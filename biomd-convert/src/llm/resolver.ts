/**
 * The gateway-backed resolver: where the hook kernel meets the compiler.
 *
 * Everything above this file speaks in classifications and column labels;
 * everything below speaks in requests, schemas and budgets. The join is
 * deliberately thin — one generic method — and it is the only place the two
 * vocabularies meet. It contains no hook names: a decision point is matched to
 * whatever enabled plugin declares the same id, and adding a hook never edits
 * this file.
 *
 * Three behaviours make an unattended thousand-file run safe:
 *
 *   - a resolver *never* fails a conversion. A closed gate, an exhausted
 *     budget, a dead gateway, a malformed reply and a refused acceptance check
 *     all resolve to null, and null means "the deterministic answer stands and
 *     the item stays flagged";
 *   - the compiler's own acceptance check runs last, on data the hook framework
 *     has already schema-validated, and it is the only thing that can authorise
 *     an application;
 *   - every decision is cached on the resolved model identity *and* the prompt
 *     template hashes, so a re-run after a code change costs nothing and
 *     produces byte-identical output, while an edited prompt is a new question.
 */
import type {
  DecisionPoint,
  DecisionResolver,
  HookCounts,
  ResolverStats,
} from "../convert-core/index.js";
import { emptyHookCounts, emptyStats } from "../convert-core/resolver.js";
import type { Budget } from "./budget.js";
import type { DecisionCache } from "./cache.js";
import type { HookRunContext, ModelTier } from "./kernel/contract.js";
import { Limiter } from "./kernel/concurrency.js";
import type { HookEvent, HookEventSink } from "./kernel/events.js";
import type { PreparedHook } from "./kernel/runner.js";
import { runHook } from "./kernel/runner.js";
import type { Transport } from "./transport.js";

export interface GatewayResolverOptions {
  transport: Transport;
  cache: DecisionCache;
  budget: Budget;
  /** Enabled hooks, already prepared: policy applied, prompts loaded. */
  hooks: ReadonlyArray<PreparedHook>;
  /** Names the queue that protects the server. Usually the gateway name. */
  endpoint: string;
  /** Model per escalation tier, from the resolved gateway config. */
  models: Record<ModelTier, string>;
  /** Facts about the run, handed to every hook unchanged. */
  context: HookRunContext;
  limiter?: Limiter;
  /**
   * Stop calling after this many consecutive transport failures. 0 disables it.
   *
   * A budget cannot carry this weight: it counts *settled* usage, and a request
   * that never reached a model settles nothing — so a dead gateway is invisible
   * to `maxCalls` and a corpus run against one produces one doomed request per
   * escalation. Measured on the 28-document bench: 72 of them, in nine seconds,
   * every one reporting the same refused connection. That is a batch conversion
   * hammering a server that is already unwell, and the first failure had
   * already told us everything the other seventy-one did.
   */
  breakerAfter?: number;
  /** Replay only: never call the network. */
  replay?: boolean;
  onEvent?: HookEventSink;
  startedAt?: number;
}

export class GatewayResolver implements DecisionResolver {
  readonly #options: GatewayResolverOptions;
  readonly #limiter: Limiter;
  readonly #byPoint = new Map<string, PreparedHook>();
  readonly #callsByHook = new Map<string, number>();
  readonly #failures = new Map<string, number>();
  // `consulted` and `resolved` are the pipeline's to count — it knows which
  // decision points exist, including the ones a null resolver never sees.
  readonly #stats: ResolverStats = emptyStats();

  constructor(options: GatewayResolverOptions) {
    this.#options = options;
    this.#limiter = options.limiter ?? new Limiter();
    for (const prepared of options.hooks) {
      const point = prepared.definition.decisionPoint;
      const existing = this.#byPoint.get(point);
      if (existing) {
        throw new Error(
          `Hooks ${existing.definition.id} and ${prepared.definition.id} both serve the decision point ` +
            `${JSON.stringify(point)}. Two hooks may compete for a point, but only one may be enabled at ` +
            "a time — a run in which both answer is a run whose output nobody can attribute.",
        );
      }
      this.#byPoint.set(point, prepared);
    }
  }

  /** Which decision points this resolver can actually answer. */
  servedPoints(): string[] {
    return [...this.#byPoint.keys()].sort();
  }

  stats(): ResolverStats {
    return {
      ...this.#stats,
      failures: [...this.#failures]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      byHook: Object.fromEntries(Object.entries(this.#stats.byHook).map(([k, v]) => [k, { ...v }])),
    };
  }

  #counts(hook: string): HookCounts {
    return (this.#stats.byHook[hook] ??= emptyHookCounts());
  }

  #record(event: HookEvent): void {
    const bucket = this.#counts(event.hook);
    switch (event.type) {
      case "gate":
        if (!event.call) {
          this.#stats.skipped += 1;
          bucket.skipped += 1;
        }
        break;
      case "cache-hit":
        this.#stats.cacheHits += 1;
        bucket.cacheHits += 1;
        break;
      case "call":
        this.#stats.calls += 1;
        bucket.calls += 1;
        break;
      case "reply":
        this.#stats.inputTokens += event.usage.inputTokens;
        this.#stats.outputTokens += event.usage.outputTokens;
        // Something answered. Whatever it said, the gateway is alive.
        this.#consecutiveTransportFailures = 0;
        break;
      case "rejected":
        this.#stats.rejected += 1;
        bucket.rejected += 1;
        this.#note(`${event.hook}: ${event.reason}`);
        break;
      case "review":
        this.#stats.unresolved += 1;
        bucket.unresolved += 1;
        this.#note(`${event.hook}: ${event.reason}`);
        if (event.reason.startsWith("transport failure")) this.#tripCheck();
        break;
      case "invalid":
        this.#note(`${event.hook}: reply rejected — ${event.issues.join("; ")}`);
        break;
      default:
        break;
    }
    this.#options.onEvent?.(event);
  }

  /**
   * Collapse the per-item detail.
   *
   * Forty items failing on one dead model is one problem, and forty lines of it
   * is noise that hides it.
   */
  #note(reason: string): void {
    const key = generalize(reason);
    this.#failures.set(key, (this.#failures.get(key) ?? 0) + 1);
  }

  #since(): number {
    return Date.now() - (this.#options.startedAt ?? Date.now());
  }

  /** Open the circuit once the gateway has failed to answer often enough. */
  #tripCheck(): void {
    const limit = this.#options.breakerAfter ?? 0;
    if (limit <= 0) return;
    this.#consecutiveTransportFailures += 1;
    if (this.#consecutiveTransportFailures < limit || this.#breakerOpen) return;
    this.#breakerOpen = true;
    // Once, not once per remaining item: the whole point is to stop repeating.
    this.#note(
      `circuit opened after ${limit} consecutive transport failures — the rest of this run ` +
        "escalated nothing. Fix the gateway and re-run; cached decisions are kept.",
    );
  }

  /** Consecutive transport failures; reset by any reply that arrives. */
  #consecutiveTransportFailures = 0;
  #breakerOpen = false;

  /** True once the resolver has stopped calling a gateway that is not answering. */
  get circuitOpen(): boolean {
    return this.#breakerOpen;
  }

  async decide<TRequest, TDecision>(
    point: DecisionPoint<TRequest, TDecision>,
    request: TRequest,
  ): Promise<TDecision | null> {
    const prepared = this.#byPoint.get(point.id);
    if (!prepared) return null;

    const itemId = point.itemId(request);
    const hookId = prepared.definition.id;

    if (this.#breakerOpen) {
      this.#record({
        type: "review",
        reason: "gateway is not answering; no further calls this run",
        hook: hookId,
        item: itemId,
        at: this.#since(),
      });
      return null;
    }
    const outcome = await runHook(
      prepared,
      { request, context: this.#options.context },
      {
        transport: this.#options.transport,
        cache: this.#options.cache,
        budget: this.#options.budget,
        limiter: this.#limiter,
        endpoint: this.#options.endpoint,
        ...(this.#options.replay ? { replay: true } : {}),
        ...(this.#options.startedAt !== undefined ? { startedAt: this.#options.startedAt } : {}),
        calls: this.#callsByHook,
        onEvent: (event) => this.#record(event),
      },
      itemId,
    );

    if (outcome.status !== "ok") return null;

    // The last word, and it is the compiler's. A well-formed reply has proved
    // nothing about this document; `accept` re-establishes every property the
    // escalation site depends on before a single node is touched.
    const verdict = point.accept(outcome.value, request);
    if (!verdict.ok) {
      this.#record({
        type: "rejected",
        reason: verdict.reason,
        detail: `acceptance check at ${point.id}`,
        hook: hookId,
        item: itemId,
        at: this.#since(),
      });
      return null;
    }

    this.#counts(hookId).resolved += 1;
    return verdict.value;
  }
}

/**
 * Strip the item-specific tail off a failure reason so identical causes group.
 *
 * A gateway error body carries the request id and sometimes the payload; keeping
 * those makes every failure look unique and turns one dead model into forty
 * distinct "problems".
 */
function generalize(reason: string): string {
  return reason
    .replace(/\s+/gu, " ")
    .replace(/"[^"]{40,}"/gu, '"…"')
    .replace(/\b[0-9a-f]{16,}\b/giu, "…")
    .trim()
    .slice(0, 160);
}
