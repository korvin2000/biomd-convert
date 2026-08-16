/**
 * LLM transport — an independent gateway, never a provider API directly.
 *
 * Targets the OpenAI-compatible `/v1/chat/completions` surface, which is the
 * only protocol every candidate gateway speaks, so the converter stays portable
 * across LiteLLM, OmniRoute and the rest.
 *
 * Three rules a middlebox makes necessary, all enforced here:
 *
 *   R1 — the transport must be transparent. Several gateways advertise
 *        prompt/response compression. The decision cache is keyed on the
 *        payload we *sent*; if something rewrites it, a cache hit no longer
 *        identifies what the model saw, and byte-identical replay becomes
 *        impossible. Compression must be off, and the probe checks it.
 *   R2 — pin the resolved model, not the alias. Through a gateway
 *        `claude-sonnet-5` is a server-side config entry. If it is repointed,
 *        cache keys stay identical while the model behind them changes. The
 *        resolved name is read back and verified.
 *   R3 — validate locally, always. Schema enforcement at the transport is a
 *        convenience, never the guarantee.
 */
import { createHash } from "node:crypto";

export interface GatewayConfig {
  /** Base URL **without** `/chat/completions`, e.g. `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey?: string;
  /** Extra headers, e.g. OpenRouter attribution or a virtual-key identifier. */
  headers?: Record<string, string>;
  /** Milliseconds. */
  timeoutMs?: number;
  /**
   * Fail when the resolved model differs from the requested one (R2).
   *
   * Turn off for a gateway whose model IDs are documented *aliases* — OpenRouter
   * resolves `~openai/gpt-latest` to a concrete model by design, and treating
   * that as a substitution would block every call. The resolved name is still
   * recorded and still keys the cache, so reproducibility is preserved either
   * way; only the hard failure is waived.
   */
  enforceModelIdentity?: boolean;
  /**
   * How to ask for typed data.
   *
   * `tools` is universal; `json_schema` is what OpenRouter documents (upstream
   * enforcement varies); `json_object` is a last resort. Local validation is
   * the authority in all three cases (R3).
   */
  structuredOutput?: "tools" | "json_schema" | "json_object";
  /**
   * Whether the endpoint accepts image content.
   *
   * `undefined` means "discover": images are sent until the endpoint refuses
   * them, after which this transport stops attaching them for the rest of the
   * run. A local `llama-server` started without an `--mmproj` projector answers
   * every image request with a 500, so one wasted call per run is the cost of
   * not being told; setting it to `false` avoids even that.
   */
  vision?: boolean;
  /** Merged into the request body — e.g. OpenRouter's `provider` routing block. */
  extraBody?: Record<string, unknown>;
  /**
   * Told once about anything an operator would want to know but that is not a
   * failure — a dropped capability, a widened output budget.
   */
  onNotice?: (notice: string) => void;
}

export interface ChatImage {
  /** Raw PNG/JPEG bytes; encoded as a data URI at request time. */
  data: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
}

export interface ChatRequest {
  model: string;
  /** Stable instruction prefix. Marked for prompt caching where supported. */
  system: string;
  /** Per-item payload. */
  user: string;
  images?: readonly ChatImage[];
  /** JSON Schema the reply must satisfy. Enforced locally regardless (R3). */
  schema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Identity that must key the cache but must not reach the model.
   *
   * Prompt template hashes and the hook's contract version live here. Two runs
   * whose rendered prompts happen to coincide across a contract change are still
   * different questions, and a cache that cannot tell them apart answers the new
   * one with the old one's reply. Hashed by {@link requestHash}, dropped by the
   * request builder.
   */
  contract?: Record<string, string>;
}

export interface ChatResponse {
  /** Parsed JSON object the model returned. */
  data: unknown;
  /** Model the gateway actually used, read back from the response (R2). */
  resolvedModel: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  /** Raw text, retained for the audit. */
  raw: string;
}

/**
 * What went wrong, coarsely — enough to decide *how* to retry.
 *
 * `structured-output` is the one that matters: it means the request reached a
 * model and the model answered, but not through the typed channel we asked for.
 * Retrying that on a different model is pointless; retrying it through a
 * different channel is exactly right.
 *
 * `output-budget` and `vision` name the two failures a *local* server produces
 * that look like a broken model and are neither. The first is a reasoning model
 * spending the whole completion allowance on its own thinking; the second is a
 * server built without a multimodal projector. Both are recovered from in
 * {@link GatewayTransport.chat} rather than reported, because the operator
 * cannot act on either from the error text alone.
 */
export type TransportFailure =
  | "network"
  | "http"
  | "structured-output"
  | "identity"
  | "output-budget"
  | "vision";

export class TransportError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly failure: TransportFailure;
  constructor(
    message: string,
    options: { status?: number; retryable?: boolean; failure?: TransportFailure } = {},
  ) {
    super(message);
    this.name = "TransportError";
    if (options.status !== undefined) this.status = options.status;
    this.failure = options.failure ?? "http";
    this.retryable = options.retryable ?? false;
  }
}

export interface Transport {
  readonly id: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /**
   * Whether images attached to a request actually leave the process.
   *
   * A transport that silently drops them would let a vision check pass on a
   * prompt the model could answer from the text alone, which is a measurement
   * saying the opposite of the truth.
   */
  readonly sendsImages?: boolean;
}

/**
 * OpenAI-compatible gateway client.
 *
 * Structured output goes through **tool calling** rather than
 * `response_format: json_schema`: tools are universally supported across
 * gateways, whereas the strict-schema response format is OpenAI-specific and
 * translated inconsistently.
 */
export class GatewayTransport implements Transport {
  readonly id = "openai-compatible-gateway";
  readonly #config: GatewayConfig &
    Required<Pick<GatewayConfig, "timeoutMs" | "enforceModelIdentity" | "structuredOutput" | "extraBody">>;

  constructor(config: GatewayConfig) {
    this.#config = {
      timeoutMs: 120_000,
      enforceModelIdentity: true,
      structuredOutput: "tools",
      extraBody: {},
      ...pruneUndefined(config),
      // Tolerate a pasted endpoint: the client appends /chat/completions itself.
      baseUrl: config.baseUrl.replace(/\/+$/u, "").replace(/\/chat\/completions$/iu, ""),
    };
    this.#sendImages = config.vision ?? true;
  }

  /**
   * Which typed channel is currently working.
   *
   * Sticky: once a channel succeeds, later calls start there rather than paying
   * for a failing attempt per item. A thousand-file run must not repeat a
   * discovery it already made.
   */
  #activeMode: NonNullable<GatewayConfig["structuredOutput"]> | null = null;

  /** Sticky for the same reason: an endpoint refuses images once, not per item. */
  #sendImages: boolean;

  get sendsImages(): boolean {
    return this.#sendImages;
  }

  /** Everything the operator was told, in order. Read by the run report. */
  readonly notices: string[] = [];

  #notice(message: string): void {
    if (this.notices.includes(message)) return;
    this.notices.push(message);
    this.#config.onNotice?.(message);
  }

  /**
   * Ask for typed data, degrading through the channels until one answers.
   *
   * §9.2 of the plan specifies `tools` → JSON mode → retry → `REVIEW`, and the
   * reason is concrete: `response_format: json_schema` is OpenAI-specific and
   * gateways translate it inconsistently. Routed to a provider that ignores it,
   * the reply comes back with no content at all — which reads as "the model is
   * broken" when the request simply used the wrong channel. `tools` is
   * universally supported and is what the ladder falls back to.
   *
   * Only a *structured-output* failure walks the ladder. A network error or a
   * 5xx is a different problem and propagates for the hook's model-tier retry.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const ladder = this.#ladder();
    let last: TransportError | null = null;

    for (let i = 0; i < ladder.length; i += 1) {
      const mode = ladder[i] as NonNullable<GatewayConfig["structuredOutput"]>;
      try {
        const reply = await this.#recover(request, mode);
        this.#activeMode = mode;
        return reply;
      } catch (error) {
        if (!(error instanceof TransportError) || error.failure !== "structured-output") throw error;
        last = error;
      }
    }

    throw new TransportError(
      `${last?.message ?? "structured output failed"} — tried ${ladder.join(" → ")}. ` +
        "The gateway or the model does not return typed data through any channel; check the model id.",
      { retryable: false, failure: "structured-output" },
    );
  }

  /**
   * One channel, with the two recoveries a local server makes necessary.
   *
   * Both are capability discoveries rather than retries in the usual sense, and
   * both are made once per transport: an endpoint that has no projector will
   * not grow one, and a model that thinks before answering will keep doing it.
   * Neither changes what was asked — the same prompt is sent, without the crop
   * or with room to finish — so an answer obtained this way is the answer to the
   * original question, and the hook's own validation still adjudicates it.
   */
  async #recover(
    request: ChatRequest,
    mode: NonNullable<GatewayConfig["structuredOutput"]>,
  ): Promise<ChatResponse> {
    const budget = request.maxOutputTokens ?? 4096;
    try {
      return await this.#attempt(request, mode, { images: this.#images(request), maxOutputTokens: budget });
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;

      if (error.failure === "vision") {
        this.#sendImages = false;
        this.#notice(
          "This gateway does not accept image input, so rendered crops are no longer being sent; " +
            "hooks that ask for one decide from their text summary alone. For llama-server, start it " +
            'with --mmproj <projector.gguf> to enable vision, or set "vision": false on the gateway to ' +
            "skip the discovery call.",
        );
        return await this.#attempt(request, mode, { images: [], maxOutputTokens: budget });
      }

      // A reasoning model charges its thinking to the same allowance as its
      // answer, so a budget sized for the answer alone returns nothing at all.
      // Widened once, not repeatedly: if the answer does not fit in four times
      // the room, the budget is not what is wrong.
      if (error.failure === "output-budget") {
        const widened = Math.max(budget * 4, 2048);
        this.#notice(
          `The model spent its whole ${budget}-token output allowance before answering — it emits ` +
            `reasoning tokens, and they are charged to the same allowance. Retrying at ${widened}. ` +
            "A hook wants a short typed verdict, so the cheaper fix is usually to turn the thinking " +
            'off — for llama.cpp, "extraBody": { "chat_template_kwargs": { "enable_thinking": false } } ' +
            'on the gateway — otherwise raise "maxOutputTokens" in the hook\'s override so the ' +
            "discarded attempt is not paid for on every item.",
        );
        return await this.#attempt(request, mode, {
          images: this.#images(request),
          maxOutputTokens: widened,
        });
      }

      throw error;
    }
  }

  #images(request: ChatRequest): readonly ChatImage[] {
    return this.#sendImages ? (request.images ?? []) : [];
  }

  /** Configured channel first, then the rest — most portable last. */
  #ladder(): Array<NonNullable<GatewayConfig["structuredOutput"]>> {
    const configured = this.#activeMode ?? this.#config.structuredOutput ?? "tools";
    return [...new Set<NonNullable<GatewayConfig["structuredOutput"]>>([configured, "tools", "json_object"])];
  }

  async #attempt(
    request: ChatRequest,
    mode: NonNullable<GatewayConfig["structuredOutput"]>,
    options: { images: readonly ChatImage[]; maxOutputTokens: number },
  ): Promise<ChatResponse> {
    // What the gateway is *asked* for and what it can compile are different
    // questions. The hook's schema stays the contract; this is its wire form.
    const schema = grammarSafeSchema(request.schema.schema);
    const content: unknown[] = [{ type: "text", text: request.user }];
    for (const image of options.images) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}` },
      });
    }

    const body: Record<string, unknown> = {
      // Anything the gateway needs that is not part of the OpenAI shape —
      // OpenRouter's `provider: { require_parameters: true }`, for instance.
      ...this.#config.extraBody,
      model: request.model,
      temperature: request.temperature ?? 0,
      max_tokens: options.maxOutputTokens,
      messages: [
        {
          role: "system",
          // `cache_control` is honoured by gateways that support prompt caching
          // (LiteLLM and OpenRouter both do) and ignored by those that do not.
          // Losing it costs money, never correctness.
          content: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        },
        { role: "user", content },
      ],
    };

    if (mode === "tools") {
      body["tools"] = [
        {
          type: "function",
          function: {
            name: request.schema.name,
            description: "Return the decision using exactly this schema.",
            parameters: schema,
          },
        },
      ];
      body["tool_choice"] = { type: "function", function: { name: request.schema.name } };
    } else if (mode === "json_schema") {
      body["response_format"] = {
        type: "json_schema",
        json_schema: { name: request.schema.name, strict: true, schema },
      };
    } else {
      body["response_format"] = { type: "json_object" };
      // With no schema channel the shape has to be stated in the prompt, and
      // local validation catches whatever comes back anyway.
      (body["messages"] as Array<{ role: string; content: unknown }>)[1] = {
        role: "user",
        content: [
          ...(content as unknown[]),
          {
            type: "text",
            text: `Reply with JSON matching this schema exactly:\n${JSON.stringify(schema)}`,
          },
        ],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.#config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#config.apiKey ? { authorization: `Bearer ${this.#config.apiKey}` } : {}),
          ...this.#config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new TransportError(`Gateway request failed: ${(error as Error).message}`, {
        retryable: true,
        failure: "network",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      // A server that cannot render an image says so with a 500, which is
      // otherwise indistinguishable from a server that fell over.
      if (options.images.length > 0 && IMAGE_UNSUPPORTED.test(text)) {
        throw new TransportError(`Gateway refused image input: ${text.slice(0, 300)}`, {
          status: response.status,
          failure: "vision",
        });
      }

      // Grammar-backed servers reject the *schema* rather than the channel, and
      // say nothing about `response_format` while doing it — llama.cpp answers
      // "failed to parse grammar". Read as a plain 4xx that is a dead end and
      // a run stops on the fifth one; read as a channel rejection it degrades
      // to `tools`, then to `json_object`, which is what recovers it.
      const channelRejected =
        response.status >= 400 &&
        response.status < 500 &&
        CHANNEL_REJECTED.test(text);
      throw new TransportError(`Gateway returned ${response.status}: ${text.slice(0, 500)}`, {
        status: response.status,
        // 408/429/5xx are worth retrying; a 4xx schema rejection is not — unless
        // the 4xx is the provider refusing the typed channel itself, which a
        // different channel may well satisfy.
        retryable: response.status === 408 || response.status === 429 || response.status >= 500 || channelRejected,
        ...(channelRejected ? { failure: "structured-output" as const } : {}),
      });
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          /** Separate thinking channel, as llama.cpp and several gateways emit it. */
          reasoning_content?: string | null;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        cache_read_input_tokens?: number;
      };
    };

    const resolvedModel = payload.model ?? request.model;
    // A `~` prefix marks a documented resolving alias (OpenRouter's
    // `~openai/gpt-latest`), so a differing answer is the contract, not a
    // substitution. The resolved name still keys the cache.
    const isAlias = request.model.startsWith("~");
    if (this.#config.enforceModelIdentity && !isAlias && !modelsMatch(request.model, resolvedModel)) {
      // R2. Serving a cache entry produced by a different model is worse than
      // failing, because it is invisible.
      throw new TransportError(
        `Gateway resolved model ${JSON.stringify(request.model)} to ${JSON.stringify(resolvedModel)}. ` +
          "Cache keys and reproducibility assume these match; fix the gateway routing or set " +
          "enforceModelIdentity:false deliberately.",
        { failure: "identity" },
      );
    }

    const choice = payload.choices?.[0];
    const call = choice?.message?.tool_calls?.[0];
    const rawArguments = call?.function?.arguments;
    // A model whose thinking is not carried in its own field inlines it, and
    // the answer is what follows the closing tag.
    const rawContent = stripInlineReasoning(choice?.message?.content ?? "");
    const raw = typeof rawArguments === "string" && rawArguments !== "" ? rawArguments : rawContent;

    if (!raw) {
      const reasoned = (choice?.message?.reasoning_content ?? "").trim() !== "";
      if (choice?.finish_reason === "length") {
        // Recovered in `#recover`, so the text here is only ever read when the
        // widened attempt failed too.
        throw new TransportError(
          `The model produced ${payload.usage?.completion_tokens ?? "?"} tokens against a ` +
            `${options.maxOutputTokens}-token allowance and stopped before answering` +
            `${reasoned ? ", having spent the allowance on reasoning" : ""}.`,
          { retryable: true, failure: "output-budget" },
        );
      }
      throw new TransportError(
        `Gateway returned neither a tool call nor content (structured output mode ${JSON.stringify(mode)})` +
          `${reasoned ? ", only a reasoning block" : ""}.`,
        { retryable: true, failure: "structured-output" },
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Some gateways wrap JSON in a fenced block. Recover once, then give up:
      // silently repairing malformed output would hide a transport problem.
      const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
      if (!fenced?.[1]) {
        // Truncation and malformation look identical in the text; only
        // `finish_reason` separates them, and they want opposite recoveries.
        if (choice?.finish_reason === "length") {
          throw new TransportError(
            `The model's reply was cut off at the ${options.maxOutputTokens}-token output allowance: ` +
              `${raw.slice(0, 120)}…`,
            { retryable: true, failure: "output-budget" },
          );
        }
        throw new TransportError(`Gateway reply is not valid JSON: ${raw.slice(0, 200)}`, {
          retryable: true,
          failure: "structured-output",
        });
      }
      data = JSON.parse(fenced[1]);
    }

    const usage = payload.usage ?? {};
    return {
      data,
      resolvedModel,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0,
      },
      raw,
    };
  }
}

/** Drop explicit `undefined`s so they cannot overwrite a default via spread. */
function pruneUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** The typed channel was refused, whatever the gateway called it. */
const CHANNEL_REJECTED =
  /response_format|json[_ ]?schema|tool[_ ]?(?:call|choice|use)|structured|grammar|sampler/iu;

/** No multimodal projector behind this endpoint. */
const IMAGE_UNSUPPORTED = /image (?:input )?is not supported|mmproj|multimodal|does not support image/iu;

/**
 * Above this, a length or item bound is a sanity cap, not a sampler constraint.
 *
 * The two roles are worth separating because only one of them survives the trip
 * to a grammar-backed server. A bound of 60 on a header label is describing the
 * answer and helps the model produce it; a bound of 4000 on a free-text
 * rationale is stopping a runaway reply, and no sampler needs to know about it.
 */
export const GRAMMAR_SAFE_BOUND = 256;

/**
 * The wire form of a reply schema: what a gateway is *asked* for.
 *
 * `llama.cpp` compiles a JSON Schema into a GBNF grammar and constrains
 * sampling with it, and a string bound is emitted literally as `char{0,N}`. Past
 * roughly two thousand repetitions the generated grammar no longer parses and
 * the server answers `400 Failed to initialize samplers: failed to parse
 * grammar` — for every request, so the whole run fails rather than one item.
 * Upstream: ggml-org/llama.cpp#25746 and #25923.
 *
 * Dropping the oversized bounds costs nothing that matters. R3 already makes
 * local validation the authority: the hook's zod schema still rejects a
 * 5000-character rationale after the fact, which is the only place the cap was
 * ever enforced. What changes is that the constraint stops being smuggled into
 * the sampler of every server that takes schemas literally.
 *
 * `$schema` goes for a related reason — it is a dialect declaration, no gateway
 * needs it, and it is one more node for a strict validator to object to.
 */
export function grammarSafeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return visit(schema) as Record<string, unknown>;

  function visit(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node !== "object" || node === null) return node;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$schema") continue;
      if (REPETITION_BOUNDS.has(key) && typeof value === "number" && value > GRAMMAR_SAFE_BOUND) continue;
      out[key] = visit(value);
    }
    return out;
  }
}

/** Bounds a grammar compiler turns into repetition counts. */
const REPETITION_BOUNDS = new Set(["minLength", "maxLength", "minItems", "maxItems"]);

/**
 * Remove an inlined thinking block, keeping the answer that follows it.
 *
 * Reasoning models reached through an OpenAI-compatible surface place their
 * thinking either in `reasoning_content` — which we never read — or, when the
 * server is not configured to separate it, inline in `content` ahead of the
 * answer. An unterminated block means the model was still thinking when its
 * allowance ran out, and there is no answer behind it to keep.
 */
export function stripInlineReasoning(content: string): string {
  const closed = /^\s*<(think|thinking|reasoning)>[\s\S]*?<\/\1>/iu.exec(content);
  if (closed) return content.slice(closed[0].length).trim();
  if (/^\s*<(?:think|thinking|reasoning)>/iu.test(content)) return "";
  return content;
}

/**
 * Gateways commonly prefix a provider (`anthropic/claude-sonnet-5`) or strip a
 * date suffix. Compare the significant part rather than demanding equality,
 * while still catching a genuine substitution.
 */
function modelsMatch(requested: string, resolved: string): boolean {
  const norm = (v: string) => v.toLowerCase().split("/").pop() ?? v.toLowerCase();
  const a = norm(requested);
  const b = norm(resolved);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Deterministic cache key over everything that can change an answer.
 *
 * `contract` is included and is the reason a prompt-template edit invalidates
 * the decisions it produced. It is omitted from the canonical form when absent,
 * so a request that carries none hashes exactly as it did before the field
 * existed.
 */
export function requestHash(request: ChatRequest, resolvedModel: string): string {
  const canonical = JSON.stringify({
    model: resolvedModel,
    system: request.system,
    user: request.user,
    schema: request.schema,
    images: (request.images ?? []).map((i) => createHash("sha256").update(i.data).digest("hex")),
    temperature: request.temperature ?? 0,
    ...(request.contract ? { contract: sortedEntries(request.contract) } : {}),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Key order must not decide a cache key. */
function sortedEntries(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

/** A transport that refuses to call anything — the `--llm off` default. */
export class OfflineTransport implements Transport {
  readonly id = "offline";
  async chat(): Promise<ChatResponse> {
    throw new TransportError(
      "LLM transport is disabled. The deterministic pipeline must produce usable output on its own; " +
        "configure a gateway to resolve the remaining ambiguous items.",
    );
  }
}
