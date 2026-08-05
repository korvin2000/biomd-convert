/** Console rendering of an evaluation run. Kept apart from scoring so the score is testable. */
import type { DocumentScore } from "./score.js";

const COLUMNS: Array<{ head: string; of: (d: DocumentScore) => number }> = [
  { head: "text", of: (d) => d.text.f1 },
  { head: "head", of: (d) => d.headings.f1 },
  { head: "link", of: (d) => d.links.f1 },
  { head: "img", of: (d) => d.images.f1 },
  { head: "dirs", of: (d) => d.directives.f1 },
  { head: "cells", of: (d) => d.tableCells.f1 },
  { head: "shape", of: (d) => d.tableShape },
];

export function renderReport(documents: readonly DocumentScore[], overall: number, verbose = false): string {
  const nameWidth = Math.max(4, ...documents.map((d) => d.name.length));
  const lines: string[] = [];

  lines.push(
    `${"file".padEnd(nameWidth)}  ${COLUMNS.map((c) => c.head.padStart(5)).join("  ")}  ${"tables".padStart(9)}  score`,
  );
  lines.push("-".repeat(nameWidth + COLUMNS.length * 7 + 11 + 8));

  for (const d of documents) {
    const cells = COLUMNS.map((c) => pct(c.of(d)).padStart(5)).join("  ");
    const tables = `${d.actualTables.length}/${d.expectedTables.length}`.padStart(9);
    lines.push(`${d.name.padEnd(nameWidth)}  ${cells}  ${tables}  ${pct(d.overall).padStart(5)}`);
  }

  lines.push("");
  lines.push(`overall similarity to fixtures/out: ${pct(overall)}`);

  if (verbose) {
    for (const d of documents) {
      const notes: string[] = [];
      if (d.tableCells.missing.length > 0) notes.push(`  missing table cells: ${preview(d.tableCells.missing)}`);
      if (d.links.missing.length > 0) notes.push(`  missing links: ${preview(d.links.missing)}`);
      if (d.headings.missing.length > 0) {
        notes.push(`  missing headings: ${preview(d.headings.missing.map((h) => h.replace("\t", "→")))}`);
      }
      if (d.directives.missing.length > 0) notes.push(`  missing directives: ${preview(d.directives.missing)}`);
      if (d.text.missing.length > 0) notes.push(`  missing text: ${preview(d.text.missing)}`);
      if (notes.length > 0) {
        lines.push("", `${d.name}  (${pct(d.overall)})`, ...notes);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}`;
}

function preview(items: readonly string[]): string {
  const head = items.slice(0, 4).map((i) => JSON.stringify(i.length > 48 ? `${i.slice(0, 48)}…` : i));
  return items.length > 4 ? `${head.join(", ")} (+${items.length - 4})` : head.join(", ");
}
