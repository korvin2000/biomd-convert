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
