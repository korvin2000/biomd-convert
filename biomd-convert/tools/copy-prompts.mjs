/**
 * Copy plugin prompt templates into `dist/`.
 *
 * `tsc` emits JavaScript and nothing else, so a hook compiled to
 * `dist/llm/plugins/x/hook.js` would look for `prompts/system.md` in a
 * directory that has none. The alternative — inlining the prompts back into the
 * TypeScript — is the thing the templates exist to undo.
 *
 * Deliberately dumb: mirror every non-TypeScript file under `src/llm/plugins`
 * into `dist/llm/plugins`, and report what moved. A prompt that does not reach
 * `dist` is a hook that throws on its first item, which is a build problem and
 * should read like one.
 */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "llm", "plugins");
const to = join(root, "dist", "llm", "plugins");

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (!/\.tsx?$/u.test(entry.name)) out.push(path);
  }
  return out;
}

const files = await walk(from);
for (const file of files) {
  const target = join(to, relative(from, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
}

// Every plugin that reached dist must have brought its prompts with it.
const missing = [];
for (const entry of await readdir(to, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory()) continue;
  const prompts = join(to, entry.name, "prompts");
  const ok = await stat(prompts).then((s) => s.isDirectory()).catch(() => false);
  if (!ok) missing.push(entry.name);
}
if (missing.length > 0) {
  process.stderr.write(`copy-prompts: no prompts/ directory for plugin(s): ${missing.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(`copy-prompts: ${files.length} template file(s) → dist/llm/plugins\n`);
