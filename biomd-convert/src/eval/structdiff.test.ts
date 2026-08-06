/**
 * Contracts for the L2 instrument.
 *
 * An adjudicator that is not itself adjudicated is a source of confident
 * nonsense, and this one decides what work happens. Three groups here:
 *
 *  1. **identity and determinism** — the same invariant L3's renderer carries:
 *     given one document twice, the instrument must report nothing, on every
 *     reference and every produced document in the corpus. A single spurious
 *     finding here would put a phantom class at the top of the ledger.
 *  2. **blind-spot closure** — one test per fold `score.ts` performs, asserting
 *     that L2 sees what L1 cannot. These are the reason the module exists; if
 *     one regresses, the ladder has quietly collapsed back to a scalar.
 *  3. **classification** — that a defect lands in a class precise enough to own
 *     a rule, and that structure is never mistaken for content (§16.3).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffDocuments } from "./structdiff.js";
import { SourceIndex, triage } from "./triage.js";

const REFERENCE_DIR = join(process.cwd(), "fixtures", "out");
const references = readdirSync(REFERENCE_DIR).filter((f) => f.endsWith(".bio.md"));

function classes(produced: string, reference: string): string[] {
  return diffDocuments("t", produced, reference).findings.map((f) => f.class);
}

describe("identity", () => {
  it("reports nothing when a reference is compared with itself", () => {
    for (const entry of references) {
      const text = readFileSync(join(REFERENCE_DIR, entry), "utf8");
      expect(diffDocuments(entry, text, text).findings, entry).toEqual([]);
    }
  });

  it("is deterministic", () => {
    const a = readFileSync(join(REFERENCE_DIR, references[0] as string), "utf8");
    const b = readFileSync(join(REFERENCE_DIR, references[1] as string), "utf8");
    const first = diffDocuments("t", a, b).findings;
    const second = diffDocuments("t", a, b).findings;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("gives every finding a line on the side it exists on", () => {
    const a = readFileSync(join(REFERENCE_DIR, references[0] as string), "utf8");
    const b = readFileSync(join(REFERENCE_DIR, references[1] as string), "utf8");
    for (const f of diffDocuments("t", a, b).findings) {
      expect(f.producedLine !== null || f.referenceLine !== null, f.class).toBe(true);
    }
  });
});

describe("blind spots the scalar score folds away", () => {
  it("sees a directive property value (facts.ts:36 counts names only)", () => {
    const want = "::: image\nsrc: a.jpg\nposition: right\nsize: medium\n:::\n";
    const got = "::: image\nsrc: a.jpg\nposition: right\nsize: small\n:::\n";
    expect(classes(got, want)).toContain("image.size.value");
  });

  it("sees a missing caption on an otherwise correct image", () => {
    const want = "::: image\nsrc: a.jpg\ncaption: Андрес Сеговия\n:::\n";
    const got = "::: image\nsrc: a.jpg\n:::\n";
    expect(classes(got, want)).toContain("image.caption.missing");
  });

  it("sees a wrong link label under a correct target (foldTarget folds it)", () => {
    expect(classes("[тут](music/x.pdf)\n", "[Часть 1 – PDF](music/x.pdf)\n")).toContain("link.label.content");
  });

  it("sees a table cell that moved a column (TableFacts is a flat multiset)", () => {
    const want = "| a | b |\n| --- | --- |\n| один | два |\n";
    const got = "| a | b |\n| --- | --- |\n| два | один |\n";
    const found = classes(got, want);
    expect(found.filter((c) => c.startsWith("table.cell."))).toHaveLength(2);
  });

  it("sees per-column alignment", () => {
    expect(classes("| a |\n| :-: |\n| x |\n", "| a |\n| --- |\n| x |\n")).toContain("table.align");
  });

  it("sees heading order and nesting, not just the multiset of levels", () => {
    expect(classes("## Б\n\ntext\n\n## А\n", "## А\n\ntext\n\n## Б\n")).toContain("heading.moved");
  });

  it("sees a heading demoted to a paragraph", () => {
    expect(classes("Избранные записи\n", "## Избранные записи\n")).toContain("retyped.paragraph-to-heading2");
  });

  it("sees a dropped hard break (normalizeForCompare folds lineation)", () => {
    expect(classes("Москва, 1969\nул. Тверская\n", "Москва, 1969\\\nул. Тверская\n")).toContain("hardbreak.missing");
  });

  it("sees a dropped `---` separator", () => {
    expect(classes("a\n\nb\n", "a\n\n---\n\nb\n")).toContain("break.missing");
  });

  it("sees containment: the same prose under a different parent", () => {
    const want = "::: columns\n::: column\n\nтекст один\n\n:::\n:::\n";
    const got = "::: columns\n::: column\n\n:::\n:::\n\nтекст один\n";
    expect(classes(got, want)).toContain("paragraph.containment");
  });

  it("sees emphasis that was lost", () => {
    expect(classes("1989 год\n", "**1989** год\n")).toContain("emphasis.span");
  });
});

describe("text defect classification", () => {
  const cases: Array<[string, string, string]> = [
    ['гитарист "виртуоз"', "гитарист «виртуоз»", "paragraph.typography.quotes"],
    ["(1913-1942)", "(1913–1942)", "paragraph.typography.dash"],
    ["классиче-ской музыки", "классической музыки", "paragraph.hyphenation"],
    ["югославский сербский гитарист", "югославский и сербский гитарист", "paragraph.content.edited"],
    [
      "Родился в 1969 году в Москве в семье пианистов",
      "Родился в 1969 году в Киеве в семье музыкантов",
      "paragraph.content",
    ],
  ];
  for (const [got, want, expected] of cases) {
    it(`classifies ${JSON.stringify(want)} as ${expected}`, () => {
      expect(classes(`${got}\n`, `${want}\n`)).toContain(expected);
    });
  }

  it("does not pair two unrelated paragraphs into one substitution", () => {
    // Deliberately not `paragraph.content`: with no shared vocabulary these are
    // not one paragraph that was rewritten, they are one that vanished and
    // another that appeared, and the two have different owning rules. Collapsing
    // them would hide a deletion behind an edit.
    // `.unattested` is the sub-class: the reference holds this text in no
    // construct at all, which is what makes it an insertion rather than an edit.
    expect(classes("совершенно другой текст здесь\n", "нечто иное про гитару\n")).toEqual(
      expect.arrayContaining(["paragraph.missing", "paragraph.spurious.unattested"]),
    );
  });
});

/**
 * A spurious produced block is sub-classified by the construct that owns its
 * text on the reference side, because "the reference has no paragraph here" is
 * not something a human can act on. Each sub-class names a different owning
 * mechanism, and the key is the text itself — no document can be named.
 */
describe("spurious blocks name where the reference put the text", () => {
  const cases: Array<[string, string, string]> = [
    [
      // Bound as a caption *and* left as a paragraph: the caption family owns it.
      "::: image\nsrc: a.jpg\ncaption: Памятник Сеговии\n:::\n\nПамятник Сеговии\n",
      "::: image\nsrc: a.jpg\ncaption: Памятник Сеговии\n:::\n",
      "paragraph.spurious.caption-echo",
    ],
    [
      // The menu was recognised and the prose run left behind as well.
      "::: nav\n- [Архив новостей](#a)\n:::\n\nАрхив новостей\n",
      "::: nav\n- [Архив новостей](#a)\n:::\n",
      "paragraph.spurious.in-nav",
    ],
    [
      // A `<br>` run emitted as a list *and* as the paragraph it came from.
      // Unnumbered on purpose: a bare `01. Love Story` line *is* an ordered
      // list to any CommonMark reader, so it could not be the paragraph this
      // case is about. The escaped form is covered below, where it stays one.
      "- Love Story\n\nLove Story\n",
      "- Love Story\n",
      "paragraph.spurious.in-list",
    ],
    [
      // The label was promoted to a heading and also kept as a paragraph.
      "## ВСТУПЛЕНИЕ\n\nВСТУПЛЕНИЕ\n",
      "## ВСТУПЛЕНИЕ\n",
      "paragraph.spurious.in-heading",
    ],
  ];
  for (const [produced, reference, expected] of cases) {
    it(`classifies it as ${expected}`, () => {
      expect(classes(produced, reference)).toContain(expected);
    });
  }

  it("keys on the words, so an escape or a glyph cannot hide the home", () => {
    // `01\.` and `• … •` differ from the reference byte for byte and are the
    // same text. A key that did not fold them would report `.unattested` and
    // send a reader looking for content that is sitting in a list.
    expect(classes("- 01. Love Story\n\n01\\. Love Story\n", "- 01. Love Story\n")).toContain(
      "paragraph.spurious.in-list",
    );
    expect(
      classes("::: nav\n- [Архив новостей](#a)\n:::\n\n• Архив новостей •\n", "::: nav\n- [Архив новостей](#a)\n:::\n"),
    ).toContain("paragraph.spurious.in-nav");
  });
});

describe("triage separates content from layout", () => {
  const source = new SourceIndex("<p>гитарист и композитор</p><table><tr><td>1989</td></tr></table>");

  it("treats prose the source does not attest as a reference inconsistency, not a defect", () => {
    expect(triage("Избранные записи", null, source, "heading.missing", "content")).toBe("reference-inconsistency");
  });

  it("treats prose the source attests as a defect", () => {
    expect(triage("гитарист и композитор", null, source, "paragraph.missing", "content")).toBe("converter-defect");
  });

  it("never calls a layout wrapper unreachable — §16.3 constrains content, not layout", () => {
    expect(triage("columns 01. Love Story", null, source, "columns.missing", "structure")).toBe("converter-defect");
  });

  it("treats typography as the migrator's, never the author's", () => {
    expect(triage("«виртуоз»", '"виртуоз"', source, "paragraph.typography.quotes", "content")).toBe(
      "reference-inconsistency",
    );
  });

  // The correction this policy exists for: the verdict is decided by which side
  // the *source* supports, not by which side differs from the reference.
  it("blames the reference when the produced side is the attested one", () => {
    // `goya2` in miniature: the source italicises a duration, the reference
    // rewrites it as a plain em-dash run. Reproducing the reference would be the
    // §16.3 violation, so the converter is not the thing to change here.
    const italic = new SourceIndex("<p>трек <i>4.07</i></p>");
    expect(triage("(none)", "em:4.07", italic, "emphasis.span", "structure")).toBe("reference-inconsistency");
    // The mirror image: emphasis the source never had is invention, and work.
    expect(triage("(none)", "em:трек", italic, "emphasis.span", "structure")).toBe("converter-defect");
    // And a loss of the author's own emphasis is work too.
    expect(triage("em:4.07", "(none)", italic, "emphasis.span", "structure")).toBe("converter-defect");
  });

  it("blames the converter when the reference side is the attested one", () => {
    expect(triage("гитарист и композитор", "нечто иное", source, "paragraph.content", "content")).toBe(
      "converter-defect",
    );
  });

  it("does not call a presentational difference layout", () => {
    // `evidence: "structure"` is not a licence. An emphasis span, a hard break
    // and a rule spelling are claims about how content is *spelled*; only a
    // claim about where content *sits* is unconditionally actionable.
    expect(triage("совсем другое", "тоже другое", source, "hardbreak.spurious", "structure")).not.toBe(
      "converter-defect",
    );
    expect(triage("совсем другое", "тоже другое", source, "columns.containment", "structure")).toBe("converter-defect");
    // A *thematic* break is a separator between regions — layout, not spelling.
    // Matching it as presentational put all 36 on the ceiling.
    expect(triage("---", null, source, "break.missing", "structure")).toBe("converter-defect");
  });

  it("asks rather than answers when the produced side keeps attested source text", () => {
    // The reference has nothing here and the produced text is in the source.
    // Keeping source content is not inventing it, but dropping page chrome is
    // not a defect either, and nothing deterministic separates the two.
    expect(triage(null, "гитарист и композитор", source, "paragraph.spurious", "content")).toBe("ambiguous");
    // Unattested on both sides is invented outright, and that is always work.
    expect(triage(null, "телефон редакции 555-0100", source, "paragraph.spurious", "content")).toBe("converter-defect");
    // But when the sub-class names where the reference keeps the text, the
    // produced document simply has it twice, and that is never a question.
    expect(triage(null, "гитарист и композитор", source, "paragraph.spurious.caption-echo", "content")).toBe(
      "converter-defect",
    );
  });
});
