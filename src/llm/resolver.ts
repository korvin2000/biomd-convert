/**
 * The gateway-backed resolver: where the hook runtime meets the compiler.
 *
 * Everything above this file speaks in classifications and column labels;
 * everything below speaks in requests, schemas and budgets. The join is
 * deliberately thin, and it is the only place the two vocabularies meet.
 *
 * Two behaviours are worth stating because they are what make an unattended
 * thousand-file run safe:
 *
 *   - a resolver *never* fails a conversion. Budget exhaustion, a dead gateway
 *     and a malformed reply all resolve to null, and null means "the
 *     deterministic answer stands and the item stays flagged";
 *   - every decision is cached on the resolved model identity, so a re-run after
 *     a code change costs nothing and produces byte-identical output.
 */
import type {
  Classification,
  DecisionResolver,
  ResolverStats,
  TableClassifyRequest,
  TableHeaderRequest,
} from "../convert-core/index.js";
import { emptyStats } from "../convert-core/resolver.js";
import { cellText, describePlan } from "../convert-core/data-table.js";
import { type Budget } from "./budget.js";
import type { DecisionCache } from "./cache.js";
import { type HookEvent, runHook } from "./hook.js";
import {
  type TableHeaderContext,
  replyToClassification,
  tableClassifyHook,
  tableHeaderHook,
} from "./hooks.js";
import type { Transport } from "./transport.js";

export interface GatewayResolverOptions {
  transport: Transport;
  cache: DecisionCache;
  budget: Budget;
  /** Model per escalation tier, from the resolved gateway config. */
  models: { fast: string; balanced: string; deep: string };
  /** Document language, so generated labels match the page. */
  lang: string;
  /** Replay only: never call the network. */
  replay?: boolean;
  onEvent?: (event: HookEvent) => void;
}

export class GatewayResolver implements DecisionResolver {
  readonly #options: GatewayResolverOptions;
  // `consulted` and `resolved` are the pipeline's to count — it knows which
  // decision points exist, including the ones a null resolver never sees.
  readonly #stats: ResolverStats = emptyStats();

  constructor(options: GatewayResolverOptions) {
    this.#options = options;
  }

  readonly #failures = new Map<string, number>();

  stats(): ResolverStats {
    return {
      ...this.#stats,
      failures: [...this.#failures]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      byHook: { ...this.#stats.byHook },
    };
  }

  #runtime() {
    return {
      transport: this.#options.transport,
      cache: this.#options.cache,
      budget: this.#options.budget,
      ...(this.#options.replay ? { replay: true } : {}),
      onEvent: (event: HookEvent) => {
        const bucket = (this.#stats.byHook[event.hook] ??= { calls: 0, cacheHits: 0, unresolved: 0 });
        if (event.type === "deterministic") this.#stats.deterministic += 1;
        if (event.type === "cache-hit") {
          this.#stats.cacheHits += 1;
          bucket.cacheHits += 1;
        }
        if (event.type === "call") {
          this.#stats.calls += 1;
          bucket.calls += 1;
        }
        if (event.type === "review") {
          this.#stats.unresolved += 1;
          bucket.unresolved += 1;
          // Collapse the per-item detail: forty items failing on one dead model
          // is one problem, and forty lines of it is noise that hides it.
          const reason = `${event.hook}: ${generalize(event.reason)}`;
          this.#failures.set(reason, (this.#failures.get(reason) ?? 0) + 1);
        }
        if (event.type === "invalid") {
          const reason = `${event.hook}: reply rejected — ${generalize(event.issues.join("; "))}`;
          this.#failures.set(reason, (this.#failures.get(reason) ?? 0) + 1);
        }
        this.#options.onEvent?.(event);
      },
    };
  }

  /** Substitute the configured tiers for the hook's declared placeholders. */
  #tiers(): readonly string[] {
    const { fast, balanced, deep } = this.#options.models;
    return [...new Set([fast, balanced, deep])];
  }

  async classifyTable(request: TableClassifyRequest): Promise<Classification | null> {
    const hook = { ...tableClassifyHook, models: this.#tiers() };
    // The deterministic tiers already ran in the pipeline and abstained; running
    // them again here would answer the question with the same "no".
    const { deterministic: _ignored, ...rest } = hook;
    const outcome = await runHook(
      rest as typeof tableClassifyHook,
      {
        ...(request.corpusFrequency !== undefined ? { corpusFrequency: request.corpusFrequency } : {}),
      },
      request.grid,
      this.#runtime(),
      `${request.sourceName ?? "?"}:${request.grid.id}`,
    );
    if (outcome.status !== "ok") return null;
    return replyToClassification(outcome.value, outcome.source === "deterministic" ? 2 : 3);
  }

  async tableHeaders(request: TableHeaderRequest): Promise<string[] | null> {
    const hook = { ...tableHeaderHook, models: this.#tiers() };
    const context: TableHeaderContext = {
      columns: request.plan.bands.length,
      planSummary: describePlan(request.plan, 0),
      lang: this.#options.lang,
      ...(request.grid.captionText ? { caption: request.grid.captionText } : {}),
      ...(precedingHeading(request) ? { precedingHeading: precedingHeading(request) as string } : {}),
    };

    const outcome = await runHook(
      hook,
      context,
      { rows: sampleRows(request) },
      this.#runtime(),
      `${request.sourceName ?? "?"}:${request.grid.id}:headers`,
    );
    if (outcome.status !== "ok") return null;
    if (outcome.value.headers.length !== request.plan.bands.length) return null;
    return outcome.value.headers.map((h) => h.trim());
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

/**
 * A sample of the planned matrix, not the whole thing.
 *
 * Naming a column needs a handful of representative values; a twenty-seven-row
 * discography adds nothing but tokens. Rows are taken from the head, middle and
 * tail so an irregular column is still visible.
 */
function sampleRows(request: TableHeaderRequest, limit = 8): string {
  const body = request.plan.body;
  const indices = new Set<number>();
  for (let i = 0; i < Math.min(limit, body.length); i += 1) {
    indices.add(Math.floor((i * (body.length - 1)) / Math.max(1, Math.min(limit, body.length) - 1)));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => {
      const row = body[i];
      if (!row) return "";
      return `  ${row.cells.map((c) => JSON.stringify(cellText(c, 48))).join(" | ")}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** The nearest heading above the table, which usually names what it lists. */
function precedingHeading(request: TableHeaderRequest): string | undefined {
  let node = request.grid.node.parent;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const siblings = node.children;
    for (let i = siblings.length - 1; i >= 0; i -= 1) {
      const sibling = siblings[i];
      if (!sibling || sibling.kind !== "element") continue;
      const marked = sibling.attrs["data-biomd-heading"];
      if (marked !== undefined || /^h[1-6]$/u.test(sibling.tag)) {
        const text = textContent(sibling);
        if (text) return text;
      }
    }
    node = node.parent;
  }
  return undefined;
}

function textContent(node: { children: Array<{ kind: string; value?: string; children: unknown[] }> }): string {
  let out = "";
  const visit = (n: { kind: string; value?: string; children: unknown[] }): void => {
    if (n.kind === "text") out += n.value ?? "";
    for (const child of n.children) visit(child as never);
  };
  visit(node as never);
  return out.replace(/\s+/gu, " ").trim().slice(0, 120);
}
