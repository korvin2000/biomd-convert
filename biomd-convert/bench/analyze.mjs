// Per-axis loss analysis against the reference set.
// Usage: node bench/analyze.mjs [actualDir] [--file name] [--axis text|headings|...]
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractFacts, foldTarget, visibleText } from "../dist/eval/facts.js";
import { multisetScore, scoreDocuments } from "../dist/eval/score.js";
import { shingles } from "../dist/convert-core/conservation.js";

const args = process.argv.slice(2);
const actualDir = resolve(args.find((a) => !a.startsWith("--")) ?? "bench/out");
const only = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const axisFilter = args.includes("--axis") ? args[args.indexOf("--axis") + 1] : null;
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 12);
const expectedDir = resolve("fixtures/out");

const entries = (await readdir(expectedDir)).filter((e) => e.endsWith(".bio.md")).sort();
const agg = { headingsMissing: [], headingsExtra: [], dirMissing: [], dirExtra: [], imgMissing: [], imgExtra: [], linkMissing: [], linkExtra: [] };

for (const entry of entries) {
  const name = entry.replace(/\.bio\.md$/u, "");
  if (only && name !== only) continue;
  const expected = await readFile(join(expectedDir, entry), "utf8");
  let actual = "";
  try { actual = await readFile(join(actualDir, entry), "utf8"); } catch { }
  const e = extractFacts(expected);
  const a = extractFacts(actual);
  const s = scoreDocuments(name, expected, actual);

  const line = (label, sc) => `  ${label.padEnd(11)} f1=${(sc.f1 * 100).toFixed(1).padStart(5)}  r=${(sc.recall * 100).toFixed(1).padStart(5)}  p=${(sc.precision * 100).toFixed(1).padStart(5)}  want=${String(sc.expected).padStart(4)} got=${String(sc.actual).padStart(4)}`;
  console.log(`\n=== ${name}  overall=${(s.overall * 100).toFixed(1)} ===`);
  console.log(line("text", s.text));
  console.log(line("headings", s.headings));
  console.log(line("links", s.links));
  console.log(line("images", s.images));
  console.log(line("directives", s.directives));
  console.log(line("tableCells", s.tableCells));
  console.log(`  tableShape  ${(s.tableShape * 100).toFixed(1)}   want ${s.expectedTables.length} tables ${JSON.stringify(s.expectedTables.map((t) => [t.rows, t.cols]))}  got ${s.actualTables.length} ${JSON.stringify(s.actualTables.map((t) => [t.rows, t.cols]))}`);

  const diff = (label, want, have, bag) => {
    const wc = new Map(); for (const x of want) wc.set(x, (wc.get(x) ?? 0) + 1);
    const hc = new Map(); for (const x of have) hc.set(x, (hc.get(x) ?? 0) + 1);
    const miss = [], extra = [];
    for (const [k, n] of wc) { const d = n - (hc.get(k) ?? 0); for (let i = 0; i < d; i++) miss.push(k); }
    for (const [k, n] of hc) { const d = n - (wc.get(k) ?? 0); for (let i = 0; i < d; i++) extra.push(k); }
    if (miss.length) console.log(`  -${label} missing (${miss.length}): ${miss.slice(0, limit).map((x) => JSON.stringify(x)).join(", ")}`);
    if (extra.length) console.log(`  +${label} extra   (${extra.length}): ${extra.slice(0, limit).map((x) => JSON.stringify(x)).join(", ")}`);
    if (bag) { agg[bag[0]].push(...miss.map((m) => `${name}: ${m}`)); agg[bag[1]].push(...extra.map((m) => `${name}: ${m}`)); }
  };

  const flat = (m) => { const o = []; for (const [k, n] of m) for (let i = 0; i < n; i++) o.push(k); return o; };
  if (!axisFilter || axisFilter === "headings") diff("head", e.headings, a.headings, ["headingsMissing", "headingsExtra"]);
  if (!axisFilter || axisFilter === "directives") diff("dir", flat(e.directives), flat(a.directives), ["dirMissing", "dirExtra"]);
  if (!axisFilter || axisFilter === "images") diff("img", e.images.map(foldTarget), a.images.map(foldTarget), ["imgMissing", "imgExtra"]);
  if (!axisFilter || axisFilter === "links") diff("link", e.links.map(foldTarget), a.links.map(foldTarget), ["linkMissing", "linkExtra"]);
  if (axisFilter === "text") {
    const want = shingles(visibleText(e), 5), have = shingles(visibleText(a), 5);
    const miss = []; for (const [k, n] of want) { const f = Math.min(n, have.get(k) ?? 0); for (let i = 0; i < n - f; i++) miss.push(k); }
    const ex = []; for (const [k, n] of have) { const f = Math.min(n, want.get(k) ?? 0); for (let i = 0; i < n - f; i++) ex.push(k); }
    console.log(`  -text missing (${miss.length}):`); for (const m of miss.slice(0, limit)) console.log(`      ${m}`);
    console.log(`  +text extra   (${ex.length}):`); for (const m of ex.slice(0, limit)) console.log(`      ${m}`);
  }
}

if (!only) {
  console.log("\n\n########## AGGREGATE ##########");
  const tally = (label, arr) => {
    const c = new Map();
    for (const x of arr) { const k = x.split(": ").slice(1).join(": "); c.set(k, (c.get(k) ?? 0) + 1); }
    console.log(`\n${label} (${arr.length}):`);
    for (const [k, n] of [...c].sort((x, y) => y[1] - x[1]).slice(0, 25)) console.log(`  ${String(n).padStart(3)} × ${k}`);
  };
  tally("directives MISSING", agg.dirMissing);
  tally("directives EXTRA", agg.dirExtra);
  tally("images MISSING", agg.imgMissing);
  tally("images EXTRA", agg.imgExtra);
  tally("links MISSING", agg.linkMissing);
  tally("links EXTRA", agg.linkExtra);
  console.log(`\nheadings MISSING: ${agg.headingsMissing.length}, EXTRA: ${agg.headingsExtra.length}`);
}
