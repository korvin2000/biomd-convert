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
  return { consulted: 0, resolved: 0, deterministic: 0, cacheHits: 0, calls: 0, unresolved: 0, byHook: {} };
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
