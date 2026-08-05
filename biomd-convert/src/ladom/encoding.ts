/**
 * Byte → character decoding for legacy, mostly-Cyrillic HTML.
 *
 * The cascade is BOM → declared charset → strict UTF-8 → scored candidates.
 * A statistical detector is one signal among several, never the authority:
 * chardet confuses Windows-1251 with KOI8-R often enough that a decoded-text
 * plausibility score has to break the tie.
 *
 * Nothing here ever "repairs" mojibake because a word looks wrong. Every
 * decision, every rejected candidate and every replacement character is
 * recorded so a reviewer can see what was chosen and why.
 */
import iconv from "iconv-lite";
import chardet from "chardet";

export interface EncodingCandidate {
  codec: string;
  /** Higher is better. Composed of the penalties below. */
  score: number;
  replacementChars: number;
  controlChars: number;
  /** Fraction of letters that are Cyrillic, 0..1. */
  cyrillicRatio: number;
  /** Mean log-probability of Cyrillic letter bigrams; higher is more Russian-like. */
  bigramScore: number;
  /** Runs like "Ð¿Ñ€Ð¸" that indicate UTF-8 read as a single-byte codec. */
  mojibakeRuns: number;
}

export interface EncodingDecision {
  /** The codec actually used. */
  codec: string;
  /** Where the decision came from. */
  source: "bom" | "declared" | "utf8-strict" | "scored";
  /** Charset label found in the document, if any. */
  declared: string | null;
  /** chardet's top guess, recorded but not obeyed. */
  detected: string | null;
  /** All scored candidates, best first. Empty when an earlier stage decided. */
  candidates: EncodingCandidate[];
  /** U+FFFD count in the chosen decoding. */
  replacementChars: number;
  /** NUL bytes replaced with U+FFFD. */
  nulBytes: number;
  /** True when the margin over the runner-up was thin, or nothing was decisive. */
  uncertain: boolean;
  warnings: string[];
}

export interface DecodeResult {
  text: string;
  decision: EncodingDecision;
  /** Original byte length, for the provenance chain. */
  byteLength: number;
}

/**
 * Codecs to score when nothing authoritative is available.
 *
 * Ordered by prior likelihood for this corpus. `iso-8859-1` is deliberately
 * absent: per the HTML standard the label maps to Windows-1252, and treating it
 * otherwise silently corrupts the 0x80–0x9F range.
 */
const CANDIDATE_CODECS = ["utf-8", "windows-1251", "koi8-r", "ibm866", "windows-1252", "iso-8859-5"] as const;

const CHARSET_ALIASES: Record<string, string> = {
  "iso-8859-1": "windows-1252",
  latin1: "windows-1252",
  "us-ascii": "utf-8",
  ascii: "utf-8",
  "cp1251": "windows-1251",
  "cp-1251": "windows-1251",
  "windows1251": "windows-1251",
  "x-cp1251": "windows-1251",
  "koi8r": "koi8-r",
  "koi8-ru": "koi8-r",
  "cp866": "ibm866",
  "x-mac-cyrillic": "maccyrillic",
  "utf8": "utf-8",
};

/** Meta-charset prescan over the first 1024 bytes, per the HTML sniffing algorithm. */
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/iu;
const META_HTTP_EQUIV = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=\s*([\w.:-]+)/iu;
const XML_DECL = /^<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)["']/iu;

export function normalizeCodecLabel(label: string): string {
  const lower = label.trim().toLowerCase().replace(/^["']|["']$/gu, "");
  return CHARSET_ALIASES[lower] ?? lower;
}

/** Read a charset declaration without decoding the whole document first. */
export function sniffDeclaredCharset(bytes: Uint8Array): string | null {
  const prescan = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("latin1");
  const xml = XML_DECL.exec(prescan);
  if (xml?.[1]) return normalizeCodecLabel(xml[1]);
  const httpEquiv = META_HTTP_EQUIV.exec(prescan);
  if (httpEquiv?.[1]) return normalizeCodecLabel(httpEquiv[1]);
  const meta = META_CHARSET.exec(prescan);
  if (meta?.[1]) return normalizeCodecLabel(meta[1]);
  return null;
}

function detectBom(bytes: Uint8Array): { codec: string; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { codec: "utf-8", length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { codec: "utf-16le", length: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { codec: "utf-16be", length: 2 };
  return null;
}

/** Strict UTF-8: decode and confirm nothing became U+FFFD. */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Russian letter-bigram log-probabilities, coarse but sufficient to separate
 * Windows-1251 from KOI8-R: the same bytes decode to real words under one and
 * to consonant salad under the other.
 *
 * Values are relative weights, not a trained model — the discrimination task is
 * easy and only the ordering matters.
 */
const COMMON_RU_BIGRAMS = new Set([
  "ст", "но", "то", "на", "ен", "ов", "ни", "ра", "во", "ко", "ро", "по", "ре", "ли", "ль", "не",
  "ор", "ер", "пр", "ол", "го", "ал", "ан", "ва", "ел", "ти", "ла", "де", "ка", "ос", "ат", "ет",
  "ин", "об", "от", "та", "ль", "ые", "ый", "ой", "ая", "ии", "ия", "ль", "ем", "ит", "ес",
]);

const CYRILLIC = /[Ѐ-ӿ]/u;
const LETTER = /[\p{L}]/u;
/** UTF-8 Cyrillic misread as a single-byte codec produces these leading bytes. */
const MOJIBAKE_RUN = /[ÐÑ][-¿Ѐ-ӿ]/gu;

function scoreDecoded(codec: string, text: string): EncodingCandidate {
  let replacementChars = 0;
  let controlChars = 0;
  let letters = 0;
  let cyrillic = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === "�") replacementChars += 1;
    else if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") controlChars += 1;
    if (LETTER.test(ch)) {
      letters += 1;
      if (CYRILLIC.test(ch)) cyrillic += 1;
    }
  }

  const lower = text.toLowerCase();
  let bigramHits = 0;
  let bigramTotal = 0;
  for (let i = 0; i + 1 < lower.length; i += 1) {
    const a = lower[i] as string;
    const b = lower[i + 1] as string;
    if (!CYRILLIC.test(a) || !CYRILLIC.test(b)) continue;
    bigramTotal += 1;
    if (COMMON_RU_BIGRAMS.has(a + b)) bigramHits += 1;
  }

  const mojibakeRuns = (text.match(MOJIBAKE_RUN) ?? []).length;
  const cyrillicRatio = letters > 0 ? cyrillic / letters : 0;
  const bigramScore = bigramTotal > 0 ? bigramHits / bigramTotal : 0;

  // Penalties are absolute so a single replacement char can never be traded
  // against a better bigram score; a lossy decode is disqualifying.
  const score =
    bigramScore * 100 +
    cyrillicRatio * 20 -
    replacementChars * 50 -
    controlChars * 25 -
    mojibakeRuns * 10;

  return { codec, score, replacementChars, controlChars, cyrillicRatio, bigramScore, mojibakeRuns };
}

function decodeWith(codec: string, bytes: Uint8Array): string | null {
  if (!iconv.encodingExists(codec)) return null;
  try {
    return iconv.decode(Buffer.from(bytes), codec);
  } catch {
    return null;
  }
}

export interface DecodeOptions {
  /** Trust a declared charset without scoring alternatives. Default true. */
  trustDeclared?: boolean;
  /** Extra codecs to score, appended to the defaults. */
  extraCodecs?: readonly string[];
}

export function decodeHtml(input: Uint8Array | Buffer, options: DecodeOptions = {}): DecodeResult {
  const bytes = input instanceof Buffer ? new Uint8Array(input) : input;
  const warnings: string[] = [];
  const byteLength = bytes.length;

  // NUL bytes are never legal in HTML text and break downstream offsets if left
  // in place. Replace before decoding so offsets stay 1:1 for single-byte
  // codecs, and count them.
  let nulBytes = 0;
  for (const b of bytes) if (b === 0) nulBytes += 1;
  const scrubbed = nulBytes > 0 ? bytes.map((b) => (b === 0 ? 0x20 : b)) : bytes;
  if (nulBytes > 0) {
    warnings.push(`${nulBytes} NUL byte(s) replaced with spaces before decoding.`);
  }

  const declared = sniffDeclaredCharset(scrubbed);
  const detectedRaw = chardet.detect(Buffer.from(scrubbed.subarray(0, Math.min(scrubbed.length, 65536))));
  const detected = typeof detectedRaw === "string" ? normalizeCodecLabel(detectedRaw) : null;

  const finish = (
    codec: string,
    source: EncodingDecision["source"],
    text: string,
    candidates: EncodingCandidate[],
    uncertain: boolean,
  ): DecodeResult => {
    const replacementChars = (text.match(/�/gu) ?? []).length;
    if (replacementChars > 0) {
      warnings.push(`${replacementChars} replacement character(s) in the chosen decoding (${codec}).`);
    }
    return {
      text: normalizeNewlines(stripBom(text)),
      byteLength,
      decision: {
        codec,
        source,
        declared,
        detected,
        candidates,
        replacementChars,
        nulBytes,
        uncertain,
        warnings,
      },
    };
  };

  // 1 — BOM is authoritative.
  const bom = detectBom(scrubbed);
  if (bom) {
    const text = decodeWith(bom.codec, scrubbed.subarray(bom.length));
    if (text !== null) return finish(bom.codec, "bom", text, [], false);
    warnings.push(`BOM declared ${bom.codec} but decoding failed; falling through.`);
  }

  // 2 — a declared charset that decodes cleanly.
  if (declared && (options.trustDeclared ?? true)) {
    const text = decodeWith(declared, scrubbed);
    if (text !== null) {
      const scored = scoreDecoded(declared, text);
      // A declaration is trusted unless the result is visibly broken. Legacy
      // pages routinely declare one charset and contain another.
      if (scored.replacementChars === 0 && scored.mojibakeRuns === 0) {
        return finish(declared, "declared", text, [scored], false);
      }
      warnings.push(
        `Declared charset ${declared} produced ${scored.replacementChars} replacement char(s) and ` +
          `${scored.mojibakeRuns} mojibake run(s); scoring alternatives.`,
      );
    } else {
      warnings.push(`Declared charset ${declared} is not supported; scoring alternatives.`);
    }
  }

  // 3 — strict UTF-8.
  if (isValidUtf8(scrubbed)) {
    const text = decodeWith("utf-8", scrubbed);
    if (text !== null) {
      const scored = scoreDecoded("utf-8", text);
      // Valid UTF-8 is near-conclusive: an accidental valid-UTF-8 reading of
      // Cyrillic single-byte text is vanishingly unlikely.
      if (scored.mojibakeRuns === 0) return finish("utf-8", "utf8-strict", text, [scored], false);
      warnings.push("Bytes are valid UTF-8 but contain mojibake runs; scoring alternatives.");
    }
  }

  // 4 — score every candidate.
  const codecs = [...new Set([...CANDIDATE_CODECS, ...(options.extraCodecs ?? []), ...(declared ? [declared] : []), ...(detected ? [detected] : [])])];
  const candidates: EncodingCandidate[] = [];
  const texts = new Map<string, string>();
  for (const codec of codecs) {
    const text = decodeWith(codec, scrubbed);
    if (text === null) continue;
    texts.set(codec, text);
    candidates.push(scoreDecoded(codec, text));
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    warnings.push("No candidate codec could decode the input; falling back to windows-1252.");
    const text = decodeWith("windows-1252", scrubbed) ?? "";
    return finish("windows-1252", "scored", text, candidates, true);
  }

  const runnerUp = candidates[1];
  const margin = runnerUp ? best.score - runnerUp.score : Infinity;
  const uncertain = margin < 10;
  if (uncertain) {
    warnings.push(
      `Encoding decision is close: ${best.codec} (${best.score.toFixed(1)}) vs ` +
        `${runnerUp?.codec} (${runnerUp?.score.toFixed(1)}). Review recommended.`,
    );
  }

  return finish(best.codec, "scored", texts.get(best.codec) as string, candidates, uncertain);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Normalize to LF.
 *
 * Done before parsing so every offset downstream refers to one consistent
 * string. The original byte length is retained in the decision record; the
 * line-ending change is uniform and reversible.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}
