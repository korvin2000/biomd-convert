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
  resolveListMarkerPadding,
} from "../biomd-ast/index.js";
import { type GridCell, type TableGrid, rowCells } from "../ladom/grid.js";
import { type LadomNode, textOf } from "../ladom/types.js";
import { type Classification, classifyTable } from "./classify.js";
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
}

export interface StructureResult {
  root: BiomdRoot;
  ledger: LedgerEntry[];
  downgrades: DowngradeRecord[];
  /** Targets emitted, for the conservation gate. */
  targets: string[];
  images: string[];
  warnings: string[];
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
  };

  const children = blocksFrom(root, ctx);
  return {
    root: { type: "root", children },
    ledger: ctx.ledger,
    downgrades: ctx.downgrades,
    targets: ctx.targets,
    images: ctx.images,
    warnings: ctx.warnings,
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

const INLINE_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "code", "span",
  "img", "br", "small", "big", "font", "tt", "abbr", "cite", "q", "mark",
]);

function isInline(node: LadomNode): boolean {
  return node.kind === "element" && INLINE_TAGS.has(node.tag);
}

/** Convert one block-level element. */
function blockFrom(el: LadomNode, ctx: Ctx): BiomdContent[] {
  const depth = HEADING_TAGS[el.tag];
  if (depth !== undefined) {
    const text = inlineFrom(el.children, ctx);
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
      case "strong":
        out.push({ type: "strong", children: inlineFrom(node.children, ctx) });
        break;
      case "i":
      case "em":
        out.push({ type: "emphasis", children: inlineFrom(node.children, ctx) });
        break;
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

function collapseAdjacentText(nodes: PhrasingContent[]): PhrasingContent[] {
  const merged: PhrasingContent[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    if (node.type === "text" && last?.type === "text") {
      last.value += node.value;
      continue;
    }
    merged.push(node);
  }

  // Whitespace sitting directly against a hard break is source indentation, not
  // content. Left in place it serializes as an escaped `&#x20;`, which is both
  // ugly and a spurious difference in any later diff.
  const cleaned: PhrasingContent[] = [];
  merged.forEach((node, index) => {
    if (node.type === "text" && node.value.trim() === "") {
      const before = merged[index - 1];
      const after = merged[index + 1];
      if (before?.type === "break" || after?.type === "break") return;
    }
    cleaned.push(node);
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

function estimatePosition(el: LadomNode): "left" | "right" | "center" | "full" {
  const float = el.style?.float ?? el.attrs["align"];
  if (float === "left") return "left";
  if (float === "right") return "right";
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
      return [];

    case "DATA": {
      const table = dataTableFrom(grid, ctx);
      if (table) {
        ctx.ledger.push(emitted(el.id, nextId(ctx, "table"), { confidence: classification.confidence }));
        return [table];
      }
      // A DATA verdict that cannot be expressed as a GFM table means the cells
      // want block content — which is the definition of HYBRID, not DATA.
      ctx.warnings.push(
        `${el.id}: classified DATA but cells require block content; emitting as sections instead (C1).`,
      );
      return decomposeFrom(grid, ctx, el);
    }

    case "CATALOG":
    case "LAYOUT":
    case "HYBRID":
      return layoutFrom(grid, ctx, el, classification);

    case "UNKNOWN":
    default:
      ctx.ledger.push(
        review(el.id, `classification inconclusive (${classification.reason}); emitted as linear flow`),
      );
      return decomposeFrom(grid, ctx, el);
  }
}

/**
 * A GFM table, or null when the content will not fit one.
 *
 * C1: cells are inline-only. Rather than silently flattening block content into
 * a cell — which loses lists and produces unreadable output — this returns null
 * and lets the caller decompose.
 */
function dataTableFrom(grid: TableGrid, ctx: Ctx): Table | null {
  if (grid.rows < 2 || grid.cols < 1) return null;

  const rows: TableRow[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const cells = rowCells(grid, r);
    if (cells.length === 0) continue;
    const rowNode: TableRow = { type: "tableRow", children: [] };

    for (const cell of cells) {
      const phrasing = inlineFrom(cell.node.children, ctx);
      // A cell containing a list or several paragraphs cannot be represented.
      if (hasBlockContent(cell)) return null;
      rowNode.children.push({ type: "tableCell", children: phrasing });
      ctx.ledger.push(emitted(cell.id, nextId(ctx, "cell")));
    }
    rows.push(rowNode);
  }

  if (rows.length < 2) return null;

  // Every row must have the header's width, or the table is ragged.
  const width = rows[0]?.children.length ?? 0;
  if (width === 0) return null;
  for (const row of rows) {
    while (row.children.length < width) row.children.push({ type: "tableCell", children: [] });
    if (row.children.length > width) row.children.length = width;
  }

  // A header must be honest. Without one, the first row is promoted only if it
  // reads like labels; otherwise the table is not a data table after all.
  const firstRow = rowCells(grid, 0);
  const headerLooksReal = firstRow.every((c) => c.isHeader) || firstRow.every((c) => c.text.length > 0 && c.text.length < 60);
  if (!headerLooksReal) return null;

  return { type: "table", align: Array.from({ length: width }, () => null), children: rows };
}

function hasBlockContent(cell: GridCell): boolean {
  for (const child of cell.node.children) {
    if (child.kind !== "element") continue;
    if (["ul", "ol", "table", "p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tag)) {
      // A single wrapping <p> is fine; more than one, or a list, is not.
      if (child.tag === "p" && cell.node.children.filter((c) => c.kind === "element" && c.tag === "p").length === 1) {
        continue;
      }
      return true;
    }
  }
  return false;
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
        if (cell) cells.push(...blocksFrom(cell.node, ctx).filter(isBounded));
      }
      if (cells.length > 0) columns.push(makeColumn(cells));
    }
    if (columns.length >= 2 && columns.length <= 3) {
      ctx.ledger.push(emitted(el.id, nextId(ctx, "columns"), { confidence: classification.confidence }));
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
