/**
 * Contract for the one declared exception in the measurement path.
 *
 * `reference-silent.ts` lets an instrument ignore a construct the reference tier
 * predates. That is exactly the shape of change `CLAUDE.md`'s metric-integrity
 * invariant exists to catch, so the exception has to prove three things and is
 * useless without them:
 *
 *  1. it is **symmetric** — never applied to one side only;
 *  2. it is **narrow** — it hides an absence, never a disagreement;
 *  3. it **retires itself** — the first reference to use the construct turns
 *     full adjudication back on, with nothing to remember or undo.
 */
import { describe, expect, it } from "vitest";
import { readBlocks } from "./blocks.js";
import {
  REFERENCE_SILENT_DIRECTIVES,
  dropDirectives,
  foldSilentDirectives,
  foldSilentHighlights,
  highlightSilentIn,
  silentIn,
} from "./reference-silent.js";
import { diffDocuments } from "./structdiff.js";
import { scoreDocuments } from "./score.js";

const REFERENCE = "# Гойя\n\n[Bahia Lady](#20)\n\nАльбом.\n";
const PRODUCED = "# Гойя\n\n[Bahia Lady](#20)\n\n::anchor{#20}\n\nАльбом.\n";

describe("what counts as silent", () => {
  it("names anchors and nothing else", () => {
    expect(REFERENCE_SILENT_DIRECTIVES).toEqual(["anchor"]);
  });

  it("a reference with no anchor is silent about them", () => {
    expect([...silentIn(readBlocks(REFERENCE).blocks)]).toEqual(["anchor"]);
  });

  it("one anchor anywhere makes the reference an authority", () => {
    const withOne = "# Гойя\n\n::: columns\n\n::: column\n\n::anchor{#20}\n\nАльбом.\n\n:::\n\n::: column\n\nx\n\n:::\n\n:::\n";
    expect([...silentIn(readBlocks(withOne).blocks)]).toEqual([]);
  });
});

describe("L2 — structural adjudication", () => {
  it("reports nothing for a marker the reference never had", () => {
    expect(diffDocuments("goya2", PRODUCED, REFERENCE).findings).toEqual([]);
  });

  it("still reports every other difference in the same document", () => {
    const changed = PRODUCED.replace("Альбом.", "Совершенно другой текст.");
    expect(diffDocuments("goya2", changed, REFERENCE).findings.length).toBeGreaterThan(0);
  });

  it("adjudicates anchors normally once the reference declares one", () => {
    const referenceWithAnchor = "# Гойя\n\n[Bahia Lady](#20)\n\n::anchor{#20}\n\nАльбом.\n";
    // Same document on both sides: identity must hold with anchors present.
    expect(diffDocuments("goya2", referenceWithAnchor, referenceWithAnchor).findings).toEqual([]);
    // A missing marker is now a finding, because the reference has an opinion.
    const withoutMarker = referenceWithAnchor.replace("::anchor{#20}\n\n", "");
    expect(diffDocuments("goya2", withoutMarker, referenceWithAnchor).findings.length).toBeGreaterThan(0);
  });

  it("drops markers at any depth, and leaves the blocks around them", () => {
    const nested = readBlocks("::: column\n\n::anchor{#1}\n\nтекст\n\n:::\n").blocks;
    const stripped = dropDirectives(nested, new Set(["anchor"]));
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.kind).toBe("directive");
    if (stripped[0]?.kind === "directive") {
      expect(stripped[0].children).toHaveLength(1);
      expect(stripped[0].children[0]?.kind).toBe("paragraph");
    }
  });
});

describe("L1 — the scalar tripwire", () => {
  it("costs a document nothing for markers the reference never had", () => {
    const withMarkers = scoreDocuments("goya2", REFERENCE, PRODUCED);
    const without = scoreDocuments("goya2", REFERENCE, REFERENCE);
    expect(withMarkers.directives.f1).toBe(without.directives.f1);
    expect(withMarkers.overall).toBe(without.overall);
  });

  it("applies to both sides or to neither", () => {
    // Symmetry is the property that makes this a fold and not a thumb on the
    // scale: with the construct on both sides it is compared, and a count
    // mismatch is visible again.
    const bothSides = foldSilentDirectives(new Map([["anchor", 2]]), new Map([["anchor", 1]]));
    expect(bothSides).toEqual({ expected: ["anchor", "anchor"], actual: ["anchor"] });

    const referenceSilent = foldSilentDirectives(new Map(), new Map([["anchor", 3]]));
    expect(referenceSilent).toEqual({ expected: [], actual: [] });
  });

  it("never hides a directive it was not asked to hide", () => {
    const folded = foldSilentDirectives(new Map([["align", 1]]), new Map([["align", 1], ["nav", 1]]));
    expect(folded.expected).toEqual(["align"]);
    expect(folded.actual).toEqual(["align", "nav"]);
  });
});

/**
 * The same three properties, for the one *inline* construct the policy covers.
 *
 * `==highlight==` was added when the converter began marking the distinctions
 * the source draws inline. Three references use it — `jovicic`,
 * `new_blackmore`, `new_rechin4` — and are adjudicated in full; the rest have
 * never written one, and `new_rules.md` states in the author's own words that
 * their silence is not a disagreement: *"Если в reference файлах текст в
 * кавычках не выделен `==`, считать что он выделен, игнорировать такие
 * различия"*.
 */
describe("an inline construct the reference tier predates", () => {
  const REF = "# Гойя\n\nОн сказал: \"это было давно\", и мы поверили ему.\n";
  const OUT = "# Гойя\n\nОн сказал: ==\"это было давно\"==, и мы поверили ему.\n";

  it("folds both sides when the reference has never written one", () => {
    const folded = foldSilentHighlights(OUT, REF);
    expect(folded.produced).toBe(REF);
    expect(folded.reference).toBe(REF);
    expect(diffDocuments("goya2", OUT, REF).findings).toEqual([]);
  });

  it("one highlight anywhere makes the reference an authority", () => {
    const speaks = "# Гойя\n\nОн сказал: ==\"это было давно\"==, и мы поверили ему.\n\n==иное==\n";
    expect(highlightSilentIn(speaks)).toBe(false);
    expect(foldSilentHighlights(OUT, speaks).produced).toBe(OUT);
  });

  it("still reports a disagreement about which run is marked", () => {
    // Both sides speak, and they mark different text. The fold is off and the
    // difference survives — this is the property that separates hiding an
    // absence from hiding a disagreement.
    const theirs = "# Гойя\n\nОн ==сказал==: \"это было давно\", и мы поверили ему.\n";
    expect(diffDocuments("goya2", OUT, theirs).findings.length).toBeGreaterThan(0);
  });

  it("never touches a lone `=` or a table rule", () => {
    const rule = "# Гойя\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nE = mc2\n";
    expect(foldSilentHighlights(rule, "# Гойя\n").produced).toBe(rule);
  });
});
