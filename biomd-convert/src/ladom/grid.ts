/**
 * Table grid materialization.
 *
 * A `<table>` has two coordinate systems that legacy-HTML analysis constantly
 * conflates: the DOM order of origin cells, and the visual occupancy grid that
 * `rowspan`/`colspan` produce. Almost every table question worth asking — "are
 * these two cells in the same row?", "what is in column 3?", "is this grid
 * regular?" — is trivial in the second system and guesswork in the first.
 *
 * This implements the HTML table model's slot assignment. Covered slots point
 * back at their origin cell and are marked non-origin, so a spanned value is
 * never counted twice: duplicating it would corrupt both the record extraction
 * and the conservation check.
 */
import { type LadomNode, textOf, walkElements } from "./types.js";

export interface GridSlot {
  row: number;
  col: number;
  /** The cell that owns this slot. */
  originId: string;
  /** False when this slot is covered by a span originating elsewhere. */
  isOrigin: boolean;
  /** Offset from the origin cell, 0/0 for the origin itself. */
  rowOffset: number;
  colOffset: number;
}

export interface GridCell {
  id: string;
  node: LadomNode;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** `th` or an explicit `scope`/`headers` attribute. */
  isHeader: boolean;
  text: string;
  links: number;
  images: number;
  /** True when the cell has no text, no media and no link. */
  isEmpty: boolean;
}

export interface TableGrid {
  id: string;
  node: LadomNode;
  rows: number;
  cols: number;
  /** `rows` × `cols`; null where a ragged source left a hole. */
  slots: (GridSlot | null)[][];
  /** Origin cells in DOM order. */
  cells: GridCell[];
  /** Tables nested inside this one, innermost handled first by callers. */
  nestedTableIds: string[];
  /** Id of the enclosing table, when this one is nested. */
  parentTableId: string | null;
  captionText: string | null;
  warnings: string[];
}

/** Guards against a hostile or corrupt span value exhausting memory. */
const MAX_SPAN = 1000;
const MAX_CELLS = 100_000;

function intAttr(node: LadomNode, name: string, fallback: number): number {
  const raw = node.attrs[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const CELL_TAGS = new Set(["td", "th"]);
const ROW_GROUP_TAGS = new Set(["thead", "tbody", "tfoot"]);

/** Rows belonging to this table, excluding rows of nested tables. */
function ownRows(table: LadomNode): LadomNode[] {
  const rows: LadomNode[] = [];
  const visit = (node: LadomNode): void => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      if (child.tag === "table") continue; // a nested table owns its own rows
      if (child.tag === "tr") {
        rows.push(child);
        continue;
      }
      if (ROW_GROUP_TAGS.has(child.tag) || child.tag === "form" || child.tag === "div") {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

/** Cells belonging to this row, excluding cells of nested tables. */
function ownCells(row: LadomNode): LadomNode[] {
  const cells: LadomNode[] = [];
  const visit = (node: LadomNode): void => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      if (child.tag === "table") continue;
      if (CELL_TAGS.has(child.tag)) {
        cells.push(child);
        continue;
      }
      if (child.tag === "form" || child.tag === "div") visit(child);
    }
  };
  visit(row);
  return cells;
}

export function materializeGrid(table: LadomNode, parentTableId: string | null = null): TableGrid {
  const warnings: string[] = [];
  const rows = ownRows(table);
  const cells: GridCell[] = [];

  // occupancy[row][col] — filled as spans are laid down.
  const occupancy: (GridSlot | null)[][] = [];
  const ensureRow = (r: number): (GridSlot | null)[] => {
    while (occupancy.length <= r) occupancy.push([]);
    return occupancy[r] as (GridSlot | null)[];
  };

  let totalSlots = 0;

  rows.forEach((rowNode, rowIndex) => {
    const rowCells = ownCells(rowNode);
    let col = 0;

    for (const cellNode of rowCells) {
      const rowArray = ensureRow(rowIndex);
      // Skip columns already covered by a span from an earlier row.
      while (rowArray[col] != null) col += 1;

      let rowSpan = intAttr(cellNode, "rowspan", 1);
      let colSpan = intAttr(cellNode, "colspan", 1);

      // rowspan="0" means "to the end of the row group"; treat it as the
      // remaining rows, which is what a browser does for the common case.
      if (rowSpan === 0) rowSpan = Math.max(1, rows.length - rowIndex);
      if (colSpan === 0) colSpan = 1;

      if (rowSpan > MAX_SPAN || colSpan > MAX_SPAN) {
        warnings.push(
          `Cell ${cellNode.id} declares rowspan=${rowSpan} colspan=${colSpan}; clamped to ${MAX_SPAN}.`,
        );
        rowSpan = Math.min(rowSpan, MAX_SPAN);
        colSpan = Math.min(colSpan, MAX_SPAN);
      }

      totalSlots += rowSpan * colSpan;
      if (totalSlots > MAX_CELLS) {
        warnings.push(`Table ${table.id} exceeds ${MAX_CELLS} slots; span expansion truncated.`);
        rowSpan = 1;
        colSpan = 1;
      }

      const text = textOf(cellNode);
      const cell: GridCell = {
        id: cellNode.id,
        node: cellNode,
        row: rowIndex,
        col,
        rowSpan,
        colSpan,
        isHeader: cellNode.tag === "th" || "scope" in cellNode.attrs,
        text,
        links: cellNode.metrics.links,
        images: cellNode.metrics.images,
        isEmpty: text === "" && cellNode.metrics.images === 0 && cellNode.metrics.links === 0,
      };
      cells.push(cell);

      for (let dr = 0; dr < rowSpan; dr += 1) {
        const target = ensureRow(rowIndex + dr);
        for (let dc = 0; dc < colSpan; dc += 1) {
          const c = col + dc;
          if (target[c] != null) {
            warnings.push(
              `Overlapping span at row ${rowIndex + dr}, column ${c} (cell ${cellNode.id}); first cell kept.`,
            );
            continue;
          }
          target[c] = {
            row: rowIndex + dr,
            col: c,
            originId: cellNode.id,
            // Only the top-left slot is the origin; every other slot is covered
            // and must never be read as if the source repeated the content.
            isOrigin: dr === 0 && dc === 0,
            rowOffset: dr,
            colOffset: dc,
          };
        }
      }

      col += colSpan;
    }
  });

  const cols = occupancy.reduce((max, row) => Math.max(max, row.length), 0);
  // Pad ragged rows with explicit holes so indexing is total.
  const slots: (GridSlot | null)[][] = occupancy.map((row) => {
    const padded = row.slice();
    while (padded.length < cols) padded.push(null);
    return padded;
  });

  const nestedTableIds: string[] = [];
  for (const el of walkElements(table)) {
    if (el === table || el.tag !== "table") continue;
    // Only direct descendants relative to this table, i.e. not inside a deeper table.
    let ancestor = el.parent;
    let nearest: LadomNode | null = null;
    while (ancestor) {
      if (ancestor.tag === "table") {
        nearest = ancestor;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (nearest === table) nestedTableIds.push(el.id);
  }

  let captionText: string | null = null;
  for (const el of walkElements(table)) {
    if (el.tag === "caption") {
      captionText = textOf(el);
      break;
    }
  }

  // Annotate the LADOM nodes so downstream passes can ask a cell for its grid
  // position without carrying the grid around.
  for (const cell of cells) {
    cell.node.grid = { row: cell.row, col: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan };
  }

  return {
    id: table.id,
    node: table,
    rows: slots.length,
    cols,
    slots,
    cells,
    nestedTableIds,
    parentTableId,
    captionText,
    warnings,
  };
}

/** Every table in the document, innermost first, each with its parent recorded. */
export function materializeAllGrids(root: LadomNode): TableGrid[] {
  const tables: LadomNode[] = [];
  for (const el of walkElements(root)) if (el.tag === "table") tables.push(el);

  const parentOf = (table: LadomNode): string | null => {
    let a = table.parent;
    while (a) {
      if (a.tag === "table") return a.id;
      a = a.parent;
    }
    return null;
  };

  const grids = tables.map((t) => materializeGrid(t, parentOf(t)));
  // Innermost first: nesting depth descending. Hybrid decomposition depends on
  // inner tables already being classified when the outer one is examined.
  const depth = (t: TableGrid): number => {
    let d = 0;
    let id = t.parentTableId;
    const byId = new Map(grids.map((g) => [g.id, g]));
    while (id) {
      d += 1;
      id = byId.get(id)?.parentTableId ?? null;
    }
    return d;
  };
  return grids.sort((a, b) => depth(b) - depth(a));
}

/** Origin cell at a grid position, or null for a hole. */
export function cellAt(grid: TableGrid, row: number, col: number): GridCell | null {
  const slot = grid.slots[row]?.[col];
  if (!slot) return null;
  return grid.cells.find((c) => c.id === slot.originId) ?? null;
}

/** Origin cells of a visual row, left to right, each appearing once. */
export function rowCells(grid: TableGrid, row: number): GridCell[] {
  const seen = new Set<string>();
  const out: GridCell[] = [];
  for (const slot of grid.slots[row] ?? []) {
    if (!slot || seen.has(slot.originId)) continue;
    seen.add(slot.originId);
    const cell = grid.cells.find((c) => c.id === slot.originId);
    if (cell) out.push(cell);
  }
  return out;
}

/**
 * The maximal run of wholly empty rows at the end of the grid.
 *
 * A geometric fact, not a rule: these rows hold nothing and have nothing after
 * them, so whatever they are they are not records and not separators either.
 * Rows covered by a `rowspan` are never in the run — {@link rowCells} reports
 * the covering cell in every row it spans. The whole grid is never returned; a
 * table of nothing but empty rows keeps them, so no caller is handed zero rows.
 *
 * The judgement built on it — *the era closed a table with a `&nbsp;` row to put
 * space under it* — lives with its callers in `classify.ts` and `data-table.ts`.
 */
export function trailingEmptyRows(grid: TableGrid): Set<number> {
  const rows = new Set<number>();
  for (let r = grid.rows - 1; r > 0; r -= 1) {
    const row = rowCells(grid, r);
    if (row.length === 0 || !row.every((c) => c.isEmpty)) break;
    rows.add(r);
  }
  return rows;
}

/** Origin cells of a visual column, top to bottom, each appearing once. */
export function columnCells(grid: TableGrid, col: number): GridCell[] {
  const seen = new Set<string>();
  const out: GridCell[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const slot = grid.slots[r]?.[col];
    if (!slot || seen.has(slot.originId)) continue;
    seen.add(slot.originId);
    const cell = grid.cells.find((c) => c.id === slot.originId);
    if (cell) out.push(cell);
  }
  return out;
}

/**
 * Fraction of grid positions actually occupied, 0..1.
 *
 * A genuine record matrix is close to 1; a layout scaffold full of spacers and
 * spans is not.
 */
export function gridRegularity(grid: TableGrid): number {
  if (grid.rows === 0 || grid.cols === 0) return 0;
  let filled = 0;
  for (const row of grid.slots) for (const slot of row) if (slot) filled += 1;
  return filled / (grid.rows * grid.cols);
}
