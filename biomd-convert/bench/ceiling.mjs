// How much of the remaining gap is *recoverable* from the source at all?
// A reference heading whose words do not occur in the source HTML was invented
// by the human migrator; no deterministic pass can produce it.
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractFacts } from "../dist/eval/facts.js";
import { decodeHtml } from "../dist/ladom/encoding.js";
import { normalizeForCompare } from "../dist/convert-core/conservation.js";

const expectedDir = resolve("fixtures/out");
const actualDir = resolve(process.argv[2] ?? "bench/out");
const htmlDir = resolve("fixtures/html");

let backed = 0;
let invented = 0;
const inventedList = [];
const backedList = [];

for (const entry of (await readdir(expectedDir)).filter((e) => e.endsWith(".bio.md")).sort()) {
  const name = entry.replace(/\.bio\.md$/u, "");
  const expected = extractFacts(await readFile(join(expectedDir, entry), "utf8"));
  let actual = { headings: [] };
  try { actual = extractFacts(await readFile(join(actualDir, entry), "utf8")); } catch { }

  const src = normalizeForCompare(
    decodeHtml(await readFile(join(htmlDir, `${name}.htm`))).text.replace(/<[^>]*>/gu, " "),
  );

  const have = new Map();
  for (const h of actual.headings) have.set(h, (have.get(h) ?? 0) + 1);
  for (const h of expected.headings) {
    const n = have.get(h) ?? 0;
    if (n > 0) { have.set(h, n - 1); continue; }
    const label = h.split("\t")[1] ?? "";
    const words = label.split(" ").filter((w) => w.length > 2);
    const hits = words.filter((w) => src.includes(w)).length;
    const ok = words.length > 0 && hits / words.length >= 0.8;
    if (ok) { backed += 1; backedList.push(`${name}: ${h.replace("\t", " → ")}`); }
    else { invented += 1; inventedList.push(`${name}: ${h.replace("\t", " → ")}`); }
  }
}

console.log(`missing headings that ARE in the source (recoverable): ${backed}`);
for (const x of backedList) console.log("   +", x);
console.log(`\nmissing headings NOT in the source (editorial invention): ${invented}`);
for (const x of inventedList) console.log("   -", x);
