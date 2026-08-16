/**
 * `table.classify` — what kind of region an ambiguous table is.
 *
 * The deterministic classifier has two tiers and both abstain rather than
 * guess; only the residual reaches this hook. It arrives as a grid summary and
 * an optional rendered crop, never as forty kilobytes of nested `<td>`, which
 * is what makes the model's attention affordable.
 *
 * The verdict is a *name*, and the compiler decides what to do with it:
 * `TABLE_CLASSIFY.accept` in `convert-core/decisions.ts` refuses a DATA
 * promotion that the region's own geometry does not support, so the worst this
 * hook can do is leave an abstention unresolved.
 */
import { z } from "zod";
import { defineHook } from "../../kernel/contract.js";
import type { HookGateVerdict, HookInvocation } from "../../kernel/contract.js";
import { rowCells } from "../../../ladom/grid.js";
import { classifyTier2, extractFeatures } from "../../../convert-core/classify.js";
import type { TableClassifyRequest } from "../../../convert-core/decisions.js";

/**
 * What the escalation site hands over — its own request type, unadapted.
 *
 * A `TableGrid` carries LADOM nodes with parent links, so the input is
 * validated structurally rather than parsed: cloning a cyclic object through a
 * schema would be both expensive and wrong.
 */
export type TableClassifyInput = HookInvocation<TableClassifyRequest>;

const InputSchema = z.custom<TableClassifyInput>(
  (value) => {
    const input = value as TableClassifyInput | null;
    return (
      typeof input === "object" &&
      input !== null &&
      typeof input.request?.grid?.id === "string" &&
      typeof input.context?.lang === "string"
    );
  },
  { message: "expected { request: { grid: TableGrid, … }, context: { lang, … } }" },
);

export const TableClassSchema = z.object({
  class: z.enum(["SHELL", "LAYOUT", "DATA", "HYBRID", "CATALOG", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(4000),
});
export type TableClassReply = z.infer<typeof TableClassSchema>;

/**
 * The cheapest possible region is not worth a request.
 *
 * A one-cell grid has no matrix to recognise and no lanes to separate; whatever
 * the deterministic tiers made of it, a model looking at the same one cell adds
 * nothing. Everything wider is genuinely ambiguous by the time it arrives here,
 * because the tiers only abstain when their own evidence ran out.
 */
function gate(input: TableClassifyInput): HookGateVerdict {
  const { grid } = input.request;
  if (grid.rows * grid.cols <= 1) {
    return { call: false, reason: "single-cell region — no structure to classify" };
  }
  if (grid.cells.length === 0) {
    return { call: false, reason: "region has no cells" };
  }
  return {
    call: true,
    reason: `deterministic tiers abstained on a ${grid.rows}×${grid.cols} region`,
  };
}

export const hook = defineHook<TableClassifyInput, TableClassReply>({
  id: "table.classify",
  title: "Ambiguous table region",
  summary: "Names a table region the two deterministic classifier tiers both abstained on.",
  version: "3",
  stability: "stable",
  decisionPoint: "table.classify",
  // No hook is on by default, this one included — the grandfather clause was
  // withdrawn. `--llm assist` names its hooks or does nothing; see
  // `plugins.test.ts`, which pins the default set empty.
  enabledByDefault: false,
  requires: { vision: true },
  moduleUrl: import.meta.url,
  input: InputSchema,
  output: TableClassSchema,
  templates: { system: "prompts/system.md", user: "prompts/user.md" },
  defaults: {
    tier: "fast",
    maxTier: "deep",
    escalateBelow: 0.6,
    maxOutputTokens: 512,
  },

  gate,

  render(input) {
    const { grid, corpusFrequency, crop } = input.request;
    const features = extractFeatures(grid, corpusFrequency);
    const tier2 = classifyTier2(features);

    const firstRows: string[] = [];
    for (let r = 0; r < Math.min(grid.rows, 3); r += 1) {
      const cells = rowCells(grid, r).map((c) => {
        const text = c.text.length > 40 ? `${c.text.slice(0, 40)}…` : c.text;
        const marks = [c.isHeader ? "TH" : "", c.images > 0 ? `${c.images}img` : "", c.links > 0 ? `${c.links}link` : ""]
          .filter(Boolean)
          .join(",");
        return `[${marks}] ${JSON.stringify(text)}`;
      });
      firstRows.push(`  row ${r + 1}: ${cells.join(" | ")}`);
    }

    return {
      vars: {
        rows: grid.rows,
        cols: grid.cols,
        originCells: grid.cells.length,
        nestedTables: features.nestedTables,
        isNested: features.isNested,
        rowspanCount: features.rowspanCount,
        colspanCount: features.colspanCount,
        gridRegularity: `${(features.gridRegularity * 100).toFixed(0)}%`,
        hasHeaderRow: features.hasHeaderRow,
        hasBorder: features.hasBorder,
        emptyRatio: `${(features.emptyRatio * 100).toFixed(0)}%`,
        maxTextLen: features.maxTextLen,
        avgTextLen: features.avgTextLen.toFixed(0),
        linkDensity: features.linkDensity.toFixed(2),
        imageDensity: features.imageDensity.toFixed(2),
        columnWidths:
          features.columnWidths.length > 0
            ? features.columnWidths.map((w) => Math.round(w)).join(", ")
            : undefined,
        corpusFrequency: corpusFrequency === undefined ? undefined : `${(corpusFrequency * 100).toFixed(0)}%`,
        caption: grid.captionText ? JSON.stringify(grid.captionText) : undefined,
        firstRows: firstRows.join("\n"),
        abstentionReason: tier2.reason,
        scores: Object.entries(tier2.scores ?? {})
          .map(([k, v]) => `${k}=${v.toFixed(2)}`)
          .join(" "),
      },
      ...(crop ? { images: [crop] } : {}),
    };
  },

  validate(out) {
    const issues: string[] = [];
    if (out.confidence > 0.99 && out.rationale.length < 20) {
      issues.push("near-certain verdict with no rationale; state the evidence");
    }
    return issues;
  },
});
