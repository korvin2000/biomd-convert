/**
 * The decision points the compiler declares.
 *
 * Each one sits beside a rule that abstained, and each one owns the check that
 * decides whether an answer may be applied. Nothing in this file knows what a
 * model is; a hook with a matching `decisionPoint` is what happens to answer,
 * and the compiler behaves identically when nothing does.
 *
 * The acceptance checks are the point of the file. A reply that satisfies a
 * hook's schema has proved that it is *well formed* — that a class is one of
 * five names, that there are as many labels as the model was asked for. Whether
 * it may be applied is a question about this document, and it is answered here,
 * deterministically, from the same evidence a rule would have used.
 */
import type { TableGrid } from "../ladom/grid.js";
import type { Classification } from "./classify.js";
import { type LogicalTablePlan, planDataTable } from "./data-table.js";
import { type Acceptance, type DecisionPoint, accepted, refused } from "./resolver.js";

// ---------------------------------------------------------------------------
// table.classify — what an ambiguous table region *is*
// ---------------------------------------------------------------------------

export interface TableClassifyRequest {
  grid: TableGrid;
  /** What the deterministic tiers produced, including why they abstained. */
  deterministic: Classification;
  corpusFrequency?: number;
  sourceName?: string;
  /**
   * A rendered crop of the region, when one is available.
   *
   * Declared here because the *question* legitimately includes what the region
   * looks like; whether a run can supply one is a capability of the measurer,
   * not of the escalation site.
   */
  crop?: { data: Uint8Array; mediaType: "image/png" | "image/jpeg" };
}

/** The five names a region can be given, plus the one that means "do not use me". */
const TABLE_CLASSES = new Set(["SHELL", "LAYOUT", "DATA", "HYBRID", "CATALOG"]);

/**
 * Promoting an abstention straight to DATA is the one upgrade that *fabricates*
 * structure rather than describing it, so it carries its own evidence bar.
 *
 * Asked "is this a data table?", a model says yes to a dated news list and to a
 * two-lane album catalog alike, and the result is two invented headers over
 * something that was never a matrix. Measured against the reference
 * conversions, the discriminator is width: a record matrix the deterministic
 * tiers missed has three or more semantic columns, while "label plus paragraph"
 * — the classic false positive — has exactly two.
 */
const DATA_PROMOTION_CONFIDENCE = 0.75;

export const TABLE_CLASSIFY: DecisionPoint<TableClassifyRequest, Classification> = {
  id: "table.classify",
  question: "Tier 1 and Tier 2 both abstained: what kind of region is this table?",

  itemId(request) {
    return `${request.sourceName ?? "?"}:${request.grid.id}`;
  },

  accept(reply, request): Acceptance<Classification> {
    const verdict = reply as { class?: unknown; confidence?: unknown; rationale?: unknown };
    const cls = verdict.class;
    const confidence = verdict.confidence;
    if (typeof cls !== "string" || typeof confidence !== "number") {
      return refused("reply carried no class and confidence");
    }
    // An explicit abstention is a successful outcome, not a failure: it leaves
    // the deterministic answer standing and the region a review item, which is
    // the correct treatment for a genuinely ambiguous table.
    if (cls === "UNCERTAIN") return refused("the model declined to classify this region");
    if (!TABLE_CLASSES.has(cls)) return refused(`unknown class ${JSON.stringify(cls)}`);

    if (cls === "DATA") {
      if (confidence < DATA_PROMOTION_CONFIDENCE) {
        return refused(
          `DATA at confidence ${confidence.toFixed(2)} — a record matrix must be asserted above ` +
            `${DATA_PROMOTION_CONFIDENCE}, since the upgrade invents a header row`,
        );
      }
      if (!isWideEnoughForData(request.grid)) {
        return refused("the region does not carry its own evidence for a record matrix");
      }
    }

    const rationale = typeof verdict.rationale === "string" ? verdict.rationale : "";
    return accepted({
      class: cls as Classification["class"],
      confidence,
      tier: 3,
      reason: rationale.slice(0, RATIONALE_LIMIT),
    });
  },
};

/**
 * A rationale is a diagnostic, not content.
 *
 * Truncated at the point of use rather than rejected: throwing away an
 * otherwise-correct classification because the model explained itself in 430
 * characters instead of 400 wastes the call *and* leaves the item unresolved.
 */
const RATIONALE_LIMIT = 400;

/**
 * Whether a region carries enough of its own evidence to become a table on a
 * model's say-so.
 *
 * A source header row is the author stating the column model outright. Failing
 * that, three or more inferred semantic columns is the width at which "these are
 * records" stops being an interpretation.
 */
export function isWideEnoughForData(grid: TableGrid): boolean {
  const planned = planDataTable(grid);
  if (!planned.plan) return false;
  return !planned.plan.headerSynthesized || planned.plan.bands.length >= 3;
}

// ---------------------------------------------------------------------------
// table.records — a name for a column the source never named
// ---------------------------------------------------------------------------

export interface TableHeaderRequest {
  grid: TableGrid;
  /** The accepted semantic plan; only its labels are missing. */
  plan: LogicalTablePlan;
  classification: Classification;
  sourceName?: string;
}

/** Long enough for a real label in any language, short enough to stay a label. */
const MAX_LABEL_LENGTH = 60;

export const TABLE_HEADERS: DecisionPoint<TableHeaderRequest, string[]> = {
  id: "table.records",
  question: "This table has no source header row: what does each column contain?",

  itemId(request) {
    return `${request.sourceName ?? "?"}:${request.grid.id}:headers`;
  },

  accept(reply, request): Acceptance<string[]> {
    const verdict = reply as { headers?: unknown };
    const raw = verdict.headers;
    if (!Array.isArray(raw)) return refused("reply carried no header list");

    const wanted = request.plan.bands.length;
    if (raw.length !== wanted) return refused(`expected ${wanted} labels, received ${raw.length}`);

    const headers: string[] = [];
    for (const value of raw) {
      if (typeof value !== "string") return refused("a label was not a string");
      const label = value.trim();
      if (label === "") return refused("a label was empty");
      if (label.length > MAX_LABEL_LENGTH) return refused(`a label exceeded ${MAX_LABEL_LENGTH} characters`);
      headers.push(label);
    }

    // Two columns with the same name describe nothing. The emitter would happily
    // write them, and the resulting table reads as if the reconstruction failed.
    const distinct = new Set(headers.map((h) => h.toLocaleLowerCase()));
    if (distinct.size !== headers.length) return refused("column labels are not distinct");

    return accepted(headers);
  },
};
