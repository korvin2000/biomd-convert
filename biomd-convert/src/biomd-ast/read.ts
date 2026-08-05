/**
 * `.bio.md` text → directive skeleton.
 *
 * This is deliberately **not** a general Markdown parser. It is a faithful
 * model of the two-layer grammar the target actually implements (plan §12.1,
 * and the parsing order the spec itself recommends in §17): a line-oriented
 * directive layer whose leaves contain independent CommonMark islands. Markdown
 * runs are kept as raw text, because that is exactly how the renderer treats
 * them — each leaf is handed to a separate Markdown instance.
 *
 * Two jobs:
 *   1. round-trip verification — serialize → read → re-serialize must be stable,
 *      and the directive tree read back must match the AST that produced it;
 *   2. the conformance suite — asserting that a document we emit is parsed the
 *      way we intend by a parser that behaves like the real one.
 *
 * Recovery behaviour intentionally mirrors the observed implementation,
 * including where it is more permissive than the specification. Divergences are
 * reported as warnings rather than silently normalized, so a conformance test
 * can assert on them.
 */

/** A run of ordinary Markdown between directives. */
export interface MarkdownRun {
  kind: "markdown";
  /** Raw text, newline-joined, with surrounding blank lines trimmed. */
  value: string;
  /** 1-based line of the first source line. */
  line: number;
}

/** A parsed `::: name … :::` block. */
export interface DirectiveBlock {
  kind: "directive";
  name: string;
  /** Properties in source order. Duplicates keep the last value, like the target. */
  props: Record<string, string>;
  /** Property names in source order, including duplicates. */
  propOrder: string[];
  children: SkeletonNode[];
  line: number;
  /** True when the block ran to EOF without a closing fence. */
  unclosed: boolean;
}

export type SkeletonNode = MarkdownRun | DirectiveBlock;

export interface ReadWarning {
  code:
    | "unclosed-fence"
    | "unknown-directive"
    | "property-header-absorbed-body"
    | "stray-content-in-container"
    | "malformed-property-line";
  message: string;
  line: number;
}

export interface BiomdSkeleton {
  children: SkeletonNode[];
  warnings: ReadWarning[];
}

const FENCE_OPEN = /^:::[ \t]*([A-Za-z][\w-]*)[ \t]*$/u;
const FENCE_CLOSE = /^:::[ \t]*$/u;
const PROP_LINE = /^([A-Za-z][\w-]*):[ \t]*(.*)$/u;

/** Directives whose body is a list of child directives rather than Markdown. */
const CONTAINER_ONLY = new Set(["columns", "images"]);

/**
 * Directives for which the target actually strips a leading property header.
 *
 * This set is a model of the implementation, not of the specification, and the
 * difference is load-bearing:
 *
 *  - `lead`, `column`, `signature` document no properties, so there is nothing
 *    to strip;
 *  - `columns` **does** document a property (`divider`) but its handler segments
 *    the body directly without stripping one. The property line therefore
 *    survives as an ordinary Markdown run and is promoted to a synthetic first
 *    column — which is precisely why `divider` must never be emitted;
 *  - `frame` and `signature` are unimplemented and fall through to a generic
 *    branch that preserves inner content without reading properties.
 *
 * Reproducing the asymmetry here is what lets a conformance test assert that
 * the corruption exists and that our own output avoids it.
 */
const PROPERTY_HEADER_DIRECTIVES = new Set(["align", "nav", "image", "images", "document"]);

/** Directives that take properties and a body. */
const KNOWN_DIRECTIVES = new Set([
  "lead",
  "align",
  "image",
  "images",
  "document",
  "columns",
  "column",
  "nav",
  "frame",
  "signature",
]);

export function read(source: string): BiomdSkeleton {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const warnings: ReadWarning[] = [];
  const cursor = { i: 0 };
  const children = readNodes(lines, cursor, warnings, null);
  return { children, warnings };
}

/**
 * Read sibling nodes until EOF or — when `closingFor` is set — until the fence
 * that closes the enclosing directive.
 */
function readNodes(
  lines: string[],
  cursor: { i: number },
  warnings: ReadWarning[],
  closingFor: string | null,
): SkeletonNode[] {
  const out: SkeletonNode[] = [];
  let markdown: string[] = [];
  let markdownStart = cursor.i + 1;

  const flush = () => {
    const value = trimBlank(markdown).join("\n");
    if (value.trim() !== "") out.push({ kind: "markdown", value, line: markdownStart });
    markdown = [];
  };

  while (cursor.i < lines.length) {
    const raw = lines[cursor.i] ?? "";

    if (closingFor !== null && FENCE_CLOSE.test(raw)) {
      cursor.i += 1; // consume the closing fence
      flush();
      return out;
    }

    const open = FENCE_OPEN.exec(raw);
    if (open) {
      flush();
      const name = open[1] as string;
      const line = cursor.i + 1;
      cursor.i += 1;
      out.push(readDirective(lines, cursor, warnings, name, line));
      markdownStart = cursor.i + 1;
      continue;
    }

    // A bare closing fence with nothing open. The target's depth counter would
    // simply decrement below the current block; treated here as stray text so
    // nothing is lost.
    markdown.push(raw);
    cursor.i += 1;
  }

  flush();
  if (closingFor !== null) {
    warnings.push({
      code: "unclosed-fence",
      message: `Unclosed ::: ${closingFor} block — content kept to end of file.`,
      line: lines.length,
    });
  }
  return out;
}

function readDirective(
  lines: string[],
  cursor: { i: number },
  warnings: ReadWarning[],
  name: string,
  line: number,
): DirectiveBlock {
  if (!KNOWN_DIRECTIVES.has(name)) {
    warnings.push({
      code: "unknown-directive",
      message: `Unknown directive ${JSON.stringify(name)}; body preserved.`,
      line,
    });
  }

  const props: Record<string, string> = {};
  const propOrder: string[] = [];

  // Property header: ends at the first blank line, or at the first line that is
  // not `key: value` — whichever comes first. This is the target's actual rule
  // and is more permissive than the spec's "a blank line separates properties
  // from body content"; the divergence is what makes the separator mandatory on
  // the emitting side.
  if (PROPERTY_HEADER_DIRECTIVES.has(name)) {
    while (cursor.i < lines.length) {
      const raw = lines[cursor.i] ?? "";
      if (raw.trim() === "") {
        cursor.i += 1; // consume the separating blank line
        break;
      }
      if (FENCE_OPEN.test(raw) || FENCE_CLOSE.test(raw)) break;
      const prop = PROP_LINE.exec(raw);
      if (!prop) break;
      const key = prop[1] as string;
      const value = (prop[2] as string).trim();
      if (key in props) {
        warnings.push({
          code: "malformed-property-line",
          message: `Duplicate property ${JSON.stringify(key)}; last value wins.`,
          line: cursor.i + 1,
        });
      }
      props[key] = value;
      propOrder.push(key);
      cursor.i += 1;
    }
  }

  const startedAt = cursor.i;
  const children = readNodes(lines, cursor, warnings, name);
  const unclosed = cursor.i >= lines.length && !closedExplicitly(lines, startedAt, cursor.i);

  const block: DirectiveBlock = { kind: "directive", name, props, propOrder, children, line, unclosed };

  if (CONTAINER_ONLY.has(name)) {
    for (const child of children) {
      if (child.kind === "markdown") {
        warnings.push({
          code: "stray-content-in-container",
          message:
            `Markdown content directly inside ::: ${name} — the target promotes it to a synthetic ` +
            `child, which is how a mis-emitted property line corrupts the layout.`,
          line: child.line,
        });
      }
    }
  }

  return block;
}

/** Whether a closing fence was consumed for the block that started at `from`. */
function closedExplicitly(lines: string[], from: number, to: number): boolean {
  for (let i = to - 1; i >= from; i -= 1) {
    if (FENCE_CLOSE.test(lines[i] ?? "")) return true;
  }
  return false;
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Flatten a skeleton to the directive names it contains, depth-first. */
export function directiveNames(nodes: readonly SkeletonNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "directive") {
      out.push(node.name);
      out.push(...directiveNames(node.children));
    }
  }
  return out;
}

/** All Markdown text in the skeleton, in reading order. */
export function markdownRuns(nodes: readonly SkeletonNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "markdown") out.push(node.value);
    else out.push(...markdownRuns(node.children));
  }
  return out;
}
