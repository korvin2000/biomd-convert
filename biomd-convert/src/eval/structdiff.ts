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
  inlineOf,
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
  /** One text index per side — see {@link indexSide}. Looked up on the *other*. */
  index: Record<"produced" | "reference", SideIndex>;
}

export function diffDocuments(doc: string, producedSource: string, referenceSource: string): DiffResult {
  const produced = readBlocks(producedSource).blocks;
  const reference = readBlocks(referenceSource).blocks;
  const ctx: Context = {
    doc,
    findings: [],
    orphans: [],
    index: { produced: indexSide(produced), reference: indexSide(reference) },
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

/**
 * Report an orphan, named by where the *other* side put its text.
 *
 * The home question is symmetric and was asked on one side only. A produced
 * orphan was sub-classified by the construct owning its text in the reference;
 * a reference orphan was reported bare, at `missingSeverity` — `critical`, with
 * `content` evidence, which reads as "this prose was lost".
 *
 * Measured, it never was. All ten `paragraph.missing` findings in the corpus had
 * their text sitting in the produced document: three as a line inside a
 * hard-break run the reference had split into blocks, four as a whole paragraph
 * under a different parent, one as a table cell, two absorbed into a longer
 * block. Zero were absent. The ledger's top-ranked class, at `critical × 10 × 6`,
 * pointed at content loss that does not exist, and outranked every real class
 * while doing it.
 *
 * So presence is asked of both sides now, and it decides the severity. A block
 * whose words are on the other side is a **placement** finding — `major`, and
 * `structure`, because the defect is which container holds the text, not whether
 * the text survived. Only `.unattested` — the words are nowhere on the other
 * side — is a content finding, and that is the one case where `critical` is the
 * truth. The instances do not move: the same findings are reported, under names
 * that say what they are.
 *
 * The question is only well-posed for blocks whose text *is* their content.
 * {@link blockText} of a directive is its name and property values followed by
 * its children, so a `::: columns` never matches anything and `.unattested`
 * would assert a loss that its own children disprove — and a `---` has no text
 * to place at all. {@link evidenceOf} already draws exactly that line.
 */
function emitUnmatched(ctx: Context, orphan: Orphan): void {
  const block = orphan.block;
  const base = `${classOf(block)}.${orphan.side === "reference" ? "missing" : "spurious"}`;
  const home = evidenceOf(block) === "content" ? homeOf(ctx, block, orphan.side) : null;
  const cls = home === null ? base : `${base}.${home}`;
  const placed = home !== null && home !== "unattested";
  const severity = placed ? "major" : missingSeverity(block);
  const evidence = placed ? "structure" : evidenceOf(block);
  ctx.findings.push(
    orphan.side === "reference"
      ? finding(ctx.doc, cls, severity, evidence, "delete", orphan.path, null, block)
      : finding(ctx.doc, cls, severity, evidence, "insert", orphan.path, block, null),
  );
}

function childrenOf(block: Block): Block[] {
  return block.kind === "directive" || block.kind === "quote" ? block.children : [];
}

// ---------------------------------------------------------------------------
// Where did the other side put it?
// ---------------------------------------------------------------------------

/**
 * Sub-classify an orphan by the construct that owns its text on the other side.
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
 *   `.in-paragraph`  the other side keeps it as a paragraph too, somewhere else.
 *                    Nothing was retyped — this is placement, so the owning
 *                    mechanism is containment or ordering, not a block rule.
 *   `.in-break-run`  it is one *line* of a paragraph over there, ended by a hard
 *                    break. One side made a block boundary where the other made
 *                    a line ending: `Надя Борислова:` heads its own paragraph in
 *                    the reference and opens a `\`-run here.
 *   `.absorbed`      its words run contiguously *inside* a longer block over
 *                    there, at no boundary at all — a caption that swallowed the
 *                    line below it, a block quote left inline in its prose.
 *   `.unattested`    no construct on the other side holds this text. On the
 *                    produced side that is page chrome or content the reference
 *                    deleted; on the reference side it is the one thing this
 *                    class always claimed to be — prose that was genuinely lost.
 *
 * Asked strongest answer first: an exact match against a whole block beats a
 * line of one, which beats a run inside one. `.absorbed` is the weakest claim
 * and therefore last, never displacing an exact answer — and it stays honest
 * because every finding quotes both spans, so a coincidence is visible to
 * whoever reads it.
 *
 * No literals: both indices are built from the two documents being compared, and
 * the key is the text itself. A detector here cannot name a document.
 */
function homeOf(ctx: Context, block: Block, side: "produced" | "reference"): string {
  const other = ctx.index[side === "produced" ? "reference" : "produced"];
  const key = homeKey(blockText(block));
  if (key === "") return "unattested";
  // Same kind, elsewhere — asked first, because nothing was retyped and the
  // owning mechanism is therefore placement. A document may hold one piece of
  // text twice: `news` writes an obituary's subject as a bold paragraph *and*
  // captions the photograph below it with the same name. Answering
  // `.caption-echo` there sends a reader hunting for a duplicated caption when
  // the other side has the very same paragraph, three lines further down.
  if (block.kind === "paragraph") {
    if (other.paragraphs.has(key)) return "in-paragraph";
    // A line of a run is still a paragraph over there, so it belongs with the
    // same-kind answers and ahead of every retyping one. `borislova` opens with
    // `# Надя Борислова` and labels a quotation `Надя Борислова:` further down;
    // folded they are one key, and asking `home` first answered `.in-heading` —
    // true, coincidental, and it sends a reader to the masthead.
    if (other.lines.has(key)) return "in-break-run";
  }
  const named = other.home.get(key);
  if (named !== undefined) return named;
  if (other.lines.has(key)) return "in-break-run";
  return absorbedIn(other, key) ? "absorbed" : "unattested";
}

/**
 * Whether a key runs contiguously inside some longer block on the other side.
 *
 * Keys are space-joined words, so padding both ends turns substring containment
 * into whole-word containment — `гитара` cannot match inside `гитарист`.
 *
 * **False friend: a page that names itself.** Containment is the weakest answer
 * here and the only one that can be a coincidence, because a short phrase may
 * recur in a document for reasons that have nothing to do with where a block
 * went. The sweep is a trend rather than a plateau — 10 attributed at one word,
 * 9 at two, 8 at three, 5 from four up — so the number is doing real work and
 * was picked by reading what each step admits:
 *
 * - at **1**, `news`'s `ПОЗДРАВЛЯЕМ` matches inside any sentence containing it.
 *   A single word places nothing.
 * - at **2**, `news_2007`'s footer chrome `• Архив новостей •` matches inside
 *   the page's own heading, `Архив новостей за 2007 год`. The reference dropped
 *   that footer; saying the heading holds it sends a reader to the masthead.
 * - at **4**, three obituary subjects — `Ядвига Ричардовна КОВАЛЕВСКАЯ` and two
 *   more — stop being recognised inside the notices that name them, and revert
 *   to claiming the reference holds them nowhere. A full three-part name is not
 *   a coincidence.
 *
 * Three is the value that admits every full name and no bare label. The claim
 * stays honest above that because each finding quotes both spans: a containment
 * that *is* coincidental is visible to whoever reads it, and it never hides a
 * defect — it renames one from "lost" to "misplaced".
 */
function absorbedIn(other: SideIndex, key: string): boolean {
  if (key.split(" ").length < ABSORBED_MIN_WORDS) return false;
  const needle = ` ${key} `;
  return other.hosts.some((host) => host.length > key.length && ` ${host} `.includes(needle));
}

const ABSORBED_MIN_WORDS = 3;

/**
 * Fold text to a lookup key.
 *
 * Case and every non-alphanumeric character are dropped, so an escape (`01\.`),
 * a bullet glyph, a typographic dash or a different quote cannot hide the fact
 * that the same words landed somewhere else.
 *
 * Intra-word hyphens go too, via {@link similarityTokens} and for its reason:
 * this corpus wraps words mid-token, and a key that split on the hyphen made
 * `успе-хов` a different word from `успехов`. `jovicic`'s Segovia testimonial
 * then reported as content the produced document does not have, while sitting
 * inside its opening paragraph with one wrap artifact in it.
 */
function homeKey(text: string): string {
  return similarityTokens(text).join(" ");
}

/**
 * Everything one document says, keyed by text, for the other to ask about.
 *
 * Built per side and identical on both, because "where did the text go" and
 * "where did the text come from" are the same question asked from opposite
 * ends. Four indices rather than one, because they are four different answers,
 * ordered by strength in {@link homeOf}:
 *
 * - `home` — what the text *became*: a heading, a list item, a cell, a caption.
 * - `paragraphs` — whether it *stayed* a paragraph. Not a competing answer, a
 *   different question, which is why it is asked first and kept separate.
 * - `lines` — the hard-break-delimited lines of multi-line paragraphs, so a
 *   block boundary on one side can be recognised as a line ending on the other.
 * - `hosts` — every indexed key, longest-match fodder for {@link absorbedIn}.
 */
interface SideIndex {
  home: Map<string, string>;
  paragraphs: Set<string>;
  lines: Set<string>;
  hosts: string[];
}

function indexSide(blocks: readonly Block[]): SideIndex {
  const home = new Map<string, string>();
  const paragraphs = new Set<string>();
  const lines = new Set<string>();
  // First writer wins: a caption is also inside its `::: image`, and the caption
  // is the more specific — and more actionable — answer.
  const put = (text: string, where: string): void => {
    const key = homeKey(text);
    if (key !== "" && !home.has(key)) home.set(key, where);
  };

  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      switch (block.kind) {
        case "paragraph": {
          const key = homeKey(block.inline.text);
          if (key !== "") paragraphs.add(key);
          // Only a *multi-line* paragraph can absorb a block: a single-line one
          // has no interior boundary, and indexing it here would answer
          // `.in-break-run` for text that is simply a paragraph elsewhere.
          if (block.lines.length > 1) {
            // Through `inlineOf`, so a line is keyed by what it *says* — the
            // whole paragraph is, and a raw line is not. `[ДИСКОГРАФИЯ](/#/…)`
            // read literally carries its own target into the key and matches
            // the reference's bare label nowhere.
            for (const line of block.lines) {
              const lineKey = homeKey(inlineOf(line).text);
              if (lineKey !== "" && lineKey !== key) lines.add(lineKey);
            }
          }
          break;
        }
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
  return { home, paragraphs, lines, hosts: [...home.keys(), ...paragraphs] };
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
      // Nothing to compare. `---`, `***` and `___` are three spellings of one
      // thematic break (`BioMD-Reference.md` §1) — same node, same rendering,
      // no reader can tell them apart. The old `separator.spelling` finding
      // reported a difference that does not exist, which is precisely the
      // "invisible Markdown difference" the project's objective says not to
      // chase. A separator that is *missing* or *spurious* is still reported;
      // that is a claim about the document, not about how it is typed.
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
    const evidence: Evidence = isProseProp(key) || isTargetProp(key) ? "content" : "structure";
    if (want === undefined) {
      const echo = selfEcho(ctx, "produced", key, got) ? ".self-echo" : "";
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.spurious${echo}`, "minor", evidence, "insert", `${path}@${key}`, quoteProp(key, got), null, undefined, [produced.line, reference.line]));
      continue;
    }
    if (got === undefined) {
      // A property the profile does not define for this node is not something
      // the converter may emit, so its absence cannot be a converter defect.
      const off = offProfileProp(reference.name, parentDirectiveOf(path), key) ? ".off-profile" : "";
      const echo = off === "" && selfEcho(ctx, "reference", key, want) ? ".self-echo" : "";
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.missing${off}${echo}`, propSeverity(key), evidence, "delete", `${path}@${key}`, null, quoteProp(key, want), undefined, [produced.line, reference.line]));
      continue;
    }
    if (got === want) continue;
    // A property whose value is prose (caption, title, alt) fails the same way
    // prose does, so it is classified the same way and lands in the same cell.
    if (isProseProp(key)) {
      const kind = classifyText(got, want);
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.${kind.suffix}`, kind.severity, "content", "substitute", `${path}@${key}`, quoteProp(key, got), quoteProp(key, want), undefined, [produced.line, reference.line]));
    } else {
      ctx.findings.push(finding(ctx.doc, `${reference.name}.${key}.value`, propSeverity(key), evidence, "substitute", `${path}@${key}`, quoteProp(key, got), quoteProp(key, want), undefined, [produced.line, reference.line]));
    }
  }
  compareSequence(ctx, produced.children, reference.children, path);
}

/**
 * The directive that encloses the node at `path`.
 *
 * `compareSequence` builds every path as `…/<directive-name>[<index>]`, so the
 * segment before the last one names the parent exactly. This is not pattern
 * matching on a document — the names come from the same `describe()` that wrote
 * the path.
 */
function parentDirectiveOf(path: string): string | null {
  const segments = path.split("/").filter((s) => s !== "");
  const parent = segments[segments.length - 2];
  if (parent === undefined) return null;
  const at = parent.indexOf("[");
  return at === -1 ? parent : parent.slice(0, at);
}

/**
 * Properties `BioMD-Reference.md` §2 does not define for a node in this position.
 *
 * The spec's directive table gives `image` two profiles: standalone, which
 * REQUIRES `src`, `position` and `size`, and **child** — an `image` inside an
 * `images` group — which takes `src` plus `alt|caption|link|frame` and nothing
 * else. §3 says the same thing in words: *"child `position/size`
 * omitted/ignored"*. A group lays its children out itself, so the properties
 * have nothing to act on.
 *
 * `CLAUDE.md` §2.1 makes permissiveness normative: a reader must accept these
 * and ignore them, and an emitter may narrow what it writes. So a reference
 * that carries them is inside what the format tolerates and outside what it
 * defines — which makes "the converter did not write one" a statement about the
 * reference, not a defect. Without this the instrument reported 12 of `goya2`'s
 * 19 converter-defects for declining to emit a property the spec forbids it.
 *
 * Scoped to the one asymmetry the spec states outright and the corpus
 * exercises. The corpus agrees: of the four references that use `::: images`,
 * `borislova`, `jovicic` and `new_kolpakov` omit these on all seven of their
 * children and only `goya2` writes them.
 */
function offProfileProp(name: string, parent: string | null, key: string): boolean {
  return name === "image" && parent === "images" && (key === "position" || key === "size");
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

  // Hyphenation: a wrap artifact one side left behind. Invisible to
  // `normalizeForCompare` by construction, because it folds intra-word hyphens
  // before comparing.
  //
  // Which side kept it decides everything, and the two directions are not the
  // same finding. Source attestation cannot tell them apart — the source has
  // the hyphen either way, since that is the artifact being reported — so an
  // undivided class sent all of them to `converter-defect` on the strength of
  // evidence that says nothing. Measured over the 13 references: 11 hyphens the
  // reference joins and the converter keeps, and 14 the converter joins and the
  // reference keeps, every one of those 14 a correct Russian word
  // (`государственном`, `классической`, `фортепиано`). The references are
  // internally inconsistent here, so the class has to name the direction and
  // let triage weigh them differently.
  const dehyphen = (v: string) => noNbsp(v).replace(/(\p{L})[-­]\s*(\p{L})/gu, "$1$2");
  if (dehyphen(produced) === dehyphen(reference)) {
    // Compared word by word, not block by block: a paragraph long enough to
    // carry one wrap usually carries several, and the reference joins some of
    // them and keeps others. Asking "does this block contain a hyphen" answered
    // yes on both sides for 14 of the 16 and named nothing.
    const kept = (v: string) => new Set(noNbsp(v).match(/\p{L}+[-­]\s*\p{L}+/gu) ?? []);
    const ours = kept(produced);
    const theirs = kept(reference);
    const weKept = [...ours].some((w) => !theirs.has(w));
    const theyKept = [...theirs].some((w) => !ours.has(w));
    if (weKept && !theyKept) return { suffix: "hyphenation.unjoined", severity: "minor" };
    if (theyKept && !weKept) return { suffix: "hyphenation.joined", severity: "minor" };
    return { suffix: "hyphenation.mixed", severity: "minor" };
  }

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

/**
 * Whether the side that carries this figure label **also states it as a block**.
 *
 * `homeOf` asks "where did the *other* side put this text". That question is
 * well posed for a whole block and ill posed for a caption, because a caption
 * and the line it labels are routinely both present and both correct: the
 * reference binds `caption: 1.000.000 Platinum` to a cover *and* keeps
 * `**1.000.000 Platinum**` in the lane beside it. Asked of the other side, the
 * produced document does hold those words — as the very same lane paragraph —
 * and the answer says nothing about whether anything was lost.
 *
 * So the question is asked of the **owning** side instead, and it is a different
 * question: does this document say the words twice? When it does, the property
 * is an echo of a line the document keeps anyway, and the difference between the
 * two sides is not content but whether to repeat it. `CLAUDE.md` §5 rules on
 * exactly that — a visible caption is emitted **once, not twice** — so the side
 * that repeats is the side that moved, and {@link triage} reads the direction.
 *
 * Measured: all 7 `image.caption.missing` on `goya2` are this shape. The source
 * writes each album title once, in the cell beside its cover; the produced
 * document keeps it once; the reference keeps it *and* echoes it. They were
 * reported as content the converter lost.
 *
 * **`caption` and `alt` only.** They are the figure-label family §5 rules on. A
 * `nav` `active` echoes its own item by construction and a `frame` `title` names
 * a region rather than repeating a line, so neither is the same question.
 *
 * **False friend: a caption the converter failed to bind.** There the reference
 * states the text *once*, in the caption, and the produced leaves it loose — so
 * the owning side does not echo, no suffix is added, and the finding stays the
 * converter defect it is. That asymmetry is the whole point of asking the owning
 * side rather than the other one.
 *
 * **Where it deliberately stops.** Two of `goya2`'s seven captions merge *two*
 * blocks — `**Francis Goya Plays His Favourite Hits**` and `**Vol. 1**` are one
 * `caption: … vol. 1` — and neither the paragraph nor the line index holds the
 * joined key. Recognising that needs a concatenation search across sibling
 * blocks, which is a weaker claim about a smaller shape, and reaching for it
 * here would be chasing the last two findings rather than making the instrument
 * truer. They stay converter defects and are wrong about it; that is the honest
 * state, and it is recorded rather than tuned away.
 */
function selfEcho(ctx: Context, side: "produced" | "reference", key: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (key !== "caption" && key !== "alt") return false;
  const text = homeKey(value);
  if (text === "") return false;
  const own = ctx.index[side];
  // `lines` for the same reason {@link homeOf} consults it: a block boundary on
  // one side is a line ending on the other, and a label repeated as a *line* of
  // a longer paragraph is repeated just as visibly. `goya2` writes one album's
  // lane as `**Historia de un Amor**` and `1999` in a single hard-break run, so
  // the paragraph key carries the year and only the line key is the title.
  return own.paragraphs.has(text) || own.lines.has(text);
}

/**
 * A property whose value is a **target** — a URL, not a layout decision.
 *
 * `BioMD-Reference.md` §0 puts targets second in its precedence ladder, right
 * behind content, and §16.3 names `href`/`src` in the same breath as text among
 * the things a converter may not fabricate. Giving them `structure` evidence
 * routed them past {@link triage}'s attestation test entirely, on the rule that
 * "layout structure is always actionable" — which is true of a lane or a
 * separator and false of a URL, the one property class §16.3 protects by name.
 *
 * Measured: all 19 `image.src.value` findings on `news` were reported as
 * converter defects for a `/../` prefix that occurs in **no** source and in
 * exactly one of the 22 references. The produced side is the source verbatim;
 * following the reference would have been inventing a target.
 *
 * **`src` only, and deliberately not `link`.** An asset path is carried through
 * verbatim, so the source attests it or nothing does. A `link` is a *route*:
 * `links.ts` rewrites `../menu.htm` to `/#/menu`, so neither side of a link
 * finding can ever appear in the source and an attestation test would answer
 * "unattested" about a correct value. Route policy is structural and stays so.
 */
function isTargetProp(key: string): boolean {
  return key === "src";
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
