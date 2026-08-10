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
 * A column of links is headed with the link symbol; nothing else is named.
 *
 * **Invariant.** `BioMD-Reference.md` §1 (Tables): every GFM column MUST have a
 * header. A column whose every populated cell is a short anchor holds links —
 * containment (the link *is* the cell, not a phrase inside it) and homogeneity
 * down the column, with no href pattern and no filename anywhere in the test.
 * `LINK_GLYPH` asserts only what the cells already assert by containing links.
 * Every other unnamed column is left empty and raises the review item.
 *
 * **This reverses PROGRESS §30.2, which had itself reversed the contract before
 * it.** The sequence is worth keeping, because the file has now been rewritten
 * in both directions and the next session will otherwise re-derive it:
 *
 * | ruling | resource column | leading column |
 * |---|---|---|
 * | pre-`06eeafb` references (16) + `analyze.md` ×3 | `🔗` | empty |
 * | `06eeafb` references (16) + `/new_rules.md` | `Аудиоформат` | `Название` |
 * | `c92c009` references (16) + `analyze-2.md` ×2 | `🔗` | empty |
 *
 * The current ruling states its own reason — *"что бы не включать эвристику и
 * не определять"* — and names the failure that prompted it: the house
 * vocabulary was reached through `dominantLabel`, which transcribes what a
 * column repeats, so a column of mixed `WMA` and `MIDI` links got named after
 * whichever format happened to dominate. The glyph is therefore checked
 * **before** transcription, not after it. §16.3 is not engaged in either
 * direction: PROGRESS §29.2 established that these tables have no source header
 * at all, so no attested text is being rewritten.
 *
 * **Why the header matters more than the label.** It used to be all-or-nothing:
 * with no recurring label the whole table was abandoned, and a five-record score
 * matrix came out as twenty loose aligned paragraphs with three work titles read
 * as quotations.
 *
 * **Recurrence does not apply** — see `isLinkColumn`. Homogeneity is exhaustive
 * here, so a one-link column is a sparsely populated column, not a stray.
 *
 * **False friend**, tested for non-firing: a column of prose that contains a
 * link. A label is not a sentence, and the length limit is the separator — such
 * a column is named neither a link column nor anything else.
 */
describe("a header for a column the source never labelled", () => {
  const linkRow = (work: string, a: string, b: string) =>
    `<tr><td>${work}</td><td><a href="${a}">${a.slice(-3).toUpperCase()}</a></td>` +
    `<td><a href="${b}">${b.slice(-3).toUpperCase()}</a></td></tr>`;

  it("marks the link columns and leaves the column that indexes them empty", async () => {
    // Mixed format tokens down each column, so no column has a dominant label —
    // `new_dyens` in miniature, where the table used to vanish entirely.
    const html =
      "<html><body><table border=\"0\">" +
      linkRow("Tango En Skaï", "tab/skai.txt", "midi/tango.mid") +
      linkRow("Valse En Skaï", "ram/valse.ram", "mp/valse.mp3") +
      linkRow("Libra Sonatine", "zip/libra.zip", "gif/libra.gif") +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toContain("| | \u{1F517} | \u{1F517} |");
    expect(result.markdown).not.toContain("Аудиоформат");
    expect(result.markdown).not.toContain("Название");
  });

  it("prefers the glyph to a format token the column happens to repeat", async () => {
    // Every cell in the column repeats `TAB`, so `dominantLabel` would transcribe
    // it — and the format is already visible in each cell, so heading the column
    // with it names the column after one of its own values. This is the case the
    // author's second sentence is about.
    const html =
      "<html><body><table border=\"0\">" +
      "<tr><td>Adelita</td><td><a href=\"a.txt\">TAB</a></td></tr>" +
      "<tr><td>Capricho</td><td><a href=\"b.txt\">TAB</a></td></tr>" +
      "<tr><td>Recuerdos</td><td><a href=\"c.txt\">TAB</a></td></tr>" +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toContain("| | \u{1F517} |");
    expect(result.markdown).not.toContain("| TAB |\n");
  });

  it("names a column populated once — recurrence would un-name it", async () => {
    // `new_karta`'s "Алаис" table: two records, one of which has no resources.
    const html =
      "<html><body><table border=\"0\">" +
      "<tr><td>La Regalona (Habanera)</td><td></td><td></td></tr>" +
      "<tr><td>Ноты</td><td><a href=\"a.jpg\">JPG</a></td><td><a href=\"b.mid\">MIDI</a></td></tr>" +
      "</table></body></html>";
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toContain("| | \u{1F517} | \u{1F517} |");
  });

  it("passes an unrecognised label through untouched — graceful degradation", () => {
    expect(canonicalColumnLabel("Ноты (TAB)")).toBe("Аудиоформат");
    expect(canonicalColumnLabel("  midi  ")).toBe("Аудиоформат");
    expect(canonicalColumnLabel("Произведение")).toBe("Название");
    expect(canonicalColumnLabel("Длительность")).toBeNull();
    expect(canonicalColumnLabel("")).toBeNull();
  });

  it("does not call a prose column a link column — non-firing", async () => {
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
