/**
 * Template contract.
 *
 * The two properties that matter: a missing variable is an error rather than a
 * `{{name}}` sent to a model, and a template's hash changes when and only when
 * its text does — because that hash is what keys the decision cache.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TemplateError, clearTemplateCache, loadTemplate, renderTemplate, templateVariables } from "./template.js";

function writeTemplate(text: string, name = "t.md"): { moduleUrl: string; name: string } {
  const dir = mkdtempSync(join(tmpdir(), "biomd-tpl-"));
  writeFileSync(join(dir, name), text, "utf8");
  clearTemplateCache();
  // A plugin passes `import.meta.url` of its module; the loader resolves the
  // template beside it, so a fake module file in the same directory is enough.
  return { moduleUrl: pathToFileURL(join(dir, "hook.js")).href, name };
}

describe("renderTemplate", () => {
  it("substitutes named variables", () => {
    const { moduleUrl, name } = writeTemplate("Rows: {{rows}}, cols: {{cols}}.");
    expect(renderTemplate(loadTemplate(moduleUrl, name), { rows: 3, cols: 2 })).toBe("Rows: 3, cols: 2.");
  });

  it("refuses to render a variable nobody supplied", () => {
    // The alternative is a prompt containing the literal text `{{caption}}`,
    // which is invisible in the run and expensive in the reply.
    const { moduleUrl, name } = writeTemplate("Caption: {{caption}}");
    expect(() => renderTemplate(loadTemplate(moduleUrl, name), {})).toThrow(TemplateError);
    expect(() => renderTemplate(loadTemplate(moduleUrl, name), {})).toThrow(/caption/u);
  });

  it("includes a section only when its value is present", () => {
    const { moduleUrl, name } = writeTemplate("A{{#x}} x={{x}}{{/x}}{{^x}} no x{{/x}}");
    const tpl = loadTemplate(moduleUrl, name);
    expect(renderTemplate(tpl, { x: "1" })).toBe("A x=1");
    expect(renderTemplate(tpl, { x: undefined })).toBe("A no x");
    // An empty string is an absence, not a value: a caption of "" must not
    // render "Caption: ".
    expect(renderTemplate(tpl, { x: "" })).toBe("A no x");
  });

  it("does not require variables inside a suppressed section", () => {
    const { moduleUrl, name } = writeTemplate("{{#caption}}Caption: {{caption}}.{{/caption}}done");
    expect(renderTemplate(loadTemplate(moduleUrl, name), { caption: undefined })).toBe("done");
  });

  it("drops authoring comments before anything reaches the model", () => {
    const { moduleUrl, name } = writeTemplate("{{! never send this }}kept");
    expect(renderTemplate(loadTemplate(moduleUrl, name), {})).toBe("kept");
  });

  it("names every variable a template uses", () => {
    const { moduleUrl, name } = writeTemplate("{{a}} {{#b}}{{c}}{{/b}} {{! d }}");
    expect(templateVariables(loadTemplate(moduleUrl, name))).toEqual(["a", "b", "c"]);
  });

  it("hashes content, not line endings", () => {
    // A checkout on Windows and one on Linux must produce the same cache key.
    const unix = writeTemplate("one\ntwo\n", "unix.md");
    const a = loadTemplate(unix.moduleUrl, unix.name).hash;
    const dos = writeTemplate("one\r\ntwo\r\n", "dos.md");
    expect(loadTemplate(dos.moduleUrl, dos.name).hash).toBe(a);
  });

  it("changes its hash when the prose changes", () => {
    const before = writeTemplate("say this", "a.md");
    const a = loadTemplate(before.moduleUrl, before.name).hash;
    const after = writeTemplate("say that", "b.md");
    expect(loadTemplate(after.moduleUrl, after.name).hash).not.toBe(a);
  });

  it("says which file is missing rather than failing three frames deep", () => {
    const { moduleUrl } = writeTemplate("x");
    expect(() => loadTemplate(moduleUrl, "nope.md")).toThrow(/prompt template not found/u);
  });
});
