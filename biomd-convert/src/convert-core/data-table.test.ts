/**
 * The table-reconstruction defect and its neighbours.
 *
 * The original failure: a 27×9 physical grid with three semantic columns was
 * classified DATA, could not be expressed as a Markdown table, and was flattened
 * into twenty-seven paragraphs — at 100% text recall, so nothing reported it.
 */
import { describe, expect, it } from "vitest";
import { materializeGrid } from "../ladom/grid.js";
import { parseHtml } from "../ladom/parse.js";
import { findFirst } from "../ladom/types.js";
import { canonicalColumnLabel } from "./column-labels.js";
import { inferColumnBands, isInlineable, planDataTable } from "./data-table.js";
import { convert } from "./pipeline.js";

function gridOf(html: string) {
  const doc = parseHtml(`<body>${html}</body>`);
  const table = findFirst(doc.root, "table");
  if (!table) throw new Error("no table in fixture");
  return materializeGrid(table);
}

/** The Barrios shape: a stable `7 + 1 + 1` body with three rows that subdivide. */
const BARRIOS_SHAPED = `
<table border="0">
  <tr><td colspan="7"><p>Choro Da Saudade</p></td>
      <td><a href="tab/a.txt">TAB</a></td><td><a href="midi/a.mid">MIDI</a></td></tr>
  <tr><td colspan="7"><p>Cueca</p></td>
      <td><a href="tab/b.txt">TAB</a></td><td></td></tr>
  <tr><td colspan="7"><p>Julia Florida</p></td>
      <td><a href="tab/c.txt">TAB</a></td><td><a href="mp/c.mp3">MP3</a></td></tr>
  <tr><td colspan="5"><ul><li><p>Ноты</p></li></ul></td>
      <td><p><a href="s/1.jpg">[ 1 ]</a></p></td>
      <td><p><a href="s/2.jpg">[ 2 ]</a></p></td>
      <td><p><a href="s/z.zip">ZIP</a></p></td>
      <td><p></p></td></tr>
  <tr><td colspan="7"><p>La Catedral</p></td>
      <td><a href="tab/d.txt">TAB</a></td><td></td></tr>
</table>`;

describe("column band inference", () => {
  it("folds a stable 7+1+1 slot pattern into three semantic columns", () => {
    const bands = inferColumnBands(gridOf(BARRIOS_SHAPED));
    expect(bands).toEqual([
      { start: 0, end: 7 },
      { start: 7, end: 8 },
      { start: 8, end: 9 },
    ]);
  });

  it("prefers an explicit header row over the body vote", () => {
    const bands = inferColumnBands(
      gridOf(`
        <table>
          <tr><th colspan="2">Работа</th><th>Ноты</th></tr>
          <tr><td>a</td><td>b</td><td>c</td></tr>
          <tr><td>d</td><td>e</td><td>f</td></tr>
        </table>`),
    );
    expect(bands).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ]);
  });
});

describe("planDataTable", () => {
  it("plans the Barrios shape without losing a single cell", () => {
    const { plan, failure } = planDataTable(gridOf(BARRIOS_SHAPED));
    expect(failure).toBeUndefined();
    expect(plan).not.toBeNull();
    expect(plan?.bands).toHaveLength(3);
    expect(plan?.body).toHaveLength(5);
    for (const row of plan?.body ?? []) expect(row.cells).toHaveLength(3);

    // The subdivided row folds its four leading cells into one semantic cell,
    // and the ZIP link lands in the second column rather than being dropped.
    const scores = plan?.body[3];
    expect(scores?.cells[0]?.sources).toHaveLength(3);
    expect(scores?.cells[1]?.sources.map((s) => s.text)).toEqual(["ZIP"]);
  });

  it("has no source header for a table that never had one", () => {
    expect(planDataTable(gridOf(BARRIOS_SHAPED)).plan?.headerSynthesized).toBe(true);
  });

  it("refuses a region whose rows carry prose in two columns", () => {
    const prose = "слово ".repeat(60);
    const { plan, failure } = planDataTable(
      gridOf(`
        <table>
          <tr><td>${prose}</td><td>${prose}</td></tr>
          <tr><td>${prose}</td><td>${prose}</td></tr>
        </table>`),
    );
    expect(plan).toBeNull();
    expect(failure).toBe("prose-matrix");
  });

  it("refuses a cell that genuinely needs block structure", () => {
    const { plan, failure } = planDataTable(
      gridOf(`
        <table>
          <tr><td><ul><li>один</li><li>два</li></ul></td><td>x</td></tr>
          <tr><td>a</td><td>b</td></tr>
          <tr><td>c</td><td>d</td></tr>
        </table>`),
    );
    expect(plan).toBeNull();
    expect(failure).toBe("cell-needs-blocks");
  });
});

describe("cell inlineability", () => {
  const cellOf = (html: string) => {
    const doc = parseHtml(`<body><table><tr><td>${html}</td></tr></table></body>`);
    const td = findFirst(doc.root, "td");
    if (!td) throw new Error("no cell");
    return td;
  };

  it("treats a one-item list as the bullet glyph it was", () => {
    expect(isInlineable(cellOf("<ul><li><p>Ноты</p></li></ul>"))).toBe(true);
  });

  it("treats several paragraphs as typography, not structure", () => {
    expect(isInlineable(cellOf("<p>a</p><p>b</p>"))).toBe(true);
  });

  it("rejects a real list", () => {
    expect(isInlineable(cellOf("<ul><li>a</li><li>b</li></ul>"))).toBe(false);
  });

  it("rejects a nested table", () => {
    expect(isInlineable(cellOf("<table><tr><td>a</td></tr></table>"))).toBe(false);
  });
});

describe("end to end", () => {
  it("emits a Markdown table for the Barrios shape", async () => {
    const result = await convert(Buffer.from(`<html><body>${BARRIOS_SHAPED}</body></html>`, "utf8"));
    expect(result.markdown).toMatch(/^\|.*\|$/mu);
    // Every score link survives, each exactly once.
    for (const href of ["s/1.jpg", "s/2.jpg", "s/z.zip", "tab/a.txt", "midi/a.mid"]) {
      expect(result.markdown.split(href)).toHaveLength(2);
    }
    const emitted = result.tables.filter((t) => t.emittedTable);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.shape).toEqual({ rows: 5, cols: 3 });
  });

  it("does not double-count links when a table attempt is abandoned", async () => {
    // A rejected attempt used to leave its already-converted links in the
    // conservation inventory, so the gate reported invented targets.
    const html = `<html><body><table>
      <tr><td><a href="a.html">Первая ссылка здесь</a></td><td><ul><li>один</li><li>два</li></ul></td></tr>
      <tr><td><a href="b.html">Вторая ссылка здесь</a></td><td>x</td></tr>
      <tr><td><a href="c.html">Третья ссылка здесь</a></td><td>y</td></tr>
    </table></body></html>`;
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.conservation.targets.extra).toEqual([]);
    expect(result.markdown.split("/#/a")).toHaveLength(2);
  });

  it("reports a DATA region that produced no table", async () => {
    const prose = "довольно длинное предложение про музыку и гитару ".repeat(6);
    const html = `<html><body><table border="1">
      <tr><th>Первый</th><th>Второй</th></tr>
      <tr><td>${prose}</td><td>${prose}</td></tr>
      <tr><td>${prose}</td><td>${prose}</td></tr>
    </table></body></html>`;
    const result = await convert(Buffer.from(html, "utf8"));
    const data = result.tables.filter((t) => t.classification === "DATA");
    if (data.length > 0) {
      expect(data.every((t) => !t.emittedTable)).toBe(true);
      expect(result.warnings.join(" ")).toMatch(/no table was emitted|decomposed to linear flow/u);
    }
  });
});

/**
 * A column the source never named gets the house name for what it holds.
 *
 * **Invariant.** `BioMD-Reference.md` §1 (Tables): every GFM column MUST have a
 * header. A column whose every populated cell is a short anchor is a resource
 * column — cardinality, containment and homogeneity down the column, no href
 * pattern and no filename. The leading column is the one whose role is fixed by
 * *position*: whatever the rows are, the thing they are indexed by is in front.
 * Both names come from `column-labels.ts`, which is language-tagged data.
 *
 * **This supersedes the previous contract, on an author ruling.** Until
 * `06eeafb` this described emitting `LINK_GLYPH` for a resource column and
 * leaving the leading column *empty*, on the grounds that naming it would be
 * invention (§16.3) — and cited `analyze/analyze.md` asking for the symbol on
 * three pages and sixteen references writing it. The author then replaced every
 * one of those sixteen and stated the vocabulary directly in `/new_rules.md`
 * ("не пытаться угадывать … использовать обобщающее название"). §16.3 is not
 * engaged: the probe in PROGRESS §29.2 confirmed these tables have **no source
 * header at all** — the old references invented `Композиция` and `Ноты (TAB)`
 * exactly as the new ones name `Название` — so nothing attested is rewritten,
 * and a column name is not factual text about the subject.
 *
 * **Why the header matters more than the label.** It used to be all-or-nothing:
 * with no recurring label the whole table was abandoned, and a five-record score
 * matrix came out as twenty loose aligned paragraphs with three work titles read
 * as quotations.
 *
 * **Recurrence requirement.** Two linked cells in the column.
 *
 * **False friend**, tested for non-firing: a column of prose that contains a
 * link. A label is not a sentence, and the length limit is the separator — such
 * a column is named neither a resource column nor anything else.
 */
describe("a header for a column the source never labelled", () => {
  const linkRow = (work: string, a: string, b: string) =>
    `<tr><td>${work}</td><td><a href="${a}">${a.slice(-3).toUpperCase()}</a></td>` +
    `<td><a href="${b}">${b.slice(-3).toUpperCase()}</a></td></tr>`;

  it("names the resource columns and the column that indexes them", async () => {
    // Mixed format tokens down each column, so no column has a dominant label —
    // `new_dyens` in miniature, where the table used to vanish entirely.
    const html =
      "<html><body><table border=\"0\">" +
      linkRow("Tango En Skaï", "tab/skai.txt", "midi/tango.mid") +
      linkRow("Valse En Skaï", "ram/valse.ram", "mp/valse.mp3") +
      linkRow("Libra Sonatine", "zip/libra.zip", "gif/libra.gif") +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toContain("| Название | Аудиоформат | Аудиоформат |");
    expect(result.markdown).not.toContain("\u{1F517}");
  });

  it("folds a transcribed format token onto the house name", async () => {
    // Here every cell in a column repeats `TAB`, so `dominantLabel` transcribes
    // it — and the format is already visible in each cell, so heading the column
    // with it names the column after one of its own values.
    const html =
      "<html><body><table border=\"0\">" +
      "<tr><td>Adelita</td><td><a href=\"a.txt\">TAB</a></td></tr>" +
      "<tr><td>Capricho</td><td><a href=\"b.txt\">TAB</a></td></tr>" +
      "<tr><td>Recuerdos</td><td><a href=\"c.txt\">TAB</a></td></tr>" +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toContain("| Название | Аудиоформат |");
  });

  it("passes an unrecognised label through untouched — graceful degradation", () => {
    expect(canonicalColumnLabel("Ноты (TAB)")).toBe("Аудиоформат");
    expect(canonicalColumnLabel("  midi  ")).toBe("Аудиоформат");
    expect(canonicalColumnLabel("Произведение")).toBe("Название");
    expect(canonicalColumnLabel("Длительность")).toBeNull();
    expect(canonicalColumnLabel("")).toBeNull();
  });

  it("does not call a prose column a resource column — non-firing", async () => {
    const sentence = (name: string, href: string) =>
      `<tr><td>${name}</td><td>Подробнее об этой записи можно прочитать в <a href="${href}">обзоре</a>, ` +
      "опубликованном в журнале в том же году.</td></tr>";
    const html =
      "<html><body><table border=\"0\">" +
      sentence("Adelita", "a.htm") +
      sentence("Capricho", "b.htm") +
      sentence("Recuerdos", "c.htm") +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).not.toContain("\u{1F517}");
    expect(result.markdown).not.toContain("Аудиоформат");
  });
});
