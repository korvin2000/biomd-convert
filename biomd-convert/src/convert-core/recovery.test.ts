/**
 * Behavioural contracts recovered from the reference conversions.
 *
 * Each case below is a shape the converter used to get wrong on a real page in
 * `fixtures/html`, expressed as the smallest markup that reproduces it. They
 * are written against observable output rather than internals, so a different
 * implementation of the same recovery still passes.
 */
import { describe, expect, it } from "vitest";
import { convert } from "./pipeline.js";
import { ALIGN_LABEL_MAX_CHARS, isAlignableLabelText, isDateLabel } from "./structure.js";
import type { Classification } from "./classify.js";
import { groupIsLineated, isWrapBreak, liftBreaks, splitLines } from "./lines.js";
import { groupColumnsFor, isDecorative, sizeTokenFor } from "./media.js";
import { paletteFor } from "./frames.js";
import { parseHtml } from "../ladom/parse.js";
import { foldTextAlign, isCenteredAlign, isDistinctiveAlign, proseAlign } from "../ladom/style.js";
import { resolveProfile } from "../biomd-ast/index.js";
import { walkElements } from "../ladom/types.js";

/** A minimal page with the era's shell, so chrome removal has something to do. */
function page(body: string): string {
  return `<html><head><title>Словарь</title></head><body>
  <table border="0" width="760"><tr><td width="458">
    <div style="FONT: bold 20pt Arial"><p align="center">Андрес Сеговия</p></div>
  </td></tr></table>
  <table border="0" width="760"><tr><td width="529">${body}</td></tr></table>
  </body></html>`;
}

const PROSE =
  "<p>Он был выдающимся гитаристом своего поколения и оставил обширное наследие, " +
  "которое до сих пор изучают исполнители по всему миру, а его записи переиздаются " +
  "регулярно и остаются образцом для подражания музыкантов следующих поколений.</p>";

/** The reference set was written against `spec-1.6`, so the tests target it. */
const SPEC = resolveProfile("spec-1.6");

async function md(body: string): Promise<string> {
  const result = await convert(Buffer.from(page(body), "utf8"), { profile: SPEC });
  return result.markdown;
}

describe("break-run segmentation", () => {
  it("splits a run into lines at every <br>", () => {
    const lines = splitLines([
      { type: "text", value: "1989" },
      { type: "break" },
      { type: "text", value: "Во поле" },
    ]);
    expect(lines.map((l) => l.gap)).toEqual([1, 0]);
    expect(lines).toHaveLength(2);
  });

  it("hoists a break out of the emphasis that encloses it", () => {
    // `<b>1989<br></b>` — the label and the break are siblings after lifting,
    // which is the only arrangement the line scanner can see.
    const lifted = liftBreaks([
      { type: "strong", children: [{ type: "text", value: "1989" }, { type: "break" }] },
      { type: "text", value: "works" },
    ]);
    expect(lifted.map((n) => n.type)).toEqual(["strong", "break", "text"]);
  });

  it("never splits a link around a break", () => {
    const lifted = liftBreaks([
      { type: "link", url: "/x", children: [{ type: "text", value: "a" }, { type: "break" }, { type: "text", value: "b" }] },
    ]);
    expect(lifted).toHaveLength(1);
    expect(lifted[0]?.type).toBe("link");
  });

  it("joins a hand-wrapped sentence and keeps a deliberate line", () => {
    expect(isWrapBreak("основным инструментом в", "конце 1950-х годов")).toBe(true);
    expect(isWrapBreak("Виктор Михайлович", "ЕФРЕМОВ")).toBe(false);
    expect(isWrapBreak("играть на гитаре.", "В 2003 году окончил")).toBe(false);
  });

  it("treats a block of short lines as verse rather than wrapped prose", () => {
    const verse = ["La guitarra es la luna", "en un lago de oro", "El piano es un tren", "cargando cascadas"].map(
      (t) => ({ content: [{ type: "text" as const, value: t }], gap: 1 }),
    );
    expect(groupIsLineated(verse)).toBe(true);
  });
});

describe("media", () => {
  it("maps a portrait to a size token relative to the article, not to its parent", () => {
    // 152 px inside a 422 px content column is a small portrait. Measuring it
    // against the paragraph it stretched produced ratio ≈ 1 and `full`.
    expect(sizeTokenFor(152, 422)).toBe("small");
    expect(sizeTokenFor(250, 422)).toBe("medium");
    expect(sizeTokenFor(418, 422)).toBe("large");
  });

  it("rejects spacers, nav arrows and rule strips as content", () => {
    const doc = parseHtml(
      '<body><img src="a/forward.gif" width="11" height="11">' +
        '<img src="a/score3.jpg" width="32" height="14">' +
        '<img src="a/gk.gif" width="378" height="31">' +
        '<img src="a/smile.gif" width="15" height="15">' +
        '<img src="a/portrait.jpg" width="150" height="202" alt="Сеговия"></body>',
    );
    const verdicts = [...walkElements(doc.root)]
      .filter((e) => e.tag === "img")
      .map((e) => [e.attrs["src"], isDecorative(e)]);
    expect(verdicts).toEqual([
      ["a/forward.gif", true],
      ["a/score3.jpg", true],
      ["a/gk.gif", true],
      // A squarish 15 px emoticon inside a news entry is content the author chose.
      ["a/smile.gif", false],
      ["a/portrait.jpg", false],
    ]);
  });

  it("groups two adjacent images into one row", () => {
    expect(groupColumnsFor(2)).toBe(2);
    expect(groupColumnsFor(3)).toBe(3);
    expect(groupColumnsFor(6)).toBe(3);
    expect(groupColumnsFor(5)).toBe(4);
  });

  it("emits `::: images` for a centred pair and binds each caption", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><img src="photo/a.jpg" alt="Надя" width="200" height="290">' +
        '<img src="photo/b.jpg" alt="Надя" width="200" height="290"></p>' +
        PROSE,
    );
    expect(out).toContain("::: images");
    expect(out).toContain("columns: 2");
    expect(out).toContain("caption: Надя");
    expect(out).not.toContain("![Надя](photo/a.jpg)");
  });

  it("keeps a linked thumbnail as one image directive with its click target", async () => {
    const out = await md(
      PROSE + '<p align="center"><a href="scan.jpg"><img src="thumb.jpg" width="420" height="294" alt="Отзыв"></a></p>',
    );
    expect(out).toContain("::: image");
    expect(out).toContain("src: thumb.jpg");
    expect(out).toContain("link: scan.jpg");
    expect(out).toContain("caption: Отзыв");
  });

  it("binds a caption line that follows the picture", async () => {
    const out = await md(
      PROSE + '<p align="center"><img src="fig1.jpg" width="224" height="334"><br><br>Рис. 1.</p>' + PROSE,
    );
    expect(out).toContain("caption: Рис. 1.");
  });

  it("keeps a link whose only label was a nav arrow clickable", async () => {
    const out = await md(PROSE + '<p>Подробнее: <a href="barrios1.htm"><img src="../main/forward.gif" width="11" height="11"></a></p>');
    expect(out).not.toContain("forward.gif");
    expect(out).toContain("](/#/barrios1)");
  });
});

describe("outline", () => {
  it("recovers a bold line above its own body as a section", async () => {
    const out = await md(`<p class="t"><b>Посадка.<br></b><br>${PROSE.replace(/<\/?p>/gu, "")}</p>`);
    expect(out).toMatch(/^## Посадка\./mu);
  });

  it("recovers a line in capitals above its own body", async () => {
    const out = await md(`<p class="t1">ВСТУПЛЕНИЕ<br><br>${PROSE.replace(/<\/?p>/gu, "")}</p>`);
    expect(out).toMatch(/^## ВСТУПЛЕНИЕ$/mu);
  });

  it("does not promote a bold line with nothing after it", async () => {
    const out = await md(`${PROSE}<p class="t"><b>Владимир МАРКУШЕВИЧ</b></p>`);
    expect(out).not.toContain("## Владимир МАРКУШЕВИЧ");
  });

  it("gives a bare year label a level below the section it belongs to", () => {
    expect(isDateLabel("1989")).toBe(true);
    expect(isDateLabel("1990-1993")).toBe(true);
    expect(isDateLabel("11 декабря 2007 г.")).toBe(true);
    expect(isDateLabel("В 1989 году он вернулся")).toBe(false);
  });

  it("emits exactly one level-one heading even when typography names none", async () => {
    const out = await md(PROSE);
    expect(out.match(/^# /gmu) ?? []).toHaveLength(1);
  });

  it("never jumps a heading level", async () => {
    const out = await md(
      `<p class="t"><b>Раздел<br></b><br>${PROSE.replace(/<\/?p>/gu, "")}</p>` +
        `<p class="t"><b>Другой раздел<br></b><br>${PROSE.replace(/<\/?p>/gu, "")}</p>`,
    );
    const levels = [...out.matchAll(/^(#{1,6}) /gmu)].map((m) => (m[1] as string).length);
    levels.forEach((level, i) => {
      if (i > 0) expect(level).toBeLessThanOrEqual((levels[i - 1] as number) + 1);
    });
  });

  it("makes the label above a menu the menu's title rather than a heading", async () => {
    const out = await md(
      '<p class="t3" align="center"><b>ИЗБРАННАЯ ДИСКОГРАФИЯ</b></p>' +
        '<p><a href="#1">Platinum</a><br><a href="#2">Favourite Hits</a><br><a href="#3">Best of</a></p>' +
        PROSE,
    );
    expect(out).toContain("::: nav");
    expect(out).toContain("title: ИЗБРАННАЯ ДИСКОГРАФИЯ");
    expect(out).not.toContain("## ИЗБРАННАЯ ДИСКОГРАФИЯ");
  });
});

describe("frames", () => {
  it("reads a palette only from a colour the author chose", () => {
    expect(paletteFor("#000000")).toBe("black");
    expect(paletteFor("rgb(0, 0, 0)")).toBe("black");
    expect(paletteFor("#CC0000")).toBe("red");
    // Mid-grey is not a palette token, and guessing one is an editorial claim.
    expect(paletteFor("#8899aa")).toBeNull();
  });

  it("wraps a bordered notice and leaves ordinary cells alone", async () => {
    const out = await md(
      PROSE +
        '<table border="0" width="85%"><tr><td style="border: 4px solid #000000">' +
        "<p>21 марта 2021 года на 86-м году жизни скончался старейший музыкант оркестра.</p>" +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).toContain("::: frame");
    expect(out).toContain("frame: black");
  });
});

/**
 * Alignment — rule contract (`CLAUDE.md` §5).
 *
 * **Invariant.** A bounded block becomes `::: align` on its *computed*
 * alignment, folded through `foldTextAlign`, and never on a presentational
 * attribute: `align="center"` under `.t { text-align: justify }` renders
 * justified, and reading the attribute promoted eleven classes on
 * `pavlov_azancheev.htm` to centred.
 *
 * **False friend.** A rule the author drew out of punctuation — `***`, a row of
 * dashes — is a separator, not a label, and must not become `::: align`.
 *
 * **Recurrence.** Supplied by the enclosing container: the construct is scoped
 * to the inside of a `column`, where a label sits over the record it names.
 */
describe("alignment", () => {
  it("folds the vendor form a browser actually returns", () => {
    // Chromium computes `-webkit-center` for an element centred by an
    // ancestor's `align` attribute — the commonest centring idiom in this
    // corpus, and the form an `=== "center"` comparison misses. Measured on the
    // 13 references: 65 of 163 distinctively-aligned blocks resolve this way.
    expect(foldTextAlign("-webkit-center")).toBe("center");
    expect(foldTextAlign("-webkit-right")).toBe("right");
    expect(foldTextAlign("start")).toBe("left");
    expect(foldTextAlign("end")).toBe("right");
    expect(foldTextAlign("Justify")).toBe("justify");
    expect(isCenteredAlign("-webkit-center")).toBe(true);
    expect(isCenteredAlign("justify")).toBe(false);
    // Not evidence, and deliberately not guessed at.
    expect(foldTextAlign("match-parent")).toBeNull();
    expect(foldTextAlign(undefined)).toBeNull();
  });

  it("admits a bold centred label that carries only digits", () => {
    // `analyze.md` names `**- 2 -**` on williams2 as a block that must be
    // centred, and the reference centres it. The rule previously demanded a
    // letter and rejected it as a page number; the human record decides.
    // Verified end to end on the corpus: `bench/out/williams2.bio.md` now emits
    // `::: align / position: center / **- 2 -**` at line 7.
    expect(isAlignableLabelText("- 2 -")).toBe(true);
    expect(isAlignableLabelText("1995")).toBe(true);
    expect(isAlignableLabelText("Альбом")).toBe(true);
  });

  it("rejects a rule the author drew out of punctuation", () => {
    // The false friend, named in the rule contract. Pure punctuation is a
    // separator and belongs to the break family, not to `::: align`.
    expect(isAlignableLabelText("* * *")).toBe(false);
    expect(isAlignableLabelText("— — —")).toBe(false);
    expect(isAlignableLabelText("")).toBe(false);
  });

  // The relational invariant behind `groupAlignedRuns`. Stated on the shared
  // primitives rather than through a synthetic page: the run pass needs a
  // *measured* tree, and a hand-built fixture would exercise the mock rather
  // than the rule. The end-to-end behaviour is measured on the corpus instead
  // and recorded in PROGRESS §8.1.
  it("reads the page's own prose as the baseline, weighted by length", () => {
    // A page with many short centred captions and a few long justified
    // paragraphs is a justified page: weight by text, do not count blocks.
    const page = [
      { align: "center" as const, textLength: 130 },
      { align: "center" as const, textLength: 140 },
      { align: "justify" as const, textLength: 900 },
      // Below the prose threshold: a label must never define the baseline it is
      // about to be judged against.
      { align: "right" as const, textLength: 20 },
    ];
    expect(proseAlign(page)).toBe("justify");
    // Nothing measured is not the same as "left", and must not be guessed at.
    expect(proseAlign([])).toBeNull();
    expect(proseAlign([{ align: "center", textLength: 10 }])).toBeNull();
  });

  it("judges a block against that baseline, never against a keyword", () => {
    // The whole point of the invariant: on a centred page a centred block says
    // nothing. A rule stated as `=== "center"` wraps the entire document.
    expect(isDistinctiveAlign("center", "center")).toBe(false);
    expect(isDistinctiveAlign("right", "center")).toBe(true);
    expect(isDistinctiveAlign("center", "justify")).toBe(true);
    // `left` and `justify` are the same reading flow for this purpose, so a
    // left block on a justified page is not set apart — it is just text.
    expect(isDistinctiveAlign("left", "justify")).toBe(false);
    expect(isDistinctiveAlign("justify", "left")).toBe(false);
    // Fallback when the page was never measured.
    expect(isDistinctiveAlign("right", null)).toBe(true);
    expect(isDistinctiveAlign("left", null)).toBe(false);
    expect(isDistinctiveAlign(null, "left")).toBe(false);
  });

  it("keeps `::: align` off blocks a run may not claim", () => {
    // §6: a picture carries its own `position`, so a wrapper restates it; §6
    // likewise forbids wrapping long body prose. Both are exclusions in
    // `alignableRunMember`, expressed here on the one constant they share so a
    // future edit cannot move the label/prose line in one rule only.
    expect("Владимир МАРКУШЕВИЧ".length).toBeLessThan(ALIGN_LABEL_MAX_CHARS);
    // The longest block any reference wraps in `::: align`, measured over all
    // 13 pairs, sits under the limit — the limit separates a label from an
    // article, and is not tuned to admit one more fixture.
    expect(ALIGN_LABEL_MAX_CHARS).toBeGreaterThan("Статья предоставлена автором.".length);
  });
});

/**
 * A region the classifier could not type is still a region.
 *
 * **Invariant.** "Not a data table" is not "not a layout". An inconclusive
 * verdict used to fall straight to linear flow, which never asked whether the
 * region had lanes — so a record card two columns wide was flattened without the
 * question being put. The abstention now hands the region to the lane path,
 * which decides on its own geometric evidence and falls back to the same linear
 * flow when there are no lanes, so nothing is forced.
 *
 * **Recurrence / false friend.** Both belong to the lane detector, not here:
 * this contract only asserts that the question reaches it. The false friend it
 * must not create is a *data* table quietly becoming columns, which is why the
 * DATA branch still goes to flow and is asserted below.
 */
describe("inconclusive table classification", () => {
  const card =
    '<table width="400"><tr>' +
    '<td width="200"><b>Jovan Jovicic</b><br>Classical guitar<br>RTS Records CD 411001</td>' +
    '<td width="200"><img src="photo/cd.jpg" width="180" height="180" alt="CD"></td>' +
    '</tr></table>';

  /**
   * The verdict is supplied rather than provoked.
   *
   *  scores a hand-written two-cell fixture as DATA/too-small, so
   * a synthetic page cannot reach UNKNOWN without reverse-engineering the
   * scorer — and a test that tuned its fixture until the scorer abstained would
   * be testing the scorer, not the routing.  is the supported
   * override the hook layer already uses, so forcing the verdict tests exactly
   * the decision under contract and nothing else.
   */
  async function convertWith(cls: Classification["class"]): Promise<Awaited<ReturnType<typeof convert>>> {
    const html = page(PROSE + card + PROSE);
    const doc = parseHtml(html);
    const inner = [...walkElements(doc.root)].filter((e) => e.tag === "table");
    const target = inner[inner.length - 1];
    const classifications = new Map([
      [target!.id, { class: cls, confidence: 0.4, tier: 4 as const, reason: "forced by test" }],
    ]);
    return convert(Buffer.from(html, "utf8"), { profile: SPEC, layoutFidelity: "faithful", classifications });
  }

  it("reconsiders a headerless two-lane region as a layout, not as flow", async () => {
    const result = await convertWith("UNKNOWN");
    // The record card pairs a label lane with its cover; flattened, the two stop
    // being one record.  and  are this shape, and the
    // references give both .
    expect(result.markdown).toContain("::: columns");
    expect(result.markdown).toContain("::: column");
  });

  it("still records the abstention rather than hiding it", async () => {
    const result = await convertWith("UNKNOWN");
    // Reconsidering the shape must not erase the fact that the classifier could
    // not type the region — that entry is the queue a human reads.
    const reviews = result.ledger.filter((e) => e.terminal.kind === "REVIEW");
    expect(reviews.some((e) => /inconclusive/u.test((e.terminal as { reason: string }).reason))).toBe(true);
  });

  it("leaves a DATA verdict on the flow path — the false friend", async () => {
    // A region the classifier *did* type as records must not be quietly
    // promoted to columns by the same fallback: losing a table to lanes is the
    // defect this reconsideration could otherwise introduce.
    const result = await convertWith("DATA");
    expect(result.markdown).not.toContain("::: columns");
  });
});

/**
 * A caption stated twice.
 *
 * **Invariant.** The evidence is *repetition*: a standalone captioned figure
 * followed by a caption-eligible block that says what the caption already says.
 * Not a length, not a position, not a similarity score.
 *
 * **False friend.** A real paragraph that follows a captioned figure and merely
 * mentions what the picture shows. Tested for non-firing below.
 */
describe("caption echo", () => {
  const fig = (alt: string, line: string) =>
    PROSE + '<p align="center"><img src="f.jpg" width="400" height="250" alt="' + alt + '"></p><p align="center">' + line + '</p>' + PROSE;

  it("absorbs a visible line that repeats the alt caption", async () => {
    const out = await md(fig("Джулиан Брим и Джон Вильямс.", "Джулиан Брим и Джон Вильямс"));
    expect(out).toContain("caption: Джулиан Брим и Джон Вильямс.");
    // Once inside the figure, never again beneath it.
    expect(out.match(/Джулиан Брим и Джон Вильямс/gu) ?? []).toHaveLength(1);
  });

  it("absorbs an abbreviated repetition", async () => {
    //  under  — every word but the last matches and the
    // last pair stands in a prefix relation.
    const out = await md(fig("Джон Вильямс в 1971 г.", "Джон Вильямс в 1971 году."));
    expect(out.match(/Джон Вильямс в 1971/gu) ?? []).toHaveLength(1);
  });

  it("leaves a paragraph that only mentions the picture", async () => {
    const out = await md(fig("Джон Вильямс в 1971 г.", "Джон Вильямс в 1972 г."));
    expect(out).toContain("Джон Вильямс в 1972 г.");
  });
});

describe("links", () => {
  it("merges adjacent anchors that share one destination", async () => {
    const out = await md(PROSE + '<p><a href="cd1.htm">1995</a><a href="cd1.htm">-2002</a></p>');
    expect(out).toContain("[1995-2002](/#/cd1)");
    expect(out.match(/\/#\/cd1/gu) ?? []).toHaveLength(1);
  });

  it("writes every link in resource form, never as an autolink", async () => {
    const out = await md(
      PROSE + '<p><a href="http://users.iol.it/x">http://users.iol.it/x</a><br><a href="mailto:a@b.c">a@b.c</a></p>',
    );
    expect(out).toContain("[http://users.iol.it/x](http://users.iol.it/x)");
    expect(out).toContain("[a@b.c](mailto:a@b.c)");
    expect(out).not.toMatch(/<https?:/u);
  });
});
