/**
 * `.bio.md` → comparable facts.
 *
 * The point of this module is to compare two documents by what a *reader*
 * receives, not by how they are spelled. Two conversions that differ in cell
 * padding, property order or line wrapping are the same document; two that
 * differ by a missing table are not.
 *
 * It reads with {@link read}, the same directive parser the conformance suite
 * uses, so a difference the target renderer would not see never shows up as a
 * score difference.
 */
import { type DirectiveBlock, type SkeletonNode, read } from "../biomd-ast/read.js";

export interface TableFacts {
  /** Column count, taken from the header row. */
  cols: number;
  /** Body rows, excluding the header and the delimiter. */
  rows: number;
  /** Header cell labels, normalized. */
  header: string[];
  /** Every non-empty body cell, normalized, in reading order. */
  cells: string[];
}

export interface DocumentFacts {
  /** Visible prose, directive property values that a reader sees included. */
  text: string;
  /** `depth\tlabel` for every heading. */
  headings: string[];
  /** Link destinations, in document order. */
  links: string[];
  /** Image sources, from both Markdown images and `::: image` / `::: images`. */
  images: string[];
  /** Directive name → occurrences. */
  directives: Map<string, number>;
  tables: TableFacts[];
}

const HEADING = /^(#{1,6})\s+(.*)$/u;
const SETEXT_UNDERLINE = /^\s*(?:={2,}|-{2,})\s*$/u;
const IMAGE_INLINE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const LINK_INLINE = /(?<!!)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

/** Fold a label to its comparable core: case, punctuation and spacing are noise. */
export function foldLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/­/gu, "")
    .replace(/[*_`~]/gu, "")
    .replace(/(\p{L})[-‐‑–—]\s*(\p{L})/gu, "$1$2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Fold a target so two spellings of one destination compare equal.
 *
 * `/pages/music/x.mp3`, `music/x.mp3` and `./music/x.mp3` all denote the same
 * resource; the resource base is a rendering decision, not content. In-app
 * routes keep their slug because that *is* the identity.
 */
export function foldTarget(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.startsWith("/#/")) return v.replace(/^\/#\//u, "#/");
  if (/^[a-z][a-z\d+.-]*:/u.test(v) || v.startsWith("//")) return v.replace(/\/+$/u, "");
  v = v.replace(/^\.\//u, "").replace(/^\/+/u, "");
  v = v.replace(/^pages\//u, "");
  return v;
}

export function extractFacts(source: string): DocumentFacts {
  const skeleton = read(source);
  const facts: DocumentFacts = {
    text: "",
    headings: [],
    links: [],
    images: [],
    directives: new Map(),
    tables: [],
  };
  const textParts: string[] = [];
  visit(skeleton.children, facts, textParts);
  facts.text = textParts.join("\n");
  return facts;
}

function visit(nodes: readonly SkeletonNode[], facts: DocumentFacts, textParts: string[]): void {
  for (const node of nodes) {
    if (node.kind === "directive") {
      facts.directives.set(node.name, (facts.directives.get(node.name) ?? 0) + 1);
      collectDirectiveProps(node, facts, textParts);
      visit(node.children, facts, textParts);
      continue;
    }
    readMarkdown(node.value, facts, textParts);
  }
}

/** Property values that are visible to a reader, or that identify a resource. */
function collectDirectiveProps(node: DirectiveBlock, facts: DocumentFacts, textParts: string[]): void {
  const src = node.props["src"];
  if (src) {
    if (node.name === "document") facts.links.push(src);
    else facts.images.push(src);
  }
  const link = node.props["link"];
  if (link) facts.links.push(link);
  for (const key of ["caption", "title", "alt", "active"]) {
    const value = node.props[key];
    if (value) textParts.push(value);
  }
}

/** Scan one Markdown island. Tables are line-structured, so a line scan suffices. */
function readMarkdown(value: string, facts: DocumentFacts, textParts: string[]): void {
  const lines = value.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;

    if (isTableRow(line) && isDelimiterRow(lines[i + 1] ?? "")) {
      const consumed = readTable(lines, i, facts, textParts);
      i = consumed - 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const label = foldLabel(stripInline(heading[2] as string));
      if (label !== "") facts.headings.push(`${(heading[1] as string).length}\t${label}`);
    } else if (SETEXT_UNDERLINE.test(lines[i + 1] ?? "") && line.trim() !== "" && !isTableRow(line)) {
      // A multi-line heading serializes as setext; it is still a heading.
      const label = foldLabel(stripInline(line));
      if (label !== "") facts.headings.push(`${(lines[i + 1] as string).trim().startsWith("=") ? 1 : 2}\t${label}`);
    }

    collectInline(line, facts);
    textParts.push(line);
  }
}

/** Reads a GFM table starting at `start`; returns the index just past it. */
function readTable(lines: string[], start: number, facts: DocumentFacts, textParts: string[]): number {
  const header = splitRow(lines[start] as string);
  const cells: string[] = [];
  let row = start + 2;
  let bodyRows = 0;

  for (; row < lines.length; row += 1) {
    const line = lines[row] as string;
    if (!isTableRow(line)) break;
    bodyRows += 1;
    for (const cell of splitRow(line)) {
      collectInline(cell, facts);
      textParts.push(cell);
      const folded = foldLabel(stripInline(cell));
      if (folded !== "" && folded !== "—" && folded !== "-") cells.push(folded);
    }
  }

  for (const cell of header) {
    collectInline(cell, facts);
    textParts.push(cell);
  }

  facts.tables.push({
    cols: header.length,
    rows: bodyRows,
    header: header.map((h) => foldLabel(stripInline(h))),
    cells,
  });
  return row;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.length > 1;
}

function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  return /^\|(?:\s*:?-{1,}:?\s*\|)+$/u.test(t);
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  // A `\|` is an escaped pipe inside a cell, not a separator.
  return t
    .split(/(?<!\\)\|/u)
    .map((c) => c.replace(/\\\|/gu, "|").trim());
}

function collectInline(text: string, facts: DocumentFacts): void {
  for (const match of text.matchAll(IMAGE_INLINE)) facts.images.push(match[2] as string);
  for (const match of text.matchAll(LINK_INLINE)) facts.links.push(match[2] as string);
}

/** Drop Markdown syntax, keeping the words a reader sees. */
export function stripInline(text: string): string {
  return text
    .replace(IMAGE_INLINE, "$1")
    .replace(LINK_INLINE, "$1")
    .replace(/[*_`~]/gu, "")
    .replace(/\\(.)/gu, "$1");
}

/** Visible prose of a whole document, for the shingle comparison. */
export function visibleText(facts: DocumentFacts): string {
  return stripInline(facts.text)
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*-{3,}\s*$/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
