/**
 * Constructs the reference tier does not use yet.
 *
 * `fixtures/out/` was written by hand before `::anchor{#id}` existed, so not one
 * of the 22 reference documents contains an anchor — including `goya2`, whose
 * `::: nav` links to `#1`…`#26` and whose reference therefore *needs* 26 of
 * them. Comparing the two sides naively would report every emitted marker as an
 * invention: 26 spurious directives on `goya2`, 2 each on `barrios` and
 * `new_dyens`, and a directive-axis precision drop that says the converter got
 * worse at the moment it started preserving targets it used to lose.
 *
 * This module is the declared, isolated exception that `CLAUDE.md`'s metric
 * integrity invariant requires such a fold to be — and it is written so that it
 * **retires itself**. The rule is per document and per construct: *if this
 * reference contains no anchor at all, ignore anchors on the produced side; if
 * it contains even one, compare them normally.* Nothing has to be remembered or
 * undone when the references gain anchors. The first reference to define one
 * turns full adjudication back on for that document, and only for that document.
 *
 * Two things it deliberately does **not** do:
 *  - it never hides a *difference* between two anchors that both sides declare;
 *  - it never touches any other axis. An anchor carries no text, no link and no
 *    image, so the text, links, images, headings and table axes are unaffected
 *    by construction — this only has to keep the directive inventory honest.
 */
import type { Block } from "./blocks.js";

/** Directive names the reference tier predates. One entry, and it should shrink. */
export const REFERENCE_SILENT_DIRECTIVES: readonly string[] = ["anchor"];

/**
 * The same policy for an inline mark: `==highlight==`.
 *
 * The second entry, added when the converter began marking the distinctions the
 * source draws inline. It qualifies for exactly the reasons the anchor did, and
 * fails none of the three tests above:
 *
 *  - **the reference tier predates it.** One reference uses `==` —
 *    `new_rechin4`, five spans — and that document is therefore adjudicated
 *    normally, in full, in both directions. The rest contain none at all.
 *  - **the author declared the difference a non-finding, by name.**
 *    `new_rules.md`: *"Если в reference файлах текст в кавычках не выделен
 *    `==`, считать что он выделен, игнорировать такие различия (т.е. не
 *    считать это нарушением. это улучшение визуала)"*.
 *  - **it hides an absence, never a disagreement.** The fold removes the two
 *    marks from **both** sides' text; where both sides mark the same run, the
 *    run still compares character for character, and where they mark
 *    *different* runs the surrounding text differs and the finding stands.
 *
 * It is self-retiring in the same way: the first reference to write a `==` for
 * a document turns full comparison back on for that document and nothing has to
 * be undone.
 *
 * Unlike the directive fold this one is textual, because the mark is inline and
 * lives inside a paragraph's characters rather than in the block inventory.
 */
const HIGHLIGHT_MARK = "==";

/** Whether this reference has anything to say about inline highlighting. */
export function highlightSilentIn(referenceSource: string): boolean {
  return !referenceSource.includes(HIGHLIGHT_MARK);
}

/**
 * Both sides with the highlight marks removed, or both unchanged.
 *
 * Returned as a pair for the reason {@link foldSilentDirectives} is: applying a
 * fold to one side and forgetting the other is the instrument tuning the
 * invariant forbids, and a signature that cannot express it prevents it.
 */
export function foldSilentHighlights(
  produced: string,
  reference: string,
): { produced: string; reference: string } {
  if (!highlightSilentIn(reference)) return { produced, reference };
  return { produced: stripHighlights(produced), reference: stripHighlights(reference) };
}

function stripHighlights(source: string): string {
  return source.split(HIGHLIGHT_MARK).join("");
}

/**
 * Which silent constructs this reference has nothing to say about.
 *
 * A name is returned only when the reference document uses it **nowhere**, at
 * any depth. One occurrence is enough to make the reference an authority on it.
 */
export function silentIn(reference: readonly Block[]): Set<string> {
  const silent = new Set(REFERENCE_SILENT_DIRECTIVES);
  for (const name of collectDirectiveNames(reference)) silent.delete(name);
  return silent;
}

/** Remove every directive whose name is in `names`, at any depth. */
export function dropDirectives(blocks: readonly Block[], names: ReadonlySet<string>): Block[] {
  if (names.size === 0) return [...blocks];
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "directive" && names.has(block.name)) continue;
    if (block.kind === "directive") out.push({ ...block, children: dropDirectives(block.children, names) });
    else if (block.kind === "quote") out.push({ ...block, children: dropDirectives(block.children, names) });
    else out.push(block);
  }
  return out;
}

/**
 * The same rule over the flat directive inventory `score.ts` compares.
 *
 * Returns both multisets, so the caller cannot apply the fold to one side and
 * forget the other — the asymmetric version of this is exactly the instrument
 * tuning the invariant forbids.
 */
export function foldSilentDirectives(
  expected: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): { expected: string[]; actual: string[] } {
  const silent = new Set(REFERENCE_SILENT_DIRECTIVES.filter((name) => (expected.get(name) ?? 0) === 0));
  return { expected: flatten(expected, silent), actual: flatten(actual, silent) };
}

function flatten(counts: ReadonlyMap<string, number>, skip: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [name, n] of counts) {
    if (skip.has(name)) continue;
    for (let i = 0; i < n; i += 1) out.push(name);
  }
  return out;
}

function collectDirectiveNames(blocks: readonly Block[], out: Set<string> = new Set()): Set<string> {
  for (const block of blocks) {
    if (block.kind === "directive") {
      out.add(block.name);
      collectDirectiveNames(block.children, out);
    } else if (block.kind === "quote") {
      collectDirectiveNames(block.children, out);
    }
  }
  return out;
}
