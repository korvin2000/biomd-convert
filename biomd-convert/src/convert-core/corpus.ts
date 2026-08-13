/**
 * Stage 0 — the corpus pass.
 *
 * The cheapest high-leverage stage in the system: every product of it converts
 * a recurring judgement into a lookup. Chrome detection stops being a hardcoded
 * list of asset names and becomes a measurement; de-hyphenation gets the
 * proper nouns no general dictionary has; table classification gets a prior.
 *
 * Linear, no model calls, cacheable by content hash.
 */
import { createHash } from "node:crypto";
import { decodeHtml } from "../ladom/encoding.js";
import { parseHtml } from "../ladom/parse.js";
import { quarantineServerMarkup } from "../ladom/quarantine.js";
import { dropHead, sanitizeS1 } from "../ladom/sanitize.js";
import { type LadomNode, rawTextOf, textOf, walkElements } from "../ladom/types.js";
import { Lexicon } from "./lexicon.js";

export interface CorpusProfile {
  files: number;
  /** Structural fingerprint → fraction of pages carrying it, 0..1. */
  fingerprintFrequency: Record<string, number>;
  /** Fingerprints whose visible text is also near-identical across pages. */
  stableChrome: string[];
  lexicon: ReturnType<Lexicon["toJSON"]>;
  /** Declared vs detected charset per file, so batch anomalies surface early. */
  encodings: Record<string, { declared: string | null; chosen: string; uncertain: boolean }>;
  /** Histogram of rendered content-column widths, when measurement ran. */
  columnWidthHistogram: Record<string, number>;
  warnings: string[];
}

export interface CorpusPassOptions {
  /** Fraction of pages a fingerprint must appear on to count as chrome. */
  chromeThreshold?: number;
}

/**
 * Pages a corpus must hold before "recurs across the site" is a measurement.
 *
 * Two, because recurrence is a relation between observations and one page is
 * one observation. Deliberately not a tunable: below it the frequency is not
 * uncertain, it is undefined. Read by `boilerplate.ts` as well, so a profile
 * written by an older build is refused at use rather than trusted on its word.
 */
export const MIN_PAGES_FOR_CHROME = 2;

/**
 * Structural fingerprint of a subtree.
 *
 * Tag path plus an attribute skeleton plus a coarse text signature. Page-
 * specific text is deliberately excluded — the point is to recognise the same
 * *structure* carrying different content, which is what distinguishes a
 * template from a coincidence.
 */
/**
 * Elements excluded from a fingerprint.
 *
 * The corpus pass and the conversion pipeline sanitize to different depths — the
 * pipeline keeps stylesheets until after it has rendered the page — so a
 * fingerprint that counted them would differ between the two for the same
 * structure, and *every* chrome lookup would miss. Excluding them here makes the
 * fingerprint a property of the page's shape rather than of when it was taken.
 */
const FINGERPRINT_IGNORED = new Set(["script", "noscript", "style", "link", "meta", "head", "template"]);

export function fingerprint(node: LadomNode): string {
  const parts: string[] = [];
  const visit = (n: LadomNode, depth: number): void => {
    if (depth > 6 || n.kind !== "element") return;
    if (FINGERPRINT_IGNORED.has(n.tag)) return;
    const classes = (n.attrs["class"] ?? "").trim().split(/\s+/u).filter(Boolean).sort().join(".");
    const id = n.attrs["id"] ?? "";
    // Structural attributes only: the shape of the scaffold, not its content.
    const shape = [
      n.tag,
      id ? `#${id}` : "",
      classes ? `.${classes}` : "",
      n.attrs["width"] ? `w${fingerprintLength(n.attrs["width"])}` : "",
      n.attrs["border"] ? `b${n.attrs["border"]}` : "",
    ].join("");
    parts.push(shape);
    for (const child of n.children) visit(child, depth + 1);
  };
  visit(node, 0);
  return createHash("sha1").update(parts.join(">")).digest("hex").slice(0, 16);
}

/**
 * One declared width, however the author spelled it.
 *
 * `width="760"` and `width="760px"` are the same scaffold — the second is not
 * even valid HTML, since the attribute takes a number or a percentage, so a
 * browser drops it — but hashing them apart makes the same site template
 * fingerprint as two different structures, and the chrome model is built on
 * exactly that recurrence. `news` writes every width in its page frame with a
 * `px` suffix and no other page in the corpus does, so its banner, its menu
 * button and its rails matched nothing and were emitted as content.
 *
 * A percentage keeps its unit: `90%` and `90` are genuinely different
 * declarations and must stay apart.
 */
function fingerprintLength(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const numeric = /^(\d+(?:\.\d+)?)(?:px)?$/u.exec(trimmed);
  return numeric ? (numeric[1] as string) : trimmed;
}

/** Coarse text signature, for deciding whether repeated structure also repeats content. */
function textSignature(node: LadomNode): string {
  const text = textOf(node).slice(0, 200).toLowerCase().replace(/\d+/gu, "#");
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export interface CorpusFile {
  name: string;
  bytes: Uint8Array | Buffer;
}

export function runCorpusPass(files: readonly CorpusFile[], options: CorpusPassOptions = {}): CorpusProfile {
  const chromeThreshold = options.chromeThreshold ?? 0.7;
  const lexicon = new Lexicon();
  const warnings: string[] = [];
  const encodings: CorpusProfile["encodings"] = {};

  const fingerprintPages = new Map<string, Set<string>>();
  const fingerprintTexts = new Map<string, Set<string>>();

  for (const file of files) {
    let decoded;
    try {
      decoded = decodeHtml(file.bytes);
    } catch (error) {
      warnings.push(`${file.name}: decode failed (${(error as Error).message}); skipped in corpus pass.`);
      continue;
    }
    encodings[file.name] = {
      declared: decoded.decision.declared,
      chosen: decoded.decision.codec,
      uncertain: decoded.decision.uncertain,
    };

    const quarantined = quarantineServerMarkup(decoded.text);
    const doc = parseHtml(quarantined.text);

    // Strip behaviour *before* reading text. `<style>` and `<script>` bodies are
    // text nodes as far as the tree is concerned, so without this the lexicon
    // learns `font-family`, `sans-serif` and every JS identifier on the page —
    // and those hyphenated CSS tokens then act as evidence in the
    // de-hyphenation cascade, which is precisely where wrong evidence does
    // the most damage.
    sanitizeS1(doc.root, { removeStyles: true });
    // The conversion pipeline drops `<head>` too, and a fingerprint taken over a
    // tree that still has one would never match the tree the converter measures
    // against. Both sides must see the same shape or chrome detection silently
    // matches nothing at all.
    dropHead(doc.root);

    // Raw text: the lexicon needs source line breaks so it can refuse to learn
    // from hyphen-wrapped fragments.
    lexicon.add(rawTextOf(doc.root));

    for (const el of walkElements(doc.root)) {
      // Only containers large enough to be a template component are worth
      // fingerprinting; fingerprinting every <b> would drown the signal.
      if (el.metrics.depth < 2) continue;
      if (!["table", "tr", "td", "div", "nav", "header", "footer"].includes(el.tag)) continue;

      const fp = fingerprint(el);
      let pages = fingerprintPages.get(fp);
      if (!pages) {
        pages = new Set();
        fingerprintPages.set(fp, pages);
      }
      pages.add(file.name);

      let texts = fingerprintTexts.get(fp);
      if (!texts) {
        texts = new Set();
        fingerprintTexts.set(fp, texts);
      }
      texts.add(textSignature(el));
    }
  }

  const total = files.length || 1;
  const fingerprintFrequency: Record<string, number> = {};
  const stableChrome: string[] = [];
  // **Recurrence needs two observations to exist.** On a corpus of one every
  // fingerprint the page carries appears on 100 % of pages, and holds exactly
  // one text signature, so *both* tests below pass for every structure on the
  // page — including the article. This is not a weak measurement to be
  // thresholded, it is an undefined one: `pages.size / total` is 1/1 by
  // construction and carries no information at all.
  //
  // Measured over the fixture sources, scanning the first N: the count is
  // **22 and 43** for the two one-file scans and **10, 10, 10, 10, 9, 9, 9**
  // from N = 2 upward, and the share of page text the removal pass then takes
  // is **18.1 %** for the one-file profile against **1.1 %** for every other.
  // A cliff at exactly one page, flat after it — the boundary is the mechanism
  // rather than a tuned number.
  if (total < MIN_PAGES_FOR_CHROME) {
    warnings.push(
      `Corpus of ${files.length} page(s): chrome cannot be identified, because "recurs on every ` +
        `page" is true of everything a single page contains. No chrome recorded — scan at least ` +
        `${MIN_PAGES_FOR_CHROME} pages of the same site, or convert without a profile.`,
    );
  }
  for (const [fp, pages] of fingerprintPages) {
    const frequency = pages.size / total;
    fingerprintFrequency[fp] = frequency;
    if (total < MIN_PAGES_FOR_CHROME) continue;
    const texts = fingerprintTexts.get(fp);
    // Recurring structure *and* near-identical text is chrome. Recurring
    // structure with varying text is a template for content — a discography
    // table looks the same on every page but says something different.
    if (frequency >= chromeThreshold && texts && texts.size <= Math.max(1, pages.size * 0.2)) {
      stableChrome.push(fp);
    }
  }

  return {
    files: files.length,
    fingerprintFrequency,
    stableChrome,
    lexicon: lexicon.toJSON(),
    encodings,
    columnWidthHistogram: {},
    warnings,
  };
}

/**
 * Frequency lookup for a document's tables, keyed by node id.
 *
 * **Empty when the corpus was too small to observe recurrence.** This is the
 * second consumer of the same evidence and the more destructive one:
 * `classify.ts` returns `SHELL` at tier 1, confidence 0.95, for any table above
 * `corpusFrequency` 0.7, and a `SHELL` table is deleted outright. On a corpus of
 * one that is *every* table on the page. Returning no entry is the honest
 * answer — the classifier already treats an absent frequency as "no evidence"
 * and decides on the grid alone — and it keeps the two consumers of
 * {@link MIN_PAGES_FOR_CHROME} from disagreeing about what the profile knows.
 */
export function frequencyForDocument(root: LadomNode, profile: CorpusProfile): Map<string, number> {
  const out = new Map<string, number>();
  if (profile.files < MIN_PAGES_FOR_CHROME) return out;
  for (const el of walkElements(root)) {
    if (el.tag !== "table") continue;
    const fp = fingerprint(el);
    out.set(el.id, profile.fingerprintFrequency[fp] ?? 0);
  }
  return out;
}
