/**
 * The hook runtime's contract.
 *
 * These are the assertions that make "turning a hook on cannot make the output
 * worse" a checked property rather than a design intention. Every path that
 * abandons an item is exercised, and every one of them must both emit and
 * return without a value: a silent abandonment is how a run makes forty paid
 * calls, resolves nothing, and reports neither.
 *
 * Inherited from the pre-plugin runtime, with its cache, budget, escalation and
 * replay cases intact; the deterministic-path case is gone because determinism
 * now lives one layer up, in `convert-core`, which is the point.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Budget } from "../budget.js";
import { MemoryCache } from "../cache.js";
import { Limiter } from "./concurrency.js";
import { EventRecorder } from "./events.js";
import { type HookDefinition, defineHook } from "./contract.js";
import { type HookRuntime, type PreparedHook, prepareHook, runHook } from "./runner.js";
import { clearTemplateCache } from "./template.js";
import { type ChatRequest, type ChatResponse, type Transport, TransportError } from "../transport.js";

const Reply = z.object({ verdict: z.enum(["a", "b"]), confidence: z.number() });
type Reply = z.infer<typeof Reply>;

interface Item {
  request: { n: number; skip?: boolean };
  context: { lang: string };
}

/** A throwaway plugin directory, so the templates are real files like a real hook's. */
function pluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "biomd-hook-"));
  writeFileSync(join(dir, "system.md"), "system prompt", "utf8");
  writeFileSync(join(dir, "user.md"), "item {{n}}", "utf8");
  clearTemplateCache();
  return pathToFileURL(join(dir, "hook.js")).href;
}

function makeHook(overrides: Partial<HookDefinition<Item, Reply>> = {}): HookDefinition<Item, Reply> {
  return defineHook<Item, Reply>({
    id: "test.hook",
    title: "Test",
    summary: "A hook that exists only to be run.",
    version: "1",
    stability: "experimental",
    decisionPoint: "test.hook",
    enabledByDefault: false,
    moduleUrl: pluginDir(),
    input: z.custom<Item>((v) => typeof (v as Item)?.request?.n === "number"),
    output: Reply,
    templates: { system: "system.md", user: "user.md" },
    defaults: { tier: "fast", maxTier: "deep" },
    gate: (item) => (item.request.skip ? { call: false, reason: "asked to skip" } : { call: true, reason: "ambiguous" }),
    render: (item) => ({ vars: { n: item.request.n } }),
    ...overrides,
  } as HookDefinition<Item, Reply>);
}

function prepare(hook: HookDefinition<Item, Reply>, policy = hook.defaults): PreparedHook<Item, Reply> {
  return prepareHook(hook, policy, { fast: "cheap-model", balanced: "cheap-model", deep: "smart-model" });
}

class StubTransport implements Transport {
  readonly id = "stub";
  calls: ChatRequest[] = [];
  constructor(private readonly replies: Array<unknown | Error>) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request);
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    return {
      data: next,
      resolvedModel: request.model,
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      raw: JSON.stringify(next),
    };
  }
}

function runtime(transport: Transport, extra: Partial<HookRuntime> = {}): HookRuntime {
  return {
    transport,
    cache: new MemoryCache(),
    budget: new Budget(),
    limiter: new Limiter(),
    endpoint: "stub",
    ...extra,
  };
}

const ITEM: Item = { request: { n: 1 }, context: { lang: "ru" } };

describe("runHook", () => {
  it("calls the model when the gate opens", async () => {
    const transport = new StubTransport([{ verdict: "b", confidence: 0.9 }]);
    const out = await runHook(prepare(makeHook()), ITEM, runtime(transport), "i1");
    expect(out).toMatchObject({ status: "ok", source: "model", model: "cheap-model" });
    expect(transport.calls).toHaveLength(1);
  });

  it("spends nothing when the gate declines", async () => {
    // Cost-aware triggering is a rule, and a closed gate is a success.
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    const recorder = new EventRecorder();
    const out = await runHook(
      prepare(makeHook()),
      { request: { n: 1, skip: true }, context: { lang: "ru" } },
      runtime(transport, { onEvent: recorder.sink }),
      "i1",
    );
    expect(out).toMatchObject({ status: "skipped", reason: "asked to skip" });
    expect(transport.calls).toHaveLength(0);
    expect(recorder.ofType("gate")[0]).toMatchObject({ call: false });
  });

  it("renders the prompts from the template files", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    await runHook(prepare(makeHook()), { request: { n: 7 }, context: { lang: "ru" } }, runtime(transport), "i1");
    expect(transport.calls[0]?.user).toBe("item 7");
    expect(transport.calls[0]?.system).toContain("system prompt");
  });

  it("throws when the escalation site hands over a request its schema rejects", async () => {
    const transport = new StubTransport([]);
    await expect(
      runHook(prepare(makeHook()), { request: {}, context: { lang: "ru" } } as never, runtime(transport), "i1"),
    ).rejects.toThrow(/input schema rejects/u);
    expect(transport.calls).toHaveLength(0);
  });

  it("caches a decision so a re-run makes no call", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 0.8 }]);
    const rt = runtime(transport);
    const hook = prepare(makeHook());
    expect((await runHook(hook, ITEM, rt, "i1")).status).toBe("ok");
    expect(await runHook(hook, ITEM, rt, "i1")).toMatchObject({ status: "ok", source: "cache" });
    expect(transport.calls).toHaveLength(1);
  });

  it("rejects a reply that violates the schema and escalates a tier", async () => {
    const transport = new StubTransport([{ verdict: "nonsense" }, { verdict: "b", confidence: 0.95 }]);
    const recorder = new EventRecorder();
    const out = await runHook(prepare(makeHook()), ITEM, runtime(transport, { onEvent: recorder.sink }), "i1");
    expect(out).toMatchObject({ status: "ok", model: "smart-model" });
    expect(recorder.types()).toContain("invalid");
    expect(recorder.types()).toContain("escalate");
  });

  it("escalates on low confidence", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 0.2 },
      { verdict: "a", confidence: 0.95 },
    ]);
    const hook = prepare(makeHook(), { tier: "fast", maxTier: "deep", escalateBelow: 0.6 });
    expect(await runHook(hook, ITEM, runtime(transport), "i1")).toMatchObject({
      status: "ok",
      model: "smart-model",
    });
  });

  it("refuses a valid but unconfident reply rather than applying it", async () => {
    // The disposition of the whole subsystem, spent rather than argued: an
    // uncertain modification is worse than no modification.
    const transport = new StubTransport([{ verdict: "a", confidence: 0.3 }]);
    const recorder = new EventRecorder();
    const hook = prepare(makeHook(), { tier: "fast", maxTier: "fast", acceptAbove: 0.8 });
    const out = await runHook(hook, ITEM, runtime(transport, { onEvent: recorder.sink }), "i1");
    expect(out.status).toBe("review");
    expect(recorder.types()).toContain("rejected");
  });

  it("stays inside the tiers its policy allows", async () => {
    const transport = new StubTransport([{ verdict: "nonsense" }]);
    const hook = prepare(makeHook(), { tier: "fast", maxTier: "fast" });
    expect((await runHook(hook, ITEM, runtime(transport), "i1")).status).toBe("review");
    // One tier means one attempt: the ceiling is not advisory.
    expect(transport.calls).toHaveLength(1);
  });

  it("routes to review when no tier produces a valid reply", async () => {
    const transport = new StubTransport([{ bad: true }, { alsoBad: true }]);
    expect((await runHook(prepare(makeHook()), ITEM, runtime(transport), "i1")).status).toBe("review");
  });

  it("honours domain validation beyond the schema", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "b", confidence: 1 },
    ]);
    const hook = prepare(makeHook({ validate: (out) => (out.verdict === "a" ? ["verdict a is not allowed"] : []) }));
    expect(await runHook(hook, ITEM, runtime(transport), "i1")).toMatchObject({
      status: "ok",
      value: { verdict: "b" },
    });
  });

  it("returns review rather than calling out in replay mode", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    const out = await runHook(prepare(makeHook()), ITEM, runtime(transport, { replay: true }), "i1");
    expect(out).toMatchObject({ status: "review" });
    expect(transport.calls).toHaveLength(0);
  });

  it("stops at the budget instead of overspending", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    const out = await runHook(
      prepare(makeHook()),
      ITEM,
      runtime(transport, { budget: new Budget({ maxCalls: 0 }) }),
      "i1",
    );
    expect(out).toMatchObject({ status: "review" });
    expect(out.status === "review" && out.reason).toMatch(/budget/u);
    expect(transport.calls).toHaveLength(0);
  });

  it("stops at a per-hook call cap without touching the shared budget", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "a", confidence: 1 },
    ]);
    const rt = runtime(transport, { calls: new Map() });
    const hook = prepare(makeHook(), { tier: "fast", maxTier: "fast", maxCalls: 1 });
    await runHook(hook, ITEM, rt, "i1");
    const second = await runHook(hook, { request: { n: 2 }, context: { lang: "ru" } }, rt, "i2");
    expect(second).toMatchObject({ status: "review" });
    expect(second.status === "review" && second.reason).toMatch(/call cap/u);
    expect(transport.calls).toHaveLength(1);
  });

  it("emits a reason for every abandonment", async () => {
    // A transport failure and an exhausted budget both used to return silently,
    // which is how a mistyped model id reads as "the LLM does nothing".
    const recorder = new EventRecorder();
    const transport = new StubTransport([new TransportError("gateway down", { retryable: false })]);
    await runHook(
      prepare(makeHook(), { tier: "fast", maxTier: "fast" }),
      ITEM,
      runtime(transport, { onEvent: recorder.sink }),
      "i1",
    );
    expect(recorder.ofType("review")[0]?.reason).toMatch(/transport failure/u);
  });

  it("a schema change keys out old entries automatically", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }, { totallyDifferent: "x" }]);
    const rt = runtime(transport);
    await runHook(prepare(makeHook()), ITEM, rt, "i1");
    const changed = prepare(makeHook({ output: z.object({ totallyDifferent: z.string() }) as never }));
    expect(await runHook(changed, ITEM, rt, "i1")).toMatchObject({ status: "ok", source: "model" });
    expect(transport.calls).toHaveLength(2);
  });

  it("treats a different contract version as a different cache entry", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "b", confidence: 1 },
    ]);
    const rt = runtime(transport);
    await runHook(prepare(makeHook()), ITEM, rt, "i1");
    expect(await runHook(prepare(makeHook({ version: "2" })), ITEM, rt, "i1")).toMatchObject({
      status: "ok",
      value: { verdict: "b" },
    });
    expect(transport.calls).toHaveLength(2);
  });

  it("treats an edited prompt as a different question", async () => {
    // The reason template hashes are in the cache key: a reworded prompt whose
    // answer is served from the old prompt's cache is a refinement that cannot
    // be measured.
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "b", confidence: 1 },
    ]);
    const rt = runtime(transport);
    await runHook(prepare(makeHook()), ITEM, rt, "i1");

    const dir = mkdtempSync(join(tmpdir(), "biomd-hook-"));
    writeFileSync(join(dir, "system.md"), "a different system prompt", "utf8");
    writeFileSync(join(dir, "user.md"), "item {{n}}", "utf8");
    clearTemplateCache();
    const edited = prepare(makeHook({ moduleUrl: pathToFileURL(join(dir, "hook.js")).href }));

    expect(await runHook(edited, ITEM, rt, "i1")).toMatchObject({ status: "ok", source: "model" });
    expect(transport.calls).toHaveLength(2);
  });

  it("refuses a cache entry that does not fit the schema, rather than reinterpreting it", async () => {
    const transport = new StubTransport([]);
    const poisoned = {
      async get() {
        return { verdict: "not-a-valid-enum-member" };
      },
      async set() {
        /* not reached */
      },
    };
    await expect(
      runHook(prepare(makeHook()), ITEM, runtime(transport, { cache: poisoned }), "i1"),
    ).rejects.toThrow(/Bump `version`/u);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("Limiter", () => {
  it("coalesces identical in-flight requests into one call", async () => {
    // The same ambiguous chrome table on forty pages is the normal case, and
    // the cache only helps after the first one has finished.
    const limiter = new Limiter({ default: 4 });
    let ran = 0;
    const task = async (): Promise<number> => {
      ran += 1;
      await new Promise((done) => setTimeout(done, 10));
      return ran;
    };
    const [a, b] = await Promise.all([limiter.coalesce("k", task), limiter.coalesce("k", task)]);
    expect(ran).toBe(1);
    expect(a?.value).toBe(b?.value);
    expect(a?.shared !== b?.shared).toBe(true);
  });

  it("never runs more than the configured number at once", async () => {
    const limiter = new Limiter({ default: 2 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.run("gw", "m", async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((done) => setTimeout(done, 5));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("defaults to serialized escalations", async () => {
    const limiter = new Limiter();
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        limiter.run("gw", "m", async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((done) => setTimeout(done, 2));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(1);
  });
});

describe("Budget", () => {
  it("blocks a call that would exceed the call cap", () => {
    const budget = new Budget({ maxCalls: 1 });
    budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 });
    budget.settle({ model: "m", inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 });
    expect(() => budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 })).toThrow(/call limit/u);
  });

  it("counts reservations so concurrent workers cannot overspend", () => {
    const budget = new Budget({ maxCalls: 2 });
    budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 });
    budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 });
    expect(() => budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 })).toThrow();
  });

  it("reports usage per model and flags an unpriced run", () => {
    const budget = new Budget();
    budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 });
    budget.settle({ model: "m", inputTokens: 100, outputTokens: 50, cachedInputTokens: 10 });
    expect(budget.usage().byModel["m"]).toMatchObject({ calls: 1, inputTokens: 100 });
    expect(budget.unpriced()).toBe(true);
  });
});
