/**
 * The escalation boundary.
 *
 * The pipeline is deterministic-first and must produce usable output with no
 * model at all. Where it genuinely cannot decide, it asks *something* — and this
 * file is that something, stated in the compiler's own vocabulary so that
 * `convert-core` never learns what a gateway, a prompt or a token is.
 *
 * The shape is a **decision point**, not a method per question. A decision point
 * is declared next to the code that abstains, carries its own acceptance check,
 * and is matched to whatever hook claims its id. Nothing here enumerates hooks,
 * and adding one never edits this file: that is what makes the escalation
 * surface an extension surface rather than a growing interface.
 *
 * Three properties matter more than the shape:
 *
 *   - `decide` may always return null, meaning "still undecided", and every
 *     caller has a deterministic answer ready for that case;
 *   - a decision point is reached only where the deterministic path has already
 *     abstained, so turning a hook on never *changes* a confident decision — it
 *     only fills in the ones that were going to become review items;
 *   - the **acceptance check lives here**, on the deterministic side. A reply
 *     that satisfies a hook's schema has proved only that it is well formed.
 *     Whether it may be applied is a question about the document, and the
 *     compiler answers it.
 */

/**
 * What an acceptance check concluded.
 *
 * A refusal carries its reason because "the model answered and nothing
 * happened" is the single most confusing thing this subsystem can do. The
 * reason reaches the run report and the progress line.
 */
export type Acceptance<TDecision> = { ok: true; value: TDecision } | { ok: false; reason: string };

export function accepted<T>(value: T): Acceptance<T> {
  return { ok: true, value };
}

export function refused<T>(reason: string): Acceptance<T> {
  return { ok: false, reason };
}

/**
 * A place in the compiler where a deterministic rule abstained.
 *
 * `TRequest` is everything the question needs, in the compiler's vocabulary.
 * `TDecision` is what the compiler will do with the answer. The reply itself
 * arrives as `unknown` on purpose: it came from outside, a hook's schema has
 * already checked its shape, and `accept` re-establishes every property this
 * particular escalation site depends on before a single node is touched.
 */
export interface DecisionPoint<TRequest, TDecision> {
  /** Stable id. The hook that serves this point declares the same string. */
  readonly id: string;
  /** One line, for `biomd hooks list` and the run report: what is undecided. */
  readonly question: string;
  /** Stable identity of one item, for the decision cache and the audit trail. */
  itemId(request: TRequest): string;
  /** The acceptance check. Deterministic, and the last word. */
  accept(reply: unknown, request: TRequest): Acceptance<TDecision>;
}

export interface ResolverStats {
  /**
   * Points where the deterministic path abstained and a resolver was consulted.
   *
   * Counted by the pipeline rather than by the resolver, so it is reported even
   * when no model is configured: it is the answer to "how much would turning the
   * LLM on actually do?", which is otherwise unknowable without spending money.
   */
  consulted: number;
  /** Of those, how many came back with an answer the compiler accepted. */
  resolved: number;
  /** Decisions served from the on-disk decision cache. */
  cacheHits: number;
  /** Decisions that cost a request. */
  calls: number;
  /** Escalations a deterministic gate declined before anything was spent. */
  skipped: number;
  /** Replies that were well formed and still refused by the acceptance check. */
  rejected: number;
  /** Decisions the resolver could not make; they stay review items. */
  unresolved: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * Distinct reasons decisions were abandoned, most frequent first.
   *
   * Reported because "3 calls, 0 resolved" is not a diagnosis. A mistyped model
   * id, an expired key and an exhausted budget all produce that line, and only
   * the reason distinguishes them.
   */
  failures: Array<{ reason: string; count: number }>;
  /** Per-hook counts, for the run report. */
  byHook: Record<string, HookCounts>;
}

export interface HookCounts {
  calls: number;
  cacheHits: number;
  skipped: number;
  rejected: number;
  unresolved: number;
  resolved: number;
}

export interface DecisionResolver {
  /**
   * Ask the point's question. Null means "still undecided".
   *
   * Never throws for an operational reason: budget exhaustion, a dead gateway,
   * a malformed reply and a refused acceptance check all resolve to null, and
   * null means the deterministic answer stands and the item stays flagged.
   */
  decide<TRequest, TDecision>(
    point: DecisionPoint<TRequest, TDecision>,
    request: TRequest,
  ): Promise<TDecision | null>;

  stats(): ResolverStats;
}

export function emptyHookCounts(): HookCounts {
  return { calls: 0, cacheHits: 0, skipped: 0, rejected: 0, unresolved: 0, resolved: 0 };
}

export function emptyStats(): ResolverStats {
  return {
    consulted: 0,
    resolved: 0,
    cacheHits: 0,
    calls: 0,
    skipped: 0,
    rejected: 0,
    unresolved: 0,
    inputTokens: 0,
    outputTokens: 0,
    failures: [],
    byHook: {},
  };
}

/** Merge two stat sets, e.g. per-file totals across a corpus run. */
export function mergeStats(a: ResolverStats, b: ResolverStats): ResolverStats {
  const failures = new Map<string, number>();
  for (const list of [a.failures, b.failures]) {
    for (const f of list) failures.set(f.reason, (failures.get(f.reason) ?? 0) + f.count);
  }
  const byHook: ResolverStats["byHook"] = {};
  for (const [hook, counts] of [...Object.entries(a.byHook), ...Object.entries(b.byHook)]) {
    const existing = byHook[hook] ?? emptyHookCounts();
    byHook[hook] = {
      calls: existing.calls + counts.calls,
      cacheHits: existing.cacheHits + counts.cacheHits,
      skipped: existing.skipped + counts.skipped,
      rejected: existing.rejected + counts.rejected,
      unresolved: existing.unresolved + counts.unresolved,
      resolved: existing.resolved + counts.resolved,
    };
  }
  return {
    consulted: a.consulted + b.consulted,
    resolved: a.resolved + b.resolved,
    cacheHits: a.cacheHits + b.cacheHits,
    calls: a.calls + b.calls,
    skipped: a.skipped + b.skipped,
    rejected: a.rejected + b.rejected,
    unresolved: a.unresolved + b.unresolved,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    failures: [...failures].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count),
    byHook,
  };
}

/** The default: never escalates, so a run with no gateway behaves exactly as before. */
export const NULL_RESOLVER: DecisionResolver = {
  async decide() {
    return null;
  },
  stats: emptyStats,
};
