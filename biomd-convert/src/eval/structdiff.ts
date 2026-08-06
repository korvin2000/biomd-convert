/**
 * Structural adjudication (L2): produced `.bio.md` ↔ reference `.bio.md`.
 *
 * The scalar score in `score.ts` answers "how close are these two documents",
 * which was the right question while whole tables were disappearing. It cannot
 * answer "what is wrong", and its folds — directive properties, cell
 * coordinates, block order, link labels, typography, hard breaks — are exactly
 * where the defects that remain live. This module answers the second question
 * and never the first: **its output is N localized findings, never an average.**
 *
 * Method: resolve both sides to block trees (`blocks.ts`), align sibling
 * sequences with Needleman–Wunsch under a kind-aware similarity, then compare
 * each aligned pair at full resolution. Unaligned pairs that are similar to
 * each other elsewhere in the script are reclassified as moves; unaligned pairs
 * that carry the same text under a different block kind are reclassified as
 * retypings, which is what an outline defect looks like from here.
 *
 * A finding whose class cannot be acted on directly is a class that is not yet
 * precise enough. Refine the class, not the tolerance.
 *
 * Diagnostic-only. Nothing in `convert-core` may import it.
 */
import {
  type Block,
  type DirectiveNode,
  type Inline,
  type ListBlock,
  type ParagraphBlock,
  type TableBlock,
  readBlocks,
} from "./blocks.js";

export type Severity = "critical" | "major" | "minor";
export type EditOp = "insert" | "delete" | "move" | "substitute";

/**
 * What kind of evidence decides a finding — and therefore whether §16.3 applies.
 *
 * `content` findings turn on text the source must attest: a heading label, a
 * caption, a paragraph, a table cell. Those are the ones a converter may not
 * close by invention, and the ones triage must test against the source.
 *
 * `structure` findings turn on layout: a directive wrapper, a separator, block
 * order, containment, geometry, an enumerated property token. Adding a
 * `::: columns` invents no content, so §16.3 does not constrain it and a
 * text-attestation test would only mislabel it as unreachable.
 */
export type Evidence = "content" | "structure";

export interface Finding {
  /** Stable across runs: same defect ⇒ same id. */
  id: string;
  doc: string;
  /** Dotted defect class — the unit progress is reported in. */
  class: string;
  severity: Severity;
  evidence: Evidence;
  op: EditOp;
  /** Node path in the reference tree where available, else the produced tree. */
  path: string;
  producedLine: number | null;
  referenceLine: number | null;
  /** Quoted spans, truncated. Both sides, always, so a finding is checkable. */
  produced: string | null;
  reference: string | null;
}

export interface DiffResult {
  doc: string;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** A block the sibling alignment could not pair, kept for global reconciliation. */
interface Orphan {
  block: Block;
  path: string;
  side: "produced" | "reference";
  taken: boolean;
}

interface Context {
  doc: string;
  findings: Finding[];
  orphans: Orphan[];
  /** Where the reference put each piece of text — see {@link indexConstructs}. */
  referenceHome: Map<string, string>;
  /** Reference text kept as a plain paragraph, whatever else also holds it. */
  referenceParagraphs: Set<string>;
}

export function diffDocuments(doc: string, producedSource: string, referenceSource: string): DiffResult {
  const produced = readBlocks(producedSource).blocks;
  const reference = readBlocks(referenceSource).blocks;
  const ctx: Context = {
    doc,
    findings: [],
    orphans: [],
    referenceHome: indexConstructs(reference),
    referenceParagraphs: indexParagraphs(reference),
  };
  compareSequence(ctx, produced, reference, "");
  reconcile(ctx);
  return { doc, findings: dedupe(ctx.findings) };
}

/**
 * Global reconciliation of everything the sibling alignments could not pair.
 *
 * Sibling alignment is blind to containment by construction: a track list that
 * the reference puts in its own `::: columns` pair and the converter leaves in
 * one persistent lane never appears in the same sequence twice, so the local
 * view reports it as one deletion plus one unrelated insertion. On `goya2` that
 * turned a single mechanism defect — one lane instead of one pair per album —
 * into 42 `paragraph.spurious` findings pointing at the same rule, which is
 * precisely the "finding a human cannot act on" the ladder forbids.
 *
 * Pairing the leftovers across the whole document instead collapses them into
 * `containment` and `retyped` findings that name the actual defect. Runs to
 * fixpoint because pairing recurses into the pair and can expose further
 * orphans, and every block can be consumed only once.
 */
function reconcile(ctx: Context): void {
  for (;;) {
    const produced = ctx.orphans.filter((o) => !o.taken && o.side === "produced");
    const reference = ctx.orphans.filter((o) => !o.taken && o.side === "reference");

    const candidates: Array<{ p: Orphan; r: Orphan; score: number }> = [];
    for (const r of reference) {
      for (const p of produced) {
        const score = Math.max(textSimilarity(blockText(p.block), blockText(r.block)), refIdentity(p.block, r.block));
        if (score >= 0.65) candidates.push({ p, r, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    let paired = 0;
    for (const { p, r } of candidates) {
      if (p.taken || r.taken) continue;
      p.taken = true;
      r.taken = true;
      paired += 1;
      emitRelocation(ctx, p, r);
      comparePair(ctx, p.block, r.block, r.path);
    }
    if (paired > 0) continue;

    // Nothing pairs at this level. Before giving up, open the wrappers: a
    // reference `::: columns` that matched nothing is still a *container*, and
    // the prose inside it may well be sitting in the produced document under a
    // different parent. Leaving it closed makes the pool asymmetric — every
    // produced block reported spurious, every reference block reported missing,
    // and the one fact worth having (the content is there, in the wrong place)
    // reported nowhere. Each expansion consumes a container and contributes
    // strictly smaller subtrees, so this terminates.
    const expandable = ctx.orphans.filter((o) => !o.taken && childrenOf(o.block).length > 0);
    if (expandable.length === 0) break;
    for (const orphan of expandable) {
      orphan.taken = true;
      emitUnmatched(ctx, orphan);
      childrenOf(orphan.block).forEach((child, k) => {
        ctx.orphans.push({ block: child, path: `${orphan.path}/${describe(child)}[${k}]`, side: orphan.side, taken: false });
      });
    }
  }

  for (const orphan of ctx.orphans) {
    if (!orphan.taken) emitUnmatched(ctx, orphan);
  }
}

function emitUnmatched(ctx: Context, orphan: Orphan): void {
  const block = orphan.block;
  const base = `${classOf(block)}.${orphan.side === "reference" ? "missing" : "spurious"}`;
  const cls = orphan.side === "produced" ? `${base}.${homeOf(ctx, block)}` : base;
  ctx.findings.push(
    orphan.side === "reference"
      ? finding(ctx.doc, cls, missingSeverity(block), evidenceOf(block), "delete", orphan.path, null, block)
      : finding(ctx.doc, cls, missingSeverity(block), evidenceOf(block), "insert", orphan.path, block, null),
  );
}

function childrenOf(block: Block): Block[] {
  return block.kind === "directive" || block.kind === "quote" ? block.children : [];
}

// ---------------------------------------------------------------------------
// Where did the reference put it?
// ---------------------------------------------------------------------------

/**
 * Sub-classify a spurious produced block by the construct that owns its text on
 * the reference side.
 *
 * `paragraph.spurious` was the ledger's largest class and its least actionable:
 * 50 instances across 11 documents with nothing in common except "the reference
 * has no paragraph here". That is the shape the ladder forbids — a finding a
 * human cannot act on is a class that is not precise enough. The refinement asks
 * one further question, and the answer names the owning mechanism:
 *
 *   `.caption-echo`  the text is an `::: image` `caption:` — the converter bound
 *                    the caption *and* left the line below the figure.
 *   `.in-nav`        a `::: nav` item label. The menu was not recognised.
 *   `.in-list`       a list item. A `<br>` run that should have been a list.
 *   `.in-heading`    a heading. Typographic prominence was not recovered.
 *   `.in-table`      a table cell. A record matrix was flattened.
 *   `.in-align`      an `::: align` body. The alignment family owns it.
 *   `.in-paragraph`  the reference keeps it as a paragraph too, somewhere else.
 *                    Nothing was retyped — this is placement, so the owning
 *                    mechanism is containment or ordering, not a block rule.
 *   `.unattested`    no reference construct holds this text at all — page
 *                    chrome, a caption echo of a dropped figure, or content the
 *                    reference deleted. The only sub-class that may be ceiling.
 *
 * No literals: the index is built from the reference document being compared,
 * and the key is the text itself. A detector here cannot name a document.
 */
function homeOf(ctx: Context, block: Block): string {
  const key = homeKey(blockText(block));
  if (key === "") return "unattested";
  // Same kind, elsewhere — asked first, because nothing was retyped and the
  // owning mechanism is therefore placement. A reference may hold one piece of
  // text twice: `news` writes an obituary's subject as a bold paragraph *and*
  // captions the photograph below it with the same name. Answering
  // `.caption-echo` there sends a reader hunting for a duplicated caption when
  // the reference has the very same paragraph, three lines further down.
  if (block.kind === "paragraph" && ctx.referenceParagraphs.has(key)) return "in-paragraph";
  return ctx.referenceHome.get(key) ?? "unattested";
}

/**
 * Fold text to a lookup key.
 *
 * Case and every non-alphanumeric character are dropped, so an escape (`01\.`),
 * a bullet glyph, a typographic dash or a different quote cannot hide the fact
 * that the same words landed somewhere else.
 */
function homeKey(text: string): string {
  return words(text).join(" ").toLowerCase();
}

/** Reference text → the name of the construct that holds it. */
function indexConstructs(blocks: readonly Block[]): Map<string, string> {
  const home = new Map<string, string>();
  // First writer wins: a caption is also inside its `::: image`, and the caption
  // is the more specific — and more actionable — answer.
  const put = (text: string, where: string): void => {
    const key = homeKey(text);
    if (key !== "" && !home.has(key)) home.set(key, where);
  };

  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      switch (block.kind) {
        case "heading":
          put(block.inline.text, "in-heading");
          break;
        case "list":
          for (const item of block.items) put(item.inline.text, "in-list");
          break;
        case "table":
          for (const cell of [...block.header, ...block.rows.flat()]) put(cell.text, "in-table");
          break;
        case "quote":
          put(blockText(block), "in-quote");
          visit(block.children);
          break;
        case "directive": {
          const caption = block.props["caption"];
          if (caption !== undefined) put(caption, "caption-echo");
          if (block.name === "nav") for (const child of block.children) putNavItems(child, put);
          if (block.name === "align") put(flatten(block.children), "in-align");
          visit(block.children);
          break;
        }
        default:
          break;
      }
    }
  };
  visit(blocks);
  return home;
}

/**
 * Reference text kept as a plain paragraph.
 *
 * Separate from {@link indexConstructs} rather than one more case in it,
 * because a paragraph is not a competing *answer* — it is the answer to a
 * different question. `indexConstructs` asks "what did this text become";
 * this asks "did it stay what it was", and {@link homeOf} asks that one first.
 */
function indexParagraphs(blocks: readonly Block[]): Set<string> {
  const keys = new Set<string>();
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        const key = homeKey(block.inline.text);
        if (key !== "") keys.add(key);
      } else visit(childrenOf(block));
    }
  };
  visit(blocks);
  return keys;
}

/** A `::: nav`'s items are an ordinary list inside the directive. */
function putNavItems(block: Block, put: (text: string, where: string) => void): void {
  if (block.kind === "list") for (const item of block.items) put(item.inline.text, "in-nav");
  else put(blockText(block), "in-nav");
}

/** Name the relocation: a re-tagging, a change of parent, or a reordering. */
function emitRelocation(ctx: Context, produced: Orphan, reference: Orphan): void {
  const p = produced.block;
  const r = reference.block;

  if (p.kind !== r.kind || (p.kind === "heading" && r.kind === "heading" && p.depth !== r.depth)) {
    ctx.findings.push(
      finding(ctx.doc, retypeClass(p, r), "major", "structure", "substitute", reference.path, p, r, `at ${produced.path}`),
    );
    return;
  }
  if (parentOf(produced.path) !== parentOf(reference.path)) {
    ctx.findings.push(
      finding(ctx.doc, `${classOf(r)}.containment`, "major", "structure", "move", reference.path, p, r, `produced at ${produced.path}`),
    );
    return;
  }
  ctx.findings.push(
    finding(ctx.doc, `${classOf(r)}.moved`, "major", "structure", "move", reference.path, p, r, `produced at ${produced.path}`),
  );
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
}

// ---------------------------------------------------------------------------
// Sequence alignment
// ---------------------------------------------------------------------------

/**
 * Cost of leaving a block unaligned.
 *
 * Two gaps cost 0.65, so the aligner prefers an insert+delete pair over a
 * substitution whenever similarity falls below 0.35. That threshold is what
 * keeps "this paragraph was rewritten" (a substitution, one finding) distinct
 * from "this paragraph is missing and a different one appeared" (two findings)
 * — a distinction the whole ledger depends on.
 */
const GAP = 0.325;

interface Aligned {
  produced: Block | null;
  reference: Block | null;
}

/** Backpointer directions. Stored, never re-derived — see {@link align}. */
const enum Step {
  Sub = 0,
  Del = 1,
  Ins = 2,
}

/**
 * Gap cost for table rows.
 *
 * A row is a positional record, not a free-floating block: two rows at the same
 * ordinal are the same row even when every cell in them differs, and reporting
 * that as "row missing plus unrelated row appeared" throws away the coordinates
 * this function exists to preserve. At 0.5 an indel pair costs exactly as much
 * as the worst substitution and ties resolve to substitution, so a gap is only
 * ever taken when the row counts force one.
 */
const ROW_GAP = 0.5;

function align(produced: readonly Block[], reference: readonly Block[], gap = GAP): Aligned[] {
  const n = produced.length;
  const m = reference.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const from: Step[][] = Array.from({ length: n + 1 }, () => new Array<Step>(m + 1).fill(Step.Sub));
  for (let i = 1; i <= n; i += 1) {
    cost[i]![0] = i * gap;
    from[i]![0] = Step.Del;
  }
  for (let j = 1; j <= m; j += 1) {
    cost[0]![j] = j * gap;
    from[0]![j] = Step.Ins;
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sub = cost[i - 1]![j - 1]! + (1 - similarity(produced[i - 1]!, reference[j - 1]!));
      const del = cost[i - 1]![j]! + gap;
      const ins = cost[i]![j - 1]! + gap;
      const best = Math.min(sub, del, ins);
      cost[i]![j] = best;
      from[i]![j] = best === sub ? Step.Sub : best === del ? Step.Del : Step.Ins;
    }
  }

  // Backpointers rather than a cost re-derivation. Recomputing `1 - similarity`
  // during the walk and testing it for float equality against the stored cost
  // is not merely slower: a one-ulp disagreement drops through every branch,
  // and the fallback decrements `j` past zero and never terminates. Storing the
  // decision the fill actually made removes the class of bug, not the instance.
  const out: Aligned[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = i === 0 ? Step.Ins : j === 0 ? Step.Del : from[i]![j]!;
    if (step === Step.Sub) {
      out.push({ produced: produced[i - 1]!, reference: reference[j - 1]! });
      i -= 1;
      j -= 1;
    } else if (step === Step.Del) {
      out.push({ produced: produced[i - 1]!, reference: null });
      i -= 1;
    } else {
      out.push({ produced: null, reference: reference[j - 1]! });
      j -= 1;
    }
  }
  return out.reverse();
}

/** Similarity in [0,1]. Zero across kinds, so a retyping never hides in a substitution. */
function similarity(a: Block, b: Block): number {
  if (a.kind !== b.kind) return 0;
  const base = textual(a, b);
  // A shared destination is strong evidence of identity and weak evidence of
  // nothing, so it may raise a score but never lower one.
  return Math.max(base, base * 0.5 + 0.5 * refIdentity(a, b));
}

function textual(a: Block, b: Block): number {
  switch (a.kind) {
    case "directive": {
      const other = b as DirectiveNode;
      if (a.name !== other.name) return 0;
      const props = jaccard(new Set(Object.entries(a.props).map(([k, v]) => `${k}=${v}`)), new Set(Object.entries(other.props).map(([k, v]) => `${k}=${v}`)));
      const kids = jaccard(new Set(a.children.map(signature)), new Set(other.children.map(signature)));
      return 0.5 + 0.25 * props + 0.25 * kids;
    }
    case "heading":
      return 0.25 + 0.75 * textSimilarity(a.inline.text, (b as typeof a).inline.text);
    case "paragraph":
      return textSimilarity(a.inline.text, (b as ParagraphBlock).inline.text);
    case "quote":
      return 0.2 + 0.8 * textSimilarity(flatten(a.children), flatten((b as typeof a).children));
    case "list":
      return 0.2 + 0.8 * textSimilarity(a.items.map((it) => it.inline.text).join(" "), (b as ListBlock).items.map((it) => it.inline.text).join(" "));
    case "table":
      return 0.2 + 0.8 * textSimilarity(tableText(a), tableText(b as TableBlock));
    case "break":
      return 1;
    case "code":
      return textSimilarity(a.value, (b as typeof a).value);
  }
}

function signature(block: Block): string {
  return block.kind === "directive" ? `directive:${block.name}` : block.kind;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareSequence(ctx: Context, produced: readonly Block[], reference: readonly Block[], path: string): void {
  const script = align(produced, reference);
  let index = 0;
  for (const step of script) {
    if (step.produced && step.reference) {
      comparePair(ctx, step.produced, step.reference, `${path}/${describe(step.reference)}[${index}]`);
      index += 1;
    } else if (step.reference) {
      // Not a finding yet: it may be the same block under a different parent.
      // Only `reconcile()` can tell, and only after the whole tree is walked.
      ctx.orphans.push({ block: step.reference, path: `${path}/${describe(step.reference)}[${index}]`, side: "reference", taken: false });
      index += 1;
    } else if (step.produced) {
      ctx.orphans.push({ block: step.produced, path: `${path}/${describe(step.produced)}[${index}]`, side: "produced", taken: false });
    }
  }
}

function comparePair(ctx: Context, produced: Block, reference: Block, path: string): void {
  if (produced.kind !== reference.kind) return;

  switch (reference.kind) {
    case "directive":
      compareDirective(ctx, produced as DirectiveNode, reference, path);
      return;
    case "heading": {
      const p = produced as typeof reference;
      if (p.depth !== reference.depth) {
        ctx.findings.push(finding(ctx.doc, "heading.level", "major", "structure", "substitute", path, p, reference, `h${p.depth}, reference h${reference.depth}`));
      }
      compareInline(ctx, p.inline, reference.inline, `${path}/text`, "heading", [p.line, reference.line]);
      return;
    }
    case "paragraph": {
      const p = produced as ParagraphBlock;
      compareLineation(ctx, p, reference, path);
      compareInline(ctx, p.inline, reference.inline, path, "paragraph", [p.line, reference.line]);
      return;
    }
    case "quote":
      compareSequence(ctx, (produced as typeof reference).children, reference.children, path);
      return;
    case "list":
      compareList(ctx, produced as ListBlock, reference, path);
      return;
    case "table":
      compareTable(ctx, produced as TableBlock, reference, path);
      return;
    case "break":
      if ((produced as typeof reference).marker !== reference.marker) {
        ctx.findings.push(finding(ctx.doc, "separator.spelling", "minor", "structure", "substitute", path, produced, reference));
      }
      return;
    case "code":
      if ((produced as typeof reference).value !== reference.value) {
        ctx.findings.push(finding(ctx.doc, "code.text", "minor", "content", "substitute", path, produced, reference));
      }
      return;
  }
}

/**
 * Directive properties — the largest single blind spot in the scalar metric.
 *
 * Classes are named `<directive>.<property>.<defect>` so that the ledger's unit
 * of work is the thing a rule actually sets: `image.size.value`,
 * `image.caption.missing`, `nav.title.missing`. A count of `::: image`
 * directives, which is what L1 compares, cannot distinguish any of these.
 */
function compareDirective(ctx: Context, produced: DirectiveNode, reference: DirectiveNode, path: string): void {
  const keys = new Set([...Object.keys(reference.props), ...Object.keys(produced.props)]);
  for (const key of [...keys].sort()) {
    const want = reference.props[key];
    const got = produced.props[key];
    const evidence: Evidence = isProseProp(key) ? "content" : "structure";
    if (want === undefined) {
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.spurious`, "minor", evidence, "insert", `${path}@${key}`, quoteProp(key, got), null, undefined, [produced.line, reference.line]));
      continue;
    }
    if (got === undefined) {
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.missing`, propSeverity(key), evidence, "delete", `${path}@${key}`, null, quoteProp(key, want), undefined, [produced.line, reference.line]));
      continue;
    }
    if (got === want) continue;
    // A property whose value is prose (caption, title, alt) fails the same way
    // prose does, so it is classified the same way and lands in the same cell.
    if (isProseProp(key)) {
      const kind = classifyText(got, want);
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.${kind.suffix}`, kind.severity, "content", "substitute", `${path}@${key}`, quoteProp(key, got), quoteProp(key, want), undefined, [produced.line, reference.line]));
    } else {
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.value`, propSeverity(key), "structure", "substitute", `${path}@${key}`, quoteProp(key, got), quoteProp(key, want), undefined, [produced.line, reference.line]));
    }
  }
  compareSequence(ctx, produced.children, reference.children, path);
}

/**
 * Blank-line and hard-break structure inside a paragraph.
 *
 * `normalizeForCompare` folds a paragraph to a word trigram bag, so a paragraph
 * that lost every hard break scores identically to one that kept them. In this
 * corpus a hard break is frequently the only surviving trace of a line the
 * author drew — a verse line, an address, a track — so it is a first-class
 * finding here.
 */
function compareLineation(ctx: Context, produced: ParagraphBlock, reference: ParagraphBlock, path: string): void {
  const wantBreaks = reference.hardBreaks.filter(Boolean).length;
  const gotBreaks = produced.hardBreaks.filter(Boolean).length;
  if (gotBreaks < wantBreaks) {
    ctx.findings.push(finding(ctx.doc, "hardbreak.missing", "major", "structure", "delete", path, produced, reference, `${gotBreaks} of ${wantBreaks} hard breaks`));
  } else if (gotBreaks > wantBreaks) {
    ctx.findings.push(finding(ctx.doc, "hardbreak.spurious", "minor", "structure", "insert", path, produced, reference, `${gotBreaks} hard breaks, reference has ${wantBreaks}`));
  }
}

function compareList(ctx: Context, produced: ListBlock, reference: ListBlock, path: string): void {
  if (produced.ordered !== reference.ordered) {
    ctx.findings.push(
      finding(ctx.doc, "list.type", "minor", "structure", "substitute", path, produced, reference, produced.ordered ? "ordered, reference is bulleted" : "bulleted, reference is ordered"),
    );
  }
  const asBlock = (it: ListBlock["items"][number]): ParagraphBlock => ({
    kind: "paragraph",
    lines: [it.inline.raw],
    hardBreaks: [false],
    inline: it.inline,
    line: it.line,
  });
  const script = align(produced.items.map(asBlock), reference.items.map(asBlock));
  let i = 0;
  let refIndex = 0;
  let prodIndex = 0;
  for (const step of script) {
    const p = `${path}/item[${i}]`;
    if (step.produced && step.reference) {
      const wantDepth = reference.items[refIndex]?.depth ?? 0;
      const gotDepth = produced.items[prodIndex]?.depth ?? 0;
      if (wantDepth !== gotDepth) {
        ctx.findings.push(finding(ctx.doc, "list.depth", "major", "structure", "substitute", p, step.produced, step.reference, `depth ${gotDepth}, reference ${wantDepth}`));
      }
      compareInline(ctx, (step.produced as ParagraphBlock).inline, (step.reference as ParagraphBlock).inline, p, "list.item", [step.produced.line, step.reference.line]);
      refIndex += 1;
      prodIndex += 1;
      i += 1;
    } else if (step.reference) {
      ctx.findings.push(finding(ctx.doc, "list.item.missing", "major", "content", "delete", p, null, step.reference));
      refIndex += 1;
      i += 1;
    } else if (step.produced) {
      ctx.findings.push(finding(ctx.doc, "list.item.spurious", "minor", "content", "insert", p, step.produced, null));
      prodIndex += 1;
    }
  }
}

/**
 * Table geometry at cell coordinates.
 *
 * `TableFacts` carries cells as a flat multiset, so a table whose every cell
 * moved one column to the left scores 100 %. Comparing at `(row, col)` is the
 * whole point of this function; the alignment is over *rows*, so an inserted or
 * dropped row does not smear into a hundred spurious cell findings.
 */
function compareTable(ctx: Context, produced: TableBlock, reference: TableBlock, path: string): void {
  if (produced.header.length !== reference.header.length) {
    ctx.findings.push(
      finding(ctx.doc, "table.geometry.cols", "major", "structure", "substitute", path, produced, reference, `${produced.header.length} columns, reference has ${reference.header.length}`),
    );
  }
  for (let c = 0; c < Math.max(produced.align.length, reference.align.length); c += 1) {
    const want = reference.align[c] ?? null;
    const got = produced.align[c] ?? null;
    if (want !== got) {
      ctx.findings.push(finding(ctx.doc, "table.align", "minor", "structure", "substitute", `${path}/col[${c}]`, `column ${c}: ${got ?? "none"}`, `column ${c}: ${want ?? "none"}`, undefined, [produced.line, reference.line]));
    }
  }
  const width = Math.max(produced.header.length, reference.header.length);
  for (let c = 0; c < width; c += 1) {
    const want = reference.header[c];
    const got = produced.header[c];
    if ((want?.text ?? "") !== (got?.text ?? "")) {
      ctx.findings.push(finding(ctx.doc, "table.header.cell", "major", "content", "substitute", `${path}/header[${c}]`, got?.raw ?? "", want?.raw ?? "", `column ${c}`, [produced.line, reference.line]));
    }
  }

  const rowScript = align(
    produced.rows.map((r, k) => rowBlock(r, produced.line + k)),
    reference.rows.map((r, k) => rowBlock(r, reference.line + k)),
    ROW_GAP,
  );
  let r = 0;
  for (const step of rowScript) {
    if (step.produced && step.reference) {
      const got = (step.produced as TableRowBlock).cells;
      const want = (step.reference as TableRowBlock).cells;
      for (let c = 0; c < Math.max(got.length, want.length); c += 1) {
        const g = got[c];
        const w = want[c];
        if ((g?.text ?? "") === (w?.text ?? "")) continue;
        const kind = classifyText(g?.text ?? "", w?.text ?? "");
        ctx.findings.push(finding(ctx.doc, `table.cell.${kind.suffix}`, kind.severity, "content", "substitute", `${path}/cell[${r}][${c}]`, g?.raw ?? "", w?.raw ?? "", undefined, [step.produced.line, step.reference.line]));
      }
      r += 1;
    } else if (step.reference) {
      ctx.findings.push(finding(ctx.doc, "table.row.missing", "critical", "content", "delete", `${path}/row[${r}]`, null, step.reference));
      r += 1;
    } else if (step.produced) {
      ctx.findings.push(finding(ctx.doc, "table.row.spurious", "major", "content", "insert", `${path}/row[${r}]`, step.produced, null));
    }
  }
}

interface TableRowBlock extends ParagraphBlock {
  cells: Inline[];
}

function rowBlock(cells: Inline[], line: number): TableRowBlock {
  const raw = cells.map((c) => c.raw).join(" | ");
  return { kind: "paragraph", lines: [raw], hardBreaks: [false], inline: { raw, text: cells.map((c) => c.text).join(" | "), refs: [], emphasis: [] }, cells, line };
}

/**
 * Inline comparison: text, emphasis, and link/image binding.
 *
 * `foldTarget` in `facts.ts` compares a link by its destination alone, so a
 * correct target under a wrong label scores perfect. Both halves are compared
 * here, and separately, because they have different owning rules.
 */
function compareInline(ctx: Context, produced: Inline, reference: Inline, path: string, context: string, at: [number, number]): void {
  if (produced.text !== reference.text) {
    const kind = classifyText(produced.text, reference.text);
    ctx.findings.push(finding(ctx.doc, `${context}.${kind.suffix}`, kind.severity, "content", "substitute", path, produced.raw, reference.raw, undefined, at));
  }

  const wantEm = reference.emphasis.map((e) => `${e.strength}:${e.text}`).sort();
  const gotEm = produced.emphasis.map((e) => `${e.strength}:${e.text}`).sort();
  if (wantEm.join(" ") !== gotEm.join(" ")) {
    ctx.findings.push(finding(ctx.doc, "emphasis.span", "minor", "structure", "substitute", path, gotEm.join(" · ") || "(none)", wantEm.join(" · ") || "(none)", undefined, at));
  }

  // Pair refs by position within kind, so a label defect and a target defect on
  // the same anchor are two findings on one node rather than one vague one.
  for (const kind of ["link", "image"] as const) {
    const want = reference.refs.filter((rf) => rf.kind === kind);
    const got = produced.refs.filter((rf) => rf.kind === kind);
    for (let k = 0; k < Math.max(want.length, got.length); k += 1) {
      const w = want[k];
      const g = got[k];
      if (w && !g) {
        ctx.findings.push(finding(ctx.doc, `${kind}.inline.missing`, "major", "structure", "delete", `${path}/${kind}[${k}]`, null, `[${w.label}](${w.target})`, undefined, at));
        continue;
      }
      if (g && !w) {
        ctx.findings.push(finding(ctx.doc, `${kind}.inline.spurious`, "minor", "structure", "insert", `${path}/${kind}[${k}]`, `[${g.label}](${g.target})`, null, undefined, at));
        continue;
      }
      if (!w || !g) continue;
      if (g.target !== w.target) {
        ctx.findings.push(finding(ctx.doc, `${kind}.target`, "major", "structure", "substitute", `${path}/${kind}[${k}]`, g.target, w.target, undefined, at));
      }
      if (g.label !== w.label) {
        const cls = classifyText(g.label, w.label);
        ctx.findings.push(finding(ctx.doc, `${kind}.label.${cls.suffix}`, cls.severity, "content", "substitute", `${path}/${kind}[${k}]`, g.label, w.label, undefined, at));
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Text defect classification
// ---------------------------------------------------------------------------

const QUOTE_CHARS = /["“”«»„‟]/gu;
const DASH_CHARS = /[-‐‑‒–—―]/gu;
const ELLIPSIS = /(?:\.\.\.|…)/gu;

/**
 * Why two texts differ — the difference between a defect and a ceiling.
 *
 * A produced/reference pair that is equal once typography is folded is a
 * copyediting difference the source cannot back (`"` → `«`, `1913-42` →
 * `1913–1942`), and belongs in hook territory. A pair that still differs after
 * every fold is a content difference and belongs to a rule. Separating the two
 * here is what stops the ledger filling with unfixable noise.
 */
export function classifyText(produced: string, reference: string): { suffix: string; severity: Severity } {
  if (produced === reference) return { suffix: "equal", severity: "minor" };
  const collapse = (v: string) => v.replace(/\s+/gu, " ").trim();
  if (collapse(produced) === collapse(reference)) return { suffix: "whitespace", severity: "minor" };

  const noQuotes = (v: string) => collapse(v).replace(QUOTE_CHARS, '"');
  const noDash = (v: string) => noQuotes(v).replace(DASH_CHARS, "-");
  const noEllipsis = (v: string) => noDash(v).replace(ELLIPSIS, "…");
  const noNbsp = (v: string) => noEllipsis(v).replace(/[   ]/gu, " ").replace(/\s+/gu, " ");

  if (noQuotes(produced) === noQuotes(reference)) return { suffix: "typography.quotes", severity: "minor" };
  if (noDash(produced) === noDash(reference)) return { suffix: "typography.dash", severity: "minor" };
  if (noEllipsis(produced) === noEllipsis(reference)) return { suffix: "typography.ellipsis", severity: "minor" };
  if (noNbsp(produced) === noNbsp(reference)) return { suffix: "typography.space", severity: "minor" };

  // Hyphenation: a wrap artifact the source left behind, or one the reference
  // left behind. Invisible to `normalizeForCompare` by construction, because it
  // folds intra-word hyphens before comparing.
  const dehyphen = (v: string) => noNbsp(v).replace(/(\p{L})[-­]\s*(\p{L})/gu, "$1$2");
  if (dehyphen(produced) === dehyphen(reference)) return { suffix: "hyphenation", severity: "minor" };

  if (noNbsp(produced).toLowerCase() === noNbsp(reference).toLowerCase()) return { suffix: "case", severity: "minor" };

  const p = words(dehyphen(produced).toLowerCase());
  const r = words(dehyphen(reference).toLowerCase());
  if (p.length === 0 && r.length > 0) return { suffix: "content.empty", severity: "critical" };
  const overlap = jaccard(new Set(p), new Set(r));
  if (overlap >= 0.6) return { suffix: "content.edited", severity: "minor" };
  return { suffix: "content", severity: "critical" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classOf(block: Block): string {
  return block.kind === "directive" ? block.name : block.kind;
}

function describe(block: Block): string {
  return block.kind === "directive" ? block.name : block.kind;
}

function retypeClass(produced: Block, reference: Block): string {
  const from = produced.kind === "heading" ? `heading${produced.depth}` : classOf(produced);
  const to = reference.kind === "heading" ? `heading${reference.depth}` : classOf(reference);
  return `retyped.${from}-to-${to}`;
}

function missingSeverity(block: Block): Severity {
  if (block.kind === "break") return "minor";
  if (block.kind === "table" || block.kind === "paragraph" || block.kind === "quote") return "critical";
  return "major";
}

/**
 * Whether a block's presence is a content question or a layout question.
 *
 * A missing paragraph is missing prose and §16.3 applies to it. A missing
 * `::: columns` is a missing wrapper around prose that is present either way —
 * no content is invented by adding one, so it is decidable from geometry and
 * belongs to a rule, not to a ceiling.
 */
function evidenceOf(block: Block): Evidence {
  return block.kind === "directive" || block.kind === "break" ? "structure" : "content";
}

/** Properties whose absence changes what the reader sees, not just how. */
function propSeverity(key: string): Severity {
  return key === "src" || key === "columns" || key === "position" || key === "title" ? "major" : "minor";
}

function isProseProp(key: string): boolean {
  return key === "caption" || key === "alt" || key === "title" || key === "active";
}

function quoteProp(key: string, value: string | undefined): string {
  return `${key}: ${value ?? ""}`;
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return block.inline.text;
    case "list":
      return block.items.map((it) => it.inline.text).join(" ");
    case "table":
      return tableText(block);
    case "quote":
      return flatten(block.children);
    case "code":
      return block.value;
    case "break":
      return block.marker;
    case "directive":
      return `${block.name} ${Object.values(block.props).join(" ")} ${flatten(block.children)}`;
  }
}

/** Directive properties carrying author text rather than presentation (§6.1). */
const TEXT_PROPS = new Set(["caption", "title", "alt"]);

/**
 * A block as the *author text* it claims, for a finding's quoted span.
 *
 * Deliberately not {@link blockText}, which also drives pairing: there a
 * directive's name and every property belong, because they are what makes two
 * directives the same directive. Here they are scaffolding this instrument
 * added, and the span is handed to `triage` to look up in the source HTML.
 * `align center Francis Goya in Moscow` appears in no source document ever
 * written, so every spurious directive read as unattested and every one of them
 * was called a converter defect — `goya2`'s `Vol. 1` and `Vol. 2` among them,
 * where the reference had simply joined two source lines into one title.
 *
 * §6.1 draws the line already: `caption`, `title` and `alt` are text a reader
 * receives; `position`, `size`, `frame`, `src` and `link` are presentation and
 * targets. The directive's own name is never author text.
 */
function spanText(block: Block): string {
  if (block.kind !== "directive") return blockText(block);
  const text = Object.entries(block.props)
    .filter(([name]) => TEXT_PROPS.has(name))
    .map(([, value]) => value);
  return [...text, flatten(block.children)].join(" ").replace(/\s+/gu, " ").trim();
}

function flatten(blocks: readonly Block[]): string {
  return blocks.map(blockText).join(" ");
}

function tableText(table: TableBlock): string {
  return [...table.header, ...table.rows.flat()].map((c) => c.text).join(" ");
}

function words(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}

/**
 * Tokens for similarity.
 *
 * Intra-word hyphens are joined first, and for the same reason `classifyText`
 * joins them: this corpus is full of wrap artifacts (`классиче-ской`), and a
 * tokenizer that splits on them scores a paragraph against its own de-hyphenated
 * self at **zero**. The aligner then refuses to pair the two, and the
 * `hyphenation` class it exists to raise can never fire — the instrument's
 * blind spot sitting exactly on top of the defect it was built to find.
 */
function similarityTokens(value: string): string[] {
  return words(
    value
      .toLowerCase()
      .replace(/­/gu, "")
      .replace(/(\p{L})[-‐‑–—]\s*(\p{L})/gu, "$1$2"),
  );
}

/** Dice coefficient over word bigrams; falls back to token overlap for short texts. */
function textSimilarity(a: string, b: string): number {
  const wa = similarityTokens(a);
  const wb = similarityTokens(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  if (wa.length < 2 || wb.length < 2) return jaccard(new Set(wa), new Set(wb));
  const bigrams = (w: string[]) => new Set(w.slice(1).map((x, k) => `${w[k]} ${x}`));
  return dice(bigrams(wa), bigrams(wb));
}

/**
 * Targets are identity.
 *
 * Two blocks carrying the same link or image destination are the same block,
 * however differently the migrator labelled it — which is the whole point of
 * the `link.label` class, and unreachable if the aligner scores `[тут](x.pdf)`
 * against `[Часть 1 – PDF](x.pdf)` on their words alone.
 */
function refIdentity(a: Block, b: Block): number {
  const targets = (block: Block): Set<string> => {
    const out = new Set<string>();
    const walk = (n: Block): void => {
      if (n.kind === "heading" || n.kind === "paragraph") for (const r of n.inline.refs) out.add(r.target);
      else if (n.kind === "list") for (const it of n.items) for (const r of it.inline.refs) out.add(r.target);
      else if (n.kind === "directive") {
        if (n.props["src"]) out.add(n.props["src"]);
        for (const c of n.children) walk(c);
      } else if (n.kind === "quote") for (const c of n.children) walk(c);
    };
    walk(block);
    return out;
  };
  const ta = targets(a);
  const tb = targets(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  return jaccard(ta, tb);
}

function dice(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function truncate(value: string, limit = 160): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function finding(
  doc: string,
  cls: string,
  severity: Severity,
  evidence: Evidence,
  op: EditOp,
  path: string,
  produced: Block | string | null,
  reference: Block | string | null,
  note?: string,
  at?: [number | null, number | null],
): Finding {
  const p = produced === null ? null : truncate(typeof produced === "string" ? produced : spanText(produced));
  const r = reference === null ? null : truncate(typeof reference === "string" ? reference : spanText(reference));
  return {
    id: stableId(`${doc}|${cls}|${path}|${r ?? p ?? ""}`),
    doc,
    class: cls,
    severity,
    evidence,
    op,
    path,
    producedLine: at ? at[0] : produced !== null && typeof produced !== "string" ? produced.line : null,
    referenceLine: at ? at[1] : reference !== null && typeof reference !== "string" ? reference.line : null,
    produced: note && p === null ? note : p,
    reference: note && p !== null ? `${r ?? ""}${r ? " — " : ""}${note}` : r,
  };
}

/** FNV-1a. Deterministic, short, and stable across runs — ledger ids depend on it. */
function stableId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.id}|${f.producedLine}|${f.referenceLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
