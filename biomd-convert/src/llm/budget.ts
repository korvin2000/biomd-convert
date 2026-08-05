/**
 * Budget enforcement.
 *
 * An estimated budget that is not enforced is a wish. Reservations happen
 * before a request is built and are settled against real usage afterwards, so
 * concurrent workers cannot collectively overspend in the window between
 * "check" and "call".
 *
 * This is the *inner* brake. A gateway virtual key with a USD cap is the outer
 * one: enforced server-side, unaffected by a bug in this file, and still in
 * force if the pipeline is invoked by hand. Configure both.
 */

export interface PriceTable {
  /** USD per million input tokens, by model. */
  input: Record<string, number>;
  /** USD per million output tokens. */
  output: Record<string, number>;
  /** Multiplier applied to cached input tokens. */
  cachedInputMultiplier: number;
}

/**
 * Prices are configuration, not knowledge: they change, and they differ per
 * gateway and per contract. The defaults are zero so that an unconfigured run
 * reports "unpriced" rather than a confidently wrong number.
 */
export const EMPTY_PRICES: PriceTable = { input: {}, output: {}, cachedInputMultiplier: 0.1 };

export interface BudgetLimits {
  maxCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCostUsd?: number;
}

export interface BudgetUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedCostUsd: number;
  /** Per-model breakdown, for the run manifest. */
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class Budget {
  readonly #limits: BudgetLimits;
  readonly #prices: PriceTable;
  #usage: BudgetUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsd: 0,
    byModel: {},
  };
  /** Tokens reserved by in-flight calls, not yet settled. */
  #reservedTokens = 0;
  #reservedCalls = 0;

  constructor(limits: BudgetLimits = {}, prices: PriceTable = EMPTY_PRICES) {
    this.#limits = limits;
    this.#prices = prices;
  }

  usage(): BudgetUsage {
    return { ...this.#usage, byModel: { ...this.#usage.byModel } };
  }

  /** Reserve capacity for one call. Throws rather than letting it proceed. */
  reserve(request: { hook: string; model: string; estimatedInputTokens: number }): void {
    const calls = this.#usage.calls + this.#reservedCalls + 1;
    if (this.#limits.maxCalls !== undefined && calls > this.#limits.maxCalls) {
      throw new BudgetExceededError(`call limit ${this.#limits.maxCalls} reached (hook ${request.hook})`);
    }

    const inputTokens = this.#usage.inputTokens + this.#reservedTokens + request.estimatedInputTokens;
    if (this.#limits.maxInputTokens !== undefined && inputTokens > this.#limits.maxInputTokens) {
      throw new BudgetExceededError(
        `input-token limit ${this.#limits.maxInputTokens} would be exceeded (hook ${request.hook})`,
      );
    }

    if (this.#limits.maxEstimatedCostUsd !== undefined) {
      const projected =
        this.#usage.estimatedCostUsd + this.#costOf(request.model, request.estimatedInputTokens, 0, 0);
      if (projected > this.#limits.maxEstimatedCostUsd) {
        throw new BudgetExceededError(
          `estimated cost $${projected.toFixed(4)} would exceed the $${this.#limits.maxEstimatedCostUsd} cap`,
        );
      }
    }

    this.#reservedCalls += 1;
    this.#reservedTokens += request.estimatedInputTokens;
  }

  /** Release a reservation whose call never happened. */
  release(): void {
    this.#reservedCalls = Math.max(0, this.#reservedCalls - 1);
    this.#reservedTokens = 0;
  }

  /** Record real usage and clear the reservation. */
  settle(actual: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  }): void {
    this.#reservedCalls = Math.max(0, this.#reservedCalls - 1);
    this.#reservedTokens = 0;

    this.#usage.calls += 1;
    this.#usage.inputTokens += actual.inputTokens;
    this.#usage.outputTokens += actual.outputTokens;
    this.#usage.cachedInputTokens += actual.cachedInputTokens;
    this.#usage.estimatedCostUsd += this.#costOf(
      actual.model,
      actual.inputTokens - actual.cachedInputTokens,
      actual.outputTokens,
      actual.cachedInputTokens,
    );

    const bucket = this.#usage.byModel[actual.model] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    bucket.calls += 1;
    bucket.inputTokens += actual.inputTokens;
    bucket.outputTokens += actual.outputTokens;
    this.#usage.byModel[actual.model] = bucket;
  }

  #costOf(model: string, inputTokens: number, outputTokens: number, cachedInputTokens: number): number {
    const inRate = this.#prices.input[model] ?? this.#prices.input[bareModel(model)] ?? 0;
    const outRate = this.#prices.output[model] ?? this.#prices.output[bareModel(model)] ?? 0;
    return (
      (inputTokens / 1_000_000) * inRate +
      (outputTokens / 1_000_000) * outRate +
      (cachedInputTokens / 1_000_000) * inRate * this.#prices.cachedInputMultiplier
    );
  }

  /** True when no price for any used model was configured. */
  unpriced(): boolean {
    return this.#usage.calls > 0 && this.#usage.estimatedCostUsd === 0;
  }
}

function bareModel(model: string): string {
  return model.split("/").pop() ?? model;
}

/**
 * A dry-run plan.
 *
 * Reports what *would* be spent before anything is sent. No network call
 * happens until these numbers have been seen and accepted.
 */
export interface CostPlan {
  items: number;
  byHook: Record<string, { items: number; estimatedInputTokens: number }>;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  /** True when the price table has no entry for a model in the plan. */
  unpriced: boolean;
  notes: string[];
}

export function planCost(
  items: ReadonlyArray<{ hook: string; model: string; estimatedInputTokens: number; estimatedOutputTokens: number }>,
  prices: PriceTable = EMPTY_PRICES,
): CostPlan {
  const byHook: CostPlan["byHook"] = {};
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;
  let estimatedCostUsd = 0;
  let unpriced = false;

  for (const item of items) {
    const bucket = byHook[item.hook] ?? { items: 0, estimatedInputTokens: 0 };
    bucket.items += 1;
    bucket.estimatedInputTokens += item.estimatedInputTokens;
    byHook[item.hook] = bucket;

    estimatedInputTokens += item.estimatedInputTokens;
    estimatedOutputTokens += item.estimatedOutputTokens;

    const inRate = prices.input[item.model] ?? prices.input[bareModel(item.model)];
    const outRate = prices.output[item.model] ?? prices.output[bareModel(item.model)];
    if (inRate === undefined || outRate === undefined) unpriced = true;
    estimatedCostUsd +=
      (item.estimatedInputTokens / 1_000_000) * (inRate ?? 0) +
      (item.estimatedOutputTokens / 1_000_000) * (outRate ?? 0);
  }

  const notes: string[] = [];
  if (unpriced) {
    notes.push(
      "No price configured for at least one model; the cost figure is a lower bound. " +
        "Set a price table from the gateway's own rates before trusting it.",
    );
  }
  notes.push(
    "Prompt caching and any provider batch discount are not modelled here. Confirm which of them the " +
      "configured gateway actually passes through before relying on either.",
  );

  return { items: items.length, byHook, estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd, unpriced, notes };
}
