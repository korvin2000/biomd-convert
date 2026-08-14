/**
 * Properties of the catalogue as a set, and of each hook's refusals.
 *
 * The set-level assertions exist because these are the mistakes that a
 * per-hook review cannot catch: a second hook with the same id shares a cache
 * namespace with the first and silently serves its answers; a hook whose prompt
 * file was never written fails on the first paid call rather than at the gate;
 * a verdict enum with no way to abstain forces a guess on every ambiguous page,
 * which is precisely the outcome the whole design is arranged to avoid.
 *
 * Three of them are here because of what this catalogue did before it was cut
 * from twenty-one hooks to six: **nothing is enabled by default**, **every hook
 * declares whether the pipeline can actually reach it**, and **the hooks deleted
 * for damaging output stay deleted**. The first makes a damaging hook impossible
 * to acquire by accident. The second stops the catalogue filling up again with
 * hooks that are defined, prompted, tested and unreachable — twelve of them
 * were. The third puts a failing test in front of anyone re-adding one by name.
 *
 * The per-hook assertions are the acceptance checks — the refusals that make a
 * reply subordinate to the rule it is helping. Each one is tested with the reply
 * that would do damage if it were let through.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HOOK_CATALOGUE, hookById, hookIds } from "./catalogue.js";
import { DEFAULT_HOOKS } from "../resolver.js";
import { readTemplate } from "../prompt-template.js";
import { tableHeaderHook } from "./table.js";
import { blockRoleHook, textSegmentHook } from "./text.js";
import { imageRoleHook, isSanctionedGlyph } from "./media.js";
import { documentReviewHook } from "./document.js";

/** Pull the member list out of a zod enum, through an array or not. */
function enumValuesOf(type: unknown): string[] | null {
  const def = (type as { def?: { type?: string; entries?: Record<string, string>; element?: unknown } }).def;
  if (!def) return null;
  if (def.type === "enum" && def.entries) return Object.values(def.entries);
  if (def.type === "array") return enumValuesOf(def.element);
  return null;
}

describe("the catalogue as a whole", () => {
  it("holds every hook exactly once", () => {
    const ids = hookIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("enables nothing by default", () => {
    // The single most important line in this file. A default set is how an
    // operator ends up paying for — and being damaged by — escalations he never
    // chose. Every hook is opt-in, named on the command line or in the config.
    expect(DEFAULT_HOOKS).toHaveLength(0);
  });

  it("has both prompt files on disk for every hook", () => {
    for (const entry of HOOK_CATALOGUE) {
      expect(() => readTemplate(`${entry.templates}.system`), entry.hook.id).not.toThrow();
      expect(() => readTemplate(`${entry.templates}.user`), entry.hook.id).not.toThrow();
    }
  });

  it("loads every system prompt through the template loader, not from a string literal", () => {
    for (const entry of HOOK_CATALOGUE) {
      const system = entry.hook.system;
      expect(system.length, entry.hook.id).toBeGreaterThan(80);
      // The rendered prompt is the file, so an unrendered slot is a bug that
      // would otherwise reach a model.
      expect(system, entry.hook.id).not.toMatch(/\{\{/u);
    }
  });

  it("lets every verdict enum abstain", () => {
    for (const entry of HOOK_CATALOGUE) {
      const shape = (entry.hook.schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      if (!shape) continue;
      for (const [field, type] of Object.entries(shape)) {
        const values = enumValuesOf(type);
        if (!values) continue;
        // `document.review`'s severity is not a verdict about an item, it is a
        // rank on a finding; there is nothing for it to abstain from.
        if (entry.hook.id === "document.review") continue;
        expect(values, `${entry.hook.id}.${field}`).toContain("UNCERTAIN");
      }
    }
  });

  it("states, for every hook, the blank it fills and the check on its answer", () => {
    for (const entry of HOOK_CATALOGUE) {
      // Neither is decoration. A hook for which the first sentence cannot be
      // written is second-guessing a rule rather than answering an impasse; one
      // for which the second cannot be written is unfalsifiable, and the three
      // hooks this catalogue lost were all of the second kind.
      expect(entry.abstention.length, entry.hook.id).toBeGreaterThan(30);
      expect(entry.acceptanceCheck.length, entry.hook.id).toBeGreaterThan(30);
    }
  });

  it("says of every hook whether the pipeline can actually reach it", () => {
    // A hook with no consult site reports as available, is counted as an
    // escalation point, and can never fire. Twelve of them accumulated here
    // once, and the report that was supposed to say so went stale. The pipeline
    // names every hook it consults in a string literal, so the honest test is
    // that those and the `wired` flags agree.
    const CONSULTED = ["text.block-role", "table.classify", "table.records", "image.role", "document.review"];
    expect(
      HOOK_CATALOGUE.filter((e) => e.wired)
        .map((e) => e.hook.id)
        .sort(),
    ).toEqual([...CONSULTED].sort());
    // And one that is honestly declared unreachable rather than quietly listed.
    expect(hookById("text.segment")?.wired).toBe(false);
  });

  it("is reachable by id", () => {
    expect(hookById("table.classify")?.stage).toBe("table");
    expect(hookById("nope")).toBeUndefined();
  });

  it("does not hold any hook that was deleted for damaging output", () => {
    // Named, so re-adding one is a deliberate act with a failing test in front
    // of it rather than a plausible-looking commit.
    for (const id of ["layout.chrome-audit", "text.hyphenation", "image.caption"]) {
      expect(hookById(id), id).toBeUndefined();
    }
  });

  it("gives the image hook no way to remove an image", () => {
    // `DECORATION` meant "drop this", and a wrong one deleted content leaving no
    // trace in the output. What remains can only substitute one sanctioned mark
    // for another.
    const roles = enumValuesOf((imageRoleHook.schema as unknown as z.ZodObject<z.ZodRawShape>).shape["role"]);
    expect(roles).not.toContain("DECORATION");
    expect(roles).toContain("ICON");
  });
});

describe("the acceptance checks refuse the replies that would do damage", () => {
  it("refuses a glyph the project's own icon table does not sanction", () => {
    const ctx = { lang: "ru", size: "16×16 px", inLink: true, occurrences: 3 };
    const item = { surroundings: "" };
    expect(isSanctionedGlyph("▶")).toBe(true);
    expect(isSanctionedGlyph("🚀")).toBe(false);
    expect(
      imageRoleHook.validate?.({ role: "ICON", glyph: "🚀", confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
    expect(
      imageRoleHook.validate?.({ role: "ICON", glyph: "▶", confidence: 0.9, rationale: "x" }, ctx, item),
    ).toHaveLength(0);
    // A mark for something that is not a mark is a contradiction, not a detail.
    expect(
      imageRoleHook.validate?.({ role: "PICTURE", glyph: "▶", confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
  });

  it("refuses a batch whose verdicts do not line up with its items", () => {
    // Verdict n applied to item n+1 is a wrong answer wearing the shape of a
    // right one, and it is the characteristic failure of every batched hook.
    expect(
      textSegmentHook.validate?.({ kinds: ["WRAP", "PARAGRAPH"], confidence: 0.8, rationale: "x" }, {
        lang: "ru",
        context: "",
        count: 4,
      }, { breaks: ["a", "b", "c", "d"] }),
    ).not.toHaveLength(0);
  });

  it("refuses a placeholder column label, and a repeated one", () => {
    const ctx = { columns: 2, planSummary: "", lang: "ru" };
    const item = { rows: "" };
    expect(
      tableHeaderHook.validate?.({ headers: ["Столбец 1", "Год"], confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
    expect(
      tableHeaderHook.validate?.({ headers: ["Год", "год"], confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
  });

  it("refuses a heading verdict that cannot be placed, and a depth on a non-heading", () => {
    const ctx = { lang: "ru", typography: "bold, centred" };
    const item = { line: "", before: "", after: "", siblings: "" };
    // A label with nowhere to go in the outline is not usable, and repairing it
    // by picking a depth is how a caption acquires a heading level.
    expect(
      blockRoleHook.validate?.({ role: "SECTION_LABEL", depth: null, confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
    // A depth on a caption is a reply that has not understood the question.
    expect(
      blockRoleHook.validate?.({ role: "CAPTION", depth: 2, confidence: 0.9, rationale: "x" }, ctx, item),
    ).not.toHaveLength(0);
    expect(
      blockRoleHook.validate?.({ role: "SECTION_LABEL", depth: 2, confidence: 0.9, rationale: "x" }, ctx, item),
    ).toHaveLength(0);
  });

  it("refuses a review finding that quotes nothing, because it cannot be located", () => {
    const ctx = { lang: "ru", sourceName: "a.htm", summary: "", maxFindings: 8 };
    const item = { sourceText: "", output: "" };
    const issues = documentReviewHook.validate?.(
      { findings: [{ severity: "major", class: "structure.flattened", quote: "  ", note: "n" }], confidence: 0.7 },
      ctx,
      item,
    );
    expect(issues).not.toHaveLength(0);
  });
});
