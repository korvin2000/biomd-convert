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
import type { Measurer, MeasureResult } from "../ladom/measure.js";
import type { LadomDocument, ResolvedStyle } from "../ladom/types.js";
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

/**
 * A measurement stand-in that reads the inline `style` attribute.
 *
 * The alignment family keys on *computed* alignment, and `NullMeasurer` — what
 * `convert` falls back to — deliberately leaves `style` undefined rather than
 * inventing plausible numbers. Without a stand-in no alignment rule can be
 * exercised end to end here at all, which is why every other contract in this
 * family is stated against the helpers instead.
 *
 * It resolves nothing: it copies `text-align` off the attribute and fills the
 * rest of `ResolvedStyle` with neutral values. That is enough for a rule whose
 * evidence is alignment, and it stays honest by not pretending to cascade.
 */
class InlineAlignMeasurer implements Measurer {
  readonly available = true;

  async measure(_html: string, doc: LadomDocument): Promise<MeasureResult> {
    for (const el of walkElements(doc.root)) {
      el.visible = !/display:\s*none|visibility:\s*hidden/iu.test(el.attrs["style"] ?? "");
      // Only where the element says so. Filling in a value everywhere would
      // overwrite the attribute heuristics the rest of the pipeline still runs
      // on here, and a stand-in that changes unrelated decisions is not a
      // stand-in for measurement — it is a second, worse cascade.
      const align = /text-align:\s*([a-z-]+)/iu.exec(el.attrs["style"] ?? "");
      const style = /font-style:\s*([a-z-]+)/iu.exec(el.attrs["style"] ?? "");
      if (align || style) {
        el.style = {
          ...NEUTRAL_STYLE,
          ...(align ? { textAlign: (align[1] as string).toLowerCase() } : {}),
          ...(style ? { fontStyle: (style[1] as string).toLowerCase() } : {}),
        };
      }
    }
    doc.measured = false;
    return { measured: false, warnings: [] };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

const NEUTRAL_STYLE: ResolvedStyle = {
  display: "block",
  position: "static",
  float: "none",
  textAlign: "start",
  verticalAlign: "baseline",
  fontSize: 16,
  fontWeight: 400,
  fontStyle: "normal",
  color: "rgb(0, 0, 0)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  borderTopWidth: 0,
  borderRightWidth: 0,
  borderBottomWidth: 0,
  borderLeftWidth: 0,
  borderStyle: "none",
  borderColor: "rgb(0, 0, 0)",
  paddingTop: 0,
  paddingLeft: 0,
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
};

async function mdMeasured(body: string): Promise<string> {
  const result = await convert(Buffer.from(page(body), "utf8"), {
    profile: SPEC,
    measurer: new InlineAlignMeasurer(),
  });
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

  it("keeps a black border the author wrote on black text", async () => {
    // The computed value cannot tell `border: 4px solid #000000` on a cell
    // whose text is also black from a colourless `border-style: solid`, and the
    // guard against the second was rejecting the first. Six of `news`'s nine
    // obituary notices are written this way; the reference frames all nine.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td style="border: 4px solid #000000; color: #000000">' +
        "<p>16 июня 2014 года скоропостижно скончался замечательный российский гитарист.</p>" +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).toContain("frame: black");
  });

  it("still declines a border whose colour the author never named", async () => {
    // The false friend the guard exists for: with no colour declared, the
    // border computes to the text colour, and reading a palette out of that
    // turned a festival announcement the reference set as a quotation into a
    // black callout. Nothing is declared here, so nothing is chosen.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td style="border-style: solid; border-width: 4px">' +
        "<p>Десятый юбилейный Международный музыкальный фестиваль в городе Калуге.</p>" +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).not.toContain("::: frame");
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
describe("alignment inside a bounded container", () => {
  it("wraps a centred run inside a frame — §13 permits align in a frame", async () => {
    // A framed notice sets its announcement apart from the page around it, and
    // `news` does exactly this eight times, once per obituary. The pass stands
    // down while a bounded interior is still being speculated about, because a
    // region detector reads the produced shape back — but standing down forever
    // contradicted §13, which names `frame` as a place `align` may appear.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td width="94%" style="border: 4px solid #000000">' +
        '<p style="text-align: center">10 декабря 2018 года ушел из жизни гитарист</p>' +
        '<p style="text-align: center">Виктор Михайлович Ефремов, 1937 года рождения</p>' +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).toContain("::: frame");
    expect(out).toContain("::: align");
    expect(out.indexOf("::: frame")).toBeLessThan(out.indexOf("::: align"));
  });

  it("still leaves a real caption to its figure", () => {
    // The veto that used to block the case above is a *position*, not a flag:
    // a caption stands under its picture. Both facts have to hold at once, so
    // this is asserted beside it rather than in the caption suite.
    return mdMeasured(
      PROSE +
        '<p style="text-align: center"><img src="f.jpg" width="400" height="250"></p>' +
        '<p class="st" style="text-align: center; font-size: 9pt">Андрес Сеговия в 1936 году</p>' +
        PROSE,
    ).then((out) => {
      expect(out).toContain("caption: Андрес Сеговия в 1936 году");
      expect(out).not.toContain("::: align");
    });
  });
});

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
    // From the measurement rather than from one fixture: over the 75 blocks the
    // 13 references place inside an `::: align`, the longest is 300 characters
    // — `news`'s obituary of 26 February 2014 — so the limit has to clear it.
    expect(ALIGN_LABEL_MAX_CHARS).toBeGreaterThan(300);
  });

  it("never wraps a list, however the page sets it", () => {
    // §13 enumerates what a bounded group is — "a short paragraph, dedication,
    // small heading group, or credit line" — and none of 499 list items across
    // the 13 references sits inside an `::: align`. The length cap used to hide
    // this: `segovia`'s discography is 24 items, so the first cap large enough
    // to admit a real notice centred the whole discography with it.
    return mdMeasured(
      PROSE +
        '<ul style="text-align: center">' +
        "<li>Centenary Celebration</li><li>Complete 1949 London Recordings</li>" +
        "<li>Short Spanish Pieces</li></ul>" +
        PROSE,
    ).then((out) => {
      expect(out).toContain("- Centenary Celebration");
      expect(out).not.toContain("::: align");
    });
  });

  it("does not wrap a block that is set the way the page is set", () => {
    // The length cap is a ceiling, not a discriminator — 98 of the 153
    // top-level paragraphs in the references are shorter than it. What keeps
    // article prose out of `::: align` is the *relational* test, so that is
    // what this asserts: a centred block on a page whose prose is centred too
    // says nothing, however short it is.
    return mdMeasured(
      '<p style="text-align: center">Он был выдающимся гитаристом своего поколения и оставил ' +
        "обширное наследие, которое до сих пор изучают исполнители по всему миру, а его записи " +
        "переиздаются регулярно и остаются образцом для подражания следующих поколений.</p>" +
        '<p style="text-align: center">Владимир МАРКУШЕВИЧ</p>' +
        '<p style="text-align: center">Он стремился преодолеть стереотипы и утвердить гитару в ' +
        "качестве солирующего инструмента, обращаясь к разным композиторам Европы и Америки, " +
        "многие из которых до встречи с ним для гитары не сочиняли вовсе.</p>",
    ).then((out) => {
      expect(out).toContain("Владимир МАРКУШЕВИЧ");
      expect(out).not.toContain("::: align");
    });
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
describe("captions bind to the visible line", () => {
  /** A centred figure over a centred small-type line — the era's figure idiom. */
  const fig = (alt: string, line: string) =>
    PROSE +
    '<p align="center"><img src="f.jpg" width="400" height="250"' +
    (alt === "" ? "" : ' alt="' + alt + '"') +
    '></p><p class="st" style="text-align: center; font-size: 9pt">' +
    line +
    "</p>" +
    PROSE;

  it("prefers the visible caption over the alt text", async () => {
    const out = await md(fig("Джон Вильямс в 1971 г.", "Джон Вильямс в 1971 году."));
    expect(out).toContain("caption: Джон Вильямс в 1971 году.");
    expect(out).not.toContain("в 1971 г.");
    // Once inside the figure, never again beneath it.
    expect(out.match(/Джон Вильямс в 1971/gu) ?? []).toHaveLength(1);
  });

  it("keeps the visible wording even when alt says the same thing", async () => {
    const out = await md(fig("Джулиан Брим и Джон Вильямс.", "Джулиан Брим и Джон Вильямс"));
    expect(out).toContain("caption: Джулиан Брим и Джон Вильямс\n");
    expect(out.match(/Джулиан Брим и Джон Вильямс/gu) ?? []).toHaveLength(1);
  });

  it("falls back to alt when there is no visible caption", async () => {
    const out = await md(
      PROSE + '<p align="center"><img src="f.jpg" width="400" height="250" alt="Андрес Сеговия"></p>' + PROSE,
    );
    expect(out).toContain("caption: Андрес Сеговия");
  });

  it("binds every line of a multi-line caption, not just the first", async () => {
    const out = await md(fig("", "Гостиница «Европейская»<br>Ленинград, 1936 г."));
    // A `<br>` is a line boundary, so it becomes a space rather than vanishing.
    expect(out).toContain("caption: Гостиница «Европейская» Ленинград, 1936 г.");
    expect(out).not.toContain("»Ленинград");
  });

  it("sets a bold title line off from the detail it introduces", async () => {
    const out = await md(fig("", "<b>А. Сеговия с учениками</b><br>В нижнем ряду второй справа Виль Белильников."));
    expect(out).toContain("caption: А. Сеговия с учениками — В нижнем ряду второй справа Виль Белильников.");
  });

  it("does not read a line above the picture as its caption", async () => {
    // `news` sets an obituary's subject in bold *above* the photograph, and the
    // reference keeps it as prose. Sibling order is the evidence.
    const out = await md(
      PROSE +
        '<p class="st" style="text-align: center; font-size: 9pt"><b>Юрий Алексеевич СМИРНОВ</b></p>' +
        '<p align="center"><img src="f.jpg" width="400" height="250" alt="Юрий Смирнов"></p>' +
        PROSE,
    );
    expect(out).toContain("Юрий Алексеевич СМИРНОВ");
    expect(out).toContain("caption: Юрий Смирнов");
  });

  it("does not swallow a section label that is small but not centred", async () => {
    // `ДИСКОГРАФИЯ` above its album list is set in small type like a caption and
    // is not centred like one. Binding it to the cover above deleted a section.
    const out = await md(
      PROSE +
        '<p align="center"><img src="f.jpg" width="400" height="250" alt="Обложка"></p>' +
        '<p class="st" style="font-size: 9pt; text-align: left"><b>ДИСКОГРАФИЯ</b></p>' +
        PROSE,
    );
    expect(out).toContain("ДИСКОГРАФИЯ");
    expect(out).toContain("caption: Обложка");
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
describe("a menu written as a table", () => {
  /** One row per item — the other way this era wrote a side menu. */
  const menu = (rows: string) => `<table border="0" width="85%">${rows}</table>`;
  const row = (cell: string) => `<tr><td width="100%">${cell}</td></tr>`;
  const item = (href: string, label: string) => row(`<p><a href="${href}">${label}</a></p>`);

  it("becomes a nav, with the unlinked first row as its title", async () => {
    const out = await md(
      PROSE +
        menu(
          row("<p>Дискография</p>") +
            item("williams_cd1.htm", "1995-2002") +
            item("williams_cd2.htm", "1989-1994") +
            item("williams_cd3.htm", "1979-1988"),
        ) +
        PROSE,
    );
    expect(out).toContain("::: nav");
    expect(out).toContain("title: Дискография");
    expect(out).toContain("- [1995-2002](/#/williams_cd1)");
    // Routed as a catalog it came out as one region per row with `---` between.
    expect(out).not.toContain("::: columns");
  });

  it("joins anchors that share one destination into a single item", async () => {
    // FrontPage splits a label across two `<a>` often enough that `williams2`
    // writes its first item as `<a>1995</a><a>-2002</a>`.
    const out = await md(
      PROSE +
        menu(
          row('<p><a href="cd1.htm">1995</a><a href="cd1.htm">-2002</a></p>') +
            item("cd2.htm", "1989-1994") +
            item("cd3.htm", "1979-1988"),
        ) +
        PROSE,
    );
    expect(out).toContain("- [1995-2002](/#/cd1)");
    expect(out.match(/\/#\/cd1/gu) ?? []).toHaveLength(1);
  });

  it("leaves a two-column score table alone", async () => {
    // False friend: a row here is a work *and* its tablature link, so the row
    // fills two columns. A menu item fills one.
    const out = await md(
      PROSE +
        menu(
          '<tr><td>Danza Paraguaya</td><td><a href="t/dp1.txt">TAB</a></td></tr>' +
            '<tr><td>Julia Florida</td><td><a href="t/jf.txt">TAB</a></td></tr>' +
            '<tr><td>La Catedral</td><td><a href="t/lc.txt">TAB</a></td></tr>',
        ) +
        PROSE,
    );
    expect(out).not.toContain("::: nav");
    expect(out).toContain("Danza Paraguaya");
  });

  it("leaves a figure over its caption alone", async () => {
    // False friend: one column, but two rows and no links — the era's figure.
    const out = await md(
      PROSE +
        menu(
          row('<img src="f.jpg" width="209" height="281">') +
            row('<p class="ph" style="text-align: center">Андрес Сеговия, 1936</p>'),
        ) +
        PROSE,
    );
    expect(out).not.toContain("::: nav");
    expect(out).toContain("Андрес Сеговия, 1936");
  });

  it("does not read a stack of citations as a menu", async () => {
    // False friend: one link per row, but the cell is a sentence around it, so
    // the label test fails and the rows stay prose.
    const out = await md(
      PROSE +
        menu(
          row('<p>См. также <a href="a.htm">Барриос</a> и его записи</p>') +
            row('<p>См. также <a href="b.htm">Сеговия</a> и его записи</p>') +
            row('<p>См. также <a href="c.htm">Таррега</a> и его записи</p>'),
        ) +
        PROSE,
    );
    expect(out).not.toContain("::: nav");
  });

  it("rejects a stack whose rows point at one destination", async () => {
    // Repeated destinations mean the source was listing, not navigating, and
    // §11 makes duplicate labels invalid outright.
    const out = await md(
      PROSE + menu(item("x.htm", "первая") + item("x.htm", "вторая") + item("x.htm", "третья")) + PROSE,
    );
    expect(out).not.toContain("::: nav");
  });
});

describe("a document the source set apart from the article", () => {
  /** The page's own narrative voice, upright and long enough to be sampled. */
  const ARTICLE =
    '<p style="font-style: normal">Матвей Степанович Павлов-Азанчеев родился в 1888 году и всю ' +
    "жизнь посвятил семиструнной гитаре, оставив после себя обширное нотное наследие, которое до " +
    "сих пор изучают исполнители, а его письма сохранились в архиве Александра Ларина.</p>";
  const letter = (text: string) => `<p style="font-style: italic">${text}</p>`;

  it("quotes a run of italic blocks when the shape recurs", async () => {
    const out = await mdMeasured(
      ARTICLE +
        '<p>• Письмо М.Павлова — А.Ларину (Краснодар, 28 августа 1946 г.)</p>' +
        letter("Уважаемый Александр Яковлевич! Простите, что не будучи с Вами знаком пишу Вам.") +
        '<p>• Письмо А.Максимова — А.Ларину (Владикавказ, 9 января 1946 г.)</p>' +
        letter("Дела и новости таковы: положение первого неопределённо, дела направлены в Москву.") +
        ARTICLE,
    );
    expect(out).toContain("> Уважаемый Александр Яковлевич!");
    expect(out).toContain("> Дела и новости таковы:");
    // The headnote naming each letter is the article's voice, not the letter's.
    expect(out).not.toContain("> • Письмо");
  });

  it("leaves a single italic block alone", async () => {
    // Recurrence is what separates a page of quoted documents from a page with
    // one italic credit line. `barrios` has exactly one and the reference
    // quotes nothing; `borislova` has one and the reference quotes elsewhere.
    const out = await mdMeasured(ARTICLE + letter("Подробнее см. «Барриос Мангори — жизнь и творчество».") + ARTICLE);
    expect(out).toContain("Подробнее см.");
    expect(out).not.toContain("> Подробнее");
  });

  it("does not quote a paragraph that merely contains an italic phrase", async () => {
    // §3.5: "Do not turn titles, scare quotes, ordinary dialogue fragments … into
    // a block quote." A `<p>` wrapping `<i>` computes upright and stays prose.
    const out = await mdMeasured(
      ARTICLE +
        "<p>Он записал <i>Чакону</i> в 1946 году.</p>" +
        "<p>Позднее он записал <i>Сарабанду</i> и <i>Гавот</i>.</p>" +
        ARTICLE,
    );
    expect(out).not.toContain("> ");
  });

  it("says nothing on a page whose prose is italic throughout", async () => {
    // With no upright prose to contrast against, italic carries no information.
    // The test is contrast, not majority — a majority test would let the quotes
    // on an archive page disqualify themselves.
    const italicArticle = ARTICLE.replace("font-style: normal", "font-style: italic");
    const out = await mdMeasured(italicArticle + letter("Уважаемый Александр Яковлевич!") + italicArticle);
    expect(out).not.toContain("> ");
  });
});
