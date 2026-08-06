/**
 * Semantic frames (§12) and bounded alignment (§6).
 *
 * Both read the same evidence — a *bounded* block that is styled differently
 * from the prose around it — and both are easy to over-apply, which is why the
 * spec spends more words on when not to use them than on when to.
 *
 * A frame is a border the author drew around a notice, not the border of the
 * page shell and not the border of a photograph. An `align` is a short block
 * the author centred, not a paragraph of justified prose and not a whole
 * article.
 */
import type { FramePalette } from "../biomd-ast/index.js";
import { type LadomNode, textOf } from "../ladom/types.js";

const BORDER_DECL = /(?:^|;)\s*border(?:-top)?\s*:\s*([^;]+)/iu;

/** Named CSS colours a legacy page actually used for a rule. */
const NAMED: Record<string, FramePalette> = {
  black: "black",
  red: "red",
  white: "white",
  gold: "gold",
  maroon: "red",
  crimson: "red",
  silver: "white",
};

/**
 * Map a CSS colour to the nearest palette token (§12).
 *
 * The palette is a set of semantic theme names, not colours — but the source
 * only ever says `#000000`, so the mapping has to go one way. Anything that is
 * not recognisably black, red or gold is treated as no evidence rather than
 * guessed at: a wrong palette is a visible editorial claim.
 */
export function paletteFor(color: string | undefined): FramePalette | null {
  if (!color) return null;
  const value = color.trim().toLowerCase();
  const named = NAMED[value];
  if (named) return named;

  const rgb = parseColor(value);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 70) return "black";
  if (min >= 200) return "white";
  if (r >= 120 && r - Math.max(g, b) >= 60 && g < 120) return "red";
  if (r >= 140 && g >= 100 && b <= Math.min(r, g) - 50) return "gold";
  return null;
}

function parseColor(value: string): [number, number, number] | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/u.exec(value);
  if (hex) {
    const h = hex[1] as string;
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u.exec(value);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

export interface FrameEvidence {
  frame: FramePalette;
  reason: string;
}

/**
 * Whether a block is a deliberately bordered notice.
 *
 * Requirements, all of them load-bearing:
 *
 *   - a border on every side, at least 2 px wide and not `none`. A one-sided
 *     rule is a separator; a 1 px hairline is a table's cell grid.
 *   - a palette the border colour maps onto. No colour, no claim.
 *   - real content, but not the article: a frame around everything is the page
 *     shell, which §12 explicitly excludes.
 *   - no nested table. A bordered region containing a table is a layout
 *     container, and `frame` may not hold `columns` (§4.1).
 */
export function frameEvidenceFor(el: LadomNode, documentTextLength: number): FrameEvidence | null {
  const style = el.style;
  const inline = el.attrs["style"] ?? "";

  let width = 0;
  let color: string | undefined;
  if (style) {
    width = Math.min(style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth);
    if (style.borderStyle === "none" || style.borderStyle === "hidden") return null;
    color = style.borderColor;
  } else {
    const decl = BORDER_DECL.exec(inline);
    if (!decl) return null;
    const parts = (decl[1] as string).trim().split(/\s+/u);
    width = Number.parseFloat(parts[0] ?? "0");
    color = parts.find((p) => p.startsWith("#") || p in NAMED);
  }
  if (!Number.isFinite(width) || width < 2) return null;

  // An undeclared border colour computes to the element's text colour. That is
  // the default, not a choice, and reading a palette out of it turns every
  // `border-style: solid` hairline into a black callout — which is how a
  // festival announcement the reference set as a quotation became a frame.
  //
  // But the test has to ask what the author *wrote*, not what the browser
  // computed, because the two are indistinguishable once computed: `border: 4px
  // solid #000000` on a cell whose text is also black computes exactly like a
  // colourless `border-style: solid`. Six of `news`'s nine obituary notices are
  // written the first way and were being read as the second — the reference
  // frames all nine. A colour the source names is a choice whatever it equals.
  if (style && color !== undefined && !declaresBorderColor(el) && sameColor(color, style.color)) return null;

  const palette = paletteFor(color);
  if (!palette) return null;

  const text = textOf(el).trim();
  if (text.length < 20) return null;
  // The page shell is bordered too, and it contains the article.
  if (documentTextLength > 0 && text.length > documentTextLength * 0.6) return null;
  if (hasDescendantTable(el)) return null;

  return { frame: palette, reason: `${width}px ${palette} border around a bounded notice` };
}

/**
 * Whether the source *names* a border colour, rather than leaving it to inherit.
 *
 * Reads the declaration, not the computed value — that is the whole point. Both
 * spellings this era used count: the `bordercolor` attribute, and a colour token
 * anywhere in a `border` / `border-color` shorthand. Nothing here is
 * corpus-specific: `NAMED` is the documented palette data file, and a `#` token
 * is CSS syntax.
 */
function declaresBorderColor(el: LadomNode): boolean {
  if ((el.attrs["bordercolor"] ?? "").trim() !== "") return true;
  const inline = el.attrs["style"] ?? "";
  const decls = inline.matchAll(/(?:^|;)\s*border(?:-top|-right|-bottom|-left)?(?:-color)?\s*:\s*([^;]+)/giu);
  for (const decl of decls) {
    const tokens = (decl[1] as string).trim().toLowerCase().split(/\s+/u);
    if (tokens.some((token) => token.startsWith("#") || token.startsWith("rgb") || token in NAMED)) return true;
  }
  return false;
}

function hasDescendantTable(el: LadomNode): boolean {
  for (const child of el.children) {
    if (child.kind !== "element") continue;
    if (child.tag === "table") return true;
    if (hasDescendantTable(child)) return true;
  }
  return false;
}

/** Two CSS colours that denote the same paint, spelled either way. */
function sameColor(a: string, b: string): boolean {
  const pa = parseColor(a.trim().toLowerCase());
  const pb = parseColor(b.trim().toLowerCase());
  if (!pa || !pb) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}
