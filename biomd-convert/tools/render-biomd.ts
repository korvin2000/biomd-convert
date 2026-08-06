#!/usr/bin/env node --experimental-strip-types
/**
 * `tools/render-biomd.ts` — the L3 diagnostic renderer, as a standalone entry.
 *
 * The implementation lives in `src/l3/render.ts` rather than in this file, for
 * the same reason L2 lives in `src/eval/` rather than in `tools/`: it is
 * typechecked, unit-tested and built with everything else, and a `tools/`
 * directory outside `rootDir` would be none of those. This file is the runnable
 * surface `CLAUDE.md` §4 names, and it adds nothing but argument handling — so
 * there is exactly one renderer, which is the L3 invariant.
 *
 *   node --experimental-strip-types tools/render-biomd.ts <in.bio.md> [out.html]
 *   node --experimental-strip-types tools/render-biomd.ts <in.bio.md> --annotate
 *
 * With no output path the HTML goes to stdout, so two renderings can be diffed
 * directly:
 *
 *   diff <(… fixtures/out/x.bio.md) <(… bench/out/x.bio.md)
 *
 * For the corpus, prefer the CLI, which also writes the launcher page:
 *   biomd render -c bench/biomd.config.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { renderBiomd } from "../src/l3/render.ts";

const args = process.argv.slice(2);
const annotate = args.includes("--annotate");
const positional = args.filter((a) => !a.startsWith("--"));
const input = positional[0];
const output = positional[1];

if (input === undefined) {
  process.stderr.write(
    "usage: node --experimental-strip-types tools/render-biomd.ts <in.bio.md> [out.html] [--annotate]\n",
  );
  process.exit(2);
}

const source = await readFile(resolve(input), "utf8");
const { html, warnings } = renderBiomd(source, {
  title: basename(input).replace(/\.bio\.md$/u, ""),
  annotate,
});

for (const w of warnings) {
  process.stderr.write(`note line ${w.line}: ${w.code} — ${w.message}\n`);
}

if (output === undefined) process.stdout.write(html);
else await writeFile(resolve(output), html);
