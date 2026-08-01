/**
 * `biomd config …` — inspect and edit persistent configuration.
 *
 * The commands exist so nobody has to guess where settings live, which file
 * won, or whether a key was picked up. `config show` answering "where did this
 * value come from?" is the difference between a configurable tool and a
 * frustrating one.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import {
  ConfigError,
  STARTER_CONFIG,
  findProjectConfig,
  loadConfig,
  normalizeBaseUrl,
  redactKey,
  resolveGateway,
  userConfigPath,
  writeUserConfig,
} from "./config.js";
import { GatewayTransport, runTransportProbe } from "../llm/index.js";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect and edit persistent configuration");

  config
    .command("init")
    .description("Create a starter biomd.config.json in the current directory")
    .option("-f, --force", "overwrite an existing file")
    .action(async (options) => {
      const path = resolve("biomd.config.json");
      if (existsSync(path) && !options.force) {
        process.stderr.write(`${path} already exists. Use --force to overwrite.\n`);
        process.exitCode = 1;
        return;
      }
      await writeFile(path, STARTER_CONFIG, "utf8");
      process.stdout.write(
        [
          `Wrote ${path}`,
          "",
          "Next steps:",
          "  1. Edit inputDir / assetRoot to point at your HTML.",
          "  2. Deterministic conversion needs nothing else:",
          "       biomd corpus scan ./html",
          "       biomd corpus run ./html",
          "  3. Only if you want model assistance:",
          "       biomd config set-key openrouter",
          "       biomd probe",
          "",
        ].join("\n"),
      );
    });

  config
    .command("show")
    .description("Show the effective configuration and where each value came from")
    .option("-c, --config <file>", "explicit config file")
    .option("--json", "machine-readable output")
    .action(async (options) => {
      const loaded = loadConfig({ ...(options.config ? { configPath: options.config } : {}) });
      const { config: cfg, sources, paths, warnings } = loaded;

      if (options.json) {
        // Keys are redacted even here: this output ends up in bug reports.
        const safe = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
        for (const gateway of Object.values(safe.llm.gateways)) {
          if (gateway.apiKey) gateway.apiKey = "***redacted***";
        }
        process.stdout.write(`${JSON.stringify({ config: safe, sources, paths, warnings }, null, 2)}\n`);
        return;
      }

      const line = (label: string, value: unknown, key: string): string => {
        const source = sources[key] ?? "default";
        return `  ${label.padEnd(18)} ${String(value).padEnd(34)} ${dim(`[${source}]`)}`;
      };

      const out: string[] = [
        "Config files",
        `  user     ${paths.user ?? dim("(none)")}`,
        `  project  ${paths.project ?? dim("(none)")}`,
        `  .env     ${paths.dotenv ?? dim("(none)")}`,
        "",
        "Conversion",
        line("profile", cfg.profile, "profile"),
        line("layoutFidelity", cfg.layoutFidelity, "layoutFidelity"),
        line("visual", cfg.visual, "visual"),
        line("lang", cfg.lang, "lang"),
        "",
        "Paths",
        line("inputDir", cfg.inputDir ?? "(unset)", "inputDir"),
        line("assetRoot", cfg.assetRoot ?? "(unset)", "assetRoot"),
        line("outDir", cfg.outDir, "outDir"),
        line("workDir", cfg.workDir, "workDir"),
        line("corpus", cfg.corpus, "corpus"),
        line("jobs", cfg.jobs, "jobs"),
        "",
        "LLM",
        line("enabled", cfg.llm.enabled, "llm.enabled"),
        line("gateway", cfg.llm.gateway ?? "(unset)", "llm.gateway"),
        line("cacheDir", cfg.llm.cacheDir, "llm.cacheDir"),
      ];

      const gatewayNames = Object.keys(cfg.llm.gateways);
      if (gatewayNames.length === 0) {
        out.push(dim("  (no gateways defined)"));
      }
      for (const name of gatewayNames) {
        const active = name === cfg.llm.gateway;
        out.push("", `  Gateway "${name}"${active ? "  ← active" : ""}`);
        try {
          const resolved = resolveGateway(cfg, name);
          out.push(
            `    baseUrl          ${resolved.baseUrl}`,
            `    apiKey           ${redactKey(resolved.apiKey)}  ${dim(`via ${resolved.apiKeySource}`)}`,
            `    models.fast      ${resolved.models.fast}`,
            `    models.balanced  ${resolved.models.balanced}`,
            `    models.deep      ${resolved.models.deep}`,
            `    structuredOutput ${resolved.structuredOutput}`,
            `    modelIdentity    ${resolved.enforceModelIdentity ? "enforced" : "not enforced"}`,
          );
          if (Object.keys(resolved.headers).length > 0) {
            out.push(`    headers          ${Object.keys(resolved.headers).join(", ")}`);
          }
          if (!resolved.apiKey) {
            out.push(
              `    ${warn("No API key resolved.")} Run: biomd config set-key ${name}`,
            );
          }
        } catch (error) {
          out.push(`    ${warn((error as Error).message.split("\n")[0] ?? "unresolvable")}`);
        }
      }

      if (cfg.llm.budget.maxCalls !== undefined || cfg.llm.budget.maxEstimatedCostUsd !== undefined) {
        out.push(
          "",
          "  Budget",
          `    maxCalls         ${cfg.llm.budget.maxCalls ?? dim("(unlimited)")}`,
          `    maxCostUsd       ${cfg.llm.budget.maxEstimatedCostUsd ?? dim("(unlimited)")}`,
        );
      }

      if (warnings.length > 0) {
        out.push("", "Warnings");
        for (const w of warnings) out.push(`  ${warn(w)}`);
      }

      process.stdout.write(`${out.join("\n")}\n`);
    });

  config
    .command("path")
    .description("Print where configuration is read from")
    .action(() => {
      process.stdout.write(
        [
          `user config     ${userConfigPath()}${existsSync(userConfigPath()) ? "" : dim("  (not created yet)")}`,
          `project config  ${findProjectConfig() ?? dim("(none found; searched upward from cwd)")}`,
          `.env            ${resolve(".env")}${existsSync(resolve(".env")) ? "" : dim("  (not present)")}`,
          "",
          "Precedence, highest first: CLI flags → environment → project config → user config → defaults",
          "",
        ].join("\n"),
      );
    });

  config
    .command("set-key")
    .description("Store an API key in the USER config, outside the repository")
    .argument("<gateway>", "gateway name, e.g. openrouter")
    .option("--key <value>", "the key (omit to be prompted, which avoids shell history)")
    .action(async (gateway: string, options) => {
      let key: string | undefined = options.key;
      if (!key) {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        key = (await rl.question(`API key for gateway "${gateway}": `)).trim();
        rl.close();
      }
      if (!key) {
        process.stderr.write("No key provided.\n");
        process.exitCode = 1;
        return;
      }
      const path = await writeUserConfig({ llm: { gateways: { [gateway]: { apiKey: key } } } });
      process.stdout.write(
        [
          `Stored key for "${gateway}" in ${path}`,
          `  ${redactKey(key)}`,
          "",
          "This file is outside your project, so the key cannot be committed by accident.",
          "Verify with: biomd config show",
          "",
        ].join("\n"),
      );
    });

  config
    .command("set-gateway")
    .description("Define or update a gateway in the USER config")
    .argument("<name>", "gateway name, e.g. openrouter")
    .requiredOption("--url <url>", "API base URL (not the /chat/completions endpoint)")
    .option("--model <id>", "model for every tier")
    .option("--fast <id>", "model for the fast tier")
    .option("--deep <id>", "model for the deep tier")
    .option("--key <value>", "API key")
    .option("--key-env <name>", "environment variable holding the key")
    .option("--structured <mode>", "tools | json_schema | json_object")
    .option("--no-enforce-identity", "accept a resolved model that differs from the request")
    .option("--activate", "also make this the active gateway and enable the LLM")
    .action(async (name: string, options) => {
      const normalized = normalizeBaseUrl(options.url);
      const gateway: Record<string, unknown> = { baseUrl: normalized.url };

      const models: Record<string, string> = {};
      if (options.model) {
        models["fast"] = options.model;
        models["balanced"] = options.model;
        models["deep"] = options.model;
      }
      if (options.fast) models["fast"] = options.fast;
      if (options.deep) models["deep"] = options.deep;
      if (Object.keys(models).length > 0) gateway["models"] = models;

      if (options.key) gateway["apiKey"] = options.key;
      if (options.keyEnv) gateway["apiKeyEnv"] = options.keyEnv;
      if (options.structured) gateway["structuredOutput"] = options.structured;
      if (options.enforceIdentity === false) gateway["enforceModelIdentity"] = false;

      const patch: Record<string, unknown> = { llm: { gateways: { [name]: gateway } } };
      if (options.activate) {
        (patch["llm"] as Record<string, unknown>)["gateway"] = name;
        (patch["llm"] as Record<string, unknown>)["enabled"] = true;
      }

      const path = await writeUserConfig(patch);
      if (normalized.changed) {
        process.stdout.write(
          `Note: baseUrl normalized to ${normalized.url} — the client appends /chat/completions itself.\n`,
        );
      }
      process.stdout.write(`Updated gateway "${name}" in ${path}\nVerify with: biomd config show\n`);
    });

  config
    .command("test")
    .description("Send one real request to verify the gateway actually works")
    .option("-g, --gateway <name>", "override the active gateway")
    .option("--tier <tier>", "fast | balanced | deep", "fast")
    .option("--full", "run the complete five-test conformance probe")
    .action(async (options) => {
      const { config: cfg } = loadConfig();
      let gateway;
      try {
        gateway = resolveGateway(cfg, options.gateway);
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
        return;
      }

      if (!gateway.apiKey) {
        process.stderr.write(
          `No API key for gateway "${gateway.name}".\nRun: biomd config set-key ${gateway.name}\n`,
        );
        process.exitCode = 1;
        return;
      }

      const model = gateway.models[options.tier as "fast" | "balanced" | "deep"] ?? gateway.models.balanced;
      process.stdout.write(
        `Gateway "${gateway.name}"\n  ${gateway.baseUrl}\n  model ${model}\n  key ${redactKey(gateway.apiKey)}\n\n`,
      );

      const transport = new GatewayTransport({
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
        headers: gateway.headers,
        timeoutMs: gateway.timeoutMs,
        enforceModelIdentity: gateway.enforceModelIdentity,
        structuredOutput: gateway.structuredOutput,
        extraBody: gateway.extraBody,
      });

      if (options.full) {
        const report = await runTransportProbe(transport, model);
        for (const r of report.results) {
          const mark = r.passed === true ? "PASS" : r.passed === false ? "FAIL" : "SKIP";
          process.stdout.write(`${mark}  ${r.title}${r.costOnly && r.passed !== true ? " (cost only)" : ""}\n      ${r.detail}\n`);
        }
        process.stdout.write(`\n${report.summary}\n`);
        process.exitCode = report.usable ? 0 : 1;
        return;
      }

      // The quick check: one round trip that proves URL, key, model and
      // structured output all work together.
      try {
        const reply = await transport.chat({
          model,
          system: "You are a connectivity check. Answer only through the provided schema.",
          user: 'Set ok to true and note to the single word "connected".',
          schema: {
            name: "connectivity",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { ok: { type: "boolean" }, note: { type: "string" } },
              required: ["ok", "note"],
            },
          },
          maxOutputTokens: 128,
        });
        process.stdout.write(
          [
            "OK — the gateway answered with valid structured output.",
            `  resolved model  ${reply.resolvedModel}`,
            `  tokens          ${reply.usage.inputTokens} in / ${reply.usage.outputTokens} out` +
              (reply.usage.cachedInputTokens > 0 ? ` (${reply.usage.cachedInputTokens} cached)` : ""),
            `  reply           ${JSON.stringify(reply.data)}`,
            "",
            "Run `biomd config test --full` for the complete conformance probe",
            "(vision, prompt caching, transport transparency, model identity).",
            "",
          ].join("\n"),
        );
      } catch (error) {
        process.stderr.write(`FAILED: ${(error as Error).message}\n\n${troubleshoot(gateway.baseUrl)}\n`);
        process.exitCode = 1;
      }
    });
}

function troubleshoot(baseUrl: string): string {
  return [
    "Common causes:",
    `  • baseUrl wrong. It must be the API base, not the endpoint.`,
    `    yours: ${baseUrl}`,
    "    OpenRouter: https://openrouter.ai/api/v1",
    "    LiteLLM:    http://localhost:4000/v1",
    "  • key missing or wrong — check `biomd config show`",
    "  • the model id is not available on this gateway",
    "  • structuredOutput mode unsupported by the model. OpenRouter: try",
    '    "structuredOutput": "json_schema"; most others: "tools"',
  ].join("\n");
}

const useColor = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
const dim = (s: string): string => (useColor ? `[2m${s}[0m` : s);
const warn = (s: string): string => (useColor ? `[33m${s}[0m` : s);

export { ConfigError };
