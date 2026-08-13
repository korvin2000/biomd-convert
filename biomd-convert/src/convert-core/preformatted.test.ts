/**
 * Contract for the one block whose whitespace is its content.
 *
 * The defect this exists for is invisible to every rung of the ladder: `<pre>`
 * was lowered with the collapsing `textOf`, so six poems on one page were
 * emitted as six single-line strings inside ``` fences. No word moved, so text
 * recall stayed at 99.5 %, the validator stayed at zero, L1's multiset axes saw
 * the same tokens and L3's renderer saw the same rendered text. Only the line
 * structure was gone.
 *
 * The tests below are written against `preformattedLines` rather than against a
 * document, because the question — which source line breaks are the author's
 * and which are a fixed-width column's — is answerable from the block alone.
 */
import { describe, expect, it } from "vitest";
import { parseHtml } from "../ladom/parse.js";
import { findFirst } from "../ladom/types.js";
import { preformattedLines, preformattedText } from "./preformatted.js";

function preOf(html: string) {
  const doc = parseHtml(`<body>${html}</body>`);
  const pre = findFirst(doc.root, "pre");
  if (!pre) throw new Error("no <pre> in fixture");
  return pre;
}

function textOfPre(html: string): string | null {
  return preformattedText(preOf(html));
}

/**
 * The Рождественский shape, verbatim: verse at the left edge, with the
 * remainder of every over-long line pushed onto the next display row.
 */
const WRAPPED_VERSE = `<pre>
А одна струна -
                    тетива,
зазвеневшая из темноты.
Вместо стрел в колчане -
                             слова.
А когда захочу -
                     цветы.

А вторая струна -
                   река.
Я дотрагиваюсь до нее.</pre>`;

/** The Долматовский shape: the same page, same class, no indent anywhere. */
const LEFT_EDGE_VERSE = `<pre>
В Гренаде, точней — в Гранаде
Земля — как хлебная корка,
На этой земле золотистой
Родился Гарсиа Лорка,
Ждала и встречала сына,
Дарила ему Гранаде
Солнышко апельсина,
Алый цветок граната.</pre>`;

describe("preformatted blocks keep their lines", () => {
  it("preserves every source line break", () => {
    // The whole defect in one assertion. Before this rule the block below was
    // one line of 8 words.
    expect(textOfPre(`<pre>Когда умру,\nСхороните меня с гитарой\nВ речном песке.</pre>`)).toBe(
      "Когда умру,\nСхороните меня с гитарой\nВ речном песке.",
    );
  });

  it("keeps the blank line the author drew between stanzas", () => {
    const out = textOfPre(`<pre>В речном песке.\n\nКогда умру...</pre>`);
    expect(out).toBe("В речном песке.\n\nКогда умру...");
  });

  it("draws one blank line for a run of them, as two `<br>` already mean one", () => {
    // `lines.ts` reads two or more consecutive breaks as a single paragraph
    // boundary; a `<pre>` that stacks blank rows means the same thing.
    expect(textOfPre(`<pre>над моею бедной землей.\n\n\nВместо пятой струны</pre>`)).toBe(
      "над моею бедной землей.\n\nВместо пятой струны",
    );
  });

  it("drops the newline the markup contributes, not one the author typed", () => {
    // A `<pre>` almost always opens on the newline that follows its tag, and
    // closes on the one before `</pre>`.
    expect(textOfPre(`<pre>\n  ГИТАРА\n</pre>`)).toBe("ГИТАРА");
  });

  it("measures the block's own left edge rather than a column number", () => {
    // Every line pushed in by the same amount is a block indented as a whole.
    // Its lines are at *its* edge, so none of them is a continuation.
    expect(textOfPre(`<pre>\n      Первая строка,\n      вторая строка,\n      третья строка.</pre>`)).toBe(
      "Первая строка,\nвторая строка,\nтретья строка.",
    );
  });

  it("advances a tab to the era's stop so the indent is measurable", () => {
    const lines = preformattedLines(preOf(`<pre>как вода по каналам - \n\t\tплачет,\nне моли ее</pre>`));
    // Two tabs are column 16, deeper than the left edge, and the line continues
    // one that ends on a dash: it is the wrap it looks like.
    expect(lines.map((l) => l.text)).toEqual(["как вода по каналам - плачет,", "не моли ее"]);
  });
});

describe("a wrapped line is folded back into the line it continues", () => {
  it("folds every continuation of the wrapped verse", () => {
    expect(textOfPre(WRAPPED_VERSE)).toBe(
      [
        "А одна струна - тетива,",
        "зазвеневшая из темноты.",
        "Вместо стрел в колчане - слова.",
        "А когда захочу - цветы.",
        "",
        "А вторая струна - река.",
        "Я дотрагиваюсь до нее.",
      ].join("\n"),
    );
  });

  it("leaves no line indented once the wraps are folded", () => {
    expect(preformattedLines(preOf(WRAPPED_VERSE)).every((line) => line.indent === 0)).toBe(true);
  });
});

describe("false friends — each tested for non-firing", () => {
  it("never folds verse that sits at the left edge", () => {
    // The decisive one. Six of these eight lines end in a comma, which is
    // `isWrapBreak`'s strongest positive signal; the indent requirement is the
    // only thing standing between this poem and one paragraph.
    const out = textOfPre(LEFT_EDGE_VERSE);
    expect(out?.split("\n")).toHaveLength(8);
  });

  it("declines a block whose indentation is its structure", () => {
    // Half or more of the lines indented means the indent is the layout, not an
    // accident of column width. The block is declined entire — no line of it is
    // folded — so a listing or an ASCII table can never be half-rewritten.
    const out = textOfPre(
      `<pre>\nЗаголовок\n    первый пункт,\n    второй пункт,\n    третий пункт,\n    четвертый пункт</pre>`,
    );
    expect(out?.split("\n")).toHaveLength(5);
    expect(out).toContain("    первый пункт,");
  });

  it("keeps an indented line the author began as a new sentence", () => {
    // Indent alone is not enough: `isWrapBreak` still has to see a sentence in
    // flight. A full stop on the left ends one.
    const out = textOfPre(`<pre>\nЯ дотрагиваюсь слегка.\n               Детство мое.\nЕсть и третья струна</pre>`);
    expect(out?.split("\n")).toHaveLength(3);
  });

  it("keeps an indented line that opens with a capital", () => {
    const out = textOfPre(`<pre>\nНеустанно\n        Гитара плачет\nне моли ее</pre>`);
    expect(out?.split("\n")).toHaveLength(3);
  });

  it("produces no block at all for a spacer", () => {
    // `<pre>&nbsp;</pre>` is a reserved row of vertical space. An empty fence
    // would be a block claiming content it does not have.
    expect(textOfPre(`<pre>&nbsp;</pre>`)).toBeNull();
    expect(textOfPre(`<pre>\n  \t \n</pre>`)).toBeNull();
  });
});

describe("mutation robustness — the evidence is geometry, not markup", () => {
  const RENAMED = WRAPPED_VERSE.replace("<pre>", `<pre class="zz9" id="q-14" style="margin-top: 3">`);
  const PERMUTED = WRAPPED_VERSE.replace("<pre>", `<pre style="margin-top: 3" id="q-14" class="zz9">`);

  it("is unchanged by renamed classes and ids", () => {
    expect(textOfPre(RENAMED)).toBe(textOfPre(WRAPPED_VERSE));
  });

  it("is unchanged by attribute order", () => {
    expect(textOfPre(PERMUTED)).toBe(textOfPre(RENAMED));
  });

  it("is unchanged by an inline wrapper the era used for colour", () => {
    const wrapped = WRAPPED_VERSE.replace("</pre>", "</font></pre>").replace(
      "<pre>",
      `<pre><font color="#575757">`,
    );
    expect(textOfPre(wrapped)).toBe(textOfPre(WRAPPED_VERSE));
  });

  it("is idempotent — folding an already-folded block changes nothing", () => {
    const once = textOfPre(WRAPPED_VERSE) ?? "";
    expect(textOfPre(`<pre>${once}</pre>`)).toBe(once);
  });

  it("is deterministic", () => {
    expect(textOfPre(WRAPPED_VERSE)).toBe(textOfPre(WRAPPED_VERSE));
  });
});
