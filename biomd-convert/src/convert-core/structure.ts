/**
 * Structure recovery — LADOM → BioMD AST.
 *
 * Classification (classify.ts) says what the *source* is. This decides what to
 * *emit*, which is a separate question and usually answers "less than the
 * source had".
 *
 * The decisive constraint comes from the target: **GFM table cells are
 * inline-only**. That single fact partitions most of the decision space before
 * any judgement is needed — a region whose cells want block content is not a
 * data table, whatever it looked like in 1998.
 */
import type { BlockContent, List, ListItem, Paragraph, PhrasingContent, RootContent, Table, TableRow } from "mdast";
import {
  type BiomdColumn,
  type BiomdContent,
  type BiomdRoot,
  type BoundedContent,
  type ColumnsCount,
  type DowngradeRecord,
  type TargetProfile,
  downgradeNotice,
  makeAlign,
  makeAnchor,
  makeColumn,
  makeColumns,
  makeGroupedImage,
  makeImage,

  makeImages,
  makeLead,
  makeNav,
  resolveColumnsCount,
  resolveListMarkerPadding,
} from "../biomd-ast/index.js";
import { type GridCell, type TableGrid, columnCells, rowCells, trailingEmptyRows } from "../ladom/grid.js";
import { type PhysicalAlign, foldTextAlign, isDistinctiveAlign, proseAlign } from "../ladom/style.js";
import { type LadomNode, textOf, walkElements } from "../ladom/types.js";
import { AnchorRegistry, harvestAnchors } from "./anchors.js";
import { type Classification, classifyTable } from "./classify.js";
import { stripLabelGlyphs } from "./headings.js";
import {
  type LogicalTablePlan,
  type PlannedCell,
  type PlannedRow,
  MEDIA_LANE_SHARE,
  cellText,
  leadingCaptionCell,
  planDataTable,
} from "./data-table.js";
import { LINK_GLYPH, LIST_BULLETS, RULE_GLYPHS, iconGlyphFor, isDrawnRule } from "./glyphs.js";
import { UNNAMED_COLUMN_MARK, canonicalColumnLabel } from "./column-labels.js";
import { type LinkProfile, rewriteTarget, siteRelativeAsset } from "./links.js";
import { type LedgerEntry, emitted, mergedInto, removed, review } from "./ledger.js";
import {
  type BreakRunCandidate,
  type RunLine,
  breakRunId,
  enumeratedItems,
  groupIsLineated,
  groupLines,
  isWrapBreak,
  lineText,
  collapseSpace,
  opensWithOrdinal,
  phrasingText,
  splitLines,
} from "./lines.js";
import { preformattedText } from "./preformatted.js";
import { frameEvidenceFor } from "./frames.js";
import { prominenceOf } from "./prominence.js";
import {
  captionFor,
  contentWidthOf,
  formsImageRow,
  groupColumnsFor,
  imageWidthOf,
  isDecorative,
  isUiIcon,
  sizeTokenFor,
} from "./media.js";

export type LayoutFidelity = "faithful" | "simplified";

export interface StructureOptions {
  profile: TargetProfile;
  links: LinkProfile;
  /**
   * `simplified` collapses presentational lanes into linear flow and reserves
   * `columns` for genuine block-level parallelism. It is the default because
   * on a narrow screen lanes already stack into exactly the flattened order, so
   * they carry no information the reader ever perceives.
   */
  layoutFidelity?: LayoutFidelity;
  /** Classification override, e.g. from a hook. Keyed by table node id. */
  classifications?: Map<string, Classification>;
  /**
   * Column labels for tables whose source had no header row, keyed by table node
   * id. Supplied by the `table.records` hook; absent means the emitter falls
   * back to labels the column repeats, and to a review item if there are none.
   */
  tableHeaders?: Map<string, string[]>;
  /**
   * Break-runs an operator's judgement promoted to lists, keyed by
   * {@link breakRunId}. Supplied by the `text.list` hook; absent means every
   * abstaining run stays the hard-break paragraph it is today.
   */
  listRuns?: ReadonlySet<string>;
}

/** What happened to one source table, for the structural conservation audit. */
export interface TableOutcome {
  tableId: string;
  classification: TableClassName;
  /** True when a Markdown table was actually emitted for this region. */
  emittedTable: boolean;
  /** Set when a DATA/UNKNOWN region could not be planned; names the obstacle. */
  failure?: string;
  /** Semantic shape of the emitted table. */
  shape?: { rows: number; cols: number };
  /** True when the table was emitted with header cells the source never had. */
  headerMissing?: boolean;
}

type TableClassName = Classification["class"];

export interface StructureResult {
  root: BiomdRoot;
  ledger: LedgerEntry[];
  downgrades: DowngradeRecord[];
  /** Targets emitted, for the conservation gate. */
  targets: string[];
  images: string[];
  warnings: string[];
  /** Per-table record, so structural loss is auditable independently of text recall. */
  tables: TableOutcome[];
  /**
   * Runs of hand-drawn lines that no list rule could claim.
   *
   * Collected on every run, with or without a model, because "how many
   * judgements is the compiler declining to make?" is the one number that says
   * what turning a hook on would be worth — and it is unknowable otherwise.
   */
  listCandidates: BreakRunCandidate[];
}

interface Ctx {
  options: Required<Pick<StructureOptions, "profile" | "links" | "layoutFidelity">> & StructureOptions;
  ledger: LedgerEntry[];
  downgrades: DowngradeRecord[];
  targets: string[];
  images: string[];
  warnings: string[];
  grids: Map<string, TableGrid>;
  emittedIds: Set<string>;
  counter: { n: number };
  tables: TableOutcome[];
  /** Break-runs the four list rules all declined, in document order. */
  listCandidates: BreakRunCandidate[];
  /**
   * Width of the article's content box, in CSS px, when measurement ran.
   *
   * Image size tokens are a share of *this*, not of the nearest measured
   * ancestor: the nearest ancestor of a portrait is usually the paragraph the
   * portrait itself stretched, which made every image `full`.
   */
  contentWidth: number | undefined;
  /** Body-text prominence of this page, for "is this block smaller than prose?". */
  bodyProminence: number;
  /** Whether this page sets its ordinary prose in italic — the §3.5 baseline. */
  proseItalic: boolean;
  /** Blocks the source subordinated; empty unless the shape recurs (§5). */
  subordinated: WeakSet<object>;
  /** Whether the subordinated shape recurs — decided once, before lowering. */
  subordinationRecurs: boolean;
  /**
   * Alignment of this page's own prose — the baseline `::: align` is judged against.
   *
   * Never compared to an absolute keyword. A page whose body text is centred
   * throughout has no centred *blocks*; it has a centred page, and wrapping each
   * paragraph in `align` would recreate the margins §13 forbids recreating.
   */
  proseAlign: PhysicalAlign;
  /**
   * Emitted block → the computed alignment of the source element it came from.
   *
   * A run pass over siblings needs each block's alignment *after* lowering, when
   * the source node is no longer in hand. Recording it at the point of emission
   * is the only place both are available at once.
   */
  blockAlign: WeakMap<object, PhysicalAlign>;
  /**
   * Blocks a construct of their own already positions.
   *
   * A table's lifted caption is the case: it left the grid but it still belongs
   * to the table, and the container that centres the table centres it too. The
   * alignment the source states about it is therefore the table's, which §3.8
   * says the table carries itself — so an `::: align` around the caption alone
   * claims a group the author never drew, and puts the caption in a different
   * bounded container from the thing it captions.
   */
  positionedByConstruct: WeakSet<object>;
  /** Visible characters in the whole document, so "is this block the article?" is answerable. */
  documentTextLength: number;
  /** Emitted mdast image → the source node it came from, for late re-lowering. */
  imageNodes: Map<object, LadomNode>;
  /** Paragraphs whose source block reads as a caption: short, centred or small. */
  captionEligible: WeakSet<object>;
  /** Headings recovered from typography, so a menu below one can claim its label. */
  recoveredHeadings: WeakSet<object>;
  /** Recovered headings that sit in a centred block — the shape of a caption. */
  captionHeadings: WeakSet<object>;
  /** Whether the run currently being lowered sits in a caption-shaped block. */
  inCaptionContext: boolean;
  /** Whether that block is *centred*, which a caption is and a small note is not. */
  inCenteredBlock: boolean;
  /**
   * How many table regions enclose the node being lowered.
   *
   * One is the page shell — every 1998 page is a table, and the article inside
   * it is still the top level. Two or more is a real nested region: a record
   * card, a discography block, a resource matrix. A label recovered there is a
   * sub-section of whatever introduced the region, so it gets `###`.
   */
  tableDepth: number;
  /**
   * Depth inside a bounded container (`column`, `align`, `frame`).
   *
   * §4.1 forbids `nav` there, and the bounded-content filter would drop one
   * silently — taking every link in it with it. Not emitting one is the safe
   * shape of that rule.
   */
  boundedDepth: number;
  /** Depth inside a `frame`, which is already a bounded group of its own. */
  frameDepth: number;
  /** Named destinations the source declared, and which region has claimed each. */
  anchors: AnchorRegistry;
  /**
   * Emitted block → the destinations that should precede it.
   *
   * A mark rather than an inserted node, because insertion has to wait until
   * every adjacency-reading pass has run. See `anchors.ts` for why.
   */
  anchorMarks: WeakMap<object, string[]>;
  /**
   * Destinations claimed by the region currently being lowered, innermost last.
   *
   * Each `blocksFrom` call splices off its own suffix, so the array behaves as a
   * stack without being one, and a claim can never be placed by the wrong
   * container.
   */
  anchorPending: string[];
}

/**
 * Emission is speculative: a region is converted, inspected, and sometimes
 * rejected in favour of a different shape. Everything a conversion appends to
 * the context therefore has to be undoable, or a rejected attempt leaves its
 * links and images behind and the conservation gate reports them as invented
 * content. That was a real defect: a rejected data table contributed exactly its
 * first ten rows' links as "unexpected" targets.
 */
interface Snapshot {
  ledger: number;
  downgrades: number;
  targets: number;
  images: number;
  warnings: number;
  counter: number;
  tables: number;
  listCandidates: number;
  /** Destinations spoken for at the moment of the attempt. See `anchors.ts`. */
  anchorClaims: boolean[];
  anchorPending: number;
}

function begin(ctx: Ctx): Snapshot {
  return {
    ledger: ctx.ledger.length,
    downgrades: ctx.downgrades.length,
    targets: ctx.targets.length,
    images: ctx.images.length,
    warnings: ctx.warnings.length,
    counter: ctx.counter.n,
    tables: ctx.tables.length,
    listCandidates: ctx.listCandidates.length,
    anchorClaims: ctx.anchors.claims(),
    anchorPending: ctx.anchorPending.length,
  };
}

function rollback(ctx: Ctx, snapshot: Snapshot): void {
  ctx.ledger.length = snapshot.ledger;
  ctx.downgrades.length = snapshot.downgrades;
  ctx.targets.length = snapshot.targets;
  ctx.images.length = snapshot.images;
  ctx.warnings.length = snapshot.warnings;
  ctx.counter.n = snapshot.counter;
  ctx.tables.length = snapshot.tables;
  // A run that a rejected shape asked about was never emitted, so the question
  // was never really asked. Leaving it behind would spend a call on a block the
  // reader never sees.
  ctx.listCandidates.length = snapshot.listCandidates;
  // A rejected attempt gives its destinations back, so the shape that is
  // actually emitted can claim them. `min`, because a nested lowering may have
  // already spliced its own suffix off the pending list.
  ctx.anchors.restore(snapshot.anchorClaims);
  ctx.anchorPending.length = Math.min(ctx.anchorPending.length, snapshot.anchorPending);
}

const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export function recoverStructure(
  root: LadomNode,
  grids: readonly TableGrid[],
  options: StructureOptions,
): StructureResult {
  const harvest = harvestAnchors(root);
  const ctx: Ctx = {
    options: { layoutFidelity: "simplified", ...options },
    ledger: [],
    downgrades: [],
    targets: [],
    images: [],
    warnings: [],
    grids: new Map(grids.map((g) => [g.id, g])),
    emittedIds: new Set(),
    counter: { n: 0 },
    tables: [],
    listCandidates: [],
    contentWidth: contentWidthOf(root),
    bodyProminence: bodyProminenceOf(root),
    proseItalic: proseItalicOf(root),
    subordinated: new WeakSet(),
    subordinationRecurs: false,
    proseAlign: proseAlignOf(root),
    blockAlign: new WeakMap(),
    positionedByConstruct: new WeakSet(),
    documentTextLength: textOf(root).trim().length,
    imageNodes: new Map(),
    captionEligible: new WeakSet(),
    recoveredHeadings: new WeakSet(),
    captionHeadings: new WeakSet(),
    inCaptionContext: false,
    inCenteredBlock: false,
    tableDepth: 0,
    boundedDepth: 0,
    frameDepth: 0,
    anchors: new AnchorRegistry(harvest),
    anchorMarks: new WeakMap(),
    anchorPending: [],
  };

  for (const drop of harvest.rejected) {
    ctx.ledger.push(removed(drop.nodeId, `anchor #${drop.identifier} not emitted: ${drop.reason}`));
  }

  ctx.subordinationRecurs = subordinationRecursIn(root, ctx.proseItalic);

  const lowered = blocksFrom(root, ctx);

  // Markers go in **once, here, over the finished tree** — never inside
  // `blocksFrom`, and the difference is not stylistic. A grouping pass runs at
  // every level, and it groups across the blocks its *children* produced: an
  // anchor inserted at the level that claimed it is a sibling by the time the
  // level above looks, and adjacency is what those passes read. Placed one level
  // too early, `goya2`'s 26 album markers stood between six covers and the
  // caption lines that name them, unbinding three `::: images` groups and six
  // captions. Placed here, no pass can see one.
  const placed = new Set<string>();
  const children = highlightEmbeddedQuotations(insertAnchors(lowered, ctx, placed), ctx);

  // Two ways a destination fails to reach the output, both recorded, neither
  // guessed at. A marker put in the wrong place is worse than an absent one:
  // absent, the validator reports the `#x` link as unreachable and a human can
  // see it; misplaced, it silently sends the reader somewhere else.
  for (const orphan of ctx.anchors.unclaimed()) {
    ctx.ledger.push(
      removed(orphan.nodeId, `anchor #${orphan.identifier} not emitted: the content it named produced no block`),
    );
  }
  for (const identifier of ctx.anchorPending) {
    if (placed.has(identifier)) continue;
    ctx.ledger.push(
      review(`anchor:#${identifier}`, `anchor #${identifier} was claimed but the block it named did not survive lowering`),
    );
  }

  const surfaced = surfacedRuns(children);

  return {
    root: { type: "root", children },
    ledger: ctx.ledger,
    downgrades: ctx.downgrades,
    targets: ctx.targets,
    images: ctx.images,
    warnings: ctx.warnings,
    tables: ctx.tables,
    // Only runs that actually *shipped* as hard-break paragraphs are still
    // undecided. A run the group pass asked about may be claimed a level up —
    // `kiselev`'s six album track lists are recognised by the `<blockquote>`
    // around them, long after the lines inside were grouped — and asking about
    // an answered question would both waste a call and, if it were answered,
    // dissolve the containment the outer rule reads. Six of the corpus's 53
    // candidates were exactly that.
    listCandidates: ctx.listCandidates.filter((c) => surfaced.has(c.id)),
  };
}

/**
 * Ids of the multi-line hard-break paragraphs a finished tree actually carries.
 *
 * Computed from the emitted nodes rather than from what a pass intended, so a
 * block that was rewritten, re-parented or rolled back cannot leave a question
 * behind it.
 */
function surfacedRuns(children: readonly BiomdContent[]): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      const block = node as { type?: string; children?: unknown[] };
      if (block.type === "paragraph" && Array.isArray(block.children)) {
        const lines = splitLines(block.children as PhrasingContent[])
          .map((line) => lineText(line))
          .filter((t) => t.trim() !== "");
        if (lines.length >= MIN_RUN_LINES) ids.add(breakRunId(lines));
        continue;
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(children);
  return ids;
}

function nextId(ctx: Ctx, prefix: string): string {
  ctx.counter.n += 1;
  return `${prefix}:${ctx.counter.n}`;
}

/**
 * A quotation the author left inside a paragraph, marked as one.
 *
 * ## Rule contract — a long quotation embedded in prose is highlighted
 *
 * **Invariant.** `new_rules.md`, stated by the author and quoted here because
 * it is the whole of the rule: *"Предложения внутри большого блока параграфа
 * текста, заключенные в кавычки, если они не выделены как цитата и имеют длину
 * более 64 символов — выделять `==`"*. Four conditions, none of which reads a
 * document, class, id or word:
 *
 *   1. **a paragraph**, not a heading, a table cell, a menu or a code block;
 *   2. **not already marked as a quotation** — anything inside a `blockquote`
 *      is excluded, which is the "если они не выделены как цитата" clause;
 *   3. **embedded**, not the whole block: at least 64 characters of the
 *      paragraph stand outside the quotation, so a paragraph that *is* a
 *      quotation keeps its own shape and is not wrapped end to end;
 *   4. **longer than 64 characters** between the marks — the author's number,
 *      used unchanged in both places;
 *   5. **it is a sentence.** The author wrote *"Предложения"*, and this is what
 *      separates a quoted sentence from a quoted *name*: a work title, a prize
 *      citation, a thesis heading and a two-word phrase are all in quotation
 *      marks too, and `borislova`'s `"La procesion de las cucarachas por Rusia
 *      o La procesion del diablo"` is 66 characters of pure title. The test is
 *      sentence-final punctuation, read where Russian typography puts it —
 *      *outside* the closing mark (`…струн гитары".`) as well as inside — so a
 *      single-sentence quotation qualifies on the period that follows it.
 *
 * **Where the marks go.** Outside the highlight: `"==текст=="`. The author
 * writes the operand as `<текст в кавычках>` — *the text, which is in quotes* —
 * so the quotation marks are the sentence's punctuation and the highlight
 * covers what they enclose. This is the same shape {@link isHighlightedRun}
 * produces, where the mark wraps exactly the distinguished run.
 *
 * **Quote pairing is computed over the whole paragraph, not per text node**,
 * and a pair is wrapped only when both of its marks land in the *same* text
 * node. A quotation broken by a link, a bold run or a hard break is left alone
 * rather than guessed at: wrapping it would have to invent where the mark goes
 * relative to the other construct, and §0 ranks content above visible
 * distinction. A paragraph with an odd number of marks is skipped entirely,
 * because nothing can be paired reliably in it.
 *
 * **Deliberate divergence from the references, authorised by name.** No
 * reference marks these, and `new_rules.md` says so explicitly in the next
 * line: *"Если в reference файлах текст в кавычках не выделен `==`, считать
 * что он выделен, игнорировать такие различия (т.е. не считать это нарушением.
 * это улучшение визуала)"*. The cost is measured and stated in the commit; it
 * falls entirely on `CLAUDE.md`'s priority 6, reference fidelity, and on
 * nothing above it.
 */
function highlightEmbeddedQuotations(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const opaque = new Set(["blockquote", "heading", "tableCell", "code", "inlineCode", "biomdNav"]);
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const value = node as { type?: string; children?: unknown[] };
    if (value.type !== undefined && opaque.has(value.type)) return;
    if (value.type === "paragraph") {
      markQuotationsIn(value as unknown as Paragraph, ctx);
      return;
    }
    if (Array.isArray(value.children)) for (const child of value.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return [...nodes];
}

/** The quotation mark this corpus writes, and the pair `analyze` also uses. */
const QUOTE_MARKS: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["«", "»"],
]);

/** The author's figure, used for both the span and the prose around it. */
const EMBEDDED_QUOTATION_MIN_CHARS = 64;

const SENTENCE_FINAL = /[.!?…]/u;

/** What may stand before a mark that is opening rather than closing a quotation. */
const BEFORE_OPENING_QUOTE = /[\s(\[{«–—-]/u;

/** Whether the mark at `index` reads as an opening one in its context. */
function opensHere(chars: readonly { ch: string }[], index: number): boolean {
  if (index === 0) return true;
  return BEFORE_OPENING_QUOTE.test((chars[index - 1] as { ch: string }).ch);
}

/**
 * Is the quotation *inside* the paragraph rather than the whole of it?
 *
 * The author's "внутри большого блока параграфа текста" clause, stated
 * structurally instead of as a length: the paragraph must carry words of its
 * own outside the marks. A block that *is* a quotation has none, and marking it
 * end to end says nothing — `segovia` writes one as a whole italic paragraph
 * with a single full stop outside the marks, and its reference leaves it
 * italic. `new_blackmore` writes the shape this exists for, and its reference
 * highlights it: thirty-three characters of lead-in, `Как говорит сам Ричи
 * Блэкмор, он`, then the quotation. A length floor set anywhere between those
 * two is arbitrary; "has words of its own" is not, and needs no number.
 */
function isEmbedded(
  chars: readonly { ch: string }[],
  openIndex: number,
  closeIndex: number,
): boolean {
  let outside = "";
  for (let i = 0; i < chars.length; i += 1) {
    if (i >= openIndex && i <= closeIndex) continue;
    outside += (chars[i] as { ch: string }).ch;
  }
  return /\p{L}/u.test(outside);
}

/**
 * Does the quoted run contain a sentence, rather than name a thing?
 *
 * The clause that separates a quoted *sentence* from a quoted *title*, and the
 * two references that use `==` on a quotation settle it between them:
 * `jovicic` highlights `"Я с большим удовольствием констатирую… отношениях. Его
 * ждёт блестящая карьера…"` and leaves the prize citation `"за высокий уровень
 * исполнения серьёзной музыки и утверждение гитары в концертной жизни"`
 * unmarked, in the same document, four paragraphs apart. The first carries a
 * full stop; the second carries none, and neither does `borislova`'s 66-
 * character work title or `new_rechin4`'s quoted thesis heading.
 */
function holdsASentence(
  chars: readonly { ch: string }[],
  openIndex: number,
  closeIndex: number,
): boolean {
  for (let i = openIndex + 1; i < closeIndex; i += 1) {
    if (SENTENCE_FINAL.test((chars[i] as { ch: string }).ch)) return true;
  }
  return false;
}

/**
 * Where the highlight ends: after the closing mark, and after the stop that
 * belongs to it.
 *
 * Russian typography puts the full stop outside the quotation mark, and
 * `jovicic`'s reference takes it inside the highlight — `…педагога".==` — so
 * the mark covers the whole sentence rather than stopping one character short
 * of its end.
 */
function sentenceEnd(
  chars: readonly { owner: { value: string }; at: number; ch: string }[],
  closeIndex: number,
  owner: { value: string },
): number {
  let at = (chars[closeIndex] as { at: number }).at + 1;
  for (let i = closeIndex + 1; i < chars.length; i += 1) {
    const c = chars[i] as { owner: { value: string }; at: number; ch: string };
    // Only characters that are still contiguous in the same text node: a stop
    // that lives past a `<br>` or a bold run is not this sentence's to take.
    if (c.owner !== owner || c.at !== at || !SENTENCE_FINAL.test(c.ch)) break;
    at += 1;
  }
  return at;
}

/**
 * Does the quoted run end a sentence?
 *
 * Read on both sides of the closing mark, because the two conventions the
 * corpus mixes put the full stop in different places: `"…гитары."` keeps it
 * inside and `"…гитары".` puts it outside, and a rule that looked only inward
 * would refuse every single-sentence quotation written the Russian way. A
 * title, a prize citation or a quoted phrase has neither.
 */
function closesASentence(
  chars: readonly { ch: string }[],
  openIndex: number,
  closeIndex: number,
): boolean {
  for (let i = closeIndex - 1; i > openIndex; i -= 1) {
    const ch = (chars[i] as { ch: string }).ch;
    if (/\s/u.test(ch)) continue;
    if (SENTENCE_FINAL.test(ch)) return true;
    break;
  }
  for (let i = closeIndex + 1; i < chars.length; i += 1) {
    const ch = (chars[i] as { ch: string }).ch;
    // The serializer's escape of a following `[`, and nothing else, is skipped.
    if (ch === "\\") continue;
    return SENTENCE_FINAL.test(ch);
  }
  return false;
}

function markQuotationsIn(paragraph: Paragraph, ctx: Ctx): void {
  // One flat reading of the paragraph, with every character still knowing which
  // text node it came from. Pairing has to be global — a node that begins
  // mid-quotation would pair its own marks the wrong way round — while the
  // rewrite has to be local.
  const chars: Array<{ owner: { value: string }; at: number; ch: string }> = [];
  const collect = (list: readonly PhrasingContent[]): void => {
    for (const node of list) {
      if (node.type === "text") {
        for (let i = 0; i < node.value.length; i += 1) {
          chars.push({ owner: node as { value: string }, at: i, ch: node.value[i] as string });
        }
      } else if ("children" in node) collect(node.children as PhrasingContent[]);
    }
  };
  collect(paragraph.children as PhrasingContent[]);
  if (chars.length < EMBEDDED_QUOTATION_MIN_CHARS * 2) return;

  // Straight quotes carry no direction, so the role of each mark is read from
  // the character before it — after a space or an opening bracket it opens,
  // after a letter it closes — and the marks are matched on a stack. Pairing
  // them 1-2, 3-4 instead makes an *inner* quotation close the outer one, and
  // the span that survives starts mid-sentence: `xtra_shelechov` quotes a
  // review that names `"Чардаш"` inside itself, twice.
  const spans: Array<{ owner: { value: string }; from: number; to: number }> = [];
  const stack: Array<{ owner: { value: string }; at: number; index: number; closer: string }> = [];
  chars.forEach((c, index) => {
    const top = stack[stack.length - 1];
    if (top !== undefined && c.ch === top.closer && !opensHere(chars, index)) {
      stack.pop();
      const inner = index - top.index - 1;
      if (
        inner > EMBEDDED_QUOTATION_MIN_CHARS &&
        isEmbedded(chars, top.index, index) &&
        c.owner === top.owner &&
        holdsASentence(chars, top.index, index) &&
        closesASentence(chars, top.index, index)
      ) {
        // The marks and the stop that closes them are inside the highlight —
        // `=="…педагога".==`, exactly as `jovicic` and `new_blackmore` write it.
        spans.push({ owner: top.owner, from: top.at, to: sentenceEnd(chars, index, top.owner) });
      }
      return;
    }
    const closer = QUOTE_MARKS.get(c.ch);
    if (closer !== undefined && opensHere(chars, index)) {
      stack.push({ owner: c.owner, at: c.at, index, closer });
    }
  });
  if (spans.length === 0) return;

  const rewrite = (list: PhrasingContent[]): PhrasingContent[] => {
    const out: PhrasingContent[] = [];
    for (const node of list) {
      if (node.type !== "text") {
        if ("children" in node) {
          (node as { children: PhrasingContent[] }).children = rewrite(node.children as PhrasingContent[]);
        }
        out.push(node);
        continue;
      }
      const mine = spans.filter((s) => s.owner === (node as unknown as { value: string })).sort((a, b) => a.from - b.from);
      if (mine.length === 0) {
        out.push(node);
        continue;
      }
      let cut = 0;
      for (const span of mine) {
        if (span.from < cut) continue;
        const before = node.value.slice(cut, span.from);
        if (before !== "") out.push({ type: "text", value: before });
        out.push({
          type: "biomdHighlight",
          children: [{ type: "text", value: node.value.slice(span.from, span.to) }],
        } as unknown as PhrasingContent);
        ctx.ledger.push(emitted(nextId(ctx, "quotation"), nextId(ctx, "highlight")));
        cut = span.to;
      }
      const rest = node.value.slice(cut);
      if (rest !== "") out.push({ type: "text", value: rest });
    }
    return out;
  };
  paragraph.children = rewrite(paragraph.children as PhrasingContent[]);
}

/** Convert a node's children into top-level block content. */
function blocksFrom(node: LadomNode, ctx: Ctx): BiomdContent[] {
  const out: BiomdContent[] = [];
  let inlineRun: LadomNode[] = [];
  const outerCaptionContext = ctx.inCaptionContext;
  const outerCentered = ctx.inCenteredBlock;
  ctx.inCaptionContext = isCaptionContext(node, ctx);
  ctx.inCenteredBlock = node.kind === "element" && prominenceOf(node).centered;

  const emitInline = (): void => {
    if (inlineRun.length === 0) return;

    // Furniture first: a spacer, a nav arrow or a rule image is not content,
    // and leaving it in the run makes every downstream test — "is this run one
    // image?", "are these two images a row?" — answer the wrong question.
    inlineRun = dropDecorative(inlineRun, ctx);
    if (inlineRun.length === 0) return;

    // A floated image is not inline with the text — the text wraps *around* it.
    // §16.1 maps a floated portrait to a standalone `::: image` with left/right,
    // and §7.2 places it immediately before the paragraph it accompanies. Left
    // in the run it degrades to a bare `![]()` glued to the first word, which is
    // both wrong and what every legacy biography page looks like.
    const floats = floatedFigures(inlineRun, ctx);
    if (floats.length > 0) {
      inlineRun = inlineRun.filter((n) => !(n.kind === "element" && n.tag === "img" && isFloated(n)));
      if (inlineRun.length === 0) {
        for (const { figure } of floats) out.push(figure);
        return;
      }
    }

    // A stack of links separated by nothing but `<br>` is a menu — a side rail,
    // a pagination strip, a discography index. §16.1 maps it to `::: nav`, and
    // the difference is not cosmetic: as a paragraph it renders as a wall of
    // run-together links, and as a nav it renders as the bar the source drew.
    const nav = navFrom(inlineRun, ctx);
    if (nav) {
      inlineRun = [];
      out.push(nav);
      return;
    }

    // A run that is nothing but one image is a standalone figure, not a
    // paragraph containing an image. Only `::: image` carries position, size,
    // caption and a separate click target; a bare `![]()` gets none of them,
    // so defaulting to the directive is what preserves the meaning.
    // Images *including* the ones a link wraps. `<a href=big><img src=thumb>`
    // is the single most common standalone figure in this corpus, and looking
    // only at direct children missed every one of them: the run's one element
    // is the `<a>`, so the figure degraded to `[![](thumb)](big)` — inline
    // Markdown that carries no position, size, caption or frame.
    const images = runImages(inlineRun);
    const otherContent =
      inlineRun.some(
        (n) =>
          (n.kind === "text" && (n.value ?? "").trim() !== "") ||
          (n.kind === "element" && n.tag !== "img" && n.tag !== "br" && textOf(n) !== ""),
      ) || hasOrphanTarget(inlineRun, images, ctx);
    if (images.length === 1 && !otherContent) {
      const only = images[0];
      if (only) {
        const figure = imageFrom(only, ctx, true);
        inlineRun = [];
        if (figure) out.push(figure);
        return;
      }
    }

    // Two or more images and nothing else is one visual row (§8) — the
    // `<p align=center><img><img></p>` a legacy page uses for a plate. As
    // inline Markdown they lose the grouping, their captions and the
    // responsive collapse order the group defines.
    if (images.length >= 2 && !otherContent && formsImageRow(images)) {
      const group = imagesFrom(images, ctx);
      inlineRun = [];
      if (group) {
        out.push(group);
        return;
      }
    }

    const phrasing = inlineFrom(inlineRun, ctx);
    inlineRun = [];
    out.push(...blocksFromPhrasing(phrasing, ctx, out[out.length - 1], floats));
  };

  /**
   * Lower one inline run, and attach any destination declared inside it to the
   * first block that run produced.
   *
   * The claim is taken *before* lowering, because lowering empties `inlineRun`,
   * and released again when the run turned out to carry no block at all — a run
   * of nothing but spacer images, for instance. Releasing rather than dropping
   * lets the element above sweep the destination instead.
   */
  const flushInline = (): void => {
    if (inlineRun.length === 0) return;
    const claimed = ctx.anchors.claimInRun(inlineRun);
    const before = out.length;
    emitInline();
    if (claimed.length === 0) return;
    if (out.length > before) markAnchors(ctx, out[before] as BiomdContent, claimed);
    else ctx.anchors.release(claimed);
  };

  for (const child of node.children) {
    if (child.kind === "comment") continue;
    if (child.kind === "text") {
      if ((child.value ?? "").trim() !== "") inlineRun.push(child);
      else inlineRun.push(child); // whitespace separates inline runs
      continue;
    }

    if (isInline(child)) {
      inlineRun.push(child);
      continue;
    }

    flushInline();
    const produced = blockFrom(child, ctx);
    // Record what the source said about this block's alignment while the source
    // node is still in hand. Only element children: an inline run's alignment is
    // its *parent's*, which every sibling shares, so it is a property of the
    // container and not evidence about the run.
    const align = foldTextAlign(child.style?.textAlign);
    if (align !== null) for (const block of produced) ctx.blockAlign.set(block, align);
    // Same reasoning, for §3.5's subordination: the evidence is on the source
    // element and has to be recorded while it is still in hand.
    if (ctx.subordinationRecurs && isSubordinatedBlock(child, ctx)) {
      for (const block of produced) ctx.subordinated.add(block);
    }
    out.push(...produced);
  }

  flushInline();
  ctx.inCaptionContext = outerCaptionContext;
  ctx.inCenteredBlock = outerCentered;
  // Subordination before alignment: a quoted letter is one block quote whose
  // interior alignment is the quote's own business, and wrapping its paragraphs
  // in `align` first would leave the quote holding directives instead of prose.
  const ungrouped = [...out];
  const grouped = bindCaptions(
    groupAlignedRuns(
      groupSubordinatedRuns(
        groupSpannedQuotation(groupBulletedItems(promoteSectionAfterRule(promoteLabelBeforeList(promoteEntryDates(absorbContinuedItems(out), ctx), ctx), ctx))),
        ctx,
      ),
      ctx,
    ),
    ctx,
  );
  return rehomeAnchors(ungrouped, grouped, ctx);
}

/**
 * Containers an anchor may sit *inside*.
 *
 * Everything absent from this set is a construct whose interior cannot hold a
 * directive line — a table cell, a nav item, a list, a blockquote whose `> `
 * prefix defeats the renderer's line-anchored match — or one whose interior is
 * type-constrained to something else. A destination declared in any of those
 * hoists to just before the construct instead.
 *
 * `biomdColumns` is deliberately **not** here even though it is a container: its
 * body admits `column` children only, and `read()` records that the target
 * promotes any other line to a synthetic first column. Anchors inside a grid are
 * pushed down into the column that owns them; see {@link insertAnchors}.
 */
const ANCHOR_CONTAINERS = new Set(["biomdAlign", "biomdColumn", "biomdFrame", "biomdLead"]);

/** Note that `block` is preceded by these destinations, and record the claim. */
function markAnchors(ctx: Ctx, block: BiomdContent, identifiers: readonly string[], record = true): void {
  if (identifiers.length === 0) return;
  const existing = ctx.anchorMarks.get(block);
  if (existing) existing.push(...identifiers);
  else ctx.anchorMarks.set(block, [...identifiers]);
  if (record) ctx.anchorPending.push(...identifiers);
}

/**
 * Move a mark off a block a grouping pass consumed, onto the block that took its
 * place.
 *
 * The passes above replace rather than mutate: a caption line folded into an
 * image's `caption:` leaves *two* dead objects behind — the caption and the
 * image, which was rebuilt to carry it. A mark on either one would be lost, and
 * on `goya2` six of twenty-six markers were: exactly the six albums whose title
 * line became its cover's caption.
 *
 * The repair needs no knowledge of which pass ran. Every one of them replaces a
 * contiguous run in place, so the replacement for a dead block sits immediately
 * after the last block **before** it that survived. Finding that survivor and
 * taking its next sibling therefore names the replacement without naming the
 * transformation — and lands the marker before its content rather than after it,
 * which is the direction that matters: a reader who arrives one block early
 * scrolls down, and one who arrives one block late has already missed it.
 */
function rehomeAnchors(before: readonly BiomdContent[], after: BiomdContent[], ctx: Ctx): BiomdContent[] {
  const live = new Set<object>();
  collectNodes(after, live);
  if (!before.some((node) => !live.has(node) && hasAnyMark(node, ctx))) return after;

  for (let i = 0; i < before.length; i += 1) {
    const node = before[i] as BiomdContent;
    if (live.has(node)) continue;
    const marks = [...takeMarks(node, ctx), ...takeDeepMarks(node, ctx)];
    if (marks.length === 0) continue;
    const target = rehomeTarget(before, i, after, live);
    if (target) markAnchors(ctx, target, marks, /* record */ false);
  }
  return after;
}

function rehomeTarget(
  before: readonly BiomdContent[],
  index: number,
  after: readonly BiomdContent[],
  live: ReadonlySet<object>,
): BiomdContent | null {
  for (let j = index - 1; j >= 0; j -= 1) {
    const survivor = before[j] as BiomdContent;
    if (!live.has(survivor)) continue;
    const at = locate(after, survivor);
    if (!at) continue;
    // The replacement follows the survivor. When the survivor is last in its
    // list there is nothing after it, and the mark goes on the survivor itself:
    // one block early, never one block late.
    return (at.list[at.index + 1] ?? at.list[at.index]) as BiomdContent;
  }
  return (after[0] as BiomdContent | undefined) ?? null;
}

function locate(
  nodes: readonly BiomdContent[],
  target: object,
): { list: readonly BiomdContent[]; index: number } | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as BiomdContent;
    if (node === target) return { list: nodes, index: i };
    const found = locate(anchorChildrenOf(node), target);
    if (found) return found;
  }
  return null;
}

function collectNodes(nodes: readonly BiomdContent[], into: Set<object>): void {
  for (const node of nodes) {
    into.add(node);
    collectNodes(anchorChildrenOf(node), into);
  }
}

function hasAnyMark(node: BiomdContent, ctx: Ctx): boolean {
  if (ctx.anchorMarks.has(node)) return true;
  return anchorChildrenOf(node).some((child) => hasAnyMark(child, ctx));
}

function insertAnchors(nodes: readonly BiomdContent[], ctx: Ctx, placed: Set<string>): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (const node of nodes) {
    const own = takeMarks(node, ctx);

    if (node.type === "biomdColumns") {
      // Nothing may stand between `columns` and `column`. A mark on a column is
      // therefore placed at the top of that column's own body.
      for (const column of node.children) {
        const inside = takeMarks(column, ctx);
        column.children = [
          ...anchorNodes(inside, placed),
          ...insertAnchors(column.children as BiomdContent[], ctx, placed),
        ] as typeof column.children;
      }
      out.push(...anchorNodes(own, placed), node);
      continue;
    }

    if (ANCHOR_CONTAINERS.has(node.type)) {
      const container = node as { children: BiomdContent[] };
      // Mutated rather than copied: several passes above key WeakMaps on node
      // identity, and a replacement node would silently lose its alignment,
      // subordination and caption bindings.
      container.children = insertAnchors(container.children, ctx, placed);
      out.push(...anchorNodes(own, placed), node);
      continue;
    }

    out.push(...anchorNodes([...own, ...takeDeepMarks(node, ctx)], placed), node);
  }
  return out;
}

function anchorNodes(identifiers: readonly string[], placed: Set<string>): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (const identifier of identifiers) {
    if (placed.has(identifier)) continue;
    placed.add(identifier);
    out.push(makeAnchor(identifier));
  }
  return out;
}

function takeMarks(node: object, ctx: Ctx): string[] {
  const marks = ctx.anchorMarks.get(node);
  if (!marks) return [];
  ctx.anchorMarks.delete(node);
  return marks;
}

/** Every mark below `node`, cleared, in reading order. */
function takeDeepMarks(node: BiomdContent, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const child of anchorChildrenOf(node)) {
    out.push(...takeMarks(child, ctx), ...takeDeepMarks(child, ctx));
  }
  return out;
}

function anchorChildrenOf(node: BiomdContent): BiomdContent[] {
  if (node.type === "biomdNav") return [node.list as unknown as BiomdContent];
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? (children as BiomdContent[]) : [];
}

/**
 * A quotation that opens in one block and closes in the next is a block quote.
 *
 * ## Rule contract
 *
 * **Invariant.** Arithmetic on the author's own quotation marks: a paragraph
 * carrying an odd number of `"` — a quotation opened and not closed — whose
 * **immediately following** block carries an odd number too, closing it. The
 * text before the opener is the lead-in and stays outside; everything from the
 * opener to the end of the next block is the quotation. `analyze.md` states the
 * evidence outright for `segovia` — *"текст заключен в кавычки (&quot;) — это
 * явно индикатор, что эта цитата"* — and §3.5 is what a quotation maps to.
 * Nothing about the document, the words, the tags or the typography.
 *
 * **Recurrence.** Not applicable: a quotation spans a block boundary once, at
 * that boundary. The two-sided test is what carries the proof instead — an
 * unclosed quote alone proves nothing, and the corpus says so loudly.
 *
 * **False friends, measured rather than imagined.** Six blocks in the 22
 * produced documents carry an odd number of `"` and only one is this shape:
 *   - `kiselev` ×3 — `*1'52"*`, a **duration**. The mark is a seconds symbol,
 *     the next block does not close anything, and all three survive in
 *     `kiselev`'s own reference.
 *   - `segovia` ×1 — `„Жизнь, отданная искусству".`, a typographic opener
 *     paired with a straight closer, so the straight count is odd and the
 *     quotation is complete.
 *   - `segovia` ×1 — the block that *closes* this very quotation.
 * The requirement that the next block close it excludes every one of them, and
 * the opener test excludes the duration marks a second time: `1'52"` is
 * preceded by a digit, and an opening quote never is.
 */
function groupSpannedQuotation(blocks: readonly BiomdContent[]): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] as BiomdContent;
    const next = blocks[i + 1];
    const split = block.type === "paragraph" && next !== undefined && closesQuotation(next) ? splitAtOpener(block) : null;
    if (!split) {
      out.push(block);
      continue;
    }
    if (split.lead) out.push(split.lead);
    out.push({ type: "blockquote", children: [split.quoted, next as BlockContent] as BlockContent[] });
    i += 1;
  }
  return out;
}

const STRAIGHT_QUOTE = '"';

/** How many straight quotes a block's visible text carries. */
function quoteCount(text: string): number {
  return [...text].filter((ch) => ch === STRAIGHT_QUOTE).length;
}

/** Whether this block ends a quotation someone else opened. */
function closesQuotation(block: BiomdContent): boolean {
  const text = blockTextOf(block);
  if (quoteCount(text) % 2 === 0) return false;
  // A closer follows the words it closes; an opener never does.
  const at = text.lastIndexOf(STRAIGHT_QUOTE);
  const before = text[at - 1];
  return before !== undefined && !/[\s(\d]/u.test(before);
}

/**
 * A paragraph cut at the quotation mark that opens inside it.
 *
 * Only a top-level text child is cut. A quote opening inside emphasis or inside
 * a link is a different construct and the rule declines it rather than guessing
 * — which is also what keeps this off `kiselev`'s `*1'52"*`.
 */
function splitAtOpener(paragraph: Paragraph): { lead: Paragraph | null; quoted: Paragraph } | null {
  if (quoteCount(blockTextOf(paragraph)) % 2 === 0) return null;
  for (let i = paragraph.children.length - 1; i >= 0; i -= 1) {
    const child = paragraph.children[i] as PhrasingContent;
    if (child.type !== "text") continue;
    const at = child.value.lastIndexOf(STRAIGHT_QUOTE);
    if (at < 0) continue;
    // An opener is preceded by a space or a colon and followed by a word.
    const before = child.value[at - 1];
    const after = child.value[at + 1];
    if (before !== undefined && !/[\s:—–-]/u.test(before)) return null;
    if (after === undefined || /[\s)]/u.test(after)) return null;
    const leadText = child.value.slice(0, at).replace(/\s+$/u, "");
    const leadChildren = [...paragraph.children.slice(0, i), ...(leadText === "" ? [] : [{ type: "text" as const, value: leadText }])];
    const quoted: Paragraph = {
      ...paragraph,
      children: [{ type: "text", value: child.value.slice(at) }, ...paragraph.children.slice(i + 1)] as PhrasingContent[],
    };
    return { lead: leadChildren.length > 0 ? { ...paragraph, children: leadChildren } : null, quoted };
  }
  return null;
}

/**
 * Blocks the author bulleted by hand are the list they were drawing.
 *
 * ## Rule contract
 *
 * **Invariant.** Two or more *adjacent* blocks whose visible text opens with
 * the **same** mark from {@link LIST_BULLETS}. The mark is lexical data that
 * degrades to nothing on no-match; the evidence is that it repeats across
 * siblings, which is what a list is. Nothing about the document, the words, the
 * length or the typography — `segovia` writes two `<p>`s each opening `•` where
 * it means `<ul><li>`, and `analyze.md` asks for exactly this conversion.
 *
 * **Recurrence** is the rule rather than a gate on it: one bulleted line is a
 * **label**, which is the false friend `RULE_GLYPHS`' own note already names
 * (`• Из письма А.Максимова`), and a run of two is the smallest thing that can
 * be a list at all. Tested for non-firing.
 *
 * **Second false friend, also tested: the drawn divider.** `• • •` alone on a
 * line is a rule, and it never reaches here — `drawnRuleFrom` consumes it
 * earlier, and it would fail this test anyway because a divider's text is
 * nothing *but* marks.
 *
 * **Third: two different marks.** `•` under `·` is two authors' habits meeting,
 * not one list, so the run breaks where the mark changes.
 *
 * Measured over the 22 documents: **no reference anywhere** leaves a
 * bullet-opened line as a paragraph, and the produced side had exactly two,
 * both on `segovia` and both wanted as items.
 */
function groupBulletedItems(blocks: readonly BiomdContent[]): BiomdContent[] {
  const out: BiomdContent[] = [];
  let run: Paragraph[] = [];
  let mark: string | null = null;

  const flush = (): void => {
    if (run.length >= 2) {
      out.push({
        type: "list",
        ordered: false,
        spread: true,
        children: run.map((paragraph) => ({
          type: "listItem" as const,
          spread: false,
          children: [stripLeadingMark(paragraph)],
        })),
      });
    } else out.push(...run);
    run = [];
    mark = null;
  };

  for (const block of blocks) {
    const paragraph = block.type === "paragraph" ? block : null;
    const opener = paragraph ? bulletOpening(paragraph) : null;
    if (opener === null || paragraph === null) {
      flush();
      out.push(block);
      continue;
    }
    if (opener !== mark) flush();
    mark = opener;
    run.push(paragraph);
  }
  flush();
  return out;
}

/** The list mark a paragraph opens with, or null. */
function bulletOpening(paragraph: Paragraph): string | null {
  const text = blockTextOf(paragraph).trimStart();
  const first = [...text][0];
  if (first === undefined || !LIST_BULLETS.has(first)) return null;
  // A line that is *nothing but* marks is a divider, not an item.
  return text.slice(first.length).trim() === "" ? null : first;
}

/** The same paragraph with its opening mark and the space after it removed. */
function stripLeadingMark(paragraph: Paragraph): Paragraph {
  const strip = (nodes: readonly PhrasingContent[]): { done: boolean; nodes: PhrasingContent[] } => {
    const out = [...nodes];
    for (const [i, node] of out.entries()) {
      if (node.type === "text") {
        const trimmed = node.value.trimStart();
        if (trimmed === "") continue;
        const first = [...trimmed][0] as string;
        if (!LIST_BULLETS.has(first)) return { done: true, nodes: out };
        out[i] = { ...node, value: trimmed.slice(first.length).replace(/^[\s ]+/u, "") };
        return { done: true, nodes: out };
      }
      const children = (node as { children?: unknown }).children;
      if (!Array.isArray(children)) return { done: true, nodes: out };
      const inner = strip(children as PhrasingContent[]);
      out[i] = { ...node, children: inner.nodes } as PhrasingContent;
      return { done: true, nodes: out };
    }
    return { done: false, nodes: out };
  };
  return { ...paragraph, children: strip(paragraph.children).nodes };
}

/** The ordinal a line announces itself with — `09.` or `9)` — if it does. */
function announcedNumber(text: string): { value: number; delimiter: string } | null {
  const m = /^\s*(\d{1,3})([.)])\s/u.exec(text);
  if (!m) return null;
  return { value: Number.parseInt(m[1] as string, 10), delimiter: m[2] as string };
}

/**
 * Where an enumerated list has got to, if it is enumerated at all.
 *
 * Every item must announce a number, with one delimiter throughout, ascending
 * by exactly one. Two items minimum: a single numbered line is a line that
 * happens to start with a digit, and the sequence is the whole evidence.
 */
function enumeratedRunOf(list: List): { last: number; delimiter: string } | null {
  if (list.children.length < 2) return null;
  let previous: number | null = null;
  let delimiter: string | null = null;
  for (const item of list.children) {
    const announced = announcedNumber(blockTextOf(item as unknown as BiomdContent).trim());
    if (!announced) return null;
    if (delimiter === null) delimiter = announced.delimiter;
    else if (announced.delimiter !== delimiter || announced.value !== previous! + 1) return null;
    previous = announced.value;
  }
  return delimiter === null || previous === null ? null : { last: previous, delimiter };
}

/**
 * A numbered run the source split in two is one run.
 *
 * ## Rule contract
 *
 * **Invariant.** Arithmetic on the author's own numbering, and nothing else: a
 * block immediately after an enumerated list, announcing the *successor* of that
 * list's last number with the same delimiter, is that list's next item. No
 * document, tag, class, margin or wording is consulted — the source's own
 * counter says the run continues, and the block boundary between them is the
 * 1998 authoring slip `analyze-2.md` names ("Человеческая ошибка, присутствует
 * в оригинале — я исправил"). `goya2` closes one `<p>` after `08. Sound Of
 * Silence` and opens another for `09. Promise Me`.
 *
 * **Recurrence** is internal and required twice over: the list must hold at
 * least two items and they must ascend by one, so a single line beginning with
 * a digit can never open a run to be continued.
 *
 * **False friends**, each tested for non-firing:
 *   - **the next album's track list**, which restarts at `01.` — the commonest
 *     shape on this very page, and excluded because 1 is not the successor of
 *     16;
 *   - **a numbered aside** — a footnote or a reference that begins with a digit
 *     but not with the next one;
 *   - **a differently punctuated run** — `07.` followed by `08)` is a second
 *     list, not a continuation of the first.
 *
 * Measured over the 22 documents: exactly **one** paragraph follows an
 * enumerated list beginning with any number at all, and it is the wanted one.
 * The corpus offers no negative instance, which is why the false friends above
 * are constructed rather than cited.
 *
 * The list is **mutated** rather than rebuilt: `ctx.blockAlign`,
 * `ctx.subordinated` and `ctx.captionEligible` are keyed by block identity, and
 * a copy would silently drop this block out of all three.
 */
function absorbContinuedItems(blocks: readonly BiomdContent[]): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (const block of blocks) {
    const previous = out[out.length - 1];
    const run = previous?.type === "list" ? enumeratedRunOf(previous) : null;
    const continued = run && previous?.type === "list" ? continuingItems(block, run) : null;
    if (continued && previous?.type === "list") {
      previous.children.push(...continued);
      continue;
    }
    out.push(block);
  }
  return out;
}

/** The items `block` contributes to `run`, or null when it does not continue it. */
function continuingItems(block: BiomdContent, run: { last: number; delimiter: string }): ListItem[] | null {
  const continues = (text: string, expected: number): boolean => {
    const announced = announcedNumber(text.trim());
    return announced !== null && announced.value === expected && announced.delimiter === run.delimiter;
  };
  if (block.type === "paragraph") {
    return continues(blockTextOf(block), run.last + 1) ? [{ type: "listItem", spread: false, children: [block] }] : null;
  }
  // The slip can also close the `<p>` mid-run and leave several lines behind,
  // which lower to a list of their own rather than to a paragraph.
  if (block.type === "list") {
    const tail = enumeratedRunOf(block);
    if (!tail || tail.delimiter !== run.delimiter) return null;
    const first = announcedNumber(blockTextOf(block.children[0] as unknown as BiomdContent).trim());
    return first?.value === run.last + 1 ? [...block.children] : null;
  }
  return null;
}

/**
 * `::: align` for a **run** of consecutive siblings the author set apart (§6).
 *
 * ## Rule contract
 *
 * **Invariant.** A maximal run of adjacent sibling blocks whose *computed*
 * horizontal alignment is the same, and differs from the alignment of the page's
 * own prose ({@link proseAlignOf}). Relational, never absolute: the rule cannot
 * be stated as "centred" because on a centred page that describes everything.
 * No length, no font size, no tag, no class, no label vocabulary.
 *
 * **Recurrence.** Supplied by the baseline rather than by repetition of the
 * shape. The comparison is against a length-weighted aggregate of every prose
 * block on the page, so a block only qualifies by differing from a mass of
 * other blocks. A single-block threshold — the thing `CLAUDE.md` §5 records as
 * having regressed every time — is exactly what this avoids: nothing here reads
 * an absolute value at all.
 *
 * **False friends.** Three, each tested for non-firing:
 *   - a **caption** under a figure, which is centred because the figure is, and
 *     whose mapping is `::: image`'s `caption:` — excluded via `captionEligible`;
 *   - **article prose** that happens to be set apart, which §6 forbids wrapping
 *     — excluded by the pre-existing per-block length limit;
 *   - a block that **already carries a position** of its own — an image, a
 *     nested `align`, a `columns` region — where a wrapper would restate it.
 *
 * ## Why a run and not an element
 *
 * The references group: `segovia1` puts three right-set paragraphs in one
 * directive and `pavlov_azancheev` two. One directive per paragraph produces the
 * same rendering and a different document, and L2 compares documents. Grouping
 * also supplies the run's own boundary evidence — the run ends where the
 * alignment changes, which is the author's own division.
 *
 * ## `right` first, then `center` — measured, not chosen
 *
 * The rule reads `center` and `right` identically, but they were admitted in two
 * steps, because taking both at once was **rejected by L2**: converter defects
 * rose 596 → 602, `align.spurious` gaining 11, ten of them centred. Restricted
 * to `right` the same pass measured 596 → 593.
 *
 * The asymmetry was real but it was never about position. **Right is deliberate
 * — nothing inherits it.** Centre is ambient: inherited from a centred
 * container, free on a caption, and how a layout lane is filled. So on a page
 * whose lanes had collapsed to flow, every lane cell looked like a centred
 * block. `borislova` and `jovicic` were exactly that, and no guard at this seam
 * could separate them — by the time this pass sees the cells, the region is
 * already gone.
 *
 * Once inconclusive regions stopped falling through to flow and those two
 * documents got their `::: columns` back, the ambiguity went with them: spurious
 * aligns dropped 15 → 4 and `center` was admitted. L1 90.9 → 91.0 and L3 204 →
 * 199 with `layout.align.mismatch` 52 → 48 — the *rendered* alignment moved
 * closer, which is the question this family exists to answer.
 *
 * **The general lesson.** A false friend that exists only because an earlier
 * stage failed is not a false friend, it is a symptom. Guarding against it here
 * would have cemented the upstream defect and hidden it from every instrument.
 *
 * **Residue, deliberately unguarded.** One link-only centred back-link on
 * `segovia1`. "Link-only" cannot be the guard: `kiselev`'s right-set contact
 * block is link-only too and the reference wraps it.
 */
/**
 * The same pass, over a bounded container's *committed* children.
 *
 * `groupAlignedRuns` declines to fire while a bounded interior is still being
 * speculated about, and that guard has to stay — a region detector inspects the
 * produced shape to decide whether the region is a layout at all, and wrapping
 * a cell's paragraphs changed the shape it inspects. But declining forever was
 * never right: §13 says an `align` block MAY appear inside `lead`, `column` or
 * `frame`, and the references use all three — `news` alone puts eight inside
 * frames, one per obituary notice.
 *
 * So the pass runs once more when the container is decided and its children are
 * final. Nothing is being speculated about any more, and the evidence is the
 * same evidence.
 */
function groupAlignedRunsCommitted(children: BiomdContent[], ctx: Ctx, container: LadomNode): BiomdContent[] {
  // Inside a bounded container the *container's* alignment is the evidence.
  //
  // `blocksFrom` records alignment only for element children, on the stated
  // grounds that an inline run's alignment is its parent's and therefore says
  // nothing about the run. That holds in the page flow, where every sibling
  // shares the container. It stops holding at a boundary: a framed notice is
  // one `<p>` of `<br>`-separated lines, so every block in it arrives with no
  // alignment recorded at all, and the one fact that matters — this whole
  // notice is centred and the page around it is not — was the only thing not
  // written down. The references wrap exactly that: one `align` over the text,
  // ending at the image, which carries its own position.
  const inherited = foldTextAlign(container.style?.textAlign);
  if (inherited !== null) {
    for (const block of children) if (ctx.blockAlign.get(block) === undefined) ctx.blockAlign.set(block, inherited);
  }

  const frameDepth = ctx.frameDepth;
  const boundedDepth = ctx.boundedDepth;
  ctx.frameDepth = 0;
  ctx.boundedDepth = 0;
  try {
    return groupAlignedRuns(children, ctx);
  } finally {
    ctx.frameDepth = frameDepth;
    ctx.boundedDepth = boundedDepth;
  }
}

/**
 * `>` for a run of blocks the source subordinated to the article (§3.5).
 *
 * ## Rule contract
 *
 * **Invariant.** A maximal run of adjacent siblings each set *wholly* in italic
 * on a page that has upright prose to contrast against — see
 * {@link isSubordinatedBlock} for why this is the only one of §3.5's signals
 * that survives measurement on this corpus, and {@link proseItalicOf} for why
 * the contrast is tested rather than the majority. Explicitly not font size,
 * which §3.5 rules out in as many words and which on an archive page reports
 * the opposite of the truth.
 *
 * **Recurrence.** The shape must occur at least twice on the page, decided
 * before lowering by {@link subordinationRecursIn}. This is what carries the
 * rule: across the 13 references, wholly-italic blocks occur on four pages —
 * `pavlov_azancheev` (17), `segovia` (2), `borislova` (1), `barrios` (1) — and
 * requiring two selects exactly the two the references quote.
 *
 * **False friends**, each tested for non-firing:
 *   - a **single italic block**: a credit line or a title, which is what
 *     `barrios` and `borislova` have and what the recurrence gate excludes;
 *   - an **italic phrase inside a paragraph**, which §3.5 names outright ("do
 *     not turn titles, scare quotes, ordinary dialogue fragments … into a block
 *     quote") — a `<p>` wrapping `<i>` computes upright, so it never qualifies;
 *   - a **page set in italic throughout**, where the distinction carries no
 *     information at all.
 *
 * A run rather than a block: a quoted letter is several paragraphs, and §3.5
 * asks for attribution to stay in the final quoted paragraph, which only works
 * if the whole letter is one quote.
 */
function groupSubordinatedRuns(blocks: BiomdContent[], ctx: Ctx): BiomdContent[] {
  if (!ctx.subordinationRecurs || blocks.length === 0) return blocks;

  const out: BiomdContent[] = [];
  let run: BiomdContent[] = [];

  const flush = (): void => {
    // No ledger entry: every member was recorded as EMITTED by the element it
    // came from, and this pass regroups blocks without consuming source nodes.
    if (run.length > 0) out.push({ type: "blockquote", children: run as BlockContent[] });
    run = [];
  };

  for (const block of blocks) {
    // A quote holds prose. A picture, a table or a nested region carries its own
    // structure and §3.5 is about text the source set apart from other text.
    const eligible =
      ctx.subordinated.has(block) && (block.type === "paragraph" || block.type === "list" || block.type === "heading");
    if (!eligible) {
      flush();
      out.push(block);
      continue;
    }
    run.push(block);
  }
  flush();
  return out;
}

/**
 * Whether a `<blockquote>`'s content is quoted matter or merely indented.
 *
 * ## Rule contract
 *
 * **Invariant.** The tag is not the evidence — the content is, and it is the
 * *same* evidence {@link groupSubordinatedRuns} keys on: the region is set
 * wholly in italic on a page with upright prose to contrast against. This path
 * used to skip the question entirely and answer yes from the tag alone.
 * Subordination is subordination in whichever path reaches it.
 *
 * `<blockquote>` in 1998 FrontPage is an indent as often as a quotation, and
 * the corpus separates cleanly on §3.5 with nothing else consulted:
 *
 * | page | children | reference |
 * |---|---|---|
 * | `segovia` | `<i>` — quoted speech, wholly italic | quotes it |
 * | `kiselev` | `<p>` upright — a track list with durations | a list |
 * | `tarrega` | four upright blocks, headings and lists among them | flattened |
 *
 * **Read off the source element, not the produced blocks.** `blocksFrom`
 * records subordination for *element children only*, deliberately: an inline
 * run's **alignment** is its container's and says nothing about the run. Italic
 * is not like that — `<i>` is written around this run and nothing else — and
 * `segovia` writes exactly `<blockquote><i>…</i></blockquote>`, so its
 * paragraph is born from an inline flush and never enters `ctx.subordinated`.
 * Asking the produced set here answered no on the one page in the corpus whose
 * blockquotes the reference does quote.
 *
 * **Recurrence** is `ctx.subordinationRecurs`, the same page-level gate the run
 * pass uses, so a page with a single italic aside cannot reach this at all.
 *
 * **False friends**, each tested for non-firing:
 *   - **an indent holding one italic line** — a credit or a title set apart
 *     inside an otherwise ordinary indented region. `every` rather than `some`:
 *     a region is quoted matter only when the source set *all* of it apart.
 *   - **an italic phrase beside bare text**, which is §3.5's "do not turn …
 *     ordinary dialogue fragments … into a block quote". Text directly under
 *     the element was not set apart, so its presence settles the question.
 *
 * **Why not the tag under the page-level gate instead.** Measured: `recurs` is
 * true on `kiselev` and `tarrega` too, so a page-level gate separates nothing
 * here. The evidence has to be read off the content.
 */
function quotesItsContent(el: LadomNode, ctx: Ctx): boolean {
  return ctx.subordinationRecurs && contentIsSubordinated(el, ctx);
}

/**
 * Whether a container's *content* is wholly set apart, as opposed to the
 * container itself carrying the style.
 *
 * The same region, written the other way round: `<p style="font-style:italic">`
 * puts the evidence on the block, `<blockquote><i>…</i></blockquote>` puts it
 * on the run inside. {@link isSubordinatedBlock} sees the first and not the
 * second, so this asks the second — and both {@link quotesItsContent} and
 * {@link subordinationRecursIn} consult it, which is what keeps the gate and
 * the rule looking at the same evidence.
 *
 * Bare text directly under the element disqualifies the region outright: it is
 * content the source did *not* set apart, so what sits beside it is a phrase,
 * not a quotation. That is §3.5's "do not turn … ordinary dialogue fragments …
 * into a block quote", asked structurally.
 */
function contentIsSubordinated(el: LadomNode, ctx: Ctx): boolean {
  let elements = 0;
  for (const child of el.children) {
    if (child.kind !== "element") {
      if (child.kind === "text" && (child.value ?? "").trim() !== "") return false;
      continue;
    }
    if (!isSubordinatedBlock(child, ctx)) return false;
    elements += 1;
  }
  return elements > 0;
}

function groupAlignedRuns(blocks: BiomdContent[], ctx: Ctx): BiomdContent[] {
  if (ctx.frameDepth > 0 || blocks.length === 0) return blocks;
  // Bounded interiors belong to `alignedGroup`, which is scoped to them. Firing
  // here as well is not merely redundant: cell interiors are lowered
  // *speculatively*, and a region detector then inspects the produced shape to
  // decide whether the region is a columns layout at all. Wrapping a cell's
  // paragraphs in `align` changed that shape and the detector rejected the
  // region — `jovicic` and `borislova` lost every `::: columns` and `::: column`
  // they had. A pass that runs mid-speculation must not alter what is being
  // speculated about.
  if (ctx.boundedDepth > 0) return blocks;

  const out: BiomdContent[] = [];
  let run: BiomdContent[] = [];
  let runAlign: "center" | "right" | null = null;

  const flush = (): void => {
    // No ledger entry: every member was already recorded as EMITTED by the
    // element it came from, and `runPass` rejects an id it did not declare —
    // this pass regroups blocks, it does not consume source nodes.
    // A run of nothing but rules has no content to position: `align` would
    // claim a bounded group where the source drew a divider, so those members
    // leave the run as they entered it.
    if (runAlign !== null && run.length > 0 && run.some((block) => blockTextOf(block) !== "")) {
      out.push(makeAlign({ position: runAlign, children: run as BoundedContent[] }));
    } else {
      out.push(...run);
    }
    run = [];
    runAlign = null;
  };

  // Whether the blocks arriving now are standing under a figure, and are
  // therefore its caption rather than an aligned run of their own. See the
  // `captionEligible` note in `alignableRunMember`.
  let underFigure: boolean = false;

  for (const block of blocks) {
    const caption: boolean = underFigure && ctx.captionEligible.has(block);
    const align = caption ? null : alignableRunMember(block, ctx);
    underFigure = caption || (block.type === "biomdImage" && block.standalone);
    if (align === null) {
      flush();
      out.push(block);
      continue;
    }
    // A rule the author drew *between* two aligned lines divides them, and a
    // wrapper that spans it asserts the opposite — §13 calls `align` a bounded
    // group, so one group either side of the divider is what the source says.
    // See {@link dividesTheRun}.
    if (dividesTheRun(block, run)) {
      flush();
      out.push(block);
      continue;
    }
    if (align !== runAlign) flush();
    runAlign = align;
    run.push(block);
  }
  flush();
  return out;
}

/**
 * Whether a rule arriving now is dividing the run rather than opening it.
 *
 * ## Rule contract
 *
 * **Invariant.** Position within the run, not the rule's own typography: a
 * `thematicBreak` divides when the run already holds a text-carrying member, so
 * the source drew content, then a divider, then more content. Nothing about the
 * document, the glyph the divider was written with, or how long either side is.
 *
 * **Why it is not a recurrence rule.** A divider inside a bounded group occurs
 * at most once per group by construction, so there is no second occurrence to
 * require. The evidence is *containment* instead, which `CLAUDE.md` §5 names as
 * the substitute where recurrence cannot apply: an `::: align` spanning a
 * divider claims the two halves are one bounded group, which is precisely what
 * the divider denies.
 *
 * **False friend, tested for non-firing: the rule that *opens* a run.**
 * `kiselev` ends with `::: align position: right` whose first child is `---`,
 * and its reference keeps it there. That rule separates the footer from the
 * page above it; it divides nothing inside the group, and the run has no
 * text-carrying member yet when it arrives. This is also why the exclusion is
 * written against `run` rather than against the block list: hoisting *every*
 * rule out would put `kiselev`'s divider in a different container from the
 * signature line it introduces, which is the case {@link alignableRunMember}
 * records for admitting rules to a run at all.
 *
 * A trailing rule is left alone for the same reason — with nothing after it
 * inside the group it is not between anything.
 */
function dividesTheRun(block: BiomdContent, run: BiomdContent[]): boolean {
  return block.type === "thematicBreak" && run.some((member) => blockTextOf(member) !== "");
}

/**
 * The alignment a block contributes to a run, or null when it cannot join one.
 *
 * Every exclusion here is a false friend or a spec rule, never a tuning knob.
 */
function alignableRunMember(block: BiomdContent, ctx: Ctx): "center" | "right" | null {
  const align = ctx.blockAlign.get(block);
  if (align === undefined || align === null) return null;
  // `left`/`justify` are the reading flow and say nothing; `center` and `right`
  // say something only if the page does not already. The relational test on the
  // next line is what turns either into evidence — not the keyword itself.
  if (align !== "center" && align !== "right") return null;
  if (!isDistinctiveAlign(align, ctx.proseAlign)) return null;

  // §4.1: these may not sit inside a bounded container, and the bounded-content
  // filter would drop them silently — taking their links with them.
  if (!isBounded(block)) return null;
  // A picture, a nested align and a frame each carry their own position (§6).
  if (block.type === "biomdImage" || block.type === "biomdImages") return null;
  if (block.type === "biomdAlign" || block.type === "biomdFrame") return null;
  // §3.8 tables and §2 headings are positioned by their own construct — and so
  // is anything a construct kept hold of while lowering it out of itself.
  if (block.type === "table" || block.type === "heading") return null;
  if (ctx.positionedByConstruct.has(block)) return null;
  // A rule carries no text, so it can never *nominate* an alignment. The source
  // block it came from can, and `blocksFrom` records that on every block the
  // element produced — a `<br>`-separated `<p>` that draws a rule above its
  // signature is **one** aligned block in the source, and hoisting the rule out
  // of the run puts it in a different container from the line it divides. So it
  // may join a run and never open one: `groupAlignedRuns` emits a run with no
  // text-carrying member bare, which is what keeps a lone rule at the root.
  if (block.type === "thematicBreak") return align;
  // A list is never a bounded group. §13 enumerates what one is — "a short
  // paragraph, dedication, small heading group, or credit line" — and warns
  // that centred body text is harder to read; across the 13 references **none**
  // of 499 list items sits inside an `::: align`. The length cap used to hide
  // this: `segovia`'s discography is 24 items and ~350 characters, so raising
  // the cap centred the whole discography rather than admitting one more label.
  if (block.type === "list") return null;

  // False friend: the caption bound to a figure. `::: image`'s `caption:` is
  // where it belongs — a competing `align` both duplicates the position and
  // detaches the text from its picture.
  //
  // The test is *positional* and lives in the caller: `captionEligible` marks a
  // block whose typography would let it be a caption, which is a candidacy and
  // not a fact. Reading it as a fact here vetoed every centred line in every
  // framed notice on `news` — an obituary's opening sentence carries exactly
  // the typography of a caption and stands *above* the photograph, so it never
  // becomes one, and the veto only stopped it from being recognised as what it
  // is. A caption follows its figure; nothing else does.

  // §6: "do not wrap … long body prose". Pre-existing limit, unchanged, applied
  // per block so one long paragraph cannot drag a run of labels with it.
  const text = blockTextOf(block);
  if (text.trim() === "" || text.length > ALIGN_LABEL_MAX_CHARS) return null;
  if (!isAlignableLabelText(text)) return null;

  return align;
}

/** Visible text of an emitted block, for the length and label guards. */
function blockTextOf(block: BiomdContent): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const n = node as { type?: string; value?: string; children?: unknown[] };
    if (n.type === "text" && typeof n.value === "string") parts.push(n.value);
    if (Array.isArray(n.children)) for (const child of n.children) visit(child);
  };
  visit(block);
  return parts.join("").replace(/\s+/gu, " ").trim();
}

/**
 * A dated news entry's date line is that entry's heading.
 *
 * `11 декабря 2007 г.` in its own narrow lane, with the entry beside it, is
 * §2.2's repeated entry label. As a bare paragraph the archive reads as an
 * undifferentiated column of dates and text with no outline and no anchor to
 * link an entry by.
 *
 * Recurrence is required: one dated line inside a biography is a sentence.
 */
/**
 * A short line immediately after a horizontal rule is a section label.
 *
 * The rule *is* the section boundary — it is what a page of this era used
 * instead of `<h2>`, and the line the author put directly under it names what
 * follows. `Надя Борислова: ПРОИЗВЕДЕНИЯ ДЛЯ ГИТАРЫ (1989–2002)` carries no
 * weight, no size and no centring, so no typographic rule can see it; its
 * position is the whole evidence.
 *
 * **Not inside a record region.** `headingLineOf` already declines there —
 * "every card opens with a bold line: the album title above its track list
 * ... only the article's own flow gets headings from a line" — and this
 * function shares the same evidence gap: a plain label without weight or
 * centring is exactly what a catalog's own field labels look like too. Two
 * levels of `<table>` and not one, because the page frame itself is a table,
 * so ordinary top-level prose already sits at depth 1.
 */
export function promoteSectionAfterRule(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  if (ctx.tableDepth >= 2) return [...nodes];
  const out = [...nodes];
  for (let i = 1; i < out.length - 1; i += 1) {
    const rule = out[i - 1] as BiomdContent;
    if (rule.type !== "thematicBreak") continue;
    // Only a rule the *author* drew is evidence. A separator this pipeline
    // derived from a row boundary is our own claim, and letting it feed a
    // detector that keys on separators is circular: on `news` the entry rules
    // promoted a paragraph per entry and the heading axis fell 66.7 to 25.0.
    if (isDerivedRule(rule)) continue;
    const node = out[i] as BiomdContent;
    if (node.type !== "paragraph") continue;
    if (node.children.some((c) => c.type === "link" || c.type === "image" || c.type === "break")) continue;
    // False friend: the byline. A short line set **right** of the column is a
    // credit — `BioMD-Reference.md` §3 has a directive for exactly that shape
    // — and a credit closes what precedes it rather than introducing what
    // follows, which is the opposite of what this rule claims. `Александр
    // НЕВЕРОВ` and `Владимир МАРКУШЕВИЧ` both stand right of the column under
    // a rule and both references write them `::: align position: right`.
    //
    // Only `right`, not "distinctively aligned". Centred is the *other* way
    // this era wrote a section label, and `borislova`'s `Надя Борислова:
    // ПРОИЗВЕДЕНИЯ ДЛЯ ГИТАРЫ (1989-2002)` — the line this rule was built for
    // — is centred. Excluding centring too was measured and costs it.
    if (ctx.blockAlign.get(node) === "right") continue;
    const text = phrasingText(node.children).replace(/\s+/gu, " ").trim();
    if (text.length < 6 || text.length > 90) continue;
    if (/[.!?]\s/u.test(text) || /[,;]$/u.test(text)) continue;
    if (text.split(/\s+/u).filter(Boolean).length > 12) continue;

    // It has to introduce something.
    const following = out.slice(i + 1).reduce((n, b) => n + blockTextLength(b), 0);
    if (following < 200) continue;

    const heading: BiomdContent = { type: "heading", depth: 2, children: headingPhrasing(node.children) };
    ctx.recoveredHeadings.add(heading);
    out[i] = heading;
  }
  return out;
}

/**
 * A separator this pipeline drew, rather than one the source contained.
 *
 * Marked at the point of emission so no later pass has to guess. Nothing in the
 * serialized output carries the mark — it exists only to stop a derived signal
 * from being read back as evidence.
 */
function markDerivedRule(): BiomdContent {
  return { type: "thematicBreak", data: { biomdDerived: true } } as BiomdContent;
}

function isDerivedRule(node: BiomdContent): boolean {
  return (node as { data?: { biomdDerived?: boolean } }).data?.biomdDerived === true;
}

function blockTextLength(node: BiomdContent): number {
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return 0;
  const phrasing = children.filter((c) => typeof (c as { type?: string }).type === "string");
  return (
    phrasingText(phrasing as PhrasingContent[]).length +
    (phrasing as BiomdContent[]).reduce((n, c) => n + blockTextLength(c), 0)
  );
}

/**
 * A short label sitting directly on top of a list is that list's heading.
 *
 * `ДИСКОГРАФИЯ` over a `<ul>` of albums, `См. также:` over a `<ul>` of related
 * pages. Neither is bold, neither is centred and both are set *smaller* than
 * the body, so no typographic rule reaches them — the only evidence is that a
 * list starts on the next line. Recurrence guards it: one label above one list
 * is a sentence introducing an enumeration, three are a page's section model.
 *
 * **Not inside a record region**, the same exclusion `headingLineOf` and
 * {@link promoteSectionAfterRule} both make and for the same reason:
 * `kiselev`'s six album titles each sit directly above that album's own
 * track list — recovered as a `list` by {@link listFromBlockquoteRun}, not
 * authored as a `<ul>` — and six is recurrence enough to satisfy this rule's
 * own floor of two. A record's own field label is not a document section,
 * however many times the record repeats.
 *
 * ## The solitary label, and why recurrence cannot decide it
 *
 * A page has one discography. Requiring the shape to repeat refuses the very
 * construct the rule was written for — `segovia`'s `ДИСКОГРАФИЯ`, named above —
 * and `CLAUDE.md` §5's recurrence law is explicitly a law about shapes that
 * repeat *within* a document, not about ones that occur once by definition.
 * What stands in for it is evidence the author left in the line itself:
 *
 *   - **it shouts, or it is wholly bold.** A lead-in is written in running
 *     case because it is running prose; a section label is set apart.
 *   - **it does not end in a colon.** A colon is the mark of a sentence
 *     handing over to what follows — `Примечания:` above its numbered notes,
 *     `См. также:` above its related pages — and both of those are paragraphs
 *     in the references, not headings.
 *
 * Both are required, and either one alone admits the false friend the other
 * excludes. The depth differs from the recurring branch for a stated reason:
 * several labels enumerating the parts of one region are peers *inside* a
 * section (`###`), while a single label opening a list nobody else labels is a
 * section of the document (`##`) — the same reading {@link headingLineOf} takes
 * of a solitary shouted line, and the one `segovia`'s reference writes.
 */
export function promoteLabelBeforeList(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  if (ctx.tableDepth >= 2) return [...nodes];
  const candidates: number[] = [];
  const standalone: number[] = [];
  nodes.forEach((node, index) => {
    if (node.type !== "paragraph") return;
    const next = nodes[index + 1];
    if (!next || next.type !== "list") return;
    if (node.children.some((c) => c.type === "link" || c.type === "image" || c.type === "break")) return;
    const raw = phrasingText(node.children).replace(/\s+/gu, " ").trim();
    const text = raw.replace(/[:\s]+$/u, "");
    if (text.length < 4 || text.length > 60) return;
    if (text.split(/\s+/u).filter(Boolean).length > 8) return;
    if (/[.!?]/u.test(text)) return;
    candidates.push(index);
    if (raw === text && (isShoutedLabel(text) || isWhollyStrong(node.children))) standalone.push(index);
  });

  const promote = candidates.length >= 2 ? candidates : standalone;
  if (promote.length === 0) return [...nodes];
  const depth: 2 | 3 = candidates.length >= 2 ? 3 : 2;

  const out = [...nodes];
  for (const index of promote) {
    const paragraph = out[index] as Paragraph;
    const children = headingPhrasing(paragraph.children);
    const last = children[children.length - 1];
    if (last?.type === "text") last.value = last.value.replace(/[:\s]+$/u, "");
    const heading: BiomdContent = { type: "heading", depth, children };
    ctx.recoveredHeadings.add(heading);
    out[index] = heading;
  }
  return out;
}

/**
 * A line written in capitals — the era's other spelling of a section label.
 *
 * The same test {@link headingLineOf} applies to a line inside a run, lifted
 * out so both callers ask one question. Case-insensitive scripts (digits,
 * punctuation, CJK) fail the `!== toLowerCase()` half and never qualify.
 */
function isShoutedLabel(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

function promoteEntryDates(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const dated: number[] = [];
  nodes.forEach((node, index) => {
    if (node.type !== "paragraph") return;
    // `[1995–2002](/#/williams_cd1)` is a year *destination* in a discography
    // menu, not the date of an entry. A heading is not somewhere to click.
    if (node.children.some((c) => c.type === "link" || c.type === "image")) return;
    const text = phrasingText(node.children as PhrasingContent[]).replace(/\s+/gu, " ").trim();
    if (!isDateLabel(text)) return;
    const next = nodes[index + 1];
    if (!next || next.type === "thematicBreak") return;
    dated.push(index);
  });
  if (dated.length < 2) return [...nodes];

  const out = [...nodes];
  for (const index of dated) {
    const paragraph = out[index] as Paragraph;
    const heading: BiomdContent = {
      type: "heading",
      depth: 3,
      children: headingPhrasing(paragraph.children),
    };
    ctx.recoveredHeadings.add(heading);
    out[index] = heading;
  }
  return out;
}

/**
 * Whether text in this block would read as a picture caption.
 *
 * The corpus writes captions one way: a centred block, or one set smaller than
 * the body, sitting directly under the picture. Neither signal alone is
 * enough — a centred block is also how a section label is written, and a small
 * block is also how a footnote is — so binding additionally requires an
 * unlabelled image immediately before it.
 */
function isCaptionContext(node: LadomNode, ctx: Ctx): boolean {
  if (node.kind !== "element") return false;
  const prominence = prominenceOf(node);
  if (prominence.centered) return true;
  return prominence.fontPx !== undefined && prominence.fontPx < ctx.bodyProminence * 0.95;
}

/**
 * Whether italic can distinguish anything on this page.
 *
 * The test is *contrast*, not majority, and the difference is the whole rule.
 * A majority test asks "is most of the long prose italic", which on an archive
 * page measures the quoted matter rather than the article: `pavlov_azancheev`
 * runs 8 italic long blocks against 4 upright, because it is a page of letters,
 * and a majority test therefore concludes the page is italic and declines to
 * quote any of them — the quotes disqualifying themselves.
 *
 * What actually makes italic meaningless is a page with *no* upright prose at
 * all, where the stylesheet has set the body italic and the distinction carries
 * no information. That is what this asks.
 */
function proseItalicOf(root: LadomNode): boolean {
  let italic = 0;
  let upright = 0;
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td") continue;
    if (el.children.some((c) => c.kind === "element" && isBlockTag(c.tag))) continue;
    if (textOf(el).length < 200 || el.style === undefined) continue;
    if (el.style.fontStyle === "italic") italic += 1;
    else upright += 1;
  }
  return italic > 0 && upright === 0;
}

/**
 * A block the source deliberately subordinated to the article around it (§3.5).
 *
 * §3.5 states both the mapping and the evidence: a block quote "MAY also carry
 * a coherent commentary, annotation, or source-credit block that the source
 * deliberately subordinates to the main prose — shown by combined evidence such
 * as a consistently smaller font *plus* deeper indentation or separate
 * alignment, **never by font size alone**".
 *
 * ## Two corpus facts that decide which evidence is available
 *
 * **Indentation is not rendered.** These stylesheets write `margin-left: 25`
 * with no unit, which is invalid CSS, and Chromium drops it: every block on
 * `pavlov_azancheev` computes an inset of 0, the quoted letters included. The
 * indent is in the source and not on the page, so it cannot be the evidence —
 * a rule built on it can never fire, which is what the first attempt here did.
 *
 * **The quotes can define the baseline.** `bodyProminenceOf` samples the
 * longest blocks, and on a page that is an archive of letters the longest
 * blocks *are* the letters. `pavlov_azancheev`'s body prominence is therefore
 * 10 pt — the quoted matter's own size — and the article's 11 pt headnotes
 * measure as *larger*. Size on such a page reports the opposite of the truth.
 *
 * What survives both is the one signal the reader actually sees: the block is
 * set wholly in italic and the page's prose is not. Not font size, which §3.5
 * rules out in as many words — a different signal, and a relational one.
 */
function isSubordinatedBlock(el: LadomNode, ctx: Ctx): boolean {
  if (ctx.proseItalic || el.style === undefined) return false;
  // The *block* is italic, not a phrase inside it: a `<p>` wrapping `<i>…</i>`
  // computes `normal` and is a paragraph with emphasis in it, which §3.5's
  // "do not turn … ordinary dialogue fragments … into a block quote" excludes.
  return el.style.fontStyle === "italic" && textOf(el).trim() !== "";
}

/**
 * Whether the subordinated shape *recurs* on this page.
 *
 * `CLAUDE.md` §5 makes this a design law rather than a heuristic: every
 * detector that survived here required recurrence, and every single-block
 * typographic threshold regressed the corpus. One indented, smaller paragraph
 * is a paragraph with a stylesheet accident behind it; a page that sets fifteen
 * of them the same way is a page quoting fifteen documents.
 *
 * Counted before lowering, so the answer is the same for every block on the
 * page and cannot depend on the order containers happen to be visited.
 */
function subordinationRecursIn(root: LadomNode, proseItalic: boolean): boolean {
  const probe = { proseItalic } as Ctx;
  let seen = 0;
  for (const el of walkElements(root)) {
    if (textOf(el).trim() === "") continue;
    // A region set apart by the style on its own block, or — the same shape
    // written the other way round — by the run inside it. `segovia` sets both
    // its quotations apart as `<blockquote><i>…</i></blockquote>`, which
    // carries no style on any `p` or `div` and so counted as nothing at all.
    const setApart =
      (el.tag === "p" || el.tag === "div") ? isSubordinatedBlock(el, probe) : el.tag === "blockquote" && contentIsSubordinated(el, probe);
    if (!setApart) continue;
    seen += 1;
    if (seen >= MIN_SUBORDINATED_BLOCKS) return true;
  }
  return false;
}

/** Two is a pattern; one is an accident. */
const MIN_SUBORDINATED_BLOCKS = 2;

/** The prominence of ordinary prose on this page, in px. */
function bodyProminenceOf(root: LadomNode): number {
  const sizes: number[] = [];
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td") continue;
    if (textOf(el).length < 200) continue;
    const px = prominenceOf(el).fontPx;
    if (px !== undefined && px > 0) sizes.push(px);
  }
  if (sizes.length === 0) return 16;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 16;
}

/**
 * The page's own prose alignment, measured once per document.
 *
 * Only *measured* nodes contribute. The inline `align` attribute is excluded on
 * purpose: `CLAUDE.md` §4 records that on `pavlov_azancheev.htm` it appears on
 * 34 elements that all compute to `justify`, so admitting it here would let the
 * lie define the baseline and every genuinely centred block would then look
 * ordinary. An unmeasured run therefore yields `null`, and the callers fall back
 * to treating `center`/`right` as distinctive on their own.
 *
 * Leaf blocks only. A `<td>` wrapping the whole article has the article's text
 * length and would outweigh every paragraph in it, so a single centred cell
 * would declare the page centred.
 */
function proseAlignOf(root: LadomNode): PhysicalAlign {
  const samples: Array<{ align: PhysicalAlign; textLength: number }> = [];
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td" && el.tag !== "li") continue;
    if (el.children.some((c) => c.kind === "element" && isBlockTag(c.tag))) continue;
    const align = foldTextAlign(el.style?.textAlign);
    if (align === null) continue;
    samples.push({ align, textLength: textOf(el).trim().length });
  }
  return proseAlign(samples);
}

const BLOCK_TAGS = new Set([
  "p", "div", "table", "tbody", "thead", "tr", "td", "th", "ul", "ol", "li",
  "blockquote", "pre", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "center", "dl", "form",
]);

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

/**
 * Attach a caption-shaped paragraph to the picture directly above it (§7.1).
 *
 * Emitting the two as siblings is not wrong so much as lossy: the renderer has
 * no way to know the line belongs to the figure, so it wraps at a different
 * width, survives a layout change the figure does not, and is read out of
 * order by a screen reader.
 */

/** One visible line of a caption, and whether the author set it apart in bold. */
type CaptionLine = { text: string; emphasized: boolean };

/**
 * Cut one caption block into the lines the reader sees.
 *
 * A `<br>` inside the block is the same line boundary as a `<br>` between two
 * of them, so it has to survive: `phrasingText` drops break nodes outright,
 * which welded `…# 52 1983` onto `Special Segovia Issue`.
 *
 * Each line also records whether *all* of its text came from inside emphasis,
 * which is how the era wrote a caption's title line.
 */
function captionLinesOf(nodes: readonly PhrasingContent[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let text = "";
  let plain = false;
  const push = (): void => {
    const trimmed = text.replace(/\s+/gu, " ").trim();
    if (trimmed !== "") lines.push({ text: trimmed, emphasized: !plain });
    text = "";
    plain = false;
  };
  const walk = (list: readonly PhrasingContent[], strong: boolean): void => {
    for (const node of list) {
      if (node.type === "break") push();
      else if (node.type === "text" || node.type === "inlineCode") {
        text += node.value;
        if (!strong && node.value.trim() !== "") plain = true;
      } else if (node.type === "image") continue;
      else if ("children" in node) {
        const inside = strong || node.type === "strong" || node.type === "emphasis";
        walk(node.children as PhrasingContent[], inside);
      }
    }
  };
  walk(nodes, false);
  push();
  return lines;
}

/** The two block kinds a visible caption can arrive as. */
type CaptionBlock = Extract<BiomdContent, { type: "paragraph" } | { type: "heading" }>;

/** Whether a block is a caption candidate on its own typography. */
function isCaptionCandidate(block: BiomdContent, ctx: Ctx): boolean {
  return (
    (block.type === "paragraph" && ctx.captionEligible.has(block)) ||
    // A *centred* recovered heading under a picture is its caption. A
    // small-type section label — `ДИСКОГРАФИЯ` above its list — is not, and
    // swallowing it deleted a real section of the document.
    (block.type === "heading" && ctx.captionHeadings.has(block))
  );
}

/**
 * Longest run of caption-eligible blocks starting at `from`.
 *
 * An `::: align` counts when everything inside it is a candidate. A figure and
 * its caption are often two rows of a one-column table, so the caption is
 * lowered in a container of its own where no figure is in sight, and the
 * alignment pass — running bottom-up, correctly, on the evidence it has —
 * wraps it. Only here is the picture next to it. Unwrapping is the whole of
 * the fix: the alignment was never wrong, it was premature, and §7 gives the
 * caption a better home than `position:` restated on a directive.
 */
function captionRunAt(
  nodes: readonly BiomdContent[],
  from: number,
  ctx: Ctx,
): { blocks: CaptionBlock[]; consumed: number } {
  const blocks: CaptionBlock[] = [];
  let i = from;
  for (; i < nodes.length; i += 1) {
    const block = nodes[i] as BiomdContent;
    // A caption closes a figure; a label opens what follows it. When the very
    // next block is a list, the line between them belongs to the list — and
    // binding it upwards does not merely mislabel it, it *deletes* it, because
    // a `caption:` property is not a block any outline can reach. `segovia`'s
    // `ДИСКОГРАФИЯ` is the corpus's instance: a section of the document was
    // absorbed into the cover above it. Asking what claims the block from
    // below costs one lookahead and needs no typography, no vocabulary and no
    // knowledge of the page.
    if (nodes[i + 1]?.type === "list") break;
    if (isCaptionCandidate(block, ctx)) {
      blocks.push(block as CaptionBlock);
      continue;
    }
    if (block.type === "biomdAlign") {
      const children = block.children as BiomdContent[];
      if (children.length > 0 && children.every((child) => isCaptionCandidate(child, ctx))) {
        blocks.push(...(children as CaptionBlock[]));
        continue;
      }
    }
    break;
  }
  return { blocks, consumed: i - from };
}

/**
 * The visible caption region, as one line.
 *
 * Lines join with a space, because that is what a `<br>` becomes when it has to
 * collapse into a single-line property. The one exception is a **typographic
 * title line** — a first line the author set wholly in bold, with detail lines
 * under it — which takes an em dash, since welding a title straight onto the
 * sentence that explains it (`А. Сеговия с учениками В.И. Яшнева В нижнем ряду
 * второй справа…`) reads as one broken sentence.
 *
 * The discriminator is the source's own typographic role, read off the inline
 * tree. It deliberately does *not* ask whether the pipeline happened to lift
 * that line to a heading: whether it did depends on surrounding context, so the
 * same caption would join two different ways on two pages.
 */
function captionTextOf(run: readonly CaptionBlock[]): string {
  const lines = run.flatMap((block) =>
    block.type === "heading"
      ? captionLinesOf(block.children as PhrasingContent[]).map((line) => ({ ...line, emphasized: true }))
      : captionLinesOf(block.children as PhrasingContent[]),
  );
  if (lines.length === 0) return "";
  const [first, ...rest] = lines as [CaptionLine, ...CaptionLine[]];
  const titled = first.emphasized && rest.length > 0 && !rest[0]?.emphasized;
  return titled
    ? `${first.text} — ${rest.map((line) => line.text).join(" ")}`
    : lines.map((line) => line.text).join(" ");
}

interface GalleryCaptionRun {
  captions: string[];
  consumed: number;
}

/** Text-only caption payload; links/media or structural blocks disqualify it. */
function galleryCaptionText(blocks: readonly BiomdContent[]): string {
  if (blocks.length === 0) return "";
  const safe = (node: unknown): boolean => {
    if (node === null || typeof node !== "object") return true;
    const value = node as { type?: string; children?: unknown[] };
    if (value.type === "link" || value.type === "image" || value.type?.startsWith("biomd")) return false;
    return !Array.isArray(value.children) || value.children.every(safe);
  };
  if (!blocks.every((block) => (block.type === "paragraph" || block.type === "heading") && safe(block))) return "";
  return captionTextOf(blocks as CaptionBlock[]);
}

/**
 * Captions drawn as lanes immediately after an `images` row.
 *
 * The three accepted lowerings are the same visible relationship: one centred
 * caption lane per picture. A layout table arrives as `columns`; a flattened
 * one arrives as one centred run or as adjacent centred runs. Exact cardinality
 * keeps prose regions out and lets source order pair the captions without
 * guessing from coordinates.
 */
function galleryCaptionRunAt(
  nodes: readonly BiomdContent[],
  from: number,
  count: number,
): GalleryCaptionRun | null {
  const first = nodes[from];
  if (first?.type === "biomdColumns" && first.children.length === count) {
    const captions = first.children.map((column) => {
      if (column.children.length !== 1 || column.children[0]?.type !== "biomdAlign") return "";
      const align = column.children[0];
      return align.position === "center" ? galleryCaptionText(align.children as BiomdContent[]) : "";
    });
    if (captions.every(Boolean)) return { captions, consumed: 1 };
  }

  if (first?.type === "biomdAlign" && first.position === "center" && first.children.length === count) {
    const captions = first.children.map((child) => galleryCaptionText([child as BiomdContent]));
    if (captions.every(Boolean)) return { captions, consumed: 1 };
  }

  const aligned = nodes.slice(from, from + count);
  if (aligned.length !== count) return null;
  const captions = aligned.map((block) =>
    block.type === "biomdAlign" && block.position === "center"
      ? galleryCaptionText(block.children as BiomdContent[])
      : "",
  );
  return captions.every(Boolean) ? { captions, consumed: count } : null;
}

/** A visible gallery caption must substantially restate its image's source label. */
function galleryCaptionMatches(sourceLabel: string | undefined, visible: string): boolean {
  if (!sourceLabel || visible.length > 300) return false;
  return relationTextMatches(sourceLabel, visible);
}

/**
 * Bind a figure or gallery to the caption(s) the reader can actually see.
 *
 * ## Rule contract — one visible caption lane per image
 *
 * **Invariant.** An `images` row immediately followed by equally many centred,
 * text-only lanes, in the same source order. Every lane must substantially
 * repeat its image's source-backed label; exact cardinality and ordered word
 * coverage establish the pairings without filenames, classes or vocabulary.
 *
 * **Recurrence.** The relationship recurs within the row: at least two images
 * and two independently matching captions. A single figure remains on the
 * stricter figure-caption path below.
 *
 * **False friends.** A record lane beside a cover, an unrelated centred region,
 * reordered or missing captions, a link-bearing label and a generic one-word
 * `alt` all fail independently. A gallery caption region preceding the images
 * also fails because sibling order is part of the relationship.
 *
 * The visible line outranks `alt` for both paths. `alt` describes the picture
 * for a reader who cannot see it; a caption is visible editorial text, and the
 * two are different properties in §6.1. When a page states both, the visible
 * wording replaces the fallback and is consumed rather than printed twice.
 */
function bindCaptions(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as BiomdContent;

    if (node.type === "biomdImages") {
      const run = galleryCaptionRunAt(nodes, i + 1, node.children.length);
      if (
        run !== null &&
        run.captions.every((caption, index) => {
          const image = node.children[index];
          return galleryCaptionMatches(image?.caption ?? image?.alt, caption);
        })
      ) {
        out.push({
          ...node,
          children: node.children.map((image, index) => ({ ...image, caption: run.captions[index] as string })),
        });
        i += run.consumed;
        continue;
      }
    }

    const next = nodes[i + 1];
    if (node.type === "biomdImage" && node.standalone && next !== undefined) {
      const run = captionRunAt(nodes, i + 1, ctx);
      const caption = captionTextOf(run.blocks);
      if (caption !== "" && caption.length <= 300) {
        if (node.caption !== undefined && caption !== node.caption) {
          ctx.ledger.push(
            mergedInto(nextId(ctx, "caption-echo"), nextId(ctx, "image"), { note: "visible caption replaces alt" }),
          );
        }
        out.push({ ...node, caption });
        i += run.consumed;
        continue;
      }
    }

    // §11: "a prominent side menu … normally moves directly below the title".
    // The label a page put above its menu is that menu's title, not a section
    // of its own — as a heading it renders twice the size of the bar it names
    // and adds an outline entry with no body under it.
    if (
      node.type === "heading" &&
      ctx.recoveredHeadings.has(node) &&
      next !== undefined &&
      next.type === "biomdNav" &&
      next.title === undefined
    ) {
      const title = phrasingText(node.children as PhrasingContent[]).replace(/\s+/gu, " ").trim();
      if (title !== "" && title.length <= 120) {
        out.push({ ...next, title });
        i += 1;
        continue;
      }
    }

    // The same §11 rule where typography never reached the label. `news` and
    // `news_2007` set theirs in a bordered, tinted, centred cell of its own
    // above the year bar, and it recovers as an aligned paragraph rather than a
    // heading — so the heading branch above never sees it and the bar loses the
    // only words that say what it is. Position is the evidence in both cases;
    // which construct the label happened to land in is not.
    if (next !== undefined && next.type === "biomdNav" && next.title === undefined) {
      const title = navTitleFrom(node);
      if (title !== null) {
        out.push({ ...next, title });
        i += 1;
        continue;
      }
    }

    out.push(node);
  }
  return out;
}

/**
 * One inline run → the blocks its `<br>` structure actually described.
 *
 * The run is cut into lines, the lines into groups at every blank line, and
 * each group is lowered as what it is: a figure, a section label, or a
 * paragraph whose interior breaks have been classified.
 */
function blocksFromPhrasing(
  phrasing: readonly PhrasingContent[],
  ctx: Ctx,
  precededBy?: BiomdContent,
  floats: readonly FloatedFigure[] = [],
): BiomdContent[] {
  if (phrasing.length === 0) return [];
  const out: BiomdContent[] = [];

  const groups = groupLines(splitLines(phrasing));
  const groupText = groups.map((g) => g.lines.map(lineText).join(" ").trim());
  const total = groupText.reduce((a, t) => a + t.length, 0);
  let after = total;
  let consumed = 0;
  let pending = 0;

  groups.forEach((group, index) => {
    const length = (groupText[index] as string).length;
    after -= length;
    // §7.2: the figure goes immediately before the paragraph it accompanies,
    // and `floats` says which one — see `floatedFigures`. The last group takes
    // whatever is left, so no figure can be dropped by rounding.
    const end = total > 0 ? (consumed + length) / total : 1;
    while (pending < floats.length && ((floats[pending] as FloatedFigure).at < end || index === groups.length - 1)) {
      out.push((floats[pending] as FloatedFigure).figure);
      pending += 1;
    }
    consumed += length;
    const previous = out[out.length - 1] ?? precededBy;
    // The line above a run is what tells a reader the run is an enumeration
    // rather than a stanza — `Номера и названия томов…:` announces nineteen
    // volumes. It is context for a judgement, never evidence a rule acts on.
    const lead = index > 0 ? (groupText[index - 1] as string) : undefined;
    out.push(...blocksFromGroup(group.lines, ctx, after, previous?.type === "biomdImage", lead));
  });
  return out;
}

/** A floated image lifted out of an inline run, and where in that run it stood. */
interface FloatedFigure {
  figure: BiomdContent;
  /** Share of the run's visible text that precedes it, 0..1. */
  at: number;
}

/**
 * Floated images lifted out of an inline run, each keeping its place in it.
 *
 * ## Rule contract
 *
 * **Invariant.** A 1998 page writes a whole section as one `<p>` whose
 * paragraphs are `<br><br>`, and drops a floated portrait wherever the text it
 * belongs beside begins. Lifting every such image to the head of the *run* put
 * `tarrega`'s portrait two paragraphs above the sentence it illustrates and
 * `williams2`'s two above the CBS award it shows — the same defect, the same
 * distance, on two documents whose sources are otherwise unalike.
 *
 * The image's own position in the run is the evidence, and it survives the
 * lowering boundary as a **proportion** of the run's visible text rather than
 * as a character offset: the two sides count text differently — entities are
 * decoded, wraps are joined, hard breaks are added — and a ratio is invariant
 * under all of it while an offset is not. The figure then goes before the
 * paragraph whose share of the run brackets it, which is where the reader saw
 * it.
 *
 * **Recurrence** does not apply and is not claimed: a floated figure occurs
 * once where it occurs. What replaces it is that the rule is *total* — every
 * floated image is placed by the same measurement, including the common case
 * of a run with one paragraph, where the bracket is the whole run and the
 * result is the head of it, exactly as before.
 *
 * **False friend.** A run that is nothing but the image. It has no paragraph
 * to sit before, so it is emitted directly and never reaches the bracketing.
 */
function floatedFigures(run: readonly LadomNode[], ctx: Ctx): FloatedFigure[] {
  const visible = (node: LadomNode): number =>
    (node.kind === "text" ? (node.value ?? "") : textOf(node)).replace(/\s+/gu, " ").trim().length;
  const total = run.reduce((n, node) => n + visible(node), 0);

  const out: FloatedFigure[] = [];
  let seen = 0;
  for (const node of run) {
    if (node.kind === "element" && node.tag === "img" && isFloated(node)) {
      const figure = imageFrom(node, ctx, true);
      if (figure) out.push({ figure, at: total > 0 ? seen / total : 0 });
      continue;
    }
    seen += visible(node);
  }
  return out;
}

/**
 * @param followingText characters of prose after this group in the same run —
 * the evidence that a short line at its head introduces something rather than
 * closing something.
 */
function blocksFromGroup(
  lines: readonly RunLine[],
  ctx: Ctx,
  followingText: number,
  afterFigure: boolean,
  lead?: string,
): BiomdContent[] {
  const out: BiomdContent[] = [];
  let rest = lines;

  // A figure on its own line is a figure, not a word in a paragraph. This is
  // what turns `<img><br><br>Рис. 1.` into an image directive followed by a
  // caption-eligible line, which `bindCaptions` then joins.
  while (rest.length > 0 && figureOf(rest[0] as RunLine, ctx) !== null) {
    out.push(figureOf(rest[0] as RunLine, ctx) as BiomdContent);
    rest = rest.slice(1);
  }
  if (rest.length === 0) return out;

  // A short label on its own line, with the group's content following it, is
  // the section heading this era wrote instead of `<h2>`.
  // A bold line directly under a picture is its caption, not a section.
  const heading = afterFigure && out.length === 0 ? null : headingLineOf(rest, ctx, followingText);
  if (heading) {
    out.push(heading);
    rest = rest.slice(1);
    if (rest.length === 0) return out;
  }

  // A run of lines whose columns the author aligned with dot leaders is a table
  // that predates the ability to draw one. It has to be asked before the
  // enumerated-list rule, because its rows are usually numbered too and a list
  // would swallow the second column into the item text.
  const leaders = tableFromLeaderLines(rest);
  if (leaders) {
    out.push(leaders);
    return out;
  }

  // An enumerated run is a list the author had no <ul> for. As a paragraph of
  // hard breaks it renders as one block and reads as one sentence; as a list
  // each track, movement or volume is an item, which is what it is.
  const enumerated = listFromEnumeratedLines(rest, ctx);
  if (enumerated) {
    out.push(enumerated);
    return out;
  }

  // The same list, drawn with an indent instead of with ordinals.
  const announced = listFromAnnouncedIndent(rest, ctx);
  if (announced) {
    out.push(...announced);
    return out;
  }

  // A speaker named, a colon, and the words in quotation marks on the next
  // line. See `quotationAfterLeadIn`.
  const quoted = quotationAfterLeadIn(rest);
  if (quoted) {
    out.push(...quoted);
    return out;
  }

  // A rule the author drew with punctuation because the era gave them no `<hr>`
  // they liked. See `drawnRuleFrom`.
  const drawn = drawnRuleFrom(rest);
  if (drawn) {
    out.push(...drawn);
    return out;
  }

  // Nothing above claimed the run, so the compiler has no answer to "are these
  // lines the items of a list?" — only a safe default. Record the question, and
  // apply an answer if an operator's hook supplied one. See `TEXT_LIST`.
  const candidate = breakRunCandidateOf(rest, ctx, lead);
  if (candidate) {
    ctx.listCandidates.push(candidate);
    if (ctx.options.listRuns?.has(candidate.id)) {
      out.push(listOfLines(rest));
      return out;
    }
  }

  const paragraph = paragraphFromLines(rest);
  if (paragraph) {
    // Remember, rather than decide: whether this is a caption depends on what
    // precedes it, which the caller knows and this does not.
    if (
      // Centring is what makes a line under a picture read as its caption.
      // Small type alone is not: `ДИСКОГРАФИЯ` above its album list is set in
      // `size=2` too, and binding it to the cover above deleted a section.
      ctx.inCaptionContext &&
      ctx.inCenteredBlock &&
      paragraph.children.every((c) => c.type !== "link" && c.type !== "image") &&
      phrasingText(paragraph.children).trim().length <= 300
    ) {
      ctx.captionEligible.add(paragraph);
    }
    out.push(paragraph);
  }
  return out;
}

/**
 * A speaker named, a colon, and the words in quotation marks that follow.
 *
 * ## Rule contract
 *
 * **Invariant.** The same arithmetic on the author's own quotation marks that
 * {@link groupSpannedQuotation} does, one level down. `borislova` writes
 * `<p class="t1">Надя Борислова:<br>"Мне было 8 лет…"</p>` — one block, whose
 * first line names who is speaking and ends in a colon, and whose remaining
 * lines are one complete quotation running to the end of the block.
 * `analyze-3.md` states the evidence and asks for the rule: *"сразу после знака
 * двоеточия ':' идет текст заключанный в кавычки, что явно указывает, что это
 * цитата"*. §3.5 is what a quotation maps to. Nothing about the document, the
 * words, the tags or the typography is consulted.
 *
 * **Recurrence.** Not applicable, and for {@link groupSpannedQuotation}'s
 * reason: an attribution happens once where it happens. What carries the proof
 * instead is that the test is closed on both sides — the colon *ends* a line,
 * the very next line *opens* the quotation, and the quotation *closes* at the
 * end of the block, so the block is exactly a lead-in and a quotation and
 * nothing is left over to be misread.
 *
 * **False friends.** A colon mid-sentence before a quoted title — excluded
 * because the colon has to end a line the author drew. A list introduced by a
 * colon — excluded because what follows has to open with a quotation mark and
 * close at the block's end. A quotation *without* attribution — excluded
 * because a lead-in is required, so ordinary quoted dialogue inside prose is
 * untouched. Swept over the 22 produced documents, this shape occurs once and
 * no near-miss occurs at all.
 */
function quotationAfterLeadIn(lines: readonly RunLine[]): BiomdContent[] | null {
  if (lines.length < 2) return null;
  const lead = lineText(lines[0] as RunLine).trim();
  if (!lead.endsWith(":") || lead.length < 3 || lead.length > 120) return null;
  // A colon that ends a line the author drew, not a wrap the browser made.
  if ((lines[0] as RunLine).gap === 0) return null;

  const rest = lines.slice(1);
  const body = rest.map(lineText).join(" ").trim();
  if (!body.startsWith(STRAIGHT_QUOTE)) return null;
  if (quoteCount(body) % 2 !== 0) return null;
  // The quotation is the whole of what follows: nothing but punctuation may
  // survive the closing mark, or the block is prose that merely contains one.
  const closed = body.lastIndexOf(STRAIGHT_QUOTE);
  if (closed < 0 || body.slice(closed + 1).replace(/[\s.,;!?)–—-]+/gu, "") !== "") return null;
  if (body.length < 60) return null;

  const leadParagraph = paragraphFromLines([lines[0] as RunLine]);
  const quotedParagraph = paragraphFromLines(rest);
  if (!leadParagraph || !quotedParagraph) return null;
  return [leadParagraph, { type: "blockquote", children: [quotedParagraph] as BlockContent[] }];
}

/** A line that shows exactly one picture and no words. */
function figureOf(line: RunLine, ctx: Ctx): BiomdContent | null {
  if (phrasingText(line.content).trim() !== "") return null;
  const images = collectPhrasingImages(line.content);
  if (images.length === 0) return null;

  const figures: BiomdContent[] = [];
  for (const { image, link } of images) {
    const source = ctx.imageNodes.get(image);
    if (!source) return null;
    const caption = captionFor(source);
    figures.push(
      images.length === 1
        ? makeImage({
            src: image.url,
            position: estimatePosition(source, ctx.proseAlign, ctx.grids),
            size: sizeTokenFor(imageWidthOf(source), ctx.contentWidth),
            ...(caption ? { caption } : {}),
            ...(link ? { link } : {}),
          })
        : makeGroupedImage({ src: image.url, ...(caption ? { caption } : {}), ...(link ? { link } : {}) }),
    );
  }
  if (figures.length === 1) return figures[0] as BiomdContent;
  const children = figures.filter((f): f is BiomdImageNode => f.type === "biomdImage");
  if (children.length < 2) return null;
  return makeImages({ columns: groupColumnsFor(children.length), children });
}

type BiomdImageNode = Extract<BiomdContent, { type: "biomdImage" }>;

/** Images in a phrasing run, with the link that wraps each, if any. */
function collectPhrasingImages(
  nodes: readonly PhrasingContent[],
  link?: string,
): Array<{ image: { url: string }; link?: string }> {
  const out: Array<{ image: { url: string }; link?: string }> = [];
  for (const node of nodes) {
    if (node.type === "image") {
      out.push({ image: node, ...(link ? { link } : {}) });
      continue;
    }
    if (node.type === "link") {
      out.push(...collectPhrasingImages(node.children, node.url));
      continue;
    }
    if ("children" in node) out.push(...collectPhrasingImages(node.children as PhrasingContent[], link));
  }
  return out;
}

/**
 * The first line of a group as a section heading, or null.
 *
 * Three source spellings, all of which mean the same thing and none of which
 * is a tag: a bold line above its own body, a line in capitals, and a short
 * line that the following prose plainly belongs to. The evidence has to
 * include the *following* content — a bold line at the end of a block is a
 * signature or a name, not a section.
 */
function headingLineOf(lines: readonly RunLine[], ctx: Ctx, followingText: number): BiomdContent | null {
  // Inside a record region every card opens with a bold line: the album title
  // above its track list, the date above an obituary. Those are labels of the
  // record, and §6 maps them to a bounded `align` — not to twenty sections of
  // the document. Only the article's own flow gets headings from a line.
  if (ctx.tableDepth >= 2) return null;
  const first = lines[0] as RunLine | undefined;
  if (!first) return null;
  const text = lineText(first);
  if (text === "" || text.length > 90) return null;
  if (collectPhrasingImages(first.content).length > 0) return null;
  if (/[,;:]$/u.test(text)) return null;
  if (text.split(/\s+/u).filter(Boolean).length > 12) return null;

  // A section needs a section: either the rest of this group, or the groups
  // after it. A bold line with nothing following is a signature or a name.
  const body = lines.slice(1).map(lineText).join(" ").trim();
  if (body.length + followingText < 60) return null;

  const bold = isWhollyStrong(first.content);
  if (!bold && !isShoutedLabel(text)) return null;
  // A label names a thing; a sentence says something about it. A short label
  // may still contain a full stop — `Положение рук. Правая рука.` is a
  // heading — but a long one with sentence punctuation is prose.
  if (text.length > 60 && /[.!?]\s/u.test(text)) return null;
  // A link is a destination, not a section label.
  if (first.content.some((n) => n.type === "link")) return null;

  // A label that is nothing but a year or a date is an entry inside a section
  // — `### 1989` under `## Произведения для гитары (1989–2002)` — never a
  // section of the document in its own right.
  const depth: 2 | 3 = ctx.tableDepth >= 2 || isDateLabel(text) ? 3 : 2;
  ctx.ledger.push(emitted(`line:${text.slice(0, 40)}`, nextId(ctx, "heading")));
  const node: BiomdContent = {
    type: "heading",
    depth,
    children: headingPhrasing(first.content as PhrasingContent[]),
  };
  ctx.recoveredHeadings.add(node);
  if (ctx.inCenteredBlock) ctx.captionHeadings.add(node);
  return node;
}

/** `1989`, `1990-1993`, `11 декабря 2007 г.` — a date, and nothing else. */
const DATE_LINE =
  /^\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йея]|июн|июл|август|сентябр|октябр|ноябр|декабр|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*\s+\d{4}(?:\s*(?:г|года|year)\.?)?$/iu;

export function isDateLabel(text: string): boolean {
  const t = text.trim().replace(/[.,;:]+$/u, "");
  if (/^\d{4}(\s*[-–—/]\s*\d{2,4})?$/u.test(t)) return true;
  return DATE_LINE.test(t);
}

/** True when every paragraph of a group is entirely bold. */
function isWhollyStrongBlocks(nodes: readonly BiomdContent[]): boolean {
  const paragraphs = nodes.filter((n): n is Paragraph => n.type === "paragraph");
  if (paragraphs.length === 0) return false;
  return paragraphs.every((p) => isWhollyStrong(p.children));
}

/** True when every word of a run sits inside `**…**`. */
function isWhollyStrong(nodes: readonly PhrasingContent[]): boolean {
  let strong = 0;
  let plain = 0;
  const visit = (list: readonly PhrasingContent[], inStrong: boolean): void => {
    for (const node of list) {
      if (node.type === "text") {
        const n = node.value.replace(/\s+/gu, "").length;
        if (inStrong) strong += n;
        else plain += n;
        continue;
      }
      if ("children" in node) {
        visit(node.children as PhrasingContent[], inStrong || node.type === "strong");
      }
    }
  };
  visit(nodes, false);
  return strong > 0 && strong >= (strong + plain) * 0.9;
}

/**
 * An enumerated line run → a bullet list whose items keep their own numbers.
 *
 * **Unordered on purpose.** An `ordered` list renumbers from its own counter, so
 * `01.` would render as `1.` and a run starting at `26.` would restart at 1 —
 * the source's numbering is content, and a renumbering list silently rewrites
 * it. A bullet list keeps every character the author typed and adds only the
 * marker, which is the layout claim §16.3 permits.
 */
/**
 * A run of equally indented lines, announced by the line above it, is a list.
 *
 * `news` writes two competition results this way: one sentence ending in a
 * colon, then each prize on its own `<br>` line pushed in by two `&ensp;`.
 * `listFromEnumeratedLines` cannot take it — the last item is *"диплом за
 * участие"*, which carries no ordinal, so the ascent test the ordinal rule
 * rightly insists on can never hold across the whole run.
 *
 * ## Rule contract
 *
 * **Invariant.** Three relations, no absolutes: the run's members share one
 * indent (uniformity), the indent is non-zero against a line that has none
 * (subordination), and that line *announces* the run by ending in a colon
 * (introduction). Nothing here reads a class, an id, a tag, a length or a word
 * — a colon before an enumeration is typographic convention, and the indent
 * test rests on the HTML whitespace model (see `collapseSpace`).
 *
 * **Recurrence** is the run itself: two members minimum, so a single indented
 * line under a colon stays a line.
 *
 * **False friends, all four measured over the 22 sources rather than argued.**
 * The uniform-indent-under-a-lead-in shape alone fires **21** times and only 2
 * of those want a list; adding the announcing colon takes it to exactly the 2:
 *   - **`borislova`'s sixteen movement runs** — a work title, then its movements
 *     uniformly indented. The reference keeps every one as hard-break lines and
 *     even preserves the indent, and no title ends in a colon.
 *   - **`goya2`'s wrapped track titles** — the *continuation* of a title is
 *     indented under it, so there the indent means the opposite. Run length 1,
 *     and the indent is deeper than its siblings rather than shared.
 *   - **`pavlov_azancheev`'s letter** — every line indented alike, but with no
 *     unindented line to be subordinate to.
 *   - **`tarrega`'s two nine-line track runs** — uniform indent under a lead-in,
 *     no colon; the reference wants a *table* there, not a list.
 */
function listFromAnnouncedIndent(lines: readonly RunLine[], ctx: Ctx): BiomdContent[] | null {
  const start = lines.findIndex((line) => line.indent > 0);
  if (start < 1) return null;
  const lead = lines[start - 1] as RunLine;
  if (lead.indent > 0 || !lineText(lead).endsWith(":")) return null;

  const run = lines.slice(start);
  const indent = (lines[start] as RunLine).indent;
  if (run.length < 2 || run.some((line) => line.indent !== indent)) return null;

  const intro = paragraphFromLines(lines.slice(0, start));
  if (!intro) return null;
  void ctx;
  return [
    intro,
    {
      type: "list",
      ordered: false,
      spread: false,
      children: run.map((line) => ({
        type: "listItem" as const,
        spread: false,
        children: [{ type: "paragraph" as const, children: line.content }],
      })),
    } as BiomdContent,
  ];
}

/**
 * The shortest run of `.` that is a column rule rather than punctuation.
 *
 * **Swept, not tuned.** Over all 22 sources, counting lines that carry an
 * interior run of at least *k* dots with text on both sides: k=2 finds 8
 * documents, k=3 finds 6, and **k=4 finds exactly 2 — `tarrega` (17 lines) and
 * `segovia` (4) — and so does k=5, 6, 8 and 10.** Every ellipsis in the corpus
 * (`Бразилию...`, `"...подделке под..."`, `произвело...`) disappears at exactly
 * 4 and nothing else does. A curve that goes flat and stays flat is a limit,
 * which `CLAUDE.md` §5 says is the right shape for a threshold; a cliff would
 * have meant the number was standing in for some other mechanism.
 *
 * The lower bound cannot be raised past 4 either: `tarrega`'s
 * *"9. Menuet de la Fantasie Op: 78 de Franz Schubert .... A. y T. 394"* pads
 * its longest title with exactly four.
 */
const LEADER_RUN = /\.{4,}/u;

/** A line split at its dot leader, or null when it carries none. */
interface LeaderRow {
  left: PhrasingContent[];
  right: PhrasingContent[];
}

/**
 * A run of lines the author ruled into columns with dot leaders → a table.
 *
 * ## Rule contract
 *
 * **Invariant.** The evidence is a *typographic device*: a run of at least four
 * dots, interior to the line, with content on both sides of it, repeated down
 * the run. That is the same family of evidence as `drawnRuleFrom` — punctuation
 * standing in for a structure the era gave the author no element for. Nothing
 * here reads a class, an id, a file name, a word or a language; a leader is a
 * leader in any script.
 *
 * **Recurrence.** Three rows minimum, *and* every non-blank line in the group
 * must carry a leader. The second half is the stronger requirement and it is
 * what makes the shape a table rather than a paragraph containing one aligned
 * line: a column that stops halfway down is not a column.
 *
 * **False friends**, each tested for non-firing:
 *   - **an ellipsis.** `new_dyens` writes `Бразилию...` and `"...подделке
 *     под..."`, `borislova` `произвело...`. Three dots, and the sweep above is
 *     the whole argument for four.
 *   - **a leader used as padding inside a cell that already has a column.**
 *     `segovia`'s Rodrigo table writes `Villano y Recercarre.................`
 *     inside a real `<td>`, and both sides keep it verbatim. Two independent
 *     guards stop it: the leader is *trailing*, so there is no right-hand
 *     content, and a one-line cell can never reach three rows. This is the
 *     distinction the rule turns on — `segovia`'s leader decorates a column,
 *     `tarrega`'s **is** the column boundary.
 *   - **an enumerated list.** Asked before `listFromEnumeratedLines` on
 *     purpose. `goya2`'s numbered track list has no leaders and is unaffected;
 *     `tarrega`'s rows are numbered *and* ruled, and the list rule would have
 *     folded the catalogue number into the title.
 *
 * **Mutation robustness.** The rule reads `RunLine` content only, so renamed
 * classes, permuted attributes, wrapper nesting, `<font>` versus CSS and a
 * changed viewport cannot reach it. Dropping a closing tag changes which lines
 * are in the group, and the all-lines requirement then declines rather than
 * emitting a partial table.
 *
 * **Source.** `analyze-3.md`, `tarrega.htm`: *"получается ASCII подобная псевдо
 * таблица, где отступ для второго столбца регулируется точками … Тут нужна
 * умная функция, эвристика, что бы распознала такую структуру и правратила ее
 * в более красивую и типичную для md таблицу"*, with the wanted output written
 * out row by row.
 */
function tableFromLeaderLines(lines: readonly RunLine[]): Table | null {
  const rows: LeaderRow[] = [];
  for (const line of lines) {
    if (lineText(line) === "") continue;
    const row = splitAtLeader(line);
    if (row === null) return null;
    rows.push(row);
  }
  if (rows.length < 3) return null;

  const header: TableRow = {
    type: "tableRow",
    children: [
      { type: "tableCell", children: [] },
      { type: "tableCell", children: [{ type: "text", value: UNNAMED_COLUMN_MARK }] },
    ],
  };
  return {
    type: "table",
    align: [null, null],
    children: [
      header,
      ...rows.map(
        (row): TableRow => ({
          type: "tableRow",
          children: [
            { type: "tableCell", children: row.left },
            { type: "tableCell", children: row.right },
          ],
        }),
      ),
    ],
  };
}

/**
 * Cut one line in two at its leader, keeping inline markup on both sides.
 *
 * The cut is made inside the phrasing rather than on the flattened string, so a
 * linked or emphasised title on the left keeps its link and its emphasis. A
 * leader that is not interior — nothing before it, or nothing after it — is not
 * a column boundary and returns null.
 */
function splitAtLeader(line: RunLine): LeaderRow | null {
  const left: PhrasingContent[] = [];
  const right: PhrasingContent[] = [];
  let cut = false;

  for (const node of line.content) {
    if (cut) {
      right.push(node);
      continue;
    }
    if (node.type !== "text") {
      left.push(node);
      continue;
    }
    const match = LEADER_RUN.exec(node.value);
    if (match === null) {
      left.push(node);
      continue;
    }
    const before = node.value.slice(0, match.index);
    const after = node.value.slice(match.index + match[0].length);
    if (before.trim() !== "") left.push({ type: "text", value: before });
    if (after.trim() !== "") right.push({ type: "text", value: after });
    cut = true;
  }
  if (!cut) return null;

  trimTextEdges(left);
  trimTextEdges(right);
  if (phrasingText(left).trim() === "" || phrasingText(right).trim() === "") return null;
  // A second leader on the same line would mean a third column, which this rule
  // does not claim to read. Declining keeps it from silently losing one.
  if (right.some((node) => node.type === "text" && LEADER_RUN.test(node.value))) return null;
  return { left, right };
}

/** Drop the leading and trailing whitespace a cut leaves on a text edge. */
function trimTextEdges(nodes: PhrasingContent[]): void {
  const first = nodes[0];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/u, "");
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") last.value = last.value.replace(/\s+$/u, "");
}

function listFromEnumeratedLines(lines: readonly RunLine[], ctx: Ctx): List | null {
  const grouped = enumeratedItems(lines);
  if (grouped === null) return null;
  void ctx;
  return {
    type: "list",
    ordered: false,
    spread: false,
    children: grouped.map((item) => ({
      type: "listItem",
      spread: false,
      children: [{ type: "paragraph", children: joinItemLines(item) }],
    })),
  };
}

/**
 * One item's lines → phrasing.
 *
 * Continuation lines join with a space, not a hard break: they exist because a
 * fixed-width layout could not fit the title, which is line *fitting* and not a
 * line the author drew. `02. I just called to say I love you` / `(S Wonder)` is
 * one title, and the reference writes it as one.
 */
function joinItemLines(item: readonly RunLine[]): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  item.forEach((line, index) => {
    if (index > 0) children.push({ type: "text", value: " " });
    children.push(...line.content);
  });
  return trimEdgeBreaks(collapseAdjacentText(children));
}

/**
 * A native `<blockquote>` around one flat run of parallel lines is a record
 * list, not a quotation this era's markup happens to indent the same way.
 *
 * ## Rule contract
 *
 * **Invariant.** Containment, not shape: the blockquote's *only* lowered
 * content is a single `paragraph`, and `quotesItsContent` has already
 * declined it. `kiselev`'s six album track lists are exactly this — each
 * `<blockquote style="margin-left: 25">` holds one `<p class="cdk">` of
 * `<br>`-joined "title <i>duration</i>" lines and nothing else.
 *
 * **Why not shape.** §15.2 measured line count, line length and variance
 * across every multi-line run in the 13 references and found total overlap
 * between a genuine list (`kiselev`'s tracks) and verse that must stay a
 * paragraph (`borislova`'s poems) — neither is a usable discriminator. What
 * separates them is containment the shape signal cannot see: `kiselev`
 * writes the run inside a real `<blockquote>`; `borislova`'s poems sit in a
 * plain `<p class="it">`, never inside `<blockquote>` at all.
 *
 * **False friend, tested for non-firing:** `segovia`'s two quoted anecdotes
 * are the same shape one level up — `<blockquote><i><p class="c">…</p></i>
 * </blockquote>`, `<br>`-joined dialogue lines — but they are wholly italic,
 * so `quotesItsContent` claims them first and this function never sees them.
 * Every other blockquote in the 22-document corpus (the whole-article
 * wrapper on 13 pages, `tarrega`'s multi-paragraph PDF-track blockquote,
 * `new_rechin4`'s pagination-strip-plus-prose blockquote) lowers to *more*
 * than one block, failing the single-paragraph gate before the question of
 * content is even asked.
 *
 * **Recurrence.** Not required by the invariant, which is containment — but
 * measured recurring six times on `kiselev`'s own page (a title paragraph
 * followed by an indented blockquote, six albums running), which is what
 * makes the shape decidable at all rather than a single credit line.
 */
function listFromBlockquoteRun(inner: readonly BiomdContent[]): List | null {
  if (inner.length !== 1) return null;
  const only = inner[0];
  if (!only || only.type !== "paragraph") return null;
  const lines = splitLines(only.children).filter((line) => lineText(line).trim() !== "");
  if (lines.length < 2) return null;
  return listOfLines(lines);
}

/**
 * One line, one item — the emission every list rule in this file shares.
 *
 * Shared deliberately. The four rules recognise a list from four unrelated
 * kinds of evidence, but what they *emit* is the same thing, and a run promoted
 * on a hook's judgement must be indistinguishable from one promoted on an
 * indent. No trailing hard break: a break inside a list item separates nothing,
 * and the item boundary already carries what the source `<br>` meant.
 */
function listOfLines(lines: readonly RunLine[]): List {
  return {
    type: "list",
    ordered: false,
    spread: false,
    children: lines.map((line) => ({
      type: "listItem",
      spread: false,
      children: [{ type: "paragraph", children: trimEdgeBreaks(collapseAdjacentText(line.content)) }],
    })),
  };
}

/**
 * A break-run the four list rules all declined, when it is worth asking about.
 *
 * ## Rule contract
 *
 * This is a **gate**, not a detector: everything it passes is still a
 * paragraph unless an operator's hook says otherwise, and everything it stops
 * is a paragraph either way. Its job is to spend nothing on runs whose answer
 * is already known, and it reads no class, id, tag, filename or word.
 *
 * **Invariant.** Three relations: the run has at least {@link MIN_RUN_LINES}
 * lines (a pair is a name and its subtitle, not an enumeration); its breaks are
 * already *structural* by `groupIsLineated`, so the lines are lines rather than
 * a hand-wrapped sentence; and it carries no picture, because a run of figures
 * is a strip and its lines are captions.
 *
 * **Recurrence** is the run itself — the parallelism between its own lines is
 * the evidence, which is why the item escalated is the whole block. Asking per
 * line would destroy exactly the evidence the question turns on.
 *
 * **False friends, and which of them this gate can see.** A *caption* run under
 * a picture is excluded here, by context rather than by shape. Prose and verse
 * are **not** excluded here and cannot be: PROGRESS §15.2 measured line count,
 * line length and variance over every multi-line run in the references and
 * found `kiselev`'s tracks and `borislova`'s poems totally overlapping. That
 * separation is the judgement the hook exists to make, and `TEXT_LIST.accept`
 * catches only the part of it that is deterministic — a line holding two
 * sentences is prose whatever a model says.
 */
function breakRunCandidateOf(lines: readonly RunLine[], ctx: Ctx, lead?: string): BreakRunCandidate | null {
  if (lines.length < MIN_RUN_LINES) return null;
  // A hand-wrapped paragraph has no lines to make items of.
  if (!groupIsLineated(lines)) return null;
  if (lines.some((line) => line.content.some((c) => c.type === "image"))) return null;
  // A line under a picture is that picture's caption; `bindCaptions` owns it.
  if (ctx.inCaptionContext && ctx.inCenteredBlock) return null;

  const texts = lines.map((line) => lineText(line));
  if (texts.some((t) => t.trim() === "")) return null;

  // A run whose members are not all peers is not a *flat* list, and the only
  // list this escalation can emit is flat. `borislova`'s works catalogue is the
  // measured case: three movements sit indented and numbered under the concerto
  // they belong to, and promoting the run would make them siblings of it —
  // structural loss (§1 priority 3) in exchange for reference agreement, which
  // the priority order forbids outright. Both forms of subordination this
  // corpus writes are read here, and neither reads a class or a word: an indent
  // some lines carry and others do not, and an ordinal on a proper subset.
  if (new Set(lines.map((line) => line.indent)).size > 1) return null;
  const numbered = texts.filter((t) => opensWithOrdinal(t)).length;
  if (numbered > 0 && numbered < texts.length) return null;

  const trimmed = lead?.trim();
  return {
    id: breakRunId(texts),
    lines: texts,
    ...(trimmed ? { lead: trimmed.slice(0, LEAD_LIMIT) } : {}),
  };
}

/** Three lines is the shortest run whose members can be parallel to each other. */
const MIN_RUN_LINES = 3;

/** Enough of the preceding block to recognise an announcement; not a payload. */
const LEAD_LIMIT = 300;

/**
 * The label a block carries, when that label can title the menu below it.
 *
 * ## Rule contract
 *
 * **Invariant.** The block immediately above a `nav`, holding one short line of
 * words and nothing else — no link, no image, no second block. `nav`'s
 * `title` is where §11 puts it, and as a loose paragraph the label reads as a
 * stray line between two sections instead of naming the bar under it.
 *
 * **False friend.** A sentence that happens to precede a menu. Absorbing one
 * would move body text into a directive property, which is the worst direction
 * this rule can fail in, so it is refused on three counts at once: length, word
 * count and terminal punctuation.
 *
 * **Second false friend: a line that is itself a series.** `new_rechin4`'s
 * strapline `Идея • Концепция • Музыкальное воплощение` passes every test above
 * — 5 words, 37 characters, no terminal stop — and is not the name of anything.
 * An ornament *between* phrases is structure: the line lists three things, and a
 * title names one. Symmetric ornament is the opposite and is stripped first by
 * {@link stripPairedOrnament}, which is why the test runs on the stripped text.
 * Measured: the five titles the references carry — `ИЗБРАННАЯ ДИСКОГРАФИЯ`,
 * `ДРУГИЕ АЛЬБОМЫ`, `Архив новостей` twice, `Дискография` — hold no interior
 * ornament between them.
 *
 * **Why not source containment**, which looks like the obvious guard: `news`
 * puts its label in a bordered tinted cell of its own, a *different* container
 * from the bar it names, and wants the title anyway. Adjacency in the flow is
 * the position §11 describes; the source's box structure is not.
 *
 * The `::: align` a centred label arrives in is unwrapped rather than refused —
 * `nav` carries its own presentation, and a label that is centred *because* it
 * titles a centred bar says nothing further.
 */
function navTitleFrom(node: BiomdContent): string | null {
  let candidate: BiomdContent = node;
  if (candidate.type === "biomdAlign") {
    const inner = candidate.children.filter((c) => c.type !== "thematicBreak");
    if (inner.length !== 1) return null;
    candidate = inner[0] as BiomdContent;
  }
  if (candidate.type !== "paragraph") return null;
  if (candidate.children.some((c) => c.type === "link" || c.type === "image" || c.type === "break")) return null;
  const text = stripPairedOrnament(phrasingText(candidate.children).replace(/\s+/gu, " ").trim());
  if (text.length < 4 || text.length > 60) return null;
  if (text.split(/\s+/u).filter(Boolean).length > 8) return null;
  if (/[.!?]/u.test(text)) return null;
  // A line that separates its own phrases with an ornament is a series, and a
  // title names one thing. Interior only — the ends were handled above.
  if ([...text].slice(1, -1).some((ch) => RULE_GLYPHS.has(ch))) return null;
  return text;
}

/**
 * Drop an ornament the page hung on both ends of a label.
 *
 * `• Архив новостей •` is `Архив новостей` with a bullet either side, the way
 * this era underlined a heading it had no heading tag for. Symmetry is the
 * evidence and it is what keeps the rule off a label that merely *starts* with
 * a marker: `stripLabelGlyphs` owns that case and answers it differently,
 * because a leading bullet is a list marker and a matched pair is decoration.
 */
function stripPairedOrnament(text: string): string {
  const chars = [...text];
  const first = chars[0];
  const last = chars[chars.length - 1];
  if (chars.length < 3 || first === undefined || first !== last || !RULE_GLYPHS.has(first)) return text;
  return chars.slice(1, -1).join("").trim();
}

/**
 * A separator the author drew out of punctuation, e.g. `* * *`.
 *
 * ## Rule contract
 *
 * **Invariant.** A *line* whose entire visible content is one ornament
 * repeated — cardinality, not typography, and nothing about size, weight or
 * position. `BioMD-Reference.md` §0 ranks hierarchy and grouping above exact
 * style, and this is the division the page drew between two passages;
 * `CLAUDE.md` invariant 4 puts drawing a separator explicitly outside §16.3,
 * because a rule invents no text. Kept as a paragraph the construct is lost
 * and the reader gets three escaped asterisks (`\* \* \*`) where the page
 * showed a break.
 *
 * **The unit is the line, not the block.** `<br>` is how this era ended a line
 * inside a block, so a rule the author drew above a signature lives in the same
 * `<p>` as the signature — `-------------------------<br>Олег Киселев: …` —
 * and a block-level test cannot see it. The five whole-block dinkuses the
 * corpus already handled are the degenerate case of the same rule, where every
 * line happens to be an ornament.
 *
 * **Recurrence.** Inside the line rather than across the page: one `*` is a
 * footnote marker, three in a row are a dinkus. Requiring the ornament to
 * recur *between* passages would be wrong here — four of the five whole-block
 * instances in the corpus are the only one on their page.
 *
 * **False friends,** all excluded by "the whole line and nothing else":
 * `• Из письма А.Максимова` is a bulleted label, `— Да, — ответил он` is
 * dialogue, `**` around a word is emphasis the inline pass already consumed,
 * and a line mixing two ornaments is decoration rather than a rule.
 * A line carrying a link or an image is content whatever its text looks like —
 * asked per line, because the signature beside the rule is exactly such a line
 * and the block-level form of this question suppressed the whole rule.
 *
 * The glyph list is documented lexical data in `glyphs.ts`; an ornament that
 * is not on it stays a paragraph, which is what every one of them does today.
 */
function drawnRuleFrom(lines: readonly RunLine[]): BiomdContent[] | null {
  if (lines.length === 0) return null;
  const isRule = (line: RunLine): boolean =>
    isDrawnRule(lineText(line)) && !line.content.some((c) => c.type === "link" || c.type === "image");
  if (!lines.some(isRule)) return null;

  // No ledger entry, for `groupAlignedRuns`' reason: the element these lines
  // came from already recorded itself as EMITTED, and `runPass` rejects an id
  // it did not declare. This changes the shape of a block, it does not consume
  // a source node.
  const out: BiomdContent[] = [];
  let segment: RunLine[] = [];
  const flush = (): void => {
    if (segment.length === 0) return;
    const paragraph = paragraphFromLines(segment);
    if (paragraph) out.push(paragraph);
    segment = [];
  };
  for (const line of lines) {
    if (isRule(line)) {
      flush();
      out.push({ type: "thematicBreak" } as BiomdContent);
      continue;
    }
    segment.push(line);
  }
  flush();
  return out.length > 0 ? out : null;
}

/** Lines → one paragraph, with each interior break classified. */
function paragraphFromLines(lines: readonly RunLine[]): Paragraph | null {
  const lineated = groupIsLineated(lines);
  const children: PhrasingContent[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      const previous = lines[index - 1] as RunLine;
      const left = lineText(previous);
      const right = lineText(line);
      const indent: [number, number] = [previous.indent, line.indent];
      // A hand-wrapped sentence means a space; a line the author drew means a
      // hard break.
      if (!lineated && isWrapBreak(left, right, indent)) children.push({ type: "text", value: " " });
      else children.push({ type: "break" });
    }
    children.push(...line.content);
  });

  const cleaned = trimEdgeBreaks(collapseAdjacentText(children));
  return cleaned.length > 0 ? { type: "paragraph", children: cleaned } : null;
}

/**
 * `::: nav` from a run of links, or null when the run is ordinary prose.
 *
 * The evidence is negative as much as positive: what makes a stack of links a
 * menu is that there is *nothing else* between them. One sentence of prose in
 * the middle and it is a paragraph that happens to contain links, which is a
 * completely different thing and must stay one.
 */
function navFrom(nodes: readonly LadomNode[], ctx: Ctx): BiomdContent | null {
  // Nav is not permitted inside `align`, `frame` or a bounded column (§4.1), and
  // silently dropping it there would lose every link in it.
  // §4.1 forbids `nav` inside a `frame`, and §2 forbids `align` wrapping one.
  // It does **not** forbid a `column`: `column→Markdown+leaf+align+nav` is in
  // the nesting table, and the side rail a menu arrives in *is* a lane.
  // `navFromGrid` already draws that line and says why; this path refused every
  // bounded context instead, so `news_2007`'s year bar — the same bar `news`
  // emits as a `nav`, one lane deeper — came out as ten bracketed links in a
  // paragraph. The `align` half needs no guard here: `alignedGroup` refuses
  // inner content containing a `nav`, and `isBounded` keeps one out of
  // `groupAlignedRuns`' runs.
  if (ctx.frameDepth > 0) return null;

  const links: LadomNode[] = [];
  /** The one plain-text item §11 allows: the page you are already on. */
  const plainItems: string[] = [];
  const order: Array<{ kind: "link"; node: LadomNode } | { kind: "plain"; text: string }> = [];

  /** The one plain item §11 allows, wherever the source spelled it. */
  const takePlain = (raw: string): boolean => {
    if (NAV_SEPARATOR.test(raw)) return true;
    const label = raw.replace(NAV_SEPARATOR_CHARS, " ").replace(/\s+/gu, " ").trim();
    if (label === "") return true;
    // §11's one plain item is "the page you are already on", and a page is
    // never *announced*. A colon is the punctuation of announcement, so the
    // text carrying one is a lead-in standing outside the run — which makes
    // the run a credit line rather than a menu. See {@link ANNOUNCING_LABEL}.
    if (ANNOUNCING_LABEL.test(label)) return false;
    if (label.length > 40 || plainItems.length > 0) return false;
    plainItems.push(label);
    order.push({ kind: "plain", text: label });
    return true;
  };

  for (const node of nodes) {
    if (node.kind === "comment") continue;
    if (node.kind === "text") {
      // Separators, not words. Legacy menus bracket their items — `[ 2007 ]` —
      // and rejecting punctuation outright missed every one of them.
      if (!takePlain(node.value ?? "")) return null;
      continue;
    }
    if (node.tag === "br") continue;
    if (node.tag === "a") {
      links.push(node);
      order.push({ kind: "link", node });
      continue;
    }
    // A wrapper around exactly one link is still a link.
    if (textOf(node) === "" && node.metrics.images === 0) continue;
    // And a wrapper around the plain item is still the plain item. `new_rechin4`
    // marks the page you are on by setting it in bold — `[ <b> 3</b> ]` beside
    // `[<a>1</a>] [<a>2</a>]` — which is the commonest way this era says "you
    // are here" and was rejecting the whole strip. Only a wrapper carrying no
    // link and no picture of its own: anything else is content, and the
    // negative evidence that makes a stack of links a menu still has to hold.
    if (node.metrics.links === 0 && node.metrics.images === 0) {
      if (!takePlain(textOf(node))) return null;
      continue;
    }
    return null;
  }

  // Three *items*, not three links: §11's plain item is an item, and a strip of
  // `1 | 2 | 3` on page three has only two places left to go. Two links remain
  // the floor for the run being navigation at all — one link and a word is a
  // sentence.
  if (links.length < 2 || order.length < 3) return null;

  // Decide before emitting: every check below is pure, so a run that turns out
  // not to be a menu leaves nothing behind in the conservation inventory.
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const rewritten = rewriteTarget(link.attrs["href"] ?? "", ctx.options.links);
    if (rewritten.kind === "unsafe" || rewritten.href === "") return null;
    const label = textOf(link);
    // A menu item is a label. An item carrying a sentence is a citation list.
    if (label === "" || label.length > 100) return null;
    // Repeated destinations mean the source was listing, not navigating — and
    // §11 makes duplicate labels invalid outright.
    if (seen.has(rewritten.href)) return null;
    seen.add(rewritten.href);
    targets.push(rewritten.href);
  }

  // A plain item that duplicates a link's label would make `active` ambiguous,
  // which §11 makes invalid outright.
  const labels = links.map((l) => textOf(l).trim());
  const active = plainItems[0];
  if (active !== undefined && labels.includes(active)) return null;

  let linkIndex = 0;
  const items: ListItem[] = order.map((entry) => {
    if (entry.kind === "plain") {
      return {
        type: "listItem",
        spread: false,
        children: [{ type: "paragraph", children: [{ type: "text", value: entry.text }] }],
      };
    }
    const url = targets[linkIndex] as string;
    linkIndex += 1;
    return {
      type: "listItem",
      spread: false,
      children: [
        { type: "paragraph", children: [{ type: "link", url, children: oneLineLabel(inlineFrom(entry.node.children, ctx)) }] },
      ],
    };
  });

  for (let i = 0; i < links.length; i += 1) {
    ctx.targets.push(targets[i] as string);
    ctx.ledger.push(emitted((links[i] as LadomNode).id, nextId(ctx, "nav-item")));
  }

  return makeNav({
    list: { type: "list", ordered: false, spread: false, children: items },
    ...(active !== undefined ? { active } : {}),
  });
}

/**
 * A label that announces what comes after it rather than naming itself.
 *
 * ## Rule contract
 *
 * **Invariant.** Punctuation, not vocabulary: a trailing colon. `BioMD-Reference.md`
 * §11 allows a `nav` exactly one plain item and says what it is — *the page you
 * are already on* — and a page name is never announced. Text that announces the
 * links after it stands **outside** the run, which makes the run a credit line
 * or a citation rather than a menu, and `navFrom`'s own stated evidence is
 * negative: what makes a stack of links a menu is that there is nothing else
 * between them. A lead-in is something else.
 *
 * This is the same signal, read the same way, as the colon-announced list of
 * `promoteLabelBeforeList`: the colon marks its line as a lead-in, not a member.
 * Language-independent, and the full-width form is included because the corpus
 * is not guaranteed to be Latin-punctuated.
 *
 * **Recurrence.** Not applicable: a run has at most one lead-in by definition.
 *
 * **False friend, tested for non-firing: the active page marker.** The corpus
 * separates cleanly and in both directions — the three plain items the
 * references *keep* are `Последние` (`news`) and `А Бартоли` twice
 * (`new_karta`), none with a colon; the two the produced side invented are
 * `Источники:` (`new_blackmore`) and `Основные источник:` (`new_kolpakov`),
 * both with one, and both of them source-credit lines their references write
 * as prose. Length, word count and position separate none of these.
 */
const ANNOUNCING_LABEL = /[:：]$/u;

/** Punctuation legacy menus used to fence their items. */
const NAV_SEPARATOR_CHARS = /[[\]()|·•—–\-/,;«»]/gu;
const NAV_SEPARATOR = /^[\s[\]()|·•—–\-/,;«»]*$/u;

const INLINE_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "code", "span",
  "img", "br", "small", "big", "font", "tt", "abbr", "cite", "q", "mark",
]);

function isInline(node: LadomNode): boolean {
  return node.kind === "element" && INLINE_TAGS.has(node.tag);
}

/** Convert one block-level element. */
/**
 * Lower one block element, then sweep up any destination nothing inside it
 * claimed.
 *
 * The sweep is what rescues an anchor from a place a directive cannot go. A
 * `<a name>` inside a cell of a region that became a Markdown table is never
 * seen by `blocksFrom`, because the cell was lowered as inline content; here the
 * table has just finished emitting, so the marker attaches to the table and
 * lands immediately before it. The same path covers a nav item, a list item and
 * an image's enclosing link.
 */
function blockFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
  const produced = lowerBlock(el, ctx);
  const claimed = ctx.anchors.claimIn(el);
  if (claimed.length > 0) {
    if (produced.length > 0) markAnchors(ctx, produced[0] as BiomdContent, claimed);
    else ctx.anchors.release(claimed);
  }
  return produced;
}

function lowerBlock(el: LadomNode, ctx: Ctx): BiomdContent[] {
  // A heading the typography carried rather than a tag (see headings.ts).
  const recovered = Number.parseInt(el.attrs["data-biomd-heading"] ?? "", 10);
  if (Number.isFinite(recovered) && recovered >= 1 && recovered <= 6) {
    const text = headingPhrasing(inlineFrom(flattenBlocks(el.children), ctx));
    if (text.length > 0) {
      // Typographic prominence is measured page-wide, so a record card's title
      // scores like a section title. Its *place* says otherwise: inside a
      // nested region it is a sub-section of whatever introduced the region.
      const depth = recovered === 2 && ctx.tableDepth >= 2 ? 3 : recovered;
      ctx.ledger.push(emitted(el.id, nextId(ctx, "heading")));
      const node: BiomdContent = { type: "heading", depth: depth as 1 | 2 | 3 | 4 | 5 | 6, children: text };
      if (depth > 1) ctx.recoveredHeadings.add(node);
      return [node];
    }
  }

  // A headline the author wrapped inside one block with `<br>` (headings.ts).
  // The lines are inline runs, so the split has to happen after inline
  // lowering — which is where `splitLines` already puts every other `<br>`
  // decision on this page.
  const mastheadPlan = el.attrs["data-biomd-masthead"];
  if (mastheadPlan !== undefined) {
    const depths = mastheadPlan.split(",").map((d) => Number.parseInt(d, 10));
    const lines = splitLines(inlineFrom(flattenBlocks(el.children), ctx)).filter((line) => lineText(line) !== "");
    if (lines.length === depths.length && depths.every((d) => d >= 1 && d <= 6)) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "heading")));
      return lines.map((line, i) => {
        const depth = depths[i] as 1 | 2 | 3 | 4 | 5 | 6;
        const node: BiomdContent = { type: "heading", depth, children: headingPhrasing(line.content) };
        if (depth > 1) ctx.recoveredHeadings.add(node);
        return node;
      });
    }
  }

  // A headline the author set over a lighter continuation — `headings.ts`'s
  // `isSplitHeadline`. It is not an outline entry: as a heading its two runs
  // joined into one 122-character `##`, which `analyze-3.md` calls
  // `pavlov_azancheev`'s first critical fault, and the bold-over-plain styling
  // the author drew was lost. It is not two blocks either — the continuation
  // belongs to the line above it. One paragraph, broken where the source broke,
  // carrying the weight the source set on each run, inside whatever alignment
  // the block already has.
  if (el.attrs["data-biomd-headline"] !== undefined) {
    const phrasing = trimEdgeBreaks(liftBreaksOutOfEmphasis(inlineFrom(flattenBlocks(el.children), ctx)));
    if (phrasing.length > 0) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "headline")));
      return [{ type: "paragraph", children: phrasing }];
    }
  }

  // §2.1: the second line of a masthead stays a secondary title line, set in
  // italics directly under the title — not a second `#`, and not prose.
  if (el.attrs["data-biomd-subtitle"] !== undefined) {
    const phrasing = trimEdgeBreaks(inlineFrom(flattenBlocks(el.children), ctx));
    if (phrasing.length > 0) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "subtitle")));
      return [{ type: "paragraph", children: [{ type: "emphasis", children: dropEmphasis(phrasing) }] }];
    }
  }

  const depth = HEADING_TAGS[el.tag];
  if (depth !== undefined) {
    const text = headingPhrasing(inlineFrom(flattenBlocks(el.children), ctx));
    if (text.length === 0) {
      ctx.ledger.push(removed(el.id, "empty heading"));
      return [];
    }
    ctx.ledger.push(emitted(el.id, nextId(ctx, "heading")));
    return [{ type: "heading", depth: depth as 1 | 2 | 3 | 4 | 5 | 6, children: text }];
  }

  switch (el.tag) {
    case "table":
      return tableFrom(el, ctx);

    case "p":
    case "div":
    case "section":
    case "article":
    case "main":
    case "body":
    case "html":
    case "#root":
    case "center":
    case "td":
    case "th": {
      const inner = blocksFrom(el, ctx);
      if (inner.length > 0) ctx.ledger.push(emitted(el.id, nextId(ctx, "block")));
      else ctx.ledger.push(removed(el.id, "no content after conversion"));
      const masthead = mastheadAlign(el, inner, ctx);
      if (masthead) return masthead;
      return alignedGroup(el, inner, ctx);
    }

    case "ul":
    case "ol": {
      // A list with no items is not a list — see `listFrom`. FrontPage's
      // "increase indent" button emits a bare `<ul>` around ordinary blocks,
      // and the item loop below has nothing to iterate. Treated as the block
      // wrapper it is, exactly like `<blockquote>`'s non-quoting path.
      if (!el.children.some((child) => child.kind === "element" && child.tag === "li")) {
        const inner = blocksFrom(el, ctx);
        if (inner.length > 0) ctx.ledger.push(emitted(el.id, nextId(ctx, "block")));
        else ctx.ledger.push(removed(el.id, "no content after conversion"));
        return alignedGroup(el, inner, ctx);
      }
      return [listFrom(el, ctx)];
    }

    case "blockquote": {
      const quoted = quotesItsContent(el, ctx);
      const inner = blocksFrom(el, ctx).filter(isBlockContent);
      if (quoted && inner.length > 0) {
        ctx.ledger.push(emitted(el.id, nextId(ctx, "quote")));
        return [{ type: "blockquote", children: inner }];
      }
      const recordList = quoted ? null : listFromBlockquoteRun(inner);
      if (recordList) {
        ctx.ledger.push(emitted(el.id, nextId(ctx, "list")));
        return [recordList];
      }
      if (inner.length > 0) ctx.ledger.push(emitted(el.id, nextId(ctx, "block")));
      else ctx.ledger.push(removed(el.id, "no content after conversion"));
      return alignedGroup(el, inner, ctx);
    }

    case "hr":
      ctx.ledger.push(emitted(el.id, nextId(ctx, "rule")));
      return [{ type: "thematicBreak" }];

    case "pre": {
      // The one block whose whitespace is its content — see `preformatted.ts`.
      // `textOf` collapses it, which turned every poem on the page into a
      // single line inside a fence while losing no word, so no rung noticed.
      const value = preformattedText(el);
      if (value === null) {
        ctx.ledger.push(removed(el.id, "preformatted spacer with no content"));
        return [];
      }
      ctx.ledger.push(emitted(el.id, nextId(ctx, "code")));
      return [{ type: "code", value }];
    }

    case "img": {
      if (isDecorative(el)) {
        ctx.ledger.push(removed(el.id, "decorative image (spacer, icon, rule or nav glyph)"));
        return [];
      }
      const image = imageFrom(el, ctx, true);
      return image ? [image] : [];
    }

    case "dl": {
      // A definition list has no BioMD construct; the honest mapping is a
      // sequence of term/definition paragraphs rather than an invented one.
      const inner = blocksFrom(el, ctx);
      ctx.ledger.push(emitted(el.id, nextId(ctx, "deflist")));
      return inner;
    }

    default: {
      const inner = blocksFrom(el, ctx);
      if (inner.length > 0) {
        ctx.ledger.push(emitted(el.id, nextId(ctx, "block")));
        return inner;
      }
      ctx.ledger.push(removed(el.id, `unmapped <${el.tag}> with no content`));
      return [];
    }
  }
}

/**
 * Reduce a phrasing run to something a heading can hold.
 *
 * A heading is one line: a source `<br>` inside it was line-fitting for a fixed
 * layout, and keeping it forces the serializer into setext form, where `# ` is
 * replaced by an `====` underline that no `^#` reader recognises. Emphasis that
 * covers the whole heading is likewise redundant — the heading already is the
 * emphasis — and `**Title**` differs from `Title` for every consumer that
 * matches on the label.
 *
 * **The fold has to reach every depth.** A `<br>` the author put *inside* the
 * emphasis — `<b>М.ПАВЛОВ-АЗАНЧЕЕВ (1888-1963).<br></b>(Краткая биография…)`,
 * which is how this era wrote a two-line title with only its first line bold —
 * is not a top-level child, so folding the top level alone left it in place and
 * `dropEmphasis` then lifted it back out. The result was the one setext heading
 * in the corpus: an underline of 89 hyphens that `blocks.ts` reads as a
 * thematic break, `read()` passes through as opaque Markdown, and CommonMark
 * turns into an `h2` swallowing the line above it. Three readings of one line.
 */
function headingPhrasing(nodes: PhrasingContent[]): PhrasingContent[] {
  const flat = foldBreaks(nodes);

  // Drop emphasis outright. A heading is uniformly prominent already, and a
  // partially bold one — `# **Андрес** Сеговия`, which is what the source
  // markup literally said — is a different label from the same words plain, for
  // anything that matches on it.
  const out = collapseAdjacentText(dropEmphasis(flat));

  // A leading bullet was the era's way of marking a list of section labels.
  // It is typography, not part of the name.
  const first = out[0];
  if (first?.type === "text") {
    const stripped = stripLabelGlyphs(first.value);
    if (stripped === "" && out.length > 1) out.shift();
    else if (stripped !== first.value) first.value = stripped;
  }
  return out.filter((n) => n.type !== "text" || n.value !== "");
}

/**
 * Replace every `break`, at any depth, with a space.
 *
 * Containers are copied rather than mutated: the caller is usually building a
 * heading *out of* a paragraph that may still be in the tree if the promotion
 * is abandoned, and a heading is the only context where a line break is
 * line-fitting rather than meaning.
 */
export function foldBreaks(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  return nodes.map((node) => {
    if (node.type === "break") return { type: "text", value: " " } as PhrasingContent;
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) return node;
    return { ...node, children: foldBreaks(children as PhrasingContent[]) } as PhrasingContent;
  });
}

/**
 * A link label is one line.
 *
 * ## Rule contract
 *
 * **Invariant.** The construct, not the document: `[label](target)` is one
 * line of inline content, so a `<br>` written inside an `<a>` divides nothing a
 * reader can act on. `analyze-2.md` states it outright — *"ссылка … всегда идет
 * в 1 строку и имеет формат `[видимое-название](ссылка)`"* — and this is the
 * rule `liftBreaks` has always applied when a break reached it inside a link
 * ("a link is a single destination; splitting it would invent a second one").
 * Asked at construction instead, so the two paths that build a link from an
 * `<a>` cannot disagree: `goya2`'s contents entry and `new_kolpakov`'s four
 * publisher links reach the serializer without passing through `liftBreaks`.
 *
 * **Not a general break rule, and `foldBreaks`' own note says why.** A break in
 * running text is meaning; only a construct that is a single line by definition
 * may fold one. A heading is such a construct; so is a link label. Nothing else
 * here may call this.
 *
 * **Recurrence.** Not applicable: a label carries at most one edge break by
 * construction. The corpus states the shape rather than repeating it — seven of
 * the 22 sources write `<br>` inside an `<a>`, and **no reference anywhere**
 * contains a break inside a link label.
 *
 * **False friend, tested for non-firing:** the break *after* a link, which is
 * the line division the author drew between two entries and is untouched — the
 * same `<a>` in `goya2` is followed by a second `<br>` outside it, and that one
 * is the entry boundary.
 *
 * **An interior break becomes a space; an edge break is handed back to the
 * caller.** These are different facts and the first version of this rule
 * conflated them, which lost a line division: `new_kolpakov` writes each source
 * credit as `<a …>talismanmusic.org<br></a>`, with the break *inside* the
 * anchor and nothing after it, so dropping it ran four credits onto one line.
 * The label is still one line — the break is simply not part of it, and it
 * divides the link from whatever follows exactly as the author drew it.
 * {@link labelWithEdgeBreaks} is the form that says so; `oneLineLabel` is the
 * shorthand for callers whose own construct is already one line per item, where
 * an edge break has nothing left to divide.
 */
function oneLineLabel(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  return labelWithEdgeBreaks(nodes).label;
}

/**
 * A break at the edge of an emphasis span is not part of the emphasis.
 *
 * A page of this era writes `<b>М.ПАВЛОВ-АЗАНЧЕЕВ (1888-1963).<br></b>` and
 * puts the line division inside the weight that applies to the line above it.
 * Serialized as written, the break lands inside `**…**`, where it has to be
 * escaped — so the line ends with a literal backslash and the bold closes a
 * character past where the reader saw it end. Nothing can be *emphasized*
 * about a line ending.
 *
 * Scoped to the split-headline branch, which is the only construct that lowers
 * a `<br>` inside emphasis into a hard break today; every other caller either
 * folds breaks away (a link label, a heading) or keeps the run as written.
 */
function liftBreaksOutOfEmphasis(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type !== "strong" && node.type !== "emphasis") {
      out.push(node);
      continue;
    }
    let children = node.children as PhrasingContent[];
    let leading = 0;
    let trailing = 0;
    for (;;) {
      const stripped = stripEdgeBreak(children, "start");
      if (!stripped.found) break;
      children = stripped.nodes;
      leading += 1;
    }
    for (;;) {
      const stripped = stripEdgeBreak(children, "end");
      if (!stripped.found) break;
      children = stripped.nodes;
      trailing += 1;
    }
    for (let i = 0; i < leading; i += 1) out.push({ type: "break" });
    if (children.length > 0) out.push({ ...node, children: liftBreaksOutOfEmphasis(children) } as PhrasingContent);
    for (let i = 0; i < trailing; i += 1) out.push({ type: "break" });
  }
  // A line that begins where the source indented it begins with spaces the
  // serializer would have to escape. The break is the indentation now.
  return out.map((node, i) =>
    node.type === "text" && out[i - 1]?.type === "break"
      ? { ...node, value: node.value.replace(/^[\s ]+/u, "") }
      : node,
  );
}

/** A one-line label, plus how many breaks stood at each of its edges. */
function labelWithEdgeBreaks(nodes: readonly PhrasingContent[]): {
  leading: number;
  label: PhrasingContent[];
  trailing: number;
} {
  let work: PhrasingContent[] = [...nodes];
  let leading = 0;
  let trailing = 0;
  for (;;) {
    const stripped = stripEdgeBreak(work, "start");
    if (!stripped.found) break;
    work = stripped.nodes;
    leading += 1;
  }
  for (;;) {
    const stripped = stripEdgeBreak(work, "end");
    if (!stripped.found) break;
    work = stripped.nodes;
    trailing += 1;
  }
  return { leading, label: trimRunEdges(foldBreaks(work)), trailing };
}

/**
 * Remove one break from an edge of an inline run, at whatever depth it sits.
 *
 * Depth matters: the corpus writes `<a><font>label<br></font></a>` as often as
 * `<a>label<br></a>`, and a top-level test sees the `<font>` and stops. Blank
 * text is stepped over — `<br> ` before `</a>` is still an edge break.
 */
function stripEdgeBreak(
  nodes: readonly PhrasingContent[],
  edge: "start" | "end",
): { found: boolean; nodes: PhrasingContent[] } {
  const out = [...nodes];
  const order = edge === "start" ? [...out.keys()] : [...out.keys()].reverse();
  for (const i of order) {
    const node = out[i] as PhrasingContent;
    if (node.type === "break") {
      out.splice(i, 1);
      return { found: true, nodes: out };
    }
    if (node.type === "text") {
      if (node.value.trim() === "") continue;
      return { found: false, nodes: out };
    }
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children) || children.length === 0) return { found: false, nodes: out };
    const inner = stripEdgeBreak(children as PhrasingContent[], edge);
    if (!inner.found) return { found: false, nodes: out };
    out[i] = { ...node, children: inner.nodes } as PhrasingContent;
    return { found: true, nodes: out };
  }
  return { found: false, nodes: out };
}

/** Whitespace off the outer edges of an inline run, at whatever depth it sits. */
function trimRunEdges(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  const trimAt = (list: readonly PhrasingContent[], edge: "start" | "end"): PhrasingContent[] => {
    const out = [...list];
    const order = edge === "start" ? [...out.keys()] : [...out.keys()].reverse();
    for (const i of order) {
      const node = out[i] as PhrasingContent;
      if (node.type === "text") {
        const value = edge === "start" ? node.value.replace(/^\s+/u, "") : node.value.replace(/\s+$/u, "");
        out[i] = { ...node, value };
        // A node emptied by the trim cannot hold the edge; the next one does.
        if (value !== "") break;
        continue;
      }
      const children = (node as { children?: unknown }).children;
      if (!Array.isArray(children) || children.length === 0) break;
      out[i] = { ...node, children: trimAt(children as PhrasingContent[], edge) } as PhrasingContent;
      break;
    }
    return out.filter((n) => n.type !== "text" || n.value !== "");
  };
  return trimAt(trimAt(nodes, "start"), "end");
}

function dropEmphasis(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type === "strong" || node.type === "emphasis" || node.type === "delete") {
      out.push(...dropEmphasis(node.children));
      continue;
    }
    out.push(node);
  }
  return out;
}

function isBlockContent(node: BiomdContent): node is BlockContent {
  return node.type !== "definition" && node.type !== "footnoteDefinition";
}

/**
 * A list, and everything a list element holds that is not an item.
 *
 * The loop used to `continue` past every non-`li` child, which is silent
 * deletion: a `<ul>` that FrontPage's indent button drew around `assad_b`'s
 * discography deleted the table, its three covers and 23 of 194 text shingles,
 * and only the corpus-wide conservation gate ever noticed. The empty-list half
 * of that is decided by the caller (cardinality: a list with no items is a
 * block wrapper); this is the interleaved half.
 *
 * **Invariant.** Containment and order only — content inside a list element
 * that is not an item belongs to the item it follows, which is where the
 * browser draws it: inside the list's indented flow, continuing the last item.
 * Content before the first item prefixes that item for the same reason. No
 * tag, class, length or text is consulted.
 *
 * **Recurrence does not apply** and is deliberately not required: an indent
 * wrapper is drawn once, wherever the author pressed the button, so asking for
 * a second one would ask the construct not to exist — the trap §35.8 recorded
 * for `minRows: 2`.
 *
 * **False friend, and why it cannot fire:** the whitespace between two `<li>`
 * elements is a non-item child on every well-formed list in the corpus. It
 * converts to no block at all, so it contributes nothing and splits nothing —
 * which is why the test is "did it produce content", never "is it a text node".
 * Across the 946 unlabelled pages and the 28 references there are **five**
 * item-less lists and **zero** interleaved ones, so this branch is a guard
 * against silent loss rather than a rule fitted to a shape.
 */
function listFrom(el: LadomNode, ctx: Ctx): List {
  const ordered = el.tag === "ol";
  const items: ListItem[] = [];
  /** Consecutive non-item children, converted as one run so inline text joins. */
  let strays: LadomNode[] = [];
  /** Their blocks, waiting for the item they belong to. */
  let carried: BlockContent[] = [];
  const takeStrays = (): void => {
    if (strays.length === 0) return;
    // The list element itself is the context — its caption and centring apply
    // to content drawn inside it — so only the child list is narrowed.
    carried.push(...blocksFrom({ ...el, children: strays }, ctx).filter(isBlockContent));
    strays = [];
  };

  for (const li of el.children) {
    if (li.kind !== "element" || li.tag !== "li") {
      strays.push(li);
      continue;
    }
    takeStrays();
    const inner = [...carried, ...blocksFrom(li, ctx).filter(isBlockContent)];
    carried = [];
    items.push({
      type: "listItem",
      spread: false,
      children: inner.length > 0 ? inner : [{ type: "paragraph", children: [] }],
    });
    ctx.ledger.push(emitted(li.id, nextId(ctx, "li")));
  }
  takeStrays();
  const last = items[items.length - 1];
  if (carried.length > 0 && last) last.children = [...last.children, ...carried];

  ctx.ledger.push(emitted(el.id, nextId(ctx, "list")));

  const startAttr = Number.parseInt(el.attrs["start"] ?? "", 10);
  const list: List = { type: "list", ordered, spread: false, children: items };
  if (ordered && Number.isFinite(startAttr)) list.start = startAttr;

  // Zero-padded markers cannot be represented and the target would not preserve
  // them anyway; record the loss rather than pretend.
  const padded = /^0\d/u.test(el.attrs["start"] ?? "");
  ctx.downgrades.push(...resolveListMarkerPadding(ctx.options.profile, padded));
  return list;
}

/** Inline content, with `<br>` handled by the caller's block segmentation. */
function inlineFrom(nodes: readonly LadomNode[], ctx: Ctx, keepEdgeSpace = false): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  /**
   * Whether the break just emitted came out of a link label rather than out of
   * the run. Set by the `<a>` case, read by the `<br>` case, and cleared by
   * anything else — blank text excepted, since `</a>\n<br>` is one gesture with
   * a newline in the middle of it. See the `<br>` case for what it decides.
   */
  let hoistedBreak = false;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index] as LadomNode;
    /** The first visible character after this node, for the mark cases. */
    const nextChar = (): string => {
      for (let i = index + 1; i < nodes.length; i += 1) {
        const text = textOf(nodes[i] as LadomNode).replace(/^\s+/u, "");
        if (text !== "") return text[0] as string;
      }
      return "";
    };
    const carriedHoist = hoistedBreak;
    if (!(node.kind === "text" && (node.value ?? "").trim() === "")) hoistedBreak = false;
    if (node.kind === "comment") continue;
    if (node.kind === "text") {
      // Whitespace collapses the way a renderer collapses it — with one
      // exception, taken at the one place it can carry meaning. A run of
      // *non-collapsing* spaces at the head of the text that opens a line is
      // the author's indent: `&nbsp;`/`&ensp;`/`&emsp;` were the only way to
      // draw one, so their presence there is deliberate. Collapsing them here
      // destroyed the evidence before `splitLines` could read it, which is why
      // `news` merged three prize lines into one. Preserved *only* directly
      // after a `<br>`; `splitLines` measures it and strips it, so it never
      // reaches the output and no other consumer sees a changed string.
      const afterBreak = out[out.length - 1]?.type === "break";
      const value = collapseSpace(node.value ?? "", afterBreak);
      if (value !== "") out.push({ type: "text", value });
      continue;
    }
    if (node.kind !== "element") continue;

    switch (node.tag) {
      case "br":
        // A division drawn on both sides of the anchor boundary is one
        // division. `borislova` writes `<a …>ДИСКОГРАФИЯ<br></a><br>`, where
        // the break inside the label and the one after it are the same
        // gesture — the editor put one where the cursor was and the author put
        // the other where they meant it. Emitting both would claim a paragraph
        // boundary and split a credit block in two, and §1's hierarchy puts
        // structural correctness above reproducing a 14 px gap. The `<br>`
        // *outside* is the authored one, so it is the hoisted break that gives
        // way. See {@link labelWithEdgeBreaks}.
        if (carriedHoist && out[out.length - 1]?.type === "break") break;
        out.push({ type: "break" });
        break;
      case "b":
      case "strong": {
        const children = inlineFrom(node.children, ctx, /* keepEdgeSpace */ true);
        // `<b><b>x</b></b>` — legacy markup nests emphasis constantly, and the
        // serializer renders the redundant level as `****x****`, which is not
        // emphasis in Markdown at all.
        pushMark(
          out,
          children,
          (kids) => unwrapRedundant(kids, "strong") ?? { type: "strong", children: kids },
          nextChar(),
        );
        break;
      }
      case "i":
      case "em": {
        const children = inlineFrom(node.children, ctx, /* keepEdgeSpace */ true);
        pushMark(
          out,
          children,
          (kids) => unwrapRedundant(kids, "emphasis") ?? { type: "emphasis", children: kids },
          nextChar(),
        );
        break;
      }
      case "s":
      case "strike":
      case "del":
        pushMark(
          out,
          inlineFrom(node.children, ctx, /* keepEdgeSpace */ true),
          (kids) => ({ type: "delete", children: kids }),
          nextChar(),
        );
        break;
      case "code":
      case "tt":
        out.push({ type: "inlineCode", value: textOf(node) });
        break;
      case "a": {
        const href = node.attrs["href"] ?? "";
        const rewritten = rewriteTarget(href, ctx.options.links);
        const declared = ctx.anchors.declaredBy(node.id);
        if (rewritten.kind === "unsafe" || rewritten.href === "") {
          // An `<a name="x">` is not a link that lost its destination — it *is*
          // the destination, and the marker for it has already been claimed by
          // the enclosing block. Recording it as a removal would tell the
          // conservation gate to excuse the text this element wraps, which is
          // exactly the text that carries on into the run below.
          ctx.ledger.push(
            declared.length > 0
              ? emitted(node.id, `anchor:#${declared.join(",#")}`)
              : removed(node.id, "target carries no navigable destination"),
          );
          out.push(...inlineFrom(node.children, ctx));
          break;
        }
        if (rewritten.warning) ctx.warnings.push(`${node.id}: ${rewritten.warning}`);
        ctx.targets.push(rewritten.href);
        ctx.ledger.push(emitted(node.id, nextId(ctx, "link")));
        const { leading, label, trailing } = labelWithEdgeBreaks(inlineFrom(node.children, ctx));
        // A break the author drew at the edge of the label divides the link
        // from its neighbour, not the label from itself, so it comes back out
        // into the run at the position it was written.
        for (let i = 0; i < leading; i += 1) out.push({ type: "break" });
        // `<a href=x><img src=forward.gif></a>` — the label was a glyph, and
        // the glyph is gone. An empty `[](x)` is not a link a reader can see
        // or a screen reader can announce; the destination is the only
        // source-backed text left, so it becomes the label.
        out.push({
          type: "link",
          url: rewritten.href,
          children: label.length > 0 ? label : [{ type: "text", value: rewritten.href }],
        });
        for (let i = 0; i < trailing; i += 1) out.push({ type: "break" });
        hoistedBreak = trailing > 0;
        break;
      }
      case "img": {
        // An inline image inside a phrasing run stays a plain Markdown image;
        // a standalone one becomes `::: image` where it can carry position,
        // size and a caption.
        const src = node.attrs["src"] ?? "";
        if (src === "") {
          ctx.ledger.push(removed(node.id, "image without a source"));
          break;
        }
        // A known control keeps its meaning and loses its bitmap: the enclosing
        // `<a>` case below turns `[glyph](href)` out of it. `alt` outranks the
        // table when the author wrote one — it is the visible thing the icon
        // stood for on this page, where the glyph is only what the asset means
        // site-wide, and the corpus is unanimous: the two icons carrying `alt`
        // are labelled with it and the six without are drawn as glyphs.
        const icon = isUiIcon(node) ? iconGlyphFor(src) : null;
        if (icon) {
          // `removed`, not `mergedInto`: the *asset* really does leave the
          // output, and the images conservation ledger accounts only for
          // removals. Recording it any other way makes a page whose icons
          // became glyphs look like a page that lost two pictures — which is
          // what it did look like, until conservation said so on `new_geyzel04`.
          // The `<a>` is not removed, so its target is still required to appear.
          ctx.ledger.push(removed(node.id, "UI icon replaced by its glyph (mini_images_to_md_guide)"));
          const alt = (node.attrs["alt"] ?? "").replace(/\s+/gu, " ").trim();
          if (alt !== "") out.push({ type: "text", value: alt });
          else if (icon.mark === "letter") {
            out.push({ type: "strong", children: [{ type: "emphasis", children: [{ type: "text", value: icon.text }] }] });
          } else out.push({ type: "text", value: icon.text });
          break;
        }
        if (isDecorative(node)) {
          ctx.ledger.push(removed(node.id, "decorative image (spacer, icon, rule or nav glyph)"));
          break;
        }
        ctx.images.push(src);
        ctx.ledger.push(emitted(node.id, nextId(ctx, "img")));
        // The ledger keeps the source spelling so conservation still matches on
        // it; only the emitted target is resolved against the site layout.
        const emittedImage = {
          type: "image" as const,
          url: siteRelativeAsset(src, ctx.options.links),
          alt: node.attrs["alt"] ?? "",
        };
        // Line segmentation may still promote this to `::: image`; it needs the
        // source node to answer position, size and caption.
        ctx.imageNodes.set(emittedImage, node);
        out.push(emittedImage);
        break;
      }
      default: {
        // A wrapper is transparent unless the author used it to set a run of a
        // sentence apart from the sentence. See {@link isHighlightedRun}.
        const children = inlineFrom(node.children, ctx, /* keepEdgeSpace */ true);
        if (isHighlightedRun(node, out, children)) {
          ctx.ledger.push(emitted(node.id, nextId(ctx, "highlight")));
          pushMark(out, children, (kids) => ({ type: "biomdHighlight", children: kids }), nextChar());
          break;
        }
        // A transparent wrapper — `<span>`, `<font>`, anything with no Markdown
        // of its own. Its children are spliced straight into this run, and its
        // edge whitespace is subject to the same word-boundary question a mark's
        // is: `Ровшан </span>Шахбазович` fuses two words, while `В.И.</font>
        // Яшнева` and a footnote marker are punctuation boundaries that stay
        // tight. `pushMark` with an identity splice asks exactly that question.
        pushMark(out, children, null, nextChar());
        break;
      }
    }
  }

  return collapseAdjacentText(out, keepEdgeSpace);
}

/**
 * A run of a sentence the author set apart, and no existing mark claims.
 *
 * ## Rule contract — `==` is the mark for a distinction with no other name
 *
 * **Invariant.** Three conditions, all relational, none naming a document,
 * class, id or word:
 *
 *   1. **The wrapper computes a typographic variant its containing prose does
 *      not.** Bold, italic and strike already have marks and are lowered above;
 *      what is left is the era's fourth device, small capitals. `analyze`'s
 *      house rules ask for exactly this — *"текст отличающийся от других
 *      соседних блоков… желательно как-то выделять"* — and Reference §0 says
 *      how: map a visible distinction to the nearest supported construct, which
 *      for "set apart, but neither emphasis nor quotation" is `==`.
 *   2. **It is inside a sentence, not at the head of one.** Visible text must
 *      already stand before it *since the last hard break in the same run*. A
 *      run-in label opens its line; a highlighted phrase is embedded in one.
 *   3. **It carries no link and no image.** A styled link label is a control's
 *      appearance, not a distinction in prose.
 *
 * **Recurrence is present and was measured, not assumed.** `new_rechin4` sets
 * five phrases this way inside four long paragraphs, and its reference marks
 * **exactly those five** with `==` — a 5-of-5 correspondence with no
 * unmatched span on either side.
 *
 * **False friends**, each excluded by a different clause and each present in
 * the corpus:
 *   - **the small-caps `MP3`/`WMA` link label** — `new_karta` ×6, `williams2`,
 *     `xtra_garcia_lorca` — refused by clause 3, and again by clause 2, since
 *     the label is the whole of its own run;
 *   - **the run-in section label** — `xtra_alexandro`'s `Сочинения:` opens its
 *     paragraph after a `<br><br>` and is refused by clause 2; its reference
 *     writes it as plain text;
 *   - **a wrapper that changes only colour or size**, which clause 1 does not
 *     look at: `new_rules.md` assigns those their own treatments, and reading
 *     them here would claim a highlight the author asked to be something else.
 */
function isHighlightedRun(
  node: LadomNode,
  before: readonly PhrasingContent[],
  children: readonly PhrasingContent[],
): boolean {
  if (!isSetApartInline(node)) return false;
  if (phrasingText(children).trim() === "") return false;
  if (containsLinkOrImage(children)) return false;
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.tag === "a") return false;
  }
  return textSinceLastBreak(before).trim() !== "";
}

/** Visible text of a run since its last hard break — "already inside a sentence". */
function textSinceLastBreak(nodes: readonly PhrasingContent[]): string {
  const last = nodes.map((n) => n.type).lastIndexOf("break");
  return phrasingText(nodes.slice(last + 1));
}

function containsLinkOrImage(nodes: readonly PhrasingContent[]): boolean {
  return nodes.some(
    (node) =>
      node.type === "link" ||
      node.type === "image" ||
      ("children" in node && containsLinkOrImage(node.children as PhrasingContent[])),
  );
}

/**
 * Does this wrapper compute a typographic variant its prose context does not?
 *
 * Measured where measurement ran, and read off the declaration where it did
 * not — the same two-tier shape {@link isCentered} uses, and for the same
 * reason: a class in a `<style>` block is invisible to the attribute tier, and
 * a computed value is invisible without a browser.
 */
function isSetApartInline(node: LadomNode): boolean {
  if (node.kind !== "element") return false;
  const variant = (value: string | undefined): boolean => /small-caps/iu.test(value ?? "");
  const here = node.style ? variant(node.style.fontVariant) : variant(node.attrs["style"]);
  if (!here) return false;
  // Relational: a page that sets *everything* in small capitals distinguishes
  // nothing by it, so the enclosing prose must not share the variant.
  for (let cur = node.parent; cur; cur = cur.parent) {
    const outer = cur.style ? variant(cur.style.fontVariant) : variant(cur.attrs["style"]);
    if (outer) return false;
    if (BLOCK_TAGS.has(cur.tag)) break;
  }
  return true;
}

/** The inner node when a wrapper's only child already carries the same mark. */
function unwrapRedundant(children: PhrasingContent[], type: "strong" | "emphasis"): PhrasingContent | null {
  return children.length === 1 && children[0]?.type === type ? (children[0] as PhrasingContent) : null;
}

/**
 * A word boundary that lives inside a mark belongs outside it.
 *
 * `<i>Доменикони </i>Карло` puts the word-separating space **inside** the
 * italic. A browser renders `Доменикони Карло`; Markdown cannot, because `*x *`
 * is not emphasis, so the serializer drops the space and the two words fuse into
 * `*Доменикони*Карло`. That is a silent semantic corruption at full text recall:
 * a reader sees one nonsense token where the source has two words, and no later
 * gate can catch it, because nothing was removed — a space became no space.
 *
 * Hoisting is the lossless answer. The space moves out of the delimiters, the
 * mark keeps exactly the words it marked, and the output is valid Markdown.
 *
 * **Only across a word boundary**, and the corpus decides that, not taste. Where
 * the source spaces a mark boundary the references split cleanly on what stands
 * on the other side: **letter to letter they keep the space, 3 to 1** — and the
 * 1 is `xtra_karta5`, whose divergences are already recorded — while **against
 * punctuation they drop it, 27 to 1**. That matches the precedence
 * `BioMD-Reference.md` states: a space between two words is part of the content,
 * a space before a dash or a bracket is exact style, which ranks last. So
 * `TCHAIKOVSKY </i>- Nutcracker` stays tight and `Доменикони </i>Карло` does not.
 *
 * The mark is dropped entirely when it held nothing but whitespace — `<i> </i>`
 * marks no word, and `**` around nothing is not emphasis either.
 */
function pushMark(
  out: PhrasingContent[],
  children: PhrasingContent[],
  /** How to wrap the children, or `null` for a transparent wrapper that splices. */
  make: ((kids: PhrasingContent[]) => PhrasingContent) | null,
  nextChar: string,
): void {
  const lead = takeEdgeSpace(children, "start");
  const trail = takeEdgeSpace(children, "end");
  const inner = phrasingText(children);
  const before = lastVisibleChar(out);

  // The mark held nothing but whitespace. It marks no word — `**` around
  // nothing is not emphasis, and `<em>Comments:</em><em> </em>clarinet` used to
  // serialize as `*Comments:***clarinet`, opening a bold that never closes. But
  // that whitespace is the element's entire content and a browser renders it,
  // so unlike a space at the *edge* of a marked word it is not style and the
  // word-boundary question does not arise. Keep it; `collapseAdjacentText`
  // merges it away if a neighbour already supplies one.
  if (children.length === 0) {
    if (lead || trail) out.push({ type: "text", value: " " });
    return;
  }

  if (lead && isWordEdge(inner[0]) && isWordEdge(before)) {
    out.push({ type: "text", value: " " });
  }
  if (make) out.push(make(children));
  else out.push(...children);
  if (trail && isWordEdge(inner[inner.length - 1]) && isWordEdge(nextChar)) {
    out.push({ type: "text", value: " " });
  }
}

/** A letter or a digit — the two things a space can separate into two tokens. */
function isWordEdge(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** The last visible character emitted so far, for the leading-edge question. */
function lastVisibleChar(out: readonly PhrasingContent[]): string {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const text = phrasingText([out[i] as PhrasingContent]).replace(/\s+$/u, "");
    if (text !== "") return text[text.length - 1] as string;
  }
  return "";
}

/** Strip whitespace from one edge of a mark's children; true when there was any. */
function takeEdgeSpace(children: PhrasingContent[], edge: "start" | "end"): boolean {
  let found = false;
  for (;;) {
    const index = edge === "start" ? 0 : children.length - 1;
    const node = children[index];
    if (!node || node.type !== "text") return found;
    const stripped =
      edge === "start" ? node.value.replace(/^\s+/u, "") : node.value.replace(/\s+$/u, "");
    if (stripped === node.value) return found;
    found = true;
    if (stripped === "") {
      children.splice(index, 1);
      continue;
    }
    node.value = stripped;
    return true;
  }
}

function collapseAdjacentText(nodes: PhrasingContent[], keepEdgeSpace = false): PhrasingContent[] {
  const merged: PhrasingContent[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    // §11: "merge adjacent source anchors that form one visual label and share
    // one target". FrontPage split a single label across two `<a>` elements
    // whenever an inline tag interrupted it, and the result renders as two
    // links — `[1995](x)[-2002](x)` — the second of which duplicates the
    // destination and reads as a separate entry.
    if (node.type === "link" && last?.type === "link" && last.url === node.url) {
      last.children.push(...node.children);
      continue;
    }
    if (node.type === "text" && last?.type === "text") {
      // Re-collapse after the join: two runs that were each "one space" at their
      // own boundary become two spaces once concatenated, and source indentation
      // inside a flattened block turns into a visible gap.
      last.value = `${last.value}${node.value}`.replace(/[ \t]{2,}/gu, " ");
      continue;
    }
    merged.push(node);
  }

  // Whitespace sitting directly against a hard break is source indentation, not
  // content. Left in place it serializes as an escaped `&#x20;`, which is both
  // ugly and a spurious difference in any later diff.
  //
  // Trimming only *whitespace-only* nodes was not enough, and the gap was
  // expensive: a legacy track list is `<br>` followed by a newline and six
  // spaces of indentation *and then* the text, all in one node. That node is not
  // whitespace-only, so its leading run survived, and every single line of the
  // output began with a literal `&#x20;`.
  const cleaned: PhrasingContent[] = [];
  merged.forEach((node, index) => {
    if (node.type !== "text") {
      cleaned.push(node);
      return;
    }
    const before = merged[index - 1];
    const after = merged[index + 1];
    let value = node.value;
    if (before?.type === "break") value = value.replace(/^[ \t]*\n?[ \t]*/u, "");
    if (after?.type === "break") value = value.replace(/[ \t]*\n?[ \t]*$/u, "");
    if (value === "" && (before?.type === "break" || after?.type === "break")) return;
    cleaned.push({ ...node, value });
  });

  // Trim the run's outer whitespace without touching interior spacing.
  //
  // **Not for a run that sits inside a mark.** At the outer edge of a paragraph
  // or a cell this whitespace is layout and must go. One level down, inside
  // `<i>Доменикони </i>Карло`, the identical character is the space between two
  // words, and trimming it here is what fused them — `pushMark` never saw a
  // space to hoist. The caller knows which of the two it is; this cannot.
  if (!keepEdgeSpace) {
    const first = cleaned[0];
    if (first?.type === "text") first.value = first.value.replace(/^\s+/u, "");
    const final = cleaned[cleaned.length - 1];
    if (final?.type === "text") final.value = final.value.replace(/\s+$/u, "");
  }

  return cleaned.filter((n) => n.type !== "text" || n.value !== "");
}

/**
 * Drop breaks at the ends of a run, where they have nothing to separate.
 *
 * Deliberately *not* part of `collapseAdjacentText`: that runs on every nested
 * inline run too, and `<b>1989<br></b>` — a bold year heading its own line —
 * ends with a break that separates the label from the works below it. Trimming
 * it there hid the line boundary from the segmenter, and every such label was
 * absorbed into the following paragraph.
 */
function trimEdgeBreaks(nodes: PhrasingContent[]): PhrasingContent[] {
  const out = [...nodes];
  while (out[0]?.type === "break") out.shift();
  while (out[out.length - 1]?.type === "break") out.pop();
  return out;
}

/**
 * A standalone image.
 *
 * `position` and `size` come from measured geometry where available: a portrait
 * occupying a fifth of the content width is `medium`, a 40 px badge is `small`.
 * Without measurement they fall back to declared attributes, and the estimate
 * is recorded as such.
 */
function imageFrom(el: LadomNode, ctx: Ctx, standalone: boolean): BiomdContent | null {
  const src = el.attrs["src"] ?? "";
  if (src === "") {
    ctx.ledger.push(removed(el.id, "image without a source"));
    return null;
  }
  ctx.images.push(src);
  ctx.ledger.push(emitted(el.id, nextId(ctx, "image")));
  // The ledger keeps the source spelling so conservation still matches on it;
  // only the emitted target is resolved against the site layout.
  const href = siteRelativeAsset(src, ctx.options.links);

  // §7.1: this corpus's `alt` is the only source-backed comment there is, and
  // it is the visible label the author wrote under the picture. Copying it to
  // `caption` is explicitly permitted; keeping *both* would print the same
  // words twice in every renderer that falls back from one to the other.
  const caption = captionFor(el);
  const link = enclosingLink(el, ctx);

  if (!standalone) {
    return makeGroupedImage({ src: href, ...(caption ? { caption } : {}), ...(link ? { link } : {}) });
  }

  return makeImage({
    src: href,
    position: estimatePosition(el, ctx.proseAlign, ctx.grids),
    size: sizeTokenFor(imageWidthOf(el), ctx.contentWidth),
    ...(caption ? { caption } : {}),
    ...(link ? { link } : {}),
  });
}

/**
 * Every image an inline run actually shows, in order.
 *
 * Descends through wrappers that contribute no text of their own — a link
 * around a thumbnail, a `<font>` or `<center>` left over from FrontPage — so
 * that "is this run one picture?" is answered by what renders, not by which
 * element happens to be the run's direct child.
 */
const IMAGE_WRAPPERS = new Set(["a", "font", "span", "center", "b", "strong", "i", "em", "u", "nobr", "small", "big"]);

function runImages(nodes: readonly LadomNode[]): LadomNode[] {
  const out: LadomNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (node.tag === "img") {
      // A nav arrow is a control, not a picture, so a run containing one is not
      // a figure and two of them are not a plate. This has to be asked *here*
      // rather than in `dropDecorative`: that pass looks at the run's direct
      // children, this one descends through `<a>`, and an icon is always
      // wrapped in the link it operates. The two disagreeing is what shipped
      // five footers as `::: image src: ../main/back.gif` — a broken image
      // where the source drew an arrow, and the fifth containment-vs-filter
      // mismatch of this campaign (`learned-patterns.md`).
      if (!isUiIcon(node)) out.push(node);
      continue;
    }
    if (IMAGE_WRAPPERS.has(node.tag) && textOf(node).trim() === "") {
      out.push(...runImages(node.children));
    }
  }
  return out;
}

/**
 * Does the run hold a navigable target the figure would not carry?
 *
 * ## Rule contract
 *
 * **Invariant.** `otherContent` asks whether anything in the run has *text*, and
 * a link whose entire label is a control glyph has none: to `textOf`,
 * `<a href=x><img src=back.gif></a>` is empty. So a run that renders as
 * *arrow · marker · arrow* looks like a run holding one lone picture, the figure
 * branch claims it, and both destinations are deleted with the two `<a>`
 * elements — at 100 % text recall, because no text was involved. A target is
 * content: `BioMD-Reference.md`'s precedence reads *content > targets > reading
 * order*, above layout, and §16.3 is not engaged either way. So a target must be
 * counted like content. Nothing here consults a document, a class or an asset
 * name; it asks the run what would be lost.
 *
 * **False friend: the linked thumbnail.** `<a href=big><img src=thumb></a>` is
 * the most common standalone figure in this corpus, and its `<a>` is exactly
 * what `::: image`'s `link:` property is for. That target is not orphaned — the
 * `<a>` contains the image the figure will use — so the branch still fires and
 * `imageFrom` still reads the link off it. Only an `<a>` holding *none* of the
 * chosen images counts, which is why the test is containment and not "is there
 * an `<a>` in the run".
 *
 * **Recurrence does not apply**, and saying so is part of the contract: a lost
 * destination is a defect at the first occurrence. Cardinality is the evidence
 * here — one unaccounted-for target is enough.
 */
function hasOrphanTarget(nodes: readonly LadomNode[], kept: readonly LadomNode[], ctx: Ctx): boolean {
  if (nodes.length === 0) return false;
  const chosen = new Set(kept);
  const holdsChosen = (n: LadomNode): boolean =>
    chosen.has(n) || n.children.some((c) => holdsChosen(c));
  const scan = (n: LadomNode): boolean => {
    if (n.kind !== "element") return false;
    if (n.tag === "a" && rewriteTarget(n.attrs["href"] ?? "", ctx.options.links).href !== "" && !holdsChosen(n)) {
      return true;
    }
    return n.children.some((c) => scan(c));
  };
  return nodes.some((n) => scan(n));
}

/** `::: images` for a run that is nothing but adjacent pictures (§8). */
function imagesFrom(images: readonly LadomNode[], ctx: Ctx): BiomdContent | null {
  const children = [];
  for (const image of images) {
    const child = imageFrom(image, ctx, false);
    if (child && child.type === "biomdImage") children.push(child);
  }
  if (children.length < 2) return null;
  return makeImages({ columns: groupColumnsFor(children.length), children });
}

/**
 * Drop decorative furniture from an inline run.
 *
 * A link whose entire label was a nav arrow would be left with no label at
 * all, so it keeps its destination as its text — which is what the reference
 * conversions do, and what a reader can still click.
 */
function dropDecorative(nodes: readonly LadomNode[], ctx: Ctx): LadomNode[] {
  const out: LadomNode[] = [];
  for (const node of nodes) {
    if (node.kind === "element" && node.tag === "img" && isDecorative(node)) {
      ctx.ledger.push(removed(node.id, "decorative image (spacer, icon, rule or nav glyph)"));
      continue;
    }
    out.push(node);
  }
  return out;
}

function enclosingLink(el: LadomNode, ctx: Ctx): string | undefined {
  let cur = el.parent;
  while (cur) {
    if (cur.tag === "a") {
      const rewritten = rewriteTarget(cur.attrs["href"] ?? "", ctx.options.links);
      if (rewritten.href !== "") {
        ctx.targets.push(rewritten.href);
        return rewritten.href;
      }
      return undefined;
    }
    cur = cur.parent;
  }
  return undefined;
}



/**
 * Whether an image floats, from measurement or from the legacy attribute.
 *
 * `align="right"` on an `<img>` *is* a float in every browser; the attribute is
 * the only evidence available when the render pass has not run, which is the
 * common case for a batch conversion.
 */
function isFloated(el: LadomNode): boolean {
  return floatOf(el) !== null;
}

function floatOf(el: LadomNode): "left" | "right" | null {
  const measured = el.style?.float;
  if (measured === "left" || measured === "right") return measured;
  const attr = (el.attrs["align"] ?? "").toLowerCase();
  if (attr === "left" || attr === "right") return attr;
  const inline = /(?:^|;)\s*float\s*:\s*(left|right)/iu.exec(el.attrs["style"] ?? "");
  if (inline) return (inline[1] as string).toLowerCase() as "left" | "right";
  return null;
}

function estimatePosition(
  el: LadomNode,
  proseAlign: PhysicalAlign,
  grids: ReadonlyMap<string, TableGrid>,
): "left" | "right" | "center" | "full" {
  const float = floatOf(el);
  if (float) return float;

  // A standalone image occupies the horizontal position of the nearest
  // ancestor that actually positions it. Computed `text-align` is inherited,
  // so the image itself already carries a paragraph's explicit placement.
  // A floated ancestor is different: the whole figure participates in prose
  // flow, and its image must keep the ancestor's side rather than defaulting
  // back to centre.
  const aligned = foldTextAlign(el.style?.textAlign);
  if ((aligned === "right" || aligned === "center") && aligned !== proseAlign) return aligned;
  let ancestor = el.parent;
  while (ancestor) {
    const ancestorFloat = floatOf(ancestor);
    if (ancestorFloat) {
      // A source table can either float a figure beside prose or be a layout
      // grid whose cells happen to sit on the left. Only the one-cell figure
      // owns the image's position; carrying a multi-cell grid's float into its
      // children collapses every lane image to the page edge.
      if (ancestor.tag !== "table") return ancestorFloat;
      const grid = grids.get(ancestor.id);
      if (grid?.cols === 1 && grid.cells.some((cell) => cell.images > 0)) return ancestorFloat;
    }
    ancestor = ancestor.parent;
  }
  return "center";
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function tableFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
  ctx.tableDepth += 1;
  try {
    return tableRegionFrom(el, ctx);
  } finally {
    ctx.tableDepth -= 1;
  }
}

function tableRegionFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
  const grid = ctx.grids.get(el.id);
  if (!grid) {
    ctx.ledger.push(review(el.id, "table has no materialized grid"));
    return blocksFrom(el, ctx);
  }

  // Asked before the classifier, because a menu is neither a record matrix nor
  // a layout and both answers are wrong for it. See {@link navFromGrid}.
  const menu = navFromGrid(grid, ctx, el);
  if (menu) return menu;

  // Asked here for the same reason, and stated in `navFromGrid`'s own false
  // friends: "a figure table, image in one row and caption in the next".
  // See {@link stackedCaptionFigureFrom}.
  const stacked = stackedCaptionFigureFrom(grid, ctx);
  if (stacked) {
    ctx.tables.push({ tableId: el.id, classification: "LAYOUT", emittedTable: false, failure: "figure-caption" });
    ctx.ledger.push(review(el.id, "a column of its own holding one picture over one caption; bound as one figure"));
    return [stacked];
  }

  const classification = ctx.options.classifications?.get(el.id) ?? classifyTable(grid);

  switch (classification.class) {
    case "SHELL":
      ctx.ledger.push(removed(el.id, `page chrome (${classification.reason})`));
      ctx.tables.push({ tableId: el.id, classification: "SHELL", emittedTable: false });
      return [];

    case "DATA":
      return dataRegionFrom(grid, ctx, el, classification, /* requireEvidence */ false);

    case "UNKNOWN":
      // An inconclusive verdict is not the same as "not a table". If the region
      // nevertheless plans cleanly *and* carries its own header, the source
      // stated the column model explicitly and that outranks a thin score
      // margin. Everything else stays a review item, which is what the hook
      // layer exists to resolve.
      return dataRegionFrom(grid, ctx, el, classification, /* requireEvidence */ true);

    case "CATALOG":
    case "LAYOUT":
    case "HYBRID":
    default:
      return layoutFrom(grid, ctx, el, classification);
  }
}

/**
 * Whether the grid draws a gutter between two populated lanes.
 *
 * The evidence a 1998 page leaves when it sets two regions side by side: a
 * column that carries content in almost no row, sitting *between* two columns
 * that do. `laneColumnsOf` already separates the two — a lane carries content
 * in a substantial share of the content rows, a spacer in almost none — so this
 * asks only about their arrangement, and reads no width, class, colour or
 * entity. A record matrix never has one: its values are adjacent by
 * construction.
 */
function hasGutteredLanes(grid: TableGrid): boolean {
  const lanes = laneColumnsOf(grid);
  if (lanes.size < 2) return false;
  const columns = [...lanes].sort((a, b) => a - b);
  const first = columns[0] as number;
  const last = columns[columns.length - 1] as number;
  for (let c = first + 1; c < last; c += 1) {
    if (!lanes.has(c)) return true;
  }
  return false;
}

/** A menu label is a label, not a sentence — the same limit `navFrom` uses. */
const NAV_TABLE_LABEL_MAX_CHARS = 100;

/**
 * `::: nav` from a table that is a stack of links, or null.
 *
 * ## Rule contract
 *
 * **Invariant.** A grid one content-column wide whose rows each hold exactly
 * one link and nothing else — no second link, no picture, no words outside the
 * label — with an optional first row that has no link at all and titles the
 * stack. Containment (one link per cell), cardinality (one occupied column),
 * recurrence (the same row shape repeated) and ordering (the title first).
 * No class, colour, id, filename or label vocabulary is read.
 *
 * **Recurrence requirement.** Three linked rows minimum, matching `navFrom`.
 * Two rows are a figure over its caption, or a heading over its paragraph.
 *
 * **False friends**, each tested for non-firing:
 *   - a **discography or score grid**, where a row is a title *and* a TAB link
 *     — two occupied columns, so the width test rejects it;
 *   - a **figure table**, image in one row and caption in the next — the cells
 *     are not links;
 *   - a **link farm** paragraph, which is prose containing links rather than a
 *     row per link, and never reaches a grid at all.
 *
 * ## Why it belongs here and not in `navFrom`
 *
 * `navFrom` reads an *inline* run — links separated by `<br>` or punctuation
 * inside one paragraph. The other half of this era's menus are written as a
 * table with one row per item, which is the same construct expressed in the
 * only other way FrontPage offered, and it never reached that code. Routed as
 * a catalog instead, `williams2`'s discography menu came out as five separate
 * one-item regions with `---` between them: five rules, five stray labels, and
 * §11's "a prominent side menu normally moves directly below the title" lost
 * along with the menu. `CLAUDE.md` §5 already assumes right-hand menus fold
 * into the flow; this is the shape they arrive in.
 */
function navFromGrid(grid: TableGrid, ctx: Ctx, el: LadomNode): BiomdContent[] | null {
  // §4.1: a `frame` MUST NOT contain a `nav`, and §13 forbids an `align`
  // wrapping one. A `column` is neither — the side rail a menu arrives in *is*
  // a lane, so refusing every bounded context refused the only context this
  // construct ever occurs in. `layoutFrom` folds the resulting lane away.
  if (ctx.frameDepth > 0 || grid.rows < 3) return null;

  const rows: GridCell[][] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const occupied = rowCells(grid, r).filter((cell) => !cell.isEmpty);
    // One content column. A row that fills two is a record, not a menu item.
    if (occupied.length > 1) return null;
    if (occupied.length === 1) rows.push(occupied);
  }
  if (rows.length < 3) return null;

  const linked: LadomNode[] = [];
  /** The cell each item came from — its whole text is the item's label. */
  const cellNodes: LadomNode[] = [];
  let title: string | null = null;
  for (const [index, [cell]] of rows.entries()) {
    const only = cell as GridCell;
    if (only.images > 0) return null;
    const label = only.text.replace(/\s+/gu, " ").trim();
    if (label === "" || label.length > NAV_TABLE_LABEL_MAX_CHARS) return null;

    if (only.links === 0) {
      // §11: the label a page puts above its menu is that menu's title. Only
      // the first row may be one — an unlinked row in the middle is a section
      // break, and this construct has no way to express one.
      if (index !== 0 || title !== null) return null;
      title = label;
      continue;
    }
    const anchors = [...walkElements(only.node)].filter((node) => node.tag === "a");
    const anchor = anchors[0];
    if (anchors.length === 0 || !anchor) return null;
    // One destination, however many anchors reach it. FrontPage splits a label
    // across two `<a>` elements often enough that `williams2` writes its first
    // menu item as `<a>1995</a><a>-2002</a>`, both pointing at the same page.
    const href = anchor.attrs["href"] ?? "";
    if (anchors.some((node) => (node.attrs["href"] ?? "") !== href)) return null;
    // The cell must be the link and nothing else: `1995-2002` is an item,
    // `1995-2002 — см. также` is a sentence that happens to contain one.
    const linkText = anchors
      .map((node) => textOf(node))
      .join("")
      .replace(/\s+/gu, " ")
      .trim();
    if (linkText !== label) return null;
    linked.push(anchor);
    cellNodes.push(only.node);
  }
  if (linked.length < 3) return null;

  const targets: string[] = [];
  const seen = new Set<string>();
  for (const link of linked) {
    const rewritten = rewriteTarget(link.attrs["href"] ?? "", ctx.options.links);
    if (rewritten.kind === "unsafe" || rewritten.href === "") return null;
    // Repeated destinations mean the source was listing, not navigating, and
    // §11 makes duplicate labels invalid outright.
    if (seen.has(rewritten.href)) return null;
    seen.add(rewritten.href);
    targets.push(rewritten.href);
  }

  // One link per item, whatever the source split it into: the anchors' own
  // contents concatenate into the label, so `<a>1995</a><a>-2002</a>` becomes
  // `[1995-2002](…)` rather than two items or a link nested in a link.
  const items: ListItem[] = cellNodes.map((cell, index) => {
    const rawLabel = [...walkElements(cell)]
      .filter((node) => node.tag === "a")
      .flatMap((anchor) => inlineFrom(anchor.children, ctx));
    const label = oneLineLabel(rawLabel);
    return {
      type: "listItem",
      spread: false,
      children: [
        { type: "paragraph", children: [{ type: "link", url: targets[index] as string, children: label }] },
      ],
    };
  });

  for (let i = 0; i < linked.length; i += 1) {
    ctx.targets.push(targets[i] as string);
    ctx.ledger.push(emitted((linked[i] as LadomNode).id, nextId(ctx, "nav-item")));
    // The anchors folded into that one item are accounted for, not dropped.
    // They were required above to carry the identical destination, so the
    // target stays reachable and the label is the one the author drew; without
    // the record the conservation gate compares multisets and reports a target
    // this rule deliberately merged as lost (`williams1`, the corpus's last).
    for (const extra of [...walkElements(cellNodes[i] as LadomNode)].filter((node) => node.tag === "a")) {
      if (extra.id === (linked[i] as LadomNode).id) continue;
      ctx.ledger.push(removed(extra.id, "anchor merged into the item's one link — same destination"));
    }
  }
  ctx.ledger.push(emitted(el.id, nextId(ctx, "nav"), { note: `menu table, ${linked.length} item(s)` }));
  ctx.tables.push({ tableId: el.id, classification: "SHELL", emittedTable: false });

  return [
    makeNav({
      list: { type: "list", ordered: false, spread: false, children: items },
      ...(title !== null ? { title } : {}),
    }),
  ];
}

/**
 * Emit a region the classifier believes is (or might be) a record matrix.
 *
 * Speculative: the plan is built, the table is constructed, and if anything
 * fails the whole attempt is rolled back before the fallback runs. Without the
 * rollback the abandoned attempt's links survive in the conservation inventory.
 */
function dataRegionFrom(
  grid: TableGrid,
  ctx: Ctx,
  el: LadomNode,
  classification: Classification,
  requireEvidence: boolean,
): BiomdContent[] {
  const snapshot = begin(ctx);
  // `minRows` is a recurrence gate, and recurrence cannot be asked of a table
  // holding one record — see `isSingleRecordRow` for what stands in for it.
  const planned = planDataTable(grid, isSingleRecordRow(grid) ? { minRows: 1 } : {});

  const supplied = ctx.options.tableHeaders?.get(el.id);

  // On the abstention path the region has to carry its own evidence for being a
  // record matrix — a source header row, three-plus inferred columns, or a row
  // whose cells hold the roles a record holds. Supplied labels deliberately do
  // *not* count: a model will happily name the columns of a two-column news
  // list, and accepting that would let the label hook quietly promote every
  // ambiguous region into a table.
  //
  // The column count is a proxy and `occupiedBands` exposed it as one: dropping
  // `new_karta`'s two spacer columns took a 4-column table to 2 and the region
  // stopped qualifying, though nothing about it had changed. `isSingleRecordRow`
  // is the direct form of the same question — it tests what the cells *are*
  // rather than how many of them there were — so it belongs here beside the
  // count rather than downstream of it.
  const evidence =
    planned.plan !== null &&
    (!planned.plan.headerSynthesized || planned.plan.bands.length >= 3 || isSingleRecordRow(grid));

  // A title the source drew as a `colspan`-full first row is a caption for the
  // table, not a record in it. Lifted before the table is built, so the header
  // is synthesized from the record columns rather than from the title's row.
  // See {@link leadingCaptionCell} for the contract and its false friend.
  let caption: BiomdContent[] = [];
  if (planned.plan && planned.plan.header === null && planned.plan.body.length >= 3) {
    const cell = leadingCaptionCell(grid);
    const first = planned.plan.body[0];
    if (cell && first && first.row === cell.row) {
      const phrasing = plannedCellTo(first.cells[0] as PlannedCell, ctx);
      if (phrasing) {
        const paragraph: BiomdContent = { type: "paragraph", children: phrasing };
        ctx.positionedByConstruct.add(paragraph);
        caption = [paragraph];
        planned.plan.body = planned.plan.body.slice(1);
      }
    }
  }

  if (planned.plan && (!requireEvidence || evidence)) {
    const table = tableFromPlan(planned.plan, ctx, supplied);
    if (table) {
      const shape = { rows: planned.plan.body.length, cols: planned.plan.bands.length };
      ctx.ledger.push(
        emitted(el.id, nextId(ctx, "table"), {
          confidence: classification.confidence,
          note: planned.plan.reason,
        }),
      );
      if (planned.plan.headerSynthesized && supplied === undefined) {
        ctx.ledger.push(
          review(el.id, "table has no header row in the source; column labels need to be supplied (§3.8)"),
        );
      }
      ctx.tables.push({
        tableId: el.id,
        classification: classification.class,
        emittedTable: true,
        shape,
        ...(planned.plan.headerSynthesized && supplied === undefined ? { headerMissing: true } : {}),
      });
      return [...caption, table];
    }
  }

  rollback(ctx, snapshot);

  const failure = planned.failure ?? (requireEvidence ? "no-source-header" : "unrepresentable");
  const detail = planned.detail || "no source header row and the classifier abstained";

  if (classification.class === "DATA") {
    // A row of nothing but links is a pager, not an abandoned record matrix.
    // `segovia1`'s `◀ | Андрес Сеговия | Владимир Бобри | ▶` scores DATA on
    // grid regularity and per-column homogeneity — the same evidence a real
    // record row gives — but `planDataTable` can never plan it: it carries no
    // data to put in a body under a header, only navigation. `layoutFrom` is
    // the right next question, the same one the UNKNOWN branch below already
    // asks for an inconclusive verdict — asked first, so a pager is recorded
    // by what it becomes rather than by the record-matrix attempt it never
    // was. A title-bearing record row (`borislova`, `new_kolpakov`,
    // `new_karta`'s single-track tables) fails `isBareLinkRow` on its very
    // first cell and falls through to the DATA-abandonment path unchanged.
    if (isBareLinkRow(grid)) return layoutFrom(grid, ctx, el, classification);

    // A table abandoned *because one column is a media lane* has already been
    // told what it is. `planDataTable` refuses it on the stated ground that the
    // column is bare pictures — §16.1's "text beside a cover", a lane rather
    // than a column of values — and a lane is precisely what `layoutFrom`
    // builds. Flattening instead destroys the pairing that reason just named:
    // on `assad_b` the album title, its year and its cover stop being one
    // record and become a rule, a bold line, a `###` year and a loose figure.
    // The refusal names the remedy; taking flow anyway contradicts it.
    //
    // **This is not the general reconsideration §18.3 killed** and
    // `recovery.test.ts` refuses by name. That one fires on a record matrix
    // that would have been a table with one more row, where lanes lose a real
    // table; this one fires only where `planDataTable` has established that no
    // table exists to lose. The contract's fixture cannot reach it: the
    // media-lane test needs two populated cells in one column and the fixture
    // is one row, so it is refused earlier as `no-body`.
    //
    // **Two false friends, both measured, both named by
    // `pairsPictureWithMatter`.** A *gallery* has no worded lane to pair the
    // covers with — `goya2`'s reference writes the one `::: images` row the
    // flow path already builds, and lanes cost that document 20 findings. A
    // *resource matrix* carrying marks is a record list whose pictures are
    // ornament. Neither has the pairing this rule exists to keep.
    if (failure === "media-lane" && pairsPictureWithMatter(grid)) {
      ctx.ledger.push(
        review(el.id, `classified DATA but one column is a media lane (${detail}); reconsidered as a layout region`),
      );
      return layoutFrom(grid, ctx, el, classification);
    }

    if (failure === "too-small") {
      // A one-row grid can be neither a record matrix nor a recurring lane,
      // yet still state one exact relationship: a figure beside its visible
      // caption. The declared `<tr>` supplies the grouping; a second occurrence
      // cannot be required of a singular figure. Binding here is earlier and
      // safer than `decomposeFrom`: once flattened, the duplicate visible line
      // survives beside `alt` as an unrelated block.
      const figure = sideCaptionFigureFrom(grid, ctx);
      if (figure) {
        ctx.ledger.push(
          review(el.id, `classified DATA but the one-row grid is a figure beside its caption (${detail}); bound as one figure`),
        );
        ctx.tables.push({ tableId: el.id, classification: classification.class, emittedTable: false, failure: "figure-caption" });
        return [figure];
      }

      // **A gutter between two lanes is the author saying "side by side".**
      //
      // `planDataTable` refuses a one-row grid because a record matrix *is*
      // recurrence and one row cannot recur. That is a verdict on the table
      // reading and carries no information about lanes — but the general form
      // of the remedy is the one §18.3 killed, and `recovery.test.ts` refuses
      // it by name: a region the classifier really did type as records must
      // not be promoted to columns, because losing a table to lanes is worse
      // than losing a layout to flow.
      //
      // What separates the two is evidence the author left in the grid. A
      // record matrix puts its values in **adjacent** columns; nobody draws a
      // gutter between two columns of one record. A page that sets two regions
      // beside each other draws exactly that — an empty column between them —
      // and in this era it is the only way to draw it. So the reconsideration
      // is asked only of a grid with two populated lanes and a column that is
      // never populated *between* them.
      //
      // `xtra_garcia_lorca` proves both halves on one page. It sets three verse
      // grids in the same `[47% | gutter | 47%]` shape; two make the classifier
      // abstain and reach `layoutFrom` through the branch at the foot of this
      // function, becoming the `::: columns` the reference writes. The third
      // scores DATA outright, was refused `too-small`, and was flattened — two
      // poems run together into one lane, which L3 reported as six
      // `layout.overflow` findings. Same geometry, same page, opposite outcome.
      // The named false friends all lack the gutter: `jovicic`'s label lane
      // beside its cover, and §48's figure beside its caption, are adjacent
      // pairs and stay exactly where they were.
      if (hasGutteredLanes(grid)) {
        ctx.ledger.push(
          review(el.id, `classified DATA but too small to be a record matrix (${detail}); reconsidered as a layout region`),
        );
        return layoutFrom(grid, ctx, el, classification);
      }
    }
    // A DATA verdict that cannot be expressed as a table is a classification
    // finding, not a formatting detail: rows and columns are about to be lost.
    ctx.tables.push({ tableId: el.id, classification: classification.class, emittedTable: false, failure });
    ctx.ledger.push(
      review(el.id, `classified DATA but not representable as a table (${failure}: ${detail}); emitted as flow`),
    );
    ctx.warnings.push(`${el.id}: DATA table decomposed to linear flow — ${failure}: ${detail}.`);
    return decomposeFrom(grid, ctx, el);
  }

  // **Not a data table is not "not a region".**
  //
  // An inconclusive verdict used to fall straight to linear flow, which skipped
  // the lane path entirely — so a record card that is plainly two columns wide
  // was flattened without anyone ever asking whether it had lanes. `borislova`
  // and `jovicic` are both this: a 1×2 grid holding a text lane beside its
  // cover, classified UNKNOWN because it has no header row to plan from, and
  // the references give each of them `::: columns`.
  //
  // `layoutFrom` is the right next question and answers it on its own evidence;
  // it falls back to the same linear flow when the region has no lanes, so
  // nothing is forced. The abstention is still recorded — it is a real thing
  // that happened — but it no longer decides the shape.
  ctx.ledger.push(
    review(el.id, `classification inconclusive (${classification.reason}); reconsidered as a layout region`),
  );
  return layoutFrom(grid, ctx, el, classification);
}

/** Lower a planned semantic matrix to a GFM table, or null if a cell will not fit. */
function tableFromPlan(plan: LogicalTablePlan, ctx: Ctx, supplied?: readonly string[]): Table | null {
  const width = plan.bands.length;
  const header = plan.header
    ? plannedRowTo(plan.header, ctx)
    : supplied && supplied.length === width
      ? suppliedHeader(supplied)
      : synthesizeHeader(plan, ctx);
  if (!header) return null;

  const rows: TableRow[] = [header];
  for (const row of plan.body) {
    const node = plannedRowTo(row, ctx);
    if (!node) return null;
    rows.push(node);
  }

  return { type: "table", align: Array.from({ length: width }, () => null), children: rows };
}

function plannedRowTo(row: PlannedRow, ctx: Ctx): TableRow | null {
  const node: TableRow = { type: "tableRow", children: [] };
  for (const cell of row.cells) {
    const phrasing = plannedCellTo(cell, ctx);
    if (phrasing === null) return null;
    node.children.push({ type: "tableCell", children: phrasing });
    for (const source of cell.sources) ctx.ledger.push(emitted(source.id, nextId(ctx, "cell")));
  }
  return node;
}

/**
 * One semantic cell's phrasing.
 *
 * Several physical cells inside one band are joined in reading order with a
 * single space. A separator richer than a space would be invented punctuation,
 * which §16.3 classes as an editorial change.
 */
function plannedCellTo(cell: PlannedCell, ctx: Ctx): PhrasingContent[] | null {
  const nodes: LadomNode[] = [];
  for (const source of cell.sources) {
    const flat = flattenBlocks(source.node.children);
    if (flat.length === 0) continue;
    if (nodes.length > 0) nodes.push(spaceNode());
    nodes.push(...flat);
  }
  const phrasing = trimEdgeBreaks(inlineFrom(nodes, ctx));
  if (phrasing.some((p) => !isPhrasingType(p.type))) return null;
  // An intentionally empty value reads as an em dash (§3.8) rather than a hole.
  if (phrasing.length === 0) return [{ type: "text", value: "—" }];
  return phrasing;
}

const PHRASING_TYPES = new Set([
  "text", "emphasis", "strong", "delete", "inlineCode", "break", "link", "image",
  "linkReference", "imageReference", "footnoteReference", "html",
]);

function isPhrasingType(type: string): boolean {
  return PHRASING_TYPES.has(type);
}

/** Column labels resolved by a hook. Plain text only — a label is not markup. */
function suppliedHeader(labels: readonly string[]): TableRow {
  return {
    type: "tableRow",
    children: labels.map((label) => ({
      type: "tableCell" as const,
      children: [{ type: "text" as const, value: label.replace(/\s+/gu, " ").trim() }],
    })),
  };
}

/**
 * Column labels for a table the source never gave a header.
 *
 * A column whose populated cells are links is headed `LINK_GLYPH` — "this holds
 * a link", with no claim about to what. Every other unnamed column is left
 * empty, which the validator reports and the ledger records as a review item.
 * A label is otherwise only ever *transcribed*: it is used when it is the
 * dominant repeated text of that column, and inventing one is an editorial
 * change (§16.3). The `table.records` hook resolves the rest when a model is
 * available.
 *
 * **The glyph outranks a transcribed label, and the leading column is not
 * named.** `analyze/analyze-2.md` states the rule directly, twice: *"любой
 * столбец где есть какие-то ссылки … просто именовать так: `&#128279;`"*, with
 * the reason — *"что бы не включать эвристику и не определять"*. Guessing what
 * a mixed column holds was producing `MIDI` over a column containing `WMA`.
 * A dominant `TAB` down a column of tablature links is that same guess reached
 * by transcription: the format is already visible in every cell, so heading the
 * column with it names the column after one of its own values.
 *
 * **This reverses PROGRESS §30.2, on the newer ruling from the same author.**
 * That change replaced the glyph with a house vocabulary (`Название`,
 * `Аудиоформат`) because `06eeafb` had rewritten sixteen references that way and
 * `/new_rules.md` stated it. `c92c009` rewrote them back: **16 of the corpus's
 * 21 synthesized headers now read `| | 🔗 | 🔗 |`**, across 8 documents, and the
 * five that do not are in three files the revision left untouched. The
 * vocabulary survives in `column-labels.ts` for a transcribed non-link label,
 * which is the one case neither ruling disputes.
 *
 * **An all-empty header is the same answer repeated, not a different one.** It
 * used to abort the table, and aborting cost the whole matrix: `new_dyens`'s
 * five score records and `new_karta`'s catalogue fell to linear flow, where
 * every cell became its own aligned paragraph and three work titles were read
 * as quotations (the false friend PROGRESS §16.4 traced to exactly this).
 * `BioMD-Reference.md`'s precedence ladder puts reading order and grouping far
 * above visible distinction, and §1 says to prefer a table while the source
 * rows and columns remain intelligible — a blank header row loses a label, a
 * flattened matrix loses the records. The review item and the `headerMissing`
 * flag still carry the missing labels to whoever can supply them.
 */
function synthesizeHeader(plan: LogicalTablePlan, ctx: Ctx): TableRow | null {
  const row: TableRow = { type: "tableRow", children: [] };
  let unlabelled = 0;
  for (let band = 0; band < plan.bands.length; band += 1) {
    const column = plan.body.map((r) => r.cells[band] as PlannedCell);
    if (isLinkColumn(column)) {
      row.children.push({ type: "tableCell", children: [{ type: "text", value: LINK_GLYPH }] });
      continue;
    }
    const label = dominantLabel(column);
    if (label) {
      // A transcribed label still goes through the house vocabulary, which folds
      // synonyms onto one spelling. Unlisted labels pass through untouched.
      const value = canonicalColumnLabel(label) ?? label;
      row.children.push({ type: "tableCell", children: [{ type: "text", value }] });
      continue;
    }
    unlabelled += 1;
    row.children.push({ type: "tableCell", children: [] });
  }
  if (unlabelled > 0) {
    ctx.warnings.push(`${unlabelled} column(s) have neither a source header nor a recurring label`);
  }
  return row;
}

/**
 * Whether a column holds links and nothing else worth calling it by.
 *
 * **Invariant.** Every cell that has anything in it is an anchor with a label
 * short enough to *be* a label — cardinality (one or more links), containment
 * (the link is the cell, not a phrase inside it) and homogeneity down the
 * column. No filename, no href pattern, no vocabulary of format names: `TAB`,
 * `MIDI`, `ZIP`, `GIF-1` and `Часть 1 — PDF` all qualify on the same evidence.
 *
 * **Recurrence does not apply, and asking for it was masking a defect.** The
 * homogeneity test is already exhaustive — *every* populated cell must be a
 * short anchor, so a single-link column is one whose other cells are empty, not
 * one with a stray link in prose. Requiring a second linked cell therefore
 * excluded nothing the length limit had not already excluded, while silently
 * un-naming any column a sparse table populates once. Swept over the corpus:
 * at `2` four columns in two documents lose their header and no column gains a
 * wrong one; at `1` they are named and nothing else moves. Flat, not a cliff,
 * so the constant was a limit on the wrong axis rather than the mechanism.
 *
 * **False friend.** A prose column that happens to contain a link — a sentence
 * with a reference in it. The label-length limit is what separates them, and it
 * is the same limit `contentKind` and `navFromGrid` already use for the same
 * question.
 */
function isLinkColumn(column: readonly PlannedCell[]): boolean {
  let linked = 0;
  for (const cell of column) {
    if (cell.isEmpty) continue;
    const links = cell.sources.reduce((a, s) => a + s.links, 0);
    if (links < 1 || cellText(cell).length >= LINK_LABEL_MAX_CHARS) return false;
    linked += 1;
  }
  return linked >= 1;
}

/** A link label is a label, not a sentence — `contentKind`'s limit, shared. */
const LINK_LABEL_MAX_CHARS = 40;

/**
 * Whether a grid sets a lane of bare pictures *beside* a lane of matter.
 *
 * This is §16.1's "text beside a cover" asked of the grid, and it is the whole
 * of the evidence: three kinds of column, told apart by what a cell holds and
 * nothing else.
 *
 *   - a **picture lane** — the cell is a picture and carries no words, at the
 *     same share `planDataTable` used to refuse the table, so the routing asks
 *     that rule's own question rather than a similar-looking one;
 *   - a **resource column** — every cell is one short link and nothing else,
 *     which is exactly what the tier-1 DATA gate reads to type a resource
 *     matrix (`MP3 | MIDI | TAB` beside a strip of 16 px marks is a record list
 *     whose pictures are ornament);
 *   - **matter** — anything else carrying words: a title, a year, a track list,
 *     which is what makes the picture beside it a picture *of* something.
 *
 * Both halves are required, and requiring the second is what keeps a *gallery*
 * out: a grid whose every column is bare covers has nothing to pair them with,
 * and one flattened all-picture row is one `::: images` (§31.2), which the flow
 * path already builds and which `goya2`'s reference writes.
 *
 * Relational and unitless throughout — cardinality of images and links per
 * cell, and the label limit every other link rule here shares. No size, no
 * filename, no class, no vocabulary.
 *
 * **Recurrence** is required of both lanes — two populated cells each — because
 * one picture beside one line is a figure over its caption, which `media.ts`
 * binds far better than any lane.
 */
function pairsPictureWithMatter(grid: TableGrid): boolean {
  let pictureLane = false;
  let matterLane = false;
  for (let col = 0; col < grid.cols; col += 1) {
    const cells = columnCells(grid, col).filter((cell) => !cell.isEmpty);
    if (cells.length < 2) continue;
    const bare = cells.filter((cell) => cell.images > 0 && cell.text.trim().length < 3).length;
    if (bare / cells.length >= MEDIA_LANE_SHARE) {
      pictureLane = true;
      continue;
    }
    const labels = cells.filter(
      (cell) => cell.links === 1 && cell.images === 0 && cell.text.trim().length <= LINK_LABEL_MAX_CHARS,
    ).length;
    if (labels === cells.length) continue;
    if (cells.some((cell) => cell.images === 0 && cell.text.trim().length >= 3)) matterLane = true;
  }
  return pictureLane && matterLane;
}

/**
 * One standalone figure above its visible caption, in a column of its own.
 *
 * ## Rule contract — the figure box this era drew with a table
 *
 * **Invariant.** A grid whose occupied cells all sit in **one** column and fill
 * exactly **two** rows: the earlier lowering to exactly one standalone image
 * and nothing else, the later to short, link-free, picture-free text that the
 * author set apart typographically — centred, or smaller than the page's body
 * prose. Containment, cardinality, column occupancy and source order carry the
 * whole relationship; no class, id, width, filename or vocabulary is read.
 *
 * **Why the typography and not `alt`.** §48's side-by-side sibling requires the
 * visible line to restate the image's `alt`, because there the two cells are
 * peers and only the wording says which is the caption. Here the author has
 * already said it, by putting a picture and one short line alone in a column
 * and stacking them — and the corpus's stacked figure boxes routinely carry no
 * `alt` at all, so requiring one would refuse every true positive. What takes
 * its place is the author's own typographic distinction, read with the same
 * {@link isCaptionContext} test the inline path uses. It has to be read off the
 * source here: a cell's blocks are flattened before lowering, so the paragraph
 * never passes through the descent that sets `captionEligible`.
 *
 * **Recurrence does not apply, and saying so is part of the contract** — a
 * figure box holds one figure by construction, the same standing as
 * {@link sideCaptionFigureFrom} and {@link isUiIcon}. What replaces it is that
 * the test is closed on both sides: one column, two rows, and *nothing else in
 * the table*, so there is no third thing for a wrong reading to swallow.
 *
 * **False friends**, each excluded by a different clause and tested for
 * non-firing:
 *   - **a section label over its list** — `segovia`'s `ДИСКОГРАФИЯ` is not in a
 *     table with the picture at all, and a labelled list is not one image;
 *   - **a prose paragraph that merely follows a picture** — body prose is
 *     neither centred nor set smaller, so {@link isCaptionContext} refuses it;
 *   - **a menu under a banner** — the caption cell may hold no link;
 *   - **a two-picture stack** — the caption row may hold no image;
 *   - **a stack of three or more rows** — that is a region, not a figure;
 *   - **a record row beside a cover** — two occupied columns, not one.
 */
function stackedCaptionFigureFrom(grid: TableGrid, ctx: Ctx): BiomdContent | null {
  const occupied = grid.cells.filter((cell) => !cell.isEmpty);
  if (occupied.length !== 2) return null;
  const columns = new Set(occupied.map((cell) => cell.col));
  if (columns.size !== 1) return null;

  const [above, below] = [...occupied].sort((a, b) => a.row - b.row) as [GridCell, GridCell];
  if (above.row === below.row) return null;
  if (below.links > 0 || below.images > 0 || above.links > 0) return null;

  const snapshot = begin(ctx);
  const figureBlocks = framedCell(above.node, ctx);
  const figure = figureBlocks[0];
  if (figureBlocks.length !== 1 || figure?.type !== "biomdImage" || !figure.standalone) {
    rollback(ctx, snapshot);
    return null;
  }

  const captionBlocks = framedCell(below.node, ctx);
  const caption = stackedCaptionText(captionBlocks, below, ctx);
  if (caption === "") {
    rollback(ctx, snapshot);
    return null;
  }

  ctx.ledger.push(mergedInto(below.id, nextId(ctx, "image-caption")));
  return { ...figure, caption };
}

/**
 * The caption text a stacked figure box accepts, or `""`.
 *
 * Line structure is read the same way the inline caption path reads it, so a
 * `<br>`-broken label collapses to one line exactly as it does there.
 */
function stackedCaptionText(blocks: readonly BiomdContent[], cell: GridCell, ctx: Ctx): string {
  if (blocks.length === 0) return "";
  if (!blocks.every((block) => block.type === "paragraph" || block.type === "heading")) return "";
  const text = captionTextOf(blocks as CaptionBlock[]);
  if (text === "" || text.length > 300) return "";
  // The author's own typographic distinction is the evidence that this line is
  // a caption and not the next paragraph of the article.
  return [...walkElements(cell.node)].some((node) => isCaptionContext(node, ctx)) ? text : "";
}

/**
 * One standalone figure beside its visible caption in a single declared row.
 *
 * This is deliberately narrower than a generic DATA→layout fallback. One cell
 * must lower to exactly one standalone image; exactly one other occupied cell
 * must lower to short, link-free text that substantially repeats the image's
 * source-backed label; nothing else may survive. A prose lane, a resource
 * record and two caption-like labels each fail a different part of that test.
 */
function sideCaptionFigureFrom(grid: TableGrid, ctx: Ctx): BiomdContent | null {
  if (grid.rows - trailingEmptyRows(grid).size !== 1) return null;
  const cells = rowCells(grid, 0).filter((cell) => !cell.isEmpty);
  if (cells.length !== 2) return null;

  const snapshot = begin(ctx);
  const lowered = cells.map((cell) => framedCell(cell.node, ctx));
  const figureIndex = lowered.findIndex(
    (blocks) => blocks.length === 1 && blocks[0]?.type === "biomdImage" && blocks[0].standalone,
  );
  if (figureIndex < 0) {
    rollback(ctx, snapshot);
    return null;
  }

  const captionIndex = figureIndex === 0 ? 1 : 0;
  const figure = lowered[figureIndex]?.[0];
  const captionBlocks = lowered[captionIndex] ?? [];
  const caption = sideCaptionText(captionBlocks, cells[captionIndex], cells[figureIndex], ctx);
  if (!figure || figure.type !== "biomdImage" || caption === "") {
    rollback(ctx, snapshot);
    return null;
  }

  const captionSource = cells[captionIndex];
  if (captionSource) ctx.ledger.push(mergedInto(captionSource.id, nextId(ctx, "image-caption")));
  return { ...figure, caption };
}

/** Caption text accepted by the side-by-side figure relation. */
function sideCaptionText(
  blocks: readonly BiomdContent[],
  captionCell: GridCell | undefined,
  imageCell: GridCell | undefined,
  ctx: Ctx,
): string {
  if (!captionCell || !imageCell || captionCell.links > 0 || captionCell.images > 0 || blocks.length === 0) return "";
  const text = blocks.map(blockTextOf).join(" ").replace(/\s+/gu, " ").trim();
  if (text === "" || text.length > 300) return "";

  const images = [...walkElements(imageCell.node)].filter((node) => node.tag === "img");
  if (images.length !== 1) return "";
  const sourceLabel = captionFor(images[0] as LadomNode);
  if (!sourceLabel) return "";
  // Captions may insert relation words and punctuation into the image's `alt`.
  // Require substantial source-label coverage in order, not literal equality.
  if (!relationTextMatches(sourceLabel, text)) return "";

  const candidates = blocks.every((block) => isCaptionCandidate(block, ctx));
  const boundedText = blocks.every((block) => block.type === "paragraph" || block.type === "heading");
  return candidates || boundedText ? text : "";
}
function relationTextMatches(sourceLabel: string, visible: string): boolean {
  const sourceWords = normalizedRelationText(sourceLabel).split(" ").filter(Boolean);
  const visibleWords = normalizedRelationText(visible).split(" ").filter(Boolean);
  if (sourceWords.length < 2 || visibleWords.length < 2) return false;
  const forward = orderedWordCoverage(sourceWords, visibleWords) / sourceWords.length;
  const reverse = orderedWordCoverage(visibleWords, sourceWords) / visibleWords.length;
  return Math.max(forward, reverse) >= 0.7;
}
function normalizedRelationText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function orderedWordCoverage(source: readonly string[], visible: readonly string[]): number {
  let at = 0;
  for (const word of visible) if (word === source[at]) at += 1;
  return at;
}

/** The text that at least 60% of a column's non-empty cells repeat verbatim. */
function dominantLabel(cells: readonly PlannedCell[]): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const cell of cells) {
    const text = cellText(cell).trim();
    if (text === "" || text.length > 24) continue;
    total += 1;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .find(([, count]) => total >= 3 && count / total >= 0.6)?.[0] ?? null;
}

/**
 * Flatten block wrappers inside a cell into an inline node sequence.
 *
 * `<p>`, `<div>`, a one-item `<ul>` used as a bullet glyph and the rest of the
 * FrontPage repertoire are typography. Removing them is what lets a cell whose
 * markup looks block-shaped be represented inline without losing a link, an
 * image or the order of either.
 */
const FLATTENABLE = new Set([
  "p", "div", "center", "ul", "ol", "li", "blockquote", "dl", "dt", "dd", "section", "article",
]);

export function flattenBlocks(nodes: readonly LadomNode[]): LadomNode[] {
  const out: LadomNode[] = [];
  for (const node of nodes) {
    if (node.kind === "element" && FLATTENABLE.has(node.tag)) {
      const inner = flattenBlocks(node.children);
      if (inner.length === 0) continue;
      if (out.length > 0) out.push(spaceNode());
      out.push(...inner);
      continue;
    }
    out.push(node);
  }
  return out;
}

let syntheticCounter = 0;

function spaceNode(): LadomNode {
  syntheticCounter += 1;
  return {
    id: `#synthetic-space[${syntheticCounter}]`,
    kind: "text",
    tag: "",
    attrs: {},
    value: " ",
    src: null,
    synthetic: true,
    metrics: { textLen: 0, links: 0, images: 0, depth: 0 },
    parent: null,
    children: [],
  };
}

/**
 * A single-row table where every occupied cell is exactly one link — a pager:
 * `◀ | Андрес Сеговия | Владимир Бобри | ▶`, the previous/current/next strip
 * this era draws as a table row rather than as inline text.
 *
 * ## Rule contract
 *
 * **Invariant.** Whole-cell equality between the cell's own text and its one
 * anchor's text — the cell must be the link and nothing else. This mirrors
 * {@link navFromGrid}'s "the cell must be the link and nothing else" test,
 * oriented as a row instead of a column stack; an icon-only cell (no text on
 * either side of the comparison) passes the same way an icon-only nav item
 * would, which is why it is not also required here as `navFromGrid` requires
 * of its own linked items.
 *
 * **False friend, tested for non-firing:** a single-row resource record —
 * title beside a format link (`borislova`'s `"Estrelluvio" … | WMA`,
 * `new_kolpakov`'s `Венгерка | WMA | (1,7 Mb)`, `new_karta`'s single-track
 * tables). The title cell holds prose and carries no link at all, so it fails
 * `links === 1` on its first cell and the row is never mistaken for a pager.
 *
 * **Recurrence.** Not required: a page draws exactly one previous/next strip,
 * so the shape occurs once per page by construction (`CLAUDE.md` §5's stated
 * exemption for a construct that cannot repeat within a document). The
 * per-cell containment test carries the whole burden of proof instead.
 */
function isBareLinkRow(grid: TableGrid): boolean {
  if (grid.rows !== 1) return false;
  const cells = rowCells(grid, 0).filter((cell) => !cell.isEmpty);
  if (cells.length === 0) return false;
  return cells.every((cell) => {
    if (cell.links !== 1) return false;
    const anchors = [...walkElements(cell.node)].filter((node) => node.tag === "a");
    const anchor = anchors[0];
    if (anchors.length !== 1 || !anchor) return false;
    const linkText = textOf(anchor).replace(/\s+/gu, " ").trim();
    const cellText = cell.text.replace(/\s+/gu, " ").trim();
    return linkText === cellText;
  });
}

/**
 * A single-row table that holds one record: a title beside its resources.
 *
 * `planDataTable`'s `minRows: 2` is a recurrence gate — "a record matrix has at
 * least two records" — and it is the one thing standing between these rows and
 * a table. The classifier has already said DATA on its own evidence; the
 * planner then refuses the grid as `too-small` and the row falls to
 * `decomposeFrom`, where each cell becomes a separate block. That does not
 * produce a different *representation* of the record, it destroys it: on
 * `new_kolpakov` the title `Венгерка` is absorbed into the preceding
 * paragraph's `::: align`, `[WMA]` becomes its own centred `::: align` and
 * `(1,7 Mb)` a third. The title↔resource relation is gone, and the title is
 * attached to a block it has nothing to do with.
 *
 * ## Rule contract
 *
 * **Invariant.** Role by position, containment, and cardinality — no width, no
 * class, no filename, no format vocabulary. The first occupied cell indexes the
 * record, so it must be text carrying neither a link nor a picture; some later
 * cell must be a resource control, meaning a link whose whole cell is short
 * enough to be a label. This is exactly {@link isBareLinkRow} inverted, which
 * is the acceptance check this mechanism was predicted to need.
 *
 * **Recurrence cannot apply**, and requiring it is what caused the defect: a
 * one-record table has one row by definition, so a second-row requirement asks
 * the construct not to exist. Same exemption `isBareLinkRow` takes, for the
 * same reason (`CLAUDE.md` §5). The per-cell role test carries the proof.
 *
 * **False friends, tested for non-firing.** A pager row — every cell is a link,
 * so the leading cell fails immediately, and `isBareLinkRow` claims it first
 * anyway. A layout scaffold of a text lane beside its cover — the second cell
 * holds a picture, not a label-length link, which is what keeps `borislova`'s
 * and `jovicic`'s 1×2 text+cover regions on the `::: columns` path the
 * references want. A prose row with a reference inside the sentence — the link
 * is not the cell, and the cell is far longer than a label.
 *
 * **The evidence that this is one defect and not a choice between two
 * representations.** All four instances classify DATA and fail identically
 * (`too-small: 1×2 is below the minimum`), including `williams2`, which was
 * previously read as the counterexample that made the question undecidable.
 * Its reference writes the shattered form — two sibling `::: align` blocks and
 * a stray `**` from an unbalanced emphasis — while `analyze/analyze.md` item 9
 * asks for the text *and* the MP3 link inside **one** block. The reference
 * transcribes the break rather than ruling on it, so there was never a 2-2
 * split; every piece of human evidence in the corpus wants the record kept
 * whole. `analyze/analyze-2.md` then states it outright for `new_karta`:
 * *"почему-то конвертор ломается именно на таблицах состоящих из одной
 * записи: one row"*.
 */
function isSingleRecordRow(grid: TableGrid): boolean {
  // Counted in content rows: `new_karta` closes each composer's table with a
  // `&nbsp;` row, and a record followed by bottom margin is still one record.
  if (grid.rows - trailingEmptyRows(grid).size !== 1) return false;
  const cells = rowCells(grid, 0).filter((cell) => !cell.isEmpty);
  const index = cells[0];
  if (cells.length < 2 || !index) return false;
  if (index.links > 0 || index.images > 0 || index.text.trim() === "") return false;
  return cells
    .slice(1)
    .some((cell) => cell.links >= 1 && cell.images === 0 && cell.text.trim().length < LINK_LABEL_MAX_CHARS);
}

/**
 * The grid's rows grouped into bands a `rowspan` holds together.
 *
 * ## Rule contract
 *
 * **Invariant.** `rowspan` and nothing else. A cell declaring `rowspan="n"` at
 * row `r` occupies rows `r … r+n-1`, so those rows cannot be laid out
 * independently: the rows below have no cell of their own in that lane, and a
 * browser stacks whatever they *do* carry underneath the content already in
 * the neighbouring lane. Emitting them as separate regions asserts a division
 * the source does not draw. No document, class, width or content is consulted.
 *
 * **Recurrence.** Not applicable and deliberately not required: a span is a
 * declared fact about two specific rows, not a pattern to be corroborated.
 * Where no cell spans, every band is one row and this is the identity function
 * — which is the corpus-wide state of all 22 documents but `goya2`.
 *
 * **False friend, tested for non-firing:** two ordinary rows that merely *look*
 * paired — a title row above a track row, `goya2`'s own commonest shape. Their
 * cells each occupy one row, so nothing joins them and the two regions stay
 * separate with the `---` the row boundary earns.
 *
 * The reading is `analyze-2.md`'s, on "Moscow Nights", and it was confirmed in
 * the browser rather than argued: the `rowspan="2"` track list renders 325 px
 * tall at x=383, and the two 162 px covers render at x=634, y and y+162 — one
 * text lane beside one lane of stacked pictures.
 */
export function rowBandsOf(grid: TableGrid): Array<{ start: number; end: number }> {
  const bands: Array<{ start: number; end: number }> = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const open = bands[bands.length - 1];
    const band = open && r <= open.end ? open : (bands.push({ start: r, end: r }), bands[bands.length - 1]!);
    for (let c = 0; c < grid.cols; c += 1) {
      const slot = grid.slots[r]?.[c];
      if (!slot?.isOrigin) continue;
      const cell = grid.cells.find((x) => x.id === slot.originId);
      if (!cell) continue;
      band.end = Math.min(grid.rows - 1, Math.max(band.end, r + cell.rowSpan - 1));
    }
  }
  return bands;
}

/**
 * Whether a laned row is an *entry* rather than a *record*.
 *
 * A `---` between laned rows says "one thing ended here and the next began",
 * and that claim is only worth making about rows that are things. Two shapes
 * earn it, and the corpus states both:
 *
 *   an album card — a title, a track list, a cover — is compound, and without a
 *   rule between them one album's tracks read as the next album's;
 *   a diary entry — `11 декабря 2007 г.` beside what was published that day —
 *   is labelled, and the label is what the rule divides.
 *
 * A concert programme is neither. Every lane of every row holds one short line
 * — a composer beside the piece he wrote — and the row boundary is the grid's
 * own, drawn tight and unremarkable. Ruling between them takes a table the
 * source renders in a screenful and spreads it down the page, which is a claim
 * about structure the author never made and a layout worse than the source's.
 *
 * Judged over the whole region, not per row: a catalog stays a catalog on the
 * one row whose cover art is missing, and `goya2` has such a row.
 */
function isEntryRow(columns: readonly BiomdColumn[]): boolean {
  return columns.some((column) =>
    column.children.length > 1
      ? true
      : column.children.some(
          (block) => block.type !== "paragraph" || isDateLabel(phrasingText(block.children as PhrasingContent[])),
        ),
  );
}

/**
 * A layout or catalog region.
 *
 * Under `simplified` this flattens to linear reading order. `columns` is
 * emitted only under `faithful`, and only for a genuine lane structure —
 * never to imitate a width. Capped at three lanes, except a bare-link pager
 * row ({@link isBareLinkRow}), which `BioMD-Reference.md` §3's `columns:
 * 2|3|4` and `segovia1`'s `◀ | name | name | ▶` footer both attest up to
 * four.
 */
function layoutFrom(
  grid: TableGrid,
  ctx: Ctx,
  el: LadomNode,
  classification: Classification,
): BiomdContent[] {
  const pager = isBareLinkRow(grid);
  const maxLanes = pager ? 4 : 3;
  if (ctx.options.layoutFidelity === "faithful" && grid.cols >= 2 && grid.cols <= maxLanes && grid.rows >= 1) {
    // Speculative, so it has to be undoable. A lane attempt that turns out not
    // to produce two usable columns still walked every cell, and its links,
    // images and ledger entries stayed behind — the conservation gate then
    // reported the whole region's targets twice as "unexpected".
    const snapshot = begin(ctx);
    const regions: BiomdContent[] = [];
    let lanedRows = 0;
    /** Where in `regions` a row-boundary `---` was drawn, so it can be undrawn. */
    const derivedRuleAt: number[] = [];
    /** How many laned rows carry an entry rather than a record. */
    let entryRows = 0;

    // One region per **row**, not one region spanning the table.
    //
    // A multi-row layout grid pairs its cells horizontally: row 4 column 1 is
    // the album title whose cover is row 4 column 2. Concatenating each grid
    // column into a single lane preserves the two-lane *look* and destroys
    // every one of those pairings — on `goya2` it turned 34 catalog rows into
    // two 34-entry lanes, so the first album's title sat 33 entries above its
    // own cover. `CLAUDE.md` §5 names the fix as legitimate: splitting a
    // multi-column region into several small regions to preserve the pairing is
    // the intended reading, and the references do exactly that (34 `::: columns`
    // on `goya2`, one per row).
    //
    // With `rows === 1` this is identical to the column-wise construction, so a
    // genuine two-lane page layout — article beside sidebar — is unaffected.
    //
    // **Lowering happens first, and lane occupancy is read off its result.**
    // The two used to disagree: occupancy came from the source grid while the
    // region was assembled from the lowered blocks, so a cell whose entire
    // content leaves the lane — a side menu, which is folded out below —
    // counted as an occupied lane and then contributed an empty `::: column`.
    // On the site's own page frame (`[margin | article | rail]`, measured
    // identical on all 22 documents) that phantom lane was the *second* column
    // that kept the region alive, and the whole article ended up inside a
    // two-lane layout whose other lane held nothing. See {@link laneColumnsOf}.
    // `null` where the row has no cell of its own at that column — a colspan
    // continuation or a ragged row. That is not an empty lane: an empty lane
    // holds a place in the region, a missing cell has no place to hold.
    type LoweredCell = { blocks: BoundedContent[]; folded: BiomdContent[] } | null;
    const loweredRows: LoweredCell[][] = [];
    for (let r = 0; r < grid.rows; r += 1) {
      const row: LoweredCell[] = [];
      for (let c = 0; c < grid.cols; c += 1) {
        const slot = grid.slots[r]?.[c];
        const cell = slot?.isOrigin ? grid.cells.find((x) => x.id === slot.originId) : undefined;
        if (!cell) {
          row.push(null);
          continue;
        }
        ctx.boundedDepth += 1;
        // `framedCell`, not `blocksFrom`: a bordered notice is a notice in
        // whichever path reaches it, and only the catalog path was asking. So
        // `news_2007`'s festival announcement — the same 1998 idiom as `news`'s
        // obituaries, but sitting in a layout grid rather than an entry list —
        // came out as loose prose while the obituaries came out framed. It
        // falls back to `blocksFrom` when there is no border evidence.
        const inner = framedCell(cell.node, ctx);
        ctx.boundedDepth -= 1;
        /**
         * A lane that is nothing but a menu is not a lane.
         *
         * §11 and `CLAUDE.md` §5 say the same thing: a prominent side menu
         * folds into the main flow. Kept as a column it becomes a half-width
         * track of link labels running beside the article for the article's
         * whole length, which is the 1998 page's shape and not its meaning —
         * and `column`'s body in §4.1 is "Markdown and leaf media directives",
         * which a `nav` is not. The reference closes the region and puts the
         * menu after it.
         */
        const kept = inner.filter((block) => block.type !== "biomdNav");
        // The cell is decided now, so the align-run pass may look at it (§13
        // permits `align` inside `column`). During lowering above it must not:
        // the region detector reads the produced shape back.
        //
        // **Except in a pager.** {@link isBareLinkRow} holds only when every
        // occupied cell is exactly one link and nothing else, so each lane
        // already holds one thing and the lane itself is what places it — an
        // `align` inside can restate the lane and nothing more. This is §6's
        // "do not use `align` to restate a bounded group", the same argument
        // {@link alignedGroup} makes for a `frame`, applied to the one region
        // shape whose lanes are single navigation labels rather than record
        // cards. The distinction matters: `kiselev` and `new_blackmore` set a
        // multi-block lane apart from its neighbour inside an ordinary layout
        // region, and their references keep that `align`.
        const bounded: BiomdContent[] = kept.filter(isBounded);
        // The second grouping pass a lane's content goes through, and the only
        // one outside `blocksFrom`'s chain — so it needs the same repair, for
        // the same reason: it rebuilds blocks rather than mutating them.
        const grouped: BiomdContent[] = pager
          ? bounded
          : rehomeAnchors(bounded, groupAlignedRunsCommitted(bounded, ctx, cell.node), ctx);
        row.push({
          blocks: grouped.filter(isBounded),
          folded: inner.filter((block) => block.type === "biomdNav"),
        });
      }
      loweredRows.push(row);
    }

    const lanes = laneColumnsOf(grid, (r, c) => (loweredRows[r]?.[c]?.blocks.length ?? 0) > 0);
    const rails = pageRailColumns(grid);
    for (const c of rails) lanes.delete(c);
    for (const band of rowBandsOf(grid)) {
      const columns = [];
      const folded: BiomdContent[] = [];
      for (let c = 0; c < grid.cols; c += 1) {
        // Every cell this band puts in lane `c`, top to bottom — which is the
        // order a browser stacks them in, and for a single-row band is the one
        // cell the loop used to read directly.
        const stacked: BoundedContent[] = [];
        let occupied = false;
        for (let r = band.start; r <= band.end; r += 1) {
          const cellContent = loweredRows[r]?.[c];
          if (!cellContent) continue;
          occupied = true;
          folded.push(...cellContent.folded);
          // A rail's content is not lost — it joins the flow after the region,
          // the same way a folded menu does.
          if (rails.has(c)) folded.push(...cellContent.blocks);
          else stacked.push(...cellContent.blocks);
        }
        if (!occupied || rails.has(c)) continue;
        if (stacked.length > 0) columns.push(makeColumn(stacked));
        // An established lane keeps its place even in a row that has nothing to
        // put there. Five `goya2` albums have no cover art, and dropping the
        // empty lane dropped the whole row out of the two-lane region — so five
        // titles stopped lining up with the thirty that do, and every index
        // after them shifted. The references emit the empty `::: column`.
        else if (lanes.has(c)) columns.push(makeColumn([]));
      }
      // A row of nothing but empty lanes is an empty row, not a region.
      if (columns.every((col) => col.children.length === 0)) columns.length = 0;
      if (columns.length >= 2) {
        // The row boundary is the author's own division between catalog
        // entries, and `---` is its Markdown-native rendering. Without it the
        // regions abut and one album's tracks read as the next album's.
        // `analyze.md` asks for exactly this on `goya2`: "после каждой группы
        // альбомов дисков с песнями можно ставить разделитель строки".
        // Layout, not text — §16.3 constrains invented *content*, and drawing a
        // separator invents none.
        //
        // Provisionally: whether these rows *are* entries is a property of the
        // whole region, and the loop is one row in. {@link isEntryRow} counts
        // them, and the region withdraws every rule below if none is.
        if (lanedRows > 0) {
          derivedRuleAt.push(regions.length);
          regions.push(markDerivedRule());
        }
        if (isEntryRow(columns)) entryRows += 1;
        // Reference §3: the legacy form may omit `columns:` for 2–3 children,
        // but a 4-lane group has no legacy spelling, so the count is the only
        // way a reader learns the arity. `resolveColumnsCount` omits it again
        // under a profile that cannot render the property line safely.
        const resolvedCount = resolveColumnsCount(ctx.options.profile, columns.length as ColumnsCount);
        ctx.downgrades.push(...resolvedCount.transforms);
        regions.push(makeColumns({ children: columns, profile: ctx.options.profile, columns: resolvedCount.columns }));
        lanedRows += 1;
        regions.push(...folded);
        continue;
      }
      // A row with one populated cell is not a two-lane region — a spanning
      // heading, a spacer row, a footnote under the grid. Its content belongs in
      // the flow, and wrapping it in a one-lane `columns` would claim a layout
      // the author did not draw.
      //
      // It also arrives already positioned. A band left the grid, but it did not
      // leave the *construct*: whatever places the table places the band, which
      // §3.8 says the table carries itself. `xtra_shelechov` is the measured
      // case — its programme sits in `<div align="right">` around a 75 %-wide
      // table, and the two spanning `I отделение` / `II отделение` labels
      // inherited that `right` and were each wrapped in an `::: align` the
      // source never drew for them. Their own cells declare no alignment at all;
      // `.t1` computes `justify`. This is the same reasoning that already marks
      // a table's lifted caption, and the alignment gate reads one flag for
      // both.
      for (const column of columns) {
        for (const block of column.children as BiomdContent[]) {
          ctx.positionedByConstruct.add(block);
          regions.push(block);
        }
      }
      regions.push(...folded);
    }

    if (lanedRows > 0) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "columns"), { confidence: classification.confidence }));
      ctx.tables.push({
        tableId: el.id,
        classification: classification.class,
        emittedTable: false,
        failure: "emitted-as-columns",
      });
      // A grid of records is not a sequence of entries, and a rule between every
      // pair of its rows is the difference between a concert programme and a
      // page of dividers.
      const withdrawn = entryRows === 0 ? new Set(derivedRuleAt) : new Set<number>();
      if (withdrawn.size > 0) ctx.ledger.push(removed(el.id, `row separators withdrawn: ${withdrawn.size} record rows`));
      return withdrawn.size === 0 ? regions : regions.filter((_, index) => !withdrawn.has(index));
    }
    rollback(ctx, snapshot);
  }

  // Simplified: emit each cell's content in visual reading order. A two-lane
  // catalog becomes a sequence of albums, which is exactly what a narrow screen
  // would have shown anyway.
  ctx.ledger.push(
    mergedInto(el.id, nextId(ctx, "flow"), {
      confidence: classification.confidence,
      note: `layout flattened to linear flow (${classification.reason})`,
    }),
  );
  ctx.tables.push({
    tableId: el.id,
    classification: classification.class,
    emittedTable: false,
    failure: "flattened-to-flow",
  });
  return decomposeFrom(grid, ctx, el, /* alreadyLedgered */ true);
}

/**
 * Which grid columns are real lanes, as opposed to spacer columns.
 *
 * **Invariant.** A lane carries content in a substantial share of the grid's
 * content rows; a spacer carries content in almost none. Stated *relative to the
 * busiest column* rather than as a fraction of the grid, so it holds for a
 * two-lane catalog and a nine-column resource matrix alike and needs no tuning
 * when a grid is mostly empty.
 *
 * **Why it is needed.** An occasionally-empty lane and a permanently-empty
 * spacer look identical in any single row, and the two want opposite treatment:
 * the lane must keep its place so the rows stay aligned, the spacer must never
 * become a column at all. Occupancy across the whole grid is the only evidence
 * that separates them, and the corpus separates cleanly on it —  measures
 * [34, 30] and is a genuine two-lane catalog,  measures [36, 0] and is a
 * one-lane archive with a spacer beside it.
 *
 * **False friend.** A sparse column that carries content once or twice — the
 * four such columns in 's nine-column grid — which is a stray cell, not
 * a lane, and would otherwise pull empty columns into every row.
 *
 * **What counts as content is the caller's to say.** The default reads the
 * source cell, which is right for a grid nobody has lowered yet. `layoutFrom`
 * passes what survived lowering instead, because a cell whose whole content
 * leaves the lane — a side menu folded into the flow — is *source*-occupied
 * and *lane*-empty, and the region is built from the second of those. Measuring
 * one and building the other is what turned the site's own page frame into a
 * two-lane region whose second lane was the menu it had just removed.
 */
export function laneColumnsOf(
  grid: TableGrid,
  occupied?: (row: number, col: number) => boolean,
): Set<number> {
  const occupancy = new Array<number>(grid.cols).fill(0);
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const slot = grid.slots[r]?.[c];
      if (!slot?.isOrigin) continue;
      const cell = grid.cells.find((x) => x.id === slot.originId);
      if (!cell) continue;
      if (occupied ? occupied(r, c) : !cell.isEmpty) occupancy[c] = (occupancy[c] ?? 0) + 1;
    }
  }
  const busiest = Math.max(0, ...occupancy);
  const lanes = new Set<number>();
  // Half the busiest column. The corpus margin is far wider than the cut —
  //  sits at 30 of 34 and  at 0 of 36 — so the constant is
  // separating populations, not trimming one.
  for (let c = 0; c < grid.cols; c += 1) if ((occupancy[c] ?? 0) * 2 >= busiest && busiest > 0) lanes.add(c);
  return lanes;
}

/**
 * The narrow decorated strips the era drew down each side of a page.
 *
 * ## Rule contract
 *
 * **Invariant.** Geometry and position together: the row's *middle* column is
 * the widest, and the columns on either side of it are each far narrower. That
 * is `CLAUDE.md` §5's corpus fact stated as measurement — "content is the centre
 * column (~½ viewport); page chrome and footer drop; right-hand menus fold into
 * the main flow" — and it is what the flanks *are*, not what they happen to
 * contain: this site's rails hold a menu on one page, an off-site credit badge
 * on the next, and nothing at all on twenty.
 *
 * **Why width alone will not do.** It was tried and measured wrong first: a
 * plain "narrow lane beside a dominant one" test also fires on
 * `new_blackmore`'s figure regions, whose reference lanes measure 29/71 with
 * the *text* in the narrow one. Being flanked on **both** sides is what
 * separates a page frame from a lane pair, and it is why this reads position
 * rather than width alone.
 *
 * **Recurrence.** None is required of a single grid, and none is available: the
 * frame is drawn once per page. Its recurrence is across the corpus — measured
 * identical on all 22 documents at `[116, 529, 115]` in a 760 px row — which is
 * evidence this function does not need and could not see.
 *
 * **False friend**, tested for non-firing: a genuine three-lane region. Every
 * multi-column grid in the corpus that is not a page frame has its widest column
 * *first* (`[298, 28, 28]`, `[360, 45, 45]`, `[304, 36, 55, 55]`) or equal thirds
 * (`[357, 357, 357]`), so the ratio separating them is 0.22 against 1.00 — a
 * ceiling with an order of magnitude of room, not a discriminator.
 */
export function pageRailColumns(grid: TableGrid): Set<number> {
  const rails = new Set<number>();
  if (grid.cols !== 3) return rails;
  const widths: number[] = [];
  for (let c = 0; c < grid.cols; c += 1) {
    let w = 0;
    for (const cell of columnCellsOf(grid, c)) w = Math.max(w, cell.node.box?.w ?? 0);
    widths.push(w);
  }
  const [left = 0, centre = 0, right = 0] = widths;
  if (centre <= 0) return rails;
  if (centre <= left || centre <= right) return rails;
  if (left <= centre * MAX_RAIL_SHARE) rails.add(0);
  if (right <= centre * MAX_RAIL_SHARE) rails.add(2);
  // Both sides, or it is not a frame — one narrow column beside a wide one is a
  // lane pair, which is exactly what `new_blackmore` writes.
  return rails.size === 2 ? rails : new Set<number>();
}

/**
 * How wide a flank may be and still be a decoration rather than a lane.
 *
 * Half the content column. The corpus measures 0.22 for both real rails and
 * 1.00 for the nearest non-rail, so the sweep across 0.3–0.7 is flat and the
 * exact number does not matter — which is the shape a limit should have.
 */
const MAX_RAIL_SHARE = 0.5;

function columnCellsOf(grid: TableGrid, col: number): GridCell[] {
  const out: GridCell[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const slot = grid.slots[r]?.[col];
    if (!slot?.isOrigin) continue;
    const cell = grid.cells.find((x) => x.id === slot.originId);
    if (cell) out.push(cell);
  }
  return out;
}

function isBounded(node: BiomdContent): node is BoundedContent {
  return node.type !== "biomdColumns" && node.type !== "biomdColumn" && node.type !== "biomdNav";
}

/**
 * Whether a centred bounded block's text can be a label at all (§13).
 *
 * Exported so the contract can be tested directly: the surrounding rule needs a
 * real two-lane region to fire, and reproducing one in a unit fixture tests the
 * lane detector rather than this decision.
 *
 * The test used to demand a **letter**, which rejected `- 2 -` on the grounds
 * that a page number is not a label. `analyze/analyze.md` names that exact block
 * on `williams2` as one that must be centred, and the reference centres it — so
 * the human record decides it and the rule was wrong (`CLAUDE.md` §4, L5).
 *
 * Relaxed to "carries a letter or a digit", which admits `- 2 -` and every bare
 * year label while still rejecting the false friend this guard exists for: a
 * rule the author drew out of punctuation (`* * *`, `— — —`). That is a
 * separator and belongs to the break family, not here.
 */
export function isAlignableLabelText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * §6: "do not wrap … long body prose". §13: "use it for a bounded group".
 *
 * The one absolute number in the alignment family. It exists to separate a
 * bounded group from an article, and both alignment rules read it so the two
 * cannot disagree about where that line falls.
 *
 * **Measured, not chosen.** Over the 75 blocks the 13 references place inside an
 * `::: align`: median 41 characters, 90th percentile 178, longest 300 —
 * `news`'s obituary of 26 February 2014, which is one sentence and plainly a
 * bounded group rather than an article. Fifteen of the 75 exceed 120, so the
 * previous value contradicted the evidence, and the comment here claiming
 * otherwise had never been checked against it. At 120 a `news` notice could not
 * take its own opening sentence, so the name below it was wrapped alone: an
 * `align` around two words, the sentence it belongs to left outside.
 *
 * 400 clears the longest reference block by a third. It does **not** separate a
 * label from an article by length any more, and should not be read as doing so:
 * 98 of the 153 top-level paragraphs in the references are shorter than 400
 * (median 307), so at this value the number is a ceiling against wrapping a
 * whole article, not a discriminator.
 *
 * That is the right shape for it. The load-bearing evidence is relational and
 * always was: a block is alignable because its computed alignment *differs from
 * the page's own prose* ({@link proseAlignOf}) — measured against a
 * length-weighted aggregate of every prose block on the page, so nothing
 * qualifies by an absolute value at all. `CLAUDE.md` §5 records that every
 * single-block typographic threshold tried here regressed the corpus and every
 * relational one held. This cap is what stops that relation from being asked
 * about an article; it is not what answers it.
 */
export const ALIGN_LABEL_MAX_CHARS = 400;

/**
 * `::: align` for a short bounded block the author centred or right-set (§6).
 *
 * Scoped deliberately to the inside of a `column`. That is where the construct
 * earns its place: a record card's label sits centred over its cover, and
 * flattening it to a bold paragraph loses the only thing that says the label
 * belongs to the picture beside it. Outside a bounded container the same
 * evidence usually means a section label or a caption, both of which have
 * better mappings, and §6 forbids wrapping article prose.
 */
function alignedGroup(el: LadomNode, inner: BiomdContent[], ctx: Ctx): BiomdContent[] {
  // A frame is already a bounded group; §6 says not to use `align` to restate
  // one. Inside an obituary notice every line is centred, and wrapping each in
  // its own `align` describes the border, not the content.
  if (ctx.boundedDepth === 0 || ctx.frameDepth > 0 || inner.length === 0) return inner;
  const folded = foldTextAlign(el.style?.textAlign);
  const position = folded === "center" || folded === "right" ? folded : null;
  if (!position) return inner;

  const text = textOf(el).trim();
  // §6: "do not wrap … long body prose". A label names the record; a paragraph
  // that happens to be centred is still a paragraph.
  if (text === "" || text.length > ALIGN_LABEL_MAX_CHARS) return inner;
  if (inner.some((n) => n.type === "biomdColumns" || n.type === "biomdColumn" || n.type === "biomdNav")) return inner;
  // A picture carries its own `position`; §6 says not to duplicate it.
  if (inner.every((n) => n.type === "biomdImage" || n.type === "biomdImages")) return inner;
  if (inner.some((n) => n.type === "heading")) return inner;
  if (!isAlignableLabelText(text)) return inner;
  // The label of a record is set apart by weight as well as by position.
  // Unemphasised centred text in a lane is a caption, not a label.
  //
  // **A preformatted block is exempt, because the question does not apply to
  // it.** The weight test asks whether the author marked this *paragraph* as a
  // label; a `<pre>` holds verbatim text that can carry no emphasis at all, so
  // it can never answer yes, and the only thing that can place it is the
  // container the author put it in. `xtra_garcia_lorca` wraps its translator
  // credit in `<div align="right">` around a `<pre class="l">` — a declaration
  // with no other expression available — and the reference writes the `::: align
  // position: right` this refused. The length cap above still applies, so a
  // whole right-set poem is a block, not a label.
  if (!inner.every((n) => n.type === "code") && !isWhollyStrongBlocks(inner)) return inner;

  ctx.ledger.push(emitted(el.id, nextId(ctx, "align"), { note: `bounded ${position} group` }));
  return [makeAlign({ position, children: inner as BoundedContent[] })];
}

/**
 * The `::: align` that holds a headline the author wrapped over several lines.
 *
 * BioMD has no multi-line heading. `BioMD-Reference.md` §2 lets `align` hold
 * Markdown, and consecutive `#` lines inside one are what the target renderer
 * sets as a single headline across lines — so the container is part of the
 * representation, not decoration on top of it. `alignedGroup` and
 * `alignableRunMember` both decline headings, and correctly: a heading is
 * positioned by its own construct. This is the one case where the alignment is
 * *what makes the headings one heading*, so it is decided by the rule that
 * recognised the headline (headings.ts) rather than by the generic pass.
 *
 * `isDistinctiveAlign` is deliberately **not** asked. Everywhere else the
 * question is whether the author set this block apart from the page, and a
 * centred block on a centred page answers no. Here the container is part of
 * how the headline is written down, so it is required even on a page that
 * centres everything — the alternative is two bare `#` lines that read as two
 * titles.
 */
function mastheadAlign(el: LadomNode, inner: BiomdContent[], ctx: Ctx): BiomdContent[] | null {
  const declared = el.attrs["data-biomd-masthead-align"];
  if (declared !== "center" && declared !== "right") return null;
  if (ctx.frameDepth > 0 || inner.length === 0) return null;
  if (!inner.every((n) => n.type === "heading")) return null;
  ctx.ledger.push(emitted(el.id, nextId(ctx, "align"), { note: "wrapped masthead" }));
  return [makeAlign({ position: declared, children: inner as BoundedContent[] })];
}

/**
 * One layout cell, wrapped in `::: frame` when the author bordered it (§12).
 *
 * A bordered cell in the middle of a news column is an obituary notice or an
 * announcement — the one thing §12 exists for. Flattening it to prose loses
 * the only signal that the block is set apart from the entries around it.
 */
function framedCell(node: LadomNode, ctx: Ctx): BiomdContent[] {
  const evidence = frameEvidenceFor(node, ctx.documentTextLength);
  if (!evidence) return blocksFrom(node, ctx);

  ctx.boundedDepth += 1;
  ctx.frameDepth += 1;
  const lowered0 = blocksFrom(node, ctx).filter(isBounded);
  ctx.frameDepth -= 1;
  ctx.boundedDepth -= 1;
  if (lowered0.length === 0) return [];
  // §13 permits `align` inside `frame`, and the notices use it: the announcement
  // is centred and the paragraphs of the surrounding page are not.
  const inner = groupAlignedRunsCommitted(lowered0, ctx, node).filter(isBounded);

  // A target that cannot draw the border gets a blockquote and a recorded
  // downgrade, not a container that renders as nothing.
  const lowered = downgradeNotice(ctx.options.profile, { frame: evidence.frame, children: inner });
  ctx.downgrades.push(...lowered.transforms);
  ctx.ledger.push(emitted(node.id, nextId(ctx, "frame"), { note: evidence.reason }));
  return lowered.content;
}

/** Emit a grid's cells in reading order, row-major, origin cells only. */
/** Recurrence floor for treating grid rows as a list of entries (see below). */
const MIN_SEPARATED_ENTRY_ROWS = 3;

function decomposeFrom(grid: TableGrid, ctx: Ctx, el: LadomNode, alreadyLedgered = false): BiomdContent[] {
  const rows: BiomdContent[][] = [];
  /** Whether the author left one or more empty rows immediately above row `i`. */
  const spacerAbove: boolean[] = [];
  const seen = new Set<string>();
  let pendingSpacer = false;

  for (let r = 0; r < grid.rows; r += 1) {
    const row: BiomdContent[] = [];
    for (let c = 0; c < grid.cols; c += 1) {
      const slot = grid.slots[r]?.[c];
      // Only origin slots: a covered slot would duplicate the content.
      if (!slot?.isOrigin || seen.has(slot.originId)) continue;
      seen.add(slot.originId);
      const cell = grid.cells.find((x) => x.id === slot.originId);
      if (!cell || cell.isEmpty) {
        if (cell) ctx.ledger.push(removed(cell.id, "empty layout cell"));
        continue;
      }
      row.push(...framedCell(cell.node, ctx));
    }
    if (row.length === 0) {
      // An empty row above the first content row is top padding, not a divider.
      if (rows.length > 0) pendingSpacer = true;
      continue;
    }
    rows.push(row);
    spacerAbove.push(pendingSpacer);
    pendingSpacer = false;
  }

  const out: BiomdContent[] = [];
  // A `---` where the author divided their own entries. §16.3 constrains
  // invented *content*; drawing a separator invents none, and without one every
  // entry in a news archive runs into the next.
  //
  // **Where the division is depends on whether the author used spacer rows**, and
  // the corpus states which outright:
  //
  //   `goya2`  35 content rows, 1 empty (trailing)  — no spacer device, so the
  //            row boundary *is* the entry boundary.
  //   `news`   36 content rows, 33 empty, interleaved `.X.XX.X.X..X…` — the
  //            spacer row is the device, and several content rows can belong to
  //            one entry (`XXXXX` is a single item with a headline, a framed
  //            notice and a picture).
  //
  // Separating every row on `news` over-emits by ten; separating only at spacers
  // on `goya2` emits none. One rule covers both: **use the spacers when the
  // author used spacers.**
  //
  // **Recurrence, twice over.** A spacer counts as a device only if interior
  // spacers *recur* — a single trailing empty row is padding, not punctuation.
  // And the row-boundary fallback needs three content rows: two rows is a layout
  // split, an article beside its sidebar, where a rule cuts a document that was
  // never divided.
  const interiorSpacers = spacerAbove.filter((s, i) => i > 0 && s).length;
  const separateAt =
    interiorSpacers >= 2
      ? (i: number) => (spacerAbove[i] ?? false)
      : rows.length >= MIN_SEPARATED_ENTRY_ROWS
        ? () => true
        : () => false;

  rows.forEach((row, index) => {
    if (index > 0 && separateAt(index)) out.push(markDerivedRule());
    const grouped = imageRowFrom(row);
    // `makeGroupedImage` rebuilds each picture, so a destination attached to one
    // has to move onto the group. A `::: images` body admits images only, which
    // is why the marker ends up before the whole row rather than before the
    // cover it named — the closest place a grid of pictures can carry one.
    out.push(...(grouped === null ? row : rehomeAnchors(row, grouped, ctx)));
  });

  if (!alreadyLedgered) ctx.ledger.push(mergedInto(el.id, nextId(ctx, "flow")));
  // Entry labels only become visible once the lanes are back in reading order,
  // so the promotion has to run on the flattened region rather than per cell.
  return bindCaptions(promoteSectionAfterRule(promoteLabelBeforeList(promoteEntryDates(out, ctx), ctx), ctx), ctx);
}

/**
 * `::: images` for a flattened grid row that is nothing but pictures.
 *
 * ## Rule contract
 *
 * **Invariant.** *Containment and cardinality*: one grid row whose cells lower
 * to two or more `image` blocks and to nothing else — no words, no list, no
 * second construct. The author drew those cells side by side; flattening them
 * loses only the fact that they were a row, and §8's "two or more adjacent
 * source images forming one visual row" is exactly that fact. No name, class,
 * size or filename is read.
 *
 * **Recurrence does not apply, and the contract says so.** A gallery row is a
 * row whether the page draws one or six, and `goya2` draws three. `CLAUDE.md`
 * §5's recurrence requirement governs shapes inferred from typography inside a
 * document; here the grouping is *declared* by the markup — the cells share a
 * `<tr>` — so adjacency needs no corroboration. This is the same reason
 * {@link isUiIcon} states an exemption.
 *
 * **False friend: a record row.** `goya2`'s album grid pairs a title cell with
 * its cover cell, and `williams2` pairs a track with its link — one image plus
 * something else. `every(isStandaloneImage)` refuses both, which is why the
 * test is on the *whole* row rather than on the images in it. A row holding one
 * picture is likewise not a row of pictures.
 *
 * **Why here and not in {@link imagesFrom}.** That path reads an inline run —
 * images separated by whitespace inside one `<p>`. This corpus draws the other
 * half of its plates as a table row per plate, which never reaches it: the grid
 * is classified, fails to plan as records, and arrives at linear flow with the
 * row structure already resolved. Both are the same construct in the two
 * spellings FrontPage offered.
 */
function imageRowFrom(row: readonly BiomdContent[]): BiomdContent[] | null {
  if (row.length < 2) return null;
  if (!row.every(isStandaloneImage)) return null;
  const children = row.map((image) =>
    makeGroupedImage({
      src: image.src,
      ...(image.alt === undefined ? {} : { alt: image.alt }),
      ...(image.caption === undefined ? {} : { caption: image.caption }),
      ...(image.link === undefined ? {} : { link: image.link }),
      ...(image.frame === undefined ? {} : { frame: image.frame }),
    }),
  );
  return [makeImages({ columns: groupColumnsFor(children.length), children })];
}

function isStandaloneImage(block: BiomdContent): block is BiomdImageNode {
  return block.type === "biomdImage" && block.standalone;
}

/**
 * `::: lead` is deliberately never emitted. Ruled by the reference author,
 * 2026-08-08 — PROGRESS §26. Do not re-derive this.
 *
 * This paragraph used to describe a "promote the first substantial paragraph to
 * `::: lead`" pass that has never existed, which made `retyped.paragraph-to-lead`
 * read like a regression in a working mechanism rather than an unbuilt one.
 *
 * All 10 `::: lead` in the 22 references are in two documents, and the author
 * states the choice was **aesthetic, not structural** — applied when every
 * paragraph opens with a highlighted initial, or when the article is built from
 * long paragraphs that read better broken up — and applied to one document only,
 * so its absence elsewhere is not an omission. The ruling is **symmetric**: a
 * `lead` discrepancy in either direction is a visual matter and not a fidelity
 * defect, so a future rule here is judged on rendered quality and never on
 * agreement with `fixtures/out/`.
 *
 * Both criteria are judgements about the finished page, and the measurements
 * agree that the source does not carry them:
 *
 *  - `new_rechin4` wraps **9 of its 9** body paragraphs. Its four `<p class="t">`
 *    blocks are the entire prose of the page and all compute 14.67 px / 400 /
 *    justify, so there is nothing to contrast against — the construct *is* the
 *    page, which is the majority-test trap `bodyProminenceOf`'s header warns
 *    about.
 *  - `news`'s two are a genuine editorial intro that measures **identical** to
 *    the archive body it introduces: 13.33 px, weight 400, upright,
 *    `rgb(51,51,40)`, differing only in a `text-align` that recurs in the body.
 *    So §3's "distinctly styled introductory source region" is not attested.
 *
 * Length does not recover it either. Across the 22 references, `lead`
 * paragraphs run 220–4164 characters while **29 plain paragraphs in 15
 * documents** exceed 900 — `williams2` reaches 3136 and `segovia` 1587, longer
 * than most leads — and `news`'s own leads (413, 220) are shorter than a plain
 * 1303-character paragraph on the same page. Only a *per-document* median
 * separates them, and only with one positive: `new_rechin4` at 839 against
 * `authors` at 631. A single-instance threshold whose payoff is rewrapping an
 * entire document body is the largest blast radius in the pipeline for the least
 * evidence, so no rule is built and none should be.
 */
/**
 * `BioMD-Reference.md` §6: one `#` for a source with one clear page title.
 *
 * Treated as a planning invariant rather than a validator finding. Waiting for
 * the validator to report `h1-count` produces a file that is written, looks
 * plausible, and is off-convention — and on a thousand-page batch nobody reads
 * the report. Typographic recovery cannot guarantee the invariant on its own: a
 * page with two equally large labels nominates both.
 *
 * **Consecutive `#` lines are one title.** A headline the author wrapped over
 * two lines is one page title with no hierarchy between its halves, and BioMD
 * writes it as adjacent `#` lines inside the alignment that sets them as one
 * block (headings.ts). Demoting the second half to `##` would assert a
 * hierarchy the headline does not have, so adjacency — nothing but other title
 * lines between them — is what separates one wrapped title from two competing
 * ones. Titles separated by content are still competing titles and are still
 * demoted.
 *
 * The repair is the smallest one that satisfies the rule: the first title group
 * in reading order stays the title, every later `#` becomes `##`, and nothing
 * is invented. A document with no heading at all is left alone — there is
 * nothing to promote, and the review item already says so.
 */
export function enforceSingleTitle(root: BiomdRoot): { root: BiomdRoot; changes: string[] } {
  const changes: string[] = [];
  const headings: Array<{ node: { depth: number; type: string }; index: number }> = [];
  /** The sibling list a heading sits in, and where — adjacency is asked here. */
  const place = new Map<{ depth: number; type: string }, { siblings: BiomdContent[]; at: number }>();
  const visit = (nodes: BiomdContent[]): void => {
    nodes.forEach((node, at) => {
      if (node.type === "heading") {
        headings.push({ node, index: headings.length });
        place.set(node, { siblings: nodes, at });
      }
      // Phrasing children are not blocks; descending into a heading would count
      // its own text as something standing between it and the next heading.
      if (node.type === "heading") return;
      const children = (node as { children?: unknown }).children;
      if (Array.isArray(children)) visit(children as BiomdContent[]);
    });
  };
  visit(root.children as BiomdContent[]);
  if (headings.length === 0) return { root, changes };

  const titles = headings.filter((h) => h.node.depth === 1);
  if (titles.length === 0) {
    const first = headings[0];
    if (first) {
      changes.push(`no level-one heading; promoted the first heading (was h${first.node.depth}) to the title`);
      first.node.depth = 1;
    }
  } else if (titles.length > 1) {
    // Walk the run of titles adjacent to the first one; only a title that
    // stands apart from it — in another container, or with content between —
    // is a competing title.
    let previous = place.get(titles[0]?.node as { depth: number; type: string });
    for (const extra of titles.slice(1)) {
      const here = place.get(extra.node);
      if (previous && here && here.siblings === previous.siblings && here.at === previous.at + 1) {
        previous = here;
        continue;
      }
      changes.push("more than one level-one heading; demoted a later one to h2");
      extra.node.depth = 2;
    }
  }

  // §18 also rejects a jump from `#` to `###`. It happens honestly: a record
  // label is recovered inside a region whose introducing `##` the source never
  // wrote. Lifting the orphan to the next legal level keeps the outline
  // navigable and invents no text.
  //
  // **A jump orphans a level, not a heading.** `new_geyzel04` sets four chapter
  // titles in one template and every one of them is recovered at h3; lifting
  // only the first made the other three its *children*, which is a hierarchy
  // the page does not have and the opposite of the consistency the template
  // states. So the correction is recorded per written level and reapplied to
  // that level's later members, until a heading the document writes shallower
  // shows the level is no longer orphaned.
  let previous = 1;
  const lifted = new Map<number, number>();
  for (const { node } of headings) {
    const written = node.depth;
    const already = lifted.get(written);
    if (already !== undefined) {
      node.depth = already;
    } else if (written > previous + 1) {
      changes.push(`heading level jumped from h${previous} to h${written}; lifted to h${previous + 1}`);
      lifted.set(written, previous + 1);
      node.depth = previous + 1;
    } else {
      for (const key of [...lifted.keys()]) if (key > written) lifted.delete(key);
    }
    previous = node.depth;
  }
  return { root, changes };
}

export function promoteLead(root: BiomdRoot, evidence: { hasLeadMarkup: boolean }): BiomdRoot {
  if (!evidence.hasLeadMarkup) return root;
  const index = root.children.findIndex((c) => c.type === "paragraph");
  if (index < 0) return root;
  const paragraph = root.children[index] as Paragraph;
  const children = [...root.children];
  children[index] = makeLead([paragraph]);
  return { ...root, children };
}

export { downgradeNotice, makeImages, type RootContent };
