/**
 * The structured-output ladder, and why it exists.
 *
 * `response_format: {type:"json_schema"}` is OpenAI-specific. Routed to a
 * provider that does not implement it, a gateway returns a 200 with an empty
 * message — no tool call, no content. That reads as "the model is broken", and
 * on a real run it looked exactly like "the LLM does nothing": every call was
 * made, paid for, and discarded.
 *
 * `tools` is universally supported, so the transport degrades to it rather than
 * giving up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayTransport, TransportError, type ChatRequest } from "./transport.js";

const request: ChatRequest = {
  model: "some/model",
  system: "system",
  user: "user",
  schema: { name: "decision", schema: { type: "object", properties: {} } },
};

interface Recorded {
  usedTools: boolean;
  responseFormat: string | undefined;
}

/** Stub `fetch`, recording which typed channel each attempt asked for. */
function stubGateway(reply: (call: Recorded, index: number) => unknown): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      tools?: unknown[];
      response_format?: { type?: string };
    };
    const record: Recorded = {
      usedTools: Array.isArray(body.tools),
      responseFormat: body.response_format?.type,
    };
    calls.push(record);
    return {
      ok: true,
      status: 200,
      json: async () => reply(record, calls.length - 1),
      text: async () => "",
    };
  });
  return calls;
}

const emptyReply = { model: "some/model", choices: [{ message: { content: "" } }] };
const toolReply = {
  model: "some/model",
  choices: [{ message: { tool_calls: [{ function: { name: "decision", arguments: '{"ok":true}' } }] } }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structured output degradation", () => {
  it("falls back to tool calling when json_schema returns nothing", async () => {
    const calls = stubGateway((call) => (call.usedTools ? toolReply : emptyReply));
    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });

    const reply = await transport.chat(request);
    expect(reply.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.responseFormat).toBe("json_schema");
    expect(calls[1]?.usedTools).toBe(true);
  });

  it("remembers the channel that worked, so the next item pays once", async () => {
    const calls = stubGateway((call) => (call.usedTools ? toolReply : emptyReply));
    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });

    await transport.chat(request);
    await transport.chat({ ...request, user: "another item" });
    // Two attempts for the first item, one for the second.
    expect(calls).toHaveLength(3);
    expect(calls[2]?.usedTools).toBe(true);
  });

  it("does not walk the ladder for a network failure", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      throw new Error("ECONNREFUSED");
    });
    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "tools" });

    await expect(transport.chat(request)).rejects.toThrow(TransportError);
    // A dead gateway is not a channel problem; retrying the same request three
    // times against it just makes the failure slower.
    expect(attempts).toBe(1);
  });

  it("gives up with an actionable message when no channel answers", async () => {
    stubGateway(() => emptyReply);
    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });
    await expect(transport.chat(request)).rejects.toThrow(/tried json_schema → tools → json_object/u);
    await expect(transport.chat(request)).rejects.toThrow(/check the model id/iu);
  });

  it("treats a 4xx that names the typed channel as a channel problem", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { tools?: unknown[] };
      const usedTools = Array.isArray(body.tools);
      calls.push(usedTools ? "tools" : "response_format");
      if (!usedTools) {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error":{"message":"response_format is not supported"}}',
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, json: async () => toolReply, text: async () => "" };
    });

    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });
    await expect(transport.chat(request)).resolves.toMatchObject({ data: { ok: true } });
    expect(calls).toEqual(["response_format", "tools"]);
  });
});
