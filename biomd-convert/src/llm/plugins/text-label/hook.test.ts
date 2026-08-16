/**
 * `text.label` plugin contract.
 *
 * `plugins.test.ts` asserts the tree-wide properties — prompts load, the schema
 * converts, the enum can abstain, the gate is total, policy resolves,
 * `enabledByDefault` is false. What is left here is the hook-specific part:
 * that the gate closes by name on the lines not worth paying for, and that
 * `render` supplies every variable its templates ask for.
 *
 * The acceptance check is not tested here. It lives in `decisions.test.ts`,
 * because it is the compiler's word and not the plugin's.
 */
import { describe, expect, it } from "vitest";
import { hook } from "./hook.js";
import { loadTemplate, renderTemplate, templateVariables } from "../../kernel/template.js";
import type { TextLabelInput } from "./hook.js";

function input(text: string, score = 6): TextLabelInput {
  return { request: { text, score }, context: { lang: "ru" } };
}

describe("text.label gate", () => {
  it("opens on a short unmarked line that no term settles", () => {
    const verdict = hook.gate(input("Примечания:"));
    expect(verdict.call).toBe(true);
    expect(verdict.reason).toContain("6");
  });

  it("closes on a line that ends one sentence and begins another", () => {
    // `new_geyzel04`'s own instance. Nothing that ends a sentence mid-line is a
    // section label, so the call is not worth paying for.
    const verdict = hook.gate(
      input("Вообще-то к этому моменту я знал много о Вавилове. А сейчас ещё больше:"),
    );
    expect(verdict.call).toBe(false);
    expect(verdict.reason).toContain("sentence");
  });

  it("does not mistake an abbreviation dot for a sentence boundary", () => {
    // A speaker's initials above their own words are the shape the hook exists
    // for. One letter before the dot is an initial, not the end of a sentence.
    expect(hook.gate(input("В. Ф. Вавилов:")).call).toBe(true);
  });

  it("closes on a line with nothing to read", () => {
    expect(hook.gate(input("—")).call).toBe(false);
  });
});

describe("text.label prompts", () => {
  it("supplies every variable both templates ask for", () => {
    for (const name of ["system", "user"] as const) {
      const template = loadTemplate(hook.moduleUrl, hook.templates[name]);
      const rendered = renderTemplate(template, hook.render(input("Примечания:")).vars);
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toContain("{{");
      expect(templateVariables(template).length).toBeGreaterThanOrEqual(0);
    }
  });

  it("sends the line and not the answer", () => {
    const template = loadTemplate(hook.moduleUrl, hook.templates.user);
    const rendered = renderTemplate(template, hook.render(input("Примечания:")).vars);
    expect(rendered).toContain("Примечания:");
    expect(rendered).not.toContain("LABEL");
  });
});

describe("text.label reply", () => {
  it("can abstain", () => {
    expect(hook.output.safeParse({ kind: "UNCERTAIN", confidence: 0.2, rationale: "short" }).success).toBe(true);
  });

  it("is a verdict, never markup — no field can carry a rewritten line", () => {
    const parsed = hook.output.safeParse({
      kind: "LABEL",
      confidence: 1,
      rationale: "names the notes below",
      text: "**Примечания:**",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(["confidence", "kind", "rationale"]);
  });
});
