/**
 * Prompt templates, on disk, versioned with the code that uses them.
 *
 * A prompt is the specification of a judgement, and a specification that lives
 * inside a `.join("\n")` array is one nobody reads, nobody reviews and nobody
 * diffs. Every hook's instructions therefore live in `src/llm/prompts/` as
 * Markdown, named for the judgement they ask for, and are loaded from here.
 *
 * Three properties this file has to guarantee, because the decision cache and
 * `--replay` both rest on them:
 *
 *   1. **Deterministic.** The same template plus the same variables render to
 *      the same bytes. No date, no locale, no iteration order of a Map.
 *   2. **Loud on a missing variable.** A template slot the caller forgot is a
 *      bug that would otherwise reach a model as the literal text `{{rows}}`
 *      and come back as a confident answer about nothing.
 *   3. **Cheap after the first read.** Templates are cached by resolved path,
 *      so a corpus run reads each file once.
 *
 * The cache key that protects replay is `requestHash`, which hashes the
 * *rendered* system and user text. Editing a template therefore invalidates
 * exactly the decisions that template produced, with no version bump needed —
 * `Hook.version` remains for schema changes, which the hash cannot see.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the templates are.
 *
 * Resolved once, by looking rather than by assuming. `tsc` does not copy
 * non-TypeScript files, so a built `dist/llm/` has no `prompts/` beside it
 * unless the build's copy step ran. Falling back to the source tree means a
 * half-built checkout degrades to "the prompts are the ones in git" instead of
 * to "every model call throws".
 */
function resolvePromptRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "prompts"),
    // Built to `dist/llm/`, prompts not copied: reach back into the source tree.
    resolve(here, "..", "..", "src", "llm", "prompts"),
    resolve(here, "..", "..", "..", "src", "llm", "prompts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Report every place that was looked at: the failure is nearly always a
  // build that did not copy, and the message should say so without a bisect.
  throw new Error(
    `No prompt template directory found. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Run `npm run build` (which copies `src/llm/prompts` into `dist/llm`), or run from the source tree.",
  );
}

let promptRoot: string | null = null;

/** The resolved template directory. Exported so the contract test can walk it. */
export function promptDirectory(): string {
  promptRoot ??= resolvePromptRoot();
  return promptRoot;
}

const fileCache = new Map<string, string>();

/**
 * Read one template by its slash-separated name, without the `.md` suffix.
 *
 * `table/classify-region.system` → `src/llm/prompts/table/classify-region.system.md`.
 */
export function readTemplate(name: string): string {
  const cached = fileCache.get(name);
  if (cached !== undefined) return cached;
  if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*(?:\.(?:system|user))?$/u.test(name)) {
    throw new Error(
      `Prompt template name ${JSON.stringify(name)} is not a lower-case slash path. ` +
        "Names are part of the on-disk layout and stay mechanical so the directory can be read as a catalogue.",
    );
  }
  const path = join(promptDirectory(), `${name}.md`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Prompt template ${JSON.stringify(name)} not found at ${path}.`);
  }
  // Normalize the line ending at the door. A Windows checkout with
  // `core.autocrlf=true` would otherwise hash differently from a Linux one and
  // silently invalidate every cached decision on the other platform.
  const normalized = text.replace(/\r\n/gu, "\n").replace(/\s+$/u, "");
  fileCache.set(name, normalized);
  return normalized;
}

/** A value a template slot may hold. Arrays join with newlines; `undefined` is empty. */
export type TemplateValue = string | number | boolean | undefined | readonly string[];

/**
 * Substitute `{{name}}` slots and resolve `{{#name}}…{{/name}}` sections.
 *
 * The syntax is deliberately three constructs and no more:
 *
 *   - `{{name}}`      — the value, or a throw when the caller never supplied it;
 *   - `{{#name}}…{{/name}}` — kept when the value is present and non-empty,
 *                       dropped otherwise. Inside it, `{{.}}` is the value;
 *   - `{{^name}}…{{/name}}` — the inverse, for "say something when there is none".
 *
 * There are no loops and no partials. A prompt that needs a loop needs the
 * caller to render the repeated part, where it can be truncated and budgeted —
 * which is the only place that decision belongs.
 */
export function renderTemplate(name: string, vars: Readonly<Record<string, TemplateValue>> = {}): string {
  return renderText(readTemplate(name), vars, name);
}

const SECTION = /\{\{([#^])([a-zA-Z][\w.-]*)\}\}\n?([\s\S]*?)\n?\{\{\/\2\}\}\n?/gu;
const SLOT = /\{\{([a-zA-Z.][\w.-]*)\}\}/gu;

export function renderText(
  template: string,
  vars: Readonly<Record<string, TemplateValue>>,
  origin = "<inline>",
): string {
  const present = (key: string): boolean => {
    const value = vars[key];
    if (value === undefined || value === false) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  // Sections first, so a slot inside a dropped section never demands a value.
  // Nested sections resolve by repeating until the text stops changing; the
  // bound is a guard against a malformed template, not an expected path.
  let text = template;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = text.replace(SECTION, (_match, kind: string, key: string, body: string) => {
      const keep = kind === "#" ? present(key) : !present(key);
      if (!keep) return "";
      return `${body.replace(/\{\{\.\}\}/gu, () => stringify(vars[key]))}\n`;
    });
    if (next === text) break;
    text = next;
  }

  return text
    .replace(SLOT, (_match, key: string) => {
      if (!(key in vars)) {
        throw new Error(
          `Prompt template ${JSON.stringify(origin)} references {{${key}}} but no such variable was supplied. ` +
            "An unfilled slot reaches the model as literal braces and comes back as a confident answer about nothing.",
        );
      }
      return stringify(vars[key]);
    })
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stringify(value: TemplateValue): string {
  if (value === undefined || value === false) return "";
  if (value === true) return "true";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}
