/**
 * Server-side markup quarantine, before HTML parsing.
 *
 * Static exports of PHP/ASP sites routinely contain live server fragments. They
 * must not reach the output, and they must not be *deleted* either: every
 * downstream provenance record is a character offset into the decoded string,
 * so removing a span would shift every offset after it and silently corrupt the
 * audit trail.
 *
 * Each island is therefore replaced by inert whitespace of exactly the same
 * length, preserving newlines so line/column numbers also stay correct. The raw
 * text is retained for the IR.
 *
 * Why this matters beyond bookkeeping: the HTML tokenizer turns `<?` into a
 * *bogus comment* that ends at the first `>`. For `<?php if ($a > $b) { ?>` that
 * is the `>` inside the condition, so the remainder — `$b) { ?>` — leaks into
 * the document as visible text. Quarantining first removes the whole class.
 */

export type IslandKind = "php" | "php-short" | "php-echo" | "asp" | "ssi" | "xml-decl";

export interface QuarantinedIsland {
  kind: IslandKind;
  /** Offsets into the decoded string. */
  start: number;
  end: number;
  /** 1-based line of `start`. */
  line: number;
  /** Verbatim source, retained for the IR and the audit. */
  raw: string;
  /** True when no terminator was found and the island was left for the parser. */
  unterminated: boolean;
}

export interface QuarantineResult {
  /** Same length as the input; islands blanked. */
  text: string;
  islands: QuarantinedIsland[];
  warnings: string[];
}

interface Pattern {
  kind: IslandKind;
  open: RegExp;
  close: string;
  /** Keep the span rather than blanking it (XML declarations are legitimate). */
  keep?: boolean;
}

/**
 * Order matters: `<?php` and `<?=` are matched before the bare short tag, and
 * `<?xml` is recognised so it is never mistaken for one.
 */
const PATTERNS: readonly Pattern[] = [
  { kind: "xml-decl", open: /<\?xml\b/giu, close: "?>", keep: true },
  { kind: "php", open: /<\?php\b/giu, close: "?>" },
  { kind: "php-echo", open: /<\?=/gu, close: "?>" },
  // A bare short tag only counts when followed by whitespace or a letter, so
  // prose like "…what<?" is not treated as code.
  { kind: "php-short", open: /<\?(?=[\s\r\n]|[A-Za-z])/gu, close: "?>" },
  { kind: "asp", open: /<%/gu, close: "%>" },
  { kind: "ssi", open: /<!--#(?:include|exec|echo|config|flastmod|fsize)\b/giu, close: "-->" },
];

/** Replace every character with a space, keeping newlines so lines still align. */
function blank(span: string): string {
  let out = "";
  for (const ch of span) out += ch === "\n" ? "\n" : " ";
  return out;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

export function quarantineServerMarkup(source: string): QuarantineResult {
  const islands: QuarantinedIsland[] = [];
  const warnings: string[] = [];

  // Collect candidate openings from every pattern, then resolve overlaps by
  // taking the earliest match and skipping past its end. Scanning patterns
  // independently and merging is simpler to reason about than one mega-regex,
  // and keeps each pattern's intent readable.
  interface Hit {
    kind: IslandKind;
    start: number;
    close: string;
    keep: boolean;
  }
  const hits: Hit[] = [];
  for (const pattern of PATTERNS) {
    pattern.open.lastIndex = 0;
    for (let m = pattern.open.exec(source); m !== null; m = pattern.open.exec(source)) {
      hits.push({ kind: pattern.kind, start: m.index, close: pattern.close, keep: pattern.keep === true });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;

  for (const hit of hits) {
    if (hit.start < cursor) continue; // already inside a quarantined span

    const closeAt = source.indexOf(hit.close, hit.start);
    const end = closeAt === -1 ? source.length : closeAt + hit.close.length;
    const raw = source.slice(hit.start, end);

    out += source.slice(cursor, hit.start);

    if (hit.keep) {
      // An XML declaration is legitimate markup: record it for the audit, but
      // pass it through unblanked so the parser still sees it.
      islands.push({
        kind: hit.kind,
        start: hit.start,
        end,
        line: lineAt(source, hit.start),
        raw,
        unterminated: closeAt === -1,
      });
      out += raw;
      cursor = end;
      continue;
    }

    if (closeAt === -1) {
      // Unterminated. Blanking to EOF would destroy the rest of the document,
      // which is worse than the leak: hand it to the parser, which will treat
      // it as a bogus comment, and flag it for review.
      warnings.push(
        `Unterminated ${hit.kind} island at line ${lineAt(source, hit.start)}; left for the parser and ` +
          "flagged for review rather than blanking the remainder of the document.",
      );
      islands.push({
        kind: hit.kind,
        start: hit.start,
        end: source.length,
        line: lineAt(source, hit.start),
        raw,
        unterminated: true,
      });
      out += source.slice(hit.start);
      cursor = source.length;
      break;
    }

    islands.push({
      kind: hit.kind,
      start: hit.start,
      end,
      line: lineAt(source, hit.start),
      raw,
      unterminated: false,
    });
    out += blank(raw);
    cursor = end;
  }

  out += source.slice(cursor);

  // The offset-preservation guarantee the rest of the pipeline relies on.
  if (out.length !== source.length) {
    throw new Error(
      `quarantine invariant violated: length changed ${source.length} → ${out.length}. ` +
        "Downstream source offsets would be invalid.",
    );
  }

  return { text: out, islands, warnings };
}
