import { describe, expect, it } from "vitest";
import { parseHtml } from "./parse.js";
import { cellAt, columnCells, gridRegularity, materializeAllGrids, materializeGrid, rowCells } from "./grid.js";
import { findFirst, textOf } from "./types.js";
import { sanitizeS1 } from "./sanitize.js";
import { quarantineServerMarkup } from "./quarantine.js";

function gridOf(html: string) {
  const doc = parseHtml(html);
  const table = findFirst(doc.root, "table");
  if (!table) throw new Error("no table");
  return materializeGrid(table);
}

describe("materializeGrid", () => {
  it("lays out a plain rectangular table", () => {
    const grid = gridOf("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>");
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
    expect(grid.cells).toHaveLength(4);
    expect(cellAt(grid, 1, 0)?.text).toBe("c");
    expect(gridRegularity(grid)).toBe(1);
  });

  it("expands colspan without duplicating content", () => {
    const grid = gridOf('<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>');
    expect(grid.cols).toBe(2);
    // Both slots point at the same origin, but only one is the origin.
    expect(grid.slots[0]?.[0]?.originId).toBe(grid.slots[0]?.[1]?.originId);
    expect(grid.slots[0]?.[0]?.isOrigin).toBe(true);
    expect(grid.slots[0]?.[1]?.isOrigin).toBe(false);
    // The wide cell is one cell, listed once.
    expect(grid.cells.filter((c) => c.text === "wide")).toHaveLength(1);
    expect(rowCells(grid, 0).map((c) => c.text)).toEqual(["wide"]);
  });

  it("expands rowspan and keeps later rows correctly offset", () => {
    const grid = gridOf(
      '<table><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></table>',
    );
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
    // "c" must land in column 1, not column 0 — column 0 is covered.
    expect(cellAt(grid, 1, 0)?.text).toBe("tall");
    expect(cellAt(grid, 1, 1)?.text).toBe("c");
    expect(columnCells(grid, 0).map((c) => c.text)).toEqual(["tall"]);
  });

  it("treats rowspan=0 as spanning the remaining rows", () => {
    const grid = gridOf(
      '<table><tr><td rowspan="0">x</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>',
    );
    expect(cellAt(grid, 2, 0)?.text).toBe("x");
    expect(cellAt(grid, 2, 1)?.text).toBe("c");
  });

  it("clamps an absurd span and records the clamp", () => {
    const grid = gridOf('<table><tr><td colspan="999999">x</td></tr></table>');
    expect(grid.warnings.join(" ")).toMatch(/clamped/u);
    expect(grid.cols).toBeLessThanOrEqual(1000);
  });

  it("pads a ragged table with explicit holes", () => {
    const grid = gridOf("<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>");
    expect(grid.cols).toBe(3);
    expect(grid.slots[1]?.[1]).toBeNull();
    expect(grid.slots[1]?.[2]).toBeNull();
    expect(gridRegularity(grid)).toBeCloseTo(4 / 6, 5);
  });

  it("does not absorb the rows of a nested table", () => {
    const grid = gridOf(
      "<table><tr><td>outer<table><tr><td>inner1</td><td>inner2</td></tr></table></td><td>right</td></tr></table>",
    );
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(2);
    expect(grid.nestedTableIds).toHaveLength(1);
    expect(grid.cells[0]?.text).toContain("inner1");
  });

  it("survives an implied tbody and misnested rows", () => {
    // The tree builder inserts tbody and foster-parents stray content; the grid
    // must be computed from the repaired tree, not the source text.
    const grid = gridOf("<table><tbody><tr><td>a<tr><td>b</table>");
    expect(grid.rows).toBe(2);
    expect(grid.cells.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("marks header cells from th and from scope", () => {
    const grid = gridOf(
      '<table><tr><th>H1</th><td scope="col">H2</td></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    expect(grid.cells[0]?.isHeader).toBe(true);
    expect(grid.cells[1]?.isHeader).toBe(true);
    expect(grid.cells[2]?.isHeader).toBe(false);
  });

  it("recognises an empty cell regardless of nbsp padding", () => {
    const grid = gridOf("<table><tr><td>&nbsp;</td><td>x</td></tr></table>");
    // A non-breaking space is whitespace for this purpose.
    expect(grid.cells[0]?.text.replace(/ /gu, "").trim()).toBe("");
    expect(grid.cells[1]?.isEmpty).toBe(false);
  });

  it("captures a caption", () => {
    const grid = gridOf("<table><caption>Дискография</caption><tr><td>a</td></tr></table>");
    expect(grid.captionText).toBe("Дискография");
  });
});

describe("materializeAllGrids", () => {
  it("orders innermost tables first and records parentage", () => {
    const doc = parseHtml(
      "<table id=o><tr><td><table id=m><tr><td><table id=i><tr><td>x</td></tr></table></td></tr></table></td></tr></table>",
    );
    const grids = materializeAllGrids(doc.root);
    expect(grids).toHaveLength(3);
    // Deepest first.
    expect(grids[0]?.node.attrs["id"]).toBe("i");
    expect(grids[2]?.node.attrs["id"]).toBe("o");
    expect(grids[0]?.parentTableId).toBe(grids[1]?.id);
    expect(grids[2]?.parentTableId).toBeNull();
  });
});

describe("end-to-end front half on malformed legacy markup", () => {
  it("quarantines, parses and grids a broken windows-1251-era page", () => {
    const raw = [
      "<html><head><title>t</title>",
      '<script>document.write(topmenu());</script>',
      "</head><body>",
      '<table width="760" border="0"><tr>',
      '<td width="116"><img src="counter.rambler.ru/x.gif" width="1" height="1"></td>',
      '<td width="529"><font size="2">',
      "<p>Первый абзац",   // unclosed <p>
      "<p>Второй абзац",
      '<table border="1"><tr><th>Год</th><th>Альбом</th></tr>',
      "<tr><td>1958<td>Recital",  // unclosed cells
      "</table>",
      "</font></td>",
      '<td width="115"><?php include("rail.php"); ?></td>',
      "</tr></table></body></html>",
    ].join("\n");

    const quarantined = quarantineServerMarkup(raw);
    expect(quarantined.islands).toHaveLength(1);

    const doc = parseHtml(quarantined.text);
    const result = sanitizeS1(doc.root);

    // Behaviour is gone; layout attributes survive untouched.
    expect(result.removals.some((r) => r.tag === "script")).toBe(true);
    expect(result.removals.some((r) => r.reason.includes("tracking"))).toBe(true);
    const outer = findFirst(doc.root, "table");
    expect(outer?.attrs["width"]).toBe("760");

    const grids = materializeAllGrids(doc.root);
    expect(grids).toHaveLength(2);

    const inner = grids[0];
    if (!inner) throw new Error("expected inner grid");
    expect(inner.rows).toBe(2);
    expect(inner.cols).toBe(2);
    expect(inner.cells[0]?.isHeader).toBe(true);
    expect(rowCells(inner, 1).map((c) => c.text)).toEqual(["1958", "Recital"]);

    // Both paragraphs survive the unclosed tags.
    expect(textOf(doc.root)).toContain("Первый абзац");
    expect(textOf(doc.root)).toContain("Второй абзац");
    // The PHP island never reaches the tree as text.
    expect(textOf(doc.root)).not.toContain("include");
  });
});
