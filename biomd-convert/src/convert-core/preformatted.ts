/**
 * Preformatted blocks — the one place where source whitespace *is* the content.
 *
 * Everywhere else in this pipeline a run of spaces, tabs and newlines collapses
 * to one space, which is why `lines.ts` has to read an author's indent off
 * `&nbsp;` runs: in normal flow those are the only spaces a renderer keeps. A
 * `<pre>` inverts that model completely. Its line breaks are lines, its leading
 * spaces are columns, and `BioMD-Reference.md`'s block table says the mapping
 * must "preserve real `<code>/<pre>` content".
 *
 * The converter did not. `case "pre"` reached for the collapsing `textOf`, so
 * every preformatted block arrived as one long line: six poems on a page were
 * emitted as six paragraph-shaped strings inside ``` fences. No word was lost,
 * so text recall, the validator and the conservation ledger all reported the
 * document clean — the only thing destroyed was the line structure, and nothing
 * in the ladder measures that.
 *
 * Two shapes have to be told apart inside the block, and only one of them is a
 * line the author chose:
 *
 *   - **a line** — the poem's own lineation, at the block's left edge;
 *   - **a wrap** — the remainder of a line too long for a fixed-width column,
 *     pushed onto the next display row and indented so it does not read as a
 *     new verse. That indent is the 1998 typist's line-fitting, exactly like
 *     the wrap hyphen of PROGRESS §50, and joining it back is undoing layout,
 *     not editing text.
 */
import { type LadomNode, rawTextOf } from "../ladom/types.js";
import { isWrapBreak } from "./lines.js";

/** Column width of a tab stop. The 1998 tools that wrote these files assumed 8. */
const TAB_STOP = 8;

/** A blank line, and everything a renderer treats as horizontal space. */
const SPACE = /[ \t  - 　]/u;

export interface PreLine {
  /** The line's text, with its leading indent removed. */
  text: string;
  /** How far the line was pushed in, in columns, from the block's left edge. */
  indent: number;
}

/**
 * The lines of a preformatted block, with layout wrapping undone.
 *
 * Returns `[]` when the block holds nothing but spacing — the `<pre>&nbsp;</pre>`
 * a FrontPage author used to reserve a row of vertical space is a spacer, and
 * an empty ``` fence is a block that claims content it does not have.
 *
 * ## Rule contract
 *
 * **Invariant.** Whitespace only. The block's own left edge is its smallest
 * indent, so the rule reads *relative* depth and never a column number; the
 * decision to join is `isWrapBreak`'s, the same predicate that classifies a
 * `<br>`, so a `<pre>` and a `<br>` run answer the question the same way. No
 * class, id, filename, tag name, length threshold or word list is consulted.
 *
 * **Recurrence is deliberately *not* required, and its inverse is.** A wrap is
 * a per-line accident, so demanding that it repeat would be wrong. What must
 * hold instead is that the indent is the **exception**: indented lines stay a
 * minority of the block. That is the same relational evidence `isWrapBreak`
 * already documents — "their indent is the exception against unindented
 * siblings" — and it is what separates a wrapped poem from a block whose
 * indentation is its structure.
 *
 * **False friends**, each tested for non-firing:
 *   - **verse at the left edge.** Долматовский's romance runs 23 lines, most
 *     ending in a comma, none indented. Every one of them satisfies
 *     `isWrapBreak`'s punctuation test and not one may be joined — the indent
 *     requirement is the whole defence, and `groupIsLineated`'s average-length
 *     test, which guards the `<br>` path, would have refused these anyway.
 *   - **indentation that is the structure.** A listing, an ASCII table or a
 *     stepped poem indents most of its lines; the minority test declines the
 *     whole block rather than any single line of it.
 *   - **a deliberate new line that happens to be indented.** `isWrapBreak`
 *     still has to see a sentence in flight: terminal punctuation on the left,
 *     or a capital, digit or dash opening the right, and the block keeps both
 *     lines.
 *   - **a spacer.** A block of nothing but spaces, tabs or `&nbsp;` produces no
 *     block at all instead of an empty fence.
 */
export function preformattedLines(el: LadomNode): PreLine[] {
  const measured = measureLines(rawTextOf(el));
  if (measured.length === 0) return [];
  return joinWraps(measured);
}

/** Convenience for the caller: the block's text, or `null` when it is a spacer. */
export function preformattedText(el: LadomNode): string | null {
  const lines = preformattedLines(el);
  if (lines.length === 0) return null;
  return lines.map((line) => " ".repeat(line.indent) + line.text).join("\n");
}

/**
 * Raw preformatted text reduced to lines measured from the block's left edge.
 *
 * Leading and trailing blank lines are the markup's, not the author's — a
 * `<pre>` almost always opens on the newline that follows the tag — and a run
 * of blank lines inside is one blank line, which is the same reading `lines.ts`
 * gives two or more consecutive `<br>`.
 */
function measureLines(raw: string): PreLine[] {
  const rows = raw.split(/\r\n|\r|\n/u).map((row) => expandTabs(row).replace(/[\s ]+$/u, ""));

  let left = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row === "") continue;
    left = Math.min(left, indentOf(row));
  }
  if (!Number.isFinite(left)) return [];

  const out: PreLine[] = [];
  for (const row of rows) {
    if (row === "") {
      // Never open with a blank line, and never draw two in a row.
      if (out.length > 0 && out[out.length - 1]?.text !== "") out.push({ text: "", indent: 0 });
      continue;
    }
    out.push({ text: row.slice(indentOf(row)), indent: indentOf(row) - left });
  }
  while (out.length > 0 && out[out.length - 1]?.text === "") out.pop();
  return out;
}

/**
 * Fold every indented continuation into the line it continues.
 *
 * The minority test is asked of the block as a whole *before* any line is
 * folded, so a block whose indentation is its structure is declined entire and
 * no partial fold can leave it half-rewritten.
 */
function joinWraps(lines: readonly PreLine[]): PreLine[] {
  const body = lines.filter((line) => line.text !== "");
  const indented = body.filter((line) => line.indent > 0).length;
  if (indented === 0 || indented * 2 >= body.length) return [...lines];

  const out: PreLine[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.text !== "" &&
      line.text !== "" &&
      line.indent > previous.indent &&
      isWrapBreak(previous.text, line.text, [previous.indent, line.indent])
    ) {
      previous.text = `${previous.text} ${line.text}`;
      continue;
    }
    out.push({ ...line });
  }
  return out;
}

/** Columns before the first non-space character, with tabs advanced to the next stop. */
function indentOf(row: string): number {
  let column = 0;
  for (const ch of row) {
    if (!SPACE.test(ch)) break;
    column += 1;
  }
  return column;
}

/**
 * Replace tabs with the spaces they stand for.
 *
 * A tab's width is a property of whoever renders the file, and the indent this
 * module reads has to mean the same thing on both sides of a comparison. Fixing
 * it at the era's stop keeps the column the author saw and makes the block's
 * left edge measurable.
 */
function expandTabs(row: string): string {
  let out = "";
  for (const ch of row) {
    if (ch !== "\t") {
      out += ch;
      continue;
    }
    out += " ".repeat(TAB_STOP - (out.length % TAB_STOP));
  }
  return out;
}
