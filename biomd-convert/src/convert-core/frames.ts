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
    if (!tint) return null;
    const minText = recurrentTintedPanel(el, tint) ? 1 : undefined;
    return applyFrameGuards(el, documentTextLength, tint, `${tint} panel spanning a grid row`, minText);
  };
  // The sole-cell path is tried wherever the border path declines, for the same
  // reason and in the same position as the tint path: the commonest way a
  // hairline declines is by being a hairline, which is the whole shape here.
  const boxed = (): FrameEvidence | null => {
    const box = soleCellBox(el);
    return box ? applyFrameGuards(el, documentTextLength, box.frame, box.reason) : tinted();
  };

  let width = 0;
  let color: string | undefined;
  if (style) {
    width = Math.min(style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth);
    if (style.borderStyle === "none" || style.borderStyle === "hidden") return tinted();
    color = style.borderColor;
  } else {
    const decl = BORDER_DECL.exec(inline);
    if (!decl) return boxed();
    const parts = (decl[1] as string).trim().split(/\s+/u);
    width = Number.parseFloat(parts[0] ?? "0");
    color = parts.find((p) => p.startsWith("#") || p in NAMED);
  }
  if (!Number.isFinite(width) || width < 2) return boxed();

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
 * The 20-character floor separates a notice from a table's cell grid. A short
 * tinted panel may bypass it only when the same full-row role recurs in its
 * table with populated content between occurrences. This is relational
 * evidence: a repeated record label is a panel; a singleton menu label is not.
 * Occupancy remains the first gate, so repeated tinted lane cells still fail.
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
 * `BioMD-Reference.md` §12: "`frame: gold|black|red|white`, **default `gold`**".
 *
 * Used where the author demonstrably drew a box but the colour says nothing —
 * a browser-default `rgb(128,128,128)` is not a choice, and §12's own "choose
 * nearest valid theme token" has no nearest for a neutral grey. Writing the
 * spec's default is the one answer that invents nothing.
 */
const DEFAULT_FRAME_PALETTE: FramePalette = "gold";

/**
 * A hairline around a table that has only one cell.
 *
 * ## Rule contract
 *
 * **Invariant.** A 1 px border is refused everywhere else because it is a
 * table's *cell grid*, and that reasoning has a precondition nobody checked:
 * there have to be cells for a grid to separate. A table with exactly one cell
 * has no grid, so its hairline is the only thing it can be — a box the author
 * drew round a notice. The evidence is cardinality, not width; no class, id,
 * colour or word is read.
 *
 * **Recurrence.** Deliberately **not** required, and this is the second shape
 * `CLAUDE.md` §5 has in mind: a notice occurs once per page by definition, and
 * both instances in the corpus are singletons. Cardinality replaces it —
 * "exactly one cell" is a stronger statement than "seen twice".
 *
 * **False friend, swept.** Rendered in Chromium at 1024 px, all 22 sources
 * carry exactly **24** single-cell bordered tables. Twenty-two are one per
 * document: the site's masthead banner, "Иллюстрированный биографический
 * энциклопедический словарь", 57 characters, identical everywhere. The other
 * two are precisely the notices `analyze-3.md` names — `segovia1`'s copyright
 * box (366 characters) and `new_karta`'s update note (154). No third shape
 * exists. The banner never reaches here: `removeBoilerplate` deletes it on all
 * 22 before structure runs, which is measured — it appears in none of the
 * produced documents. That is a **dependency, not a coincidence**: without a
 * corpus profile the chrome is kept, and the CLI already warns that it will be.
 *
 * **Mutation robustness.** Cardinality survives renamed classes, permuted
 * attributes and `<font>`↔CSS. It is sensitive to a dropped `</td>`, which
 * merges cells — and merging can only *reduce* the count to one, so the guard
 * fails toward drawing a box that the source's own recovery would also draw.
 *
 * **Source.** `analyze-3.md` states it twice with the HTML: on `segovia1`,
 * *"заключен в рамку (находится внутри таблицы у которой явно указан
 * border="1") и отцентрован … такой текст стоит заключить во frame"*; on
 * `new_karta`, *"поэтому такой текст я тоже выделил и поместил в самую близкую
 * по цвету рамку"*.
 */
function soleCellBox(el: LadomNode): FrameEvidence | null {
  if (el.tag !== "td" && el.tag !== "th") return null;
  const table = tableOf(el);
  if (!table || cellCount(table) !== 1) return null;
  const width = drawnBorderWidth(el, table);
  if (width === null) return null;
  return {
    frame: DEFAULT_FRAME_PALETTE,
    reason: `${width}px border around the only cell of its table`,
  };
}

/** The `<table>` this cell belongs to, through an optional row section. */
function tableOf(el: LadomNode): LadomNode | null {
  const row = el.parent;
  if (!row || row.kind !== "element" || row.tag !== "tr") return null;
  const section = row.parent;
  if (!section || section.kind !== "element") return null;
  const table = section.tag === "table" ? section : section.parent;
  if (!table || table.kind !== "element" || table.tag !== "table") return null;
  return table;
}

/**
 * The border width the author drew, from measurement or from the attribute.
 *
 * Measured style wins where there is any — `border="0"` computes
 * `border-style: none`, and a layout table is not a notice however many cells
 * it has. Where the page was not measured the HTML `border` attribute is read
 * instead, which is what this era actually writes: `border="1"` is not inline
 * CSS, so `BORDER_DECL` never sees it and the unmeasured path would otherwise
 * be blind to the only form the corpus uses.
 */
function drawnBorderWidth(el: LadomNode, table: LadomNode): number | null {
  const style = el.style;
  if (style) {
    if (style.borderStyle === "none" || style.borderStyle === "hidden") return null;
    const width = Math.min(style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth);
    return Number.isFinite(width) && width >= 1 ? width : null;
  }
  const attr = Number.parseInt(table.attrs["border"] ?? "", 10);
  return Number.isFinite(attr) && attr >= 1 ? attr : null;
}

/** How many cells the table holds, counted through its row sections. */
function cellCount(table: LadomNode): number {
  let cells = 0;
  const visit = (node: LadomNode): void => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      // A nested table's cells belong to it, not to this one.
      if (child.tag === "table") continue;
      if (child.tag === "td" || child.tag === "th") cells += 1;
      else visit(child);
    }
  };
  visit(table);
  return cells;
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
 * rather than a cell. It is the primary rule because the false friend is
 * enormous.
 *
 * **Short labels require recurrence.** The ordinary 20-character content
 * floor still rejects singleton labels. A shorter panel qualifies only when a
 * second full-row panel of the same palette occurs in the same table with a
 * populated row between them. Record labels recur around their records; a
 * page's one archive/menu label does not. Recurrence is deliberately applied
 * after occupancy: repeating lane cells never reach it.
 *
 * **False friend, measured.** `goya2` tints **fifteen** cells exactly this way
 * — `bgcolor="#F5E29E"` with dead unitless top/bottom borders — and its
 * reference frames **none** of them. They are `width="50%"` *lane* cells, two
 * to a catalogue row, and framing them would put a box round every album title
 * in the corpus's worst document. `new_lendle2`'s five are `colspan="2"
 * width="100%"` and occupy a row of their own. Occupancy separates the two
 * shapes before recurrence is consulted.

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

/**
 * Whether a short tinted panel repeats as a structural row label.
 *
 * Recurrence is deliberately subordinate to occupancy: every candidate must
 * already span its row. Two candidates must also have a populated row between
 * them, so adjacent decorative bands and one-off menu labels do not qualify.
 */
function recurrentTintedPanel(el: LadomNode, palette: FramePalette): boolean {
  const table = tableOf(el);
  const row = el.parent;
  if (!table || !row || row.kind !== "element" || row.tag !== "tr") return false;

  const rows: LadomNode[] = [];
  const visit = (node: LadomNode): void => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      if (child.tag === "table" && child !== table) continue;
      if (child.tag === "tr") rows.push(child);
      visit(child);
    }
  };
  visit(table);

  const here = rows.indexOf(row);
  if (here < 0) return false;
  for (let i = 0; i < rows.length; i += 1) {
    if (i === here || Math.abs(i - here) < 2) continue;
    const cells = rows[i]!.children.filter(
      (child) => child.kind === "element" && (child.tag === "td" || child.tag === "th"),
    );
    const peer = cells.find((cell) => spansItsRow(cell) && tintedPanelPalette(cell) === palette);
    if (!peer) continue;
    const [from, to] = i < here ? [i + 1, here] : [here + 1, i];
    if (rows.slice(from, to).some((between) => textOf(between) !== "")) return true;
  }
  return false;
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

