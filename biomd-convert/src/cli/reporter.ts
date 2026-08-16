/**
 * What a run says about itself while it is running.
 *
 * The failure this exists to prevent is not a wrong number, it is a silent
 * terminal. A corpus run measures pages in a browser, waits on a gateway and
 * de-hyphenates against a dictionary; any of those can take tens of seconds,
 * and a program that prints nothing during them is indistinguishable from one
 * that has hung. So: a live line on a terminal, a heartbeat when nothing else
 * has happened, and — always, regardless of level — a structured log on disk
 * that is detailed enough to reconstruct what the run did and why.
 *
 * Two rules keep it usable rather than merely loud:
 *
 *   - **progress goes to stderr.** Stdout stays the machine-readable surface,
 *     so `corpus run > report.txt` and the scripts that grep it are unaffected;
 *   - **the level decides the terminal, never the log.** `--quiet` suppresses
 *     the display and still writes the full `run.jsonl`, because the moment you
 *     need the detail is after the run that did not show it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { hrtime } from "node:process";
import type { HookEvent } from "../llm/kernel/events.js";
import { describeEvent } from "../llm/kernel/events.js";

export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

const RANK: Record<LogLevel, number> = { quiet: 0, normal: 1, verbose: 2, debug: 3 };

export interface ReporterOptions {
  level?: LogLevel;
  /** Seconds between heartbeats when nothing else has happened. 0 disables. */
  heartbeatSeconds?: number;
  /** Directory for `run.jsonl` and `report.json`. Omit to keep the run in memory. */
  logDir?: string;
  /** Overridden in tests; defaults to `process.stderr`. */
  out?: { write(chunk: string): unknown; isTTY?: boolean };
  /** Total files, when known up front. */
  total?: number;
}

export interface FileOutcome {
  name: string;
  state: string;
  status: "ok" | "review" | "failed";
  ms: number;
  detail?: Record<string, unknown>;
}

/** One line of the structured log. Everything the run did, in order. */
export interface LogRecord {
  at: number;
  kind: string;
  [key: string]: unknown;
}

export class RunReporter {
  readonly #level: LogLevel;
  readonly #out: { write(chunk: string): unknown; isTTY?: boolean };
  readonly #tty: boolean;
  readonly #startedAt = Date.now();
  readonly #startedNs = hrtime.bigint();
  readonly #heartbeatMs: number;
  readonly #records: LogRecord[] = [];
  readonly files: FileOutcome[] = [];

  #stream: WriteStream | null = null;
  #logDir: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #total: number;
  #started = 0;
  #done = 0;
  #failed = 0;
  #review = 0;
  #stage = "starting";
  #current: string | null = null;
  #lastPaintAt = 0;
  #painted = false;
  /** Live LLM counters, so the progress line can say what the model is doing. */
  readonly llm = { pending: 0, calls: 0, cacheHits: 0, skipped: 0, rejected: 0, unresolved: 0, inputTokens: 0, outputTokens: 0 };
  #activeHook: string | null = null;

  constructor(options: ReporterOptions = {}) {
    this.#level = options.level ?? "normal";
    this.#out = options.out ?? process.stderr;
    this.#tty = this.#out.isTTY === true && process.env["NO_COLOR"] === undefined;
    this.#heartbeatMs = Math.round((options.heartbeatSeconds ?? 20) * 1000);
    this.#total = options.total ?? 0;
  }

  /** Open the on-disk log. Safe to skip; everything else still works. */
  async open(logDir: string | null, header: Record<string, unknown>): Promise<void> {
    this.record("run.start", header);
    if (!logDir) return;
    await mkdir(logDir, { recursive: true });
    this.#logDir = logDir;
    this.#stream = createWriteStream(join(logDir, "run.jsonl"), { flags: "a" });
    for (const record of this.#records) this.#stream.write(`${JSON.stringify(record)}\n`);
  }

  get logDir(): string | null {
    return this.#logDir;
  }

  setTotal(total: number): void {
    this.#total = total;
  }

  /** Elapsed milliseconds, monotonic. */
  get elapsedMs(): number {
    return Number(hrtime.bigint() - this.#startedNs) / 1e6;
  }

  // -- the stream --------------------------------------------------------

  record(kind: string, fields: Record<string, unknown> = {}): void {
    const line: LogRecord = { at: Math.round(this.elapsedMs), kind, ...fields };
    this.#records.push(line);
    this.#stream?.write(`${JSON.stringify(line)}\n`);
  }

  get records(): readonly LogRecord[] {
    return this.#records;
  }

  // -- the display -------------------------------------------------------

  #enabled(level: LogLevel): boolean {
    return RANK[this.#level] >= RANK[level];
  }

  /** A line that stays. Clears the live progress line first so nothing overlaps. */
  #say(text: string): void {
    if (this.#painted) {
      this.#out.write(`\r${" ".repeat(120)}\r`);
      this.#painted = false;
    }
    this.#out.write(`${text}\n`);
  }

  /**
   * The live line.
   *
   * On a terminal it is repainted in place and costs nothing to update often.
   * Anywhere else — a redirected run, a CI log, `> last-run.txt` — it can only
   * ever *append*, so it is written on a heartbeat and on nothing else. That
   * distinction is the difference between "a sign of life every twenty seconds"
   * and two extra lines per file in a file somebody greps.
   */
  #paint(tick = false): void {
    if (!this.#enabled("normal")) return;
    if (!this.#tty) {
      if (tick) this.#out.write(`${this.progressLine()}\n`);
      return;
    }
    const now = Date.now();
    if (!tick && now - this.#lastPaintAt < 120) return;
    this.#lastPaintAt = now;
    this.#out.write(`\r${this.progressLine().padEnd(118).slice(0, 118)}`);
    this.#painted = true;
  }

  /** The one-line status, also used by the heartbeat and by tests. */
  progressLine(): string {
    const parts = [`[${formatDuration(this.elapsedMs)}]`, this.#stage];
    if (this.#total > 0) parts.push(`${this.#done}/${this.#total}`);
    if (this.#current) parts.push(this.#current);
    const tally: string[] = [];
    if (this.#review > 0) tally.push(`${this.#review} review`);
    if (this.#failed > 0) tally.push(`${this.#failed} failed`);
    if (tally.length > 0) parts.push(`(${tally.join(", ")})`);
    if (this.llm.calls > 0 || this.llm.pending > 0 || this.llm.cacheHits > 0) {
      const llm = [`llm ${this.llm.calls} call${this.llm.calls === 1 ? "" : "s"}`];
      if (this.llm.pending > 0) llm.push(`${this.llm.pending} in flight`);
      if (this.llm.cacheHits > 0) llm.push(`${this.llm.cacheHits} cached`);
      if (this.#activeHook) llm.push(this.#activeHook);
      parts.push(`· ${llm.join(", ")}`);
    }
    return parts.join(" ");
  }

  start(): void {
    if (this.#heartbeatMs > 0 && this.#enabled("normal")) {
      this.#timer = setInterval(() => {
        // A heartbeat is only interesting when nothing else has spoken. On a
        // terminal the live line already moves; elsewhere this is the only
        // sign of life a redirected run produces.
        this.#paint(true);
        this.record("heartbeat", { stage: this.#stage, done: this.#done, total: this.#total });
      }, this.#heartbeatMs);
      this.#timer.unref();
    }
  }

  stage(name: string, detail?: string): void {
    this.#stage = detail ? `${name} ${detail}` : name;
    this.record("stage", { stage: name, ...(detail ? { detail } : {}) });
    this.#paint();
  }

  fileStart(name: string): void {
    this.#started += 1;
    this.#current = name;
    // Reset the stage, so the line never reports the previous file's last stage
    // against this file's name.
    this.#stage = "converting";
    this.record("file.start", { file: name, index: this.#started, total: this.#total });
    if (this.#enabled("verbose")) this.#say(`→ ${name}`);
    this.#paint();
  }

  fileDone(outcome: FileOutcome): void {
    this.#done += 1;
    if (outcome.status === "failed") this.#failed += 1;
    if (outcome.status === "review") this.#review += 1;
    this.files.push(outcome);
    this.record("file.done", { file: outcome.name, status: outcome.status, state: outcome.state, ms: Math.round(outcome.ms), ...outcome.detail });
    if (outcome.status === "failed") {
      // A failure is never hidden, at any level above `quiet`.
      this.#say(`FAILED ${outcome.name}: ${String(outcome.detail?.["error"] ?? outcome.state)}`);
    } else if (this.#enabled("verbose")) {
      this.#say(`✓ ${outcome.name} ${outcome.state} in ${formatDuration(outcome.ms)}`);
    }
    this.#paint();
  }

  /**
   * One escalation event.
   *
   * The standing rule is that an escalation is never silent: at `normal` the
   * accepted and refused decisions print, with the reason; `verbose` adds the
   * gate verdicts and the queueing; `debug` adds everything, including the
   * cache misses.
   */
  hookEvent(event: HookEvent, file?: string): void {
    this.record("llm", { ...event, ...(file ? { file } : {}) });
    switch (event.type) {
      case "call":
        this.llm.calls += 1;
        this.llm.pending += 1;
        this.#activeHook = event.hook;
        break;
      case "reply":
        this.llm.pending = Math.max(0, this.llm.pending - 1);
        this.llm.inputTokens += event.usage.inputTokens;
        this.llm.outputTokens += event.usage.outputTokens;
        break;
      case "cache-hit":
        this.llm.cacheHits += 1;
        break;
      case "gate":
        if (!event.call) this.llm.skipped += 1;
        break;
      case "rejected":
        this.llm.rejected += 1;
        break;
      case "review":
        this.llm.pending = Math.max(0, this.llm.pending - 1);
        this.llm.unresolved += 1;
        break;
      default:
        break;
    }

    const loud = event.type === "accepted" || event.type === "rejected" || event.type === "review" || event.type === "invalid";
    const chatty = event.type === "gate" || event.type === "call" || event.type === "escalate" || event.type === "queued";
    if ((loud && this.#enabled("normal")) || (chatty && this.#enabled("verbose")) || this.#enabled("debug")) {
      this.#say(`  llm ${event.hook} ${event.item} — ${describeEvent(event)}`);
    }
    this.#paint();
  }

  note(message: string): void {
    this.record("note", { message });
    if (this.#enabled("normal")) this.#say(`note: ${message}`);
  }

  warn(message: string): void {
    this.record("warning", { message });
    // A warning is worth interrupting even a quiet run: every one of them is
    // something the operator can act on.
    this.#say(`warning: ${message}`);
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.record("debug", { message, ...fields });
    if (this.#enabled("debug")) this.#say(`  debug: ${message}`);
  }

  /** Stop the heartbeat, clear the live line, flush and write the report. */
  async finish(report: Record<string, unknown>): Promise<string | null> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#painted) {
      this.#out.write(`\r${" ".repeat(120)}\r`);
      this.#painted = false;
    }
    const full = {
      startedAt: new Date(this.#startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(this.elapsedMs),
      ...report,
      files: this.files.map((f) => ({ name: f.name, status: f.status, state: f.state, ms: Math.round(f.ms), ...f.detail })),
    };
    this.record("run.finish", { durationMs: Math.round(this.elapsedMs) });

    await new Promise<void>((done) => {
      if (!this.#stream) return done();
      this.#stream.end(done);
    });
    this.#stream = null;

    if (!this.#logDir) return null;
    const path = join(this.#logDir, "report.json");
    await writeFile(path, `${JSON.stringify(full, null, 2)}\n`, "utf8");
    return path;
  }
}

/**
 * Show a path relative to where the command was run, when it is below it.
 *
 * A run report's location ends up in `bench/last-run.txt`, which is committed.
 * An absolute path there is one machine's, and it turns every rerun on a
 * different checkout into a spurious diff.
 */
export function displayPath(path: string, from: string = process.cwd()): string {
  const rel = relative(from, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** A run id that sorts chronologically and is safe on every filesystem. */
export function runId(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/gu, "-").replace(/Z$/u, "");
}
