/**
 * `text.segment` — what a run of `<br>` breaks means.
 *
 * **This hook has no escalation site.** No decision point in `convert-core`
 * declares `text.segment`, so it can never fire during a conversion, and
 * `biomd hooks list` says so in its own column. It is migrated rather than
 * deleted for two reasons: it is the shape the reference author named as the
 * next judgement worth asking for — *"is this verse or lyrics; the line breaks
 * are the author's and must not be collapsed"* — and it is the worked example a
 * hook author reads before writing the third plugin.
 *
 * Wiring it means adding a decision point beside the deterministic break
 * handling, with an acceptance check that can refuse a wrong verdict. That is a
 * conversion change and belongs to a refinement iteration with its own
 * measurement, not to the framework that makes it possible.
 */
import { z } from "zod";
import { defineHook } from "../../kernel/contract.js";
import type { HookGateVerdict, HookInvocation } from "../../kernel/contract.js";

/**
 * The request shape a decision point would declare.
 *
 * It lives here because no decision point exists yet. When one is written, this
 * interface moves to `convert-core/decisions.ts` beside its acceptance check
 * and the plugin imports it, exactly as the two table hooks do.
 */
export interface TextSegmentRequest {
  /** Surrounding text, enough to tell verse from prose. */
  surrounding: string;
  /** The breaks to classify, in document order, each with its neighbourhood. */
  breaks: string[];
}

export type TextSegmentInput = HookInvocation<TextSegmentRequest>;

const InputSchema = z.object({
  request: z.object({ surrounding: z.string(), breaks: z.array(z.string()) }),
  context: z.object({ lang: z.string() }).loose(),
});

export const BreakKindSchema = z.object({
  kinds: z.array(z.enum(["WRAP", "PARAGRAPH", "LINEATION", "SPACING", "UNCERTAIN"])),
  confidence: z.number().min(0).max(1),
});
export type BreakKindReply = z.infer<typeof BreakKindSchema>;

/**
 * One break is not a pattern.
 *
 * Lineation is recognised from *recurrence* — several short end-stopped lines
 * in a row — so a single isolated break carries no evidence a model can use
 * that the surrounding geometry did not already carry. Asking per break would
 * also be the per-line call pattern this subsystem exists to avoid: the item is
 * the run, never the break.
 */
function gate(input: TextSegmentInput): HookGateVerdict {
  const { breaks, surrounding } = input.request;
  if (breaks.length < 2) {
    return { call: false, reason: "fewer than two breaks — no lineation pattern to read" };
  }
  if (surrounding.trim().length < 40) {
    return { call: false, reason: "too little surrounding text to tell verse from prose" };
  }
  return { call: true, reason: `${breaks.length} breaks in one run, geometry did not settle them` };
}

export const hook = defineHook<TextSegmentInput, BreakKindReply>({
  id: "text.segment",
  title: "Line-break meaning",
  summary: "Tells a wrapped prose line from verse lineation in a run of <br> breaks.",
  version: "2",
  stability: "candidate",
  decisionPoint: "text.segment",
  enabledByDefault: false,
  moduleUrl: import.meta.url,
  input: InputSchema,
  output: BreakKindSchema,
  templates: { system: "prompts/system.md", user: "prompts/user.md" },
  defaults: {
    tier: "fast",
    maxTier: "deep",
    escalateBelow: 0.6,
    acceptAbove: 0.6,
    maxOutputTokens: 512,
  },

  gate,

  render(input) {
    return {
      vars: {
        context: input.request.surrounding,
        breaks: input.request.breaks.map((b, i) => `${i + 1}. …${b}…`).join("\n"),
      },
    };
  },

  validate(out, input) {
    const wanted = input.request.breaks.length;
    return out.kinds.length === wanted ? [] : [`expected ${wanted} verdicts, received ${out.kinds.length}`];
  },
});
