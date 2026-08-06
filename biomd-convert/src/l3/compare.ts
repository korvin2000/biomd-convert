/**
 * L3 — rendered and geometric adjudication.
 *
 * Turns three probed surfaces into *localized findings*, never a score. The
 * surfaces are the source `.htm`, the produced `.bio.md` and the reference
 * `.bio.md`, the latter two rendered by the one function in `render.ts`.
 *
 * What L3 can see that L2 cannot, and why each needs a browser:
 *
 *  - **alignment as rendered.** L2 compares `::: align` directives. It cannot
 *    tell that a produced paragraph is centred anyway because an ancestor
 *    centres it, nor that a reference `::: align position: center` around a
 *    figure changes nothing because `image.position` already won (§13). Only
 *    the computed value settles it.
 *  - **containment as laid out.** L2 compares the directive tree. Two different
 *    trees can produce the same reading, and identical trees can lay out
 *    differently once a float or a grid is involved.
 *  - **lanes.** Whether a region reads as one persistent lane or as one pair per
 *    row is a fact about boxes, not about nesting.
 *  - **overflow.** §14 requires content to stay inside the article measure.
 *    Nothing else in the ladder measures it at all.
 *  - **source backing for a layout claim.** Whether the *source* actually
 *    centres a block is a question about the source's computed style, and it is
 *    the only honest way to separate "the converter missed evidence" from "the
 *    migrator editorialized".
 *
 * Findings are shaped like L2's so they land in the same ledger, with the extra
 * geometric evidence attached. Advisory rank and severity follow L2's
 * conventions. Diagnostic-only.
 */
import { type Alignment, type Box, alignmentVerdict, lanesOf, normalizeTextAlign, proseAlignment, readingRanks } from "./geometry.js";
import type { BlockGeometry, PageProbe } from "./probe.js";

export type Severity = "critical" | "major" | "minor";

export interface L3Finding {
  id: string;
  doc: string;
  class: string;
  severity: Severity;
  /** Always `structure`: geometry never invents text, so §16.3 never applies. */
  evidence: "structure";
  op: "insert" | "delete" | "move" | "substitute";
  path: string;
  producedLine: number | null;
  referenceLine: number | null;
  produced: string | null;
  reference: string | null;
  /** The measurement behind the finding, so it can be checked without re-running. */
  geometry: Record<string, string | number | null>;
}

/**
 * One row of the alignment evidence table.
 *
 * This is the artifact the alignment task is decided from. Every column is a
 * measurement, and the three pre-registered hypotheses in PROGRESS §8.1 are all
 * answered by counting rows rather than by reading code:
 *
 *  - H1 (the evidence is read wrongly) — count rows whose `sourceTextAlignRaw`
 *    carries a `-webkit-` prefix;
 *  - H2 (a missing `right` path) — count rows by `referenceAlignment`;
 *  - H3 (the reference editorializes) — count rows where the source computes to
 *    the page's own prose alignment, i.e. `sourceDistinctive` is false.
 */
export interface AlignmentEvidence {
  doc: string;
  producedLine: number | null;
  referenceLine: number | null;
  text: string;
  producedAlignment: Alignment;
  referenceAlignment: Alignment;
  /** Verbatim computed value from the source node. The `-webkit-` falsifier. */
  sourceTextAlignRaw: string | null;
  sourceAlignment: Alignment;
  /** The source page's own prose alignment — the baseline. */
  sourceProse: Alignment;
  /** Whether the source node's alignment differs from that page's prose. */
  sourceDistinctive: boolean;
  /** The source node path, so the converter can look it up by id. */
  sourcePath: string | null;
}

export interface L3Result {
  doc: string;
  findings: L3Finding[];
  alignment: AlignmentEvidence[];
  /** Populated when a surface could not be probed; findings are then partial. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface CompareInput {
  doc: string;
  produced: PageProbe;
  reference: PageProbe;
  /** Optional: without it, no alignment row can be source-backed. */
  source: PageProbe | null;
}

export function compareRendered(input: CompareInput): L3Result {
  const { doc, produced, reference, source } = input;
  const findings: L3Finding[] = [];
  const notes: string[] = [];
  if (source === null) notes.push("No source probe: alignment rows carry no source backing and H3 cannot be tested.");

  const producedBlocks = comparable(produced);
  const referenceBlocks = comparable(reference);
  const pairs = pairBlocks(producedBlocks, referenceBlocks);

  const producedProse = proseOf(produced);
  const referenceProse = proseOf(reference);
  const sourceProse = source ? proseOf(source) : "unknown";

  // Lane index per side, computed over the paired blocks only, so a block the
  // other side does not have cannot shift every lane number after it.
  const producedLanes = laneIndex(pairs.map((p) => p.produced));
  const referenceLanes = laneIndex(pairs.map((p) => p.reference));

  const alignment: AlignmentEvidence[] = [];

  pairs.forEach((pair, k) => {
    const p = pair.produced;
    const r = pair.reference;
    if (!p || !r) return; // presence is L2's question; L3 only judges what both sides render

    const path = r.path;
    const pv = alignmentVerdict(p.textAlign, p.box, p.container, producedProse);
    const rv = alignmentVerdict(r.textAlign, r.box, r.container, referenceProse);

    // --- alignment -------------------------------------------------------
    if (pv.alignment !== rv.alignment && (pv.distinctive || rv.distinctive)) {
      findings.push(
        make(doc, "layout.align.mismatch", "major", "substitute", path, p, r, {
          producedAlign: pv.alignment,
          referenceAlign: rv.alignment,
          producedRaw: p.textAlign,
          referenceRaw: r.textAlign,
          producedEvidence: pv.evidence,
          referenceEvidence: rv.evidence,
          producedProse,
          referenceProse,
        }),
      );
    }

    // The evidence table records every block either side aligns distinctively,
    // whether or not the two sides disagree: a row where both agree is what
    // makes a disagreement rate meaningful.
    if (pv.distinctive || rv.distinctive) {
      const src = source ? findSourceNode(source, r.text, r.imageName ?? p.imageName) : null;
      const sourceAlign = src ? normalizeTextAlign(src.textAlign) : "unknown";
      alignment.push({
        doc,
        producedLine: p.line,
        referenceLine: r.line,
        text: truncate(r.text, 90),
        producedAlignment: pv.alignment,
        referenceAlignment: rv.alignment,
        sourceTextAlignRaw: src ? src.textAlign : null,
        sourceAlignment: sourceAlign,
        sourceProse,
        sourceDistinctive: src ? isDistinctiveAgainst(sourceAlign, sourceProse) : false,
        sourcePath: src ? src.path : null,
      });
    }

    // --- containment -----------------------------------------------------
    // Compared as the chain of block *kinds*, not paths: an index shift is not a
    // containment defect, and comparing raw paths would report one for every
    // block after any insertion.
    const pChain = kindChain(p, producedBlocks);
    const rChain = kindChain(r, referenceBlocks);
    if (pChain !== rChain) {
      findings.push(
        make(doc, "layout.containment.mismatch", "major", "move", path, p, r, {
          producedContainer: pChain || "(root)",
          referenceContainer: rChain || "(root)",
        }),
      );
    }

    // --- lanes -----------------------------------------------------------
    const pl = producedLanes[k];
    const rl = referenceLanes[k];
    if (pl !== undefined && rl !== undefined && pl !== rl) {
      findings.push(
        make(doc, "layout.lane.mismatch", "major", "move", path, p, r, {
          producedLane: pl,
          referenceLane: rl,
        }),
      );
    }

    // --- overflow --------------------------------------------------------
    // Only a *new* overflow is a finding. The reference overflowing too means
    // the shape overflows, which is a renderer question, not a converter one.
    if (p.overflow > 1 && p.overflow > r.overflow + 1) {
      findings.push(
        make(doc, "layout.overflow", "major", "substitute", path, p, r, {
          producedOverflowPx: p.overflow,
          referenceOverflowPx: r.overflow,
          articleWidth: produced.article.w,
        }),
      );
    }
  });

  // --- reading order -------------------------------------------------------
  // Compared as a relative order over the paired blocks. An absolute index would
  // report every block after a single insertion; the longest increasing
  // subsequence isolates the blocks that actually moved past one another.
  findings.push(...orderFindings(doc, pairs));

  findings.sort((a, b) => a.class.localeCompare(b.class) || (a.referenceLine ?? 0) - (b.referenceLine ?? 0) || a.id.localeCompare(b.id));
  alignment.sort((a, b) => (a.referenceLine ?? 0) - (b.referenceLine ?? 0) || (a.producedLine ?? 0) - (b.producedLine ?? 0));
  return { doc, findings, alignment, notes };
}

// ---------------------------------------------------------------------------
// Block selection and pairing
// ---------------------------------------------------------------------------

/**
 * Which rendered blocks are comparable at all.
 *
 * Wrapper directives are excluded: a `::: columns` and a `::: column` carry the
 * concatenated text of their children, so including them would pair a wrapper
 * on one side with a leaf on the other and report the same defect several
 * times. Containment — the thing wrappers actually decide — is compared through
 * the leaf's ancestor chain instead, which reports it exactly once.
 */
const WRAPPER_KINDS = new Set(["columns", "column", "images", "lead", "align", "frame", "signature", "nav", "quote"]);

function comparable(page: PageProbe): BlockGeometry[] {
  return page.blocks.filter((b) => !WRAPPER_KINDS.has(b.kind) && (b.text !== "" || b.kind === "break" || b.kind === "image"));
}

interface Pair {
  produced: BlockGeometry | null;
  reference: BlockGeometry | null;
}

/**
 * Pair blocks across the two rendered surfaces **by what the reader sees**.
 *
 * Deliberately independent of L2's aligner. L3 must be able to *disagree* with
 * L2 — that is the entire value of a separate rung — and an L3 that inherited
 * L2's pairing would inherit its blind spots along with it. Rendered text is a
 * strong key in this corpus, and the fallback below handles the cases where the
 * migrator copyedited the text.
 */
function pairBlocks(produced: readonly BlockGeometry[], reference: readonly BlockGeometry[]): Pair[] {
  const takenP = new Set<number>();
  const takenR = new Set<number>();
  const pairs: Pair[] = [];

  // Pass 1 — exact normalized text within the same kind family, in order.
  const byKey = new Map<string, number[]>();
  produced.forEach((b, i) => {
    const key = pairKey(b);
    const list = byKey.get(key);
    if (list) list.push(i);
    else byKey.set(key, [i]);
  });
  reference.forEach((r, j) => {
    const list = byKey.get(pairKey(r));
    if (!list) return;
    const i = list.find((idx) => !takenP.has(idx));
    if (i === undefined) return;
    takenP.add(i);
    takenR.add(j);
    pairs.push({ produced: produced[i]!, reference: r });
  });

  // Pass 2 — copyedited text: the same block under a rewritten label. Greedy on
  // the best score, which is stable because ties break on index.
  const restP = produced.map((b, i) => ({ b, i })).filter(({ i }) => !takenP.has(i));
  const restR = reference.map((b, j) => ({ b, j })).filter(({ j }) => !takenR.has(j));
  const cands: Array<{ i: number; j: number; s: number }> = [];
  for (const { b: rb, j } of restR) {
    for (const { b: pb, i } of restP) {
      if (family(pb.kind) !== family(rb.kind)) continue;
      const s = similarity(pb.text, rb.text);
      if (s >= 0.65) cands.push({ i, j, s });
    }
  }
  cands.sort((a, b) => b.s - a.s || a.j - b.j || a.i - b.i);
  for (const c of cands) {
    if (takenP.has(c.i) || takenR.has(c.j)) continue;
    takenP.add(c.i);
    takenR.add(c.j);
    pairs.push({ produced: produced[c.i]!, reference: reference[c.j]! });
  }

  // Unpaired blocks are recorded so lane and order indices stay aligned with the
  // pair list, but they never become findings here: presence is L2's question.
  produced.forEach((b, i) => {
    if (!takenP.has(i)) pairs.push({ produced: b, reference: null });
  });
  reference.forEach((b, j) => {
    if (!takenR.has(j)) pairs.push({ produced: null, reference: b });
  });

  pairs.sort((a, b) => {
    const ay = a.reference?.box.y ?? a.produced?.box.y ?? 0;
    const by = b.reference?.box.y ?? b.produced?.box.y ?? 0;
    return ay - by || (a.reference?.box.x ?? 0) - (b.reference?.box.x ?? 0);
  });
  return pairs;
}

function pairKey(b: BlockGeometry): string {
  return `${family(b.kind)} ${normalize(b.text)}`;
}

/** Kind families. A heading that became a paragraph must still pair. */
function family(kind: string): string {
  switch (kind) {
    case "heading":
    case "paragraph":
      return "text";
    case "list":
    case "table":
      return kind;
    case "image":
    case "images":
    case "document":
      return "media";
    default:
      return kind;
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Derived measurements
// ---------------------------------------------------------------------------

function proseOf(page: PageProbe): Alignment {
  return proseAlignment(
    page.blocks
      .filter((b) => b.kind === "paragraph" || b.kind === "p" || b.kind === "td" || b.kind === "div")
      .map((b) => ({ alignment: normalizeTextAlign(b.textAlign), textLength: b.textLength })),
  );
}

function isDistinctiveAgainst(alignment: Alignment, prose: Alignment): boolean {
  const flow = (a: Alignment) => (a === "justify" ? "left" : a);
  if (alignment === "unknown") return false;
  if (prose === "unknown") return alignment === "center" || alignment === "right";
  return flow(alignment) !== flow(prose);
}

/**
 * The source element a rendered block came from.
 *
 * Three keys, in decreasing strength, because each covers a case the one before
 * it provably cannot:
 *
 *  1. **exact text.** The innermost element whose visible text *is* the block's
 *     text. Innermost matters: on a legacy page every ancestor up to `<body>`
 *     contains the same string, and an outermost match would report the
 *     alignment of the layout table rather than of the paragraph.
 *  2. **the image.** An uncaptioned `::: image` renders no text at all, so key 1
 *     can never bind it — and whether the source centres a figure is one of the
 *     questions L3 exists to answer. Matched on the image basename.
 *  3. **containment.** The migrator's text is frequently a *fragment* of the
 *     source element's: `Тавровский Сергей` under a source `<b>Тавровский
 *     Сергей Викторович</b>`. The innermost element containing the text, with
 *     the least excess, is that element. Bounded at 3× the wanted length so a
 *     short label cannot bind to a whole paragraph that happens to mention it.
 *
 * Returning null is a real answer and is counted as one: a row with no source
 * node carries no backing verdict, and the reported hypothesis counts say so
 * rather than silently treating "not found" as "not backed".
 */
function findSourceNode(source: PageProbe, text: string, imageName: string | null): BlockGeometry | null {
  const want = normalize(text);

  if (want !== "") {
    let exact: BlockGeometry | null = null;
    for (const node of source.blocks) {
      if (normalize(node.text) !== want) continue;
      if (exact === null || node.ancestors.length > exact.ancestors.length) exact = node;
    }
    if (exact) return exact;
  }

  if (imageName !== null) {
    let byImage: BlockGeometry | null = null;
    for (const node of source.blocks) {
      if (node.imageName !== imageName) continue;
      // The innermost element carrying only this image: the `<img>` itself, or
      // the cell that wraps it when the `<img>` has no box of its own.
      if (byImage === null || node.ancestors.length > byImage.ancestors.length) byImage = node;
    }
    if (byImage) return byImage;
  }

  if (want.length >= 4) {
    let contained: BlockGeometry | null = null;
    let bestExcess = Number.POSITIVE_INFINITY;
    for (const node of source.blocks) {
      const have = normalize(node.text);
      if (have.length > want.length * 3) continue;
      if (!have.includes(want)) continue;
      const excess = have.length - want.length;
      if (excess < bestExcess || (excess === bestExcess && contained !== null && node.ancestors.length > contained.ancestors.length)) {
        contained = node;
        bestExcess = excess;
      }
    }
    if (contained) return contained;
  }

  return null;
}

/** The chain of block kinds a block is nested in, outermost first. */
function kindChain(block: BlockGeometry, all: readonly BlockGeometry[]): string {
  const byPath = new Map(all.map((b) => [b.path, b] as const));
  return block.ancestors
    .map((p) => byPath.get(p)?.kind ?? p.slice(p.lastIndexOf("/") + 1).replace(/\[\d+\]$/u, ""))
    .join(">");
}

function laneIndex(blocks: ReadonlyArray<BlockGeometry | null>): Array<number | undefined> {
  const present: number[] = [];
  const boxes: Box[] = [];
  blocks.forEach((b, i) => {
    if (!b) return;
    present.push(i);
    boxes.push(b.box);
  });
  const lanes = lanesOf(boxes);
  const out = new Array<number | undefined>(blocks.length).fill(undefined);
  present.forEach((idx, k) => {
    out[idx] = lanes[k];
  });
  return out;
}

/**
 * Blocks whose reading order differs between the two renderings.
 *
 * §14 makes source order the reading, focus, copy and screen-reader order, so a
 * reordering is a real defect and a severe one. Reported only for the blocks
 * *outside* the longest increasing subsequence of the reference order: those are
 * the ones that actually moved, and reporting the rest would turn one relocation
 * into a hundred findings.
 */
function orderFindings(doc: string, pairs: readonly Pair[]): L3Finding[] {
  const both = pairs.filter((p) => p.produced && p.reference) as Array<{ produced: BlockGeometry; reference: BlockGeometry }>;
  if (both.length === 0) return [];

  // `readingRanks` rather than a pairwise comparator: see the note on
  // `readingOrder`. A non-transitive comparator here produced one finding whose
  // two ranks were *equal* — a block reported as moved past itself, which is
  // the signature of a sort over an inconsistent order rather than of a defect.
  const producedRank = readingRanks(both.map((p) => p.produced.box));
  const referenceRank = readingRanks(both.map((p) => p.reference.box));

  const byReference = both.map((_, i) => i).sort((i, j) => referenceRank[i]! - referenceRank[j]!);
  const seq = byReference.map((i) => producedRank[i]!);
  const keep = new Set(longestIncreasing(seq));

  const out: L3Finding[] = [];
  byReference.forEach((i, k) => {
    if (keep.has(k)) return;
    const p = both[i]!;
    out.push(
      make(doc, "layout.order.mismatch", "critical", "move", p.reference.path, p.produced, p.reference, {
        producedRank: producedRank[i]!,
        referenceRank: referenceRank[i]!,
      }),
    );
  });
  return out;
}

/** Indices of one longest strictly-increasing subsequence. O(n log n). */
function longestIncreasing(seq: readonly number[]): number[] {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const out: number[] = [];
  let k = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    out.push(k);
    k = prev[k]!;
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make(
  doc: string,
  cls: string,
  severity: Severity,
  op: L3Finding["op"],
  path: string,
  produced: BlockGeometry | null,
  reference: BlockGeometry | null,
  geometry: Record<string, string | number | null>,
): L3Finding {
  return {
    id: stableId(`${doc}|${cls}|${path}|${normalize(reference?.text ?? produced?.text ?? "")}`),
    doc,
    class: cls,
    severity,
    evidence: "structure",
    op,
    path,
    producedLine: produced?.line ?? null,
    referenceLine: reference?.line ?? null,
    produced: produced ? truncate(produced.text, 120) : null,
    reference: reference ? truncate(reference.text, 120) : null,
    geometry,
  };
}

function truncate(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** FNV-1a, matching `structdiff.ts` so ids from both rungs are the same shape. */
function stableId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function similarity(a: string, b: string): number {
  const wa = tokens(a);
  const wb = tokens(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  if (wa.length < 2 || wb.length < 2) return jaccard(new Set(wa), new Set(wb));
  const bigrams = (w: string[]) => new Set(w.slice(1).map((x, k) => `${w[k]} ${x}`));
  const A = bigrams(wa);
  const B = bigrams(wb);
  let shared = 0;
  for (const v of A) if (B.has(v)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/­/gu, "")
    .replace(/(\p{L})[-‐‑–—]\s*(\p{L})/gu, "$1$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return shared / (a.size + b.size - shared);
}
