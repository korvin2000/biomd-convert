import { describe, expect, it } from "vitest";
import { Lexicon } from "./lexicon.js";
import {
  NULL_ORACLE,
  createHyphenopolyOracle,
  createWordDictionary,
  decideHyphen,
  dehyphenateDocument,
  dehyphenateText,
  type HyphenationOracle,
} from "./dehyphenate.js";

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

/**
 * Rule contract — **rule 6 needs two independent external signals.**
 *
 * *Invariant.* Hyphenopoly only proves that a word may break at the observed
 * position; Hunspell independently proves that the joined form is a word.
 * Neither signal alone may authorize a destructive join.
 *
 * *Recurrence.* Not applicable: dictionary membership and legal break position
 * are independent external evidence. Requiring corpus recurrence would make
 * rule 6 identical to rule 4 and remove its purpose.
 *
 * *False friend.* A common lexical compound has legal breaks in its hypothetical
 * joined spelling but the dictionary rejects that spelling, so it is preserved.
 *
 * *Mutation robustness.* Package loading and word decisions depend on language
 * data only, not DOM names, wrappers, attributes, or fixture identity.
 */
describe("production de-hyphenation oracles", () => {
  it("loads Russian patterns and dictionary while preserving independent vetoes", async () => {
    const [oracle, dictionary] = await Promise.all([
      createHyphenopolyOracle(["ru"]),
      createWordDictionary("ru"),
    ]);
    expect(oracle.available).toBe(true);
    expect(dictionary).toBeTypeOf("function");
    expect(oracle.isLegalBreak("маркетолог", 3, "ru")).toBe(true);
    expect(dictionary?.("маркетолог")).toBe(true);
    expect(dictionary?.("информационноаналитического")).toBe(false);
  });
});

/**
 * Rule contract — **a hyphen inside a machine identifier is never a wrap.**
 *
 * *Invariant.* The evidence is the shape of the unbroken token the hyphen sits
 * in, not its spelling: an interior `.` between two alphanumerics, or a `/`,
 * `@`, `:` or `%`. No scheme, no TLD, no host and no file extension is named,
 * so a `.ru` domain, a `.jpg` file name and a bare path all qualify, and text
 * the rule cannot see simply falls through to the rest of the cascade.
 *
 * *Recurrence.* Deliberately **not** required, and this is one of the shapes
 * `CLAUDE.md` §5 has in mind when it says so: an identifier is decided by
 * containment, and one link is one link. Requiring a second occurrence would
 * mean the corpus had to spell a domain twice before its label could be
 * trusted — which is exactly the accident that produced the defect.
 *
 * *False friend.* Prose punctuation that merely abuts the token. `в г. Штут-
 * гарте` carries a full stop two characters away and must still join; the space
 * ends the token, and a leading or trailing separator is trimmed before the
 * test, so `rendez-vous:` is not read as a scheme.
 *
 * *Mutation robustness.* Nothing here reads the DOM, the class, the `href` or
 * the surrounding element, so wrapper nesting, renamed classes, `<font>` versus
 * CSS and Latin/Cyrillic labels cannot change the answer. The candidate is
 * judged from the text node alone.
 *
 * *Source.* `analyze-3.md`, `authors.htm`: "и в названии ссылки убран дефис
 * (критически): [www.abcguitars.com] (должно быть [www.abc-guitars.com])".
 */
describe("rule 0 — a hyphen inside an identifier is not prose", () => {
  // The real defect, reduced. `authors.htm` links to `www.abc-guitars.com` and,
  // one clause later, to the genuinely different `www.abcguitars.com`. The
  // second is therefore attested, and rule 4 rewrote the label of the first
  // into the name of the second — leaving a label that contradicts its own href.
  const lex = lexiconOf("www.abcguitars.com abcguitars хостинг");

  it("preserves a hyphen in a host name the corpus attests unhyphenated", () => {
    const src = "хостинг на www.abc-guitars.com, а также на www.abcguitars.com.";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.text).toContain("www.abc-guitars.com");
    expect(result.operations[0]).toMatchObject({ kind: "preserve-break" });
    expect(decideHyphen({ left: "abc", right: "guitars", hyphen: "-", inIdentifier: true }, { lexicon: lex }))
      .toMatchObject({ verdict: "PRESERVE", rule: 0 });
  });

  it("preserves a hyphen in a path and in a file name", () => {
    for (const src of ["music/wma/kol-pakov.wma", "см. photo/w/john-williams.jpg"]) {
      expect(dehyphenateText(src, "ir:1", { lexicon: lexiconOf("kolpakov johnwilliams") }).text).toBe(src);
    }
  });

  // False friend: an abbreviation's full stop is *outside* the token, and a
  // wrapped word next to one must still join.
  it("does not fire on prose whose neighbouring word ends in a full stop", () => {
    const prose = lexiconOf("Штутгарте Штутгарте");
    const result = dehyphenateText("живет в г. Штут-гарте, Германия.", "ir:1", { lexicon: prose });
    expect(result.text).toBe("живет в г. Штутгарте, Германия.");
  });

  // False friend: a trailing colon is sentence punctuation, not a scheme.
  it("does not read trailing sentence punctuation as an identifier", () => {
    expect(decideHyphen({ left: "музы", right: "кант", hyphen: "-" }, { lexicon: lexiconOf("музыкант музыкант") }))
      .toMatchObject({ verdict: "JOIN", rule: 4 });
    const result = dehyphenateText("музы-кант:", "ir:1", { lexicon: lexiconOf("музыкант музыкант") });
    expect(result.text).toBe("музыкант:");
  });
});

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

  it("rule 6: an illegal break point alone does not authorize a join", () => {
    // `музыкант` cannot break after `музык`. With a dictionary that calls every
    // string a word, both fragments are words too, so the fragment evidence
    // rule 6b needs is absent and the illegal position is not overridden.
    const d = decideHyphen(
      { left: "музык", right: "ант", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: FAKE_ORACLE, dictionary: () => true },
    );
    expect(d.verdict).not.toBe("JOIN");
  });

  /**
   * Rule contract — **rule 6b: the break position is the typist's, the
   * fragments are the language's.**
   *
   * *Invariant.* Evidence is two dictionary questions about the two fragments
   * and their concatenation. No document, class, id, filename or title appears,
   * and the dictionary is supplied per language by the caller.
   *
   * *Recurrence.* Not applicable, and stated rather than assumed: a wrapped word
   * is one lexical event at one place on one page. Requiring it to recur would
   * make the rule unable to fire on the shape it exists for.
   *
   * *False friend.* An abbreviation or compound whose halves are both words —
   * `лит-ре`, where the joined spelling `литре` is a real but *different* word.
   * Tested for non-firing. The larger family (`из-за`, `кто-то`, `во-первых`)
   * is refused one step earlier, because no dictionary holds their joined forms.
   *
   * *Mutation robustness.* The decision reads two strings; DOM names, wrappers,
   * attribute order and viewport cannot reach it. With no dictionary installed
   * the rule cannot fire at all and the conservative path is unchanged.
   */
  it("rule 6b: joins an illegal break when the split leaves a fragment that is not a word", () => {
    // `фестивалях` breaks as `фе-сти-ва-лях`, never after `фес` — yet that is
    // where the page has it, and `фес` and `тивалях` are not words.
    const russian = (w: string) => w === "фестивалях";
    const d = decideHyphen(
      { left: "фес", right: "тивалях", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: russian },
    );
    expect(d).toMatchObject({ verdict: "JOIN", rule: 6, joined: "фестивалях" });
  });

  it("rule 6b: does not join when both fragments are words in their own right", () => {
    // `лит-ре` abbreviates `литературе`; joining it silently produces `литре`,
    // a real word with an unrelated meaning. Both halves are words, so the
    // wrap evidence is absent and the conservative default holds.
    const russian = (w: string) => ["литре", "лит", "ре"].includes(w);
    const d = decideHyphen(
      { left: "лит", right: "ре", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: russian },
    );
    expect(d.verdict).not.toBe("JOIN");
  });

  it("rule 6b: a lexical compound the dictionary does not hold is never reached", () => {
    // `вице-президент` is two words the language keeps apart; no dictionary
    // holds `вицепрезидент`, so the first signal already refuses.
    const russian = (w: string) => ["вице", "президент"].includes(w);
    const d = decideHyphen(
      { left: "вице", right: "президент", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: russian },
    );
    expect(d.verdict).not.toBe("JOIN");
  });

  it("rule 6b: the earlier rules still outrank it", () => {
    // A proper compound (rule 3) and an identifier (rule 0) must keep their
    // hyphen even when the concatenation happens to be a dictionary word.
    const yes = () => true;
    const compound = decideHyphen(
      { left: "Римский", right: "Корсаков", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: yes },
    );
    expect(compound).toMatchObject({ verdict: "PRESERVE", rule: 3 });

    const identifier = decideHyphen(
      { left: "abc", right: "guitars", hyphen: "-", inIdentifier: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: yes },
    );
    expect(identifier).toMatchObject({ verdict: "PRESERVE", rule: 0 });
  });

  it("rule 6b: degrades to the old behaviour when no dictionary is installed", () => {
    const d = decideHyphen(
      { left: "фес", right: "тивалях", hyphen: "-", atLineEdge: true },
      { lexicon: lexiconOf(), oracle: NULL_ORACLE },
    );
    expect(d).toMatchObject({ verdict: "REVIEW", rule: 7 });
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
    // Two candidates, not one: a hyphen no longer needs a newline after it to
    // be examined, because this corpus writes its wraps mid-line. `какое-то` is
    // undecidable against an empty lexicon and `незнако-моеслово` likewise, so
    // both are preserved and both are escalated rather than joined on a guess.
    const src = "какое-то незнако-\nмоеслово тут";
    const result = dehyphenateText(src, "ir:1", { lexicon: lexiconOf() });
    expect(result.reviews).toBe(2);
    expect(result.operations.every((op) => op.status === "review")).toBe(true);
    expect(result.text).toBe("какое-то незнако-моеслово тут");
  });

  it("examines a hyphen with no newline after it", () => {
    // The shape this corpus actually has: the hyphen was typed to break the
    // word in the author's browser and the text kept flowing, so the newline is
    // somewhere else entirely. Requiring one saw none of these.
    const result = dehyphenateText("Укра-ина большая", "ir:1", { lexicon: lexiconOf("Украина большая страна") });
    expect(result.text).toBe("Украина большая");
  });

  it("still refuses a compound whose halves are both title-cased", () => {
    // Rule 3 settles this before any frequency evidence, which is what makes
    // widening the pattern safe: every genuine compound reaches the cascade now.
    const result = dehyphenateText("Римский-Корсаков писал", "ir:1", { lexicon: lexiconOf("Римскийкорсаков Римскийкорсаков") });
    expect(result.text).toBe("Римский-Корсаков писал");
  });

  it("handles several candidates in one block independently", () => {
    const src = "музы-\nкант и компози-\nтор вместе";
    const result = dehyphenateText(src, "ir:1", { lexicon: lex });
    expect(result.text).toBe("музыкант и композитор вместе");
    expect(result.operations).toHaveLength(2);
  });

  /**
   * Rule contract — **every break in one multiply hyphenated word is decided.**
   *
   * *Invariant.* A candidate shares its right letter-run with the next
   * candidate; discovery must not consume that run. Decisions replace only
   * the intervening hyphen and whitespace, so neighbouring candidates cannot
   * overlap or duplicate text.
   *
   * *Recurrence.* Intrinsic: this rule exists only when the same word carries
   * at least two candidates. A one-break word stays on the established path.
   *
   * *False friend.* A multi-part proper name may contain a lower-case linker.
   * All its breaks are lexical and must survive even when one linker is a
   * frequent standalone word.
   *
   * *Mutation robustness.* The contract is plain text: DOM wrappers, classes,
   * attributes, encoding, and script do not participate in candidate overlap.
   */
  it("decides adjacent candidates without consuming their shared fragment", () => {
    const result = dehyphenateText("информационно-аналити-ческого", "ir:1", {
      lexicon: lexiconOf("аналитического аналитического"),
    });
    expect(result.text).toBe("информационно-аналитического");
    expect(result.operations).toHaveLength(2);
    expect(result.operations.map((op) => op.kind)).toEqual(["preserve-break", "join-hyphenated-word"]);

    const properName = dehyphenateText("Кастельон-де-ла-Плане", "ir:2", { lexicon: lexiconOf("де де") });
    expect(properName.text).toBe("Кастельон-де-ла-Плане");
    expect(properName.operations).toHaveLength(3);
    expect(properName.operations.every((op) => op.kind === "preserve-break")).toBe(true);
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

/**
 * Rule contract — **a wrap hyphen that markup put in a box of its own.**
 *
 * *Invariant.* Evidence is structural: an inline wrapper whose whole subtree is
 * one hyphen, raw text siblings on both sides, letters touching both junctions.
 * No class, id, filename, title or corpus word appears; `INLINE_WRAPPERS` is
 * HTML vocabulary and an unknown tag simply yields no join.
 *
 * *Recurrence.* Not applicable, and stated: one wrapped word is one lexical
 * event. The recurring thing here is the *markup habit*, not the word.
 *
 * *False friends.* Named and tested for non-firing: a dash separated by spaces;
 * a hyphen alone inside a block element rather than an inline one; a hyphen
 * whose neighbours are elements rather than raw text; and the verdict itself,
 * which is the ordinary cascade — so an identifier and a proper compound keep
 * their hyphen through this path exactly as they do through the other one.
 *
 * *Mutation robustness.* The wrapper's attributes are never read, so renaming a
 * class or permuting attributes cannot change the decision; the same word split
 * by `<span>`, `<font>` or `<b>` decides identically.
 */
describe("de-hyphenation across an inline wrapper", () => {
  const text = (id: string, value: string) => ({ kind: "text", id, value, children: [] as unknown[] });
  const el = (id: string, tag: string, ...children: unknown[]) => ({ kind: "element", id, tag, children });
  const para = (...children: unknown[]) => ({ children: [el("ir:p", "p", ...children)] });

  const russian = (w: string) => ["издавал", "фестивалях", "литре", "лит", "ре"].includes(w);
  const opts = { lexicon: lexiconOf(), oracle: NULL_ORACLE, dictionary: russian };

  it("joins a word the markup split into three nodes", () => {
    const doc = para(text("ir:1", "он изда"), el("ir:2", "span", text("ir:3", "-")), text("ir:4", "вал сочинения"));
    const result = dehyphenateDocument(doc as never, opts);
    expect(result.operations.at(-1)).toMatchObject({ kind: "join-hyphenated-word", after: "издавал" });
    const kids = doc.children[0]!.children as Array<{ children?: Array<{ value?: string }> }>;
    expect(kids[1]!.children![0]!.value).toBe("");
  });

  it("decides identically whichever inline element holds the hyphen", () => {
    for (const tag of ["span", "font", "b", "i"]) {
      const doc = para(text("ir:1", "изда"), el("ir:2", tag, text("ir:3", "-")), text("ir:4", "вал"));
      expect(dehyphenateDocument(doc as never, opts).operations.at(-1)).toMatchObject({ after: "издавал" });
    }
  });

  it("does not join across a block element", () => {
    const doc = para(text("ir:1", "изда"), el("ir:2", "p", text("ir:3", "-")), text("ir:4", "вал"));
    expect(dehyphenateDocument(doc as never, opts).operations).toHaveLength(0);
  });

  it("does not join when whitespace touches either junction", () => {
    for (const [l, r] of [["изда ", "вал"], ["изда", " вал"]]) {
      const doc = para(text("ir:1", l!), el("ir:2", "span", text("ir:3", "-")), text("ir:4", r!));
      expect(dehyphenateDocument(doc as never, opts).operations).toHaveLength(0);
    }
  });

  it("does not join when the wrapper holds more than the hyphen", () => {
    const doc = para(text("ir:1", "изда"), el("ir:2", "span", text("ir:3", "-в")), text("ir:4", "ал"));
    expect(dehyphenateDocument(doc as never, opts).operations).toHaveLength(0);
  });

  it("keeps the cascade's guards on this path too", () => {
    // An identifier: `abc-guitars.com` is a host name, not a wrapped word.
    const host = para(text("ir:1", "www.abc"), el("ir:2", "span", text("ir:3", "-")), text("ir:4", "guitars.com"));
    const d1 = dehyphenateDocument(host as never, { ...opts, dictionary: () => true });
    expect(d1.operations.at(-1)).toMatchObject({ kind: "preserve-break" });

    // A compound proper noun keeps its hyphen however it is marked up.
    const name = para(text("ir:1", "Римский"), el("ir:2", "span", text("ir:3", "-")), text("ir:4", "Корсаков"));
    const d2 = dehyphenateDocument(name as never, { ...opts, dictionary: () => true });
    expect(d2.operations.at(-1)).toMatchObject({ kind: "preserve-break" });
  });

  it("leaves the hyphen in place when the language does not license the join", () => {
    // `лит-ре` — both halves are words, so rule 6b refuses exactly as it does
    // when no markup is involved.
    const doc = para(text("ir:1", "в лит"), el("ir:2", "span", text("ir:3", "-")), text("ir:4", "ре сказано"));
    const result = dehyphenateDocument(doc as never, opts);
    expect(result.operations.at(-1)).toMatchObject({ kind: "preserve-break" });
    const kids = doc.children[0]!.children as Array<{ children?: Array<{ value?: string }> }>;
    expect(kids[1]!.children![0]!.value).toBe("-");
  });
});
