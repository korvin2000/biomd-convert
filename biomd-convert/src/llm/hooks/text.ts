/**
 * Text hooks — what a run of line breaks means, and nothing else.
 *
 * ## What used to be here, and why it is gone
 *
 * This module once held six more: hyphenation, block role, lineation, list
 * intent, quote intent and emphasis role. They are deleted rather than disabled,
 * because each of them was a model second-guessing a rule that had already
 * decided, and that is a design error no configuration flag repairs.
 *
 * `text.hyphenation` is the one worth remembering. Its argument read well — the
 * cascade's residual is the set of words a dictionary does not hold, so ask a
 * model about morphology — and it shipped `когда-то` written back as `когдато`.
 * The flaw was that its acceptance check was positional only: it verified the
 * text had not moved since the cascade ran, and verified nothing whatever about
 * the word it was about to produce. A `JOIN` was applied because it was
 * returned. Under this project's own rule — *hook proposes, deterministic check
 * accepts or rejects* — a hook whose acceptance check cannot be written is a
 * hook that must not exist, and this one's could not be: deciding whether
 * `когда-то` keeps its hyphen **is** the deterministic question, so a check
 * strong enough to catch the bad answer would have answered it without asking.
 *
 * The rule that survives: an escalation may only fill a gap where the
 * deterministic path produced *no answer at all*. Where it produced a wrong
 * answer, the fix is the rule.
 */
import { z } from "zod";
import type { Hook } from "../hook.js";
import { CONFIDENCE, RATIONALE, expectLength, systemPrompt, userPrompt } from "./shared.js";

const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"] as const;

// ---------------------------------------------------------------------------
// text.segment — what a run of line breaks means
// ---------------------------------------------------------------------------

/**
 * `UNCERTAIN` is a member here for the same reason it is everywhere else, and it
 * was missing until the catalogue contract asked for it.
 *
 * This hook predates the rest of the catalogue and inherited a closed enum with
 * no way out, which meant a run of breaks the model could not read came back as
 * four confident guesses. The caller now refuses the *whole run* when any one
 * break is uncertain: the kinds are positional, so there is no way to drop one
 * and keep the rest, and a run the model half-read is a run the geometry rule's
 * reading should keep.
 */
export const BreakKindSchema = z.object({
  kinds: z.array(z.enum(["WRAP", "PARAGRAPH", "LINEATION", "SPACING", "UNCERTAIN"])),
  confidence: CONFIDENCE,
  rationale: RATIONALE,
});
export type BreakKindReply = z.infer<typeof BreakKindSchema>;

export interface BreakContext {
  lang: string;
  context: string;
  count: number;
}

/**
 * `text.segment` — classify a run of line breaks.
 *
 * Deliberately has no deterministic default here: the caller resolves the easy
 * cases from geometry before it ever constructs an item, so anything reaching
 * this hook is already the residual.
 */
export const textSegmentHook: Hook<BreakContext, { breaks: readonly string[] }, BreakKindReply> = {
  id: "text.segment",
  version: "2",
  schema: BreakKindSchema,
  models: MODELS,
  escalateBelow: 0.6,
  maxOutputTokens: 512,

  get system() {
    return systemPrompt("text/classify-breaks");
  },

  buildPayload(ctx, item) {
    return {
      text: userPrompt("text/classify-breaks", {
        lang: ctx.lang,
        context: ctx.context,
        breaks: item.breaks.map((b, i) => `  ${i + 1}. …${b}…`).join("\n"),
      }),
    };
  },

  validate(out, _ctx, item) {
    return expectLength(out.kinds.length, item.breaks.length, "verdicts");
  },
};

// ---------------------------------------------------------------------------
// text.block-role — what a line the outline rule could not place actually is
// ---------------------------------------------------------------------------

/**
 * The one escalation in this module that survived, and the one that earned it.
 *
 * A page writes `БЛАГОДАРНОСТИ:` on its own line, set a little apart from the
 * prose. It is a section heading; the compiler emits it as a paragraph, because
 * at that prominence a section label, a caption, a menu item, a signature and a
 * date are the same measurement. The rule cannot decide and is right not to
 * guess — and a reader decides instantly.
 *
 * Only `SECTION_LABEL` does anything. Every other verdict — including
 * `UNCERTAIN` — is recorded as a review item and applied to nothing, so the line
 * stays the paragraph the rule made it. That asymmetry is deliberate: the
 * deterministic answer here is "not a heading", the escalation exists to
 * overturn it in the one direction, and in every other direction the two agree
 * and there is nothing to do.
 */
export const BlockRoleSchema = z.object({
  role: z.enum(["SECTION_LABEL", "CAPTION", "SIGNATURE", "DATE", "COPYRIGHT", "MENU_ITEM", "PROSE", "UNCERTAIN"]),
  /** Required for `SECTION_LABEL`, meaningless otherwise; `null` when not one. */
  depth: z.union([z.literal(2), z.literal(3), z.null()]),
  confidence: CONFIDENCE,
  rationale: RATIONALE,
});
export type BlockRoleReply = z.infer<typeof BlockRoleSchema>;

export interface BlockRoleContext {
  lang: string;
  typography: string;
  openHeading?: string;
  openDepth?: number;
}

export const blockRoleHook: Hook<
  BlockRoleContext,
  { line: string; before: string; after: string; siblings: string },
  BlockRoleReply
> = {
  id: "text.block-role",
  version: "1",
  schema: BlockRoleSchema,
  models: MODELS,
  escalateBelow: 0.6,
  maxOutputTokens: 400,

  get system() {
    return systemPrompt("text/classify-block-role");
  },

  buildPayload(ctx, item) {
    return {
      text: userPrompt("text/classify-block-role", {
        lang: ctx.lang,
        typography: ctx.typography,
        line: item.line,
        before: item.before,
        after: item.after,
        siblings: item.siblings,
        ...(ctx.openHeading !== undefined ? { openHeading: ctx.openHeading } : {}),
        ...(ctx.openDepth !== undefined ? { openDepth: ctx.openDepth } : {}),
      }),
    };
  },

  validate(out) {
    // A depth on a non-label is a reply that has not understood the question,
    // and a label without one cannot be placed in the outline. Both are refused
    // here rather than silently repaired, because repairing a confused reply is
    // how a caption acquires a heading level.
    if (out.role === "SECTION_LABEL" && out.depth === null) {
      return ["a SECTION_LABEL must state a depth of 2 or 3"];
    }
    if (out.role !== "SECTION_LABEL" && out.depth !== null) {
      return [`depth is meaningless for ${out.role}; it must be null`];
    }
    return [];
  },
};
