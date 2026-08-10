/**
 * Contracts for lane detection and for the one directive that may be empty.
 *
 * Both exist for the same defect: a grid column that is *usually* populated and
 * a column that is *never* populated look identical in any single row, and they
 * want opposite treatment. Getting it wrong drops five `goya2` albums out of the
 * two-lane region their thirty siblings sit in.
 */
import { describe, expect, it } from "vitest";
import type { TableGrid } from "../ladom/grid.js";
import { makeColumn } from "../biomd-ast/index.js";
import { laneColumnsOf, pageRailColumns, rowBandsOf } from "./structure.js";

/**
 * A grid from an occupancy map: `"XX"` is a row with both cells populated,
 * `"X."` a row whose second cell is empty.
 *
 * Only the fields `laneColumnsOf` reads are populated — the rest of `TableGrid`
 * is irrelevant to the question and faking it would only invite the test to
 * depend on things the rule does not.
 */
function gridOf(rows: readonly string[]): TableGrid {
  const cols = rows[0]?.length ?? 0;
  const cells = rows.flatMap((row, r) =>
    [...row].map((ch, c) => ({ id: `${r}:${c}`, isEmpty: ch !== "X" })),
  );
  const slots = rows.map((row, r) => [...row].map((_, c) => ({ isOrigin: true, originId: `${r}:${c}` })));
  return { rows: rows.length, cols, slots, cells } as unknown as TableGrid;
}

describe("lane detection", () => {
  it("keeps a lane that is usually populated but sometimes empty", () => {
    // `goya2` measured: 34 rows in column 0, 30 in column 1. Five albums have no
    // cover art, and the right track is still a track.
    const lanes = laneColumnsOf(gridOf(["XX", "XX", "XX", "XX", "X."]));
    expect([...lanes].sort()).toEqual([0, 1]);
  });

  it("rejects a spacer column that is never populated", () => {
    // `news` measured: 36 rows in column 0, 0 in column 1. Treating that as a
    // lane wraps every entry of a one-lane archive in a two-track region.
    const lanes = laneColumnsOf(gridOf(["X.", "X.", "X.", "X.", "X."]));
    expect([...lanes]).toEqual([0]);
  });

  it("rejects a stray cell — the false friend", () => {
    // `barrios` has a nine-column grid with four columns carrying content once.
    // A column that fires once is a stray cell, not a track, and admitting it
    // would pull an empty column into every row of the grid.
    const lanes = laneColumnsOf(gridOf(["XXX", "X..", "X..", "X..", "X.."]));
    expect([...lanes]).toEqual([0]);
  });

  it("judges relative to the busiest column, not against a fixed fraction", () => {
    // A grid that is mostly empty still has lanes: what matters is how the
    // columns compare with each other, not how full the grid is overall.
    const sparse = laneColumnsOf(gridOf(["XX", "..", "..", "..", "XX"]));
    expect([...sparse].sort()).toEqual([0, 1]);
  });
});

/**
 * Occupancy is whatever the caller is going to build the region out of.
 *
 * **Invariant.** A column is a lane when it carries content in a substantial
 * share of the rows *of the content the region will be assembled from*. No
 * width, no position, no threshold on the page: the same relative-occupancy
 * test, applied to the right input.
 *
 * **Why it is a separate question.** The source cell and the lowered cell
 * disagree exactly once, and it matters every time: a cell holding nothing but
 * a side menu is source-occupied and lane-empty, because `layoutFrom` folds a
 * `nav` out of the lane and emits it after the region. Reading occupancy off
 * the source then claimed a lane the assembly had already emptied — and on the
 * site's own page frame that phantom was the second column keeping a one-lane
 * region alive.
 *
 * **False friend**, tested for non-firing: `goya2`'s five coverless albums. A
 * lane that is empty in *some* rows is still a lane, whichever input is used to
 * measure it — the distinction is "empty here" versus "empty everywhere", and
 * collapsing the two shifts thirty catalog rows out of alignment.
 */
describe("lane occupancy is measured on what the region is built from", () => {
  it("drops a column whose content all leaves the lane", () => {
    // The page frame: `[margin | article | menu rail]`. All three cells carry
    // source content, but the rail's is a menu and menus fold into the flow, so
    // after lowering the rail contributes nothing to any row.
    const grid = gridOf(["XXX"]);
    expect([...laneColumnsOf(grid)].sort()).toEqual([0, 1, 2]);
    const lowered = laneColumnsOf(grid, (_r, c) => c === 1);
    expect([...lowered]).toEqual([1]);
  });

  it("keeps a lane that lowers to nothing in one row but not in another", () => {
    // The false friend. Column 1 is empty in the last row only; that is a
    // coverless album, not a rail, and its place in the region is the content.
    const lanes = laneColumnsOf(gridOf(["XX", "XX", "XX", "XX", "XX"]), (r, c) => !(c === 1 && r === 4));
    expect([...lanes].sort()).toEqual([0, 1]);
  });

  it("still reads the source cell when no predicate is supplied", () => {
    // The default has to stay the source grid: callers that have not lowered
    // anything yet are asking about the shape the author drew.
    expect([...laneColumnsOf(gridOf(["X.", "X.", "X."]))].sort()).toEqual([0]);
  });
});

/**
 * A grid whose cells may span rows: `"A"` spans two rows, `"X"` one, `"."` is
 * a covered slot with no cell of its own.
 */
function spanGridOf(rows: readonly string[]): TableGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: Array<{ id: string; isEmpty: boolean; rowSpan: number }> = [];
  const slots = rows.map((row) => [...row].map(() => null as { isOrigin: boolean; originId: string } | null));
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === ".") return;
      const id = `${r}:${c}`;
      const rowSpan = ch === "A" ? 2 : 1;
      cells.push({ id, isEmpty: false, rowSpan });
      for (let dr = 0; dr < rowSpan && r + dr < rows.length; dr += 1) {
        slots[r + dr]![c] = { isOrigin: dr === 0, originId: id };
      }
    }),
  );
  return { rows: rows.length, cols, slots, cells } as unknown as TableGrid;
}

/**
 * See `rowBandsOf`'s own contract for the invariant. These pin the two
 * behaviours the region loop depends on: identity where nothing spans, and one
 * band where something does.
 */
describe("a rowspan holds its rows together", () => {
  it("leaves every row its own band when nothing spans — the false friend", () => {
    // `goya2`'s commonest shape and 21 of the 22 documents: a title row above a
    // track row *look* paired and are not, so each keeps the `---` its own row
    // boundary earns.
    expect(rowBandsOf(spanGridOf(["XX", "XX", "XX"]))).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });

  it("joins the row a span reaches into", () => {
    // "Moscow Nights": a `rowspan="2"` track list beside a cover, and a second
    // row carrying only the second cover. One band, so both covers land in the
    // same lane instead of the second falling out of the region entirely.
    expect(rowBandsOf(spanGridOf(["XX", "AX", ".X", "XX"]))).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 2 },
      { start: 3, end: 3 },
    ]);
  });

  it("does not let a span run off the end of the grid", () => {
    // A `rowspan` that overshoots the last row is ordinary in 1998 markup; the
    // band still has to name a row that exists.
    expect(rowBandsOf(spanGridOf(["XX", "AX"]))).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
    ]);
  });
});

describe("an empty column is legal — every other bounded directive is not", () => {
  it("builds a column with no children", () => {
    // The track position is the content. `goya2`'s reference emits five of these
    // and validates with zero errors, so the builder was stricter than both the
    // spec and the target renderer.
    expect(() => makeColumn([])).not.toThrow();
    expect(makeColumn([])).toEqual({ type: "biomdColumn", children: [] });
  });
});

/**
 * The page frame's side rails.
 *
 * **Invariant.** Geometry *and* position: the middle column is the widest and
 * both outer columns are far narrower. That is `CLAUDE.md` §5's "content is the
 * centre column, right-hand menus fold into the main flow", stated as
 * measurement rather than as a guess about what the rails contain — measured
 * identical on all 22 corpus documents at `[116, 529, 115]` in a 760 px row,
 * holding a menu on one page, an off-site credit badge on another, and nothing
 * at all on twenty.
 *
 * **False friend**, tested for non-firing below: a real three-lane region, and a
 * lane pair where one lane simply happens to be narrow. The second is why the
 * rule reads position and not width alone — `new_blackmore`'s reference lanes
 * measure 29/71 with the *text* in the narrow one, so a plain "narrow flank"
 * test would have flattened the three regions its `column.missing` findings are
 * still open on.
 */
describe("page rails are not lanes", () => {
  /** A one-row grid from measured column widths. */
  function widthGrid(widths: readonly number[]): TableGrid {
    const cells = widths.map((w, c) => ({ id: `0:${c}`, isEmpty: false, node: { box: { x: 0, y: 0, w, h: 10 } } }));
    const slots = [widths.map((_, c) => ({ isOrigin: true, originId: `0:${c}` }))];
    return { rows: 1, cols: widths.length, slots, cells } as unknown as TableGrid;
  }

  it("finds both rails of the site's page frame", () => {
    expect([...pageRailColumns(widthGrid([116, 529, 115]))].sort()).toEqual([0, 2]);
    expect([...pageRailColumns(widthGrid([64, 458, 115]))].sort()).toEqual([0, 2]);
  });

  it("leaves a three-lane region alone — the widest column is not the middle", () => {
    // Every non-frame multi-column grid measured in the corpus.
    for (const widths of [
      [298, 28, 28],
      [360, 45, 45],
      [360, 40, 49],
      [400, 49, 49],
    ]) {
      expect([...pageRailColumns(widthGrid(widths))], widths.join("/")).toEqual([]);
    }
  });

  it("leaves equal thirds alone", () => {
    expect([...pageRailColumns(widthGrid([357, 357, 357]))]).toEqual([]);
  });

  it("leaves a narrow lane beside a wide one alone — the measured false friend", () => {
    // `new_blackmore`'s figure regions, and `kiselev`'s and `barrios`'s cards.
    for (const widths of [
      [63, 296],
      [250, 132],
      [176, 300],
    ]) {
      expect([...pageRailColumns(widthGrid(widths))], widths.join("/")).toEqual([]);
    }
  });

  it("needs both sides — one rail is a lane pair, not a frame", () => {
    // Content on the left with a narrow strip after it is the shape of a card,
    // not of a page frame; a frame is the thing the content sits *inside*.
    expect([...pageRailColumns(widthGrid([529, 116, 115]))]).toEqual([]);
    expect([...pageRailColumns(widthGrid([116, 115, 529]))]).toEqual([]);
  });

  it("says nothing without measurement", () => {
    const unmeasured = { rows: 1, cols: 3, slots: [[0, 1, 2].map((c) => ({ isOrigin: true, originId: `0:${c}` }))], cells: [0, 1, 2].map((c) => ({ id: `0:${c}`, isEmpty: false, node: {} })) } as unknown as TableGrid;
    expect([...pageRailColumns(unmeasured)]).toEqual([]);
  });
});
