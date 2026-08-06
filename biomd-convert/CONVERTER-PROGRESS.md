# BioMD converter: verification of the assessment, and what changed

This is the follow-up to `CONVERTER-ASSESSMENT.md`. It records (1) which of that
document's claims reproduce, (2) which of its conclusions the evidence does not
support, (3) the recovery passes implemented since, with measured effect, and
(4) what is left, separated into what a rule can still reach and what cannot.

Every number here comes from `npm run build && node dist/cli/index.js corpus run`
followed by `biomd eval` over the 13 reference pairs, with Chromium measurement
on, `spec-1.6`, `layoutFidelity: faithful`, and **LLM off**. The bench workspace
(`bench/`) reproduces it in one command: `sh bench/run.sh`.

---

## 1. Result

| | baseline | now |
|---|---:|---:|
| Weighted similarity to `fixtures/out` | **82.33 %** | **87.61 %** |
| Unit tests | 216 pass | 239 pass |
| Validation errors across the corpus | 15 | 14 |
| — of which structural (`h1-count`, `heading-skips-level`) | 2 | **0** |
| Image `src` conservation | 100 % recall, 21 spurious | 100 % recall, **3** spurious |
| Image size tokens (`full`/`large`/`medium`/`small`) | 16 / 32 / … / … | 0 / 9 / 48 / 38 |
| Reference size tokens | — | 0 / 17 / 45 / 33 |
| Phantom "extra target" conservation reports | several hundred | **0** |

Per document — **stale, does not reproduce; see §6.1 for the measured values.** The
aggregate above is trustworthy; this breakdown is not. Re-measure before citing it.

| file | before | after | Δ |
|---|---:|---:|---:|
| segovia1 | 71.6 | 91.0 | **+19.4** |
| borislova | 78.2 | 90.0 | **+11.8** |
| pavlov_azancheev | 91.1 | 99.3 | **+8.2** |
| news | 86.8 | 93.3 | +6.5 |
| tarrega | 77.5 | 83.7 | +6.2 |
| news_2007 | 89.5 | 95.5 | +6.0 |
| jovicic | 80.5 | 84.2 | +3.7 |
| goya2 | 81.7 | 85.4 | +3.6 |
| williams2 | 85.3 | 86.9 | +1.6 |
| authors | 84.7 | 85.8 | +1.1 |
| barrios | 79.2 | 80.3 | +1.1 |
| kiselev | 87.0 | 87.9 | +0.9 |
| segovia | 77.1 | 75.7 | −1.4 |

---

## 2. Where the assessment was right

Reproduced exactly: the 82.33 % baseline, the 216 passing tests, the 15
validation errors, the 0 % clean share, and the 27 unresolved escalation points.
Its architectural reading of the front half — decoding, parse5 repair, Chromium
measurement, the physical occupancy grid, the typed AST/serializer/validator,
the ledger, the transport layer — is correct and none of it needed changing.

Its diagnosis of the *symptoms* was also right: no captions, no `align`, no
`frame`, no `images`, far too few headings, far too many hard breaks, image
sizes read off the wrong box.

## 3. Where the evidence contradicts it

**3.1 The defect was not principally a missing IR.** The assessment's headline
recommendation is to stop tuning and build a semantic intermediate
representation first. Read against the corpus, most of the observed loss came
from a small number of *local, identifiable* defects, each of which is a
one-place fix in the existing lowering path:

- the serializer was configured with `resourceLink: false`, so every link whose
  label equalled its href — the whole "sources" section of a legacy page —
  serialized as a `<https://…>` autolink, which is not a construct the BioMD
  renderer recognises. One line. **+0.4 points.**
- `flushInline()` looked for `<img>` among the run's *direct children*, so
  `<a href=big><img src=thumb>` — the most common standalone figure in this
  corpus — never became `::: image`. **+0.4 points**, and 19 of segovia1's
  19 image directives.
- `collapseAdjacentText()` trimmed breaks at the edges of *every* inline run,
  including nested ones, so the break in `<b>1989<br></b>` was deleted before
  anything could see it. Every bold label that owned its own line was absorbed
  into the paragraph below it.
- `isCentered()` in `prominence.ts` read the `align` attribute even when the
  page had been rendered. `align` is a *presentational hint* and loses to author
  CSS: `<p class="t" align="center">` under `.t { text-align: Justify }` renders
  justified. Browser inspection of `pavlov_azancheev.htm` confirmed only
  `.t3` is centred, while the attribute walk called eleven different classes
  centred. This single misreading was why centring could not be used as
  evidence at all.

None of these needed a new representation. They needed the evidence already
collected to be read correctly.

**3.2 The reference set has a hard deterministic ceiling, and the assessment's
promotion targets ignore it.** A measurable share of the remaining gap is
editorial work the human migrator did and no rule may do:

- **9 of the 34 still-missing headings do not occur in the source at all** —
  `## Избранные записи`, `## Ноты и медиаматериалы`, `## Аудио`,
  `## Полное собрание сочинений`. They were invented to give a page an outline.
- reference prose is copyedited: `гитарист виртуоз` → `гитарист-виртуоз`,
  `(1913-42)` → `(1913–1942)`, `"…"` → `«…»`, `в г. Киеве` → `в Киеве`,
  `В 30-ти тт.` → `в 30 томах`. `jovicic` loses 34 points of text F1 to
  rewriting alone (`югославский и сербский` vs the source's
  `югославский сербский`), and `authors` and `barrios` lose ~26 each.
- `segovia`'s reference simply *deletes* a whole MP3 track table.

So a target of "heading F1 ≥ 95 % corpus-wide" is not reachable against this
reference set by any deterministic converter, and reaching it by other means
would mean inventing text — which §16.3 forbids. **The target should be stated
against the source-backed subset**, and the invented-heading cases are precisely
where an LLM hook has something to contribute that a rule does not.

**3.3 The eval harness silently scored stale output.** `corpus run` catches a
per-file exception and reports `FAILED`, but `biomd eval` happily scores
whatever `.bio.md` files are lying in the output directory. During this work a
regex bug crashed three conversions and the next two measurements were partly
meaningless. `bench/run.sh` now clears the output directory and refuses to print
a score if any conversion failed. **Any refinement loop needs this gate before
it needs anything else.**

---

## 4. What was implemented

New modules: `convert-core/lines.ts` (break-run segmentation),
`convert-core/media.ts` (decorative filter, size calibration, caption source,
grouping), `convert-core/frames.ts` (border palette and frame evidence).
`convert-core/recovery.test.ts` holds 23 behavioural contracts, one per shape
below.

### 4.1 Break-run segmentation (§4.5 of the assessment)

A run is now cut into lines at `<br>`, lines into groups at blank lines, and
each single break is classified `WRAP` (a hand-wrapped sentence → a space) or
`LINEATION` (a line the author drew → a hard break), with verse, addresses and
track lists decided for the group as a whole. Breaks are hoisted out of the
emphasis that encloses them first, so `<b>1989<br></b>` is visible as a line.

This is what made the rest possible: figures, captions and section labels are
all *lines*, and before this pass nothing could see a line.

### 4.2 Media binding (§4.7)

- size tokens are computed against the **article content box** — the first
  quartile of the widths of blocks carrying real prose — not the nearest
  measured ancestor. The token distribution now tracks the reference set
  (0 `full` / 9 `large` / 48 `medium` / 38 `small` against 0/17/45/33); it was
  16 `full` / 32 `large`.
- `alt` is copied to `caption`, which §7.1 explicitly permits for a corpus like
  this one and which all 13 references do.
- a caption line under an uncaptioned centred picture is bound to it
  (`segovia1`: 19 of 19 captions).
- ≥2 adjacent images with no prose between them become `::: images`.
- a link wrapping a single image becomes one `::: image` with `link:`.
- decorative furniture is dropped on rendered geometry, not on filename:
  spacers, ≤14 px glyphs, flat unlabelled badges, banner strips. A link whose
  only label was a nav arrow keeps its destination as its label.

### 4.3 Outline recovery (§4.6)

Four detectors, each requiring **recurrence** rather than a single-block
threshold, because every one of them has a near-identical false friend
(a caption, a menu label, a record label, a copyright note):

| detector | evidence | reaches |
|---|---|---|
| line label | a bold or all-caps line owning its line, with a body after it | segovia1, borislova years |
| centred cluster | ≥3 blocks sharing a tag/class signature, centred on a page whose prose is not, separated by prose | pavlov `.t3` |
| bulleted entry | ≥3 `•`-prefixed short blocks each followed by a body | pavlov's 12 letters |
| entry date | ≥2 paragraphs whose whole text is a date | news_2007 |
| label before a list | ≥2 short labels sitting on a `<ul>` | discography sections |

Plus three structural rules: a two-line masthead becomes `#` + an italic
subtitle (§2.1); a label directly above a menu becomes that menu's `title`
(§11); and a label recovered inside a *nested* region gets `###`, unless the
region produces more than four of them, in which case they are record labels
and not sections at all.

`pavlov_azancheev` went from 1 heading to 16 of 16.

### 4.4 Invariants instead of findings (§6 P0)

`enforceSingleTitle()` runs before serialization: exactly one `#`, and no level
skips. Both were previously left for the validator to report on a file that had
already been written. Both structural validation errors are now zero.

### 4.5 `frame` and `align` (§4.2, §4.8)

`borderColor` was added to the measured style — it was the one piece of
evidence §12 needs that measurement was not collecting. A cell with a ≥2 px
border in a colour the author *chose* (a border colour equal to the text colour
is the CSS default, not a choice) becomes `::: frame` with the mapped palette,
downgraded to a blockquote on a profile that cannot draw it. `normalize()` no
longer unwraps a single-cell table whose cell carries that border.

`::: align` is emitted only inside a `column`, only for a wholly-bold short
label, and never inside a `frame` — the shape of a record card's title over its
cover. Scoping it this narrowly is what stopped it from wrapping captions and
obituary lines.

### 4.6 Smaller corrections

`resourceLink: true`; adjacent anchors sharing one target are merged per §11
(`[1995](x)[-2002](x)` → `[1995-2002](x)`); `visual: always` now fails the run
instead of silently substituting `NullMeasurer`.

`layoutFrom()` was the cause of the assessment's second P0 — "conservation
reports count expected output assets as extra". The lane attempt walks every
cell, and when it does not yield two usable columns it fell through to the
flow path *without rolling back*, leaving that whole region's links and images
in the inventory a second and third time. `news` reported ~100 phantom extra
targets. It now takes a snapshot like the data-table path already did.
Spurious conservation reports across the corpus: **0**, was several hundred.

---

## 5. What is left, and what it is worth

**Deterministically reachable (est. +3 to +4 points):**

1. **Catalog row-pattern segmentation** — 114 of the 127 still-missing
   directives are `columns`/`column`, essentially all in `goya2`, whose
   reference emits one `columns` pair per album (label | cover) and one per
   track range, separated by `---`. `layoutFrom()` still emits one persistent
   lane per physical column. This is the assessment's §4.3 and its diagnosis is
   correct.
2. **Table continuation rows** — `tarrega` scores 78 on cells because a "Ноты"
   row continues the work above it and should merge into that row's fourth
   column, not become a row of its own. `data-table.ts` already has the
   machinery; the merge predicate is what is missing.
3. **Empty table headers** — 12 of the 14 remaining validation errors. The
   source states no column model; §16.3 forbids inventing one. This is exactly
   what the existing `table.records` hook is for, and it already resolves all
   12 when the LLM is enabled.

**Not deterministically reachable — hook territory:**

4. inventing an outline for a page that has none (9 headings);
5. copyediting: typographic quotes and dashes, expanding `(1913-42)`,
   dropping `г.` before a city;
6. de-hyphenating a wrap artifact that left no newline behind
   (`классиче-ской`) — the corpus lexicon can attest the joined form, but the
   references are themselves inconsistent about this, so it is invisible to the
   metric and should be decided on output quality, not on score.

**Method note for whoever continues:** every regression in this work came from a
detector that fired on a single block's typography. Every detector that held up
required the *same shape to recur* on the page, with content between the
occurrences. That is the generalizable lesson from these 13 pages, and it is
also the cheapest possible stand-in for the assessment's page-archetype model.

---

## 6. Iteration 0 — the evaluation ladder replaces the scalar (2026-08-06)

No converter rule was changed in this phase. Everything below is instrumentation,
measurement and the defect ledger that now decides what work happens. The
unchanged L1 number is therefore expected, and is not evidence of quality.

### 6.1 Baseline reproduced, with two reconciliations

`sh bench/run.sh`, LLM off, `spec-1.6`, `layoutFidelity: faithful`, Chromium
measurement on:

| | documented | measured 2026-08-06 |
|---|---:|---:|
| overall similarity | 87.61 % | **87.6 %** |
| unit tests | 239 | **263** (239 + 24 new L2 contracts) |
| validation errors | 14 | **14** |
| FAILED conversions | 0 | **0** |

Two things cost time once and should not cost it again:

- **The 14 errors come from the `corpus run` per-file `errors=` column**, not from
  `biomd validate`. The standalone `validate` command resolves a different profile
  and reports 1 error (a `line-too-long` in `williams2`). The two are not
  comparable; do not treat a disagreement between them as a regression.
- **§1's per-document table does not reproduce.** Measured now: authors 95.1 ·
  barrios 80.3 · borislova 70.2 · goya2 85.4 · jovicic 97.7 · kiselev 91.3 ·
  news 84.8 · news_2007 74.1 · pavlov_azancheev 92.7 · segovia 94.5 ·
  segovia1 94.6 · tarrega 81.5 · williams2 97.2. Both sets average to 87.6 and two
  entries (goya2, barrios) agree exactly, so the aggregate is trustworthy and the
  breakdown is stale. **§1's per-document column is historical — re-measure before
  citing any number from it.**

### 6.2 Why the scalar score could not be the instrument

Verified from the code, and the reason L2 exists. `src/eval/score.ts` averages seven multiset
F1 axes; each of the following is invisible to it **by construction**, and each is where the
remaining defects live:

- `eval/facts.ts:36` — `directives: Map<string, number>`, name → count. **Every directive
  property is invisible**: an `::: image` with the wrong `size`, `position`, `caption` or
  `link` scores identically to a correct one.
- `links` and `images` fold through `foldTarget` — **a correct target under a wrong label
  scores perfect**.
- `TableFacts` carries `cols`, `rows`, `header[]`, `cells[]` as flat multisets — **which cell
  sits in which row and column is invisible**, as is per-column alignment.
- text is a word-3-gram multiset over `normalizeForCompare`
  (`convert-core/conservation.ts:102`), which lowercases, strips soft hyphens and folds
  intra-word hyphens — so **block order, blank-line structure, hard breaks, emphasis, case and
  typography are invisible**, and de-hyphenation quality is invisible by construction.
- headings carry level (`facts.ts:132`, `level\tlabel`) but as a multiset — **position, order
  and nesting are invisible**.
- nothing measures containment (an image inside vs outside a `::: column`), `---` separators,
  list nesting, or block ordering.

L2 has one contract test per item above, so a regression that quietly collapses the ladder
back to a scalar fails the suite.

### 6.3 L2 implemented

| module | role |
|---|---|
| `src/eval/blocks.ts` | `.bio.md` → typed, line-numbered block tree; resolves what `biomd-ast/read()` leaves as opaque Markdown runs |
| `src/eval/structdiff.ts` | Needleman–Wunsch sibling alignment + global reconciliation → typed findings |
| `src/eval/triage.ts` | three-way source backing against the decoded `.htm` |
| `src/eval/rollup.ts` | defect ledger, ranked by `instances × severity × generality` |
| `src/eval/structdiff.test.ts` | 24 contracts: identity, determinism, one test per scalar blind spot, classification, triage |

Surfaced as `biomd diff [produced] [reference]` with `--doc`, `--class`,
`--backing`, `-v`, `--json`. Diagnostic-only: `convert-core` must never import it.
Corpus roll-up regenerates `analyze/defects.json`:

```bash
cd biomd-convert && node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json
```

Held to two properties, asserted in the test file: **identity** — the same
document on both sides yields zero findings, over all thirteen references; and
**determinism** — same inputs, byte-identical findings.

### 6.4 The ledger — `analyze/defects.json`, 707 findings

598 source-backed · 77 ambiguous · 32 ceiling. 97 critical · 325 major · 285 minor.
80 classes over 13 documents.

| class | inst | docs | rank |
|---|---:|---:|---:|
| `paragraph.spurious` | 65 | 12 | 3900 |
| `paragraph.containment` | 38 | 8 | 912 |
| `retyped.paragraph-to-align` | 25 | 9 | 675 |
| `column.missing` | 25 | 5 | 375 |
| `retyped.paragraph-to-column` | 18 | 6 | 324 |
| `break.missing` | 63 | 5 | 315 |
| `align.missing` | 14 | 6 | 252 |
| `retyped.paragraph-to-columns` | 20 | 3 | 180 |
| `image.missing` | 14 | 4 | 168 |
| `paragraph.hyphenation` | 19 | 7 | 98 |

Ceiling, correctly separated and excluded from targets: `table.header.cell` (21, 4
documents — precisely §5.3's empty-header hook territory),
`table.cell.typography.dash` (4), `table.cell.content.empty` (2).

### 6.5 Confirmed instrument defects

All three were found by the L2 contract tests, not by inspection. Each is a class
of bug, not an instance, and each is fixed at the class level.

1. **Alignment traceback reconstructed its path by float equality** against the
   cost matrix. A one-ulp disagreement fell through every branch, the fallback
   decremented `j` past zero, and the walk never terminated — an infinite hang on
   `goya2`. Replaced with stored backpointers; the fill's decision is now recorded
   rather than re-derived.
2. **Similarity tokenized without folding intra-word hyphens.** A paragraph scored
   **zero** against its own de-hyphenated self, so the aligner refused to pair
   them and the `hyphenation` class the instrument exists to raise could never
   fire — the blind spot sitting exactly on top of the defect.
3. **Triage tested structural findings by text attestation.** That put
   `columns.missing` (43 instances, 5 documents) — the largest deterministically
   reachable class in the corpus, named as reachable in §5.1 — in the *ceiling*
   list. `Biography-Markup.md` §16.3 forbids inventing **text**; wrapping text that
   is already present in a `::: columns`, splitting a lane, drawing a `---` or
   reading a size off geometry invents nothing. Every finding now carries
   `evidence: "content" | "structure"`, and structure is never attested.

**Killed hypotheses.** Two readings were falsified during this phase and should not
be re-derived: that a document's blocks can be adjudicated by *sibling* alignment
alone — containment defects are invisible to it by construction, and on `goya2` one
mechanism defect appeared as 42 unrelated `paragraph.spurious` findings until
reconciliation was made global; and that two paragraphs with no shared vocabulary
should be reported as one rewritten paragraph — they are a deletion and an
insertion with different owning rules, and collapsing them hides the deletion.

### 6.6 L5 calibration — L2 against the human record

Agreement is high: every per-page complaint in `analyze/analyze.md` maps onto an
emitted class.

| human complaint | L2 class |
|---|---|
| williams2 `**- 2 -**` centred; segovia1 / pavlov / news / authors alignment | `retyped.paragraph-to-align`, `align.missing` |
| williams2, news_2007: right-hand menu folds into the flow | `nav.missing`, `nav.title.missing` |
| williams2 5/6/8, segovia: caption text repeated as a paragraph below the figure | `paragraph.spurious` |
| williams2 4, tarrega 2: figure earlier than the paragraph it belongs to | `image.containment`, `image.moved` |
| tarrega 1, segovia, pavlov, news: escaped or drawn rules should be separators | `retyped.paragraph-to-break`, `break.missing` |
| tarrega 3: multi-block region wrongly wrapped in a blockquote | `retyped.quote-to-*` |
| tarrega: dotted-leader pseudo-tables should become tables | `retyped.paragraph-to-table` |
| segovia, pavlov, kiselev, jovicic, barrios, authors, news: de-hyphenation | `paragraph.hyphenation` |
| segovia, authors: caption truncated or taken from the wrong block | `image.caption.content` |
| kiselev, jovicic: song lists shown as quotes | `retyped.quote-to-list` |
| kiselev: table read as 3 columns, should be 2 | `table.geometry.cols` |
| kiselev, barrios, tarrega, segovia: guessed table headers wrong | `table.header.cell` — triaged as **ceiling** |
| goya2: one lane per column instead of one pair per album | `columns.missing`, `column.missing`, `break.missing`, `paragraph.containment`, `retyped.paragraph-to-column` |
| borislova: 2-column table at the end not recognised | `table.missing` |
| barrios: one table per disc | `table.*`, `columns.*` |
| news: repeated site masthead must be dropped | `image.spurious`, `paragraph.spurious` |
| news: frames not recognised | `frame.missing` |
| authors: separators too sparse; image sizes imprecise | `break.missing`, `image.size.value` |

Confirmed by probe, not by reading: **4 `paragraph.spurious` findings repeat
verbatim a `caption:` already bound in the same document** (williams2 ×2, segovia,
news) — exactly the defect `analyze.md` names for williams2 items 5/6/8.

### 6.7 Known instrument weaknesses — what to distrust first

- **The `ambiguous` band is set, not calibrated.** Triage routes a finding to
  `ambiguous` on a word-coverage corridor of 0.5–0.95. Those bounds were chosen.
  77 findings sit in that band and none of them has been checked by hand.
- **Global reconciliation pairs at similarity ≥ 0.65.** The 38
  `paragraph.containment` findings depend on that constant, and the stability of
  the class split under 0.55 or 0.75 has not been measured.
- **L2 cannot answer the project's actual question.** Whether a defensible layout
  reads as the migrator's intent, and whether the produced layout is visually
  equal to or better than the source, are L3/L4 questions. L2 silence is not
  evidence of quality.
- **Two requests in `analyze.md` are proposals, not reference-attested defects** —
  replacing a bare URL label with a link glyph, and abstracting guessed table
  headers. Check `fixtures/out/` before treating either as work.

### 6.8 Holdout

Round 1 development set: goya2, news, borislova, pavlov_azancheev, segovia,
kiselev, tarrega, williams2, jovicic. **Holdout: barrios, news_2007, segovia1,
authors.**

Stated honestly: `analyze/analyze.md` is one file covering all thirteen pages and
has been read in full. This is a **tuning** holdout — no rule is designed against
holdout output and no holdout measurement is taken until the rule and its tests
are written — not an *unseen* holdout. Rotate it each round and report both sides.

---

## 7. L3 — built and calibrated (2026-08-06)

The phase gate is cleared. L3 renders `.bio.md` to HTML, probes the rendered
geometry in Chromium, and adjudicates three surfaces against each other: source
`.htm` ↔ produced `.bio.md` ↔ reference `.bio.md`. No converter rule was changed
building it.

### 7.1 What was implemented

| module | role |
|---|---|
| `src/l3/render.ts` | `.bio.md` → deterministic HTML, from `Biography-Markup.md` + the target model in `biomd-ast/read.ts`. One entry point, no side parameter. |
| `src/l3/geometry.ts` | the vocabulary: vendor/logical `text-align` folding, box-derived alignment, the page's own prose baseline, row banding, reading rank, overflow, lanes |
| `src/l3/probe.ts` | Chromium harness. Same launch flags, viewport, offline routing and asset placeholder as `ladom/measure.ts` |
| `src/l3/compare.ts` | rendered surfaces → localized findings + the alignment evidence table |
| `src/l3/render.test.ts` | 38 contracts |
| `tools/render-biomd.ts` | the runnable entry `CLAUDE.md` §4 names; argument handling only |

Surfaced as two commands:

```bash
cd biomd-convert && node dist/cli/index.js render -c bench/biomd.config.json
```
```bash
cd biomd-convert && node dist/cli/index.js l3 -c bench/biomd.config.json --json ../analyze/l3.json
```

`render` writes 26 pages plus a launcher to `analyze/rendered`; with the
`rendered` server (8124) and `fixtures` server (8123) from `.claude/launch.json`
the three surfaces of any document are one click apart.

**Implementation note on placement.** `CLAUDE.md` names `tools/render-biomd.ts`.
The renderer itself lives in `src/l3/` — `tsconfig` has `rootDir: src`, so a
`tools/` implementation would be neither typechecked, tested, nor built, and L2
set the precedent by living in `src/eval/`. `tools/render-biomd.ts` is the
runnable surface and contains no rendering logic, so there is exactly one
renderer, which is the invariant that matters.

### 7.2 The two properties, verified

- **Identity.** Every reference rendered against itself, all thirteen, through
  Chromium: **0 findings**. Asserted at unit level too, on synthetic probes.
- **Determinism.** Two full corpus runs, byte-identical JSON. The renderer is a
  pure function of its input; the probe rounds to 0.01 px because sub-ulp jitter
  would break finding-id stability.

### 7.3 Target quirks are modelled, not fixed

`read()` documents where the target diverges from the specification. L3
reproduces the *consequences*, because rendering the author's intent instead
would hide the corruption:

- a `divider:` or `columns:` line inside `::: columns` is **not** a property —
  the target promotes it to a synthetic first column, shifting every real column
  one track right. Rendered as such, outlined in red, `data-quirk` set. This is
  the layout consequence of the asymmetry `conformance.test.ts` already asserts,
  and it is why `divider` must never be emitted;
- `::: frame`'s `frame:` and `title:` lines likewise arrive as body text; the
  palette falls back to §11's default and the line renders as the paragraph a
  reader would actually see.

Three contracts assert the corruption is reproduced. A contributor "fixing" the
renderer to be more correct will fail them.

### 7.4 Calibration against the human record — L3 finds what `analyze.md` names

| `analyze.md` complaint | L3 finding | localized to |
|---|---|---|
| williams2 1 — `**- 2 -**` must be centred | `layout.align.mismatch`, referenceAlign `center` | ref line 9 |
| williams2 4 — `changes1.jpg` appears too early | `layout.order.mismatch` | ref 30 → produced 13 |
| williams2 9 — Bach/MP3 line right-aligned | `layout.align.mismatch`, referenceAlign `right` | ref line 98 |
| williams2 10 — closing credit right-aligned | `layout.align.mismatch`, referenceAlign `right` | ref line 104 |
| tarrega 2 — `tarrega1.jpg` misplaced | `layout.order.mismatch` | ref 21 → produced 117 |
| tarrega 3 — multi-block region wrongly a blockquote | 7 × `layout.containment.mismatch`, `quote` → `(root)` | ref 45, 46, 48, 51, 54, 65, 82 |
| goya2 — one lane per column, not one pair per album | 35 × `layout.containment.mismatch`, `(root)` → `columns>column` | per block |
| kiselev/jovicic — song lists shown as quotes | `quote` ↔ `(root)` containment | per block |

Every geometry-decidable complaint in the sampled pages maps to a finding with a
line number on both sides.

**Two findings L3 produced that no other rung can.**

1. **A defect in the reference set.** `pavlov_azancheev.bio.md` ended with an
   `::: align position: right` that was never closed — the file finished on a
   `---` — so the target would have swallowed the closing credit and the
   trailing rule into the right-aligned region. Invisible to L2 by construction:
   both sides go through the same reader, the identical mis-parse happens twice
   and cancels. Corrected in the reference on 2026-08-06. A regression test now
   asserts no reference leaves a fence open.
2. **`williams2` loses half its text measure, and L2 reports nothing.** The
   produced document wraps the whole article in a `::: columns` with **two**
   `::: column` children — prose in lane 1, the source's right-hand menu left as
   loose links in lane 2 — so every paragraph renders at **328 px instead of
   672 px**. The reference's `::: columns` has one child and renders at full
   measure. L2's 24 findings for `williams2` contain **zero** `column`/`columns`
   classes. §9 lists "forcing a narrow text measure" and "recreating page
   margins" as bad uses by name; only a renderer can see that this is one.

### 7.5 Corpus result, and what it says

`node dist/cli/index.js l3 -c bench/biomd.config.json`, 1024 px, 13 documents:

| class | inst | docs | severity |
|---|---:|---:|---|
| `layout.containment.mismatch` | 125 | 12 | major |
| `layout.align.mismatch` | 61 | 10 | major |
| `layout.lane.mismatch` | 25 | 7 | major |
| `layout.order.mismatch` | 24 | 9 | critical |

The containment findings are not noise — they decompose exactly onto the known
families: 35 `(root)`→`columns>column` (the catalog-row task, §8.2), 49 into an
`align` wrapper (the alignment task, §8.1), 22 `quote` ↔ `(root)` (the blockquote
anomaly `analyze.md` names for tarrega, kiselev and jovicic), 6 → `images`,
6 → `frame`.

### 7.6 One instrument defect found and fixed at the class level

`readingOrder` — a pairwise "same row?" test — is **not transitive**: A shares a
row with B and B with C while A and C do not overlap. Handed to
`Array.prototype.sort`, it yields an implementation-defined permutation, and two
such sorts can disagree for reasons that have nothing to do with the documents.
It manufactured one finding whose produced and reference ranks were **equal** — a
block reported as having moved past itself.

Replaced with `rowBands()` + `readingRanks()`: boxes are swept top to bottom and
each joins the open band when it overlaps that band's **anchor**, giving a total,
transitive, permutation-invariant order. Comparing against the anchor rather than
the band's running extent is what stops one tall cell absorbing the page. Three
contracts, including permutation invariance. Equal-rank findings: 0 of 24.

### 7.7 Stated limitations — what to distrust in L3

- **No asset tree, so picture boxes are token-derived.** Every image 404s by
  construction. A figure's box comes from its `size` token and a fixed 4:3 aspect
  ratio, never from an intrinsic size. L3 adjudicates *the layout the tokens
  produce*, not the layout the real pictures would produce. Aspect-ratio defects
  are outside its reach.
- **The renderer is a model of the target, not the target.** It is built from the
  spec and from `read()`. Where the real renderer differs in a way `read()` does
  not document, L3 is wrong in the same direction on both sides — the most
  dangerous error class, because a comparison cannot reveal it.
- **7 of 151 alignment rows have no source node.** Pairing is by rendered text,
  then image basename, then containment. A row without a source node carries no
  backing verdict and is counted separately rather than being silently treated as
  unbacked.
- **Pairing is by rendered text, deliberately independent of L2.** L3 must be
  able to disagree with L2; that is the value of a separate rung. The cost is
  that a block whose text the migrator rewrote past 0.65 similarity is unpaired,
  and unpaired blocks yield no L3 finding — presence remains L2's question.
- **One viewport by default.** 1024 px, the era's design target and what
  `ladom/measure.ts` uses. `--width` re-runs at any other; nothing yet asserts a
  finding is stable across widths.

---

## 8. Next phase — three ranked classes, hypotheses pre-registered

#1 is closed for `right` and deferred for `center` (§8.1); #2 is closed, and
exposed one further mechanism that is recorded and reverted (§8.2, §8.2a); #3 is
**pending** and needs no L3 because it does not touch the converter.

Measured effect of the phase, all four rungs, from the Iteration 0 checkpoint:

| | L0 | L1 | L2 source-backed | L3 |
|---|---|---|---|---|
| checkpoint | 263 tests | 87.6 | 598 | not built |
| now | **307 tests** | **89.1** | **501** | **230**, identity 0 |

### 8.1 Alignment family — hypotheses now measured, mechanism identified

**In progress.** L3's alignment evidence table decides all three pre-registered
hypotheses by counting. The inventory below is the reference measured against
itself (so it is the complete reference-side picture, uncontaminated by
produced-side gaps): `analyze/l3-reference-alignment.json`, **163 blocks the
reference aligns distinctively** — 128 `center`, 35 `right`.

Source computed `text-align`, verbatim, for those 163 blocks:

| value | n |
|---|---:|
| `-webkit-center` | **65** |
| `center` | 50 |
| `justify` | 16 |
| `right` | 14 |
| `start` | 9 |
| *(no matching source node)* | 9 |

Cross-tabulated against what the reference wanted:

| reference wants | source says | n | verdict |
|---|---|---:|---|
| center | center, distinctive | 106 | actionable |
| right | right, distinctive | 14 | actionable |
| right | center, distinctive | 9 | migrator's choice |
| right | justify | 9 | ceiling |
| center | left | 9 | ceiling |
| center | justify | 7 | ceiling |
| center / right | unknown | 9 | no verdict |

The prose baseline is `left` on twelve documents and `justify` on `goya2`, so
"distinctive" is well defined per page and no page is centred throughout.

**H1 — confirmed as evidence, falsified as a code claim.** 65 of 163 source nodes
compute `-webkit-center`; an `=== "center"` test misses every one, so the vendor
fold is genuinely load-bearing — 40 % of the family and 57 % of the centre cases.
But the two sites PROGRESS named were **already folding it**: `prominence.ts`'s
measured branch and `alignedGroup` both tested `=== "center" || === "-webkit-center"`.
Of the two sites said to be broken, `prominence.ts`'s ancestor walk was genuinely
under-detecting (it runs only when unmeasured), and `structure.ts`'s
`estimatePosition` read `text-align` into a branch that **returned `"center"`
either way** — a dead comparison that looked like a rule. So H1 did not explain
the open findings, and PROGRESS §8.1 was pointing at the wrong line.

**H2 — confirmed, and smaller than the headline.** 35 of 163 want `right`; only
**14** have a source node that computes `right`. A `right` path is real work but
reaches 14 blocks, not 35.

**H3 — confirmed, and it is 21 % of the family.** 34 of 163 rows are not
distinctive in the source (or have no source node): the migrator aligned blocks
the source does not align. Ceiling, excluded from targets.

**H4 — the actual mechanism, found by reading the gate rather than the keyword.**
`alignedGroup()` reads the evidence correctly and then discards it. `::: align`
is emitted only when *all* of: inside a `column` (`boundedDepth > 0`), not inside
a `frame`, text ≤ 120 chars, no `columns`/`column`/`nav` child, not all images,
no heading child, text carries a letter, **and the whole block is bold**. The
bold requirement and the `boundedDepth` scope reject most of the 129 actionable
blocks: `kiselev`'s right-aligned addresses and `williams2`'s closing credit are
not bold, and most are not inside a column. This is where the remaining work is,
and it is a *widening on relational evidence*, not a keyword fix.

**Change made (2026-08-06), first increment.**

1. `ladom/style.ts` — `foldTextAlign()` / `isCenteredAlign()`, one definition,
   in `ladom` because both `convert-core` and `l3` need it and neither may
   import the other. It folds vendor prefixes, `start`/`end`, and returns `null`
   for anything that is not evidence rather than defaulting. `prominence.ts` and
   `structure.ts` now use it; the dead `estimatePosition` comparison was removed
   rather than repaired, with the reason recorded at the site.
2. `alignedGroup` no longer requires the label to contain a **letter**.
   `analyze.md` names `**- 2 -**` on `williams2` as a block that must be centred
   and the reference centres it, so the human record decides it (L5). Relaxed to
   "a letter *or a digit*", which admits `- 2 -` and every bare year label and
   still rejects the false friend the guard exists for — a rule drawn out of
   punctuation (`* * *`), which belongs to the break family. Extracted as
   `isAlignableLabelText()` so the contract is testable without reproducing a
   two-lane region.

Measured effect, all four rungs, LLM off:

| | before | after |
|---|---:|---:|
| L0 tests | 301 | **304** |
| L1 overall | 87.6 % | **87.7 %** |
| L1 `williams2` directives | 73.7 | **80.0** |
| L2 findings / source-backed | 707 / 598 | **705 / 596** |
| L3 findings | 235 | **233** |
| L3 `layout.align.mismatch` | 61 | **60** |

`williams2` now emits `::: align / position: center / **- 2 -**` — `analyze.md`
williams2 item 1, closed. `align.spurious` did not rise. Small, but every rung
moved the same way, which is the property a change has to have before the larger
gate widening is worth attempting.

*Remaining in this family:* the H4 widening — ~115 centre and 14 right blocks
whose evidence is present and whose gate rejects them.

**Closed for `right`; `center` deferred with a stated falsifier.**

The count above was wrong and the measurement corrected it: the actionable set is
**39**, not ~129 — the larger figure was the whole reference inventory rather than
the produced/reference *mismatches*. All 39 are under the §6 length limit, only 9
are bold, and 31 sit in the main content column at top level — so both halves of
`alignedGroup()`'s gate (the `isWhollyStrongBlocks` bold requirement and the
`boundedDepth > 0` scope) reject them.

The seam was also wrong. The references **group**: `segovia1` puts three right-set
paragraphs in one directive and `pavlov_azancheev` two. One directive per element
renders the same and is a different document, and L2 compares documents. So the
rule is a run over siblings — `groupAlignedRuns()` — carrying its contract in the
source: invariant relational against `proseAlignOf()`, recurrence supplied by the
length-weighted baseline rather than by repetition, three named false friends.

`proseAlign()` and `isDistinctiveAlign()` live in `ladom/style.ts` and
`l3/geometry.ts` **delegates** to them rather than keeping a twin. If the
instrument computed its own baseline the two could drift and L3 would grade the
converter against a rule the converter never applied.

**The position asymmetry is measured, not chosen.** Admitting `center` as well
was tried first and rejected by L2: source-backed 596 -> 602, `align.spurious`
+11 (ten of them centred) against 8 closed. Restricted to `right`: 596 -> **593**,
L1 87.7 -> 88.4, L3 233 -> 212 with `layout.align.mismatch` 60 -> 47. The
asymmetry is structural, which is why it should hold beyond the 13: **right is
deliberate — nothing inherits it**; centre is ambient — inherited from centred
containers, free on a caption, and how a layout lane is filled.

*Falsifier:* a page whose centred blocks are neither captions, nor inherited, nor
lane content. `goya2` may be one — it holds 7 `align.missing`, all centred.

*Blocker for centre:* `borislova` and `jovicic` put centred content in the
reading flow that the references put in `::: column`. Four guards were tried
against this and all measured worse than no guard — `tableDepth <= 1` (L1 88.2),
a multi-lane-region flag (88.3), a link-only-run guard (removes correct aligns on
`kiselev`/`segovia1`), and container-relative distinctiveness (L2 601). None can
work at that seam: by the time the run pass sees the cells, the region is gone.
§8.2 fixed the region for `goya2`; `borislova` and `jovicic` still fail it, so
centre stays deferred.

### 8.2 Catalog row-pattern segmentation — **closed**

`layoutFrom()` built one `::: column` per *grid column*, concatenating every
row's cell into it. That preserves the two-lane look and destroys every
horizontal pairing: `goya2`'s 36x2 discography became two 34-entry lanes, so the
first album's title sat 33 entries above its own cover. The references split the
other way — **34 `::: columns` regions and 68 lanes on `goya2`; the converter
emitted 1 and 2.**

The six classes named as candidates *were* one mechanism, and it was this one.
`analyze.md` states it directly and decided the design (L5): *"это не должна быть
1 большая левая колонка и 1 большая правая колонка"*, and for `barrios`,
*"Таблица должна быть разбита на 2 таблицы. На каждый диск по 1 таблице"*.
`CLAUDE.md` §5 already sanctioned the split as legitimate.

Two changes, each measured separately:

| | L1 | L2 source-backed | L3 |
|---|---|---|---|
| after §8.1 | 88.4 | 593 | 212 |
| row-wise regions | **89.0** | **528** | 214 |
| + rule between rows | **89.1** | **501** | 230 |

Row-wise segmentation, per class: `column.missing` 25 -> 8 · `columns.containment`
16 -> 3 · `retyped.paragraph-to-column` 20 -> 7 · `retyped.paragraph-to-columns`
19 -> 8 · `columns.position.spurious` 18 -> 5 · `paragraph.spurious` 62 -> 48 ·
`column.containment` 9 -> 3 · `columns.missing` 9 -> 4. Only `goya2` (85.4 ->
91.4, directives 43.9 -> 92.3) and `barrios` (80.3 -> 82.0) moved on L1 — with
`rows === 1` the new construction is identical to the old, so a genuine
article-beside-sidebar layout is untouched. That is the generalization argument,
and it is structural rather than empirical.

The separator closed `break.missing` 64 -> 36 (`goya2` 35 -> 7). L3 rose 214 ->
230, entirely `layout.order.mismatch`: produced draws 33 rules where the
reference draws 35, so every later block sits two ranks early. That is the same
residue L2 reports as the remaining `break.missing`, counted a second way — not
a new class.

**Remaining in this family:** 7 separators on `goya2`, and `break.missing` 24 on
`news`, which is a dated-entry list rather than a catalog grid and so is a
different mechanism that has not been examined.

### 8.2a Enumerated break-runs -> lists — mechanism found, **change reverted**

Exposed by 8.2: with the lanes correct, `retyped.paragraph-to-list` went 5 -> 32
(`goya2` 29, `kiselev` 2, `segovia` 1). Each lane holds a `<br>`-separated track
run that the reference writes as a bullet list — unordered on purpose, since an
ordered list renumbers and `01.` is content.

A detector was written (`enumeratedItems()` in `lines.ts`: ordinals must ascend,
three items minimum, the run must *open* with one, unnumbered lines attach to the
item above) and it worked — 178 list items emitted, `retyped.paragraph-to-list`
32 -> 3.

**Reverted anyway: L2 source-backed 528 -> 600.** The cost is not new
differences, it is new *findings* for differences that already existed inside one
large paragraph — chiefly `list.item.content.edited` (+48) and `emphasis.span`
(+37), which are one reference editorial repeated 25 times: the source writes
`<i>4.07</i>` at the end of a track line and the reference writes `— 4.07`.
Reproducing that is a fixture-specific typographic rewrite; not reproducing it
costs a finding per track.

**What blocks it is a triage question, not converter work.** Those findings are
`evidence: "structure"`, and `triage.ts:76` returns `source-backed` for every
structural finding unconditionally. That rule is right for layout — it is what
stopped the first ledger burying `columns.missing` in the ceiling — but an
emphasis span deleted by the reference is not layout. Settling it means changing
an instrument, which invariant 2 permits only as an isolated declared step with
both sides re-baselined, never as a side effect of a converter change. Land the
detector after that, not before.

### 8.3 `paragraph.spurious` refined — **instrument work done, residue named**

50 instances across 11 documents, and unactionable as one class: the only thing
they shared was "the reference has no paragraph here". `structdiff.ts` now asks
one further question of every spurious produced block — **which construct owns
this text on the reference side** — and the answer names the owning mechanism.

No literals: the index is built from the reference document under comparison and
the key is the text itself, folded to words, so an escape (`01\.`), a bullet
glyph or a different dash cannot hide a home. A detector here cannot name a
document.

| sub-class | inst | docs | who owns it |
|---|---:|---:|---|
| `paragraph.spurious.unattested` | 32 | 10 | no reference construct holds the text |
| `paragraph.spurious.caption-echo` | 7 | 4 | bound as `::: image` `caption:` *and* left below the figure |
| `paragraph.spurious.in-nav` | 5 | 1 | a `::: nav` item label — the menu was not recognised |
| `paragraph.spurious.in-list` | 3 | 2 | a list item — a `<br>` run that should have been a list (§8.2a) |
| `paragraph.spurious.in-table` / `.in-align` / `.in-quote` | 1 each | 1 | a flattened record matrix, the alignment family, a quote |

The same refinement applies to every `*.spurious` class, so `heading.spurious`
(8), `image.spurious` (7), `align.spurious` (4), `quote.spurious` and
`break.spurious` are now split the same way.

**Totals are identical before and after — 613 findings, 501 source-backed.** The
instrument renames, it does not re-score (invariant 2). 18 of the 50 moved from
an unactionable class into a named mechanism; the rest is honestly labelled as
residue rather than hidden behind a tolerance.

**Killed here:** a corpus-level `.chrome` sub-class, splitting `.unattested` by
cross-document recurrence of the text (≥3 documents) — the only literal-free test
for site chrome available. It fires on **nothing** across the 13, so it was
removed rather than shipped on the argument that it would fire on the other ~987.

**Remaining, and not started:** the triage thresholds are still uncalibrated —
the 0.5–0.95 `ambiguous` word-coverage corridor (80 findings unchecked) and the
0.65 reconciliation constant. §8.2a adds a third, sharper question to that queue:
`triage.ts:76` returns `source-backed` for *every* `evidence: "structure"`
finding unconditionally. That is right for layout — it is what stopped the first
ledger burying `columns.missing` in the ceiling — but an emphasis span the
reference deleted is not layout, and until it is settled the enumerated-list rule
cannot be landed.

