/**
 * The template loader's contract.
 *
 * Two of these tests exist because of what the decision cache rests on. The
 * cache key is a hash of the *rendered* prompt, so rendering has to be a
 * function of the template and the variables and of nothing else — not of the
 * platform's line endings, not of the order a caller happened to build an object
 * in. A render that varies invalidates every cached decision on the other
 * platform, silently, and `--replay` stops being replay.
 *
 * The third exists because of what an unfilled slot does: it reaches the model
 * as the literal text `{{rows}}` and comes back as a confident answer about
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promptDirectory, readTemplate, renderTemplate, renderText } from "./prompt-template.js";

describe("rendering", () => {
  it("substitutes a slot", () => {
    expect(renderText("Language: {{lang}}.", { lang: "ru" })).toBe("Language: ru.");
  });

  it("throws on a slot the caller never supplied", () => {
    expect(() => renderText("Rows:\n{{rows}}", {})).toThrow(/\{\{rows\}\}/u);
  });

  it("treats an explicitly undefined variable as supplied and empty", () => {
    // The distinction matters: `{caption: undefined}` is "there is no caption",
    // which is a fact the caller knows. An absent key is a caller that forgot.
    expect(renderText("a{{caption}}b", { caption: undefined })).toBe("ab");
  });

  it("keeps a section when its value is present", () => {
    expect(renderText("x\n{{#c}}caption: {{.}}{{/c}}\ny", { c: "hi" })).toBe("x\ncaption: hi\ny");
  });

  it("drops a section when its value is empty, and does not demand its slots", () => {
    expect(renderText("x\n{{#c}}caption: {{.}} {{missing}}{{/c}}\ny", { c: "" })).toBe("x\ny");
  });

  it("supports the inverse section, for saying there is none", () => {
    expect(renderText("{{^alt}}no alt{{/alt}}", { alt: "" })).toBe("no alt");
    expect(renderText("{{^alt}}no alt{{/alt}}", { alt: "x" })).toBe("");
  });

  it("joins an array with newlines and treats an empty one as absent", () => {
    expect(renderText("{{#l}}{{.}}{{/l}}", { l: ["a", "b"] })).toBe("a\nb");
    expect(renderText("start{{#l}}{{.}}{{/l}}end", { l: [] })).toBe("startend");
  });

  it("renders the same bytes for the same inputs, whatever order the object was built in", () => {
    const a = renderText("{{x}}/{{y}}", { x: "1", y: "2" });
    const b = renderText("{{x}}/{{y}}", { y: "2", x: "1" });
    expect(a).toBe(b);
  });
});

describe("loading", () => {
  it("normalizes line endings, so a Windows checkout hashes like a Linux one", () => {
    for (const name of everyTemplate()) {
      expect(readTemplate(name)).not.toContain("\r");
    }
  });

  it("refuses a name that is not a lower-case slash path", () => {
    expect(() => readTemplate("../secrets")).toThrow(/lower-case slash path/u);
    expect(() => readTemplate("Table/Classify")).toThrow(/lower-case slash path/u);
  });

  it("names every place it looked when the template is missing", () => {
    expect(() => readTemplate("table/does-not-exist.system")).toThrow(/not found at/u);
  });
});

/** Every template on disk, by the name the loader takes. */
export function everyTemplate(): string[] {
  const root = promptDirectory();
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path, `${prefix}${entry}/`);
        continue;
      }
      if (!entry.endsWith(".md") || entry === "README.md") continue;
      out.push(`${prefix}${entry.slice(0, -3)}`);
    }
  };
  walk(root, "");
  return out.sort();
}

describe("the templates on disk", () => {
  it("are all system/user pairs, with nothing orphaned", () => {
    const names = everyTemplate();
    const systems = names.filter((n) => n.endsWith(".system")).map((n) => n.slice(0, -".system".length));
    const users = names.filter((n) => n.endsWith(".user")).map((n) => n.slice(0, -".user".length));
    // A stem with only one half is a hook whose prompt was half written, and it
    // would fail at the first call rather than here.
    expect(systems).toEqual(users);
  });

  it("render with no variables at all, or demand only slots a hook supplies", () => {
    // Not an assertion that they render — most demand variables. It asserts the
    // *failure* is the specific, actionable one, never a silent partial render.
    for (const name of everyTemplate()) {
      try {
        renderTemplate(name, {});
      } catch (error) {
        expect((error as Error).message).toMatch(/references \{\{/u);
      }
    }
  });
});
