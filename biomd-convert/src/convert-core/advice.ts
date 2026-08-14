/**
 * Advice — what an escalation resolved, written back onto the tree.
 *
 * ## Why this file exists
 *
 * The compiler's stages are synchronous and the escalation boundary is not. A
 * rule deep inside structure recovery cannot `await` an answer, and threading a
 * promise through six hundred call sites to let it would turn every rule into a
 * coroutine for the sake of the handful of cases that ever ask.
 *
 * So the pipeline asks *before* the synchronous stages run, and writes the
 * answers onto the nodes they are about, as `data-biomd-*` attributes. This is
 * not a new idea in this codebase: `recoverHeadings` has always marked its
 * verdicts as `data-biomd-heading` for exactly this reason, and structure
 * recovery has always read them. This file gives that channel a vocabulary, a
 * type and one place to change.
 *
 * ## The subordination rule, which is the whole point
 *
 * **Advice never overrules a rule that decided.** Every read site here is
 * placed *after* its own deterministic test has already abstained, and every
 * write goes through an acceptance check that can refuse it. The order at every
 * decision point is, without exception:
 *
 *   1. the deterministic rule runs and either decides or abstains;
 *   2. only on abstention is advice consulted;
 *   3. the advice is checked against the same evidence the rule had, and a
 *      check that fails leaves the deterministic default standing.
 *
 * A hook is therefore incapable of changing an answer the compiler was sure of.
 * It can only fill in one the compiler was going to leave as a review item —
 * which is the difference between an assistant and a second, unaccountable
 * author. `advice.test.ts` asserts this against a resolver that answers every
 * question with the most disruptive verdict available to it.
 *
 * ## Why attributes rather than a side table
 *
 * Because the tree is what survives the stages. Normalization rewrites nodes,
 * lifts them and merges them; a `Map` keyed on node id goes stale the moment a
 * node is replaced, and silently — a lookup miss is indistinguishable from "no
 * advice". An attribute travels with the node it describes, and when the node
 * is discarded the advice goes with it, which is correct.
 */
import type { LadomNode } from "../ladom/types.js";

/** The one place an attribute name is spelled. */
export const ADVICE_ATTRS = {
  blockRole: "data-biomd-advice-role",
  headingDepth: "data-biomd-heading",
  caption: "data-biomd-advice-caption",
  imageRole: "data-biomd-advice-image",
  imageGlyph: "data-biomd-advice-glyph",
  linkLabel: "data-biomd-advice-link-label",
  breakKinds: "data-biomd-advice-breaks",
  lineation: "data-biomd-advice-lineation",
  quoteIntent: "data-biomd-advice-quote",
  listIntent: "data-biomd-advice-list",
  emphasisRole: "data-biomd-advice-emphasis",
  alignIntent: "data-biomd-advice-align",
  separatorIntent: "data-biomd-advice-separator",
  regionRole: "data-biomd-advice-region",
  /** Provenance: which hook wrote the advice on this node, for the ledger. */
  source: "data-biomd-advice-source",
} as const;

export type BlockRole =
  | "SECTION_LABEL"
  | "CAPTION"
  | "SIGNATURE"
  | "DATE"
  | "COPYRIGHT"
  | "MENU_ITEM"
  | "PROSE";
export type ImageRole = "PICTURE" | "ICON" | "DECORATION";
export type BreakKind = "WRAP" | "PARAGRAPH" | "LINEATION" | "SPACING";
export type QuoteIntent = "QUOTATION" | "EMPHASIS" | "PLAIN";
export type ListIntent = "UNORDERED" | "ORDERED" | "NOT_A_LIST";
export type EmphasisRole = "STRUCTURAL_LABEL" | "TITLE_OF_WORK" | "EMPHASIS";
export type AlignIntent = "AUTHORED" | "PRESENTATIONAL";
export type SeparatorIntent = "DIVIDER" | "PADDING";
export type RegionRole = "MAIN" | "SIDEBAR" | "NAV" | "CHROME" | "MEDIA" | "CAPTION";

/**
 * Everything an escalation can say about one node.
 *
 * Every field is optional and every field is a *verdict a rule already declined
 * to reach*. There is no field here that a deterministic path would have filled
 * in on its own.
 */
export interface NodeAdvice {
  blockRole?: BlockRole;
  headingDepth?: 1 | 2 | 3;
  caption?: string;
  imageRole?: ImageRole;
  imageGlyph?: string;
  linkLabel?: string;
  breakKinds?: readonly BreakKind[];
  lineation?: boolean;
  quoteIntent?: QuoteIntent;
  listIntent?: ListIntent;
  emphasisRole?: EmphasisRole;
  alignIntent?: AlignIntent;
  separatorIntent?: SeparatorIntent;
  regionRole?: RegionRole;
}

const BLOCK_ROLES = new Set<string>([
  "SECTION_LABEL",
  "CAPTION",
  "SIGNATURE",
  "DATE",
  "COPYRIGHT",
  "MENU_ITEM",
  "PROSE",
]);
const IMAGE_ROLES = new Set<string>(["PICTURE", "ICON", "DECORATION"]);
const BREAK_KINDS = new Set<string>(["WRAP", "PARAGRAPH", "LINEATION", "SPACING"]);
const QUOTE_INTENTS = new Set<string>(["QUOTATION", "EMPHASIS", "PLAIN"]);
const LIST_INTENTS = new Set<string>(["UNORDERED", "ORDERED", "NOT_A_LIST"]);
const EMPHASIS_ROLES = new Set<string>(["STRUCTURAL_LABEL", "TITLE_OF_WORK", "EMPHASIS"]);
const ALIGN_INTENTS = new Set<string>(["AUTHORED", "PRESENTATIONAL"]);
const SEPARATOR_INTENTS = new Set<string>(["DIVIDER", "PADDING"]);
const REGION_ROLES = new Set<string>(["MAIN", "SIDEBAR", "NAV", "CHROME", "MEDIA", "CAPTION"]);

/**
 * Write advice onto a node.
 *
 * Callers hand over only what an escalation actually resolved; an `undefined`
 * field writes no attribute, so "no advice" and "advice that says nothing" stay
 * the same state. A field whose value is not in this file's vocabulary is
 * dropped rather than written: the schemas at the boundary already reject those,
 * and a second refusal here costs nothing and closes the path by which a future
 * caller could put arbitrary text on the tree.
 */
export function writeAdvice(node: LadomNode, advice: NodeAdvice, source: string): void {
  let wrote = false;
  const put = (attr: string, value: string): void => {
    node.attrs[attr] = value;
    wrote = true;
  };

  if (advice.blockRole && BLOCK_ROLES.has(advice.blockRole)) put(ADVICE_ATTRS.blockRole, advice.blockRole);
  if (advice.headingDepth === 1 || advice.headingDepth === 2 || advice.headingDepth === 3) {
    put(ADVICE_ATTRS.headingDepth, String(advice.headingDepth));
  }
  if (advice.caption !== undefined && advice.caption.trim() !== "") put(ADVICE_ATTRS.caption, advice.caption);
  if (advice.imageRole && IMAGE_ROLES.has(advice.imageRole)) put(ADVICE_ATTRS.imageRole, advice.imageRole);
  if (advice.imageGlyph !== undefined && advice.imageGlyph !== "") put(ADVICE_ATTRS.imageGlyph, advice.imageGlyph);
  if (advice.linkLabel !== undefined && advice.linkLabel.trim() !== "") put(ADVICE_ATTRS.linkLabel, advice.linkLabel);
  if (advice.breakKinds && advice.breakKinds.every((k) => BREAK_KINDS.has(k))) {
    put(ADVICE_ATTRS.breakKinds, advice.breakKinds.join(","));
  }
  if (advice.lineation !== undefined) put(ADVICE_ATTRS.lineation, advice.lineation ? "1" : "0");
  if (advice.quoteIntent && QUOTE_INTENTS.has(advice.quoteIntent)) put(ADVICE_ATTRS.quoteIntent, advice.quoteIntent);
  if (advice.listIntent && LIST_INTENTS.has(advice.listIntent)) put(ADVICE_ATTRS.listIntent, advice.listIntent);
  if (advice.emphasisRole && EMPHASIS_ROLES.has(advice.emphasisRole)) {
    put(ADVICE_ATTRS.emphasisRole, advice.emphasisRole);
  }
  if (advice.alignIntent && ALIGN_INTENTS.has(advice.alignIntent)) put(ADVICE_ATTRS.alignIntent, advice.alignIntent);
  if (advice.separatorIntent && SEPARATOR_INTENTS.has(advice.separatorIntent)) {
    put(ADVICE_ATTRS.separatorIntent, advice.separatorIntent);
  }
  if (advice.regionRole && REGION_ROLES.has(advice.regionRole)) put(ADVICE_ATTRS.regionRole, advice.regionRole);

  if (wrote) node.attrs[ADVICE_ATTRS.source] = source;
}

/** Read back everything advised about a node. Absent fields mean nobody was asked. */
export function adviceOf(node: LadomNode | null | undefined): NodeAdvice {
  if (!node) return {};
  const attrs = node.attrs;
  const out: NodeAdvice = {};

  const role = attrs[ADVICE_ATTRS.blockRole];
  if (role && BLOCK_ROLES.has(role)) out.blockRole = role as BlockRole;

  const depth = attrs[ADVICE_ATTRS.headingDepth];
  if (depth === "1" || depth === "2" || depth === "3") out.headingDepth = Number(depth) as 1 | 2 | 3;

  const caption = attrs[ADVICE_ATTRS.caption];
  if (caption !== undefined && caption.trim() !== "") out.caption = caption;

  const image = attrs[ADVICE_ATTRS.imageRole];
  if (image && IMAGE_ROLES.has(image)) out.imageRole = image as ImageRole;

  const glyph = attrs[ADVICE_ATTRS.imageGlyph];
  if (glyph !== undefined && glyph !== "") out.imageGlyph = glyph;

  const label = attrs[ADVICE_ATTRS.linkLabel];
  if (label !== undefined && label.trim() !== "") out.linkLabel = label;

  const breaks = attrs[ADVICE_ATTRS.breakKinds];
  if (breaks) {
    const kinds = breaks.split(",").filter((k) => BREAK_KINDS.has(k)) as BreakKind[];
    if (kinds.length > 0) out.breakKinds = kinds;
  }

  const lineation = attrs[ADVICE_ATTRS.lineation];
  if (lineation === "1" || lineation === "0") out.lineation = lineation === "1";

  const quote = attrs[ADVICE_ATTRS.quoteIntent];
  if (quote && QUOTE_INTENTS.has(quote)) out.quoteIntent = quote as QuoteIntent;

  const list = attrs[ADVICE_ATTRS.listIntent];
  if (list && LIST_INTENTS.has(list)) out.listIntent = list as ListIntent;

  const emphasis = attrs[ADVICE_ATTRS.emphasisRole];
  if (emphasis && EMPHASIS_ROLES.has(emphasis)) out.emphasisRole = emphasis as EmphasisRole;

  const align = attrs[ADVICE_ATTRS.alignIntent];
  if (align && ALIGN_INTENTS.has(align)) out.alignIntent = align as AlignIntent;

  const separator = attrs[ADVICE_ATTRS.separatorIntent];
  if (separator && SEPARATOR_INTENTS.has(separator)) out.separatorIntent = separator as SeparatorIntent;

  const region = attrs[ADVICE_ATTRS.regionRole];
  if (region && REGION_ROLES.has(region)) out.regionRole = region as RegionRole;

  return out;
}

/** Whether any escalation said anything about this node. Cheap guard for a hot path. */
export function hasAdvice(node: LadomNode | null | undefined): boolean {
  return node !== null && node !== undefined && node.attrs[ADVICE_ATTRS.source] !== undefined;
}
