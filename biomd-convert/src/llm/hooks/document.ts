/**
 * The document hook — the reader this migration never had.
 *
 * Every other hook in the catalogue answers a question the compiler asked. This
 * one answers the question the compiler does not know how to ask: *is the
 * finished document right?*
 *
 * That is not a rhetorical flourish. The failures this project has actually
 * shipped were all invisible to its instruments at the moment they shipped —
 * six poems flattened into paragraph-shaped strings under a clean conservation
 * report; a section label swallowed into an image's caption property, which is
 * not a block, so nothing compared it; a construct the compiler could not emit,
 * which no instrument reports as missing. A reader notices all three in a
 * minute and no rung notices any of them. Reviewing a thousand pages by hand is
 * what makes that reader unaffordable, and it is exactly the cost this hook is
 * for.
 *
 * **It reports; it never edits.** Findings go to the provenance ledger as review
 * items with a severity and a quoted span. Nothing here can change a byte of the
 * output, which is what lets it run on documents the compiler was confident
 * about without endangering them.
 */
import { z } from "zod";
import type { Hook } from "../hook.js";
import { CONFIDENCE, systemPrompt, userPrompt } from "./shared.js";

const MODELS = ["claude-sonnet-5"] as const;

/** How many findings one document may produce, so a bad run cannot flood the queue. */
export const MAX_FINDINGS = 8;

export const DocumentFindingSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  /** Lower-case dotted class, e.g. `structure.flattened`. Free-form by design. */
  class: z.string().min(3).max(60),
  /** Verbatim span from the produced document, so the finding can be located. */
  quote: z.string().max(200),
  note: z.string().max(400),
});
export type DocumentFinding = z.infer<typeof DocumentFindingSchema>;

export const DocumentReviewSchema = z.object({
  findings: z.array(DocumentFindingSchema).max(MAX_FINDINGS),
  confidence: CONFIDENCE,
});
export type DocumentReviewReply = z.infer<typeof DocumentReviewSchema>;

export interface DocumentReviewContext {
  lang: string;
  sourceName: string;
  /** The compiler's own account of what it did, so the reviewer is not guessing. */
  summary: string;
  warnings?: string;
  maxFindings: number;
}

/**
 * `document.review` — advisory, and the only hook that reads the whole page.
 *
 * **Why it uses a strong model and nothing cheaper.** Every other hook is a
 * bounded classification with the evidence pre-selected; this one is open-ended
 * over two full documents, and a cheap model on an open-ended review returns
 * plausible-sounding style notes. The prompt spends most of its length on what
 * is *not* a finding for the same reason.
 *
 * **Why there is no deterministic default.** There is no rule that could produce
 * one. That is the point of the hook, and it is the honest form of the project's
 * own standard for adding one: a hook is added where evidence rules cannot
 * supply the judgement and its acceptance check can be named. The acceptance
 * check here is that a finding must quote the produced document verbatim —
 * enforced at the call site, where the document is in hand.
 */
export const documentReviewHook: Hook<DocumentReviewContext, { sourceText: string; output: string }, DocumentReviewReply> = {
  id: "document.review",
  version: "1",
  schema: DocumentReviewSchema,
  models: MODELS,
  maxOutputTokens: 2000,

  get system() {
    return systemPrompt("document/review-conversion", { maxFindings: MAX_FINDINGS });
  },

  buildPayload(ctx, item) {
    return {
      text: userPrompt("document/review-conversion", {
        lang: ctx.lang,
        sourceName: ctx.sourceName,
        summary: ctx.summary,
        warnings: ctx.warnings ?? "",
        sourceText: item.sourceText,
        output: item.output,
      }),
    };
  },

  /**
   * A finding that quotes nothing cannot be located, and one that quotes text
   * the document does not contain is about a document that does not exist.
   *
   * Only the first half is checkable here — the produced document is not in the
   * context — so the second is checked at the call site. Both refusals drop the
   * single finding rather than the whole reply: one hallucinated quote among
   * five real findings should cost one finding.
   */
  validate(out) {
    const issues: string[] = [];
    for (const finding of out.findings) {
      if (finding.quote.trim() === "") {
        issues.push(`finding ${JSON.stringify(finding.class)} quotes nothing and cannot be located`);
      }
    }
    return issues;
  },
};
