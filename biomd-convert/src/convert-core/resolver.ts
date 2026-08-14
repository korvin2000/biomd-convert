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
 *   - a resolver is consulted only where the deterministic path produced **no
 *     answer at all**, so turning one on never *changes* a decision — it only
 *     fills in the ones that were going to become review items.
 *
 * The second property was, for a while, a comment rather than a fact. Methods
 * were added here for reviewing chrome the boilerplate pass had decided to
 * delete, and for rejoining hyphens the cascade had decided to preserve. Both
 * are a rule being appealed rather than a blank being filled, both damaged
 * output that was correct without them, and both are deleted. `bindImageCaption`
 * went too, for a different reason worth keeping separate: it *did* fill a real
 * blank, and a wrong answer was invisible in the output and read as a fact.
 *
 * What is left obeys both rules. A method belongs here only if the deterministic
 * path produced no answer at all, **and** a wrong answer would be visible to
 * whoever reads the result.
 */
import type { BlockRole, BreakKind, ImageRole } from "./advice.js";
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

/**
 * A short standalone line the prominence rule scored between prose and a heading.
 *
 * The residual of {@link recoverHeadings}, and nothing else. A line the rule
 * marked as a heading never appears here, so this escalation cannot demote one;
 * it can only promote a line the rule left as a paragraph.
 */
export interface BlockRoleRequest {
  /** Source node id, so the answer can be written back onto it. */
  id: string;
  line: string;
  before: string;
  after: string;
  /** How the line is set against the page's own prose. */
  typography: string;
  openHeading?: string;
  openDepth?: number;
  /** Lines set the same way elsewhere on the page — the recurrence signal. */
  siblingLines?: readonly string[];
  sourceName?: string;
}

export interface BlockRoleAnswer {
  role: BlockRole;
  depth?: 2 | 3;
  confidence: number;
  reason: string;
}

/** An image whose asset the known-icon table has never seen. */
export interface ImageRoleRequest {
  id: string;
  /** Declared size, e.g. `24×24 px` or `not declared`. */
  size: string;
  alt?: string;
  inLink: boolean;
  linkTarget?: string;
  occurrences: number;
  /** Characters of prose before it in its block, when it sits inside a sentence. */
  inRunningProse?: number;
  surroundings: string;
  sourceName?: string;
}

export interface ImageRoleAnswer {
  role: ImageRole;
  /** Only ever a mark the project's own icon table already sanctions. */
  glyph?: string;
  confidence: number;
  reason: string;
}

/** A run of line breaks the geometry rule could not read. */
export interface BreakRunRequest {
  id: string;
  context: string;
  breaks: readonly string[];
  sourceName?: string;
}

/**
 * The finished document, and the source it came from, for a reading review.
 *
 * Both sides in full. Every other request in this file is deliberately clipped,
 * because a bounded judgement needs bounded evidence; this one is not, because
 * the failures it exists to catch are properties of the whole document — a
 * section flattened, an order that does not read, a caption annexed from the
 * article — and none of them is visible in a window.
 */
export interface DocumentReviewRequest {
  sourceName: string;
  sourceText: string;
  output: string;
  /** The compiler's own account of what it did, so the reviewer is not guessing. */
  summary: string;
  warnings?: readonly string[];
}

/** A place a human should look. Advisory: nothing here edits the document. */
export interface ReviewFinding {
  severity: "critical" | "major" | "minor";
  /** Lower-case dotted class, e.g. `structure.flattened`. */
  class: string;
  /** Verbatim span of the produced document, so the finding can be located. */
  quote: string;
  note: string;
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
  /**
   * Per-hook counts, for the run report.
   *
   * `consulted` is counted by the pipeline and the rest by the resolver, which
   * is why `consulted` is present with no model configured and the others are
   * not. That asymmetry is the useful part: it turns "should I turn this hook
   * on?" into a number an operator can read off a deterministic run, per hook,
   * before anything is spent.
   */
  byHook: Record<string, { consulted: number; calls: number; cacheHits: number; unresolved: number }>;
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

  /**
   * Name a standalone line the prominence rule scored between prose and a heading.
   *
   * The one escalation here that changes the document's *structure*, and the one
   * with a demonstrated case behind it: `БЛАГОДАРНОСТИ:` on its own line is a
   * section heading, typography alone cannot say so, and the rule correctly
   * declines rather than guessing. Only a `SECTION_LABEL` reply is ever applied;
   * every other role is recorded and the line stays the paragraph it was.
   */
  blockRole?(request: BlockRoleRequest): Promise<BlockRoleAnswer | null>;

  /** Say what an image the known-icon table has never seen actually is. */
  imageRole?(request: ImageRoleRequest): Promise<ImageRoleAnswer | null>;

  /** Classify a run of line breaks geometry could not read. */
  classifyBreaks?(request: BreakRunRequest): Promise<readonly BreakKind[] | null>;

  /**
   * Whether this resolver would actually ask about a given hook id.
   *
   * Optional methods answer this by existing — a disabled hook simply is not
   * installed. The two required methods cannot: `classifyTable` and
   * `tableHeaders` are always present and return null both when the hook is
   * switched off and when the model declined, and the pipeline needs to tell
   * those apart. It reports the first as nothing having happened and the second
   * as a declined escalation, and printing "asked, declined" for a hook nobody
   * turned on is exactly the kind of noise that made the last progress output
   * useless.
   */
  canAnswer?(hookId: string): boolean;

  /**
   * Read the finished document against its source and report what is wrong.
   *
   * The only method here that runs on a document nothing abstained about, and
   * the only one that cannot change a byte. It exists because every failure this
   * project has actually shipped passed every automatic gate at the moment it
   * shipped — structure flattened under a clean conservation report, a section
   * label absorbed into a property no comparison looks at, a construct the
   * compiler could not emit and so nothing reported as missing. A reader catches
   * all three in a minute; reviewing a thousand pages by hand is what makes that
   * reader unaffordable.
   */
  reviewDocument?(request: DocumentReviewRequest): Promise<readonly ReviewFinding[] | null>;

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
    const existing = byHook[hook] ?? { consulted: 0, calls: 0, cacheHits: 0, unresolved: 0 };
    byHook[hook] = {
      consulted: existing.consulted + counts.consulted,
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
  canAnswer() {
    return false;
  },
  stats: emptyStats,
};
