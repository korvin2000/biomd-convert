/**
 * Contract: recurrence needs two observations to exist.
 *
 * The defect this exists for deleted a third of a document and reported
 * `Text recall: 100.00%`, `Targets: conserved`, `Images: conserved` and
 * `State: biomd-structurally-valid` while doing it.
 *
 * `biomd corpus scan` over a directory holding **one** page assigns every
 * structure on that page `frequency = 1/1`, and each fingerprint holds exactly
 * one text signature, so both halves of the chrome test pass for everything the
 * page contains — including the article. Two consumers then act on that:
 * `removeBoilerplate` detaches the structures, and `classify.ts` returns `SHELL`
 * at tier 1 / confidence 0.95 for any table above `corpusFrequency` 0.7, which
 * deletes the table outright. The conservation gate cannot see either, because
 * the source inventory is captured *after* boilerplate removal.
 *
 * Measured over the fixture sources, scanning the first N: `stableChrome` is
 * **22** and **43** for the two one-file scans and **10, 10, 10, 10, 9, 9, 9**
 * from N = 2 upward; the share of page text the removal pass takes is **18.1 %**
 * for a one-file profile against **1.1 %** for every other. A cliff at exactly
 * one page and a flat curve after it — the boundary is the mechanism, not a
 * tuned number.
 */
import { describe, expect, it } from "vitest";
import { parseHtml } from "../ladom/parse.js";
import { textOf } from "../ladom/types.js";
import { resolveProfile } from "../biomd-ast/index.js";
import { removeBoilerplate } from "./boilerplate.js";
import { type CorpusProfile, frequencyForDocument, runCorpusPass } from "./corpus.js";
import { convert } from "./pipeline.js";

/** The era's page shape: a chrome banner and menu around the article. */
function page(article: string): string {
  return `<html><head><title>t</title></head><body>
<center><table border="0" width="760"><tr><td><b>Иллюстрированный словарь</b></td></tr></table></center>
<center><table border="0" width="760"><tr><td><a href="menu.htm">меню</a></td><td><a href="new.htm">новое</a></td></tr></table></center>
<table border="0" width="529"><tr><td>${article}</td></tr></table>
<center><table border="0" width="760"><tr><td>© 2001-2008</td></tr></table></center>
</body></html>`;
}

const ARTICLE_A =
  "<p>Гарсиа Лорка не стал профессиональным музыкантом, однако его поэзия неразрывно связана с гитарой.</p>";
const ARTICLE_B =
  "<p>Сеговия был выдающимся гитаристом своего поколения и оставил обширное концертное наследие.</p>";

const file = (name: string, html: string) => ({ name, bytes: Buffer.from(html, "utf8") });

describe("a corpus of one cannot distinguish chrome from content", () => {
  it("records no chrome at all, and says why", () => {
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A))]);
    expect(profile.files).toBe(1);
    expect(profile.stableChrome).toEqual([]);
    expect(profile.warnings.some((w) => /chrome cannot be identified/u.test(w))).toBe(true);
  });

  it("still measures the fingerprints — only the verdict is withheld", () => {
    // The frequencies are a real observation and other passes read them. What
    // is refused is the *claim* that a structure is chrome.
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A))]);
    expect(Object.keys(profile.fingerprintFrequency).length).toBeGreaterThan(0);
  });

  it("recognises chrome again as soon as there are two pages — the positive control", () => {
    // Without this the fix would be indistinguishable from switching the
    // mechanism off. Two pages of one site share their banner, menu and footer,
    // and differ in the article.
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A)), file("b.htm", page(ARTICLE_B))]);
    expect(profile.files).toBe(2);
    expect(profile.stableChrome.length).toBeGreaterThan(0);
    expect(profile.warnings.some((w) => /chrome cannot be identified/u.test(w))).toBe(false);
  });

  it("removes the banner and keeps the article, on that two-page profile", () => {
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A)), file("b.htm", page(ARTICLE_B))]);
    const doc = parseHtml(page(ARTICLE_A));
    const result = removeBoilerplate(doc.root, profile);
    expect(result.removals.length).toBeGreaterThan(0);
    expect(result.removals.map((r) => r.text).join(" ")).not.toContain("Гарсиа Лорка не стал");
  });
});

describe("a profile that claims what it could not observe is refused at use", () => {
  /** A profile of the shape already written to disk by every one-page scan. */
  const stale: CorpusProfile = {
    files: 1,
    fingerprintFrequency: {},
    stableChrome: ["deadbeefdeadbeef"],
    lexicon: runCorpusPass([]).lexicon,
    encodings: {},
    columnWidthHistogram: {},
    warnings: [],
  };

  it("removes nothing and explains itself", () => {
    const doc = parseHtml(page(ARTICLE_A));
    const result = removeBoilerplate(doc.root, stale);
    expect(result.removals).toEqual([]);
    expect(result.warnings.some((w) => /built from 1 page/u.test(w))).toBe(true);
  });

  it("hands the table classifier no recurrence evidence either", () => {
    // The more destructive of the two consumers: `SHELL` is tier 1 at
    // confidence 0.95 and deletes the table. An empty map is what the
    // classifier already treats as "decide on the grid alone".
    const doc = parseHtml(page(ARTICLE_A));
    expect(frequencyForDocument(doc.root, { ...stale, fingerprintFrequency: { x: 1 } }).size).toBe(0);
  });

  it("still hands it evidence from a corpus that has some — non-firing", () => {
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A)), file("b.htm", page(ARTICLE_B))]);
    const doc = parseHtml(page(ARTICLE_A));
    expect(frequencyForDocument(doc.root, profile).size).toBeGreaterThan(0);
  });
});

describe("end to end: the documented scan-then-run workflow keeps the document", () => {
  it("converts the whole article when the profile was scanned over one page", async () => {
    const html = page(ARTICLE_A);
    const profile = runCorpusPass([file("a.htm", html)]);
    const result = await convert(Buffer.from(html, "utf8"), {
      profile: resolveProfile("spec-1.6"),
      corpusProfile: profile,
    });
    expect(result.markdown).toContain("Гарсиа Лорка не стал профессиональным музыкантом");
  });

  it("keeps it even against a stale profile that claims chrome it never saw", async () => {
    const html = page(ARTICLE_A);
    const result = await convert(Buffer.from(html, "utf8"), {
      profile: resolveProfile("spec-1.6"),
      corpusProfile: { ...runCorpusPass([file("a.htm", html)]), stableChrome: ["deadbeefdeadbeef"] },
    });
    expect(result.markdown).toContain("Гарсиа Лорка не стал профессиональным музыкантом");
    expect(result.warnings.some((w) => /built from 1 page/u.test(w))).toBe(true);
  });
});

/**
 * Chrome removal is *measured*, whether or not it is bounded.
 *
 * **A cumulative bound was built and killed here.** The per-candidate
 * `maxTextShare` guards were collectively unbounded, so the obvious next rule
 * was to apply the same share to their sum. Its own false-friend test refused
 * it: an ordinary short page whose banner, menu and footer are a third of its
 * visible text trips any bound low enough to have caught the misfire that
 * prompted it — which took 18.1 %, less than the false friend. The share of page
 * text does not separate content from furniture, and the destructive half of
 * that misfire was `classify.ts` returning `SHELL`, which this pass never saw.
 *
 * What survives is the measurement: the pass reports what it took, the CLI
 * prints it on every conversion, and nothing detaches until the sum is known.
 * Silence was the defect — a threshold that cannot tell the cases apart would
 * only have moved it.
 */
describe("chrome removal reports what it took", () => {
  it("reports the characters removed and the page they came from", () => {
    const profile = runCorpusPass([file("a.htm", page(ARTICLE_A)), file("b.htm", page(ARTICLE_B))]);
    const doc = parseHtml(page(ARTICLE_A));
    const result = removeBoilerplate(doc.root, profile);
    expect(result.removals.length).toBeGreaterThan(0);
    expect(result.removedText).toBeGreaterThan(0);
    expect(result.documentText).toBeGreaterThan(result.removedText);
    expect(textOf(doc.root)).toContain("Гарсиа Лорка не стал");
  });

  it("reports zero, not a stale number, when it declines the profile", () => {
    const doc = parseHtml(page(ARTICLE_A));
    const result = removeBoilerplate(doc.root, runCorpusPass([file("a.htm", page(ARTICLE_A))]));
    expect(result.removedText).toBe(0);
    expect(result.removals).toEqual([]);
  });
});
