/**
 * Corpus lexicon.
 *
 * 20 MB of Russian text from one domain contains exactly the vocabulary in play
 * — the composer names, place names and instrument terms any general dictionary
 * lacks. Built once over the whole corpus, it is the single strongest signal in
 * the de-hyphenation cascade and it costs one pass.
 */

export interface LexiconStats {
  /** Distinct surface forms. */
  words: number;
  /** Total tokens counted. */
  tokens: number;
  /** Forms that appear hyphenated somewhere in the corpus. */
  hyphenatedForms: number;
}

/** A word-frequency map plus the multiset of attested hyphenated forms. */
export class Lexicon {
  readonly #counts = new Map<string, number>();
  readonly #hyphenated = new Map<string, number>();
  #tokens = 0;

  /**
   * Tokenization is deliberately permissive about scripts and strict about
   * hyphens: a hyphenated form is recorded *both* as a whole (`из-за`) and not
   * split into parts, because splitting it would manufacture evidence that the
   * parts stand alone.
   */
  add(text: string): void {
    // Mask out line-final hyphen wraps before tokenizing. `музы-\nкант` must
    // contribute neither `музы` nor `кант`: those fragments are not words, and
    // counting them would manufacture exactly the evidence the de-hyphenation
    // cascade later consults — a lexicon teaching itself that `из` and `за`
    // stand alone is worse than an empty one.
    const masked = text.replace(/\p{L}+[-‐‑­][ \t]*\n[ \t]*\p{L}+/gu, " ");

    for (const match of masked.matchAll(WORD)) {
      const raw = match[0];
      const word = raw.toLowerCase();
      if (word.includes("-")) {
        this.#hyphenated.set(word, (this.#hyphenated.get(word) ?? 0) + 1);
        continue;
      }
      this.#counts.set(word, (this.#counts.get(word) ?? 0) + 1);
      this.#tokens += 1;
    }
  }

  /** Occurrences of an unhyphenated form. */
  count(word: string): number {
    return this.#counts.get(word.toLowerCase()) ?? 0;
  }

  /** Occurrences of a hyphenated form, exactly as written. */
  hyphenatedCount(word: string): number {
    return this.#hyphenated.get(word.toLowerCase()) ?? 0;
  }

  has(word: string): boolean {
    return this.#counts.has(word.toLowerCase());
  }

  stats(): LexiconStats {
    return { words: this.#counts.size, tokens: this.#tokens, hyphenatedForms: this.#hyphenated.size };
  }

  toJSON(): { counts: Record<string, number>; hyphenated: Record<string, number> } {
    return {
      counts: Object.fromEntries(this.#counts),
      hyphenated: Object.fromEntries(this.#hyphenated),
    };
  }

  static fromJSON(data: { counts: Record<string, number>; hyphenated: Record<string, number> }): Lexicon {
    const lex = new Lexicon();
    for (const [word, n] of Object.entries(data.counts ?? {})) lex.#counts.set(word, n);
    for (const [word, n] of Object.entries(data.hyphenated ?? {})) lex.#hyphenated.set(word, n);
    lex.#tokens = [...lex.#counts.values()].reduce((a, b) => a + b, 0);
    return lex;
  }
}

/**
 * A word is a run of letters, optionally joined by internal hyphens.
 *
 * Digits are excluded on purpose: `1958-1962` is a range, not a hyphenated
 * word, and letting it into the lexicon would pollute the hyphenated-form
 * evidence that decides real joins.
 */
const WORD = /\p{L}+(?:-\p{L}+)*/gu;
