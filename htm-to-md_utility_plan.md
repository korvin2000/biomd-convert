# HTML → BioMD conversion utility — final implementation plan

**Working name:** `biomd-convert`
**Status:** consolidated implementation plan — supersedes `htm-to-md_utility_plan_A.md` and `htm-to-md_utility_plan_B.md`
**Corpus target:** ~1 000 files / ~20 MB, mostly Russian legacy HTML (abc-guitars.com / *«Гитаристы и композиторы»*)
**Normative output contract:** [`BioMD-Reference.md`](BioMD-Reference.md) — BioMD Lite
**Policy inputs:** [`html-to-biomd_guide.md`](html-to-biomd_guide.md), [`html-to-biomd_ext_guide.md`](html-to-biomd_ext_guide.md)
**Date:** 2026-07-31

---

## 0. What this document is

Plans A and B were written against the same requirements and reached the same broad conclusion —
*build a compiler with a typed intermediate representation, not an HTML-to-Markdown converter* — but
disagreed on roughly a dozen concrete points, several of them consequential. This document is the
merge: **Plan B's architecture as the base, Plan A's engineering discipline layered onto it**, with
every conflict resolved explicitly in §1 and four product decisions confirmed with the user before
drafting.

It also does something neither input plan did: **§15 assesses whether this is actually buildable**,
names what to cut, and gives an honest verdict on the parts most likely to fail.

### Decisions locked before drafting

| # | Decision | Effect |
|---|---|---|
| 1 | `layoutFidelity: simplified` is the default | Presentational lanes collapse to linear flow; spec §10's lane-preservation clause becomes profile-dependent (§7.3) |
| 2 | Repaired + sanitized HTML is a retained deliverable; **no v.Nu** | Three honest validity levels, no Java dependency (§5 Stage 2, §10.6) |
| 3 | Live render check is **optional, never a gate** | Converter acceptance ends at BioMD validation; the renderer is never an operational dependency (§10.5) |
| 4 | Converter **never emits** `divider`, `::: frame`, `::: signature` | Serializer downgrades deterministically against the renderer that exists today (§12.3) |
| 5 | All model calls go through an **independent LLM gateway**, never a provider API directly | OpenAI-compatible transport behind the existing `LlmClient` interface; two hard rules on transport transparency and model pinning (§9.2) |

---

## 1. Evaluation of the two plans

### 1.1 Where they agree — adopted without further argument

Both plans independently reached these conclusions, which is the strongest evidence available that
they are right:

- The core must be a **typed intermediate representation**, not a node-by-node HTML→Markdown
  serializer. Turndown, breakdance, mdream, get-md and both `html-to-markdown` implementations are
  rejected as the core for the same reason: they are element-local, and this problem is not.
- **HTML5 tree construction is the repair specification.** parse5 is the canonical parser; HTML Tidy
  is at most a gated fallback because it reformats toward a doctype and can destroy the legacy
  presentational evidence the pipeline exists to read.
- The **LLM must never emit BioMD text.** It returns typed decisions/operations; a deterministic
  serializer owns every `:::`, every property line, every escape.
- **Layout tables must be classified, not transcribed** — SHELL / LAYOUT / DATA / HYBRID, with
  `rowspan`/`colspan` expanded into a real occupancy grid before any decision.
- **Classic Markdown tables are preferred** for genuine record matrices; `columns` is reserved for
  true parallelism and is not a width-imitation device.
- **Conservation is mechanical**, not a checklist item: nothing may disappear because a model omitted
  it.
- **Cost scales with ambiguity classes, not file count.** Deterministic-first, corpus clustering,
  compact payloads, caching, batching, hard budgets.
- **Hyphenation libraries solve the forward problem.** None de-hyphenates; they are a validity oracle
  inside a decision cascade.
- **TypeScript / Node**, chosen on the converter's own merits, with Python acknowledged as equally
  viable. Renderer technology is irrelevant to this choice.
- The existing guides encode real domain knowledge in the wrong *form*; they become code, profile
  data, fixtures and prompts.

### 1.2 Where they conflict — resolutions

| # | Question | Plan A | Plan B | Resolution | Why |
|---|---|---|---|---|---|
| 1 | **Browser measurement** | Optional; only for ambiguous layouts | Always, every page; the central innovation | **B** | Circular otherwise: you need geometry to know whether a page *is* ambiguous. Tier-1 gates ("measured width ratio 0.45–0.55"), de-hyphenation rule 2, visibility and block segmentation all require it. ~10 min for the whole corpus, cached by content hash. A's `--visual never\|auto\|always` escape hatch is kept for fast CI runs |
| 2 | **Renderer engagement** | Out of scope entirely; no renderer facts in the converter | Read the parser; encode its real behavior | **B on substance, A on framing** | A conflates *implementation coupling* (correctly forbidden) with *format contract* (unavoidable). The output format's real grammar is defined by the one program that reads it. Emitting `divider: true` per spec **corrupts the page** — that is a fact about the artifact, not a dependency. Resolution: static conformance fixtures (portable data, no coupling) + A's rule that no gate may require a renderer process |
| 3 | **HTML validity claim** | Four levels, v.Nu-gated `conforming-clean-html` | Silent — parse5 parsed it, move on | **A's taxonomy, without v.Nu** (user decision 2) | A is right that "the parser accepted it" ≠ "valid HTML", and step 1 was named as a deliverable. v.Nu adds a Java dependency for a claim nothing downstream consumes. Three levels: `decoded` → `structurally-repaired` → `sanitized-content` |
| 4 | **PHP / server islands** | php-parser lexer; replace with **offset-preserving** inert space | Strip; keep raw text in IR | **A** | Decisive detail B missed: deleting spans before parsing invalidates every subsequent `sourceCodeLocation` offset, and B's entire provenance story rests on those offsets. Same-length, same-newline-count replacement is nearly free and strictly better. (A bounded scanner suffices; php-parser is an optional upgrade) |
| 5 | **Text edits** | `TextOperation` ledger; immutable `rawText`, derived `normalizedText`, status lifecycle | `TextPatch` with category + editorial allowlist | **Merge, A-shaped** | Same idea. A's raw/normalized split and `proposed\|accepted\|review\|rejected` lifecycle make review natural; B's category enum drives the editorial policy gate and its post-check ("only patched spans differ") is a real invariant. Take all three |
| 6 | **Hyphenation engine** | `ytiurin/hyphen` (`hyphen/ru`) | Hyphenopoly (verified `ru`/`uk`/`de`/`en-us`) | **B, with A's discipline** | A's objection (WASM packaging) is thin — `hyphenopoly.module.js` loads patterns itself. A's *versioning* requirement is excellent and adopted verbatim: pin engine version, pattern hash, left/right minima, exception-list version. The choice sits behind a 1-method interface, so it is cheap to reverse |
| 7 | **Reading order** | Constraint graph; LLM may only add/remove edges | Recursive XY-cut over measured boxes | **Both — they are different layers** | XY-cut (needs B's geometry) produces the *default order*; A's constraint graph is how it is *represented and adjudicated*, and A's insight — never ask a model for a reordered document, ask for edges — is the safer contract. Cycles → review |
| 8 | **LLM contract** | Ajv-validated operations over stable IDs; ID-existence, precondition, post-patch conservation checks | Typed `Hook<>` with deterministic default, versioning, caching, model tiers, budgets | **Merge cleanly** | B's hook interface is what makes "LLM hooks / interception" a real API — an explicit user requirement. A's validator pipeline is what makes it *safe*. They compose: B's interface, A's `validate()` + apply path |
| 9 | **Cost control** | Dry-run estimate, hard `--max-calls`/`--max-cost`, transactional budget reservation | Prompt caching, Batch API, item batching, per-family recipes, Green/Amber/Red lanes | **Both** | B has the levers, A has the brakes. A budget that is estimated but not *enforced* is a wish. A's "don't batch" list (no mixed schemas, no cross-item refs, no truncation risk) is adopted verbatim |
| 10 | **Artifacts / resumability** | Numbered job dir, parent-hash chain, stage cacheable only on hash match, SQLite index | `*.ir.json` + decision cache, sketchy | **A**, trimmed | This is the operational backbone of a 1 000-file resumable batch. A's model is right; its nine stage directories are more than needed at MVP (§13.1). SQLite deferred — JSONL + in-memory index handles 1 000 files |
| 11 | **Conservation** | Ledger: every source item in exactly one terminal state | Shingle recall ≥ 0.995 + link/image multisets | **Both — they catch different bugs** | The ledger is the structural invariant (nothing lost by omission); the shingle diff is the independent detector that needs no cooperation from the emitter and catches a pass that marks `EMITTED` but writes the wrong text |
| 12 | **Simplification** | Principle only ("penalize unnecessary directive count") | `layoutFidelity` knob + CI-enforceable complexity budget | **B** | B's is measurable and therefore real. A's "every simplification still needs source coverage" is the right guard rail and is kept |
| 13 | **Schema tooling** | JSON Schema + Ajv as the portable contract | Zod → JSON Schema for tool use | **Zod as source, JSON Schema as output** | One definition drives static types, tool-use schema and runtime validation; emitting JSON Schema for the *persisted* artifact contracts keeps A's portability and cross-language readability. Best of both, no drift |
| 14 | **CSS handling** | PostCSS to parse stylesheets | Computed styles from Chromium | **B — and this removes a dependency** | A consequence of always-on measurement: `getComputedStyle` resolves `<font>`, `<center>`, `align=`, inline styles, stylesheet rules and UA defaults in one step. PostCSS survives only if rule-level attribution is ever needed for audit; not in MVP |
| 15 | **Roadmap** | 6 phases with rigorous exit criteria + a first vertical slice | 9 milestones with time estimates and two ordering constraints | **Merge** | B's ordering constraints are load-bearing (geometry before LLM design; measure `Green%` before committing budget). A's exit criteria and its **first vertical slice** (§14.2) are the best thing in either roadmap and B lacks the slice entirely |

### 1.3 On the plans as documents

**Plan A** is the better-engineered document. Its provenance model, artifact chain, validity
taxonomy, risk table and test taxonomy are more rigorous, and its prose is more disciplined about
distinguishing evidence from decision from serialization. Its principal weakness is that it treats
the single highest-leverage capability — measurement — as optional, which quietly leaves the
originally-reported failure unaddressed on the default path.

**Plan B** is the better-diagnosed document. F1–F6 correctly identify *why* the current approach
fails, the cost analysis is arithmetic rather than assertion, and it is the only one of the two that
went and read the code that will actually consume the output. Its weakness is operational thinness —
resumability, budget enforcement, offset preservation and failure isolation are gestured at rather
than designed.

**Code quality.** A's `SourceRef` / `Evidence` / `Decision` / `IrNode` split is cleaner than B's flat
`IrItem` — separating evidence from decision structurally is exactly the discipline the system needs,
and it makes the "may an LLM change this?" question answerable by type. B's `BiomdDirective`
discriminated union is the better *output* AST: it encodes spec §4.1's content model directly in the
types, so `columns` holding anything but `column` is a compile error rather than a lint. §6 takes
A's node shape and B's directive union.

**Spec compatibility.** Both are compatible with `BioMD-Reference.md` and both correctly
implement §16.2's four-way classification and §3.8's table rules. B is the only one that identified
the two real compatibility hazards: spec §10's lane mandate conflicting with a simplification policy,
and the divergence between the spec and the renderer that implements it. A is the only one that
insisted on an explicit `unrepresentable → review` outcome instead of forcing every source into the
nearest directive — a rule §7.4 adopts.

---

## 2. Requirements → where each is satisfied

| # | Requirement | Section |
|---|---|---|
| — | Malformed HTML → valid HTML (step 1) | §5 Stage 2; validity levels §10.6 |
| — | Valid HTML → `.bio.md` (step 2) | §5 Stages 3–12 |
| — | LLM hooks / interception controlling structure, layout and text | §9 |
| — | Failure on tables and complex layout | §5 Stage 3 + §7 |
| 1 | ~1 000 files / 20 MB | §3.2, §9.6, §13 |
| 2 | Strip scripts, `<head>`, PHP, clutter | §5 Stage 2b (S1/S2 split) |
| 3 | Cost control — not 1 000 calls | §9.6–9.7 |
| 4 | Renderer tech must not affect converter tech | §11.1, §12 preamble |
| 5 | Explain stack decisions | §11 |
| 6 | Classic Markdown tables where advantageous | §7.4 |
| 7 | Output need not mirror HTML 1:1 | §7.5 |
| 8 | De-hyphenation for Russian and English | §8 |
| 9 | Feasibility / over-engineering assessment | §15 |

---

## 3. The design in one page

### 3.1 What changes

The current system asks a language model to *mentally execute a browser layout engine* over tens of
thousands of tokens of `<table><font>` soup, and then to hand-write a constrained language as free
text. Both are architectural mistakes, and they have a single fix:

1. **Measure the layout instead of inferring it.** Render every page in headless Chromium; read back
   real box geometry and resolved computed styles. Legacy layout tables were authored *for a
   browser* — use one. The hardest guessing problem becomes a lookup.
2. **Give the model decisions, not documents.** Compact geometry-annotated block outlines plus, for
   ambiguous regions, a cropped screenshot. It returns typed operations against stable IDs; a
   deterministic serializer owns all syntax.
3. **Make invalid output unrepresentable.** The spec's content model lives in the type system, not in
   a post-hoc checklist.
4. **Verify mechanically.** Ledger totality + shingle/link/image conservation + complexity budget.
   Anything dropped carries an explicit `REMOVE(reason)`.
5. **Buy the expensive resource with the cheap one.** CPU is free at 20 MB; model calls are not.
   Every stage that replaces a judgment with a computation — measurement, corpus statistics, lexicon
   lookup, template clustering — is a permanent cost reduction *and* a reliability improvement. They
   are the same lever.

### 3.2 What the scale figure settles

20 KB/page × 1 000 pages is small by every measure that matters:

| Consequence | Because |
|---|---|
| **Throughput is not a stack-selection criterion** | The corpus fits in memory; parsing is milliseconds. This settles parse5-vs-tag-soup: a 5× parse speedup is worth nothing, missing tree construction is fatal |
| **Rendering every page is affordable** | ~1 000 × 0.3–0.6 s ≈ 5–10 min, once, cached by content hash |
| **Retaining everything is affordable** | Full IR, screenshots, per-decision provenance for every page |
| **LLM calls are the binding constraint** | 1 000 full-context calls is slow, expensive, and mostly wasted on pages a script converts perfectly |

### 3.3 Flow

```text
original bytes (immutable)
  → decoded text + encoding report            [Stage 1]
  → PHP/exec quarantine → parse5 hast + offsets → S1 behavior strip   [Stage 2]
  → Chromium geometry + computed styles + screenshots → LADOM         [Stage 3]
  → grid materialization, spacer/wrapper folding                       [Stage 4]
  → S2 chrome strip (corpus model + geometry)                          [Stage 5]
  → visual block segmentation                                          [Stage 6]
  → table classification (4-tier cascade)                              [Stage 7]
  → region roles                                                       [Stage 8]
  → structure recovery + reading-order constraint graph                [Stage 9]
  → text reconstruction + de-hyphenation (TextOperation ledger)        [Stage 10]
  → deterministic rewrites (link policy, paths)                        [Stage 11]
  → BioMD AST → simplification passes → serializer                     [Stage 12]
  → verify: ledger · conservation · grammar · complexity               [Stage 13]
  → bounded repair loop                                                [Stage 14]
```

---

## 4. Principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Measure, don't infer** | Chromium supplies boxes and computed styles for every page |
| P2 | **Separate evidence / decision / serialization** | An LLM may change only the middle layer, and only through validated operations |
| P3 | **Determinism first, LLM last** | Every pass has a deterministic default; the model sees only the uncertainty band |
| P4 | **Make invalid states unrepresentable** | Content model in types and constructors, not in a checklist |
| P5 | **Provenance is total** | Every source item ends in exactly one terminal state; enforced by the pass framework (§6.4), not by discipline |
| P6 | **Conservation is a gate, not a hope** | Mechanical diff, hard-fail |
| P7 | **The original is authoritative** | Immutable bytes; repaired HTML is an *interpretation*, never an overwrite |
| P8 | **Corpus is a first-class input** | Boilerplate, geometry statistics and schemas are computed, not hardcoded |
| P9 | **Profiles specialize; they never fork the engine** | ABC specifics are versioned data |
| P10 | **Prefer the simplest representation that preserves meaning** | Output is a document, not a cast of a 2003 table skeleton |
| P11 | **Converter and renderer are independent** | No renderer import, no renderer process in any gate. The *format contract* is static fixture data |
| P12 | **Every decision is addressable, cached, replayable** | Content-hash keyed store; re-runs are free and byte-identical |

---

## 5. Pipeline

### Stage 0 — Corpus pass (once, incremental, no LLM)

Produces `corpus-profile.json`. The cheapest high-leverage stage in the system: every product
converts a recurring model judgment into a lookup.

- **Structural fingerprinting** — `tag-path + attribute skeleton + normalized-text SimHash` per
  subtree. Subtrees recurring on > *N* % of pages with near-identical text are chrome candidates.
  Replaces the hardcoded `album.gif` / `gk.gif` / `topmenu()` list with evidence.
- **Page-family clustering** — cluster whole pages (biography, roster, news, catalog, discography,
  gallery…). Drives triage lanes and, if families prove tight, per-family recipes (§9.6a).
- **Geometry statistics** — histogram of rendered content-column widths. The guides' "central cell
  ≈ 529 px / rails ≈ 116/115 px" should *fall out of this histogram*, not be typed into prose.
- **Table schema mining** — cluster tables by column count + per-column content-kind profile.
  Recurring clusters become named schemas that hand the DATA pass ready-made headers.
- **Corpus lexicon** — word-frequency map over all decoded text plus the multiset of hyphenated
  forms. 20 MB of single-domain Russian contains exactly the composer names, place names and
  instrument vocabulary a general dictionary lacks. Retires most de-hyphenation ambiguity (§8).
- **Asset & link graph** — every `src`/`href` resolved and classified; missing-asset inventory;
  page graph for nav detection.
- **Encoding survey** — declared vs detected charset per file, so batch anomalies surface up front.

Stage 0 depends on Stage 3 for geometry, so the first corpus pass runs decode → parse → measure for
all files, then aggregates. Both halves are cached by content hash.

### Stage 1 — Ingest (deterministic)

Port the guides' decode cascade unchanged — it is already good:

```text
BOM → recognized HTML meta / XML charset → strict UTF-8
    → scored { UTF-16LE/BE, Windows-1251, Windows-1252, KOI8-R, IBM866, Latin-* } fallback
```

Score each *decoded candidate*: replacement chars, control chars, NULs, invalid round-trips,
mixed-script mojibake, Cyrillic plausibility (letter-bigram frequency tuned on the corpus).
`iso-8859-1` label ⇒ treat as Windows-1252. NUL ⇒ `U+FFFD`, audited. Never abort a batch; emit
`encoding_uncertain` with declared/chosen codec and counts.

**Never repair mojibake because a word "looks wrong".** Record the declared label, detector rankings,
chosen codec, scores and every replacement.

Build a sparse **source map** from decoded-string offsets back to original byte ranges. Parser offsets
refer to the decoded string and must never be mislabeled as byte offsets — the distinction matters
for multibyte UTF-8 and single-byte Cyrillic alike.

Libraries: `chardet` (one scored signal, not the authority) + `iconv-lite` + custom scorer.

### Stage 2 — Repair and sanitize (deterministic)

#### 2a. Quarantine and parse

1. **Scan for server-side islands before parsing**: `<?php … ?>`, `<? … ?>`, `<?= … ?>`, ASP
   `<% … %>`, SSI `<!--#include -->` / `<!--#exec -->`. Replace each span with **inert whitespace of
   identical length and identical newline count**, recording the raw text and span in IR.

   > This is the detail that makes provenance work. Deleting these spans shifts every subsequent
   > `sourceCodeLocation` offset and silently corrupts the audit trail. Do not confuse an XML
   > declaration with a PHP short tag. A malformed/unclosed island becomes review data and is never
   > passed through as article text. A bounded state-machine scanner suffices; `php-parser` in
   > lexer-only mode is an optional upgrade if the corpus proves it necessary.

2. **Parse with parse5** (`scriptingEnabled: false`, parse-error collection, `sourceCodeLocation:
   true`) → **hast** with byte offsets.

3. **Assign stable node IDs.** Mark implied/reconstructed nodes as *synthetic* and retain the parse
   error that produced them.

**HTML Tidy is not in the default path.** The HTML5 parsing algorithm *is* a normative error-recovery
specification — implied end tags, foster parenting of misnested table content, the adoption agency
algorithm. That *is* "malformed → valid", performed by the same code path as the era's target
renderer. Tidy is a different operation: it reformats and cleans toward a doctype and can restructure
or drop proprietary constructs, i.e. destroy the legacy evidence this pipeline reads. Keep it as a
**gated WASM fallback** invoked only on catastrophic recovery (`<frameset>`, binary garbage, > X %
foster-parented), always behind a content-conservation diff.

`<frameset>` pages: detect, convert each frame document independently, record the frame graph.
`document.write` menus stay unexecuted — they are chrome, and the fact is recorded.

#### 2b. Sanitize — two phases, and the ordering is load-bearing

Stage 3 measures the *rendered* page. Anything removed before rendering that had visual extent
silently changes the geometry the entire design depends on. So:

```text
decode → harvest <head> → S1 (behavior strip) → render + measure → S2 (chrome strip, Stage 5)
```

**Head harvesting, before `<head>` is discarded:**

| Harvested | Use |
|---|---|
| `<meta charset>` / XML decl | consumed in Stage 1 |
| `<style>`, local `<link rel=stylesheet>` | **retained for the render pass only**; dropped from content IR afterwards |
| `<base href>` | affects target resolution; honoured by the link policy (§5 Stage 11) |
| `<title>` | recorded as provenance and **explicitly excluded from article-title candidates** — both guides are emphatic that the repeated site title is never the article title |

**S1 — pre-render strip (behavior only, layout-preserving):**

| Removed | Recorded |
|---|---|
| `<script>`, `<noscript>` bodies | count |
| `on*` attributes | count |
| `javascript:` / `vbscript:` / `data:text/html` targets | `target_dropped` |
| Quarantined PHP/ASP/SSI spans (already inert) | raw text in IR |
| `<meta http-equiv=refresh>`, remaining `<meta>` | after charset harvest |
| `<applet>`, `<object>`, `<embed>` | `src`/`data` preserved as a target record |
| `<form>`, `<input>`, `<select>`, `<button>` | flagged; removed only once boilerplate-confirmed |
| 1×1 / zero-area images, known counter hosts | yes |
| HTML comments | **kept in IR** — legacy comments occasionally hold real content, and conditional comments can hold live markup |

Everything with visual extent — all body markup, `width`/`height`/`align`/`bgcolor`/`border`,
`<font>`, inline `style`, spacer cells — **survives S1 untouched**. It is not clutter at this stage;
it is the evidence. It is discarded in Stage 4 and Stage 5, *after* measurement.

> **Implementation warning.** Do not use `rehype-sanitize` with its default schema. It is designed to
> make untrusted HTML safe for re-display and strips precisely the presentational attributes this
> pipeline exists to read. Use a custom hast visitor with an explicit denylist. Getting this wrong
> produces a pipeline that runs cleanly and quietly loses every layout signal.
>
> A tailored `hast-util-sanitize` schema is still worth running as a **final security backstop** after
> S2, then reparsing and reconciling retained text/targets/media against the removal ledger.

**Deliverable (user decision 2):** `repaired.html` (post-parse5, post-quarantine, UTF-8, normalized
line endings) and `clean-body.html` (post-S2 content fragment, no `<head>`) are written per file and
retained. Validity levels in §10.6.

At 20 MB total this is seconds of work for the whole corpus.

### Stage 3 — Measure (deterministic; the central capability)

Load the *repaired* HTML into Playwright/Chromium and read the layout back.

Captured per element: stable node path matched to the hast tree · `{x, y, w, h}` · computed-style
subset (`display, position, float, textAlign, verticalAlign, fontSize, fontWeight, fontStyle, color,
backgroundColor, backgroundImage, border*, padding*, margin*, whiteSpace, overflow`) · visibility
(area > 0, not `display:none`/`visibility:hidden`, not clipped, not a 1×1 spacer) · text length, link
count, image count, intrinsic image dimensions. Plus a full-page screenshot and a crop per candidate
region.

The computed-style subset resolves `<font>`, `<center>`, `align=`, inline styles, stylesheet rules and
UA defaults in one step — which is exactly the "inventory CSS class usage" work spec §16 asks for by
hand, and why PostCSS is not needed (§1.2 row 14).

**Deterministic rendering contract** — geometry must be reproducible or golden tests become flaky:

- pinned Playwright/Chromium version;
- fixed viewport `1024 × 768`, `deviceScaleFactor: 1` (the era's design target); also render at
  `390` for the responsive check;
- bundled pinned font set with Cyrillic coverage; `--font-render-hinting=none`; system font fallback
  disabled; `--disable-lcd-text`; animations off;
- **fully offline** — route interception serves assets from the local corpus root; all external
  requests aborted; JavaScript disabled; service workers blocked;
- **missing images** get a synthesized placeholder honouring the element's `width`/`height` (or a
  recorded intrinsic size from the asset index), so boxes stay plausible; each substitution recorded
  as `asset_missing` and never leaked into output;
- hard time, memory and document-size limits; one browser process, isolated contexts, pooled.

Output: **LADOM** (§6.1), cached by content hash.

`--visual never|auto|always` remains available for fast CI runs; `always` is the default.

> This stage removes the guesswork behind two-column catalogs, split track grids, side rails,
> bordered notice regions, alignment evidence, floated portraits and shell-vs-content — i.e. every
> failure reported.

### Stage 4 — Normalize (deterministic)

- **Table grid materialization.** Expand `rowspan`/`colspan` into a real *r × c* occupancy matrix per
  the HTML table model, distinguishing origin cells from covered slots. After this, "same source
  row", "equal cells", "column N" are index lookups. Clamp absurd span values and record the clamp.
  **Never copy a spanned cell's content as if the source repeated it.**
- **Presentational folding.** `<font>`, `<center>`, `align=`, `<b>`/`<i>` → style evidence on the
  node; the tags stop being load-bearing.
- **Spacer and ornament removal** — zero-area nodes, 1×1 GIFs, `&nbsp;`-only cells, empty paragraphs
  — with a ledger record, never silently.
- **Wrapper unwrapping** — a 1×1 borderless table with no background is a wrapper.
- **Entity decoding exactly once** (carry over the guides' double-decoding warning).
- **Whitespace normalization** per CSS `white-space` semantics, preserving block boundaries.

### Stage 5 — Boilerplate removal (S2)

Corpus template model + per-page geometry (rails, header/footer bands, repeated blocks).

Preserve the spec's rule (§16.4): **a side rail is not automatically chrome.** A rail region is
removed only if *every* subtree in it is corpus-repeated; any non-repeated, content-bearing subtree
inside a rail is retained and marked `rail_exception` for relocation in Stage 9.

Generic extractors (Readability, Defuddle) may **nominate** regions and produce advisory masks; they
may never delete. Defuddle is the more interesting of the two here because it records its removals
and removes fewer uncertain elements — but its small-image, hidden-element and sidebar defaults
conflict directly with BioMD's preservation requirements.

### Stage 6 — Block segmentation

Convert LADOM into a linear sequence of **visual blocks** — VIPS-style segmentation informed by real
geometry: separators, background/border changes, whitespace gutters, font-size steps. Each block
carries geometry, style summary, text preview and provenance.

This is the unit the LLM reasons about: typically 20–80 blocks per page instead of 40 000 tokens of
markup.

### Stage 7 — Table classification

Four-tier confidence cascade. See §7.

### Stage 8 — Region roles

Assign each block a role: `title | subtitle | lead | section-heading | prose | quote |
secondary-note | list | table-data | catalog | gallery | figure | nav | notice-region | signature |
footnote-def | chrome`. Deterministic where evidence is decisive (a `<th>` grid; the largest
font-size run near the top; a bordered region containing in-memoriam wording); hook adjudication
otherwise.

### Stage 9 — Structure recovery

Per region, produce IR nodes:

- **DATA table** → records + semantic headers seeded from the mined corpus schema; continuation-row
  merging with ownership proof (spec §3.8); `—` for intentionally empty.
- **LAYOUT table** → flow / `image` / `images` / `columns` / `nav`, with reading order from geometry.
- **Two-column catalog / split track grid** → lane assignment from *measured* cell x-ranges and
  recurrence, not from a width attribute. Under `simplified` (§7.5) most of these flatten.
- **Media binding** → image ↔ caption ↔ enclosing link ↔ accompanying paragraph; `position`/`size`
  from measured float and relative footprint (a portrait occupying 18 % of content width is
  `medium`; a 40 px badge is `small`).
- **Nav detection** → link density + geometry + corpus link-graph evidence.
- **Notice regions** → bordered region + wording + contained media. Since `::: frame` is not emitted
  (§12.3), these degrade to a heading + blockquote or a plain section, recorded as such.

**Reading order as constraints, never as a rewritten document.** Recursive XY-cut over measured boxes
produces the default order; it is expressed as a constraint graph:

- source order supplies default edges; caption stays attached to its image; a floated image precedes
  its related paragraph; a section nav precedes what it controls; each parallel group keeps internal
  order; unrelated regions keep source order.
- Hooks and humans may only **add or remove narrowly-scoped edges**. A stable topological sort
  produces the final order; cycles become review items.

### Stage 10 — Text reconstruction

See §8.

### Stage 11 — Deterministic rewrites

- **Link/target policy** as a pure function from the profile (the guides' §9 / B7 rule), unit-tested
  against the guide's own example table, which becomes a fixture file verbatim.
- Path rebasing against the configured resource base (spec §15).
- Ordered-list marker handling per decision C2 (§12.6).
- **Never probe, fetch, validate or repair a target** — carried over verbatim.
- Targets live in a **symbol table**. A model refers to a `targetId`; it never retypes a URL. Only a
  deterministic profile rule may rewrite a value.

### Stage 12 — Lower and serialize

Approved decisions → BioMD AST → simplification passes (§7.5) → deterministic serializer. Single
owner of all syntax. See §6.3.

### Stage 13 — Verify

See §10.

### Stage 14 — Bounded repair loop

Validator findings → a targeted `repair` hook that patches the **AST**, never the text → re-verify.
Maximum two iterations; unresolved findings become `REVIEW`. Never silently rewrite.

---

## 6. Core data structures

### 6.1 LADOM — Layout-Annotated DOM

```ts
interface LadomNode {
  id: NodePath;                       // stable; matches hast and Chromium
  tag: string;
  attrs: Record<string, string>;
  src: { decodedStart: number; decodedEnd: number; byteStart?: number; byteEnd?: number };
  synthetic: boolean;                 // parser-implied, not source-backed
  box: { x: number; y: number; w: number; h: number };
  style: ResolvedStyle;
  visible: boolean;
  metrics: { textLen: number; links: number; images: number; depth: number };
  grid?: { row: number; col: number; rowSpan: number; colSpan: number; isOrigin: boolean };
  corpus?: { fingerprint: string; frequency: number };   // 0..1 across corpus
  children: LadomNode[];
}
```

### 6.2 Semantic IR — evidence, decision and content kept apart

Plan A's separation, which makes "may an LLM change this?" answerable by type:

```ts
interface Evidence {                     // never writable by a hook
  source: NodePath[];
  attributes: Record<string, string>;
  geometry: Box;
  style: StyleSummary;
  detectorSignals: Signal[];
  classifierScores?: Record<string, number>;
  screenshotCrop?: string;
}

interface Decision {                     // the only hook-writable layer
  state: 'undecided' | 'KEEP' | 'TRANSFORM' | 'MERGE' | 'MOVE' | 'REMOVE' | 'REVIEW';
  role?: SemanticRole;
  confidence: number;
  decidedBy: 'rule' | 'profile' | 'classifier' | `llm:${string}` | 'human';
  rationale?: EvidenceRef[];
  reason?: string;                       // required when state is REMOVE or REVIEW
}

interface IrNode {
  id: string;
  kind: IrKind;                          // region | text-run | break-run | heading-candidate | …
  rawText?: string;                      // immutable
  normalizedText?: string;               // derived from accepted TextOperations only
  targetIds?: string[];                  // symbol-table refs, never literal URLs
  children: string[];
  relations: Relation[];                 // caption-of | click-target-of | floats-beside |
                                         // parallel-with | continues | belongs-to | …
  evidence: Evidence;
  decision: Decision;
}
```

### 6.3 BioMD AST and serializer

Plan B's discriminated union — the spec's content model encoded in the types:

```ts
type BiomdDirective =
  | { type:'biomdLead';   children: BlockContent[] }
  | { type:'biomdAlign';  position:'left'|'center'|'right'; children: BoundedContent[] }
  | { type:'biomdImage';  src:string; position?:Pos; size?:Size;
      alt?:string; caption?:string; link?:string; frame?:PictureFrame }
  | { type:'biomdImages'; columns:2|3|4; frame?:PictureFrame; children: BiomdImage[] }
  | { type:'biomdDocument'; src:string; title:string; mode:'link'|'embed' }
  | { type:'biomdColumns'; children: [BiomdColumn, BiomdColumn]
                                   | [BiomdColumn, BiomdColumn, BiomdColumn] }
  | { type:'biomdColumn';  children: BoundedContent[] }
  | { type:'biomdNav';     title?:string; active?:string; children:[List] };

interface BioBase { id: string; sourceIds: string[]; decisionIds: string[] }
```

Three properties make this the highest-leverage component:

1. **The content model is unrepresentable when wrong.** `biomdColumns` cannot hold anything but two
   or three `biomdColumn`; `biomdColumn` cannot hold `biomdColumns`; there is nowhere to put
   `divider: false`. Whole checklist sections in the guides' Phase C stop describing possible states.
2. **Constructors validate.** `makeImage()` requires `src`, and requires `position` + `size` when
   standalone. Palette tokens are union types.
3. **`mdast-util-to-markdown` owns Markdown-level correctness** — escaping, table alignment padding,
   footnote definitions, list markers, tight/loose lists — with one small custom handler per directive
   emitting the `::: name` / `property: value` / blank line / body / `:::` shape.

Note what is **absent by construction**: no `biomdFrame`, no `biomdSignature`, no `divider` property
(user decision 4, §12.3). Re-enabling any of them is a one-line union change plus a serializer
handler, gated behind a profile flag.

The serializer owns all context-aware escaping. Literal source lines that look like headings, list
markers, table delimiters, footnote references or `:::` fences remain data unless the AST says
otherwise.

**Reading BioMD back** (round-trip verification): a small reader built on
`micromark-extension-directive` for the generic `:::` fence machinery plus a custom property-line
extension. Converter-internal; see §12 for why it must match the renderer's *behavior*, not the spec.

### 6.4 The pass contract — making provenance enforceable

Plan A requires that every source item end in exactly one terminal state. That is the right
invariant, but as stated it is a discipline tax on fourteen passes. Make it a runtime check instead:

```ts
interface Pass<In, Out> {
  id: string;
  version: string;
  run(input: In, ctx: PassContext): { output: Out; ledger: LedgerDelta };
}

// LedgerDelta maps every input item id to exactly one of:
//   EMITTED(outId) | MERGED_INTO(outId) | MOVED_TO(outId)
//   | REMOVED(reason) | REVIEW(reason)
```

The framework asserts totality after every pass and fails loudly on a gap. **No item may disappear
because it was absent from a response** — this is the single structural guarantee that the current
guide-driven system cannot make.

---

## 7. Layout analysis and output shaping

§7.1–7.3 classify what the *source* is. §7.4–7.5 decide what to *emit* — a separate question, and
the one where "don't make the output unnecessarily complex" lives.

### 7.1 Tier 1 — Deterministic gates (high precision, expected majority)

Fires only on decisive evidence; otherwise abstains.

| Rule | Verdict |
|---|---|
| 1×1, no border, no background | `SHELL` → unwrap |
| corpus frequency > 0.7 and text SimHash near-identical across pages | `SHELL` |
| contains `<th>`/`scope`, or a header row of bold/centred cells over ≥3 cols × ≥3 rows | `DATA` |
| ≥1 column where all non-empty cells are single links of one resource class | `DATA` |
| every row has identical cell count, all cells short (< 80 chars), ≥3 rows | `DATA` |
| a cell contains a nested table with prose in > 1 of its cells | `LAYOUT` / `HYBRID` |
| single content cell (all siblings empty/spacer) | `LAYOUT` → unwrap |
| 2 columns, **measured** width ratio 0.45–0.55, ≥2 rows, each cell = image + numbered list, recurring | `CATALOG` |

Border presence alone never decides (spec §16.2).

### 7.2 Tier 2 — Scored classifier (the uncertainty band)

Feature vector, all cheaply available once geometry exists:

```text
structural : rows, cols, cellCount, nestingDepth, hasNestedTable, isNested,
             rowspanCount, colspanCount, gridRegularity
geometric  : totalW/H, colWidthPx[], colWidthRatioVariance, rowHeightVariance,
             gutterWidths, cellTextAlignment, borderPresence, bgColorDistinctness
content    : perColumn{ contentKindHistogram, avgTextLen, textLenVariance,
             linkDensity, imageDensity, numericRatio, emptyRatio },
             columnKindEntropy, neighbourCellSimilarity
corpus     : structuralFingerprintFrequency, schemaClusterId, schemaMatchScore
```

`neighbourCellSimilarity` — cells in a genuine data table resemble their neighbours; layout cells do
not — is the most discriminative classical feature in the literature and is trivial to compute here.

Start hand-weighted; train a small gradient-boosted model later on accumulated labels (M7). Output: a
distribution over `{SHELL, LAYOUT, DATA, HYBRID, CATALOG}` plus a margin. Below the margin, abstain —
`unknown` is a legitimate answer.

### 7.3 Tier 3 — LLM adjudication · Tier 4 — human review

Tier 3 payload is small, dense and multimodal: a **cropped screenshot** of the rendered region plus a
grid summary (dimensions, measured widths, per-column content profile, first two rows as normalized
text, corpus recurrence, Tier-2 scores and the rule that abstained), against a typed schema.
Roughly 800–1 500 input tokens and one image, versus whole-page markup today. *A rendered two-column
album catalog is instantly legible to a vision model in a way 40 KB of nested `<td>` never is.*

Tier 4 surfaces source crop, proposed output and decision trail for a human. Corrections feed the
Tier-2 training set, so the system gets measurably better rather than accreting guide paragraphs.

### 7.4 Choosing the output construct

The decisive property comes from the renderer (§12.6, C1): **GFM table cells are inline-only.** No
lists, no multiple paragraphs, no block images. That single fact partitions most of the decision
space before judgment enters.

| Source relationship | Inline-only cells? | Row-wise correspondence? | Emit |
|---|---|---|---|
| Resource matrix (work × tab / audio / scores) | yes | yes | **Markdown table** |
| Term/definition, label/value, date/event pairs | yes | yes | **Markdown table** — often mis-modelled as `columns` today |
| Key/value records with block cell content | no | yes | definition-style lists or sections |
| Cover + title + track list, repeated | no | no | flatten (§7.5), or `columns` under `faithful` |
| Text beside a portrait | no | no | floated `::: image` + prose — simpler than `columns` and reads better |
| One logical list split across two visual cells | n/a | no | **one flat list** |
| Two genuinely independent short lists | yes | **no** | two lists in sequence — **never a table** |
| Related adjacent images | n/a | n/a | `images` |
| Compact local link set | n/a | n/a | `nav` |
| Article-specific bordered notice | no | no | heading + blockquote or plain section (§12.3) |
| Mixed table | — | — | decompose into several semantic groups |
| **Unrepresentable relation** | — | — | **safest linear form + `REVIEW`. Never invented syntax** |

**Where a Markdown table wins.** For inline-only content with real row-wise correspondence a table
beats `columns` on every axis: plainer Markdown, degrades gracefully in any viewer, already wrapped in
`overflow-x-auto` by the renderer (verified, §12.5), and it never touches the broken `divider` path.
Any two-lane construct whose rows genuinely pair up should be a table.

**Where a table is actively wrong — the important half.** A Markdown table asserts that the cells in
a row belong together. For presentational lanes that assertion is false — item 1 on the left and item
15 on the right are not a record — and a table additionally imposes *row-major* reading order on
content whose real order is *column-major*. Using a table there does not simplify the output; it
corrupts it. Treat the absence of correspondence as a signal to **flatten**, not as a reason to reach
for `columns`.

Spec §3.8 already agrees: no `rowspan`/`colspan`/spacers/percentage widths in output, and never a
table for page layout, paired images or text beside a cover.

### 7.5 Structural simplification — `layoutFidelity: simplified` (confirmed)

- `faithful` — preserve visual lanes wherever geometry proves them (current guide behavior).
- **`simplified` — the default.** Presentational lanes collapse into linear flow; `columns` is
  reserved for genuine *block-level parallelism* where the two sides are semantically bound (a cover
  and its track list), not merely adjacent.

Four independent arguments, all of which survived review:

1. Requirement 7 authorizes it directly — output need not mirror source structure.
2. **On mobile, lanes already collapse to exactly the flattened order.** Spec §10 itself: "on narrow
   screens columns stack in source order." A two-lane track grid stacks into tracks 1–10 then 11–20 on
   a phone. The lanes carry no information a narrow-screen reader ever perceives — they are a
   desktop-only artifact of 2003 page width.
3. It deletes the most complex rule cluster in the guides — `split_numbered_track_grid`, odd/even lane
   mapping, `source_layout.track_grids`, continuous-numbering-across-cells — which is also, by direct
   report, where conversion most often goes wrong. Rules that are hard to state precisely are rules
   that are hard to execute reliably.
4. `divider` is not emitted at all (§12.3), so one of the two things `columns` offers over plain flow
   is unavailable regardless.

Concretely: a two-column album catalog emits each album as a sequential block — label, `::: image`
cover, track list — in visual reading order, with no lane machinery.

> **Spec implication, stated plainly.** `BioMD-Reference.md` §10 currently *mandates* lane
> preservation for source-proven track grids. Under `simplified` that clause becomes profile-dependent
> rather than normative. Note the spec already contemplates a fidelity trade-off in the same section
> ("if row-major mobile reading is more important than persistent lanes…") — this extends that
> reasoning one step further. `faithful` remains available and both modes run from the same IR, so
> their outputs are diffable.

**Deterministic simplification passes** on the AST before serialization:

1. **Unwrap degenerate directives** — `columns` with one column; `images` with one child → `image`;
   `align` wrapping a single image (the image's own `position` already says it); empty `lead`.
2. **Collapse presentational lanes** per the policy above.
3. **Prefer float over columns** — cover + substantial prose becomes `::: image position: right`
   followed by paragraphs.
4. **Drop incidental alignment** — `align` requires direct `align=`/`text-align` evidence *and* a
   repeated semantic role; one centered cell inside a layout table is not evidence.
5. **Merge adjacent same-kind blocks** — consecutive `images` groups of equal column count with no
   intervening prose.
6. **Prefer plain Markdown** — the spec says this already (§3); make it a lint rather than advice.

**Complexity budget as a CI gate:**

```text
directive_density   = directives per 1000 words
max_nesting_depth
directives_total
```

Thresholds calibrated on the golden corpus. A 600-word biography emitting 30 directives is modelling
layout rather than meaning — flag it rather than ship it.

**Every simplification still needs source coverage.** "Simpler" must never mean omitting inconvenient
content: each flattening is recorded as a `MERGE` ledger entry with its reason, so it stays visible,
reversible, and consistent with the conservation gate.

---

## 8. Text reconstruction and de-hyphenation

### 8.1 Read the problem correctly

Legacy Russian prose was hand-wrapped, so words are split at line ends with a literal hyphen:

```text
…выдающийся музы-
кант и композитор…        →    …выдающийся музыкант и композитор…
```

and must **not** be joined when the hyphen is lexical:

```text
из-за · кто-то · Санкт-Петербург · Римский-Корсаков · где-нибудь
```

**Every candidate library solves the forward problem** — "at which points *may* this word be broken?"
— for justified typesetting. **None de-hyphenates.** Hyphenation patterns still earn their place, but
as a **validity oracle** inside a decision cascade, not as the mechanism:

> Given the candidate join `музыкант`, ask the hyphenator for its legal break points → `му-зы-кант`.
> The observed break `музы|кант` is one of them → consistent with hyphenation → joining is safe. For
> `из-` + `за`, the joined form `изза` is not a word and the hyphenated form is → preserve.

**The corpus is its own best dictionary.** 20 MB of single-domain Russian contains exactly the
composer names, place names and instrument vocabulary any general dictionary lacks. If `музыкант`
appears unhyphenated 40 times elsewhere in the corpus, the question is settled without consulting
anything else. This is the strongest signal in the cascade and it costs one pass (Stage 0).

### 8.2 Decision cascade (first match wins; all deterministic, zero LLM)

| # | Condition | Action |
|---|---|---|
| 1 | Soft hyphen `U+00AD` | **JOIN** — unambiguous layout artifact |
| 2 | Hyphen is **not** at the measured right edge of its line box (Stage 3) | **PRESERVE** — a mid-line hyphen is lexical by construction |
| 3 | Joined form attested in the corpus lexicon | **JOIN** |
| 4 | Hyphenated form attested and joined form never attested | **PRESERVE** |
| 5 | Both fragments capitalized (`Римский-` + `Корсаков`) | **PRESERVE** — compound proper noun |
| 6 | Break legal per language patterns **and** joined form passes the hunspell lexicon | **JOIN** |
| 7 | otherwise | **PRESERVE + REVIEW** — batched to a hook only if volume justifies it |

Rule 2 is measurement replacing inference again: whether a hyphen sits at a line edge is a fact the
layout engine already computed, and it decides a large share of cases outright.

Additional rules carried from both plans:

- Ordinary HTML source newlines inside prose are collapsible whitespace, not evidence of a break.
- Preserve hard block boundaries. `<br>` is *evidence*: keep it in verse, addresses, signatures,
  compact table cells and deliberate lineation; convert to a space only in confidently ordinary prose.
  This is the guides' `WRAP | PARAGRAPH | LINEATION | SPACING` state machine, now geometry-informed —
  a `<br>` whose following text starts at the same x, and whose preceding line reached the container's
  right edge, is almost certainly `WRAP`.
- **Never concatenate two unhyphenated words** merely because they occupy adjacent lines; prose joins
  them with a space.
- Weaken confidence for genuine Russian compounds, identifiers, repeated literal hyphens, mixed
  scripts, numbers and URLs.
- **Never write soft hyphens or discretionary breaks into `.bio.md`.** The oracle's output is
  consulted, never emitted.
- Respect spec §16.3's 2 200-character physical line limit; never join verse or songs.

### 8.3 TextOperation ledger

```ts
interface TextOperation {
  id: string;
  kind: 'collapse-space' | 'line-to-space' | 'remove-soft-hyphen'
      | 'join-hyphenated-word' | 'preserve-break' | 'entity' | 'dropcap'
      | 'spelling' | 'punctuation' | 'transliteration' | 'paraphrase';
  sourceIds: string[];
  before: string;
  after: string;
  evidenceIds: string[];
  confidence: number;
  status: 'proposed' | 'accepted' | 'review' | 'rejected';
}
```

- `rawText` is immutable; `normalizedText` is *derived* by replaying accepted operations. Validation
  reconstructs every changed span from the ledger.
- The editorial policy declares which kinds are permitted. Mechanical kinds
  (`collapse-space`, `line-to-space`, `remove-soft-hyphen`, `join-hyphenated-word`, `entity`,
  `dropcap`) are on by default; everything editorial is denied unless the profile enables it — which
  matches spec §16.3's conservative-transcription default.
- A hook **never returns rewritten text**, only operations. Applied deterministically in span order
  with overlap detection.
- Post-check: *only* patched spans differ from the source text.

### 8.4 Library selection

**Hyphenopoly** (`hyphenopoly.module.js`). Verified in the repository's `patterns/`: `ru.wasm`,
`uk.wasm`, `de.wasm`, `en-us.wasm`, `en-gb.wasm` among ~100 language pattern sets — covering the
corpus language, English, and the `ru`/`en`/`de` editions the renderer already anticipates. Actively
maintained, first-class Node entry point, supports exceptions and custom patterns.

Selection criteria, given the reframing above, are **pattern coverage, a usable Node API, and
maintenance** — *not* hyphenation quality, since no hyphen is ever rendered.

| Alternative | Verdict |
|---|---|
| `hyphenator.js` | **Reject** — explicitly superseded by Hyphenopoly (same author) |
| `ytiurin/hyphen` | **Reject** — clean and small, but fewer languages and far less activity; no advantage once Hyphenopoly covers `ru`. Viable fallback |
| `hunspell/hyphen` | **Reject the library, adopt the dictionaries** — native FFI for no behavioural gain, but `ru_RU`/`en_US` hunspell data is the right secondary lexicon |
| `ekmett/hyphenation` (Haskell), `text-hyphen` (Ruby) | **Reject** — process boundary, no benefit |
| Python path | `pyphen` — same libhyphen pattern lineage, includes Russian. Cascade unchanged |

**Versioning discipline (from Plan A, adopted verbatim):** pin and record the engine version, the
pattern file hash/source/license, the left/right minima, and the exception-list version, so a rerun
cannot silently change word joins.

The oracle sits behind a one-method interface —
`isLegalBreak(word: string, index: number, lang: Lang): boolean` — so swapping engines is a
half-day's work. This is deliberately a cheap decision to reverse.

---

## 9. LLM integration — the hook system

### 9.1 Hook contract

```ts
interface Hook<TCtx, TItem, TOut> {
  id: string;                                            // "table.classify"
  version: string;                                       // prompt + schema version → cache key
  schema: z.ZodType<TOut>;                               // → JSON Schema for tool use
  deterministic?(ctx: TCtx, item: TItem): TOut | null;   // null ⇒ escalate
  buildPayload(ctx: TCtx, item: TItem): { text: string; images?: ImageRef[] };
  validate(out: TOut, ctx: TCtx, item: TItem): Diagnostic[];
  model: { tiers: ModelId[]; escalateBelow: number };
  budget: { maxInputTokens: number; maxItems?: number };
}
```

Note what the interface does *not* mention: a provider. A hook declares the **capabilities** it needs
(a schema, optional images, a model tier) and the transport layer satisfies them. §9.2 makes that
transport a gateway rather than a vendor API without touching anything above this line.

Runtime guarantees:

- **Structured output only.** The schema is enforced at the transport layer where possible, but
  **local Zod validation is always the authority** — never the transport's promise (§9.2, R3). A
  response failing Zod is re-requested once with the validation error appended, then escalated one
  tier, then marked `REVIEW`.
- **Caching.** `sha256(hookId + version + canonicalJSON(payload) + resolvedModelId)` → response, on
  disk. Re-runs are free and byte-identical; `--replay` runs fully offline. The key uses the
  **resolved** model identity read back from the response, not the requested alias — see §9.2, R2.
- **Prompt caching.** Invariant prefix (spec excerpt + profile + hook instruction) as a cache
  breakpoint; per-item payload appended.
- **Middleware.** `onBeforeHook` / `onAfterHook` for logging, redaction, cost accounting, tracing.
- **Profile override.** A profile may replace, disable or wrap any hook — the extension point for a
  new corpus.

### 9.2 Transport — an independent LLM gateway, not a provider API

**Constraint:** the Anthropic API cannot be called directly. Every model call is routed through a
self-hosted or independently-operated gateway (LiteLLM, OmniRoute, 9router or equivalent).

**This costs the architecture nothing**, because §9.1 already depends on *capabilities* rather than on
a vendor SDK, and the plan always specified the SDK as sitting **behind an internal `LlmClient`
interface**. Only the adapter below that interface changes; hooks, schemas, the patch validator, the
cache, batching and budgets are untouched. What does change is that four capabilities can no longer
be assumed — they must be probed — and that a middlebox in the path introduces two failure modes that
a direct API call does not have.

#### Wire protocol

Target the **OpenAI-compatible `/v1/chat/completions` surface**. It is the lowest common denominator
that all three candidate gateways speak, so the converter stays portable across them. Where a gateway
also exposes an **Anthropic-native `/v1/messages` passthrough** (LiteLLM does), keep that as a second
adapter: it carries `cache_control` and tool-use semantics verbatim with zero translation, which
matters for the two capabilities most likely to be lost in translation.

#### Capability matrix — what the plan needs, and how it degrades

| Capability | Load-bearing for | Mapping onto an OpenAI-compatible gateway | If unavailable |
|---|---|---|---|
| **Structured output** | §9.1 — every hook returns typed data | `tools` (function calling) is universally supported. `response_format: {type:"json_schema", strict:true}` is OpenAI-specific and gateways translate it inconsistently — prefer `tools` | Nothing breaks: local Zod validation was always the authority (R3). Degrade `tools` → JSON mode → retry-with-error → `REVIEW` |
| **Vision (image input)** | Tier-3 table adjudication (§7.3) — the crop is doing the heavy lifting | `content: [{type:"image_url", image_url:{url:"data:image/png;base64,…"}}]`; the gateway translates to the provider's native block shape | Fall back to text-only grid summaries. Measurably worse on catalogs, so this one deserves a fixture probe before committing |
| **Prompt caching** | §9.6c — ~0.1× on the invariant prefix | `cache_control: {"type":"ephemeral"}` on content blocks. **Verified: LiteLLM supports this through its OpenAI-compatible surface** and reports `cache_read_input_tokens` / `prompt_tokens_details.cached_tokens` back | The cost model loses one multiplier. Item batching (§9.6b) and the local decision cache are unaffected and carry the bulk of the reduction |
| **Batch API** | §9.6c — 0.5× discount | LiteLLM exposes `/batches`; lighter gateways generally do not | Lose the discount, nothing else. Run synchronously through `p-queue`; an offline migration does not care about latency |
| **Usage accounting** | `Cost` metric (§10.7), budget caps (§9.7) | `usage` in the response, though field names vary by gateway | Fall back to a local tokenizer estimate and treat the gateway's own spend dashboard as the authority |

The important structural property: **only the two cost multipliers are at risk, and neither is
load-bearing for correctness.** Losing both raises spend without changing a single output byte, and the
dominant reduction — item batching plus the Green lane paying nothing at all — is entirely
provider-independent.

#### Three rules the gateway introduces

**R1 — the transport must be transparent.** Several gateways advertise token-compression features that
*rewrite the request or the response*: 9router's "RTK Token Saver" and "Caveman mode", OmniRoute's
stacked compression engines claiming 15–95 % savings. **Disable all of them for every hook.** The
objection is not output quality:

- the decision cache key is computed over the payload we *sent*; if a middlebox rewrites it, the key
  no longer identifies what the model actually saw, and cache hits become meaningless;
- response compression can break strict JSON, converting a schema violation into a retry loop;
- §9's reproducibility guarantee — a re-run is byte-identical — is unachievable if traffic is being
  mutated in flight.

A gateway that cannot be configured to pass requests through verbatim is disqualified as the primary
transport, whatever it saves.

**R2 — pin the resolved model, not the alias.** Through a gateway, `claude-sonnet-5` is a *gateway-side
config alias*, not a concrete model. If someone edits the gateway's routing config, cache keys stay
byte-identical while the model behind them changes — silently, and the whole determinism story (§9)
goes with it. Mitigation: read the resolved model back from the response's `model` field, assert it
matches what was requested, record it in the run manifest, and make it part of the cache key (§9.1).
**Fail loudly on a mismatch rather than serving a cache hit produced by a different model.**

**R3 — validate locally, always.** Never rely on the transport to have enforced the schema. This was
already the design (§9.1), and under a gateway it stops being defence in depth and becomes the primary
guarantee.

#### Client libraries

| Option | Verdict |
|---|---|
| **`openai` npm + `baseURL` override** | **Baseline recommendation.** `new OpenAI({ baseURL: "http://localhost:4000/v1", apiKey })` is the canonical, officially-supported pattern for any OpenAI-compatible endpoint. Zero abstraction, complete control over the request body — which R1/R2 both need |
| **Vercel AI SDK** — `ai` + `@ai-sdk/openai-compatible` | **Recommended if the hook layer leans hard on schema output.** `createOpenAICompatible({ baseURL, apiKey, headers })` exists precisely for gateways, and `generateObject({ schema })` accepts a **Zod schema directly** — mapping 1:1 onto `Hook.schema` and removing the hand-written Zod↔tool-use bridge from M4. Set `supportsStructuredOutputs` explicitly; `transformRequestBody` covers gateway quirks. Plan A's instinct to keep an AI-SDK adapter optional is vindicated here |
| **`@anthropic-ai/sdk` + `baseURL` override** | **Keep as a second adapter** where the gateway offers an Anthropic-native `/v1/messages` passthrough. Preserves `cache_control` and tool-use semantics with no translation layer — the cheapest way to protect the prompt-cache multiplier |
| LangChain.js | **Reject** — a chain/agent framework at the wrong abstraction level; this pipeline needs one typed request/response call, not an orchestration layer |

Whichever is chosen, it lives **only** inside `packages/llm/transport/`. Provider and gateway types
never reach the compiler domain — that boundary is what makes this a swap rather than a migration.

#### Gateway assessment

| Gateway | Assessment | Verdict |
|---|---|---|
| **LiteLLM** (Python) | The most established of the three. Exposes `/chat/completions`, a native Anthropic `/messages`, and `/batches`; `cache_control` verified working through the OpenAI-compatible surface *with* cache-token reporting; virtual keys with USD budgets, spend tracking, fallbacks and load balancing. **Every capability this plan depends on is present**, and its virtual-key budget doubles as the outer enforcement layer (§9.7) | **Recommended** |
| **OmniRoute** (TypeScript) | Same language as the converter, MIT, claims OpenAI-compatible `/v1` with tool calling, structured output, vision, prompt caching and per-key USD budgets. **But** its headline feature is aggressive prompt compression, which R1 forbids, and its capability claims are self-reported | **Viable second choice** — only with every compression engine disabled and R1–R3 fixture-verified |
| **9router** (Node/Next.js) | OpenAI-compatible `/v1/chat/completions` with subscription→cheap→free tier fallback. Oriented toward routing coding-assistant subscriptions and minimising tokens; structured output, vision and prompt caching are **not** documented as supported | **Not recommended as primary transport** — the capabilities this plan needs are precisely the ones it does not advertise |

Gateway feature claims are README self-descriptions, not verified behavior. Which is why:

#### Transport conformance probe

A five-test fixture suite in `fixtures/transport/`, run once whenever the gateway or its config
changes — cheap to write, and it converts every assumption above into a checked fact:

1. a `tools` round-trip returns schema-valid JSON for a known payload;
2. an image block is accepted and demonstrably influences the answer;
3. `cache_control` is reflected in the reported usage (cache-read tokens > 0 on the second call);
4. the request arrives unmodified — assert an echo hook or a token count matching a local estimate
   within tolerance (**R1**);
5. the response's resolved `model` equals the requested one (**R2**).

Failures here are configuration bugs, and finding them on five fixtures is very much better than
finding them after a 1 000-file run has produced a cache full of results from an unknown model.

### 9.3 The apply path — where Plan A's discipline lives

`validate()` returning clean is *not* sufficient to apply an operation. Every response passes:

1. schema validation;
2. **every referenced ID exists and belongs to this packet** (no hallucinated or cross-item IDs);
3. no attempt to modify immutable raw text, targets or evidence;
4. operation preconditions hold, and the result is BioMD-representable;
5. patch applied to a **copy** of the decision graph;
6. ledger totality and conservation re-run on the copy;
7. accept / queue for review / reject with a bounded retry reason;
8. prompt, response, model, settings, latency, tokens and outcome recorded.

An LLM output that is valid JSON but semantically unsafe is the expected failure mode, not an
exotic one. Schema validation alone does not catch it.

### 9.4 Hook catalogue

| Hook | Input | Output | Tier |
|---|---|---|---|
| `document.plan` | block outline + full screenshot | section boundaries, region→construct map, reading order, title/subtitle/lead picks | Sonnet |
| `boilerplate.adjudicate` | ambiguous region + corpus frequency + crop | keep / remove(reason) / rail-exception | Haiku |
| `table.classify` | grid summary + crop | class, subtype, confidence | Sonnet |
| `table.toRecords` | DATA grid + mined schema candidates | headers, row records, continuation merges | Sonnet |
| `table.toLayout` | LAYOUT/CATALOG grid + crop | ordered construct plan + lane mapping | Sonnet |
| `text.segment` | ambiguous `<br>` runs with geometry | per-break `WRAP/PARAGRAPH/LINEATION/SPACING` | Haiku |
| `text.role` | block + style evidence | heading level / subtitle / lead / quote / note / prose | Haiku |
| `text.operations` | unresolved join proposals + context | accept/reject per proposal | Haiku |
| `media.bind` | image cluster + neighbouring prose + crop | grouping, position, size, caption/alt binding | Sonnet |
| `order.resolve` | conflicting geometric vs DOM order | edge additions/removals only | Sonnet |
| `biomd.map` | approved semantic group | smallest legal construct | Sonnet |
| `review.audit` | final AST + IR + crop + rubric | structured findings, no edits | Opus |
| `repair.patch` | AST + validator diagnostics | AST patch operations | Opus |

The two-level split is intentional: `document.plan` gives the model **global structural authority**
("understand layout and document structure"), and per-region hooks execute that plan with focused
evidence. Planner/executor is what makes whole-document comprehension tractable without a 100 k-token
prompt.

### 9.5 What the LLM must never do

Encoding detection · entity decoding · URL/path rewriting · basename computation · fence emission ·
property spelling · line-length limits · list-marker formatting · table column padding · target
probing · de-hyphenation rules 1–6. All pure functions; all unit-testable; all currently done
stochastically.

### 9.6 Cost control

**Why the current approach is expensive, precisely.** It sends ~50 KB of guide text (≈15–20 k tokens)
with every file — **~20 M instruction tokens across the corpus, byte-identical every time**, before a
single byte of source HTML. The page content itself (~6–10 k tokens) is the *minority* of each
request. Any serious reduction must attack instruction overhead and call count, not the page payload.

**(a) Solve the template, not the page.** Where Stage 0 clusters pages into tight families, call the
model **once per family** to induce a *conversion recipe*, review it once, then apply it
deterministically to every member. This is wrapper induction (Kushmerick; RoadRunner; EXALG) applied
to migration rather than scraping. A recipe is data:

```ts
interface Recipe {
  familyId: string;
  matcher: { fingerprint: string; minSimilarity: number };
  regions: Array<{ pattern: LadomPathPattern; role: RegionRole; construct: ConstructPlan }>;
  guards: Precondition[];        // must hold on each member
  fallback: 'individual';
}
```

Two safety rails, one from each plan: a recipe is **promoted only when its guards validate across the
rest of the cluster** (A), and a member that fails its conservation gate **demotes that page to
individual handling** (B). A bad recipe degrades gracefully instead of silently corrupting 200 pages.

> **Feasibility caveat (§15.3).** Recipes pay off only if families are structurally tight, which is
> unknown until M3 measures it. They are an *optimization*, not a load-bearing assumption. Build (b)
> first; it is simpler, independent, and already delivers most of the reduction.

**(b) Batch items, not files.** The decision unit is a region, not a document. Pack 30–50
*independent* region decisions — drawn from many different files — into one request, returning an
array of typed results; fixed instruction overhead amortizes 30–50×. Rough arithmetic: 1 000 files ×
~3 genuinely ambiguous items ≈ 3 000 items; at 40 per call, ~75 calls against 1 000 in the naive
design.

**Do not batch** (Plan A's list, adopted verbatim): whole files merely to reduce HTTP calls; different
hook schemas in one prompt; enough items to risk output truncation; screenshots for items that don't
need them; low-confidence text edits together with layout classification. Every item carries its own
`itemId` + `inputHash`; results validate independently; **cross-item references are rejected**; one
bad item never invalidates its siblings.

**(c) Amortize the remainder.** Prompt caching on the invariant prefix · Batch API (asynchronous,
discounted — an offline migration is the ideal workload, nobody waits on any response) · decision
cache, so re-runs and later-stage iteration cost nothing.

> **Gateway caveat (§9.2).** These two are the only reductions in the whole strategy that depend on
> provider-specific features, and therefore the only ones a gateway can take away. Prompt caching
> survives on LiteLLM (verified); the Batch API survives only where the gateway proxies `/batches`.
> **Neither affects correctness, and the ordering of (a)–(d) is deliberate:** the large multipliers —
> the Green lane paying nothing, item batching amortizing instructions 30–50×, and the local decision
> cache making re-runs free — are entirely transport-independent. Losing both of (c)'s multipliers
> raises spend and changes no output byte. Confirm which survive with the transport probe (§9.2)
> *before* the dry-run's price table is trusted.

**(d) Spend CPU instead of tokens.** Rendering all 1 000 pages costs ~10 minutes and nothing else.
Every question the layout engine answers is a question you are not paying a model to guess at — and
the answer is more reliable than the guess. The same holds for the corpus lexicon, template
fingerprinting and the Tier-1/Tier-2 gates: each is a computation that retires a class of calls
permanently.

**Triage lanes.** Each file is scored deterministically from its LADOM (family-match confidence,
ambiguous-table count, Tier-1 abstentions, boilerplate coverage) and routed:

| Lane | Criteria | LLM cost |
|---|---|---|
| **Green** | matches a known family above threshold; no ambiguous tables; conservation passes | **zero** |
| **Amber** | a handful of item-level ambiguities, no structural novelty | batched items, shared across files |
| **Red** | novel template, complex hybrid tables, or a failed conservation gate | per-file plan + region hooks |

**The shares are a hypothesis, not a claim.** M3 measures them before any budget is committed.

### 9.7 Budget enforcement and operating modes

Estimation without enforcement is a wish. Before any paid call:

```powershell
biomd corpus llm-plan .\.biomd-work --dry-run
```

reports item counts by hook/risk/family, estimated prompt and output tokens, expected cache hits,
proposed batches, the configured price table and worst-case cost. **No network call occurs until
budgets are accepted.**

Hard caps, reserved transactionally per batch so concurrent workers cannot overspend:
`--max-calls`, `--max-input-tokens`, `--max-output-tokens`, `--max-estimated-cost`.

**Two independent layers, and the gateway makes this strictly better** (§9.2). The converter's
pre-flight estimate and hard caps are the *inner* brake: they know the item count and abort before a
request is built. A gateway **virtual key with a USD budget** (LiteLLM, OmniRoute) is the *outer* stop:
it is enforced server-side, cannot be bypassed by a bug in the converter's own accounting, and is the
one enforcement point that still holds if the pipeline is invoked by hand. Configure both, provision
the virtual key per migration run, and treat the gateway's spend dashboard as authoritative for
reporting — the converter's local figure is an estimate and should be labelled as one in the manifest.

Operating modes:

- `--llm off` — fully deterministic; unresolved cases become review items. **Must always produce a
  usable corpus run.**
- `--llm assist` — call hooks below confidence thresholds; auto-apply only low-risk patches passing
  every gate.
- `--llm review` — generate suggestions, require human approval.
- `--llm editorial` — separately authorized text editing with exact before/after spans and reasons.

Never silently fall back to a different model; never weaken validation to satisfy a budget.

---

## 10. Verification and gates

### 10.1 Ledger and IR gates

- every source-backed text/target/media item has exactly one terminal state (§6.4);
- no dangling source IDs, target IDs or relations;
- movement constraints form an acyclic graph;
- every merge/split preserves an ordered source mapping;
- every text change is an accepted `TextOperation` with exact before/after spans and evidence;
- every hook operation has valid evidence, provenance and an accepted status.

### 10.2 Conservation (hard gate)

- **Text:** normalized 5-gram shingle multiset, source content region vs output. `recall ≥ 0.995`,
  and every missing shingle maps to an explicit `REMOVE(reason)`.
- **Links:** multiset of source targets *after applying the rewrite function* vs output — exact
  equality, with every excluded target ledgered.
- **Images:** multiset of `src` values — exact equality.
- **Captions/alt:** every source caption/alt present or explicitly audited.

The ledger and the shingle diff are deliberately redundant: the ledger catches omission, the diff
catches a pass that claims `EMITTED` but writes the wrong text.

### 10.3 Table gates

Every origin cell and every occupied grid slot accounted for · covered span slots do not duplicate
content · nested tables resolved innermost-first with ownership retained · data tables have stable
semantic headers and rectangular rows · hybrid decomposition maps every meaningful cell or creates a
review · **no table is flattened before its class is finalized**.

### 10.4 BioMD gates and lint

Exactly one `#`; non-skipping, source-backed headings · balanced fences, documented properties,
valid nesting · no raw HTML/CSS/JS/PHP · no line > 2 200 chars · footnote reference/definition
balance · `nav.active` matches exactly one item · no redundant default properties · linked images
retain both `src` and `link`; captions attached · tables have semantic headers, never `Поле N` ·
**no `divider`, `::: frame` or `::: signature` emitted** (§12.3) · **complexity budget within
threshold** (§7.5) · AST → text → AST round-trips exactly.

### 10.5 Render round-trip — optional, never a gate (user decision 3)

A separate opt-in command:

```powershell
biomd verify <job> --render
```

drives the existing React renderer headlessly via Playwright against a local static build,
screenshots at 1280 px and 390 px, and checks: no page-level horizontal overflow · every image
resolves · every link present · heading count matches the AST · captions attached. Optionally a
source-vs-output contact sheet and a vision A/B against a rubric derived from spec §1's preservation
priority order.

**Constraint, per P11:** the renderer's absence, failure or version can never block a conversion or
change a completion state. This command is a diagnostic the operator chooses to run. Conversion
correctness is established by §10.1–10.4 plus the static conformance suite (§12), all of which run
offline with no renderer present.

### 10.6 Completion states

```text
decoded                     bytes decoded without unreported loss
structurally-repaired       browser-equivalent HTML5 tree parses and reserializes deterministically
sanitized-content           no scripts/PHP/handlers/executable schemes; removals reconcile with the ledger
conversion-review-required  unresolved semantic decisions remain
biomd-structurally-valid    grammar, nesting and properties pass
conversion-complete         full ledger reconciliation, conservation passed, no unresolved decisions
```

"The parser accepted it" and "the document is conforming HTML" are different claims. Without an
external conformance checker (user decision 2) the tool claims only up to `sanitized-content`, and
says so — it does **not** report a `conforming-clean-html` level it cannot substantiate. Adding v.Nu
later is an additive change behind `--strict-html`.

### 10.7 Metrics

```text
T      normalized word-sequence similarity          (existing)
R      target multiset F1                           (existing)
S      structure-token F1                           (existing)
C      normalized character-sequence similarity     (existing)
Ltab   table-class accuracy vs labelled fixtures
Lrel   layout-relation F1 (image ↔ prose ↔ position tuples)
Ccons  conservation recall                          — hard gate
Xcplx  complexity-budget violations                 — hard gate
Hyph   de-hyphenation precision & recall on a hand-labelled hyphen fixture set
Green% share of corpus converted with zero LLM calls — the cost KPI
Cost   measured tokens and spend per 100 pages, from the run manifest
```

`Green%` and `Cost` deserve equal billing with quality metrics: a change improving `S` by a point
while pushing 200 pages out of Green is usually a bad trade at this corpus size.

`Hyph` needs its own fixture set — a few hundred hand-labelled line-final hyphens covering both
directions (`музы-кант` vs `из-за`, `Римский-Корсаков`) — because **de-hyphenation errors corrupt
words silently and neither the conservation gate nor the render check will catch them** (both forms
are "present").

Text similarity to a reference conversion is diagnostic only. It must never reward dropping targets,
copying editorial drift, or reproducing one reviewer's optional structure. Never seed a candidate from
a reference output; freeze, then compare.

### 10.8 Test layers

- **Unit** — encoding scoring, PHP quarantine offsets, sanitation keep/unwrap/drop, text operations,
  Russian break scoring, grid expansion, link policy, order graph, lowering, escaping, schemas.
- **Property / fuzz** (`fast-check`) — malformed HTML never crashes, never loses an unreported target,
  never produces an unparseable artifact.
- **Differential** — parse5 serialization vs Chromium DOM; optional generic-converter baselines as an
  advisory oracle only.
- **Golden semantic fixtures** — assert IR roles, relations, text, targets and table coverage *before*
  snapshotting final formatting.
- **Round-trip** — BioMD AST → text → AST.
- **Conformance suite** — §12, static, offline.
- **Hook contract tests** — recorded responses, invalid operations, hallucinated IDs, deliberate
  target/text mutations, missing batch items, cross-item references, truncation, cache replay, budget
  exhaustion.
- **Corpus acceptance** — a full run over the 1 000 files verifying bounded concurrency, resume,
  failure isolation and aggregate reporting.

---

## 11. Technology stack

### 11.1 TypeScript / Node 24 LTS — on the converter's own merits

**The converter and the BioMD renderer are separate projects that never run together.** Nothing about
the renderer's language, framework or deployment factors into this choice, and nothing below leans on
it — the recommendation would read identically if the renderer were Python/Jinja, a Go service, or
did not exist. What the renderer supplies is the answer to a *different* question, addressed in §12.

**The scale reframing that drives half of these rows:** at 1 000 files / 20 MB the corpus fits in
memory and parses in milliseconds, so **throughput is not a selection criterion** — correctness,
control, provenance and testability are. Several rows would flip at 10 M pages; none are close calls
here.

| Concern | Choice | Why this, not the obvious alternative |
|---|---|---|
| Language / runtime | **TypeScript, Node 24 LTS**, ESM, pnpm | Discriminated unions express the IR and the BioMD content model almost verbatim, with compiler-enforced exhaustiveness on every `switch` over node kinds. *Not Python:* equally viable (§11.3); chosen against only on ecosystem depth |
| HTML parse | **parse5** via `rehype-parse` (`sourceCodeLocation: true`) | HTML5 tree construction *is* the repair spec; byte offsets give provenance. *Not tag-soup:* 5× faster but skips tree construction (foster parenting, adoption agency) — worthless speed, fatal gap. *Not cheerio/htmlparser2:* not HTML5 tree construction. *Not jsdom:* heavier, and a real browser is already in the pipeline |
| Sanitization | **custom hast visitor**, explicit denylist; `hast-util-sanitize` as a post-S2 backstop | *Not `rehype-sanitize` defaults:* strips `width`/`align`/`bgcolor`/`border`/`style` — precisely the layout evidence. It would run cleanly and destroy the design |
| Encoding | `chardet` + `iconv-lite` + corpus-tuned Cyrillic scorer | *Not `TextDecoder` alone:* decodes but cannot *detect*; Windows-1251 / KOI8-R / mojibake disambiguation is the actual problem |
| Server islands | bounded scanner with **offset-preserving** replacement; `php-parser` (lexer mode) optional | Offset preservation is the requirement; the tool is an implementation detail |
| Optional deep repair | **tidy-html5 (WASM)**, gated | *Not `htmltidy2`:* spawns a CLI per file, unmaintained. WASM avoids a native toolchain on Windows |
| Measurement | **Playwright (Chromium)** | The one irreplaceable choice. *Not jsdom + CSSOM:* no layout engine, which is the entire point. *Not Puppeteer:* comparable, but Playwright's browser pinning and route interception are cleaner for the determinism contract |
| CSS | **computed styles from Chromium** | *Not PostCSS:* `getComputedStyle` resolves the cascade, legacy attributes, inline styles and UA defaults in one step. Choosing always-on measurement *removes* this dependency |
| Document ASTs | **hast** → custom IR → **mdast** + directive nodes | AST→AST control at both ends. *Not turndown/mdream/breakdance:* node-by-node serializers with no semantic layer |
| Markdown output | **`mdast-util-to-markdown`** + `mdast-util-gfm-table` / `-gfm-footnote` + custom directive handler | Escaping, table padding, footnote definitions and list markers are all subtly wrong when hand-rolled, and each bug surfaces as a rendering artifact months later. *Not string templates:* this is where that decision gets punished |
| BioMD reader | **`micromark-extension-directive`** + custom property-line extension | Generic `:::` fence machinery already correct; only the property-line grammar is bespoke. For round-trip verification |
| Hyphenation oracle | **Hyphenopoly** | Verified `ru`/`uk`/`de`/`en-us`, real Node entry point, maintained. Behind a one-method interface (§8.4) |
| Lexicon | **corpus frequency map** + hunspell `ru_RU`/`en_US` data | The corpus is its own best dictionary for a single-domain encyclopedia |
| Schemas | **Zod** as the single source; **emit JSON Schema** for persisted artifact contracts | One definition drives static types, the tool-use contract and runtime validation; emitted JSON Schema keeps the portable, cross-language, versionable artifact contract. *Not hand-written JSON Schema:* three copies that drift |
| LLM transport | **`openai` npm with `baseURL` → an independent gateway** (LiteLLM recommended), behind an internal `LlmClient` interface. Optionally the **Vercel AI SDK** `@ai-sdk/openai-compatible` where Zod-native `generateObject()` earns its keep | Provider APIs are not reachable directly (§9.2), and the OpenAI-compatible surface is the only protocol all candidate gateways speak. *Not `@anthropic-ai/sdk` directly:* ruled out by the constraint — but keep it as a **second adapter** where the gateway exposes an Anthropic-native `/v1/messages` passthrough, since that preserves `cache_control` with no translation. *Not LangChain.js:* an orchestration framework at the wrong abstraction level. Transport types never leave `packages/llm/transport/` |
| Classifier | hand-weighted score → small GBM on labelled fixtures | The existing `training/` + `validation/` + `*.right.bio.md` corpus is already a labelled dataset |
| Tests | **Vitest** + `fast-check` + `pixelmatch` | Unit, property/fuzz and screenshot diffing in one runner |
| CLI / batch | `commander`, `p-queue`, `listr2`, `pino` | Resumable, concurrent, content-hash keyed; a 1 000-file run must survive interruption |
| Corpus state | content-addressed filesystem artifacts + JSONL manifest behind a `Store` interface | Files are the auditable truth. SQLite (`node:sqlite`, zero-dependency) is a later swap behind the same interface if aggregate queries justify it |

Why this ecosystem, independent of the renderer:

- `unified`/`rehype`/`hast`/`mdast` has no equivalent depth anywhere — dozens of battle-tested
  micro-packages for exactly this problem, instead of one monolithic library to extend by hand.
- `remark-directive` already implements generic `:::` container-fence parsing — most of the hard part
  of reading BioMD back for round-trip verification.
- Playwright's page-context code (`page.evaluate(() => …)`) is JavaScript by construction; writing the
  pipeline in TypeScript keeps that seam invisible instead of making it a cross-language boundary.

### 11.2 The Python path — equally valid

`lxml.html` / `html5lib`, `playwright-python` (identical Chromium capability via the same CDP
protocol), `markdown-it-py` + `mdformat`, `pydantic`, `pyphen`, the `anthropic` Python SDK — all
production-grade. If existing skills or `tools/biomd_pipeline.py` make Python the path of least
resistance, take it; nothing in §§3–10 depends on TypeScript.

**The one cost that does not change with language:** BioMD's real grammar lives in one hand-written
parser that has already drifted from the spec it claims to implement (§12). Whatever the converter is
written in, it needs its own reader/validator matching that parser's *actual* behavior, plus a
conformance suite. TypeScript's head start is narrow — `remark-directive` covers the generic
fence-parsing 80 %; the BioMD-specific 20 % must be written and tested from real behavior regardless.

**Keep `tools/biomd_pipeline.py validate`** running in CI through the migration either way. A second,
independently-written validator disagreeing with the first is a useful signal, not a liability.

### 11.3 Do not adopt as the core

turndown · breakdance · mdream · get-md · htmltidy2 · tag-soup · hyphenator.js · Readability/Defuddle
as destructive extractors.

**Borrow from:** `lightfeed/extractor` (Playwright + Zod-schema-constrained LLM — the closest
philosophical prior art; read its JSON-recovery code) · `mdream` (hook/plugin API shape) · `all2md`
(its document-diff command is a good model for the conservation check) · `xberg-io/html-to-markdown`
(strong generic comparison oracle and a plain-Markdown fallback channel) · trafilatura (SimHash
deduplication) · the wrapper-induction literature (recipes).

---

## 12. Renderer conformance — the target grammar

**This section is independent of §11 and creates no dependency.** §11 answered "what should the
converter be built with?". This answers a different question: **what must `.bio.md` actually look
like to render correctly today?** The answer is static data — input → expected-behavior fixture pairs,
checked into `conformance/`, portable to any language, requiring no renderer at CI time.

The facts below come from reading `app/src/lib/biomd/parse.ts`, `remarkHighlight.ts`, `BioArticle.tsx`,
`paths.ts` and `entry.ts` (read-only; nothing was built, run or modified). `parse.ts`'s own header
self-labels it against **"Biography-Markup.md, v1.3"** while the workspace spec is v1.6 — three
revisions of drift.

### 12.1 Two-layer grammar — and it matches the spec's own parsing order

The `:::` layer is a hand-written recursive-descent parser over raw text lines producing its own tree,
handling `lead`, `align`, `image`, `images`, `document`, `columns`, `column`, `nav`, plus a generic
`unknown` fallback that preserves and recursively re-parses unrecognized content. Only afterwards does
Markdown enter, and in a *fragmented* way: each leaf containing prose becomes its own independent
`<ReactMarkdown>` instance with `remark-gfm` + a custom `remarkHighlight`. There is no single mdast
tree for the article.

This is not a quirk — it is exactly spec §17's recommended parsing order (directive tree → validate →
parse Markdown inside permitted bodies). The converter's internal AST may be whatever it likes; what
it must *match* is this two-layer grammar: a line-oriented directive layer with independent
CommonMark+GFM islands inside its leaves.

### 12.2 Fence mechanics — and one real landmine

```text
FENCE_OPEN  = /^:::\s*([A-Za-z][\w-]*)\s*$/     # name alone on its line, ASCII + dash
FENCE_CLOSE = /^:::\s*$/
PROP_LINE   = /^([A-Za-z][\w-]*):\s*(.*)$/      # value = remainder of line; matches spec
```

Nesting is a plain depth counter: any `:::name` increments, any bare `:::` decrements, **name-agnostic**
— no check that a closing fence matches what was opened. An unclosed fence is tolerated (content runs
to EOF with a warning), so recovery is graceful.

**The landmine.** `align` and `nav` read properties via `splitPropsAndBody`, which ends the property
header at the first blank line **or the first line that doesn't parse as `key: value` — whichever
comes first**. This is more lenient than the spec. Consequence: if an `align` or `nav` body's *first
line* looks like `Label: text…`, it is silently consumed as a bogus property and **vanishes from the
rendered output**, with nothing warning about it.

> **Correction, established by the conformance test rather than by reading.** `PROP_LINE` is
> **ASCII-anchored** — `^([A-Za-z][\w-]*):` — so a Cyrillic label such as `Дата: …` can *never* match
> it, and such a line is safe. The real exposure is narrower and less obvious: a **single Latin-script
> word followed by a colon**. In this corpus that means musical terms (`Andante: …`, `Moderato: …`,
> `Op: …`) and any content in the `en`/`de` editions the renderer anticipates. The mitigation below is
> unchanged; only the threat model is sharper. `conformance.test.ts` asserts both the trigger and the
> Cyrillic boundary case, so the distinction cannot quietly regress.

> **Hard serializer rule:** always emit an explicit blank line between an `align`/`nav` property block
> and its body. The spec treats this as general style; here it is a content-loss guard.

### 12.3 Confirmed gaps — and the converter's response (user decision 4)

| Spec construct | Renderer status | Converter policy |
|---|---|---|
| `::: frame` (spec §12) | **Not implemented** — falls to `default:`, renders as a bare `<div>`; palette, border and notice semantics lost silently (`console.warn` fires only in DEV) | **Never emit.** Degrade to heading + blockquote, or a plain section, recorded as a `TRANSFORM` |
| `::: signature` (spec §13) | **Not implemented** — same fallback | **Never emit.** Degrade to ordinary short paragraphs |
| `columns` → `divider: true` (spec §10) | **Not implemented — actively broken** (traced below) | **Never emit.** Under `simplified` most `columns` disappear anyway; where one remains, omit the property |
| Leading-zero markers `01.`, `02.` (spec §3.4) | **Not implemented** — no `ol`/`li` override; `remark-gfm` parses `01.` as `start: 1` | See C2 |
| "Undocumented property MUST warn" (spec §4) | **Not implemented for any directive** — an unrecognized but well-formed key is silently stored and never read | The converter's own validator is the **only** backstop; the renderer will never surface a mistake |
| `image`/`images` picture `frame:` property | **Implemented** — `ImageNode.frame` → `<CurlFrame>` | Safe to emit freely. **Distinct from block-level `::: frame`** — do not confuse them |

**The `divider` bug, traced.** The `columns` case calls `segment(block.lines)` directly, unlike
`align`/`nav`, which call `splitPropsAndBody` first. So the line `divider: true` is never recognized
as a property; `segment()` sees no fence marker, so it becomes an ordinary markdown run, which the
`columns` case then treats as *"stray markdown directly inside `::: columns` → its own column"* and
pushes as the **first column**. Result: a corrupted three-slot layout with the literal text
`divider: true` rendered as bogus leading content ahead of the two real columns.

This is why the AST in §6.3 has no `divider` field: the shortest path to never emitting it is to make
it unrepresentable. Re-enabling any of these three constructs after a renderer fix is a small,
localized change plus a conformance-fixture update.

### 12.4 Links and resources — confirmed, plus one new constraint

- `resolveResourcePath` matches spec §15 exactly: default base `/pages`; absolute URLs, `mailto:`,
  fragments and query-only refs pass through; both `music/x.mp3` and `/music/x.mp3` resolve to
  `/pages/music/x.mp3`. The guides' link-base assumptions are confirmed correct.
- `entryTargetSlug` recognizes exactly four forms — `#/slug`, `/#/slug`, `<slug>.bio.md`, `<slug>.md`
  — and in every case requires `SLUG_PATTERN = /^[\w.-]+$/`: **ASCII word characters, dot and dash
  only; no Unicode flag, so a Cyrillic slug is rejected.** Anything else, including an un-rewritten
  legacy `.htm` link, falls through to a "legacy relative link" branch: resolved as a static resource,
  opened in a new tab, labeled archival — it will not navigate in-app and will most likely 404.
- This makes the guides' §9/B7 rewrite rule load-bearing rather than stylistic, and it works today only
  because the ABC corpus filenames are already Latin.
- **New constraint for a Russian corpus, in neither guide:** any *new* BioMD-to-BioMD cross-link whose
  natural slug would be Cyrillic must be transliterated to ASCII first, or it silently degrades to a
  dead archival reference. This belongs in the profile's link policy as a named transliteration rule,
  not an implicit assumption.

### 12.5 Media widgets — confirms guide advice, mechanism now visible

- An ordinary Markdown link is upgraded to a rich widget purely by extension:
  `.mp3/.wav/.ogg/.oga/.m4a/.aac/.flac` and `.mid/.midi` become an inline native/MIDI player;
  `.txt` becomes an interactive ASCII-tablature viewer backed by a full tolerant six-string grid
  parser. **This is why both guides say audio/MIDI/TAB references stay plain links** — wrapping them
  in `::: document` trades a rich widget for a flat download card.
- A bare `![alt](src)` gets a generic click-to-zoom frame with **no** float/size semantics; only
  `::: image` carries `position`, `size`, `frame`, `caption` and a separate `link`. Default to
  `::: image` whenever a source image has meaningful position, size, caption or click target — which,
  per the guides, is nearly always.
- GFM tables are confirmed wrapped in `<div class="overflow-x-auto">`. `columns` and `images` use
  responsive grid classes collapsing to one column below their breakpoint, matching spec §14.
  **`nav`'s responsive wrapping was not verified** — its stylesheet was not inspected. Treat as
  unverified.

### 12.6 Constraints for the converter (C1–C5)

**C1 — GFM table cells are inline-only.** No lists, no multiple paragraphs, no block images, no line
breaks; `|` must be escaped. A cell needing block content means the region is `HYBRID`, not `DATA`.
This turns the guides' judgment call into a mechanical constraint and drives §7.4.

**C2 — Leading-zero markers are lost (confirmed).** Decide once and record it in the serializer:
either accept the loss (simplest — align the spec to reality), or treat it as a separate renderer
request. **Do not keep emitting `01.` while pretending it survives.** Recommended: accept the loss;
emit plain `1.` and record a `TRANSFORM`.

**C3 — `==highlight==` is narrow.** Splits mdast `text` nodes on `/==([^=\n]+)==/g`: cannot span a
blank line, cannot contain `=`, never touches already-tokenized nodes (inline code, link URLs). Treat
highlight spans as inline-only, single-line, `=`-free.

**C4 — Raw HTML disappears silently.** `react-markdown` renders no raw HTML (`rehype-raw` is not
enabled). Anything leaking through vanishes without error at render time — which makes the
conservation gate load-bearing rather than decorative, since the renderer will never surface the loss.

**C5 — Responsive behavior is the renderer's job**, verified per construct: tables, `columns` and
`images` confirmed; `nav` is a known gap in verification.

---

## 13. Repository, artifacts, CLI

### 13.1 Job layout

```text
.biomd-work/<job-id>/
  manifest.json            # schema/engine/profile versions, input hash, parent hashes, timings
  00-source/original.bin · source-meta.json
  01-decode/decoded.html · encoding-report.json
  02-repair/repaired.html · quarantine.json · parse-errors.json
  03-measure/ladom.json · screenshot-wide.png · screenshot-narrow.png · crops/
  04-clean/clean-body.html · sanitation-report.json
  05-ir/document.ir.json · tables.ir.json · targets.json · text-operations.json · ledger.jsonl
  06-decisions/deterministic.jsonl · llm-requests.jsonl · llm-responses.jsonl · accepted.jsonl
  07-output/document.biomd.ast.json · document.bio.md
  08-validation/report.json · report.md
```

Every artifact records schema version, engine/profile version, input hash, parent-artifact hash and
tool/model identity. **A stage is cacheable and resumable only when its input hashes match.** Write to
temp + atomic rename; never modify the original.

### 13.2 Source layout

```text
biomd-convert/
  packages/
    biomd-ast/       # AST, constructors, serializer, reader, validator
    ladom/           # encoding, quarantine, parse, sanitize, measure, normalize
    convert-core/    # IR, pass framework, ledger, classifiers, structure recovery, text
    llm/             # hook runtime, packets, batching, cache, budget, patch validator
      transport/     # gateway adapter — the ONLY place provider/gateway types exist (§9.2)
    profiles/abc/    # selectors, link + transliteration rules, chrome assets, corpus stats, editorial policy
    cli/
  conformance/       # fixtures + assertions extracted from the renderer's real behavior (§12)
  fixtures/          # encoding · malformed · sanitation · dehyphenation · tables · layouts · biomd
                     #   + transport/ — the 5-test gateway conformance probe (§9.2)
  golden/            # frozen decision cache — offline, free CI
  corpus/            # corpus-profile.json, asset index, link graph, lexicon
```

The ABC profile holds code or declarative data for the §9 target function, shell fingerprints, corpus
selectors, recurring catalog shapes and thresholds. It must not contain fixture prose or expected
document text.

### 13.3 CLI

```powershell
biomd corpus scan .\html --profile abc --work .\.biomd-work
biomd corpus run  .\.biomd-work --llm off --resume
biomd corpus llm-plan .\.biomd-work --dry-run
biomd corpus llm-run  .\.biomd-work --max-calls 20 --max-estimated-cost 25
biomd corpus report   .\.biomd-work

biomd run input.htm --profile abc --llm assist
biomd verify <job> --render          # optional; never a gate
biomd review <job>
```

Controls: `--stop-after decode|repair|measure|clean|ir|plan|emit` · `--visual never|auto|always` ·
`--llm off|assist|review|editorial` · `--layout-fidelity simplified|faithful` ·
`--review-threshold <c>` · `--jobs <n>` / `--browser-jobs <n>` · budget caps (§9.7) · `--replay` /
`--record` / `--refresh <hookId>` · `--offline` (default; no link or asset probing) · `--resume`
(only on matching hashes).

---

## 14. Roadmap

### 14.1 Milestones

| # | Deliverable | Exit criteria |
|---|---|---|
| **M0 — Harness** (1 wk) | Monorepo, fixture families, golden corpus, metric implementation, CI. No conversion. | Metrics run and report on an empty baseline |
| **M1 — `biomd-ast` + conformance** (1–2 wks) | Types, constructors, serializer, reader, validator; conformance suite extracted from the renderer's real behavior (§12) | Round-trips every existing `.bio.md`; the fence landmine, `divider`, `frame`/`signature` and C1–C5 are all covered by fixtures. Renderer unmodified |
| **M2 — LADOM** (2 wks) | Ingest, quarantine, parse, S1, Playwright measurement, determinism contract, grid materialization | Geometry reproducible across two machines; `ladom.json` + screenshots for the corpus. **Inspect it against the pages that currently fail before going further** |
| **M3 — Deterministic pipeline, zero LLM** (2–3 wks) | Corpus pass, S2, segmentation, Tier-1 rules, structure recovery, de-hyphenation cascade, simplification, link policy, serializer, ledger + conservation | A simple biography converts with `--llm off`, prose rebuilt with no unledgered changes, all targets accounted for. **`Green%` measured** |
| **M4 — Hook runtime** (1–2 wks) | Hook contract, **gateway transport adapter + 5-test transport probe (§9.2)**, Zod↔tool-use, patch validator, decision cache, routing, prompt caching, **item batching**, Batch API where proxied, dry-run + hard budgets, `--replay` | A model can correct an ambiguous classification but cannot change raw text, targets, schemas or serialization. A failed batch applies nothing unrelated and cannot exceed budget. **The transport probe passes against the configured gateway**, and the price table reflects which of caching/batching actually survived |
| **M5 — Semantic hooks** (2–3 wks) | `document.plan`, `table.classify` (vision), `table.toLayout`, `media.bind`, `text.segment` for Amber/Red; then per-family recipes *if* M3's family distribution justifies them | **The reported failure is fixed here.** Every table fixture reaches 100 % meaningful origin-cell accounting; ambiguous cases stop for review rather than flattening wrongly |
| **M6 — Verification loop** (1–2 wks) | Complexity budget, repair loop, optional render check, review contact sheet | Human review scales; F6 closed |
| **M7 — Tier-2 classifier** (1 wk) | Train on accumulated labels; push Amber into Green | Measurable accuracy and cost reduction |
| **M8 — Production** (ongoing) | Resumable corpus run, dashboards, cost reporting | Ship |

**Two ordering constraints, both load-bearing:**

- **M2 before any LLM design.** Look at the geometry of the pages that currently fail; it will reshape
  the hook catalogue. Do not build M5 on assumptions.
- **M3 before any LLM budget is committed.** The Green/Amber/Red shares are a hypothesis. M3 replaces
  them with a measurement, and that measurement decides whether M5 needs 20 recipes or 60 — a 3×
  difference in the only expensive part of the system.

### 14.2 First vertical slice (before any UI, inside M3)

One end-to-end file exercising every architectural risk simultaneously:

1. a malformed Windows-1251 Russian biography;
2. `<head>` CSS/base/title evidence, plus a script, an event handler and a PHP island to quarantine;
3. Russian prose containing a manual wrap, a removable soft hyphen, one valid split-word join, and one
   genuine hyphenated compound that must survive;
4. one linked portrait and one meaningful side-rail item;
5. one simple resource table → classic Markdown table;
6. one cover-plus-track layout table with a span or nested table → simplest correct form;
7. parse5 repair + sanitation report + measurement + screenshots;
8. Source/Table/Text IR and a debug view;
9. deterministic conversion of every unambiguous region;
10. one `table.classify` item in a validated multi-item envelope, plus a dry-run budget report;
11. BioMD AST → serialize → conservation report.

This tests the architectural risk directly. Building a crawler, multi-format ingestion or a polished
editor first would prove nothing about the table/layout approach.

Then a **25–50-file stratified pilot** selected by encoding, family fingerprint, table complexity,
sanitation signals and rejoin risk. Freeze thresholds, run all 1 000 with `--llm off`, and only then
authorize paid batches.

---

## 15. Feasibility assessment

The user asked directly whether this is buildable and whether it is over-engineered. Both plans
avoided the question. Here is the honest answer.

### 15.1 Effort and confidence, component by component

| Component | Size | Confidence | Note |
|---|---|---|---|
| Encoding cascade | ~300 LOC | **High** | Well-understood; the guides' version already works |
| Quarantine + parse5 + S1 | ~400 LOC | **High** | Mostly library orchestration; offset preservation is the only subtlety |
| BioMD AST + serializer + validator | ~600 LOC | **High** | The best-bounded component in the system. `mdast-util-to-markdown` does the hard part |
| Grid materialization | ~200 LOC | **High** | A specified algorithm with a known answer |
| Link policy + rewrites | ~150 LOC | **High** | Pure functions with an existing example table as fixtures |
| Conservation + ledger framework | ~350 LOC | **High** | Shingling and multiset diffs are simple; the pass contract (§6.4) makes totality mechanical |
| De-hyphenation cascade | ~250 LOC + fixtures | **Medium-high** | The cascade is simple; the fixture set is the actual work |
| Playwright measurement + determinism | ~450 LOC | **Medium** | Straightforward to write, fiddly to make *reproducible*. Font pinning and asset substitution will each cost a day |
| Corpus pass (fingerprints, families, lexicon) | ~500 LOC | **Medium** | SimHash and clustering are standard; *threshold tuning is empirical* and will take iteration |
| Block segmentation | ~350 LOC | **Medium-low** | Heuristic. Expect three or four rewrites against real pages. Plan for it |
| Structure recovery | ~800 LOC | **Medium-low** | The genuine work. Cannot be specified fully in advance; grows with the corpus |
| Hook runtime + patch validator | ~600 LOC | **Medium-high** | Well-understood plumbing; the validator's precondition checks need care |
| CLI + job store + resume | ~400 LOC | **High** | Ordinary engineering |

**Core total: roughly 5 000 lines of real logic plus tests** — a genuinely tractable project. With
AI-assisted implementation and the milestone ordering above, **M0–M3 (a working deterministic
converter) is realistic in 6–8 focused weeks**; M4–M6 add 4–6 more. M7–M8 are open-ended tuning.

### 15.2 Cut list — what to drop or defer, and why

Both input plans over-scoped. Cut now:

| Item | Verdict | Reason |
|---|---|---|
| Nu Html Checker / `conforming-clean-html` | **Cut** (user decision 2) | Java dependency for a claim nothing downstream consumes |
| PostCSS style evidence | **Cut** | Computed styles subsume it once measurement is always-on |
| Tidy differential-repair comparison | **Defer** | Both plans agree Tidy is off-path; a differential harness for a fallback that rarely fires is premature |
| SQLite corpus index | **Defer** | JSONL + in-memory index handles 1 000 files. Keep the `Store` interface so the swap is cheap |
| Tier-2 GBM classifier | **Defer to M7** | Needs labels that do not exist yet |
| Full review UI (Fastify + React) | **Defer** | A static HTML contact sheet — source crop, output, decision trail — gets 80 % of the value for 5 % of the work |
| Self-consistency sampling | **Cut** | Multiplies cost for a marginal gain the confidence cascade already provides |
| Multi-format ingestion (DOC/PDF) | **Cut from v1** | Not in scope; the IR does not need to anticipate it |
| Per-family recipe induction | **Downgrade** | See §15.3 |

### 15.3 The three things most likely to go wrong

**1. Recipe induction may not pay off.** Plan B treats per-family recipes as the primary cost lever
(~20 calls covering the bulk). That holds only if families are structurally *tight* — if pages within
a family differ in region layout, an induced selector-based recipe will match poorly and either fail
its guards (safe, but no saving) or pass them while producing wrong output (unsafe, though the
conservation gate catches most of it). **Mitigation:** item-level batching (§9.6b) is simpler,
independent, and already delivers a >10× reduction. Build it first. Treat recipes as an optimization
enabled by M3's measured family distribution, not as a load-bearing assumption. The plan is designed so
that recipes failing entirely costs a constant factor, not the architecture.

**2. Block segmentation and structure recovery cannot be specified in advance.** These two components
— ~1 150 LOC of the ~5 000 — are irreducibly heuristic. No plan, this one included, can specify them
correctly before seeing real geometry from real pages. **Mitigation:** the M2-before-M5 ordering exists
precisely for this. Budget for iteration, keep the golden corpus and metric harness from M0 so each
rewrite is measurable rather than a matter of opinion, and accept that the first version will be wrong
in ways only the corpus can reveal.

**3. Ledger totality is a tax on every pass.** The invariant is right, but if it depends on developer
discipline across fourteen passes it will erode. **Mitigation:** §6.4 makes it a runtime assertion in
the pass framework. Enforce it from the first pass written, never retrofit it — a ledger added at pass
nine is a ledger with eight holes.

### 15.4 Is it over-engineered?

**In its merged form, no — with two qualifications.**

The load-bearing parts each pay for themselves directly:

- **measurement** converts the reported failure from guesswork into lookup *and* is the largest single
  cost reduction — correctness and economics are the same lever here;
- the **typed AST** makes an entire class of bugs unrepresentable for maybe 600 lines;
- the **ledger + conservation gate** is the only mechanism that catches silent content loss, which
  §12.6/C4 confirms the renderer will never surface;
- **hook typing + caching** is what makes LLM behavior reproducible and diffable at all.

Remove any of those four and the system regresses to the current one with more infrastructure.

The two qualifications: the **artifact chain** (§13.1) is more ceremony than a 1 000-file job strictly
requires — it is justified only because migration is a one-way operation over irreplaceable content,
and an unauditable bad run is worse than a slow one. And the **four-tier cascade** is only worth its
complexity if Tier 1 genuinely absorbs the majority; M3 measures that, and if Tier 1 lands below ~50 %,
collapse Tiers 2 and 3 into one rather than maintaining both.

### 15.5 Verdict

**Buildable, and I can implement it.** The deterministic core (M0–M3) is conventional compiler
engineering against well-understood libraries, and I have high confidence in it — that is also the
milestone that must produce usable output on its own, so the project has value before any model is
called. The semantic layer (M5) is where genuine uncertainty lives, and the plan is deliberately
structured so that uncertainty is *measured at M3* rather than discovered at M8.

The most important property of this plan is not any single technique. It is that **the cheap,
high-confidence work comes first and produces a working converter, and every expensive or uncertain
addition is gated on a measurement taken by the stage before it.**

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Wrong Cyrillic decoding produces plausible but false text | Standards sniff + multiple scored candidates + round-trip and plausibility scoring + review threshold |
| Repair changes author intent | Immutable source, byte spans, synthetic-node flags, conservation gates |
| **Sanitizing before measuring** silently destroys all layout evidence | Explicit S1/S2 split; custom sanitizer, never `rehype-sanitize` defaults; a geometry snapshot test on a fixture with `<style>` in `<head>` |
| Script/PHP survives malformed parsing | Pre-parse quarantine + post-sanitize active-content scan, fail closed |
| Rendering non-determinism (fonts, Chromium version) | Pinned browser + bundled fonts + fixed viewport + hinting off; geometry snapshot tests |
| Missing assets distort geometry | Placeholder honouring `width`/`height`; asset index; `asset_missing` audit |
| **De-hyphenation joins a lexical hyphen** — conservation will *not* catch it | Dedicated `Hyph` fixture set and metric; geometry rule 2 decides most cases; every join a reversible ledger entry |
| Main-content extractor drops meaningful rails | Advisory masks only; full inventory retained; removal requires a decision |
| **`Green%` far below hope** — cost model collapses | M3 measures before budget is committed; remediation unit is a family (cheap), not a page (expensive) |
| **Recipes don't generalize** | Guard validation across the cluster + per-member conservation demotion; item batching as the independent fallback (§15.3) |
| Large batches contaminate or truncate answers | Homogeneous token-bounded items, no cross-item refs, independent validation, bounded retry |
| LLM follows prompt injection from source text | Source framed as untrusted evidence; constrained operations; immutable fields; schema + semantic validators |
| LLM output valid JSON but semantically unsafe | ID/precondition checks and post-patch conservation, not schema alone (§9.3) |
| **Gateway rewrites the prompt or response** (token-compression features) — invalidates cache keys and breaks byte-identical replay | R1 (§9.2): every compression engine disabled; transport probe test 4 asserts the request arrives unmodified; a gateway that cannot pass through verbatim is disqualified |
| **Gateway model alias silently remaps** — cache serves results from a different model | R2 (§9.2): cache key uses the *resolved* model read back from the response; assert requested = resolved and fail loudly rather than returning a hit |
| Gateway drops prompt caching or `/batches` | Cost only, never correctness (§9.6c). Verified working on LiteLLM; probe test 3 confirms per deployment; the dominant reductions are transport-independent |
| Gateway becomes a single point of failure or adds latency | Local decision cache means re-runs need no network at all; `--llm off` must always produce a usable run; gateway fallback/load-balancing (LiteLLM, OmniRoute) covers provider outages |
| **Over-simplification loses real structure** | `layoutFidelity` is a knob; both modes run from the same IR and diff; every flattening is a recorded `MERGE` |
| Chromium's tree ≠ parse5's tree | Reconcile by node path; log discrepancies, never resolve silently |
| BioMD cannot express a source relation | Decompose to safe linear semantics or queue review; **never invent syntax** |
| Renderer gaps widen or a fix lands | Conformance suite is the contract; re-enabling `divider`/`frame`/`signature` is a localized AST + fixture change |
| Engine overfits to ABC fixtures | Scope profile rules; retain confidence and evidence; evaluate on untouched layouts and mutation fixtures |
| Native tooling complicates Windows | WASM over native; pin binaries behind adapters; the parse5 path works without Tidy |
| Over-engineering / never ships | M3 must produce usable output with zero LLM calls; every later tier is additive; §15.2 cut list is a standing instruction |

---

## 17. Open questions

1. **Local assets offline?** Full offline rendering with real images produces materially better
   geometry than placeholder substitution. Affects M2 quality directly.
2. **How many page families?** The single number that most determines total spend. M3 measures it;
   it also decides whether §9.6a recipes are worth building at all.
3. **Labelled fixtures.** How many `*.right.bio.md` / `*.wrong.bio.md` pairs exist? Determines whether
   M7's classifier can train now or must wait for review labels.
4. **Editorial policy for ABC.** Which `TextOperation` kinds are enabled? Default is mechanical-only —
   note `join-hyphenated-word` is in the mechanical set and therefore **on by default**; demote it
   explicitly if that is too aggressive.
5. **Language coverage.** Russian-only for the first batch, or already mixed `ru`/`en`/`de`?
   Hyphenation, sentence segmentation and the lexicon are all per-language.
6. **C2 — leading zeros.** Confirm accepting the loss (recommended), or track a renderer request.
7. **`nav` responsive behavior** was not verified (§12.5). One manual check before relying on it.
8. **Renderer patches.** Should the `divider` bug, `frame`/`signature` and the `splitPropsAndBody`
   landmine be tracked as a separate renderer work item? Out of scope here, but §12 is the write-up.
9. **Which gateway, and is it already deployed?** LiteLLM is recommended (§9.2) because it is the only
   candidate confirmed to carry every capability the plan uses. Two things to settle before M4: does
   the deployment expose an **Anthropic-native `/v1/messages` passthrough** (cheapest route to keeping
   `cache_control` intact), and does it proxy **`/batches`** (the 0.5× discount)? Both are
   cost-only questions — neither blocks correctness.
10. **Which models are reachable through the gateway, under what alias?** §9.4 routes Haiku/Sonnet/Opus
    tiers by cost. If the gateway exposes a different model mix, the routing table is profile data and
    adjusts freely — but the tier *ordering* must stay monotonic in capability, or escalation stops
    meaning anything.

---

## 18. Sources

**Parsing, repair, encoding**
[parse5](https://parse5.js.org/) ·
[WHATWG HTML parsing & encoding sniffing](https://html.spec.whatwg.org/multipage/parsing.html) ·
[html-encoding-sniffer](https://www.npmjs.com/package/html-encoding-sniffer) ·
[iconv-lite](https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings) ·
[chardet](https://www.npmjs.com/package/chardet) ·
[tidy-html5](https://github.com/htacg/tidy-html5) ·
[htmltidy2](https://github.com/c0b41/htmltidy2) ·
[tag-soup](https://github.com/smikhalevski/tag-soup) ·
[php-parser](https://github.com/glayzzle/php-parser) ·
[hast-util-sanitize](https://github.com/syntax-tree/hast-util-sanitize) ·
[Nu Html Checker](https://github.com/validator/validator) *(deferred)*

**Layout analysis**
[Classification of Layout vs. Relational Tables on the Web — ACM TWEB](https://dl.acm.org/doi/10.1145/3555349) ·
[Layout tables vs data tables — PowerMapper](https://www.powermapper.com/blog/layout-tables-vs-data-tables/) ·
[Trafilatura deduplication / SimHash](https://trafilatura.readthedocs.io/en/latest/deduplication.html) ·
[Playwright request interception](https://playwright.dev/docs/api/class-route)

**AST and serialization**
[rehype](https://github.com/rehypejs/rehype) ·
[mdast](https://github.com/syntax-tree/mdast) ·
[remark-gfm](https://github.com/remarkjs/remark-gfm) ·
[micromark-extension-directive](https://github.com/micromark/micromark-extension-directive) ·
[remark-directive](https://github.com/remarkjs/remark-directive)

**Conversion candidates evaluated**
[turndown](https://github.com/mixmark-io/turndown) ·
[breakdance](https://github.com/breakdance/breakdance) ·
[mdream](https://github.com/harlan-zw/mdream) ·
[get-md](https://github.com/Nano-Collective/get-md) ·
[all2md](https://github.com/thomas-villani/all2md) ·
[lightfeed/extractor](https://github.com/lightfeed/extractor) ·
[JohannesKaufmann/html-to-markdown](https://github.com/JohannesKaufmann/html-to-markdown) ·
[xberg-io/html-to-markdown](https://github.com/xberg-io/html-to-markdown) ·
[Readability](https://github.com/mozilla/readability) ·
[Defuddle](https://github.com/kepano/defuddle)

**Hyphenation**
[Hyphenopoly](https://github.com/mnater/Hyphenopoly) *(patterns verified: `ru`, `uk`, `de`, `en-us`, `en-gb`)* ·
[hyphenator.js — superseded](https://github.com/mnater/hyphenator) ·
[ytiurin/hyphen](https://github.com/ytiurin/hyphen) ·
[hunspell/hyphen](https://github.com/hunspell/hyphen) ·
[ekmett/hyphenation](https://github.com/ekmett/hyphenation) ·
[halostatue/text-hyphen](https://github.com/halostatue/text-hyphen) ·
[pyphen](https://github.com/Kozea/Pyphen) *(Python path)*

**Schemas, runtime**
[Zod](https://zod.dev/) ·
[Ajv](https://ajv.js.org/json-schema.html) ·
[Node.js 24 LTS](https://nodejs.org/en/download)

**LLM gateways and transport** (§9.2)
[LiteLLM](https://github.com/BerriAI/litellm) — *recommended*; [prompt-caching docs](https://docs.litellm.ai/docs/completion/prompt_caching) confirm `cache_control` passthrough with cache-token reporting ·
[OmniRoute](https://github.com/diegosouzapw/OmniRoute) ·
[9router](https://github.com/decolua/9router) ·
[`openai` npm — custom `baseURL`](https://github.com/openai/openai-node) ·
[Vercel AI SDK — OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers) ·
[Anthropic SDK](https://docs.claude.com/en/api/client-sdks) *(second adapter, via a gateway `/v1/messages` passthrough only)*
