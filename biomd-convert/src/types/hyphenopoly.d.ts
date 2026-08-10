/**
 * Hyphenopoly ships no type declarations. Only the Node `config()` surface
 * used by the converter is declared here.
 * The library is used strictly as a *validity oracle* ("is this a legal break
 * point?"), never to hyphenate output, so nothing beyond this is needed.
 */
declare module "hyphenopoly" {
  type Hyphenator = (text: string) => string;

  interface HyphenopolyConfig {
    require: string[];
    hyphen?: string;
    exceptions?: Record<string, string>;
    leftmin?: number;
    rightmin?: number;
    loader: (file: string, patternDirectory: URL) => Promise<Uint8Array>;
    [key: string]: unknown;
  }

  interface Hyphenopoly {
    config(options: HyphenopolyConfig): Map<string, Promise<Hyphenator>>;
  }

  const hyphenopoly: Hyphenopoly;
  export default hyphenopoly;
}

declare module "nspell" {
  interface Dictionary {
    aff: Uint8Array;
    dic: Uint8Array;
  }

  interface SpellChecker {
    correct(word: string): boolean;
  }

  export default function nspell(dictionary: Dictionary): SpellChecker;
}
