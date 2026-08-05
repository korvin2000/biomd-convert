/**
 * Media semantics — what an `<img>` *means*, separately from where it sits.
 *
 * The three questions a legacy page never answers explicitly, and that
 * `::: image` requires an answer to:
 *
 *   1. is this picture content at all, or a 1×1 spacer / a 11px nav arrow?
 *   2. how wide is it *relative to the article*, not to whatever `<p>` happens
 *      to wrap it — the ancestor walk that answered this before returned the
 *      paragraph the image itself had stretched, so every portrait measured
 *      ratio ≈ 1 and came out `full`;
 *   3. what visible label belongs to it — `alt`, a centred `.ph` line under it,
 *      or nothing.
 *
 * Everything here is a pure function of the tree plus the measured boxes, so
 * the decisions are testable without a browser and reproducible without one.
 */
import { type LadomNode, textOf, walkElements } from "../ladom/types.js";

export type ImageSizeToken = "small" | "medium" | "large" | "full";
export type ImagePositionToken = "left" | "right" | "center" | "full";

/**
 * The width the article's prose actually occupies.
 *
 * Legacy pages are one wide shell table containing one content cell; the
 * content cell is the box every image should be measured against. It is found
 * as the modal width of the blocks that carry substantial prose — a statistic
 * rather than a lookup, because the cell has no distinguishing markup.
 */
export function contentWidthOf(root: LadomNode): number | undefined {
  const widths: number[] = [];
  for (const el of walkElements(root)) {
    if (!el.box || el.box.w <= 0) continue;
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td" && el.tag !== "blockquote") continue;
    const text = textOf(el);
    if (text.length < 200) continue;
    // A cell that also holds the images is still the content box; a shell that
    // holds the whole page is not — it is wider than any line of text ever is.
    widths.push(el.box.w);
  }
  if (widths.length === 0) return undefined;
  widths.sort((a, b) => a - b);
  // The narrowest prose box: nested prose blocks are the innermost measurement
  // of the same column, and a wrapper's width is the shell's, not the text's.
  const q1 = widths[Math.floor(widths.length * 0.25)];
  return q1 && q1 > 0 ? q1 : undefined;
}

/** Rendered width of an image, measured if possible and declared otherwise. */
export function imageWidthOf(el: LadomNode): number | undefined {
  if (el.box && el.box.w > 0) return el.box.w;
  const declared = Number.parseInt(el.attrs["width"] ?? "", 10);
  return Number.isFinite(declared) && declared > 0 ? declared : undefined;
}

export function imageHeightOf(el: LadomNode): number | undefined {
  if (el.box && el.box.h > 0) return el.box.h;
  const declared = Number.parseInt(el.attrs["height"] ?? "", 10);
  return Number.isFinite(declared) && declared > 0 ? declared : undefined;
}

/**
 * Size token from the share of the content width the image takes.
 *
 * Calibrated against the reference conversions rather than invented: those use
 * no `full` at all, and put a 152 px portrait in a 422 px column at `small`,
 * a 200–300 px plate at `medium`, and a 420 px full-width illustration at
 * `large`. The thresholds below reproduce that mapping.
 */
export function sizeTokenFor(width: number | undefined, content: number | undefined): ImageSizeToken {
  if (width === undefined) return "medium";
  if (content !== undefined && content > 0) {
    const share = width / content;
    if (share >= 0.92) return "large";
    if (share >= 0.55) return "medium";
    if (share >= 0.38) return "small";
    return width >= 150 ? "small" : "small";
  }
  if (width >= 380) return "large";
  if (width >= 190) return "medium";
  return "small";
}

/**
 * Decorative furniture that carries no content.
 *
 * Three independent signals, because each alone has false positives: a spacer
 * is tiny, a nav arrow is tiny *and* recurs in the site chrome, and a rule
 * image is extremely wide relative to its height. The name test is last and
 * deliberately narrow — an image is not decorative because of its filename, it
 * is decorative because of how it renders.
 */
export function isDecorative(el: LadomNode): boolean {
  const src = (el.attrs["src"] ?? "").toLowerCase();
  if (src === "") return true;

  const w = imageWidthOf(el);
  const h = imageHeightOf(el);

  // A spacer: too small to depict anything.
  if (w !== undefined && h !== undefined && w <= 14 && h <= 14) return true;
  if (w !== undefined && w <= 3) return true;
  if (h !== undefined && h <= 3) return true;

  const alt = (el.attrs["alt"] ?? "").trim();

  // An unlabelled badge: the little "scores"/"audio" strip a 1998 table put in
  // front of a cell's links instead of a column header. Squarish small images
  // are excluded deliberately — a 15×15 emoticon inside a news entry is
  // content the author chose, and the references keep it.
  if (w !== undefined && h !== undefined && h > 0 && alt === "" && w <= 40 && h <= 20 && w / h >= 1.8) {
    return true;
  }

  // A rule, a banner or a wordmark: a short strip much wider than it is tall,
  // with nothing said about what it depicts.
  if (w !== undefined && h !== undefined && h > 0 && h <= 40 && alt === "" && w / h >= 6) return true;

  // Site furniture that measurement cannot distinguish because it has no
  // intrinsic size in the markup. These are the arrow/bullet glyphs the
  // template repeats on every page of this corpus; each is a link decoration
  // whose link is emitted independently.
  if (/(?:^|\/)(?:forward|back|next|prev|end|dot|point|line|bullet|spacer|pixel|blank|clear|shim)\d*\.gif$/u.test(src)) {
    return true;
  }
  return false;
}

/**
 * A caption for one image, from the source only.
 *
 * §7.1 permits copying a legacy `alt` label to `caption` when it is the only
 * source-backed comment the corpus provides, and forbids deriving either from
 * the filename. Nothing here invents text.
 */
export function captionFor(el: LadomNode): string | undefined {
  const alt = (el.attrs["alt"] ?? "").replace(/\s+/gu, " ").trim();
  if (alt === "") return undefined;
  // A filename is not a caption (§7.1), and neither is the placeholder text
  // FrontPage inserted for an image it could not describe.
  if (/\.(?:jpe?g|gif|png|bmp)$/iu.test(alt)) return undefined;
  if (/^(?:image|picture|photo|img|foto)\s*\d*$/iu.test(alt)) return undefined;
  if (alt.length > 300) return undefined;
  return alt;
}

/**
 * Whether a run of images is one visual row.
 *
 * §8 asks for "two or more adjacent source images forming one visual row", and
 * warns against grouping images merely because their dimensions match. The
 * adjacency is therefore established by the caller (the images are the entire
 * content of one inline run); this only rejects a run whose members are plainly
 * not a row — wildly different heights, or a single image repeated.
 */
export function formsImageRow(images: readonly LadomNode[]): boolean {
  if (images.length < 2) return false;
  const heights = images.map((i) => imageHeightOf(i)).filter((h): h is number => h !== undefined);
  if (heights.length === images.length) {
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    if (min > 0 && max / min > 2.5) return false;
  }
  return true;
}

/** `columns` for a group of n images — §8 allows 2, 3 or 4. */
export function groupColumnsFor(n: number): 2 | 3 | 4 {
  if (n <= 2) return 2;
  if (n === 3) return 3;
  if (n % 3 === 0) return 3;
  return 4;
}
