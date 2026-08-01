/**
 * Heading recovery from typography.
 *
 * A page of this era carries its document outline in font sizes, not in tags:
 * the title is `<div style="FONT: bold 20pt Arial">`, a section label is a
 * centred `<b>` one step above body size, and `<h1>` appears nowhere. Emitting
 * such a document without recovering the outline produces a `.bio.md` with no
 * `#` at all — which the validator rejects (§18) and which no reader can
 * navigate.
 *
 * The decision is a *relative* one, made per document: what counts as prominent
 * depends on what the rest of that page looks like. An absolute pt threshold
 * would work on one template and fail on the next.
 *
 * The result is written back onto the tree as `data-biomd-heading`, so structure
 * recovery stays a straight lowering pass and this heuristic stays testable on
 * its own.
 */
import { BLOCK_TAGS, type LadomNode, textOf, walkElements } from "../ladom/types.js";
import { type Prominence, prominenceOf } from "./prominence.js";

export interface HeadingDecision {
  id: string;
  depth: 1 | 2 | 3;
  text: string;
  score: number;
  reason: string;
}

export interface HeadingOptions {
  /** Longest text that can still be a heading. */
  maxTitleLength?: number;
  maxSectionLength?: number;
  /** Minimum score, relative to the document's body baseline. */
  titleThreshold?: number;
  sectionThreshold?: number;
  /** Recover section headings as well as the title. */
  sections?: boolean;
}

const DEFAULTS: Required<HeadingOptions> = {
  maxTitleLength: 120,
  maxSectionLength: 70,
  titleThreshold: 1.25,
  sectionThreshold: 1.12,
  sections: true,
};

/**
 * Containers a heading may be lifted through.
 *
 * The marked node has to be one structure recovery treats as a block, or the
 * heading is swept into an inline run and never emitted. Climbing stops at a
 * cell or list-item boundary: a `<td>` whose only text is the title still holds
 * *other* cells' images, and lifting that far would drag them into the heading.
 */
const LIFT_THROUGH = new Set(["p", "div", "center", "span", "font", "b", "strong", "i", "em", "u", "nobr"]);
const LIFT_STOP = new Set(["td", "th", "tr", "table", "tbody", "thead", "tfoot", "li", "body", "html", "#root"]);

/** Blocks that can carry a heading; a `<td>` is included because 1998. */
const CANDIDATE_TAGS = new Set(["p", "div", "td", "th", "center", "span", "font", "caption", "li"]);

interface Candidate {
  node: LadomNode;
  prominence: Prominence;
  /** Document order. */
  order: number;
}

/**
 * Find and mark the document outline.
 *
 * Runs after normalization, so `<font>` sizes have already been folded onto the
 * nodes that carried them and wrapper tables no longer stand between a label and
 * its section.
 */
export function recoverHeadings(root: LadomNode, options: HeadingOptions = {}): HeadingDecision[] {
  const opts = { ...DEFAULTS, ...options };
  const decisions: HeadingDecision[] = [];

  const candidates: Candidate[] = [];
  let order = 0;
  for (const el of walkElements(root)) {
    order += 1;
    if (!CANDIDATE_TAGS.has(el.tag)) continue;
    if (el.attrs["data-biomd-heading"] !== undefined) continue;
    const text = textOf(el);
    if (text === "" || text.length > opts.maxTitleLength) continue;
    // Only the innermost element that holds exactly this text: a `<td>` wrapping
    // a `<p>` wrapping a `<span>` would otherwise nominate the same words three
    // times, and the outermost would win on nothing but nesting.
    if (!isTightWrapper(el, text)) continue;
    if (el.metrics.links > 0 && el.metrics.textLen === linkTextLength(el)) continue; // a link, not a label
    candidates.push({ node: el, prominence: prominenceOf(el), order });
  }

  if (candidates.length === 0) return decisions;

  const baseline = bodyBaseline(root);
  const scored = candidates
    .map((c) => ({ ...c, relative: c.prominence.score / baseline }))
    .sort((a, b) => b.relative - a.relative || a.order - b.order);

  const title = scored[0];
  if (!title || title.relative < opts.titleThreshold) return decisions;

  const titleHost = blockHost(title.node);
  mark(titleHost, 1);
  decisions.push({
    id: titleHost.id,
    depth: 1,
    text: title.prominence.text,
    score: title.relative,
    reason:
      `most prominent short block on the page ` +
      `(${title.prominence.fontPx ? `${title.prominence.fontPx.toFixed(0)}px` : "no declared size"}` +
      `${title.prominence.bold ? ", bold" : ""}${title.prominence.centered ? ", centred" : ""})`,
  });

  if (!opts.sections) return decisions;

  // A section label must be clearly above the body baseline but clearly below
  // the title; otherwise the page has one heading level, which is a legitimate
  // shape and not something to invent structure over.
  for (const candidate of scored.slice(1)) {
    if (candidate.relative < opts.sectionThreshold) break;
    if (candidate.relative >= title.relative * 0.98) continue;
    if (candidate.prominence.text.length > opts.maxSectionLength) continue;
    if (!isLabelLike(candidate.prominence.text)) continue;
    if (isInsideHeading(candidate.node)) continue;
    if (!hasFollowingContent(candidate.node)) continue;
    const host = blockHost(candidate.node);
    if (host.attrs["data-biomd-heading"] !== undefined) continue;
    mark(host, 2);
    decisions.push({
      id: host.id,
      depth: 2,
      text: candidate.prominence.text,
      score: candidate.relative,
      reason: "prominent short block above the body baseline, followed by content",
    });
  }

  return decisions;
}

/**
 * A label names a thing; a sentence says something about it.
 *
 * Legacy pages emphasize whole opening sentences all the time — an obituary
 * lede, a dated announcement — and promoting those to `##` invents an outline
 * that misrepresents the page.
 */
function isLabelLike(text: string): boolean {
  if (/[.!?]\s/u.test(text)) return false;
  if (/[,;:]$/u.test(text)) return false;
  // More than about ten words is prose whatever its punctuation.
  return text.split(/\s+/u).filter(Boolean).length <= 10;
}

/**
 * Lift a heading to the outermost block element carrying exactly its text.
 *
 * The prominent node is frequently a `<span>` or `<font>`, which structure
 * recovery treats as inline; marking it would put the title inside a paragraph.
 */
function blockHost(node: LadomNode): LadomNode {
  const text = textOf(node);
  let best = node;
  let cur = node.parent;
  while (cur && !LIFT_STOP.has(cur.tag)) {
    if (!LIFT_THROUGH.has(cur.tag)) break;
    if (textOf(cur) !== text) break;
    if (BLOCK_TAGS.has(cur.tag)) best = cur;
    cur = cur.parent;
  }
  return best;
}

function mark(node: LadomNode, depth: 1 | 2 | 3): void {
  node.attrs["data-biomd-heading"] = String(depth);
}

function isInsideHeading(node: LadomNode): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.attrs["data-biomd-heading"] !== undefined) return true;
    cur = cur.parent;
  }
  return false;
}

/** True when `node` is the innermost element carrying exactly this text. */
function isTightWrapper(node: LadomNode, text: string): boolean {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (textOf(child).length >= text.length) return false;
  }
  return true;
}

function linkTextLength(node: LadomNode): number {
  let n = 0;
  for (const el of walkElements(node)) if (el.tag === "a") n += textOf(el).length;
  return n;
}

/**
 * The prominence of ordinary body text on this page.
 *
 * Taken from the longest text-bearing blocks, which are prose by definition.
 * Using a constant here would misjudge any page whose body is not 16px.
 */
function bodyBaseline(root: LadomNode): number {
  const prose: number[] = [];
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td") continue;
    const text = textOf(el);
    if (text.length < 200) continue;
    if (!isTightWrapper(el, text)) continue;
    prose.push(prominenceOf(el).score);
  }
  if (prose.length === 0) return 1;
  prose.sort((a, b) => a - b);
  return prose[Math.floor(prose.length / 2)] ?? 1;
}

/** A label with nothing after it is a caption or a footer, not a section heading. */
function hasFollowingContent(node: LadomNode): boolean {
  let cur: LadomNode | null = node;
  while (cur && cur.parent) {
    const siblings = cur.parent.children;
    const at = siblings.indexOf(cur);
    for (let i = at + 1; i < siblings.length; i += 1) {
      const sibling = siblings[i] as LadomNode;
      if (sibling.metrics.textLen > 40 || sibling.metrics.images > 0) return true;
    }
    cur = cur.parent;
  }
  return false;
}
