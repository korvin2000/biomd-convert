/**
 * The hook runtime.
 *
 * One escalation, start to finish. The order of the steps is the safety
 * argument, so it is worth reading as a list rather than as code:
 *
 *   1. **validate the request** — a malformed item is a bug at the escalation
 *      site, and it throws rather than being sent to a model;
 *   2. **gate** — deterministic, free, and the only thing that authorises
 *      spending. A closed gate is a normal, common, successful outcome;
 *   3. **cache** — an answered question is never asked twice, and `--replay`
 *      stops here rather than reaching the network;
 *   4. **budget** — reserved *before* the request is built, so concurrent
 *      workers cannot collectively overspend between check and call;
 *   5. **queue** — bounded per endpoint, and identical in-flight requests are
 *      coalesced into one;
 *   6. **schema**, then **domain validation**, then **confidence** — three
 *      independent refusals, any of which discards the reply;
 *   7. **cache the accepted value** and return it.
 *
 * Failure at every one of those steps degrades to the same place: the
 * deterministic answer stands and the item remains a review item. That is the
 * monotonicity property the whole design rests on — turning a hook on can
 * resolve an abstention, and can never damage an answer a rule already gave.
 */
import { z } from "zod";
import { type Budget, BudgetExceededError } from "../budget.js";
import type { DecisionCache } from "../cache.js";
import {
  type ChatImage,
  type ChatRequest,
  type Transport,
  TransportError,
  requestHash,
} from "../transport.js";
import type { HookDefinition, HookPolicy, ModelTier } from "./contract.js";
import { tiersFor } from "./contract.js";
import type { Limiter } from "./concurrency.js";
import type { HookEventBody, HookEventSink } from "./events.js";
import { type LoadedTemplate, loadTemplate, renderTemplate } from "./template.js";

/** A hook with its operator policy applied and its prompts loaded. */
export interface PreparedHook<TInput = unknown, TOutput = unknown> {
  readonly definition: HookDefinition<TInput, TOutput>;
  readonly policy: HookPolicy;
  readonly templates: { system: LoadedTemplate; user: LoadedTemplate };
  /** Model ids this hook may walk, cheapest first. */
  readonly models: readonly string[];
}

export interface HookRuntime {
  transport: Transport;
  cache: DecisionCache;
  budget: Budget;
  limiter: Limiter;
  /** Names the queue that protects the server — the gateway, not the model. */
  endpoint: string;
  /** Replay only: never call the network, fail if a decision is missing. */
  replay?: boolean;
  onEvent?: HookEventSink;
  /** Wall clock origin, so event timestamps form one timeline across a run. */
  startedAt?: number;
  /** Model calls already made, per hook, for the per-hook call cap. */
  calls?: Map<string, number>;
}

export type HookOutcome<TOutput> =
  | { status: "ok"; value: TOutput; source: "cache" | "model"; model: string; ms: number }
  /** The gate declined. Nothing was spent, and this is the common outcome. */
  | { status: "skipped"; reason: string }
  | { status: "review"; reason: string; issues?: string[] };

/**
 * Prepare a hook for use: apply the policy, resolve the tiers, load the prompts.
 *
 * Done once per run rather than per item, so a template read and a JSON Schema
 * conversion do not repeat a thousand times, and so a missing prompt file fails
 * at startup instead of on the first ambiguous table of the four hundredth
 * document.
 */
export function prepareHook<TInput, TOutput>(
  definition: HookDefinition<TInput, TOutput>,
  policy: HookPolicy,
  models: Record<ModelTier, string>,
): PreparedHook<TInput, TOutput> {
  return {
    definition,
    policy,
    templates: {
      system: loadTemplate(definition.moduleUrl, definition.templates.system),
      user: loadTemplate(definition.moduleUrl, definition.templates.user),
    },
    models: tiersFor(policy, models),
  };
}

export async function runHook<TInput, TOutput>(
  prepared: PreparedHook<TInput, TOutput>,
  input: TInput,
  runtime: HookRuntime,
  itemId: string,
): Promise<HookOutcome<TOutput>> {
  const hook = prepared.definition;
  const started = runtime.startedAt ?? Date.now();
  const emit = (event: HookEventBody): void => {
    runtime.onEvent?.({ ...event, hook: hook.id, item: itemId, at: Date.now() - started });
  };
  /**
   * Give up on this item, loudly.
   *
   * Every abandonment emits, not just the one at the end of the tier loop. A
   * transport failure and an exhausted budget used to return silently, so a run
   * could make a paid call per item, have every one of them fail, and report
   * nothing at all — which is precisely how a mistyped model id looks like "the
   * LLM does nothing" instead of like an error.
   */
  const giveUp = (reason: string, issues?: string[]): HookOutcome<TOutput> => {
    emit({ type: "review", reason, ...(issues && issues.length > 0 ? { issues } : {}) });
    return { status: "review", reason, ...(issues && issues.length > 0 ? { issues } : {}) };
  };

  // 1 — the request itself. A schema failure here is the escalation site
  // handing over something it should not have built, and it is loud.
  const checkedInput = hook.input.safeParse(input);
  if (!checkedInput.success) {
    throw new Error(
      `Hook ${hook.id}: the decision point handed over a request its own input schema rejects — ` +
        issuesOf(checkedInput.error).join("; "),
    );
  }
  const item = checkedInput.data;

  // 2 — the gate. Deterministic, free, and the reason it gives is what the
  // progress reporter prints when it says why a hook fired.
  const gate = hook.gate(item);
  emit({ type: "gate", call: gate.call, reason: gate.reason });
  if (!gate.call) return { status: "skipped", reason: gate.reason };

  if (prepared.models.length === 0) {
    return giveUp("no model is configured for this hook's tiers");
  }

  const rendered = hook.render(item);
  const system = renderTemplate(prepared.templates.system, rendered.vars);
  const user = renderTemplate(prepared.templates.user, rendered.vars);
  const jsonSchema = z.toJSONSchema(hook.output, { io: "output" }) as Record<string, unknown>;

  let lastIssues: string[] = [];

  for (let tier = 0; tier < prepared.models.length; tier += 1) {
    const model = prepared.models[tier] as string;
    const request: ChatRequest = {
      model,
      // The provenance marker predates the templates and stays: a reply quoted
      // in a gateway log should name the hook that asked for it.
      system: `${system}\n\n[hook:${hook.id}@${hook.version}]`,
      user,
      ...(rendered.images ? { images: rendered.images as readonly ChatImage[] } : {}),
      schema: { name: hook.id.replace(/\W/gu, "_"), schema: jsonSchema },
      ...(prepared.policy.maxOutputTokens ? { maxOutputTokens: prepared.policy.maxOutputTokens } : {}),
      temperature: prepared.policy.temperature ?? 0,
      // Hashed into the cache key, never sent. An edited prompt or a bumped
      // contract keys its old decisions out instead of reinterpreting them.
      contract: {
        hook: hook.id,
        version: hook.version,
        system: prepared.templates.system.hash,
        user: prepared.templates.user.hash,
      },
    };

    const key = requestHash(request, model);
    const cached = await runtime.cache.get(key);
    if (cached !== undefined) {
      const parsed = hook.output.safeParse(cached);
      if (parsed.success) {
        emit({ type: "cache-hit", model });
        emit({ type: "accepted", source: "cache", model, ms: 0 });
        return { status: "ok", value: parsed.data, source: "cache", model, ms: 0 };
      }
      // A cached value that no longer fits the schema means the schema changed
      // without the version being bumped. Loud, not silent.
      throw new Error(
        `Hook ${hook.id}: cached decision no longer satisfies the schema. Bump \`version\` when the ` +
          "schema changes, so stale entries are keyed out rather than reinterpreted.",
      );
    }
    emit({ type: "cache-miss" });

    if (runtime.replay) {
      return giveUp("replay mode and no cached decision for this item");
    }

    const soFar = runtime.calls?.get(hook.id) ?? 0;
    if (prepared.policy.maxCalls !== undefined && soFar >= prepared.policy.maxCalls) {
      return giveUp(`per-hook call cap ${prepared.policy.maxCalls} reached`);
    }

    const estimatedInputTokens = estimateTokens(request);
    try {
      runtime.budget.reserve({ hook: hook.id, model, estimatedInputTokens });
    } catch (error) {
      if (error instanceof BudgetExceededError) return giveUp(`budget exhausted: ${error.message}`);
      throw error;
    }

    const depth = runtime.limiter.depth(runtime.endpoint, model);
    if (depth > 0) emit({ type: "queued", model, endpoint: runtime.endpoint, depth });
    emit({ type: "call", model, estimatedInputTokens, attempt: tier + 1 });
    runtime.calls?.set(hook.id, soFar + 1);

    const callStarted = Date.now();
    let reply;
    try {
      // Coalescing is keyed on the request hash, so two items can only share a
      // call when they would have received the same answer anyway.
      const shared = await runtime.limiter.coalesce(key, () =>
        runtime.limiter.run(runtime.endpoint, model, () => runtime.transport.chat(request)),
      );
      reply = shared.value;
    } catch (error) {
      runtime.budget.release();
      if (error instanceof TransportError && error.retryable && tier + 1 < prepared.models.length) {
        emit({
          type: "escalate",
          from: model,
          to: prepared.models[tier + 1] as string,
          why: `transport: ${error.failure}`,
        });
        continue;
      }
      return giveUp(`transport failure: ${(error as Error).message}`);
    }
    const ms = Date.now() - callStarted;

    runtime.budget.settle({
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
      cachedInputTokens: reply.usage.cachedInputTokens,
      model: reply.resolvedModel,
    });
    emit({ type: "reply", model: reply.resolvedModel, ms, usage: reply.usage });

    // R3 — local validation is the authority, never the transport's promise.
    const parsed = hook.output.safeParse(reply.data);
    if (!parsed.success) {
      lastIssues = issuesOf(parsed.error);
      emit({ type: "invalid", issues: lastIssues });
      if (tier + 1 < prepared.models.length) {
        emit({ type: "escalate", from: model, to: prepared.models[tier + 1] as string, why: "schema" });
        continue;
      }
      break;
    }

    const domainIssues = hook.validate?.(parsed.data, item) ?? [];
    if (domainIssues.length > 0) {
      lastIssues = domainIssues;
      emit({ type: "invalid", issues: domainIssues });
      if (tier + 1 < prepared.models.length) {
        emit({ type: "escalate", from: model, to: prepared.models[tier + 1] as string, why: "domain" });
        continue;
      }
      break;
    }

    const confidence = (parsed.data as { confidence?: number }).confidence;
    if (typeof confidence === "number") {
      const { escalateBelow, acceptAbove } = prepared.policy;
      if (escalateBelow !== undefined && confidence < escalateBelow && tier + 1 < prepared.models.length) {
        emit({
          type: "escalate",
          from: model,
          to: prepared.models[tier + 1] as string,
          why: `confidence ${confidence.toFixed(2)} < ${escalateBelow}`,
        });
        continue;
      }
      // The last refusal before acceptance. Preferring abstention to an
      // uncertain modification is the whole disposition of this subsystem, and
      // this is where it is spent rather than argued.
      if (acceptAbove !== undefined && confidence < acceptAbove) {
        emit({
          type: "rejected",
          reason: "below the acceptance threshold",
          detail: `confidence ${confidence.toFixed(2)} < ${acceptAbove}`,
        });
        return giveUp(`confidence ${confidence.toFixed(2)} below the acceptance threshold ${acceptAbove}`);
      }
    }

    await runtime.cache.set(key, parsed.data, {
      hook: hook.id,
      version: hook.version,
      model: reply.resolvedModel,
    });
    emit({ type: "accepted", source: "model", model: reply.resolvedModel, ms });
    return { status: "ok", value: parsed.data, source: "model", model: reply.resolvedModel, ms };
  }

  const reason = lastIssues.length > 0 ? "no tier produced a valid reply" : "no tier produced a reply";
  return giveUp(reason, lastIssues);
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

/**
 * What one item would cost, without sending anything.
 *
 * Backs `biomd hooks test --dry-run` and the cost plan: nothing paid happens
 * before these numbers have been seen.
 */
export function planItem<TInput, TOutput>(
  prepared: PreparedHook<TInput, TOutput>,
  input: TInput,
): { gate: { call: boolean; reason: string }; system: string; user: string; estimatedInputTokens: number; model: string } {
  const hook = prepared.definition;
  const item = hook.input.parse(input);
  const gate = hook.gate(item);
  const rendered = hook.render(item);
  const system = renderTemplate(prepared.templates.system, rendered.vars);
  const user = renderTemplate(prepared.templates.user, rendered.vars);
  const model = prepared.models[0] ?? "(no model configured)";
  const estimatedInputTokens = estimateTokens({
    model,
    system,
    user,
    schema: { name: hook.id, schema: z.toJSONSchema(hook.output, { io: "output" }) as Record<string, unknown> },
    ...(rendered.images ? { images: rendered.images as readonly ChatImage[] } : {}),
  });
  return { gate, system, user, estimatedInputTokens, model };
}
