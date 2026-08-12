/**
 * Physical table grid → semantic record matrix.
 *
 * Three representations have to stay separate, and conflating any two of them is
 * what made whole tables disappear:
 *
 *   1. the repaired HTML tree;
 *   2. the **physical** occupancy grid — span coverage, origin cells (grid.ts);
 *   3. the **semantic** record matrix — what a Markdown table can express.
 *
 * Legacy tables routinely use more physical slots than they have semantic
 * columns. A FrontPage discography table declares nine slots per row in a stable
 * `7 + 1 + 1` pattern; it has three columns. Rows that carry extra resource links
 * split the leading seven slots into several cells without changing what the row
 * *means*. The old converter required the physical width to equal the Markdown
 * width, so it rejected the table, classified it DATA anyway, and flattened it
 * into paragraphs — text recall stayed at 100% while the table ceased to exist.
 *
 * The fix is to plan the entire matrix before emitting anything:
 *
 *   - infer semantic **column bands** from the dominant complete-row partition,
 *     corrected by an explicit header row when there is one;
 *   - assign every origin cell to exactly one band; several physical cells inside
 *     one band become one semantic cell, joined in reading order;
 *   - never read a covered span slot, so a spanned value is not duplicated;
 *   - flatten harmless wrappers (`<p>`, `<div>`, a one-item `<ul>`, `<font>`) to
 *     inline content, because they are typography, not structure;
 *   - accept only when every source cell is placed exactly once, no cell crosses
 *     a band boundary, and every row has the semantic width.
 *
 * Anything that fails those conditions returns null, and the caller falls back to
 * a *reviewed* decomposition rather than to a fabricated table.
 */
import { type GridCell, type TableGrid, trailingEmptyRows } from "../ladom/grid.js";
import { type LadomNode, textOf } from "../ladom/types.js";

/** One semantic cell: the origin cells that fall inside one band of one row. */
export interface PlannedCell {
  /** Physical cells contributing to this semantic cell, in reading order. */
  sources: GridCell[];
  /** True when the source marked every contributing cell as a header. */
  isHeader: boolean;
  /** Nothing to show — the caller emits the em-dash placeholder. */
  isEmpty: boolean;
}

export interface PlannedRow {
  /** Exactly `bands.length` cells. */
  cells: PlannedCell[];
  /** Grid row index this came from, for provenance. */
  row: number;
}

export interface LogicalTablePlan {
  /** Semantic column boundaries as half-open physical slot ranges. */
  bands: Array<{ start: number; end: number }>;
  /** Header row, when the source has an honest one. */
  header: PlannedRow | null;
  body: PlannedRow[];
  /** Why the plan was accepted — recorded on the ledger entry. */
  reason: string;
  /**
   * True when the source supplied no header row. The caller must either obtain
   * labels from a hook or emit a review item; inventing them is an editorial
   * change the spec forbids (§16.3).
   */
  headerSynthesized: boolean;
}

export interface PlanOptions {
  /** Reject tables narrower/shorter than this. */
  minRows?: number;
  minCols?: number;
  /** Maximum semantic columns a reader can still use on a narrow screen. */
  maxCols?: number;
}

const DEFAULTS: Required<PlanOptions> = { minRows: 2, minCols: 2, maxCols: 8 };

// ---------------------------------------------------------------------------
// Cell shape
// ---------------------------------------------------------------------------

/** Wrappers that carry typography rather than structure; flattened to inline. */
const TRANSPARENT_BLOCKS = new Set(["p", "div", "center", "font", "span", "nobr", "small", "big", "blockquote"]);

/** Block constructs a GFM cell genuinely cannot hold. */
const HARD_BLOCKS = new Set(["table", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "hr", "dl", "form"]);

/**
 * Whether a cell's content survives being flattened to inline phrasing.
 *
 * A single wrapping `<p>`, a stack of them, or a one-item `<ul>` used as a bullet
 * glyph are all typography. A multi-item list, a nested table or a heading are
 * structure, and flattening those produces the unreadable output that made
 * rejecting block content the right instinct in the first place.
 */
export function isInlineable(node: LadomNode): boolean {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (HARD_BLOCKS.has(child.tag)) return false;
    if (child.tag === "ul" || child.tag === "ol") {
      const items = child.children.filter((c) => c.kind === "element" && c.tag === "li");
      if (items.length > 1) return false;
      for (const item of items) if (!isInlineable(item)) return false;
      continue;
    }
    if (TRANSPARENT_BLOCKS.has(child.tag)) {
      if (!isInlineable(child)) return false;
      continue;
    }
    // Anything else is inline (a, b, i, img, br, u, sup…) — its own children may
    // still hide a table, so keep descending.
    if (!isInlineable(child)) return false;
  }
  return true;
}

/**
 * How many block-ish paragraphs a cell holds.
 *
 * One or two short paragraphs flatten acceptably (they become `a b`); a cell with
 * five is prose, and prose beside prose is a layout table, not a data table.
 */
export function paragraphCount(node: LadomNode): number {
  let n = 0;
  for (const child of node.children) {
    if (child.kind === "element" && (child.tag === "p" || child.tag === "div")) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Band inference
// ---------------------------------------------------------------------------

/** The physical slot ranges each row's origin cells occupy. */
function rowPartition(grid: TableGrid, row: number): Array<{ start: number; end: number; cell: GridCell }> {
  const out: Array<{ start: number; end: number; cell: GridCell }> = [];
  const seen = new Set<string>();
  const slots = grid.slots[row] ?? [];
  for (let c = 0; c < slots.length; c += 1) {
    const slot = slots[c];
    if (!slot || !slot.isOrigin || seen.has(slot.originId)) continue;
    seen.add(slot.originId);
    const cell = grid.cells.find((x) => x.id === slot.originId);
    if (!cell) continue;
    out.push({ start: cell.col, end: cell.col + cell.colSpan, cell });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Infer the semantic column bands.
 *
 * The signal is the **dominant partition**: the boundary set that the largest
 * number of rows agrees on. In the `7 + 1 + 1` case twenty-four of twenty-seven
 * rows vote for `{0, 7, 8}`, and the three score rows that subdivide the leading
 * band are the minority — which is exactly the right way round, because they are
 * the exception the layout was bent to accommodate.
 *
 * An explicit header row overrides the vote when it is at least as coarse: the
 * author stated the column count there.
 */
export function inferColumnBands(grid: TableGrid): Array<{ start: number; end: number }> {
  const votes = new Map<string, { boundaries: number[]; rows: number }>();

  for (let r = 0; r < grid.rows; r += 1) {
    const partition = rowPartition(grid, r);
    if (partition.length === 0) continue;
    // A row that does not span the full width is ragged; it cannot define the
    // column model, though it may still be placed into one.
    if ((partition[partition.length - 1] as { end: number }).end !== grid.cols) continue;
    const boundaries = partition.map((p) => p.start);
    const key = boundaries.join(",");
    const entry = votes.get(key) ?? { boundaries, rows: 0 };
    entry.rows += 1;
    votes.set(key, entry);
  }

  if (votes.size === 0) return [];

  const headerBoundaries = headerRowBoundaries(grid);
  const ranked = [...votes.values()].sort((a, b) => b.rows - a.rows || a.boundaries.length - b.boundaries.length);
  let chosen = (ranked[0] as { boundaries: number[] }).boundaries;

  // The header states the column count; prefer it unless it is *finer* than the
  // dominant body partition, which would mean the header itself was subdivided
  // for layout reasons.
  if (headerBoundaries && headerBoundaries.length <= chosen.length) chosen = headerBoundaries;

  return toBands(chosen, grid.cols);
}

function headerRowBoundaries(grid: TableGrid): number[] | null {
  for (let r = 0; r < Math.min(grid.rows, 2); r += 1) {
    const partition = rowPartition(grid, r);
    if (partition.length < 2) continue;
    if (!partition.every((p) => p.cell.isHeader)) continue;
    if ((partition[partition.length - 1] as { end: number }).end !== grid.cols) continue;
    return partition.map((p) => p.start);
  }
  return null;
}

function toBands(boundaries: readonly number[], cols: number): Array<{ start: number; end: number }> {
  const sorted = [...new Set(boundaries)].sort((a, b) => a - b);
  const bands: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i] as number;
    const end = i + 1 < sorted.length ? (sorted[i + 1] as number) : cols;
    if (end > start) bands.push({ start, end });
  }
  return bands;
}

/**
 * The position a cell states about itself, or null when it states none.
 *
 * A *position cell* is one link and nothing else, whose whole visible text is a
 * number wearing the era's bracket decoration. Both spellings the corpus uses
 * reduce to the same reading: `[ <a>3</a> ]` puts the brackets outside the
 * anchor and `<a>[ 3 ]</a>` puts them inside, and neither says anything except
 * "this is item 3". The brackets are stripped as punctuation, and a cell with
 * any other text left over is not a position cell at all.
 */
function positionOf(cell: GridCell): number | null {
  if (cell.links !== 1 || cell.images > 0) return null;
  const bare = cell.text.replace(/\s+/gu, " ").trim();
  const digits = /^[\p{Ps}\p{Pi}|]*\s*(\d{1,3})\s*[\p{Pe}\p{Pf}|.]*$/u.exec(bare);
  return digits ? Number(digits[1]) : null;
}

/**
 * Fold a strip of numbered slots into the one column it is.
 *
 * ## What it is for
 *
 * The era drew a multi-page scan as one `<td>` per page — eight narrow cells
 * reading `[ 1 ] [ 2 ] … [ 8 ]` beside a label and an archive link. That is
 * eleven physical columns, so {@link planDataTable} declares the table wider
 * than a reader can use and the caller decomposes it to linear flow: the rows
 * cease to exist and every cell becomes a loose aligned paragraph. It is one
 * column of *this row's scans*, not eight columns of anything, and all four
 * references that meet the shape write it as one cell of consecutive links.
 *
 * ## Rule contract
 *
 * **Invariant.** Ordinality and adjacency, with no vocabulary at all: a run of
 * adjacent single-slot bands whose every occupied cell is a lone link labelled
 * with a bare number, ascending strictly across the run. No class, width,
 * filename or label is consulted, and the digits are language-neutral. A run
 * that does not ascend is several columns that happen to hold numbers.
 *
 * **Recurrence** is *within the row*, not down the table: the same cell shape
 * repeats at least three times side by side, with the sequence advancing
 * between occurrences. Down-the-table recurrence would be the wrong test —
 * `xtra_karta5`'s `Полет шмеля` strip occupies exactly one row of its table,
 * and `xtra_rodrigo`'s occupies three.
 *
 * **False friends, all present in the corpus and all non-firing.** A pair of
 * format links (`MIDI | MP3` in `xtra_karta5`'s six-column Sor and Tárrega
 * tables) — a run of two, and the labels are names rather than numbers. A
 * movement column (`I. | II. | III.`) — roman numerals are not digits. A
 * duration or year column — no link. A column of literal dashes (`segovia`) —
 * no digits. The narrow escape hatch matters more than the breadth: this runs
 * **only** when the table is otherwise about to be abandoned, so a table that
 * already plans is never reshaped by it.
 *
 * **Degradation.** No qualifying run leaves the bands untouched and the caller
 * fails exactly as before.
 */
export function coalesceOrdinalStrips(grid: TableGrid, bands: readonly Band[]): Band[] {
  /** Per band: every position it states, or null the moment it states a non-position. */
  const positions = bands.map((band) => {
    if (band.end - band.start !== 1) return null;
    const seen: Array<number | null> = [];
    for (let r = 0; r < grid.rows; r += 1) {
      const slot = grid.slots[r]?.[band.start];
      if (!slot || !slot.isOrigin) {
        seen.push(null);
        continue;
      }
      const cell = grid.cells.find((x) => x.id === slot.originId);
      if (!cell || cell.isEmpty) {
        seen.push(null);
        continue;
      }
      const position = positionOf(cell);
      if (position === null) return null;
      seen.push(position);
    }
    return seen.some((p) => p !== null) ? seen : null;
  });

  const out: Band[] = [];
  for (let i = 0; i < bands.length; ) {
    let j = i;
    while (j + 1 < bands.length && positions[j + 1]) j += 1;
    // The run must ascend somewhere. A row that occupies fewer than three of
    // its slots cannot show a sequence, so it neither proves nor disproves one.
    const ascends =
      positions[i] != null &&
      j - i + 1 >= 3 &&
      Array.from({ length: grid.rows }, (_, r) => r).some((r) => {
        const line: number[] = [];
        for (let c = i; c <= j; c += 1) {
          const value = (positions[c] as Array<number | null>)[r];
          if (value !== null && value !== undefined) line.push(value);
        }
        return line.length >= 3 && line.every((v, k) => k === 0 || v > (line[k - 1] as number));
      });
    if (ascends) {
      out.push({ start: (bands[i] as Band).start, end: (bands[j] as Band).end });
      i = j + 1;
      continue;
    }
    out.push(bands[i] as Band);
    i += 1;
  }
  return out;
}

/**
 * The index ranges, within one row's partition, that a numbered strip occupies.
 *
 * Same primitive as {@link coalesceOrdinalStrips}, asked of a single row instead
 * of down the whole table: a maximal run of adjacent cells each stating nothing
 * but its own position, the positions ascending strictly, at least three long.
 */
function ordinalRunsIn(partition: ReadonlyArray<{ cell: GridCell }>): Array<{ from: number; to: number }> {
  const positions = partition.map((p) => positionOf(p.cell));
  const runs: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < positions.length; ) {
    if (positions[i] === null) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < positions.length && positions[j + 1] !== null && (positions[j + 1] as number) > (positions[j] as number)) {
      j += 1;
    }
    if (j - i + 1 >= MIN_ORDINAL_RUN) runs.push({ from: i, to: j });
    i = j + 1;
  }
  return runs;
}

/** Three slots is the shortest run that can show a sequence rather than a coincidence. */
const MIN_ORDINAL_RUN = 3;

/** Whether any text inside this cell is set bold. */
function carriesBoldText(node: LadomNode): boolean {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (BOLD_TAGS.has(child.tag) && textOf(child).trim() !== "") return true;
    if (carriesBoldText(child)) return true;
  }
  return false;
}

const BOLD_TAGS = new Set(["b", "strong"]);

/**
 * The row above the table that the source drew inside it.
 *
 * ## What it is for
 *
 * A work's movement list is introduced by its own title, and the era wrote that
 * title as a `colspan`-full first row rather than as a paragraph above the
 * table. Kept as a record it becomes a row of one value and four em dashes,
 * under a header that has to pretend the title is a column value
 * (`segovia`, `xtra_rodrigo` ×2). The references lift it out and set it as a
 * paragraph immediately above the table, which is where it already reads.
 *
 * ## Rule contract
 *
 * **Invariant.** Position, span and typographic prominence *relative to the
 * table's own body* — no vocabulary, no length, no class. The row must be the
 * table's first, must be a single cell covering every column, must carry bold
 * text, and the body must not be mostly bold itself, or the "prominence" is
 * just the table's typeface.
 *
 * **Recurrence does not apply, and saying so is the point.** A table has one
 * title by definition; a recurrence requirement would make the rule unable to
 * fire at all. Span and position carry the evidence instead.
 *
 * **False friend, present twice in the corpus and tested for non-firing:** the
 * full-span *section label* — `xtra_karta5`'s `Двадцать этюдов` over twenty
 * studies, `kiselev`'s jazz-suite dedication over its movements. Identical
 * position and span, set in the body's own face, and both references keep them
 * as table rows. Prominence is the whole discriminator, and it separates all
 * five corpus instances with nothing in between: the titles carry bold text,
 * the labels carry none.
 *
 * **Only where the source stated no header.** A table with a real header row
 * has already said what its columns are, and its first body row is a record.
 */
export function leadingCaptionCell(grid: TableGrid): GridCell | null {
  const first = grid.cells.filter((c) => c.row === 0);
  if (first.length !== 1) return null;
  const cell = first[0] as GridCell;
  if (cell.colSpan !== grid.cols || cell.rowSpan !== 1 || cell.isEmpty) return null;
  if (!carriesBoldText(cell.node)) return null;
  const body = grid.cells.filter((c) => c.row > 0 && !c.isEmpty);
  if (body.length < 2) return null;
  const bold = body.filter((c) => carriesBoldText(c.node)).length;
  return bold * 2 < body.length ? cell : null;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type PlanFailure =
  | "too-small"
  | "no-bands"
  | "too-many-columns"
  | "cell-crosses-band"
  | "cell-needs-blocks"
  | "prose-matrix"
  /** One column is pictures and the others are matter: a catalog *lane*. */
  | "media-lane"
  /** Most of the grid is pictures: a gallery, with no lane to pair them with. */
  | "media-catalog"
  | "no-body";

export interface PlanResult {
  plan: LogicalTablePlan | null;
  failure?: PlanFailure;
  /** Human-readable detail for the ledger and for a hook payload. */
  detail: string;
}

export function planDataTable(grid: TableGrid, options: PlanOptions = {}): PlanResult {
  const opts = { ...DEFAULTS, ...options };

  const contentRows = grid.rows - trailingEmptyRows(grid).size;
  if (contentRows < opts.minRows || grid.cols < 1) {
    return { plan: null, failure: "too-small", detail: `${contentRows}×${grid.cols} is below the minimum` };
  }

  let bands = inferColumnBands(grid);
  if (bands.length < opts.minCols) {
    return {
      plan: null,
      failure: bands.length === 0 ? "no-bands" : "too-small",
      detail: `inferred ${bands.length} semantic column(s) from ${grid.cols} physical slots`,
    };
  }
  let coalescedStrips = 0;
  if (bands.length > opts.maxCols) {
    const coalesced = coalesceOrdinalStrips(grid, bands);
    coalescedStrips = bands.length - coalesced.length;
    if (coalescedStrips > 0) bands = coalesced;
  }
  if (bands.length > opts.maxCols) {
    return {
      plan: null,
      failure: "too-many-columns",
      detail: `${bands.length} semantic columns is wider than a reader can use`,
    };
  }

  const rows: PlannedRow[] = [];
  // Bottom margin the era drew as a `&nbsp;` row. `classify.ts` already declines
  // to read it as evidence about the table; emitting it would put a row of em
  // dashes under the last record.
  const padding = trailingEmptyRows(grid);

  for (let r = 0; r < grid.rows; r += 1) {
    if (padding.has(r)) continue;
    const partition = rowPartition(grid, r);
    if (partition.length === 0) continue;

    const cells: PlannedCell[] = bands.map(() => ({ sources: [], isHeader: true, isEmpty: true }));

    // A numbered strip is one value however many slots the source drew it in, so
    // it is placed whole into the band it opens in and the boundaries the other
    // rows voted for do not divide it. See {@link ordinalRunsIn}.
    const anchors = partition.map((p) => p.start);
    const inRun = partition.map(() => false);
    for (const run of ordinalRunsIn(partition)) {
      for (let k = run.from; k <= run.to; k += 1) {
        anchors[k] = anchors[run.from] as number;
        inRun[k] = k > run.from;
      }
    }

    for (const [index, part] of partition.entries()) {
      const anchor = anchors[index] as number;
      const bandIndex = bands.findIndex((b) => anchor >= b.start && anchor < b.end);
      if (bandIndex < 0) {
        return {
          plan: null,
          failure: "cell-crosses-band",
          detail: `cell ${part.cell.id} starts at slot ${part.start}, outside every inferred band`,
        };
      }
      const band = bands[bandIndex] as { start: number; end: number };
      // A cell may end past its band only when it ends at the table edge — a
      // trailing colspan filler. Anything else genuinely straddles two columns
      // and cannot be represented without inventing a merge.
      if (!inRun[index] && part.end > band.end && part.end !== grid.cols) {
        return {
          plan: null,
          failure: "cell-crosses-band",
          detail: `cell ${part.cell.id} covers slots ${part.start}–${part.end - 1}, crossing the band ending at ${band.end}`,
        };
      }
      if (!isInlineable(part.cell.node)) {
        return {
          plan: null,
          failure: "cell-needs-blocks",
          detail: `cell ${part.cell.id} contains block structure a table cell cannot hold`,
        };
      }

      const target = cells[bandIndex] as PlannedCell;
      target.sources.push(part.cell);
      if (!part.cell.isHeader) target.isHeader = false;
      if (!part.cell.isEmpty) target.isEmpty = false;
    }

    for (const cell of cells) if (cell.sources.length === 0) cell.isHeader = false;
    rows.push({ cells, row: r });
  }

  if (rows.length < opts.minRows) {
    return { plan: null, failure: "no-body", detail: `only ${rows.length} usable row(s)` };
  }

  // Long prose in more than one column of the same row is a layout table wearing
  // a grid: rendering it as a table produces columns nobody can read.
  const proseRows = rows.filter(
    (row) => row.cells.filter((c) => textLengthOf(c) > 180).length > 1,
  ).length;
  if (proseRows > 0) {
    return {
      plan: null,
      failure: "prose-matrix",
      detail: `${proseRows} row(s) carry long prose in more than one column`,
    };
  }

  // A column that is mostly bare pictures is a *lane*, not a column of values.
  // §16.1 maps text beside a cover to `columns`, and the distinction is real: a
  // record matrix compares values down a column, while a catalog puts an album's
  // cover next to its track list. Forcing the second into a table produces two
  // meaningless headers over a picture strip — which is exactly what a model
  // asked "is this DATA?" will happily agree to.
  for (let band = 0; band < bands.length; band += 1) {
    const column = rows.map((r) => r.cells[band] as PlannedCell).filter((c) => !c.isEmpty);
    if (column.length < 2) continue;
    const pictures = column.filter((c) => isPictureCell(c)).length;
    if (pictures / column.length >= MEDIA_LANE_SHARE) {
      return {
        plan: null,
        failure: "media-lane",
        detail: `column ${band + 1} is ${Math.round((pictures / column.length) * 100)}% bare images: a catalog lane, not a data column`,
      };
    }
  }

  // The same judgement one level up, and a *different* construct: a grid where
  // most cells carry a picture is a gallery — covers, repeated — not a matrix
  // of values and not a lane beside one either, because there is no worded lane
  // left to pair the pictures with. `goya2`'s cover wall is 100 % pictures and
  // its reference writes one `::: images` row, which is what the flow path
  // builds; routing it to lanes instead cost that document 20 findings.
  const populated = rows.flatMap((r) => r.cells).filter((c) => !c.isEmpty);
  const withMedia = populated.filter((c) => c.sources.some((s) => s.images > 0)).length;
  if (populated.length >= 4 && withMedia / populated.length >= 0.5) {
    return {
      plan: null,
      failure: "media-catalog",
      detail: `${Math.round((withMedia / populated.length) * 100)}% of cells carry an image: a media catalog, not a record matrix`,
    };
  }

  const headerRow = rows[0] as PlannedRow;
  const hasRealHeader = headerRow.cells.every((c) => c.isHeader) || looksLikeLabels(rows);

  const header = hasRealHeader ? headerRow : null;
  const body = hasRealHeader ? rows.slice(1) : rows;
  if (body.length === 0) return { plan: null, failure: "no-body", detail: "header row with no body" };

  const kept = occupiedBands(bands, header, body, opts.minCols);
  if (kept.length < bands.length) {
    for (const row of rows) row.cells = kept.map((b) => row.cells[bands.indexOf(b)] as PlannedCell);
  }

  return {
    plan: {
      bands: kept,
      header,
      body,
      headerSynthesized: !hasRealHeader,
      reason:
        `${kept.length} semantic column(s) folded from ${grid.cols} physical slots across ` +
        `${rows.length} row(s)${hasRealHeader ? " with a source header" : " with no source header"}` +
        `${kept.length < bands.length ? `, ${bands.length - kept.length} unoccupied column(s) dropped` : ""}` +
        `${coalescedStrips > 0 ? `, ${coalescedStrips} slot(s) folded into a numbered strip` : ""}`,
    },
    detail: "",
  };
}

/**
 * Columns that hold something. A column no row ever fills is spacing.
 *
 * `analyze/analyze-2.md` asks for this twice: *"последние 2 пустые и поэтому их
 * стоит отфильтровать"*, and *"проверять все row … если все пустые … то такой
 * column можно удалить"*. This era padded a row out to a pixel width with
 * `<td width="12%" align="center"></td>`, and carrying those through produces a
 * header cell over nothing and a column of em dashes in every record.
 *
 * ## Rule contract
 *
 * **Invariant.** Emptiness *in the source* — `PlannedCell.isEmpty`, which is
 * `text === "" && images === 0 && links === 0`. Not the rendered cell, which is
 * where this rule would go wrong: `plannedCellTo` prints an em dash for an empty
 * value, so a column of dashes and a column the author filled with dashes look
 * identical downstream. `segovia` is exactly that false friend — five columns
 * where the second is a literal `-` the author typed between the movement number
 * and its title (`<td class="jr"><p class="jr">-</td>`), and its reference keeps
 * the column. Testing the source rather than the output separates them with no
 * vocabulary of dash characters at all.
 *
 * **Recurrence** is inherent: every row must agree, so one populated cell
 * anywhere in the column keeps it.
 *
 * **A source header keeps its column.** A named column that happens to be empty
 * in this table is a fact the source states, and dropping it would delete the
 * name — §16.3 in the other direction.
 *
 * **Never below `minCols`**, so a table cannot be emptied into a list.
 */
function occupiedBands(
  bands: readonly Band[],
  header: PlannedRow | null,
  body: readonly PlannedRow[],
  minCols: number,
): Band[] {
  const kept = bands.filter((_, band) => {
    if (header && !(header.cells[band] as PlannedCell).isEmpty) return true;
    return body.some((row) => !(row.cells[band] as PlannedCell).isEmpty);
  });
  return kept.length >= minCols && kept.length < bands.length ? kept : [...bands];
}

type Band = { start: number; end: number };

function textLengthOf(cell: PlannedCell): number {
  return cell.sources.reduce((a, c) => a + c.text.length, 0);
}

/** An image with no caption of its own — a cover, not a value. */
/**
 * The share of a column that must be bare pictures for it to be a media lane.
 *
 * Exported so the routing decision downstream asks the *same* question this
 * refusal asked, rather than a similar-looking one with its own number.
 */
export const MEDIA_LANE_SHARE = 0.6;

function isPictureCell(cell: PlannedCell): boolean {
  const images = cell.sources.reduce((a, c) => a + c.images, 0);
  return images > 0 && textLengthOf(cell) < 3;
}

/**
 * Whether the first row reads like column labels rather than like a record.
 *
 * Deliberately strict. Promoting a data row to a header silently deletes it from
 * the table, and every legacy resource matrix in this corpus starts with a real
 * record, so the default answer must be "no".
 */
function looksLikeLabels(rows: readonly PlannedRow[]): boolean {
  const first = rows[0];
  const rest = rows.slice(1);
  if (!first || rest.length < 2) return false;

  // Labels never link anywhere and never carry media.
  for (const cell of first.cells) {
    if (cell.isEmpty) return false;
    if (cell.sources.some((s) => s.links > 0 || s.images > 0)) return false;
    if (textLengthOf(cell) === 0 || textLengthOf(cell) > 60) return false;
  }

  // A header is unlike the rows beneath it. If the body also has link-free short
  // text in every column, the first row is simply the first record.
  const bodyLooksTheSame = rest.every((row) =>
    row.cells.every((c) => c.sources.every((s) => s.links === 0 && s.images === 0)),
  );
  return !bodyLooksTheSame;
}

/**
 * A compact textual rendering of the plan, for a hook payload and for diagnostics.
 */
export function describePlan(plan: LogicalTablePlan, limit = 4): string {
  const lines: string[] = [
    `Semantic shape: ${plan.bands.length} columns × ${plan.body.length} body rows ` +
      `(bands ${plan.bands.map((b) => `${b.start}–${b.end - 1}`).join(" | ")}).`,
  ];
  if (plan.header) {
    lines.push(`Header: ${plan.header.cells.map((c) => JSON.stringify(cellText(c, 30))).join(" | ")}`);
  } else {
    lines.push("Header: none in the source.");
  }
  for (const row of plan.body.slice(0, limit)) {
    lines.push(`  ${row.cells.map((c) => JSON.stringify(cellText(c, 30))).join(" | ")}`);
  }
  if (plan.body.length > limit) lines.push(`  … ${plan.body.length - limit} more rows`);
  return lines.join("\n");
}

export function cellText(cell: PlannedCell, max = Infinity): string {
  const text = cell.sources
    .map((s) => s.text.replace(/\s+/gu, " ").trim())
    .filter((t) => t !== "")
    .join(" ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
