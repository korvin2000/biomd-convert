/**
 * The hook contract.
 *
 * A hook is a **plugin**, not an entry in a catalogue. Everything the runtime
 * needs to schedule, budget, cache, validate, report and refuse it is declared
 * here, in one object, next to its prompt templates and its tests. Adding a hook
 * means adding a directory under `plugins/`; it must never mean editing a list
 * of hook names somewhere else.
 *
 * Four rules are load-bearing and are enforced rather than documented:
 *
 *   1. **A hook decides; it never edits.** `output` is a narrow typed verdict
 *      against stable ids. It is not Markdown, not HTML, not "the rewritten
 *      paragraph". Deterministic code in `convert-core` performs every
 *      transformation, and it does so from its own acceptance check.
 *   2. **A hook fills an abstention.** It is reached only where the
 *      deterministic path produced no answer at all, so enabling one can never
 *      overturn a decision a rule already made.
 *   3. **A hook may always be skipped.** `gate` is deterministic and free, and
 *      the pipeline is required to remain usable when every hook is off.
 *   4. **Prose lives in templates.** `render` returns *variables*, never
 *      sentences; the sentences are in `prompts/*.md`, versioned and diffable.
 */
import { z } from "zod";

/** How much the project is willing to rely on a hook. Reported by `biomd hooks list`. */
export type HookStability = "stable" | "candidate" | "experimental";

/** Model tier, resolved against the gateway's configured models. */
export type ModelTier = "fast" | "balanced" | "deep";

export const ModelTierSchema = z.enum(["fast", "balanced", "deep"]);

/**
 * What a hook asks of the transport.
 *
 * Declared rather than assumed so a gateway that fails the vision probe
 * disables the hooks that need vision, instead of paying for calls that come
 * back blind.
 */
export interface HookRequirements {
  /** The payload may carry a rendered crop. */
  vision?: boolean;
}

/** Per-hook knobs an operator may override in configuration. */
export interface HookPolicy {
  /** Cheapest tier to start at. Escalation walks upward from here. */
  tier: ModelTier;
  /** Highest tier the hook may reach. Equal to `tier` disables escalation. */
  maxTier: ModelTier;
  /** Escalate a tier when the reply reports a confidence below this. */
  escalateBelow?: number;
  /**
   * Reject an otherwise-valid reply below this confidence.
   *
   * Distinct from `escalateBelow`: escalation asks a better model, this one
   * abandons the item to the deterministic answer. Principle: an uncertain
   * modification is worse than no modification.
   */
  acceptAbove?: number;
  maxOutputTokens?: number;
  temperature?: number;
  /** Stop calling this hook after this many model calls in one run. */
  maxCalls?: number;
}

export const HookPolicySchema = z.object({
  tier: ModelTierSchema.default("fast"),
  maxTier: ModelTierSchema.default("deep"),
  escalateBelow: z.number().min(0).max(1).optional(),
  acceptAbove: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxCalls: z.number().int().nonnegative().optional(),
});

/**
 * The same policy as an *override* — every field optional, none defaulted.
 *
 * Written out rather than derived with `.partial()`, which keeps the inner
 * `.default()` calls and fills them in. That difference is invisible and
 * expensive: an operator raising one hook's `escalateBelow` would have silently
 * reset its tier ceiling to the schema default, overruling a policy the plugin
 * declared deliberately. An override must say only what it overrides.
 */
export const HookPolicyOverrideSchema = z.object({
  tier: ModelTierSchema.optional(),
  maxTier: ModelTierSchema.optional(),
  escalateBelow: z.number().min(0).max(1).optional(),
  acceptAbove: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxCalls: z.number().int().nonnegative().optional(),
});

/** Prompt template file names, resolved relative to the plugin's own directory. */
export interface HookTemplateRefs {
  /** Stable instruction prefix. Cached by gateways that support it. */
  system: string;
  /** Per-item payload framing. Data blocks arrive through variables. */
  user: string;
}

/**
 * The deterministic decision to spend money, or not.
 *
 * Cost-aware triggering is a *rule*, not a disposition: it runs before anything
 * is rendered, it sees only the request, and its `reason` is what the progress
 * reporter prints when it says why a hook fired. A gate that always returns
 * `call: true` is a hook that has not thought about cost.
 */
export type HookGateVerdict = { call: boolean; reason: string };

/** Variables handed to the templates. Values are stringified verbatim. */
export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

export interface HookRenderResult {
  /** Substituted into `prompts/user.md`. */
  vars: TemplateVars;
  /** Optional rendered crop; requires `requires.vision`. */
  images?: readonly HookImage[];
}

export interface HookImage {
  data: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
}

/**
 * Facts about the run rather than about the item.
 *
 * Supplied by the resolver, identically for every hook. It exists so that a
 * plugin never needs an adapter: a hook's input is exactly what its decision
 * point declared, plus this. Nothing in the framework translates between the
 * compiler's vocabulary and a hook's, because there is nothing to translate.
 */
export interface HookRunContext {
  /** Document language, so anything the model writes matches the page. */
  lang: string;
  /** Source file name, for the audit trail. */
  sourceName?: string;
  /** Whether the page was measured in a browser; layout cues are weak without it. */
  measured?: boolean;
}

/** What a hook actually receives: its decision point's request, plus the run. */
export interface HookInvocation<TRequest> {
  request: TRequest;
  context: HookRunContext;
}

/**
 * A hook plugin.
 *
 * `TInput` is the request the escalation site in `convert-core` hands over, in
 * the compiler's vocabulary. `TOutput` is the verdict, in the hook's.
 */
export interface HookDefinition<TInput = unknown, TOutput = unknown> {
  /** Dotted, stable, and the same string the decision point declares. */
  readonly id: string;
  /** One short noun phrase for `biomd hooks list`. */
  readonly title: string;
  /** One sentence: what judgement this asks for, and why a rule cannot make it. */
  readonly summary: string;
  /**
   * Contract version — bump when the schema or the templates change meaning.
   *
   * Participates in cache identity, so a bump keys stale decisions out rather
   * than reinterpreting them.
   */
  readonly version: string;
  readonly stability: HookStability;
  /**
   * The `convert-core` decision point this serves.
   *
   * Usually equal to `id`. They are separate fields because a decision point is
   * a *place in the compiler* and a hook is one possible answer for it: two
   * competing candidate hooks may serve one point while a refinement round
   * compares them.
   */
  readonly decisionPoint: string;
  /**
   * Whether the hook runs when the operator enables the LLM without naming it.
   *
   * **New hooks declare `false`.** `defaults.test.ts` pins the set that may say
   * `true`, so a hook cannot quietly enlarge what an unattended run does. The
   * standing ruling is that `--llm assist` with nothing named must be
   * byte-identical to `--llm off`, and the two hooks grandfathered here predate
   * it and are wired to abstentions that existed before it.
   */
  readonly enabledByDefault: boolean;
  readonly requires?: HookRequirements;
  /** Validates what the escalation site handed over. A failure is a caller bug. */
  readonly input: z.ZodType<TInput>;
  /** Validates the reply. Narrow: a verdict against stable ids, never prose to paste. */
  readonly output: z.ZodType<TOutput>;
  readonly templates: HookTemplateRefs;
  readonly defaults: HookPolicy;
  /**
   * Where `templates` are resolved from — always `import.meta.url` of the
   * plugin module, so the same code finds them in `src/` under vitest and in
   * `dist/` after a build.
   */
  readonly moduleUrl: string;

  /** Deterministic, free, and the only thing that authorises a call. */
  gate(input: TInput): HookGateVerdict;
  /** Template variables and optional images. Never returns sentences. */
  render(input: TInput): HookRenderResult;
  /** Domain checks the schema cannot express. Empty array means accepted. */
  validate?(output: TOutput, input: TInput): string[];
}

/**
 * Shape check for a discovered module.
 *
 * A plugin directory is loaded by convention, so the failure mode to design for
 * is a half-written one. Naming the missing field beats `undefined is not a
 * function` three stack frames into the runner.
 */
export function assertHookDefinition(value: unknown, origin: string): asserts value is HookDefinition {
  const problems: string[] = [];
  const hook = value as Partial<HookDefinition> | null;
  if (typeof hook !== "object" || hook === null) {
    throw new Error(`${origin}: expected a hook definition object, received ${typeof value}`);
  }
  for (const key of ["id", "title", "summary", "version", "decisionPoint", "moduleUrl"] as const) {
    if (typeof hook[key] !== "string" || hook[key] === "") problems.push(`${key} must be a non-empty string`);
  }
  if (typeof hook.enabledByDefault !== "boolean") problems.push("enabledByDefault must be a boolean");
  if (!["stable", "candidate", "experimental"].includes(hook.stability as string)) {
    problems.push("stability must be stable | candidate | experimental");
  }
  for (const key of ["input", "output"] as const) {
    if (typeof (hook[key] as { safeParse?: unknown } | undefined)?.safeParse !== "function") {
      problems.push(`${key} must be a zod schema`);
    }
  }
  for (const key of ["gate", "render"] as const) {
    if (typeof hook[key] !== "function") problems.push(`${key} must be a function`);
  }
  if (typeof hook.templates?.system !== "string" || typeof hook.templates?.user !== "string") {
    problems.push("templates must name a system and a user file");
  }
  if (typeof hook.defaults !== "object" || hook.defaults === null) problems.push("defaults must be a HookPolicy");
  if (typeof hook.id === "string" && !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(hook.id)) {
    problems.push(`id ${JSON.stringify(hook.id)} must be lower-case dotted, e.g. "table.classify"`);
  }
  if (problems.length > 0) {
    throw new Error(`${origin}: invalid hook definition —\n  ${problems.join("\n  ")}`);
  }
}

/** Helper so a plugin gets full inference without repeating its type arguments. */
export function defineHook<TInput, TOutput>(hook: HookDefinition<TInput, TOutput>): HookDefinition<TInput, TOutput> {
  return hook;
}

/** Merge an operator override onto a hook's declared defaults. */
export function resolvePolicy(defaults: HookPolicy, override: Partial<HookPolicy> = {}): HookPolicy {
  const merged = { ...defaults } as HookPolicy & Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) merged[key] = value;
  }
  // An override may raise the floor above the ceiling; the ceiling wins, because
  // the alternative is a hook that silently never escalates.
  if (TIER_ORDER.indexOf(merged.maxTier) < TIER_ORDER.indexOf(merged.tier)) merged.maxTier = merged.tier;
  return merged;
}

export const TIER_ORDER: readonly ModelTier[] = ["fast", "balanced", "deep"];

/** The tiers a policy may walk, cheapest first, deduplicated by resolved model id. */
export function tiersFor(policy: HookPolicy, models: Record<ModelTier, string>): string[] {
  const from = TIER_ORDER.indexOf(policy.tier);
  const to = TIER_ORDER.indexOf(policy.maxTier);
  const out: string[] = [];
  for (let i = from; i <= to; i += 1) {
    const model = models[TIER_ORDER[i] as ModelTier];
    if (model && !out.includes(model)) out.push(model);
  }
  return out;
}
