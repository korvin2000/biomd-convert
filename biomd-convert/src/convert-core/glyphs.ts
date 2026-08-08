/**
 * Lexical data: symbols that stand in for something the target cannot draw.
 *
 * `CLAUDE.md` §3.5 keeps knowledge like this out of detectors and in a
 * documented data file, so a rule consulting it degrades gracefully when the
 * table does not have an entry for what it is looking at. Nothing here names a
 * document, a class, an id or a filename.
 *
 * The wider icon → glyph map that `mini_images_to_md_guide.md` specifies (29
 * entries, keyed on the site's shared asset paths) belongs here too and is not
 * built yet; this module exists so it has a home when it is.
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
