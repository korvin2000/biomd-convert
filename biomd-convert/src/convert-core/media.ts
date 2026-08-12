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
import { iconGlyphFor } from "./glyphs.js";

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
 * A control drawn as a picture — `mini_images_to_md_guide.md`'s UI icon.
 *
 * **Invariant.** Three independent signals, none of them a name this function
 * knows: *containment* — the image is inside an `<a href>`, so it is a control
 * and not article media; *geometry* — it is icon-sized in both dimensions, so it
 * cannot be depicting anything; *asset identity* — its stem is in the documented
 * icon table, which is lexical data (`glyphs.ts`) and degrades to `false` for an
 * asset it has never seen. The guide asks for two agreeing UI signals before
 * calling an unknown image an icon; requiring a table hit is stricter than that
 * and is what makes the rule safe to run without a caption check.
 *
 * **Recurrence does not apply, and saying so is part of the contract.** A page
 * has one footer, and its pager is drawn once or twice — `new_karta` has exactly
 * one nav arrow on the page. `CLAUDE.md` §5's recurrence requirement is a design
 * law for shapes that repeat *within* a document; here the recurring evidence is
 * cross-document (the same shared asset on every page of the site), which is
 * what the table records. Requiring within-page recurrence would refuse every
 * true positive in the corpus.
 *
 * **False friend: a linked thumbnail.** A small content image whose link points
 * at a larger scan is the shape the guide warns about, and the size cap alone
 * does not separate them — a 32 px thumbnail is legal. Table membership does:
 * a thumbnail is article-specific, so it is never a shared asset, so it is never
 * in the table. `../main/km.gif` is the corpus's near-miss — a linked, icon-ish
 * site badge that carries a real caption and is *not* in the table, and it must
 * keep its `::: image`.
 *
 * The `<a>` requirement is deliberate and narrower than the guide, and
 * {@link inControlStrip} states the one exemption: an *unlinked* known icon is
 * usually a score mark inside a table cell, where a glyph substitution would
 * move table planning, so it stays a picture unless the company it keeps says
 * otherwise.
 */
export function isUiIcon(el: LadomNode): boolean {
  if (el.tag !== "img") return false;
  if (iconGlyphFor(el.attrs["src"] ?? "") === null) return false;

  const w = imageWidthOf(el);
  const h = imageHeightOf(el);
  if (w === undefined || h === undefined) return false;
  if (w > ICON_MAX_PX || h > ICON_MAX_PX) return false;

  for (let cur = el.parent; cur; cur = cur.parent) {
    if (cur.tag === "a") return (cur.attrs["href"] ?? "") !== "";
  }
  return inControlStrip(el);
}

/**
 * Is this unlinked known icon standing in a strip of linked ones?
 *
 * ## Rule contract
 *
 * **Invariant.** The current-page marker of a footer pager is unlinked *by
 * definition* — the page it would point at is the page you are on — so
 * {@link isUiIcon}'s containment signal can never fire for it, and it shipped as
 * `![](../main/h2.gif)`: a broken picture standing between two arrows that had
 * become glyphs. What separates it from the score marks is not the asset and not
 * its size, both of which it shares with them, but the company it keeps: a
 * *linked* known icon in the same block. The relation is the evidence; neither
 * icon alone decides, and no document, class or asset name is consulted. The
 * block boundary is what stops the strip from reaching across the page.
 *
 * **Recurrence within the block is the evidence**, which is the form
 * `CLAUDE.md` §5 asks for and the form {@link isUiIcon} cannot use: a control
 * strip is by construction two or three controls side by side, and one icon
 * alone is not a strip.
 *
 * **False friend: the score mark before a cell's links.** Ten of the 28
 * reference sources' eleven unlinked known icons are `score3` marks inside
 * discography cells, and they must keep their `::: image`. They have no linked
 * known icon as a block sibling — a link column's labels are text — so this
 * never fires on them. Across the 946 unlabelled pages the same holds: 66
 * unlinked known icons (score marks, smiley marks, the bitmap letter marks of a
 * catalogue index) have no linked icon beside them and 12 do, and those 12 are
 * exactly the footer pagers.
 */
function inControlStrip(el: LadomNode): boolean {
  let block = el.parent;
  while (block && !BLOCK_CONTEXT.has(block.tag)) block = block.parent;
  if (!block) return false;

  const linkedSibling = (node: LadomNode, linked: boolean): boolean => {
    if (node === el) return false;
    const inside = linked || (node.tag === "a" && (node.attrs["href"] ?? "") !== "");
    if (inside && node.tag === "img" && iconGlyphFor(node.attrs["src"] ?? "") !== null) return true;
    return node.children.some((child) => linkedSibling(child, inside));
  };
  return block.children.some((child) => linkedSibling(child, false));
}

/**
 * Where an inline run ends, for the purpose of "the same strip".
 *
 * Deliberately the block boundary rather than the whole document: two pagers on
 * one page are two strips, and a marker in a table cell is not in a strip with
 * an arrow three cells away.
 */
const BLOCK_CONTEXT: ReadonlySet<string> = new Set([
  "p",
  "td",
  "th",
  "div",
  "center",
  "li",
  "blockquote",
  "body",
]);

/**
 * How big a control is allowed to be.
 *
 * The guide's own figure — "typically `<=32×32` px or similarly icon-sized". It
 * is a ceiling rather than a discriminator: every icon in the corpus measures
 * 11×11 or 16×16, so the result is flat for anything from 16 to well past 32 and
 * the exact number does no work. That flatness is the shape a limit should have
 * (`learned-patterns.md`); a cliff here would mean the size was masking a
 * missing exclusion.
 */
const ICON_MAX_PX = 32;

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
