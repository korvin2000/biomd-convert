/**
 * `text.label` — whether a standalone line names a section or says something.
 *
 * `analyze/TODO_Rules.md` §1 scores an unmarked standalone line out of five
 * terms and marks it `**bold**` above a threshold. Two of those terms are
 * evidence only a label has — a shout, and a word from the section vocabulary —
 * and the compiler applies them itself. The other four are satisfied by prose:
 * a trailing colon adds three points and a lone paragraph always stands clear
 * below, so `Примечания:` above a numbered list and
 * `В автобиографии Сеговия описал встречу со своим первым гитарным учителем:`
 * above a quotation clear the threshold identically.
 *
 * Length looked like it separated them and does not: `Формулируя цели Сеговия
 * писал:` is four words and a sentence, which `recovery.test.ts` asserted
 * before this hook existed. What separates them is whether the words name
 * something or predicate something, which is the one thing the source never
 * states.
 *
 * The item is one line, because one line is the whole question — unlike
 * `text.list`, where parallelism between lines is the evidence.
 *
 * The verdict is a *name*, and the compiler decides what to do with it:
 * `TEXT_LABEL.accept` in `convert-core/decisions.ts` refuses anything that is
 * not an asserted LABEL, and refuses a reply whose text is not the line it
 * claims to be about. The worst this hook can do is leave a sentence in bold,
 * which is visible on the page and invents no text.
 */
import { z } from "zod";
import { defineHook } from "../../kernel/contract.js";
import type { HookGateVerdict, HookInvocation } from "../../kernel/contract.js";
import type { TextLabelRequest } from "../../../convert-core/decisions.js";

export type TextLabelInput = HookInvocation<TextLabelRequest>;

const InputSchema = z.object({
  request: z.object({
    text: z.string(),
    score: z.number(),
    sourceName: z.string().optional(),
  }),
  context: z.object({ lang: z.string() }).loose(),
});

export const LineKindSchema = z.object({
  kind: z.enum(["LABEL", "SENTENCE", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(4000),
});
export type LineKindReply = z.infer<typeof LineKindSchema>;

/**
 * A line this short cannot be told apart by a reader either.
 *
 * A cost brake, not a discriminator: it never promotes anything, it only
 * declines to pay for a line with no words in it to judge. One character is not
 * a name and not a sentence.
 */
const MIN_CHARS = 3;

/**
 * Sentence-terminal punctuation *inside* the line settles it without a call.
 *
 * A line carrying a full stop, a question mark or an exclamation followed by
 * more words has already ended one sentence and begun another; nothing that
 * does that is a section label. `new_geyzel04`'s
 * `Вообще-то к этому моменту я знал уже достаточно много о В. Ф. Вавилове. А …`
 * is the corpus's instance.
 *
 * **Two letters before the mark, and that is the whole of the abbreviation
 * defence.** `В. Ф. Вавилов:` — a speaker's initials above their own words — is
 * one of the shapes this hook exists for, and a one-letter token before a dot
 * is an initial rather than the end of a sentence. Written the obvious way,
 * this gate closed on it.
 */
const CARRIES_A_SENTENCE_BOUNDARY = /\p{L}{2,}[.!?…]\s+\p{Lu}/u;

function gate(input: TextLabelInput): HookGateVerdict {
  const { text } = input.request;
  if (text.length < MIN_CHARS) {
    return { call: false, reason: `${text.length} character(s) — nothing to read` };
  }
  if (CARRIES_A_SENTENCE_BOUNDARY.test(text)) {
    return { call: false, reason: "the line ends a sentence and begins another" };
  }
  return { call: true, reason: `a standalone line scoring ${input.request.score} that no term settles` };
}

export const hook = defineHook<TextLabelInput, LineKindReply>({
  id: "text.label",
  title: "Unmarked standalone line",
  summary: "Tells a section label from a lead-in sentence where the source marked neither.",
  version: "1",
  stability: "experimental",
  decisionPoint: "text.label",
  enabledByDefault: false,
  moduleUrl: import.meta.url,
  input: InputSchema,
  output: LineKindSchema,
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
    const { text, score } = input.request;
    return {
      vars: {
        lang: input.context.lang,
        length: text.length,
        score,
        text,
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
