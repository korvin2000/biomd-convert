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

  // A masthead is often two lines in one styled box: the name, then what the
  // page is about — `Френсис Гойя` over `(дискография)`. Marking the box makes
  // one heading out of both, which is neither the title nor a subtitle and
  // matches no outline. §2.1 keeps the second line as an italic paragraph
  // under the title, and §2 still allows exactly one `#`.
  const titleHost = blockHost(splitMasthead(title.node) ?? title.node);
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
  const accepted = scored
    .slice(1)
    .filter(
      (c) =>
        c.relative >= opts.sectionThreshold &&
        c.relative < title.relative * 0.98 &&
        c.prominence.text.length <= opts.maxSectionLength &&
        isLabelLike(c.prominence.text),
    );

  // A prominent short label that recurs many times *inside a region* is that
  // region's record label — an album title above its track list, a date above
  // an obituary — not a section of the document. Twenty-six of them turned a
  // discography into twenty-six `###` and buried the two real headings. The
  // count is the evidence: two or three record cards are sections, twenty-six
  // are a catalog.
  const nested = accepted.filter((c) => tableAncestors(c.node) > 1);
  const catalogLabels = nested.length > 4 ? new Set(nested.map((c) => c.node.id)) : new Set<string>();

  for (const candidate of accepted) {
    if (catalogLabels.has(candidate.node.id)) continue;
    if (isInsideHeading(candidate.node) || containsHeading(candidate.node)) continue;
    // A short prominent line directly under a photograph is its caption. It is
    // typographically identical to a section label and semantically opposite:
    // one introduces what follows, the other closes what precedes.
    if (followsImage(candidate.node)) continue;
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

  decisions.push(...recoverCenteredSections(root, opts));
  decisions.push(...recoverBulletSections(root, opts));
  return decisions;
}

/** Glyphs a page of this era used to head an entry. */
const BULLET_LABEL = /^\s*[•·▪◆♦●■]\s+\S/u;

/**
 * Entry labels a page wrote by putting a bullet in front of them.
 *
 * `• Из письма А.Максимова — А.Ларину (Владикавказ, 9 января 1946 г.)` is a
 * section: the document it introduces follows it, indented and in a smaller
 * face. The same glyph in a "see also" strip is a *list marker*, and the two
 * are told apart by what comes next — a section has a body, a list item has
 * the next list item.
 *
 * Recurrence decides for the page as a whole: once three bulleted labels are
 * each followed by a body, every bulleted label on that page is one, including
 * the two that happen to sit next to each other.
 */
function recoverBulletSections(root: LadomNode, opts: Required<HeadingOptions>): HeadingDecision[] {
  const decisions: HeadingDecision[] = [];
  if (!opts.sections) return decisions;

  const textAt = new Map<string, number>();
  let seen = 0;
  const countText = (node: LadomNode): void => {
    if (node.kind === "text") {
      seen += (node.value ?? "").trim().length;
      return;
    }
    // An engraving between two letters is content as surely as a paragraph is.
    if (node.kind === "element" && node.tag === "img") seen += 80;
    if (node.kind === "element") textAt.set(node.id, seen);
    for (const child of node.children) countText(child);
  };
  countText(root);

  const candidates: Array<{ node: LadomNode; host: LadomNode; label: string; start: number; end: number }> = [];
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td") continue;
    if (el.attrs["data-biomd-heading"] !== undefined || isInsideHeading(el)) continue;
    if (insideList(el)) continue;
    if (tableAncestors(el) > 1) continue;
    const text = textOf(el).replace(/\s+/gu, " ").trim();
    if (!BULLET_LABEL.test(text) || text.length > 180) continue;
    if (!isTightWrapper(el, textOf(el))) continue;
    // A bulleted *link* is a menu item.
    if (el.metrics.links > 0 && linkTextLength(el) >= text.length * 0.5) continue;
    const label = stripLabelGlyphs(text);
    if (label.length < 6) continue;
    const start = textAt.get(el.id) ?? 0;
    candidates.push({ node: el, host: blockHost(el), label, start, end: start + text.length });
  }

  if (candidates.length < 3) return decisions;
  const withBody = candidates.filter((c, i) => {
    const next = candidates[i + 1];
    const until = next ? next.start : seen;
    return until - c.end >= 100;
  });
  if (withBody.length < 3) return decisions;

  for (const c of candidates) {
    if (c.host.attrs["data-biomd-heading"] !== undefined) continue;
    mark(c.host, 3);
    decisions.push({
      id: c.host.id,
      depth: 3,
      text: c.label,
      score: 1,
      reason: `bulleted entry label; ${withBody.length} such labels on this page introduce a body`,
    });
  }
  return decisions;
}

function insideList(el: LadomNode): boolean {
  let cur: LadomNode | null = el.parent;
  while (cur) {
    if (cur.tag === "ul" || cur.tag === "ol" || cur.tag === "li") return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Section labels a page wrote by centring them.
 *
 * The dominant failure of scoring by prominence alone: on a page whose body is
 * justified 11 pt, the section labels are *10 pt* and centred. They score
 * below the baseline and are never nominated, so a 150-paragraph article of
 * letters and documents came out with a title and nothing else.
 *
 * Centring alone is far too weak on its own — a caption, a menu, a dedication
 * and a copyright note are all short and centred. What distinguishes a section
 * label is that it *recurs*: the same tag/class/weight signature appears three
 * or more times down the page with substantial prose between the occurrences.
 * That is a page template, and a page template for a short centred block is a
 * section heading. Anything that occurs once or twice stays prose.
 */
interface CenteredCandidate {
  node: LadomNode;
  host: LadomNode;
  label: string;
  signature: string;
  bold: boolean;
  fontPx: number | undefined;
  order: number;
}

function recoverCenteredSections(root: LadomNode, opts: Required<HeadingOptions>): HeadingDecision[] {
  const decisions: HeadingDecision[] = [];
  if (!opts.sections) return decisions;
  if (proseIsCentered(root)) return decisions;

  const baseline = bodyBaseline(root);
  const candidates: CenteredCandidate[] = [];
  /** Running count of visible characters, so "how much prose is between two
   * candidates?" is a subtraction rather than an accumulation that every
   * `continue` in the loop could forget. */
  const textAt = new Map<string, number>();
  let seen = 0;
  const countText = (node: LadomNode): void => {
    if (node.kind === "text") {
      seen += (node.value ?? "").trim().length;
      return;
    }
    if (node.kind === "element") textAt.set(node.id, seen);
    for (const child of node.children) countText(child);
  };
  countText(root);

  const proseBefore: number[] = [];
  let previousEnd = 0;
  let order = 0;

  for (const el of walkElements(root)) {
    order += 1;
    if (!CANDIDATE_TAGS.has(el.tag)) continue;
    const text = textOf(el);
    if (text === "") continue;
    if (!isTightWrapper(el, text)) continue;
    if (text.length > 160 || el.metrics.images > 0) continue;
    if (el.attrs["data-biomd-heading"] !== undefined || isInsideHeading(el)) continue;
    if (containsHeading(el)) continue;

    const prominence = prominenceOf(el);
    if (!prominence.centered) continue;
    const label = stripLabelGlyphs(prominence.text);
    // A divider drawn with bullets has nothing to name.
    if (label.length < 4 || !/\p{L}/u.test(label)) continue;
    if (label.split(/\s+/u).filter(Boolean).length > 22) continue;
    // A menu is short, centred and made of links; so is a "see also" strip.
    if (el.metrics.links > 0 && linkTextLength(el) >= text.length * 0.6) continue;
    // A caption sits under its picture.
    if (followsImage(el)) continue;
    if (!hasFollowingContent(el)) continue;
    // Inside a nested region — a record card, an obituary notice, a catalog
    // cell — a short centred line is the record's *label*, and §6 maps that to
    // a bounded `align`, not to a section of the document. Promoting them made
    // a discography of twenty albums into twenty `###`.
    if (tableAncestors(el) > 1) continue;

    const host = blockHost(el);
    if (host.attrs["data-biomd-heading"] !== undefined) continue;

    candidates.push({
      node: el,
      host,
      label,
      // A class name *is* the template: the author used `.t3` for section
      // labels and `.t8` for quoted documents. Weight and size are deliberately
      // left out — one label in the family may be bold and the next not, and
      // splitting the family on that put every member below the recurrence
      // threshold.
      signature: el.attrs["class"]
        ? `${el.tag}.${el.attrs["class"]}`
        : `${el.tag}|${prominence.bold ? "b" : ""}|${Math.round(prominence.fontPx ?? baseline)}`,
      bold: prominence.bold,
      ...(prominence.fontPx !== undefined ? { fontPx: prominence.fontPx } : { fontPx: undefined }),
      order,
    });
    const start = textAt.get(el.id) ?? 0;
    proseBefore.push(Math.max(0, start - previousEnd));
    previousEnd = start + text.trim().length;
  }

  const bySignature = new Map<string, number[]>();
  candidates.forEach((c, index) => {
    const list = bySignature.get(c.signature) ?? [];
    list.push(index);
    bySignature.set(c.signature, list);
  });

  for (const [, indices] of bySignature) {
    if (indices.length < 3) continue;
    // Three labels in a row with nothing between them is a stanza, an address
    // or the body of a notice — not three sections.
    const separated = indices.slice(1).filter((i) => (proseBefore[i] ?? 0) >= 150).length;
    if (separated < indices.length - 2) continue;

    for (const index of indices) {
      const c = candidates[index] as CenteredCandidate;
      if (c.host.attrs["data-biomd-heading"] !== undefined) continue;
      const strong = c.bold || (c.fontPx ?? baseline) > baseline * 1.05;
      const depth: 2 | 3 = strong ? 2 : 3;
      mark(c.host, depth);
      decisions.push({
        id: c.host.id,
        depth,
        text: c.label,
        score: 1,
        reason: `recurring centred short block (${indices.length} on this page) separated by prose`,
      });
    }
  }

  return decisions;
}

/** How many `<table>` elements enclose this node. One is the page shell. */
function tableAncestors(el: LadomNode): number {
  let n = 0;
  let cur = el.parent;
  while (cur) {
    if (cur.tag === "table") n += 1;
    cur = cur.parent;
  }
  return n;
}

/** True when the nearest preceding sibling with content shows a picture. */
function followsImage(el: LadomNode): boolean {
  let cur: LadomNode | null = el;
  while (cur) {
    const siblings: readonly LadomNode[] = cur.parent?.children ?? [];
    for (let i = siblings.indexOf(cur) - 1; i >= 0; i -= 1) {
      const previous = siblings[i] as LadomNode;
      if (previous.kind === "text" && (previous.value ?? "").trim() === "") continue;
      if (previous.kind === "comment") continue;
      if (previous.metrics.images > 0) return true;
      if (previous.metrics.textLen > 0) return false;
    }
    // Nothing before it here; the picture may be the last thing in the block
    // that precedes this one's parent.
    cur = cur.parent && cur.parent.metrics.textLen === el.metrics.textLen ? cur.parent : null;
  }
  return false;
}

/**
 * Glyphs a legacy page used as a list marker in front of a label.
 *
 * `• Из письма…` is the same heading as `Из письма…`; the bullet is the
 * typography of the era, not part of the name.
 */
/**
 * When a title box holds several short lines, return the one that is the title.
 *
 * The remaining lines are marked as subtitle so structure recovery can emit
 * them as the italic paragraph §2.1 asks for, keeping §2's single `#`. Returns
 * null when the candidate is one line, which is the common case.
 */
function splitMasthead(node: LadomNode): LadomNode | null {
  const lines = node.children.filter(
    (c): c is LadomNode => c.kind === "element" && BLOCK_TAGS.has(c.tag) && textOf(c).trim() !== "",
  );
  if (lines.length < 2) return null;
  // Only a genuine masthead: a container of paragraphs is not a title.
  if (lines.some((l) => textOf(l).trim().length > 80)) return null;
  for (const rest of lines.slice(1)) rest.attrs["data-biomd-subtitle"] = "1";
  return lines[0] as LadomNode;
}

export function stripLabelGlyphs(text: string): string {
  return text
    .replace(/^[\s•·▪◦*•▪● -]+/u, "")
    .replace(/[\s ]+$/u, "")
    .trim();
}

/** True when centring carries no information because the whole page is centred. */
function proseIsCentered(root: LadomNode): boolean {
  let centered = 0;
  let total = 0;
  for (const el of walkElements(root)) {
    if (el.tag !== "p" && el.tag !== "div" && el.tag !== "td") continue;
    const text = textOf(el);
    if (text.length < 200) continue;
    if (!isTightWrapper(el, text)) continue;
    total += 1;
    if (prominenceOf(el).centered) centered += 1;
  }
  return total > 0 && centered / total > 0.5;
}

/**
 * A label names a thing; a sentence says something about it.
 *
 * Legacy pages emphasize whole opening sentences all the time — an obituary
 * lede, a dated announcement — and promoting those to `##` invents an outline
 * that misrepresents the page.
 */
function isLabelLike(text: string): boolean {
  // `• • •` is a divider the page drew with bullets. It is prominent, short and
  // centred, and it is not a heading — it has nothing to name.
  if (!/\p{L}/u.test(text)) return false;
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

/**
 * True when a heading has already been marked *inside* this node.
 *
 * The mirror of `isInsideHeading`, and just as necessary. After the title is
 * marked on the first line of a masthead, the box around it is still a short
 * prominent block and the section loop nominated it — producing a second
 * heading that contained the first, so the title was emitted once, with the
 * subtitle glued onto it.
 */
function containsHeading(node: LadomNode): boolean {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (child.attrs["data-biomd-heading"] !== undefined) return true;
    if (child.attrs["data-biomd-subtitle"] !== undefined) return true;
    if (containsHeading(child)) return true;
  }
  return false;
}

function isInsideHeading(node: LadomNode): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.attrs["data-biomd-heading"] !== undefined) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * True when `node` is the innermost element carrying exactly this text.
 *
 * Emphasis is not a competing carrier. `<p class="t3"><b>II. Неизвестные
 * письма</b></p>` has exactly one block that holds the label — the `<p>` — and
 * treating the `<b>` as an inner carrier disqualified the paragraph *and*
 * nominated nothing in its place, because `<b>` is not a block a heading can
 * be marked on. Every centred bold section label on the page vanished.
 */
const EMPHASIS_ONLY = new Set(["b", "strong", "i", "em", "u", "s", "nobr", "big", "small", "sup", "sub"]);

function isTightWrapper(node: LadomNode, text: string): boolean {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (EMPHASIS_ONLY.has(child.tag)) continue;
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
