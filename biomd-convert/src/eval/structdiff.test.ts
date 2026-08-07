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

function findings(produced: string, reference: string) {
  return diffDocuments("t", produced, reference).findings;
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

  /**
   * `BioMD-Reference.md` §1: `---`, `***` and `___` are one construct.
   *
   * Identity has to hold across the spelling, not merely across the byte. An
   * instrument that reports a difference no reader can see manufactures work,
   * and this one did — three of the twenty-two references write `***` at least
   * once while every produced document writes `---`.
   */
  it("reports nothing when two documents differ only in how a rule is spelled", () => {
    const dashes = "# T\n\nОдин.\n\n---\n\nДва.\n";
    for (const marker of ["***", "___"]) {
      const other = dashes.replace("---", marker);
      expect(diffDocuments("t", other, dashes).findings, marker).toEqual([]);
      // …and in the other direction, because a differ that is not symmetric here
      // would simply move the false finding to the other side.
      expect(diffDocuments("t", dashes, other).findings, marker).toEqual([]);
    }
  });

  /**
   * A numeric character reference and its character are one character.
   *
   * `CLAUDE.md` §4 puts entity decoding among the things L2 adjudicates, and
   * this is that fold. `mini_images_to_md_guide.md` sanctions both spellings —
   * "compact inline text **or** a Unicode/HTML numeric character reference" —
   * the references write `&#128279;` sixteen times across six documents, and
   * the converter cannot write that spelling without either a backslash escape
   * or a raw-HTML node. Reporting the difference manufactured a finding for
   * output that was exactly right.
   *
   * The fold changes the *spelling* of a character and never which character it
   * is, so it does not reach the typography blind spot next door: `«` and `"`
   * stay a finding.
   */
  it("reports nothing when two documents differ only in how a character is spelled", () => {
    const glyph = "# T\n\n| Название | \u{1F517} |\n| - | - |\n| Adelita | [TAB](t.txt) |\n";
    const entity = glyph.replace("\u{1F517}", "&#128279;");
    expect(diffDocuments("t", entity, glyph).findings).toEqual([]);
    expect(diffDocuments("t", glyph, entity).findings).toEqual([]);
    // Hex spelling too, and the other direction of the same character.
    expect(diffDocuments("t", glyph.replace("\u{1F517}", "&#x1F517;"), glyph).findings).toEqual([]);
    // The near neighbour that must still differ: one character is not another.
    expect(diffDocuments("t", glyph.replace("\u{1F517}", "&#9654;"), glyph).findings).not.toEqual([]);
  });

  it("FALSE FRIEND: a rule that is absent or added is still reported", () => {
    const withRule = "# T\n\nОдин.\n\n---\n\nДва.\n";
    const without = "# T\n\nОдин.\n\nДва.\n";
    expect(classes(without, withRule)).toContain("break.missing");
    expect(classes(withRule, without).some((c) => c.startsWith("break.spurious"))).toBe(true);
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
    ["классиче-ской музыки", "классической музыки", "paragraph.hyphenation.unjoined"],
    // The other direction, which is not the same finding: the converter joined
    // the wrap and the reference kept it. Every instance of this in the corpus
    // is a correct Russian word, and the instrument cannot know that.
    ["классической музыки", "классиче-ской музыки", "paragraph.hyphenation.joined"],
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
    // `.unattested` on both sides: neither document holds the other's text in
    // any construct, which is what makes this an insertion plus a deletion
    // rather than an edit — and the one case where "missing" means missing.
    expect(classes("совершенно другой текст здесь\n", "нечто иное про гитару\n")).toEqual(
      expect.arrayContaining(["paragraph.missing.unattested", "paragraph.spurious.unattested"]),
    );
  });
});

/**
 * The home question is symmetric, and its answer decides the severity.
 *
 * A reference block was reported bare and `critical`, on `content` evidence,
 * which reads as prose that was lost. Measured over the corpus it never was:
 * all ten `paragraph.missing` findings had their text sitting in the produced
 * document under a different container. Presence is a fact both sides can be
 * asked about, and a finding may not claim loss while the words are there.
 */
describe("missing blocks name where this document put the text", () => {
  const cases: Array<[string, string, string]> = [
    [
      // Still a paragraph, elsewhere: placement, not content. Written twice on
      // the reference side so that one copy pairs and the other has to be
      // named — with a single copy the reconciler pairs it across containers
      // and answers `paragraph.containment`, which is a better answer still.
      "Джулиан БРИМ\n\nпрочее\n",
      "Джулиан БРИМ\n\nДжулиан БРИМ\n\nпрочее\n",
      "paragraph.missing.in-paragraph",
    ],
    [
      // One side ended a line, the other started a block. `Номера изданий:`
      // heads its own paragraph in the reference and opens a `\`-run here.
      "Номера изданий:\\\nДжаз-сюита - IMP 066\n",
      "Номера изданий:\n\nДжаз-сюита - IMP 066\n",
      "paragraph.missing.in-break-run",
    ],
    [
      // A caption that swallowed the line below the figure. The words are in
      // the produced document — inside a longer string, at no boundary.
      "::: image\nsrc: a.jpg\ncaption: А. Сеговия с учениками — Ленинград, гостиница Европейская\n:::\n",
      "::: image\nsrc: a.jpg\ncaption: А. Сеговия с учениками\n:::\n\nЛенинград, гостиница Европейская\n",
      "paragraph.missing.absorbed",
    ],
    [
      // Flattened into a record matrix. The table carries other rows on
      // purpose: a one-cell table simply pairs with the paragraph and reports
      // `retyped.table-to-paragraph`, which is the reconciler doing better.
      "| Rodrigo Fantasia | 1954 |\n| --- | --- |\n| Ponce Concierto del Sur | 1941 |\n| Castelnuovo Concerto | 1939 |\n",
      "Rodrigo Fantasia\n\nсовсем иные слова про другое\n",
      "paragraph.missing.in-table",
    ],
  ];
  for (const [produced, reference, expected] of cases) {
    it(`classifies it as ${expected}`, () => {
      expect(classes(produced, reference)).toContain(expected);
    });
  }

  it("calls a placement finding major and structural, not critical content", () => {
    // The severity *is* the claim. Critical/`content` says prose was lost, and
    // ranking work by `instances × severity × generality` then puts a class
    // that loses nothing above every class that does.
    const found = findings("Джулиан БРИМ\n\nпрочее\n", "Джулиан БРИМ\n\nДжулиан БРИМ\n\nпрочее\n").filter(
      (f) => f.class === "paragraph.missing.in-paragraph",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "major", evidence: "structure" });
  });

  it("keeps critical content for the one case where the words are gone", () => {
    const found = findings("прочее\n", "гитарист и композитор\n\nпрочее\n").filter((f) =>
      f.class.startsWith("paragraph.missing"),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      class: "paragraph.missing.unattested",
      severity: "critical",
      evidence: "content",
    });
  });

  it("does not let a page that names itself absorb its own chrome", () => {
    // `.absorbed` is the weakest answer and the only one that can be a
    // coincidence. `news_2007` repeats `Архив новостей` as footer chrome the
    // reference drops, and it runs inside the page's own heading — two words,
    // below the minimum, so the finding stays `.unattested` and stays a
    // question about chrome rather than an answer pointing at the masthead.
    expect(classes("## Архив новостей за 2007 год\n\n• Архив новостей •\n", "## Архив новостей за 2007 год\n")).toContain(
      "paragraph.spurious.unattested",
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

  it("names a paragraph the reference also keeps as a paragraph", () => {
    // Nothing was retyped here, so the owning mechanism is placement. Calling
    // it `.unattested` sent a reader looking for content the reference had
    // deleted, when the reference holds that very paragraph. Emitted twice on
    // the produced side so that one copy pairs and the other has to be named —
    // a single copy simply reconciles as `paragraph.moved`, which is a better
    // answer still and the reason this sub-class is rarer than it looks.
    expect(classes("Джулиан БРИМ\n\nДжулиан БРИМ\n\nпрочее\n", "Джулиан БРИМ\n\nпрочее\n")).toContain(
      "paragraph.spurious.in-paragraph",
    );
  });

  it("prefers the same kind when the reference holds one text twice", () => {
    // `news` writes an obituary's subject as a bold paragraph *and* captions
    // the photograph below it with the same name. `.caption-echo` reads as a
    // duplicated caption; the actionable answer is that the paragraph itself is
    // right and only its place is wrong.
    const reference = "Юрий Смирнов\n\n::: image\nsrc: a.jpg\ncaption: Юрий Смирнов\n:::\n";
    const produced = "::: image\nsrc: a.jpg\ncaption: Юрий Смирнов\n:::\n\nЮрий Смирнов\n\nЮрий Смирнов\n";
    const found = classes(produced, reference);
    expect(found).toContain("paragraph.spurious.in-paragraph");
    expect(found).not.toContain("paragraph.spurious.caption-echo");
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

  it("does not call a block boundary a defect just because it is placement", () => {
    // `.in-break-run` says one side ended a block where the other ended a line
    // — the hard-break question one level out, and presentation rather than
    // layout. `structdiff` gives placement findings `structure` evidence, which
    // routed the class around attestation and reported all six corpus
    // instances as defects; measured, every one was the reference merging
    // paragraphs the source states outright. Attested, it is a question.
    expect(triage(null, "гитарист и композитор", source, "paragraph.spurious.in-break-run", "structure")).toBe(
      "ambiguous",
    );
    // The other direction still stands: the reference asserts a block the
    // produced document does not have, and the source has the words.
    expect(triage("гитарист и композитор", null, source, "paragraph.missing.in-break-run", "structure")).toBe(
      "converter-defect",
    );
  });

  it("does not decide a hyphenation finding by source attestation", () => {
    // The source contains the hyphen either way — that is the artifact being
    // reported — so the hyphenated side is attested by construction and the
    // joined side never is. Running it through the attestation test says "the
    // reference is right" every time, including where the converter joined
    // correctly and the reference kept the wrap. Direction is the only evidence.
    const withHyphen = new SourceIndex("<p>клас-сической музыки</p>");
    expect(triage("классической музыки", "клас-сической музыки", withHyphen, "paragraph.hyphenation.unjoined")).toBe(
      "converter-defect",
    );
    expect(triage("клас-сической музыки", "классической музыки", withHyphen, "paragraph.hyphenation.joined")).toBe(
      "ambiguous",
    );
    // Both directions in one block still holds at least one real defect.
    expect(triage("клас-сической музыки", "классической музыки", withHyphen, "paragraph.hyphenation.mixed")).toBe(
      "converter-defect",
    );
  });

  it("does not let a directive's own scaffolding decide attestation", () => {
    // The span quoted for a directive used to open with its name and every
    // property value, so `align center гитарист и композитор` was absent from
    // the source for a reason that had nothing to do with the author's text.
    // The name and the presentational properties are this instrument's, and a
    // span it wrote itself must not be evidence about the source.
    expect(triage("гитарист и композитор", null, source, "align.missing", "content")).toBe("converter-defect");
    expect(triage(null, "гитарист и композитор", source, "align.spurious.unattested", "content")).toBe("ambiguous");
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
