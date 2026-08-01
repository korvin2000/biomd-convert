/**
 * De-hyphenation — the inverse of hyphenation.
 *
 * Legacy Russian prose was hand-wrapped, so words are split at line ends with a
 * literal hyphen (`музы-\nкант`), and must *not* be joined when the hyphen is
 * lexical (`из-за`, `Римский-Корсаков`).
 *
 * The critical framing: **every hyphenation library solves the forward
 * problem** — "where *may* this word be broken?" None of them de-hyphenates.
 * Patterns still earn a place here, but as a *validity oracle* inside a
 * decision cascade, not as the mechanism. The heavy lifting is done by the
 * corpus lexicon and by measured line geometry, both of which are cheaper and
 * far more decisive.
 *
 * Nothing in the cascade calls a model. Every join is emitted as a reversible,
 * audited operation; nothing is joined silently.
 */
import type { Lexicon } from "./lexicon.js";
import type { TextOperation } from "./text-ops.js";

export type HyphenVerdict = "JOIN" | "PRESERVE" | "REVIEW";

export interface HyphenDecision {
  verdict: HyphenVerdict;
  /** Which cascade rule fired, 1-7. */
  rule: number;
  reason: string;
  confidence: number;
  /** The word that results from joining, when applicable. */
  joined: string;
}

/** A line-final hyphen and the fragments on either side of it. */
export interface HyphenCandidate {
  /** Text before the hyphen on the same line, e.g. `музы`. */
  left: string;
  /** Text after the break, e.g. `кант`. */
  right: string;
  /** The hyphen character actually present. */
  hyphen: string;
  /**
   * Whether the hyphen sat at the measured right edge of its line box.
   * Undefined when the page was not measured.
   */
  atLineEdge?: boolean;
}

/** Answers "is this a legal hyphenation point of this word?" — nothing more. */
export interface HyphenationOracle {
  readonly available: boolean;
  /** True when `word` may legally break after `index` characters. */
  isLegalBreak(word: string, index: number, lang: string): boolean;
}

/** Used when no pattern engine is installed. Abstains rather than guessing. */
export const NULL_ORACLE: HyphenationOracle = {
  available: false,
  isLegalBreak: () => false,
};

export interface DehyphenateOptions {
  lexicon: Lexicon;
  oracle?: HyphenationOracle;
  lang?: string;
  /** Occurrences of the joined form needed before rule 3 fires. */
  minJoinedAttestations?: number;
  /** Secondary dictionary for words the corpus does not attest (hunspell data). */
  dictionary?: (word: string) => boolean;
}

const SOFT_HYPHEN = "­";
/** Characters legacy pages use as a hyphen. */
const HYPHENS = new Set(["-", "‐", "‑", SOFT_HYPHEN]);

/**
 * Decide a single candidate. First match wins.
 *
 * The ordering is deliberate: the two cheapest and most decisive signals —
 * an explicit soft hyphen, and measured line position — come first, and the
 * pattern oracle comes last, because it is the weakest evidence of the five.
 */
export function decideHyphen(candidate: HyphenCandidate, options: DehyphenateOptions): HyphenDecision {
  const { lexicon } = options;
  const lang = options.lang ?? "ru";
  const oracle = options.oracle ?? NULL_ORACLE;
  const minAttestations = options.minJoinedAttestations ?? 1;

  const left = candidate.left;
  const right = candidate.right;
  const joined = left + right;
  const hyphenatedForm = `${left}-${right}`;

  // 1 — a soft hyphen is a layout artifact by definition. There is no other
  // reason for the character to exist.
  if (candidate.hyphen === SOFT_HYPHEN) {
    return { verdict: "JOIN", rule: 1, reason: "soft hyphen U+00AD is a discretionary break marker", confidence: 1, joined };
  }

  // 2 — measurement replacing inference. A hyphen that is not at the right edge
  // of its line box was not produced by wrapping, so it is lexical. This is a
  // fact the layout engine already computed and it settles a large share of
  // cases outright.
  if (candidate.atLineEdge === false) {
    return {
      verdict: "PRESERVE",
      rule: 2,
      reason: "hyphen is mid-line, so it cannot be a wrap artifact",
      confidence: 0.98,
      joined,
    };
  }

  // 3 — a compound proper noun. `Римский-` + `Корсаков` is never one word.
  //
  // This deliberately outranks corpus frequency. Frequency evidence can be an
  // artifact — a page that wrote the name without its hyphen, an earlier bad
  // join fed back into the lexicon — whereas two title-cased fragments joined
  // into a single word is essentially never correct Russian orthography.
  //
  // The check requires *title* case specifically. An ALL-CAPS heading wraps
  // like any other text (`МУЗЫ-` + `КАНТ`), and treating that as a compound
  // would leave every wrapped heading broken.
  if (isTitleCase(left) && isTitleCase(right)) {
    return {
      verdict: "PRESERVE",
      rule: 3,
      reason: "both fragments are title-cased, indicating a compound proper noun",
      confidence: 0.92,
      joined,
    };
  }

  // 4 — the corpus is its own best dictionary.
  const joinedCount = lexicon.count(joined);
  if (joinedCount >= minAttestations) {
    return {
      verdict: "JOIN",
      rule: 4,
      reason: `joined form attested ${joinedCount}× elsewhere in the corpus`,
      confidence: Math.min(0.99, 0.85 + joinedCount / 100),
      joined,
    };
  }

  // 5 — the converse: the hyphenated form is attested and the joined one never is.
  const hyphenCount = lexicon.hyphenatedCount(hyphenatedForm);
  if (hyphenCount > 0 && joinedCount === 0) {
    return {
      verdict: "PRESERVE",
      rule: 5,
      reason: `hyphenated form attested ${hyphenCount}× and joined form never attested`,
      confidence: Math.min(0.98, 0.85 + hyphenCount / 100),
      joined,
    };
  }

  // 6 — the oracle, finally: is the observed break a legal hyphenation point of
  // the joined word, and is that word real?
  if (oracle.available && oracle.isLegalBreak(joined, left.length, lang)) {
    const inDictionary = options.dictionary?.(joined) ?? false;
    if (inDictionary) {
      return {
        verdict: "JOIN",
        rule: 6,
        reason: "observed break is a legal hyphenation point and the joined form is a dictionary word",
        confidence: 0.88,
        joined,
      };
    }
    return {
      verdict: "REVIEW",
      rule: 6,
      reason: "break is a legal hyphenation point but the joined form is unattested",
      confidence: 0.6,
      joined,
    };
  }

  // 7 — preserve, and flag. Preserving is the conservative default: a wrongly
  // preserved hyphen is visible and fixable; a wrongly joined word is a silent
  // corruption that no later gate can catch.
  return {
    verdict: "REVIEW",
    rule: 7,
    reason: "no decisive evidence either way",
    confidence: 0.5,
    joined,
  };
}

/**
 * Find and resolve every line-final hyphen in a block of text.
 *
 * Returns the rewritten text plus one operation per candidate, including the
 * ones that were preserved — the audit needs to show what was considered, not
 * only what was changed.
 */
export interface DehyphenateResult {
  text: string;
  operations: TextOperation[];
  /** Candidates that need a human or a model. */
  reviews: number;
}

export function dehyphenateText(
  text: string,
  irItemId: string,
  options: DehyphenateOptions & { lineEdges?: (offset: number) => boolean | undefined },
): DehyphenateResult {
  const operations: TextOperation[] = [];
  let reviews = 0;
  let out = "";
  let cursor = 0;
  let opIndex = 0;

  // A break candidate is: letters, a hyphen, a newline (with optional spaces),
  // then letters. Anything else — a hyphen followed by a space, a hyphen at the
  // very end of the text — is not a wrap.
  const pattern = /(\p{L}+)([-‐‑­])[ \t]*\n[ \t]*(\p{L}+)/gu;

  for (const match of text.matchAll(pattern)) {
    const [whole, left = "", hyphen = "-", right = ""] = match;
    const start = match.index;
    const end = start + whole.length;

    const candidate: HyphenCandidate = { left, right, hyphen };
    const atEdge = options.lineEdges?.(start + left.length);
    if (atEdge !== undefined) candidate.atLineEdge = atEdge;

    const decision = decideHyphen(candidate, options);
    out += text.slice(cursor, start);

    const before = whole;
    let after: string;
    if (decision.verdict === "JOIN") {
      after = decision.joined;
    } else {
      // Preserve the hyphen but still resolve the line break: the wrap itself is
      // presentational even when the hyphen is not.
      after = `${left}${hyphen === SOFT_HYPHEN ? "" : hyphen}${right}`;
      if (decision.verdict === "REVIEW") reviews += 1;
    }
    out += after;
    cursor = end;

    operations.push({
      id: `${irItemId}:hyphen:${opIndex++}`,
      kind: decision.verdict === "JOIN" ? "join-hyphenated-word" : "preserve-break",
      sourceIds: [irItemId],
      before,
      after,
      evidenceIds: [`rule:${decision.rule}`],
      confidence: decision.confidence,
      status: decision.verdict === "REVIEW" ? "review" : "accepted",
      note: decision.reason,
    });
  }

  out += text.slice(cursor);
  return { text: out, operations, reviews };
}

/**
 * Run the cascade over every text node of a parsed document.
 *
 * This must happen **before** whitespace normalization. The evidence a wrap
 * decision rests on is the source newline immediately after the hyphen, and
 * collapsing `\s+` to a single space destroys it — after which every wrapped
 * word reads as two words separated by a hyphen and a space, and nothing can
 * tell them apart from a genuine dash.
 */
export function dehyphenateDocument(
  root: { children: Array<{ kind: string; id: string; value?: string; children: unknown[] }> },
  options: DehyphenateOptions,
): { operations: TextOperation[]; reviews: number } {
  const operations: TextOperation[] = [];
  let reviews = 0;

  const visit = (node: { kind: string; id: string; value?: string; children: unknown[] }): void => {
    if (node.kind === "text" && typeof node.value === "string" && /[-‐‑­][ \t]*\n/u.test(node.value)) {
      const result = dehyphenateText(node.value, node.id, options);
      node.value = result.text;
      operations.push(...result.operations);
      reviews += result.reviews;
    }
    for (const child of node.children) {
      visit(child as { kind: string; id: string; value?: string; children: unknown[] });
    }
  };

  visit(root as never);
  return { operations, reviews };
}

/** Upper-case initial followed by at least one lower-case letter. */
function isTitleCase(word: string): boolean {
  const first = word[0];
  if (!first) return false;
  const initialIsUpper = first !== first.toLowerCase() && first === first.toUpperCase();
  if (!initialIsUpper) return false;
  const rest = word.slice(1);
  return rest !== rest.toUpperCase();
}

export function isHyphen(ch: string): boolean {
  return HYPHENS.has(ch);
}

/**
 * Hyphenopoly-backed oracle.
 *
 * Loaded lazily and optional: the package ships ~100 WASM pattern sets, and if
 * it is absent the cascade simply never reaches rule 6. Selection rationale is
 * pattern coverage plus a real Node entry point — not hyphenation quality,
 * since no hyphen is ever rendered.
 */
export async function createHyphenopolyOracle(langs: readonly string[] = ["ru", "en-us"]): Promise<HyphenationOracle> {
  try {
    const mod = (await import("hyphenopoly")) as unknown as {
      config: (options: Record<string, unknown>) => unknown;
    };
    const SENTINEL = "";
    const hyphenators = new Map<string, (word: string) => string>();

    const configured = mod.config({
      require: [...langs],
      hyphen: SENTINEL,
      exceptions: {},
      // Minima must be pinned: changing them silently changes which joins are
      // legal, and therefore which words the corpus ends up with.
      leftmin: 2,
      rightmin: 2,
      sync: true,
    }) as Record<string, (word: string) => string> | ((word: string) => string);

    if (typeof configured === "function") {
      hyphenators.set(langs[0] ?? "ru", configured);
    } else {
      for (const lang of langs) {
        const fn = (configured as Record<string, unknown>)[lang];
        if (typeof fn === "function") hyphenators.set(lang, fn as (word: string) => string);
      }
    }
    if (hyphenators.size === 0) return NULL_ORACLE;

    return {
      available: true,
      isLegalBreak(word: string, index: number, lang: string): boolean {
        const hyphenate = hyphenators.get(lang) ?? hyphenators.values().next().value;
        if (!hyphenate) return false;
        try {
          const marked = hyphenate(word.toLowerCase());
          // Positions of the sentinel, converted back to indices in the original.
          let seen = 0;
          for (let i = 0; i < marked.length; i += 1) {
            if (marked[i] === SENTINEL) {
              if (seen === index) return true;
              continue;
            }
            seen += 1;
          }
          return false;
        } catch {
          return false;
        }
      },
    };
  } catch {
    return NULL_ORACLE;
  }
}
