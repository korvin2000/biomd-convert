/**
 * Persistent configuration.
 *
 * Precedence, highest first:
 *
 *   1. command-line flags
 *   2. environment variables (and a `.env` file next to the project config)
 *   3. project config   — ./biomd.config.json, searched upward from cwd
 *   4. user config      — ~/.config/biomd/config.json (or %APPDATA%\biomd)
 *   5. built-in defaults
 *
 * Secrets are deliberately awkward to commit: an API key belongs in the *user*
 * config or an environment variable, and `apiKeyEnv` exists so a project config
 * can name the variable without containing its value.
 */
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * How a gateway is asked to return typed data.
 *
 * `tools`       — function calling. Universally supported; the safest default.
 * `json_schema` — `response_format: {type:"json_schema", strict:true}`. What
 *                 OpenRouter documents; enforcement varies by upstream provider.
 * `json_object` — plain JSON mode, no schema. Last resort; local validation
 *                 still rejects anything malformed.
 */
export const StructuredOutputMode = z.enum(["tools", "json_schema", "json_object"]);
export type StructuredOutputMode = z.infer<typeof StructuredOutputMode>;

export const GatewayConfigSchema = z.object({
  /**
   * Base URL **without** `/chat/completions` — the client appends it.
   * For OpenRouter this is `https://openrouter.ai/api/v1`.
   *
   * Optional in the schema, required by {@link resolveGateway}. A gateway entry
   * is assembled from several layers — `biomd config set-key` writes the key
   * into the *user* config while the URL lives in the *project* config — so any
   * single layer may legitimately be partial. Demanding completeness here made
   * a key-only user config abort every run in the corpus, including the ones
   * that never touch a model.
   */
  baseUrl: z.string().min(1).optional(),
  /** Literal key. Prefer `apiKeyEnv` in a project config. */
  apiKey: z.string().optional(),
  /** Name of an environment variable holding the key. */
  apiKeyEnv: z.string().optional(),
  /** Extra request headers, e.g. OpenRouter's optional attribution headers. */
  headers: z.record(z.string(), z.string()).default({}),
  /** Model per escalation tier. `fast` handles volume; `deep` handles hard cases. */
  models: z
    .object({
      fast: z.string().optional(),
      balanced: z.string().optional(),
      deep: z.string().optional(),
    })
    .default({}),
  structuredOutput: StructuredOutputMode.default("tools"),
  /** Merged into the request body — e.g. OpenRouter's `provider` routing block. */
  extraBody: z.record(z.string(), z.unknown()).default({}),
  /**
   * Fail when the model the gateway used differs from the one requested.
   * Turn off only for gateways whose model IDs are documented aliases.
   */
  enforceModelIdentity: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export const BudgetConfigSchema = z
  .object({
    maxCalls: z.number().int().nonnegative().optional(),
    maxInputTokens: z.number().int().nonnegative().optional(),
    maxOutputTokens: z.number().int().nonnegative().optional(),
    maxEstimatedCostUsd: z.number().nonnegative().optional(),
  })
  .default({});

export const PricesSchema = z
  .object({
    input: z.record(z.string(), z.number()).default({}),
    output: z.record(z.string(), z.number()).default({}),
    cachedInputMultiplier: z.number().default(0.1),
  })
  .default({ input: {}, output: {}, cachedInputMultiplier: 0.1 });

export const ConfigSchema = z.object({
  $schema: z.string().optional(),

  /** Target profile: what the consuming renderer can actually render. */
  profile: z.string().default("renderer-current"),
  /** `simplified` collapses presentational lanes; `faithful` preserves them. */
  layoutFidelity: z.enum(["simplified", "faithful"]).default("simplified"),
  /** Browser measurement. `never` is much weaker but needs no Chromium. */
  visual: z.enum(["never", "auto", "always"]).default("always"),
  lang: z.string().default("ru"),

  /** Where the source HTML lives. Also used to resolve relative assets. */
  inputDir: z.string().optional(),
  assetRoot: z.string().optional(),
  outDir: z.string().default("out"),
  workDir: z.string().default(".biomd-work"),
  corpus: z.string().default("corpus/corpus-profile.json"),
  jobs: z.number().int().positive().default(4),

  llm: z
    .object({
      /** Master switch. Off means a fully deterministic run. */
      enabled: z.boolean().default(false),
      /** Which entry of `gateways` to use. */
      gateway: z.string().optional(),
      gateways: z.record(z.string(), GatewayConfigSchema).default({}),
      budget: BudgetConfigSchema,
      prices: PricesSchema,
      /** Where cached decisions live, so re-runs are free. */
      cacheDir: z.string().default(".biomd-cache"),
    })
    .default({ enabled: false, gateways: {}, budget: {}, prices: { input: {}, output: {}, cachedInputMultiplier: 0.1 }, cacheDir: ".biomd-cache" }),
});
export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const PROJECT_FILENAMES = ["biomd.config.json", "biomd.config.jsonc", ".biomdrc.json"];

export function userConfigDir(): string {
  if (platform() === "win32") {
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "biomd");
  }
  return join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "biomd");
}

export function userConfigPath(): string {
  return join(userConfigDir(), "config.json");
}

/** Nearest project config, searching upward from `from`. */
export function findProjectConfig(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of PROJECT_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Strip `//` and block comments so a config file can explain itself.
 *
 * A configuration nobody can annotate is a configuration nobody understands, so
 * comments are worth the twenty lines it costs to allow them.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 1;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Minimal `.env` reader: `KEY=value`, `#` comments, optional quotes. */
export function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading and merging
// ---------------------------------------------------------------------------

export type Source = "default" | "user-config" | "project-config" | "env" | "flag";

export interface LoadedConfig {
  config: Config;
  /** Where each top-level setting came from, for `biomd config show`. */
  sources: Record<string, Source>;
  paths: { user: string | null; project: string | null; dotenv: string | null };
  warnings: string[];
}

function readConfigFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Deep merge where a later object wins, recording which keys it set. */
function merge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  source: Source,
  sources: Record<string, Source>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const existing = out[key];
    if (isPlainObject(value)) {
      // Recurse even when nothing exists yet, so every leaf gets its own
      // provenance entry. Assigning the object wholesale would make
      // `config show` report the whole subtree as "default", which is exactly
      // the question the command exists to answer.
      out[key] = merge(isPlainObject(existing) ? existing : {}, value, source, sources, path);
    } else {
      out[key] = value;
      sources[path] = source;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface LoadOptions {
  /** Explicit config file; skips discovery. */
  configPath?: string;
  /** CLI flags, already normalized to config shape. */
  flags?: Record<string, unknown>;
  cwd?: string;
  /**
   * Override the user-level config location, or `null` to ignore it entirely.
   *
   * Exists so a test — or a reproducible batch run — is not silently altered by
   * whatever happens to sit in `%APPDATA%\biomd`.
   */
  userConfigPath?: string | null;
}

export function loadConfig(options: LoadOptions = {}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];
  const sources: Record<string, Source> = {};

  const userPath = options.userConfigPath === undefined ? userConfigPath() : options.userConfigPath;
  const projectPath = options.configPath ? resolve(options.configPath) : findProjectConfig(cwd);

  let merged: Record<string, unknown> = {};

  if (userPath && existsSync(userPath)) {
    merged = merge(merged, readConfigFile(userPath) as Record<string, unknown>, "user-config", sources);
  }
  if (projectPath) {
    if (!existsSync(projectPath)) throw new Error(`Config file not found: ${projectPath}`);
    merged = merge(merged, readConfigFile(projectPath) as Record<string, unknown>, "project-config", sources);
  }

  // `.env` beside the project config, then the real environment on top.
  const dotenvPath = projectPath ? join(dirname(projectPath), ".env") : join(cwd, ".env");
  const dotenv = loadDotEnv(dotenvPath);
  for (const [key, value] of Object.entries(dotenv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const fromEnv = envOverrides();
  if (Object.keys(fromEnv).length > 0) merged = merge(merged, fromEnv, "env", sources);
  if (options.flags) merged = merge(merged, pruneUndefined(options.flags), "flag", sources);

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration is invalid:\n${issues}\n\nChecked: ${projectPath ?? "(no project config)"}`);
  }

  const config = parsed.data;

  // Normalize and sanity-check gateway URLs, which is where mistakes actually
  // happen: pasting the full endpoint instead of the base is the common one.
  for (const [name, gateway] of Object.entries(config.llm.gateways)) {
    if (gateway.baseUrl === undefined) continue;
    const normalized = normalizeBaseUrl(gateway.baseUrl);
    if (normalized.changed) {
      warnings.push(
        `Gateway ${JSON.stringify(name)}: baseUrl should be the API base, not the endpoint. ` +
          `Using ${normalized.url} instead of ${gateway.baseUrl}.`,
      );
      gateway.baseUrl = normalized.url;
    }
  }

  if (config.llm.enabled) {
    const name = config.llm.gateway;
    if (!name) {
      warnings.push("llm.enabled is true but llm.gateway is not set; model calls will be skipped.");
    } else if (!config.llm.gateways[name]) {
      warnings.push(
        `llm.gateway is ${JSON.stringify(name)} but no such entry exists in llm.gateways ` +
          `(${Object.keys(config.llm.gateways).join(", ") || "none defined"}).`,
      );
    }
  }

  return {
    config,
    sources,
    paths: {
      user: userPath && existsSync(userPath) ? userPath : null,
      project: projectPath,
      dotenv: existsSync(dotenvPath) ? dotenvPath : null,
    },
    warnings,
  };
}

/**
 * Accept a pasted endpoint URL and reduce it to the base.
 *
 * `https://openrouter.ai/api/v1/chat/completions` → `https://openrouter.ai/api/v1`
 */
export function normalizeBaseUrl(url: string): { url: string; changed: boolean } {
  let out = url.trim().replace(/\/+$/u, "");
  const suffixes = ["/chat/completions", "/completions", "/messages", "/responses"];
  for (const suffix of suffixes) {
    if (out.toLowerCase().endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      return { url: out, changed: true };
    }
  }
  return { url: out, changed: out !== url.trim() };
}

function envOverrides(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const env = process.env;

  const set = (path: string[], value: unknown): void => {
    let node = out;
    for (const key of path.slice(0, -1)) {
      node[key] = (node[key] as Record<string, unknown>) ?? {};
      node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1] as string] = value;
  };

  if (env["BIOMD_PROFILE"]) set(["profile"], env["BIOMD_PROFILE"]);
  if (env["BIOMD_VISUAL"]) set(["visual"], env["BIOMD_VISUAL"]);
  if (env["BIOMD_LANG"]) set(["lang"], env["BIOMD_LANG"]);
  if (env["BIOMD_OUT_DIR"]) set(["outDir"], env["BIOMD_OUT_DIR"]);
  if (env["BIOMD_CORPUS"]) set(["corpus"], env["BIOMD_CORPUS"]);
  if (env["BIOMD_LLM_ENABLED"]) set(["llm", "enabled"], env["BIOMD_LLM_ENABLED"] === "true");
  if (env["BIOMD_GATEWAY"]) set(["llm", "gateway"], env["BIOMD_GATEWAY"]);

  // A URL/key/model supplied purely through the environment defines an
  // implicit gateway named `env`, so the tool is usable with no config file.
  const url = env["BIOMD_GATEWAY_URL"];
  const key = env["BIOMD_GATEWAY_KEY"];
  const model = env["BIOMD_MODEL"];
  if (url || key || model) {
    const gateway: Record<string, unknown> = {};
    if (url) gateway["baseUrl"] = normalizeBaseUrl(url).url;
    // Point at the variable rather than copying its value, so `config show`
    // reports the key's true origin instead of claiming it came from a file.
    if (key) gateway["apiKeyEnv"] = "BIOMD_GATEWAY_KEY";
    if (model) gateway["models"] = { fast: model, balanced: model, deep: model };
    set(["llm", "gateways", "env"], gateway);
    if (!env["BIOMD_GATEWAY"]) set(["llm", "gateway"], "env");
    if (env["BIOMD_LLM_ENABLED"] === undefined) set(["llm", "enabled"], true);
  }

  return out;
}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[key] = isPlainObject(v) ? pruneUndefined(v) : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gateway resolution
// ---------------------------------------------------------------------------

export interface ResolvedGateway {
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  /** Where the key came from, for diagnostics. Never the key itself. */
  apiKeySource: string;
  headers: Record<string, string>;
  models: { fast: string; balanced: string; deep: string };
  structuredOutput: StructuredOutputMode;
  extraBody: Record<string, unknown>;
  enforceModelIdentity: boolean;
  timeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(hint ? `${message}\n\n${hint}` : message);
    this.name = "ConfigError";
  }
}

/** Resolve the active gateway, including where its key comes from. */
export function resolveGateway(config: Config, override?: string): ResolvedGateway {
  const name = override ?? config.llm.gateway;
  if (!name) {
    throw new ConfigError(
      "No LLM gateway selected.",
      [
        "Set one in your config:",
        '  { "llm": { "gateway": "openrouter", "gateways": { "openrouter": { … } } } }',
        "",
        "Or run `biomd config init` to create a starter config, then",
        "`biomd config set-key openrouter` to store the API key.",
      ].join("\n"),
    );
  }

  const gateway = config.llm.gateways[name];
  if (!gateway) {
    throw new ConfigError(
      `Gateway ${JSON.stringify(name)} is not defined.`,
      `Defined gateways: ${Object.keys(config.llm.gateways).join(", ") || "(none)"}`,
    );
  }

  if (!gateway.baseUrl) {
    throw new ConfigError(
      `Gateway ${JSON.stringify(name)} defines no baseUrl.`,
      [
        "Add the API base — not the endpoint; the client appends /chat/completions:",
        `  { "llm": { "gateways": { ${JSON.stringify(name)}: { "baseUrl": "https://openrouter.ai/api/v1" } } } }`,
        "",
        "`biomd config set-key` stores only the key, so the URL has to come from",
        "the project config or from BIOMD_GATEWAY_URL.",
      ].join("\n"),
    );
  }

  let apiKey = gateway.apiKey;
  let apiKeySource = "config (apiKey)";
  if (!apiKey && gateway.apiKeyEnv) {
    apiKey = process.env[gateway.apiKeyEnv];
    apiKeySource = `environment (${gateway.apiKeyEnv})`;
  }
  if (!apiKey) {
    apiKey = process.env["BIOMD_GATEWAY_KEY"];
    if (apiKey) apiKeySource = "environment (BIOMD_GATEWAY_KEY)";
  }
  if (!apiKey) apiKeySource = "not set";

  const models = gateway.models;
  const fallback = models.balanced ?? models.fast ?? models.deep;
  if (!fallback) {
    throw new ConfigError(
      `Gateway ${JSON.stringify(name)} defines no models.`,
      [
        "Add at least one tier:",
        '  "models": { "fast": "deepseek/deepseek-v4-flash", "balanced": "…", "deep": "…" }',
        "",
        "`fast` handles high-volume classification, `deep` handles hard escalations.",
        "Setting only one is fine — every tier falls back to it.",
      ].join("\n"),
    );
  }

  return {
    name,
    baseUrl: gateway.baseUrl,
    apiKey,
    apiKeySource,
    headers: gateway.headers,
    models: {
      fast: models.fast ?? fallback,
      balanced: models.balanced ?? fallback,
      deep: models.deep ?? fallback,
    },
    structuredOutput: gateway.structuredOutput,
    extraBody: gateway.extraBody,
    enforceModelIdentity: gateway.enforceModelIdentity,
    timeoutMs: gateway.timeoutMs,
  };
}

/** Never print a key. Show enough to identify it and nothing more. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)} (${key.length} chars)`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function writeUserConfig(patch: Record<string, unknown>): Promise<string> {
  const path = userConfigPath();
  await mkdir(dirname(path), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) existing = readConfigFile(path) as Record<string, unknown>;

  const merged = merge(existing, patch, "user-config", {});
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  // Best-effort: a key file should not be world-readable. Silently ignored on
  // filesystems that do not implement POSIX modes.
  await chmod(path, 0o600).catch(() => undefined);
  return path;
}

/** The starter project config written by `biomd config init`. */
export const STARTER_CONFIG = `{
  // biomd-convert configuration.
  // Comments are allowed. Every setting here can be overridden by a CLI flag.
  // Run \`biomd config show\` to see the effective values and where each came from.

  // ---- conversion ---------------------------------------------------------

  // Target profile — what the consuming renderer can actually render.
  //   "renderer-current"  never emits ::: frame, ::: signature or columns.divider
  //   "spec-1.6"          emits everything the specification allows
  "profile": "renderer-current",

  // "simplified" collapses presentational lanes into linear flow (recommended).
  // "faithful" preserves them wherever geometry proves them.
  "layoutFidelity": "simplified",

  // Browser measurement. "always" is strongly recommended: without it, table
  // and lane detection fall back to attribute guesswork.
  //   Requires: npx playwright install chromium
  "visual": "always",

  "lang": "ru",

  // ---- paths --------------------------------------------------------------

  "inputDir": "./html",          // source .htm/.html files
  "assetRoot": "./html",         // images resolved from here while measuring
  "outDir": "./out",             // .bio.md output
  "workDir": ".biomd-work",      // per-file audit artifacts
  "corpus": "corpus/corpus-profile.json",  // produced by \`biomd corpus scan\`
  "jobs": 4,

  // ---- LLM (entirely optional) --------------------------------------------
  // The pipeline is deterministic-first and produces usable output with
  // "enabled": false. Turn this on only to resolve the residual ambiguity.

  "llm": {
    "enabled": false,
    "gateway": "openrouter",
    "cacheDir": ".biomd-cache",

    "gateways": {
      "openrouter": {
        // Base URL, NOT the endpoint. The client appends /chat/completions.
        "baseUrl": "https://openrouter.ai/api/v1",

        // Do not put the key here in a config you commit.
        // Either name an environment variable:
        "apiKeyEnv": "OPENROUTER_API_KEY",
        // …or store it outside the repo with: biomd config set-key openrouter

        "headers": {
          // Optional, for OpenRouter's leaderboards.
          "HTTP-Referer": "https://example.org",
          "X-OpenRouter-Title": "biomd-convert"
        },

        // fast = high-volume classification, deep = hard escalations.
        "models": {
          "fast": "deepseek/deepseek-v4-flash",
          "balanced": "deepseek/deepseek-v4-flash",
          "deep": "anthropic/claude-sonnet-5"
        },

        // OpenRouter documents json_schema; tool support varies by provider.
        "structuredOutput": "json_schema",

        // Route only to providers that honour the parameters we send.
        "extraBody": {
          "provider": { "require_parameters": true }
        },

        // OpenRouter may resolve an alias to a concrete model, so an exact
        // match is not expected.
        "enforceModelIdentity": false
      },

      "litellm": {
        "baseUrl": "http://localhost:4000/v1",
        "apiKeyEnv": "LITELLM_API_KEY",
        "models": {
          "fast": "claude-haiku-4-5",
          "balanced": "claude-sonnet-5",
          "deep": "claude-opus-5"
        },
        "structuredOutput": "tools",
        "enforceModelIdentity": true
      }
    },

    // Hard caps. Reserved before each call, so concurrent workers cannot
    // collectively overspend.
    "budget": {
      "maxCalls": 200,
      "maxEstimatedCostUsd": 5
    },

    // USD per million tokens. Without these the cost report reads "unpriced"
    // rather than showing a confidently wrong number.
    "prices": {
      "input": {},
      "output": {},
      "cachedInputMultiplier": 0.1
    }
  }
}
`;
