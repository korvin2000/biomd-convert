/**
 * HTML → LADOM.
 *
 * The HTML5 tree-construction algorithm *is* the error-recovery specification:
 * implied end tags, foster parenting of misnested table content, the adoption
 * agency algorithm. Running a spec-compliant parser over malformed legacy
 * markup is what "repair" means here — there is no separate cleanup tool, and
 * introducing one (HTML Tidy) would reformat toward a doctype and destroy the
 * presentational evidence the pipeline exists to read.
 *
 * parse5 is used directly rather than through rehype: it already produces
 * source locations and a spec tree, and the extra hast conversion would buy
 * nothing this pipeline uses.
 */
import { parse, parseFragment, serialize as serializeParse5 } from "parse5";
import type { DefaultTreeAdapterMap, ParserError } from "parse5";
import { type LadomDocument, type LadomNode, type NodeMetrics, type SourceSpan } from "./types.js";

type P5Node = DefaultTreeAdapterMap["node"];
type P5Element = DefaultTreeAdapterMap["element"];
type P5Parent = DefaultTreeAdapterMap["parentNode"];

export interface ParseResult extends LadomDocument {
  /** Parse errors reported by the tree builder, evidence of how bad the source was. */
  errors: ParseErrorRecord[];
  /** Re-serialized, structurally repaired HTML. A retained deliverable. */
  repairedHtml: string;
}

export interface ParseErrorRecord {
  code: string;
  startLine: number;
  startCol: number;
  startOffset: number;
}

export interface ParseOptions {
  /** Parse as a fragment rather than a full document. */
  fragment?: boolean;
}

function isElement(node: P5Node): node is P5Element {
  return "tagName" in node;
}

function hasChildren(node: P5Node): node is P5Node & P5Parent {
  return "childNodes" in node;
}

function spanOf(node: P5Node): SourceSpan | null {
  const loc = (node as { sourceCodeLocation?: unknown }).sourceCodeLocation as
    | { startOffset: number; endOffset: number; startLine: number; startCol: number }
    | undefined
    | null;
  if (!loc) return null;
  return {
    startOffset: loc.startOffset,
    endOffset: loc.endOffset,
    startLine: loc.startLine,
    startCol: loc.startCol,
  };
}

/**
 * Build a stable, browser-reproducible path.
 *
 * The same expression can be evaluated inside the page during measurement, so
 * geometry lines up with the tree by construction rather than by heuristic
 * matching. Indices are 1-based and per-tag, matching XPath conventions.
 */
function childPath(parentPath: string, tag: string, indexAmongSameTag: number): string {
  return `${parentPath}/${tag}[${indexAmongSameTag}]`;
}

export function parseHtml(source: string, options: ParseOptions = {}): ParseResult {
  const errors: ParseErrorRecord[] = [];
  const onParseError = (error: ParserError): void => {
    errors.push({
      code: error.code,
      startLine: error.startLine,
      startCol: error.startCol,
      startOffset: error.startOffset,
    });
  };

  const p5doc = options.fragment
    ? parseFragment(source, { sourceCodeLocationInfo: true, onParseError, scriptingEnabled: false })
    : parse(source, { sourceCodeLocationInfo: true, onParseError, scriptingEnabled: false });

  const index = new Map<string, LadomNode>();
  const warnings: string[] = [];

  const root: LadomNode = {
    id: "",
    kind: "element",
    tag: "#root",
    attrs: {},
    src: null,
    synthetic: true,
    metrics: { textLen: 0, links: 0, images: 0, depth: 0 },
    parent: null,
    children: [],
  };
  index.set("", root);

  const convertChildren = (p5parent: P5Node, parent: LadomNode): void => {
    if (!hasChildren(p5parent)) return;
    const tagCounts = new Map<string, number>();

    for (const child of p5parent.childNodes) {
      const nodeName = child.nodeName;

      if (nodeName === "#text") {
        const value = (child as { value: string }).value;
        // Preserve whitespace-only text: it separates inline runs and is the
        // difference between "wordword" and "word word" after folding.
        const node: LadomNode = {
          id: childPath(parent.id, "#text", (tagCounts.get("#text") ?? 0) + 1),
          kind: "text",
          tag: "",
          attrs: {},
          value,
          src: spanOf(child),
          synthetic: spanOf(child) === null,
          metrics: { textLen: value.replace(/\s+/gu, " ").trim().length, links: 0, images: 0, depth: 0 },
          parent,
          children: [],
        };
        tagCounts.set("#text", (tagCounts.get("#text") ?? 0) + 1);
        parent.children.push(node);
        index.set(node.id, node);
        continue;
      }

      if (nodeName === "#comment") {
        const value = (child as { data: string }).data;
        const node: LadomNode = {
          id: childPath(parent.id, "#comment", (tagCounts.get("#comment") ?? 0) + 1),
          kind: "comment",
          tag: "",
          attrs: {},
          value,
          src: spanOf(child),
          synthetic: false,
          metrics: { textLen: 0, links: 0, images: 0, depth: 0 },
          parent,
          children: [],
        };
        tagCounts.set("#comment", (tagCounts.get("#comment") ?? 0) + 1);
        parent.children.push(node);
        index.set(node.id, node);
        continue;
      }

      if (nodeName === "#documentType") continue;

      if (!isElement(child)) {
        if (hasChildren(child)) convertChildren(child, parent);
        continue;
      }

      const tag = child.tagName.toLowerCase();
      const count = (tagCounts.get(tag) ?? 0) + 1;
      tagCounts.set(tag, count);

      const attrs: Record<string, string> = {};
      for (const attr of child.attrs) {
        // Duplicate attributes: the tree builder already kept the first, which
        // is what a browser does. Recorded rather than silently ignored.
        const name = attr.name.toLowerCase();
        if (name in attrs) {
          warnings.push(`Duplicate attribute ${JSON.stringify(name)} on <${tag}>; first value kept.`);
          continue;
        }
        attrs[name] = attr.value;
      }

      const src = spanOf(child);
      const node: LadomNode = {
        id: childPath(parent.id, tag, count),
        kind: "element",
        tag,
        attrs,
        src,
        // A node with no start-tag location was implied by the tree builder —
        // <tbody>, a reopened <p>, foster-parented content.
        synthetic:
          src === null ||
          (child as { sourceCodeLocation?: { startTag?: unknown } }).sourceCodeLocation?.startTag === undefined,
        metrics: { textLen: 0, links: 0, images: 0, depth: 0 },
        parent,
        children: [],
      };
      parent.children.push(node);
      index.set(node.id, node);
      convertChildren(child, node);
    }
  };

  convertChildren(p5doc as P5Node, root);
  computeMetrics(root);

  return {
    root,
    index,
    measured: false,
    warnings,
    errors,
    repairedHtml: serializeParse5(p5doc as never),
  };
}

/** Roll subtree metrics up from the leaves. */
export function computeMetrics(node: LadomNode): NodeMetrics {
  let textLen = 0;
  let links = 0;
  let images = 0;
  let depth = 0;

  if (node.kind === "text") {
    textLen = (node.value ?? "").replace(/\s+/gu, " ").trim().length;
  }
  if (node.kind === "element") {
    if (node.tag === "a" && typeof node.attrs["href"] === "string") links += 1;
    if (node.tag === "img") images += 1;
  }

  for (const child of node.children) {
    const m = computeMetrics(child);
    textLen += m.textLen;
    links += m.links;
    images += m.images;
    depth = Math.max(depth, m.depth + 1);
  }

  node.metrics = { textLen, links, images, depth };
  return node.metrics;
}

/**
 * Re-serialize a LADOM subtree back to HTML.
 *
 * Used for the sanitized-content deliverable and for handing an isolated region
 * to the browser. Deliberately minimal and escaping-correct rather than pretty.
 */
export function toHtml(node: LadomNode): string {
  if (node.kind === "text") return escapeText(node.value ?? "");
  if (node.kind === "comment") return `<!--${node.value ?? ""}-->`;

  const inner = node.children.map(toHtml).join("");
  if (node.tag === "#root") return inner;

  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");

  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

function escapeText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}
