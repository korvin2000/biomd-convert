/**
 * L3 — the geometric vocabulary.
 *
 * Pure functions over boxes and computed styles, with no browser and no I/O, so
 * every rule the rendered adjudicator applies is unit-testable without Chromium
 * and identical on both sides of a comparison.
 *
 * Two corpus facts recorded in `CLAUDE.md` §4 shape everything here, and both
 * are the reason an `=== "center"` test is not good enough:
 *
 *  - **presentational attributes lie.** `align="center"` on `p.t8` under
 *    `.t8 { text-align: Justify }` renders justified. Only the *computed* value
 *    is evidence.
 *  - **the computed value is not always the keyword you expect.** Chromium
 *    returns `-webkit-center` / `-webkit-left` / `-webkit-right` for elements
 *    centred by an ancestor's `align` attribute, and `start` / `end` for the
 *    logical keywords. An exact keyword comparison under-detects.
 *
 * And one design law from §5: alignment is judged **relative to the page's own
 * prose alignment**, never against an absolute keyword. A page whose body text
 * is centred throughout has no centred *blocks* — it has a centred page, and
 * wrapping every paragraph in `::: align` would be exactly the "recreate the
 * margins" misuse §13 forbids.
 */
import { type PhysicalAlign, isDistinctiveAlign, proseAlign } from "../ladom/style.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Physical horizontal alignment, after every vendor and logical form is folded. */
export type Alignment = "left" | "center" | "right" | "justify" | "unknown";

/** How an alignment verdict was reached — kept so a finding can cite its evidence. */
export type AlignEvidence = "keyword" | "box" | "keyword+box" | "none";

export interface AlignmentVerdict {
  alignment: Alignment;
  evidence: AlignEvidence;
  /**
   * True when this block's alignment differs from the alignment of the page's
   * ordinary prose. Only a `true` here is evidence that alignment carries
   * meaning; an absolute `center` on a wholly centred page carries none.
   */
  distinctive: boolean;
}

/**
 * Fold a computed `text-align` to a physical keyword.
 *
 * The vendor forms are the load-bearing part. `-webkit-center` is what Chromium
 * computes for a `<p>` inside `<div align="center">` — the single commonest
 * centring idiom in a 1998 FrontPage page, and the exact case an `=== "center"`
 * comparison misses.
 *
 * Direction is assumed left-to-right: this corpus is Russian and Latin, and
 * `Biography-Markup.md` §13 states `left`/`right` are physical values with
 * logical `start`/`end` deferred to a later revision.
 */
export function normalizeTextAlign(value: string | undefined | null): Alignment {
  if (value === undefined || value === null) return "unknown";
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
    // `auto`, `match-parent`, `-webkit-match-parent`, `""` and anything a future
    // engine invents: not evidence, and deliberately not guessed at.
    default:
      return "unknown";
  }
}

/**
 * Alignment implied by where a box sits inside its container.
 *
 * A block that shrink-wraps its content — a centred `<table>`, an image, a
 * `<div>` with `margin: 0 auto` — carries its alignment in its *position*, not
 * in a `text-align` keyword, and a keyword-only reader sees nothing at all.
 *
 * Returns `unknown` rather than guessing when the box fills its container
 * (there is no room for the position to mean anything) or when either box has
 * no width.
 */
export function boxAlignment(box: Box, container: Box, tolerance = 4): Alignment {
  if (!(box.w > 0) || !(container.w > 0)) return "unknown";
  const slack = container.w - box.w;
  // Filling the container: position carries no information.
  if (slack <= tolerance * 2) return "unknown";

  const leftGap = box.x - container.x;
  const rightGap = container.x + container.w - (box.x + box.w);
  if (Math.abs(leftGap - rightGap) <= tolerance) return "center";
  if (leftGap <= tolerance && rightGap > tolerance) return "left";
  if (rightGap <= tolerance && leftGap > tolerance) return "right";
  // Indented on both sides but not symmetrically: an inset block, not an
  // alignment. Saying so is more useful than rounding it to the nearer edge.
  return "unknown";
}

/**
 * The alignment of a rendered block, from both kinds of evidence at once.
 *
 * `keyword` and `box` answer different questions — "how is the text laid out
 * inside this box" and "where is this box inside its parent" — and a block is
 * only unambiguously aligned when they agree or when only one of them speaks.
 * When they disagree the box wins, because a shrink-wrapped centred block whose
 * inner text is left-aligned reads as centred, not as left.
 */
export function resolveAlignment(
  textAlign: string | undefined | null,
  box: Box | undefined,
  container: Box | undefined,
  tolerance = 4,
): { alignment: Alignment; evidence: AlignEvidence } {
  const keyword = normalizeTextAlign(textAlign);
  const positional = box && container ? boxAlignment(box, container, tolerance) : "unknown";

  if (keyword === "unknown" && positional === "unknown") return { alignment: "unknown", evidence: "none" };
  if (positional === "unknown") return { alignment: keyword, evidence: "keyword" };
  if (keyword === "unknown") return { alignment: positional, evidence: "box" };
  if (keyword === positional) return { alignment: keyword, evidence: "keyword+box" };
  return { alignment: positional, evidence: "box" };
}

/**
 * The alignment of the page's ordinary prose — the baseline everything else is
 * judged against.
 *
 * "Ordinary prose" is decided by text length, not by tag or class: a block long
 * enough to wrap is body text whatever it is called, and a short block is a
 * label, caption or heading whose alignment is exactly what we are trying to
 * measure and therefore must not be allowed to define the baseline.
 *
 * Weighted by text length rather than counted, because a page with forty short
 * centred captions and six long justified paragraphs is a justified page.
 * `justify` and `left` are *not* merged: they are different keywords, but for
 * the purpose of "is this block distinctive" they behave the same, which
 * {@link isDistinctive} — not this function — is where that belongs.
 */
export function proseAlignment(
  blocks: ReadonlyArray<{ alignment: Alignment; textLength: number }>,
  minProseLength = 120,
): Alignment {
  // Delegated, not reimplemented. The converter decides which blocks to wrap in
  // `::: align` using exactly this baseline; if the instrument computed its own,
  // the two could drift and L3 would grade the converter against a rule the
  // converter never applied — an instrument measuring itself. `ladom` is the
  // legal shared floor: `l3` may import it, `convert-core` already does, and
  // neither imports the other.
  return widen(proseAlign(blocks.map((b) => ({ align: narrow(b.alignment), textLength: b.textLength })), minProseLength));
}

/** `Alignment` → `PhysicalAlign`: the instrument's "unknown" is `ladom`'s `null`. */
function narrow(alignment: Alignment): PhysicalAlign {
  return alignment === "unknown" ? null : alignment;
}

/** `PhysicalAlign` → `Alignment`. */
function widen(align: PhysicalAlign): Alignment {
  return align ?? "unknown";
}

/**
 * Whether a block's alignment says anything the page does not already say.
 *
 * `left` and `justify` are both "the default reading flow" for this purpose: a
 * justified page does not make its left-aligned blocks distinctive, and vice
 * versa. `center` and `right` are distinctive against either.
 */
export function isDistinctive(alignment: Alignment, prose: Alignment): boolean {
  return isDistinctiveAlign(narrow(alignment), narrow(prose));
}

/**
 * The full verdict for one block.
 *
 * This is the function a rule contract should be written against: it never
 * exposes an absolute keyword as the answer, only the keyword *and* whether it
 * differs from the page's own baseline.
 */
export function alignmentVerdict(
  textAlign: string | undefined | null,
  box: Box | undefined,
  container: Box | undefined,
  prose: Alignment,
  tolerance = 4,
): AlignmentVerdict {
  const { alignment, evidence } = resolveAlignment(textAlign, box, container, tolerance);
  return { alignment, evidence, distinctive: isDistinctive(alignment, prose) };
}

/**
 * Vertical reading order of **two** boxes.
 *
 * Two boxes on the same visual line — a lane pair — must not be ordered by a
 * one-pixel difference in `y`, or the reading order reported for a two-column
 * region depends on font metrics. Boxes whose vertical extents overlap by more
 * than half the shorter one are treated as the same row and ordered by `x`.
 *
 * **Not a sort comparator.** It is deliberately not transitive: A may share a
 * row with B and B with C while A and C do not overlap at all. Handing a
 * non-transitive comparator to `Array.prototype.sort` yields an
 * implementation-defined permutation, and two such sorts can then disagree for
 * reasons that have nothing to do with the documents — which manufactures
 * exactly the reordering finding an ordering check exists to detect. Use
 * {@link readingRanks} to order a *set*.
 */
export function readingOrder(a: Box, b: Box): number {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const shorter = Math.min(a.h, b.h);
  if (shorter > 0 && overlap > shorter / 2) return a.x - b.x || a.y - b.y;
  return a.y - b.y || a.x - b.x;
}

/**
 * Partition boxes into visual rows.
 *
 * The transitive replacement for pairwise row-sharing. Boxes are swept top to
 * bottom and each one joins the open band when it overlaps that band's
 * **anchor** — the band's first, topmost box — by more than half the shorter
 * height. Comparing against the anchor rather than against the band's running
 * extent is what stops one tall cell from absorbing every box beside and below
 * it and collapsing a whole page into a single row.
 *
 * Returns the 0-based row index of each box, in input order.
 */
export function rowBands(boxes: readonly Box[]): number[] {
  const order = boxes
    .map((_, i) => i)
    .sort((i, j) => boxes[i]!.y - boxes[j]!.y || boxes[i]!.x - boxes[j]!.x || i - j);

  const band = new Array<number>(boxes.length).fill(0);
  let current = -1;
  let anchor: Box | null = null;

  for (const idx of order) {
    const box = boxes[idx]!;
    if (anchor === null) {
      current += 1;
      anchor = box;
      band[idx] = current;
      continue;
    }
    const overlap = Math.min(anchor.y + anchor.h, box.y + box.h) - Math.max(anchor.y, box.y);
    const shorter = Math.min(anchor.h, box.h);
    if (shorter > 0 && overlap > shorter / 2) {
      band[idx] = current;
    } else {
      current += 1;
      anchor = box;
      band[idx] = current;
    }
  }
  return band;
}

/**
 * A total, transitive reading order over a set of boxes.
 *
 * Row band first, then `x` within the row, then `y`, then input index. Every
 * tiebreak is total, so the result is a genuine permutation and is identical
 * across runs and engines — which is what makes a rank comparison between two
 * documents mean something.
 *
 * Returns each box's 0-based rank, in input order.
 */
export function readingRanks(boxes: readonly Box[]): number[] {
  const band = rowBands(boxes);
  const order = boxes
    .map((_, i) => i)
    .sort((i, j) => band[i]! - band[j]! || boxes[i]!.x - boxes[j]!.x || boxes[i]!.y - boxes[j]!.y || i - j);
  const rank = new Array<number>(boxes.length).fill(0);
  order.forEach((idx, k) => {
    rank[idx] = k;
  });
  return rank;
}

/**
 * Whether a box overflows its container horizontally.
 *
 * §14 requires a conforming renderer to keep all content within the article
 * viewport and to contain wide tables "without page-level horizontal overflow".
 * A produced document that overflows where the reference does not is a real
 * layout defect, and it is invisible to every other rung of the ladder.
 */
export function overflowsHorizontally(box: Box, container: Box, tolerance = 1): number {
  const right = box.x + box.w - (container.x + container.w);
  const left = container.x - box.x;
  return Math.max(0, Math.max(right, left) - tolerance);
}

/**
 * Lane assignment for a set of boxes sharing a horizontal band.
 *
 * Used to answer "is this one persistent lane or one pair per row" — the
 * question §8.2 of PROGRESS turns on — from geometry rather than from the
 * directive nesting, so the two can be compared against each other.
 *
 * Returns the 0-based column index of each box within its row, where a row is a
 * maximal set of boxes whose vertical extents overlap.
 */
export function lanesOf(boxes: readonly Box[]): number[] {
  const band = rowBands(boxes);
  const rows = new Map<number, number[]>();
  band.forEach((b, i) => {
    const row = rows.get(b);
    if (row) row.push(i);
    else rows.set(b, [i]);
  });
  const lane = new Array<number>(boxes.length).fill(0);
  for (const row of rows.values()) {
    row.sort((i, j) => boxes[i]!.x - boxes[j]!.x || boxes[i]!.y - boxes[j]!.y || i - j);
    row.forEach((idx, k) => {
      lane[idx] = k;
    });
  }
  return lane;
}
