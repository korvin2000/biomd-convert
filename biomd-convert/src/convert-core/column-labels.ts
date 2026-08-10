/**
 * Lexical data: what to call a column the source never named.
 *
 * A GFM table MUST carry a header (`BioMD-Reference.md` §1, Tables), and this
 * corpus is full of resource matrices whose columns the source labels nowhere —
 * a work title beside two or three anonymous columns of TAB, MIDI, MP3, ZIP and
 * scan links. `synthesizeHeader` has to put *something* there.
 *
 * The vocabulary below is the author's, stated in `/new_rules.md`:
 *
 * > "Название композиции", "Название", "Произведение", "Аудио произведение" →
 * > "Название" … "Табулатура", "Аудиоформат", "TAB", "MIDI", "Формат MP3",
 * > "Ноты (TAB)", "Аудио (MIDI/WMA)" и т.п. → "Аудиоформат" … Не пытаться
 * > угадывать содержимое колонки, содержащей много ссылок на ресурсы ".mp3",
 * > ".tab", … Вместо этого использовать обобщающее название "аудиформат".
 *
 * That makes it a documented, language-tagged label vocabulary — exactly the
 * kind of knowledge `CLAUDE.md` invariant 5 requires to live in a data file
 * rather than inside a detector. Nothing here names a document, a class or an
 * id, and a label the table has never seen is passed through untouched.
 *
 * **This supersedes the `LINK_GLYPH` reasoning in `glyphs.ts`.** That comment
 * cites `analyze/analyze.md` saying `&#128279;` *"просто показывает символ
 * ссылки — он универсальный и подходит по смыслу"*, and it was right about the
 * corpus it was written against: sixteen references spelled it that way. The
 * `06eeafb` revision replaced **every** one of them with `Аудиоформат` and
 * `/new_rules.md` states the rule directly, so the newer instruction from the
 * same author governs. `LINK_GLYPH` still stands for a link column this table
 * declines to name — see `MEDIA_COLUMN_LABEL`'s note.
 */

/** Language of every surface form in this module. */
export const LABEL_LANGUAGE = "ru";

/** What a column of downloadable resources is called, whatever it holds. */
export const MEDIA_COLUMN_LABEL = "Аудиоформат";

/** What the column carrying each record's name is called. */
export const TITLE_COLUMN_LABEL = "Название";

/**
 * The mark for a column that has no name and no glyph that fits it.
 *
 * `LINK_GLYPH` says "this column holds a link". A column of catalogue numbers,
 * durations or plate marks says nothing of the kind, and inventing a word for
 * it is the §16.3 editorialising `c92c009` reverted when it deleted the
 * `Название` headers §30.2 had synthesized.
 *
 * A dash is not an invention here: it is **the corpus's own mark for the
 * column it declines to name**. `segovia.htm` writes `<p class="jr">-</td>` as
 * the whole content of its second column, in a five-column media table whose
 * other columns carry a movement number, a title, a duration and a link — and
 * both the reference and the converter carry that `-` through untouched.
 * `analyze-3.md` and `fixtures/out/tarrega.bio.md` then write the same mark
 * into a synthesized header, independently of each other.
 */
export const UNNAMED_COLUMN_MARK = "-";

/**
 * Synonyms the author folds onto the two canonical labels.
 *
 * Matched case-insensitively on the trimmed surface form. These are the labels
 * a *synthesized* header can produce — `dominantLabel` transcribes the text a
 * whole column repeats, so `TAB` and `MIDI` arrive here as column names even
 * though the source wrote them as cell contents. Folding them is therefore not
 * rewriting attested text: no header row existed to rewrite, which the probe in
 * PROGRESS §29.2 established for every affected table.
 */
const CANONICAL: ReadonlyMap<string, string> = new Map(
  (
    [
      [TITLE_COLUMN_LABEL, ["название", "название композиции", "произведение", "произведения", "аудио произведение", "композиция"]],
      [
        MEDIA_COLUMN_LABEL,
        [
          "аудиоформат",
          "формат",
          "табулатура",
          "таблатура",
          "табы",
          "tab",
          "midi",
          "mp3",
          "wma",
          "ram",
          "zip",
          "формат tab",
          "формат midi",
          "формат mp3",
          "аудио mp3",
          "аудио wma",
          "аудио / midi",
          "аудио (midi/wma)",
          "ноты (tab)",
          "midi / mp3",
          "аудио",
        ],
      ],
    ] as ReadonlyArray<readonly [string, readonly string[]]>
  ).flatMap(([canonical, forms]) => forms.map((form) => [form, canonical] as const)),
);

/**
 * The house name for a synthesized column label, or `null` when it has none.
 *
 * `null` is the graceful degradation invariant 5 asks for: a label this table
 * does not recognise is kept exactly as the column repeated it, which is the
 * behaviour every table had before this module existed.
 */
export function canonicalColumnLabel(label: string): string | null {
  return CANONICAL.get(label.replace(/\s+/gu, " ").trim().toLowerCase()) ?? null;
}
