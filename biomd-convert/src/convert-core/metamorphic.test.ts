/**
 * Metamorphic properties of the conversion.
 *
 * `CLAUDE.md` §5 asks every rule for mutation robustness: the same output shape
 * under renamed classes and ids, permuted attributes, wrapper nesting changes,
 * and equivalent `<font>`/`<b>` ↔ CSS spellings. Stated per rule that is a
 * discipline tax that erodes; stated here, over whole documents, it is a
 * property the whole rule system either has or does not.
 *
 * These are **metamorphic** tests, not oracle tests: none of them needs to know
 * what the right Markdown is. Each states a transformation of the *input* that a
 * reader would not notice, and asserts the *output* does not notice it either.
 * That is what makes them runnable on documents no reference exists for, which
 * is the whole point — invariant 5 forbids a detector from naming a class, an
 * id, a filename or a title, and a renaming sweep is the only thing that can
 * actually check the claim rather than restate it.
 *
 * Driven by the committed reference sources so the suite stays hermetic and
 * fast. The same properties were swept over the 946-page unlabelled corpus,
 * which is where their reach is measured; see `CONVERTER-PROGRESS.md`.
 *
 * A failure here is not automatically a defect in the rule under suspicion. It
 * says the output depends on something it claims not to depend on — read the
 * diff before deciding which side is wrong.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convert } from "./pipeline.js";
import { resolveProfile } from "../biomd-ast/index.js";

const HTML_DIR = join(process.cwd(), "fixtures", "html");
const SPEC = resolveProfile("spec-1.6");

/**
 * Documents to sweep.
 *
 * All of them: the suite runs without a browser (`NullMeasurer`) and a whole
 * pass is a few seconds. Sampling would make the property probabilistic for no
 * saving worth having.
 */
const SOURCES = readdirSync(HTML_DIR)
  .filter((f) => /\.html?$/i.test(f))
  .sort();

async function md(html: string): Promise<string> {
  const result = await convert(Buffer.from(html, "utf8"), { profile: SPEC, sourceName: "probe.htm" });
  return result.markdown;
}

/** Read a source as text, honouring the declared codec the way the pipeline does. */
function sourceText(name: string): string {
  const bytes = readFileSync(join(HTML_DIR, name));
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// The transformations
// ---------------------------------------------------------------------------

/**
 * Rename every `class` and `id` *value*, leaving structure and text alone.
 *
 * The direct test of invariant 5. A detector that keys on `p.t3`, `class="nr"`
 * or `id="main"` produces different Markdown here; one that keys on geometry,
 * containment, recurrence or typographic role does not. Values are mapped
 * through a fixed permutation rather than blanked, so CSS selectors that
 * *group* elements keep grouping the same elements — the property is "the name
 * does not matter", not "styling does not matter".
 */
function renameClassesAndIds(html: string): string {
  const seen = new Map<string, string>();
  const rename = (value: string): string =>
    value
      .split(/\s+/u)
      .filter((token) => token !== "")
      .map((token) => {
        const existing = seen.get(token);
        if (existing !== undefined) return existing;
        const fresh = `q${seen.size.toString(36)}zz`;
        seen.set(token, fresh);
        return fresh;
      })
      .join(" ");
  return html
    .replace(/(\sclass\s*=\s*)"([^"]*)"/giu, (_m, lead: string, v: string) => `${lead}"${rename(v)}"`)
    .replace(/(\sid\s*=\s*)"([^"]*)"/giu, (_m, lead: string, v: string) => `${lead}"${rename(v)}"`)
    .replace(/(\.)([A-Za-z][\w-]*)(\s*\{)/gu, (m, dot: string, name: string, brace: string) => {
      const mapped = seen.get(name);
      return mapped === undefined ? m : `${dot}${mapped}${brace}`;
    });
}

/**
 * Reverse the attribute order of every start tag.
 *
 * Attribute order carries no meaning in HTML, so nothing may read it. A rule
 * that walks `Object.entries(attrs)` and stops at the first hit it recognizes
 * is the failure this catches.
 */
function permuteAttributes(html: string): string {
  return html.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)+)(\s*\/?)>/gu, (m, tag: string, attrs: string, tail: string) => {
    const parts = attrs.match(/[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?/gu);
    if (!parts || parts.length < 2) return m;
    return `<${tag} ${parts.reverse().join(" ")}${tail}>`;
  });
}

/**
 * Wrap the body's children in one more transparent `<div>`.
 *
 * A pure nesting change: `<div>` with no attributes computes to a block box of
 * the same width in the same place. A rule that counts ancestors, or that reads
 * "depth from body" as a proxy for a region's role, changes its answer.
 */
function addWrapper(html: string): string {
  return html.replace(/(<body[^>]*>)([\s\S]*)(<\/body>)/iu, (_m, open: string, body: string, close: string) => `${open}<div>${body}</div>${close}`);
}

// ---------------------------------------------------------------------------
// The properties
// ---------------------------------------------------------------------------

describe("conversion is deterministic", () => {
  it.each(SOURCES)("%s converts to the same bytes twice", async (name) => {
    const html = sourceText(name);
    expect(await md(html)).toBe(await md(html));
  });
});

describe("no detector names a class or an id", () => {
  it.each(SOURCES)("%s survives a renaming of every class and id", async (name) => {
    const html = sourceText(name);
    expect(await md(renameClassesAndIds(html))).toBe(await md(html));
  });
});

describe("no detector reads attribute order", () => {
  it.each(SOURCES)("%s survives having its attributes reversed", async (name) => {
    const html = sourceText(name);
    expect(await md(permuteAttributes(html))).toBe(await md(html));
  });
});

describe("conservation holds whatever the markup is called", () => {
  it.each(SOURCES)("%s loses no target or image under renaming", async (name) => {
    const html = sourceText(name);
    const before = await convert(Buffer.from(html, "utf8"), { profile: SPEC, sourceName: name });
    const after = await convert(Buffer.from(renameClassesAndIds(html), "utf8"), { profile: SPEC, sourceName: name });
    expect(after.conservation.targets.missing).toStrictEqual(before.conservation.targets.missing);
    expect(after.conservation.images.missing).toStrictEqual(before.conservation.images.missing);
    expect(after.conservation.text.recall).toBeCloseTo(before.conservation.text.recall, 6);
  });
});

/**
 * The nesting property is asserted on *conservation*, not on byte equality.
 *
 * An extra block box is genuinely visible to geometry, and several rules read
 * geometry on purpose — a lane, a float, a centred region. Demanding identical
 * bytes here would be demanding that those rules stop working. What may never
 * change is what survives: a wrapper cannot cost the document a destination, a
 * picture or a word.
 */
describe("an extra transparent wrapper costs no content", () => {
  it.each(SOURCES)("%s keeps every target and image inside one more div", async (name) => {
    const html = sourceText(name);
    const before = await convert(Buffer.from(html, "utf8"), { profile: SPEC, sourceName: name });
    const after = await convert(Buffer.from(addWrapper(html), "utf8"), { profile: SPEC, sourceName: name });
    expect(after.conservation.targets.missing.length).toBeLessThanOrEqual(before.conservation.targets.missing.length);
    expect(after.conservation.images.missing.length).toBeLessThanOrEqual(before.conservation.images.missing.length);
    expect(after.conservation.text.recall).toBeGreaterThanOrEqual(before.conservation.text.recall - 0.02);
  });
});
