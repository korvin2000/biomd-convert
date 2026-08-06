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
import { laneColumnsOf } from "./structure.js";

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

describe("an empty column is legal — every other bounded directive is not", () => {
  it("builds a column with no children", () => {
    // The track position is the content. `goya2`'s reference emits five of these
    // and validates with zero errors, so the builder was stricter than both the
    // spec and the target renderer.
    expect(() => makeColumn([])).not.toThrow();
    expect(makeColumn([])).toEqual({ type: "biomdColumn", children: [] });
  });
});
