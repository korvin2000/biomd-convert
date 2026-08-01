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
import { type LadomNode, textOf } from "../ladom/types.js";
import { type Classification, classifyTable } from "./classify.js";
import {
  type LogicalTablePlan,
  type PlannedCell,
  type PlannedRow,
  cellText,
  planDataTable,
} from "./data-table.js";
import { type LinkProfile, rewriteTarget } from "./links.js";
import { type LedgerEntry, emitted, mergedInto, removed, review } from "./ledger.js";

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
   * Depth inside a bounded container (`column`, `align`, `frame`).
   *
   * §4.1 forbids `nav` there, and the bounded-content filter would drop one
   * silently — taking every link in it with it. Not emitting one is the safe
   * shape of that rule.
   */
  boundedDepth: number;
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
    boundedDepth: 0,
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

  const flushInline = (): void => {
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
    const images = inlineRun.filter((n) => n.kind === "element" && n.tag === "img");
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

    const phrasing = inlineFrom(inlineRun, ctx);
    if (phrasing.length > 0) out.push({ type: "paragraph", children: phrasing });
    inlineRun = [];
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
    out.push(...blockFrom(child, ctx));
  }

  flushInline();
  return out;
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
      ctx.ledger.push(emitted(el.id, nextId(ctx, "heading")));
      return [{ type: "heading", depth: recovered as 1 | 2 | 3 | 4 | 5 | 6, children: text }];
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
      return inner;
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
  return collapseAdjacentText(dropEmphasis(flat));
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
        out.push({ type: "link", url: rewritten.href, children: inlineFrom(node.children, ctx) });
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
        ctx.images.push(src);
        ctx.ledger.push(emitted(node.id, nextId(ctx, "img")));
        out.push({ type: "image", url: src, alt: node.attrs["alt"] ?? "" });
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

  const trimmed = cleaned.filter((n) => n.type !== "text" || n.value !== "");
  // A break at either end has nothing to separate.
  while (trimmed[0]?.type === "break") trimmed.shift();
  while (trimmed[trimmed.length - 1]?.type === "break") trimmed.pop();
  return trimmed;
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

  const alt = el.attrs["alt"];
  const link = enclosingLink(el, ctx);

  if (!standalone) {
    return makeGroupedImage({ src, ...(alt ? { alt } : {}), ...(link ? { link } : {}) });
  }

  const width = el.box?.w ?? Number.parseInt(el.attrs["width"] ?? "", 10);
  const containerWidth = findContainerWidth(el);
  const size = estimateSize(width, containerWidth);
  const position = estimatePosition(el);

  return makeImage({
    src,
    position,
    size,
    ...(alt ? { alt } : {}),
    ...(link ? { link } : {}),
  });
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

function findContainerWidth(el: LadomNode): number | undefined {
  let cur = el.parent;
  while (cur) {
    if (cur.box && cur.box.w > 0) return cur.box.w;
    cur = cur.parent;
  }
  return undefined;
}

function estimateSize(width: number | undefined, container: number | undefined): "small" | "medium" | "large" | "full" {
  if (!Number.isFinite(width) || width === undefined) return "medium";
  if (container && container > 0) {
    const share = width / container;
    if (share >= 0.85) return "full";
    if (share >= 0.45) return "large";
    if (share >= 0.12) return "medium";
    return "small";
  }
  if (width >= 500) return "full";
  if (width >= 280) return "large";
  if (width >= 100) return "medium";
  return "small";
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
  const align = el.style?.textAlign ?? el.parent?.attrs["align"];
  if (align === "center") return "center";
  return "center";
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function tableFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
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
  const phrasing = inlineFrom(nodes, ctx);
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
    const columns = [];
    for (let c = 0; c < grid.cols; c += 1) {
      const cells = [];
      for (let r = 0; r < grid.rows; r += 1) {
        const slot = grid.slots[r]?.[c];
        if (!slot?.isOrigin) continue;
        const cell = grid.cells.find((x) => x.id === slot.originId);
        if (!cell) continue;
        ctx.boundedDepth += 1;
        const inner = blocksFrom(cell.node, ctx);
        ctx.boundedDepth -= 1;
        cells.push(...inner.filter(isBounded));
      }
      if (cells.length > 0) columns.push(makeColumn(cells));
    }
    if (columns.length >= 2 && columns.length <= 3) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "columns"), { confidence: classification.confidence }));
      ctx.tables.push({
        tableId: el.id,
        classification: classification.class,
        emittedTable: false,
        failure: "emitted-as-columns",
      });
      return [makeColumns({ children: columns, profile: ctx.options.profile })];
    }
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
      out.push(...blocksFrom(cell.node, ctx));
    }
  }

  if (!alreadyLedgered) ctx.ledger.push(mergedInto(el.id, nextId(ctx, "flow")));
  return out;
}

/**
 * Promote the first substantial paragraph to `::: lead` when the source marked
 * it as an introduction.
 *
 * Deliberately conservative: a lead is a genuine introductory summary, not
 * merely the first paragraph.
 */
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
