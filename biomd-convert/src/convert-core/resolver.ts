/**
 * The escalation boundary.
 *
 * The pipeline is deterministic-first and must produce usable output with no
 * model at all. Where it genuinely cannot decide, it asks *something* — and this
 * interface is that something, stated in the compiler's own vocabulary so that
 * `convert-core` never learns what a gateway, a prompt or a token is.
 *
 * Two properties matter more than the shape:
 *
 *   - every method may return null, meaning "still undecided", and every caller
 *     has a deterministic answer ready for that case;
 *   - a resolver is consulted only at points the deterministic path has already
 *     abstained on, so turning one on never *changes* a confident decision, it
 *     only fills in the ones that were going to become review items.
 */
import type { Classification } from "./classify.js";
import type { LogicalTablePlan } from "./data-table.js";
import type { TableGrid } from "../ladom/grid.js";

export interface TableClassifyRequest {
  grid: TableGrid;
  /** What the deterministic tiers produced, including why they abstained. */
  deterministic: Classification;
  corpusFrequency?: number;
  sourceName?: string;
}

export interface TableHeaderRequest {
  grid: TableGrid;
  /** The accepted semantic plan; only its labels are missing. */
  plan: LogicalTablePlan;
  classification: Classification;
  sourceName?: string;
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
  /** Of those, how many came back with an answer. */
  resolved: number;
  /** Decisions answered without a model. */
  deterministic: number;
  /** Decisions served from the on-disk decision cache. */
  cacheHits: number;
  /** Decisions that cost a request. */
  calls: number;
  /** Decisions the resolver could not make; they stay review items. */
  unresolved: number;
  /**
   * Distinct reasons decisions were abandoned, most frequent first.
   *
   * Reported because "3 calls, 0 resolved" is not a diagnosis. A mistyped model
   * id, an expired key and an exhausted budget all produce that line, and only
   * the reason distinguishes them.
   */
  failures: Array<{ reason: string; count: number }>;
  /** Per-hook counts, for the run report. */
  byHook: Record<string, { calls: number; cacheHits: number; unresolved: number }>;
}

export interface DecisionResolver {
  /**
   * Decide what an ambiguous table region *is*.
   *
   * Consulted only when Tier 1 and Tier 2 both abstained.
   */
  classifyTable(request: TableClassifyRequest): Promise<Classification | null>;

  /**
   * Supply column labels for a table whose source had no header row.
   *
   * §3.8 requires a meaningful header for every column, and §16.3 classes
   * inventing one as an editorial change — which is exactly why it is asked for
   * here rather than fabricated in the emitter. Returning null keeps the table
   * *and* the review item.
   */
  tableHeaders(request: TableHeaderRequest): Promise<string[] | null>;

  stats(): ResolverStats;
}

export function emptyStats(): ResolverStats {
  return {
    consulted: 0,
    resolved: 0,
    deterministic: 0,
    cacheHits: 0,
    calls: 0,
    unresolved: 0,
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
  const byHook: ResolverStats["byHook"] = { ...a.byHook };
  for (const [hook, counts] of Object.entries(b.byHook)) {
    const existing = byHook[hook] ?? { calls: 0, cacheHits: 0, unresolved: 0 };
    byHook[hook] = {
      calls: existing.calls + counts.calls,
      cacheHits: existing.cacheHits + counts.cacheHits,
      unresolved: existing.unresolved + counts.unresolved,
    };
  }
  return {
    consulted: a.consulted + b.consulted,
    resolved: a.resolved + b.resolved,
    deterministic: a.deterministic + b.deterministic,
    cacheHits: a.cacheHits + b.cacheHits,
    calls: a.calls + b.calls,
    unresolved: a.unresolved + b.unresolved,
    failures: [...failures].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count),
    byHook,
  };
}

/** The default: never escalates, so a run with no gateway behaves exactly as before. */
export const NULL_RESOLVER: DecisionResolver = {
  async classifyTable() {
    return null;
  },
  async tableHeaders() {
    return null;
  },
  stats: emptyStats,
};
