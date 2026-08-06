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
  resolveListMarkerPadding,
} from "../biomd-ast/index.js";
import type { TableGrid } from "../ladom/grid.js";
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
import { type LinkProfile, rewriteTarget } from "./links.js";
import { type LedgerEntry, emitted, mergedInto, removed, review } from "./ledger.js";
import {
  type RunLine,
  groupIsLineated,
  groupLines,
  isWrapBreak,
  lineText,
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
    out.push(...produced);
  }

  flushInline();
  ctx.inCaptionContext = outerCaptionContext;
  ctx.inCenteredBlock = outerCentered;
  return bindCaptions(
    groupAlignedRuns(promoteSectionAfterRule(promoteLabelBeforeList(promoteEntryDates(out, ctx), ctx), ctx), ctx),
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
 * ## Why `right` and not `center` — measured, not chosen
 *
 * The rule reads `center` and `right` identically. Admitting both was tried
 * first and **rejected by L2**: source-backed findings rose 596 → 602, because
 * `align.spurious` gained 11 while `align.missing` and
 * `retyped.paragraph-to-align` together lost only 8. Ten of the eleven spurious
 * were `center`. Restricted to `right`, the same pass measures 596 → **593**.
 *
 * The asymmetry is structural rather than numerical, which is why it is expected
 * to hold on the other ~987 pages. **Right is deliberate: nothing inherits it.**
 * In this corpus a right-set block is an attribution, a contact block or a
 * source citation — the author asked for it, on that block, on purpose. **Centre
 * is ambient:** it is inherited from centred containers, it is what a caption
 * under a figure gets for free, and it is how a layout lane is filled. The
 * computed value is equally trustworthy in both cases; what differs is how many
 * *other* constructs also produce it.
 *
 * **Falsifier.** A page whose centred blocks are neither captions, nor inherited
 * from a centred container, nor lane content — measurably distinctive, and wrong
 * to leave plain. `goya2` may already be one: it holds 7 `align.missing`, all
 * centred. If that shape recurs across the corpus, centre belongs here too and
 * the missing guard is a caption/lane exclusion, not a position restriction.
 *
 * **Known blocker.** Two documents — `borislova` and `jovicic` — put centred
 * content in the reading flow that the references put in `::: column`. Their
 * `columns` region fails to lower, so its cells arrive as ordinary siblings with
 * genuine centring evidence. No guard at this seam can separate them, because by
 * the time the run pass sees them the region is already gone. That is the
 * columns family's defect, and centre cannot be reconsidered before it is fixed.
 */
function groupAlignedRuns(blocks: BiomdContent[], ctx: Ctx): BiomdContent[] {
  // A frame is already a bounded group; §6 says not to restate one.
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
  let runAlign: "right" | null = null;

  const flush = (): void => {
    // No ledger entry: every member was already recorded as EMITTED by the
    // element it came from, and `runPass` rejects an id it did not declare —
    // this pass regroups blocks, it does not consume source nodes.
    if (runAlign !== null && run.length > 0) {
      out.push(makeAlign({ position: runAlign, children: run as BoundedContent[] }));
    } else {
      out.push(...run);
    }
    run = [];
    runAlign = null;
  };

  for (const block of blocks) {
    const align = alignableRunMember(block, ctx);
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
function alignableRunMember(block: BiomdContent, ctx: Ctx): "right" | null {
  const align = ctx.blockAlign.get(block);
  if (align === undefined || align === null) return null;
  // `left`/`justify` are the reading flow and say nothing. `center` is held back
  // deliberately — see the position asymmetry in `groupAlignedRuns`'s contract,
  // which L2 decided and which the columns family has to clear before it can be
  // revisited. The relational test below is what makes even `right` evidence.
  if (align !== "right") return null;
  if (!isDistinctiveAlign(align, ctx.proseAlign)) return null;

  // §4.1: these may not sit inside a bounded container, and the bounded-content
  // filter would drop them silently — taking their links with them.
  if (!isBounded(block)) return null;
  // A picture, a nested align and a frame each carry their own position (§6).
  if (block.type === "biomdImage" || block.type === "biomdImages") return null;
  if (block.type === "biomdAlign" || block.type === "biomdFrame") return null;
  // §3.8 tables and §2 headings are positioned by their own construct.
  if (block.type === "table" || block.type === "heading") return null;
  if (block.type === "thematicBreak") return null;

  // False friend: the caption bound to a figure. `::: image`'s `caption:` is
  // where it belongs — a competing `align` both duplicates the position and
  // detaches the text from its picture.
  if (ctx.captionEligible.has(block)) return null;

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
 */
function promoteSectionAfterRule(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const out = [...nodes];
  for (let i = 1; i < out.length - 1; i += 1) {
    if ((out[i - 1] as BiomdContent).type !== "thematicBreak") continue;
    const node = out[i] as BiomdContent;
    if (node.type !== "paragraph") continue;
    if (node.children.some((c) => c.type === "link" || c.type === "image" || c.type === "break")) continue;
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
 */
function promoteLabelBeforeList(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
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
function bindCaptions(nodes: readonly BiomdContent[], ctx: Ctx): BiomdContent[] {
  const out: BiomdContent[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as BiomdContent;
    const next = nodes[i + 1];
    if (node.type === "biomdImage" && node.standalone && node.caption === undefined && next !== undefined) {
      // A short line under an uncaptioned picture is its caption — including
      // when typography made it look like a section label. `А. Сеговия с
      // учениками В.И.Яшнева` is what the photograph shows, not what the next
      // three paragraphs are about.
      const eligible =
        (next.type === "paragraph" && ctx.captionEligible.has(next)) ||
        // A *centred* recovered heading under a picture is its caption. A
        // small-type section label — `ДИСКОГРАФИЯ` above its list — is not,
        // and swallowing it deleted a real section of the document.
        (next.type === "heading" && ctx.captionHeadings.has(next));
      if (eligible) {
        const caption = phrasingText(next.children as PhrasingContent[]).replace(/\s+/gu, " ").trim();
        if (caption !== "" && caption.length <= 300) {
          out.push({ ...node, caption });
          i += 1;
          continue;
        }
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

/** Lines → one paragraph, with each interior break classified. */
function paragraphFromLines(lines: readonly RunLine[]): Paragraph | null {
  const lineated = groupIsLineated(lines);
  const children: PhrasingContent[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      const left = lineText(lines[index - 1] as RunLine);
      const right = lineText(line);
      // A hand-wrapped sentence means a space; a line the author drew means a
      // hard break.
      if (!lineated && isWrapBreak(left, right)) children.push({ type: "text", value: " " });
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
  if (ctx.boundedDepth > 0) return null;

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
      return alignedGroup(el, inner, ctx);
    }

    case "ul":
    case "ol":
      return [listFrom(el, ctx)];

    case "blockquote": {
      const inner = blocksFrom(el, ctx).filter(isBlockContent);
      ctx.ledger.push(emitted(el.id, nextId(ctx, "quote")));
      return inner.length > 0 ? [{ type: "blockquote", children: inner }] : [];
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
 */
function headingPhrasing(nodes: PhrasingContent[]): PhrasingContent[] {
  const flat: PhrasingContent[] = [];
  const push = (list: readonly PhrasingContent[]): void => {
    for (const node of list) {
      if (node.type === "break") {
        flat.push({ type: "text", value: " " });
        continue;
      }
      flat.push(node);
    }
  };
  push(nodes);

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
      const value = (node.value ?? "").replace(/\s+/gu, " ");
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
        if (isDecorative(node)) {
          ctx.ledger.push(removed(node.id, "decorative image (spacer, icon, rule or nav glyph)"));
          break;
        }
        ctx.images.push(src);
        ctx.ledger.push(emitted(node.id, nextId(ctx, "img")));
        const emittedImage = { type: "image" as const, url: src, alt: node.attrs["alt"] ?? "" };
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

  // §7.1: this corpus's `alt` is the only source-backed comment there is, and
  // it is the visible label the author wrote under the picture. Copying it to
  // `caption` is explicitly permitted; keeping *both* would print the same
  // words twice in every renderer that falls back from one to the other.
  const caption = captionFor(el);
  const link = enclosingLink(el, ctx);

  if (!standalone) {
    return makeGroupedImage({ src, ...(caption ? { caption } : {}), ...(link ? { link } : {}) });
  }

  return makeImage({
    src,
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
      out.push(node);
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
  const planned = planDataTable(grid);

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
  ctx.tables.push({ tableId: el.id, classification: classification.class, emittedTable: false, failure });

  if (classification.class === "DATA") {
    // A DATA verdict that cannot be expressed as a table is a classification
    // finding, not a formatting detail: rows and columns are about to be lost.
    ctx.ledger.push(
      review(el.id, `classified DATA but not representable as a table (${failure}: ${detail}); emitted as flow`),
    );
    ctx.warnings.push(`${el.id}: DATA table decomposed to linear flow — ${failure}: ${detail}.`);
  } else {
    ctx.ledger.push(
      review(el.id, `classification inconclusive (${classification.reason}); emitted as linear flow`),
    );
  }
  return decomposeFrom(grid, ctx, el);
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
 * Only ever *transcribed*: a label is used when it is the dominant repeated text
 * of that column ("TAB" down a whole column of tablature links). Where the
 * column has no such label the header cell is left empty, which the validator
 * reports as an error and the ledger as a review item — the honest outcome,
 * because inventing a caption is an editorial change (§16.3). The `table.records`
 * hook is what resolves it when a model is available.
 */
function synthesizeHeader(plan: LogicalTablePlan, ctx: Ctx): TableRow | null {
  const row: TableRow = { type: "tableRow", children: [] };
  for (let band = 0; band < plan.bands.length; band += 1) {
    const label = dominantLabel(plan.body.map((r) => r.cells[band] as PlannedCell));
    row.children.push({
      type: "tableCell",
      children: label ? [{ type: "text", value: label }] : [],
    });
  }
  if (row.children.every((c) => c.children.length === 0)) {
    // Not a single column has a recurring label. Emitting an entirely blank
    // header row helps nobody; leave it to the review path.
    ctx.warnings.push("table has neither a source header nor any recurring column label");
    return null;
  }
  return row;
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
 * A layout or catalog region.
 *
 * Under `simplified` this flattens to linear reading order. `columns` is
 * emitted only under `faithful`, and only for a genuine two- or three-lane
 * structure — never to imitate a width.
 */
function layoutFrom(
  grid: TableGrid,
  ctx: Ctx,
  el: LadomNode,
  classification: Classification,
): BiomdContent[] {
  if (ctx.options.layoutFidelity === "faithful" && grid.cols >= 2 && grid.cols <= 3 && grid.rows >= 1) {
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
    for (let r = 0; r < grid.rows; r += 1) {
      const columns = [];
      for (let c = 0; c < grid.cols; c += 1) {
        const slot = grid.slots[r]?.[c];
        if (!slot?.isOrigin) continue;
        const cell = grid.cells.find((x) => x.id === slot.originId);
        if (!cell) continue;
        ctx.boundedDepth += 1;
        const inner = blocksFrom(cell.node, ctx);
        ctx.boundedDepth -= 1;
        const cells = inner.filter(isBounded);
        if (cells.length > 0) columns.push(makeColumn(cells));
      }
      if (columns.length >= 2) {
        regions.push(makeColumns({ children: columns, profile: ctx.options.profile }));
        lanedRows += 1;
        continue;
      }
      // A row with one populated cell is not a two-lane region — a spanning
      // heading, a spacer row, a footnote under the grid. Its content belongs in
      // the flow, and wrapping it in a one-lane `columns` would claim a layout
      // the author did not draw.
      for (const column of columns) regions.push(...(column.children as BiomdContent[]));
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
 * §6: "do not wrap … long body prose".
 *
 * The one absolute number in the alignment family, and it is a *spec* limit
 * rather than a tuned one: it separates a label from an article, and both
 * alignment rules read it so the two cannot disagree about where that line is.
 * Every block the references wrap in `::: align` is comfortably under it.
 */
export const ALIGN_LABEL_MAX_CHARS = 120;

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
  const inner = blocksFrom(node, ctx).filter(isBounded);
  ctx.frameDepth -= 1;
  ctx.boundedDepth -= 1;
  if (inner.length === 0) return [];

  // A target that cannot draw the border gets a blockquote and a recorded
  // downgrade, not a container that renders as nothing.
  const lowered = downgradeNotice(ctx.options.profile, { frame: evidence.frame, children: inner });
  ctx.downgrades.push(...lowered.transforms);
  ctx.ledger.push(emitted(node.id, nextId(ctx, "frame"), { note: evidence.reason }));
  return lowered.content;
}

/** Emit a grid's cells in reading order, row-major, origin cells only. */
function decomposeFrom(grid: TableGrid, ctx: Ctx, el: LadomNode, alreadyLedgered = false): BiomdContent[] {
  const out: BiomdContent[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < grid.rows; r += 1) {
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
      out.push(...framedCell(cell.node, ctx));
    }
  }

  if (!alreadyLedgered) ctx.ledger.push(mergedInto(el.id, nextId(ctx, "flow")));
  // Entry labels only become visible once the lanes are back in reading order,
  // so the promotion has to run on the flattened region rather than per cell.
  return bindCaptions(promoteSectionAfterRule(promoteLabelBeforeList(promoteEntryDates(out, ctx), ctx), ctx), ctx);
}

/**
 * Promote the first substantial paragraph to `::: lead` when the source marked
 * it as an introduction.
 *
 * Deliberately conservative: a lead is a genuine introductory summary, not
 * merely the first paragraph.
 */
/**
 * §2: "Every document MUST have exactly one level-one heading."
 *
 * Treated as a planning invariant rather than a validator finding. Waiting for
 * the validator to report `h1-count` produces a file that is written, looks
 * plausible, and is invalid — and on a thousand-page batch nobody reads the
 * report. Typographic recovery cannot guarantee the invariant on its own: a
 * page whose title is split over two lines nominates neither line, and a page
 * with two equally large labels nominates both.
 *
 * The repair is the smallest one that satisfies the rule: the first heading in
 * reading order becomes the title, every later `#` becomes `##`, and nothing
 * is invented. A document with no heading at all is left alone — there is
 * nothing to promote, and the review item already says so.
 */
export function enforceSingleTitle(root: BiomdRoot): { root: BiomdRoot; changes: string[] } {
  const changes: string[] = [];
  const headings: Array<{ node: { depth: number; type: string }; index: number }> = [];
  const visit = (nodes: BiomdContent[]): void => {
    nodes.forEach((node) => {
      if (node.type === "heading") headings.push({ node, index: headings.length });
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
    for (const extra of titles.slice(1)) {
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
