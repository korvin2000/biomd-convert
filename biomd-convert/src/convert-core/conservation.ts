/**
 * The conservation gate.
 *
 * Mechanizes what the existing guides ask a model to self-police. A diff cannot
 * forget under a long context, and it needs no cooperation from whatever
 * produced the output.
 *
 * This is load-bearing rather than decorative for a specific reason: the
 * consuming renderer does not render raw HTML and silently discards anything it
 * does not understand, so content lost in conversion produces no error anywhere
 * downstream. This check is the only thing that will notice.
 *
 * It is deliberately redundant with the ledger. The ledger catches omission —
 * an item nothing accounted for. This catches substitution — a pass that
 * claimed `EMITTED` and wrote the wrong thing.
 */

export interface ConservationInput {
  /** Visible text of the source content region, after boilerplate removal. */
  sourceText: string;
  /** Visible text of the emitted document. */
  outputText: string;
  /** Source targets, after the rewrite function has been applied. */
  sourceTargets: readonly string[];
  outputTargets: readonly string[];
  sourceImages: readonly string[];
  outputImages: readonly string[];
  /**
   * Content whose absence the ledger already explains.
   *
   * Removing page chrome is correct, not a conservation failure — but only
   * because something recorded a `REMOVED(reason)` for it. This is where that
   * distinction is enforced: text and targets listed here may be absent from
   * the output, and everything else may not.
   */
  accounted?: {
    text?: string;
    targets?: readonly string[];
    images?: readonly string[];
  };
}

export interface ConservationReport {
  ok: boolean;
  text: {
    recall: number;
    sourceShingles: number;
    matchedShingles: number;
    /** Shingles excused because they straddle an explicitly removed span. */
    seamShingles: number;
    /** Up to 20 examples, for the audit. */
    missingExamples: string[];
  };
  targets: MultisetDiff;
  images: MultisetDiff;
  failures: string[];
}

export interface MultisetDiff {
  ok: boolean;
  missing: string[];
  extra: string[];
}

export interface ConservationOptions {
  /** Shingle size. 5 words balances sensitivity against reordering noise. */
  shingleSize?: number;
  /** Required text recall. */
  minRecall?: number;
}

export const DEFAULT_CONSERVATION: Required<ConservationOptions> = {
  shingleSize: 5,
  minRecall: 0.995,
};

/**
 * Word shingles over normalized text.
 *
 * Normalization folds case, collapses whitespace and strips punctuation, so the
 * check survives legitimate transcription repairs — entity decoding, a
 * hyphen join, a `<br>` becoming a space — while still catching a dropped
 * sentence. Hyphens are removed rather than kept so that a de-hyphenation join
 * does not read as a missing shingle.
 */
export function shingles(text: string, size: number): Map<string, number> {
  const words = normalizeForCompare(text).split(" ").filter(Boolean);
  const out = new Map<string, number>();
  if (words.length === 0) return out;
  if (words.length < size) {
    const key = words.join(" ");
    out.set(key, 1);
    return out;
  }
  for (let i = 0; i + size <= words.length; i += 1) {
    const key = words.slice(i, i + size).join(" ");
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export function normalizeForCompare(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFC")
      // A soft hyphen is invisible and must never count as content.
      .replace(/­/gu, "")
      // Fold an intra-word hyphen *together with any whitespace after it*, so a
      // de-hyphenation join and its unjoined source compare equal: `гита- рист`,
      // `гита-рист` and `гитарист` all normalize to one token. The hyphen must
      // be flanked by letters, so a spaced dash between words (`Сеговия —
      // выдающийся`) still separates them.
      .replace(/(\p{L})[-‐‑–—][\s]*(\p{L})/gu, "$1$2")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function diffMultiset(source: readonly string[], output: readonly string[]): MultisetDiff {
  const counts = new Map<string, number>();
  for (const item of source) counts.set(item, (counts.get(item) ?? 0) + 1);
  const extra: string[] = [];
  for (const item of output) {
    const n = counts.get(item);
    if (n === undefined || n === 0) extra.push(item);
    else counts.set(item, n - 1);
  }
  const missing: string[] = [];
  for (const [item, n] of counts) for (let i = 0; i < n; i += 1) missing.push(item);
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

export function checkConservation(
  input: ConservationInput,
  options: ConservationOptions = {},
): ConservationReport {
  const size = options.shingleSize ?? DEFAULT_CONSERVATION.shingleSize;
  const minRecall = options.minRecall ?? DEFAULT_CONSERVATION.minRecall;

  const sourceShingles = shingles(input.sourceText, size);
  const outputShingles = shingles(input.outputText, size);
  // Shingles belonging to explicitly removed content are discharged rather than
  // counted as losses.
  const accountedShingles = shingles(input.accounted?.text ?? "", size);

  // Words belonging to explicitly removed content. A shingle that mixes them
  // with retained words is a *seam*: it spans the cut where the removal
  // happened and therefore cannot exist in the output, however faithful the
  // conversion was. Counting seams as losses would make the gate fail on every
  // page that has chrome — which is every page — and a gate that always fails
  // is a gate everyone learns to ignore.
  const accountedWords = new Set(normalizeForCompare(input.accounted?.text ?? "").split(" ").filter(Boolean));

  let sourceTotal = 0;
  let matched = 0;
  let seams = 0;
  const missingExamples: string[] = [];
  for (const [key, count] of sourceShingles) {
    const excused = accountedShingles.get(key) ?? 0;
    const required = Math.max(0, count - excused);
    if (required === 0) continue;

    const found = Math.min(required, outputShingles.get(key) ?? 0);
    if (found < required && key.split(" ").some((word) => accountedWords.has(word))) {
      seams += required - found;
      continue;
    }

    sourceTotal += required;
    matched += found;
    if (found < required && missingExamples.length < 20) missingExamples.push(key);
  }

  const recall = sourceTotal === 0 ? 1 : matched / sourceTotal;
  const targets = diffMultiset(
    subtract(input.sourceTargets, input.accounted?.targets ?? []),
    input.outputTargets,
  );
  const images = diffMultiset(
    subtract(input.sourceImages, input.accounted?.images ?? []),
    input.outputImages,
  );

  const failures: string[] = [];
  if (recall < minRecall) {
    failures.push(
      `Text recall ${(recall * 100).toFixed(2)}% is below the ${(minRecall * 100).toFixed(2)}% floor. ` +
        `${sourceTotal - matched} of ${sourceTotal} shingles are absent from the output.`,
    );
  }
  if (!targets.ok) {
    failures.push(
      `Target multiset differs: ${targets.missing.length} missing, ${targets.extra.length} unexpected. ` +
        `Missing: ${preview(targets.missing)}`,
    );
  }
  if (!images.ok) {
    failures.push(
      `Image multiset differs: ${images.missing.length} missing, ${images.extra.length} unexpected. ` +
        `Missing: ${preview(images.missing)}`,
    );
  }

  return {
    ok: failures.length === 0,
    text: { recall, sourceShingles: sourceTotal, matchedShingles: matched, seamShingles: seams, missingExamples },
    targets,
    images,
    failures,
  };
}

/** Multiset difference: `a` minus one occurrence per element of `b`. */
function subtract(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of b) counts.set(item, (counts.get(item) ?? 0) + 1);
  const out: string[] = [];
  for (const item of a) {
    const n = counts.get(item) ?? 0;
    if (n > 0) counts.set(item, n - 1);
    else out.push(item);
  }
  return out;
}

function preview(items: readonly string[]): string {
  const head = items.slice(0, 5).join(", ");
  return items.length > 5 ? `${head}, … (+${items.length - 5})` : head || "—";
}
