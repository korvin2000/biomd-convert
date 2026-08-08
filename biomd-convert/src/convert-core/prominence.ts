/**
 * Typographic prominence, read off whatever evidence the run actually has.
 *
 * A 1998 page has no `<h1>`. It has `<div style="FONT: bold 20pt Arial">`,
 * `<font size=+2>`, `<b>` inside a centered cell — the heading level is encoded
 * in the typography and nowhere else. Recovering it is what turns a wall of
 * paragraphs back into a document with a title and sections.
 *
 * Three evidence sources, in descending order of trust:
 *
 *   1. measured computed style, when the render pass ran;
 *   2. the inline `style` attribute, including the `font:` shorthand that
 *      FrontPage emitted and that no simple `font-size:` scan finds;
 *   3. legacy attributes — `<font size>`, `<b>`, `align=center`.
 *
 * Everything here is a pure function of a node, so the caller can score
 * candidates without caring which evidence was available.
 */
import { isCenteredAlign } from "../ladom/style.js";
import { type LadomNode, textOf } from "../ladom/types.js";

/** Body text is 12pt ≈ 16px; sizes are normalized to px against that. */
export const BASE_FONT_PX = 16;

export interface Prominence {
  /** Effective font size in px, or undefined when nothing said. */
  fontPx?: number;
  bold: boolean;
  centered: boolean;
  /** Uppercase ratio of the visible text, 0..1. */
  upperRatio: number;
  /** Visible text, whitespace-collapsed. */
  text: string;
  /**
   * Composite score. Above ~1.35 the source was shouting; a value near 1 is
   * ordinary body text.
   */
  score: number;
}

const FONT_SIZE_DECL = /(?:^|;)\s*font-size\s*:\s*([^;]+)/iu;
/** `font: [style] [variant] [weight] <size>[/<line-height>] <family>` */
const FONT_SHORTHAND = /(?:^|;)\s*font\s*:\s*([^;]+)/iu;
const SIZE_VALUE = /(-?[\d.]+)\s*(pt|px|em|rem|%)?/iu;

/** Resolve a CSS length to px. Returns undefined for anything unparseable. */
export function cssLengthPx(value: string): number | undefined {
  const match = SIZE_VALUE.exec(value.trim());
  if (!match) return undefined;
  const n = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  switch ((match[2] ?? "px").toLowerCase()) {
    case "pt":
      return (n * 4) / 3;
    case "em":
    case "rem":
      return n * BASE_FONT_PX;
    case "%":
      return (n / 100) * BASE_FONT_PX;
    default:
      return n;
  }
}

/** Font size declared on this node alone, in px. */
export function declaredFontPx(node: LadomNode): number | undefined {
  if (node.style && node.style.fontSize > 0) return node.style.fontSize;

  const style = node.attrs["style"] ?? "";
  const explicit = FONT_SIZE_DECL.exec(style);
  if (explicit) {
    const px = cssLengthPx(explicit[1] as string);
    if (px !== undefined) return px;
  }
  const shorthand = FONT_SHORTHAND.exec(style);
  if (shorthand) {
    // The size is the first component that parses as a length with a unit; the
    // preceding words are style/variant/weight keywords.
    for (const token of (shorthand[1] as string).split(/\s+/u)) {
      if (!/\d/u.test(token)) continue;
      const px = cssLengthPx(token.split("/")[0] as string);
      if (px !== undefined) return px;
    }
  }

  // `<font size>`, folded onto the parent by normalize(). Legacy sizes 1–7 map
  // to roughly 0.6×–3× body; `+n` / `-n` are relative to 3.
  const legacy = node.attrs["size"] ?? node.attrs["data-fold-font-size"];
  if (legacy !== undefined) return legacyFontPx(legacy);
  return undefined;
}

/** A legacy `<font size>` level resolved to px. */
function legacyFontPx(value: string): number | undefined {
  const relative = /^[+-]/u.test(value.trim());
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return undefined;
  const level = Math.max(1, Math.min(7, relative ? 3 + n : n));
  return BASE_FONT_PX * [0.63, 0.82, 1, 1.13, 1.5, 2, 3][level - 1]!;
}

/**
 * The size the text sitting *directly* inside a node renders at.
 *
 * Different from {@link effectiveFontPx} in exactly one case, and deliberately
 * so. `normalize` unwraps a presentational wrapper that covered all of its
 * parent's text and records its size on the parent — after which the parent's
 * own measured `font-size`, taken before the unwrap, no longer describes the
 * text the parent now holds directly. `<span><font size=4>(дискография)</font>
 * </span>` measures 26.7 px on the span and renders at 18 px.
 *
 * Scoped to comparisons *between* runs of text, where the question is how two
 * pieces of text are set relative to each other. `effectiveFontPx` stays the
 * general reading: heading recovery ranks whole blocks, and a block's own
 * computed size is the right thing for that — reading the folded value there
 * costs three section headings in the corpus, because a legacy page routinely
 * wraps a whole centred label in a `<font size=2>` it does not mean as a
 * demotion.
 */
export function textFontPx(node: LadomNode): number | undefined {
  const folded = node.attrs["data-fold-font-size"];
  if (folded !== undefined) {
    const px = legacyFontPx(folded);
    if (px !== undefined) return px;
  }
  return effectiveFontPx(node);
}

/** Font size in effect for a node, inherited from the nearest ancestor that set one. */
export function effectiveFontPx(node: LadomNode): number | undefined {
  let cur: LadomNode | null = node;
  while (cur) {
    const px = declaredFontPx(cur);
    if (px !== undefined) return px;
    cur = cur.parent;
  }
  return undefined;
}

const BOLD_TAGS = new Set(["b", "strong", "th", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Weight in effect for a node, inherited like {@link effectiveFontPx}.
 *
 * Bold is read as a *class*, not as a number, on purpose. A `<b>` inside a box
 * already declared `font: bold` computes to 900 against the box's 700, and the
 * two render identically in a family with one bold face — treating that as a
 * level would split a headline whose lines the author set the same way.
 */
export function effectiveBold(node: LadomNode): boolean {
  let cur: LadomNode | null = node;
  while (cur) {
    if (isBold(cur)) return true;
    // A measured node already carries the inherited value; anything above it
    // has been accounted for.
    if (cur.style) return false;
    cur = cur.parent;
  }
  return false;
}

function isBold(node: LadomNode): boolean {
  if (node.style && node.style.fontWeight >= 600) return true;
  const style = node.attrs["style"] ?? "";
  if (/font-weight\s*:\s*(bold|[6-9]00)/iu.test(style)) return true;
  if (/(?:^|;)\s*font\s*:[^;]*\bbold\b/iu.test(style)) return true;
  if (BOLD_TAGS.has(node.tag)) return true;
  // A wrapper whose only element child is <b> is bold in effect.
  const kids = node.children.filter((c) => c.kind === "element");
  return kids.length === 1 && BOLD_TAGS.has((kids[0] as LadomNode).tag);
}

function isCentered(node: LadomNode): boolean {
  // When the page was rendered, the computed value is the answer and the
  // ancestor walk is not merely redundant but wrong. `align="center"` is a
  // *presentational hint*: it sits below author CSS in the cascade, so
  // `<p class="t" align="center">` under `.t { text-align: Justify }` renders
  // justified. Reading the attribute called it centred and promoted every
  // quoted document on the page to a section heading.
  if (node.style) return isCenteredAlign(node.style.textAlign);

  let cur: LadomNode | null = node;
  let hops = 0;
  while (cur && hops < 4) {
    // Folded, not compared. This walk runs only on an unmeasured node, but a
    // partially measured tree reaches it with real computed values on the
    // ancestors, and `-webkit-center` is exactly what an ancestor that centres
    // by attribute computes to — the form this branch used to miss.
    if (isCenteredAlign(cur.style?.textAlign)) return true;
    if ((cur.attrs["align"] ?? "").toLowerCase() === "center") return true;
    if (/text-align\s*:\s*center/iu.test(cur.attrs["style"] ?? "")) return true;
    if (cur.tag === "center" || cur.attrs["data-fold-align"] === "center") return true;
    cur = cur.parent;
    hops += 1;
  }
  return false;
}

export function prominenceOf(node: LadomNode): Prominence {
  const text = textOf(node);
  const fontPx = effectiveFontPx(node);
  const bold = isBold(node) || hasBoldDescendantCoveringAll(node, text);
  const centered = isCentered(node);

  const letters = text.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "");
  const upperRatio = letters.length > 0 ? upper.length / letters.length : 0;

  let score = fontPx !== undefined ? fontPx / BASE_FONT_PX : 1;
  if (bold) score *= 1.15;
  if (centered) score *= 1.05;
  // A short all-caps run is a label, not shouting prose.
  if (upperRatio > 0.8 && letters.length > 2 && letters.length < 60) score *= 1.1;

  const result: Prominence = { bold, centered, upperRatio, text, score };
  if (fontPx !== undefined) result.fontPx = fontPx;
  return result;
}

/** True when every letter of the node's text sits inside a bold descendant. */
function hasBoldDescendantCoveringAll(node: LadomNode, text: string): boolean {
  if (text === "") return false;
  let boldText = "";
  const visit = (n: LadomNode, inBold: boolean): void => {
    const nowBold = inBold || (n.kind === "element" && BOLD_TAGS.has(n.tag));
    if (n.kind === "text" && nowBold) boldText += n.value ?? "";
    for (const child of n.children) visit(child, nowBold);
  };
  visit(node, false);
  return boldText.replace(/\s+/gu, " ").trim().length >= text.length * 0.9;
}
