/**
 * The plugin tree's contract.
 *
 * Three things are pinned here, and each of them is a promise the operator is
 * entitled to rather than a matter of taste:
 *
 *   1. **discovery is by directory, not by list.** Adding a plugin must not
 *      require editing anything else, and the test that proves it is one that
 *      never names a hook it did not discover;
 *   2. **the default-enabled set cannot grow.** The standing ruling is that a
 *      new hook ships disabled — a previous generation of this subsystem
 *      shipped twenty-one hooks with seven on by default, three of which
 *      re-decided questions rules had already answered. That regression is now
 *      a failing test rather than a memory;
 *   3. **every hook is inspectable without a gateway.** Its prompts load, its
 *      schema converts, its gate is total.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { discoverHooks } from "../kernel/registry.js";
import { loadTemplate, templateVariables } from "../kernel/template.js";
import { TIER_ORDER, resolvePolicy, tiersFor } from "../kernel/contract.js";

/**
 * The only hooks permitted to run when nobody named one.
 *
 * Both predate the ruling and are wired to abstentions that predate it too.
 * **Do not add to this list.** A hook that wants to be on by default is a
 * conversion change and belongs to a refinement iteration that measures it.
 */
const GRANDFATHERED_DEFAULTS = ["table.classify", "table.records"];

describe("the plugin tree", () => {
  it("discovers every plugin directory without a central list", async () => {
    const registry = await discoverHooks();
    expect(registry.ids().length).toBeGreaterThanOrEqual(3);
    // Ordered, so a registry — and therefore a run — is reproducible.
    expect(registry.ids()).toEqual([...registry.ids()].sort());
  });

  it("enables exactly the grandfathered hooks by default", async () => {
    const registry = await discoverHooks();
    expect(registry.defaults()).toEqual(GRANDFATHERED_DEFAULTS);
  });

  it("gives every hook a loadable prompt pair and a convertible schema", async () => {
    for (const { hook } of (await discoverHooks()).all()) {
      const system = loadTemplate(hook.moduleUrl, hook.templates.system);
      const user = loadTemplate(hook.moduleUrl, hook.templates.user);
      expect(system.text.trim().length, `${hook.id} system prompt`).toBeGreaterThan(0);
      expect(user.text.trim().length, `${hook.id} user prompt`).toBeGreaterThan(0);
      expect(system.hash).not.toBe(user.hash);
      expect(() => z.toJSONSchema(hook.output, { io: "output" })).not.toThrow();
    }
  });

  it("supplies every variable its user template asks for", async () => {
    // A prompt referring to a variable the plugin never computes throws on the
    // first real item, at which point it has already cost a conversion.
    for (const { hook } of (await discoverHooks()).all()) {
      const declared = new Set(templateVariables(loadTemplate(hook.moduleUrl, hook.templates.user)));
      const sample = SAMPLE_INPUTS[hook.id];
      if (!sample) continue;
      const supplied = new Set(Object.keys(hook.render(sample).vars));
      for (const name of declared) {
        expect(supplied.has(name), `${hook.id} user template needs ${name}`).toBe(true);
      }
    }
  });

  it("lets every verdict enum abstain", async () => {
    // An enum with no way to say "I do not know" forces a guess, and a guess is
    // exactly what the acceptance checks downstream have to spend effort
    // undoing.
    for (const { hook } of (await discoverHooks()).all()) {
      const schema = JSON.stringify(z.toJSONSchema(hook.output, { io: "output" }));
      if (!schema.includes('"enum"')) continue;
      expect(schema, `${hook.id} has an enum with no UNCERTAIN member`).toContain("UNCERTAIN");
    }
  });

  it("gates on something, rather than calling because a block exists", async () => {
    for (const { hook } of (await discoverHooks()).all()) {
      const sample = SAMPLE_INPUTS[hook.id];
      if (!sample) continue;
      const verdict = hook.gate(sample);
      expect(typeof verdict.call).toBe("boolean");
      expect(verdict.reason.length, `${hook.id} gate gives no reason`).toBeGreaterThan(0);
    }
  });

  it("declares a policy whose tiers resolve to at least one model", async () => {
    for (const { hook } of (await discoverHooks()).all()) {
      const policy = resolvePolicy(hook.defaults);
      expect(TIER_ORDER).toContain(policy.tier);
      expect(tiersFor(policy, { fast: "f", balanced: "b", deep: "d" }).length).toBeGreaterThan(0);
    }
  });
});

describe("policy resolution", () => {
  it("lets an operator narrow a hook to one tier", () => {
    const policy = resolvePolicy({ tier: "fast", maxTier: "deep" }, { maxTier: "fast" });
    expect(tiersFor(policy, { fast: "f", balanced: "b", deep: "d" })).toEqual(["f"]);
  });

  it("never leaves a ceiling below the floor", () => {
    // An override that inverts them would produce a hook that can never call.
    const policy = resolvePolicy({ tier: "deep", maxTier: "deep" }, { maxTier: "fast" });
    expect(tiersFor(policy, { fast: "f", balanced: "b", deep: "d" })).toEqual(["d"]);
  });

  it("collapses tiers that name the same model", () => {
    const policy = resolvePolicy({ tier: "fast", maxTier: "deep" });
    expect(tiersFor(policy, { fast: "same", balanced: "same", deep: "same" })).toEqual(["same"]);
  });
});

/**
 * Minimal inputs, one per hook that can be built without a parsed document.
 *
 * Hooks whose request carries a LADOM grid are exercised end to end in
 * `resolver.test.ts` against a real conversion instead; a synthetic grid would
 * assert the fixture, not the hook.
 */
const SAMPLE_INPUTS: Record<string, never> = {
  "text.segment": {
    request: {
      surrounding: "Ночь, улица, фонарь, аптека,\nБессмысленный и тусклый свет.",
      breaks: ["аптека,|Бессмысленный", "свет.|Живи"],
    },
    context: { lang: "ru" },
  },
} as unknown as Record<string, never>;
