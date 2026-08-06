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
import type { PhrasingContent } from "mdast";

/** One line of a run, plus how many breaks closed it. */
export interface RunLine {
  content: PhrasingContent[];
  /** Consecutive `<br>` that followed this line. 0 at the end of the run. */
  gap: number;
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
      lines.push({ content: current, gap: 1 });
      current = [];
      continue;
    }
    // A break with nothing before it deepens the gap of the previous line;
    // a leading break has nothing to separate and is dropped.
    const last = lines[lines.length - 1];
    if (last) last.gap += 1;
  }
  if (current.length > 0) lines.push({ content: current, gap: 0 });

  return lines;
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
 */
export function isWrapBreak(left: string, right: string): boolean {
  if (left === "" || right === "") return false;
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
    if (isWrapBreak(texts[i] as string, texts[i + 1] as string)) wraps += 1;
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
