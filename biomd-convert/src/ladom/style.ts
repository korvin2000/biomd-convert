/**
 * Computed-style folding.
 *
 * One place, because the alternative is what the corpus already demonstrated:
 * four sites reading `text-align`, two of them folding Chromium's vendor forms
 * and two comparing with `=== "center"`. `CLAUDE.md` §4 records that split as a
 * live inconsistency rather than a style preference, and an inconsistency in
 * *reading the evidence* is indistinguishable, from the outside, from a rule
 * that does not exist.
 *
 * This lives in `ladom` rather than in `convert-core` or `l3` because both
 * halves need it and neither may import the other. It is a fact about what a
 * browser returns, not a judgement about a document, so sharing it costs no
 * independence: nothing here decides anything, it only spells one value one way.
 */

/** Physical horizontal alignment, after every vendor and logical form is folded. */
export type PhysicalAlign = "left" | "center" | "right" | "justify" | null;

/**
 * Fold a computed `text-align` to a physical keyword.
 *
 * The vendor forms carry the weight. Chromium returns `-webkit-center` for an
 * element centred by an *ancestor's* `align` attribute — `<div align="center">`
 * around a `<p>` — which is the single commonest centring idiom in a 1998
 * FrontPage page and precisely the case an exact keyword comparison misses.
 * `start` / `end` are the logical forms; this corpus is left-to-right and
 * `Biography-Markup.md` §13 states `left`/`right` are physical, with logical
 * values deferred to a later revision.
 *
 * Returns `null` for anything that is not evidence — `auto`, `match-parent`,
 * an empty string, an unmeasured node — rather than guessing at a default. A
 * caller can then tell "measured as left" from "never measured", which a
 * defaulted value would erase.
 */
export function foldTextAlign(value: string | undefined | null): PhysicalAlign {
  if (value === undefined || value === null) return null;
  const v = value.trim().toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/u, "");
  switch (v) {
    case "center":
    case "centre":
      return "center";
    case "right":
    case "end":
      return "right";
    case "left":
    case "start":
      return "left";
    case "justify":
    case "justify-all":
      return "justify";
    default:
      return null;
  }
}

/**
 * Whether a computed `text-align` centres its content.
 *
 * The predicate the outline and alignment detectors actually want, named so
 * that a future site cannot reintroduce the `=== "center"` bug by accident.
 */
export function isCenteredAlign(value: string | undefined | null): boolean {
  return foldTextAlign(value) === "center";
}

/**
 * The alignment of a page's ordinary prose — the baseline everything else is
 * judged against.
 *
 * "Ordinary prose" is decided by text length, not by tag or class: a block long
 * enough to wrap is body text whatever it is called, and a short block is a
 * label, caption or heading whose alignment is exactly what a caller is trying
 * to measure and therefore must not be allowed to define the baseline.
 *
 * Weighted by text length rather than counted, because a page with forty short
 * centred captions and six long justified paragraphs is a justified page.
 * `justify` and `left` are deliberately *not* merged here: they are different
 * keywords, and folding them together belongs in {@link isDistinctiveAlign},
 * which is the function that asks the comparative question.
 *
 * This is the recurrence evidence for every alignment rule in the project. A
 * single block's keyword says nothing on its own — `align="center"` lies often
 * enough that `CLAUDE.md` §4 records it as a corpus fact. What does not lie is
 * the same block being aligned differently from the mass of text around it, and
 * "the mass of text around it" is precisely what this returns.
 */
export function proseAlign(
  blocks: ReadonlyArray<{ align: PhysicalAlign; textLength: number }>,
  minProseLength = 120,
): PhysicalAlign {
  const weight = new Map<PhysicalAlign, number>();
  for (const b of blocks) {
    if (b.textLength < minProseLength) continue;
    if (b.align === null) continue;
    weight.set(b.align, (weight.get(b.align) ?? 0) + b.textLength);
  }
  if (weight.size === 0) return null;
  // Ties resolve by the fixed order below rather than by insertion order, so the
  // result does not depend on document order. Determinism is a contract: this
  // value decides emitted directives and must be identical across runs.
  const order: PhysicalAlign[] = ["left", "justify", "center", "right"];
  let best: PhysicalAlign = null;
  let bestWeight = -1;
  for (const candidate of order) {
    const w = weight.get(candidate) ?? 0;
    if (w > bestWeight) {
      best = candidate;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * Whether a block's alignment says anything the page does not already say.
 *
 * `left` and `justify` are both "the default reading flow" for this purpose: a
 * justified page does not make its left-aligned blocks distinctive, and vice
 * versa. `center` and `right` are distinctive against either.
 *
 * When the page's own baseline is unknown — nothing was measured, or the page
 * has no prose long enough to count — `center` and `right` are still treated as
 * distinctive, because they are the two values a 1998 author had to ask for
 * explicitly. That is a fallback, not the rule: a caller that can supply a real
 * baseline gets a strictly better answer.
 */
export function isDistinctiveAlign(align: PhysicalAlign, prose: PhysicalAlign): boolean {
  if (align === null) return false;
  const flow = (a: PhysicalAlign) => (a === "justify" ? "left" : a);
  if (prose === null) return align === "center" || align === "right";
  return flow(align) !== flow(prose);
}
