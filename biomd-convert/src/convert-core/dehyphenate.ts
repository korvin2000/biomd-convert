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

/**
 * How often a hyphenated form must appear before rule 5 trusts it.
 *
 * Two, not one, because the lexicon is built by scanning the same corpus this
 * runs on: a wrap artifact is indexed as a hyphenated word like any other, so
 * one attestation is the defect vouching for itself.
 */
const MIN_HYPHEN_ATTESTATIONS = 2;

export type HyphenVerdict = "JOIN" | "PRESERVE" | "REVIEW";

export interface HyphenDecision {
  verdict: HyphenVerdict;
  /** Which cascade rule fired: 0 for the not-prose gate, then 1-7. */
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
  /**
   * Whether the hyphen sits inside a machine identifier rather than prose —
   * a host name, a path, a file name, an address. Set by `dehyphenateText`,
   * which is the only caller that can see the characters around the candidate.
   */
  inIdentifier?: boolean;
  /** Whether this break belongs to a multi-part proper-name compound. */
  inProperCompound?: boolean;
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

  // 0 — the candidate is not prose. A hyphen inside a host name, a path or a
  // file name was never produced by wrapping, because the thing it sits in is a
  // single unbreakable token that no line break ever ran through; and joining it
  // does not merely misspell a word, it rewrites an identifier. `authors` shows
  // both halves of why this must outrank everything below it: the page links to
  // `www.abc-guitars.com` *and*, two clauses later, to the genuinely different
  // `www.abcguitars.com`, so the corpus attests the joined form and rule 4 —
  // "the corpus is its own best dictionary" — joins the label of the first into
  // the name of the second. The label then contradicts its own `href`.
  //
  // This is the one place in the cascade where PRESERVE is not merely the safe
  // default but a §16.3 requirement: a target and its visible label are content.
  if (candidate.inIdentifier === true) {
    return {
      verdict: "PRESERVE",
      rule: 0,
      reason: "hyphen sits inside a machine identifier, which no line break ever wrapped",
      confidence: 0.99,
      joined,
    };
  }

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
  // A multi-part name may carry lower-case linkers between title-cased ends;
  // each internal candidate still belongs to the same lexical compound.
  //
  // This deliberately outranks corpus frequency. Frequency evidence can be an
  // artifact — a page that wrote the name without its hyphen, an earlier bad
  // join fed back into the lexicon, or an internal linker that is also a common
  // standalone word — whereas joining any break inside a proper-name compound
  // silently changes the name.
  //
  // The check requires *title* case specifically. An ALL-CAPS heading wraps
  // like any other text (`МУЗЫ-` + `КАНТ`), and treating that as a compound
  // would leave every wrapped heading broken.
  if (candidate.inProperCompound === true || (isTitleCase(left) && isTitleCase(right))) {
    return {
      verdict: "PRESERVE",
      rule: 3,
      reason: "break belongs to a compound proper noun",
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
  //
  // **Recurrence, because the lexicon reads the same broken text.** A wrap
  // artifact is a hyphenated "word" too, and the corpus scan indexes it like
  // any other, so a single attestation is exactly what an artifact looks like
  // from here — the evidence is the defect, quoting itself. `Борис-лавовна` and
  // `монас-тырь` are each attested once and are each a wrap; `из-за` is
  // attested twice and is a word. A lexical compound recurs because it is
  // lexical; an accident of where one line happened to end does not.
  const hyphenCount = lexicon.hyphenatedCount(hyphenatedForm);
  if (hyphenCount >= MIN_HYPHEN_ATTESTATIONS && joinedCount === 0) {
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
  const inDictionary = options.dictionary?.(joined) ?? false;
  const legalBreak = oracle.available && oracle.isLegalBreak(joined, left.length, lang);

  if (legalBreak && inDictionary) {
    return {
      verdict: "JOIN",
      rule: 6,
      reason: "observed break is a legal hyphenation point and the joined form is a dictionary word",
      confidence: 0.88,
      joined,
    };
  }

  // 6b — the break *position* is the typesetter's choice, not the language's.
  //
  // Rule 6 asks the pattern engine where a word *may* break and refuses to join
  // anywhere else. That is the right question for text a layout engine wrapped,
  // and the wrong one for this corpus: these pages were typed from print by
  // hand, and the hyphen is wherever the person doing the typing found it —
  // `фес-тивалях`, `общест-ва`, `художест-венной`. Russian patterns forbid a
  // break inside those clusters, so rule 6 vetoes the join and the broken word
  // ships. Measured over the unlabelled corpus, 131 occurrences of 112 distinct
  // forms sit in exactly that position, and not one of them is a compound.
  //
  // So the second signal moves off the break position and onto the fragments.
  // A wrap cuts one word into two pieces that are not themselves words; a
  // compound joins two things that are. That keeps rule 6 a two-signal gate —
  // it replaces a signal measuring where a 1998 typist pressed the key with one
  // measuring what the language actually contains — and it is why the join
  // stays refused for `из-за`, `кто-то`, `во-первых` and `вице-президент`,
  // whose joined spellings no dictionary holds, and for `лит-ре`, whose joined
  // spelling `литре` is a different word and whose halves are both words.
  //
  // Recurrence cannot apply: a wrapped word is one lexical event at one place
  // on one page. The evidence is lexical, and it is external to the corpus.
  if (inDictionary) {
    const isWord = options.dictionary ?? (() => false);
    if (!(isWord(left) && isWord(right))) {
      return {
        verdict: "JOIN",
        rule: 6,
        reason:
          "joined form is a dictionary word and the split leaves a fragment that is not, " +
          "so the hyphen is a wrap the language does not license",
        confidence: 0.82,
        joined,
      };
    }
  }

  if (legalBreak) {
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
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let reviews = 0;
  let opIndex = 0;

  // A break candidate is letters, a hyphen, then letters — with or without a
  // newline between them, and nothing else in the gap.
  //
  // The newline was originally required, on the reasoning that a wrap leaves
  // one behind. It does when the author let the editor wrap. This corpus was
  // typed the other way: the hyphen was inserted to break the word in *the
  // author's* browser at *their* window width, and then the text kept flowing —
  // `Укра-ина` and `Владимиро-вич` sit mid-line in the source with the newline
  // somewhere else entirely. Requiring the newline saw none of them, which is
  // why this module has been in the pipeline all along with almost nothing to
  // do.
  //
  // Dropping the requirement means every hyphenated word in the corpus now
  // reaches the cascade, including every genuine compound. That is safe because
  // the cascade's default is PRESERVE and its first questions are about
  // compounds: `Римский-Корсаков` and `Переяслав-Хмельницкий` are settled by
  // rule 3 before any frequency evidence is consulted.
  //
  // The right fragment is captured in a lookahead rather than consumed. That
  // lets the same fragment become the left side of the next candidate in a
  // multiply broken word. Replacements touch only the hyphen and whitespace,
  // so adjacent decisions cannot overlap or duplicate the shared fragment.
  const pattern = /(\p{L}+)([-‐‑­])[ \t]*\n?[ \t]*(?=(\p{L}+))/gu;

  for (const match of text.matchAll(pattern)) {
    const [gapWithLeft, left = "", hyphen = "-", right = ""] = match;
    const start = match.index;
    const hyphenStart = start + left.length;
    const rightStart = start + gapWithLeft.length;
    const end = rightStart + right.length;

    const candidate: HyphenCandidate = { left, right, hyphen };
    if (insideIdentifier(text, start, end)) candidate.inIdentifier = true;
    if (insideProperCompound(text, start, end)) candidate.inProperCompound = true;
    const atEdge = options.lineEdges?.(hyphenStart);
    if (atEdge !== undefined) candidate.atLineEdge = atEdge;

    const decision = decideHyphen(candidate, options);
    const replacement = decision.verdict === "JOIN" || hyphen === SOFT_HYPHEN ? "" : hyphen;
    replacements.push({ start: hyphenStart, end: rightStart, value: replacement });
    if (decision.verdict === "REVIEW") reviews += 1;

    const before = text.slice(start, end);
    const after = decision.verdict === "JOIN" ? decision.joined : `${left}${replacement}${right}`;
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

  let out = "";
  let cursor = 0;
  for (const replacement of replacements) {
    out += text.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
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
/** Cheap pre-filter: does this text hold a hyphen between two letters at all? */
const HYPHEN_IN_WORD = /\p{L}[-‐‑­][ \t]*\n?[ \t]*\p{L}/u;

/**
 * Inline elements a wrap hyphen is found inside.
 *
 * HTML vocabulary, not corpus vocabulary: the list holds no class, id, file
 * name or title, and a tag it does not know simply yields no join. It exists so
 * that a hyphen alone inside `<p>` — a real dash between two blocks — can never
 * be mistaken for a word split by markup.
 */
const INLINE_WRAPPERS = new Set([
  "span", "font", "b", "strong", "i", "em", "u", "s", "strike", "small", "big",
  "sub", "sup", "tt", "code", "abbr", "cite", "mark", "a",
]);

type TextishNode = { kind: string; id: string; tag?: string; value?: string; children: unknown[] };

/** Concatenated text of a subtree — used only to recognize a lone hyphen. */
function subtreeText(node: TextishNode): string {
  if (node.kind === "text") return node.value ?? "";
  let out = "";
  for (const child of node.children) out += subtreeText(child as TextishNode);
  return out;
}

export function dehyphenateDocument(
  root: { children: Array<{ kind: string; id: string; value?: string; children: unknown[] }> },
  options: DehyphenateOptions,
): { operations: TextOperation[]; reviews: number } {
  const operations: TextOperation[] = [];
  let reviews = 0;
  let crossIndex = 0;

  /**
   * A wrap hyphen that markup put in a box of its own.
   *
   * `dehyphenateText` reads one text node, and this corpus routinely breaks the
   * word across three: `изда<span lang="en-us">-</span>вал`. The spell-checker
   * of the day tagged the hyphen it had just typed, and after that no single
   * node holds a hyphen between two letters, so the pre-filter skips all of
   * them and the word ships broken at 100 % text recall.
   *
   * The shape is recognized structurally and nothing else is admitted: an inline
   * wrapper whose whole subtree is exactly one hyphen, a raw text sibling
   * immediately before it ending in a letter, a raw text sibling immediately
   * after it starting with a letter, and no whitespace at either junction. Two
   * raw text siblings cannot be in different blocks, so the join can never span
   * one. The verdict itself is the ordinary cascade — the same rules, with the
   * same identifier and proper-compound guards, reading a synthesized view of
   * the three nodes as the one word the source meant.
   */
  const joinAcrossWrapper = (parent: TextishNode): void => {
    const kids = parent.children as TextishNode[];
    for (let i = 1; i < kids.length - 1; i++) {
      const wrapper = kids[i];
      const before = kids[i - 1];
      const after = kids[i + 1];
      if (!wrapper || !before || !after) continue;
      if (wrapper.kind !== "element" || !INLINE_WRAPPERS.has(wrapper.tag ?? "")) continue;
      if (before.kind !== "text" || after.kind !== "text") continue;

      const hyphen = subtreeText(wrapper);
      if (hyphen.length !== 1 || !isHyphen(hyphen)) continue;

      const leftValue = before.value ?? "";
      const rightValue = after.value ?? "";
      const left = /(\p{L}+)$/u.exec(leftValue)?.[1];
      const right = /^(\p{L}+)/u.exec(rightValue)?.[1];
      if (!left || !right) continue;

      // The guards read characters around the candidate, so give them the word
      // as it would have been written without the markup.
      const context = leftValue + hyphen + rightValue;
      const start = leftValue.length - left.length;
      const end = leftValue.length + hyphen.length + right.length;
      const candidate: HyphenCandidate = { left, right, hyphen };
      if (insideIdentifier(context, start, end)) candidate.inIdentifier = true;
      if (insideProperCompound(context, start, end)) candidate.inProperCompound = true;

      const decision = decideHyphen(candidate, options);
      if (decision.verdict === "REVIEW") reviews += 1;
      if (decision.verdict === "JOIN") {
        for (const child of wrapper.children) {
          const text = child as TextishNode;
          if (text.kind === "text") text.value = "";
        }
      }
      operations.push({
        id: `${wrapper.id}:hyphen-across:${crossIndex++}`,
        kind: decision.verdict === "JOIN" ? "join-hyphenated-word" : "preserve-break",
        sourceIds: [before.id, wrapper.id, after.id],
        before: `${left}${hyphen}${right}`,
        after: decision.verdict === "JOIN" ? decision.joined : `${left}${hyphen}${right}`,
        evidenceIds: [`rule:${decision.rule}`, "split:inline-wrapper"],
        confidence: decision.confidence,
        status: decision.verdict === "REVIEW" ? "review" : "accepted",
        note: decision.reason,
      });
    }
  };

  const visit = (node: { kind: string; id: string; value?: string; children: unknown[] }): void => {
    // The cheap pre-filter has to admit the same shapes the cascade decides.
    // It used to require a newline after the hyphen, so a text node holding
    // `Укра-ина` was skipped before `dehyphenateText` ever saw it — the reason
    // widening the pattern alone changed nothing.
    if (node.kind === "text" && typeof node.value === "string" && HYPHEN_IN_WORD.test(node.value)) {
      const result = dehyphenateText(node.value, node.id, options);
      node.value = result.text;
      operations.push(...result.operations);
      reviews += result.reviews;
    }
    if (node.kind === "element") joinAcrossWrapper(node as TextishNode);
    for (const child of node.children) {
      visit(child as { kind: string; id: string; value?: string; children: unknown[] });
    }
  };

  visit(root as never);
  return { operations, reviews };
}

/**
 * Characters that may continue a machine identifier around the candidate.
 *
 * Whitespace and every sentence-level punctuation mark are absent on purpose:
 * they are exactly what ends the token, and the token is what has to be judged.
 */
const IDENTIFIER_CHAR = /[\p{L}\p{N}._~/@+%&=?#:-]/u;

/**
 * Does the hyphen at `[start, end)` sit inside a machine identifier?
 *
 * The evidence is **structural, not lexical** — no scheme list, no TLD list, no
 * host name appears here, so the rule holds for a `.ru` domain, a `.jpg` file
 * and a path segment alike, and degrades to `false` on anything it cannot see.
 * The token is grown outward from the candidate over identifier characters, and
 * it counts as an identifier when it carries an interior `.` between two
 * alphanumerics, or any `/`, `@`, `:` or `%`.
 *
 * Requiring the dot to be *interior* is what keeps prose out. A sentence ends in
 * a full stop and an abbreviation carries one (`г. Штут-гарте`), but neither
 * puts one *between* two alphanumeric characters of the same unbroken token, and
 * `г.` is separated from the next word by the space that stops the growth.
 */
function insideIdentifier(text: string, start: number, end: number): boolean {
  let from = start;
  while (from > 0 && IDENTIFIER_CHAR.test(text[from - 1] as string)) from -= 1;
  let to = end;
  while (to < text.length && IDENTIFIER_CHAR.test(text[to] as string)) to += 1;
  // Punctuation that merely abuts the token belongs to the sentence, not to it:
  // a trailing colon after `rendez-vous:` is not a scheme separator.
  const token = text.slice(from, to).replace(/^[._~/@+%&=?#:-]+/u, "").replace(/[._~/@+%&=?#:-]+$/u, "");
  return /[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(token) || /[/@:%]/u.test(token);
}

/**
 * Is this candidate part of a multi-hyphen token whose outer fragments are
 * title-cased? Lower-case internal linkers remain part of the same proper name.
 */
function insideProperCompound(text: string, start: number, end: number): boolean {
  let from = start;
  while (from > 0 && /[\p{L}\-‐‑­]/u.test(text[from - 1] as string)) from -= 1;
  let to = end;
  while (to < text.length && /[\p{L}\-‐‑­]/u.test(text[to] as string)) to += 1;
  const parts = text.slice(from, to).split(/[-‐‑­]/u);
  const first = parts[0];
  const last = parts.at(-1);
  return parts.length >= 3 && first !== undefined && last !== undefined && isTitleCase(first) && isTitleCase(last);
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
    const [{ default: hyphenopoly }, { readFile }] = await Promise.all([
      import("hyphenopoly"),
      import("node:fs/promises"),
    ]);
    const SENTINEL = "•";
    const configured = hyphenopoly.config({
      require: [...new Set(langs)],
      hyphen: SENTINEL,
      exceptions: {},
      loader: async (file, patternDirectory) => readFile(new URL(file, patternDirectory)),
      // Minima must be pinned: changing them silently changes which joins are
      // legal, and therefore which words the corpus ends up with.
      leftmin: 2,
      rightmin: 2,
    });
    const entries = await Promise.all(
      [...configured].map(async ([lang, promised]) => [lang, await promised] as const),
    );
    const hyphenators = new Map(entries);
    if (hyphenators.size === 0) return NULL_ORACLE;

    return {
      available: true,
      isLegalBreak(word: string, index: number, lang: string): boolean {
        const hyphenate = hyphenators.get(lang) ?? hyphenators.values().next().value;
        if (!hyphenate) return false;
        try {
          const marked = hyphenate(word.toLowerCase());
          let seen = 0;
          for (const ch of marked) {
            if (ch === SENTINEL) {
              if (seen === index) return true;
            } else {
              seen += 1;
            }
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

/**
 * Optional Hunspell dictionary used only as the second half of rule 6.
 * Absence or an unsupported language degrades to abstention, never guessing.
 */
export async function createWordDictionary(lang = "ru"): Promise<((word: string) => boolean) | undefined> {
  if (!lang.toLowerCase().startsWith("ru")) return undefined;
  try {
    const [{ default: words }, { default: nspell }] = await Promise.all([
      import("dictionary-ru"),
      import("nspell"),
    ]);
    const spell = nspell(words);
    return (word: string): boolean => spell.correct(word);
  } catch {
    return undefined;
  }
}
