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
import { GatewayTransport, TransportError, type ChatRequest, requestHash } from "./transport.js";

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

/**
 * A grammar-backed server compiles the schema it is sent and samples against
 * it, so a bound written as a sanity cap becomes a repetition count in a
 * generated grammar. Past roughly two thousand the grammar stops parsing and
 * the server rejects *every* request — ggml-org/llama.cpp#25746, #25923.
 *
 * This is what took a whole corpus run down: `rationale: z.string().max(4000)`
 * on two hooks, forty-eight escalations, five 400s and an open circuit breaker.
 */
describe("wire schema", () => {
  const wide: ChatRequest = {
    ...request,
    schema: {
      name: "decision",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["A", "B"] },
          labels: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 4000 },
          rationale: { type: "string", maxLength: 4000 },
        },
        required: ["verdict", "labels", "rationale"],
        additionalProperties: false,
      },
    },
  };

  /** The schema as it left the process, in whichever channel carried it. */
  function sentSchema(body: Record<string, unknown>): Record<string, unknown> {
    const tools = body["tools"] as Array<{ function: { parameters: Record<string, unknown> } }> | undefined;
    if (tools) return tools[0]!.function.parameters;
    const format = body["response_format"] as { json_schema?: { schema: Record<string, unknown> } };
    return format.json_schema!.schema;
  }

  it("drops repetition bounds a grammar compiler cannot survive", async () => {
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent = sentSchema(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => toolReply, text: async () => "" };
    });

    await new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "tools" }).chat(wide);

    const properties = sent!["properties"] as Record<string, Record<string, unknown>>;
    expect(properties["rationale"]).not.toHaveProperty("maxLength");
    expect(properties["labels"]).not.toHaveProperty("maxItems");
    expect(sent).not.toHaveProperty("$schema");
    // A bound small enough to describe the answer is guidance the model can
    // use, and no grammar compiler struggles with sixty repetitions.
    const labelItems = properties["labels"]!["items"] as Record<string, unknown>;
    expect(labelItems["maxLength"]).toBe(60);
    // Everything that carries meaning survives untouched.
    expect(properties["verdict"]).toEqual({ type: "string", enum: ["A", "B"] });
    expect(sent!["required"]).toEqual(["verdict", "labels", "rationale"]);
    expect(sent!["additionalProperties"]).toBe(false);
  });

  it("keys the cache on the hook's schema, not on the wire form", () => {
    // R3: the bound is still the contract and zod still enforces it. Were the
    // wire form to key the cache, sending the same question to a grammar
    // gateway and to a strict one would look like two different questions.
    expect(requestHash(wide, "m")).toBe(requestHash(structuredClone(wide), "m"));
    expect(requestHash(wide, "m")).not.toBe(requestHash(request, "m"));
  });

  it("degrades when the server rejects the grammar rather than the channel", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { tools?: unknown[] };
      const usedTools = Array.isArray(body.tools);
      calls.push(usedTools ? "tools" : "response_format");
      if (!usedTools) {
        return {
          ok: false,
          status: 400,
          // llama.cpp's wording. It names neither `response_format` nor a tool,
          // so before this it read as a plain dead-end 4xx.
          text: async () =>
            '{"error":{"code":400,"message":"Failed to initialize samplers: failed to parse grammar"}}',
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

/**
 * Two failures a self-hosted server produces that look like a broken model.
 *
 * A `llama-server` started without `--mmproj` is text-only however multimodal
 * the weights are, and answers an image with a 500. A reasoning model charges
 * its thinking to the same allowance as its answer, so a budget sized for the
 * answer returns `finish_reason: "length"` and an empty `content` — which the
 * transport used to report as "neither a tool call nor content", pointing the
 * operator at the model id, which was correct all along.
 */
describe("self-hosted endpoints", () => {
  const withImage: ChatRequest = {
    ...request,
    images: [{ data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }],
  };

  function hasImage(body: Record<string, unknown>): boolean {
    const messages = body["messages"] as Array<{ content: unknown }>;
    const parts = messages[1]?.content;
    return Array.isArray(parts) && parts.some((p) => (p as { type: string }).type === "image_url");
  }

  it("retries without the crop when the endpoint has no projector, and says so once", async () => {
    const sentImages: boolean[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const image = hasImage(JSON.parse(init.body) as Record<string, unknown>);
      sentImages.push(image);
      if (image) {
        return {
          ok: false,
          status: 500,
          text: async () =>
            '{"error":{"message":"image input is not supported - hint: if this is unexpected, ' +
            'you may need to provide the mmproj"}}',
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, json: async () => toolReply, text: async () => "" };
    });

    const notices: string[] = [];
    const transport = new GatewayTransport({
      baseUrl: "http://x/v1",
      structuredOutput: "tools",
      onNotice: (n) => notices.push(n),
    });

    await expect(transport.chat(withImage)).resolves.toMatchObject({ data: { ok: true } });
    expect(sentImages).toEqual([true, false]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/mmproj/u);

    // Sticky: the second item pays nothing for a discovery already made.
    await transport.chat(withImage);
    expect(sentImages).toEqual([true, false, false]);
    expect(notices).toHaveLength(1);
  });

  it("does not send images at all when the gateway declares no vision", async () => {
    const sentImages: boolean[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sentImages.push(hasImage(JSON.parse(init.body) as Record<string, unknown>));
      return { ok: true, status: 200, json: async () => toolReply, text: async () => "" };
    });

    await new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "tools", vision: false }).chat(
      withImage,
    );
    expect(sentImages).toEqual([false]);
  });

  it("widens the output allowance once when reasoning consumed all of it", async () => {
    const budgets: number[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { max_tokens: number };
      budgets.push(body.max_tokens);
      if (budgets.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: "some/model",
            choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "thinking…" } }],
            usage: { completion_tokens: 512 },
          }),
          text: async () => "",
        };
      }
      return { ok: true, status: 200, json: async () => toolReply, text: async () => "" };
    });

    const notices: string[] = [];
    const transport = new GatewayTransport({
      baseUrl: "http://x/v1",
      structuredOutput: "tools",
      onNotice: (n) => notices.push(n),
    });

    await expect(transport.chat({ ...request, maxOutputTokens: 512 })).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(budgets).toEqual([512, 2048]);
    expect(notices[0]).toMatch(/reasoning tokens/u);
  });

  it("stops widening rather than escalating a budget forever", async () => {
    const budgets: number[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      budgets.push((JSON.parse(init.body) as { max_tokens: number }).max_tokens);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "some/model",
          choices: [{ finish_reason: "length", message: { content: "" } }],
        }),
        text: async () => "",
      };
    });

    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "tools" });
    await expect(transport.chat({ ...request, maxOutputTokens: 512 })).rejects.toThrow(
      /stopped before answering/u,
    );
    // One widened retry per channel, and the ladder is not walked: an exhausted
    // allowance is not a channel problem.
    expect(budgets).toEqual([512, 2048]);
  });

  it("reads the answer behind an inlined thinking block", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "some/model",
        choices: [{ message: { content: '<think>weighing the options</think>\n{"ok":true}' } }],
      }),
      text: async () => "",
    }));

    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });
    await expect(transport.chat(request)).resolves.toMatchObject({ data: { ok: true } });
  });

  it("treats an unterminated thinking block as no answer, not as malformed JSON", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "some/model",
        choices: [{ finish_reason: "length", message: { content: "<think>still weighing the" } }],
      }),
      text: async () => "",
    }));

    const transport = new GatewayTransport({ baseUrl: "http://x/v1", structuredOutput: "json_schema" });
    await expect(transport.chat({ ...request, maxOutputTokens: 64 })).rejects.toThrow(
      /stopped before answering/u,
    );
  });
});
