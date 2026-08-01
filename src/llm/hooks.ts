/**
 * The hook catalogue.
 *
 * Each entry has a deterministic default that carries the majority of the
 * corpus, and escalates only in the genuine uncertainty band. The payloads are
 * compact by construction — a grid summary and a crop, never raw markup — which
 * is what makes the model's attention affordable.
 */
import { z } from "zod";
import type { Hook } from "./hook.js";
import type { TableGrid } from "../ladom/grid.js";
import { rowCells } from "../ladom/grid.js";
import { type Classification, classifyTier1, classifyTier2, extractFeatures } from "../convert-core/classify.js";
import type { ChatImage } from "./transport.js";

export const TableClassSchema = z.object({
  class: z.enum(["SHELL", "LAYOUT", "DATA", "HYBRID", "CATALOG"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
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
  version: "1",
  schema: TableClassSchema,
  models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
  escalateBelow: 0.6,
  maxOutputTokens: 512,

  system: [
    "You classify a table from a 1998-2010 encyclopedia page that is being migrated to a semantic",
    "document format. Decide what the table IS, not what it should become.",
    "",
    "SHELL   — repeated page furniture: header, footer, nav, background scaffolding.",
    "LAYOUT  — position is the only relationship. Cells hold unrelated blocks placed side by side.",
    "DATA    — cells form a record matrix: rows are comparable records, columns have stable meaning.",
    "HYBRID  — genuine records mixed with layout, covers, or nested arrangement.",
    "CATALOG — a repeated two-lane grid of items, each lane carrying an image and a list.",
    "",
    "Border presence alone decides nothing, and neither does its absence.",
    "A table whose cells need lists, several paragraphs, or block images is HYBRID, never DATA:",
    "the target format's table cells are inline-only.",
    "Report the confidence you actually have. Low confidence routes to human review, which is the",
    "correct outcome for a genuinely ambiguous table.",
  ].join("\n"),

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

    const lines: string[] = [
      `Grid: ${grid.rows} rows × ${grid.cols} columns, ${grid.cells.length} origin cells.`,
      `Nested tables: ${features.nestedTables}. Nested inside another table: ${features.isNested}.`,
      `Spans: ${features.rowspanCount} rowspan, ${features.colspanCount} colspan. ` +
        `Grid fill: ${(features.gridRegularity * 100).toFixed(0)}%.`,
      `Header row present: ${features.hasHeaderRow}. Border: ${features.hasBorder}.`,
      `Empty cells: ${(features.emptyRatio * 100).toFixed(0)}%. ` +
        `Longest cell: ${features.maxTextLen} chars. Mean: ${features.avgTextLen.toFixed(0)}.`,
      `Links per cell: ${features.linkDensity.toFixed(2)}. Images per cell: ${features.imageDensity.toFixed(2)}.`,
    ];

    if (features.columnWidths.length > 0) {
      lines.push(`Measured column widths (px): ${features.columnWidths.map((w) => Math.round(w)).join(", ")}.`);
    } else {
      lines.push("Column widths: NOT MEASURED — the page was not rendered, so treat layout cues as weak.");
    }
    if (ctx.corpusFrequency !== undefined) {
      lines.push(`This structure appears on ${(ctx.corpusFrequency * 100).toFixed(0)}% of corpus pages.`);
    }
    if (grid.captionText) lines.push(`Caption: ${JSON.stringify(grid.captionText)}.`);

    lines.push("", "First rows, cell contents truncated:");
    for (let r = 0; r < Math.min(grid.rows, 3); r += 1) {
      const cells = rowCells(grid, r).map((c) => {
        const text = c.text.length > 40 ? `${c.text.slice(0, 40)}…` : c.text;
        const marks = [c.isHeader ? "TH" : "", c.images > 0 ? `${c.images}img` : "", c.links > 0 ? `${c.links}link` : ""]
          .filter(Boolean)
          .join(",");
        return `[${marks}] ${JSON.stringify(text)}`;
      });
      lines.push(`  row ${r + 1}: ${cells.join(" | ")}`);
    }

    lines.push(
      "",
      `Scored classifier abstained: ${tier2.reason}.`,
      "Scores: " +
        Object.entries(tier2.scores ?? {})
          .map(([k, v]) => `${k}=${v.toFixed(2)}`)
          .join(" "),
    );

    return { text: lines.join("\n"), ...(ctx.crop ? { images: [ctx.crop] } : {}) };
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

/** Convert a hook reply back into the pipeline's classification shape. */
export function replyToClassification(reply: TableClassReply, tier: 1 | 2 | 3 | 4): Classification {
  return { class: reply.class, confidence: reply.confidence, tier, reason: reply.rationale };
}

// ---------------------------------------------------------------------------
// table.records — column labels for a headerless record matrix
// ---------------------------------------------------------------------------

export const TableHeaderSchema = z.object({
  headers: z.array(z.string().min(1).max(60)),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
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
 * genuine escalation rather than a convenience.
 *
 * There is deliberately no `deterministic()`: by the time an item is built, the
 * emitter has already tried the only honest rule — reuse a label the column
 * itself repeats — and failed.
 */
export const tableHeaderHook: Hook<TableHeaderContext, { rows: string }, TableHeaderReply> = {
  id: "table.records",
  version: "1",
  schema: TableHeaderSchema,
  models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
  escalateBelow: 0.5,
  maxOutputTokens: 400,

  system: [
    "A table from a 1998-2010 encyclopedia page is being migrated to a semantic document format.",
    "Its rows and columns have already been reconstructed correctly. The source table had no header",
    "row, and the target format requires a meaningful label for every column.",
    "",
    "Return exactly one short label per column, in left-to-right order.",
    "",
    "Rules:",
    "- name what the column CONTAINS, from the values you are shown;",
    "- write the labels in the language of the surrounding document;",
    "- 1-3 words each; no numbering, no 'Column 1', no punctuation at the end;",
    "- a column of resource links is named for the kind of resource, not for the link text;",
    "- if a column's content is genuinely unclear, still give the most defensible label and",
    "  lower the confidence, so the result routes to human review.",
  ].join("\n"),

  buildPayload(ctx, item) {
    const lines = [
      `Document language: ${ctx.lang}.`,
      `Columns to label: ${ctx.columns}.`,
    ];
    if (ctx.caption) lines.push(`Table caption: ${JSON.stringify(ctx.caption)}.`);
    if (ctx.precedingHeading) lines.push(`Nearest heading above the table: ${JSON.stringify(ctx.precedingHeading)}.`);
    lines.push("", ctx.planSummary, "", "Rows:", item.rows);
    return { text: lines.join("\n") };
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

export const BreakKindSchema = z.object({
  kinds: z.array(z.enum(["WRAP", "PARAGRAPH", "LINEATION", "SPACING"])),
  confidence: z.number().min(0).max(1),
});

/**
 * `text.segment` — classify a run of `<br>` breaks.
 *
 * Deliberately has no deterministic default here: the caller resolves the easy
 * cases from geometry before it ever constructs an item, so anything reaching
 * this hook is already the residual.
 */
export const textSegmentHook: Hook<{ context: string }, { breaks: string[] }, z.infer<typeof BreakKindSchema>> = {
  id: "text.segment",
  version: "1",
  schema: BreakKindSchema,
  models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
  maxOutputTokens: 512,
  system: [
    "Legacy pages used <br> for four different purposes. Classify each break in order:",
    "WRAP       — a manual line wrap inside one paragraph. Joins with a space.",
    "PARAGRAPH  — a real paragraph boundary.",
    "LINEATION  — meaningful line structure: verse, an address, a signature. Must be preserved.",
    "SPACING    — vertical padding with no textual meaning. Discarded.",
    "Return exactly one kind per break, in the order given.",
    "Verse and song lyrics are never joined.",
  ].join("\n"),
  buildPayload(ctx, item) {
    return {
      text: `Context:\n${ctx.context}\n\nBreaks to classify, in order:\n${item.breaks
        .map((b, i) => `${i + 1}. …${b}…`)
        .join("\n")}`,
    };
  },
  validate(out, _ctx, item) {
    return out.kinds.length === item.breaks.length
      ? []
      : [`expected ${item.breaks.length} verdicts, received ${out.kinds.length}`];
  },
};
