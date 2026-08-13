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
