/**
 * Acceptance-check contracts.
 *
 * The point of these tests is the *plausible-but-wrong* reply. A malformed one
 * never reaches `accept` — a hook's schema stops it — so a test that feeds
 * `accept` garbage proves nothing about the property that matters. What matters
 * is that a well-formed, confident, entirely reasonable-looking verdict is
 * refused when this escalation site cannot support it.
 */
import { describe, expect, it } from "vitest";
import { TEXT_LIST, type TextListRequest } from "./decisions.js";
import { breakRunId } from "./lines.js";

function runOf(lines: string[], sourceName = "kiselev.htm"): TextListRequest {
  return { id: breakRunId(lines), lines, sourceName };
}

/** `kiselev`'s own volume list, shortened; the case the hook exists for. */
const VOLUMES = [
  "Том I Клубника со сливками (1984-1993)",
  "Том VII Ура! Каникулы! (2000)",
  "Том XII Почему ты не любишь джаз? (2004)",
  "Том XIX Сотворчество (2017)",
];

describe("TEXT_LIST.accept", () => {
  it("accepts an asserted LIST over a flat run of entries", () => {
    const verdict = TEXT_LIST.accept({ kind: "LIST", confidence: 0.95, rationale: "parallel volume titles" }, runOf(VOLUMES));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.value.confidence).toBe(0.95);
  });

  it("does not read an exclamation inside a title as a sentence boundary", () => {
    // The regression this test exists for: a shape test that called a line
    // holding two sentences "prose" refused `Том VII Ура! Каникулы! (2000)` and
    // with it the whole list the hook was written to recover.
    const verdict = TEXT_LIST.accept({ kind: "LIST", confidence: 0.9, rationale: "titles" }, runOf(VOLUMES));
    expect(verdict.ok).toBe(true);
  });

  for (const kind of ["PROSE", "VERSE", "UNCERTAIN"]) {
    it(`refuses a confident ${kind}, naming what the model said`, () => {
      const verdict = TEXT_LIST.accept({ kind, confidence: 1, rationale: "…" }, runOf(VOLUMES));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain(kind);
    });
  }

  it("refuses a LIST the model is not sure of", () => {
    // Not a formality: an uncertain restructuring is worse than none, and the
    // deterministic hard-break paragraph is already a correct rendering.
    const verdict = TEXT_LIST.accept({ kind: "LIST", confidence: 0.6, rationale: "maybe" }, runOf(VOLUMES));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("0.60");
  });

  it("refuses a LIST over a pair, however confident", () => {
    const pair = ["Jovan Jovicic", "Classical guitar"];
    const verdict = TEXT_LIST.accept({ kind: "LIST", confidence: 1, rationale: "two entries" }, runOf(pair));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("2 line(s)");
  });

  it("refuses a LIST when any line of the run is empty", () => {
    const verdict = TEXT_LIST.accept(
      { kind: "LIST", confidence: 1, rationale: "entries" },
      runOf(["Preludio", "   ", "Danza"]),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("empty");
  });

  it("refuses a reply whose id does not belong to the lines it would restructure", () => {
    // A decision is cached by content. A stale entry, or a request assembled by
    // hand, must not be applied to a different block — this is the one property
    // no upstream stage can establish.
    const stale: TextListRequest = { id: breakRunId(["something", "else", "entirely"]), lines: VOLUMES };
    const verdict = TEXT_LIST.accept({ kind: "LIST", confidence: 1, rationale: "entries" }, stale);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("does not belong");
  });

  it("refuses a kind it has no name for, and a reply with no kind at all", () => {
    expect(TEXT_LIST.accept({ kind: "TABLE", confidence: 1, rationale: "" }, runOf(VOLUMES)).ok).toBe(false);
    expect(TEXT_LIST.accept({ confidence: 1 }, runOf(VOLUMES)).ok).toBe(false);
  });

  it("keys an item by source and content, so one run is one question", () => {
    expect(TEXT_LIST.itemId(runOf(VOLUMES))).toBe(`kiselev.htm:${breakRunId(VOLUMES)}`);
    // The same run on two pages is the same question and shares one answer.
    expect(TEXT_LIST.itemId(runOf(VOLUMES, "a.htm"))).not.toBe(TEXT_LIST.itemId(runOf(VOLUMES, "b.htm")));
  });
});
