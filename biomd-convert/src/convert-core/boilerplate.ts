/**
 * Boilerplate removal — the corpus pass cashing in.
 *
 * Site chrome is not recognisable from one page. The banner, the top menu, the
 * side rails and the counter all look exactly like content when you only have
 * one document: they are text, in tables, with links. What identifies them is
 * that they are *the same on every page*, and that is a measurement the Stage 0
 * corpus pass has already made.
 *
 * The classifier can only reach chrome that survives as a `<table>`, and most of
 * it does not: normalization unwraps a single-cell wrapper table long before
 * classification runs, after which the banner is simply a paragraph. So removal
 * happens here instead — before normalization, while the scaffolding is still
 * standing.
 *
 * Deleting the article by mistake is the failure that matters, so the guards are
 * asymmetric on purpose: recurrence is necessary but never sufficient.
 */
import { type LadomNode, textOf, walk, walkElements } from "../ladom/types.js";
import type { CorpusProfile } from "./corpus.js";
import { MIN_PAGES_FOR_CHROME, fingerprint } from "./corpus.js";

export interface BoilerplateRemoval {
  id: string;
  tag: string;
  reason: string;
  /** Visible text removed, so the conservation gate can discharge it. */
  text: string;
  fingerprint: string;
  frequency: number;
}

export interface BoilerplateOptions {
  /** Fraction of corpus pages a structure must recur on. */
  threshold?: number;
  /** A candidate carrying more than this share of the page is never chrome. */
  maxTextShare?: number;
  /** A candidate containing a text run this long is prose, not furniture. */
  maxProseRun?: number;
}

const DEFAULTS: Required<BoilerplateOptions> = {
  threshold: 0.7,
  maxTextShare: 0.25,
  maxProseRun: 300,
};

/** Containers worth testing. Fingerprinting every `<b>` would drown the signal. */
const CANDIDATE_TAGS = new Set(["table", "tr", "td", "div", "nav", "header", "footer", "center", "p"]);

export interface BoilerplateResult {
  removals: BoilerplateRemoval[];
  warnings: string[];
}

export function removeBoilerplate(
  root: LadomNode,
  profile: CorpusProfile | null,
  options: BoilerplateOptions = {},
): BoilerplateResult {
  const opts = { ...DEFAULTS, ...options };
  const removals: BoilerplateRemoval[] = [];
  const warnings: string[] = [];
  if (!profile) return { removals, warnings };

  // A profile written before `MIN_PAGES_FOR_CHROME` existed can claim chrome a
  // corpus of one could not possibly have observed — and one is on disk in every
  // job directory that was scanned over a single page. Refuse it at use, so the
  // fix does not depend on the operator knowing to re-scan.
  if (profile.files < MIN_PAGES_FOR_CHROME && profile.stableChrome.length > 0) {
    warnings.push(
      `Corpus profile was built from ${profile.files} page(s) and claims ` +
        `${profile.stableChrome.length} chrome structure(s); on a corpus that small every structure ` +
        "on the page recurs on 100 % of it, so the claim carries no evidence. Chrome removal is " +
        "skipped for this document — re-run `biomd corpus scan` over the whole site.",
    );
    return { removals, warnings };
  }

  const chrome = new Set(profile.stableChrome);
  const documentText = visibleLength(root);
  if (documentText === 0) return { removals, warnings };

  // Outermost first: removing the whole header table is better than removing its
  // six cells one at a time, and a descendant of something already gone is not a
  // separate decision.
  const candidates: LadomNode[] = [];
  for (const el of walkElements(root)) {
    if (!CANDIDATE_TAGS.has(el.tag)) continue;
    if (el.metrics.depth < 1) continue;
    candidates.push(el);
  }

  const detached = new Set<LadomNode>();
  for (const el of candidates) {
    if (el.parent === null) continue;
    if (hasDetachedAncestor(el, detached)) continue;

    const fp = fingerprint(el);
    if (!chrome.has(fp)) continue;
    const frequency = profile.fingerprintFrequency[fp] ?? 0;
    if (frequency < opts.threshold) continue;

    const share = visibleLength(el) / documentText;
    if (share > opts.maxTextShare) {
      warnings.push(
        `${el.id}: structure recurs on ${(frequency * 100).toFixed(0)}% of pages but carries ` +
          `${(share * 100).toFixed(0)}% of this page's text; kept as content.`,
      );
      continue;
    }
    if (longestTextRun(el) > opts.maxProseRun) {
      warnings.push(`${el.id}: recurring structure containing prose; kept as content.`);
      continue;
    }

    removals.push({
      id: el.id,
      tag: el.tag,
      reason: `page chrome: this structure recurs with the same text on ${(frequency * 100).toFixed(0)}% of corpus pages`,
      text: textOf(el),
      fingerprint: fp,
      frequency,
    });
    detach(el);
    detached.add(el);
  }

  return { removals, warnings };
}

function hasDetachedAncestor(node: LadomNode, detached: ReadonlySet<LadomNode>): boolean {
  let cur: LadomNode | null = node.parent;
  while (cur) {
    if (detached.has(cur)) return true;
    cur = cur.parent;
  }
  // A node whose chain no longer reaches a root was detached with its ancestor.
  return false;
}

function visibleLength(node: LadomNode): number {
  return textOf(node).length;
}

/** The longest single text node. Chrome is labels; an article is sentences. */
function longestTextRun(node: LadomNode): number {
  let max = 0;
  for (const n of walk(node)) {
    if (n.kind !== "text") continue;
    max = Math.max(max, (n.value ?? "").replace(/\s+/gu, " ").trim().length);
  }
  return max;
}

function detach(node: LadomNode): void {
  const parent = node.parent;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parent = null;
}
