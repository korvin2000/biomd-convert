/**
 * Behavioural contracts recovered from the reference conversions.
 *
 * Each case below is a shape the converter used to get wrong on a real page in
 * `fixtures/html`, expressed as the smallest markup that reproduces it. They
 * are written against observable output rather than internals, so a different
 * implementation of the same recovery still passes.
 */
import { describe, expect, it } from "vitest";
import type { List, Paragraph } from "mdast";
import { convert } from "./pipeline.js";
import {
  ALIGN_LABEL_MAX_CHARS,
  foldBreaks,
  isAlignableLabelText,
  isDateLabel,
  promoteLabelBeforeList,
} from "./structure.js";
import type { Classification } from "./classify.js";
import { groupIsLineated, isWrapBreak, liftBreaks, splitLines } from "./lines.js";
import { iconGlyphFor, isDrawnRule } from "./glyphs.js";
import { groupColumnsFor, isDecorative, isUiIcon, sizeTokenFor } from "./media.js";
import { paletteFor } from "./frames.js";
import { parseHtml } from "../ladom/parse.js";
import type { Measurer, MeasureResult } from "../ladom/measure.js";
import type { LadomDocument, ResolvedStyle } from "../ladom/types.js";
import { foldTextAlign, isCenteredAlign, isDistinctiveAlign, proseAlign } from "../ladom/style.js";
import { resolveProfile } from "../biomd-ast/index.js";
import type { BiomdContent } from "../biomd-ast/index.js";
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
      const declared = el.attrs["style"] ?? "";
      const align = /text-align:\s*([a-z-]+)/iu.exec(declared);
      const style = /font-style:\s*([a-z-]+)/iu.exec(declared);
      const border = borderOf(declared);
      // The one UA default this stand-in owes the rules: `<i>` and `<em>`
      // compute `font-style: italic` in every browser without declaring it,
      // and `segovia` sets its quotations apart with exactly `<i>` and no
      // stylesheet at all. Leaving it out made the subordination rule
      // untestable end-to-end while looking like the rule being wrong.
      const uaItalic = el.tag === "i" || el.tag === "em";
      // A background is painted by the `bgcolor` attribute as often as by CSS
      // here, and the frame rule compares an element's against its ancestors'.
      const declaredBg = /background-color:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/iu.exec(declared)?.[1];
      const bg = declaredBg ?? el.attrs["bgcolor"];
      if (align || style || border || uaItalic || bg) {
        el.style = {
          ...NEUTRAL_STYLE,
          ...(uaItalic ? { fontStyle: "italic" } : {}),
          ...(align ? { textAlign: (align[1] as string).toLowerCase() } : {}),
          ...(style ? { fontStyle: (style[1] as string).toLowerCase() } : {}),
          ...(bg ? { backgroundColor: bg.toLowerCase() } : {}),
          ...(border ?? {}),
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

/**
 * The border half of the stand-in, resolved the way a browser would.
 *
 * Frames are measurement-driven exactly as alignment is: the fallback parser in
 * `frames.ts` reads only a `border:` shorthand, so a test written against
 * `border-style: solid` would silently exercise the degraded path and prove
 * nothing about the rule. It resolves the shorthand and the longhands, and
 * mirrors the one browser behaviour that matters here — an omitted border
 * colour inherits from `color`, and an unrecognised width falls back to
 * `medium` (3 px), which is what makes a unitless `border-width: 1` render.
 */
function borderOf(declared: string): Partial<ResolvedStyle> | null {
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/iu.exec(declared)?.[1]?.trim();
  const shorthand = /(?:^|;)\s*border\s*:\s*([^;]+)/iu.exec(declared)?.[1]?.trim();
  const tokens = shorthand ? shorthand.split(/\s+/u) : [];
  const width =
    /(?:^|;)\s*border-width\s*:\s*([^;]+)/iu.exec(declared)?.[1]?.trim() ??
    tokens.find((t) => /^[\d.]/u.test(t));
  const lineStyle =
    /(?:^|;)\s*border-style\s*:\s*([a-z]+)/iu.exec(declared)?.[1] ??
    tokens.find((t) => /^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)$/iu.test(t));
  const borderColor =
    /(?:^|;)\s*border-color\s*:\s*([^;]+)/iu.exec(declared)?.[1]?.trim() ??
    tokens.find((t) => t.startsWith("#") || t.startsWith("rgb"));
  if (lineStyle === undefined && width === undefined) return null;

  const px = width !== undefined && /^[\d.]+px$/u.test(width) ? Number.parseFloat(width) : 3;
  const resolved = lineStyle === undefined ? "none" : lineStyle.toLowerCase();
  const effective = resolved === "none" || resolved === "hidden" ? 0 : px;
  return {
    borderStyle: resolved,
    borderTopWidth: effective,
    borderRightWidth: effective,
    borderBottomWidth: effective,
    borderLeftWidth: effective,
    borderColor: borderColor ?? color ?? "rgb(0, 0, 0)",
    ...(color ? { color } : {}),
  };
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

  it("folds a break out of a heading at every depth", () => {
    // A heading is one line. A `<br>` nested inside the emphasis that covers
    // only the first line — `<b>Title<br></b>subtitle` — used to survive the
    // top-level fold and force the serializer into setext form.
    const folded = foldBreaks([
      { type: "strong", children: [{ type: "text", value: "Title" }, { type: "break" }] },
      { type: "link", url: "/x", children: [{ type: "text", value: "a" }, { type: "break" }, { type: "text", value: "b" }] },
      { type: "break" },
      { type: "text", value: "tail" },
    ]);
    const types = (n: unknown): unknown =>
      Array.isArray((n as { children?: unknown }).children)
        ? [(n as { type: string }).type, ((n as { children: unknown[] }).children ?? []).map(types)]
        : (n as { type: string }).type;
    expect(folded.map(types)).toEqual([
      ["strong", ["text", "text"]],
      ["link", ["text", "text", "text"]],
      "text",
      "text",
    ]);
    // False friend: a break outside a heading is meaning, not line-fitting, so
    // nothing else in the pipeline may call this — `liftBreaks` is that path.
    expect(liftBreaks([{ type: "strong", children: [{ type: "text", value: "1989" }, { type: "break" }] }]).map((n) => n.type)).toEqual([
      "strong",
      "break",
    ]);
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

  /**
   * Rule contract — a linked micro-image that a known asset table recognises is
   * a control, and becomes its glyph rather than a picture.
   *
   * *Invariant:* containment in an `<a href>`, icon geometry in both dimensions,
   * and a hit in `glyphs.ts`'s documented table. No filename, class or id is
   * named here or in `isUiIcon`; the table is the lexical data invariant 5
   * requires, and an unlisted asset degrades to the old behaviour.
   *
   * *Recurrence:* deliberately not required. A pager is drawn once per page —
   * `new_karta` has exactly one arrow — so the recurrence that licenses this is
   * cross-document (one shared asset, every page) and is what the table records.
   *
   * *False friend:* a linked thumbnail, and the corpus's own near-miss — a
   * linked, icon-ish site badge that carries a caption and is not in the table.
   * Both must keep their image.
   */
  it("turns a linked known icon into its glyph and leaves a linked thumbnail alone", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><a href="karta2.htm"><img src="../main/next.gif" width="16" height="16"></a></p>' +
        '<p align="center"><a href="rechin3.htm"><img src="../main/back.gif" width="11" height="11"></a>&nbsp;' +
        '<a href="rechin.htm"><img src="../main/h2.gif" width="16" height="16"></a></p>',
    );
    expect(out).toContain("[▶](/#/karta2)");
    expect(out).toContain("[◀](/#/rechin3)");
    expect(out).toContain("[●](/#/rechin)");
    // The pair no longer reads as a plate of two pictures.
    expect(out).not.toContain("::: images");
    expect(out).not.toContain("main/back.gif");
  });

  it("labels a known icon with its `alt` when the author wrote one", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><a href="geyzel_03.htm">' +
        '<img src="../main/previous.gif" width="16" height="16" alt="Главы 8-9"></a></p>',
    );
    expect(out).toContain("[Главы 8-9](/#/geyzel_03)");
    expect(out).not.toContain("◀");
  });

  it("does not fire on a linked thumbnail or on an unlisted linked badge", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><a href="http://www.km.ru"><img src="../main/km.gif" width="28" height="28"' +
        ' alt="Источник: Большая энциклопедия"></a></p>' +
        '<p align="center"><a href="photo/big.jpg"><img src="photo/thumb.jpg" width="30" height="30"' +
        ' alt="Сеговия"></a></p>',
    );
    expect(out).toContain("src: ../main/km.gif");
    expect(out).toContain("src: photo/thumb.jpg");
  });

  it("leaves an unlinked known icon to the decorative filter", () => {
    const doc = parseHtml('<body><img src="../main/score3.jpg" width="32" height="14"></body>');
    const img = [...walkElements(doc.root)].find((e) => e.tag === "img");
    expect(img && isUiIcon(img)).toBe(false);
  });

  it("keys the icon table on the stem, ignoring case, directory and extension", () => {
    // The guide spells the score icon `.gif`; the page that uses it writes `.jpg`.
    expect(iconGlyphFor("/main/score3.gif")?.text).toBe("♫");
    expect(iconGlyphFor("../MAIN/Score3.JPG?v=2")?.text).toBe("♫");
    expect(iconGlyphFor("photo/s/segovia3.jpg")).toBeNull();
    expect(iconGlyphFor("")).toBeNull();
    expect(iconGlyphFor("/main/ak.gif")).toEqual({ text: "А-К", mark: "letter" });
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

  it("titles a menu with the decorated label the page set above it", async () => {
    // §11 puts the label a page puts above its menu in `nav`'s `title`. The
    // existing branch takes a *recovered heading*; `news` and `news_2007` set
    // theirs in a tinted centred cell of its own, where no typographic rule
    // reaches it, so it arrives as an aligned paragraph instead. Position is
    // the evidence either way. The matched bullets are decoration — symmetry
    // is what says so, and a leading marker alone still means a list item.
    const out = await mdMeasured(
      `${PROSE}<p style="text-align: center">&#8226; Архив новостей &#8226;</p>` +
        '<p style="text-align: center">[<a href="a.htm">2007</a> ] ' +
        '[<a href="b.htm">2006</a> ] [<a href="c.htm">2005</a> ]</p>',
    );
    expect(out).toContain("::: nav");
    expect(out).toContain("title: Архив новостей");
    expect(out).not.toContain("• Архив новостей •");
  });

  it("false friend: a sentence above a menu is not its title", async () => {
    // Absorbing one would move body text into a directive property, which is
    // the worst direction this rule can fail in.
    const sentence = "Ниже собраны ссылки на все выпуски архива нашего проекта за прошедшие годы.";
    const out = await mdMeasured(
      `${PROSE}<p style="text-align: center">${sentence}</p>` +
        '<p style="text-align: center">[<a href="a.htm">2007</a> ] ' +
        '[<a href="b.htm">2006</a> ] [<a href="c.htm">2005</a> ]</p>',
    );
    expect(out).toContain("::: nav");
    expect(out).not.toContain(`title: ${sentence}`);
    expect(out).toContain(sentence);
  });

  it("recovers a section label that follows a banner carrying its own words", async () => {
    // The caption guard asks whether a picture stands above the label, and it
    // has to mean a picture still looking for its words. `new_blackmore` sets
    // each reprinted interview under a small table holding the paper's date and
    // a linked masthead image; that block has already said what it is, and
    // reading it as "a photograph above" cost the article below its heading.
    const banner =
      '<div align="center"><table border="0" width="80%"><tr>' +
      '<td width="29%"><p>27 марта 2002 г.</p></td>' +
      '<td width="71%"><a href="a.htm"><img src="photo/b/kp.jpg" width="294" height="34"></a></td>' +
      "</tr></table></div>";
    const out = await md(`${PROSE}${banner}<p class="t"><b>Гитарист "тяжелого" поведения</b></p>${PROSE}${PROSE}`);
    expect(out).toMatch(/^## Гитарист "тяжелого" поведения$/mu);
  });

  it("false friend: a bare picture above a short line still makes it a caption", async () => {
    // The other half of the same decision. A picture with no words of its own
    // is one that has not been captioned yet, and the line under it is what
    // captions it — which is why the guard exists at all.
    const out = await md(
      `${PROSE}<p><img src="photo/s/segovia.jpg" width="300" height="400"></p>` +
        `<p align="center"><b>Андрес Сеговия в 1936 году</b></p>${PROSE}${PROSE}`,
    );
    expect(out).not.toMatch(/^## Андрес Сеговия в 1936 году$/mu);
  });

  it("reads a run of one repeated ornament as the rule the author drew", async () => {
    // Cardinality, not typography: three of the same ornament and nothing else
    // in the block. `CLAUDE.md` invariant 4 puts drawing a separator outside
    // §16.3 — a rule invents no text — and as a paragraph it renders as three
    // escaped asterisks where the page showed a division.
    expect(isDrawnRule("* * *")).toBe(true);
    expect(isDrawnRule("***")).toBe(true);
    expect(isDrawnRule("• • •")).toBe(true);
    expect(isDrawnRule("— — —")).toBe(true);
    // False friends, every one of them a real line in this corpus.
    expect(isDrawnRule("*")).toBe(false); // a footnote marker
    expect(isDrawnRule("* *")).toBe(false); // two markers, not a dinkus
    expect(isDrawnRule("• Из письма А.Максимова")).toBe(false); // a bulleted label
    expect(isDrawnRule("* — примечание")).toBe(false); // a marker and its note
    expect(isDrawnRule("*-*")).toBe(false); // two ornaments mixed is decoration
    const out = await md(`${PROSE}<p align="center">* * *</p>${PROSE}`);
    expect(out).toMatch(/^(-{3,}|\*{3,})$/mu);
    expect(out).not.toContain("\\* \\* \\*");
  });

  it("does not read a rule as introducing a byline set right of the column", async () => {
    // A short line under a rule is a section label — that is the only evidence
    // `promoteSectionAfterRule` has. A line the author set *right* carries its
    // own positional evidence and it says the opposite: a credit closes what
    // precedes it. Both `pavlov_azancheev` and `new_blackmore` write one, and
    // both references keep it an `::: align position: right`.
    const out = await mdMeasured(
      `${PROSE}<p align="center">* * *</p>` +
        `<p style="text-align: right">Владимир МАРКУШЕВИЧ</p>${PROSE}${PROSE}`,
    );
    expect(out).not.toContain("## Владимир МАРКУШЕВИЧ");
    expect(out).toContain("Владимир МАРКУШЕВИЧ");
  });

  it("still reads a rule as introducing a centred section label", async () => {
    // The other half of the same decision, and the line the rule was built for:
    // `borislova`'s discography label is centred, so excluding every
    // distinctively aligned block would cost it.
    const out = await mdMeasured(
      `${PROSE}<p align="center">* * *</p>` +
        `<p style="text-align: center">Надя Борислова: ПРОИЗВЕДЕНИЯ ДЛЯ ГИТАРЫ</p>${PROSE}${PROSE}`,
    );
    expect(out).toMatch(/^#{2,3} Надя Борислова: ПРОИЗВЕДЕНИЯ ДЛЯ ГИТАРЫ$/mu);
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
    // whose text is also black from a colourless `border-style: solid`. A guard
    // against the second was rejecting the first, and six of `news`'s nine
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

  it("frames a border whose colour the author left to inherit", async () => {
    // The palette is the only question a colour answers, and a border left to
    // inherit black *is* black. `news_2007`'s festival announcement is written
    // this way and the reference writes `frame: black` for it.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td style="border-style: solid; border-width: 4px">' +
        "<p>Десятый юбилейный Международный музыкальный фестиваль в городе Калуге.</p>" +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).toContain("frame: black");
  });

  it("leaves a hairline alone — that is a cell grid, not a notice", async () => {
    // What actually separates a notice from table furniture is the width. A
    // 1 px rule is how this era drew a table, and framing it would put a
    // callout around every cell on the page.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td style="border: 1px solid #000000">' +
        "<p>Десятый юбилейный Международный музыкальный фестиваль в городе Калуге.</p>" +
        "</td></tr></table>" +
        PROSE,
    );
    expect(out).not.toContain("::: frame");
  });
});

/**
 * `<blockquote>` — rule contract (`CLAUDE.md` §5).
 *
 * The tag is an indent as often as a quotation in 1998 FrontPage, so §3.5's
 * evidence decides and the tag decides nothing. Recurrence is the page-level
 * gate the run pass already uses, which is why every fixture here carries two
 * subordinated regions: one would be a credit line, not a quoted archive.
 */
describe("a blockquote is quoted matter only when the source set it apart", () => {
  it("quotes a region the source wrote wholly in italic", async () => {
    // `segovia` writes exactly this — `<blockquote><i>…</i></blockquote>` —
    // and the reference quotes both of them.
    const out = await mdMeasured(
      PROSE +
        "<blockquote><i>Однажды в наш дом пришел гитарист фламенко.</i></blockquote>" +
        PROSE +
        "<blockquote><i>По дороге на сцену ко мне подошел старик.</i></blockquote>" +
        PROSE,
    );
    expect(out).toMatch(/^> \*?Однажды/mu);
    expect(out).toMatch(/^> \*?По дороге/mu);
  });

  it("reads an upright indent of parallel lines as a list, not a quote", async () => {
    // `kiselev` indents six track lists this way, each line ended with `<br>`,
    // and the reference emits lists — a run flattened here used to lose the
    // structure entirely (`retyped.paragraph-to-list`, PROGRESS §34).
    const out = await mdMeasured(
      PROSE +
        "<blockquote><p>Игра 0'52\"<br>Колыбельная 0'53\"</p></blockquote>" +
        PROSE +
        "<blockquote><p>Прелюдия 1'43\"<br>Листопад 1'20\"</p></blockquote>" +
        PROSE,
    );
    expect(out).not.toMatch(/^>/mu);
    expect(out).toContain("- Игра 0'52\"");
    expect(out).toContain("- Колыбельная 0'53\"");
  });

  it("does not read a single-line indent as a list — recurrence still applies", async () => {
    // One line has nothing to be parallel *with*. `listFromBlockquoteRun`'s own
    // floor (`lines.length < 2`), independent of the page-level gate above.
    const out = await mdMeasured(
      PROSE + "<blockquote><p>Записано в студии в 1993 году.</p></blockquote>" + PROSE,
    );
    expect(out).not.toContain("- Записано");
    expect(out).toContain("Записано в студии в 1993 году.");
  });

  it("does not read a multi-block indent as a list — the false friend", async () => {
    // A caption-and-credit pair, or any indent whose content is more than one
    // flat paragraph, is not this shape: `listFromBlockquoteRun` requires the
    // blockquote's *entire* lowered content to be exactly one paragraph.
    const out = await mdMeasured(
      PROSE +
        "<blockquote><p>Игра 0'52\"<br>Колыбельная 0'53\"</p><p>Записано в 1984 году.</p></blockquote>" +
        PROSE +
        "<blockquote><p>Прелюдия 1'43\"<br>Листопад 1'20\"</p><p>Записано в 1986 году.</p></blockquote>" +
        PROSE,
    );
    expect(out).not.toContain("- Игра");
    expect(out).toContain("Игра 0'52\"");
  });

  it("flattens an indent that merely carries structure", async () => {
    // `tarrega`'s score catalogue: nine blocks, headings and lists among them.
    // A region with its own outline is a section, not something quoted.
    const out = await mdMeasured(
      PROSE +
        "<blockquote><h2>Часть 1</h2><ul><li>Capricho Arabe</li></ul></blockquote>" +
        PROSE +
        "<blockquote><h2>Часть 2</h2><ul><li>Rosita (Polka)</li></ul></blockquote>" +
        PROSE,
    );
    expect(out).not.toMatch(/^>/mu);
    expect(out).toContain("Capricho Arabe");
  });

  it("does not quote an indent that holds one italic line among upright ones", async () => {
    // False friend: a credit or a title set apart inside an ordinary indented
    // region. `every` rather than `some` — quoted matter is a region the source
    // set *all* of apart, not one that contains something emphasised.
    const out = await mdMeasured(
      PROSE +
        "<blockquote><i>Записал А. Иванов</i><p>Протокол заседания от 12 мая.</p></blockquote>" +
        PROSE +
        "<blockquote><i>Записал А. Иванов</i><p>Протокол заседания от 19 мая.</p></blockquote>" +
        PROSE,
    );
    expect(out).not.toMatch(/^>/mu);
    expect(out).toContain("Протокол заседания от 12 мая.");
  });

  it("does not quote an italic phrase sitting beside bare text", async () => {
    // §3.5's own exclusion — "do not turn … ordinary dialogue fragments … into
    // a block quote". Text directly under the element was not set apart, so its
    // presence settles the question whatever sits next to it.
    const out = await mdMeasured(
      PROSE +
        "<blockquote>Он сказал: <i>гитара — маленький оркестр</i>, и вышел.</blockquote>" +
        PROSE +
        "<blockquote>Она добавила: <i>это язык сердца</i>, и села.</blockquote>" +
        PROSE,
    );
    expect(out).not.toMatch(/^>/mu);
    expect(out).toContain("маленький оркестр");
  });

  it("does not promote a record's own title above its recovered list to a heading", () => {
    // The other half of PROGRESS §34: `promoteLabelBeforeList` and
    // `promoteSectionAfterRule` see the same "label directly above a list"
    // shape `listFromBlockquoteRun` now produces, and neither originally
    // excluded a record region the way `headingLineOf` already does. Six
    // album titles above six recovered lists satisfy `promoteLabelBeforeList`'s
    // own recurrence floor of two, so the guard has to be the same
    // `ctx.tableDepth >= 2` exclusion, not recurrence.
    //
    // Unit-level, not `md()`: reproducing `ctx.tableDepth >= 2` through real
    // markup depends on how many page-frame tables the classifier collapses
    // before the walk reaches content, which is corpus-profile-sensitive and
    // not what this contract is about. `lanes.test.ts` sets the precedent for
    // a partial `as unknown as …` context carrying only the fields read.
    const label = (text: string): Paragraph => ({ type: "paragraph", children: [{ type: "text", value: text }] });
    const trackList: List = {
      type: "list",
      ordered: false,
      spread: false,
      children: [{ type: "listItem", spread: false, children: [label("Игра 0'52\"")] }],
    };
    const nodes: BiomdContent[] = [
      label("Детская сюита"),
      trackList,
      label("Осенняя сюита"),
      trackList,
    ];
    const ctxAt = (tableDepth: number): Parameters<typeof promoteLabelBeforeList>[1] =>
      ({ tableDepth, recoveredHeadings: new Set(), blockAlign: new Map() }) as unknown as Parameters<
        typeof promoteLabelBeforeList
      >[1];

    const inRecord = promoteLabelBeforeList(nodes, ctxAt(2));
    expect(inRecord.every((n) => n.type !== "heading")).toBe(true);

    // False friend, tested the other way: the exact same shape at the
    // article's own top level (`ДИСКОГРАФИЯ` above a `<ul>`, `See also:`
    // above a related-pages list) must still promote — the guard is scoped
    // to record regions, not disabled outright.
    const atTopLevel = promoteLabelBeforeList(nodes, ctxAt(1));
    expect(atTopLevel.filter((n) => n.type === "heading")).toHaveLength(2);
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

  it("frames a tinted panel that spans its row, and not a tinted lane cell", async () => {
    // `new_lendle2` writes `border: 1 solid #D5A96F` on five album panels — a
    // unitless width, so Chromium drops the whole shorthand and computes
    // `border-style: none`. The tint is the only evidence left.
    const panel = await mdMeasured(
      PROSE +
        '<div style="background-color: #F7E7AF"><table border="0" width="90%"><tr>' +
        '<td width="100%" colspan="2" style="background-color: #FCF3D8">Variations capricieuses</td>' +
        "</tr><tr>" +
        '<td width="50%">Niccolo Paganini: Caprice Nr. 24, and other works of the period</td>' +
        '<td width="50%">Wolfgang Lendle plays the caprices on a modern instrument</td>' +
        "</tr></table></div>" +
        PROSE,
    );
    expect(panel).toContain("::: frame");

    // False friend, and it is the whole rule: `goya2` tints fifteen cells the
    // same way, two to a row, and its reference frames none of them. A lane
    // cell is not a panel however it is coloured.
    const lanes = await mdMeasured(
      PROSE +
        '<div style="background-color: #F7E7AF"><table border="0" width="90%"><tr>' +
        '<td width="50%" style="background-color: #F5E29E">Francis Goya Plays His Favourite</td>' +
        '<td width="50%" style="background-color: #F5E29E">Best of Francis Goya, a compilation</td>' +
        "</tr></table></div>" +
        PROSE,
    );
    expect(lanes).not.toContain("::: frame");
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

  it("keeps a drawn rule inside the aligned block it was drawn in", async () => {
    // `kiselev` ends with one right-set `<p>` holding a rule and the signature
    // it divides. Split into two blocks, the rule carries no text, so it cannot
    // nominate an alignment — but it may join the run its own source block
    // opened, and hoisting it to the root put it in a different container from
    // the line below it.
    const out = await mdMeasured(
      PROSE + '<p style="text-align: right">-------------------------<br>Олег Киселев: oleg@list.ru</p>',
    );
    const align = out.indexOf("::: align");
    expect(align).toBeGreaterThan(-1);
    expect(out.indexOf("\n---\n")).toBeGreaterThan(align);
    expect(out).not.toContain("\\-----");
  });

  it("ends the aligned group at a rule the author drew between two lines", async () => {
    // `news`'s red congratulation notice: four centred `<p>`, then `* * *`, then
    // two more centred `<p>`. Its reference closes the `::: align`, puts the
    // `---` in the frame, and opens a second one — an `align` spanning the
    // divider would claim the two halves are one bounded group, which is what
    // the divider denies. Position within the run is the whole evidence, so the
    // false friend above (a rule that *opens* a run) still keeps its rule.
    const out = await mdMeasured(
      PROSE +
        '<table border="0" width="85%"><tr><td width="94%" style="border: 2px solid #FF0000">' +
        '<p style="text-align: center">Анну Валерьевну Тихонравову (г. Харьков)</p>' +
        '<p style="text-align: center">с успешной защитой диссертации</p>' +
        '<p style="text-align: center">* * *</p>' +
        '<p style="text-align: center">Защита состоялась 17 сентября 2014 г.</p>' +
        "</td></tr></table>" +
        PROSE,
    );
    const rule = out.indexOf("\n---\n", out.indexOf("::: frame"));
    expect(rule).toBeGreaterThan(-1);
    // One group each side of the divider, and the divider outside both.
    expect(out.slice(0, rule).lastIndexOf(":::")).toBeGreaterThan(out.slice(0, rule).indexOf("::: align"));
    expect(out.indexOf("::: align", rule)).toBeGreaterThan(rule);
  });

  it("does not make an aligned group out of a rule alone", async () => {
    // False friend: the same alignment on a block with nothing in it. `align`
    // positions content, and a run whose only member is a divider has none, so
    // it leaves the run as it entered it.
    const out = await mdMeasured(PROSE + '<p style="text-align: right">* * *</p>' + PROSE);
    expect(out).toContain("---");
    expect(out).not.toContain("::: align");
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
 * A single-row table where every cell is nothing but a link is a pager, not
 * an abandoned record matrix — even when the classifier calls it DATA.
 *
 * ## Rule contract
 *
 * **Invariant.** Whole-cell equality between a cell's own text and its one
 * anchor's text: the cell must be the link and nothing else. `segovia1`'s
 * `◀ | Андрес Сеговия | Владимир Бобри | ▶` scores DATA on grid regularity
 * and per-column homogeneity — the same evidence a real record row gives —
 * but has no header to plan a table from, because it carries no data, only
 * navigation. `planDataTable` abandons it outright (`grid.rows < minRows`),
 * and an abandoned DATA verdict used to fall straight to linear flow without
 * ever asking whether the row had lanes.
 *
 * **False friend, tested for non-firing:** a single-row resource record —
 * title beside a format link, the shape `borislova`, `new_kolpakov` and
 * `new_karta`'s single-track discography rows all share. The title cell
 * holds prose and carries no link at all, so it fails `links === 1` on its
 * first cell and the row is never mistaken for a pager.
 *
 * **Recurrence.** Deliberately not required — a page draws exactly one
 * previous/next strip, so the shape occurs once per page by construction
 * (`CLAUDE.md` §5's stated exemption). The per-cell containment test carries
 * the whole burden of proof instead, the same way the icon-glyph table's
 * "recurrence is cross-document" contract does above.
 */
describe("a row of nothing but links is a pager, not an abandoned record", () => {
  const pager =
    '<table width="60" border="0" cellspacing="0" cellpadding="0"><tr>' +
    '<td width="11"><a href="segovia.htm"><img src="../main/back.gif" width="11" height="11"></a></td>' +
    '<td><a href="segovia.htm">Андрес Сеговия</a></td>' +
    '<td><a href="bobri.htm">Владимир Бобри</a></td>' +
    '<td width="11"><a href="bobri.htm"><img src="../main/forward.gif" width="11" height="11"></a></td>' +
    "</tr></table>";

  const record =
    '<table width="300" border="0" cellspacing="0" cellpadding="0"><tr>' +
    '<td width="85%">&quot;Estrelluvio&quot; (Dedicada a Jos&eacute; Luis Vega)</td>' +
    '<td width="15%"><a href="music/wma/estrelluvio.wma">WMA</a></td>' +
    "</tr></table>";

  async function convertWith(cls: Classification["class"], html: string): Promise<Awaited<ReturnType<typeof convert>>> {
    const doc = parseHtml(html);
    const inner = [...walkElements(doc.root)].filter((e) => e.tag === "table");
    const target = inner[inner.length - 1];
    const classifications = new Map([
      [target!.id, { class: cls, confidence: 0.4, tier: 4 as const, reason: "forced by test" }],
    ]);
    return convert(Buffer.from(html, "utf8"), { profile: SPEC, layoutFidelity: "faithful", classifications });
  }

  it("reconsiders a four-cell bare-link row as a layout, not as flow", async () => {
    const result = await convertWith("DATA", page(PROSE + pager));
    expect(result.markdown).toContain("::: columns");
    expect(result.markdown).toContain("columns: 4");
    expect(result.markdown).toContain("::: column");
  });

  it("does not read a title-bearing record row as a pager — the false friend", async () => {
    const result = await convertWith("DATA", page(PROSE + record));
    expect(result.markdown).not.toContain("::: columns");
  });

  /**
   * ## Rule contract — a pager's lane is what places its link
   *
   * **Invariant.** {@link isBareLinkRow} holds only when every occupied cell is
   * exactly one link and nothing else, so each lane holds one thing and the
   * lane is already the bounded group. `BioMD-Reference.md` §6 says not to use
   * `align` to restate one — the same argument `alignedGroup` makes for a
   * `frame`. Nothing about the document, the glyph, or the label's text.
   *
   * **Recurrence.** Inherited from `isBareLinkRow`, which is exempt for the
   * stated reason: a page draws one previous/next strip.
   *
   * **False friend, tested for non-firing below:** an ordinary layout region
   * whose lane is set apart from its neighbour. `kiselev` right-sets a contact
   * block beside a left-set source list and `new_blackmore` centres an issue
   * date beside its interview, and both references keep the `align` — those
   * lanes hold blocks, not a single navigation label, and the alignment is the
   * only thing saying the lane differs from the one next to it.
   */
  async function measuredWith(cls: Classification["class"], html: string): Promise<string> {
    const doc = parseHtml(html);
    const inner = [...walkElements(doc.root)].filter((e) => e.tag === "table");
    const target = inner[inner.length - 1];
    const classifications = new Map([
      [target!.id, { class: cls, confidence: 0.4, tier: 4 as const, reason: "forced by test" }],
    ]);
    const result = await convert(Buffer.from(html, "utf8"), {
      profile: SPEC,
      layoutFidelity: "faithful",
      classifications,
      measurer: new InlineAlignMeasurer(),
    });
    return result.markdown;
  }

  it("leaves a pager's lanes bare, however the strip is centred", async () => {
    // `segovia1`'s footer: `◀ | Андрес Сеговия | Владимир Бобри | ▶`, the two
    // named cells centred. Its reference writes each lane's link bare.
    const centred =
      '<table width="60" border="0" cellspacing="0" cellpadding="0"><tr>' +
      '<td width="11"><a href="segovia.htm"><img src="../main/back.gif" width="11" height="11"></a></td>' +
      '<td><p style="text-align: center"><a href="segovia.htm">Андрес Сеговия</a></p></td>' +
      '<td><p style="text-align: center"><a href="bobri.htm">Владимир Бобри</a></p></td>' +
      '<td width="11"><a href="bobri.htm"><img src="../main/forward.gif" width="11" height="11"></a></td>' +
      "</tr></table>";
    const out = await measuredWith("DATA", page(PROSE + centred));
    expect(out).toContain("::: columns");
    expect(out).toContain("[Андрес Сеговия](/#/segovia)");
    expect(out).not.toContain("::: align");
  });

  it("keeps the align on a lane that is set apart from its neighbour", async () => {
    // The false friend, and the reason the guard reads the *region* rather than
    // the cell: a two-lane region whose right lane is right-set against a
    // left-set source list. Not a bare-link row — the left lane carries prose —
    // so the pager guard never sees it and §13's `align` inside `column` stands.
    const region =
      '<table width="90%" border="0"><tr>' +
      '<td width="50%"><p>Основные источники приведены ниже по тексту статьи.</p></td>' +
      '<td width="50%"><p style="text-align: right">Информация о продуктах<br>' +
      "VP Music Media<br>представлена на сайтах издательства</p></td>" +
      "</tr></table>";
    const out = await measuredWith("UNKNOWN", page(PROSE + region));
    expect(out).toContain("::: columns");
    expect(out).toContain("::: align");
    expect(out).toContain("position: right");
  });

  /**
   * A single-row table holding one record is a table.
   *
   * `planDataTable`'s `minRows: 2` is a recurrence gate, and a one-record table
   * has one row by definition — so the gate asked the construct not to exist.
   * The classifier had already said DATA; the planner then refused the grid as
   * `too-small` and every cell became a separate block. That is not a different
   * representation of the record, it is the loss of one: on `new_kolpakov` the
   * title `Венгерка` was absorbed into the previous paragraph's `::: align`,
   * `[WMA]` became its own centred `::: align`, `(1,7 Mb)` a third.
   *
   * **Invariant.** Role by position, containment, cardinality — the first
   * occupied cell indexes the record and so carries neither link nor picture,
   * and a later cell is a label-length whole-cell link. Exactly
   * `isBareLinkRow` inverted, which is the acceptance check this mechanism was
   * predicted to need before it was built.
   *
   * **Recurrence cannot apply**; the role test carries the proof instead.
   *
   * **False friends, tested for non-firing:** the pager above (its first cell
   * is a link), and a text lane beside its cover (the second cell holds a
   * picture, not a label), which must stay on the `::: columns` path.
   */
  it("plans a one-record row as a table instead of scattering its cells", async () => {
    const result = await convertWith("DATA", page(PROSE + record));
    expect(result.markdown).toContain("| | \u{1F517} |");
    expect(result.markdown).toContain(
      "| \"Estrelluvio\" (Dedicada a José Luis Vega) | [WMA](music/wma/estrelluvio.wma) |",
    );
  });

  it("does not read a text lane beside its cover as a record — non-firing", async () => {
    const laneAndCover =
      '<table width="400" border="0"><tr>' +
      "<td width=\"70%\">Надя Борислова родилась в Москве и с восьми лет занималась на гитаре.</td>" +
      '<td width="30%"><a href="photo/big.jpg"><img src="photo/cover.jpg" width="150" height="150"></a></td>' +
      "</tr></table>";
    const result = await convertWith("DATA", page(PROSE + laneAndCover));
    expect(result.markdown).not.toContain("\u{1F517}");
  });

  it("caps an ordinary layout region at three lanes — the count stays four only for a pager", async () => {
    // Four bare prose cells (no links at all) are not a pager either: the
    // lane cap only widens for the shape this rule names, not for every
    // four-column region a classifier abstains on.
    const plain =
      '<table width="400" border="0"><tr>' +
      "<td>one</td><td>two</td><td>three</td><td>four</td>" +
      "</tr></table>";
    const result = await convertWith("UNKNOWN", page(PROSE + plain));
    expect(result.markdown).not.toContain("::: columns");
  });
});

/**
 * A flattened grid row that is nothing but pictures is one visual row.
 *
 * **Invariant.** Containment and cardinality only: a row whose cells lower to
 * two or more standalone `image` blocks and to nothing else. The `<tr>` is the
 * adjacency evidence §8 asks for, declared by the author rather than inferred,
 * which is why recurrence does not apply — a gallery row is a row whether the
 * page draws one or six.
 *
 * **False friend: a record row**, a picture beside the words about it. That is
 * the shape of `goya2`'s album grid and `williams2`'s track list, and testing
 * the *whole* row rather than the images in it is what separates them.
 *
 * `goya2` draws its "ДРУГИЕ АЛЬБОМЫ" plates as three such rows; the converter
 * shipped six loose `::: image` blocks where the reference groups each pair.
 */
describe("an all-picture row keeps its row", () => {
  const plate = (a: string, b: string) =>
    `<table width="95%"><tr>` +
    `<td width="50%"><p align="center"><img src="${a}" width="150" height="147"></td>` +
    `<td width="50%"><p align="center"><img src="${b}" width="150" height="150"></td>` +
    `</tr></table>`;

  it("groups a row of two pictures into `::: images`", async () => {
    const out = await md(PROSE + plate("photo/a.jpg", "photo/b.jpg") + PROSE);
    expect(out).toContain("::: images");
    expect(out).toContain("columns: 2");
    expect(out).toContain("src: photo/a.jpg");
    expect(out).toContain("src: photo/b.jpg");
  });

  it("does not group a picture beside its words — the false friend", async () => {
    const record =
      `<table width="95%"><tr>` +
      `<td width="50%"><p align="center"><b>1.000.000 Platinum</b></td>` +
      `<td width="50%"><p align="center"><img src="photo/a.jpg" width="150" height="150"></td>` +
      `</tr></table>`;
    const out = await md(PROSE + record + PROSE);
    expect(out).not.toContain("::: images");
    expect(out).toContain("src: photo/a.jpg");
  });

  it("does not group a row that shows one picture", async () => {
    const single = `<table width="95%"><tr><td><p align="center"><img src="photo/a.jpg" width="150" height="150"></td></tr></table>`;
    const out = await md(PROSE + single + PROSE);
    expect(out).not.toContain("::: images");
  });
});

/**
 * A catalog is evidenced by the pairing, not by the column widths.
 *
 * **Invariant.** Every content row of a two-column grid sets a bare picture
 * beside worded matter — one cell is the picture *of* what the other says.
 * Relational and unitless: no width, no pixel threshold, no filename. The gate
 * it joins asks instead for lanes of near-equal width, which a 150 px cover
 * beside a tracklist has no reason to be; measured, `new_lagq2` pairs 7 of 7
 * rows at a 37/63 split, scored DATA, and lost all six of its reference's
 * `::: columns` to linear flow.
 *
 * This is the answer to the question `new_lagq2` was held back to settle
 * (PROGRESS §19.4): the CATALOG gate was wrong, and the contract above — a DATA
 * verdict must not be reconsidered as lanes — did not have to move. The grid
 * simply never becomes DATA now.
 *
 * **Recurrence requirement.** Two paired rows, separated by the grid's own row
 * boundary.
 *
 * **False friend**, tested for non-firing: one picture beside one line, which
 * is a figure over its caption. `media.ts` binds that pair far better than a
 * lane region would, and the recurrence requirement is what keeps it away.
 */
describe("a two-column grid that pairs a picture with its matter", () => {
  /** The lane path only exists under `faithful`, which is what the corpus runs. */
  const laned = async (body: string): Promise<string> =>
    (
      await convert(Buffer.from(page(body), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;

  const record = (cover: string, matter: string) =>
    `<tr><td width="176"><img src="${cover}" width="150" height="150"></td>` +
    `<td width="300">${matter}</td></tr>`;

  it("becomes lanes when the pairing recurs", async () => {
    const out = await laned(
      PROSE +
        '<table border="0" width="476">' +
        record("cd1.jpg", "Dances From Renaissance to Nutcracker<br>TCHAIKOVSKY - Nutcracker Suite") +
        record("cd2.jpg", "Evening in Grenada<br>BOCCHERINI - Introduction and Fandango") +
        "</table>" +
        PROSE,
    );
    expect(out).toContain("::: columns");
    expect(out.match(/^::: column$/gmu)?.length).toBe(4);
  });

  it("leaves a single picture beside a single line to the caption binder", async () => {
    // The false friend. One row, and nothing like it anywhere on the page: that
    // is a figure, and a figure's caption belongs to the picture rather than to
    // a lane beside it.
    const out = await laned(
      PROSE +
        '<table border="0" width="476">' +
        record("cd1.jpg", "Andrés Segovia, 1955") +
        "</table>" +
        PROSE,
    );
    expect(out).not.toContain("::: columns");
  });

  it("accepts a one-row card when the shape recurs in a sibling table", async () => {
    // `new_blackmore` writes each of its three interview cards as its own
    // one-row table with prose between them, so the recurrence is real and
    // simply invisible from inside any one grid. Its reference lanes all three.
    const card = (cover: string, line: string) =>
      `<table border="0" width="476">${record(cover, line)}</table>`;
    const out = await laned(
      PROSE + card("kp.jpg", "27 марта 2002 г.") + PROSE + card("aif.jpg", "3 апреля 2002 г.") + PROSE,
    );
    expect(out.match(/^::: columns$/gmu)?.length).toBe(2);
  });

  it("leaves a resource matrix alone even when it carries pictures", async () => {
    // The tier-1 DATA gates run first on purpose: a column that is entirely
    // single short links is a resource matrix whatever else the grid holds.
    const out = await laned(
      PROSE +
        '<table border="0" width="476">' +
        '<tr><td><img src="a.gif" width="16" height="16"></td><td><a href="a.htm">MP3</a></td></tr>' +
        '<tr><td><img src="b.gif" width="16" height="16"></td><td><a href="b.htm">MIDI</a></td></tr>' +
        '<tr><td><img src="c.gif" width="16" height="16"></td><td><a href="c.htm">TAB</a></td></tr>' +
        "</table>" +
        PROSE,
    );
    expect(out).not.toContain("::: columns");
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

  /**
   * The rail the menu arrives in is not a lane either.
   *
   * **Invariant.** A lane carries content in a substantial share of the rows of
   * *the content the region is assembled from*. `navFromGrid` already assumed
   * this — its header says "`layoutFrom` folds the resulting lane away" — but
   * occupancy was read off the source grid while the region was built from the
   * lowered blocks, so the emptied rail still contributed a `::: column` and
   * that column was the second one, keeping a one-lane region alive.
   *
   * **Recurrence.** None is available and none is needed: the question is not
   * "does this shape repeat" but "is this column ever populated", which is the
   * lane detector's existing test on the input it should always have had.
   *
   * **False friend**, covered by `lanes.test.ts` and by `goya2` corpus-wide: a
   * lane empty in *some* rows. Empty-here and empty-everywhere want opposite
   * treatment and only the second is a rail.
   */
  /** The lane path only exists under `faithful`, which is what the corpus runs. */
  const laned = async (body: string): Promise<string> =>
    (await convert(Buffer.from(page(body), "utf8"), { profile: SPEC, layoutFidelity: "faithful" })).markdown;

  it("folds a menu rail out of the page frame instead of laning the article", async () => {
    // The site template, measured identical on all 22 corpus documents: an
    // empty margin cell, the article, and a rail holding the side menu.
    const out = await laned(
      '<table border="0" width="760"><tr>' +
        '<td width="116">&nbsp;</td>' +
        `<td width="529">${PROSE}${PROSE}</td>` +
        `<td width="115" valign="top">${menu(
          item("a.htm", "Первая глава") + item("b.htm", "Вторая глава") + item("c.htm", "Третья глава"),
        )}</td>` +
        "</tr></table>",
    );
    expect(out).toContain("::: nav");
    // The article is the page, not one track of a two-lane layout — and a
    // `columns` with a single `column` is not a legal region anyway (§2).
    expect(out).not.toContain("::: columns");
  });

  it("still lanes a rail that keeps content of its own — non-firing", async () => {
    // The same frame with a rail that does *not* fold away. Two populated lanes
    // remain two lanes: this rule removes a phantom, never a real column.
    const out = await laned(
      '<table border="0" width="760"><tr>' +
        `<td width="529">${PROSE}</td>` +
        '<td width="115" valign="top"><p>Записи и ноты этого периода хранятся в архиве.</p></td>' +
        "</tr></table>",
    );
    expect(out).toContain("::: columns");
    expect(out).toContain("::: column");
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

/**
 * A run of equally indented lines, announced by the line above it, is a list.
 *
 * `news` writes two competition results this way: a sentence ending in a colon,
 * then each prize on its own `<br>` line pushed in by two `&ensp;`. The
 * ordinal-ascent rule cannot take it — the last item is "диплом за участие",
 * which carries no ordinal at all.
 *
 * **Invariant.** Three relations, no absolutes: uniformity (the run's members
 * share one indent), subordination (that indent is non-zero against a line with
 * none) and introduction (the line above ends in a colon). The indent test
 * rests on the HTML whitespace model — ASCII space collapses, so a *visible*
 * indent had to be `&nbsp;`/`&ensp;`/`&emsp;` and is therefore deliberate.
 *
 * **Recurrence** is the run: two members minimum.
 *
 * **False friends, measured rather than argued.** Uniform-indent-under-a-lead-in
 * alone fires 21 times across the 22 sources and only 2 want a list; the colon
 * takes it to exactly those 2. The three tested below stand for the other 19:
 * `borislova`'s sixteen movement runs (a work title announces nothing and its
 * reference keeps hard-break lines), `goya2`'s wrapped track title (where the
 * indent marks a *continuation*, one line, deeper than its siblings), and
 * `pavlov_azancheev`'s letter (uniformly indented with nothing to subordinate
 * to).
 */
describe("an announced run of equally indented lines is a list", () => {
  const enumeration =
    '<p class="t2">Подведены итоги конкурса в Москве:<br>\n' +
    "\t\t&#8194;&#8194;1-я премия – <b>Артём Дервоед</b> (Россия, Москва),<br>\n" +
    "\t\t&#8194;&#8194;2-я премия – <b>Антон Баранов</b> (Россия, Санкт-Петербург),<br>\n" +
    "\t\t&#8194;&#8194;диплом за участие – <b>Дмитрий Загуменников</b> (Австрия)</p>";

  it("splits the announcement from the items instead of running them together", async () => {
    const out = await md(enumeration);
    expect(out).toContain("Подведены итоги конкурса в Москве:");
    expect(out).toContain("- 1-я премия – **Артём Дервоед** (Россия, Москва),");
    expect(out).toContain("- 2-я премия – **Антон Баранов** (Россия, Санкт-Петербург),");
    // The unnumbered last line is an item too — the ordinal rule cannot see it.
    expect(out).toContain("- диплом за участие – **Дмитрий Загуменников** (Австрия)");
  });

  it("does not join two items that both end in a comma", async () => {
    // The punctuation heuristic reads a trailing comma as proof of continuation.
    // Equal indent on both sides of the break outranks it, and this is the
    // `paragraph.content` critical the rule was built for.
    const out = await md(enumeration);
    expect(out).not.toContain("(Россия, Москва), 2-я премия");
  });

  it("leaves a work title and its movements as lines — the false friend", async () => {
    // `borislova`: uniform indent, subordinate to a title that announces nothing.
    const movements =
      '<p class="t1">Suite "La procesion de las cucarachas" / Сюита "Шествие тараканов" *<br>\n' +
      "&nbsp;&nbsp;1. La procesion / Шествие,<br>\n" +
      "&nbsp;&nbsp;2. Estancamiento / Застой,<br>\n" +
      "&nbsp;&nbsp;3. Nostalgia / Ностальгия</p>";
    const out = await md(movements);
    expect(out).not.toContain("- 2. Estancamiento");
  });

  it("leaves an indented continuation joined to the line it continues", async () => {
    // `goya2`: the indent marks a wrapped title, so it means the opposite. One
    // line, and deeper than the siblings it sits among.
    const tracks =
      '<p class="t1">Треки:<br>\n' +
      "01. Woman in love (B&amp;R Gibb)&nbsp;<br>\n" +
      "02. I just called to say I love you&nbsp;<br>\n" +
      "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (S Wonder)&nbsp;<br>\n" +
      "03. Maggy M (F Weyner)&nbsp;</p>";
    const out = await md(tracks);
    expect(out).not.toContain("- (S Wonder)");
  });

  it("leaves a uniformly indented letter alone — nothing to be subordinate to", async () => {
    // `pavlov_azancheev`: every line indented alike, no unindented lead-in.
    const letter =
      '<p class="t8">&nbsp;&nbsp;Уважаемый Александр Яковлевич!<br>\n' +
      "&nbsp;&nbsp;Простите, что так поздно выбрался написать,<br>\n" +
      "&nbsp;&nbsp;но обстоятельства сложились именно так.</p>";
    const out = await md(letter);
    expect(out).not.toMatch(/^- Простите/mu);
  });
});
