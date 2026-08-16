/**
 * Break-run segmentation.
 *
 * A 1998 page has almost no block structure. One `<p>` holds a section label,
 * a blank line, four paragraphs of prose, a photograph, its caption and a
 * signature — separated by nothing but `<br>`. Serializing every `<br>` as a
 * Markdown hard break preserves the words and destroys the document: the
 * caption glues itself to the picture, the label never becomes a heading, and
 * the paragraph boundaries the author drew with `<br><br>` disappear.
 *
 * So a `<br>` is classified before anything is emitted:
 *
 *   - **PARAGRAPH** — two or more in a row: the author's blank line;
 *   - **LINEATION** — one, between lines that are deliberately separate
 *     (verse, an address, a track list, a two-line name);
 *   - **WRAP** — one, in the middle of a sentence the author hand-wrapped to
 *     fit a fixed-width cell; it means a space.
 *
 * The classifier works on the *phrasing* run rather than on the DOM, because
 * `<b>Посадка.<br></b>` puts the break inside the emphasis: after inline
 * lowering the break is a sibling, which is where the decision belongs.
 */
import { createHash } from "node:crypto";
import type { PhrasingContent } from "mdast";

/**
 * A break-run no rule could claim, offered for judgement.
 *
 * The converter recognises a list from four kinds of evidence — a bullet glyph,
 * ascending ordinals, a uniform indent under an announcing colon, and a native
 * `<blockquote>` around a single flat run. A run that carries none of them is
 * an *abstention*: `kiselev`'s nineteen volume titles and `jovicic`'s fifteen
 * track titles are `<br>`-separated lines in a plain `<p>`, and PROGRESS §15.2
 * measured line count, line length and variance across every multi-line run in
 * the references and found total overlap with verse that must stay a paragraph.
 * Shape cannot separate them; only meaning can.
 *
 * The candidate is therefore the **whole run**, never one line: what makes a
 * set of lines an enumeration is that they are parallel to each other, which is
 * a property of the block.
 */
export interface BreakRunCandidate {
  /** Content-derived, so the same run gets the same id in every run and cache. */
  id: string;
  /** Every line of the run, in order, as a reader sees it. */
  lines: string[];
  /** Visible text of the block immediately above, when the run has one. */
  lead?: string;
}

/**
 * Identity of a run, from the run's own words.
 *
 * Deliberately not a node id: the same discography block appears on many pages
 * of this corpus, and a content-derived id lets one decision serve all of them
 * while staying stable across a re-parse that renumbers nodes.
 */
export function breakRunId(lines: readonly string[]): string {
  return createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 16);
}

/** One line of a run, plus how many breaks closed it. */
export interface RunLine {
  content: PhrasingContent[];
  /** Consecutive `<br>` that followed this line. 0 at the end of the run. */
  gap: number;
  /**
   * How far the author pushed the line in, in non-collapsing space characters.
   *
   * 0 at the margin. Measured and then **removed** from `content` by
   * {@link splitLines}, so the indent informs segmentation without any consumer
   * of a line seeing a string it did not see before. See {@link collapseSpace}
   * for why the characters survive that far in the first place.
   */
  indent: number;
}

/** A maximal sequence of lines with no blank line between them. */
export interface LineGroup {
  lines: RunLine[];
}

/**
 * Hoist breaks out of the emphasis that encloses them.
 *
 * `<b>1989<br></b>` — a bold year, its own line, above the works of that
 * year — lowers to `strong[text, break]`, and a scan of the top-level run
 * never sees the break at all. Every such label was swallowed into the
 * paragraph that followed it. Splitting the emphasis around the break keeps
 * the marks on the words that carried them and puts the break where the line
 * scanner can see it.
 */
export function liftBreaks(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type !== "strong" && node.type !== "emphasis" && node.type !== "delete" && node.type !== "link") {
      out.push(node);
      continue;
    }
    const inner = liftBreaks(node.children as PhrasingContent[]);
    if (!inner.some((n) => n.type === "break")) {
      out.push({ ...node, children: inner } as PhrasingContent);
      continue;
    }
    // A link is a single destination; splitting it would invent a second one.
    if (node.type === "link") {
      out.push({ ...node, children: inner.filter((n) => n.type !== "break") } as PhrasingContent);
      continue;
    }
    let chunk: PhrasingContent[] = [];
    const flush = (): void => {
      if (chunk.length > 0) out.push({ ...node, children: chunk } as PhrasingContent);
      chunk = [];
    };
    for (const child of inner) {
      if (child.type === "break") {
        flush();
        out.push(child);
        continue;
      }
      chunk.push(child);
    }
    flush();
  }
  return out;
}

export function splitLines(input: readonly PhrasingContent[]): RunLine[] {
  const lines: RunLine[] = [];
  let current: PhrasingContent[] = [];
  const phrasing = liftBreaks(input);

  for (const node of phrasing) {
    if (node.type !== "break") {
      current.push(node);
      continue;
    }
    if (current.length > 0) {
      lines.push(measured(current, 1));
      current = [];
      continue;
    }
    // A break with nothing before it deepens the gap of the previous line;
    // a leading break has nothing to separate and is dropped.
    const last = lines[lines.length - 1];
    if (last) last.gap += 1;
  }
  if (current.length > 0) lines.push(measured(current, 0));

  return lines;
}

/**
 * Read the line's indent, then take it out of the content.
 *
 * A line that is *nothing but* spacing has no indent to read — the whole line
 * is spacing, and the `&nbsp;` a 1998 author put between two `<br>`s to draw a
 * blank line is the line, not a margin in front of one. Stripping it there
 * emptied the spacer and `new_dyens` lost two paragraph boundaries: three
 * paragraphs became one with two hard breaks in it.
 */
function measured(content: PhrasingContent[], gap: number): RunLine {
  const head = content[0];
  if (head === undefined || head.type !== "text" || !NON_COLLAPSING_SPACE.test(head.value)) {
    return { content, gap, indent: 0 };
  }
  const indent = LEADING_INDENT.exec(head.value)?.[1];
  if (indent === undefined) return { content, gap, indent: 0 };
  const stripped = head.value.replace(LEADING_INDENT, "");
  if (phrasingText([{ ...head, value: stripped }, ...content.slice(1)]).trim() === "") {
    return { content, gap, indent: 0 };
  }
  return {
    content: [{ ...head, value: stripped }, ...content.slice(1)],
    gap,
    indent: indent.length,
  };
}

/** Split lines into groups at every blank line the author drew. */
export function groupLines(lines: readonly RunLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  let current: RunLine[] = [];
  for (const line of lines) {
    current.push(line);
    if (line.gap >= 2) {
      groups.push({ lines: current });
      current = [];
    }
  }
  if (current.length > 0) groups.push({ lines: current });
  return groups;
}

/** Visible text of a line. */
export function lineText(line: RunLine): string {
  return phrasingText(line.content).replace(/\s+/gu, " ").trim();
}

/**
 * Space characters an HTML renderer does **not** collapse.
 *
 * This is the whole basis of the indent test in {@link isWrapBreak} and it is the HTML whitespace
 * model rather than anything about this corpus: a run of ASCII spaces, tabs and
 * newlines collapses to one space, so an author who wanted a *visible* indent
 * had no choice but to type `&nbsp;`, `&ensp;` or `&emsp;`. Their presence at
 * the head of a line is therefore always deliberate.
 */
const NON_COLLAPSING_SPACE = /[  -   　]/u;
const LEADING_INDENT = /^[ \t\r\n]*([  -   　]+)/u;

/**
 * Collapse a text node's whitespace the way a renderer does.
 *
 * `keepIndent` is set only for the text that opens a line, where a run of
 * non-collapsing spaces is the author's indent rather than layout whitespace.
 * Everywhere else the two are indistinguishable to a reader and the ASCII form
 * is what the rest of the pipeline expects. {@link splitLines} removes even the
 * kept run once it has measured it, so no emitted string differs.
 */
export function collapseSpace(value: string, keepIndent: boolean): string {
  const collapsed = value.replace(/\s+/gu, " ");
  if (!keepIndent) return collapsed;
  const indent = LEADING_INDENT.exec(value)?.[1];
  if (indent === undefined) return collapsed;
  const rest = collapsed.replace(/^\s+/u, "");
  // Nothing follows: this text is not an indent, it is a spacer — the `&nbsp;`
  // a 1998 author put between two `<br>`s to draw a blank line. Keeping its
  // characters here changed the string every consumer sees and cost `new_dyens`
  // two paragraph boundaries.
  return rest === "" ? collapsed : indent + rest;
}

export function phrasingText(nodes: readonly PhrasingContent[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if (node.type === "image") out += "";
    else if ("children" in node) out += phrasingText(node.children as PhrasingContent[]);
  }
  return out;
}

/**
 * Whether a single break inside a group is a hand-wrap rather than a
 * deliberate line.
 *
 * The default is *lineation*: an author who typed `<br>` usually meant one.
 * A wrap is recognised only from positive evidence that the sentence
 * continues — no terminal punctuation on the left, and a continuation word on
 * the right — and only in a group that reads as prose rather than as verse or
 * a list, which is decided for the group as a whole.
 *
 * ## Two lines pushed in by the same amount are two lines
 *
 * The punctuation tests alone read a trailing comma as proof of continuation,
 * and that is wrong for the shape this corpus writes an enumeration in: each
 * item on its own line, indented, ending in a comma. `news` lost three lines to
 * it — the first, second and third prizes of a competition ran together into
 * one, which is a `paragraph.content` **critical**, the only kind of finding
 * that says content changed.
 *
 * **The evidence is relational, and it has to be**, because an indent alone
 * means the opposite just as often. `goya2` indents the *continuation* of a
 * wrapped track title under the title it belongs to, and `borislova` indents
 * every second line of a poem. What separates those from an enumeration is
 * that their indent is the exception against unindented siblings, while an
 * enumeration indents every item alike. So the test is equality of indent
 * across the break, never the presence of one.
 *
 * Swept over all 22 sources against the shipped classifier: of the 19 folded
 * pairs whose right line is indented, the 4 with **equal** indent are exactly
 * `news`'s two enumerations, and the 15 with unequal indent are exactly the
 * continuations and verse lines that must stay folded. No overlap, so the
 * boundary is the mechanism rather than a tuned threshold.
 */
export function isWrapBreak(left: string, right: string, indent?: readonly [number, number]): boolean {
  if (left === "" || right === "") return false;
  if (indent !== undefined && indent[0] > 0 && indent[0] === indent[1]) return false;
  // A sentence that ended did not wrap.
  if (/[.!?…:;»"”)]$/u.test(left)) return false;
  if (/[,—–-]$/u.test(left)) return true;
  const first = right[0] as string;
  // A continuation is lower case; a new line that starts with a capital, a
  // digit, a bullet or a dash is a line the author chose.
  return first.toLowerCase() === first && first.toUpperCase() !== first;
}

/**
 * Whether a group's single breaks are structural rather than typographic.
 *
 * Verse, a discography track list and a postal address all share one shape:
 * many short lines, most of which do not continue the previous one. Treating
 * them line by line is the whole point; joining them would run the poem into
 * a paragraph.
 */
export function groupIsLineated(lines: readonly RunLine[]): boolean {
  if (lines.length < 3) return true;
  const texts = lines.map((l) => lineText(l));
  const avg = texts.reduce((a, t) => a + t.length, 0) / texts.length;
  if (avg < 60) return true;
  let wraps = 0;
  for (let i = 0; i + 1 < texts.length; i += 1) {
    const pair: [number, number] = [(lines[i] as RunLine).indent, (lines[i + 1] as RunLine).indent];
    if (isWrapBreak(texts[i] as string, texts[i + 1] as string, pair)) wraps += 1;
  }
  return wraps < (texts.length - 1) / 2;
}

/**
 * An enumerated list the author drew with `<br>`, grouped into its items.
 *
 * ## Rule contract
 *
 * **Invariant.** Every item opens with an ordinal token followed by content on
 * the same line, and the ordinals **ascend**. Ascent is what makes this evidence
 * rather than a pattern match: any run of lines can start with a digit, but only
 * a list counts upward. Nothing here reads a class, a tag, a length or a word.
 *
 * **Recurrence.** Three *items* minimum, and the ascent is itself a recurrence
 * test — it must hold across every adjacent pair, so a single stray numeral
 * cannot carry the group.
 *
 * **False friends**, each tested for non-firing:
 *   - **verse.** `borislova`'s poem is lineated the same way and has no
 *     ordinals; the ordinal requirement is what separates them.
 *   - **a year list.** `1989 Во поле` opens with a number too. Years are four
 *     digits and carry no `.`/`)` separator, and a dated entry label belongs to
 *     the heading family — so the ordinal is capped at three digits and the
 *     separator is required.
 *   - **a dotted date.** `01.02.2003` opens with `01.`; a digit may not follow
 *     the separator.
 *   - **prose containing numbers.** A paragraph whose fourth line happens to
 *     read `1. …` is not a list: the run must *open* with an ordinal, so an
 *     unnumbered leading line disqualifies the group outright.
 *
 * Lines without an ordinal attach to the item above them — the era's line
 * fitting broke long titles across two lines, and `goya2` has several
 * (`02. I just called to say I love you` / `(S Wonder)`).
 *
 * Returns the grouped items, so the caller builds from the same evidence the
 * rule fired on, or null when the group is not a list.
 */
export function enumeratedItems(lines: readonly RunLine[]): RunLine[][] | null {
  const items: RunLine[][] = [];
  const ordinals: number[] = [];
  for (const line of lines) {
    const ordinal = leadingOrdinal(lineText(line));
    if (ordinal === null) {
      if (items.length === 0) return null;
      (items[items.length - 1] as RunLine[]).push(line);
      continue;
    }
    items.push([line]);
    ordinals.push(ordinal);
  }
  if (items.length < 3) return null;
  for (let i = 0; i + 1 < ordinals.length; i += 1) {
    if ((ordinals[i + 1] as number) <= (ordinals[i] as number)) return null;
  }
  return items;
}

/** Whether a line opens with the ordinal token {@link enumeratedItems} reads. */
export function opensWithOrdinal(text: string): boolean {
  return leadingOrdinal(text) !== null;
}

/** `NN.` / `NN)` at the head of a line, followed by content. Null when absent. */
function leadingOrdinal(text: string): number | null {
  const t = text.trim();
  // Capped at three digits: a four-digit leader is a year, and a year line is a
  // dated entry label, not a list item.
  const match = /^(\d{1,3})\s*[.)]\s+(\S.*)$/su.exec(t);
  if (!match) return null;
  // `01.02.2003` — a date, not an ordinal followed by a title.
  if (/^\d/u.test(match[2] as string)) return null;
  return Number.parseInt(match[1] as string, 10);
}
