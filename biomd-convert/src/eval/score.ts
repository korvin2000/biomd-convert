/**
 * Similarity between a produced `.bio.md` and a hand-written reference.
 *
 * The reference set in `fixtures/out/` is what a human decided the conversion
 * *should* look like, on real, malformed, 1998-vintage pages. Text recall alone
 * cannot see the difference between a table and the same words spilled into
 * twenty-seven paragraphs, so the score is deliberately several axes rather than
 * one number, and structure is weighted as heavily as prose.
 *
 * Every axis is an F1 over a multiset, so both loss and invention are penalized.
 * A converter that emits the source twice scores worse, not better.
 */
import { shingles } from "../convert-core/conservation.js";
import { type DocumentFacts, type TableFacts, extractFacts, foldTarget, visibleText } from "./facts.js";
import { foldSilentDirectives } from "./reference-silent.js";

export interface AxisScore {
  recall: number;
  precision: number;
  f1: number;
  expected: number;
  actual: number;
  matched: number;
  /** A few concrete items the output is missing, for the report. */
  missing: string[];
}

export interface DocumentScore {
  name: string;
  text: AxisScore;
  headings: AxisScore;
  links: AxisScore;
  images: AxisScore;
  directives: AxisScore;
  tableCells: AxisScore;
  /** Table count and shape agreement, 0..1. */
  tableShape: number;
  expectedTables: TableFacts[];
  actualTables: TableFacts[];
  /** Weighted overall similarity, 0..1. */
  overall: number;
}

/**
 * Axis weights.
 *
 * Structure carries half the weight between `tableCells`, `tableShape` and
 * `directives`: prose recall was already near-perfect while whole tables were
 * disappearing, which is exactly the blind spot this score exists to close.
 */
export const WEIGHTS = {
  text: 0.3,
  headings: 0.1,
  links: 0.15,
  images: 0.1,
  directives: 0.1,
  tableCells: 0.15,
  tableShape: 0.1,
} as const;

export function scoreDocuments(name: string, expectedSource: string, actualSource: string): DocumentScore {
  const expected = extractFacts(expectedSource);
  const actual = extractFacts(actualSource);

  const text = shingleScore(visibleText(expected), visibleText(actual));
  const headings = multisetScore(expected.headings, actual.headings);
  const links = multisetScore(expected.links.map(foldTarget), actual.links.map(foldTarget));
  const images = multisetScore(expected.images.map(foldTarget), actual.images.map(foldTarget));
  // A construct the reference tier predates is excluded from the inventory on
  // *both* sides, per document, and only while that reference stays silent about
  // it — see `reference-silent.ts` for why that is a truthfulness fix and not a
  // thumb on the scale.
  const inventory = foldSilentDirectives(expected.directives, actual.directives);
  const directives = multisetScore(inventory.expected, inventory.actual);
  const tableCells = multisetScore(
    expected.tables.flatMap((t) => t.cells),
    actual.tables.flatMap((t) => t.cells),
  );
  const tableShape = shapeAgreement(expected.tables, actual.tables);

  const overall =
    text.f1 * WEIGHTS.text +
    headings.f1 * WEIGHTS.headings +
    links.f1 * WEIGHTS.links +
    images.f1 * WEIGHTS.images +
    directives.f1 * WEIGHTS.directives +
    tableCells.f1 * WEIGHTS.tableCells +
    tableShape * WEIGHTS.tableShape;

  return {
    name,
    text,
    headings,
    links,
    images,
    directives,
    tableCells,
    tableShape,
    expectedTables: expected.tables,
    actualTables: actual.tables,
    overall,
  };
}

export function multisetScore(expected: readonly string[], actual: readonly string[]): AxisScore {
  const want = new Map<string, number>();
  for (const item of expected) want.set(item, (want.get(item) ?? 0) + 1);

  let matched = 0;
  const remaining = new Map(want);
  for (const item of actual) {
    const n = remaining.get(item) ?? 0;
    if (n > 0) {
      remaining.set(item, n - 1);
      matched += 1;
    }
  }

  const missing: string[] = [];
  for (const [item, n] of remaining) {
    if (n > 0 && missing.length < 8) missing.push(item);
  }

  return finish(expected.length, actual.length, matched, missing);
}

function shingleScore(expected: string, actual: string): AxisScore {
  const want = shingles(expected, 5);
  const have = shingles(actual, 5);

  let total = 0;
  let matched = 0;
  const missing: string[] = [];
  for (const [key, count] of want) {
    total += count;
    const found = Math.min(count, have.get(key) ?? 0);
    matched += found;
    if (found < count && missing.length < 8) missing.push(key);
  }
  let actualTotal = 0;
  for (const count of have.values()) actualTotal += count;

  return finish(total, actualTotal, matched, missing);
}

function finish(expected: number, actual: number, matched: number, missing: string[]): AxisScore {
  const recall = expected === 0 ? 1 : matched / expected;
  const precision = actual === 0 ? (expected === 0 ? 1 : 0) : matched / actual;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { recall, precision, f1, expected, actual, matched, missing };
}

/**
 * How well the emitted tables match the reference tables in count and shape.
 *
 * Greedy pairing by cell overlap, then a per-pair shape score over column count
 * and row count. Unpaired tables on either side score zero, so both a lost table
 * and an invented one are visible.
 */
function shapeAgreement(expected: readonly TableFacts[], actual: readonly TableFacts[]): number {
  if (expected.length === 0 && actual.length === 0) return 1;
  if (expected.length === 0 || actual.length === 0) return 0;

  const used = new Set<number>();
  let sum = 0;

  for (const want of expected) {
    let bestIndex = -1;
    let bestOverlap = 0;
    actual.forEach((have, index) => {
      if (used.has(index)) return;
      const overlap = cellOverlap(want.cells, have.cells);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) continue;
    used.add(bestIndex);
    const have = actual[bestIndex] as TableFacts;
    sum += ratio(want.cols, have.cols) * 0.5 + ratio(want.rows, have.rows) * 0.5;
  }

  // Denominator counts every table on both sides, so an extra table dilutes.
  return sum / Math.max(expected.length, actual.length);
}

function cellOverlap(a: readonly string[], b: readonly string[]): number {
  const set = new Set(b);
  let n = 0;
  for (const item of a) if (set.has(item)) n += 1;
  return n;
}

function ratio(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  if (a === 0 || b === 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

export function scoreDocumentSources(
  files: ReadonlyArray<{ name: string; expected: string; actual: string }>,
): { documents: DocumentScore[]; overall: number } {
  const documents = files.map((f) => scoreDocuments(f.name, f.expected, f.actual));
  const overall =
    documents.length === 0 ? 0 : documents.reduce((a, d) => a + d.overall, 0) / documents.length;
  return { documents, overall };
}
