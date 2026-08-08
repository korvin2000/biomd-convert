/**
 * Document shaping: the outline, the chrome, and the constructs a legacy page
 * expresses with `<br>` and `align=`.
 *
 * Each of these was producing output that validated and lost information at the
 * same time — no `#` at all, an article wrapped in `>`, a site menu emitted as
 * body text, a portrait glued to the first word of the biography.
 */
import { describe, expect, it } from "vitest";
import type { BiomdContent } from "../biomd-ast/types.js";
import { convert } from "./pipeline.js";
import { enforceSingleTitle } from "./structure.js";
import { runCorpusPass } from "./corpus.js";
import { recoverHeadings } from "./headings.js";
import { removeBoilerplate } from "./boilerplate.js";
import { normalize } from "../ladom/normalize.js";
import { parseHtml } from "../ladom/parse.js";
import { dropHead, sanitizeS1 } from "../ladom/sanitize.js";
import { walkElements } from "../ladom/types.js";
import { cssLengthPx, declaredFontPx } from "./prominence.js";

const CHROME = `<table border="0" width="760"><tr><td width="760">
  <a href="menu.htm"><img src="use/album.gif" width="123" height="142"></a>
  </td></tr></table>`;

function page(title: string, body: string): string {
  return `<html><head><title>Словарь</title></head><body>
  ${CHROME}
  <table border="0" width="760"><tr><td width="458">
    <div class="vt1" style="COLOR: #A7876F; FONT: bold 20pt Arial; WIDTH: 100%">
      <p align="center"><font color="#D5A96F"><span>${title}</span></font></p>
    </div>
  </td></tr></table>
  <table border="0" width="760"><tr><td width="529">${body}</td></tr></table>
  </body></html>`;
}

const PROSE =
  "<p>Он был выдающимся гитаристом своего поколения и оставил обширное наследие, " +
  "которое до сих пор изучают исполнители по всему миру, а его записи переиздаются " +
  "регулярно и остаются образцом для подражания.</p>";

describe("prominence", () => {
  it("reads a size out of the `font:` shorthand FrontPage emitted", () => {
    const doc = parseHtml('<body><div style="COLOR: red; FONT: bold 20pt Arial; WIDTH: 100%">x</div></body>');
    const div = [...walkElements(doc.root)].find((e) => e.tag === "div");
    // 20pt is 26.67px; a plain `font-size:` scan finds nothing here at all.
    expect(declaredFontPx(div!)).toBeCloseTo(26.67, 1);
  });

  it("resolves legacy units", () => {
    expect(cssLengthPx("12pt")).toBeCloseTo(16, 5);
    expect(cssLengthPx("18px")).toBe(18);
    expect(cssLengthPx("1.5em")).toBe(24);
  });

  it("maps a relative <font size> onto the legacy scale", () => {
    const doc = parseHtml('<body><b size="+2">x</b></body>');
    const b = [...walkElements(doc.root)].find((e) => e.tag === "b");
    expect(declaredFontPx(b!)).toBeGreaterThan(16);
  });
});

describe("heading recovery", () => {
  it("recovers the title from typography when no <h1> exists", async () => {
    const result = await convert(Buffer.from(page("Агустин Барриос", PROSE), "utf8"));
    expect(result.markdown).toMatch(/^# Агустин Барриос$/mu);
    // §18: exactly one level-1 heading, which used to fail on every document.
    expect(result.diagnostics.filter((d) => d.code === "h1-count")).toHaveLength(0);
  });

  it("joins a title the author hand-wrapped with <br> inside one block", async () => {
    const result = await convert(Buffer.from(page("Олег Николаевич<br>Киселев", PROSE), "utf8"));
    expect(result.markdown).toMatch(/^# Олег Николаевич Киселев$/mu);
    expect(result.markdown).not.toMatch(/^=+$/mu);
  });

  it("keeps a title the author wrote as two blocks as two title lines", async () => {
    // The containment half of the masthead contract. The same two words, set
    // the same way, mean different things depending on how the author divided
    // them: a `<br>` inside one block is a hand-wrap to fit a 458 px cell (the
    // test above), two blocks are two lines the author drew — and BioMD writes
    // one headline over two lines as consecutive `#` inside the alignment that
    // sets them as a block. `#` + `##` would assert a hierarchy a name split in
    // half does not have.
    const asBlocks = `<p align="center"><span>Лос-Анджелесский</span></p><p align="center"><span>гитарный квартет</span></p>`;
    const html = `<html><head><title>Словарь</title></head><body>${CHROME}
      <table border="0" width="760"><tr><td width="458">
        <div class="vt1" style="COLOR: #A7876F; FONT: bold 20pt Arial; WIDTH: 100%">${asBlocks}</div>
      </td></tr></table>
      <table border="0" width="760"><tr><td width="529">${PROSE}</td></tr></table></body></html>`;
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toMatch(
      /::: align\nposition: center\n\n# Лос-Анджелесский\n\n# гитарный квартет\n\n:::/u,
    );
  });

  it("makes the smaller half of a wrapped masthead a subtitle, not a second title", async () => {
    // The discriminator is the lines' typography compared with each other, not
    // an absolute size: the second line here declares its own smaller size
    // inside a box that declares 20pt for everything else.
    const title = 'Ричи Блэкмор<br><font size="3">Ritchie Blackmore &amp; Blackmore\'s Night</font>';
    const result = await convert(Buffer.from(page(title, PROSE), "utf8"));
    expect(result.markdown).toMatch(/^# Ричи Блэкмор$/mu);
    expect(result.markdown).toMatch(/^## Ritchie Blackmore & Blackmore's Night$/mu);
    // A title and its subtitle are two headings; the alignment container is
    // only what makes *equal* lines read as one headline.
    expect(result.markdown).not.toMatch(/::: align\nposition: center\n\n# Ричи/u);
  });

  it("reads the same masthead through a renamed class and permuted attributes", async () => {
    // The invariant is typography and containment; nothing in the rule may be
    // able to name this corpus. Same shape, no `vt1`, no `<span>`, attributes
    // in another order.
    //
    // Known limit, not asserted here: a box written as `<center>` is unwrapped
    // by `normalize` before heading recovery runs, which leaves the lines with
    // no box to be lines of. All 22 mastheads in the corpus use a `<div>`.
    const masthead =
      `<div id="hdr" class="q7" style="WIDTH: 100%; FONT: bold 20pt Arial; COLOR: #A7876F">` +
      `<p align="center">Лос-Анджелесский</p><p align="center">гитарный квартет</p></div>`;
    const html = `<html><head><title>Словарь</title></head><body>${CHROME}
      <table border="0" width="760"><tr><td width="458">${masthead}</td></tr></table>
      <table border="0" width="760"><tr><td width="529">${PROSE}</td></tr></table></body></html>`;
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toMatch(
      /::: align\nposition: center\n\n# Лос-Анджелесский\n\n# гитарный квартет\n\n:::/u,
    );
  });

  it("false friend: a smaller line in its own block stays a block, not a heading", async () => {
    // `goya2`'s masthead — a name over a smaller `(дискография)`, written as two
    // `<p>`. A separate block the author set smaller is a separate block; only a
    // `<br>` continuation is still headline matter, and the reference agrees.
    const masthead = `<p align="center"><span>Френсис Гойя</span></p><p align="center"><span><font size="4">(дискография)</font></span></p>`;
    const html = `<html><head><title>Словарь</title></head><body>${CHROME}
      <table border="0" width="760"><tr><td width="458">
        <div class="vt1" style="COLOR: #A7876F; FONT: bold 20pt Arial; WIDTH: 100%">${masthead}</div>
      </td></tr></table>
      <table border="0" width="760"><tr><td width="529">${PROSE}</td></tr></table></body></html>`;
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).toMatch(/^# Френсис Гойя$/mu);
    expect(result.markdown).not.toMatch(/^#+ \(дискография\)$/mu);
    expect(result.markdown).toContain("(дискография)");
  });

  it("keeps adjacent title lines but demotes a title that stands apart", () => {
    // The false friend §20.6 named, stated on the pass that decides it: two
    // headings *separated by content* are two competing titles and the later
    // one is demoted; two adjacent ones are the halves of one wrapped headline
    // and demoting either asserts a hierarchy the headline does not have.
    const heading = (depth: 1 | 2, text: string): BiomdContent => ({
      type: "heading",
      depth,
      children: [{ type: "text", value: text }],
    });
    const wrapped = heading(1, "Иоганн Себастьян");
    const wrappedTail = heading(1, "Бах");
    const competing = heading(1, "Второй заголовок");
    const root = {
      type: "root" as const,
      children: [
        { type: "biomdAlign" as const, position: "center" as const, children: [wrapped, wrappedTail] },
        { type: "paragraph" as const, children: [{ type: "text" as const, value: PROSE }] },
        competing,
      ] as BiomdContent[],
    };
    const result = enforceSingleTitle(root as never);
    expect(wrapped.depth).toBe(1);
    expect(wrappedTail.depth).toBe(1);
    expect(competing.depth).toBe(2);
    expect(result.changes).toHaveLength(1);
  });

  it("strips emphasis inside a heading", async () => {
    const result = await convert(Buffer.from(page("<b>Андрес</b> Сеговия", PROSE), "utf8"));
    expect(result.markdown).toMatch(/^# Андрес Сеговия$/mu);
  });

  it("does not promote an emphasized opening sentence to a section heading", () => {
    const doc = parseHtml(
      '<body><p><b style="font-size:14pt">14 августа 2020 года в Англии в возрасте 87 лет ' +
        "умер выдающийся британский гитарист и лютнист.</b></p>" +
        `${PROSE}${PROSE}</body>`,
    );
    sanitizeS1(doc.root);
    normalize(doc.root, { useGeometry: false });
    const decisions = recoverHeadings(doc.root);
    expect(decisions.filter((d) => d.depth === 2)).toHaveLength(0);
  });
});

describe("blockquote used for indentation", () => {
  it("does not wrap a whole article in a quotation", async () => {
    const html = page("Заголовок", `<blockquote>${PROSE}${PROSE}${PROSE}</blockquote>`);
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).not.toMatch(/^>/mu);
  });

  it("does not quote a short one either, when nothing was measured", async () => {
    // This asserted the opposite until the corpus was measured. The tag alone
    // is not evidence: `kiselev` indents six track lists with `<blockquote>`
    // and `tarrega` indents a nine-block score catalogue, headings and lists
    // among them, and the references quote none of it. §3.5 wants *combined*
    // evidence, so with no measurement there is none to combine and emitting a
    // quotation asserts something unevidenced. Flattening keeps every word and
    // stays valid BioMD, which is the sane degradation.
    //
    // The positive contract lives in `recovery.test.ts`, on `mdMeasured` —
    // `convert()` here falls back to `NullMeasurer` and leaves `el.style`
    // undefined, so a rule keyed on computed style cannot be exercised at all.
    const html = page(
      "Заголовок",
      `${PROSE}${PROSE}<blockquote><p>Гитара — это маленький оркестр.</p></blockquote>${PROSE}`,
    );
    const result = await convert(Buffer.from(html, "utf8"));
    expect(result.markdown).not.toMatch(/^>/mu);
    expect(result.markdown).toContain("Гитара — это маленький оркестр.");
  });

  it("unwraps a blockquote containing a table, so the table is reachable", async () => {
    const table = `<table border="1"><tr><th>Работа</th><th>Ноты</th></tr>
      <tr><td>La Catedral</td><td><a href="a.txt">TAB</a></td></tr>
      <tr><td>Julia Florida</td><td><a href="b.txt">TAB</a></td></tr></table>`;
    const result = await convert(Buffer.from(page("Заголовок", `<blockquote>${table}</blockquote>`), "utf8"));
    // Inside a blockquote every row would be prefixed `> |` and no consumer that
    // scans for a table would find one.
    expect(result.markdown).toMatch(/^\| Работа \| Ноты \|$/mu);
  });
});

describe("boilerplate removal", () => {
  const corpusOf = (bodies: readonly string[]) =>
    runCorpusPass(
      bodies.map((body, i) => ({ name: `p${i}.html`, bytes: Buffer.from(body, "utf8") })),
      { chromeThreshold: 0.7 },
    );

  it("removes a structure that recurs with the same text across the corpus", () => {
    const pages = ["Первый", "Второй", "Третий", "Четвёртый"].map((t) => page(t, PROSE));
    const profile = corpusOf(pages);
    expect(profile.stableChrome.length).toBeGreaterThan(0);

    const doc = parseHtml(pages[0] as string);
    sanitizeS1(doc.root);
    dropHead(doc.root);
    const { removals } = removeBoilerplate(doc.root, profile);
    expect(removals.length).toBeGreaterThan(0);
    expect(removals.some((r) => r.text.includes("Агустин"))).toBe(false);
  });

  it("keeps a recurring structure that carries this page's article", () => {
    // The outer scaffold recurs on every page too; removing it would delete the
    // document. Text share is the guard, and it has to hold.
    const pages = ["Первый", "Второй", "Третий", "Четвёртый"].map((t) => page(t, PROSE));
    const profile = corpusOf(pages);
    const doc = parseHtml(pages[0] as string);
    sanitizeS1(doc.root);
    dropHead(doc.root);
    removeBoilerplate(doc.root, profile);
    const remaining = [...walkElements(doc.root)].map((e) => e.tag);
    expect(remaining).toContain("p");
  });

  it("does nothing without a corpus profile, and says so", async () => {
    const result = await convert(Buffer.from(page("Заголовок", PROSE), "utf8"));
    expect(result.warnings.join(" ")).toMatch(/No corpus profile/u);
  });
});

describe("floated images", () => {
  it("hoists a right-floated portrait out of the paragraph it wraps", async () => {
    const body = `<p><img src="photo/x.jpg" align="right" width="108" height="146" alt="Портрет">${PROSE.slice(3)}`;
    const result = await convert(Buffer.from(page("Заголовок", body), "utf8"));
    expect(result.markdown).toContain("::: image");
    expect(result.markdown).toContain("position: right");
    // And it must not also survive as an inline image, which would duplicate it.
    expect(result.markdown).not.toContain("![Портрет]");
  });

  it("leaves a genuinely inline image inline", async () => {
    const body = `<p>текст <img src="icon.gif" width="16" height="16"> ещё текст</p>`;
    const result = await convert(Buffer.from(page("Заголовок", body), "utf8"));
    expect(result.markdown).toContain("текст ![](icon.gif) ещё текст");
  });
});

describe("nav", () => {
  const menu = (items: string) => page("Заголовок", `<p>${items}</p>${PROSE}`);

  it("recognises a <br>-separated stack of links", async () => {
    const result = await convert(
      Buffer.from(
        menu(
          '<a href="a.htm">Первый альбом</a><br><a href="b.htm">Второй альбом</a><br>' +
            '<a href="c.htm">Третий альбом</a><br><a href="d.htm">Четвёртый альбом</a>',
        ),
        "utf8",
      ),
    );
    expect(result.markdown).toContain("::: nav");
    expect(result.markdown).toContain("- [Первый альбом](/#/a)");
  });

  it("recognises a bracketed pagination strip and its current page", async () => {
    const result = await convert(
      Buffer.from(
        menu(
          '[<a href="news.htm">Последние</a> ] [<a href="news_2008.htm">2008</a> ] ' +
            "[<font> 2007</font> ] [<a href=\"news_2006.htm\">2006</a> ]",
        ),
        "utf8",
      ),
    );
    expect(result.markdown).toContain("::: nav");
    // §11: the source-backed current item may be plain text, named by `active`.
    expect(result.markdown).toContain("active: 2007");
  });

  it("leaves a paragraph that merely contains links alone", async () => {
    const result = await convert(
      Buffer.from(
        menu(
          'Смотрите также <a href="a.htm">первую</a> и <a href="b.htm">вторую</a> ' +
            'статьи, а также <a href="c.htm">третью</a>.',
        ),
        "utf8",
      ),
    );
    expect(result.markdown).not.toContain("::: nav");
  });

  it("does not turn two links into a menu", async () => {
    const result = await convert(
      Buffer.from(menu('<a href="a.htm">Первый</a><br><a href="b.htm">Второй</a>'), "utf8"),
    );
    expect(result.markdown).not.toContain("::: nav");
  });
});
