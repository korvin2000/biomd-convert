/**
 * Prompt templates as files.
 *
 * A prompt embedded in TypeScript is a prompt nobody reviews: it cannot be
 * diffed as prose, it cannot be edited without a rebuild, and its history is
 * tangled with the history of the code around it. Moving them out is what makes
 * `/refine-biomd-converter` able to *tune* a hook rather than rewrite it.
 *
 * The syntax is deliberately tiny — four constructs, no expressions, no logic.
 * Anything a template cannot say is a variable the plugin computes, which keeps
 * the interesting decisions in code where they can be tested:
 *
 *   {{name}}              substitute; an unknown or undefined name is an error
 *   {{#name}} … {{/name}} include only when the value is present and truthy
 *   {{^name}} … {{/name}} include only when it is absent, empty or false
 *   {{! … }}              an authoring note that never reaches the model
 *
 * Every template is hashed, and the hash participates in cache identity: an
 * edited prompt keys its old decisions out instead of quietly reusing them.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TemplateVars } from "./contract.js";

export interface LoadedTemplate {
  /** Absolute path, so an error message can name the file to edit. */
  readonly path: string;
  readonly text: string;
  /** First 12 hex of the sha-256 of the file, for cache identity and reports. */
  readonly hash: string;
}

export class TemplateError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${path}: ${message}`);
    this.name = "TemplateError";
  }
}

const cache = new Map<string, LoadedTemplate>();

/**
 * Load a template beside the plugin module that declares it.
 *
 * `moduleUrl` is always the plugin's own `import.meta.url`, which is what makes
 * one plugin directory relocatable and makes the same source work under vitest
 * (running from `src/`) and after `tsc` (running from `dist/`, where the build
 * copies the prompt files alongside the emitted JavaScript).
 */
export function loadTemplate(moduleUrl: string, name: string): LoadedTemplate {
  const path = join(dirname(fileURLToPath(moduleUrl)), name);
  const cached = cache.get(path);
  if (cached) return cached;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new TemplateError(
      `prompt template not found (${(error as Error).message}). ` +
        "A plugin's prompts live in its own directory and are copied into dist by `npm run build`.",
      path,
    );
  }
  // Normalize line endings so a checkout on Windows and one on Linux hash the
  // same — otherwise the decision cache misses for no reason anybody can see.
  const normalized = text.replace(/\r\n/gu, "\n");
  const loaded: LoadedTemplate = {
    path,
    text: normalized,
    hash: createHash("sha256").update(normalized).digest("hex").slice(0, 12),
  };
  cache.set(path, loaded);
  return loaded;
}

/** Drop every memoized template. Only tests that rewrite a template need this. */
export function clearTemplateCache(): void {
  cache.clear();
}

const SECTION = /\{\{([#^])([A-Za-z_][\w.]*)\}\}([\s\S]*?)\{\{\/\2\}\}/gu;
const VARIABLE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/gu;
const COMMENT = /\{\{!\s*[\s\S]*?\}\}/gu;

/**
 * Render a template.
 *
 * Strict on purpose: a name the caller did not supply throws rather than
 * rendering `{{precedingHeading}}` into a prompt. That mistake is invisible in
 * the output of a run and expensive in the reply.
 */
export function renderTemplate(template: LoadedTemplate, vars: TemplateVars): string {
  let out = template.text.replace(COMMENT, "");

  // Sections first, so a variable inside a suppressed section is never required.
  // Nested sections resolve by repeating until the text stops changing.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = out;
    out = out.replace(SECTION, (_match, kind: string, name: string, body: string) => {
      const present = isPresent(vars[name]);
      const keep = kind === "#" ? present : !present;
      return keep ? body : "";
    });
    if (out === before) break;
  }

  out = out.replace(VARIABLE, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) {
      throw new TemplateError(
        `template variable ${JSON.stringify(name)} was not supplied. ` +
          `Supplied: ${Object.keys(vars).sort().join(", ") || "(none)"}.`,
        template.path,
      );
    }
    return String(value);
  });

  // A section that occupied its own line leaves a blank one behind; collapsing
  // runs of three or more newlines keeps the rendered prompt readable without
  // making the template author think about whitespace.
  return out.replace(/\n{3,}/gu, "\n\n").trim();
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return true;
  return true;
}

/** Every `{{name}}` a template references, for `biomd hooks show` and for tests. */
export function templateVariables(template: LoadedTemplate): string[] {
  const names = new Set<string>();
  const text = template.text.replace(COMMENT, "");
  for (const match of text.matchAll(SECTION)) if (match[2]) names.add(match[2]);
  for (const match of text.matchAll(VARIABLE)) if (match[1]) names.add(match[1]);
  return [...names].sort();
}
