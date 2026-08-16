/**
 * Hook enablement, as an operator experiences it.
 *
 * The rules are short, and every one of them exists because its absence was a
 * real failure: a hook that turned itself on, a `--hooks` id that was silently
 * ignored, an `--llm assist` that changed the output of a run in which nobody
 * had asked for anything.
 */
import { describe, expect, it } from "vitest";
import { ConfigSchema, type Config } from "./config.js";
import { HookConfigError, loadRegistry, prepareEnabled, resolveEnabled, openLlmSession } from "./llm-session.js";
import { Budget } from "../llm/budget.js";
import { GatewayResolver } from "../llm/resolver.js";
import type { ChatResponse, Transport } from "../llm/transport.js";

const DEAD_TRANSPORT: Transport = {
  id: "dead",
  async chat(): Promise<ChatResponse> {
    throw new Error("this transport exists to prove a constructor refuses before it is used");
  },
};

function config(patch: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse(patch);
}

describe("resolveEnabled", () => {
  it("starts from the hooks that declare themselves on", async () => {
    const registry = await loadRegistry(config());
    const { enabled } = resolveEnabled(registry, config());
    expect(enabled).toEqual(registry.defaults());
  });

  it("turns a named hook on", async () => {
    const registry = await loadRegistry(config());
    const cfg = config({ llm: { hooks: { enable: ["text.segment"] } } });
    const { enabled, reasons } = resolveEnabled(registry, cfg);
    expect(enabled).toContain("text.segment");
    expect(reasons.get("text.segment")).toBe("llm.hooks.enable");
  });

  it("turns one off, and says which setting did it", async () => {
    const registry = await loadRegistry(config());
    const cfg = config({ llm: { hooks: { disable: ["table.records"] } } });
    const { enabled, reasons } = resolveEnabled(registry, cfg);
    expect(enabled).not.toContain("table.records");
    expect(reasons.get("table.records")).toBe("llm.hooks.disable");
  });

  it('turns everything off with "*"', async () => {
    const registry = await loadRegistry(config());
    const cfg = config({ llm: { hooks: { disable: ["*"] } } });
    expect(resolveEnabled(registry, cfg).enabled).toEqual([]);
  });

  it("lets a per-hook override outrank both lists", async () => {
    const registry = await loadRegistry(config());
    const cfg = config({
      llm: { hooks: { disable: ["table.classify"], overrides: { "table.classify": { enabled: true } } } },
    });
    expect(resolveEnabled(registry, cfg).enabled).toContain("table.classify");
  });

  it("honours --hooks and --no-hooks", async () => {
    const registry = await loadRegistry(config());
    expect(resolveEnabled(registry, config(), { hooks: "text.segment" }).enabled).toContain("text.segment");
    expect(resolveEnabled(registry, config(), { noHooks: true }).enabled).toEqual([]);
  });

  it("refuses an unknown hook id instead of ignoring it", async () => {
    // Asking for a hook and getting nothing, with no message, is how an
    // operator concludes the subsystem does not work.
    const registry = await loadRegistry(config());
    expect(() => resolveEnabled(registry, config(), { hooks: "table.clasify" })).toThrow(HookConfigError);
    expect(() => resolveEnabled(registry, config({ llm: { hooks: { enable: ["nope"] } } }))).toThrow(/Unknown hook id/u);
    expect(() => resolveEnabled(registry, config({ llm: { hooks: { overrides: { nope: {} } } } }))).toThrow(
      /Unknown hook id/u,
    );
  });
});

describe("prepareEnabled", () => {
  it("applies the global default, then the per-hook override", async () => {
    const registry = await loadRegistry(config());
    const cfg = config({
      llm: {
        hooks: {
          enable: ["table.classify"],
          defaults: { maxTier: "balanced" },
          overrides: { "table.classify": { escalateBelow: 0.9 } },
        },
      },
    });
    const [prepared] = prepareEnabled(registry, ["table.classify"], cfg, {
      fast: "f",
      balanced: "b",
      deep: "d",
    });
    expect(prepared?.policy.maxTier).toBe("balanced");
    expect(prepared?.policy.escalateBelow).toBe(0.9);
    expect(prepared?.models).toEqual(["f", "b"]);
  });

  it("loads the prompts once, at startup", async () => {
    // A missing prompt file must fail before the run, not on the first
    // ambiguous table of the four hundredth document.
    const registry = await loadRegistry(config());
    const [prepared] = prepareEnabled(registry, ["table.classify"], config(), {
      fast: "f",
      balanced: "b",
      deep: "d",
    });
    expect(prepared?.templates.system.hash).toMatch(/^[0-9a-f]{12}$/u);
  });
});

describe("openLlmSession", () => {
  it("is off by default", async () => {
    const session = await openLlmSession(config());
    expect(session.resolver).toBeNull();
    expect(session.hooks).toEqual([]);
    expect(session.note).toMatch(/fully deterministic/u);
  });

  it("is off, not broken, when the gateway is unconfigured", async () => {
    const session = await openLlmSession(config({ llm: { enabled: true } }));
    expect(session.resolver).toBeNull();
    expect(session.note).toMatch(/llm unavailable/u);
  });

  it("assist with nothing enabled is identical to off", async () => {
    // The standing ruling, as a test: enabling the subsystem without naming a
    // hook must not change a single byte of output.
    const session = await openLlmSession(
      config({
        llm: {
          enabled: true,
          gateway: "g",
          gateways: { g: { baseUrl: "http://gw.local/v1", apiKey: "k", models: { fast: "m" } } },
          hooks: { disable: ["*"] },
        },
      }),
    );
    expect(session.resolver).toBeNull();
    expect(session.note).toMatch(/no hook is enabled/u);
  });

  it("builds a resolver that serves exactly the enabled points", async () => {
    const session = await openLlmSession(
      config({
        llm: {
          enabled: true,
          gateway: "g",
          gateways: { g: { baseUrl: "http://gw.local/v1", apiKey: "k", models: { fast: "m" } } },
          hooks: { disable: ["table.records"] },
        },
      }),
    );
    expect(session.resolver).not.toBeNull();
    expect(session.hooks.map((h) => h.definition.id)).toEqual(["table.classify"]);
    expect(session.note).toContain("table.classify");
  });

  it("refuses two hooks competing for one decision point", async () => {
    // Two answers to one question is a run whose output nobody can attribute.
    const registry = await loadRegistry(config());
    const classify = registry.get("table.classify");
    expect(classify).toBeDefined();
    const clone = { ...classify!.hook, id: "table.classify.alt" };
    registry.add({ hook: clone, dir: "test", builtin: false });
    const cfg = config({
      llm: {
        enabled: true,
        gateway: "g",
        gateways: { g: { baseUrl: "http://gw.local/v1", apiKey: "k", models: { fast: "m" } } },
      },
    });
    const { enabled } = resolveEnabled(registry, { ...cfg, llm: { ...cfg.llm, hooks: { ...cfg.llm.hooks, enable: ["table.classify.alt"] } } });
    expect(enabled).toContain("table.classify.alt");
    const prepared = prepareEnabled(registry, enabled, cfg, { fast: "m", balanced: "m", deep: "m" });
    expect(
      () =>
        new GatewayResolver({
          transport: DEAD_TRANSPORT,
          cache: {
            async get() {
              return undefined;
            },
            async set() {
              /* never reached */
            },
          },
          budget: new Budget(),
          hooks: prepared,
          endpoint: "g",
          models: { fast: "m", balanced: "m", deep: "m" },
          context: { lang: "ru" },
        }),
    ).toThrow(/both serve the decision point/u);
  });
});
