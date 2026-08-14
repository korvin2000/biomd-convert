/**
 * Media hooks — one, for the marks that are not pictures.
 *
 * `image.role` is a **choice from a closed set**, never a composition: the glyph
 * vocabulary is derived from the project's own known-icon table, so this hook
 * cannot put a mark on the page that `mini_images_to_md_guide.md` does not
 * already license. It fires on that table's documented no-match path — a control
 * drawn with an asset nobody has catalogued — and its worst case is that a 16×16
 * arrow becomes `▶` instead of a broken image link.
 *
 * ## `image.caption` was here, and it is gone
 *
 * It chose a picture's caption from lines lifted verbatim out of the page, so it
 * could not fabricate text, and it only ran where the caption rule had found
 * nothing. It still went: **binding the wrong line to a picture is a content
 * error that reads as a fact**, and the honest output when no caption rule
 * matched is a picture with no caption. A blank that stays blank is correctable;
 * a confident wrong caption is not, because nothing downstream will ever
 * question it.
 *
 * The rule that decided it: an escalation may fill a blank the compiler would
 * otherwise leave, but only where being wrong is *visible* — a glyph that looks
 * odd, a heading that reads oddly. Where being wrong is invisible and assertive,
 * the blank stays.
 */
import { z } from "zod";
import type { Hook } from "../hook.js";
import { iconGlyphVocabulary } from "../../convert-core/glyphs.js";
import { CONFIDENCE, RATIONALE, quote, systemPrompt, userPrompt } from "./shared.js";

const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"] as const;

/** The closed answer space, rendered once for the prompt. */
function glyphVocabulary(): string {
  return iconGlyphVocabulary()
    .map((entry) => `- \`${entry.glyph}\` — ${entry.meaning}`)
    .join("\n");
}

/** Whether a proposed glyph is one the project already sanctions. */
export function isSanctionedGlyph(glyph: string): boolean {
  return iconGlyphVocabulary().some((entry) => entry.glyph === glyph);
}

// ---------------------------------------------------------------------------
// image.role — the documented no-match path of the icon table
// ---------------------------------------------------------------------------

/**
 * `DECORATION` is gone from this enum, and that is an acceptance check, not a
 * tidy-up.
 *
 * It meant "this image carries nothing; drop it", and a wrong `DECORATION`
 * deletes something from the document with no trace in the output. The verdict
 * that remains, `ICON`, only ever *replaces* a mark with another mark. An
 * escalation that can subtract content is a different kind of thing from one
 * that can only substitute, and only the second kind belongs in this compiler.
 */
export const ImageRoleSchema = z.object({
  role: z.enum(["PICTURE", "ICON", "UNCERTAIN"]),
  glyph: z.string().max(8).nullable(),
  confidence: CONFIDENCE,
  rationale: RATIONALE,
});
export type ImageRoleReply = z.infer<typeof ImageRoleSchema>;

export interface ImageRoleContext {
  lang: string;
  size: string;
  alt?: string;
  inLink: boolean;
  linkTarget?: string;
  /** How many times this same asset appears on this page. */
  occurrences: number;
  /** Characters of prose before it in its own block, when it sits inside a sentence. */
  inRunningProse?: number;
}

/**
 * `image.role` — invariant 5's graceful degradation, given somewhere to go.
 *
 * The known-icon table is lexical data and returns null for an asset it has
 * never seen, which is exactly the behaviour the no-literals rule requires. On
 * the reference corpus that null is nearly always right, because the table holds
 * the assets this site draws its controls with. Across the other ~987 pages, and
 * across a structurally similar site, it is the single most likely place for the
 * rule to be silently wrong — a control shipped as a broken picture.
 *
 * This hook is that path. It cannot widen the table: a glyph it proposes must be
 * one the table already sanctions, checked here and again at the call site, and
 * `NONE` keeps the picture.
 */
export const imageRoleHook: Hook<ImageRoleContext, { surroundings: string }, ImageRoleReply> = {
  id: "image.role",
  version: "1",
  schema: ImageRoleSchema,
  models: MODELS,
  escalateBelow: 0.65,
  maxOutputTokens: 400,

  get system() {
    return systemPrompt("media/classify-image-role", { glyphVocabulary: glyphVocabulary() });
  },

  buildPayload(ctx, item) {
    return {
      text: userPrompt("media/classify-image-role", {
        lang: ctx.lang,
        size: ctx.size,
        alt: ctx.alt ? quote(ctx.alt) : "",
        inLink: ctx.inLink,
        linkTarget: ctx.linkTarget ? quote(ctx.linkTarget, 120) : "",
        occurrences: ctx.occurrences,
        inRunningProse: ctx.inRunningProse !== undefined ? String(ctx.inRunningProse) : "",
        surroundings: item.surroundings,
      }),
    };
  },

  /**
   * The answer space is closed, and this is where it is closed.
   *
   * A glyph outside the sanctioned vocabulary is refused rather than trimmed:
   * substituting a nearby character would be the compiler quietly widening a
   * table that is supposed to be the whole of its lexical knowledge.
   */
  validate(out) {
    const issues: string[] = [];
    if (out.role === "ICON" && out.glyph !== null && out.glyph !== "" && !isSanctionedGlyph(out.glyph)) {
      issues.push(`${JSON.stringify(out.glyph)} is not in the sanctioned glyph vocabulary`);
    }
    if (out.role !== "ICON" && out.glyph !== null && out.glyph !== "") {
      issues.push("a glyph was given for an image that is not an icon");
    }
    return issues;
  },
};
