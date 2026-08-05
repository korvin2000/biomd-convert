/**
 * The provenance ledger and the pass framework that enforces it.
 *
 * The rule is: every source item ends in exactly one terminal state. Stated as
 * a convention it would be a discipline tax on a dozen passes and would erode —
 * a ledger retrofitted at pass nine is a ledger with eight holes. Stated here,
 * as a runtime assertion the framework performs after every pass, it is a
 * guarantee.
 *
 * The point is not bookkeeping for its own sake. It is that **no item may
 * disappear because it was absent from a response** — the one structural
 * promise a guide-driven conversion cannot make.
 */

export type Terminal =
  | { kind: "EMITTED"; to: string }
  | { kind: "MERGED_INTO"; to: string }
  | { kind: "MOVED_TO"; to: string }
  | { kind: "REMOVED"; reason: string }
  | { kind: "REVIEW"; reason: string };

export interface LedgerEntry {
  /** Source item id. */
  id: string;
  terminal: Terminal;
  /** Pass that decided. */
  pass: string;
  decidedBy: "rule" | "profile" | "classifier" | "human" | `llm:${string}`;
  confidence: number;
  /** Short human-readable justification, for the audit. */
  note?: string;
}

export class LedgerError extends Error {
  readonly pass: string;
  readonly missing: string[];
  readonly unknown: string[];
  constructor(pass: string, missing: string[], unknown: string[]) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`${missing.length} input item(s) have no terminal state: ${preview(missing)}`);
    }
    if (unknown.length > 0) {
      parts.push(`${unknown.length} ledger entr(y|ies) reference unknown items: ${preview(unknown)}`);
    }
    super(`Pass ${JSON.stringify(pass)} violated ledger totality. ${parts.join("; ")}`);
    this.name = "LedgerError";
    this.pass = pass;
    this.missing = missing;
    this.unknown = unknown;
  }
}

function preview(ids: string[]): string {
  const head = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `${head}, … (+${ids.length - 5})` : head;
}

/** Accumulates every decision made about every source item across all passes. */
export class Ledger {
  readonly #entries: LedgerEntry[] = [];
  readonly #byId = new Map<string, LedgerEntry[]>();

  record(entry: LedgerEntry): void {
    this.#entries.push(entry);
    const list = this.#byId.get(entry.id);
    if (list) list.push(entry);
    else this.#byId.set(entry.id, [entry]);
  }

  entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  for(id: string): readonly LedgerEntry[] {
    return this.#byId.get(id) ?? [];
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** Items whose final state is REVIEW, i.e. what a human still has to look at. */
  reviews(): LedgerEntry[] {
    return this.#entries.filter((e) => e.terminal.kind === "REVIEW");
  }

  /** Items removed, with reasons — the answer to "where did this content go?". */
  removals(): LedgerEntry[] {
    return this.#entries.filter((e) => e.terminal.kind === "REMOVED");
  }

  counts(): Record<Terminal["kind"], number> {
    const out: Record<Terminal["kind"], number> = {
      EMITTED: 0,
      MERGED_INTO: 0,
      MOVED_TO: 0,
      REMOVED: 0,
      REVIEW: 0,
    };
    for (const e of this.#entries) out[e.terminal.kind] += 1;
    return out;
  }

  toJSON(): LedgerEntry[] {
    return [...this.#entries];
  }
}

/** What a pass hands back: its output plus what it did to every input item. */
export interface PassResult<Out> {
  output: Out;
  /** One entry per input item. Totality is checked by {@link runPass}. */
  ledger: LedgerEntry[];
  warnings?: string[];
}

export interface PassContext {
  ledger: Ledger;
  warnings: string[];
}

export interface Pass<In, Out> {
  id: string;
  /**
   * Ids of the items this pass is accountable for. A pass that transforms a
   * subset of the document declares only that subset.
   */
  inputIds(input: In): string[];
  run(input: In, ctx: PassContext): PassResult<Out>;
}

/**
 * Execute a pass and assert ledger totality.
 *
 * Two failures are possible and both are bugs, not data problems: an input item
 * the pass forgot to account for, and a ledger entry naming an item that was
 * never an input. Either would let content vanish silently, so both throw.
 */
export function runPass<In, Out>(pass: Pass<In, Out>, input: In, ctx: PassContext): Out {
  const declared = new Set(pass.inputIds(input));
  const result = pass.run(input, ctx);

  const accounted = new Set<string>();
  const unknown: string[] = [];
  for (const entry of result.ledger) {
    if (!declared.has(entry.id)) unknown.push(entry.id);
    accounted.add(entry.id);
    ctx.ledger.record({ ...entry, pass: entry.pass || pass.id });
  }

  const missing = [...declared].filter((id) => !accounted.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new LedgerError(pass.id, missing, unknown);
  }

  if (result.warnings) ctx.warnings.push(...result.warnings);
  return result.output;
}

/** Convenience constructors, so passes read declaratively. */
export const emitted = (id: string, to: string, opts: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  terminal: { kind: "EMITTED", to },
  pass: opts.pass ?? "",
  decidedBy: opts.decidedBy ?? "rule",
  confidence: opts.confidence ?? 1,
  ...(opts.note ? { note: opts.note } : {}),
});

export const mergedInto = (id: string, to: string, opts: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  terminal: { kind: "MERGED_INTO", to },
  pass: opts.pass ?? "",
  decidedBy: opts.decidedBy ?? "rule",
  confidence: opts.confidence ?? 1,
  ...(opts.note ? { note: opts.note } : {}),
});

export const movedTo = (id: string, to: string, opts: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  terminal: { kind: "MOVED_TO", to },
  pass: opts.pass ?? "",
  decidedBy: opts.decidedBy ?? "rule",
  confidence: opts.confidence ?? 1,
  ...(opts.note ? { note: opts.note } : {}),
});

export const removed = (id: string, reason: string, opts: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  terminal: { kind: "REMOVED", reason },
  pass: opts.pass ?? "",
  decidedBy: opts.decidedBy ?? "rule",
  confidence: opts.confidence ?? 1,
  ...(opts.note ? { note: opts.note } : {}),
});

export const review = (id: string, reason: string, opts: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  terminal: { kind: "REVIEW", reason },
  pass: opts.pass ?? "",
  decidedBy: opts.decidedBy ?? "rule",
  confidence: opts.confidence ?? 0.5,
  ...(opts.note ? { note: opts.note } : {}),
});
