/**
 * Three-way triage of an L2 finding against the **source**.
 *
 * Without this, a deep structural diff floods the ledger with work that no
 * deterministic rule may ever do. Thirteen hand-made references are not thirteen
 * mechanical transcriptions: the migrator invented headings for pages that had
 * none, replaced `"…"` with `«…»`, expanded `(1913-42)`, and in one case deleted
 * a whole table. `Biography-Markup.md` §16.3 forbids a converter from inventing
 * content, so a finding whose reference side is *not attested by the source* is
 * a ceiling, not a defect, and must be excluded from targets rather than closed.
 *
 * The test is deliberately crude and deliberately one-directional: does the text
 * the reference expects occur in the source at all? A crude attested/unattested
 * test is honest about what it measures; a clever one would quietly decide
 * questions that belong to a human.
 */

export type Backing = "source-backed" | "source-unbacked" | "ambiguous";

/**
 * A searchable model of one source document: its visible text, folded.
 *
 * Built from the decoded HTML rather than from the DOM, because the question is
 * only ever "does this string occur", and tag structure would add nothing but
 * a dependency on the front half of the pipeline.
 */
export class SourceIndex {
  private readonly folded: string;
  private readonly tokens: Set<string>;

  constructor(html: string) {
    this.folded = fold(stripTags(html));
    this.tokens = new Set(this.folded.split(" ").filter((w) => w.length > 0));
  }

  /** Whether a span occurs verbatim (folded) in the source. */
  hasSpan(value: string): boolean {
    const needle = fold(value);
    return needle.length > 0 && this.folded.includes(needle);
  }

  /** Fraction of a span's words the source attests anywhere. */
  wordCoverage(value: string): number {
    const w = fold(value).split(" ").filter((x) => x.length > 0);
    if (w.length === 0) return 1;
    let hit = 0;
    for (const token of w) if (this.tokens.has(token)) hit += 1;
    return hit / w.length;
  }
}

/**
 * Classify one finding.
 *
 * `reference === null` means the produced document invented something; that is
 * always a real defect regardless of the source, so it is source-backed by
 * definition. Everything else turns on whether the source attests the reference
 * side. The band between "verbatim" and "unattested" is `ambiguous`, which is
 * hook territory — the source says something close but not this, which is
 * exactly the shape of a copyedit.
 */
export function triage(
  referenceSpan: string | null,
  producedSpan: string | null,
  source: SourceIndex | null,
  cls: string,
  evidence: "content" | "structure" = "content",
): Backing {
  // Layout is not content. §16.3 forbids inventing *text*; it says nothing
  // about wrapping text that is already there in a `::: columns`, splitting a
  // lane, drawing a `---`, or reading a size off the geometry. Running those
  // through a text-attestation test mislabels every one of them as an
  // unreachable ceiling — which is how the first build of this instrument
  // buried `columns.missing`, the largest genuinely reachable class in the
  // corpus, in the ceiling list. Structure is always actionable.
  if (evidence === "structure") return "source-backed";

  if (source === null) return "ambiguous";
  if (referenceSpan === null) return "source-backed";

  // A typography or whitespace class can never be source-backed: the source is
  // 1998 HTML with straight quotes and hyphens, so the reference spelling is by
  // construction the migrator's, not the author's.
  if (cls.includes("typography") || cls.endsWith(".whitespace")) return "source-unbacked";

  const span = stripLabel(referenceSpan);
  if (span.trim() === "") return "ambiguous";
  if (source.hasSpan(span)) return "source-backed";

  const coverage = source.wordCoverage(span);
  if (coverage >= 0.95) return "ambiguous";
  if (coverage <= 0.5) return "source-unbacked";
  return "ambiguous";
}

/** Property findings are quoted as `key: value`; only the value is content. */
function stripLabel(span: string): string {
  const m = /^[a-z][\w-]*: ([\s\S]*)$/u.exec(span);
  return m ? (m[1] as string) : span;
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;?/giu, " ")
    .replace(/&quot;?/giu, '"')
    .replace(/&amp;?/giu, "&")
    .replace(/&laquo;?/giu, "«")
    .replace(/&raquo;?/giu, "»")
    .replace(/&#(\d+);?/gu, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;/giu, " ");
}

/**
 * Fold for attestation.
 *
 * Case, punctuation and hyphenation are folded away because none of them can
 * decide whether the *content* was present. Everything the migrator could have
 * changed cosmetically must fold; everything they could only have invented must
 * not.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/­/gu, "")
    .replace(/(\p{L})[-‐‑–—]\s*(\p{L})/gu, "$1$2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
