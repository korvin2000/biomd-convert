/**
 * LADOM — the Layout-Annotated DOM.
 *
 * A parsed element tree carrying, per node: source provenance, the presentational
 * attributes that survive S1, and — once the measurement stage has run — real
 * geometry and resolved computed style from a browser.
 *
 * Geometry is optional throughout. The pipeline degrades to attribute-only
 * heuristics when measurement is unavailable and records that it did, rather
 * than pretending it has evidence it does not have.
 */

export interface SourceSpan {
  /** Offsets into the decoded, quarantined string. */
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCol: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The computed-style subset that carries layout meaning for this corpus. */
export interface ResolvedStyle {
  display: string;
  position: string;
  float: string;
  textAlign: string;
  verticalAlign: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  borderStyle: string;
  /** Top border colour, the palette evidence for a semantic frame (§12). */
  borderColor: string;
  paddingTop: number;
  paddingLeft: number;
  marginTop: number;
  marginLeft: number;
  whiteSpace: string;
  overflow: string;
  visibility: string;
}

export interface NodeMetrics {
  /** Length of descendant text, whitespace-collapsed. */
  textLen: number;
  links: number;
  images: number;
  /** Depth below this node. */
  depth: number;
}

export interface GridPosition {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface CorpusSignal {
  /** Structural fingerprint of this subtree. */
  fingerprint: string;
  /** Fraction of corpus pages carrying an identical fingerprint, 0..1. */
  frequency: number;
  /** True when the visible text is also near-identical across those pages. */
  textStable: boolean;
}

export type LadomNodeKind = "element" | "text" | "comment";

export interface LadomNode {
  /** Stable path, e.g. `/html/body/table[2]/tr[1]/td[3]`. Matches hast and the browser. */
  id: string;
  kind: LadomNodeKind;
  /** Lowercase tag name for elements; empty for text and comments. */
  tag: string;
  attrs: Record<string, string>;
  /** Text content for `text` and `comment` nodes. */
  value?: string;
  src: SourceSpan | null;
  /** True when the parser implied this node; it has no source backing. */
  synthetic: boolean;

  box?: Box;
  style?: ResolvedStyle;
  /** Undefined until measured. Attribute-based fallback sets it heuristically. */
  visible?: boolean;

  metrics: NodeMetrics;
  grid?: GridPosition;
  corpus?: CorpusSignal;

  parent: LadomNode | null;
  children: LadomNode[];
}

export interface LadomDocument {
  root: LadomNode;
  /** Every node by id, for O(1) provenance lookup. */
  index: Map<string, LadomNode>;
  /** True when Stage 3 supplied real geometry. */
  measured: boolean;
  warnings: string[];
}

/** Depth-first pre-order iteration. */
export function* walk(node: LadomNode): Generator<LadomNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** Depth-first iteration restricted to elements. */
export function* walkElements(node: LadomNode): Generator<LadomNode> {
  for (const n of walk(node)) if (n.kind === "element") yield n;
}

export function findFirst(node: LadomNode, tag: string): LadomNode | null {
  for (const n of walkElements(node)) if (n.tag === tag) return n;
  return null;
}

/** Collapse-whitespace text content of a subtree. */
export function textOf(node: LadomNode): string {
  let out = "";
  for (const n of walk(node)) {
    if (n.kind === "text") out += n.value ?? "";
    else if (n.kind === "element" && (n.tag === "br" || BLOCK_TAGS.has(n.tag))) out += " ";
  }
  return out.replace(/\s+/gu, " ").trim();
}

/**
 * Text of a subtree with source line breaks intact.
 *
 * The collapsing variant above is right for comparison and display, but the
 * lexicon and the de-hyphenation cascade both depend on knowing where a source
 * line ended — collapse it and a wrapped word becomes indistinguishable from a
 * genuine dash.
 */
export function rawTextOf(node: LadomNode): string {
  let out = "";
  for (const n of walk(node)) {
    if (n.kind === "text") out += n.value ?? "";
    else if (n.kind === "element" && (n.tag === "br" || BLOCK_TAGS.has(n.tag))) out += "\n";
  }
  return out;
}

export const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "center", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** Elements that never carry content meaning on their own. */
export const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
