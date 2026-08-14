/**
 * Table hooks — what a region IS, and how its matrix is shaped.
 *
 * The two oldest hooks in the catalogue live here, and so do three that close
 * the gaps they left. `table.classify` decides *whether* a region is a record
 * matrix and `table.records` names its columns; between those two questions sit
 * three the deterministic planner still abstains on — whether the source drew a
 * header row without saying so, whether the matrix is transposed, and what to do
 * with a cell holding content the target format's tables cannot carry.
 *
 * Every one of them is consulted only after the planner has run and declined.
 */
import { z } from "zod";
import type { Hook } from "../hook.js";
import type { TableGrid } from "../../ladom/grid.js";
import { rowCells } from "../../ladom/grid.js";
import {
  type Classification,
  classifyTier1,
  classifyTier2,
  extractFeatures,
} from "../../convert-core/classify.js";
import type { ChatImage } from "../transport.js";
import { CONFIDENCE, RATIONALE, quote, systemPrompt, trimRationale, userPrompt } from "./shared.js";

const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"] as const;

// ---------------------------------------------------------------------------
// table.classify — what the region IS
// ---------------------------------------------------------------------------

/**
 * `UNCERTAIN` was added when the catalogue contract asked every hook to be able
 * to abstain, and this one — the oldest — could not.
 *
 * It mattered more here than the omission looked. The item reaching this hook is
 * a region *two* scored classifier tiers already declined to name, so it is
 * ambiguous by selection; being unable to say so meant every one of them came
 * back as a confident LAYOUT or HYBRID. The pipeline's own guard caught the
 * expensive half of that — a fabricated DATA verdict — and nothing caught the
 * rest. An abstention keeps the deterministic `UNKNOWN`, which is a review item,
 * and a review item is the correct outcome for a genuinely ambiguous table.
 */
export const TableClassSchema = z.object({
  class: z.enum(["SHELL", "LAYOUT", "DATA", "HYBRID", "CATALOG", "UNCERTAIN"]),
  confidence: CONFIDENCE,
  rationale: RATIONALE,
});
export type TableClassReply = z.infer<typeof TableClassSchema>;

export interface TableClassifyContext {
  corpusFrequency?: number;
  crop?: ChatImage;
}

/**
 * `table.classify` — the hook that fixes the reported failure.
 *
 * Tiers 1 and 2 run first and abstain rather than guess; only the residual
 * reaches a model, and it arrives as a rendered crop plus a grid summary rather
 * than as forty kilobytes of nested `<td>`.
 */
export const tableClassifyHook: Hook<TableClassifyContext, TableGrid, TableClassReply> = {
  id: "table.classify",
  version: "4",
  schema: TableClassSchema,
  models: MODELS,
  escalateBelow: 0.6,
  maxOutputTokens: 512,

  get system() {
    return systemPrompt("table/classify-region");
  },

  // Tiers 1 and 2. Returning null is the escalation signal.
  deterministic(ctx, grid) {
    const features = extractFeatures(grid, ctx.corpusFrequency);
    const tier1 = classifyTier1(grid, features);
    if (tier1) return toReply(tier1);
    const tier2 = classifyTier2(features);
    return tier2.class === "UNKNOWN" ? null : toReply(tier2);
  },

  buildPayload(ctx, grid) {
    const features = extractFeatures(grid, ctx.corpusFrequency);
    const tier2 = classifyTier2(features);

    const firstRows: string[] = [];
    for (let r = 0; r < Math.min(grid.rows, 3); r += 1) {
      const cells = rowCells(grid, r).map((c) => {
        const marks = [c.isHeader ? "TH" : "", c.images > 0 ? `${c.images}img` : "", c.links > 0 ? `${c.links}link` : ""]
          .filter(Boolean)
          .join(",");
        return `[${marks}] ${quote(c.text, 40)}`;
      });
      firstRows.push(`  row ${r + 1}: ${cells.join(" | ")}`);
    }

    const text = userPrompt("table/classify-region", {
      rows: grid.rows,
      cols: grid.cols,
      originCells: grid.cells.length,
      nestedTables: features.nestedTables,
      isNested: features.isNested,
      rowspanCount: features.rowspanCount,
      colspanCount: features.colspanCount,
      gridFill: `${(features.gridRegularity * 100).toFixed(0)}%`,
      hasHeaderRow: features.hasHeaderRow,
      hasBorder: features.hasBorder,
      emptyRatio: `${(features.emptyRatio * 100).toFixed(0)}%`,
      maxTextLen: features.maxTextLen,
      avgTextLen: features.avgTextLen.toFixed(0),
      linkDensity: features.linkDensity.toFixed(2),
      imageDensity: features.imageDensity.toFixed(2),
      columnWidths:
        features.columnWidths.length > 0 ? features.columnWidths.map((w) => Math.round(w)).join(", ") : "",
      corpusFrequency:
        ctx.corpusFrequency !== undefined ? `${(ctx.corpusFrequency * 100).toFixed(0)}%` : "",
      caption: grid.captionText ? quote(grid.captionText) : "",
      firstRows: firstRows.join("\n"),
      abstentionReason: tier2.reason,
      scores: Object.entries(tier2.scores ?? {})
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(" "),
    });

    return { text, ...(ctx.crop ? { images: [ctx.crop] } : {}) };
  },

  validate(out) {
    const issues: string[] = [];
    if (out.confidence > 0.99 && out.rationale.length < 20) {
      issues.push("near-certain verdict with no rationale; state the evidence");
    }
    return issues;
  },
};

function toReply(classification: Classification): TableClassReply {
  return {
    class: classification.class === "UNKNOWN" ? "LAYOUT" : classification.class,
    confidence: classification.confidence,
    rationale: classification.reason,
  };
}

/**
 * Convert a hook reply back into the pipeline's classification shape.
 *
 * An abstention returns null rather than an `UNKNOWN` classification: the
 * caller's contract is that null means "the deterministic answer stands", and
 * the deterministic answer here already *is* `UNKNOWN`. Handing back a
 * differently-worded copy of it would replace a rule's verdict with a model's
 * agreement, and the ledger would then record an escalation as having resolved
 * something.
 */
export function replyToClassification(reply: TableClassReply, tier: 1 | 2 | 3 | 4): Classification | null {
  if (reply.class === "UNCERTAIN") return null;
  return {
    class: reply.class,
    confidence: reply.confidence,
    tier,
    reason: trimRationale(reply.rationale),
  };
}

// ---------------------------------------------------------------------------
// table.records — column labels for a headerless record matrix
// ---------------------------------------------------------------------------

export const TableHeaderSchema = z.object({
  headers: z.array(z.string().min(1).max(60)),
  confidence: CONFIDENCE,
  rationale: RATIONALE,
});
export type TableHeaderReply = z.infer<typeof TableHeaderSchema>;

export interface TableHeaderContext {
  /** Semantic column count the deterministic planner settled on. */
  columns: number;
  /** Rendered summary of the planned matrix. */
  planSummary: string;
  /** Document language, so the labels match the rest of the page. */
  lang: string;
  caption?: string;
  /** Nearest preceding heading, which usually names the section. */
  precedingHeading?: string;
}

/**
 * `table.records` — the second half of the table fix.
 *
 * The physical→semantic reconstruction is deterministic and stays that way; what
 * a rule cannot supply is a *name* for a column the source never named. §3.8
 * requires one and §16.3 forbids the converter from inventing it, so this is a
 * genuine escalation rather than a convenience — and it is the catalogue's only
 * hook licensed to produce text the source never carried.
 *
 * There is deliberately no `deterministic()`: by the time an item is built, the
 * emitter has already tried the only honest rule — reuse a label the column
 * itself repeats — and failed.
 */
export const tableHeaderHook: Hook<TableHeaderContext, { rows: string }, TableHeaderReply> = {
  id: "table.records",
  version: "3",
  schema: TableHeaderSchema,
  models: MODELS,
  escalateBelow: 0.5,
  maxOutputTokens: 400,

  get system() {
    return systemPrompt("table/synthesize-column-labels");
  },

  buildPayload(ctx, item) {
    return {
      text: userPrompt("table/synthesize-column-labels", {
        lang: ctx.lang,
        columns: ctx.columns,
        caption: ctx.caption ? quote(ctx.caption) : "",
        precedingHeading: ctx.precedingHeading ? quote(ctx.precedingHeading) : "",
        planSummary: ctx.planSummary,
        rows: item.rows,
      }),
    };
  },

  validate(out, ctx) {
    const issues: string[] = [];
    if (out.headers.length !== ctx.columns) {
      issues.push(`expected ${ctx.columns} labels, received ${out.headers.length}`);
    }
    for (const header of out.headers) {
      if (/^(?:поле|столбец|колонка|column|field|col)\s*\d*$/iu.test(header.trim())) {
        issues.push(`${JSON.stringify(header)} is a placeholder, not a meaning (§3.8)`);
      }
    }
    const seen = new Set(out.headers.map((h) => h.trim().toLowerCase()));
    if (seen.size !== out.headers.length) issues.push("column labels must be distinct");
    return issues;
  },
};

