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

  // The tint path is tried wherever the border path declines, and "no border at
  // all" is the commonest way it declines — so it cannot sit behind the
  // `border-style: none` return below. That return is a *pre-filter*, and a
  // pre-filter is part of the rule: with the fallback behind it, none of the
  // five `new_lendle2` panels reached the new code and it looked like the rule
  // being wrong rather than never being called.
  const tinted = (): FrameEvidence | null => {
    const tint = tintedPanelPalette(el);
    return tint ? applyFrameGuards(el, documentTextLength, tint, `${tint} panel spanning a grid row`) : null;
  };

  let width = 0;
  let color: string | undefined;
  if (style) {
    width = Math.min(style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth);
    if (style.borderStyle === "none" || style.borderStyle === "hidden") return tinted();
    color = style.borderColor;
  } else {
    const decl = BORDER_DECL.exec(inline);
    if (!decl) return tinted();
    const parts = (decl[1] as string).trim().split(/\s+/u);
    width = Number.parseFloat(parts[0] ?? "0");
    color = parts.find((p) => p.startsWith("#") || p in NAMED);
  }
  if (!Number.isFinite(width) || width < 2) return tinted();

  // There used to be a test here rejecting a border whose computed colour
  // equalled the element's text colour, on the grounds that an *undeclared*
  // border colour inherits from `color` and a default is not a choice.
  //
  // It conflated two questions. "Did the author draw a border?" is answered by
  // the border itself — a declared style and a width of 2 px or more, which is
  // what separates a notice from a table's cell grid. "Which palette?" is the
  // only question the colour answers, and there the computed value is exactly
  // right: a border the author left to inherit black *is* black.
  //
  // Asking them together got both wrong. Six of `news`'s nine obituary notices
  // write `border: 4px solid #000000` on black text, which computes identically
  // to a colourless `border-style: solid` — so a declared colour was read as a
  // default and six frames were lost. And the one block the guard existed to
  // protect, `news_2007`'s festival announcement, is framed by the reference:
  // it declares `border-style: solid` and a background tint, and the reference
  // writes `frame: black`. With the test removed, frame counts match the
  // references exactly on all thirteen documents — 9 on `news`, 1 on
  // `news_2007`, 0 everywhere else, none gained anywhere.

  const palette = paletteFor(color);
  if (!palette) return null;
  return applyFrameGuards(el, documentTextLength, palette, `${width}px ${palette} border around a bounded notice`);
}

/**
 * The guards every frame answers, whatever drew it.
 *
 * The 20-character floor separates a notice from a table's cell grid, and it
 * costs one real panel: `new_lendle2`'s `Heitor Villa-Lobos` is 18 characters,
 * so four of its five panels are framed and the fifth is not.
 *
 * **Dropping the floor for the tint path was measured and reverted.** The
 * argument was good — `spansItsRow` is a stronger occupancy statement than a
 * length — and it did close the fifth panel and the `layout.order.mismatch`
 * that the gap creates (L3 92 → 90, critical 11 → 10). But the same floor is
 * the only thing keeping the *menu label* cells out: `news` and `news_2007`
 * each set `• Архив новостей •` in a spanning tinted cell, and both gained a
 * spurious frame (9 → 10 and 1 → 2). A box the author did not draw, on two
 * regression-corpus documents, outranks two L3 findings on one. L1 93.2 → 93.1
 * and L2 413 · 238 → 418 · 241 agreed.
 */
function applyFrameGuards(
  el: LadomNode,
  documentTextLength: number,
  palette: FramePalette,
  reason: string,
  minText = 20,
): FrameEvidence | null {
  const text = textOf(el).trim();
  if (text.length < minText) return null;
  // The page shell is bordered too, and it contains the article.
  if (documentTextLength > 0 && text.length > documentTextLength * 0.6) return null;
  if (hasDescendantTable(el)) return null;
  return { frame: palette, reason };
}

/**
 * A panel the author drew with a background tint rather than a border.
 *
 * ## Rule contract
 *
 * **Why this path exists.** The border is often not there. `new_lendle2` writes
 * `border: 1 solid #D5A96F` on five album panels — a **unitless** width, so the
 * whole shorthand is invalid and Chromium computes `border-style: none` and
 * width 0. Measured, not assumed: all five report `none`/0/0/0/0. What the
 * reader still sees is the *background* — `rgb(252,243,216)` against the page's
 * `rgb(247,231,175)` — and its reference writes `frame: white` five times,
 * which is exactly what {@link paletteFor} returns for that tint. A tint that
 * differs from the nearest painted ancestor is the same construct as a border.
 *
 * **Invariant: the panel spans its whole row.** This is what makes it a panel
 * rather than a cell. It is not a refinement — it is the entire rule, because
 * the false friend is enormous.
 *
 * **False friend, measured.** `goya2` tints **fifteen** cells exactly this way
 * — `bgcolor="#F5E29E"` with dead unitless top/bottom borders — and its
 * reference frames **none** of them. They are `width="50%"` *lane* cells, two
 * to a catalogue row, and framing them would put a box round every album title
 * in the corpus's worst document. `new_lendle2`'s five are `colspan="2"
 * width="100%"` and occupy a row of their own. Recurrence cannot separate these
 * — `goya2` recurs fifteen times and `new_lendle2` five — so this rule
 * deliberately does **not** use it; occupancy is the evidence instead.
 *
 * A cell that is alone in its row spans it too, so both forms are accepted, and
 * a cell that shares its row with a sibling is refused however it is tinted.
 */
function tintedPanelPalette(el: LadomNode): FramePalette | null {
  if (el.tag !== "td" && el.tag !== "th") return null;
  const background = el.style?.backgroundColor;
  if (!background || background === "transparent" || /rgba\([^)]*,\s*0\s*\)/u.test(background)) return null;
  if (!spansItsRow(el)) return null;

  // A tint is only a panel where the page is not already that colour.
  let ancestor = el.parent;
  while (ancestor) {
    const behind = ancestor.style?.backgroundColor;
    if (behind && behind !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/u.test(behind)) {
      if (behind === background) return null;
      break;
    }
    ancestor = ancestor.parent;
  }
  if (!ancestor) return null;

  return paletteFor(background);
}

/** True when this cell covers every column of the row it sits in. */
function spansItsRow(el: LadomNode): boolean {
  const span = Number.parseInt(el.attrs["colspan"] ?? "", 10);
  if (Number.isFinite(span) && span > 1) return true;
  const row = el.parent;
  if (!row || row.kind !== "element" || row.tag !== "tr") return false;
  return row.children.filter((c) => c.kind === "element" && (c.tag === "td" || c.tag === "th")).length === 1;
}

function hasDescendantTable(el: LadomNode): boolean {
  for (const child of el.children) {
    if (child.kind !== "element") continue;
    if (child.tag === "table") return true;
    if (hasDescendantTable(child)) return true;
  }
  return false;
}

