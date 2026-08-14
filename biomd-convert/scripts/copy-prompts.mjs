/**
 * Copy the prompt templates into the build output.
 *
 * `tsc` copies TypeScript and nothing else, so a built `dist/llm/` has no
 * `prompts/` beside it. The loader falls back to the source tree when the
 * directory is missing, which keeps a half-built checkout working — but a
 * published `dist/` has no source tree to fall back to, so the copy is what
 * makes the build self-contained.
 *
 * Deliberately not a bundler step and deliberately not a `postinstall`: it runs
 * exactly when the code it belongs to is built, and it fails loudly if the
 * source directory is gone.
 */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "llm", "prompts");
const to = join(root, "dist", "llm", "prompts");

const info = await stat(from).catch(() => null);
if (!info?.isDirectory()) {
  process.stderr.write(`copy-prompts: ${from} is not a directory; the hook catalogue cannot load its prompts.\n`);
  process.exit(1);
}

await mkdir(dirname(to), { recursive: true });
await cp(from, to, { recursive: true });

let files = 0;
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await walk(join(dir, entry.name));
    else if (entry.name.endsWith(".md")) files += 1;
  }
};
await walk(to);
process.stdout.write(`copy-prompts: ${files} template(s) → dist/llm/prompts\n`);
