/**
 * Lexical data: the words a section label opens with, and how a line is scored.
 *
 * `analyze/TODO_Rules.md` §1 specifies a classifier for *"одиноко стоящих
 * строк"* — a line the source left standing on its own and marked in no way at
 * all, neither as a heading nor with any inline style. Such a line is scored
 * out of five terms and, above the threshold, marked `**bold**`:
 *
 * > 1) если весь текст заглавными буквами +4 пункта
 * > 2) Если отделен еще и снизу 1 пустой строкой +1.5 пункта
 * > 3) Если заканчиваются на ":" +3 пункта
 * > 3) +3 пункта, если начинаются словами "Список", "Сочинения", …
 * > 4) Если строка короче 64 символов +1 пункт, если короче 32 символов +1.5
 * > 5) +1 пункт, если текст начинается с арабских цифр: "I", "II", … или
 * >    обычных цифр и стоящих за ними "." или ")" или "]"
 * >
 * > Если такой текст набирает > 3 (>=4) пунктов и он пока никак не выделен, то
 * > его стоит выделять например "**" стилем, даже если это портит статистику
 * > по-сравнению с reference файлами.
 *
 * The author demonstrated the intended output in the same commit, by editing
 * `new_geyzel04`'s reference from `### БЛАГОДАРНОСТИ:` to `**БЛАГОДАРНОСТИ:**`.
 *
 * The vocabulary is language-tagged data, kept here rather than inside the
 * detector, which is what `CLAUDE.md` invariant 5 requires of a label list; a
 * line that opens with none of these words simply scores nothing for it, which
 * is the graceful degradation the same invariant asks for. Nothing here names a
 * document, a class, an id or a filename.
 *
 * The **scoring** lives here too, beside the words it reads, so the one place
 * that has to be checked against the brief is one file. What consumes it —
 * which lines are even asked, and what a promotion does — is
 * `structure.ts`'s `promoteScoredLabel`.
 */

/** Language of every surface form in this module. */
export const LABEL_LANGUAGE = "ru";

/**
 * Words that open a section label.
 *
 * The author's list verbatim, plus one spelling: `Галерея` beside the brief's
 * `Галлерея`. Adding a spelling to a lookup is coverage, not a correction of
 * anyone's text — the corpus is 1998 typing and the misspelling is as likely as
 * the standard form.
 */
const OPENERS: readonly string[] = [
  "список", "сочинения", "сборник", "собрание", "часть", "глава", "подборка",
  "коллекция", "альманах", "антология", "каталог", "таблица", "перечень",
  "благодарности", "ссылки", "литература", "дискография", "галлерея", "галерея",
  "архив", "годы", "приложение", "дополнение", "вступление",
];

const OPENER_SET = new Set(OPENERS);

/** Roman numerals the brief enumerates, `I` through `X`. */
const ROMAN = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]);

/** The brief's threshold: *"> 3 (>=4) пунктов"*. */
export const LABEL_SCORE_THRESHOLD = 4;

/** The brief's candidate ceiling: *"длинной не более 120 символов"*. */
export const LABEL_MAX_CHARS = 120;

/**
 * Whether the line carries evidence that only a label carries.
 *
 * **Why the score alone cannot decide, measured.** The brief's five terms give
 * a lone paragraph +1.5 for standing clear below as well as above, and every
 * lone paragraph does; a trailing colon adds +3; so *any* standalone line
 * ending in a colon reaches the threshold on no other evidence at all. Over the
 * 28 produced documents that promotes nine sentences -- `Ð Ð°Ð²ÑÐ¾Ð±Ð¸Ð¾Ð³ÑÐ°ÑÐ¸Ð¸
 * Ð¡ÐµÐ³Ð¾Ð²Ð¸Ñ Ð¾Ð¿Ð¸ÑÐ°Ð» Ð²ÑÑÑÐµÑÑ ÑÐ¾ ÑÐ²Ð¾Ð¸Ð¼ Ð¿ÐµÑÐ²ÑÐ¼ Ð³Ð¸ÑÐ°ÑÐ½ÑÐ¼ ÑÑÐ¸ÑÐµÐ»ÐµÐ¼:` and its kind --
 * which introduce the quotation below them. Four are on `news`, which the
 * author has ruled has no errors at all (`OPEN.md` Â§3.10).
 *
 * **And length does not separate them.** Word count looked as if it did: the
 * corpus's labels run 1-4 words and its lead-in sentences 6-15. A contract that
 * predates this rule falsified it -- `recovery.test.ts` asserts that
 * `Ð¤Ð¾ÑÐ¼ÑÐ»Ð¸ÑÑÑ ÑÐµÐ»Ð¸ Ð¡ÐµÐ³Ð¾Ð²Ð¸Ñ Ð¿Ð¸ÑÐ°Ð»:` stays plain, and that is a **four-word
 * sentence**. A cap fitted to the corpus would have shipped and been wrong on
 * the other ~987 pages, which is exactly what the contracts exist to catch.
 *
 * What survives is the difference between the brief's own terms. Two of them
 * are evidence *only a label has*: a line shouted in capitals, and a line that
 * opens with a word from the section vocabulary. The other four -- standing
 * clear, a trailing colon, shortness, an ordinal -- are satisfied by prose as
 * readily as by a label, so they may raise a score and cannot carry one.
 *
 * A candidate that clears the threshold with none of this is not "not a label";
 * it is **undecided**, and `promoteScoredLabel` records it as such rather than
 * answering it. Whether `ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ñ:` names a section and `ÐÐ°Ð´Ñ ÐÐ¾ÑÐ¸ÑÐ»Ð¾Ð²Ð°:`
 * names a speaker is a judgement about the words, which is the one thing the
 * source never states.
 */
export function carriesLabelEvidence(text: string): boolean {
  return isShouted(text) || opensASection(text);
}

/**
 * The identity of a candidate line: its own normalized text.
 *
 * Content-derived on purpose. A decision keyed by position would be applied to
 * a different line the moment anything above it moved, and a cached one would
 * be applied to a different document; keyed by the words themselves, the
 * acceptance check can re-derive it and refuse a reply that does not belong.
 */
export function labelLineId(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Whether every letter in the line is a capital.
 *
 * Two letters minimum: a single initial is not a shout, and a line with no
 * letters at all (a rule drawn from punctuation) is not one either.
 */
function isShouted(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 2) return false;
  return letters.every((c) => c === c.toLocaleUpperCase(LABEL_LANGUAGE) && c !== c.toLocaleLowerCase(LABEL_LANGUAGE));
}

/** Whether the line opens with one of the section words. */
function opensASection(text: string): boolean {
  const first = text.replace(/^[^\p{L}\p{N}]+/u, "").split(/[\s ]+/u)[0] ?? "";
  return OPENER_SET.has(first.replace(/[^\p{L}]+$/u, "").toLocaleLowerCase(LABEL_LANGUAGE));
}

/** Whether the line opens with an ordinal the brief recognises. */
function opensWithAnOrdinal(text: string): boolean {
  const match = /^\s*([IVX]{1,4}|\d{1,3})\s*[.)\]]/u.exec(text);
  if (!match) return false;
  const token = match[1] as string;
  return /^\d+$/u.test(token) || ROMAN.has(token);
}

/**
 * The brief's five terms, summed.
 *
 * `standsClearBelow` is the caller's answer to term 2: the line is separated
 * from what follows as well as from what precedes it. A whole one-line
 * paragraph always is, which is why the term is a constant for that shape and
 * why {@link carriesLabelEvidence} exists.
 *
 * Term 4 is read as a *scale*, not a sum: a line under 32 characters scores
 * 1.5 and not 2.5. Summing them promotes every short standalone line on
 * length alone, which the brief's own threshold shows it does not intend — at
 * 1.5 + 2.5 a bare short line reaches exactly 4 with no other evidence.
 */
export function scoreLabelLine(text: string, standsClearBelow: boolean): number {
  let score = 0;
  if (isShouted(text)) score += 4;
  if (standsClearBelow) score += 1.5;
  if (text.endsWith(":")) score += 3;
  if (opensASection(text)) score += 3;
  if (text.length < 32) score += 1.5;
  else if (text.length < 64) score += 1;
  if (opensWithAnOrdinal(text)) score += 1;
  return score;
}
