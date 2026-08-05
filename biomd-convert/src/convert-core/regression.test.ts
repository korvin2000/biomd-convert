/**
 * Regressions for bugs that were found by running the pipeline, not by reading
 * it. Each one was silent, and two of them were only reachable in the
 * better-configured run — which is the shape of defect most worth pinning.
 */
import { describe, expect, it } from "vitest";
import { convert } from "./pipeline.js";
import { checkConservation } from "./conservation.js";
import { Lexicon } from "./lexicon.js";
import { normalize } from "../ladom/normalize.js";
import { parseHtml } from "../ladom/parse.js";
import { walkElements } from "../ladom/types.js";
import { runCorpusPass } from "./corpus.js";

describe("measurement must not delete zero-extent structure", () => {
  it("keeps <br> even though a browser reports it as having no visual extent", () => {
    // The measured-invisible rule exists to drop layout scaffolding. A <br> has
    // zero width by construction, so it was being caught by it — meaning that
    // turning measurement ON silently destroyed every hard break.
    const doc = parseHtml("<body><p>a<br>b</p></body>");
    for (const el of walkElements(doc.root)) {
      if (el.tag === "br") {
        el.visible = false;
        el.box = { x: 0, y: 0, w: 0, h: 0 };
      }
    }
    normalize(doc.root, { useGeometry: true });
    expect([...walkElements(doc.root)].some((e) => e.tag === "br")).toBe(true);
  });

  it("still drops a genuinely invisible empty container", () => {
    const doc = parseHtml('<body><div id="ghost"></div><p>x</p></body>');
    for (const el of walkElements(doc.root)) {
      if (el.attrs["id"] === "ghost") {
        el.visible = false;
        el.box = { x: 0, y: 0, w: 0, h: 0 };
      }
    }
    normalize(doc.root, { useGeometry: true });
    expect([...walkElements(doc.root)].some((e) => e.attrs["id"] === "ghost")).toBe(false);
  });

  it("renders a hard break rather than concatenating the two sides", async () => {
    const html = '<body><td><a href="a.html">Сеговия</a><br><a href="b.html">Льобет</a></td></body>';
    const result = await convert(Buffer.from(html, "utf8"));
    // Without the break the two names fuse into one nonsense token.
    expect(result.markdown).not.toMatch(/Сеговия\]\([^)]*\)\[Льобет/u);
    expect(result.markdown).toContain("\\\n");
  });

  it("does not emit an escaped space where a spacer image was removed", async () => {
    const html = '<body><td><img src="i/spacer.gif" width="1" height="1"><br><a href="a.html">Ссылка</a></td></body>';
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).not.toContain("&#x20;");
    // A break with nothing before it has nothing to separate.
    expect(result.markdown.trimStart().startsWith("\\")).toBe(false);
  });
});

describe("conservation accounts for explicitly removed content", () => {
  it("does not report removed chrome as a loss", () => {
    const report = checkConservation({
      sourceText: "Главная Авторы Ссылки Андрес Сеговия испанский гитарист и педагог школы",
      outputText: "Андрес Сеговия испанский гитарист и педагог школы",
      sourceTargets: ["/#/index", "/#/a"],
      outputTargets: ["/#/a"],
      sourceImages: ["logo.gif", "photo.jpg"],
      outputImages: ["photo.jpg"],
      accounted: {
        text: "Главная Авторы Ссылки",
        targets: ["/#/index"],
        images: ["logo.gif"],
      },
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    // The shingles spanning the cut are excused, and counted so the discount is
    // visible rather than hidden.
    expect(report.text.seamShingles).toBeGreaterThan(0);
  });

  it("still catches a real loss next to removed chrome", () => {
    const report = checkConservation({
      sourceText: "Главная Авторы Ссылки Андрес Сеговия испанский гитарист и педагог школы игры навсегда",
      outputText: "Андрес Сеговия",
      sourceTargets: [],
      outputTargets: [],
      sourceImages: [],
      outputImages: [],
      accounted: { text: "Главная Авторы Ссылки" },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toMatch(/recall/u);
  });

  it("does not excuse content that was never accounted for", () => {
    const report = checkConservation({
      sourceText: "первое второе третье четвёртое пятое шестое седьмое восьмое девятое",
      outputText: "первое второе третье",
      sourceTargets: [],
      outputTargets: [],
      sourceImages: [],
      outputImages: [],
    });
    expect(report.ok).toBe(false);
  });
});

describe("the lexicon refuses to learn from hyphen wraps", () => {
  it("does not record the fragments of a wrapped word as standalone words", () => {
    const lex = new Lexicon();
    lex.add("он ушёл из-\nза дождя и вернулся");
    // Recording `из` and `за` here would manufacture exactly the evidence the
    // de-hyphenation cascade consults, and would teach it the wrong answer.
    expect(lex.count("из")).toBe(0);
    expect(lex.count("за")).toBe(0);
    expect(lex.count("дождя")).toBe(1);
  });

  it("still records genuine standalone occurrences elsewhere", () => {
    const lex = new Lexicon();
    lex.add("из-\nза дождя");
    lex.add("он вышел из дома");
    expect(lex.count("из")).toBe(1);
  });
});

describe("the corpus pass must not learn from stylesheets or scripts", () => {
  it("keeps CSS identifiers out of the lexicon", () => {
    // <style> and <script> bodies are text nodes in the tree. Reading text
    // before S1 runs teaches the lexicon `font-family` and `sans-serif`, which
    // then act as hyphenated-form evidence in the de-hyphenation cascade.
    const html = `<html><head><style>.v { font-family: sans-serif; font-size: 12px }</style>
<script>var topMenu = buildMenu();</script></head>
<body><p>Настоящий текст страницы про музыку.</p></body></html>`;
    const profile = runCorpusPass([{ name: "a.html", bytes: Buffer.from(html, "utf8") }]);
    const lex = Lexicon.fromJSON(profile.lexicon);

    expect(lex.hyphenatedCount("font-family")).toBe(0);
    expect(lex.hyphenatedCount("sans-serif")).toBe(0);
    expect(lex.count("buildmenu")).toBe(0);
    expect(lex.count("музыку")).toBe(1);
  });
});
