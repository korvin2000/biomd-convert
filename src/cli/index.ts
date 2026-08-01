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
import { createHyphenopolyOracle } from "../convert-core/dehyphenate.js";
import { createMeasurer, type VisualMode } from "../ladom/measure.js";
import { parseHtml } from "../ladom/parse.js";
import { quarantineServerMarkup } from "../ladom/quarantine.js";
import { decodeHtml } from "../ladom/encoding.js";
import { PROFILES, resolveProfile, read as readBiomd, lintText } from "../biomd-ast/index.js";
import { renderReport, scoreDocumentSources } from "../eval/index.js";
import { ENGINE_VERSION, JobStore, hashOf, writeAtomic } from "./store.js";
import {
  Budget,
  FileCache,
  GatewayResolver,
  GatewayTransport,
  MemoryCache,
  runTransportProbe,
} from "../llm/index.js";
import type { DecisionResolver, ResolverStats } from "../convert-core/index.js";
import { loadConfig, resolveGateway, redactKey, type Config } from "./config.js";
import { registerConfigCommands } from "./config-cmd.js";

/**
 * Build the escalation boundary from configuration.
 *
 * Returns null whenever a model must not be used — `llm.enabled` off, `--llm
 * off`, no gateway, no key. Every one of those is a normal, supported state: the
 * pipeline is deterministic-first and a null resolver simply means the residual
 * ambiguity becomes review items instead of requests.
 */
function makeResolver(
  cfg: Config,
  options: { llm?: string; gateway?: string; replay?: boolean },
  onEvent?: (event: { type: string; hook: string }) => void,
): { resolver: DecisionResolver | null; budget: Budget | null; note: string } {
  const mode = (options.llm as string | undefined) ?? (cfg.llm.enabled ? "assist" : "off");
  if (mode === "off") return { resolver: null, budget: null, note: "llm off — fully deterministic" };

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

  const resolver = new GatewayResolver({
    transport,
    cache,
    budget,
    models: gateway.models,
    lang: cfg.lang,
    ...(options.replay ? { replay: true } : {}),
    ...(onEvent ? { onEvent } : {}),
  });
  return {
    resolver,
    budget,
    note: `llm ${mode} via "${gateway.name}" (${gateway.models.fast} → ${gateway.models.deep}), key ${redactKey(gateway.apiKey)}`,
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
  return parts.join("  ");
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
  .option("--llm <mode>", "off | assist — escalate the residual ambiguity to a model")
  .option("-g, --gateway <name>", "which configured gateway to use")
  .option("--replay", "use only cached model decisions; never call the network")
  .option("-c, --config <file>", "explicit config file")
  .option("--quiet", "only print the output path")
  .action(async (input: string, options) => {
    const cfg = settings(options);
    const bytes = await readFile(resolve(input));
    const profile = resolveProfile(cfg.profile);
    const corpus = await loadCorpus(cfg.corpus, true);

    const measurer = await createMeasurer(cfg.visual as VisualMode);
    const oracle = await createHyphenopolyOracle([cfg.lang, "en-us"]);
    const { resolver, budget, note } = makeResolver(cfg, options);
    if (!options.quiet) process.stderr.write(`${note}\n`);

    try {
      const store = await JobStore.open(resolve(cfg.workDir), basename(input), bytes, profile.id);
      const result = await convert(bytes, {
        sourceName: basename(input),
        profile,
        links: ABC_LINK_PROFILE,
        layoutFidelity: cfg.layoutFidelity,
        measurer,
        oracle,
        lang: cfg.lang,
        ...(resolver ? { resolver } : {}),
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
  .option("--llm <mode>", "off | assist — escalate the residual ambiguity to a model")
  .option("-g, --gateway <name>", "which configured gateway to use")
  .option("--replay", "use only cached model decisions; never call the network")
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
    const files = await collectHtml(resolve(dir));
    const profile = resolveProfile(cfg.profile);
    const corpusProfile = await loadCorpus(cfg.corpus, true);
    const lexicon = corpusProfile ? Lexicon.fromJSON(corpusProfile.lexicon) : new Lexicon();

    const measurer = await createMeasurer(cfg.visual as VisualMode);
    const oracle = await createHyphenopolyOracle([cfg.lang, "en-us"]);
    // Browser contexts are the scarce resource; conversions are cheap.
    const queue = new PQueue({ concurrency: measurer.available ? Math.min(cfg.jobs, 4) : cfg.jobs });

    // One resolver for the whole run: the budget is a corpus-wide cap, and the
    // decision cache is shared, so the same ambiguous table on forty pages costs
    // one request rather than forty.
    const { resolver, budget, note } = makeResolver(cfg, options);
    process.stderr.write(`${note}\n`);

    const tally = { complete: 0, review: 0, failed: 0 };
    const escalationTotals = { consulted: 0, resolved: 0 };
    const rows: string[] = [];

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
                lexicon,
                lang: cfg.lang,
                ...(resolver ? { resolver } : {}),
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
    process.exitCode = tally.failed > 0 ? 1 : 0;
  });

// ---------------------------------------------------------------------------

program
  .command("eval")
  .description("Score converted output against hand-written reference .bio.md files")
  .argument("[actualDir]", "directory of produced .bio.md files (defaults to config outDir)")
  .option("-e, --expected <dir>", "directory of reference .bio.md files", "fixtures/out")
  .option("-v, --verbose", "list what each document is missing")
  .option("--json <file>", "also write the full score as JSON")
  .option("-c, --config <file>", "explicit config file")
  .action(async (actualArg: string | undefined, options) => {
    const cfg = settings(options);
    const actualDir = resolve(actualArg ?? cfg.outDir);
    const expectedDir = resolve(options.expected as string);

    const files: Array<{ name: string; expected: string; actual: string }> = [];
    const absent: string[] = [];
    for (const entry of (await readdir(expectedDir)).sort()) {
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
      process.stderr.write(`No reference documents in ${expectedDir}\n`);
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
  process.stdout.write(`${lines.join("\n")}\n`);
}

registerConfigCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
