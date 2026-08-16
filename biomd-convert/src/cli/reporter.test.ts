/**
 * What a run says about itself, pinned.
 *
 * The properties worth asserting are the ones that fail silently: that the
 * structured log is written whatever the terminal was told to show, that a
 * failure is never suppressed by `--quiet`, and that stdout is left alone so
 * the scripts which parse a corpus run keep working.
 */
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunReporter, displayPath, formatDuration, runId } from "./reporter.js";

class Sink {
  chunks: string[] = [];
  isTTY = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join("");
  }
}

function reporter(level: "quiet" | "normal" | "verbose" | "debug", out = new Sink()) {
  return {
    out,
    reporter: new RunReporter({ level, out, heartbeatSeconds: 0, total: 2 }),
  };
}

describe("RunReporter", () => {
  it("keeps every record regardless of the display level", async () => {
    // The moment you need the detail is after the run that did not show it.
    const { reporter: r, out } = reporter("quiet");
    r.stage("measure");
    r.note("a corpus profile would help here");
    r.fileDone({ name: "a.htm", state: "conversion-complete", status: "ok", ms: 10 });
    expect(out.text).toBe("");
    expect(r.records.map((x) => x.kind)).toEqual(["stage", "note", "file.done"]);
  });

  it("never suppresses a failure", async () => {
    const { reporter: r, out } = reporter("quiet");
    r.fileDone({ name: "b.htm", state: "failed", status: "failed", ms: 3, detail: { error: "boom" } });
    expect(out.text).toContain("FAILED b.htm");
    expect(out.text).toContain("boom");
  });

  it("never suppresses a warning", async () => {
    const { reporter: r, out } = reporter("quiet");
    r.warn("no corpus profile: chrome will be kept");
    expect(out.text).toContain("warning: no corpus profile");
  });

  it("shows per-file lines only from verbose upward", () => {
    const normal = reporter("normal");
    normal.reporter.fileStart("a.htm");
    expect(normal.out.text).not.toContain("→ a.htm");

    const verbose = reporter("verbose");
    verbose.reporter.fileStart("a.htm");
    expect(verbose.out.text).toContain("→ a.htm");
  });

  it("prints an accepted or refused escalation at normal, and the gate only at verbose", () => {
    // The standing rule: an escalation is never silent. A gate verdict is not
    // an escalation — it is the machinery declining to make one.
    const normal = reporter("normal");
    normal.reporter.hookEvent({ type: "gate", call: false, reason: "single-cell", hook: "h", item: "i", at: 1 });
    normal.reporter.hookEvent({ type: "rejected", reason: "below threshold", hook: "h", item: "i", at: 2 });
    expect(normal.out.text).not.toContain("single-cell");
    expect(normal.out.text).toContain("below threshold");

    const verbose = reporter("verbose");
    verbose.reporter.hookEvent({ type: "gate", call: false, reason: "single-cell", hook: "h", item: "i", at: 1 });
    expect(verbose.out.text).toContain("single-cell");
  });

  it("counts what the model is doing, live", () => {
    const { reporter: r } = reporter("normal");
    r.hookEvent({ type: "call", model: "m", estimatedInputTokens: 500, attempt: 1, hook: "h", item: "i", at: 1 });
    expect(r.llm.pending).toBe(1);
    r.hookEvent({
      type: "reply",
      model: "m",
      ms: 20,
      usage: { inputTokens: 480, outputTokens: 40, cachedInputTokens: 0 },
      hook: "h",
      item: "i",
      at: 2,
    });
    expect(r.llm.pending).toBe(0);
    expect(r.llm.inputTokens).toBe(480);
    expect(r.progressLine()).toContain("llm 1 call");
  });

  it("appends nothing per file when the output is not a terminal", () => {
    // A redirected run can only append, so the live line must be a heartbeat
    // and nothing else — otherwise `corpus run > last-run.txt` grows two extra
    // lines per file in a file other tools parse.
    const { reporter: r, out } = reporter("normal");
    r.stage("measure", "a.htm");
    r.fileStart("a.htm");
    r.fileDone({ name: "a.htm", state: "conversion-complete", status: "ok", ms: 4 });
    expect(out.text).toBe("");
  });

  it("names the current stage and file in the progress line", () => {
    const { reporter: r } = reporter("normal");
    r.fileStart("segovia.htm");
    r.stage("measure", "segovia.htm");
    const line = r.progressLine();
    expect(line).toContain("measure segovia.htm");
    expect(line).toContain("0/2");
  });

  it("writes run.jsonl and report.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "biomd-run-"));
    const { reporter: r } = reporter("quiet");
    await r.open(dir, { engine: "test" });
    r.fileDone({ name: "a.htm", state: "conversion-complete", status: "ok", ms: 5, detail: { errors: 0 } });
    const path = await r.finish({ command: "corpus run", tally: { complete: 1 } });

    expect(path).toBe(join(dir, "report.json"));
    const report = JSON.parse(await readFile(path as string, "utf8")) as Record<string, unknown>;
    expect(report["command"]).toBe("corpus run");
    expect((report["files"] as unknown[]).length).toBe(1);

    const lines = (await readFile(join(dir, "run.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as LogLine);
    expect(lines[0]?.kind).toBe("run.start");
    expect(lines.some((l) => l.kind === "file.done")).toBe(true);
    expect(lines.at(-1)?.kind).toBe("run.finish");
  });

  it("keeps a run in memory when no log directory is given", async () => {
    const { reporter: r } = reporter("normal");
    await r.open(null, { engine: "test" });
    expect(await r.finish({})).toBeNull();
    expect(r.records.length).toBeGreaterThan(0);
  });
});

interface LogLine {
  kind: string;
}

describe("formatting", () => {
  it("reads durations at a glance", () => {
    expect(formatDuration(900)).toBe("1s");
    expect(formatDuration(65_000)).toBe("1m05s");
  });

  it("shows a path below the working directory as a relative one", () => {
    // The run report's location is printed into `bench/last-run.txt`, which is
    // committed. An absolute path there belongs to one machine and turns every
    // rerun on a different checkout into a spurious diff.
    expect(displayPath(join(process.cwd(), "bench", "runs", "x"), process.cwd())).toBe(
      join("bench", "runs", "x"),
    );
    expect(displayPath(join(process.cwd(), "..", "elsewhere"), process.cwd())).toContain("elsewhere");
  });

  it("makes run ids sort chronologically and survive every filesystem", () => {
    const id = runId(new Date("2026-08-16T12:34:56.789Z"));
    expect(id).toBe("2026-08-16T12-34-56-789");
    expect(id).not.toMatch(/[:.]/u);
  });
});
