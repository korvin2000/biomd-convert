/**
 * What a hook run emits.
 *
 * Every observable moment of an escalation is an event, because the failure this
 * subsystem is most likely to produce is a *silent* one: a run that appears to
 * hang, a mistyped model id that looks exactly like "the LLM does nothing", a
 * budget that quietly stopped the third call of forty. Progress reporting, the
 * structured run log, the per-run statistics and the final report are all
 * projections of this one stream, so nothing can be visible in one and missing
 * from another.
 *
 * The stream is also the audit trail. `gate` records *why* a call was
 * authorised; `rejected` records why a schema-valid reply was still refused.
 */

export interface HookUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** The event minus the identity the runner attaches. What a call site writes. */
export type HookEventBody =
  /** The deterministic gate ran. `call: false` means nothing was spent. */
  | { type: "gate"; call: boolean; reason: string }
  | { type: "cache-hit"; model: string }
  | { type: "cache-miss" }
  /** Waiting for a concurrency slot on this endpoint. */
  | { type: "queued"; model: string; endpoint: string; depth: number }
  | { type: "call"; model: string; estimatedInputTokens: number; attempt: number }
  | { type: "reply"; model: string; ms: number; usage: HookUsage }
  /** A schema or domain violation. The reply was not used. */
  | { type: "invalid"; issues: string[] }
  | { type: "escalate"; from: string; to: string; why: string }
  /** Valid but not confident enough, or refused by the caller's acceptance check. */
  | { type: "rejected"; reason: string; detail?: string }
  | { type: "accepted"; source: "cache" | "model"; model: string; ms: number; summary?: string }
  /** Abandoned. The deterministic answer stands and the item remains a review item. */
  | { type: "review"; reason: string; issues?: string[] };

export interface HookEventIdentity {
  hook: string;
  /** Stable identity of the item under decision — document and node, where known. */
  item: string;
  /** Milliseconds since the run started, so a log reads as a timeline. */
  at: number;
}

export type HookEvent = HookEventBody & HookEventIdentity;

export type HookEventSink = (event: HookEvent) => void;

/** Collects a stream in memory. Used by tests and by `biomd hooks test`. */
export class EventRecorder {
  readonly events: HookEvent[] = [];
  readonly sink: HookEventSink = (event) => {
    this.events.push(event);
  };
  types(): string[] {
    return this.events.map((e) => e.type);
  }
  ofType<T extends HookEvent["type"]>(type: T): Array<Extract<HookEvent, { type: T }>> {
    return this.events.filter((e) => e.type === type) as Array<Extract<HookEvent, { type: T }>>;
  }
}

/**
 * A one-line human rendering, shared by the progress reporter and the run log.
 *
 * Kept here rather than in the CLI so that the same escalation reads identically
 * in the terminal, in `run.jsonl` and in a test assertion.
 */
export function describeEvent(event: HookEventBody): string {
  switch (event.type) {
    case "gate":
      return event.call ? `gate open — ${event.reason}` : `skipped — ${event.reason}`;
    case "cache-hit":
      return `cache hit (${event.model})`;
    case "cache-miss":
      return "cache miss";
    case "queued":
      return `queued on ${event.endpoint} (${event.depth} ahead)`;
    case "call":
      return `calling ${event.model}, ~${event.estimatedInputTokens} input tokens (attempt ${event.attempt})`;
    case "reply":
      return `${event.model} replied in ${event.ms} ms — ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`;
    case "invalid":
      return `reply rejected — ${event.issues.join("; ")}`;
    case "escalate":
      return `escalating ${event.from} → ${event.to} (${event.why})`;
    case "rejected":
      return `refused — ${event.reason}${event.detail ? `: ${event.detail}` : ""}`;
    case "accepted":
      return `accepted from ${event.source}${event.summary ? ` — ${event.summary}` : ""}`;
    case "review":
      return `left for review — ${event.reason}`;
    default: {
      const exhaustive: never = event;
      return JSON.stringify(exhaustive);
    }
  }
}
