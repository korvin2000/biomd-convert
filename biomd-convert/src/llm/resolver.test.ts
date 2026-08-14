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
import { convert } from "../convert-core/pipeline.js";

class StubTransport implements Transport {
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

/**
 * The two table hooks, named explicitly — because nothing is on by default.
 *
 * These tests are about what happens *when* a hook is consulted, so they have to
 * turn one on. Naming them here rather than relying on a default is also the
 * point: a resolver constructed without `hooks` asks nothing at all, and the
 * assertion for that is its own test below.
 */
const TABLE_HOOKS = ["table.classify", "table.records"];

function makeResolver(reply: (request: ChatRequest) => unknown, hooks: readonly string[] = TABLE_HOOKS) {
  const transport = new StubTransport(reply);
  const resolver = new GatewayResolver({
    transport,
    cache: new MemoryCache(),
    budget: new Budget({ maxCalls: 20 }),
    models: { fast: "stub-fast", balanced: "stub-fast", deep: "stub-deep" },
    lang: "ru",
    hooks,
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
    const { transport, resolver } = makeResolver(() => ({
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
    const { resolver } = makeResolver(() => ({ headers: [], confidence: 0.1, rationale: "unclear" }));
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    // A rejected reply must never take the reconstructed table down with it.
    expect(result.markdown).toMatch(/^\|.*Choro Da Saudade.*\|$/mu);
    expect(result.resolverStats.resolved).toBe(0);
  });

  it("never lets a transport failure fail the conversion", async () => {
    const { resolver } = makeResolver(() => {
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
    const { resolver } = makeResolver(() => {
      throw new Error("Gateway returned neither a tool call nor content.");
    });
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });

    expect(result.resolverStats.calls).toBeGreaterThan(0);
    expect(result.resolverStats.unresolved).toBeGreaterThan(0);
    expect(result.resolverStats.failures.length).toBeGreaterThan(0);
    expect(result.resolverStats.failures[0]?.reason).toMatch(/neither a tool call nor content/u);
  });

  it("collapses identical failures instead of listing every item", async () => {
    const { resolver } = makeResolver(() => {
      throw new Error("Gateway returned neither a tool call nor content.");
    });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "a.htm" });
    await convert(Buffer.from(HEADERLESS, "utf8"), { resolver, sourceName: "b.htm" });

    const stats = resolver.stats();
    // One dead model is one problem, however many items hit it.
    expect(stats.failures).toHaveLength(1);
    expect(stats.failures[0]?.count).toBe(stats.unresolved);
  });

  it("rejects a label set of the wrong width rather than emitting a ragged table", async () => {
    const { resolver } = makeResolver(() => ({
      headers: ["Только одна"],
      confidence: 0.9,
      rationale: "one label",
    }));
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(result.markdown).not.toContain("Только одна");
  });

  it("serves a repeated decision from the cache instead of calling again", async () => {
    const { transport, resolver } = makeResolver(() => ({
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
    const transport = new StubTransport(() => ({
      headers: ["a", "b", "c"],
      confidence: 0.9,
      rationale: "x",
    }));
    const resolver = new GatewayResolver({
      transport,
      cache: new MemoryCache(),
      budget: new Budget({ maxCalls: 0 }),
      models: { fast: "stub", balanced: "stub", deep: "stub" },
      lang: "ru",
      hooks: TABLE_HOOKS,
    });
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(transport.requests).toHaveLength(0);
    // And the conversion still produced its table.
    expect(result.markdown).toContain("Choro Da Saudade");
  });

  it("asks nothing at all when no hook is named", async () => {
    // The default, and the property the whole opt-in design rests on: a
    // configured gateway with no hook selected is a fully deterministic run. A
    // page that would otherwise have cost a request costs nothing, and the
    // output is the output the compiler produces on its own.
    const { transport, resolver } = makeResolver(
      () => ({ headers: ["a", "b", "c"], confidence: 0.9, rationale: "x" }),
      [],
    );
    const result = await convert(Buffer.from(HEADERLESS, "utf8"), { resolver });
    expect(transport.requests).toHaveLength(0);
    expect(resolver.stats().calls).toBe(0);
    expect(resolver.canAnswer("table.records")).toBe(false);
    expect(result.markdown).toContain("Choro Da Saudade");
  });
});
