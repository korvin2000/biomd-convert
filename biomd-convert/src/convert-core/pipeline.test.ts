import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { convert } from "./pipeline.js";
import { Lexicon } from "./lexicon.js";
import { read, directiveNames } from "../biomd-ast/index.js";
import { rewriteTarget, makeEntryLink, transliterateSlug, resolveResourcePath } from "./links.js";
import { checkConservation } from "./conservation.js";
import { runCorpusPass, fingerprint } from "./corpus.js";
import { parseHtml } from "../ladom/parse.js";

/**
 * A page shaped like the real corpus: windows-1251, a script-generated menu, a
 * tracking pixel, a PHP include, nested layout tables with pixel widths, a
 * `<font>`-wrapped biography with a manual hyphen wrap, and a genuine
 * discography table.
 */
const LEGACY_PAGE = `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">
<title>Гитаристы и композиторы :: Андрес Сеговия</title>
<script>document.write(topmenu());</script>
<style>.vt1 { font-family: Arial; }</style>
</head><body bgcolor="#FFFFFF">
<table width="760" border="0" cellspacing="0" cellpadding="0"><tr>
<td width="116" valign="top"><img src="i/counter.gif" width="1" height="1"><a href="index.html">Главная</a></td>
<td width="529" valign="top" class="vt1">
<h1>Андрес Сеговия</h1>
<p><font size="2">Андрес Сеговия — выдающийся испанский гита-
рист и педагог, основатель современной школы классической игры.
Его вклад в репертуар инструмента трудно переоценить.</font>
<p><font size="2">Родился в Линаресе. Из-
за отсутствия учителей он занимался самостоятельно.</font>
<table border="1" cellpadding="2">
<tr><th>Год</th><th>Альбом</th><th>Ноты</th></tr>
<tr><td>1958<td>Segovia Recital<td><a href="music/scores/a.pdf">PDF</a>
<tr><td>1962<td>Granada<td><a href="music/scores/b.pdf">PDF</a>
</table>
<p><font size="2">Подробнее см. <a href="andres-segovia-bio.html">биографию</a>.</font>
</td>
<td width="115" valign="top"><?php include("rail.php"); ?><img src="photo/segovia.jpg" width="100" height="140" alt="Портрет"></td>
</tr></table>
</body></html>`;

describe("convert — end to end on malformed legacy markup", () => {
  it("produces a valid document and conserves content", async () => {
    const lexicon = new Lexicon();
    // The corpus attests the joined form, which is what settles the wrap.
    lexicon.add("гитарист гитарист выдающийся гитарист и педагог");
    lexicon.add("из-за из-за отсутствия");

    const bytes = iconv.encode(LEGACY_PAGE, "windows-1251");
    const result = await convert(bytes, { lexicon });

    // --- step 1: decode and repair ---------------------------------------
    expect(result.encoding.codec).toBe("windows-1251");
    expect(result.repairedHtml).toContain("<tbody>"); // tree construction ran
    expect(result.head.title).toContain("Андрес Сеговия");

    // --- behaviour and server markup are gone ----------------------------
    expect(result.markdown).not.toContain("topmenu");
    expect(result.markdown).not.toContain("<?php");
    expect(result.markdown).not.toContain("include");
    expect(result.markdown).not.toContain("counter.gif");
    expect(result.markdown).not.toMatch(/<script|<style|<font/u);

    // --- the document is structurally valid ------------------------------
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);

    // --- content survived --------------------------------------------------
    expect(result.markdown).toContain("# Андрес Сеговия");
    expect(result.markdown).toContain("Родился в Линаресе");
    expect(result.markdown).toContain("Segovia Recital");

    // --- the hyphen wrap was joined, the lexical hyphen was not ----------
    expect(result.markdown).toContain("гитарист и педагог");
    expect(result.markdown).not.toContain("гита-");
    expect(result.markdown).toContain("Из-за");

    // --- the discography became a real Markdown table --------------------
    // Cells are padded to the widest entry, so assert on structure not spacing.
    expect(result.markdown).toMatch(/^\|\s*Год\s*\|\s*Альбом\s*\|\s*Ноты\s*\|$/mu);
    expect(result.markdown).toMatch(/^\|\s*1958\s*\|\s*Segovia Recital\s*\|/mu);
    // The resource link inside the cell stays a plain Markdown link, which is
    // what the target upgrades to a rich widget by extension.
    expect(result.markdown).toContain("[PDF](music/scores/a.pdf)");

    // --- links were rewritten to in-app routes ---------------------------
    expect(result.markdown).toContain("/#/andres-segovia-bio");

    // --- conservation holds ------------------------------------------------
    expect(result.conservation.failures).toEqual([]);
    expect(result.conservation.ok).toBe(true);

    // --- the output parses back as the intended directive structure -------
    const skeleton = read(result.markdown);
    expect(skeleton.warnings).toEqual([]);
  });

  it("classifies the layout scaffold and the data table differently", async () => {
    const result = await convert(iconv.encode(LEGACY_PAGE, "windows-1251"));
    const classes = result.classifications.map((c) => c.classification.class);
    // The 760px three-cell scaffold is not data; the bordered 3-column grid is.
    expect(classes).toContain("DATA");
    expect(classes.some((c) => c === "LAYOUT" || c === "HYBRID" || c === "UNKNOWN")).toBe(true);
  });

  it("keeps every source item accounted for in the ledger", async () => {
    const result = await convert(iconv.encode(LEGACY_PAGE, "windows-1251"));
    // Nothing may vanish without a terminal state naming a reason.
    for (const entry of result.ledger) {
      expect(entry.terminal.kind).toBeDefined();
      if (entry.terminal.kind === "REMOVED" || entry.terminal.kind === "REVIEW") {
        expect(entry.terminal.reason.length).toBeGreaterThan(0);
      }
    }
    const removals = result.ledger.filter((e) => e.terminal.kind === "REMOVED");
    expect(removals.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same bytes give byte-identical output", async () => {
    const bytes = iconv.encode(LEGACY_PAGE, "windows-1251");
    const a = await convert(bytes);
    const b = await convert(bytes);
    expect(a.markdown).toBe(b.markdown);
  });

  it("never emits a construct the target cannot render", async () => {
    const result = await convert(iconv.encode(LEGACY_PAGE, "windows-1251"));
    expect(result.markdown).not.toContain("divider:");
    expect(result.markdown).not.toMatch(/^:::\s*frame/mu);
    expect(result.markdown).not.toMatch(/^:::\s*signature/mu);
  });

  it("degrades without a browser rather than failing", async () => {
    const result = await convert(iconv.encode(LEGACY_PAGE, "windows-1251"));
    expect(result.measured).toBe(false);
    expect(result.markdown.length).toBeGreaterThan(100);
    expect(result.warnings.join(" ")).toMatch(/geometry unavailable/u);
  });
});

describe("link policy", () => {
  const cases: Array<[string, string, string]> = [
    ["a page becomes an in-app route", "andres-segovia.html", "/#/andres-segovia"],
    ["an .htm page too", "segovia.htm", "/#/segovia"],
    ["a nested path keeps only the basename", "bio/andres-segovia.html", "/#/andres-segovia"],
    ["a gallery path keeps its extension", "/guitar_art/galery/x.html", "/#/x.html"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(rewriteTarget(input).href).toBe(expected));
  }

  it("leaves a resource path alone", () => {
    expect(rewriteTarget("music/midi/a.mid")).toMatchObject({ kind: "resource", rewritten: false });
  });

  it("leaves an external site alone", () => {
    expect(rewriteTarget("https://example.com/x.html")).toMatchObject({ kind: "external", rewritten: false });
  });

  it("rewrites an absolute URL pointing at this site", () => {
    expect(rewriteTarget("http://abc-guitars.com/segovia.html").href).toBe("/#/segovia");
  });

  it("drops a javascript: target", () => {
    expect(rewriteTarget("javascript:void(0)")).toMatchObject({ kind: "unsafe", href: "" });
  });

  it("passes anchors and mailto through", () => {
    expect(rewriteTarget("#top").kind).toBe("anchor");
    expect(rewriteTarget("mailto:a@b.c").kind).toBe("mailto");
  });

  it("warns when a route would not match the app's ASCII slug pattern", () => {
    const result = rewriteTarget("сеговия.html");
    expect(result.kind).toBe("entry");
    expect(result.warning).toMatch(/ASCII slug/u);
  });

  it("transliterates a new cross-link so it can actually navigate", () => {
    const link = makeEntryLink("Андрес Сеговия");
    expect(link.transliterated).toBe(true);
    expect(link.slug).toBe("andres-segoviya");
    expect(/^[\w.-]+$/u.test(link.slug)).toBe(true);
  });

  it("leaves an already-valid slug untouched", () => {
    expect(makeEntryLink("andres-segovia")).toMatchObject({ transliterated: false });
  });

  it("resolves resource paths against the configured base", () => {
    expect(resolveResourcePath("music/x.mp3")).toBe("/pages/music/x.mp3");
    expect(resolveResourcePath("/music/x.mp3")).toBe("/pages/music/x.mp3");
    expect(resolveResourcePath("/pages/music/x.mp3")).toBe("/pages/music/x.mp3");
    expect(resolveResourcePath("https://x.com/a.mp3")).toBe("https://x.com/a.mp3");
  });
});

describe("conservation gate", () => {
  it("passes when the text survives with mechanical repairs", () => {
    const report = checkConservation({
      sourceText: "Андрес Сеговия — выдающийся испанский гита- рист и педагог школы",
      outputText: "Андрес Сеговия — выдающийся испанский гитарист и педагог школы",
      sourceTargets: [],
      outputTargets: [],
      sourceImages: [],
      outputImages: [],
    });
    expect(report.ok).toBe(true);
  });

  it("fails when a sentence is dropped", () => {
    const report = checkConservation({
      sourceText: "Первое предложение здесь. Второе предложение тоже здесь. Третье предложение вот.",
      outputText: "Первое предложение здесь.",
      sourceTargets: [],
      outputTargets: [],
      sourceImages: [],
      outputImages: [],
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toMatch(/recall/u);
  });

  it("fails when a link disappears", () => {
    const report = checkConservation({
      sourceText: "текст",
      outputText: "текст",
      sourceTargets: ["/#/a", "/#/b"],
      outputTargets: ["/#/a"],
      sourceImages: [],
      outputImages: [],
    });
    expect(report.ok).toBe(false);
    expect(report.targets.missing).toEqual(["/#/b"]);
  });

  it("fails when an image is invented", () => {
    const report = checkConservation({
      sourceText: "текст",
      outputText: "текст",
      sourceTargets: [],
      outputTargets: [],
      sourceImages: ["a.jpg"],
      outputImages: ["a.jpg", "b.jpg"],
    });
    expect(report.ok).toBe(false);
    expect(report.images.extra).toEqual(["b.jpg"]);
  });
});

describe("corpus pass", () => {
  it("identifies repeated chrome and builds a lexicon", () => {
    const nav = '<table width="760"><tr><td><a href="i.html">Главная</a> | <a href="a.html">Авторы</a></td></tr></table>';
    const files = [1, 2, 3, 4].map((n) => ({
      name: `p${n}.html`,
      bytes: Buffer.from(`<html><body>${nav}<p>Уникальный текст страницы номер ${n} про музыку.</p></body></html>`, "utf8"),
    }));

    const profile = runCorpusPass(files);
    expect(profile.files).toBe(4);
    expect(profile.stableChrome.length).toBeGreaterThan(0);

    const lexicon = Lexicon.fromJSON(profile.lexicon);
    expect(lexicon.count("музыку")).toBe(4);
    expect(lexicon.count("главная")).toBe(4);
  });

  it("does not mark a recurring template with varying content as chrome", () => {
    // Same discography structure on every page, different albums: a content
    // template, not chrome. Removing it would delete the article.
    const files = ["Recital", "Granada", "Castelnuovo", "Ponce"].map((album, n) => ({
      name: `p${n}.html`,
      bytes: Buffer.from(
        `<html><body><table border="1"><tr><th>Год</th><th>Альбом</th></tr><tr><td>19${60 + n}</td><td>${album} большая запись студии</td></tr></table></body></html>`,
        "utf8",
      ),
    }));
    const profile = runCorpusPass(files);
    const doc = parseHtml(files[0]!.bytes.toString("utf8"));
    const table = [...doc.index.values()].find((n) => n.tag === "table");
    const fp = table ? fingerprint(table) : "";
    expect(profile.fingerprintFrequency[fp]).toBe(1);
    expect(profile.stableChrome).not.toContain(fp);
  });
});
