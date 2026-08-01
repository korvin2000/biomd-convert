import { describe, expect, it } from "vitest";
import { Lexicon } from "./lexicon.js";
import { NULL_ORACLE, decideHyphen, dehyphenateText, type HyphenationOracle } from "./dehyphenate.js";

function lexiconOf(...texts: string[]): Lexicon {
  const lex = new Lexicon();
  for (const t of texts) lex.add(t);
  return lex;
}

/** Stands in for Hyphenopoly: `музыкант` breaks as `му-зы-кант`. */
const FAKE_ORACLE: HyphenationOracle = {
  available: true,
  isLegalBreak(word, index) {
    const points: Record<string, number[]> = {
      музыкант: [2, 4],
      композитор: [3, 5, 7],
      гитарист: [3, 5],
      изза: [],
    };
    return (points[word.toLowerCase()] ?? []).includes(index);
  },
};

describe("decideHyphen cascade", () => {
  it("rule 1: joins on a soft hyphen unconditionally", () => {
    const d = decideHyphen(
      { left: "музы", right: "кант", hyphen: "­" },
      { lexicon: lexiconOf() },
    );
    expect(d).toMatchObject({ verdict: "JOIN", rule: 1, joined: "музыкант" });
  });

  it("rule 2: preserves a mid-line hyphen, whatever the lexicon says", () => {
    // Geometry outranks the lexicon: a hyphen that is not at the line edge was
    // not produced by wrapping, so it is lexical by construction.
    const lex = lexiconOf("изза изза изза");
    const d = decideHyphen({ left: "из", right: "за", hyphen: "-", atLineEdge: false }, { lexicon: lex });
    expect(d).toMatchObject({ verdict: "PRESERVE", rule: 2 });
  });

  it("rule 4: joins when the corpus attests the joined form", () => {
    const lex = lexiconOf("музыкант музыкант выдающийся музыкант");
    const d = decideHyphen({ left: "музы", right: "кант", hyphen: "-", atLineEdge: true }, { lexicon: lex });
    expect(d).toMatchObject({ verdict: "JOIN", rule: 4, joined: "музыкант" });
    expect(d.confidence).toBeGreaterThan(0.85);
  });

  it("rule 5: preserves when only the hyphenated form is attested", () => {
    const lex = lexiconOf("из-за из-за плохой погоды");
    const d = decideHyphen({ left: "из", right: "за", hyphen: "-", atLineEdge: true }, { lexicon: lex });
    expect(d).toMatchObject({ verdict: "PRESERVE", rule: 5 });
  });

  it("rule 3: preserves a compound proper noun", () => {
    const d = decideHyphen(
      { left: "Римский", right: "Корсаков", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf() },
    );
    expect(d).toMatchObject({ verdict: "PRESERVE", rule: 3 });
  });

  it("rule 6: joins when the break is legal and a dictionary confirms the word", () => {
    const d = decideHyphen(
      { left: "му", right: "зыкант", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: FAKE_ORACLE, dictionary: (w) => w === "музыкант" },
    );
    expect(d).toMatchObject({ verdict: "JOIN", rule: 6 });
  });

  it("rule 6: a legal break with an unattested word goes to review, not to a join", () => {
    const d = decideHyphen(
      { left: "му", right: "зыкант", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: FAKE_ORACLE },
    );
    expect(d).toMatchObject({ verdict: "REVIEW", rule: 6 });
  });

  it("rule 6: an illegal break point is not joined", () => {
    // `музыкант` cannot break after `музык`, so this is not a wrap artifact.
    const d = decideHyphen(
      { left: "музык", right: "ант", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: FAKE_ORACLE, dictionary: () => true },
    );
    expect(d.verdict).not.toBe("JOIN");
  });

  it("rule 7: preserves and flags when nothing is decisive", () => {
    const d = decideHyphen(
      { left: "неиз", right: "вестное", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE },
    );
    expect(d).toMatchObject({ verdict: "REVIEW", rule: 7 });
  });

  it("title case outranks corpus frequency, guarding a polluted lexicon", () => {
    // The lexicon wrongly attests the joined form — an earlier bad join, or a
    // page that dropped the hyphen. Structural evidence must win.
    const lex = lexiconOf("римскийкорсаков римскийкорсаков");
    const d = decideHyphen(
      { left: "Римский", right: "Корсаков", hyphen: "-", atLineEdge: true },
      { lexicon: lex },
    );
    expect(d).toMatchObject({ verdict: "PRESERVE", rule: 3 });
  });

  it("but an ALL-CAPS heading still wraps normally", () => {
    // Both fragments are "capitalized", yet this is one word broken across a
    // line in an all-caps run — preserving the hyphen would corrupt the heading.
    const lex = lexiconOf("МУЗЫКАНТ музыкант");
    const d = decideHyphen(
      { left: "МУЗЫ", right: "КАНТ", hyphen: "-", atLineEdge: true },
      { lexicon: lex },
    );
    expect(d.verdict).toBe("JOIN");
    expect(d.rule).toBe(4);
  });
});

describe("dehyphenateText", () => {
  const lex = lexiconOf(
    "выдающийся музыкант и композитор музыкант композитор гитарист",
    "из-за из-за где-нибудь кто-то",
  );

  it("joins a wrapped word and removes the line break", () => {
    const src = "Он был выдающийся музы-\nкант и композитор.";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.text).toBe("Он был выдающийся музыкант и композитор.");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: "join-hyphenated-word", status: "accepted" });
  });

  it("preserves a lexical hyphen while still resolving the wrap", () => {
    const src = "Он ушёл из-\nза дождя.";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.text).toBe("Он ушёл из-за дождя.");
    expect(result.operations[0]).toMatchObject({ kind: "preserve-break" });
  });

  it("removes a soft hyphen entirely when joining", () => {
    const src = "музы­\nкант";
    expect(dehyphenateText(src, "ir:1", { lexicon: lex }).text).toBe("музыкант");
  });

  it("uses measured line edges to keep a mid-line hyphen", () => {
    const src = "Слово из-\nза чего-то";
    // Report every position as mid-line: nothing may be joined.
    const result = dehyphenateText(src, "ir:1", { lexicon: lex, lineEdges: () => false });
    expect(result.text).toContain("из-за");
    expect(result.operations.every((o) => o.kind === "preserve-break")).toBe(true);
  });

  it("leaves a hyphen followed by a space alone — it is not a wrap", () => {
    const src = "тире - это не перенос\nследующая строка";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.operations).toHaveLength(0);
    expect(result.text).toBe(src);
  });

  it("does not treat a number range as a word break", () => {
    const src = "1958-\n1962";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.operations).toHaveLength(0);
  });

  it("counts reviews so the caller can decide whether to escalate", () => {
    const src = "какое-то незнако-\nмоеслово тут";
    const result = dehyphenateText(src, "ir:1", { lexicon: lexiconOf() });
    expect(result.reviews).toBe(1);
    expect(result.operations[0]?.status).toBe("review");
  });

  it("handles several candidates in one block independently", () => {
    const src = "музы-\nкант и компози-\nтор вместе";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.text).toBe("музыкант и композитор вместе");
    expect(result.operations).toHaveLength(2);
  });
});

describe("Lexicon", () => {
  it("counts unhyphenated forms and hyphenated forms separately", () => {
    const lex = lexiconOf("музыкант музыкант из-за");
    expect(lex.count("музыкант")).toBe(2);
    expect(lex.hyphenatedCount("из-за")).toBe(1);
    // A hyphenated form must not contribute evidence that its parts stand alone.
    expect(lex.count("из")).toBe(0);
    expect(lex.count("за")).toBe(0);
  });

  it("ignores digit ranges", () => {
    const lex = lexiconOf("1958-1962 годы");
    expect(lex.hyphenatedCount("1958-1962")).toBe(0);
    expect(lex.count("годы")).toBe(1);
  });

  it("round-trips through JSON", () => {
    const lex = lexiconOf("музыкант из-за");
    const restored = Lexicon.fromJSON(lex.toJSON());
    expect(restored.count("музыкант")).toBe(1);
    expect(restored.hyphenatedCount("из-за")).toBe(1);
  });
});
