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
import { isDateLabel } from "./structure.js";
import { groupIsLineated, isWrapBreak, liftBreaks, splitLines } from "./lines.js";
import { groupColumnsFor, isDecorative, sizeTokenFor } from "./media.js";
import { paletteFor } from "./frames.js";
import { parseHtml } from "../ladom/parse.js";
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
