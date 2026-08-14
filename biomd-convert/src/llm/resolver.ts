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
  BlockRoleAnswer,
  BlockRoleRequest,
  BreakKind,
  BreakRunRequest,
  Classification,
  DecisionResolver,
  DocumentReviewRequest,
  ReviewFinding,
  ImageRoleAnswer,
  ImageRoleRequest,
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
  MAX_FINDINGS,
  blockRoleHook,
  documentReviewHook,
  imageRoleHook,
  isSanctionedGlyph,
  numbered,
  quote,
  replyToClassification,
  tableClassifyHook,
  tableHeaderHook,
  textSegmentHook,
  trimRationale,
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
  /**
   * Which escalations this run may make, by hook id.
   *
   * **Omitted means none.** Not a default set — none. Turning a hook on is a
   * decision an operator makes per run, out loud, and the CLI prints the list it
   * ended up with before it converts anything.
   *
   * That is a reversal, and it is the lesson of the version this replaces. That
   * one shipped seven hooks in a default set on the reasoning that each fired
   * only on some rule's residual, so the blast radius was small. The reasoning
   * was wrong twice over: three of the seven were not firing on a residual at
   * all but overriding rules that had decided, and the operator who typed
   * `--llm assist` had no way to know which seven he had bought. Opting in per
   * hook makes both failures impossible to have by accident — an escalation that
   * damages a page is now one somebody chose.
   */
  hooks?: readonly string[];
}

/**
 * The escalations a run makes when nobody says which — deliberately empty.
 *
 * `--llm assist` on its own configures a gateway and asks nothing. The
 * deterministic compiler is the product; escalation is an instrument you point
 * at a specific problem, with `--hooks <id>`, having read `biomd llm-plan` to
 * see what each one is asked and what checks its answer.
 *
 * Kept as a named export rather than inlined so the CLI, the tests and
 * `llm-plan` all agree on what "the default" is, and so that changing it later
 * is one edit in a file that has to explain itself.
 */
export const DEFAULT_HOOKS: readonly string[] = [];

export class GatewayResolver implements DecisionResolver {
  readonly #options: GatewayResolverOptions;
  // `consulted` and `resolved` are the pipeline's to count — it knows which
  // decision points exist, including the ones a null resolver never sees.
  readonly #stats: ResolverStats = emptyStats();
  readonly #enabled: ReadonlySet<string>;

  // Declared, not defined. Each is installed in the constructor only when its
  // hook is enabled, so "this resolver cannot answer that" and "this resolver
  // answered null" stay distinguishable at the call site — which is what keeps
  // the escalation counters honest.
  blockRole?: DecisionResolver["blockRole"];
  imageRole?: DecisionResolver["imageRole"];
  classifyBreaks?: DecisionResolver["classifyBreaks"];
  reviewDocument?: DecisionResolver["reviewDocument"];

  constructor(options: GatewayResolverOptions) {
    this.#options = options;
    this.#enabled = new Set(options.hooks ?? DEFAULT_HOOKS);

    const self = this as Record<string, unknown>;
    const install = (id: string, key: string, method: unknown): void => {
      if (this.#enabled.has(id)) self[key] = method;
    };
    install("text.block-role", "blockRole", this.#blockRole.bind(this));
    install("image.role", "imageRole", this.#imageRole.bind(this));
    install("text.segment", "classifyBreaks", this.#classifyBreaks.bind(this));
    install("document.review", "reviewDocument", this.#reviewDocument.bind(this));
  }

  /** Which escalations this resolver may make, for the run report. */
  enabledHooks(): string[] {
    return [...this.#enabled].sort();
  }

  /**
   * Whether a hook is switched on.
   *
   * The optional methods answer this by existing; `classifyTable` and
   * `tableHeaders` are required by the interface and always present, so without
   * this the pipeline cannot tell "switched off" from "declined" for exactly the
   * two hooks that predate the rest.
   */
  canAnswer(hookId: string): boolean {
    return this.#enabled.has(hookId);
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
        const bucket = (this.#stats.byHook[event.hook] ??= { consulted: 0, calls: 0, cacheHits: 0, unresolved: 0 });
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
    if (!this.#enabled.has("table.classify")) return null;
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
    if (!this.#enabled.has("table.records")) return null;
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

  // -------------------------------------------------------------------------
  // The escalations added beyond table classification.
  //
  // Every one of them ends the same way: a reply that does not satisfy its
  // acceptance check returns `null`, and `null` means the deterministic answer
  // stands. There is no path from here by which a model changes a decision the
  // compiler was sure of, because none of these methods is called unless a rule
  // has already abstained — and the pipeline, not this class, is what enforces
  // that.
  // -------------------------------------------------------------------------

  async #imageRole(request: ImageRoleRequest): Promise<ImageRoleAnswer | null> {
    const hook = { ...imageRoleHook, models: this.#tiers() };
    const outcome = await runHook(
      hook,
      {
        lang: this.#options.lang,
        size: request.size,
        ...(request.alt ? { alt: request.alt } : {}),
        inLink: request.inLink,
        ...(request.linkTarget ? { linkTarget: request.linkTarget } : {}),
        occurrences: request.occurrences,
        ...(request.inRunningProse !== undefined ? { inRunningProse: request.inRunningProse } : {}),
      },
      { surroundings: request.surroundings },
      this.#runtime(),
      `${request.sourceName ?? "?"}:${request.id}:image-role`,
    );
    if (outcome.status !== "ok") return null;
    const { role, glyph } = outcome.value;
    if (role === "UNCERTAIN") return null;
    // The vocabulary is closed on both sides of the boundary. An `ICON` whose
    // mark the project's own table does not sanction is not an icon this
    // compiler can emit, so it is dropped rather than approximated.
    if (role === "ICON" && (glyph === null || glyph === "" || !isSanctionedGlyph(glyph))) return null;
    return {
      role,
      ...(role === "ICON" && glyph ? { glyph } : {}),
      confidence: outcome.value.confidence,
      reason: trimRationale(outcome.value.rationale),
    };
  }

  async #blockRole(request: BlockRoleRequest): Promise<BlockRoleAnswer | null> {
    const hook = { ...blockRoleHook, models: this.#tiers() };
    const outcome = await runHook(
      hook,
      {
        lang: this.#options.lang,
        typography: request.typography,
        ...(request.openHeading !== undefined ? { openHeading: request.openHeading } : {}),
        ...(request.openDepth !== undefined ? { openDepth: request.openDepth } : {}),
      },
      {
        line: quote(request.line),
        before: quote(request.before),
        after: quote(request.after),
        siblings:
          request.siblingLines && request.siblingLines.length > 0
            ? numbered(request.siblingLines.map((text) => ({ text })))
            : "(none — this is the only unplaced line on the page)",
      },
      this.#runtime(),
      `${request.sourceName ?? "?"}:${request.id}:block-role`,
    );
    if (outcome.status !== "ok") return null;
    if (outcome.value.role === "UNCERTAIN") return null;
    return {
      role: outcome.value.role,
      ...(outcome.value.depth !== null ? { depth: outcome.value.depth } : {}),
      confidence: outcome.value.confidence,
      reason: trimRationale(outcome.value.rationale),
    };
  }

  async #classifyBreaks(request: BreakRunRequest): Promise<readonly BreakKind[] | null> {
    const hook = { ...textSegmentHook, models: this.#tiers() };
    const outcome = await runHook(
      hook,
      { lang: this.#options.lang, context: request.context, count: request.breaks.length },
      { breaks: request.breaks },
      this.#runtime(),
      `${request.sourceName ?? "?"}:${request.id}:breaks`,
    );
    if (outcome.status !== "ok") return null;
    // The kinds are positional, so a single abstention cannot be dropped without
    // shifting every verdict after it onto the wrong break. A run the model
    // half-read is one the geometry rule's reading should keep, whole.
    if (outcome.value.kinds.some((k) => k === "UNCERTAIN")) return null;
    return outcome.value.kinds as readonly BreakKind[];
  }

  async #reviewDocument(request: DocumentReviewRequest): Promise<readonly ReviewFinding[] | null> {
    const hook = { ...documentReviewHook, models: this.#tiers().slice(-1) };
    const outcome = await runHook(
      hook,
      {
        lang: this.#options.lang,
        sourceName: request.sourceName,
        summary: request.summary,
        ...(request.warnings && request.warnings.length > 0
          ? { warnings: request.warnings.map((w) => `  - ${w}`).join("\n") }
          : {}),
        maxFindings: MAX_FINDINGS,
      },
      { sourceText: request.sourceText, output: request.output },
      this.#runtime(),
      `${request.sourceName}:review`,
    );
    if (outcome.status !== "ok") return null;
    return outcome.value.findings;
  }
}

/**
 * How sure a rejoin has to be before it is applied.
 *
 * Not tuned against a metric and not derived from one. It is the number at which
 * "the model was fairly sure" stops being enough for an edit whose failure mode
 * is a corrupted word that no later gate detects, and it sits above the hook's
 * own escalation floor so that a reply which already escalated once and came
 * back merely acceptable does not silently rewrite the page.
 */
const JOIN_CONFIDENCE_FLOOR = 0.75;

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
