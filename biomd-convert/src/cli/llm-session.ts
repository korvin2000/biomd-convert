/**
 * Assembling the escalation boundary from configuration.
 *
 * This is the one place that turns files on disk into a live resolver:
 * discovery, enablement, policy, budget, cache, transport and the queue that
 * protects the gateway. It lives in `cli/` because configuration does, and
 * because `src/llm` must stay usable by anything that can build the same
 * objects by hand — a test, or `biomd hooks test`, both of which do.
 *
 * The enablement rules are short and are the operator's whole interface:
 *
 *   1. a hook that declares `enabledByDefault` starts on;
 *   2. `llm.hooks.enable` turns more on;
 *   3. `llm.hooks.disable` turns them off, and `"*"` turns everything off;
 *   4. `llm.hooks.overrides.<id>.enabled` overrules all three.
 *
 * An id nobody recognises is a startup error, never a silent no-op. Asking for
 * a hook and getting nothing, with no message, is how an operator concludes the
 * subsystem does not work.
 */
import { resolve } from "node:path";
import {
  Budget,
  FileCache,
  GatewayResolver,
  GatewayTransport,
  type HookRunContext,
  type HookRegistry,
  type ModelTier,
  Limiter,
  MemoryCache,
  type PreparedHook,
  discoverHooks,
  prepareHook,
  resolvePolicy,
} from "../llm/index.js";
import type { DecisionResolver } from "../convert-core/index.js";
import type { HookEventSink } from "../llm/kernel/events.js";
import { type Config, redactKey, resolveGateway } from "./config.js";

export interface LlmSession {
  /** Null whenever a model must not be used. Every such state is supported. */
  resolver: DecisionResolver | null;
  budget: Budget | null;
  /** Enabled hooks, prepared. Empty is a normal and fully deterministic state. */
  hooks: ReadonlyArray<PreparedHook>;
  /** Everything discovered, enabled or not — for `biomd hooks list`. */
  registry: HookRegistry;
  /** One line for the operator: what is on, through what, with which key. */
  note: string;
  /** Non-fatal problems worth printing. */
  warnings: string[];
}

export interface SessionOptions {
  /** `off` | `assist`. Absent means "whatever the config says". */
  llm?: string;
  gateway?: string;
  replay?: boolean;
  /** `--hooks a,b` — the enable list, from the command line. */
  hooks?: string;
  /** `--no-hooks` — disable every hook for this run. */
  noHooks?: boolean;
  onEvent?: HookEventSink;
  /** Something the operator should know, discovered after the session opened. */
  onNotice?: (notice: string) => void;
  startedAt?: number;
}

export class HookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookConfigError";
  }
}

/**
 * Which hooks a configuration asks for, and why.
 *
 * Separated from the session so `biomd hooks list` can show the answer without
 * building a transport, and so the rules can be tested without a gateway.
 */
export function resolveEnabled(
  registry: HookRegistry,
  cfg: Config,
  options: Pick<SessionOptions, "hooks" | "noHooks"> = {},
): { enabled: string[]; reasons: Map<string, string> } {
  const known = new Set(registry.ids());
  const fromFlag = (options.hooks ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const named = [...cfg.llm.hooks.enable, ...cfg.llm.hooks.disable, ...Object.keys(cfg.llm.hooks.overrides), ...fromFlag];
  const unknown = named.filter((id) => id !== "*" && !known.has(id));
  if (unknown.length > 0) {
    throw new HookConfigError(
      `Unknown hook id(s): ${unknown.map((id) => JSON.stringify(id)).join(", ")}.\n` +
        `Discovered hooks: ${[...known].sort().join(", ") || "(none)"}.\n` +
        "Run `biomd hooks list` to see every hook and where it was loaded from.",
    );
  }

  const reasons = new Map<string, string>();
  const enabled = new Set<string>();
  for (const id of registry.defaults()) {
    enabled.add(id);
    reasons.set(id, "on by default");
  }
  for (const id of cfg.llm.hooks.enable) {
    enabled.add(id);
    reasons.set(id, "llm.hooks.enable");
  }
  for (const id of fromFlag) {
    enabled.add(id);
    reasons.set(id, "--hooks");
  }
  if (options.noHooks === true) {
    for (const id of [...enabled]) {
      enabled.delete(id);
      reasons.set(id, "--no-hooks");
    }
  }
  for (const id of cfg.llm.hooks.disable) {
    if (id === "*") {
      for (const known2 of registry.ids()) {
        enabled.delete(known2);
        reasons.set(known2, 'llm.hooks.disable ["*"]');
      }
      continue;
    }
    enabled.delete(id);
    reasons.set(id, "llm.hooks.disable");
  }
  for (const [id, override] of Object.entries(cfg.llm.hooks.overrides)) {
    if (override.enabled === undefined) continue;
    if (override.enabled) {
      enabled.add(id);
      reasons.set(id, `llm.hooks.overrides.${id}.enabled`);
    } else {
      enabled.delete(id);
      reasons.set(id, `llm.hooks.overrides.${id}.enabled = false`);
    }
  }

  return { enabled: [...enabled].sort(), reasons };
}

/** Prepare one hook: merge global defaults, then its own override, then load prompts. */
export function prepareEnabled(
  registry: HookRegistry,
  ids: readonly string[],
  cfg: Config,
  models: Record<ModelTier, string>,
): PreparedHook[] {
  const prepared: PreparedHook[] = [];
  for (const id of ids) {
    const found = registry.get(id);
    if (!found) continue;
    const { enabled: _ignored, ...override } = cfg.llm.hooks.overrides[id] ?? {};
    const policy = resolvePolicy(found.hook.defaults, { ...cfg.llm.hooks.defaults, ...override });
    prepared.push(prepareHook(found.hook, policy, models));
  }
  return prepared;
}

/** Discover every hook the configuration points at. Cheap; no network. */
export async function loadRegistry(cfg: Config): Promise<HookRegistry> {
  return discoverHooks({ paths: cfg.llm.hooks.paths.map((p) => resolve(p)) });
}

/**
 * Build the escalation boundary.
 *
 * Returns a null resolver whenever a model must not be used — `llm.enabled`
 * off, `--llm off`, no gateway, no key, or no hook enabled. Every one of those
 * is a normal, supported, fully deterministic state, and each of them says so.
 */
export async function openLlmSession(cfg: Config, options: SessionOptions = {}): Promise<LlmSession> {
  const registry = await loadRegistry(cfg);
  const warnings: string[] = [];
  const off = (note: string): LlmSession => ({
    resolver: null,
    budget: null,
    hooks: [],
    registry,
    note,
    warnings,
  });

  const mode = options.llm ?? (cfg.llm.enabled ? "assist" : "off");
  if (mode !== "assist" && mode !== "off") {
    throw new HookConfigError(`--llm expects "off" or "assist", received ${JSON.stringify(mode)}.`);
  }
  if (mode === "off") return off("llm off — fully deterministic");

  let gateway;
  try {
    gateway = resolveGateway(cfg, options.gateway);
  } catch (error) {
    return off(`llm unavailable: ${(error as Error).message.split("\n")[0]}`);
  }
  if (gateway.requiresApiKey && !gateway.apiKey && !options.replay) {
    return off(
      `llm unavailable: no API key for gateway "${gateway.name}" (${gateway.apiKeySource}). ` +
        "Run `biomd config set-key <gateway>`, or set `requiresApiKey: false` on the gateway if it " +
        "is a local server that authenticates nobody.",
    );
  }

  const { enabled } = resolveEnabled(registry, cfg, options);
  if (enabled.length === 0) {
    // Byte-identical to `--llm off`: with nothing enabled there is nothing to
    // ask, and building a transport would only make the report claim otherwise.
    return off("llm assist, but no hook is enabled — fully deterministic. See `biomd hooks list`.");
  }

  const hooks = prepareEnabled(registry, enabled, cfg, gateway.models);
  for (const prepared of hooks) {
    if (prepared.models.length === 0) {
      warnings.push(
        `Hook ${prepared.definition.id} has no model for tiers ` +
          `${prepared.policy.tier}..${prepared.policy.maxTier}; it will abstain.`,
      );
    }
  }

  const transport = new GatewayTransport({
    baseUrl: gateway.baseUrl,
    ...(gateway.apiKey ? { apiKey: gateway.apiKey } : {}),
    headers: gateway.headers,
    structuredOutput: gateway.structuredOutput,
    ...(gateway.vision === undefined ? {} : { vision: gateway.vision }),
    extraBody: gateway.extraBody,
    enforceModelIdentity: gateway.enforceModelIdentity,
    timeoutMs: gateway.timeoutMs,
    // Discovered mid-run — a capability the endpoint turns out not to have, an
    // output allowance that had to be widened. Warnings collected at startup
    // cannot carry these, and without a route out they are invisible.
    onNotice: (notice) => {
      warnings.push(notice);
      options.onNotice?.(notice);
    },
  });
  const budget = new Budget(cfg.llm.budget, {
    input: cfg.llm.prices.input,
    output: cfg.llm.prices.output,
    cachedInputMultiplier: cfg.llm.prices.cachedInputMultiplier,
  });
  const cache = cfg.llm.cacheDir ? new FileCache(resolve(cfg.llm.cacheDir)) : new MemoryCache();
  const context: HookRunContext = { lang: cfg.lang, measured: cfg.visual !== "never" };

  const resolver = new GatewayResolver({
    transport,
    cache,
    budget,
    hooks,
    endpoint: gateway.name,
    models: gateway.models,
    context,
    limiter: new Limiter({
      default: cfg.llm.concurrency.default,
      perModel: cfg.llm.concurrency.perModel,
    }),
    breakerAfter: cfg.llm.concurrency.breakerAfter,
    ...(options.replay ? { replay: true } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
  });

  return {
    resolver,
    budget,
    hooks,
    registry,
    note:
      `llm ${mode} via "${gateway.name}" (${gateway.models.fast} → ${gateway.models.deep}), ` +
      `key ${gateway.apiKey ? redactKey(gateway.apiKey) : gateway.apiKeySource}, ` +
      `hooks: ${enabled.join(", ")}`,
    warnings,
  };
}
