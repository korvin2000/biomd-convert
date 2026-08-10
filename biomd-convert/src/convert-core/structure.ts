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
  type BiomdContent,
  type BiomdRoot,
  type BoundedContent,
  type ColumnsCount,
  type DowngradeRecord,
  type TargetProfile,
  downgradeNotice,
  makeAlign,
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
import { type GridCell, type TableGrid, rowCells } from "../ladom/grid.js";
import { type PhysicalAlign, foldTextAlign, isDistinctiveAlign, proseAlign } from "../ladom/style.js";
import { type LadomNode, textOf, walkElements } from "../ladom/types.js";
import { type Classification, classifyTable } from "./classify.js";
import { stripLabelGlyphs } from "./headings.js";
import {
  type LogicalTablePlan,
  type PlannedCell,
  type PlannedRow,
  cellText,
  planDataTable,
} from "./data-table.js";
import { LINK_GLYPH, RULE_GLYPHS, iconGlyphFor, isDrawnRule } from "./glyphs.js";
import { canonicalColumnLabel } from "./column-labels.js";
import { type LinkProfile, rewriteTarget, siteRelativeAsset } from "./links.js";
import { type LedgerEntry, emitted, mergedInto, removed, review } from "./ledger.js";
import {
  type RunLine,
  enumeratedItems,
  groupIsLineated,
  groupLines,
  isWrapBreak,
  lineText,
  collapseSpace,
  phrasingText,
  splitLines,
} from "./lines.js";
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
}

const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export function recoverStructure(
  root: LadomNode,
  grids: readonly TableGrid[],
  options: StructureOptions,
): StructureResult {
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
    contentWidth: contentWidthOf(root),
    bodyProminence: bodyProminenceOf(root),
    proseItalic: proseItalicOf(root),
    subordinated: new WeakSet(),
    subordinationRecurs: false,
    proseAlign: proseAlignOf(root),
    blockAlign: new WeakMap(),
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
  };

  ctx.subordinationRecurs = subordinationRecursIn(root, ctx.proseItalic);

  const children = blocksFrom(root, ctx);
  return {
    root: { type: "root", children },
    ledger: ctx.ledger,
    downgrades: ctx.downgrades,
    targets: ctx.targets,
    images: ctx.images,
    warnings: ctx.warnings,
    tables: ctx.tables,
  };
}

function nextId(ctx: Ctx, prefix: string): string {
  ctx.counter.n += 1;
  return `${prefix}:${ctx.counter.n}`;
}

/** Convert a node's children into top-level block content. */
function blocksFrom(node: LadomNode, ctx: Ctx): BiomdContent[] {
  const out: BiomdContent[] = [];
  let inlineRun: LadomNode[] = [];
  const outerCaptionContext = ctx.inCaptionContext;
  const outerCentered = ctx.inCenteredBlock;
  ctx.inCaptionContext = isCaptionContext(node, ctx);
  ctx.inCenteredBlock = node.kind === "element" && prominenceOf(node).centered;

  const flushInline = (): void => {
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
    let hoisted = 0;
    for (const node of inlineRun) {
      if (node.kind !== "element" || node.tag !== "img" || !isFloated(node)) continue;
      const figure = imageFrom(node, ctx, true);
      if (figure) {
        out.push(figure);
        hoisted += 1;
      }
    }
    if (hoisted > 0) {
      inlineRun = inlineRun.filter((n) => !(n.kind === "element" && n.tag === "img" && isFloated(n)));
      if (inlineRun.length === 0) return;
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
    const otherContent = inlineRun.some(
      (n) =>
        (n.kind === "text" && (n.value ?? "").trim() !== "") ||
        (n.kind === "element" && n.tag !== "img" && n.tag !== "br" && textOf(n) !== ""),
    );
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
    out.push(...blocksFromPhrasing(phrasing, ctx, out[out.length - 1]));
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
  return bindCaptions(
    groupAlignedRuns(
      groupSubordinatedRuns(
        promoteSectionAfterRule(promoteLabelBeforeList(promoteEntryDates(out, ctx), ctx), ctx),
        ctx,
      ),
      ctx,
    ),
    ctx,
  );
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
    if (align !== runAlign) flush();
    runAlign = align;
    run.push(block);
  }
  flush();
  return out;
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
  // §3.8 tables and §2 headings are positioned by their own construct.
  if (block.type === "table" || block.type === "heading") return null;
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
 */
export function promoteLabelBeforeList(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  if (ctx.tableDepth >= 2) return [...nodes];
  const candidates: number[] = [];
  nodes.forEach((node, index) => {
    if (node.type !== "paragraph") return;
    const next = nodes[index + 1];
    if (!next || next.type !== "list") return;
    if (node.children.some((c) => c.type === "link" || c.type === "image" || c.type === "break")) return;
    const text = phrasingText(node.children).replace(/\s+/gu, " ").trim().replace(/[:\s]+$/u, "");
    if (text.length < 4 || text.length > 60) return;
    if (text.split(/\s+/u).filter(Boolean).length > 8) return;
    if (/[.!?]/u.test(text)) return;
    candidates.push(index);
  });
  if (candidates.length < 2) return [...nodes];

  const out = [...nodes];
  for (const index of candidates) {
    const paragraph = out[index] as Paragraph;
    const children = headingPhrasing(paragraph.children);
    const last = children[children.length - 1];
    if (last?.type === "text") last.value = last.value.replace(/[:\s]+$/u, "");
    const heading: BiomdContent = { type: "heading", depth: 3, children };
    ctx.recoveredHeadings.add(heading);
    out[index] = heading;
  }
  return out;
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

/**
 * Bind a figure to the caption the reader can actually see.
 *
 * ## Rule contract
 *
 * **Invariant.** A standalone image immediately followed by a run of
 * caption-eligible blocks — centred, set in type smaller than the page's prose,
 * free of links and pictures, and short. Containment and sibling order decide
 * the binding; no filename, class or label vocabulary is consulted.
 *
 * **The visible line outranks `alt`.** `alt` describes the picture for a reader
 * who cannot see it; a caption is visible editorial text, and the two are
 * different properties in §6.1. When a page states both, the visible one is the
 * caption and `alt` is only the fallback for a figure that has no visible line
 * at all. Before this rule the first writer won, which was `alt`, so `authors`
 * captioned a scan `Заметка о проекте…` while printing the three lines the
 * author actually wrote as a loose paragraph underneath — the caption wrong and
 * the text duplicated at once.
 *
 * **A run, not a line.** `segovia`'s 1936 photographs caption in three lines:
 * a bold title, who is in the picture, and where it was taken. Taking only the
 * first left the other two orphaned below the figure. The run ends where
 * eligibility ends, which is the author's own boundary.
 *
 * **False friend.** Prose that merely follows a figure — excluded because
 * `captionEligible` requires centring *and* small type together: `ДИСКОГРАФИЯ`
 * above its album list is small but not centred, and binding it to the cover
 * above it deleted a section of the document. A block *preceding* an image is
 * never a caption: `news` sets an obituary's subject in bold above the
 * photograph, and the reference keeps it as prose.
 *
 * **Subsumes "the same caption twice".** A page that puts the caption in `alt`
 * and repeats it on a visible line no longer needs a separate absorb rule: the
 * visible line replaces the property and is consumed. It also fixes what that
 * rule got wrong — it kept `alt`'s wording, so `williams2` read `Джон Вильямс в
 * 1971 г.` where the visible line, and the reference, say `в 1971 году.`
 */
function bindCaptions(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as BiomdContent;
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
): BiomdContent[] {
  if (phrasing.length === 0) return [];
  const out: BiomdContent[] = [];

  const groups = groupLines(splitLines(phrasing));
  const groupText = groups.map((g) => g.lines.map(lineText).join(" ").trim());
  let after = groupText.reduce((a, t) => a + t.length, 0);

  groups.forEach((group, index) => {
    after -= (groupText[index] as string).length;
    const previous = out[out.length - 1] ?? precededBy;
    out.push(...blocksFromGroup(group.lines, ctx, after, previous?.type === "biomdImage"));
  });
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

  // A rule the author drew with punctuation because the era gave them no `<hr>`
  // they liked. See `drawnRuleFrom`.
  const drawn = drawnRuleFrom(rest);
  if (drawn) {
    out.push(...drawn);
    return out;
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
            position: estimatePosition(source),
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
  const letters = text.replace(/[^\p{L}]/gu, "");
  const shouted = letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  if (!bold && !shouted) return null;
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

  for (const node of nodes) {
    if (node.kind === "comment") continue;
    if (node.kind === "text") {
      // Separators, not words. Legacy menus bracket their items — `[ 2007 ]` —
      // and rejecting punctuation outright missed every one of them.
      const value = node.value ?? "";
      if (NAV_SEPARATOR.test(value)) continue;
      const label = value.replace(NAV_SEPARATOR_CHARS, " ").replace(/\s+/gu, " ").trim();
      if (label === "" ) continue;
      if (label.length > 40 || plainItems.length > 0) return null;
      plainItems.push(label);
      order.push({ kind: "plain", text: label });
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
    return null;
  }

  if (links.length < 3) return null;

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
        { type: "paragraph", children: [{ type: "link", url, children: inlineFrom(entry.node.children, ctx) }] },
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
function blockFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
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
    case "ol":
      return [listFrom(el, ctx)];

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
      ctx.ledger.push(emitted(el.id, nextId(ctx, "code")));
      return [{ type: "code", value: textOf(el) }];
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

function listFrom(el: LadomNode, ctx: Ctx): List {
  const ordered = el.tag === "ol";
  const items: ListItem[] = [];

  for (const li of el.children) {
    if (li.kind !== "element" || li.tag !== "li") continue;
    const inner = blocksFrom(li, ctx).filter(isBlockContent);
    items.push({
      type: "listItem",
      spread: false,
      children: inner.length > 0 ? inner : [{ type: "paragraph", children: [] }],
    });
    ctx.ledger.push(emitted(li.id, nextId(ctx, "li")));
  }

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
function inlineFrom(nodes: readonly LadomNode[], ctx: Ctx): PhrasingContent[] {
  const out: PhrasingContent[] = [];

  for (const node of nodes) {
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
        out.push({ type: "break" });
        break;
      case "b":
      case "strong": {
        const children = inlineFrom(node.children, ctx);
        // `<b><b>x</b></b>` — legacy markup nests emphasis constantly, and the
        // serializer renders the redundant level as `****x****`, which is not
        // emphasis in Markdown at all.
        out.push(unwrapRedundant(children, "strong") ?? { type: "strong", children });
        break;
      }
      case "i":
      case "em": {
        const children = inlineFrom(node.children, ctx);
        out.push(unwrapRedundant(children, "emphasis") ?? { type: "emphasis", children });
        break;
      }
      case "s":
      case "strike":
      case "del":
        out.push({ type: "delete", children: inlineFrom(node.children, ctx) });
        break;
      case "code":
      case "tt":
        out.push({ type: "inlineCode", value: textOf(node) });
        break;
      case "a": {
        const href = node.attrs["href"] ?? "";
        const rewritten = rewriteTarget(href, ctx.options.links);
        if (rewritten.kind === "unsafe" || rewritten.href === "") {
          // A link whose only destination was a script has no destination.
          ctx.ledger.push(removed(node.id, "target carries no navigable destination"));
          out.push(...inlineFrom(node.children, ctx));
          break;
        }
        if (rewritten.warning) ctx.warnings.push(`${node.id}: ${rewritten.warning}`);
        ctx.targets.push(rewritten.href);
        ctx.ledger.push(emitted(node.id, nextId(ctx, "link")));
        const label = inlineFrom(node.children, ctx);
        // `<a href=x><img src=forward.gif></a>` — the label was a glyph, and
        // the glyph is gone. An empty `[](x)` is not a link a reader can see
        // or a screen reader can announce; the destination is the only
        // source-backed text left, so it becomes the label.
        out.push({
          type: "link",
          url: rewritten.href,
          children: label.length > 0 ? label : [{ type: "text", value: rewritten.href }],
        });
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
      default:
        out.push(...inlineFrom(node.children, ctx));
        break;
    }
  }

  return collapseAdjacentText(out);
}

/** The inner node when a wrapper's only child already carries the same mark. */
function unwrapRedundant(children: PhrasingContent[], type: "strong" | "emphasis"): PhrasingContent | null {
  return children.length === 1 && children[0]?.type === type ? (children[0] as PhrasingContent) : null;
}

function collapseAdjacentText(nodes: PhrasingContent[]): PhrasingContent[] {
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
  const first = cleaned[0];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/u, "");
  const final = cleaned[cleaned.length - 1];
  if (final?.type === "text") final.value = final.value.replace(/\s+$/u, "");

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
    position: estimatePosition(el),
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

function estimatePosition(el: LadomNode): "left" | "right" | "center" | "full" {
  const float = floatOf(el);
  if (float) return float;
  // Centre is the fallback for a standalone figure with no float evidence, and
  // it is the *only* outcome here: the `text-align` test that used to sit on
  // this line compared with `=== "center"` and returned "center" either way, so
  // it decided nothing while looking like a rule. Removed rather than repaired
  // — reading alignment for an image position is a separate question from the
  // `::: align` family, and folding one into the other would confound both.
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
    const label = [...walkElements(cell)]
      .filter((node) => node.tag === "a")
      .flatMap((anchor) => inlineFrom(anchor.children, ctx));
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
  // record matrix — a source header row, or three-plus inferred columns.
  // Supplied labels deliberately do *not* count: a model will happily name the
  // columns of a two-column news list, and accepting that would let the label
  // hook quietly promote every ambiguous region into a table.
  const evidence =
    planned.plan !== null && (!planned.plan.headerSynthesized || planned.plan.bands.length >= 3);

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
      return [table];
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
  if (total < 3) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  return best[1] / total >= 0.6 ? best[0] : null;
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
  if (grid.rows !== 1) return false;
  const cells = rowCells(grid, 0).filter((cell) => !cell.isEmpty);
  const index = cells[0];
  if (cells.length < 2 || !index) return false;
  if (index.links > 0 || index.images > 0 || index.text.trim() === "") return false;
  return cells
    .slice(1)
    .some((cell) => cell.links >= 1 && cell.images === 0 && cell.text.trim().length < LINK_LABEL_MAX_CHARS);
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
  const maxLanes = isBareLinkRow(grid) ? 4 : 3;
  if (ctx.options.layoutFidelity === "faithful" && grid.cols >= 2 && grid.cols <= maxLanes && grid.rows >= 1) {
    // Speculative, so it has to be undoable. A lane attempt that turns out not
    // to produce two usable columns still walked every cell, and its links,
    // images and ledger entries stayed behind — the conservation gate then
    // reported the whole region's targets twice as "unexpected".
    const snapshot = begin(ctx);
    const regions: BiomdContent[] = [];
    let lanedRows = 0;

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
        row.push({
          blocks: groupAlignedRunsCommitted(kept.filter(isBounded), ctx, cell.node).filter(isBounded),
          folded: inner.filter((block) => block.type === "biomdNav"),
        });
      }
      loweredRows.push(row);
    }

    const lanes = laneColumnsOf(grid, (r, c) => (loweredRows[r]?.[c]?.blocks.length ?? 0) > 0);
    const rails = pageRailColumns(grid);
    for (const c of rails) lanes.delete(c);
    for (let r = 0; r < grid.rows; r += 1) {
      const columns = [];
      const folded: BiomdContent[] = [];
      for (let c = 0; c < grid.cols; c += 1) {
        const cellContent = loweredRows[r]?.[c];
        if (!cellContent) continue;
        folded.push(...cellContent.folded);
        // A rail's content is not lost — it joins the flow after the region, the
        // same way a folded menu does.
        if (rails.has(c)) folded.push(...cellContent.blocks);
        else if (cellContent.blocks.length > 0) columns.push(makeColumn(cellContent.blocks));
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
        if (lanedRows > 0) regions.push(markDerivedRule());
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
      for (const column of columns) regions.push(...(column.children as BiomdContent[]));
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
      return regions;
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
  // The label of a record is set apart by weight as well as by position.
  // Unemphasised centred text in a lane is a caption, not a label.
  if (!isAlignableLabelText(text) || !isWhollyStrongBlocks(inner)) return inner;

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
    out.push(...(imageRowFrom(row) ?? row));
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
  let previous = 1;
  for (const { node } of headings) {
    if (node.depth > previous + 1) {
      changes.push(`heading level jumped from h${previous} to h${node.depth}; lifted to h${previous + 1}`);
      node.depth = previous + 1;
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
