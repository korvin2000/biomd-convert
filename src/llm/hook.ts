/**
 * The hook runtime.
 *
 * This is where "the LLM controls structure, layout understanding and text
 * preprocessing" lives — as an API with a deterministic default, a typed
 * schema, a cache and a budget, rather than as a paragraph in a guide.
 *
 * Two invariants shape everything here:
 *   - a hook is only consulted when the deterministic path abstains;
 *   - a reply is data, never text to be pasted anywhere. It is validated,
 *     applied to a copy, re-checked, and only then accepted.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { type Budget, BudgetExceededError } from "./budget.js";
import type { DecisionCache } from "./cache.js";
import { type ChatImage, type ChatRequest, type Transport, TransportError, requestHash } from "./transport.js";

export interface HookPayload {
  text: string;
  images?: readonly ChatImage[];
}

export interface HookContext {
  transport: Transport;
  cache: DecisionCache;
  budget: Budget;
  /** Replay only: never call the network, fail if a decision is missing. */
  replay?: boolean;
  onEvent?: (event: HookEvent) => void;
}

export type HookEvent =
  | { type: "deterministic"; hook: string; item: string }
  | { type: "cache-hit"; hook: string; item: string }
  | { type: "call"; hook: string; item: string; model: string }
  | { type: "invalid"; hook: string; item: string; issues: string[] }
  | { type: "escalate"; hook: string; item: string; from: string; to: string }
  | { type: "review"; hook: string; item: string; reason: string };

export interface Hook<TCtx, TItem, TOut> {
  id: string;
  /** Prompt + schema version; part of the cache key so a change invalidates it. */
  version: string;
  schema: z.ZodType<TOut>;
  /** The instruction prefix. Stable across items so it can be cached. */
  system: string;
  /** Returns null to escalate. The common and preferred outcome. */
  deterministic?(ctx: TCtx, item: TItem): TOut | null;
  buildPayload(ctx: TCtx, item: TItem): HookPayload;
  /** Domain checks the schema cannot express. Empty array means accepted. */
  validate?(out: TOut, ctx: TCtx, item: TItem): string[];
  /** Model tiers, cheapest first. */
  models: readonly string[];
  /** Escalate to the next tier below this confidence, when the schema reports one. */
  escalateBelow?: number;
  maxOutputTokens?: number;
}

export type HookOutcome<TOut> =
  | { status: "ok"; value: TOut; source: "deterministic" | "cache" | "model"; model?: string }
  | { status: "review"; reason: string; issues?: string[] };

/** Stable identity for an item, used in the cache key and in events. */
export function itemKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export async function runHook<TCtx, TItem, TOut>(
  hook: Hook<TCtx, TItem, TOut>,
  ctx: TCtx,
  item: TItem,
  runtime: HookContext,
  itemId = itemKey(item),
): Promise<HookOutcome<TOut>> {
  const emit = runtime.onEvent ?? (() => undefined);

  // 1 — the deterministic path. Cheapest, reproducible, and the one that must
  // carry the majority of the corpus.
  const local = hook.deterministic?.(ctx, item) ?? null;
  if (local !== null) {
    const parsed = hook.schema.safeParse(local);
    if (parsed.success) {
      emit({ type: "deterministic", hook: hook.id, item: itemId });
      return { status: "ok", value: parsed.data, source: "deterministic" };
    }
    // A deterministic rule that produces an invalid value is a bug in the rule,
    // not an occasion to ask a model.
    throw new Error(
      `Hook ${hook.id}: deterministic result failed its own schema — ${issuesOf(parsed.error).join("; ")}`,
    );
  }

  const payload = hook.buildPayload(ctx, item);
  const jsonSchema = z.toJSONSchema(hook.schema, { io: "output" }) as Record<string, unknown>;

  let lastIssues: string[] = [];

  for (let tier = 0; tier < hook.models.length; tier += 1) {
    const model = hook.models[tier] as string;
    const request: ChatRequest = {
      model,
      system: `${hook.system}\n\n[hook:${hook.id}@${hook.version}]`,
      user: payload.text,
      ...(payload.images ? { images: payload.images } : {}),
      schema: { name: hook.id.replace(/\W/gu, "_"), schema: jsonSchema },
      ...(hook.maxOutputTokens ? { maxOutputTokens: hook.maxOutputTokens } : {}),
      temperature: 0,
    };

    const key = requestHash(request, model);
    const cached = await runtime.cache.get(key);
    if (cached !== undefined) {
      const parsed = hook.schema.safeParse(cached);
      if (parsed.success) {
        emit({ type: "cache-hit", hook: hook.id, item: itemId });
        return { status: "ok", value: parsed.data, source: "cache", model };
      }
      // A cached value that no longer fits the schema means the schema changed
      // without the version being bumped. Loud, not silent.
      throw new Error(
        `Hook ${hook.id}: cached decision no longer satisfies the schema. Bump \`version\` when the ` +
          "schema changes, so stale entries are keyed out rather than reinterpreted.",
      );
    }

    if (runtime.replay) {
      return { status: "review", reason: "replay mode and no cached decision for this item" };
    }

    // Budget is reserved before the request is built, so concurrent workers
    // cannot collectively overspend between check and call.
    try {
      runtime.budget.reserve({ hook: hook.id, model, estimatedInputTokens: estimateTokens(request) });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        return { status: "review", reason: `budget exhausted: ${error.message}` };
      }
      throw error;
    }

    emit({ type: "call", hook: hook.id, item: itemId, model });

    let reply;
    try {
      reply = await runtime.transport.chat(request);
    } catch (error) {
      runtime.budget.release();
      if (error instanceof TransportError && error.retryable && tier + 1 < hook.models.length) {
        emit({ type: "escalate", hook: hook.id, item: itemId, from: model, to: hook.models[tier + 1] as string });
        continue;
      }
      return { status: "review", reason: `transport failure: ${(error as Error).message}` };
    }

    runtime.budget.settle({
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
      cachedInputTokens: reply.usage.cachedInputTokens,
      model: reply.resolvedModel,
    });

    // R3 — local validation is the authority, never the transport's promise.
    const parsed = hook.schema.safeParse(reply.data);
    if (!parsed.success) {
      lastIssues = issuesOf(parsed.error);
      emit({ type: "invalid", hook: hook.id, item: itemId, issues: lastIssues });
      if (tier + 1 < hook.models.length) {
        emit({ type: "escalate", hook: hook.id, item: itemId, from: model, to: hook.models[tier + 1] as string });
        continue;
      }
      break;
    }

    const domainIssues = hook.validate?.(parsed.data, ctx, item) ?? [];
    if (domainIssues.length > 0) {
      lastIssues = domainIssues;
      emit({ type: "invalid", hook: hook.id, item: itemId, issues: domainIssues });
      if (tier + 1 < hook.models.length) {
        emit({ type: "escalate", hook: hook.id, item: itemId, from: model, to: hook.models[tier + 1] as string });
        continue;
      }
      break;
    }

    const confidence = (parsed.data as { confidence?: number }).confidence;
    if (
      hook.escalateBelow !== undefined &&
      typeof confidence === "number" &&
      confidence < hook.escalateBelow &&
      tier + 1 < hook.models.length
    ) {
      emit({ type: "escalate", hook: hook.id, item: itemId, from: model, to: hook.models[tier + 1] as string });
      continue;
    }

    await runtime.cache.set(key, parsed.data, {
      hook: hook.id,
      version: hook.version,
      model: reply.resolvedModel,
    });
    return { status: "ok", value: parsed.data, source: "model", model: reply.resolvedModel };
  }

  const reason = lastIssues.length > 0 ? `no tier produced a valid reply` : "no tier produced a reply";
  emit({ type: "review", hook: hook.id, item: itemId, reason });
  return { status: "review", reason, ...(lastIssues.length > 0 ? { issues: lastIssues } : {}) };
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
}

/** Rough token estimate for budgeting before a call is made. */
export function estimateTokens(request: ChatRequest): number {
  const chars = request.system.length + request.user.length + JSON.stringify(request.schema).length;
  // ~3.5 chars/token is a reasonable average for mixed Cyrillic and markup.
  const textTokens = Math.ceil(chars / 3.5);
  const imageTokens = (request.images?.length ?? 0) * 1500;
  return textTokens + imageTokens;
}
