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

  it("folds a break out of a link label, and keeps the division it drew", async () => {
    // `goya2` writes `<a href="#26">…Francis Goya&nbsp;<br></a>` — the break is
    // inside the label. `analyze-2.md` rules that a link label is one line, so
    // it does not stay there; it is the division between two contents entries,
    // so it does not vanish either.
    const out = await md(
      PROSE +
        '<p><a href="a.htm">Галерея инструментальной музыки. Francis Goya&nbsp;<br></a>' +
        '<a href="b.htm">Другие альбомы</a></p>' +
        PROSE,
    );
    expect(out).toContain("[Галерея инструментальной музыки. Francis Goya](/#/a)");
    // The label is one line — no hard break and no trailing space inside it.
    expect(out).not.toMatch(/\[[^\]\n]*\\\n[^\]]*\]\(/u);
    // And the division survives, outside the label where the reader sees it.
    expect(out).toMatch(/\\\n\[Другие альбомы\]/u);
  });

  it("reads a break drawn on both sides of the anchor boundary as one division", async () => {
    // `borislova` writes `<a …>ДИСКОГРАФИЯ<br></a><br>` and `goya2` the same
    // shape. Measured in the browser, the source draws a **blank** line there:
    // 14 px line height, a 28 px step from `ДИСКОГРАФИЯ` to `Основные
    // источники:` where every other step in the block is 14. Emitting both
    // breaks reproduces that gap and, in Markdown, also asserts a paragraph
    // boundary — splitting one credit block into two, taking its opening link
    // out of the block it belongs to.
    //
    // §1's hierarchy is lexicographic and structural correctness outranks
    // rendering detail, so the hoisted break gives way to the authored one and
    // the 14 px is knowingly not reproduced. The whole block stays one
    // paragraph, which is also what the reference does.
    const out = await md(
      PROSE + '<p><a href="a.htm">Первая<br></a><br>Вторая строка<br>Третья</p>' + PROSE,
    );
    expect(out).toMatch(/\[Первая\]\(\/#\/a\)\\\nВторая строка\\\nТретья/u);
    expect(out).not.toMatch(/\[Первая\]\(\/#\/a\)\n\s*\nВторая/u);
  });

  it("hands an edge break back to the run — it divides the link, not the label", async () => {
    // `new_kolpakov` writes each source credit as `<a …>talismanmusic.org<br></a>`,
    // the break inside the anchor with nothing after it. The label is still one
    // line; the break is not part of it, and dropping it ran four credits
    // together. Nested inside `<font>`, which is how the corpus writes it.
    const credits = await md(
      PROSE +
        '<p>Основные источники: <a href="http://a.example/"><font>a.example<br></font></a>' +
        '<a href="http://b.example/"><font>b.example<br></font></a>' +
        '<a href="http://c.example/"><font>c.example</font></a></p>' +
        PROSE,
    );
    expect(credits).toContain("[a.example](http://a.example/)\\\n");
    expect(credits).toContain("[b.example](http://b.example/)\\\n");
    // Still one line each — no break survives *inside* a label.
    expect(credits).not.toMatch(/\[[^\]\n]*\\\n[^\]]*\]\(/u);
  });

  it("puts a space where an interior label break was, so two words cannot fuse", async () => {
    // No source in this corpus writes one — every `<br>` inside an `<a>` here
    // sits at an edge — so this states what the rule does with the case the
    // other ~987 pages may hold.
    const out = await md(PROSE + '<p><a href="a.htm">Первая<br>вторая</a></p>' + PROSE);
    expect(out).toContain("[Первая вторая](/#/a)");
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
  it("puts a floated figure before the paragraph it stands beside, not the block", async () => {
    // `tarrega` and `williams2` both write a whole section as one `<p>` whose
    // paragraphs are `<br><br>`, and drop the portrait where the text it
    // illustrates begins. Lifting it to the head of the *run* moved it two
    // paragraphs up on both.
    const out = await md(
      "<p>Первый абзац этой страницы, достаточно длинный чтобы его нельзя было принять за подпись.<br>" +
        "<br>" +
        "Второй абзац, тоже достаточно длинный чтобы считаться обычной прозой этой страницы.<br>" +
        "<br>" +
        '<img border="1" src="photo/t/tarrega1.jpg" align="right" width="150" height="201">Третий абзац, ' +
        "рядом с которым художник и поставил этот портрет, и он тоже длинный.</p>",
    );
    const lines = out.split("\n");
    const figure = lines.findIndex((l) => l.startsWith("::: image"));
    const second = lines.findIndex((l) => l.startsWith("Второй абзац"));
    const third = lines.findIndex((l) => l.startsWith("Третий абзац"));
    expect(figure).toBeGreaterThan(second);
    expect(figure).toBeLessThan(third);
  });

  it("false friend: a run that is nothing but the floated image stays where it is", async () => {
    // No paragraph to stand beside, so it is emitted directly and never reaches
    // the bracketing — the common single-paragraph case has to keep behaving
    // exactly as it did.
    const out = await md(
      '<p><img border="1" src="photo/t/tarrega1.jpg" align="right" width="150" height="201"></p>' +
        "<p>Абзац, который следует за отдельно стоящей картинкой и является обычной прозой страницы.</p>",
    );
    const lines = out.split("\n");
    expect(lines.findIndex((l) => l.startsWith("::: image"))).toBeLessThan(
      lines.findIndex((l) => l.startsWith("Абзац, который")),
    );
  });

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

  it("false friend: a strapline that is itself a series is not a title", async () => {
    // `new_rechin4`'s `Идея • Концепция • Музыкальное воплощение` passes every
    // other test — 5 words, 37 characters, no terminal stop — and names
    // nothing. An ornament *between* phrases is structure: the line lists three
    // things. Symmetric ornament is the opposite and is stripped, so the two
    // cases are decided by where the glyph sits, not by which glyph it is.
    const strapline = "Идея • Концепция • Музыкальное воплощение";
    const out = await mdMeasured(
      `${PROSE}<p style="text-align: center">${strapline}</p>` +
        '<p style="text-align: center">[<a href="a.htm">1</a> ] ' +
        '[<a href="b.htm">2</a> ] [ <b>3</b> ]</p>',
    );
    expect(out).toContain("::: nav");
    expect(out).not.toContain("title:");
    expect(out).toContain(strapline);
  });

  it("counts the page you are on as an item, however the source marked it", async () => {
    // `new_rechin4`'s pager is `[1] [2] [ <b>3</b> ]` — two links left to go
    // and the current page in bold. The old floor counted links, so a
    // three-item strip on its last page was two links and fell through; and a
    // wrapper carrying only text rejected the whole run rather than yielding
    // the plain item inside it. §11's plain item is an item.
    const out = await mdMeasured(
      `${PROSE}<p style="text-align: center">[<a href="a.htm">1</a> ] ` +
        '[<a href="b.htm">2</a> ] [ <b>3</b> ]</p>',
    );
    expect(out).toContain("::: nav");
    expect(out).toContain("active: 3");
    expect(out).toContain("[1](/#/a)");
  });

  it("false friend: one link and a word is a sentence, not a menu", async () => {
    // Two links stay the floor for the run being navigation at all — counting
    // items must not let a single link plus a stray word claim a menu.
    const out = await mdMeasured(
      `${PROSE}<p style="text-align: center">Смотри <a href="a.htm">здесь</a></p>`,
    );
    expect(out).not.toContain("::: nav");
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

  // -- a headline set over a lighter continuation (`isSplitHeadline`)

  /** Three `p.t3` blocks, exactly as `pavlov_azancheev` writes them. */
  const PAVLOV_HEADLINE =
    '<p class="t3" align="center"><br><b>М.ПАВЛОВ-АЗАНЧЕЕВ (1888-1963).<br></b>' +
    "(Краткая биография, нотное наследие, первые исполнители, неизвестные письма и документы).</p>";
  const PAVLOV_SECTIONS =
    '<p class="t3" align="center"><b>I. Краткая биография.</b><br><b>Нотное наследие.</b></p>' +
    `${PROSE}${PROSE}` +
    '<p class="t3" align="center"><br><b>II. Неизвестные письма и документы</b></p>';

  it("keeps a headline over its lighter continuation as one aligned block", async () => {
    // Joined into a section label the two runs make a 122-character `##`,
    // which `analyze-3.md` calls this page's first critical fault, and the
    // bold-over-plain styling the author drew is lost.
    const out = await mdMeasured(`${PAVLOV_HEADLINE}${PROSE}${PAVLOV_SECTIONS}${PROSE}`);
    expect(out).not.toMatch(/^#+ М\.ПАВЛОВ-АЗАНЧЕЕВ \(1888-1963\)\. \(Краткая/mu);
    expect(out).toMatch(/^\*\*М\.ПАВЛОВ-АЗАНЧЕЕВ \(1888-1963\)\.\*\*\\$/mu);
    expect(out).toMatch(/^\(Краткая биография/mu);
    // The two real headings on the same page, in the same template, are bold
    // throughout and stay headings — the veto keys on weight per run, and an
    // earlier attempt that compared prominence vetoed these as well.
    expect(out).toMatch(/^#{2,3} I\. Краткая биография\./mu);
    expect(out).toMatch(/^#{2,3} II\. Неизвестные письма и документы$/mu);
  });

  it("false friend: the same shape drawn repeatedly is an entry label", async () => {
    // `borislova` writes `<b>1990-1993<br></b>` over its unbolded works eleven
    // times down the page and every one is a heading the reference keeps.
    // Recurrence inverts here: once is a masthead, many times is a template.
    const entry = (year: string, work: string): string =>
      `<p class="t3" align="center"><b>${year}<br></b>${work}</p>${PROSE}`;
    const out = await mdMeasured(
      entry("1990-1993", "Ciclo de piezas La mariposa") +
        entry("1993", "Sonata para guitarra") +
        entry("1995", "Preludios y danzas"),
    );
    // The veto does not fire, so each label stays whatever heading recovery
    // makes of it rather than becoming a hard-broken headline.
    expect(out).not.toMatch(/^\*\*1990-1993\*\*\\$/mu);
    expect(out).not.toMatch(/^\*\*1993\*\*\\$/mu);
    expect(out).toMatch(/^#{2,3} 1990-1993/mu);
  });

  // -- a page template already recovered as a heading (`completeHeadingTemplates`)

  it("completes a heading template the page has already answered for twice", async () => {
    // `new_geyzel04` sets four chapter titles in one template and typography
    // reaches only two of them: the third is a character over the label cap and
    // the fourth stands under a photograph, where the caption guard correctly
    // refuses it. Neither exception is about typography, so nothing keyed on
    // typography can reach them without reaching the false friends too. The
    // template is the evidence, and the page has already used it as a heading.
    const label = (t: string): string => `<p class="ttlb" align="center"><b>${t}</b></p>`;
    const out = await md(
      label("ГЛАВА ПЕРВАЯ") +
        PROSE +
        label("ГЛАВА ВТОРАЯ") +
        PROSE +
        // Over `maxSectionLength`, so prominence alone will not nominate it.
        label("ГЛАВА ТРЕТЬЯ, ЦЕЛИКОМ ПОСВЯЩЕННАЯ ИСЧИСЛЕНИЮ БЕСКОНЕЧНО ИСЧЕЗАЮЩЕГО ВАВИЛОВА") +
        PROSE +
        // Directly under a bare picture, so the caption guard refuses it.
        '<p><img src="photo/g/img_07.jpg" width="340" height="255"></p>' +
        label("ПРИЛОЖЕНИЕ") +
        PROSE,
    );
    expect(out).toMatch(/^#{2,3} ГЛАВА ТРЕТЬЯ, ЦЕЛИКОМ ПОСВЯЩЕННАЯ ИСЧИСЛЕНИЮ/mu);
    expect(out).toMatch(/^#{2,3} ПРИЛОЖЕНИЕ$/mu);
    // The picture keeps the caption it does not have rather than borrowing one.
    expect(out).not.toContain("caption: ПРИЛОЖЕНИЕ");
  });

  it("false friend: a caption template has nothing to complete", async () => {
    // Captions share a class as readily as headings do. The asymmetry that
    // makes this rule safe is that it only ever *joins* a majority the page
    // established: a family every member of which sits under its own picture
    // has no recovered member at all, so no count is reached and nothing moves.
    const figure = (t: string): string =>
      `<p><img src="photo/g/${t}.jpg" width="300" height="200"></p>` +
      `<p class="cap" align="center"><b>Снимок ${t} года</b></p>`;
    const out = await md(PROSE + figure("1936") + PROSE + figure("1947") + PROSE + figure("1952") + PROSE);
    expect(out).not.toMatch(/^#{2,3} Снимок 1936 года$/mu);
    expect(out).not.toMatch(/^#{2,3} Снимок 1952 года$/mu);
  });

  it("false friend: one long member disqualifies the template", async () => {
    // The body class of a page whose first paragraph happens to be recovered as
    // a heading must not promote the article. Homogeneity is the guard: every
    // member has to be label-shaped, so one paragraph of prose in the family
    // takes the whole family out of consideration.
    const out = await md(
      '<p class="t" align="center"><b>ПЕРВЫЙ РАЗДЕЛ</b></p>' +
        '<p class="t" align="center"><b>ВТОРОЙ РАЗДЕЛ</b></p>' +
        PROSE.replace("<p>", '<p class="t">') +
        '<p class="t">Короткая строка</p>' +
        PROSE,
    );
    expect(out).not.toContain("## Короткая строка");
    expect(out).toContain("Короткая строка");
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
  it("quotes the words a colon introduces on the next line", async () => {
    // `borislova` writes `Надя Борислова:<br>"Мне было 8 лет…"` in one block.
    // `analyze-3.md` states the evidence and asks for the rule: straight after
    // a colon comes text in quotation marks, so it is a quotation.
    const quote =
      '"Мне было 8 лет, когда отец купил нам две маленькие гитары: ему пришлось отстоять за ними ' +
      'длинную очередь, поскольку стоили они дешево."';
    const out = await md(`${PROSE}<p>Надя Борислова:<br>${quote}</p>${PROSE}`);
    expect(out).toMatch(/^Надя Борислова:$/mu);
    expect(out).toMatch(/^> "Мне было 8 лет/mu);
  });

  it("false friend: a colon inside a sentence introduces nothing", async () => {
    // The colon has to end a line the author drew. Inside running text it is
    // punctuation, and the quotation that follows is part of the sentence.
    const out = await md(
      `${PROSE}<p>Он вспоминал об этом так: "Мне было 8 лет, когда отец купил нам две маленькие ` +
        'гитары: ему пришлось отстоять за ними длинную очередь, поскольку стоили они дешево."</p>' +
        PROSE,
    );
    expect(out).not.toContain("> \"Мне было 8 лет");
  });

  it("false friend: a colon introducing something that is not a quotation", async () => {
    // What follows has to open with a quotation mark and close at the block's
    // end, or an introduced list becomes a quotation.
    const out = await md(
      `${PROSE}<p>Основные источники:<br>Пресса, письма и воспоминания современников, а также ` +
        "материалы личного архива семьи, переданные в музей в 1994 году.</p>" +
        PROSE,
    );
    expect(out).not.toMatch(/^> /mu);
    expect(out).toContain("Основные источники:");
  });

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

  it("frames recurrent short row labels and rejects a singleton menu label", async () => {
    // Short record labels have no meaningful absolute length. Their role is
    // stated by recurrence: each owns a full tinted row, and populated record
    // content sits between them. Class names and attribute order are irrelevant.
    const records = await mdMeasured(
      PROSE +
        '<div style="background-color: #F7E7AF"><table border="0" width="90%">' +
        '<tr><td bgcolor="#FCF3D8" colspan="2" width="100%">Lute Album</td></tr>' +
        '<tr><td width="45%">Cover image</td><td width="55%">First programme and recording notes</td></tr>' +
        '<tr><td width="100%" colspan="2" bgcolor="#FCF3D8">Guitar Album</td></tr>' +
        '<tr><td width="45%">Second cover</td><td width="55%">Second programme and recording notes</td></tr>' +
        "</table></div>" +
        PROSE,
    );
    expect(records.match(/::: frame/gu)).toHaveLength(2);

    // Named false friend: a page draws one tinted menu title followed by its
    // links. It spans a row and shares the palette, but has no peer role.
    const menu = await mdMeasured(
      PROSE +
        '<div style="background-color: #F7E7AF"><table border="0" width="90%">' +
        '<tr><td width="100%" colspan="2" bgcolor="#FCF3D8">Archive</td></tr>' +
        '<tr><td colspan="2"><a href="older.htm">Older</a> <a href="newer.htm">Newer</a></td></tr>' +
        "</table></div>" +
        PROSE,
    );
    expect(menu).not.toContain("::: frame");
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

/**
 * Standalone image position — rule contract (`CLAUDE.md` §5).
 *
 * **Invariant.** A figure keeps a source-stated horizontal position: first its
 * own computed alignment, then a floated one-column figure ancestor that
 * positions it. This is relational containment evidence, not a filename,
 * class or size threshold.
 *
 * **Recurrence.** Not required: a page can contain one signature or floated
 * figure. The containing block owns its placement by construction.
 *
 * **False friends.** A left-aligned page baseline is not a request for a left
 * image; nor is a floated multi-column layout grid. With no distinctive image
 * alignment or figure float, standalone figures retain the centred default.
 */
describe("standalone image position", () => {
  it("keeps explicit placement inherited from the image's containing block", async () => {
    const out = await mdMeasured(
      PROSE +
        '<p><img src="signature.gif" style="text-align: right" width="98" height="56"></p>' +
        PROSE,
    );
    expect(out).toMatch(/::: image\nsrc: signature\.gif\nposition: right/u);
  });

  it("keeps a floated figure on its source side", async () => {
    const out = await mdMeasured(
      PROSE +
        '<table align="left" style="float: left" width="218"><tr><td>' +
        '<img src="cover.gif" width="209" height="281"></td></tr>' +
        '<tr><td>Специальный выпуск журнала</td></tr></table>' +
        PROSE,
    );
    expect(out).toMatch(/::: image\nsrc: cover\.gif\nposition: left/u);
  });

  it("false friend: a floated multi-column layout does not position its lane images", async () => {
    const out = await mdMeasured(
      '<table align="left" style="float: left"><tr>' +
        '<td><img src="left.jpg" width="120" height="120"><p>Левая карточка</p></td>' +
        '<td><img src="right.jpg" width="120" height="120"><p>Правая карточка</p></td>' +
        "</tr></table>",
    );
    expect(out).not.toMatch(/src: (?:left|right)\.jpg\nposition: left/u);
  });

  it("false friend: ordinary page alignment keeps the centred default", async () => {
    const out = await mdMeasured(PROSE + '<p><img src="portrait.jpg" width="180" height="240"></p>' + PROSE);
    expect(out).toMatch(/::: image\nsrc: portrait\.jpg\nposition: center/u);
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

  /**
   * Rule contract — **a sample of one is not a baseline.**
   *
   * *Invariant.* Recurrence applied to the baseline itself. The evidence for
   * "this block is aligned unlike the text around it" is the text around it,
   * and a page with a single block of prose has none: the block ends up
   * compared against itself and is distinctive from nothing. Counted in
   * *qualifying blocks*, not in winning weight, because two long blocks that
   * disagree still offer a real comparison.
   *
   * *False friend.* A page whose long blocks genuinely agree. Two centred prose
   * blocks are a centred page and must keep suppressing a third centred block —
   * this is `CLAUDE.md`'s corpus fact that a wholly centred page has no
   * distinctively centred region, and the guard must not weaken it.
   *
   * *Measured.* `new_lagq2`, in Chromium at 1024 px: 50 leaf blocks, of which
   * 40 compute `justify` and 8 `-webkit-center`, and **exactly one** reaches
   * 120 characters — the centred composer list the caller was asking about. It
   * declared the page centred and vetoed its own `::: align`.
   */
  it("declines to call one block a baseline, and still trusts two that agree", () => {
    const composerList = [{ align: "center" as const, textLength: 164 }];
    expect(proseAlign(composerList)).toBeNull();
    expect(isDistinctiveAlign("center", proseAlign(composerList))).toBe(true);

    // False friend: a page that really is centred keeps its baseline.
    const centredPage = [
      { align: "center" as const, textLength: 300 },
      { align: "center" as const, textLength: 250 },
    ];
    expect(proseAlign(centredPage)).toBe("center");
    expect(isDistinctiveAlign("center", proseAlign(centredPage))).toBe(false);

    // Two long blocks that disagree are still a comparison, so still a baseline.
    expect(proseAlign([
      { align: "justify" as const, textLength: 900 },
      { align: "center" as const, textLength: 130 },
    ])).toBe("justify");
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

  it("stacks a span's covered row into the lane beside it, not after the region", async () => {
    // `goya2`'s "Moscow Nights", end to end. The second cover has no cell of
    // its own in the text lane, so its row used to fail `columns.length >= 2`
    // and fall out of the region — the picture ended up *after* the `:::
    // columns` it belongs inside. Measured in the browser: 325 px of track list
    // at x=383, two 162 px covers at x=634, y and y+162.
    const spanned =
      '<table width="90%" border="0"><tr>' +
      '<td width="50%" valign="middle" rowspan="2"><p>01. Song of the Dnepr<br>02. Cossack Patrol</p></td>' +
      '<td width="50%" valign="top"><p align="center"><img src="photo/goya_moscow1.jpg" width="150" height="150"></p></td>' +
      "</tr><tr>" +
      '<td width="50%" valign="top"><p align="center"><img src="photo/goya_moscow3a.jpg" width="150" height="150"></p></td>' +
      "</tr></table>";
    const out = await measuredWith("UNKNOWN", page(PROSE + spanned));
    const region = out.indexOf("::: columns");
    expect(region).toBeGreaterThan(-1);
    const first = out.indexOf("goya_moscow1.jpg");
    const second = out.indexOf("goya_moscow3a.jpg");
    expect(first).toBeGreaterThan(region);
    expect(second).toBeGreaterThan(first);
    // Both inside the same lane: no `::: column` opens between them.
    expect(out.slice(first, second)).not.toContain("::: column");
  });

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

  /**
   * A record grid gets no rule between its rows.
   *
   * A `---` between laned rows claims "one thing ended here and the next
   * began". That is true of a catalog — an album title over its track list
   * beside its cover — and of a dated archive, and the corpus asks for it on
   * both. It is false of a concert programme, where every lane of every row
   * holds one short line and the row boundary is the grid's own. Ruling between
   * those rows takes a table the source draws in a screenful and spreads it
   * down the page: 21 rules on one document, all of them the converter's own
   * claim (*ruled 2026-08-14*).
   *
   * **Invariant.** Block cardinality and role inside the lanes — compound, or
   * labelled by a date — never a width, a class or a row count.
   *
   * **Recurrence is the region, not the row:** the question is asked once over
   * every laned row a region produced, so a catalog stays a catalog on the one
   * row whose cover art is missing. `goya2` has such a row.
   *
   * **False friends, both tested for non-firing:** the compound row, and the
   * dated row whose lanes are each a single paragraph and which is an entry all
   * the same.
   */
  const programmeRows = (rows: readonly [string, string][]): string =>
    '<table width="75%" border="0" cellspacing="0" cellpadding="0"><tr>' +
    rows.map(([a, b]) => `<td width="25%">${a}</td><td width="75%">${b}</td>`).join("</tr><tr>") +
    "</tr></table>";

  it("draws no rule between the rows of a record grid", async () => {
    const programme = programmeRows([
      ["Ф. Таррега", "Воспоминанье об Альгамбре"],
      ["Л. Ален", 'Испанская фантазия "Огонь сердца"'],
      ["Х. Мостаццо", "Сапатеадо"],
    ]);
    const result = await convertWith("UNKNOWN", page(PROSE + programme));
    expect(result.markdown).toContain("::: columns");
    expect(result.markdown).toContain("Сапатеадо");
    expect(result.markdown.split("\n").filter((l) => l.trim() === "---")).toHaveLength(0);
  });

  it("false friend: a compound row is an entry and keeps its rules", async () => {
    // One lane carries more than a single line — a title over its track list.
    // Without a rule the first album's tracks read as the second album's.
    const catalog = programmeRows([
      ["<p><b>Vol. 1</b></p><p>01. Melodia<br>02. Sacrifice</p>", "Ф. Гойя"],
      ["<p><b>Vol. 2</b></p><p>01. Hello Again<br>02. Secret Love</p>", "Ф. Гойя"],
      ["<p><b>Vol. 3</b></p><p>01. Winds Of Time<br>02. Promise Me</p>", "Ф. Гойя"],
    ]);
    const result = await convertWith("UNKNOWN", page(PROSE + catalog));
    expect(result.markdown.split("\n").filter((l) => l.trim() === "---").length).toBeGreaterThan(0);
  });

  it("false friend: a dated row is an entry however few blocks its lanes hold", async () => {
    // The archive shape: a date beside what was published that day. Every lane
    // is one paragraph, exactly like the programme above, and the label is what
    // the rule divides.
    const archive = programmeRows([
      ["<b>11 декабря 2007 г.</b>", "Добавлена биография венгерского гитариста Ласло Сендрей-Карпера."],
      ["<b>9 декабря 2007 г.</b>", "Размещены статьи о Висенте Эспинеле и Хосе Феррере."],
      ["<b>25 ноября 2007 г.</b>", "Словарь пополнился статьями о Милане Зеленке и Яне Обровской."],
    ]);
    const result = await convertWith("UNKNOWN", page(PROSE + archive));
    expect(result.markdown.split("\n").filter((l) => l.trim() === "---").length).toBeGreaterThan(0);
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

describe("gallery captions bind by ordered lane", () => {
  const gallery = (first: string, second: string): string =>
    '<p align="center">' +
    `<img src="first.jpg" width="200" height="300" alt="${first}"> ` +
    `<img src="second.jpg" width="200" height="300" alt="${second}">` +
    "</p>";
  const centred = (text: string): string =>
    `<div><p style="text-align: center; font-size: 9pt">${text}</p></div>`;
  const first = "Обложка книги мастера";
  const withCaptionTable = async (captions: string): Promise<string> => {
    const html = page(PROSE + gallery(first, second) + captions + PROSE);
    const doc = parseHtml(html);
    const tables = [...walkElements(doc.root)].filter((element) => element.tag === "table");
    const target = tables[tables.length - 1];
    const classifications = new Map([
      [target!.id, { class: "UNKNOWN" as const, confidence: 0.4, tier: 4 as const, reason: "forced by test" }],
    ]);
    const result = await convert(Buffer.from(html, "utf8"), {
      profile: SPEC,
      layoutFidelity: "faithful",
      classifications,
      measurer: new InlineAlignMeasurer(),
    });
    return result.markdown;
  };

  const second = "Страница старого журнала";

  it("absorbs a following caption table into its ordered image row", async () => {
    const captions =
      '<table border="0" width="80%"><tr>' +
      `<td width="50%" style="text-align: center">${first}</td>` +
      `<td width="50%" style="text-align: center">${second}</td>` +
      "</tr></table>";
    const out = await withCaptionTable(captions);
    expect(out).toContain(`caption: ${first}`);
    expect(out).toContain(`caption: ${second}`);
    expect(out.match(new RegExp(first, "gu")) ?? []).toHaveLength(1);
    expect(out.match(new RegExp(second, "gu")) ?? []).toHaveLength(1);
  });

  it("absorbs one centred caption region with one line per image", async () => {
    const captions = `<div style="text-align: center"><p>${first}</p><p>${second} за 1914 год</p></div>`;
    const out = await mdMeasured(PROSE + gallery(first, second) + captions + PROSE);
    expect(out).toContain(`caption: ${second} за 1914 год`);
    expect(out.match(new RegExp(second, "gu")) ?? []).toHaveLength(1);
  });

  it("absorbs adjacent independently centred caption lanes", async () => {
    const out = await mdMeasured(
      PROSE + gallery(first, second) + centred(first) + centred(second) + PROSE,
    );
    expect(out.match(new RegExp(first, "gu")) ?? []).toHaveLength(1);
    expect(out.match(new RegExp(second, "gu")) ?? []).toHaveLength(1);
  });

  it("leaves unrelated or reordered centred matter outside the gallery", async () => {
    const unrelated = await mdMeasured(
      PROSE + gallery(first, second) + centred("Биографическая справка автора") + centred("Продолжение статьи") + PROSE,
    );
    expect(unrelated.match(new RegExp(first, "gu")) ?? []).toHaveLength(1);
    expect(unrelated).toContain("Биографическая справка автора");

    const reversed = await mdMeasured(
      PROSE + gallery(first, second) + centred(second) + centred(first) + PROSE,
    );
    expect(reversed.match(new RegExp(first, "gu")) ?? []).toHaveLength(2);
    expect(reversed.match(new RegExp(second, "gu")) ?? []).toHaveLength(2);
  });

  it("requires exact cardinality, source-backed labels and text-only lanes", async () => {
    const missing = await mdMeasured(PROSE + gallery(first, second) + centred(first) + PROSE);
    expect(missing.match(new RegExp(first, "gu")) ?? []).toHaveLength(2);

    const generic = await mdMeasured(
      PROSE + gallery("Photo", "Scan") + centred("Photo by the author") + centred("Scan from the archive") + PROSE,
    );
    expect(generic).toContain("Photo by the author");

    const linked = await mdMeasured(
      PROSE +
        gallery(first, second) +
        centred(`<a href="first.htm">${first}</a>`) +
        centred(second) +
        PROSE,
    );
    expect(linked).toContain(`[${first}](/#/first)`);
  });

  it("never binds a caption region that precedes the images", async () => {
    const out = await mdMeasured(PROSE + centred(first) + centred(second) + gallery(first, second) + PROSE);
    expect(out.match(new RegExp(first, "gu")) ?? []).toHaveLength(2);
    expect(out.match(new RegExp(second, "gu")) ?? []).toHaveLength(2);
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

  /**
   * ## Rule contract — a quotation that spans a block boundary is a block quote
   *
   * **Invariant.** Arithmetic on the author's own quotation marks: a paragraph
   * with an odd number of `"` whose *immediately following* block also has an
   * odd number, closing it. `analyze.md` states the evidence outright for
   * `segovia` — the `&quot;` is "явно индикатор, что эта цитата".
   *
   * **False friends, measured.** Six blocks in the corpus carry an odd count
   * and only one is this shape; the rest are `kiselev`'s `*1'52"*` durations
   * (three, present in its own reference) and a typographic `„…"` pair.
   */
  it("quotes a quotation the source opened in one block and closed in the next", async () => {
    // `segovia`: `Сеговия писал: "Я посвятил…` and the closing `"` at the end
    // of the last `<li>` four items later. The lead-in stays outside.
    const out = await md(
      PROSE +
        '<p class="t1">Формулируя цели Сеговия писал: &quot;Я посвятил свою жизнь задачам:</p>' +
        "<ol><li>отделение гитары от увеселений;</li>" +
        "<li>обеспечение репертуаром высокого качества;</li>" +
        "<li>донесению красоты звучания до публики&quot;</li></ol>" +
        PROSE,
    );
    expect(out).toMatch(/^Формулируя цели Сеговия писал:$/mu);
    expect(out).toMatch(/^> "Я посвятил свою жизнь задачам:$/mu);
    expect(out).toMatch(/^> 1\\?\. отделение/mu);
    expect(out).toMatch(/донесению красоты звучания до публики"/u);
  });

  it("leaves a duration alone — the measured false friend", async () => {
    // `kiselev` writes `*1'52"*`: the mark is a seconds symbol, the count is
    // odd, and nothing closes it. Two guards catch it — the next block closes
    // no quotation, and an opening quote is never preceded by a digit.
    const out = await md(
      PROSE +
        '<p class="t1">- "Босса-нова" Лео Брауэру (1987) <i>1\'52"</i></p>' +
        '<p class="t1">Английская сюита (1988-1992)</p>' +
        PROSE,
    );
    expect(out).not.toContain("> ");
  });

  /**
   * ## Rule contract — a hand-drawn bullet is the list it was drawing
   *
   * **Invariant.** Two or more adjacent blocks opening with the *same* mark
   * from `LIST_BULLETS`. The marks are lexical data that degrade to nothing on
   * no-match; the evidence is that one repeats across siblings.
   *
   * **Recurrence is the rule, not a gate on it** — one bulleted line is a
   * label, which `RULE_GLYPHS`' own note already names as the false friend.
   *
   * Measured: no reference anywhere leaves a bullet-opened line a paragraph.
   */
  it("makes a list of adjacent blocks the author bulleted by hand", async () => {
    // `segovia`: two `<p>` each opening `•` where the page meant `<ul>`.
    // `analyze.md` asks for exactly this conversion, by name.
    const out = await md(
      PROSE +
        '<p class="t">• Владимир Бобри о технических приемах Сеговии</p>' +
        '<p class="t">• Денис Кольвах "Техника Сеговии"</p>' +
        PROSE,
    );
    expect(out).toContain("- Владимир Бобри о технических приемах Сеговии");
    expect(out).toContain('- Денис Кольвах "Техника Сеговии"');
    expect(out).not.toMatch(/^•/mu);
  });

  it("leaves one bulleted line a label — the false friend", async () => {
    const out = await md(PROSE + '<p class="t">• Из письма А.Максимова</p>' + PROSE);
    expect(out).not.toContain("- Из письма А.Максимова");
  });

  it("breaks the run where the mark changes — the second false friend", async () => {
    // Two different marks are two authors' habits meeting, not one list.
    const out = await md(
      PROSE + '<p class="t">• Первый пункт списка</p><p class="t">· Второй пункт списка</p>' + PROSE,
    );
    expect(out).not.toContain("- Первый пункт списка");
    expect(out).not.toContain("- Второй пункт списка");
  });

  it("absorbs a numbered line the source closed the paragraph before", async () => {
    // `goya2`: `<p>01…08</p><p>09. Promise Me</p>` — the run continues and the
    // block boundary is the 1998 authoring slip `analyze-2.md` names. The
    // source's own counter is the whole evidence.
    const split =
      '<p class="t">01. Everything I Do<br>02. Melodia<br>03. Sacrifice</p>' + '<p class="t">04. Be<br></p>';
    const out = await md(PROSE + split + PROSE);
    expect(out).toContain("- 04\\. Be");
    expect(out).not.toMatch(/^04\\?\. Be/mu);
  });

  it("leaves the next album's track list alone — the false friend", async () => {
    // The commonest shape on the same page: a second run restarting at 01.
    // 1 is not the successor of 3, so the two lists stay two lists.
    const restart =
      '<p class="t">01. Everything I Do<br>02. Melodia<br>03. Sacrifice</p>' +
      '<p class="t">01. Song Sung Blue<br>02. Hello Again<br>03. Natacha</p>';
    const out = await md(PROSE + restart + PROSE);
    const first = out.indexOf("03\\. Sacrifice");
    const second = out.indexOf("01\\. Song Sung Blue");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // Two lists, and the serializer alternates the bullet marker to keep them
    // apart — which is only possible because they were never merged.
    expect(out.slice(first, second)).toMatch(/\n\s*\n/u);
    expect(out).toMatch(/^[*+] 01\\\. Song Sung Blue/mu);
  });

  it("leaves a number that is not the successor alone — the second false friend", async () => {
    const aside = '<p class="t">01. Everything I Do<br>02. Melodia<br>03. Sacrifice</p>' + '<p class="t">07. See also</p>';
    const out = await md(PROSE + aside + PROSE);
    expect(out).not.toContain("- 07\\. See also");
  });

  it("leaves a differently punctuated run alone — the third false friend", async () => {
    const repunctuated =
      '<p class="t">01. Everything I Do<br>02. Melodia<br>03. Sacrifice</p>' + '<p class="t">04) Be</p>';
    const out = await md(PROSE + repunctuated + PROSE);
    expect(out).not.toContain("- 04) Be");
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

/**
 * ## Rule contract — a dot leader is the column it was drawing
 *
 * The full contract lives above `tableFromLeaderLines` in `structure.ts`,
 * including the threshold sweep. These are its four falsifiers.
 *
 * `analyze-3.md`, `tarrega.htm`: *"получается ASCII подобная псевдо таблица,
 * где отступ для второго столбца регулируется точками … Тут нужна умная
 * функция, эвристика, что бы распознала такую структуру и правратила ее в
 * более красивую и типичную для md таблицу"*.
 */
describe("a dot leader is the column it was drawing", () => {
  const LEADERS =
    "<blockquote><p>" +
    "1. Capricho Arabe (Serenata para guitarra) ..................... A. y T. 357<br>" +
    "2-3. Preludios No 1 y 2 ......................................... A. y T. 358<br>" +
    "4. Largo de la Sonata de Beethoven (Op. 7) .................... A. y T. 362<br>" +
    "5. Gran Vals ............................................ A. y T. 360" +
    "</p></blockquote>";

  it("reads a ruled run as the two-column table it renders as", async () => {
    const out = await md(PROSE + LEADERS + PROSE);
    expect(out).toMatch(/^\| \| - \|$/mu);
    expect(out).toMatch(/^\| 1\\?\. Capricho Arabe \(Serenata para guitarra\) \| A\. y T\. 357 \|$/mu);
    // The row the enumerated-list rule used to swallow: `2-3.` is not an
    // ordinal, so the list attached it to the item above and lost the boundary.
    expect(out).toMatch(/^\| 2-3\. Preludios No 1 y 2 \| A\. y T\. 358 \|$/mu);
    expect(out).not.toMatch(/^- 1\\?\. Capricho/mu);
    // No leader survives into a cell: the dots were the boundary, not content.
    expect(out).not.toMatch(/\|[^|\n]*\.{4,}/u);
  });

  // False friend 1 — an ellipsis. `new_dyens` and `borislova` write three dots
  // as punctuation, and the sweep is what fixes the limit at four.
  it("does not read an ellipsis as a column rule", async () => {
    const out = await md(
      PROSE +
        "<blockquote><p>" +
        "Он объездил Восток, Индонезию, Скандинавию, Бразилию... Он также выступал<br>" +
        'Речь шла о "...заменителе", "подделке под..." и о многом другом<br>' +
        "Это произвело... Для меня же это было настоящим чудом и радостью" +
        "</p></blockquote>" +
        PROSE,
    );
    expect(out).not.toContain("| - |");
  });

  // False friend 2 — the measured one. `segovia`'s Rodrigo table pads a title
  // inside a real `<td>` that already has its own column, and both sides keep
  // the dots verbatim. The leader is trailing, so it bounds nothing.
  it("leaves a leader that pads a cell which already has a column", async () => {
    const out = await md(
      PROSE +
        '<table border="0" width="80%">' +
        '<tr><td class="jr">I</td><td class="jr">-</td>' +
        '<td><p class="jr">Villano y Recercarre........................................</p></td>' +
        '<td align="right"><p class="jr">4:49</p></td></tr>' +
        '<tr><td class="jr">II</td><td class="jr">-</td>' +
        '<td><p class="jr">Espanoleta e Fanfare de la Caballeria........................</p></td>' +
        '<td align="right"><p class="jr">9:17</p></td></tr>' +
        '<tr><td class="jr">III</td><td class="jr">-</td>' +
        '<td><p class="jr">Danza de Las Hachas......................................</p></td>' +
        '<td align="right"><p class="jr">2:13</p></td></tr>' +
        "</table>" +
        PROSE,
    );
    expect(out).toContain("Villano y Recercarre........................................");
  });

  // False friend 3 — a run where the rule stops halfway down. A column that
  // does not reach every row is not a column, and half a table loses the rest.
  it("declines when only some of the lines are ruled", async () => {
    const out = await md(
      PROSE +
        "<blockquote><p>" +
        "1. Capricho Arabe ..................... A. y T. 357<br>" +
        "2. Preludios No 1 y 2 ................. A. y T. 358<br>" +
        "3. Все остальные произведения этого сборника изданы отдельно" +
        "</p></blockquote>" +
        PROSE,
    );
    expect(out).not.toContain("| - |");
    expect(out).toContain("Все остальные произведения этого сборника изданы отдельно");
  });

  // False friend 4 — an enumerated list with no leaders keeps being a list.
  it("leaves an unruled numbered run to the list rule", async () => {
    const out = await md(
      PROSE +
        "<blockquote><p>" +
        "01. Speak softly love<br>02. I just called to say I love you<br>03. Moscow nights" +
        "</p></blockquote>" +
        PROSE,
    );
    expect(out).toMatch(/^- 01\\?\. Speak softly love$/mu);
    expect(out).not.toContain("| - |");
  });
});

/**
 * ## Rule contract — a hairline round a lone cell is a box, not a grid
 *
 * The full contract lives above `soleCellBox` in `frames.ts`, including the
 * 24-instance corpus sweep. These are its falsifiers.
 *
 * `analyze-3.md` states it twice with the HTML. On `segovia1`: *"текст …
 * заключен в рамку (находится внутри таблицы у которой явно указан border="1")
 * и отцентрован … такой текст стоит заключить во frame"*. On `new_karta`:
 * *"такой текст я тоже выделил и поместил в самую близкую по цвету рамку"*.
 */
describe("a hairline round a lone cell is a box", () => {
  const NOTICE =
    "ВНИМАНИЕ! Частичное или полное использование материалов данной статьи " +
    "разрешается только с письменного согласия автора. Ссылка обязательна.";

  it("frames a one-cell bordered table the way the author drew it", async () => {
    const out = await md(
      PROSE + `<table border="1" width="90%"><tr><td><p>${NOTICE}</p></td></tr></table>` + PROSE,
    );
    expect(out).toContain("::: frame");
    // No colour evidence — a browser-default grey is not a choice — so the
    // spec's own default is written rather than a guessed token.
    expect(out).toContain("frame: gold");
    expect(out).toContain("ВНИМАНИЕ!");
  });

  // False friend: a bordered table that has a grid. The hairline is then the
  // cell rule it was always taken for, and framing every cell of a discography
  // would put a box round each track in the corpus's worst documents.
  it("leaves a bordered table that actually has cells", async () => {
    const out = await md(
      PROSE +
        '<table border="1"><tr>' +
        `<td><p>${NOTICE}</p></td><td><p>Второй столбец этой же строки таблицы</p></td>` +
        "</tr></table>" +
        PROSE,
    );
    expect(out).not.toContain("::: frame");
  });

  // False friend: a lone cell with no border at all. `border="0"` computes
  // `border-style: none`, and a table used for layout is not a notice.
  it("leaves a one-cell table the author drew no border on", async () => {
    const out = await md(
      PROSE + `<table border="0"><tr><td><p>${NOTICE}</p></td></tr></table>` + PROSE,
    );
    expect(out).not.toContain("::: frame");
  });

  // False friend: the page shell. Legacy pages wrap the whole article in one
  // bordered cell, and §12 excludes exactly that.
  it("leaves a lone bordered cell that holds the whole article", async () => {
    const out = await md(`<table border="1"><tr><td>${PROSE}</td></tr></table>`);
    expect(out).not.toContain("::: frame");
  });
});

/**
 * A run's links survive the figure branch.
 *
 * The contract lives above `hasOrphanTarget` in `structure.ts`. These are its
 * falsifiers. The shape it protects is the footer pager every page of this
 * corpus family draws — *back arrow · current-page marker · forward arrow* —
 * where the marker is the one icon `isUiIcon` declines, because the page it
 * would point at is the page you are on. With the marker counted as the run's
 * only picture, the run looked like a lone figure and both arrows' destinations
 * were deleted. Text recall stayed at 100 %: no text was ever involved.
 *
 * The shape does not occur in any of the 28 reference sources, which is why no
 * reference could have caught it; it occurs on 12 of the 946 unlabelled pages,
 * and the conservation gate reports 15 lost targets and 15 lost images there.
 */
describe("a figure never swallows a link", () => {
  const PAGER =
    '<p align="center">' +
    '<a href="prev.htm"><img border="0" src="../main/previous.gif" width="16" height="16"></a>' +
    '<img border="0" src="../main/h2.gif" width="16" height="16">' +
    '<a href="next.htm"><img border="0" src="../main/next.gif" width="16" height="16"></a>' +
    "</p>";

  it("keeps both destinations of a pager whose middle marker is unlinked", async () => {
    const out = await md(PROSE + PAGER);
    expect(out).toContain("(/#/prev)");
    expect(out).toContain("(/#/next)");
  });

  it("does not reduce that run to a standalone figure", async () => {
    const out = await md(PROSE + PAGER);
    expect(out).not.toContain("::: image\nsrc: ../main/h2.gif");
  });

  // False friend: the linked thumbnail, the corpus's commonest standalone
  // figure. Its `<a>` is what `::: image`'s `link:` property is for, and the
  // `<a>` contains the chosen image, so the target is not orphaned and the
  // figure branch must still fire.
  it("still makes a figure of a thumbnail that links to its own scan", async () => {
    const out = await md(
      PROSE + '<p align="center"><a href="photo/big.jpg"><img src="photo/thumb.jpg" width="120" height="90"></a></p>',
    );
    expect(out).toContain("::: image");
    expect(out).toContain("src: photo/thumb.jpg");
  });

  // False friend: a lone unlinked picture. Nothing to orphan, so nothing changes.
  it("still makes a figure of a lone unlinked picture", async () => {
    const out = await md(PROSE + '<p align="center"><img src="photo/portrait.jpg" width="200" height="260"></p>');
    expect(out).toContain("::: image");
    expect(out).toContain("src: photo/portrait.jpg");
  });

  // A link whose destination does not survive rewriting is not a lost target,
  // so it must not block the figure either.
  it("still makes a figure when the only other link goes nowhere", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><a href="javascript:void(0)"><img src="../main/previous.gif" width="16" height="16"></a>' +
        '<img src="photo/portrait.jpg" width="200" height="260"></p>',
    );
    expect(out).toContain("::: image");
    expect(out).toContain("src: photo/portrait.jpg");
  });
});

/**
 * An unlinked known icon standing in a strip of linked ones.
 *
 * The contract lives above `inControlStrip` in `media.ts`. These are its
 * falsifiers. `isUiIcon` wants an `<a href>` ancestor, which the current-page
 * marker of a footer pager can never have — the page it would point at is the
 * page you are on — so it shipped as `![](../main/h2.gif)`, a broken picture
 * between two arrows that had become glyphs. `mini_images_to_md_guide.md` maps
 * the asset to `●` with no linked requirement, and `new_rechin4.bio.md` writes
 * exactly that glyph in exactly this pager position.
 */
describe("an unlinked icon in a strip of linked ones is a control too", () => {
  it("draws the pager marker as its glyph", async () => {
    const out = await md(
      PROSE +
        '<p align="center">' +
        '<a href="prev.htm"><img src="../main/previous.gif" width="16" height="16"></a>\n' +
        '<img src="../main/h2.gif" width="16" height="16">\n' +
        '<a href="next.htm"><img src="../main/next.gif" width="16" height="16"></a>' +
        "</p>",
    );
    expect(out).toContain("[◀](/#/prev) ● [▶](/#/next)");
    expect(out).not.toContain("h2.gif");
  });

  // False friend: the score mark before a discography cell's links. Ten of the
  // reference corpus's eleven unlinked known icons are these, and they keep
  // their picture. A link column's labels are text, never a known icon, so no
  // linked icon stands beside them.
  it("leaves a score mark that stands before a cell's text links", async () => {
    const out = await md(
      PROSE +
        '<table border="0" width="90%"><tr>' +
        '<td><p>Этюд № 1 для гитары соло, сочинение первое</p></td>' +
        '<td><p><img src="../main/score3.gif" width="16" height="16">' +
        '<a href="score/etude1.pdf">PDF</a></p></td>' +
        "</tr><tr>" +
        '<td><p>Этюд № 2 для гитары соло, сочинение второе</p></td>' +
        '<td><p><img src="../main/score3.gif" width="16" height="16">' +
        '<a href="score/etude2.pdf">PDF</a></p></td>' +
        "</tr></table>" +
        PROSE,
    );
    expect(out).toContain("score3.gif");
  });

  // False friend: a lone unlinked known icon with nothing beside it. One icon
  // is not a strip, so the `<a>` requirement still governs.
  it("leaves a lone unlinked known icon alone", async () => {
    const out = await md(PROSE + '<p align="center"><img src="../main/h2.gif" width="16" height="16"></p>' + PROSE);
    expect(out).toContain("h2.gif");
  });

  // The block boundary is the strip: an arrow in a different paragraph is not
  // company.
  it("does not reach across a block for its company", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><img src="../main/h2.gif" width="16" height="16"></p>' +
        '<p align="center"><a href="next.htm"><img src="../main/next.gif" width="16" height="16"></a></p>',
    );
    expect(out).toContain("h2.gif");
  });

  // A linked image that is *not* a known icon is not company either — otherwise
  // any thumbnail beside a marker would promote it.
  it("needs the company to be a known icon, not merely a link", async () => {
    const out = await md(
      PROSE +
        '<p align="center"><img src="../main/h2.gif" width="16" height="16">' +
        '<a href="photo/big.jpg"><img src="photo/thumb.jpg" width="24" height="24"></a></p>',
    );
    expect(out).toContain("h2.gif");
  });
});

  // The guide's other unlinked form — *"unlinked meaningful icon ->
  // replacement"* — where the company is a sentence rather than another icon.
  it("draws an icon a sentence carries as its glyph", async () => {
    const out = await md(
      PROSE +
        '<p>Загружен, пожалуй, самый крупный за последние полтора года пакет обновлений и новой ' +
        'информации, а это значит, что проект жив. Иногда мы все-таки оживаем!&nbsp;' +
        '<img border="0" src="main/smile.gif" width="15" height="15"></p>',
    );
    expect(out).toContain("оживаем! ☻");
    expect(out).not.toContain("smile.gif");
  });

  // False friend, the shape the `<a>` requirement exists to protect: the mark
  // that *opens* a resource cell. Both clauses refuse it — it is the cell's
  // first content, and nothing but spacing precedes it.
  it("leaves a score mark that opens a labelled cell", async () => {
    const out = await md(
      PROSE +
        '<table border="0" width="90%"><tr>' +
        '<td><p>Adelita (в исп. Дэвида Рассела), мазурка для гитары соло</p></td>' +
        '<td><p>&nbsp;&nbsp;<img src="../main/score3.gif" width="16" height="16">&nbsp;&nbsp;Ноты (*.jpg)</p></td>' +
        "</tr><tr>" +
        '<td><p>Recuerdos de la Alhambra, тремоло для гитары соло</p></td>' +
        '<td><p>&nbsp;&nbsp;<img src="../main/score3.gif" width="16" height="16">&nbsp;&nbsp;Ноты (*.jpg)</p></td>' +
        "</tr></table>" +
        PROSE,
    );
    expect(out).toContain("score3.gif");
  });

  // The block boundary bounds the sentence too: prose in the paragraph above
  // does not carry an icon in the cell below it.
  it("does not borrow a sentence from a neighbouring block", async () => {
    const out = await md(PROSE + '<p><img src="main/smile.gif" width="15" height="15"> Ноты</p>');
    expect(out).toContain("smile.gif");
  });

/**
 * A list with no items is not a list.
 *
 * **Invariant.** Cardinality, and nothing else: a list element with zero
 * list-item children cannot be a list in a target whose lists are made of
 * items, so it is the block wrapper it renders as. The era's authoring tool
 * emitted `<ul>` with no `<li>` for its indent button, and `listFrom` skipped
 * every non-`li` child — silently, with no ledger entry and no diagnostic. On
 * `assad_b` that deleted a whole discography: the table, its three album covers
 * and 23 of 194 text shingles, behind a text recall of 88 % that PROGRESS §46.6
 * had just established is not a loss signal.
 *
 * **Recurrence deliberately not required.** An indent wrapper is drawn once,
 * where the author pressed the button; asking for a second occurrence would ask
 * the construct not to exist — the trap §35.8 recorded for `minRows: 2`. There
 * are five in the 946 unlabelled pages, on five separate documents, and none in
 * the 28 references, which is why no reference could ever have caught it.
 *
 * **False friends, both tested for non-firing:** a real list, and a list whose
 * single item is empty — `<ul><li></li></ul>` has a list item and stays a list,
 * because the evidence is the item's presence and never its content.
 */
describe("a list element with no items", () => {
  const INDENTED_TABLE =
    '<ul><div><table border="0" width="80%">' +
    '<tr><td width="33%"><p><b>Solo</b></p><p>1994</p></td>' +
    '<td width="67%"><p>композиции Сержиу Ассада</p></td></tr>' +
    "</table></div></ul>";

  it("keeps the content the indent wrapper holds", async () => {
    const out = await md(PROSE + INDENTED_TABLE + PROSE);
    expect(out).toContain("Solo");
    expect(out).toContain("1994");
    expect(out).toContain("композиции Сержиу Ассада");
  });

  it("loses no image drawn inside one", async () => {
    const out = await md(
      PROSE + '<ul><p><img src="photo/a/bassad_1.jpg" width="180" height="180"></p></ul>' + PROSE,
    );
    expect(out).toContain("photo/a/bassad_1.jpg");
  });

  it("still writes a list when the items are there — non-firing", async () => {
    const out = await md(PROSE + "<ul><li>Solo</li><li>Rhythms</li></ul>" + PROSE);
    expect(out).toContain("- Solo");
    expect(out).toContain("- Rhythms");
  });

  it("reads one item as a list and one bare block as an indent — the pair", async () => {
    // The discriminator, stated as the minimal pair it is: identical content,
    // and the only difference is whether the tool wrote a list item around it.
    expect(await md(PROSE + "<ul><li><p>Solo</p></li></ul>" + PROSE)).toContain("- Solo");
    const wrapped = await md(PROSE + "<ul><p>Solo</p></ul>" + PROSE);
    expect(wrapped).toContain("Solo");
    expect(wrapped).not.toContain("- Solo");
  });

  it("keeps content a list holds beside its items", async () => {
    // Zero instances in 974 pages, so this is a guard against silent loss and
    // not a rule fitted to a shape — but the loss it guards against is the one
    // that cost a discography, so it is stated rather than assumed impossible.
    const out = await md(PROSE + "<ul><li>Solo</li><p>Rhythms</p></ul>" + PROSE);
    expect(out).toContain("Solo");
    expect(out).toContain("Rhythms");
  });
});

/**
 * An anchor folded into a menu item is accounted for, not lost.
 *
 * `navFromGrid` requires every anchor of a cell to carry the *same* destination
 * and then writes one link — `<a>1995</a><a>-2002</a>` becomes
 * `[1995-2002](…)`, which is §11's rule and the right reading of a label the
 * era's authoring tool split in two. The conservation gate compares target
 * *multisets*, so the second anchor read as a lost destination: `williams1` was
 * the last lost target in the 946 unlabelled pages, and it was never lost.
 *
 * **Invariant.** The record is the merge itself — one ledger entry per anchor
 * the rule folded away, keyed on nothing but identity with the anchor it kept.
 * A destination still in the document is still reachable.
 */
describe("a menu item whose label the source split across two anchors", () => {
  const menu =
    '<table border="0" width="120"><tr><td>Дискография</td></tr>' +
    '<tr><td><a href="cd1.htm">1995</a><a href="cd1.htm">-2002</a></td></tr>' +
    '<tr><td><a href="cd2.htm">1989-1994</a></td></tr>' +
    '<tr><td><a href="cd3.htm">1979-1988</a></td></tr></table>';

  it("writes one link carrying the whole label", async () => {
    const out = await md(PROSE + menu + PROSE);
    expect(out).toContain("[1995-2002](/#/cd1)");
  });

  it("records the folded anchor so the destination is not reported as lost", async () => {
    const result = await convert(Buffer.from(page(PROSE + menu + PROSE), "utf8"), { profile: SPEC });
    expect(result.conservation.targets.missing).toEqual([]);
    expect(
      result.ledger.some(
        (e) =>
          e.terminal.kind === "REMOVED" &&
          /merged into the item/u.test((e.terminal as { reason: string }).reason),
      ),
    ).toBe(true);
  });
});

/**
 * A grid abandoned *because* one column is a media lane is that lane.
 *
 * **Invariant.** The refusal names the remedy. `planDataTable` declines a
 * `media-lane` grid on the stated ground that one column is bare pictures —
 * §16.1's "text beside a cover", a lane rather than a column of values — and a
 * lane is what `layoutFrom` builds. Decomposing to flow instead destroys the
 * pairing that reason just identified: on `assad_b` an album's title, its year
 * and its cover stop being one record and become a rule, a bold line, a `###`
 * year and a loose figure.
 *
 * **This is not the reconsideration §18.3 killed**, which a contract above
 * refuses by name. That one fires where a record matrix would have been a real
 * table with one more row, and lanes lose it; this one fires only where
 * `planDataTable` has established there is no table to lose. The killed form's
 * own fixture cannot reach here — the media-lane test needs two populated cells
 * in one column, and that fixture has one row.
 *
 * **Two false friends, both tested for non-firing.** A *gallery* — most of the
 * grid pictures, so `planDataTable` refuses it as `media-catalog` instead —
 * has no worded lane to pair the covers with, and `goya2`'s reference writes
 * the single `::: images` row the flow path already builds. Lanes cost that
 * document 20 findings, which is how the two refusals came to be told apart by
 * name rather than by degree. A *resource matrix* carrying marks —
 * `MP3 | MIDI | TAB` down one column, a 16 px glyph down the other — is a
 * record list whose pictures are ornament; `hasResourceColumn` reads the same
 * evidence the tier-1 DATA gate used to type it, so the two rules cannot
 * disagree about what the grid is.
 */
describe("a media catalog that cannot be a table", () => {
  /** The lane path only exists under `faithful`, which is what the corpus runs. */
  const laned = async (body: string): Promise<string> =>
    (
      await convert(Buffer.from(page(body), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;

  const album = (title: string, year: string, cover: string) =>
    `<tr><td width="33%" valign="top"><p><b>${title}</b></p><p>${year}</p></td>` +
    `<td width="67%" align="center"><p><img src="${cover}" width="180" height="180"></p></td></tr>`;

  const CATALOG =
    '<table border="0" width="80%">' +
    album("Solo", "1994", "photo/a/bassad_1.jpg") +
    album("Rhythms", "1995", "photo/a/bassad_2.jpg") +
    album("Echoes of Brazil", "1997", "photo/a/bassad_3.jpg") +
    "</table>";

  it("pairs each cover with its own matter instead of flattening the grid", async () => {
    const out = await laned(PROSE + CATALOG + PROSE);
    expect(out).toContain("::: columns");
    expect(out).toContain("photo/a/bassad_1.jpg");
    // The year was becoming a section heading once the record was taken apart.
    expect(out).not.toContain("### 1994");
  });

  it("leaves a gallery of covers on the flow path, where it becomes one row — non-firing", async () => {
    // Every cell a picture: there is no worded lane to pair them with, so the
    // pairing lanes would preserve does not exist. `goya2` is this shape, and
    // its reference writes one `::: images` row. The verdict is forced for the
    // same reason the contract above forces one — a synthetic gallery does not
    // score DATA on its own, and tuning it until it did would test the scorer.
    const cover = (src: string) => `<td width="25%"><p><img src="${src}" width="120" height="120"></p></td>`;
    const html = page(
      PROSE +
        '<table border="0" width="80%"><tr>' +
        cover("c1.jpg") +
        cover("c2.jpg") +
        "</tr><tr>" +
        cover("c3.jpg") +
        cover("c4.jpg") +
        "</tr></table>" +
        PROSE,
    );
    const doc = parseHtml(html);
    const tables = [...walkElements(doc.root)].filter((e) => e.tag === "table");
    const target = tables[tables.length - 1] as { id: string };
    const result = await convert(Buffer.from(html, "utf8"), {
      profile: SPEC,
      layoutFidelity: "faithful",
      measurer: new InlineAlignMeasurer(),
      classifications: new Map([
        [target.id, { class: "DATA", confidence: 0.4, tier: 4, reason: "forced by test" } as Classification],
      ]),
    });
    expect(result.markdown).not.toContain("::: columns");
    expect(result.markdown).toContain("::: images");
  });

  it("leaves a resource matrix on the flow path however often its marks recur — non-firing", async () => {
    const mark = (glyph: string, href: string, label: string) =>
      `<tr><td><img src="${glyph}" width="16" height="16"></td><td><a href="${href}">${label}</a></td></tr>`;
    const out = await laned(
      PROSE +
        '<table border="0" width="300">' +
        mark("a.gif", "a.htm", "MP3") +
        mark("b.gif", "b.htm", "MIDI") +
        mark("c.gif", "c.htm", "TAB") +
        mark("d.gif", "d.htm", "NOTES") +
        "</table>" +
        PROSE,
    );
    expect(out).not.toContain("::: columns");
  });
});

/**
 * A one-row DATA grid that carries a figure beside its visible caption is a
 * bounded layout region, not a record matrix and not linear flow.
 *
 * **Invariant.** One occupied cell lowers to one standalone image; another
 * lowers only to short, link-free text that substantially repeats the image's
 * source-backed label. The source's row states the side-by-side relationship.
 * No filename, class, width ratio or detector vocabulary participates.
 *
 * **Recurrence cannot apply.** A figure has one caption by definition. The
 * declared row, cardinality and caption role carry the proof instead.
 *
 * **False friends, tested for non-firing.** A text lane beside a cover carries
 * article prose rather than a centred caption and must not be bound as one; a
 * title beside a resource link is the one-record DATA shape
 * and must remain a GFM table; two caption cells with no image do not identify
 * either text block as a caption of the other.
 */
describe("a one-row figure-and-caption grid preserves the binding", () => {
  async function converted(body: string): Promise<string> {
    return (
      await convert(Buffer.from(page(PROSE + body + PROSE), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;
  }

  it("binds the visible side caption to the figure instead of repeating it", async () => {
    const figure =
      '<table border="0"><tr>' +
      '<td><p style="text-align: center"><img src="portrait.jpg" alt="Душан Богданович" width="125" height="175"></p></td>' +
      '<td><p style="text-align: center">Душан Богданович в журнале, сентябрь 1998 г.</p></td>' +
      "</tr></table>";
    const out = await converted(figure);
    expect(out).toContain("caption: Душан Богданович в журнале, сентябрь 1998 г.");
    expect(out.match(/Душан Богданович в журнале, сентябрь 1998 г\./gu)).toHaveLength(1);
    expect(out).not.toContain("::: columns");
  });

  it("binds a shorter visible caption when it preserves the image label's identity", async () => {
    const figure =
      '<table border="0"><tr>' +
      '<td><p><img src="portrait.jpg" alt="Душан Богданович, Classical Guitar" width="125"></p></td>' +
      '<td>Душан Богданович в журнале Classical Guitar</td>' +
      "</tr></table>";
    const out = await converted(figure);
    expect(out).toContain("caption: Душан Богданович в журнале Classical Guitar");
  });

  it("does not bind unrelated short side text to a figure — non-firing", async () => {
    const unrelated =
      '<table border="0"><tr>' +
      '<td><p><img src="portrait.jpg" alt="Душан Богданович" width="125"></p></td>' +
      '<td><p>Концерт состоялся в сентябре</p></td>' +
      "</tr></table>";
    const out = await converted(unrelated);
    expect(out).not.toContain("caption: Концерт состоялся");
  });

  it("does not bind a one-word generic alt to repeated side text — non-firing", async () => {
    const generic =
      '<table border="0"><tr>' +
      '<td><p><img src="portrait.jpg" alt="Фото" width="125"></p></td>' +
      '<td><p>Фото с концерта в сентябре</p></td>' +
      "</tr></table>";
    const out = await converted(generic);
    expect(out).not.toContain("caption: Фото с концерта");
  });

  it("does not bind a prose lane beside its cover as a caption — non-firing", async () => {
    const lane =
      '<table border="0"><tr>' +
      '<td>Он был выдающимся гитаристом своего поколения и оставил обширное музыкальное наследие.</td>' +
      '<td><p><img src="cover.jpg" alt="Обложка" width="150" height="150"></p></td>' +
      "</tr></table>";
    const out = await converted(lane);
    expect(out).toContain("Он был выдающимся гитаристом");
    expect(out).not.toContain("caption: Он был выдающимся");
  });

  it("leaves a one-record resource row as a table — non-firing", async () => {
    const record =
      '<table border="0"><tr><td>Estrelluvio</td>' +
      '<td><a href="music/estrelluvio.wma">WMA</a></td></tr></table>';
    const out = await converted(record);
    expect(out).toContain("| Estrelluvio | [WMA](music/estrelluvio.wma) |");
    expect(out).not.toContain("::: columns");
  });

  it("does not invent a binding between two caption-like text cells — non-firing", async () => {
    const labels =
      '<table border="0"><tr>' +
      '<td><p style="text-align: center">Левая подпись</p></td>' +
      '<td><p style="text-align: center">Правая подпись</p></td>' +
      "</tr></table>";
    const out = await converted(labels);
    expect(out).not.toContain("caption:");
  });
});

/**
 * Rule contract — **a picture over a caption, alone in a column, is a figure.**
 *
 * *Invariant.* Every occupied cell in one column, exactly two of them, the
 * earlier lowering to one standalone image and nothing else, the later to
 * short link-free picture-free text the author set apart typographically.
 * Containment, cardinality, occupancy and source order; no class, id, width,
 * filename or vocabulary is read.
 *
 * *Recurrence.* Not applicable and stated: a figure box holds one figure. The
 * closure of the test replaces it — one column, two rows, nothing else in the
 * table, so no third thing exists for a wrong reading to swallow.
 *
 * *Why not `alt`.* Its side-by-side sibling matches the visible line against
 * the image's `alt`, because two peer cells need the wording to say which is
 * the caption. A stacked box has already said it structurally, and the corpus's
 * stacked boxes routinely carry no `alt` — `xtra_alexandro`'s postage stamp has
 * none — so requiring one refuses every true positive.
 *
 * *False friends*, each tested for non-firing.
 */
describe("a picture over its caption in a column of its own", () => {
  async function converted(body: string): Promise<string> {
    return (
      await convert(Buffer.from(page(PROSE + body + PROSE), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;
  }

  const STAMP =
    '<table border="0" width="150" align="right">' +
    '<tr><td width="100%"><p><img border="0" src="photo/stamp.jpg" width="150" height="212"></p></td></tr>' +
    '<tr><td width="100%"><p style="text-align: center">Почтовая марка,<br>выпущенная в Уругвае<br>(1999)</p></td></tr>' +
    "</table>";

  it("binds the line under the picture as its caption", async () => {
    const out = await converted(STAMP);
    expect(out).toContain("caption: Почтовая марка, выпущенная в Уругвае (1999)");
    expect(out.match(/Почтовая марка/gu)).toHaveLength(1);
  });

  it("decides identically under renamed attributes and permuted order — mutation", async () => {
    const permuted =
      '<table align="right" class="figbox" id="fig-7" width="150" border="0">' +
      '<tr><td class="pic"><p><img width="150" src="photo/stamp.jpg" height="212" border="0"></p></td></tr>' +
      '<tr><td class="cap"><p class="podpis" style="text-align: center">Почтовая марка,<br>выпущенная в Уругвае<br>(1999)</p></td></tr>' +
      "</table>";
    expect(await converted(permuted)).toContain("caption: Почтовая марка, выпущенная в Уругвае (1999)");
  });

  it("leaves body prose under a picture as prose — non-firing", async () => {
    const prose =
      '<table border="0" width="150" align="right">' +
      '<tr><td><p><img src="photo/stamp.jpg" width="150" height="212"></p></td></tr>' +
      "<tr><td><p>Почтовая марка была выпущена в Уругвае в 1999 году.</p></td></tr>" +
      "</table>";
    const out = await converted(prose);
    expect(out).not.toContain("caption: Почтовая марка была выпущена");
    expect(out).toContain("Почтовая марка была выпущена в Уругвае в 1999 году.");
  });

  it("leaves a menu under a banner alone — non-firing", async () => {
    const menu =
      '<table border="0" width="150" align="right">' +
      '<tr><td><p><img src="photo/stamp.jpg" width="150" height="212"></p></td></tr>' +
      '<tr><td><p style="text-align: center"><a href="disc.htm">Дискография</a></p></td></tr>' +
      "</table>";
    expect(await converted(menu)).not.toContain("caption: Дискография");
  });

  it("leaves a two-picture stack as two pictures — non-firing", async () => {
    const stack =
      '<table border="0" width="150" align="right">' +
      '<tr><td><p><img src="photo/one.jpg" width="150" height="212"></p></td></tr>' +
      '<tr><td><p style="text-align: center"><img src="photo/two.jpg" width="150" height="212"></p></td></tr>' +
      "</table>";
    expect(await converted(stack)).not.toContain("caption:");
  });

  it("leaves a three-row column alone — non-firing", async () => {
    const three =
      '<table border="0" width="150" align="right">' +
      '<tr><td><p><img src="photo/stamp.jpg" width="150" height="212"></p></td></tr>' +
      '<tr><td><p style="text-align: center">Почтовая марка</p></td></tr>' +
      '<tr><td><p style="text-align: center">Уругвай, 1999</p></td></tr>' +
      "</table>";
    expect(await converted(three)).not.toContain("caption: Почтовая марка");
  });

  it("does not read a caption above the picture it would name — non-firing", async () => {
    const inverted =
      '<table border="0" width="150" align="right">' +
      '<tr><td><p style="text-align: center">Почтовая марка, Уругвай</p></td></tr>' +
      '<tr><td><p><img src="photo/stamp.jpg" width="150" height="212"></p></td></tr>' +
      "</table>";
    expect(await converted(inverted)).not.toContain("caption: Почтовая марка, Уругвай");
  });
});

/**
 * Rule contract — **a solitary shouted label above a list opens a section.**
 *
 * *Invariant.* A paragraph immediately above a `list`, short, no link, image or
 * hard break, no sentence punctuation — and, where it is the page's only such
 * label, written in capitals or wholly bold and *not* ending in a colon. The
 * evidence is position, cardinality and letter case; no vocabulary is read.
 *
 * *Recurrence.* Deliberately not required for the solitary branch, and the
 * reason is stated: a page has one discography. `CLAUDE.md` §5's recurrence law
 * governs shapes that repeat within a document, and cannot govern one that
 * occurs once by definition. Typography and the absent colon stand in for it,
 * and both are required.
 *
 * *Depth is not arbitrary.* Several such labels are peers inside one region
 * (`###`, unchanged); one label that nothing else labels is a section of the
 * document (`##`), which is what `headingLineOf` reads of a solitary shouted
 * line and what `segovia`'s reference writes.
 *
 * *False friends*, each tested for non-firing: a colon-terminated lead-in
 * handing over to an enumeration (`Примечания:`, a paragraph in
 * `new_geyzel04`'s reference); a running-case sentence above a list; a label
 * inside a record region.
 */
describe("a solitary shouted label above a list", () => {
  const ALBUMS = "<ul><li>Centenary Celebration</li><li>Poet of the Guitar</li><li>Recital Intimo</li></ul>";

  it("opens a section of the document", async () => {
    const out = await md(PROSE + "<p><font size=2>ДИСКОГРАФИЯ</font></p>" + ALBUMS);
    expect(out).toContain("## ДИСКОГРАФИЯ");
  });

  it("leaves a colon-terminated lead-in as prose — non-firing", async () => {
    const out = await md(PROSE + "<p><font size=2>ПРИМЕЧАНИЯ:</font></p>" + ALBUMS);
    expect(out).not.toMatch(/^#+ ПРИМЕЧАНИЯ/mu);
    expect(out).toContain("ПРИМЕЧАНИЯ:");
  });

  it("leaves a running-case line above a list as prose — non-firing", async () => {
    const out = await md(PROSE + "<p><font size=2>Среди них</font></p>" + ALBUMS);
    expect(out).not.toMatch(/^#+ Среди них/mu);
    expect(out).toContain("Среди них");
  });

  // Unit-level for the same reason the record-region guard above is: which
  // container a block lands in, and therefore how many labels one call sees,
  // depends on how many page-frame tables the classifier collapses first.
  it("keeps several labels as peers and a lone one as a section", () => {
    const label = (text: string): Paragraph => ({ type: "paragraph", children: [{ type: "text", value: text }] });
    const albums: List = {
      type: "list",
      ordered: false,
      spread: false,
      children: [{ type: "listItem", spread: false, children: [label("Poet of the Guitar")] }],
    };
    const ctx = (): Parameters<typeof promoteLabelBeforeList>[1] =>
      ({ tableDepth: 1, recoveredHeadings: new Set(), blockAlign: new Map() }) as unknown as Parameters<
        typeof promoteLabelBeforeList
      >[1];

    const several = promoteLabelBeforeList([label("ДИСКОГРАФИЯ"), albums, label("ФИЛЬМОГРАФИЯ"), albums], ctx());
    expect(several.filter((n) => n.type === "heading" && n.depth === 3)).toHaveLength(2);

    const lone = promoteLabelBeforeList([label("ДИСКОГРАФИЯ"), albums], ctx());
    expect(lone.filter((n) => n.type === "heading" && n.depth === 2)).toHaveLength(1);

    // The two signals the solitary branch stands on, each removed in turn.
    expect(promoteLabelBeforeList([label("ДИСКОГРАФИЯ:"), albums], ctx()).some((n) => n.type === "heading")).toBe(
      false,
    );
    expect(promoteLabelBeforeList([label("Среди которых"), albums], ctx()).some((n) => n.type === "heading")).toBe(
      false,
    );
  });

  it("does not absorb the label into the picture above it — non-firing", async () => {
    const body =
      PROSE +
      '<p style="text-align: center"><img src="cover.jpg" width="400" height="562"></p>' +
      '<p style="text-align: center"><font size=2>ДИСКОГРАФИЯ</font></p>' +
      ALBUMS;
    const out = (
      await convert(Buffer.from(page(body), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;
    expect(out).not.toContain("caption: ДИСКОГРАФИЯ");
    expect(out).toContain("## ДИСКОГРАФИЯ");
  });
});

/**
 * Rule contract — **a word boundary inside a mark belongs outside it.**
 *
 * *Invariant.* Evidence is the characters on the two sides of the boundary and
 * nothing else: no document, class, id, filename, title or word list. It holds
 * for any inline mark in any language, because what is being read is the HTML
 * whitespace model, not the text.
 *
 * *Recurrence.* Not applicable, and stated rather than assumed: one `<i>x </i>y`
 * is one word boundary at one place. Requiring it to recur would make the rule
 * unable to fire on the shape it exists for. What recurs is the markup habit.
 *
 * *The word/punctuation cut is measured, not chosen.* Over the source pages of
 * the reference corpus, where the source spaces a mark boundary the references
 * keep the space **letter to letter, 3 to 1** — the 1 being `xtra_karta5`, whose
 * divergences are recorded — and drop it **against punctuation, 27 to 1**.
 *
 * *False friends*, each tested for non-firing:
 *   - punctuation on the other side (`<i>TCHAIKOVSKY </i>- Nutcracker`), which
 *     is the 26-instance majority reading and `BioMD-Reference.md`'s lowest
 *     precedence class, exact style;
 *   - a source that already spaces the outside — no second space may appear;
 *   - `<i> x</i>y` after a space, where the two spaces genuinely collapse in a
 *     browser and the words really do run together;
 *   - the outer edge of a paragraph or cell, where the same character is layout
 *     and must still be trimmed.
 *
 * *Mutation robustness.* The wrapper's tag and attributes are not read beyond
 * choosing the mark, so `<i>`/`<em>`/`<b>`/`<strong>`/`<s>` and any class or
 * attribute order decide identically.
 */
describe("boundary whitespace inside an inline mark", () => {
  it("hoists a trailing space out of the mark instead of dropping it", async () => {
    const out = await md("<p>alpha <i>Доменикони </i>Карло beta</p>");
    expect(out).toContain("alpha *Доменикони* Карло beta");
  });

  it("decides the same for every mark that carries delimiters", async () => {
    expect(await md("<p>x <b>Fires </b>его y</p>")).toContain("x **Fires** его y");
    expect(await md("<p>x <strong>Fires </strong>его y</p>")).toContain("x **Fires** его y");
    expect(await md("<p>x <em>Fires </em>его y</p>")).toContain("x *Fires* его y");
    expect(await md('<p>x <i class="q" lang="en-us">Fires </i>его y</p>')).toContain("x *Fires* его y");
  });

  it("hoists a leading space when nothing outside supplies one", async () => {
    const out = await md("<p>слово<i> другое</i> конец</p>");
    expect(out).toContain("слово *другое* конец");
  });

  it("leaves the boundary tight against punctuation — non-firing", async () => {
    // The 26-instance majority reading. A space before a dash is exact style,
    // the last thing in the reference's precedence order, and every reference
    // but one writes it closed up.
    const out = await md("<p><i>TCHAIKOVSKY </i>- Nutcracker Suite</p>");
    expect(out).toContain("*TCHAIKOVSKY*- Nutcracker Suite");
  });

  it("hoists across a digit boundary, which is a token boundary too", async () => {
    const out = await md("<p><i>Опус </i>1998 год</p>");
    expect(out).toContain("*Опус* 1998 год");
  });

  it("adds no second space when the source already spaces the outside", async () => {
    const out = await md("<p>x <i>Абреу </i> Зекинья y</p>");
    expect(out).toContain("x *Абреу* Зекинья y");
    expect(out).not.toContain("*Абреу*  Зекинья");
  });

  it("leaves words fused when the browser fuses them too — non-firing", async () => {
    // `epsilon ` then `<i> Leading</i>` — the two spaces collapse into one, so a
    // browser renders `epsilon Leadingword`. Inventing a space here would be
    // inventing content.
    const out = await md("<p>epsilon <i> Leading</i>word zeta</p>");
    expect(out).toContain("epsilon *Leading*word zeta");
  });

  it("still trims the outer edge of the block itself — non-firing", async () => {
    const out = await md("<p>  <i>Слово</i>  </p>");
    expect(out).toContain("*Слово*");
    expect(out.split("\n").some((line) => /^[ \t]+\*Слово|\*[ \t]+$/u.test(line))).toBe(false);
  });

  it("drops a mark that held nothing but whitespace", async () => {
    const out = await md("<p>раз<i> </i>два</p>");
    expect(out).toContain("раз два");
    expect(out).not.toContain("**");
  });
});

describe("boundary whitespace inside a transparent wrapper", () => {
  it("keeps the space a span or font holds between two words", async () => {
    expect(await md("<p><span>Ровшан </span>Шахбазович</p>")).toContain("Ровшан Шахбазович");
    expect(await md('<p><font color="red">основателем </font>Нормальной</p>')).toContain("основателем Нормальной");
  });

  it("adds no second space when the source spaces both sides — non-firing", async () => {
    const out = await md("<p>раз <span>два </span> три</p>");
    expect(out).toContain("раз два три");
    expect(out).not.toContain("два  три");
  });

  it("still trims the block's own outer edge — non-firing", async () => {
    const out = await md("<p><span> Слово </span></p>");
    expect(out.split("\n").some((line) => /^[ \t]+Слово|Слово[ \t]+$/u.test(line))).toBe(false);
  });
});

describe("a mark that holds nothing but whitespace", () => {
  it("keeps the space it renders and emits no delimiters", async () => {
    // `<em>Comments:</em><em> </em>clarinet` used to serialize as
    // `*Comments:***clarinet` — an unclosed bold and a lost space.
    const out = await md("<p><em>Comments:</em><em> </em>clarinet, violin</p>");
    expect(out).toContain("*Comments:* clarinet, violin");
    expect(out).not.toContain("***");
  });

  it("keeps it against punctuation too, because it is content and not style", async () => {
    const out = await md("<p>раз<i> </i>(два)</p>");
    expect(out).toContain("раз (два)");
  });
});

/**
 * "Too small to be a record matrix" is a verdict on the table, not on the region.
 *
 * **Invariant.** `planDataTable` refuses a one-row grid because a record matrix
 * *is* recurrence and one row cannot recur. That is a statement about columns of
 * values; it carries no information about whether the author drew lanes. The
 * remedy is to ask the question that does — `layoutFrom`, which decides on
 * occupancy and forces nothing: fewer than two columns, or only one populated
 * lane, and it falls through to the same `decomposeFrom` this branch reached
 * directly before. Nothing here reads a class, an id, a width, a filename or a
 * word.
 *
 * **Recurrence cannot apply** — the rule fires only where recurrence has already
 * been established absent. Cardinality and occupancy carry the proof instead.
 *
 * **Why it is a defect and not a preference.** `xtra_garcia_lorca` sets three
 * verse grids in one `[47% | spacer | 47%]` shape on one page. Two make the
 * classifier abstain, reach `layoutFrom` through the branch at the foot of
 * `dataRegionFrom`, and become the `::: columns` the reference writes. The third
 * scores DATA outright, is refused `too-small`, and was flattened — two poems
 * running together into one lane, which L3 reported as six `layout.overflow`
 * findings. Same geometry, same page, opposite outcome, decided by a score
 * margin that says nothing about lanes.
 *
 * **False friends, tested for non-firing.** A one-column strip has no second
 * lane and must stay flow. A one-row grid whose second cell is a spacer has no
 * second *populated* lane and must stay flow. A figure beside its caption is
 * claimed by the contract above, which runs first, and stays one figure.
 */
describe("a DATA grid too small to be a table is still asked whether it is a region", () => {
  async function laned(body: string): Promise<string> {
    return (
      await convert(Buffer.from(page(PROSE + body + PROSE), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;
  }

  /** The Лорка shape: two verse lanes with a spacer column between them. */
  const VERSE_PAIR =
    '<table border="0" width="74%"><tr>' +
    '<td width="47%" valign="top"><pre>Когда умру,\nСхороните меня с гитарой\nВ речном песке.</pre></td>' +
    '<td width="6%" valign="top">&nbsp;</td>' +
    '<td width="47%" valign="top"><pre>Когда умру,\nСтану флюгером я на крыше,\nНа ветру.</pre></td>' +
    "</tr></table>";

  it("keeps the two lanes the author drew instead of running them together", async () => {
    const out = await laned(VERSE_PAIR);
    expect(out).toContain("::: columns");
    expect(out).toContain("Схороните меня с гитарой");
    expect(out).toContain("Стану флюгером я на крыше,");
  });

  it("records the reconsideration rather than swallowing it", async () => {
    const result = await convert(Buffer.from(page(PROSE + VERSE_PAIR + PROSE), "utf8"), {
      profile: SPEC,
      layoutFidelity: "faithful",
      measurer: new InlineAlignMeasurer(),
    });
    const noted = result.ledger.some(
      (e) => e.terminal.kind === "REVIEW" && /too small to be a record matrix/u.test((e.terminal as { reason: string }).reason),
    );
    expect(noted).toBe(true);
  });

  it("leaves a one-column strip on the flow path — non-firing", async () => {
    const out = await laned(
      '<table border="0" width="300"><tr><td width="100%"><pre>Одна строка,\nвторая строка.</pre></td></tr></table>',
    );
    expect(out).not.toContain("::: columns");
    expect(out).toContain("вторая строка.");
  });

  it("leaves a lane with a spacer beside it on the flow path — non-firing", async () => {
    const out = await laned(
      '<table border="0" width="300"><tr>' +
        '<td width="94%"><pre>Одна строка,\nвторая строка.</pre></td>' +
        '<td width="6%">&nbsp;</td>' +
        "</tr></table>",
    );
    expect(out).not.toContain("::: columns");
    expect(out).toContain("вторая строка.");
  });

  it("loses no word on any of those paths", async () => {
    for (const body of [VERSE_PAIR, '<table border="0" width="300"><tr><td><pre>Одна\nдве</pre></td></tr></table>']) {
      const result = await convert(Buffer.from(page(PROSE + body + PROSE), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      });
      expect(result.conservation.targets.missing).toStrictEqual([]);
      expect(result.conservation.images.missing).toStrictEqual([]);
    }
  });
});

/**
 * A preformatted block is placed by the container the author put it in.
 *
 * **Invariant.** `alignedGroup` asks for weight because an unemphasised centred
 * paragraph in a lane is a caption rather than a label. A `<pre>` holds verbatim
 * text that can carry no emphasis at all, so it can never answer that question —
 * and its own content can express no placement either. The container's computed
 * alignment is the only statement available, and it is read as one. Geometry and
 * node type only; no class, id, width or word.
 *
 * **Recurrence cannot apply** — a credit line under a poem occurs once.
 *
 * **False friends, tested for non-firing.** A code block the author did *not*
 * set apart takes no wrapper, so a page that aligns nothing gains nothing. The
 * length cap that separates a bounded group from an article still applies, so a
 * whole right-set poem stays a block rather than becoming a label.
 */
describe("a code block keeps the placement its container declares", () => {
  async function aligned(body: string): Promise<string> {
    return (
      await convert(Buffer.from(page(PROSE + body + PROSE), "utf8"), {
        profile: SPEC,
        layoutFidelity: "faithful",
        measurer: new InlineAlignMeasurer(),
      })
    ).markdown;
  }

  /**
   * The corpus spells this `<div align="right">`; a browser computes
   * `text-align: right` from it, which is what the rule reads and what the
   * stand-in measurer above models. Both spellings sit on the element so the
   * fixture stays the era's markup without exercising the degraded path.
   */
  const RIGHT_CREDIT = '<div align="right" style="text-align: right"><pre>(перевод М. Цветаевой)</pre></div>';

  /** The Лорка shape: two lanes, the right one closing with a right-set credit. */
  const lanes = (credit: string): string =>
    '<table border="0" width="80%"><tr>' +
    '<td width="48%" valign="top"><pre>Начинается плач гитары,\nРазбивается чаша утра.</pre></td>' +
    '<td width="4%" valign="top">&nbsp;</td>' +
    `<td width="48%" valign="top"><pre>Так плачет закат о расвете,\nтак плачет стрела без цели.</pre>${credit}</td>` +
    "</tr></table>";

  it("keeps the right placement of a credit the source set apart", async () => {
    const out = await aligned(lanes(RIGHT_CREDIT));
    expect(out).toContain("position: right");
    expect(out).toContain("(перевод М. Цветаевой)");
  });

  it("wraps nothing when the source declares nothing — non-firing", async () => {
    const out = await aligned(lanes("<pre>(перевод М. Цветаевой)</pre>"));
    expect(out).toContain("(перевод М. Цветаевой)");
    expect(out).not.toContain("position: right");
  });

  it("loses neither the credit nor the verse on either path", async () => {
    for (const credit of [RIGHT_CREDIT, "<pre>(перевод М. Цветаевой)</pre>"]) {
      const out = await aligned(lanes(credit));
      expect(out).toContain("Разбивается чаша утра.");
      expect(out).toContain("так плачет стрела без цели.");
      expect(out).toContain("(перевод М. Цветаевой)");
    }
  });
});
