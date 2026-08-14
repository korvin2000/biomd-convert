/**
 * Where the deterministic passes ran out of evidence — enumerated.
 *
 * This module answers one question per collector: *which items did a rule look
 * at and decline?* Nothing here decides anything. It builds the population an
 * escalation may be asked about, and the population is always the rule's own
 * residual — never "everything of this kind on the page".
 *
 * That distinction is the difference between a hook that supports a rule and one
 * that competes with it. `unknownIconCandidates` does not return every image; it
 * returns the images whose asset the known-icon table has never seen, which is
 * that table's documented no-match path.
 *
 * A collector that cannot be written this way is the signal that the hook it
 * feeds is wrong. `hyphenCasesFrom` used to live here and its population was the
 * words the cascade had *decided* to keep hyphenated — a rule's output dressed
 * up as a rule's residual. It is gone, with the hook it fed. `captionCandidates`
 * was a correct collector feeding a hook that was removed for a different
 * reason, and it went with it.
 *
 * The collectors are also where the *payload* is bounded. A page is cheap to
 * read and expensive to send, so each collector clips its context to what the
 * judgement needs — the block around an image, the blocks either side of a line
 * — and the bounds live here rather than in the prompt, where they would be
 * advice instead of a limit.
 */
import { type LadomNode, textOf, walkElements } from "../ladom/types.js";
import { imageHeightOf, imageWidthOf } from "./media.js";
import { iconGlyphFor } from "./glyphs.js";
import type { ImageRoleRequest } from "./resolver.js";

/** How much text around an item is enough to judge it, and not more. */
const CONTEXT_CHARS = 220;
/** An image this size in both dimensions cannot be depicting anything. */
const ICON_CEILING_PX = 32;

/**
 * Images the known-icon table has never seen, at a size that cannot depict.
 *
 * ## The abstention this enumerates
 *
 * `isUiIcon` requires a hit in the icon table, and returns false without one.
 * That refusal is correct as a default — invariant 5 requires the lexical table
 * to degrade gracefully rather than guess — and on the reference corpus it is
 * nearly always right, because the table holds the assets this site draws its
 * controls with.
 *
 * It is also the rule's blind spot on every page nobody has measured: a control
 * drawn with an asset the table lacks ships as a broken picture, and no
 * instrument reports a missing glyph. This collector is that blind spot, made
 * addressable.
 *
 * ## Why the geometry bound stays here
 *
 * An image larger than the ceiling is a picture whatever anyone says about it,
 * so it is never offered. The escalation can therefore only ever change the
 * *identity* of a mark that already has a control's shape — it can never turn a
 * photograph into a glyph.
 */
export function unknownIconCandidates(root: LadomNode, limit = 12): ImageRoleRequest[] {
  const out: ImageRoleRequest[] = [];
  const occurrences = new Map<string, number>();
  const images: LadomNode[] = [];

  for (const el of walkElements(root)) {
    if (el.tag !== "img") continue;
    images.push(el);
    const src = el.attrs["src"] ?? "";
    occurrences.set(src, (occurrences.get(src) ?? 0) + 1);
  }

  for (const el of images) {
    const src = el.attrs["src"] ?? "";
    if (src === "") continue;
    if (iconGlyphFor(src) !== null) continue; // the table decided; nothing to ask

    const w = imageWidthOf(el);
    const h = imageHeightOf(el);
    if (w === undefined || h === undefined) continue; // no geometry, no candidacy
    if (w > ICON_CEILING_PX || h > ICON_CEILING_PX) continue;

    const link = ancestorLink(el);
    const alt = (el.attrs["alt"] ?? "").trim();
    const prose = proseBefore(el);

    out.push({
      id: el.id,
      size: `${w}×${h} px`,
      ...(alt !== "" ? { alt } : {}),
      inLink: link !== null,
      ...(link ? { linkTarget: link.attrs["href"] ?? "" } : {}),
      occurrences: occurrences.get(src) ?? 1,
      ...(prose > 0 ? { inRunningProse: prose } : {}),
      surroundings: surroundingsOf(el),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function ancestor(el: LadomNode, tags: ReadonlySet<string>): LadomNode | null {
  for (let cur = el.parent; cur; cur = cur.parent) {
    if (tags.has(cur.tag)) return cur;
  }
  return null;
}

function ancestorLink(el: LadomNode): LadomNode | null {
  for (let cur = el.parent; cur; cur = cur.parent) {
    if (cur.tag === "a" && (cur.attrs["href"] ?? "") !== "") return cur;
  }
  return null;
}

/** Visible characters before this node inside its own block. */
function proseBefore(el: LadomNode): number {
  const block = ancestor(el, BLOCK_CONTEXT);
  if (!block) return 0;
  let before = "";
  let reached = false;
  const visit = (node: LadomNode): void => {
    if (reached) return;
    if (node === el) {
      reached = true;
      return;
    }
    if (node.kind === "text") before += node.value ?? "";
    for (const child of node.children) visit(child);
  };
  visit(block);
  return reached ? before.replace(/[\s ]+/gu, " ").trim().length : 0;
}

const BLOCK_CONTEXT: ReadonlySet<string> = new Set([
  "p",
  "div",
  "td",
  "th",
  "li",
  "center",
  "blockquote",
  "body",
  "#root",
]);

/** The block an item sits in, clipped — enough to judge it, not the page. */
function surroundingsOf(el: LadomNode): string {
  const block = ancestor(el, BLOCK_CONTEXT);
  const text = textOf(block ?? el).replace(/\s+/gu, " ").trim();
  return text.length > CONTEXT_CHARS ? `${text.slice(0, CONTEXT_CHARS)}…` : text;
}

/** Text of the blocks around a node, for a payload that needs both sides. */
export function neighbourhoodOf(node: LadomNode): { before: string; after: string } {
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  const clip = (n: LadomNode | undefined): string => {
    if (!n) return "(nothing)";
    const text = textOf(n).replace(/\s+/gu, " ").trim();
    if (text === "") return "(nothing)";
    return text.length > CONTEXT_CHARS ? `${text.slice(0, CONTEXT_CHARS)}…` : text;
  };
  return { before: clip(siblings[index - 1]), after: clip(siblings[index + 1]) };
}
