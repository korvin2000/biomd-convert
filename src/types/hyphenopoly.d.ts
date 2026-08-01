/**
 * Hyphenopoly ships no type declarations. Only the fraction of its surface this
 * project uses is declared here — `config()` in synchronous mode, returning
 * either a single hyphenate function or a map of them by language.
 *
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
    sync?: boolean;
    [key: string]: unknown;
  }

  export function config(options: HyphenopolyConfig): Hyphenator | Record<string, Hyphenator>;

  const _default: { config: typeof config };
  export default _default;
}
