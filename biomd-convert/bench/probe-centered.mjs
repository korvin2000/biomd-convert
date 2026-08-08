// Dump every short centred block with its signature, so the section-label
// detector can be designed from the corpus instead of guessed at.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeHtml, parseHtml, quarantineServerMarkup, sanitizeS1, dropHead, normalize } from "../dist/ladom/index.js";
import { removeBoilerplate } from "../dist/convert-core/boilerplate.js";
import { walkElements, textOf } from "../dist/ladom/types.js";
import { prominenceOf } from "../dist/convert-core/prominence.js";
import { extractFacts, foldLabel } from "../dist/eval/facts.js";

const corpus = JSON.parse(await readFile("bench/corpus/corpus-profile.json", "utf8"));
const names = process.argv.slice(2);

for (const name of names) {
  const bytes = await readFile(join("fixtures/html", `${name}.htm`));
  const doc = parseHtml(quarantineServerMarkup(decodeHtml(bytes).text).text);
  sanitizeS1(doc.root); dropHead(doc.root); removeBoilerplate(doc.root, corpus);
  normalize(doc.root, { useGeometry: false });

  const want = new Set(
    extractFacts(await readFile(join("fixtures/out", `${name}.bio.md`), "utf8")).headings
      .map((h) => h.split("\t")[1]),
  );

  console.log(`\n##### ${name}`);
  const CAND = new Set(["p", "div", "td", "th", "center", "span", "font", "li", "b"]);
  for (const el of walkElements(doc.root)) {
    if (!CAND.has(el.tag)) continue;
    const text = textOf(el).replace(/\s+/g, " ").trim();
    if (text === "" || text.length > 170) continue;
    // innermost block-ish carrier only
    let inner = false;
    for (const c of el.children) {
      if (c.kind === "element" && CAND.has(c.tag) && textOf(c).replace(/\s+/g, " ").trim().length >= text.length) inner = true;
    }
    if (inner) continue;
    const p = prominenceOf(el);
    if (!p.centered) continue;
    const hit = want.has(foldLabel(text)) ? "HEAD" : "    ";
    const cls = el.attrs["class"] ?? el.parent?.attrs["class"] ?? "-";
    console.log(
      `  ${hit} <${el.tag}.${cls}> px=${p.fontPx?.toFixed(0) ?? "-"} b=${p.bold ? 1 : 0} img=${el.metrics.images} lnk=${el.metrics.links} len=${text.length} :: ${text.slice(0, 80)}`,
    );
  }
}
