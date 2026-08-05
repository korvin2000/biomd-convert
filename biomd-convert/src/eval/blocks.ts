/**
 * `.bio.md` → a fully resolved block tree.
 *
 * `biomd-ast/read.ts` stops at the directive layer: everything between two
 * fences comes back as one opaque `MarkdownRun`. That is the right model for
 * conformance (the target hands each leaf to a separate Markdown instance) and
 * the wrong model for adjudication, because every defect that survives into
 * late-stage work lives *inside* those runs — a heading that became a
 * paragraph, a table cell that moved a column, a hard break that was dropped, a
 * quotation mark that was copyedited.
 *
 * So this module resolves a run into typed, line-numbered blocks, and resolves
 * each block's inline content into the pairs that actually carry meaning:
 * link label ↔ target, image alt ↔ src, emphasis spans. It is a parser for the
 * subset of CommonMark + GFM that `Biography-Markup.md` §4.1 admits, not a
 * general one, and it deliberately keeps the things a general parser normalizes
 * away — trailing hard breaks, blank-line grouping, the literal spelling of a
 * dash — because those are the findings.
 *
 * Diagnostic-only. Nothing in `convert-core` may import it.
 */
import { type DirectiveBlock, type SkeletonNode, read } from "../biomd-ast/read.js";

// ---------------------------------------------------------------------------
// Block model
// ---------------------------------------------------------------------------

/** One inline link or image, with the binding L1 folds away. */
export interface InlineRef {
  kind: "link" | "image";
  /** Link text, or image `alt`. Kept verbatim — a wrong label is a finding. */
  label: string;
  target: string;
}

/** An emphasis span, by strength and content. */
export interface InlineEmphasis {
  strength: "em" | "strong";
  text: string;
}

/** What a reader receives from a run of inline content. */
export interface Inline {
  /** Source spelling, markup included. */
  raw: string;
  /** Markup removed, entities and escapes resolved. What the reader sees. */
  text: string;
  refs: InlineRef[];
  emphasis: InlineEmphasis[];
}

export interface BlockBase {
  /** 1-based line in the whole document. */
  line: number;
}

export interface HeadingBlock extends BlockBase {
  kind: "heading";
  depth: number;
  inline: Inline;
}

/**
 * A paragraph, kept as its physical lines.
 *
 * `lines` preserves the author's lineation and `hardBreaks` records which of
 * those line ends were drawn deliberately (`\` or two trailing spaces). Folding
 * a paragraph to one string — which is what the scalar metric does — makes
 * every hard-break defect invisible by construction.
 */
export interface ParagraphBlock extends BlockBase {
  kind: "paragraph";
  lines: string[];
  hardBreaks: boolean[];
  inline: Inline;
}

export interface ListItem {
  /** Nesting depth, 0 for a top-level item. */
  depth: number;
  inline: Inline;
  line: number;
}

export interface ListBlock extends BlockBase {
  kind: "list";
  ordered: boolean;
  items: ListItem[];
}

export interface TableBlock extends BlockBase {
  kind: "table";
  /** Per-column alignment from the delimiter row; `null` = unspecified. */
  align: Array<"left" | "center" | "right" | null>;
  header: Inline[];
  /** Body rows, each padded to the header's width so coordinates are stable. */
  rows: Inline[][];
}

export interface QuoteBlock extends BlockBase {
  kind: "quote";
  children: Block[];
}

export interface BreakBlock extends BlockBase {
  kind: "break";
  /** The literal rule spelling; `***` and `---` are both thematic breaks. */
  marker: string;
}

export interface CodeBlock extends BlockBase {
  kind: "code";
  lang: string;
  value: string;
}

/** A `::: name` block whose Markdown children have themselves been resolved. */
export interface DirectiveNode extends BlockBase {
  kind: "directive";
  name: string;
  props: Record<string, string>;
  propOrder: string[];
  children: Block[];
  unclosed: boolean;
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | QuoteBlock
  | BreakBlock
  | CodeBlock
  | DirectiveNode;

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/u;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const QUOTE = /^ {0,3}> ?(.*)$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/u;
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/u;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/u;
/** A GFM delimiter row: only pipes, colons, dashes and spaces, ≥1 dash. */
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/u;

/**
 * Resolve a whole document.
 *
 * `read()` supplies the directive layer and the absolute line of every node;
 * each Markdown run is then resolved with that line as its origin, so every
 * block reports a line number in the real file rather than in a fragment.
 */
export function readBlocks(source: string): { blocks: Block[]; warnings: ReturnType<typeof read>["warnings"] } {
  const skeleton = read(source);
  return { blocks: resolveNodes(skeleton.children), warnings: skeleton.warnings };
}

function resolveNodes(nodes: readonly SkeletonNode[]): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    if (node.kind === "markdown") out.push(...parseMarkdown(node.value, node.line));
    else out.push(resolveDirective(node));
  }
  return out;
}

function resolveDirective(node: DirectiveBlock): DirectiveNode {
  return {
    kind: "directive",
    name: node.name,
    props: node.props,
    propOrder: node.propOrder,
    children: resolveNodes(node.children),
    unclosed: node.unclosed,
    line: node.line,
  };
}

/**
 * Markdown run → blocks.
 *
 * Deliberately line-oriented rather than character-oriented: every construct
 * this corpus uses is decided by the shape of a line, and a line-oriented
 * parser can report a defect's line without a position map.
 */
export function parseMarkdown(value: string, originLine: number): Block[] {
  const lines = value.split("\n");
  const out: Block[] = [];
  let i = 0;
  const at = (n: number) => originLine + n;

  while (i < lines.length) {
    const raw = lines[i] ?? "";

    if (raw.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(raw);
    if (fence) {
      const closer = fence[1] as string;
      const start = i;
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !new RegExp(`^ {0,3}${closer[0]}{${closer.length},}[ \t]*$`, "u").test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      out.push({ kind: "code", lang: fence[2] ?? "", value: body.join("\n"), line: at(start) });
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      out.push({
        kind: "heading",
        depth: (heading[1] as string).length,
        inline: inlineOf(heading[2] as string),
        line: at(i),
      });
      i += 1;
      continue;
    }

    // Order matters: a delimiter row of a two-column empty-header table is
    // `| --- | --- |`, which THEMATIC would otherwise never see, but a bare
    // `---` must not be mistaken for one either. Pipes decide.
    if (THEMATIC.test(raw) && !raw.includes("|")) {
      out.push({ kind: "break", marker: raw.trim(), line: at(i) });
      i += 1;
      continue;
    }

    if (QUOTE.test(raw)) {
      const start = i;
      const inner: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i] ?? "") || (lines[i] ?? "").trim() !== "")) {
        const m = QUOTE.exec(lines[i] ?? "");
        if (!m && (lines[i] ?? "").trim() === "") break;
        inner.push(m ? (m[1] as string) : (lines[i] as string)); // lazy continuation
        i += 1;
      }
      out.push({ kind: "quote", children: parseMarkdown(inner.join("\n"), at(start)), line: at(start) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const start = i;
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(lines[i] as string);
        i += 1;
      }
      out.push(parseTable(rows, at(start)));
      continue;
    }

    if (BULLET.test(raw) || ORDERED.test(raw)) {
      const start = i;
      const ordered = !BULLET.test(raw) && ORDERED.test(raw);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const line = lines[i] ?? "";
        const m = BULLET.exec(line) ?? ORDERED.exec(line);
        if (!m) {
          // A continuation line belongs to the item above it; a blank line or
          // any other block ends the list.
          if (line.trim() !== "" && /^[ \t]/u.test(line) && items.length > 0) {
            const last = items[items.length - 1] as ListItem;
            items[items.length - 1] = { ...last, inline: inlineOf(`${last.inline.raw} ${line.trim()}`) };
            i += 1;
            continue;
          }
          break;
        }
        const indent = (m[1] as string).replace(/\t/gu, "    ").length;
        items.push({ depth: Math.floor(indent / 2), inline: inlineOf(m[3] as string), line: at(i) });
        i += 1;
      }
      out.push({ kind: "list", ordered, items, line: at(start) });
      continue;
    }

    // Paragraph: to the next blank line or to the next line that starts a
    // different construct.
    const start = i;
    const para: string[] = [];
    while (i < lines.length) {
      const line = lines[i] ?? "";
      if (line.trim() === "") break;
      if (para.length > 0 && (HEADING.test(line) || (THEMATIC.test(line) && !line.includes("|")) || QUOTE.test(line) || FENCE.test(line) || isTableStart(lines, i))) break;
      para.push(line);
      i += 1;
    }
    out.push(paragraphOf(para, at(start)));
  }

  return out;
}

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i] ?? "";
  const next = lines[i + 1] ?? "";
  return head.includes("|") && DELIMITER_ROW.test(next) && next.includes("|");
}

function paragraphOf(raw: string[], line: number): ParagraphBlock {
  const text: string[] = [];
  const hardBreaks: boolean[] = [];
  for (const entry of raw) {
    const hard = /\\$/u.test(entry) || / {2,}$/u.test(entry);
    text.push(entry.replace(/\\$/u, "").replace(/ +$/u, "").trim());
    hardBreaks.push(hard);
  }
  return { kind: "paragraph", lines: text, hardBreaks, inline: inlineOf(text.join(" ")), line };
}

function parseTable(rows: string[], line: number): TableBlock {
  const cells = rows.map(splitRow);
  const header = (cells[0] ?? []).map(inlineOf);
  const align = (cells[1] ?? []).map((spec) => {
    const s = spec.trim();
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    if (left && right) return "center" as const;
    if (right) return "right" as const;
    if (left) return "left" as const;
    return null;
  });
  const width = Math.max(header.length, align.length, ...cells.slice(2).map((r) => r.length), 1);
  const body = cells.slice(2).map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push("");
    return padded.map(inlineOf);
  });
  while (header.length < width) header.push(inlineOf(""));
  while (align.length < width) align.push(null);
  return { kind: "table", align, header, rows: body, line };
}

/** Split a GFM row on unescaped pipes, dropping the leading/trailing frame. */
function splitRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let escaped = false;
  for (const ch of row.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      escaped = true;
      continue;
    }
    if (ch === "|") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  if (out.length > 0 && (out[0] as string).trim() === "") out.shift();
  if (out.length > 0 && (out[out.length - 1] as string).trim() === "") out.pop();
  return out.map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Inline resolution
// ---------------------------------------------------------------------------

const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/gu;
const LINK = /(?<!!)\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/gu;
const STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/gu;
const EM = /(?<![*\w])(\*|_)(?=\S)((?:[^*_]|\*\*)*?\S)\1(?![*\w])/gu;

/** Resolve one run of inline content into what a reader receives. */
export function inlineOf(raw: string): Inline {
  const refs: InlineRef[] = [];
  const emphasis: InlineEmphasis[] = [];

  for (const m of raw.matchAll(IMAGE)) refs.push({ kind: "image", label: m[1] ?? "", target: m[2] ?? "" });
  for (const m of raw.matchAll(LINK)) refs.push({ kind: "link", label: stripMarkup(m[1] ?? ""), target: m[2] ?? "" });
  for (const m of raw.matchAll(STRONG)) emphasis.push({ strength: "strong", text: stripMarkup(m[2] ?? "") });
  for (const m of raw.matchAll(EM)) emphasis.push({ strength: "em", text: stripMarkup(m[2] ?? "") });

  return { raw, text: stripMarkup(raw), refs, emphasis };
}

/**
 * Markup → what the reader sees.
 *
 * Backslash escapes are resolved last so that `1\.` and `\[Надежда]` compare
 * equal to their unescaped spellings: escaping is a serializer decision, not
 * content. Typography is *not* normalized here — `"` versus `«` is a finding,
 * and folding it away here would be exactly the blind spot this instrument was
 * built to remove.
 */
export function stripMarkup(value: string): string {
  return value
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(/(\*\*|__)([\s\S]*?)\1/gu, "$2")
    .replace(/(?<![*\w])(\*|_)(?=\S)([\s\S]*?\S)\1(?![*\w])/gu, "$2")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/gu, "$1")
    .replace(/[ \t]+/gu, " ")
    .trim();
}
