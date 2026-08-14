/**
 * The catalogue — every escalation this compiler is capable of, in one list.
 *
 * A registry exists because the properties that matter about these hooks are
 * properties of the *set*, not of any one of them:
 *
 *   - every hook's templates exist on disk and render;
 *   - every verdict enum can abstain;
 *   - no two hooks share an id, which would silently share a cache namespace;
 *   - every hook is off until an operator names it.
 *
 * `catalogue.test.ts` asserts all four over this list.
 *
 * ## The list is short on purpose, and was not always
 *
 * It held twenty-one entries. Twelve had no consult site at all — defined,
 * prompted, tested, unreachable — and four of the rest damaged output that was
 * correct without them:
 *
 *   - `layout.chrome-audit` reviewed the removals `removeBoilerplate` was sure
 *     of and could cancel them. Not an abstention filled: a rule appealed. It
 *     put the site's standing masthead back onto pages the deterministic profile
 *     had correctly stripped it from.
 *   - `text.hyphenation` applied a `JOIN` with no check on the word it produced,
 *     and wrote `когда-то` back as `когдато`.
 *   - `image.caption` bound a picture to the wrong nearby line. It could not
 *     fabricate text — every candidate came verbatim from the page — and it was
 *     removed anyway, because a wrong caption reads as a fact and nothing
 *     downstream ever questions it.
 *   - `image.role`'s `DECORATION` verdict deleted an image outright. The
 *     verdict is gone; `ICON` remains, and can only ever swap one mark for
 *     another the project's own guide already licenses.
 *
 * ## The two tests a hook has to pass to be in this list
 *
 * 1. **{@link CatalogueEntry.abstention}** — name the state in which the
 *    deterministic path produced *no answer at all*. A hook that can only be
 *    described as improving an answer a rule already gave belongs in the rule.
 * 2. **{@link CatalogueEntry.acceptanceCheck}** — name what stops a wrong reply
 *    reaching the page, and prefer a hook whose worst case is *visible*. A glyph
 *    that looks odd or a heading that reads oddly gets noticed and fixed; a
 *    silently corrupted word or an authoritative wrong caption does not.
 *
 * `text.block-role` is the worked example of a hook that passes both, and the
 * reason this file is not empty. A page writes `БЛАГОДАРНОСТИ:` on its own line;
 * typography cannot distinguish that from a caption or a menu item, so the
 * outline rule declines and a real heading is flattened into prose. Rare,
 * genuinely undecidable from the available evidence, trivially decidable by
 * anything that can read, and wrong answers are visible in the output.
 */
import type { Hook } from "../hook.js";
import { tableClassifyHook, tableHeaderHook } from "./table.js";
import { blockRoleHook, textSegmentHook } from "./text.js";
import { imageRoleHook } from "./media.js";
import { documentReviewHook } from "./document.js";

/**
 * A hook with its generics erased.
 *
 * The catalogue is heterogeneous by construction — every hook has its own
 * context and item types, and that is the whole point of the abstraction. The
 * erasure is confined to this file; nothing that *calls* a hook goes through it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHook = Hook<any, any, any>;

export interface CatalogueEntry {
  hook: AnyHook;
  /** Template stem under `src/llm/prompts`, without `.system` / `.user`. */
  templates: string;
  /** The compiler stage this hook is consulted from. */
  stage: "text" | "headings" | "table" | "media" | "review";
  /**
   * The state in which the deterministic path produced **no answer at all**.
   *
   * Written as the blank it fills, never as the improvement it offers. If this
   * sentence cannot be written for a proposed hook without describing a rule's
   * answer as wrong, the hook is second-guessing a rule and does not belong
   * here.
   */
  abstention: string;
  /**
   * What a wrong answer costs, and what stops it reaching the page.
   *
   * Required, and required to be specific. The three hooks this catalogue lost
   * all had convincing abstentions and no answer to this question; writing it
   * down at the point of adding a hook is what makes the omission visible while
   * it is still cheap.
   */
  acceptanceCheck: string;
  /**
   * Whether the pipeline has a consult site for this hook.
   *
   * `false` means defined, prompted, tested — and never asked. One entry is in
   * that state and it predates this catalogue; twelve were, which is how the
   * flag came to be a field rather than a paragraph in a report. `llm-plan`
   * prints it, so the gap is visible where an operator would otherwise assume
   * coverage.
   */
  wired: boolean;
}

export const HOOK_CATALOGUE: readonly CatalogueEntry[] = [
  {
    hook: blockRoleHook,
    templates: "text/classify-block-role",
    stage: "headings",
    wired: true,
    abstention:
      "the prominence rule scored a standalone line above prose and below its section threshold, and declined to place it",
    acceptanceCheck:
      "only a SECTION_LABEL is applied, and only at a depth one step below the open heading; every other role is recorded and changes nothing, so the line stays the paragraph the rule made it",
  },
  {
    hook: tableClassifyHook,
    templates: "table/classify-region",
    stage: "table",
    wired: true,
    abstention: "both scored classifier tiers declined to name the region, so it has no class",
    acceptanceCheck:
      "a DATA verdict needs confidence ≥ 0.75 and a region wide enough to be a record matrix; otherwise the region stays a review item",
  },
  {
    hook: tableHeaderHook,
    templates: "table/synthesize-column-labels",
    stage: "table",
    wired: true,
    abstention: "no header row exists to promote and no column repeats a label of its own",
    acceptanceCheck:
      "one label per column, none a placeholder, all distinct — and it only ever fills a plan whose header the source never wrote, so a deterministic header is never overwritten",
  },
  {
    hook: imageRoleHook,
    templates: "media/classify-image-role",
    stage: "media",
    wired: true,
    abstention: "the known-icon table has never seen this asset, which is its documented no-match path",
    acceptanceCheck:
      "an ICON must name a glyph the project's own table already sanctions, so the only possible effect is swapping one licensed mark for another; nothing here can remove an image",
  },
  {
    hook: documentReviewHook,
    templates: "document/review-conversion",
    stage: "review",
    wired: true,
    abstention: "nothing — this one changes no output at all, and reports findings for a human to read",
    acceptanceCheck: "every finding must quote the produced document verbatim; the output is never modified",
  },
  {
    hook: textSegmentHook,
    templates: "text/classify-breaks",
    stage: "text",
    wired: false,
    abstention: "geometry resolved the easy breaks and left a run it could not read",
    acceptanceCheck: "one verdict per break, and any UNCERTAIN refuses the whole run back to the geometry reading",
  },
];

/** Look one up by id, for `biomd llm-plan` and for cache invalidation. */
export function hookById(id: string): CatalogueEntry | undefined {
  return HOOK_CATALOGUE.find((entry) => entry.hook.id === id);
}

/** Every hook id, in catalogue order. */
export function hookIds(): string[] {
  return HOOK_CATALOGUE.map((entry) => entry.hook.id);
}
