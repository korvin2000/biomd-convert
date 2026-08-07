/**
 * Table classification — Tier 1 (deterministic gates) and Tier 2 (scored).
 *
 * Border presence alone never decides, and neither does its absence (spec
 * §16.2). What decides is the combination of structure, measured geometry and
 * content shape — most of which only became available because Stage 3 rendered
 * the page.
 *
 * Tier 1 fires only on decisive evidence and otherwise abstains. Abstaining is
 * a legitimate answer: a wrong confident classification is far more expensive
 * than an escalation.
 */
import { type GridCell, type TableGrid, columnCells, gridRegularity, rowCells } from "../ladom/grid.js";

export type TableClass = "SHELL" | "LAYOUT" | "DATA" | "HYBRID" | "CATALOG" | "UNKNOWN";

export interface Classification {
  class: TableClass;
  confidence: number;
  tier: 1 | 2 | 3 | 4;
  /** The rule that fired, or the scores that produced the verdict. */
  reason: string;
  scores?: Record<TableClass, number>;
  /** Margin over the runner-up. Low margin means the tier abstained. */
  margin?: number;
}

export interface TableFeatures {
  rows: number;
  cols: number;
  cellCount: number;
  nestedTables: number;
  isNested: boolean;
  rowspanCount: number;
  colspanCount: number;
  gridRegularity: number;
  hasHeaderRow: boolean;
  headerCells: number;
  emptyRatio: number;
  avgTextLen: number;
  maxTextLen: number;
  linkDensity: number;
  imageDensity: number;
  /** Mean similarity between horizontally adjacent cells' content kind. */
  neighbourCellSimilarity: number;
  /** Per-column content-kind entropy, low when columns are homogeneous. */
  columnKindEntropy: number;
  /** Measured column widths, empty when the page was not rendered. */
  columnWidths: number[];
  /** Variance of column-width ratios; near zero for equal lanes. */
  columnWidthRatioVariance: number;
  hasBorder: boolean;
  /** Corpus recurrence, 0..1; undefined without a corpus pass. */
  corpusFrequency?: number;
}

type ContentKind = "empty" | "number" | "year" | "shortText" | "longText" | "link" | "image" | "mixed";

function contentKind(cell: GridCell): ContentKind {
  if (cell.isEmpty) return "empty";
  if (cell.images > 0 && cell.text.length < 3) return "image";
  if (cell.links > 0 && cell.text.length < 40) return "link";
  const t = cell.text.trim();
  if (/^\d{4}$/u.test(t)) return "year";
  if (/^[\d\s.,–—-]+$/u.test(t)) return "number";
  if (cell.images > 0 || cell.links > 0) return "mixed";
  return t.length > 80 ? "longText" : "shortText";
}

/**
 * How much of a two-column grid is a picture set beside its matter.
 *
 * Returns the share of content rows in which one cell is a bare picture and the
 * other carries words — the relation that makes a row a *record* rather than
 * two independent cells. 0 when the grid is not two columns wide.
 *
 * This is the evidence the CATALOG gate was reaching for through column widths.
 * A 150 px cover beside a tracklist is a catalog row and is nowhere near equal
 * lanes, so `ratio ≈ 0.5` under-detects it; measured, `new_lagq2` sits at 0.37
 * and `new_blackmore` at 0.18 while both are unmistakable picture pairings.
 */
export function picturePairedRows(grid: TableGrid): number {
  if (grid.cols !== 2) return 0;
  let content = 0;
  let paired = 0;
  for (let r = 0; r < grid.rows; r += 1) {
    const row = rowCells(grid, r);
    if (row.length !== 2) continue;
    const kinds = row.map(contentKind);
    if (kinds.every((k) => k === "empty")) continue;
    content += 1;
    const pictures = kinds.filter((k) => k === "image").length;
    const worded = kinds.filter((k) => k === "shortText" || k === "longText" || k === "link" || k === "mixed").length;
    if (pictures === 1 && worded === 1) paired += 1;
  }
  return content > 0 ? paired / content : 0;
}

export function extractFeatures(grid: TableGrid, corpusFrequency?: number): TableFeatures {
  const cells = grid.cells;
  const cellCount = cells.length;
  const empty = cells.filter((c) => c.isEmpty).length;
  const textLens = cells.map((c) => c.text.length);
  const links = cells.reduce((a, c) => a + c.links, 0);
  const images = cells.reduce((a, c) => a + c.images, 0);

  const firstRow = grid.rows > 0 ? rowCells(grid, 0) : [];
  const headerCells = cells.filter((c) => c.isHeader).length;
  const hasHeaderRow =
    firstRow.length >= 2 && (firstRow.every((c) => c.isHeader) || headerCells >= firstRow.length);

  // Neighbour similarity: in a genuine data table a cell resembles the cell
  // beside it far less than the cell above it. Comparing horizontally is the
  // discriminative direction.
  let pairs = 0;
  let similar = 0;
  for (let r = 0; r < grid.rows; r += 1) {
    const row = rowCells(grid, r);
    for (let i = 0; i + 1 < row.length; i += 1) {
      const a = row[i];
      const b = row[i + 1];
      if (!a || !b) continue;
      pairs += 1;
      if (contentKind(a) === contentKind(b)) similar += 1;
    }
  }
  const neighbourCellSimilarity = pairs > 0 ? similar / pairs : 0;

  // Column homogeneity: a data column holds one kind of thing all the way down.
  let entropySum = 0;
  let countedColumns = 0;
  const columnWidths: number[] = [];
  for (let c = 0; c < grid.cols; c += 1) {
    const col = columnCells(grid, c);
    if (col.length === 0) continue;
    countedColumns += 1;
    const dist = new Map<ContentKind, number>();
    for (const cell of col) dist.set(contentKind(cell), (dist.get(contentKind(cell)) ?? 0) + 1);
    let h = 0;
    for (const n of dist.values()) {
      const p = n / col.length;
      h -= p * Math.log2(p);
    }
    entropySum += h;
    const width = col[0]?.node.box?.w;
    if (typeof width === "number") columnWidths.push(width);
  }
  const columnKindEntropy = countedColumns > 0 ? entropySum / countedColumns : 0;

  let columnWidthRatioVariance = 0;
  if (columnWidths.length >= 2) {
    const total = columnWidths.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const ratios = columnWidths.map((w) => w / total);
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      columnWidthRatioVariance = ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length;
    }
  }

  const borderAttr = Number.parseInt(grid.node.attrs["border"] ?? "0", 10);
  const hasBorder =
    (Number.isFinite(borderAttr) && borderAttr > 0) ||
    (grid.node.style?.borderTopWidth ?? 0) > 0 ||
    cells.some((c) => (c.node.style?.borderTopWidth ?? 0) > 0);

  const features: TableFeatures = {
    rows: grid.rows,
    cols: grid.cols,
    cellCount,
    nestedTables: grid.nestedTableIds.length,
    isNested: grid.parentTableId !== null,
    rowspanCount: cells.filter((c) => c.rowSpan > 1).length,
    colspanCount: cells.filter((c) => c.colSpan > 1).length,
    gridRegularity: gridRegularity(grid),
    hasHeaderRow,
    headerCells,
    emptyRatio: cellCount > 0 ? empty / cellCount : 0,
    avgTextLen: cellCount > 0 ? textLens.reduce((a, b) => a + b, 0) / cellCount : 0,
    maxTextLen: textLens.length > 0 ? Math.max(...textLens) : 0,
    linkDensity: cellCount > 0 ? links / cellCount : 0,
    imageDensity: cellCount > 0 ? images / cellCount : 0,
    neighbourCellSimilarity,
    columnKindEntropy,
    columnWidths,
    columnWidthRatioVariance,
    hasBorder,
  };
  if (corpusFrequency !== undefined) features.corpusFrequency = corpusFrequency;
  return features;
}

/**
 * Tier 1 — deterministic gates.
 *
 * Each returns a verdict only on decisive evidence. Returning null is the
 * common and correct outcome for anything interesting.
 */
export function classifyTier1(grid: TableGrid, f: TableFeatures): Classification | null {
  // Corpus chrome: the same structure with the same text on most pages.
  if ((f.corpusFrequency ?? 0) > 0.7) {
    return { class: "SHELL", confidence: 0.95, tier: 1, reason: "structure recurs on >70% of corpus pages" };
  }

  // A single-cell table is a wrapper, not a table.
  if (f.rows === 1 && f.cols === 1) {
    return { class: "LAYOUT", confidence: 0.97, tier: 1, reason: "single cell: a layout wrapper" };
  }
  const nonEmpty = grid.cells.filter((c) => !c.isEmpty);
  if (nonEmpty.length === 1 && f.cellCount > 1) {
    return {
      class: "LAYOUT",
      confidence: 0.9,
      tier: 1,
      reason: "exactly one content cell; the rest are spacers",
    };
  }

  // Explicit header semantics over a real grid.
  if (f.hasHeaderRow && f.rows >= 3 && f.cols >= 2 && f.maxTextLen < 400) {
    return { class: "DATA", confidence: 0.93, tier: 1, reason: "explicit header row over a ≥3×2 grid" };
  }

  // A column that is entirely single links of one resource class is a resource
  // matrix — the discography/tab tables this corpus is full of.
  for (let c = 0; c < grid.cols; c += 1) {
    const col = columnCells(grid, c).filter((cell) => !cell.isEmpty);
    if (col.length < 3) continue;
    if (col.every((cell) => cell.links === 1 && cell.text.length < 40)) {
      return {
        class: "DATA",
        confidence: 0.88,
        tier: 1,
        reason: `column ${c + 1} is entirely single short links: a resource matrix`,
      };
    }
  }

  // Uniform short rows.
  if (f.rows >= 3 && f.gridRegularity === 1 && f.maxTextLen < 80 && f.cols >= 2 && f.emptyRatio < 0.2) {
    return {
      class: "DATA",
      confidence: 0.85,
      tier: 1,
      reason: "uniform grid of short cells with no holes",
    };
  }

  // Prose in more than one cell of a nested table is layout scaffolding.
  if (f.nestedTables > 0) {
    const prosey = grid.cells.filter((c) => c.text.length > 120).length;
    if (prosey > 1) {
      return {
        class: "HYBRID",
        confidence: 0.8,
        tier: 1,
        reason: "nested tables with prose in more than one cell",
      };
    }
  }

  // Two measured lanes of near-equal width, each carrying an image and a list,
  // recurring down the table: the two-column catalog.
  if (f.cols === 2 && f.rows >= 2 && f.columnWidths.length === 2) {
    const [a = 0, b = 0] = f.columnWidths;
    const ratio = a + b > 0 ? a / (a + b) : 0;
    if (ratio >= 0.45 && ratio <= 0.55 && f.imageDensity > 0.3) {
      return {
        class: "CATALOG",
        confidence: 0.85,
        tier: 1,
        reason: `two measured lanes at ${(ratio * 100).toFixed(0)}/${(100 - ratio * 100).toFixed(0)} carrying media`,
      };
    }
  }

  // The same catalog, evidenced by the pairing instead of by the widths.
  //
  // **Invariant.** Every content row of a two-column grid sets a bare picture
  // beside worded matter. That relation — one cell is the picture *of* what the
  // other says — is what makes the row a record; the near-equal widths the gate
  // above asks for are a consequence that a cover beside a tracklist simply
  // does not have. Measured: `new_lagq2` pairs 7 of 7 rows at a 37/63 split and
  // scored DATA, then fell to linear flow because a DATA verdict that cannot be
  // planned is not reconsidered — so its reference's six `::: columns` came out
  // as loose prose. Classification, not routing, was the thing that was wrong.
  //
  // **Recurrence requirement.** Two paired rows, with the grid's own row
  // boundary between them. A single picture beside a single line is a figure
  // over its caption, and `media.ts` binds those far better than a lane pair
  // would: it is the named false friend and it is tested for non-firing.
  //
  // Deliberately *after* the tier-1 DATA gates: a resource matrix that happens
  // to carry thumbnails is still a resource matrix.
  if (f.cols === 2 && grid.rows >= 2) {
    const paired = picturePairedRows(grid);
    if (paired === 1) {
      return {
        class: "CATALOG",
        confidence: 0.85,
        tier: 1,
        reason: "every content row pairs a picture with its matter",
      };
    }
  }

  return null;
}

/**
 * Tier 2 — a scored classifier over the full feature vector.
 *
 * Hand-weighted to start. The weights are a hypothesis to be replaced by a
 * model trained on review labels once they exist; what matters architecturally
 * is that the output is a distribution with a margin, so the caller can tell
 * "confidently layout" from "no idea".
 */
export function classifyTier2(f: TableFeatures): Classification {
  const scores: Record<TableClass, number> = {
    SHELL: 0,
    LAYOUT: 0,
    DATA: 0,
    HYBRID: 0,
    CATALOG: 0,
    UNKNOWN: 0.15, // a floor, so a featureless table lands on UNKNOWN
  };

  // DATA evidence.
  scores.DATA += f.hasHeaderRow ? 0.35 : 0;
  scores.DATA += f.gridRegularity > 0.95 ? 0.2 : 0;
  scores.DATA += f.neighbourCellSimilarity < 0.5 ? 0.15 : 0; // columns differ from each other
  scores.DATA += f.columnKindEntropy < 0.6 ? 0.2 : 0; // but each column is homogeneous
  scores.DATA += f.rows >= 3 && f.cols >= 2 ? 0.15 : 0;
  scores.DATA += f.maxTextLen < 120 ? 0.1 : -0.2;
  scores.DATA += f.hasBorder ? 0.05 : 0;
  scores.DATA -= f.nestedTables > 0 ? 0.35 : 0;
  scores.DATA -= f.emptyRatio > 0.35 ? 0.25 : 0;

  // LAYOUT evidence.
  scores.LAYOUT += f.nestedTables > 0 ? 0.35 : 0;
  scores.LAYOUT += f.emptyRatio > 0.35 ? 0.2 : 0;
  scores.LAYOUT += f.maxTextLen > 300 ? 0.25 : 0;
  scores.LAYOUT += f.gridRegularity < 0.8 ? 0.15 : 0;
  scores.LAYOUT += !f.hasBorder && !f.hasHeaderRow ? 0.15 : 0;
  scores.LAYOUT += f.rows <= 2 ? 0.15 : 0;
  scores.LAYOUT += f.colspanCount + f.rowspanCount > f.rows ? 0.15 : 0;
  scores.LAYOUT -= f.hasHeaderRow ? 0.3 : 0;

  // SHELL evidence.
  scores.SHELL += (f.corpusFrequency ?? 0) * 0.8;
  scores.SHELL += f.avgTextLen < 8 && f.cellCount > 3 ? 0.2 : 0;
  scores.SHELL += f.imageDensity > 0.6 && f.avgTextLen < 5 ? 0.2 : 0;

  // CATALOG evidence.
  if (f.cols === 2 && f.columnWidths.length === 2) {
    const [a = 0, b = 0] = f.columnWidths;
    const ratio = a + b > 0 ? a / (a + b) : 0;
    scores.CATALOG += ratio >= 0.42 && ratio <= 0.58 ? 0.4 : 0;
  }
  scores.CATALOG += f.imageDensity > 0.3 && f.cols === 2 && f.rows >= 2 ? 0.3 : 0;
  scores.CATALOG += f.columnWidthRatioVariance < 0.01 && f.cols === 2 ? 0.1 : 0;

  // HYBRID evidence: data-like and layout-like at once.
  scores.HYBRID += f.hasHeaderRow && f.nestedTables > 0 ? 0.4 : 0;
  scores.HYBRID += f.imageDensity > 0.2 && f.hasHeaderRow ? 0.2 : 0;
  scores.HYBRID += f.maxTextLen > 200 && f.gridRegularity > 0.9 && f.cols >= 2 ? 0.2 : 0;

  const ranked = (Object.entries(scores) as Array<[TableClass, number]>).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const best = top ?? (["UNKNOWN", 0] as [TableClass, number]);
  const margin = best[1] - (second?.[1] ?? 0);

  // A thin margin is not a verdict. Escalate rather than commit.
  const cls: TableClass = margin < 0.15 ? "UNKNOWN" : best[0];
  return {
    class: cls,
    confidence: Math.max(0, Math.min(1, best[1])),
    tier: 2,
    reason:
      cls === "UNKNOWN"
        ? `margin ${margin.toFixed(2)} below threshold between ${best[0]} and ${second?.[0]}; abstaining`
        : `scored ${best[0]} at ${best[1].toFixed(2)} with margin ${margin.toFixed(2)}`,
    scores,
    margin,
  };
}

/** Run the deterministic tiers in order. */
export function classifyTable(grid: TableGrid, corpusFrequency?: number): Classification {
  const features = extractFeatures(grid, corpusFrequency);
  return classifyTier1(grid, features) ?? classifyTier2(features);
}
