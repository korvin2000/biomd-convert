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
