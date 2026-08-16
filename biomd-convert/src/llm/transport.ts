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
  /** Merged into the request body — e.g. OpenRouter's `provider` routing block. */
  extraBody?: Record<string, unknown>;
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
 */
export type TransportFailure = "network" | "http" | "structured-output" | "identity";

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
  }

  /**
   * Which typed channel is currently working.
   *
   * Sticky: once a channel succeeds, later calls start there rather than paying
   * for a failing attempt per item. A thousand-file run must not repeat a
   * discovery it already made.
   */
  #activeMode: NonNullable<GatewayConfig["structuredOutput"]> | null = null;

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
        const reply = await this.#attempt(request, mode);
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

  /** Configured channel first, then the rest — most portable last. */
  #ladder(): Array<NonNullable<GatewayConfig["structuredOutput"]>> {
    const configured = this.#activeMode ?? this.#config.structuredOutput ?? "tools";
    return [...new Set<NonNullable<GatewayConfig["structuredOutput"]>>([configured, "tools", "json_object"])];
  }

  async #attempt(
    request: ChatRequest,
    mode: NonNullable<GatewayConfig["structuredOutput"]>,
  ): Promise<ChatResponse> {
    const content: unknown[] = [{ type: "text", text: request.user }];
    for (const image of request.images ?? []) {
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
      max_tokens: request.maxOutputTokens ?? 4096,
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
            parameters: request.schema.schema,
          },
        },
      ];
      body["tool_choice"] = { type: "function", function: { name: request.schema.name } };
    } else if (mode === "json_schema") {
      body["response_format"] = {
        type: "json_schema",
        json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
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
            text: `Reply with JSON matching this schema exactly:\n${JSON.stringify(request.schema.schema)}`,
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
      const channelRejected =
        response.status >= 400 &&
        response.status < 500 &&
        /response_format|json_schema|tool[_ ]?(?:call|choice)|structured/iu.test(text);
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
        message?: {
          content?: string | null;
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

    const call = payload.choices?.[0]?.message?.tool_calls?.[0];
    const rawArguments = call?.function?.arguments;
    const rawContent = payload.choices?.[0]?.message?.content ?? "";
    const raw = typeof rawArguments === "string" && rawArguments !== "" ? rawArguments : rawContent;

    if (!raw) {
      throw new TransportError(
        `Gateway returned neither a tool call nor content (structured output mode ${JSON.stringify(mode)}).`,
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
