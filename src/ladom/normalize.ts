/**
 * Stage 4 — normalize / desugar.
 *
 * Runs *after* measurement, which is what makes it safe to throw away
 * presentational markup: the information it carried has already been read off
 * the rendered page and attached to the nodes as geometry and computed style.
 *
 * Every removal is recorded. "Simpler" must never mean "quietly shorter".
 */
import { computeMetrics } from "./parse.js";
import { type LadomNode, textOf, walk, walkElements } from "./types.js";

export interface NormalizeRecord {
  id: string;
  tag: string;
  action: "unwrap" | "remove";
  reason: string;
  /** Text that moved to the parent (unwrap) or was discarded (remove). */
  text: string;
}

export interface NormalizeResult {
  records: NormalizeRecord[];
  /** Style facts folded onto nodes from presentational tags. */
  foldedStyles: number;
  warnings: string[];
}

/** Purely presentational wrappers: their children keep the meaning. */
const PRESENTATIONAL = new Set(["font", "center", "big", "small", "tt", "nobr", "basefont"]);

/** Inline emphasis that carries meaning and must survive as emphasis. */
const SEMANTIC_INLINE = new Set(["b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "code"]);

/**
 * Void elements that mean something without occupying space.
 *
 * They must never be caught by the measured-invisible rule: a browser
 * legitimately reports zero extent for them, and they are content.
 */
const STRUCTURAL_VOID = new Set(["br", "wbr", "hr", "area", "col", "source", "track"]);

export interface NormalizeOptions {
  /** Treat a node as invisible when measurement said so. Default true. */
  useGeometry?: boolean;
}

export function normalize(root: LadomNode, options: NormalizeOptions = {}): NormalizeResult {
  const useGeometry = options.useGeometry ?? true;
  const records: NormalizeRecord[] = [];
  const warnings: string[] = [];
  let foldedStyles = 0;

  // 1 — fold presentational tags into style evidence on the node itself, then
  // unwrap them. `<font size=2 color=red>` has already been resolved into
  // computed style by the browser; the tag itself is now noise.
  for (const el of [...walkElements(root)]) {
    if (!PRESENTATIONAL.has(el.tag)) continue;
    if (el.tag === "center") {
      // Record the alignment intent on the parent before discarding the tag.
      annotate(el, "data-fold-align", "center");
    }
    const size = el.attrs["size"];
    const color = el.attrs["color"];
    if (size) annotate(el, "data-fold-font-size", size);
    if (color) annotate(el, "data-fold-color", color);
    foldedStyles += 1;
    records.push({ id: el.id, tag: el.tag, action: "unwrap", reason: "presentational wrapper", text: "" });
    unwrap(el);
  }

  // 2 — remove spacers and ornaments. A 1x1 GIF, a zero-area node and an
  // nbsp-only cell carry no content; they exist to push pixels around.
  for (const el of [...walkElements(root)]) {
    if (el.parent === null) continue;

    if (el.tag === "img" && isSpacerImage(el, useGeometry)) {
      records.push({ id: el.id, tag: el.tag, action: "remove", reason: "spacer or ornament image", text: "" });
      detach(el);
      continue;
    }

    // Measured-invisible removal applies to *containers* only.
    //
    // A `<br>` has zero width by construction, so a browser reports it as
    // having no visual extent — but it is the line structure, not scaffolding.
    // Deleting it here would mean that turning measurement on silently
    // destroyed every hard break in the corpus, which is the worst shape a bug
    // can take: invisible, and worse in the better-configured run.
    if (
      useGeometry &&
      el.visible === false &&
      el.metrics.textLen === 0 &&
      el.metrics.images === 0 &&
      !STRUCTURAL_VOID.has(el.tag)
    ) {
      records.push({ id: el.id, tag: el.tag, action: "remove", reason: "measured invisible and empty", text: "" });
      detach(el);
      continue;
    }

    if ((el.tag === "p" || el.tag === "div") && isEffectivelyEmpty(el)) {
      records.push({ id: el.id, tag: el.tag, action: "remove", reason: "empty block", text: "" });
      detach(el);
    }
  }

  // 3 — unwrap wrapper tables. A single-cell, borderless, background-free table
  // is a layout scaffold, not a table; keeping it would create a spurious
  // classification target.
  for (const el of [...walkElements(root)]) {
    if (el.tag !== "table" || el.parent === null) continue;
    if (!isWrapperTable(el)) continue;
    records.push({ id: el.id, tag: el.tag, action: "unwrap", reason: "single-cell layout wrapper", text: "" });
    unwrapTable(el);
  }

  // 4 — collapse redundant nesting: a div/span whose only child is another
  // div/span with no attributes of its own.
  for (const el of [...walkElements(root)]) {
    if (el.parent === null) continue;
    if (el.tag !== "div" && el.tag !== "span") continue;
    if (Object.keys(el.attrs).length > 0) continue;
    const kids = el.children.filter((c) => c.kind !== "text" || (c.value ?? "").trim() !== "");
    if (kids.length !== 1) continue;
    const only = kids[0];
    if (!only || only.kind !== "element") continue;
    if (only.tag !== "div" && only.tag !== "span") continue;
    records.push({ id: el.id, tag: el.tag, action: "unwrap", reason: "redundant wrapper", text: "" });
    unwrap(el);
  }

  computeMetrics(root);
  return { records, foldedStyles, warnings };
}

function annotate(el: LadomNode, key: string, value: string): void {
  // Fold onto the parent so the fact survives the unwrap.
  const target = el.parent ?? el;
  if (!(key in target.attrs)) target.attrs[key] = value;
}

function isSpacerImage(el: LadomNode, useGeometry: boolean): boolean {
  const src = (el.attrs["src"] ?? "").toLowerCase();
  if (/(?:^|\/)(?:spacer|blank|pixel|dot|clear|1x1|shim)[\w.-]*\.(?:gif|png|jpg)$/u.test(src)) return true;

  const w = Number.parseInt(el.attrs["width"] ?? "", 10);
  const h = Number.parseInt(el.attrs["height"] ?? "", 10);
  if (Number.isFinite(w) && Number.isFinite(h) && (w <= 2 || h <= 2)) return true;

  if (useGeometry && el.box) {
    if (el.box.w <= 2 || el.box.h <= 2) return true;
  }
  // Without geometry and without a declared size, an image with alt text and a
  // meaningful name is content; assume content rather than delete it.
  return false;
}

function isEffectivelyEmpty(el: LadomNode): boolean {
  if (el.metrics.images > 0 || el.metrics.links > 0) return false;
  const text = textOf(el);
  // U+00A0 and friends used purely as indentation are not content.
  return text.replace(/[\s   ]+/gu, "") === "";
}

function isWrapperTable(table: LadomNode): boolean {
  const border = Number.parseInt(table.attrs["border"] ?? "0", 10);
  if (Number.isFinite(border) && border > 0) return false;
  if (table.attrs["bgcolor"] || table.attrs["background"]) return false;
  if (table.style && (table.style.borderTopWidth > 0 || table.style.backgroundImage !== "none")) return false;

  let rows = 0;
  let cells = 0;
  for (const el of walkElements(table)) {
    if (el === table) continue;
    // Only this table's own rows/cells.
    let nearest: LadomNode | null = el.parent;
    while (nearest && nearest.tag !== "table") nearest = nearest.parent;
    if (nearest !== table) continue;
    if (el.tag === "tr") rows += 1;
    if (el.tag === "td" || el.tag === "th") cells += 1;
  }
  return rows === 1 && cells === 1;
}

function unwrap(el: LadomNode): void {
  const parent = el.parent;
  if (!parent) return;
  const at = parent.children.indexOf(el);
  if (at < 0) return;
  for (const child of el.children) child.parent = parent;
  parent.children.splice(at, 1, ...el.children);
  el.parent = null;
  el.children = [];
}

/** Replace a wrapper table with the contents of its single cell. */
function unwrapTable(table: LadomNode): void {
  const cell = [...walkElements(table)].find((e) => e.tag === "td" || e.tag === "th");
  const parent = table.parent;
  if (!cell || !parent) return;
  const at = parent.children.indexOf(table);
  if (at < 0) return;
  for (const child of cell.children) child.parent = parent;
  parent.children.splice(at, 1, ...cell.children);
  table.parent = null;
}

function detach(node: LadomNode): void {
  const parent = node.parent;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parent = null;
}

/**
 * Decode HTML entities exactly once.
 *
 * parse5 has already decoded them during tokenization; this exists so that
 * *later* passes can assert they are not decoding a second time. Double
 * decoding turns `&amp;lt;` into `<` and silently changes content.
 */
export function assertNoDoubleDecoding(root: LadomNode): string[] {
  const suspicious: string[] = [];
  for (const node of walk(root)) {
    if (node.kind !== "text") continue;
    const value = node.value ?? "";
    if (/&(?:amp|lt|gt|quot|nbsp|#\d+);/u.test(value)) {
      suspicious.push(
        `Text at ${node.id} still contains an entity-like sequence after parsing; it was probably ` +
          "double-escaped in the source and must not be decoded again.",
      );
    }
  }
  return suspicious;
}
