import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type Hook, runHook } from "./hook.js";
import { MemoryCache } from "./cache.js";
import { Budget } from "./budget.js";
import {
  GatewayTransport,
  OfflineTransport,
  type ChatRequest,
  type ChatResponse,
  type Transport,
  TransportError,
  requestHash,
} from "./transport.js";

const Reply = z.object({ verdict: z.enum(["a", "b"]), confidence: z.number() });
type Reply = z.infer<typeof Reply>;

function makeHook(overrides: Partial<Hook<{ force?: Reply }, { n: number }, Reply>> = {}) {
  const hook: Hook<{ force?: Reply }, { n: number }, Reply> = {
    id: "test.hook",
    version: "1",
    schema: Reply,
    system: "system prompt",
    models: ["cheap-model", "smart-model"],
    deterministic: (ctx) => ctx.force ?? null,
    buildPayload: (_ctx, item) => ({ text: `item ${item.n}` }),
    ...overrides,
  };
  return hook;
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

function runtime(transport: Transport, extra: Partial<Parameters<typeof runHook>[3]> = {}) {
  return { transport, cache: new MemoryCache(), budget: new Budget(), ...extra };
}

describe("runHook", () => {
  it("uses the deterministic path and never calls the transport", async () => {
    const transport = new StubTransport([]);
    const out = await runHook(makeHook(), { force: { verdict: "a", confidence: 1 } }, { n: 1 }, runtime(transport));
    expect(out).toMatchObject({ status: "ok", source: "deterministic" });
    expect(transport.calls).toHaveLength(0);
  });

  it("escalates to the model only when the deterministic path abstains", async () => {
    const transport = new StubTransport([{ verdict: "b", confidence: 0.9 }]);
    const out = await runHook(makeHook(), {}, { n: 1 }, runtime(transport));
    expect(out).toMatchObject({ status: "ok", source: "model", model: "cheap-model" });
    expect(transport.calls).toHaveLength(1);
  });

  it("caches a decision so a re-run makes no call", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 0.8 }]);
    const rt = runtime(transport);
    const first = await runHook(makeHook(), {}, { n: 1 }, rt);
    const second = await runHook(makeHook(), {}, { n: 1 }, rt);
    expect(first.status).toBe("ok");
    expect(second).toMatchObject({ status: "ok", source: "cache" });
    expect(transport.calls).toHaveLength(1);
  });

  it("rejects a reply that violates the schema and escalates a tier", async () => {
    const transport = new StubTransport([{ verdict: "nonsense" }, { verdict: "b", confidence: 0.95 }]);
    const events: string[] = [];
    const out = await runHook(makeHook(), {}, { n: 1 }, {
      ...runtime(transport),
      onEvent: (e) => events.push(e.type),
    });
    expect(out).toMatchObject({ status: "ok", model: "smart-model" });
    expect(events).toContain("invalid");
    expect(events).toContain("escalate");
  });

  it("escalates on low confidence", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 0.2 },
      { verdict: "a", confidence: 0.95 },
    ]);
    const out = await runHook(makeHook({ escalateBelow: 0.6 }), {}, { n: 1 }, runtime(transport));
    expect(out).toMatchObject({ status: "ok", model: "smart-model" });
  });

  it("routes to review when no tier produces a valid reply", async () => {
    const transport = new StubTransport([{ bad: true }, { alsoBad: true }]);
    const out = await runHook(makeHook(), {}, { n: 1 }, runtime(transport));
    expect(out.status).toBe("review");
  });

  it("honours domain validation beyond the schema", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "b", confidence: 1 },
    ]);
    const hook = makeHook({ validate: (out) => (out.verdict === "a" ? ["verdict a is not allowed here"] : []) });
    const out = await runHook(hook, {}, { n: 1 }, runtime(transport));
    expect(out).toMatchObject({ status: "ok", value: { verdict: "b" } });
  });

  it("returns review rather than calling out in replay mode", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    const out = await runHook(makeHook(), {}, { n: 1 }, { ...runtime(transport), replay: true });
    expect(out).toMatchObject({ status: "review" });
    expect(transport.calls).toHaveLength(0);
  });

  it("stops at the budget instead of overspending", async () => {
    const transport = new StubTransport([{ verdict: "a", confidence: 1 }]);
    const budget = new Budget({ maxCalls: 0 });
    const out = await runHook(makeHook(), {}, { n: 1 }, { ...runtime(transport), budget });
    expect(out).toMatchObject({ status: "review" });
    expect(out.status === "review" && out.reason).toMatch(/budget/u);
    expect(transport.calls).toHaveLength(0);
  });

  it("a schema change keys out old entries automatically", async () => {
    // The schema is part of the request hash, so changing it produces a
    // different key rather than a reinterpreted entry — the version field is
    // only needed for changes the JSON Schema does not capture.
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { totallyDifferent: "x" },
    ]);
    const rt = runtime(transport);
    await runHook(makeHook(), {}, { n: 1 }, rt);
    const changed = makeHook({ schema: z.object({ totallyDifferent: z.string() }) as never });
    const out = await runHook(changed, {}, { n: 1 }, rt);
    expect(out).toMatchObject({ status: "ok", source: "model" });
    expect(transport.calls).toHaveLength(2);
  });

  it("refuses a cache entry that does not fit the schema, rather than reinterpreting it", async () => {
    // Defence in depth for the cases the key cannot catch: a hand-edited entry,
    // or a refinement that does not serialize into the JSON Schema.
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
      runHook(makeHook(), {}, { n: 1 }, { ...runtime(transport), cache: poisoned }),
    ).rejects.toThrow(/Bump `version`/u);
    expect(transport.calls).toHaveLength(0);
  });

  it("treats a different hook version as a different cache entry", async () => {
    const transport = new StubTransport([
      { verdict: "a", confidence: 1 },
      { verdict: "b", confidence: 1 },
    ]);
    const rt = runtime(transport);
    await runHook(makeHook(), {}, { n: 1 }, rt);
    const out = await runHook(makeHook({ version: "2" }), {}, { n: 1 }, rt);
    expect(out).toMatchObject({ status: "ok", value: { verdict: "b" } });
    expect(transport.calls).toHaveLength(2);
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
    // Both are in flight and neither has settled; a third must still be refused.
    expect(() => budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 })).toThrow();
  });

  it("reports usage per model and flags an unpriced run", () => {
    const budget = new Budget();
    budget.reserve({ hook: "h", model: "m", estimatedInputTokens: 10 });
    budget.settle({ model: "m", inputTokens: 100, outputTokens: 50, cachedInputTokens: 10 });
    const usage = budget.usage();
    expect(usage.calls).toBe(1);
    expect(usage.byModel["m"]).toMatchObject({ calls: 1, inputTokens: 100 });
    expect(budget.unpriced()).toBe(true);
  });
});

describe("GatewayTransport", () => {
  const okBody = {
    model: "claude-sonnet-5",
    choices: [{ message: { tool_calls: [{ function: { name: "t", arguments: '{"verdict":"a","confidence":1}' } }] } }],
    usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 100 } },
  };

  const request: ChatRequest = {
    model: "claude-sonnet-5",
    system: "s",
    user: "u",
    schema: { name: "t", schema: { type: "object" } },
  };

  it("parses a tool call and reports cache usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new GatewayTransport({ baseUrl: "http://gw.local/v1", apiKey: "k" });
    const reply = await transport.chat(request);
    expect(reply.data).toEqual({ verdict: "a", confidence: 1 });
    expect(reply.usage.cachedInputTokens).toBe(100);

    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    // Structured output goes through tools, which every gateway supports.
    expect(sent.tool_choice.function.name).toBe("t");
    // A cache breakpoint is offered; gateways that ignore it lose only money.
    expect(sent.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    vi.unstubAllGlobals();
  });

  it("R2: refuses a silently substituted model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...okBody, model: "some-other-model" }), { status: 200 })),
    );
    const transport = new GatewayTransport({ baseUrl: "http://gw.local/v1" });
    await expect(transport.chat(request)).rejects.toThrow(/resolved model/u);
    vi.unstubAllGlobals();
  });

  it("accepts a provider-prefixed alias as the same model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...okBody, model: "anthropic/claude-sonnet-5" }), { status: 200 })),
    );
    const transport = new GatewayTransport({ baseUrl: "http://gw.local/v1" });
    await expect(transport.chat(request)).resolves.toBeDefined();
    vi.unstubAllGlobals();
  });

  it("recovers JSON wrapped in a fenced block", async () => {
    const body = {
      model: "claude-sonnet-5",
      choices: [{ message: { content: '```json\n{"verdict":"b","confidence":0.5}\n```' } }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const transport = new GatewayTransport({ baseUrl: "http://gw.local/v1" });
    expect((await transport.chat(request)).data).toEqual({ verdict: "b", confidence: 0.5 });
    vi.unstubAllGlobals();
  });

  it("marks 429 and 5xx retryable but a 400 not", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [400, false]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status })));
      const transport = new GatewayTransport({ baseUrl: "http://gw.local/v1" });
      await expect(transport.chat(request)).rejects.toMatchObject({ retryable });
      vi.unstubAllGlobals();
    }
  });

  it("cache keys change with the resolved model, not just the alias", () => {
    const a = requestHash(request, "claude-sonnet-5");
    const b = requestHash(request, "claude-haiku-4-5-20251001");
    expect(a).not.toBe(b);
  });
});

describe("OfflineTransport", () => {
  it("refuses to call and says why", async () => {
    await expect(new OfflineTransport().chat()).rejects.toThrow(/deterministic pipeline must produce/u);
  });
});
