/**
 * `table.records` — a name for a column the source never named.
 *
 * The physical→semantic reconstruction is deterministic and stays that way;
 * what a rule cannot supply is a *name*. `BioMD-Reference.md` §1 requires a
 * header row and §16.3 forbids the converter from inventing one, so this is a
 * genuine escalation rather than a convenience: the only honest deterministic
 * rule — reuse a label the column itself repeats — has already been tried and
 * failed by the time an item is built.
 *
 * The three entry tests are met. **Abstention:** the emitter reaches this point
 * only with `headerSynthesized`, meaning it has no label at all. **Acceptance
 * check:** `TABLE_HEADERS.accept` requires one non-empty distinct label per
 * band, and the hook additionally refuses placeholder vocabulary. **Visible
 * failure:** a wrong column label is a heading a reader sees over a column
 * whose values contradict it.
 */
import { z } from "zod";
import { defineHook } from "../../kernel/contract.js";
import type { HookGateVerdict, HookInvocation } from "../../kernel/contract.js";
import type { TableGrid } from "../../../ladom/grid.js";
import { type LogicalTablePlan, cellText, describePlan } from "../../../convert-core/data-table.js";
import type { TableHeaderRequest } from "../../../convert-core/decisions.js";

export type TableHeaderInput = HookInvocation<TableHeaderRequest>;

const InputSchema = z.custom<TableHeaderInput>(
  (value) => {
    const input = value as TableHeaderInput | null;
    return (
      typeof input === "object" &&
      input !== null &&
      typeof input.request?.grid?.id === "string" &&
      Array.isArray(input.request?.plan?.bands) &&
      typeof input.context?.lang === "string"
    );
  },
  { message: "expected { request: { grid, plan, … }, context: { lang, … } }" },
);

export const TableHeaderSchema = z.object({
  headers: z.array(z.string().min(1).max(60)),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(4000),
});
export type TableHeaderReply = z.infer<typeof TableHeaderSchema>;

/**
 * Placeholder vocabulary, in the two languages this corpus mixes.
 *
 * Lexical data, not a detector literal: the list is a *rejection* vocabulary
 * that degrades gracefully — a placeholder it misses is still caught by the
 * distinctness and emptiness checks in `TABLE_HEADERS.accept`, and a language
 * it does not cover simply loses this one extra guard.
 */
const PLACEHOLDER = /^(?:поле|столбец|колонка|column|field|col)\s*\d*$/iu;

/**
 * Nothing to name, or nothing to name it from.
 *
 * A single-column plan needs no header vocabulary worth a request, and a plan
 * with no body rows offers the model no values to reason from — asking anyway
 * buys a guess at full price.
 */
function gate(input: TableHeaderInput): HookGateVerdict {
  const { plan } = input.request;
  const columns = plan.bands.length;
  if (columns < 2) return { call: false, reason: "fewer than two columns to label" };
  if (plan.body.length === 0) {
    return { call: false, reason: "no body rows — nothing to infer a column's meaning from" };
  }
  return { call: true, reason: `${columns} reconstructed columns and no source header row` };
}

export const hook = defineHook<TableHeaderInput, TableHeaderReply>({
  id: "table.records",
  title: "Missing column labels",
  summary: "Names the columns of a reconstructed record matrix whose source had no header row.",
  version: "3",
  stability: "stable",
  decisionPoint: "table.records",
  // No hook is on by default; see `plugins.test.ts`.
  enabledByDefault: false,
  moduleUrl: import.meta.url,
  input: InputSchema,
  output: TableHeaderSchema,
  templates: { system: "prompts/system.md", user: "prompts/user.md" },
  defaults: {
    tier: "fast",
    maxTier: "deep",
    escalateBelow: 0.5,
    maxOutputTokens: 400,
  },

  gate,

  render(input) {
    const { grid, plan } = input.request;
    const heading = precedingHeading(grid);
    return {
      vars: {
        lang: input.context.lang,
        columns: plan.bands.length,
        caption: grid.captionText ? JSON.stringify(grid.captionText) : undefined,
        precedingHeading: heading ? JSON.stringify(heading) : undefined,
        planSummary: describePlan(plan, 0),
        rows: sampleRows(plan),
      },
    };
  },

  validate(out, input) {
    const issues: string[] = [];
    const wanted = input.request.plan.bands.length;
    if (out.headers.length !== wanted) {
      issues.push(`expected ${wanted} labels, received ${out.headers.length}`);
    }
    for (const header of out.headers) {
      if (PLACEHOLDER.test(header.trim())) {
        issues.push(`${JSON.stringify(header)} is a placeholder, not a meaning`);
      }
    }
    const seen = new Set(out.headers.map((h) => h.trim().toLowerCase()));
    if (seen.size !== out.headers.length) issues.push("column labels must be distinct");
    return issues;
  },
});

/**
 * The nearest heading above the table, which usually names what it lists.
 *
 * Payload construction, so it belongs to the plugin: the compiler has no reason
 * to walk upward from a grid, and a different hook serving the same decision
 * point is free to build its payload from something else entirely.
 */
export function precedingHeading(grid: TableGrid): string | undefined {
  let node = grid.node.parent;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const siblings = node.children;
    for (let i = siblings.length - 1; i >= 0; i -= 1) {
      const sibling = siblings[i];
      if (!sibling || sibling.kind !== "element") continue;
      const marked = sibling.attrs["data-biomd-heading"];
      if (marked !== undefined || /^h[1-6]$/u.test(sibling.tag)) {
        const text = textContent(sibling);
        if (text) return text;
      }
    }
    node = node.parent;
  }
  return undefined;
}

function textContent(node: { children: Array<{ kind: string; value?: string; children: unknown[] }> }): string {
  let out = "";
  const visit = (n: { kind: string; value?: string; children: unknown[] }): void => {
    if (n.kind === "text") out += n.value ?? "";
    for (const child of n.children) visit(child as never);
  };
  visit(node as never);
  return out.replace(/\s+/gu, " ").trim().slice(0, 120);
}

/**
 * A sample of the planned matrix, not the whole thing.
 *
 * Naming a column needs a handful of representative values; a twenty-seven-row
 * discography adds nothing but tokens. Rows are taken from the head, middle and
 * tail so an irregular column is still visible.
 */
export function sampleRows(plan: LogicalTablePlan, limit = 8): string {
  const body = plan.body;
  const indices = new Set<number>();
  for (let i = 0; i < Math.min(limit, body.length); i += 1) {
    indices.add(Math.floor((i * (body.length - 1)) / Math.max(1, Math.min(limit, body.length) - 1)));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => {
      const row = body[i];
      if (!row) return "";
      return `  ${row.cells.map((c) => JSON.stringify(cellText(c, 48))).join(" | ")}`;
    })
    .filter(Boolean)
    .join("\n");
}
