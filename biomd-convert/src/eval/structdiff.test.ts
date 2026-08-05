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
    expect(classes("совершенно другой текст здесь\n", "нечто иное про гитару\n")).toEqual(
      expect.arrayContaining(["paragraph.missing", "paragraph.spurious"]),
    );
  });
});

describe("triage separates content from layout", () => {
  const source = new SourceIndex("<p>гитарист и композитор</p><table><tr><td>1989</td></tr></table>");

  it("treats prose the source does not attest as a ceiling, not a defect", () => {
    expect(triage("Избранные записи", null, source, "heading.missing", "content")).toBe("source-unbacked");
  });

  it("treats prose the source attests as a defect", () => {
    expect(triage("гитарист и композитор", null, source, "paragraph.missing", "content")).toBe("source-backed");
  });

  it("never calls a layout wrapper unreachable — §16.3 constrains content, not layout", () => {
    expect(triage("columns 01. Love Story", null, source, "columns.missing", "structure")).toBe("source-backed");
  });

  it("treats typography as the migrator's, never the author's", () => {
    expect(triage("«виртуоз»", '"виртуоз"', source, "paragraph.typography.quotes", "content")).toBe("source-unbacked");
  });
});
