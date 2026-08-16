/**
 * `text.list` — whether a run of hand-drawn lines is an enumeration.
 *
 * The converter recognises a list from four kinds of evidence: a bullet glyph,
 * ascending ordinals, a uniform indent under an announcing colon, and a native
 * `<blockquote>` around one flat run. A 1998 author who typed nineteen album
 * titles separated by `<br>` supplied none of them, and PROGRESS §15.2 measured
 * that no shape signal separates that run from a poem — line count, line length
 * and variance overlap totally across the references. What separates them is
 * what the lines *mean*, which is the one thing a rule here cannot read.
 *
 * The item is the **whole run**. Parallelism between the lines is the entire
 * evidence, so asking per line would destroy the question before asking it.
 *
 * The verdict is a *name*, and the compiler decides what to do with it:
 * `TEXT_LIST.accept` in `convert-core/decisions.ts` refuses anything that is
 * not an asserted LIST, and refuses a LIST over lines that hold whole
 * sentences. The worst this hook can do is leave an abstention unresolved.
 */
import { z } from "zod";
import { defineHook } from "../../kernel/contract.js";
import type { HookGateVerdict, HookInvocation } from "../../kernel/contract.js";
import type { TextListRequest } from "../../../convert-core/decisions.js";

export type TextListInput = HookInvocation<TextListRequest>;

const InputSchema = z.object({
  request: z.object({
    id: z.string(),
    lines: z.array(z.string()),
    lead: z.string().optional(),
    sourceName: z.string().optional(),
  }),
  context: z.object({ lang: z.string() }).loose(),
});

export const RunKindSchema = z.object({
  kind: z.enum(["LIST", "PROSE", "VERSE", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(4000),
});
export type RunKindReply = z.infer<typeof RunKindSchema>;

/** Three lines is the shortest run whose members can be parallel to each other. */
const MIN_LINES = 3;

/**
 * Above this many characters per line the run is prose, whatever it is about.
 *
 * A cost brake, not a discriminator: it never promotes anything, it only
 * declines to pay for runs whose answer the reader already knows. Swept over
 * the corpus's 53 candidate runs — the mean line of every run a reference
 * writes as a list is under 80 characters, and the runs above 160 are
 * `borislova`'s bilingual poem stanzas and `pavlov_azancheev`'s letter.
 */
const MAX_MEAN_LINE = 160;

/**
 * Above this many lines the run is a page, and a page is not one judgement.
 *
 * The largest run any reference writes as a list is 19 items. A run of 200
 * lines is a whole document lowered into one block, and one verdict over it
 * would be applied to material the model never really read.
 */
const MAX_LINES = 120;

function gate(input: TextListInput): HookGateVerdict {
  const { lines } = input.request;
  if (lines.length < MIN_LINES) {
    return { call: false, reason: `${lines.length} line(s) — a pair is not an enumeration` };
  }
  if (lines.length > MAX_LINES) {
    return { call: false, reason: `${lines.length} lines — too large to be one judgement` };
  }
  const mean = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  if (mean > MAX_MEAN_LINE) {
    return { call: false, reason: `mean line ${mean.toFixed(0)} chars — these are paragraphs, not entries` };
  }
  return { call: true, reason: `${lines.length} hand-drawn lines that no list rule claimed` };
}

export const hook = defineHook<TextListInput, RunKindReply>({
  id: "text.list",
  title: "Unmarked list block",
  summary: "Tells a run of enumerated titles from verse and prose where the source marked neither.",
  version: "1",
  stability: "experimental",
  decisionPoint: "text.list",
  enabledByDefault: true,
  moduleUrl: import.meta.url,
  input: InputSchema,
  output: RunKindSchema,
  templates: { system: "prompts/system.md", user: "prompts/user.md" },
  defaults: {
    tier: "fast",
    maxTier: "deep",
    escalateBelow: 0.6,
    acceptAbove: 0.75,
    maxOutputTokens: 512,
  },

  gate,

  render(input) {
    const { lines, lead } = input.request;
    const lengths = lines.map((l) => l.length);
    return {
      vars: {
        lang: input.context.lang,
        count: lines.length,
        shortest: Math.min(...lengths),
        longest: Math.max(...lengths),
        lead: lead ?? undefined,
        lines: lines.map((l, i) => `${i + 1}\t${l}`).join("\n"),
      },
    };
  },

  validate(out) {
    const issues: string[] = [];
    if (out.confidence > 0.99 && out.rationale.length < 20) {
      issues.push("near-certain verdict with no rationale; state the evidence");
    }
    return issues;
  },
});
