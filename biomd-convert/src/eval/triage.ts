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
 * The objective is a valid, visually good conversion that keeps the source's
 * content and layout intent — not byte-agreement with the references. So the
 * question is not "does the produced side match the reference" but "which side
 * does the *source* support", and the test runs on **both sides**. When the
 * produced side is attested and the reference side is not, the reference is the
 * thing that moved, and reporting that as a converter defect sends a reader to
 * fix code that is already right.
 *
 * The test is deliberately crude: does the text occur in the source at all? A
 * crude attested/unattested test is honest about what it measures; a clever one
 * would quietly decide questions that belong to a human.
 */

/**
 * See `CLAUDE.md` §4. Only `converter-defect` is work.
 *
 * `triage()` never returns `acceptable-alternative`, and that is deliberate
 * rather than an omission: the verdict means "differs from the reference,
 * preserves the intent, **visually** equal or better", and a text-attestation
 * test cannot see a rendering. It is reachable only from L3 geometry or an L4
 * judgement, which is where the evidence for it lives. Returning it from here on
 * a text heuristic would be the instrument deciding a question it cannot see.
 */
export type Verdict = "converter-defect" | "acceptable-alternative" | "reference-inconsistency" | "ambiguous";

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
  private readonly emphasized: string;

  constructor(html: string) {
    this.folded = fold(stripTags(html));
    this.tokens = new Set(this.folded.split(" ").filter((w) => w.length > 0));
    this.emphasized = fold(stripTags(emphasisRuns(html)));
  }

  /**
   * Whether a span occurs inside the source's own emphasis markup.
   *
   * The one piece of *presentation* the source states outright. Everything else
   * about spelling — a dash, a quote, a case — is 1998 HTML and tells us nothing
   * about intent, but `<i>` and `<b>` are the author saying "set this apart".
   * Without this, a produced emphasis span and a reference em-dash fold to the
   * same words and no text test can say which side moved.
   */
  hasEmphasis(value: string): boolean {
    const needle = fold(value);
    return needle.length > 0 && this.emphasized.includes(needle);
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
 * Classes whose evidence is *presentational* rather than layout.
 *
 * Layout is a claim about where content sits: a lane, a wrapper, a separator, an
 * ordering. Presentation is a claim about how the same content is spelled — an
 * emphasis span, a hard break, a dash, a letter case. §16.3 constrains invented
 * text and says nothing about the former, which is why layout is actionable
 * unconditionally; the latter is exactly where the migrator's editorial choices
 * live, so it has to be attested like content.
 *
 * The distinction is not cosmetic. `goya2`'s source writes `<i>4.07</i>` at the
 * end of each track and the reference writes `— 4.07`; treating that as layout
 * reported 37 converter defects for a reference decision §16.3 forbids the
 * converter to reproduce.
 *
 * `hardbreak` only, never `break`. A hard break is a line ending inside a
 * paragraph — presentation. A *thematic* break is a separator between regions —
 * layout, and one `analyze.md` asks for by name. Matching both put all 36
 * `break.missing` findings on the ceiling, which is the opposite of true.
 *
 * `.in-break-run` is the same question one level out: one side ended a block
 * where the other ended a line. `structdiff` gives placement findings
 * `structure` evidence, which is right for a lane or a wrapper and wrong here —
 * it routed the whole class around the attestation test and reported every
 * instance as a converter defect. Measured against the sources, **all six were
 * the reference merging paragraphs the source states outright**:
 * `pavlov_azancheev` writes each address as its own `<p class="t8">`, `goya2`
 * writes the album title and its year as two `<p>`s, `williams2` puts the track
 * and its link in two `<td>`s — and the reference runs each pair together as
 * soft-wrapped lines of one paragraph. Attested, the produced side is the one
 * the source backs, and `ambiguous` is what the instrument can honestly say.
 */
const PRESENTATIONAL = /^(?:emphasis|hardbreak)\b|\.(?:typography|whitespace|case)$|\.in-break-run$/u;

/**
 * Classes that are *about* a feature {@link fold} erases.
 *
 * For these, fold-equality proves nothing — it is the very thing they report.
 * Everything else that folds equal on both sides has no content difference at
 * all, whatever the class name claims.
 */
const SPELLING = /\.(?:hyphenation(?:\.[a-z]+)?|typography(?:\.[a-z]+)?|whitespace|case)$/u;

/**
 * Classify one finding. See `CLAUDE.md` §4 for the four verdicts.
 *
 * Everything turns on which side the source attests. Both are tested, because a
 * finding where the produced side is attested and the reference side is not is a
 * statement about the *reference*, not about the converter.
 */
export function triage(
  referenceSpan: string | null,
  producedSpan: string | null,
  source: SourceIndex | null,
  cls: string,
  evidence: "content" | "structure" = "content",
): Verdict {
  // Layout is not content. §16.3 forbids inventing *text*; it says nothing
  // about wrapping text that is already there in a `::: columns`, splitting a
  // lane, drawing a `---`, or reading a size off the geometry. Running those
  // through a text-attestation test mislabels every one of them as an
  // unreachable ceiling — which is how the first build of this instrument
  // buried `columns.missing`, the largest genuinely reachable class in the
  // corpus, in the ceiling list. Layout structure is always actionable.
  if (evidence === "structure" && !PRESENTATIONAL.test(cls)) return "converter-defect";

  if (source === null) return "ambiguous";

  // A typography or whitespace class can never be a converter defect: the source
  // is 1998 HTML with straight quotes and hyphens, so the reference spelling is
  // by construction the migrator's, not the author's.
  if (cls.includes("typography") || cls.endsWith(".whitespace")) return "reference-inconsistency";

  const wanted = referenceSpan === null ? null : stripLabel(referenceSpan);
  const got = producedSpan === null ? null : stripLabel(producedSpan);
  const referenceAttested = wanted !== null && wanted.trim() !== "" && source.hasSpan(wanted);
  const producedAttested = got !== null && got.trim() !== "" && source.hasSpan(got);

  // An insertion: the reference has nothing *here*.
  //
  // `structdiff` sub-classifies these by the construct that owns the text on the
  // reference side, and that answer settles the verdict. A `.caption-echo` or a
  // `.in-nav` means the reference does hold this content — in an `::: image`
  // caption, in a menu — so emitting it as a paragraph as well is a duplication,
  // and duplication is a defect however attested the words are.
  //
  // With no such home, keeping source text is not inventing it — but neither is
  // dropping page chrome a defect, and nothing deterministic separates the two,
  // so an attested insertion is a question rather than an answer. An
  // *unattested* one is invented outright (§16.3).
  if (wanted === null) {
    if (/\.(?:caption-echo|in-[a-z]+)$/u.test(cls)) return "converter-defect";
    return producedAttested ? "ambiguous" : "converter-defect";
  }
  if (wanted.trim() === "") return "ambiguous";

  // A deletion: the produced document dropped something. Only a defect if the
  // source had it; otherwise the reference added it and §16.3 forbids following.
  if (got === null) return referenceAttested ? "converter-defect" : "reference-inconsistency";

  // Emphasis is quoted as a `strength:text` list, so it needs the source's own
  // markup rather than a prose test: `<i>4.07</i>` and `— 4.07` carry identical
  // words, and `fold()` erases the only characters that differ.
  if (cls === "emphasis.span") return triageEmphasis(wanted, got, source);

  // **Both sides carry the same content.** Whatever differs is how it is set,
  // not what it is, so no *content* class may call it a defect: a produced
  // `*4.07*` against a reference `— 4.07` is one editorial choice, not forty.
  //
  // Excluded are the classes that are *about* a feature `fold()` erases. A
  // hyphenation finding exists precisely because `классиче-ской` and
  // `классической` fold together, and swallowing it here would retire a defect
  // family `analyze.md` names by name on `barrios`.
  if (!SPELLING.test(cls) && fold(wanted) === fold(got)) return "ambiguous";

  // Hyphenation is the one family where source attestation says nothing, and
  // says it loudly. The artifact being reported is a hyphen the *source*
  // contains, so the hyphenated side is attested by construction and the joined
  // side never is — whichever side did the joining. Running it through the test
  // below therefore reports "the reference is right" every time, including the
  // 14 measured cases where the converter joined `клас-сической` correctly and
  // the reference kept the wrap.
  //
  // Direction is the only evidence available here. Keeping a hyphen the
  // reference joined is a converter defect: the reference did the work and we
  // did not. Joining one the reference kept cannot be settled without a
  // dictionary — every instance in this corpus is a correct word, but the
  // instrument cannot see that, and `ambiguous` is what verdict 4 is for.
  if (cls.endsWith(".hyphenation.unjoined")) return "converter-defect";
  if (cls.endsWith(".hyphenation.joined")) return "ambiguous";
  // Both directions in one paragraph, which means at least one hyphen the
  // reference joined and this did not. That is work, whatever else is in the
  // block — calling it ambiguous would let a real defect hide behind a correct
  // join that happens to sit in the same paragraph.
  if (cls.endsWith(".hyphenation.mixed")) return "converter-defect";

  // The two-sided question, and the reason this function was rewritten.
  // Whichever side the source supports is the side that is right.
  if (referenceAttested && !producedAttested) return "converter-defect";
  if (producedAttested && !referenceAttested) return "reference-inconsistency";
  if (referenceAttested) return "converter-defect";

  const coverage = source.wordCoverage(wanted);
  if (coverage >= 0.95) return "ambiguous";
  if (coverage <= 0.5) return "reference-inconsistency";
  return "ambiguous";
}

/**
 * Decide an emphasis difference against the source's own `<i>` / `<b>`.
 *
 * The only class where the reference and the converter can both be *right about
 * the words* and disagree about the markup, so it is the only one where "which
 * side does the source support" has to be asked of the markup rather than the
 * text. `goya2` is 25 instances of it: the source italicises each track's
 * duration and the reference rewrote every one as `— 4.07`.
 */
function triageEmphasis(wanted: string, got: string, source: SourceIndex): Verdict {
  const wantRuns = emphasisSpans(wanted);
  const gotRuns = emphasisSpans(got);
  const extra = gotRuns.filter((t) => !wantRuns.includes(t));
  const missing = wantRuns.filter((t) => !gotRuns.includes(t));

  // The source marks it and the converter dropped it: a real loss.
  if (missing.length > 0 && missing.every((t) => source.hasEmphasis(t))) return "converter-defect";
  // The converter marks what the source does not: invention, and always work.
  if (extra.length > 0 && !extra.every((t) => source.hasEmphasis(t))) return "converter-defect";
  // The converter kept what the author set apart; the reference chose otherwise.
  if (extra.length > 0) return "reference-inconsistency";
  // The reference added emphasis the source never had.
  if (missing.length > 0) return "reference-inconsistency";
  return "ambiguous";
}

/** `em:4.07 · strong:Title` → `["4.07", "Title"]`. `(none)` yields nothing. */
function emphasisSpans(quoted: string): string[] {
  if (quoted.trim() === "" || quoted === "(none)") return [];
  return quoted
    .split(" · ")
    .map((run) => run.replace(/^(?:em|strong):/u, "").trim())
    .filter((t) => t.length > 0);
}

/** The text inside the source's emphasis markup, tags and all. */
function emphasisRuns(html: string): string {
  const runs: string[] = [];
  const re = /<(i|em|b|strong)\b[^>]*>([\s\S]*?)<\/\1>/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) runs.push(m[2] as string);
  return runs.join("  ");
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
