/**
 * Lexical data: symbols that stand in for something the target cannot draw.
 *
 * `CLAUDE.md` §3.5 keeps knowledge like this out of detectors and in a
 * documented data file, so a rule consulting it degrades gracefully when the
 * table does not have an entry for what it is looking at. Nothing here names a
 * document, a class, an id or a filename.
 *
 * The wider icon → glyph map `mini_images_to_md_guide.md` specifies lives here
 * too — `ICON_GLYPHS`, below.
 */

/**
 * U+1F517 LINK SYMBOL — "this holds a link", with no claim about to what.
 *
 * A GFM table column MUST carry a header (`BioMD-Reference.md` §1, Tables), and
 * this corpus is full of resource matrices whose link columns the source never
 * names: a work title beside three anonymous columns of TAB, MIDI, MP3, ZIP and
 * scan links, in whatever combination that particular work happens to have.
 *
 * Transcribing a recurring label is always preferred, because it is attested.
 * Where there is none, the choice is between a symbol and an invented noun, and
 * `analyze/analyze.md` settles it in the same words on three separate pages:
 * `&#128279;` *"просто показывает символ ссылки (Link) — он универсальный и
 * подходит по смыслу"*. The references agree — 16 occurrences across six of the
 * 22 — and §16.3 is not engaged, because a symbol for "link" asserts no fact
 * that the source does not already state by containing the link.
 *
 * Emitted as the **character**, not as the `&#128279;` reference the guide, the
 * human record and the six references spell it with. The guide sanctions either
 * ("compact inline text **or** a Unicode/HTML numeric character reference"), and
 * the two are the same document to a renderer — but not to this pipeline:
 * `mdast-util-to-markdown` escapes a text node's `&` to `\&`, and routing it
 * through an mdast `html` node to avoid that trips `raw-html` and
 * `table-cell-block-content`, both of which are correct. L2 folds numeric
 * character references before comparing, so the two spellings compare equal.
 */
export const LINK_GLYPH = "\u{1F517}";

/**
 * What a shared UI icon stood for — `mini_images_to_md_guide.md`'s known-icon map.
 *
 * A 1998 template drew its controls as tiny GIFs: a back arrow, a forward
 * arrow, a home mark, a letter tab. They are text-equivalents, not article
 * media, and the guide is normative for the family (`CLAUDE.md` §2.3), which is
 * also what makes this table *lexical data* rather than detector literals under
 * invariant 5 — the same standing as `RULE_GLYPHS` below and the border palette.
 * `isUiIcon` names nothing; it asks this table.
 *
 * **Keyed on the asset stem**, lower-cased, without directory or extension. The
 * guide sanctions ignoring case and suffixes, and the corpus requires it: the
 * same score icon is spelled `score3.gif` in the guide and `score3.jpg` on the
 * page that uses it. A stem is still specific enough to be wrong safely — an
 * unlisted icon simply keeps whatever the pipeline does with it today.
 *
 * `mark` carries the guide's `***А-К***` forms: a bitmap letter or letter range
 * is replaced by *styled text*, not by a character, so the emphasis has to
 * survive as structure. Emitting `"***А-К***"` as a text node would serialize
 * escaped, which is the trap the `LINK_GLYPH` note above records.
 */
export interface IconGlyph {
  /** The replacement, as characters — never as a numeric character reference. */
  readonly text: string;
  /** `letter` renders as `***text***`; the default renders as-is. */
  readonly mark?: "letter";
}

const ICON_GLYPHS: ReadonlyMap<string, IconGlyph> = new Map([
  ["reply", { text: "↩" }], // ↩ reply / return
  ["www", { text: "↗" }], // ↗ external link
  ["up", { text: "▲" }], // ▲ up / previous level
  ["kkk", { text: "▲" }], // ▲ up / previous level
  ["smile", { text: "☻" }], // ☻
  ["score3", { text: "♫" }], // ♫ sheet music
  ["sad", { text: "☹" }], // ☹
  ["previous", { text: "◀" }], // ◀ previous / backward
  ["back", { text: "◀" }], // ◀ back / return
  ["next", { text: "▶" }], // ▶ next / forward
  ["forward", { text: "▶" }], // ▶ next / forward
  ["go", { text: "▶" }], // ▶ next / forward
  ["new", { text: "★" }], // ★ newly added
  ["h1", { text: "⌂" }], // ⌂ home
  ["h2", { text: "●" }], // ● current page / selected item
  ["kk", { text: "▪" }], // ▪ small square marker
  ["bggb1", { text: "■" }], // ■ square marker
  ["v", { text: "В", mark: "letter" }], // В
  ["p", { text: "Р", mark: "letter" }], // Р
  ["o", { text: "О", mark: "letter" }], // О
  ["n", { text: "Н", mark: "letter" }], // Н
  ["m", { text: "М", mark: "letter" }], // М
  ["k", { text: "К", mark: "letter" }], // К
  ["c", { text: "С", mark: "letter" }], // С
  ["c1", { text: "С", mark: "letter" }], // С
  ["ja", { text: "Я", mark: "letter" }], // Я
  ["ak", { text: "А-К", mark: "letter" }], // А-К
  ["ls", { text: "Л-С", mark: "letter" }], // Л-С
  ["ty", { text: "Т-Я", mark: "letter" }], // Т-Я
]);

/**
 * The glyph a shared asset path stands for, or `null` when it is not a known icon.
 *
 * Query and fragment are dropped before the stem is taken, as the guide allows.
 * Returning `null` is the graceful degradation invariant 5 requires: an asset
 * this table has never heard of is left exactly as it was.
 */
export function iconGlyphFor(src: string): IconGlyph | null {
  const path = src.split(/[?#]/u)[0] ?? "";
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const stem = (dot > 0 ? file.slice(0, dot) : file).toLowerCase();
  return stem === "" ? null : (ICON_GLYPHS.get(stem) ?? null);
}

/**
 * Characters this era drew a horizontal rule with, when it had no `<hr>`.
 *
 * A typesetter's dinkus. The author centres a short line of one repeated
 * ornament between two passages — `* * *`, `• • •`, `— — —` — and means the
 * separator `<hr>` would have drawn. Emitting it as a paragraph keeps the
 * characters and loses the construct: the reader sees three literal asterisks,
 * escaped, where the page showed a division.
 *
 * The list is lexical data, not detector literals, and the rule that consults
 * it degrades the obvious way — an ornament that is not listed simply stays a
 * paragraph, which is what happens today for all of them. What makes a run of
 * these a rule is **repetition and nothing else in the block**, which is
 * decided by the rule, not here: one `*` is a footnote marker and `• Из письма`
 * is a bulleted label.
 */
export const RULE_GLYPHS = new Set([
  "*", // asterisk — the printer's asterism, by far the commonest here
  "•", // • bullet
  "·", // · middle dot
  "●", // ● black circle
  "▪", // ▪ black small square
  "◦", // ◦ white bullet
  "—", // — em dash
  "–", // – en dash
  "-", // hyphen-minus
  "_", // low line
  "~", // tilde
  "=", // equals
  "─", // ─ box drawings light horizontal
]);

/**
 * Marks this era used where it had no `<ul>`: the glyph that opens an item.
 *
 * Lexical data, not detector literals — a mark that is not listed simply leaves
 * its line a paragraph, which is what happens today for every one of them. The
 * *rule* is elsewhere and supplies the whole burden of proof: what makes these
 * a list is that the same mark opens two or more adjacent blocks. One bulleted
 * line is a label (`• Из письма А.Максимова`), and three of them alone on a
 * line are a divider — {@link RULE_GLYPHS} owns that case and answers it by
 * repetition within the line.
 *
 * A deliberate subset of `RULE_GLYPHS`: a dash or an em dash opens a line of
 * dialogue far more often than an item in this corpus, and `*` opens emphasis.
 */
/**
 * Marks this era keyed a note to the passage that cites it.
 *
 * A printer's reference mark: the text carries `Soneto (para dos guitarras)
 * ***` and, further down, a line opening `*** CD 1999 …` that says what the
 * three stars stood for. The mark is a *pointer back*, not an item marker, and
 * {@link RULE_GLYPHS}'s note above already draws the distinction — "one `*` is
 * a footnote marker".
 *
 * Lexical data, not detector literals: a mark that is not listed leaves its
 * line exactly as it is today. Deliberately disjoint from {@link LIST_BULLETS};
 * the two vocabularies answer opposite questions, and `*` belongs to this one
 * because it is also emphasis, which is why no list rule ever claimed it.
 */
export const FOOTNOTE_MARKS = new Set([
  "*", // asterisk — the only one this corpus uses, and it uses it repeated
  "†", // † dagger
  "‡", // ‡ double dagger
  "§", // § section sign
]);

/**
 * Whether a line opens with a footnote mark keying it to something else.
 *
 * Pure and exported so the contract can be tested on the text alone. One mark
 * repeated, then whitespace, then the note. The whitespace is what separates a
 * key from emphasis — `*Артур Рубинштейн*` opens with the same character and is
 * a word — and requiring something after the run is what leaves `* * *` to
 * {@link isDrawnRule}, whose whole line is marks.
 */
export function opensWithFootnoteMark(text: string): boolean {
  // `* * *` opens with a mark and continues past it, and it is a division
  // rather than a key. The dinkus is asked about first because its own rule is
  // the stricter one — the whole line, and nothing else in the block.
  if (isDrawnRule(text)) return false;
  const chars = [...text.trimStart()];
  const first = chars[0];
  if (first === undefined || !FOOTNOTE_MARKS.has(first)) return false;
  let i = 0;
  while (i < chars.length && chars[i] === first) i += 1;
  const rest = chars.slice(i).join("");
  if (rest.trim() === "") return false;
  return /^[\s ]/u.test(rest);
}

export const LIST_BULLETS = new Set([
  "•", // • bullet
  "·", // · middle dot
  "●", // ● black circle
  "▪", // ▪ black small square
  "◦", // ◦ white bullet
  "‣", // ‣ triangular bullet
  "»", // » right guillemet, used as a marker in this corpus's era
]);

/**
 * How many ornaments make a rule.
 *
 * Two is an ellipsis mid-sentence or a pair of markers; three is the dinkus.
 * Every instance in the corpus is exactly three, and the references draw a
 * separator for each of them.
 */
export const MIN_RULE_GLYPHS = 3;

/**
 * True when a block's whole visible text is a rule the author drew.
 *
 * Pure and exported so the contract can be tested on the text alone. The
 * caller supplies the second half of the invariant — that this text is *all*
 * the block contains, and that the block carries no link or image.
 */
export function isDrawnRule(text: string): boolean {
  const compact = [...text.replace(/\s+/gu, "")];
  if (compact.length < MIN_RULE_GLYPHS) return false;
  const first = compact[0] as string;
  if (!RULE_GLYPHS.has(first)) return false;
  return compact.every((c) => c === first);
}
