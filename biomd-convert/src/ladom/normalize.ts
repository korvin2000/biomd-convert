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
  action: "unwrap" | "remove" | "keep";
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
    // A size declared on *part* of a line says "this run is set differently
    // from the rest of the line". Folding that onto the parent asserts it of
    // the whole line, which is false, and the unwrap then erases the only
    // record of where the distinction began and ended. Keep the wrapper and
    // record the evidence on itself instead: it stays an inline element, so
    // nothing downstream sees a new block, and the run boundary survives.
    //
    // A wrapper that covers everything its parent covers is *not* kept, even
    // when it renders at a different size. There the fold is faithful — every
    // word of the parent is set that way — and keeping the element instead
    // makes it the innermost carrier of the text, which moves which node
    // heading recovery nominates and what size that node reports. Measured
    // corpus-wide: keeping only partial covers changes nothing on any rung;
    // keeping full covers as well costs three section headings.
    if (size !== undefined && !coversParentText(el)) {
      el.attrs["data-fold-font-size"] = size;
      if (color !== undefined) el.attrs["data-fold-color"] = color;
      foldedStyles += 1;
      records.push({ id: el.id, tag: el.tag, action: "keep", reason: "style evidence for part of a line", text: "" });
      continue;
    }
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

  // 2b — demote a `<blockquote>` that is indentation rather than quotation.
  //
  // Every WYSIWYG editor of the period offered exactly one indent button, and it
  // emitted `<blockquote>`. Taking those at face value wraps an entire article
  // in `>`, which is wrong three times over: it asserts a quotation that does
  // not exist, it prefixes every line so a `:::` directive inside it is never
  // parsed as one, and it hides the tables it contains from anything that reads
  // the output.
  const documentTextLength = visibleLength(root);
  for (const el of [...walkElements(root)]) {
    if (el.tag !== "blockquote" || el.parent === null) continue;
    const reason = indentationBlockquote(el, documentTextLength);
    if (!reason) continue;
    records.push({ id: el.id, tag: el.tag, action: "unwrap", reason, text: "" });
    unwrap(el);
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

/**
 * True when a wrapper holds everything its parent holds.
 *
 * Only then is folding the wrapper's style onto the parent a faithful
 * restatement rather than a claim about text the wrapper never covered.
 */
function coversParentText(el: LadomNode): boolean {
  const parent = el.parent;
  if (!parent) return true;
  const own = textOf(el).replace(/\s+/gu, " ").trim();
  const all = textOf(parent).replace(/\s+/gu, " ").trim();
  return own === all;
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

function visibleLength(node: LadomNode): number {
  return textOf(node).replace(/\s+/gu, " ").trim().length;
}

/**
 * Why a `<blockquote>` is indentation, or null when it is a genuine quotation.
 *
 * A quotation is *bounded*: some prose, attributed, inside a larger document.
 * The tests below all describe the opposite — a container holding the page's own
 * structure. Deliberately conservative: an ordinary indented quotation, however
 * long, trips none of them, so the `>` mapping the spec asks for (§16.1) still
 * happens where it should.
 */
function indentationBlockquote(el: LadomNode, documentTextLength: number): string | null {
  let headings = 0;
  let tables = 0;
  for (const inner of walkElements(el)) {
    if (inner === el) continue;
    if (inner.tag === "table") tables += 1;
    if (/^h[1-6]$/u.test(inner.tag)) headings += 1;
  }
  if (tables > 0) return `indentation wrapper: contains ${tables} table(s), not quoted prose`;
  if (headings > 0) return `indentation wrapper: contains ${headings} heading(s), not quoted prose`;

  const share = documentTextLength > 0 ? visibleLength(el) / documentTextLength : 0;
  if (share >= 0.35) {
    return `indentation wrapper: holds ${(share * 100).toFixed(0)}% of the document text`;
  }

  // An empty or whitespace-only blockquote is a vertical spacer.
  if (visibleLength(el) === 0 && el.metrics.images === 0) return "empty blockquote used as spacing";
  return null;
}

function isWrapperTable(table: LadomNode): boolean {
  const border = Number.parseInt(table.attrs["border"] ?? "0", 10);
  if (Number.isFinite(border) && border > 0) return false;
  if (table.attrs["bgcolor"] || table.attrs["background"]) return false;
  if (table.style && (table.style.borderTopWidth > 0 || table.style.backgroundImage !== "none")) return false;
  // A single cell that draws its own border is a notice the author boxed, not
  // an indentation wrapper. Unwrapping it discards the only evidence that the
  // block is set apart (§12) — and the table around it carries `border="0"`,
  // because the border was put on the cell.
  if (cellCarriesBorder(table)) return false;

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

function cellCarriesBorder(table: LadomNode): boolean {
  for (const el of walkElements(table)) {
    if (el.tag !== "td" && el.tag !== "th") continue;
    if (el.style && Math.min(el.style.borderTopWidth, el.style.borderLeftWidth) >= 2) return true;
    if (/(?:^|;)\s*border(?:-width)?\s*:\s*(?![0-1]\D)\d/iu.test(el.attrs["style"] ?? "")) return true;
  }
  return false;
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
