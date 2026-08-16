/**
 * `biomd hooks …` — discover, inspect and exercise hooks without converting.
 *
 * This is the surface a refinement iteration works through. Its job is to make
 * four questions answerable in one command each, because a hook whose prompt
 * cannot be read, whose gate cannot be tested and whose cost cannot be seen is
 * a hook nobody will tune:
 *
 *   list   — what exists, what is on, what serves nothing, and why
 *   show   — the rendered prompts, the schema, the policy, the template hashes
 *   test   — one item, in isolation; `--dry-run` prices it without sending it
 *   cache  — drop one hook's decisions so a prompt change can be re-measured
 *
 * Nothing here can change a conversion. `test` is deliberately the only command
 * that can spend money, and it refuses to without an explicit `--live`.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { Budget, FileCache, Limiter, MemoryCache, GatewayTransport } from "../llm/index.js";
import { EventRecorder, describeEvent } from "../llm/kernel/events.js";
import { planItem, prepareHook, runHook } from "../llm/kernel/runner.js";
import { resolvePolicy } from "../llm/kernel/contract.js";
import { templateVariables } from "../llm/kernel/template.js";
import { loadConfig, resolveGateway } from "./config.js";
import { loadRegistry, prepareEnabled, resolveEnabled } from "./llm-session.js";

export function registerHookCommands(program: Command): void {
  const hooks = program.command("hooks").description("Discover, inspect and exercise LLM hooks");

  hooks
    .command("list")
    .description("Every discovered hook, whether it is enabled, and why")
    .option("-c, --config <file>", "explicit config file")
    .option("--json", "machine-readable output")
    .action(async (options) => {
      const { config: cfg } = loadConfig({ ...(options.config ? { configPath: options.config } : {}) });
      const registry = await loadRegistry(cfg);
      const { enabled, reasons } = resolveEnabled(registry, cfg);
      const on = new Set(enabled);

      // A hook whose decision point nothing declares can never fire. Saying so
      // here is the difference between an inert plugin and a silent bug.
      const points = new Set<string>(KNOWN_DECISION_POINTS);

      const rows = registry.all().map((entry) => ({
        id: entry.hook.id,
        title: entry.hook.title,
        summary: entry.hook.summary,
        version: entry.hook.version,
        stability: entry.hook.stability,
        decisionPoint: entry.hook.decisionPoint,
        wired: points.has(entry.hook.decisionPoint),
        enabled: on.has(entry.hook.id),
        enabledByDefault: entry.hook.enabledByDefault,
        why: reasons.get(entry.hook.id) ?? "not named anywhere",
        dir: entry.dir,
        builtin: entry.builtin,
      }));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ hooks: rows, enabled }, null, 2)}\n`);
        return;
      }

      if (rows.length === 0) {
        process.stdout.write("No hooks discovered. Built-in plugins live in src/llm/plugins/.\n");
        return;
      }

      process.stdout.write(`${"hook".padEnd(18)}${"on".padEnd(5)}${"wired".padEnd(7)}${"stability".padEnd(13)}point\n`);
      for (const row of rows) {
        process.stdout.write(
          `${row.id.padEnd(18)}${(row.enabled ? "yes" : "no").padEnd(5)}` +
            `${(row.wired ? "yes" : "NO").padEnd(7)}${row.stability.padEnd(13)}${row.decisionPoint}\n` +
            `  ${row.summary}\n` +
            `  ${row.why}${row.builtin ? "" : `  · ${row.dir}`}\n`,
        );
      }
      const inert = rows.filter((r) => !r.wired);
      if (inert.length > 0) {
        process.stdout.write(
          `\n${inert.length} hook(s) declare a decision point no converter stage raises: ` +
            `${inert.map((r) => r.id).join(", ")}.\n` +
            "They cannot fire. Wiring one means adding a decision point beside the rule that abstains.\n",
        );
      }
      process.stdout.write(`\nEnabled for a run: ${enabled.join(", ") || "(none — identical to --llm off)"}\n`);
    });

  hooks
    .command("show")
    .description("Everything about one hook: prompts, schema, policy, template hashes")
    .argument("<id>", "hook id, e.g. table.classify")
    .option("-c, --config <file>", "explicit config file")
    .option("--json", "machine-readable output")
    .action(async (id: string, options) => {
      const { config: cfg } = loadConfig({ ...(options.config ? { configPath: options.config } : {}) });
      const registry = await loadRegistry(cfg);
      const found = registry.get(id);
      if (!found) {
        process.stderr.write(`No hook ${JSON.stringify(id)}. Known: ${registry.ids().join(", ") || "(none)"}\n`);
        process.exitCode = 1;
        return;
      }

      const { enabled: _drop, ...override } = cfg.llm.hooks.overrides[id] ?? {};
      const policy = resolvePolicy(found.hook.defaults, { ...cfg.llm.hooks.defaults, ...override });
      const prepared = prepareHook(found.hook, policy, { fast: "fast", balanced: "balanced", deep: "deep" });
      const schema = z.toJSONSchema(found.hook.output, { io: "output" });

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              id: found.hook.id,
              title: found.hook.title,
              summary: found.hook.summary,
              version: found.hook.version,
              stability: found.hook.stability,
              decisionPoint: found.hook.decisionPoint,
              enabledByDefault: found.hook.enabledByDefault,
              requires: found.hook.requires ?? {},
              policy,
              dir: found.dir,
              templates: {
                system: { path: prepared.templates.system.path, hash: prepared.templates.system.hash },
                user: { path: prepared.templates.user.path, hash: prepared.templates.user.hash },
              },
              variables: {
                system: templateVariables(prepared.templates.system),
                user: templateVariables(prepared.templates.user),
              },
              outputSchema: schema,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      process.stdout.write(
        [
          `${found.hook.id} — ${found.hook.title}`,
          `  ${found.hook.summary}`,
          "",
          `version        ${found.hook.version}   stability ${found.hook.stability}`,
          `decision point ${found.hook.decisionPoint}`,
          `default state  ${found.hook.enabledByDefault ? "enabled" : "disabled"}`,
          `directory      ${found.dir}`,
          `policy         tier ${policy.tier}→${policy.maxTier}` +
            `${policy.escalateBelow !== undefined ? `, escalate below ${policy.escalateBelow}` : ""}` +
            `${policy.acceptAbove !== undefined ? `, accept above ${policy.acceptAbove}` : ""}` +
            `${policy.maxCalls !== undefined ? `, max ${policy.maxCalls} calls` : ""}`,
          "",
          `system prompt  ${prepared.templates.system.path}  [${prepared.templates.system.hash}]`,
          `user prompt    ${prepared.templates.user.path}  [${prepared.templates.user.hash}]`,
          `variables      ${templateVariables(prepared.templates.user).join(", ") || "(none)"}`,
          "",
          "---- system ----",
          prepared.templates.system.text.trim(),
          "",
          "---- user ----",
          prepared.templates.user.text.trim(),
          "",
          "---- reply schema ----",
          JSON.stringify(schema, null, 2),
          "",
        ].join("\n"),
      );
    });

  hooks
    .command("test")
    .description("Run one hook against a JSON item, in isolation")
    .argument("<id>", "hook id")
    .requiredOption("-i, --input <file>", "JSON file holding one { request, context } invocation")
    .option("--live", "actually call the gateway (without this, nothing is sent)")
    .option("-g, --gateway <name>", "which configured gateway to use")
    .option("-c, --config <file>", "explicit config file")
    .option("--json", "machine-readable output")
    .action(async (id: string, options) => {
      const { config: cfg } = loadConfig({ ...(options.config ? { configPath: options.config } : {}) });
      const registry = await loadRegistry(cfg);
      const found = registry.get(id);
      if (!found) {
        process.stderr.write(`No hook ${JSON.stringify(id)}. Known: ${registry.ids().join(", ") || "(none)"}\n`);
        process.exitCode = 1;
        return;
      }

      const raw = JSON.parse(await readFile(resolve(options.input as string), "utf8")) as unknown;
      const invocation = normalizeInvocation(raw, cfg.lang);

      let models = { fast: "(unconfigured)", balanced: "(unconfigured)", deep: "(unconfigured)" };
      let gateway = null as ReturnType<typeof resolveGateway> | null;
      try {
        gateway = resolveGateway(cfg, options.gateway);
        models = gateway.models;
      } catch {
        /* a dry run needs no gateway; a live run is refused below */
      }

      const { enabled: _drop, ...override } = cfg.llm.hooks.overrides[id] ?? {};
      const policy = resolvePolicy(found.hook.defaults, { ...cfg.llm.hooks.defaults, ...override });
      const prepared = prepareHook(found.hook, policy, models);
      const plan = planItem(prepared, invocation);

      if (options.live !== true) {
        // The dry run is the default because the point of this command is to
        // see the question before paying for the answer.
        const out = {
          hook: id,
          dryRun: true,
          gate: plan.gate,
          model: plan.model,
          estimatedInputTokens: plan.estimatedInputTokens,
          system: plan.system,
          user: plan.user,
        };
        if (options.json) {
          process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
        } else {
          process.stdout.write(
            [
              `${id} — dry run, nothing sent`,
              `gate: ${plan.gate.call ? "OPEN" : "CLOSED"} — ${plan.gate.reason}`,
              `model: ${plan.model}   ~${plan.estimatedInputTokens} input tokens`,
              "",
              "---- system ----",
              plan.system,
              "",
              "---- user ----",
              plan.user,
              "",
              "Add --live to send it.",
              "",
            ].join("\n"),
          );
        }
        return;
      }

      if (!gateway?.apiKey) {
        process.stderr.write("A live run needs a configured gateway and key. Run `biomd config show`.\n");
        process.exitCode = 1;
        return;
      }

      const recorder = new EventRecorder();
      const budget = new Budget(cfg.llm.budget, {
        input: cfg.llm.prices.input,
        output: cfg.llm.prices.output,
        cachedInputMultiplier: cfg.llm.prices.cachedInputMultiplier,
      });
      const outcome = await runHook(
        prepared,
        invocation,
        {
          transport: new GatewayTransport({
            baseUrl: gateway.baseUrl,
            apiKey: gateway.apiKey,
            headers: gateway.headers,
            structuredOutput: gateway.structuredOutput,
            extraBody: gateway.extraBody,
            enforceModelIdentity: gateway.enforceModelIdentity,
            timeoutMs: gateway.timeoutMs,
          }),
          cache: cfg.llm.cacheDir ? new FileCache(resolve(cfg.llm.cacheDir)) : new MemoryCache(),
          budget,
          limiter: new Limiter({ default: 1 }),
          endpoint: gateway.name,
          onEvent: recorder.sink,
        },
        "hooks-test",
      );

      const usage = budget.usage();
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ hook: id, outcome, usage, events: recorder.events }, null, 2)}\n`);
        return;
      }
      for (const event of recorder.events) process.stdout.write(`  ${describeEvent(event)}\n`);
      process.stdout.write(
        `\n${outcome.status.toUpperCase()}\n${JSON.stringify(outcome, null, 2)}\n` +
          `\ntokens ${usage.inputTokens} in / ${usage.outputTokens} out` +
          `${usage.estimatedCostUsd > 0 ? `, est. $${usage.estimatedCostUsd.toFixed(4)}` : ", unpriced"}\n`,
      );
    });

  hooks
    .command("cache-clear")
    .description("Drop one hook's cached decisions, so a prompt change can be re-measured")
    .argument("<id>", "hook id")
    .option("-c, --config <file>", "explicit config file")
    .action(async (id: string, options) => {
      const { config: cfg } = loadConfig({ ...(options.config ? { configPath: options.config } : {}) });
      if (!cfg.llm.cacheDir) {
        process.stdout.write("No cacheDir configured; nothing to clear.\n");
        return;
      }
      const removed = await new FileCache(resolve(cfg.llm.cacheDir)).invalidateHook(id);
      process.stdout.write(`Removed ${removed} cached decision(s) for ${id}.\n`);
    });
}

/**
 * Decision points the compiler raises.
 *
 * Listed here only so `hooks list` can tell an inert plugin from a live one.
 * It is a *report*, not a registry: nothing dispatches through it, and a hook
 * missing from it still works the moment its decision point is declared.
 */
const KNOWN_DECISION_POINTS = ["table.classify", "table.records"] as const;

/**
 * Accept a bare request as well as a full invocation.
 *
 * A fixture written by hand is almost always the request; requiring the
 * `{ request, context }` envelope for every one of them is friction with no
 * benefit, so a bare object is wrapped with the configured language.
 */
function normalizeInvocation(raw: unknown, lang: string): { request: unknown; context: { lang: string } } {
  const value = raw as { request?: unknown; context?: { lang?: string } } | null;
  if (value && typeof value === "object" && "request" in value) {
    return { request: value.request, context: { lang: value.context?.lang ?? lang, ...value.context } };
  }
  return { request: raw, context: { lang } };
}
