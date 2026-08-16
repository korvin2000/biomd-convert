/**
 * The escalation boundary, end to end, against a stub transport.
 *
 * The defect this pins is not subtle: the hook runtime, the catalogue, the cache
 * and the budget were all implemented and tested, and *nothing called them*.
 * `convert()` had no resolver, the CLI built no transport, and every run
 * truthfully reported "zero model calls" because zero was the only number
 * reachable.
 */
import { describe, expect, it } from "vitest";
import { Budget } from "./budget.js";
import { MemoryCache } from "./cache.js";
import { GatewayResolver } from "./resolver.js";
import type { ChatRequest, ChatResponse, Transport } from "./transport.js";
import { discoverHooks } from "./kernel/registry.js";
import { type PreparedHook, prepareHook } from "./kernel/runner.js";
import type { ModelTier } from "./kernel/contract.js";
import { convert } from "../convert-core/pipeline.js";

class StubTransport implements Transport {
  readonly id = "stub";
  readonly requests: ChatRequest[] = [];
  constructor(private readonly reply: (request: ChatRequest) => unknown) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const data = this.reply(request);
    return {
      data,
      resolvedModel: request.model,
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      raw: JSON.stringify(data),
    };
  }
}

const MODELS: Record<ModelTier, string> = { fast: "stub-fast", balanced: "stub-fast", deep: "stub-deep" };

/**
 * The hooks these tests exercise, named because nothing is on by default.
 *
 * This used to filter on `enabledByDefault` and so asked the CLI's question,
 * "what is on by default?" — which is now answered "nothing", and would leave
 * every test below with an empty resolver that trivially passes. What is under
 * test here is the resolver *mechanism* — escalation, caching, the breaker, the
 * budget — so the fixture states which decision points it needs and
 * `plugins.test.ts` keeps sole custody of the default set.
 */
const EXERCISED = ["table.classify", "table.records"];

async function defaultHooks(): Promise<PreparedHook[]> {
  const registry = await discoverHooks();
  const entries = registry.all().filter((entry) => EXERCISED.includes(entry.hook.id));
  // A renamed or deleted plugin must fail loudly rather than silently shrink
  // the resolver these tests are built around.
  if (entries.length !== EXERCISED.length) {
    throw new Error(`expected ${EXERCISED.join(", ")}; discovered ${registry.ids().join(", ")}`);
  }
  return entries.map((entry) => prepareHook(entry.hook, entry.hook.defaults, MODELS));
}

async function makeResolver(
  reply: (request: ChatRequest) => unknown,
  budget = new Budget({ maxCalls: 20 }),
  extra: { breakerAfter?: number } = {},
) {
  const transport = new StubTransport(reply);
  const resolver = new GatewayResolver({
    transport,
    cache: new MemoryCache(),
    budget,
    hooks: await defaultHooks(),
    endpoint: "stub",
    models: MODELS,
    context: { lang: "ru" },
    ...extra,
  });
  return { transport, resolver };
}

/** The Barrios shape: reconstructs cleanly, but the source names no columns. */
const HEADERLESS = `<html><body><table border="0">
  <tr><td colspan="7"><p>Choro Da Saudade</p></td>
      <td><a href="tab/a.txt">TAB</a></td><td><a href="midi/a.mid">MIDI</a></td></tr>
  <tr><td colspan="7"><p>Cueca</p></td>
      <td><a href="tab/b.txt">TAB</a></td><td></td></tr>
  <tr><td colspan="7"><p>Julia Florida</p></td>
      <td><a href="tab/c.txt">TAB</a></td><td><a href="mp/c.mp3">MP3</a></td></tr>
  <tr><td colspan="7"><p>La Catedral</p></td>
      <td><a href="tab/d.txt">TAB</a></td><td></td></tr>
</table></body></html>`;

describe("the pipeline consults the resolver", () => {
  it("counts the escalation points even with no model configured", async () => {
    const result = await convert(Buffer.from(HEADERLESS, "utf8"));
    // Knowing how much a model *would* be asked is the prerequisite for
    // deciding whether to configure one.
    expect(result.resolverStats.consulted).toBeGreaterThan(0);
    expect(result.resolverStats.resolved).toBe(0);
    expect(result.resolverStats.calls).toBe(0);
  });

  it("asks for column labels and emits them", async () => {
    const { transport, resolver } = await makeResolver(() => ({
      headers: ["Произведение", "Табулатура", "Аудио"],
      confidence: 0.9,
      rationale: "columns hold a work title, a tablature link and an audio link",
    }));

    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "barrios.htm" });

    expect(transport.requests.length).toBeGreaterThan(0);
    expect(result.resolverStats.calls).toBeGreaterThan(0);
    expect(result.markdown).toContain("| Произведение | Табулатура | Аудио |");
    // The table is no longer a review item once its columns have names.
    expect(result.tables.some((t) => t.emittedTable && t.headerMissing)).toBe(false);
    expect(result.diagnostics.filter((d) => d.code === "table-header-empty")).toHaveLength(0);
  });

  it("keeps the table and the review item when the model declines", async () => {
    const { resolver } = await makeResolver(() => ({ headers: [], confidence: 0.1, rationale: "unclear" }));
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    // A rejected reply must never take the reconstructed table down with it.
    expect(result.markdown).toMatch(/^\|.*Choro Da Saudade.*\|$/mu);
    expect(result.resolverStats.resolved).toBe(0);
  });

  it("never lets a transport failure fail the conversion", async () => {
    const { resolver } = await makeResolver(() => {
      throw new Error("gateway unreachable");
    });
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(result.markdown).toContain("Choro Da Saudade");
    expect(result.resolverStats.resolved).toBe(0);
  });

  it("says why a call resolved nothing", async () => {
    // "3 calls, 0 resolved" is not a diagnosis, and a mistyped model id used to
    // produce exactly that line and nothing else — every abandonment returned
    // without emitting, so the reason never reached the report.
    const { resolver } = await makeResolver(() => {
      throw new Error("Gateway returned neither a tool call nor content.");
    });
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });

    expect(result.resolverStats.calls).toBeGreaterThan(0);
    expect(result.resolverStats.unresolved).toBeGreaterThan(0);
    expect(result.resolverStats.failures.length).toBeGreaterThan(0);
    expect(result.resolverStats.failures[0]?.reason).toMatch(/neither a tool call nor content/u);
  });

  it("collapses identical failures instead of listing every item", async () => {
    const { resolver } = await makeResolver(() => {
      throw new Error("Gateway returned neither a tool call nor content.");
    });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "a.htm" });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "b.htm" });

    const stats = resolver.stats();
    // One dead model is one problem, however many items hit it.
    expect(stats.failures).toHaveLength(1);
    expect(stats.failures[0]?.count).toBe(stats.unresolved);
  });

  it("stops calling a gateway that is not answering", async () => {
    // A budget cannot catch this: it counts settled usage, and a request that
    // never reached a model settles nothing. Without the breaker, one dead
    // endpoint produced one refused connection per escalation — 72 of them on
    // the bench corpus, all reporting the same thing.
    const { transport, resolver } = await makeResolver(
      () => {
        throw new Error("Gateway request failed: fetch failed");
      },
      new Budget({ maxCalls: 100 }),
      { breakerAfter: 2 },
    );
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "a.htm" });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "b.htm" });

    expect(resolver.circuitOpen).toBe(true);
    expect(transport.requests.length).toBe(2);
    // And the conversions still produced their output.
    expect(result.markdown).toContain("Choro Da Saudade");
    expect(resolver.stats().failures.some((f) => f.reason.includes("circuit opened"))).toBe(true);
  });

  it("keeps calling while the gateway answers, however it answers", async () => {
    // A refused reply is not a dead gateway. Confusing the two would open the
    // circuit on the first hook that guards its own quality.
    const { transport, resolver } = await makeResolver(
      () => ({ headers: ["one"], confidence: 0.9, rationale: "wrong width on purpose" }),
      new Budget({ maxCalls: 100 }),
      { breakerAfter: 2 },
    );
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "a.htm" });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "b.htm" });
    expect(resolver.circuitOpen).toBe(false);
    expect(transport.requests.length).toBeGreaterThan(2);
  });

  it("rejects a label set of the wrong width rather than emitting a ragged table", async () => {
    const { resolver } = await makeResolver(() => ({
      headers: ["Только одна"],
      confidence: 0.9,
      rationale: "one label",
    }));
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(result.markdown).not.toContain("Только одна");
  });

  it("serves a repeated decision from the cache instead of calling again", async () => {
    const { transport, resolver } = await makeResolver(() => ({
      headers: ["Произведение", "Табулатура", "Аудио"],
      confidence: 0.9,
      rationale: "as above",
    }));
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    const before = transport.requests.length;
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(transport.requests.length).toBe(before);
    expect(resolver.stats().cacheHits).toBeGreaterThan(0);
  });

  it("stops calling once the budget is exhausted", async () => {
    const { transport, resolver } = await makeResolver(
      () => ({ headers: ["a", "b", "c"], confidence: 0.9, rationale: "x" }),
      new Budget({ maxCalls: 0 }),
    );
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(transport.requests).toHaveLength(0);
    // And the conversion still produced its table.
    expect(result.markdown).toContain("Choro Da Saudade");
  });
});
