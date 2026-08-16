/**
 * `text.list` plugin contract.
 *
 * `plugins.test.ts` already asserts the tree-wide properties — prompts load,
 * the schema converts, the enum can abstain, the gate is total, policy
 * resolves, `enabledByDefault` is false. What is left for this file is the
 * hook-specific part: that the gate closes by name on the runs not worth
 * paying for, and that `render` supplies every variable its templates ask for.
 *
 * The acceptance check is not tested here. It lives in
 * `convert-core/decisions.test.ts`, because it is the compiler's word and not
 * the plugin's.
 */
import { describe, expect, it } from "vitest";
import { hook } from "./hook.js";
import { loadTemplate, renderTemplate, templateVariables } from "../../kernel/template.js";
import type { TextListInput } from "./hook.js";

function input(lines: string[], lead?: string): TextListInput {
  return {
    request: { id: "run", lines, ...(lead ? { lead } : {}) },
    context: { lang: "ru" },
  };
}

const TRACKS = [
  "J. S. Bach - Allemande",
  "F. Sor - Estudio e-moll",
  "J. Vinas - Fantasia",
  "I. Albeniz - Granada",
];

describe("text.list gate", () => {
  it("opens on a flat run of short parallel lines", () => {
    const verdict = hook.gate(input(TRACKS));
    expect(verdict.call).toBe(true);
    expect(verdict.reason).toContain("4");
  });

  it("closes on a pair — two lines are a name and its subtitle", () => {
    expect(hook.gate(input(["Jovan Jovicic", "Classical guitar"]))).toMatchObject({ call: false });
  });

  it("closes on a run of paragraphs, by mean line length", () => {
    // `pavlov_azancheev`'s letter is the measured case: five lines averaging
    // 584 characters. A cost brake, not a discriminator — it declines to pay,
    // it never promotes.
    const verdict = hook.gate(input(Array.from({ length: 5 }, () => "x".repeat(600))));
    expect(verdict.call).toBe(false);
    expect(verdict.reason).toContain("paragraphs");
  });

  it("closes on a run too large to be one judgement", () => {
    const verdict = hook.gate(input(Array.from({ length: 400 }, (_, i) => `Item ${i}`)));
    expect(verdict.call).toBe(false);
    expect(verdict.reason).toContain("one judgement");
  });
});

describe("text.list prompts", () => {
  it("supplies every variable both templates ask for, with and without a lead", () => {
    for (const name of ["system", "user"] as const) {
      const template = loadTemplate(hook.moduleUrl, hook.templates[name]);
      for (const value of [input(TRACKS), input(TRACKS, "Номера и названия томов:")]) {
        const rendered = renderTemplate(template, hook.render(value).vars);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).not.toContain("{{");
      }
      expect(templateVariables(template).length).toBeGreaterThanOrEqual(0);
    }
  });

  it("numbers the lines and says the number is not part of the text", () => {
    const template = loadTemplate(hook.moduleUrl, hook.templates.user);
    const rendered = renderTemplate(template, hook.render(input(TRACKS)).vars);
    expect(rendered).toContain("1\tJ. S. Bach - Allemande");
    expect(rendered).toContain("not part of the text");
  });

  it("sends the whole run, because parallelism between lines is the evidence", () => {
    const template = loadTemplate(hook.moduleUrl, hook.templates.user);
    const rendered = renderTemplate(template, hook.render(input(TRACKS)).vars);
    for (const line of TRACKS) expect(rendered).toContain(line);
  });
});

describe("text.list reply", () => {
  it("can abstain", () => {
    expect(hook.output.safeParse({ kind: "UNCERTAIN", confidence: 0.2, rationale: "mixed" }).success).toBe(true);
  });

  it("is a verdict, never markup — no field can carry a rewritten line", () => {
    const parsed = hook.output.safeParse({
      kind: "LIST",
      confidence: 1,
      rationale: "titles",
      lines: ["- rewritten"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(["confidence", "kind", "rationale"]);
  });
});
