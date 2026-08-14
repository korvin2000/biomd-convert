#!/usr/bin/env node
/**
 * `biomd` — the command line.
 *
 * Three things the surface is shaped around:
 *   - `--llm off` is the default and must always produce usable output;
 *   - a corpus run is resumable, because a thousand-file job will be interrupted;
 *   - nothing paid happens before `llm-plan --dry-run` has been seen.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { Command } from "commander";
import PQueue from "p-queue";
import {
  ABC_LINK_PROFILE,
  Lexicon,
  convert,
  runCorpusPass,
  type CorpusProfile,
} from "../convert-core/index.js";
import { createHyphenopolyOracle, createWordDictionary } from "../convert-core/dehyphenate.js";
import { createMeasurer, type VisualMode } from "../ladom/measure.js";
import { parseHtml } from "../ladom/parse.js";
import { quarantineServerMarkup } from "../ladom/quarantine.js";
import { decodeHtml } from "../ladom/encoding.js";
import { PROFILES, resolveProfile, read as readBiomd, lintText } from "../biomd-ast/index.js";
import {
  SourceIndex,
  buildLedger,
  diffDocuments,
  renderLedger,
  renderReport,
  scoreDocumentSources,
  triage,
  type LedgerFinding,
} from "../eval/index.js";
import { L3Probe, compareRendered, renderBiomd, type L3Result } from "../l3/index.js";
import { ENGINE_VERSION, JobStore, hashOf, writeAtomic } from "./store.js";
import {
  Budget,
  DEFAULT_HOOKS,
  FileCache,
  GatewayResolver,
  GatewayTransport,
  HOOK_CATALOGUE,
  MemoryCache,
  hookIds,
  runTransportProbe,
} from "../llm/index.js";
import type { ConvertEvent, DecisionResolver, ResolverStats } from "../convert-core/index.js";
import { ConfigError, loadConfig, resolveGateway, redactKey, type Config } from "./config.js";
import { registerConfigCommands } from "./config-cmd.js";

/**
 * Build the escalation boundary from configuration.
 *
 * Returns null whenever a model must not be used — `llm.enabled` off, `--llm
 * off`, no gateway, no key. Every one of those is a normal, supported state: the
 * pipeline is deterministic-first and a null resolver simply means the residual
 * ambiguity becomes review items instead of requests.
 */
/**
 * Which escalations a run may make, from the flag, the config, or the default.
 *
 * The default is nothing. `--llm assist` configures a gateway and asks it
 * nothing; a hook fires because somebody named it. `--llm review` is the one
 * shorthand, and it names exactly one hook — the whole-document reading pass,
 * which cannot change a byte of output.
 *
 * `none` is accepted and beats everything, including a config file, so a project
 * that has hooks configured can still be run clean from the command line without
 * editing anything.
 */
function hookSelection(cfg: Config, mode: string, flag?: string): readonly string[] | undefined {
  const explicit = flag ?? (cfg.llm.hooks.length > 0 ? cfg.llm.hooks.join(",") : undefined);
  if (explicit !== undefined) {
    const names = explicit
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.includes("none") || names.includes("off")) return [];
    if (names.includes("*") || names.includes("all")) return hookIds();
    return names;
  }
  return mode === "review" ? ["document.review"] : undefined;
}

/**
 * Reject hook ids that name nothing, loudly, before anything runs.
 *
 * A typo used to be silent: the id went into a `Set`, matched no catalogue
 * entry, and the run proceeded with one fewer escalation than the operator
 * believed he had asked for. Since a hook now only ever fires because it was
 * named, a name that matches nothing is a broken instruction, not a preference.
 */
function checkHookNames(names: readonly string[]): void {
  const known = new Set(hookIds());
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new ConfigError(
      `unknown escalation id(s): ${unknown.join(", ")}\n` +
        `known ids: ${hookIds().join(", ")}\n` +
        "Run `biomd llm-plan` to see what each one is asked and what checks its answer.",
    );
  }
}

function makeResolver(
  cfg: Config,
  options: { llm?: string; gateway?: string; replay?: boolean; hooks?: string },
  onEvent?: (event: { type: string; hook: string }) => void,
): { resolver: DecisionResolver | null; budget: Budget | null; note: string } {
  const mode = (options.llm as string | undefined) ?? (cfg.llm.enabled ? "assist" : "off");
  if (mode === "off") return { resolver: null, budget: null, note: "llm off — fully deterministic" };

  // An enabled gateway with no hook named is a run that would make no requests.
  // Say so and hand back no resolver at all, so the pipeline takes exactly the
  // deterministic path — rather than carrying a resolver that answers every
  // question with null and reporting escalation points nothing could reach.
  const selection = hookSelection(cfg, mode, options.hooks);
  if (selection !== undefined) checkHookNames(selection);
  if (selection !== undefined && selection.length === 0) {
    return { resolver: null, budget: null, note: "llm off — no escalation enabled (`--hooks <id>` turns one on)" };
  }
  if (selection === undefined && DEFAULT_HOOKS.length === 0) {
    return {
      resolver: null,
      budget: null,
      note:
        `llm ${mode} requested, but no escalation is enabled, so nothing will be asked.\n` +
        "Escalations are opt-in: name one with `--hooks <id>` or `llm.hooks` in the config.\n" +
        "`biomd llm-plan` lists them, what each is asked, and what checks its answer.",
    };
  }

  let gateway;
  try {
    gateway = resolveGateway(cfg, options.gateway);
  } catch (error) {
    return { resolver: null, budget: null, note: `llm unavailable: ${(error as Error).message.split("\n")[0]}` };
  }
  if (!gateway.apiKey && !options.replay) {
    return {
      resolver: null,
      budget: null,
      note: `llm unavailable: no API key for gateway "${gateway.name}" (${gateway.apiKeySource}). ` +
        "Run `biomd config set-key <gateway>`.",
    };
  }

  const transport = new GatewayTransport({
    baseUrl: gateway.baseUrl,
    ...(gateway.apiKey ? { apiKey: gateway.apiKey } : {}),
    headers: gateway.headers,
    structuredOutput: gateway.structuredOutput,
    extraBody: gateway.extraBody,
    enforceModelIdentity: gateway.enforceModelIdentity,
    timeoutMs: gateway.timeoutMs,
  });
  const budget = new Budget(cfg.llm.budget, {
    input: cfg.llm.prices.input,
    output: cfg.llm.prices.output,
    cachedInputMultiplier: cfg.llm.prices.cachedInputMultiplier,
  });
  const cache = cfg.llm.cacheDir ? new FileCache(resolve(cfg.llm.cacheDir)) : new MemoryCache();

  const hooks = selection;
  const resolver = new GatewayResolver({
    transport,
    cache,
    budget,
    models: gateway.models,
    lang: cfg.lang,
    ...(hooks ? { hooks } : {}),
    ...(options.replay ? { replay: true } : {}),
    ...(onEvent ? { onEvent } : {}),
  });
  return {
    resolver,
    budget,
    note:
      `llm ${mode} via "${gateway.name}" (${gateway.models.fast} → ${gateway.models.deep}), ` +
      `key ${redactKey(gateway.apiKey)}\n` +
      `escalations enabled: ${resolver.enabledHooks().join(", ")}`,
  };
}

function describeResolverStats(stats: ResolverStats, budget: Budget | null): string {
  const usage = budget?.usage();
  const parts = [
    `escalations: ${stats.resolved}/${stats.consulted} resolved`,
    `model calls: ${stats.calls}`,
    `cache hits: ${stats.cacheHits}`,
  ];
  if (usage && usage.calls > 0) {
    parts.push(
      `tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`,
      usage.estimatedCostUsd > 0 ? `est. $${usage.estimatedCostUsd.toFixed(4)}` : "unpriced",
    );
  }

  const lines = [parts.join("  ")];

  // Calls that resolved nothing are the case that most needs explaining: a
  // mistyped model id, an expired key and an exhausted budget all look like
  // "the LLM does nothing" until the reason is on screen.
  if (stats.failures.length > 0) {
    lines.push("");
    if (stats.calls > 0 && stats.resolved === 0) {
      lines.push(
        `                ${stats.calls} model call(s) were made and none produced a usable decision:`,
      );
    } else {
      lines.push("                unresolved escalations:");
    }
    for (const failure of stats.failures.slice(0, 5)) {
      lines.push(`                  ${failure.count}× ${failure.reason}`);
    }
    if (stats.calls > 0 && stats.resolved === 0) {
      lines.push("                Check the model id and key with: biomd probe");
    }
  }
  return lines.join("\n");
}

/**
 * Print the conversion as it happens.
 *
 * ## Two audiences, two thresholds
 *
 * **Escalations print whenever one happens, verbose or not.** A model call costs
 * money and can change the document; there is no run in which the operator
 * should have to have guessed the right flag beforehand to find out one
 * occurred. `-v` adds the deterministic passes — which stage ran, how long it
 * took, and what it decided.
 *
 * ## What a line has to carry
 *
 * The version this replaces printed an outcome and a count, which reads the same
 * whether a hook did something right or wrote `когдато` into the text. Every
 * line that corresponds to a change therefore shows the change:
 *
 * ```
 *   1243ms  text      412 hyphen decision(s), 7 unresolved
 *             join  раз-\nные → разные
 *             kept  когда-\nто → когда-то
 *           + table.classify   t3   UNKNOWN → DATA
 *                              why: three repeating columns with a consistent shape
 *           ✗ table.records    t7   refused: 4 labels for 3 columns
 * ```
 *
 * `refused` is the line worth watching: a model answered, an acceptance check
 * turned it down, and the deterministic answer stands. It is invisible in a call
 * count and it is exactly what says a prompt has drifted.
 *
 * `label` prefixes every line during a corpus run, because otherwise interleaved
 * files are unreadable — though a run with escalations on is single-file at a
 * time anyway, for reasons the `corpus run` command explains.
 */
function progressPrinter(label?: string): (event: ConvertEvent) => void {
  const MARK: Record<string, string> = { asked: "?", resolved: "+", declined: "·", refused: "✗" };
  const prefix = label ? `${label}  ` : "";
  const out = (line: string): void => {
    process.stderr.write(`${prefix}${line}\n`);
  };
  return (event) => {
    if (event.type === "stage") {
      out(`  ${String(event.elapsedMs).padStart(5)}ms  ${event.stage.padEnd(9)} ${event.detail}`);
      for (const change of event.changes ?? []) out(`            ${change}`);
      return;
    }
    if (event.type === "escalation") {
      const mark = MARK[event.outcome] ?? " ";
      const detail = event.detail ? `  ${event.detail}` : "";
      out(`          ${mark} ${event.hook.padEnd(16)} ${event.item}${detail}`);
      if (event.before !== undefined || event.after !== undefined) {
        out(`                             ${event.before ?? "?"} → ${event.after ?? "?"}`);
      }
      if (event.reason) out(`                             why: ${event.reason}`);
      return;
    }
    out(`          ${event.text}`);
  };
}

/**
 * The printer a run should use, given its flags.
 *
 * Returns `undefined` only when there is genuinely nothing to say: no verbose
 * flag *and* no resolver, so no escalation can occur. Anywhere else the pipeline
 * gets a printer, and the printer itself decides what is loud enough to show.
 */
function progressFor(
  options: { verbose?: boolean; quiet?: boolean },
  resolver: DecisionResolver | null,
  label?: string,
): ((event: ConvertEvent) => void) | undefined {
  if (options.quiet) return undefined;
  if (!options.verbose && !resolver) return undefined;
  const print = progressPrinter(label);
  if (options.verbose) return print;
  // Escalations only: a run that did not ask for the deterministic narration
  // still gets told, in full, about every question that went to a model.
  return (event) => {
    if (event.type === "escalation") print(event);
  };
}

/** Findings from the reading review, which change nothing and are worth reading. */
function printReviewFindings(findings: ReadonlyArray<{ severity: string; class: string; quote: string; note: string }>): void {
  if (findings.length === 0) return;
  process.stdout.write(`\nReading review — ${findings.length} finding(s), advisory, nothing was changed:\n`);
  for (const finding of findings) {
    process.stdout.write(`  [${finding.severity}] ${finding.class}\n`);
    process.stdout.write(`      ${JSON.stringify(finding.quote.slice(0, 100))}\n`);
    process.stdout.write(`      ${finding.note}\n`);
  }
}

/**
 * Resolve settings for a command: config file first, CLI flags on top.
 *
 * Every flag is optional. A configured project needs `biomd corpus run` and
 * nothing else; flags exist for one-off overrides.
 */
function settings(options: Record<string, unknown>): Config {
  const flags: Record<string, unknown> = {};
  for (const key of ["profile", "layoutFidelity", "visual", "lang", "outDir", "workDir", "corpus", "assetRoot", "jobs"]) {
    if (options[key] !== undefined) flags[key] = key === "jobs" ? Number(options[key]) : options[key];
  }
  const loaded = loadConfig({
    flags,
    ...(options["config"] ? { configPath: options["config"] as string } : {}),
  });
  for (const warning of loaded.warnings) process.stderr.write(`warning: ${warning}\n`);
  return loaded.config;
}

const program = new Command();

program
  .name("biomd")
  .description("Legacy HTML → BioMD Lite conversion compiler")
  .version(ENGINE_VERSION);

// ---------------------------------------------------------------------------

program
  .command("convert")
  .description("Convert one HTML file")
  .argument("<input>", "source .htm/.html file")
  .option("-o, --out <file>", "write the .bio.md here (default: alongside the input)")
  .option("-w, --work-dir <dir>", "job artifact directory")
  .option("-p, --profile <id>", `target profile (${Object.keys(PROFILES).join(" | ")})`)
  .option("--layout-fidelity <mode>", "simplified | faithful")
  .option("--visual <mode>", "never | auto | always")
  .option("--asset-root <dir>", "resolve relative assets from here during measurement")
  .option("--lang <code>", "primary language for hyphenation")
  .option("--corpus <file>", "corpus-profile.json from `biomd corpus scan`")
  .option("--llm <mode>", "off | assist | review — escalate the residual ambiguity to a model")
  .option("--hooks <ids>", "comma-separated escalation ids, or `all` (see `biomd llm-plan`)")
  .option("-g, --gateway <name>", "which configured gateway to use")
  .option("--replay", "use only cached model decisions; never call the network")
  .option("-c, --config <file>", "explicit config file")
  .option("-v, --verbose", "print each stage and each escalation as it happens")
  .option("--quiet", "only print the output path")
  .action(async (input: string, options) => {
    const cfg = settings(options);
    const bytes = await readFile(resolve(input));
    const profile = resolveProfile(cfg.profile);
    const corpus = await loadCorpus(cfg.corpus, true);

    const measurer = await createMeasurer(cfg.visual as VisualMode);
    const oracle = await createHyphenopolyOracle([cfg.lang, "en-us"]);
    const dictionary = await createWordDictionary(cfg.lang);
    const { resolver, budget, note } = makeResolver(cfg, options);
    if (!options.quiet) process.stderr.write(`${note}\n`);
    const onProgress = progressFor(options, resolver);

    try {
      const store = await JobStore.open(resolve(cfg.workDir), basename(input), bytes, profile.id);
      const result = await convert(bytes, {
        sourceName: basename(input),
        profile,
        links: ABC_LINK_PROFILE,
        layoutFidelity: cfg.layoutFidelity,
        measurer,
        oracle,
        dictionary,
        lang: cfg.lang,
        ...(resolver ? { resolver } : {}),
        ...(onProgress ? { onProgress } : {}),
        ...(cfg.assetRoot ? { assetRoot: resolve(cfg.assetRoot) } : {}),
        ...(corpus ? { lexicon: Lexicon.fromJSON(corpus.lexicon) } : {}),
        ...(corpus ? { corpusProfile: corpus } : {}),
      });

      const sourceHash = hashOf(bytes);
      await store.put("02-repair/repaired.html", result.repairedHtml, "repair", sourceHash);
      await store.put("04-clean/clean-body.html", result.cleanHtml, "sanitize", sourceHash);
      await store.putJson("01-decode/encoding-report.json", result.encoding, "decode", sourceHash);
      await store.putJson("05-ir/ledger.json", result.ledger, "ir", sourceHash);
      await store.putJson("05-ir/text-operations.json", result.textOperations, "text", sourceHash);
      await store.putJson("08-validation/report.json", {
        state: result.state,
        conservation: result.conservation,
        diagnostics: result.diagnostics,
        complexity: result.complexity,
        classifications: result.classifications,
        warnings: result.warnings,
        measured: result.measured,
      }, "verify", sourceHash);
      await store.put("07-output/document.bio.md", result.markdown, "serialize", sourceHash);

      const outPath = options.out
        ? resolve(options.out)
        : join(resolve(cfg.outDir), `${basename(input, extname(input))}.bio.md`);
      await writeAtomic(outPath, result.markdown);

      await store.finish(result.state, {
        conservationOk: result.conservation.ok,
        textRecall: Number(result.conservation.text.recall.toFixed(4)),
        errors: result.diagnostics.filter((d) => d.severity === "error").length,
        reviews: result.ledger.filter((e) => e.terminal.kind === "REVIEW").length,
        measured: result.measured,
      });

      if (options.quiet) {
        process.stdout.write(`${outPath}\n`);
      } else {
        printResult(input, outPath, result, store.root);
        if (resolver) process.stdout.write(`LLM:          ${describeResolverStats(result.resolverStats, budget)}\n`);
        printReviewFindings(result.reviewFindings);
      }
      process.exitCode = result.state === "conversion-review-required" ? 2 : 0;
    } finally {
      await measurer.close();
    }
  });

// ---------------------------------------------------------------------------

const corpus = program.command("corpus").description("Corpus-wide operations");

corpus
  .command("scan")
  .description("Stage 0: template fingerprints, chrome model and lexicon over the whole corpus")
  .argument("[dir]", "directory of .htm/.html files (defaults to config inputDir)")
  .option("-o, --out <file>", "corpus profile output (defaults to config `corpus`)")
  .option("--chrome-threshold <n>", "fraction of pages a structure must recur on", "0.7")
  .option("-c, --config <file>", "explicit config file")
  .action(async (dirArg: string | undefined, options) => {
    const cfg = settings(options);
    const dir = dirArg ?? cfg.inputDir;
    if (!dir) {
      process.stderr.write(
        "No input directory. Pass one, or set `inputDir` in biomd.config.json (see `biomd config init`)." + "\n",
      );
      process.exitCode = 1;
      return;
    }
    options.out = options.out ?? cfg.corpus;
    const files = await collectHtml(resolve(dir));
    process.stderr.write(`Scanning ${files.length} file(s)…\n`);
    const loaded = await Promise.all(
      files.map(async (path) => ({ name: basename(path), bytes: await readFile(path) })),
    );
    const profile = runCorpusPass(loaded, { chromeThreshold: Number(options.chromeThreshold) });
    await writeAtomic(resolve(options.out), `${JSON.stringify(profile, null, 2)}\n`);

    const lexicon = Lexicon.fromJSON(profile.lexicon);
    const stats = lexicon.stats();
    process.stdout.write(
      [
        `Files scanned:        ${profile.files}`,
        `Distinct fingerprints:${Object.keys(profile.fingerprintFrequency).length}`,
        `Chrome structures:    ${profile.stableChrome.length}`,
        `Lexicon:              ${stats.words} forms, ${stats.tokens} tokens, ${stats.hyphenatedForms} hyphenated`,
        `Uncertain encodings:  ${Object.values(profile.encodings).filter((e) => e.uncertain).length}`,
        `Written to            ${resolve(options.out)}`,
        "",
      ].join("\n"),
    );
    // A profile that could not measure recurrence says so here, where the
    // operator is standing, rather than only inside the JSON it just wrote.
    for (const warning of profile.warnings) process.stderr.write(`warning: ${warning}\n`);
  });

corpus
  .command("run")
  .description("Convert every file in a directory, resumable")
  .argument("[dir]", "directory of .htm/.html files (defaults to config inputDir)")
  .option("-w, --work-dir <dir>", "job artifact directory")
  .option("-O, --out-dir <dir>", "write .bio.md files here")
  .option("-p, --profile <id>", "target profile")
  .option("--layout-fidelity <mode>", "simplified | faithful")
  .option("--visual <mode>", "never | auto | always")
  .option("--asset-root <dir>", "resolve relative assets from here")
  .option("--corpus <file>", "corpus-profile.json")
  .option("--lang <code>", "primary language")
  .option("-j, --jobs <n>", "concurrent conversions")
  .option("--llm <mode>", "off | assist | review — escalate the residual ambiguity to a model")
  .option("--hooks <ids>", "comma-separated escalation ids, or `all` (see `biomd llm-plan`)")
  .option("-g, --gateway <name>", "which configured gateway to use")
  .option("--replay", "use only cached model decisions; never call the network")
  .option("-c, --config <file>", "explicit config file")
  .option("-v, --verbose", "print each stage and each escalation as it happens")
  .action(async (dirArg: string | undefined, options) => {
    const cfg = settings(options);
    const dir = dirArg ?? cfg.inputDir;
    if (!dir) {
      process.stderr.write(
        "No input directory. Pass one, or set `inputDir` in biomd.config.json (see `biomd config init`)." + "\n",
      );
      process.exitCode = 1;
      return;
    }
    const files = await collectHtml(resolve(dir));
    const profile = resolveProfile(cfg.profile);
    const corpusProfile = await loadCorpus(cfg.corpus, true);
    const lexicon = corpusProfile ? Lexicon.fromJSON(corpusProfile.lexicon) : new Lexicon();

    const measurer = await createMeasurer(cfg.visual as VisualMode);
    const oracle = await createHyphenopolyOracle([cfg.lang, "en-us"]);
    const dictionary = await createWordDictionary(cfg.lang);

    // One resolver for the whole run: the budget is a corpus-wide cap, and the
    // decision cache is shared, so the same ambiguous table on forty pages costs
    // one request rather than forty.
    const { resolver, budget, note } = makeResolver(cfg, options);
    process.stderr.write(`${note}\n`);

    // Browser contexts are the scarce resource; conversions are cheap — but a
    // resolver makes them expensive in a way concurrency multiplies. Four
    // conversions in flight is four independent streams of requests against one
    // budget, four interleaved progress printers, and no order an operator can
    // read. It also makes the run's cost depend on `jobs`, which is supposed to
    // be a speed knob.
    //
    // So escalation forces one file at a time. It is slower and it is the only
    // setting in which "stop, that hook is wrong" is a thing you can act on
    // before the bill arrives.
    const concurrency = resolver ? 1 : measurer.available ? Math.min(cfg.jobs, 4) : cfg.jobs;
    if (resolver && cfg.jobs > 1) {
      process.stderr.write(`jobs: 1 (escalation is enabled; requests are made one at a time)\n`);
    }
    const queue = new PQueue({ concurrency });

    const tally = { complete: 0, review: 0, failed: 0 };
    const escalationTotals: Pick<ResolverStats, "consulted" | "resolved" | "byHook"> = {
      consulted: 0,
      resolved: 0,
      byHook: {},
    };
    const rows: string[] = [];
    /**
     * Reading-review findings, kept across the whole run.
     *
     * Reported per class rather than per file: a thousand pages producing the
     * same finding once each is one defect in the rule system, and a thousand
     * lines of it is noise that hides that.
     */
    const findingsByClass = new Map<string, { count: number; severity: string; example: string; file: string }>();

    try {
      await Promise.all(
        files.map((path) =>
          queue.add(async () => {
            try {
              const bytes = await readFile(path);
              const store = await JobStore.open(resolve(cfg.workDir), basename(path), bytes, profile.id);
              const result = await convert(bytes, {
                sourceName: basename(path),
                profile,
                layoutFidelity: cfg.layoutFidelity,
                measurer,
                oracle,
                dictionary,
                lexicon,
                lang: cfg.lang,
                ...(resolver ? { resolver } : {}),
                ...(() => {
                  const onProgress = progressFor(options, resolver, basename(path));
                  return onProgress ? { onProgress } : {};
                })(),
                ...(cfg.assetRoot ? { assetRoot: resolve(cfg.assetRoot) } : {}),
                ...(corpusProfile ? { corpusProfile } : {}),
              });

              const outPath = join(resolve(cfg.outDir), `${basename(path, extname(path))}.bio.md`);
              await writeAtomic(outPath, result.markdown);
              await store.put("07-output/document.bio.md", result.markdown, "serialize", hashOf(bytes));
              await store.putJson("08-validation/report.json", {
                state: result.state,
                conservation: result.conservation,
                diagnostics: result.diagnostics,
              }, "verify", hashOf(bytes));
              await store.finish(result.state);

              if (result.state === "conversion-review-required") tally.review += 1;
              else tally.complete += 1;
              escalationTotals.consulted += result.resolverStats.consulted;
              escalationTotals.resolved += result.resolverStats.resolved;
              for (const [hook, counts] of Object.entries(result.resolverStats.byHook)) {
                const bucket = (escalationTotals.byHook[hook] ??= {
                  consulted: 0,
                  calls: 0,
                  cacheHits: 0,
                  unresolved: 0,
                });
                bucket.consulted += counts.consulted;
                bucket.calls += counts.calls;
                bucket.cacheHits += counts.cacheHits;
                bucket.unresolved += counts.unresolved;
              }
              for (const finding of result.reviewFindings) {
                const existing = findingsByClass.get(finding.class);
                if (existing) existing.count += 1;
                else {
                  findingsByClass.set(finding.class, {
                    count: 1,
                    severity: finding.severity,
                    example: finding.quote.slice(0, 80),
                    file: basename(path),
                  });
                }
              }
              const wantTables = result.tables.filter((t) => t.classification === "DATA").length;
              const gotTables = result.tables.filter((t) => t.emittedTable).length;
              rows.push(
                `${result.state === "conversion-review-required" ? "REVIEW " : "ok     "} ${basename(path)}  ` +
                  `recall=${(result.conservation.text.recall * 100).toFixed(1)}%  ` +
                  `errors=${result.diagnostics.filter((d) => d.severity === "error").length}  ` +
                  `reviews=${result.ledger.filter((e) => e.terminal.kind === "REVIEW").length}  ` +
                  `tables=${gotTables}/${wantTables}  ` +
                  `llm=${result.resolverStats.resolved}/${result.resolverStats.consulted}`,
              );
            } catch (error) {
              tally.failed += 1;
              rows.push(`FAILED  ${basename(path)}  ${(error as Error).message}`);
            }
          }),
        ),
      );
    } finally {
      await measurer.close();
    }

    rows.sort();
    process.stdout.write(`${rows.join("\n")}\n\n`);

    process.stdout.write(
      [
        `Converted:      ${tally.complete}`,
        `Needs review:   ${tally.review}`,
        `Failed:         ${tally.failed}`,
        `Clean share:    ${((tally.complete / Math.max(1, files.length)) * 100).toFixed(1)}%`,
        resolver
          ? `LLM:            ${describeResolverStats({ ...resolver.stats(), ...escalationTotals }, budget)}`
          : `LLM:            off — ${escalationTotals.consulted} escalation point(s) left as review items`,
        "",
      ].join("\n"),
    );

    // Per hook, whether or not a model ran. This is the number that answers
    // "which escalation would be worth turning on, and what would it cost?",
    // and it is only obtainable from a deterministic run.
    const ranked = [...Object.entries(escalationTotals.byHook)]
      .filter(([, counts]) => counts.consulted > 0)
      .sort((a, b) => b[1].consulted - a[1].consulted);
    if (ranked.length > 0) {
      process.stdout.write("Escalation points the rules left open, by hook:\n");
      for (const [hook, counts] of ranked) {
        const spent = counts.calls > 0 || counts.cacheHits > 0 ? `  (${counts.calls} call(s), ${counts.cacheHits} cached)` : "";
        process.stdout.write(`  ${String(counts.consulted).padStart(5)}  ${hook}${spent}\n`);
      }
      process.stdout.write("\n");
    }

    if (findingsByClass.size > 0) {
      const order = { critical: 0, major: 1, minor: 2 } as Record<string, number>;
      const ranked = [...findingsByClass].sort(
        (a, b) => (order[a[1].severity] ?? 3) - (order[b[1].severity] ?? 3) || b[1].count - a[1].count,
      );
      process.stdout.write(
        `Reading review — ${ranked.length} class(es) over ${[...findingsByClass.values()].reduce((n, f) => n + f.count, 0)} finding(s). Advisory; no output was changed.\n`,
      );
      for (const [name, info] of ranked) {
        process.stdout.write(`  [${info.severity}] ${name}  ×${info.count}\n`);
        process.stdout.write(`      e.g. ${info.file}: ${JSON.stringify(info.example)}\n`);
      }
      process.stdout.write("\n");
    }

    process.exitCode = tally.failed > 0 ? 1 : 0;
  });

// ---------------------------------------------------------------------------

program
  .command("eval")
  .description("Score converted output against hand-written reference .bio.md files")
  .argument("[actualDir]", "directory of produced .bio.md files (defaults to config outDir)")
  .option("-e, --expected <dir>", "directory of reference .bio.md files (default: config `expectedDir`)")
  .option("-v, --verbose", "list what each document is missing")
  .option("--json <file>", "also write the full score as JSON")
  .option("-c, --config <file>", "explicit config file")
  .action(async (actualArg: string | undefined, options) => {
    const cfg = settings(options);
    const actualDir = resolve(actualArg ?? cfg.outDir);
    const expectedArg = (options.expected as string | undefined) ?? cfg.expectedDir;

    // Scoring needs a reference set, and most projects do not have one — it is
    // hand-written, one document at a time. Saying so is the whole job here; the
    // previous behaviour defaulted to a path inside this repository and, run
    // anywhere else, surfaced as a raw ENOENT stack trace from `readdir`.
    if (!expectedArg) {
      process.stderr.write(
        [
          "biomd eval compares your output against reference .bio.md files that you wrote by hand.",
          "",
          "Point it at them:",
          "  biomd eval --expected ./reference",
          "",
          "…or set the directory once, in biomd.config.json:",
          '  "expectedDir": "./reference"',
          "",
          "A reference document is simply the conversion you would have written yourself for one",
          "page, named after it — `barrios.htm` → `barrios.bio.md`. A handful is enough to measure",
          "with; they do not need to cover the corpus.",
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const expectedDir = resolve(expectedArg);
    let entries: string[];
    try {
      entries = await readdir(expectedDir);
    } catch {
      process.stderr.write(
        `No reference directory at ${expectedDir}.\n` +
          "Pass --expected <dir>, or set `expectedDir` in biomd.config.json.\n",
      );
      process.exitCode = 1;
      return;
    }

    const files: Array<{ name: string; expected: string; actual: string }> = [];
    const absent: string[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".bio.md")) continue;
      const actualPath = join(actualDir, entry);
      let actual: string;
      try {
        actual = await readFile(actualPath, "utf8");
      } catch {
        absent.push(entry);
        actual = "";
      }
      files.push({ name: entry.replace(/\.bio\.md$/u, ""), expected: await readFile(join(expectedDir, entry), "utf8"), actual });
    }

    if (files.length === 0) {
      process.stderr.write(
        `No \`.bio.md\` reference documents in ${expectedDir} (found ${entries.length} other entr${entries.length === 1 ? "y" : "ies"}).\n`,
      );
      process.exitCode = 1;
      return;
    }

    const { documents, overall } = scoreDocumentSources(files);
    process.stdout.write(renderReport(documents, overall, options.verbose === true));
    for (const name of absent) process.stdout.write(`note: no output produced for ${name}\n`);
    if (options.json) {
      await writeAtomic(resolve(options.json as string), `${JSON.stringify({ overall, documents }, null, 2)}\n`);
    }
  });

// ---------------------------------------------------------------------------

program
  .command("diff")
  .description("L2: structural adjudication of produced .bio.md against the reference, as localized findings")
  .argument("[produced]", "produced .bio.md, or omit for a corpus-wide roll-up over the reference set")
  .argument("[reference]", "reference .bio.md")
  .option("-e, --expected <dir>", "directory of reference .bio.md files (default: config `expectedDir`)")
  .option("-i, --input-dir <dir>", "directory of source .htm files, for source-backing triage")
  .option("--json <file>", "write the defect ledger here")
  .option("--class <name>", "only findings whose class starts with this prefix")
  .option("--doc <name>", "only this document")
  .option("--verdict <kind>", "converter-defect | acceptable-alternative | reference-inconsistency | ambiguous")
  .option("-l, --limit <n>", "classes to list in the roll-up", "30")
  .option("-v, --verbose", "list every finding, not just the class roll-up")
  .option("-c, --config <file>", "explicit config file")
  .action(async (producedArg: string | undefined, referenceArg: string | undefined, options) => {
    const cfg = settings(options);
    const pairs: Array<{ doc: string; produced: string; reference: string; source: string | null }> = [];

    if (producedArg && referenceArg) {
      pairs.push({
        doc: basename(producedArg).replace(/\.bio\.md$/u, ""),
        produced: await readFile(resolve(producedArg), "utf8"),
        reference: await readFile(resolve(referenceArg), "utf8"),
        source: null,
      });
    } else {
      const expectedArg = (options.expected as string | undefined) ?? cfg.expectedDir;
      if (!expectedArg) {
        process.stderr.write("biomd diff needs reference documents: pass two files, --expected <dir>, or set `expectedDir`.\n");
        process.exitCode = 1;
        return;
      }
      const expectedDir = resolve(expectedArg);
      const actualDir = resolve(producedArg ?? cfg.outDir);
      const inputDir = resolve((options.inputDir as string | undefined) ?? cfg.inputDir ?? expectedDir);
      for (const entry of (await readdir(expectedDir)).sort()) {
        if (!entry.endsWith(".bio.md")) continue;
        const doc = entry.replace(/\.bio\.md$/u, "");
        let produced = "";
        try {
          produced = await readFile(join(actualDir, entry), "utf8");
        } catch {
          process.stdout.write(`note: no output produced for ${doc}\n`);
        }
        let source: string | null = null;
        for (const ext of [".htm", ".html"]) {
          try {
            source = decodeHtml(await readFile(join(inputDir, `${doc}${ext}`))).text;
            break;
          } catch {
            /* the source is optional; without it every finding stays `ambiguous` */
          }
        }
        pairs.push({ doc, produced, reference: await readFile(join(expectedDir, entry), "utf8"), source });
      }
    }

    const all: LedgerFinding[] = [];
    for (const pair of pairs) {
      const index = pair.source === null ? null : new SourceIndex(pair.source);
      for (const f of diffDocuments(pair.doc, pair.produced, pair.reference).findings) {
        all.push({ ...f, verdict: triage(f.reference, f.produced, index, f.class, f.evidence) });
      }
    }

    const classPrefix = options.class as string | undefined;
    const docFilter = options.doc as string | undefined;
    const verdictFilter = options.verdict as string | undefined;
    const filtered = all.filter(
      (f) =>
        (!classPrefix || f.class.startsWith(classPrefix)) &&
        (!docFilter || f.doc === docFilter) &&
        (!verdictFilter || f.verdict === verdictFilter),
    );

    const ledger = buildLedger(filtered, pairs.map((p) => p.doc));
    process.stdout.write(renderLedger(ledger, Number(options.limit ?? 30)));

    if (options.verbose === true || (producedArg && referenceArg)) {
      process.stdout.write("\n");
      for (const f of ledger.findings) {
        const where = `${f.doc}:${f.referenceLine ?? "-"}→${f.producedLine ?? "-"}`;
        process.stdout.write(`${f.severity[0]!.toUpperCase()} ${f.class}  ${where}  ${f.path}  [${f.verdict}]\n`);
        if (f.reference !== null) process.stdout.write(`    want: ${f.reference}\n`);
        if (f.produced !== null) process.stdout.write(`    got : ${f.produced}\n`);
      }
    }

    if (options.json) {
      await writeAtomic(resolve(options.json as string), `${JSON.stringify(ledger, null, 2)}\n`);
    }
  });

// ---------------------------------------------------------------------------

program
  .command("validate")
  .description("Validate an existing .bio.md against a target profile")
  .argument("<input>", ".bio.md file")
  .option("-p, --profile <id>", "target profile")
  .option("-c, --config <file>", "explicit config file")
  .action(async (input: string, options) => {
    const cfg = settings(options);
    const text = await readFile(resolve(input), "utf8");
    const profile = resolveProfile(cfg.profile);
    const skeleton = readBiomd(text);
    const diagnostics = lintText(text, { profile });

    for (const warning of skeleton.warnings) {
      process.stdout.write(`warning  line ${warning.line}  ${warning.code}: ${warning.message}\n`);
    }
    for (const d of diagnostics) {
      process.stdout.write(`${d.severity.padEnd(8)} ${d.path.padEnd(12)} ${d.code}: ${d.message}\n`);
    }
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    process.stdout.write(
      `\n${errors} error(s), ${diagnostics.length - errors} warning(s), ${skeleton.warnings.length} parse note(s)\n`,
    );
    process.exitCode = errors > 0 ? 1 : 0;
  });

// ---------------------------------------------------------------------------

program
  .command("llm-plan")
  .description("List every escalation the compiler can make, what it is asked, and whether it is on")
  .option("--llm <mode>", "off | assist | review — the mode to report for")
  .option("--hooks <ids>", "comma-separated escalation ids, or `all`")
  .option("-c, --config <file>", "explicit config file")
  .action((options) => {
    const cfg = settings(options);
    const mode = (options.llm as string | undefined) ?? (cfg.llm.enabled ? "assist" : "off");
    const selected = new Set(hookSelection(cfg, mode, options.hooks) ?? DEFAULT_HOOKS);

    process.stdout.write(
      `Escalation catalogue — ${HOOK_CATALOGUE.length} hook(s). Mode: ${mode}.\n` +
        "Every one is OFF unless you name it. Each is consulted only where the deterministic\n" +
        "path produced no answer at all, and every reply passes the stated acceptance check\n" +
        "before it can reach the document.\n\n",
    );

    let stage = "";
    for (const entry of HOOK_CATALOGUE) {
      if (entry.stage !== stage) {
        stage = entry.stage;
        process.stdout.write(`${stage}\n`);
      }
      const on = mode !== "off" && selected.has(entry.hook.id) && entry.wired;
      process.stdout.write(`  ${!entry.wired ? "---" : on ? "ON " : "off"}  ${entry.hook.id.padEnd(18)} ${entry.templates}\n`);
      process.stdout.write(`       asked when:  ${entry.abstention}\n`);
      process.stdout.write(`       checked by:  ${entry.acceptanceCheck}\n`);
      if (!entry.wired) {
        process.stdout.write("       NOT WIRED:   the pipeline has no consult site for this; naming it does nothing.\n");
      }
    }

    process.stdout.write(
      `\n${selected.size === 0 ? "Nothing is enabled; this run would make no requests." : `Enabled: ${[...selected].sort().join(", ")}`}\n` +
        "Turn one on with `--hooks <id>`, several with `--hooks a,b`, all with `--hooks all`,\n" +
        "and back off with `--hooks none`. `llm.hooks` in the config file is the persistent form.\n\n" +
        "Deleted in this revision, and why — so nobody re-adds them:\n" +
        "  layout.chrome-audit  reviewed deletions the boilerplate pass was sure of; put the site\n" +
        "                       masthead back onto pages the profile had correctly stripped.\n" +
        "  text.hyphenation     applied every JOIN it was given; wrote `когда-то` as `когдато`.\n" +
        "  image.caption        bound the wrong nearby line to a picture; a wrong caption is\n" +
        "                       invisible in the output and reads as a fact.\n" +
        "  image.role DECORATION  deleted images outright; ICON, which only substitutes one\n" +
        "                       licensed mark for another, is what remains of that hook.\n" +
        "  + 12 more that had no consult site at all.\n\n" +
        "Prompts are editable Markdown under src/llm/prompts; editing one invalidates exactly the\n" +
        "cached decisions it produced.\n",
    );
  });

// ---------------------------------------------------------------------------

program
  .command("probe")
  .description("Verify an LLM gateway satisfies what the pipeline relies on")
  .option("--base-url <url>", "override the configured gateway base URL")
  .option("--api-key <key>", "override the configured key")
  .option("--model <id>", "override the model to probe")
  .option("-g, --gateway <name>", "which configured gateway to probe")
  .option("-c, --config <file>", "explicit config file")
  .action(async (options) => {
    const cfg = settings(options);
    let baseUrl = options.baseUrl as string | undefined;
    let apiKey = options.apiKey as string | undefined;
    let model = options.model as string | undefined;
    let headers: Record<string, string> = {};
    let structuredOutput: "tools" | "json_schema" | "json_object" = "tools";
    let extraBody: Record<string, unknown> = {};
    let enforceModelIdentity = true;

    if (!baseUrl) {
      try {
        const gateway = resolveGateway(cfg, options.gateway);
        baseUrl = gateway.baseUrl;
        apiKey = apiKey ?? gateway.apiKey;
        model = model ?? gateway.models.balanced;
        headers = gateway.headers;
        structuredOutput = gateway.structuredOutput;
        extraBody = gateway.extraBody;
        enforceModelIdentity = gateway.enforceModelIdentity;
        process.stdout.write(`Gateway "${gateway.name}"  ${baseUrl}\n  key ${redactKey(apiKey)}\n\n`);
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
        return;
      }
    }

    const transport = new GatewayTransport({
      baseUrl: baseUrl as string,
      ...(apiKey ? { apiKey } : {}),
      headers,
      structuredOutput,
      extraBody,
      enforceModelIdentity,
    });
    const report = await runTransportProbe(transport, model ?? "claude-sonnet-5");

    for (const r of report.results) {
      const mark = r.passed === true ? "PASS" : r.passed === false ? "FAIL" : "SKIP";
      const tag = r.costOnly && r.passed !== true ? " (cost only)" : "";
      process.stdout.write(`${mark}  ${r.title}${tag}\n      ${r.detail}\n`);
    }
    process.stdout.write(`\n${report.summary}\n`);
    process.exitCode = report.usable ? 0 : 1;
  });

// ---------------------------------------------------------------------------

/**
 * The three surfaces L3 adjudicates, for one document.
 *
 * `source` is optional throughout: without it the alignment evidence table
 * carries no backing verdict, which is a stated limitation rather than a
 * failure. `produced` missing is a failure, and is reported as one.
 */
interface L3Surfaces {
  doc: string;
  produced: string | null;
  reference: string;
  sourceHtml: string | null;
  sourcePath: string | null;
}

async function collectL3Surfaces(cfg: Config, options: Record<string, unknown>): Promise<L3Surfaces[]> {
  const expectedDir = resolve((options["expected"] as string | undefined) ?? cfg.expectedDir ?? "");
  const actualDir = resolve((options["produced"] as string | undefined) ?? cfg.outDir);
  const inputDir = resolve((options["inputDir"] as string | undefined) ?? cfg.inputDir ?? expectedDir);
  const only = options["doc"] as string | undefined;

  const out: L3Surfaces[] = [];
  for (const entry of (await readdir(expectedDir)).sort()) {
    if (!entry.endsWith(".bio.md")) continue;
    const doc = entry.replace(/\.bio\.md$/u, "");
    if (only && doc !== only) continue;
    let produced: string | null = null;
    try {
      produced = await readFile(join(actualDir, entry), "utf8");
    } catch {
      /* reported by the caller — a missing output is a real state, not an error */
    }
    let sourceHtml: string | null = null;
    let sourcePath: string | null = null;
    for (const ext of [".htm", ".html"]) {
      try {
        const path = join(inputDir, `${doc}${ext}`);
        sourceHtml = decodeHtml(await readFile(path)).text;
        sourcePath = path;
        break;
      } catch {
        /* optional */
      }
    }
    out.push({ doc, produced, reference: await readFile(join(expectedDir, entry), "utf8"), sourceHtml, sourcePath });
  }
  return out;
}

program
  .command("render")
  .description("L3: render .bio.md documents to diagnostic HTML for side-by-side inspection")
  .option("-e, --expected <dir>", "directory of reference .bio.md files (default: config `expectedDir`)")
  .option("-p, --produced <dir>", "directory of produced .bio.md files (default: config `outDir`)")
  .option("-i, --input-dir <dir>", "directory of source .htm files")
  .option("-o, --out <dir>", "where to write the rendered pages", "../analyze/rendered")
  .option("--doc <name>", "only this document")
  .option("--annotate", "outline every block and label its kind and line")
  .option("-c, --config <file>", "explicit config file")
  .action(async (options) => {
    const cfg = settings(options);
    const outDir = resolve(options.out as string);
    const surfaces = await collectL3Surfaces(cfg, options);
    const annotate = options.annotate === true;

    let written = 0;
    const rows: string[] = [];
    for (const s of surfaces) {
      const reference = renderBiomd(s.reference, { title: `${s.doc} — reference`, annotate });
      await writeAtomic(join(outDir, `${s.doc}.reference.html`), reference.html);
      written += 1;
      let producedNote = "—";
      if (s.produced !== null) {
        const produced = renderBiomd(s.produced, { title: `${s.doc} — produced`, annotate });
        await writeAtomic(join(outDir, `${s.doc}.produced.html`), produced.html);
        written += 1;
        producedNote = `<a href="${s.doc}.produced.html">produced</a>`;
      }
      const sourceLink = s.sourcePath ? `<a href="http://localhost:8123/${basename(s.sourcePath)}">source</a>` : "—";
      rows.push(
        `<tr><td>${s.doc}</td><td>${sourceLink}</td><td>${producedNote}</td>` +
          `<td><a href="${s.doc}.reference.html">reference</a></td></tr>`,
      );
      for (const w of reference.warnings) {
        process.stdout.write(`note ${s.doc} reference line ${w.line}: ${w.code} — ${w.message}\n`);
      }
    }

    // A launcher, so the three surfaces of a document are one click apart. The
    // source column points at the `fixtures` server declared in launch.json;
    // the other two are served from this directory by the `rendered` server.
    await writeAtomic(
      join(outDir, "index.html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>L3 surfaces</title>` +
        `<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem}table{border-collapse:collapse}` +
        `td,th{border:1px solid #ccc;padding:.3em .6em;text-align:left}</style></head><body>` +
        `<h1>L3 surfaces</h1><p>source = localhost:8123 · produced/reference = this server.</p>` +
        `<table><thead><tr><th>document</th><th>source .htm</th><th>produced</th><th>reference</th></tr></thead>` +
        `<tbody>${rows.join("")}</tbody></table></body></html>\n`,
    );

    process.stdout.write(`\n${written} page(s) written to ${outDir}\nOpen http://localhost:8124/index.html\n`);
  });

// ---------------------------------------------------------------------------

program
  .command("l3")
  .description("L3: rendered and geometric adjudication of produced against reference, with source backing")
  .option("-e, --expected <dir>", "directory of reference .bio.md files (default: config `expectedDir`)")
  .option("-p, --produced <dir>", "directory of produced .bio.md files (default: config `outDir`)")
  .option("-i, --input-dir <dir>", "directory of source .htm files")
  .option("--doc <name>", "only this document")
  .option("--width <px>", "viewport width", "1024")
  .option("--json <file>", "write findings and the alignment evidence table here")
  .option("--class <name>", "only findings whose class starts with this prefix")
  .option("-v, --verbose", "list every finding, not just the class roll-up")
  .option("-c, --config <file>", "explicit config file")
  .action(async (options) => {
    const cfg = settings(options);
    const surfaces = await collectL3Surfaces(cfg, options);
    const width = Number(options.width ?? 1024);

    const probe = await L3Probe.create();
    if (probe === null) {
      process.stderr.write(
        "L3 needs Chromium and it is not available. Install it with `npx playwright install chromium`.\n" +
          "Refusing to report geometry that was not measured.\n",
      );
      process.exitCode = 1;
      return;
    }

    const assetRoot = cfg.assetRoot ? resolve(cfg.assetRoot) : undefined;
    const results: L3Result[] = [];
    const skipped: string[] = [];

    try {
      for (const s of surfaces) {
        if (s.produced === null) {
          skipped.push(s.doc);
          continue;
        }
        const producedPage = await probe.probeRendered(renderBiomd(s.produced).html, { width });
        const referencePage = await probe.probeRendered(renderBiomd(s.reference).html, { width });
        const sourcePage =
          s.sourceHtml === null
            ? null
            : await probe.probeSource(s.sourceHtml, { width, ...(assetRoot ? { assetRoot } : {}) });
        results.push(compareRendered({ doc: s.doc, produced: producedPage, reference: referencePage, source: sourcePage }));
      }
    } finally {
      await probe.close();
    }

    const classPrefix = options.class as string | undefined;
    const findings = results.flatMap((r) => r.findings).filter((f) => !classPrefix || f.class.startsWith(classPrefix));
    const alignment = results.flatMap((r) => r.alignment);

    // Classes and instances, never an average — the reporting convention §8.
    const byClass = new Map<string, { n: number; docs: Set<string>; severity: string }>();
    for (const f of findings) {
      const e = byClass.get(f.class) ?? { n: 0, docs: new Set<string>(), severity: f.severity };
      e.n += 1;
      e.docs.add(f.doc);
      byClass.set(f.class, e);
    }
    process.stdout.write(`\nL3 — ${findings.length} finding(s) over ${results.length} document(s) at ${width}px\n`);
    if (skipped.length > 0) process.stdout.write(`skipped (no produced output): ${skipped.join(", ")}\n`);
    process.stdout.write(`\n${"class".padEnd(32)}${"inst".padStart(6)}${"docs".padStart(6)}  severity\n`);
    for (const [cls, e] of [...byClass].sort((a, b) => b[1].n - a[1].n)) {
      process.stdout.write(`${cls.padEnd(32)}${String(e.n).padStart(6)}${String(e.docs.size).padStart(6)}  ${e.severity}\n`);
    }

    // The alignment evidence table: the artifact the alignment family is
    // decided from. Printed as counts here; the rows go to --json.
    if (alignment.length > 0) {
      const webkit = alignment.filter((a) => (a.sourceTextAlignRaw ?? "").startsWith("-webkit-")).length;
      const wantRight = alignment.filter((a) => a.referenceAlignment === "right").length;
      const wantCenter = alignment.filter((a) => a.referenceAlignment === "center").length;
      const unbacked = alignment.filter((a) => a.sourcePath !== null && !a.sourceDistinctive).length;
      const noNode = alignment.filter((a) => a.sourcePath === null).length;
      process.stdout.write(
        `\nalignment evidence — ${alignment.length} distinctively-aligned block(s)\n` +
          `  reference wants center            ${wantCenter}\n` +
          `  reference wants right             ${wantRight}\n` +
          `  source computes a -webkit- form   ${webkit}   (H1)\n` +
          `  source not distinctive            ${unbacked}   (H3)\n` +
          `  no matching source node           ${noNode}\n`,
      );
    }

    if (options.verbose === true) {
      process.stdout.write("\n");
      for (const f of findings) {
        process.stdout.write(
          `${f.severity[0]!.toUpperCase()} ${f.class}  ${f.doc}:${f.referenceLine ?? "-"}→${f.producedLine ?? "-"}  ${f.path}\n` +
            `    ${JSON.stringify(f.geometry)}\n` +
            `    want: ${f.reference ?? "—"}\n    got : ${f.produced ?? "—"}\n`,
        );
      }
    }

    if (options.json) {
      await writeAtomic(
        resolve(options.json as string),
        `${JSON.stringify(
          {
            generated: { viewport: width, documents: results.map((r) => r.doc) },
            totals: { findings: findings.length, alignmentRows: alignment.length },
            classes: [...byClass].map(([cls, e]) => ({ class: cls, instances: e.n, documents: e.docs.size })),
            findings,
            alignment,
            notes: results.flatMap((r) => r.notes.map((n) => `${r.doc}: ${n}`)),
          },
          null,
          2,
        )}\n`,
      );
    }
  });

// ---------------------------------------------------------------------------

program
  .command("inspect")
  .description("Show what the front half of the pipeline sees, without converting")
  .argument("<input>", "source .htm/.html file")
  .action(async (input: string) => {
    const bytes = await readFile(resolve(input));
    const decoded = decodeHtml(bytes);
    const quarantined = quarantineServerMarkup(decoded.text);
    const doc = parseHtml(quarantined.text);

    process.stdout.write(
      [
        `Encoding:     ${decoded.decision.codec} (via ${decoded.decision.source})` +
          `${decoded.decision.uncertain ? "  UNCERTAIN" : ""}`,
        `  declared:   ${decoded.decision.declared ?? "—"}`,
        `  detected:   ${decoded.decision.detected ?? "—"}`,
        `Server islands: ${quarantined.islands.length}`,
        `Parse errors:   ${doc.errors.length}`,
        `Elements:       ${doc.index.size}`,
        "",
      ].join("\n"),
    );
    for (const island of quarantined.islands.slice(0, 10)) {
      process.stdout.write(`  ${island.kind} at line ${island.line}: ${island.raw.slice(0, 60)}\n`);
    }
    const codes = new Map<string, number>();
    for (const e of doc.errors) codes.set(e.code, (codes.get(e.code) ?? 0) + 1);
    for (const [code, n] of [...codes].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      process.stdout.write(`  ${String(n).padStart(4)} × ${code}\n`);
    }
  });

// ---------------------------------------------------------------------------

async function collectHtml(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.html?$/iu.test(entry.name)) out.push(path);
    }
  };
  const info = await stat(dir);
  if (info.isFile()) return [dir];
  await walk(dir);
  return out.sort();
}

/**
 * Load a corpus profile.
 *
 * A missing profile is not fatal — conversion works without one — but it must
 * never be silent: chrome detection and de-hyphenation are both materially
 * weaker without it, and "why is the site menu still in my output?" is exactly
 * the question a silent skip creates.
 */
async function loadCorpus(path: string | undefined, warn = false): Promise<CorpusProfile | null> {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(resolve(path), "utf8")) as CorpusProfile;
  } catch {
    if (warn) {
      process.stderr.write(
        `note: no corpus profile at ${resolve(path)} — chrome detection and de-hyphenation will be ` +
          "weaker. Create one with: biomd corpus scan <dir>\n",
      );
    }
    return null;
  }
}

/**
 * One line per source table: its class and what came out.
 *
 * Naming the outcome next to the class is the point — `DATA→flow` is the shape
 * of a silent structural loss and used to be invisible in every report.
 */
function describeTables(result: Awaited<ReturnType<typeof convert>>): string {
  if (result.tables.length === 0) return "none";
  return result.tables
    .map((t) => {
      if (t.emittedTable) {
        return `${t.classification}→table[${t.shape?.rows ?? "?"}×${t.shape?.cols ?? "?"}]${t.headerMissing ? "*" : ""}`;
      }
      if (t.classification === "SHELL") return "SHELL→removed";
      return `${t.classification}→flow${t.failure ? `(${t.failure})` : ""}`;
    })
    .join(", ");
}

function printResult(
  input: string,
  outPath: string,
  result: Awaited<ReturnType<typeof convert>>,
  jobRoot: string,
): void {
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const reviews = result.ledger.filter((e) => e.terminal.kind === "REVIEW");

  const lines = [
    `${input} → ${outPath}`,
    "",
    `State:        ${result.state}`,
    `Encoding:     ${result.encoding.codec} (${result.encoding.source})${result.encoding.uncertain ? "  UNCERTAIN" : ""}`,
    `Measured:     ${result.measured ? "yes" : "no — attribute heuristics only"}`,
    `Text recall:  ${(result.conservation.text.recall * 100).toFixed(2)}%`,
    `Targets:      ${result.conservation.targets.ok ? "conserved" : `${result.conservation.targets.missing.length} missing`}`,
    `Images:       ${result.conservation.images.ok ? "conserved" : `${result.conservation.images.missing.length} missing`}`,
    `Complexity:   ${result.complexity.directivesTotal} directives, depth ${result.complexity.maxNestingDepth}, ` +
      `${result.complexity.directiveDensity}/1000 words` +
      `${result.complexity.densityEnforced ? "" : " (density not enforced: document too short)"}`,
    `Chrome:       ${describeChrome(result)}`,
    `Tables:       ${describeTables(result)}`,
    `Job:          ${jobRoot}`,
  ];

  if (errors.length > 0) {
    lines.push("", `${errors.length} error(s):`);
    for (const e of errors.slice(0, 10)) lines.push(`  ${e.code} at ${e.path}: ${e.message}`);
  }
  if (!result.conservation.ok) {
    lines.push("", "Conservation failures:");
    for (const f of result.conservation.failures) lines.push(`  ${f}`);
  }
  if (reviews.length > 0) {
    lines.push("", `${reviews.length} item(s) need review:`);
    for (const r of reviews.slice(0, 10)) {
      lines.push(`  ${r.id}: ${r.terminal.kind === "REVIEW" ? r.terminal.reason : ""}`);
    }
  }
  // The pipeline's own warnings were being collected and never shown. Every one
  // of them is something the operator can act on — a corpus profile too thin to
  // identify chrome, a recurring structure kept because it carries the page's
  // text, a page with no recoverable heading — and the boilerplate pass in
  // particular can only be understood from them. Silence here is what let a
  // profile scanned over one page delete a third of a document unremarked.
  if (result.warnings.length > 0) {
    lines.push("", `${result.warnings.length} warning(s):`);
    for (const w of result.warnings.slice(0, 20)) lines.push(`  ${w}`);
    if (result.warnings.length > 20) lines.push(`  … and ${result.warnings.length - 20} more`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** What boilerplate removal took — the pass the conservation gate cannot audit. */
function describeChrome(result: { chrome: { documentText: number; removedText: number; structures: number } }): string {
  const { documentText, removedText, structures } = result.chrome;
  if (structures === 0) return "none removed";
  const share = documentText > 0 ? (removedText / documentText) * 100 : 0;
  return `${removedText} of ${documentText} visible chars (${share.toFixed(1)}%) in ${structures} structure(s)`;
}

registerConfigCommands(program);

/**
 * A stack trace is for a bug in this program, not for a missing directory.
 *
 * Filesystem and configuration errors are things the person running the command
 * can fix, and burying the one line that says which path was wrong under ten
 * frames of `node:internal/fs/promises` helps nobody.
 */
program.parseAsync(process.argv).catch((error: unknown) => {
  const err = error as NodeJS.ErrnoException;
  const expected = new Set(["ENOENT", "EACCES", "EISDIR", "ENOTDIR", "EPERM"]);
  if (err?.code && expected.has(err.code)) {
    process.stderr.write(`${err.message}\n`);
    if (err.code === "ENOENT") process.stderr.write("The path above does not exist.\n");
  } else if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(`${err?.stack ?? String(error)}\n`);
  }
  process.exit(1);
});
