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
   list. `BioMD-Reference.md` §16.3 forbids inventing **text**; wrapping text that
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
| `src/l3/render.ts` | `.bio.md` → deterministic HTML, from `BioMD-Reference.md` + the target model in `biomd-ast/read.ts`. One entry point, no side parameter. |
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

## 9. Evaluation policy corrected (2026-08-06)

`CLAUDE.md` §4 now defines four verdicts and this section records what changed
under them. Only `converter-defect` is work.

### 9.1 Three corrections to `triage()`

1. **`evidence: "structure"` returned actionable unconditionally.** Right for
   layout — wrapping, splitting and separating invent no text — and wrong for
   *presentation*. An emphasis span and a hard break are claims about how content
   is spelled, and go through attestation.
2. **Only the reference side was tested.** When the produced side is attested and
   the reference side is not, the reference is what moved.
3. **`emphasis.span` folds to identical words on both sides**, so no prose test
   can decide it. `SourceIndex` now indexes the source's own `<i>`/`<b>` runs —
   the one piece of presentation the source states outright.

A fourth followed from re-baselining: when **both sides fold to the same
content**, no content class may call it a defect. Excluded are the classes that
are *about* a folded feature (hyphenation, typography, whitespace, case), since
fold-equality is the very thing they report.

Two of my own verdicts were wrong and the re-baseline caught them, both now with
contracts: a *thematic* break is layout, not presentation (matching `break`
alongside `hardbreak` put all 36 `break.missing` on the ceiling, the opposite of
what `analyze.md` asks for); and a `.caption-echo` sub-class already names where
the reference keeps the text, so emitting it twice is duplication, not a question.

| | findings | converter-defect | ambiguous | reference-inconsistency |
|---|---:|---:|---:|---:|
| before | 613 | 501 | 80 | 32 |
| after | 613 | 400 | 139 | 74 |

Findings unchanged — the instrument re-verdicts, it does not add or remove.

`acceptable-alternative` is **never** returned by `triage()`, by design: it means
visually equal or better, and a text test cannot see a rendering. It is reachable
only from L3 geometry or an L4 judgement.

### 9.2 Two decisions the user made authoritative

Both were put as side-by-side comparisons; both resolved in favour of the source
over the reference, and **neither requires converter work**.

- **Track durations.** Source `<i>4.07</i>`, reference `— 4.07`, produced
  `*4.07*`. **The source's emphasis is authoritative.** The author marked it up;
  converting it to a dash is a typographic rewrite of source markup. The
  reference's em-dash is `reference-inconsistency` and excluded from targets.
  25 instances on `goya2`, and the same shape recurs on other discography pages.
- **List item numbering.** Reference `- 01. Love Story`, produced
  `- 01\. Love Story`. **The escape stays.** The reference's form is ambiguous
  CommonMark — a reader may take `01.` as opening a nested ordered list — and the
  two parse to identical text. ~380 items on `goya2` alone.

### 9.3 L3 rule pairing — the instrument debt, cleared

L3 rose 230 → 310 across three accepted converter changes while L2 fell. The
cause was the instrument, not the converter: a `---` carries no text, so every
rule on a page has the same pair key, and both pairing passes fell back to
**ordinal** order — produced rule 12 against reference rule 12. One extra rule
near the top shifted every rule after it, and each shift was reported as a move.
On `news`, 26 of 32 order findings *were the rules*.

Textless blocks are now held out of both passes and paired in a third, by their
**anchors**: two rules correspond when the nearest already-paired block above
each is the same pair. That is the only claim a rule can make, and it is the one
a reader checks — is there a line between this entry and the next.

L3 **310 → 260**, `layout.order.mismatch` **75 → 29**. Identity still 0 over all
13, output still byte-identical across runs.

### 9.4 State

| rung | value |
|---|---|
| L0 | 317 tests, typecheck clean, 0 FAILED conversions |
| L1 | 89.1 |
| L2 | 679 findings — **390 converter-defect** · 178 ambiguous · 111 reference-inconsistency |
| L3 | 260 findings, identity 0, deterministic |

**Next, in order.** (a) `borislova` and `jovicic` emit 0 `::: columns` where the
references have 2 and 1 — traced to their inner 1×2 record-card grids never
reaching `layoutFrom`, and this is also the blocker for centre alignment.
(b) Centre alignment, once (a) lands. (c) `news` still draws 30 rules to the
reference's 25. (d) The 0.5–0.95 ambiguous corridor and the 0.65 reconciliation
constant remain uncalibrated, now over 178 ambiguous findings.


## 10. Structural recovery — the region family closed (2026-08-06)

Four changes, each measured separately. All four rungs moved together, which had
not happened before in this campaign.

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| start of section | 320 | 89.1 | 390 | 260 |
| inconclusive → layout | 320 | **90.9** | **356** | **204** |
| centre alignment | 320 | 91.0 | 360 | 199 |
| lanes keep their place | 325 | 90.9 | **301** | **196** |
| caption echo | 328 | 90.9 | **297** | 196 |

### 10.1 An inconclusive verdict is not "not a region"

`borislova` and `jovicic` emitted 0 `::: columns` where the references have 2
and 1. The cause was **routing**, not lane detection: a table the classifier
could not type went to `dataRegionFrom(requireEvidence: true)`, and when that
abstained it fell straight to linear flow — so the lane path was never asked.
Both documents are the same shape, a 1×2 grid holding a text lane beside its
cover, classified UNKNOWN because there is no header row to plan from.

An abstention now hands the region to `layoutFrom`, which decides on its own
evidence and falls back to the same flow when there are no lanes. `jovicic`
reached **100.0** on L1; `news_2007` 74.1 → 87.6; `kiselev` 94.2 → 97.0.

### 10.2 Centre alignment — the false friend was a symptom

`center` had been held back because L2 rejected it (596 → 602). The asymmetry was
real but never about position: centre is *ambient* — inherited, free on a
caption, and how a lane is filled — so on a page whose lanes had collapsed to
flow, every lane cell looked like a centred block. §10.1 gave those documents
their lanes back and the ambiguity went with them: spurious aligns 15 → 4.

**The general lesson, now in the rule contract:** a false friend that exists only
because an earlier stage failed is not a false friend, it is a symptom. Guarding
against it at the later stage would have cemented the upstream defect and hidden
it from every instrument.

Accepted on rendered evidence — L3 `layout.align.mismatch` 52 → 48 — against L2
+4, of which two are `goya2` findings where the reference *joined* two source
lines into one title.

### 10.3 A lane keeps its place in the rows that have nothing for it

`goya2` emitted 29 `::: columns` against 34. The five missing rows are the albums
with no cover art: the second cell is genuinely empty, the row produced one
column, and the whole row fell out of the lane region — five titles running
full-width while thirty sat in a half-width track.

**Lane detection.** An occasionally-empty lane and a permanently-empty spacer are
identical in any single row and want opposite treatment. Occupancy across the
whole grid separates them, and the corpus separates cleanly:

| document | occupancy | reading |
|---|---|---|
| `goya2` | `[34, 30]` | two real lanes |
| `news` | `[36, 0]` | one lane, one spacer |
| `kiselev` | `[13, 10, 4]` | two lanes, one sparse column |
| `barrios` | `[27,1,1,1,1,3,3,24,12]` | two lanes among stray cells |

Stated relative to the busiest column rather than as a fraction of the grid, so
it holds for a two-lane catalog and a nine-column matrix alike.

**An empty `column` is legal.** Only the builder said otherwise: `validate`
accepts it, and the reference emits five and reports zero errors. §9.1's "leave a
trailing incomplete row ragged; do not pad it with empty columns" governs a
*trailing* row of a multi-child grid, where padding invents a track the source
never had; here the source itself has the empty cell.

L2 fell 59 on this change alone, because the region indices stopped shifting —
that shift had been mispairing whole subtrees on `goya2` and producing
`retyped.paragraph-to-align`, `list.containment` and `paragraph.containment`
findings for blocks that were already correct.

### 10.4 A caption stated twice

A 1998 page routinely puts the caption in the picture's `alt` *and* on a visible
line beneath it. Both are the caption and §7 gives an image one, so the line was
printed twice — once inside the figure, once under it. The evidence is
*repetition*, not a length or a position: equality after folding case, spacing
and a trailing period, plus one abbreviation form (every word but the last equal,
the last pair in a prefix relation — `в 1971 г.` under `в 1971 году.`).
Deliberately not a similarity score, which would start absorbing paragraphs that
merely mention what the picture shows.

4 of the 7 findings closed. The remaining 3 are **not** caption echoes: the
sub-classifier indexes headings, lists, tables, quotes and directives but not
plain reference *paragraphs*, so a block the reference keeps as a paragraph falls
through to whatever construct does hold its text — an image caption. That is an
instrument imprecision, not converter work.

### 10.5 State and ranking

| rung | value |
|---|---|
| L0 | 328 tests, typecheck clean, 0 FAILED conversions |
| L1 | 90.9 |
| L2 | 583 findings — **297 converter-defect** · 165 ambiguous · 121 reference-inconsistency |
| L3 | 196 findings, identity 0, deterministic |

`goya2` fell from 127 converter defects to 61 and is no longer the worst
document; `news` is, at 69.

Top classes now: `paragraph.containment` (25, 7 docs) · `retyped.paragraph-to-align`
(14, 6) · `paragraph.missing` (7 of 13, 7 docs) · `paragraph.hyphenation` (16 of
21, 8 docs) · `image.size.value` (23, 5).

**Open, in order.** (a) `news` — 4 spurious + 3 moved + 1 containment rules, an
*ordering* difference around a framed obituary rather than a count problem.
(b) The `.unattested` sub-classifier should index reference paragraphs.
(c) A directive's own name and property values are quoted into the span triage
attests against, so any spurious directive reads as unattested — this is what
mis-verdicts `goya2`'s `Vol. 1`. (d) The 0.5–0.95 corridor, now over 165
ambiguous findings.

## 11. The references moved, and four rules followed them (2026-08-06)

The reference set was revised toward the source: `barrios` lost its copyedited
prose, invented headings and four-column media table; `borislova` and `kiselev`
regained the hard breaks their `<br>`s always meant; `news`, `news_2007` and
`goya2` gained the entry separators; `williams2` moved its menu out of the
layout region. Much of what PROGRESS recorded as an unreachable editorializing
ceiling is now reachable, and **`barrios` has no converter defect left at all.**

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| §10 close | 328 | 90.9 | 297 | 196 |
| references revised (no code change) | 327 | **92.7** | **258** | — |
| caption precedence | 332 | 92.8 | 251 | 168 |
| two L2 blind spots | 335 | 92.8 | *(instrument)* | 168 |
| align in bounded containers | 337 | 92.9 | 248 | **121** |
| menu tables | 343 | **93.1** | **230** | 121 |

### 11.1 The line the reader sees outranks `alt`

§6.1 keeps `alt` and `caption` apart — one describes the picture for a reader
who cannot see it, the other is visible editorial text — and §6.4 shows a figure
carrying both. The binder took whichever arrived first, which was always `alt`.
`authors` therefore captioned a scan `Заметка о проекте…` while printing the
three lines the author actually wrote as a loose paragraph underneath: the
caption wrong and the text duplicated at once.

A standalone image now binds the *run* of caption-eligible blocks under it and
replaces an alt-derived caption. A run, because `segovia`'s 1936 photographs
caption in three lines — a bold title, who is in the picture, where it was
taken — and taking only the first orphaned the other two. Lines join with a
space; a first line set wholly in bold takes an em dash before the detail under
it, read off the inline tree rather than off whether the pipeline happened to
lift that line to a heading, which depends on context the caption does not have.

This subsumed the older "same caption stated twice" rule and fixed what that one
got wrong: it kept `alt`'s wording, so `williams2` read `в 1971 г.` where the
visible line — and the reference — say `в 1971 году.`

### 11.2 Two things a finding was allowed to claim and should not have been

Both instruments, both re-baselined, pairing untouched (380 findings before and
after, so every move was a verdict changing rather than a diff changing).

**A directive's own scaffolding is not evidence about the source.** The span
quoted for a directive opened with its name and every property value, and triage
looks a span up in the source HTML. `align center Francis Goya in Moscow`
appears in no document anyone has written, so every spurious directive read as
unattested and was called a defect — and every *missing* one was written off as
reference editorializing for the same reason, which was the larger error. Split
from `blockText`, which also drives pairing and where the name and properties
genuinely belong: they are what makes two directives the same directive.

**A paragraph that stayed a paragraph.** The sub-classifier indexed headings,
lists, tables, quotes, navs and captions but not plain paragraphs, so a produced
orphan whose text the reference also keeps as prose fell through to whatever
construct did hold it. `.in-paragraph` says what is actually wrong: nothing was
retyped, so this is placement. It is asked *before* the others, because a
reference may hold one text twice — `news` writes an obituary's subject as a
bold paragraph *and* captions the photograph below it with the same name — and
"did it stay what it was" is a different question from "what did it become".

### 11.3 `align` belongs in a bounded container, and three things blocked it

§13: "an `align` block MAY appear inside `lead`, `column`, or `frame`". `news`
alone puts eight inside frames. The pass reached none of them.

1. **The guard was right, its scope was not.** A region detector reads the
   produced shape back, so a pass that fires mid-speculation changes what is
   being speculated about — that is how `jovicic` and `borislova` once lost
   every column they had. The pass now runs a second time on the container's
   *committed* children, where nothing is speculative any more.
2. **A bounded container's own alignment is the evidence.** Alignment is
   recorded for element children only, on the stated grounds that an inline
   run's alignment is its parent's. True in the page flow; false at a boundary.
   A framed notice is one `<p>` of `<br>`-separated lines, so every block in it
   arrived with no alignment recorded, and the one fact that mattered — this
   notice is centred and the page is not — was the only thing not written down.
3. **A caption veto read a candidacy as a fact.** `captionEligible` marks a
   block whose typography *would* let it be a caption. As an unconditional veto
   it blocked every centred line in every framed notice: an obituary's opening
   sentence carries exactly a caption's typography and stands *above* the
   photograph, so it never becomes one. The test is now positional.

Making it positional inverted a related case — a figure and its caption as two
rows of a one-column table, where the caption is lowered alone and gets wrapped
before any picture is in sight. `bindCaptions` unwraps a single-position `align`
whose contents are all caption candidates: **the alignment was never wrong, it
was premature.**

`layout.align.mismatch` 49 → 23 and `layout.containment.mismatch` 81 → 60 — the
*rendered* layout, which is the question this family exists to answer.

### 11.4 A menu written as a table

`navFrom` reads an inline run of links. The other half of this era's menus are a
table with one row per item — the only other way FrontPage offered — and that
half never reached it. A menu is neither a record matrix nor a layout, so
`williams2`'s discography came out as five one-item regions with `---` between
them, and §11's "a prominent side menu normally moves directly below the title"
was lost with the menu it described.

One grid one content-column wide, rows each holding exactly one destination and
nothing else, an optional unlinked first row as the title, three linked rows
minimum. False friends, each tested for non-firing: a two-column score grid (a
row is a work *and* its tablature), a figure over its caption (no links), a
stack of citations (the cell is a sentence around the link), repeated
destinations. A label split across two anchors sharing one destination is one
item. A lane holding nothing but a menu is not a lane and folds into the flow —
`CLAUDE.md` §5, §11 and the reference all agree.

`williams2` 97.4 → 99.1, directives 74.1 → 90.9.

### 11.5 Instrument note: the alignment family had no end-to-end test

`NullMeasurer` leaves `style` undefined by design, and `convert` falls back to
it, so until now every contract in this family was stated against its helpers
and no rule could be exercised past them. The stand-in in `recovery.test.ts`
fills in `text-align` only where the element declares it and leaves everything
else to the attribute heuristics — a double that changed unrelated decisions
would be a second, worse cascade rather than a stand-in for measurement.

### 11.6 State and ranking

| rung | value |
|---|---|
| L0 | 343 tests, typecheck clean, 0 FAILED conversions |
| L1 | 93.1 |
| L2 | 356 findings — **230 converter-defect** · 72 ambiguous · 54 reference-inconsistency |
| L3 | 121 findings, identity 0, deterministic |

Per document, converter defects: `news` 63 · `goya2` 43 · `pavlov_azancheev` 20 ·
`borislova` 17 · `segovia` 17 · `kiselev` 15 · `news_2007` 15 · `tarrega` 12 ·
`authors` 8 · `jovicic` 8 · `segovia1` 8 · `williams2` 4 · **`barrios` 0**.

Top classes: `paragraph.missing` (11, 6 docs, critical) · `paragraph.hyphenation`
(23 of 23, 9 docs) · `paragraph.containment` (9, 5) ·
`align.spurious.unattested` (8, 4) · `retyped.paragraph-to-quote` (15, 2) ·
`retyped.paragraph-to-align` (6, 5) · `image.size.value` (21, 4).

**Open, in order.** (a) `ALIGN_LABEL_MAX_CHARS = 120` is a single-block absolute
threshold of exactly the kind §5 warns about, and it is now the binding
constraint on four `news` obituaries — the opening sentence cannot join its own
name, so the name is wrapped alone. 16 of 55 reference `align` bodies exceed
120 characters. Replace it with relational evidence rather than a bigger number.
(b) `retyped.paragraph-to-quote`, 15 instances in 2 documents — `news_2007`'s
reference dropped the `> ` it used to carry, so this may be largely closed
already and wants re-measuring before any work. (c) `image.size.value` (21) and
`image.src.value` (17, all `goya2`) are single-document or mechanical.
(d) The 0.5–0.95 ambiguous corridor, still uncalibrated, now over 72 findings.

## 12. The label ceiling, and a rule that had to be measured twice (2026-08-06)

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| §11 close | 343 | 93.1 | 230 | 121 |
| label ceiling 120 → 400 | 345 | **93.2** | 231 | **113** |
| subordinated documents | 349 | 93.2 | **220** | **99** |

### 12.1 The cap was hiding a list

`ALIGN_LABEL_MAX_CHARS` separated a label from an article, and the comment
claiming every reference block sat comfortably under 120 had never been checked
against the references: 15 of the 75 blocks they place inside an `::: align`
exceed it, and the longest is 300 — `news`'s obituary of 26 February 2014. At
120 a notice could not take its own opening sentence, so the name below it was
wrapped alone.

Raising it alone made L3 *worse*, 121 → 152. The sweep said why — the curve was
a **cliff at 300→400, not a trend**, so the number was never the mechanism:

| cap | L1 | L2 defect | L3 |
|---|---|---|---|
| 120 | 93.1 | 230 | 121 |
| 200 | 93.2 | 243 | 124 |
| 300 | 93.2 | 242 | 122 |
| 400 | 93.2 | 232 | **152** |

`segovia`'s discography is 24 items and ~350 characters, and
`alignableRunMember` excluded tables and headings but not **lists** — so the
first cap large enough to admit a real notice centred a whole discography. §13
enumerates what a bounded group is ("a short paragraph, dedication, small
heading group, or credit line") and warns that centred body text is harder to
read; across the 13 references **none of 499 list items** sits inside an
`::: align`.

With lists excluded the sweep is flat from 300 upward — 93.2 / 231 / 113 at 300,
400 and 600 alike. That is the right shape for the number: a ceiling against
wrapping an article, not a discriminator. 98 of the 153 top-level paragraphs in
the references are shorter than 400, so at this value it discriminates nothing.
The load-bearing evidence is and always was relational — a block is alignable
because its computed alignment differs from the page's own prose, measured
length-weighted over every prose block on the page.

**Value set to 400 by user decision.** The measurement supports it, and the
insensitivity above means the exact figure no longer matters.

### 12.2 A document the source set apart, and two traps in measuring it

§3.5 permits a block quote for material "the source deliberately subordinates to
the main prose — shown by combined evidence such as a consistently smaller font
*plus* deeper indentation or separate alignment, never by font size alone".
`pavlov_azancheev` is an archive of letters and poems; the reference quotes 34
lines and the converter emitted every one as prose.

`.t8` against `.t` looked like three concordant signals — italic, 10 pt against
11 pt, inset 25 against 15. Two of the three do not survive measurement.

**Indentation is not rendered.** The stylesheets write `margin-left: 25` with no
unit, which is invalid CSS, and Chromium drops it. Every block on the page
computes an inset of **0**, quoted letters included. The indent is in the source
and not on the page, and the first version of this rule — built on §3.5's
indentation, faithfully — could never fire on any page in the corpus.

**The quotes define the baseline.** `bodyProminenceOf` samples the longest
blocks, and on an archive page the longest blocks *are* the letters. Body
prominence comes out as the quoted matter's own 10 pt and the article's 11 pt
headnotes measure as *larger*: size reports the opposite of the truth. The same
trap caught the first italic test, asked as a majority — 8 italic long blocks
against 4 upright made the page "italic", and the quotes disqualified
themselves. The test is **contrast**, not majority: a page with *no* upright
prose is one where italic carries no information, and that is the only case the
guard needs to catch.

What survives is the one signal the reader sees. Recurrence carries the rule, as
§5 requires — and the corpus separates cleanly:

| document | wholly-italic blocks | reference quoted lines |
|---|---|---|
| `pavlov_azancheev` | 17 | 34 |
| `segovia` | 2 | 17 |
| `borislova` | 1 | 2 |
| `barrios` | 1 | 0 |
| the other nine | 0 | 0 |

Requiring **two** selects exactly the two documents the references quote and
excludes the two single-block credit lines. An italic *phrase* inside a
paragraph never qualifies — a `<p>` wrapping `<i>` computes upright — which is
§3.5's own "do not turn … ordinary dialogue fragments … into a block quote".

`pavlov_azancheev` emits 34 quoted lines against the reference's 34;
`retyped.paragraph-to-quote` 14 → 3 there, and the class is no longer ranked.

### 12.3 Killed hypotheses added

- **Indentation as blockquote evidence.** Unitless `margin-left` is invalid CSS;
  computed inset is 0 corpus-wide. Any rule keyed on indentation is dead on this
  corpus regardless of how the stylesheet reads.
- **Font size as subordination evidence.** On a page whose longest blocks are
  the quoted matter, `bodyProminenceOf` measures the quotes and the comparison
  inverts. §3.5 forbids size alone anyway; this is why.
- **Majority tests against a page baseline.** Any "is most of the page X" test
  lets a dominant construct disqualify itself. Ask for contrast instead.

### 12.4 State and ranking

| rung | value |
|---|---|
| L0 | 349 tests, typecheck clean, 0 FAILED conversions |
| L1 | 93.2 |
| L2 | 346 findings — **220 converter-defect** · 72 ambiguous · 54 reference-inconsistency |
| L3 | 99 findings, identity 0, deterministic |

Per document, converter defects: `news` 65 · `goya2` 43 · `segovia` 17 ·
`borislova` 16 · `kiselev` 15 · `news_2007` 15 · `tarrega` 12 ·
`pavlov_azancheev` 10 · `authors` 8 · `jovicic` 8 · `segovia1` 7 ·
`williams2` 4 · **`barrios` 0**.

Top classes: `paragraph.missing` (14, 6 docs, critical) · `paragraph.hyphenation`
(23, 9) · `align.spurious.unattested` (8, 5) · `retyped.paragraph-to-align`
(7, 5) · `image.size.value` (21, 4) · `paragraph.containment` (7, 4).

**Open, in order.** (a) `paragraph.missing` is now the clear top class — 14
instances over 6 documents, critical, and content loss rather than layout, so it
outranks everything else by construction. (b) `paragraph.hyphenation`, 23
instances over 9 documents, is the widest class in the ledger and mechanical:
the source soft-hyphenates across line breaks (`ак-тивно`, `испан-скую`) and
`dehyphenate.ts` already exists. (c) `align.spurious` and
`retyped.paragraph-to-align` are the same family, 15 between them, and now that
the region and menu work has settled they should be re-read together.
(d) `image.size.value` (21, 4 docs) is a threshold question in `media.ts`.
(e) The 0.5–0.95 ambiguous corridor, still uncalibrated, at 72 findings.

## 13. Frames, and a module that had nothing to do (2026-08-06)

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| §12 close | 349 | 93.2 | 220 | 99 |
| a named colour is a choice | 351 | **93.3** | 204 | 92 |
| a notice in whichever path | 352 | 93.3 | **200** | **89** |
| de-hyphenation | 356 | 93.3 | **191** | 89 |

### 13.1 `paragraph.missing` was mostly one absent frame

Following the top class down: four of its fourteen instances were `frame:
black` property lines reported as missing prose, which is what an absent frame
looks like from L2. `news` carries nine bordered obituary notices and the
reference frames all nine; the converter framed three.

**The colour test asked two questions at once.** It rejected a border whose
*computed* colour equalled the element's text colour, reasoning that an
undeclared border colour inherits from `color` and a default is not a choice.
But "did the author draw a border?" is answered by the border — a declared
style and a width of 2 px or more, which is what separates a notice from a
table's cell grid. "Which palette?" is the only question the colour answers,
and there the computed value is exactly right: a border left to inherit black
*is* black.

Asked together it got both wrong. Six of the nine notices write `border: 4px
solid #000000` on black text, which computes identically to a colourless
`border-style: solid`, so a declared colour was read as a default. The three
that survived did so only because `class="t2"` tints their text `#333328` — a
stylesheet accident, not a fact about frames.

**And the false friend had moved.** The one block the test existed to protect,
`news_2007`'s festival announcement, is framed by the revised reference: it
declares `border-style: solid` and a background tint, and the reference writes
`frame: black` where it once wrote `>`. With the test removed, frame counts
match the references **exactly on all thirteen documents** — 9 on `news`, 1 on
`news_2007`, 0 elsewhere, none gained anywhere.

**Only the catalog path asked about frames.** `layoutFrom` lowered its cells
with `blocksFrom` and never offered them to the detector, so the same bordered
idiom was a notice in an entry list and loose prose in a layout grid.
`framedCell` falls back to `blocksFrom` when there is no border evidence, so
routing through it is the whole fix.

### 13.2 The de-hyphenation module had been running on nothing

`dehyphenate.ts` — seven-rule cascade, lexicon, oracle interface, audited
reversible operations — has been wired into the pipeline since it was written
and had almost nothing to do. Its candidate pattern, and decisively the cheap
pre-filter in `dehyphenateDocument` that gates it, required a **newline after
the hyphen**.

That is what a wrap leaves behind when the author lets the editor wrap. This
corpus was typed the other way: the hyphen was inserted to break the word in
*the author's* browser at *their* window width, and the text then kept flowing.
`Укра-ина` and `Владимиро-вич` sit mid-line in the source with the newline
somewhere else entirely. Widening the pattern alone changed nothing at all,
because the pre-filter had already skipped the node — two hours of measurement
that a single instrumented run would have found in ten minutes.

Dropping the requirement sends every hyphenated word in the corpus through the
cascade, genuine compounds included. Safe, because the cascade defaults to
PRESERVE and asks about compounds first: rule 3 settles `Римский-Корсаков` and
`Переяслав-Хмельницкий` before any frequency evidence is consulted.

**Rule 5 needed a recurrence requirement.** It preserves when the hyphenated
form is attested and the joined one is not — but the lexicon is built by
scanning the same corpus, so a wrap artifact is indexed as a hyphenated word
like any other and one attestation is the defect vouching for itself.
`Борис-лавовна` and `монас-тырь` are attested once each and are both wraps;
`из-за` is attested twice and is a word.

### 13.3 The references are inconsistent about hyphenation, and the instrument could not see it

Measured word by word across the 13 pairs:

| direction | count | examples |
|---|---|---|
| reference joins, converter keeps | 11 | `маркетолог`, `Бориславовна`, `компьютерных` |
| converter joins, reference keeps | 14 | `государственном`, `классической`, `фортепиано` |

Every one of the 14 is a correct Russian word the reference failed to join. The
references join some wraps and keep others; there is no rule behind which.

**Source attestation cannot adjudicate this class.** The source contains the
hyphen either way — that *is* the artifact being reported — so the hyphenated
side is attested by construction and the joined side never is, whichever side
did the joining. The undivided class therefore reported "the reference is
right" 24 times out of 24, on evidence that says nothing.

The class now names the direction, word by word rather than block by block
(a paragraph long enough to carry one wrap usually carries several, and asking
"does this block contain a hyphen" answered yes on both sides for 14 of 16):

- `.unjoined` — the reference joined and this did not. **Work.**
- `.joined` — this joined and the reference did not. Needs a dictionary the
  project has not installed; every instance in the corpus is correct, and the
  instrument cannot know that. **`ambiguous`** — which is what verdict 4 is for.
- `.mixed` — both directions in one block, so at least one real under-join.
  **Work.** Calling it ambiguous would let a defect hide behind a correct join
  that happens to share a paragraph.

Reported split, because the two halves are not the same claim: the **converter**
change closed 8 findings (24 → 16); the **class refinement** moved 9 of the
remaining 16 off the defect count, and those 9 are cases where this output is
better than the reference.

### 13.4 Killed hypotheses added

- **A computed colour cannot testify to authorial intent.** `#000000` declared
  and `#000000` inherited are the same value. Any rule that needs to know which
  one the author wrote must read the declaration.
- **A pre-filter is part of the rule.** Widening `dehyphenateText`'s pattern
  while `dehyphenateDocument`'s gate stayed narrow produced a null result that
  looked like the rule being wrong.
- **A same-corpus lexicon cannot vouch for a single occurrence.** Whatever the
  defect is, the scan indexed it too. Require recurrence or require an outside
  dictionary.

### 13.5 State and ranking

| rung | value |
|---|---|
| L0 | 356 tests, typecheck clean, 0 FAILED conversions |
| L1 | 93.3 |
| L2 | 321 findings — **191 converter-defect** · 80 ambiguous · 50 reference-inconsistency |
| L3 | 89 findings, identity 0, deterministic |

Per document, converter defects: `news` 46 · `goya2` 43 · `kiselev` 17 ·
`borislova` 16 · `segovia` 14 · `tarrega` 12 · `pavlov_azancheev` 10 ·
`news_2007` 9 · `authors` 7 · `segovia1` 7 · `jovicic` 6 · `williams2` 4 ·
**`barrios` 0**.

Top classes: `paragraph.missing` (10, 6 docs, critical) · `paragraph.containment`
(9, 4) · `image.size.value` (21, 4) · `align.spurious.unattested` (5, 5) ·
`retyped.paragraph-to-align` (5, 4) · `image.src.value` (19, 1) ·
`retyped.align-to-paragraph` (6, 3).

**Open, in order.** (a) `paragraph.missing`, still top at 10 over 6 documents
and still content loss, but no longer one mechanism — the survivors are an
attribution line merged into its quote (`borislova`), a label above a list
(`kiselev`), a date in a column (`news_2007`) and two on `segovia`. Each wants
its own look. (b) `image.size.value` (21) and `image.src.value` (19, all
`goya2`) are the largest remaining blocks and both mechanical — `src` is one
path-resolution rule, `size` a threshold in `media.ts`. (c) The alignment
residue, `align.spurious` and the two `retyped.*-align` classes, 16 between
them across 5 documents, now that the region, menu and frame work has settled.
(d) `frame`'s `title:` property is unused: `news` puts `ПОЗДРАВЛЯЕМ` in it and
the converter emits a heading inside the frame instead — one instance corpus-
wide, so recorded rather than acted on. (e) The 0.5–0.95 ambiguous corridor,
still uncalibrated, now at 80 findings and growing as classes are refined into
it — the single largest piece of unexamined instrument behaviour left.

## 14. A phantom top class, and a tag that was never evidence (2026-08-06)

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| §13 close | 356 | 93.3 | 191 | 89 |
| symmetric home attribution | 363 | 93.3 | **200** | 89 |
| §3.5 decides a blockquote | 368 | **93.8** | **194** | **82** |

### 14.1 `paragraph.missing` contained no missing paragraphs

The ledger's top class — rank 300, `critical`, 10 instances, 6 documents,
content evidence — was followed down, and every one of the ten had its text
sitting in the produced document: three as a line inside a hard-break run the
reference had split into blocks, four as a whole paragraph under a different
parent, one as a table cell, two absorbed into a longer block. **Zero were
absent.** A class reporting content loss where none exists had, by construction,
outranked every class reporting a real defect.

The cause was an asymmetry the file had already half-fixed. `homeOf`
sub-classifies a *produced* orphan by the construct owning its text on the
reference side — built because `paragraph.spurious` was "50 instances with
nothing in common". The mirror question was never asked, so a reference orphan
was reported bare at `missingSeverity`: critical, content, which reads as prose
that was lost.

Presence is a fact both sides can be asked about, and it now decides the
severity. Text present on the other side is a **placement** finding — `major`,
`structure` — because the defect is which container holds it. Only `.unattested`
is content, and there `critical` is the truth.

Two folding gaps surfaced while measuring, the same blind spot one function
over. `homeKey` used `words()` and split on intra-word hyphens, so `успе-хов`
and `успехов` were different words and `jovicic`'s Segovia testimonial read as
absent while sitting inside its opening paragraph; it now uses
`similarityTokens`, which the aligner has always used for exactly this reason.
Run lines were keyed raw, so `[ДИСКОГРАФИЯ](/#/…)` carried its own target into
the key; they now go through `inlineOf`.

Two new answers were needed for the corpus's actual absorption shapes:
`.in-break-run` (one side made a block boundary where the other made a line
ending) and `.absorbed` (the words run contiguously inside a longer block, at no
boundary). `.absorbed` is the weakest answer and the only one that can be a
coincidence, so its minimum was read off the sweep rather than assumed:

| min words | attributed |
|---|---|
| 1 | 10 — a bare `ПОЗДРАВЛЯЕМ` matches any sentence containing it |
| 2 | 9 — `news_2007`'s footer chrome matches inside the page's own heading |
| 3 | 8 — every full name, no bare label |
| 4-6 | 5 — three obituary subjects stop being found in the notices naming them |

A trend, not a plateau, so the number does real work; 3 is where it admits every
three-part name and no single label. The false friend is tested for non-firing.

**The instances did not move, and that is the evidence this was truthfulness
rather than accounting**: 321 findings before, 321 after, none added, none lost.
Nine changed verdict and all nine moved *up* — `paragraph.spurious.unattested`
[ambiguous/critical] became `.in-break-run` or `.absorbed`
[converter-defect/major], duplications the instrument had been filing as "the
reference may have deleted it". Corpus critical count 37 to 13.

### 14.2 `<blockquote>` was converted from the tag, with no §3.5 test at all

Following the re-ranked ledger to `paragraph.containment` found three
mechanisms, and the largest was one wrapper: `tarrega` emitted **33** quoted
lines against the reference's **0**, a single `<blockquote>` swallowing a
nine-block score catalogue — headings, lists and all — and producing eight
findings alone. `kiselev` emitted **29** against **0**, six indented track lists.

§12.2 built a §3.5-grounded subordination test for the CSS path. The tag path
never asked it. Same shape as §13.1: the question was answered by evidence in
one path and by construction in the other.

Two hypotheses died before the third was written:

| hypothesis | falsifier |
|---|---|
| the tag is never evidence — make it transparent | `segovia` 11 quoted lines to **0**. The reference wants 17. |
| the tag is evidence, merely ungated — require `subordinationRecurs` | `recurs` is **true** on `kiselev` and `tarrega` too. It separates nothing. |

What separates them is the content, on §3.5's own evidence and nothing else —
`segovia` 1/1 subordinated children, `kiselev` 0/1, `tarrega` 0/4.

**The evidence had to be read off the source element, not the produced blocks.**
`blocksFrom` records subordination for element children only, deliberately: an
inline run's *alignment* is its container's and says nothing about the run.
Italic is not like that — `<i>` is written around this run and nothing else —
and `segovia` writes `<blockquote><i>…</i></blockquote>`, so its paragraph is
born from an inline flush and never enters `ctx.subordinated`. Asking the
produced set answered no on the one page whose blockquotes the reference quotes.
`subordinationRecursIn` had the identical blind spot — it counts `p` and `div`
only — and scored those two regions as nothing. Both now call one shared
`contentIsSubordinated`.

`InlineAlignMeasurer` gained the one UA default the rule needs: `<i>` and `<em>`
compute italic without declaring it. Without it the positive contract could not
be exercised end-to-end, and the rule looked wrong.

The old contract *"still quotes a genuine short quotation"* asserted that the
tag is enough — the belief this iteration falsified. Unmeasured input now
flattens rather than asserting an unevidenced quotation; no text is lost either
way, and the positive contract moved to `mdMeasured`, where computed style
exists.

`tarrega` 12 to 6 defects, L1 81.5 to 88.5. **`kiselev` holds at 17**: its track
lists were two defects stacked, and removing the quote exposed the list recovery
underneath — `retyped.quote-to-list` (6) became `retyped.paragraph-to-list`,
which is now the top-ranked class.

### 14.3 Killed hypotheses added

- **A tag is not evidence about intent.** `<blockquote>` in this corpus is an
  indent as often as a quotation. Any rule converting a presentational tag
  without asking what is inside it will be wrong on roughly half the corpus.
- **A page-level recurrence gate cannot substitute for content evidence.**
  `subordinationRecurs` is true on both pages that must *not* quote. Recurrence
  qualifies a shape; it does not identify one.
- **A shared evidence set is only shared where it is recorded.**
  `ctx.subordinated` covers element children and not inline runs, so two
  consumers reading it saw nothing on the very page the rule was for. Check what
  populates a set before keying a second rule on it.
- **An instrument's own key must fold what the rest of the instrument folds.**
  `homeKey` split on hyphens while `similarityTokens` joined them; the result
  was a class asserting content loss for text one function over could see.

### 14.4 State and ranking

| rung | value |
|---|---|
| L0 | 368 tests, typecheck clean, 0 FAILED conversions |
| L1 | 93.8 |
| L2 | 314 findings — **194 converter-defect** · 70 ambiguous · 50 reference-inconsistency |
| L3 | 82 findings, identity 0, deterministic |

Per document, converter defects: `news` 49 · `goya2` 45 · `kiselev` 17 ·
`borislova` 16 · `segovia` 14 · `pavlov_azancheev` 13 · `news_2007` 9 ·
`authors` 7 · `segovia1` 7 · `jovicic` 6 · `tarrega` 6 · `williams2` 5 ·
**`barrios` 0**.

Top classes: `retyped.paragraph-to-list` (10, 4 docs) · `image.size.value`
(21, 4) · `align.spurious` (5, 5) · `retyped.paragraph-to-align` (5, 4) ·
`image.src.value` (19, 1) · `paragraph.spurious.in-break-run` (6, 3) ·
`retyped.align-to-paragraph` (6, 3) · `paragraph.containment` (5, 3).

**Open, in order.** (a) `retyped.paragraph-to-list`, 10 over 4 documents and now
top: a `<br>`-separated run of parallel short lines is a list, and `kiselev`'s
six track lists are the clearest instance now that the quote no longer hides
them. `paragraph.spurious.in-break-run` (6, 3) is very likely the same mechanism
seen from the other side — check before treating them separately.
(b) `image.src.value` (19, all `goya2`) and `image.size.value` (21, 4 docs),
both mechanical: one path-resolution rule and one threshold in `media.ts`.
(c) The alignment residue — `align.spurious`, `retyped.paragraph-to-align`,
`retyped.align-to-paragraph` — 16 across 5 documents. (d) `borislova` and
`jovicic` want a quote the recurrence gate declines to give (1 subordinated
region each; `MIN_SUBORDINATED_BLOCKS` is 2). §12.2 chose that gate deliberately
and it is the right shape, so this is a ceiling until a second signal exists.
(e) The ambiguous corridor, 70 findings, still uncalibrated and still the
largest piece of unexamined instrument behaviour.

## 15. Two classes that were not one mechanism (2026-08-06)

| | L0 | L1 | L2 converter-defect | L3 |
|---|---|---|---|---|
| §14 close | 368 | 93.8 | 194 | 82 |
| a block boundary is presentation | 369 | 93.8 | **188** | 82 |

§14.4 guessed that `retyped.paragraph-to-list` (10, 4 docs) and
`paragraph.spurious.in-break-run` (6, 3 docs) were one general mechanism seen
from two sides — both are about how a `<br>` run is segmented. Tested, they are
not, and only one of them is work.

### 15.1 The over-split class was the reference merging, six times out of six

`paragraph.spurious.in-break-run` reports a produced paragraph whose text is a
*line* of a paragraph on the reference side. Every instance was checked against
the source:

| document | what the source writes | what the reference writes |
|---|---|---|
| `pavlov_azancheev` ×3 | each address is its own `<p class="t8">` | one paragraph, soft-wrapped lines |
| `goya2` | album title and year are two separate `<p>` | one paragraph, two lines |
| `williams2` | the track and its link are two separate `<td>` | one paragraph, two lines |

Six for six the produced side is attested by an actual paragraph element and the
reference is not. The reference's merge renders as a wall of text — `pavlov`'s
letter loses the break between its two mailing addresses — so this is not even
an acceptable alternative in the reference's favour.

**The instrument said "defect" because of §14.1.** Giving placement findings
`structure` evidence stopped them claiming content loss, which was right, but
`structure` short-circuits triage to `converter-defect` without ever running the
attestation test. That is correct for a lane, a wrapper or a separator — §16.3
constrains text, not layout — and wrong for this class, because a block boundary
against a line ending is the **hard-break question one level out**, and
`CLAUDE.md` §4 puts hard breaks with presentation, to be attested like content.

`.in-break-run` joins `PRESENTATIONAL`. The two directions then separate the way
the existing triage logic already handles insertions and deletions, with no
special case: a *spurious* block whose text the source attests is `ambiguous` —
the instrument cannot know whether the reference merged deliberately; a
*missing* block whose text the source attests stays `converter-defect`, because
there the reference asserts a boundary the produced document lacks.

Corpus effect: converter-defect 194 → 188, ambiguous 70 → 76. Nothing else moved.

### 15.2 The list class is real, and its discriminator is not deterministic yet

`retyped.paragraph-to-list` is the opposite direction and a genuine defect: a
`<br>` run of parallel record lines emitted as one hard-break paragraph where
the reference writes a bullet list. `kiselev` 6, `jovicic` 1, `kiselev`'s volume
list 1, plus `news_2007`'s menu and `segovia`'s bullet run, which belong to the
nav and glyph-bullet families rather than this one.

`enumeratedItems` already covers the neighbouring shape and correctly declines
these: it requires an explicit ascending ordinal (`01.`, `2)`) on each line, and
these runs have none.

**The discriminator was measured before a rule was designed, and it does not
exist in the shape.** Every multi-line produced run was matched against what the
reference does with the same text:

| | runs | lines | line length min/med/max |
|---|---|---|---|
| reference makes a **list** | 9 | 2–19 | 11 / 30 / 85 |
| reference keeps a **paragraph** | 69 | 2–11 | 4 / 30 / 2109 |

`kiselev`'s track lists are 3–9 lines of 11–85 characters. `borislova`'s poems
are 4–9 lines of 10–36 characters, thirteen of them, and the reference keeps
every one as a paragraph — as §3.5 and the `text.segment` hook both require,
since verse is lineation and never a list. Line count, line length, length
variance and lineation all overlap completely. A rule on any of them converts
`borislova`'s poetry into bullet lists.

Two candidate mechanisms remain, both recorded rather than built:

- **Indent under a label.** All six `kiselev` runs sit in
  `<blockquote style="margin-left: 25">` under an album title, and after §14.2
  made the tag transparent that containment is free evidence. It separates
  cleanly on this corpus — but *only* on `kiselev`, so it is six instances in
  one document, which `CLAUDE.md` §5 names as the wrong target however many
  instances it has, and its false friend would be untested. `jovicic`'s run is
  not indented at all; it is a `<br><br>`-delimited group inside `<p class="cd">`.
- **An `ITEM` kind for `text.segment`.** The hook exists and classifies breaks as
  WRAP / PARAGRAPH / LINEATION / SPACING. A track list and a poem are both
  LINEATION under that vocabulary, which is why the hook cannot answer this
  today. Distinguishing "independent records" from "one utterance in lines" is
  semantic interpretation of the content, which is §6's definition of hook
  territory rather than rule territory. It would need the deterministic
  acceptance check named before it is built — the obvious candidate being that
  accepting an `ITEM` verdict may only change block *type*, never text, never
  line count, and never fire where the run is verse by §3.5's evidence.

Deliberately not built this iteration: a single-document rule, and a hook whose
acceptance check has not been designed. The class stays open with its evidence
recorded.

### 15.3 Killed hypotheses added

- **`retyped.paragraph-to-list` and `paragraph.spurious.in-break-run` are one
  mechanism.** They share a substrate — `<br>` run segmentation — and nothing
  else. One is a missing detector; the other was an instrument over-claim. A
  shared substrate is not a shared mechanism.
- **`structure` evidence is safe for any placement finding.** It bypasses
  attestation by design. That is correct for layout — lanes, wrappers,
  separators — and wrong for any class whose claim is about how the same content
  is *set*. A block boundary against a line ending is presentation.
- **A record list can be told from verse by shape.** Measured across 78 runs in
  the 13 references: line count, line length, variance and lineation all
  overlap. `borislova`'s poems and `kiselev`'s track lists are the same shape.

### 15.4 State and ranking

| rung | value |
|---|---|
| L0 | 369 tests, typecheck clean, 0 FAILED conversions |
| L1 | 93.8 |
| L2 | 314 findings — **188 converter-defect** · 76 ambiguous · 50 reference-inconsistency |
| L3 | 82 findings, identity 0, deterministic |

Per document, converter defects: `news` 49 · `goya2` 43 · `kiselev` 17 ·
`borislova` 16 · `segovia` 14 · `pavlov_azancheev` 10 · `news_2007` 9 ·
`authors` 7 · `segovia1` 7 · `jovicic` 6 · `tarrega` 6 · `williams2` 4 ·
**`barrios` 0**.

**Open, in order.** (a) `image.src.value` (19, all `goya2`) and
`image.size.value` (21, 4 docs) — the largest remaining blocks and both
mechanical: one path-resolution rule, one threshold in `media.ts`.
(b) The alignment residue — `align.spurious`, `retyped.paragraph-to-align`,
`retyped.align-to-paragraph` — 16 across 5 documents. (c)
`retyped.paragraph-to-list`, open with its evidence in §15.2 and blocked on a
hook design rather than on measurement. (d) The ambiguous corridor, now 76
findings, still uncalibrated.

**Development corpus frozen here.** The thirteen pairs are the regression corpus
from this point; the next work is generalization measured on unseen pages, not
further tuning against these.

## 16. Blind generalization check — 10 unseen pages (2026-08-06)

Ten new sources landed in `fixtures/html/` with no references. Converted with the
frozen rule set, no reference read, **no `corpus scan`** — rebuilding the lexicon
from 23 files would have changed behaviour on the 13 and destroyed the test.

**Regression first: the 13 outputs are byte-identical with the 10 new inputs
present.** No cross-contamination through the shared corpus profile.

### 16.1 The gates all held

| gate | result |
|---|---|
| crashes / `FAILED` conversions | **0 of 10** |
| `biomd-ast/read()` warnings on output | **0 on all 10** |
| `biomd validate` (spec profile, standalone) | 9 of 10 clean; `new_rechin4` 2 × `line-too-long` |
| links lost (`conservation.targets.missing`) | **0 on all 10** |
| images lost (`conservation.images.missing`) | **0 on all 10** |
| words lost | **0 on all 10** |
| diagnostic error *codes* | only `table-header-empty`, `complexity-budget`, `line-too-long` — the same three the 13 produce |
| review escalation *kinds* | same categories as the 13; "no decisive evidence either way" dominates both |

Every one of the ten got exactly **one `# ` masthead**. Encoding detection, chrome
removal, link and image conservation and emitter conformance generalize without
qualification. Nothing in the new set produced a failure mode the 13 had not
already produced.

### 16.2 `conservation.text.recall` is not a content-loss measure

`new_lagq2` reported **45.3 %** recall — worse than anything in the 13 — with
**zero** words, links or images missing. The metric is built on word shingles,
and every shingle straddling a block boundary breaks when the converter splits a
run. `lagq2`'s source writes each track as its own unclosed `<p class="t">`, the
converter emits each as its own paragraph — faithfully — and the shingles
spanning title into track list all miss.

The number therefore measures *how similar the block structure stayed*, not how
much content survived. On the 13 it never fell below 94 % because their block
structure happens to sit close to the shingling's assumption. **Read
`targets.missing`, `images.missing` and a word-level check before believing a
recall figure**; a low recall with those three at zero is a restructuring, not a
loss.

### 16.3 One genuinely new archetype: the per-composer media catalogue

`new_karta` and `new_karta5` are a combined audio/score catalogue — "сводный
каталог аудио, нот и табулатур" — and they are the **multi-column media/score
table** archetype at a scale the 13 never showed. Measured in the browser at
1024 px, `new_karta5` renders 21 multi-column tables:

| rows per table | 1 | 2 | 3 | 4 | 7 | 11 | 20 |
|---|---|---|---|---|---|---|---|
| tables | **12** | 2 | 2 | 2 | 1 | 1 | 1 |

Twelve of the twenty-one are **single-row** — one composer, one work, one format
link (title cell 405 px left-aligned, link cell 45 px centred). The table path
classifies them DATA and then refuses them: 7 × "classified DATA but not
representable as a table (too-small)", 3 × "unrepresentable", 1 × "too-many".
Corpus-wide the new set emits **8 of 28** DATA-classified tables as tables, and
the shortfall is concentrated here — `new_karta5` 4/15, `new_karta` 3/6.

What the rows become instead is `::: align position: center` around the title and
the link as separate paragraphs. `new_karta5` carries **39 `::: align`**
directives, more than any of the 13 (`goya2` has 26), and L3's source-backing
column reports **21 of them with no distinctive source alignment at all** — the
title cell computes `start`, not centre.

The fix direction is already sanctioned: §5's corpus facts say "vertically
aligned blocks in a multi-column region are semantically paired, and splitting
such a region into several small tables to preserve that pairing is legitimate".
The guard rejecting a one-row media table is the thing to revisit, not the
pairing.

### 16.4 A false friend for §12.2, and it is a symptom

`new_dyens` emits three block quotes — `Tango En Skaï`, `Valse En Skaï`,
`Libra Sonatine`. All three are **work titles in a media table**, and §3.5
excludes them by name: "do not turn titles … into a block quote".

The page has exactly one `<blockquote>` in the source — the biography paragraph —
and §14.2's rule correctly declined it. These three came from §12.2's
italic-recurrence rule: the title column is `<p class="l">`, the stylesheet sets
that italic, three of them recur, and `groupSubordinatedRuns` wraps each.

**The root cause is upstream.** The media table was not emitted as a table
(`tables=0/1`), so its title cell was lowered as loose prose and only then met a
rule that reads computed italic. §5's own instruction applies — "check the
routing and grouping stages above it first: a false friend that exists only
because an earlier stage failed is a symptom" — so this is the same defect as
§16.3, seen one stage later. Guarding the quote rule against italic titles would
cement the table failure and hide it.

### 16.5 Two smaller findings

- **`new_rechin4`** — 2 × `line-too-long` (4156 and 2850 characters against a
  2200 ceiling) and only 11 paragraphs for a 33 KB source. Under-segmentation:
  whole sections are landing in single paragraphs. The only validation *error*
  class the new set raises that the 13 raise just once.
- **`new_geyzel04`** — nesting depth 4 against a budget of 3, and 48 review items
  ("no decisive evidence either way"), three times the highest in the 13
  (`segovia` 19). Volume, not kind.

### 16.6 Archetype mapping

| page | archetype | new? |
|---|---|---|
| `new_bach`, `new_blackmore`, `new_kolpakov`, `new_lendle2` | masthead + prose with bound figures | known |
| `new_dyens`, `new_lagq2` | prose + multi-column media/score table | known shape, table path declines |
| `new_geyzel04`, `new_rechin4` | long-form prose, deep nesting | known, at new depth/length |
| `new_karta`, `new_karta5` | **per-composer media catalogue** — many one-row tables | **new scale of a known archetype** |

None announced itself as wholly unmapped. The one that stresses the catalog is
the catalogue page, and it stresses a *guard* rather than a missing detector.

### 16.7 What this says about generalization

The deterministic front half — encoding, chrome, masthead, figures, links,
conservation — generalizes. The emitter generalizes absolutely: 10/10 with zero
`read()` warnings and zero validation warnings.

What does not generalize is **one guard and one threshold**: the minimum size a
DATA table must reach to be emitted as a table. Every high-value defect in this
blind set traces to it, including the §12.2 false friend, which exists only
downstream of it. That is a better outcome than a scattered failure — it is one
mechanism, it is already described in `CLAUDE.md` §5's corpus facts, and it can
be measured on `new_karta5` without touching the 13.

Outputs preserved before any comparison, for the reference step.

## 17. Blind improvement phase — two hypotheses, both falsified (2026-08-06)

Worked from the 10 unseen sources, the current output, `BioMD-Reference.md` and
the existing rules only. No reference was opened. **No rule shipped**, and the
reason is the result: both candidate mechanisms were carried to the point where
the evidence killed them, which is cheaper now than after they were built.

| rung | before | after |
|---|---|---|
| L0 / L1 / L2 / L3 | 369 · 93.8 · 188 · 82 | unchanged — no code change survives |
| the 13 outputs | — | byte-identical |
| the 10 blind outputs | — | byte-identical to the §16 baseline |

### 17.1 Killed: "a one-row table in a region that writes records is a record row"

§16.3 named the `minRows: 2` guard in `planDataTable` as the single mechanism
behind the largest defect in the blind set — `new_karta5` emits 4 of 15
DATA-classified tables, and 12 of its 21 multi-column tables are single-row.

A rule was designed to §5 and measured before being trusted: a one-row table is
a record when, **in the same region**, at least two multi-row tables were already
accepted as data, and no cell of the candidate exceeds the largest cell those
accepted rows contain. Three relations, no literal, no absolute number. The
firing set was measured first and was tight — `new_karta5` 8, `new_karta` 1,
`kiselev` 1 — and the false friend separated cleanly:

| document | candidate's widest cell | peers' widest cell | verdict |
|---|---|---|---|
| `kiselev` (album header, a layout container) | **1303** | 189 | reject |
| `new_karta` | 51 | 72 | accept |
| `new_karta5` | 7–31 | 80 | accept |

Implemented, it fired exactly as measured and the 13 stayed byte-identical. It
still emitted **no** table, and the reason falsifies the premise rather than the
implementation: `tableFromPlan` cannot synthesize a header for a one-row table,
because `dominantLabel` needs a label recurring across three body rows. That is
correct behaviour, not a bug — and the column counts say why:

```
new_karta5 accepted tables:  2x2  4x10  7x2  11x7  20x8  4x4  2x2  3x4
```

**There is no column schema.** Each record is a work title followed by however
many format links that work happens to have — arity 1 to 9. These are not rows
of a matrix that the guard is wrongly splitting; they are variable-arity records
that a table cannot express without inventing a header, which §16.3 forbids. The
`too-small` rejection is a symptom; the classifier calling them DATA is the
thing to re-examine, and what they should become instead is a question the
reference can answer and deduction cannot.

Reverted in full.

### 17.2 Not shipped: the unbacked centring on `new_karta5`

§16.3 also reported 21 blocks carrying `position: center` with no distinctive
source alignment. Traced, the mechanism is real and general:

`proseAlignOf` samples only leaf blocks of **≥120 characters**, and measured
across all 23 documents `new_karta5` is the only page with **zero** of them:

| document | leaf samples | ≥120 chars | baseline |
|---|---|---|---|
| `new_karta5` | 302 | **0** | **null** |
| `new_karta` | 198 | 1 | justify |
| every other document | 35–302 | 5–32 | justify |

With no baseline, `isDistinctiveAlign` falls back to "centre and right are
distinctive on their own", so on a catalogue page — short entries throughout —
nearly every block qualifies and `new_karta5` collects 39 `::: align`
directives, more than any of the 13.

The obvious repair does not work: dropping the length threshold gives
`left:1383 center:660 justify:259` by weight, so the baseline becomes `left` and
the centred blocks stay distinctive. The `<center>` wrapper centres block
*boxes* while the text inside the cells computes `start`, so "the page is
centred" and "the page's prose is left-aligned" are both true, and the two
instruments disagree about which one `isDistinctiveAlign` should be asking
about. That disagreement is worth resolving, but not blind: the fix changes an
alignment baseline used by every rule in the project, and it is not decidable
from source geometry alone which reading §13 intends for a page with no prose.

Left open with the measurement recorded.

### 17.3 A stale line in `CLAUDE.md` §4

§4's third corpus fact reads: "`prominence.ts:132` and `structure.ts:1809` handle
this; **`prominence.ts:138` and `structure.ts:1437` do not** — a live
inconsistency, not a style preference."

Measured: it is closed. Every comparison now folds through
`isCenteredAlign`/`foldTextAlign`, and `src/ladom/style.ts:6` records the split
and exists to prevent its reintroduction. The remaining `=== "center"`
comparisons are on already-folded values or on raw HTML attributes, where they
are correct. The line numbers have also drifted.

Flagged rather than edited — `CLAUDE.md` is the constitution and the correction
is the user's to make.

### 17.4 Killed hypotheses added

- **A rejected DATA table implies a missed table.** `new_karta5`'s records have
  no shared column schema; a table would need an invented header. When a guard
  rejects something, check that the accepted alternative is expressible before
  treating the guard as the defect.
- **Recurrence among accepted peers licenses a one-row table.** The evidence is
  sound and the rule fires exactly where measured — and it still cannot produce
  output, because a one-row table has no recurring label to name its columns. A
  rule must be checked against what the *emitter* can express, not only against
  what the detector can justify.
- **A missing alignment baseline can be repaired by dropping the length
  threshold.** On the one page where the baseline is null, the unrestricted
  weighted majority is `left`, not `center`, so the centred blocks remain
  distinctive and nothing changes.

### 17.5 What the reference step should settle

1. What `new_karta`/`new_karta5`'s variable-arity records should become — table
   with supplied labels, definition-style flow, or paired lines. This is the
   single highest-value question in the new set and deduction cannot answer it.
2. Whether `::: align` belongs around a catalogue entry at all on a page whose
   blocks are centred but whose cell text is not.
3. Whether `new_rechin4`'s two over-long lines are under-segmentation or faithful
   long paragraphs.

## 18. Second blind pass — broadened search, four more hypotheses dead (2026-08-06)

A bounded second blind pass across all 10 unseen sources and their outputs,
searching the objective classes: lost/duplicated/invented content, degraded
BioMD, routing and containment, collapsed neighbour relationships,
image/caption and record-field associations. No reference was opened.

**Accepted converter changes: zero.** One documentation correction shipped.
L0 369 · L1 93.8 · L2 188 · L3 82 — unchanged; the 13 and the 10 blind outputs
byte-identical.

### 18.1 What the sweep found, and what survived scrutiny

| signal | instances | verdict |
|---|---|---|
| duplicated blocks in output | 1 (`new_lagq2`) | **not a defect** — the source really carries that track twice |
| caption echoed as a paragraph | 0 in the new set | clean; caption binding generalizes |
| empty `::: column` lanes | 5 over 4 docs | **not objectively wrong** — see 18.2 |
| `::: align` around a single paragraph | 62 over 9 docs | not new-set-specific: `goya2` has 25 in its *reference* |
| one-item lists | 4, one document | too narrow to carry a rule |
| collapsed two-lane album records | `new_lagq2` | real, and the fix is forbidden — see 18.3 |

### 18.2 Killed: "an empty `::: column` is degraded output"

Five spurious-looking empty lanes across `news_2007`, `williams2`,
`new_geyzel04` and `new_karta` — four documents, and two of them in the
regression corpus where a reference can adjudicate. It looked like a clean
candidate until both sides were read:

| document | reference | produced |
|---|---|---|
| `goya2` | **5 empty lanes** | 5 |
| `news_2007` | 0 | 1 |
| `williams2` | 0 | 1 |

`goya2`'s reference *keeps* the trailing empty lane, and for a reason the code
already documents: five albums have no cover art, and dropping the lane would
shift every index after them out of alignment with the thirty that do. The
shape that is correct on `goya2` and wrong on `news_2007` is byte-identical —
what separates them is whether a sibling `::: columns` group puts content in
that lane. For the two *new* documents there is no way to tell blind which kind
they are, and guessing would break `goya2`.

### 18.3 Killed by an existing contract: reconsidering a failed DATA table as lanes

The best-founded candidate of the pass, and the most instructive failure.

`new_lagq2` is seven album records — cover beside tracklist — and the produced
output has **zero** `::: columns`: the two-lane relationship is flattened
entirely. Traced through measured geometry:

| document | grid | ratio | imgDensity | class | outcome |
|---|---|---|---|---|---|
| `goya2` | 35×2 | 0.50 | 0.16 | CATALOG | 34 `::: columns` |
| `new_lendle2` | 10×2 | 0.50 | 0.33 | CATALOG | lanes |
| `new_lagq2` | 7×2 | **0.37** | 0.46 | **DATA 0.50** | flattened |

Two mechanisms were separated before writing code. The first — that CATALOG's
tier-1 gate demands lanes of near-equal width (0.45–0.55) and a 150 px cover
beside a tracklist has no reason to be 50/50 — is true but not the cause:
widening it would also catch `barrios` (0.67) and `news_2007` (0.27), both in
the regression corpus.

The actual cause is a **routing asymmetry**. An UNKNOWN verdict is reconsidered
as a layout region ("not a data table is not 'not a region'"); a DATA verdict
that cannot be *planned* falls straight to linear flow, so the one classification
that says "this grid is structured" is the only one never asked whether its
columns are lanes. That is the identical shape as §13.1's frames and §14.2's
subordination — a question answered by evidence on one path and by construction
on the other — and it was implemented on that reasoning.

**It was already considered and deliberately rejected.** `recovery.test.ts`
carries the contract *"leaves a DATA verdict on the flow path — the false
friend"*, with the rationale stated outright: "losing a table to lanes is the
defect this reconsideration could otherwise introduce." The corpus agreed —
L1 **93.8 → 93.6**, with `borislova`, `goya2` and `williams2` all changed.
Reverted.

The lesson generalizes past this candidate: *a symmetry argument is not
evidence.* Three times in this campaign "the same question should be asked on
every path" produced a real fix; here the paths are deliberately asymmetric,
and the test that says so was written by someone who had already tried it.
**Grep the contracts for a candidate before building it.**

### 18.4 `CLAUDE.md` §4 corrected

The `-webkit-*` alignment note claimed a live inconsistency between four call
sites. Measured, it is closed: every comparison folds through
`isCenteredAlign`/`foldTextAlign`, `src/ladom/style.ts` documents the split and
exists to prevent its return, and the remaining `=== "center"` comparisons are
on already-folded values or raw HTML attributes where they are correct. The
line numbers had also drifted. Replaced with the standing rule — fold, never
compare a computed value raw.

### 18.5 Killed hypotheses added

- **An empty lane is degraded output.** It is load-bearing when a sibling group
  fills that lane; `goya2`'s reference keeps five.
- **A failed DATA table should be reconsidered as a layout region.** Symmetric
  with the UNKNOWN path, measurably worse, and already refused by a contract
  with a named false friend.
- **CATALOG's near-equal-lane gate is over-fitted.** True, and still not the
  cause of the one document that misses it; widening it reaches two regression
  documents.
- **A block appearing twice in the output is duplication.** Check the *stripped*
  source text, not the raw HTML — markup splits an occurrence and makes a
  faithful conversion look like invention.

### 18.6 State

Unchanged from §17: L0 369 tests · L1 93.8 · L2 314 findings, 188
converter-defect · L3 82. Blind outputs preserved.

The open questions for the reference cycle are those of §17.5, plus: whether
`new_lagq2`'s album records should be two-lane regions at all, given that the
one mechanism which would produce them is forbidden by a tested contract. If
the reference gives them `::: columns`, the contract and the CATALOG gate both
need revisiting together — and that is a reference-guided decision, not a blind
one.

## 19. Handoff — the blind phase is closed; the reference-guided phase starts here

Everything above this section is done. **Do not repeat it.** The bootstrap, the
four instrument rungs, the L5 calibration, the two blind passes over the 10 new
pages and every hypothesis they killed are recorded and measured. A session that
picks this up starts at §19.2.

### 19.1 Checkpoint

| rung | value | how to reproduce |
|---|---|---|
| L0 | 369 tests, typecheck clean, 0 FAILED conversions | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **93.8** | `sh bench/run.sh` |
| L2 | 314 findings — **188 converter-defect** · 76 ambiguous · 50 reference-inconsistency | `node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | 82 findings, identity 0, deterministic | `node dist/cli/index.js l3 -c bench/biomd.config.json` |

Branch `main`, tree clean apart from `.claude/settings.local.json`. The 10 new
`.htm` are tracked; **no new `.bio.md` reference existed when this was written.**

Blind outputs for the 10 new pages are preserved in the session scratchpad; they
are reproducible at any time with `corpus run`, and they were byte-identical
across both blind passes.

### 19.2 Corpus roles from here on

| set | members | role |
|---|---|---|
| **regression corpus** | the original **13** pairs | never regress. L0/L1/L2/L3 as in §19.1 are the floor |
| **refinement set** | **9** new pairs — every `new_*` except `new_karta5` | where the work happens |
| **holdout** | **`new_karta5`** | untouched. Do not read, diff, score or tune against it |

**Holdout mechanism, decided and requiring no code change:** keep
`new_karta5.bio.md` *outside* `fixtures/out/`. `diff`, `l3` and `eval` skip any
document with no reference file — that is already how the 10 blind pages behaved
— so the holdout stays genuinely unseen while `corpus run` still converts the
`.htm` and still reports its conservation and validation. Verify after placing
the references that the instruments report **22** documents, not 23.

`new_karta5` was chosen as the holdout because it is the page that stresses the
two open questions hardest (§17.1, §17.2); measuring it only at the end is worth
more than tuning on it.

### 19.3 The exact next step

1. **Baseline first, attribute nothing yet.** Reference edits move every rung
   with no code change. Place the 9 references, re-run all four rungs, and record
   the new numbers *before* touching code. Expect L1/L2/L3 to move simply because
   9 documents joined the comparison.
2. **Classify and rank** the new defects with `diff --json`, by
   `instances × severity × generality`, keeping the 13 and the 9 visible
   separately — a class that appears only in the new set is a generalization
   finding; one that spans both is a rule finding and outranks it.
3. **Take `new_lagq2` early**, out of rank order, because it is the one document
   whose reference can settle a question that is otherwise undecidable — see
   §19.4. After that, follow the ranking.
4. One general mechanism per iteration, `CLAUDE.md` §5 contract, full four-rung
   acceptance, commit with measured before/after.

### 19.4 The one question `new_lagq2` settles, and the contract in its way

`new_lagq2` is seven album records — cover beside tracklist — and the converter
emits **zero** `::: columns` for them. §18.3 traced why, and the answer is a
routing asymmetry rather than a threshold:

- an **UNKNOWN** verdict is reconsidered as a layout region ("not a data table is
  not 'not a region'", `structure.ts`);
- a **DATA** verdict that cannot be *planned* falls straight to linear flow, so
  the one classification asserting "this grid is structured" is the only one
  never asked whether its columns are lanes.

Reconsidering it was implemented and **reverted**: L1 **93.8 → 93.6**, with
`borislova`, `goya2` and `williams2` all changed. And it is refused outright by
an existing contract —

> `src/convert-core/recovery.test.ts` → *"leaves a DATA verdict on the flow path —
> the false friend"*: "A region the classifier *did* type as records must not be
> quietly promoted to columns by the same fallback: losing a table to lanes is
> the defect this reconsideration could otherwise introduce."

**If `new_lagq2`'s reference gives those records `::: columns`, that contract and
the CATALOG width gate have to be revisited together** — the contract forbids the
only mechanism that would produce them. If the reference flattens them too, the
contract stands and the current output is right. Either answer closes a question
that deduction could not.

**The CATALOG width-gate uncertainty.** `classify.ts`'s tier-1 CATALOG gate
requires two lanes of near-equal width, `ratio` in 0.45–0.55, plus
`imageDensity > 0.3`. Measured:

| document | grid | ratio | imgDensity | class |
|---|---|---|---|---|
| `goya2` | 35×2 | 0.50 | 0.16 | CATALOG |
| `new_lendle2` | 10×2 | 0.50 | 0.33 | CATALOG |
| `new_lagq2` | 7×2 | **0.37** | 0.46 | DATA 0.50 |

A 150 px cover beside a tracklist has no reason to be 50/50, so the band is
probably over-fitted — but it is **not** the cause of `new_lagq2`, and widening it
reaches `barrios` (0.67) and `news_2007` (0.27), both in the regression corpus.
Do not widen it on its own; decide it together with §19.4's contract question.

### 19.5 Two blind findings that will otherwise be re-derived

**Empty `::: column` lanes cannot be judged blind.** Five across four documents
looked like degraded output. They are not:

| document | reference | produced |
|---|---|---|
| `goya2` | **5 empty lanes** | 5 |
| `news_2007` | 0 | 1 |
| `williams2` | 0 | 1 |

`goya2`'s reference *keeps* them, because five albums have no cover art and
dropping the lane shifts every index out of alignment with the thirty that do.
The correct and the incorrect shape are byte-identical; what separates them is
whether a sibling `::: columns` group puts content in that lane. `news_2007` and
`williams2` are open defects with reference backing — they are legitimate targets
in the reference-guided phase, and any rule must keep `goya2`'s five.

**`new_lagq2`'s "duplicated" track is in the source twice.** `FALLA - El Amor
Brujo` appears on two albums. A raw-HTML search finds one occurrence because
markup splits the other; the *stripped* text has both. Not invention, not
duplication — do not chase it. Search stripped source text, never raw HTML, when
testing a conservation claim.

### 19.6 Where the numbers and the rules live

- measured state, killed hypotheses, open queue — this file
- binding law, the ladder, triage, rule contracts — `CLAUDE.md`
- normative syntax — `BioMD-Reference.md`
- generated defect ledger — `analyze/defects.json`
- the procedure for an iteration — `.claude/skills/refine-biomd-converter/SKILL.md`
- harness lessons that cost hours to learn — the sibling `learned-patterns.md`

Start the next phase with `/refine-biomd-converter`.

## 20. The 22-document baseline, and an implementation stricter than its format (2026-08-08)

Two separate things happened here and they are reported separately, because
conflating them is how a re-baseline gets mistaken for a regression.

### 20.1 Baseline first — the nine references joined, no code changed

§19.3 step 1, executed. The nine `new_*` references were placed in
`fixtures/out/`, the holdout parked outside `fixtures/` entirely, and all four
rungs re-run **before** a line of code was touched.

| rung | 13 documents (§19.1) | **22 documents, 2026-08-08** |
|---|---|---|
| L0 | 369 tests, typecheck clean, 0 FAILED | 369 tests, typecheck clean, **0 FAILED** |
| L1 | 93.8 | **90.3** |
| L2 | 314 findings — 188 converter-defect | **746 findings — 581 converter-defect** · 81 ambiguous · 84 reference-inconsistency, 116 classes |
| L3 | 82 | **287** |

**Every one of those movements is nine documents joining the comparison.** The
13 outputs are byte-identical. Attributing any part of the drop to code would be
the mistake §19.3 exists to prevent.

Worst new documents by L1: `new_kolpakov` 67.9 · `new_dyens` 68.5 ·
`new_karta` 78.3. Best: `new_lendle2` 96.1 · `new_bach` 96.8. `new_lagq2`
reports `recall=45.3%` with zero words, links or images missing — §16.2 again,
and still not a loss.

### 20.2 The implementation was stricter than the format, in six places

`BioMD-Reference.md` was revised toward flexibility, and measuring against it
showed the codebase refusing documents the format allows. The governing rule,
now stated in the README and in `profile.ts`: **the converter may narrow what it
emits, never what it accepts.** A narrowing that is a claim about the consuming
renderer belongs in a `TargetProfile`; every other narrowing is a defect.

| what was refused | what the reference says | now |
|---|---|---|
| a four-track `::: columns` | §2 "≥2 `column`", §3 "`columns: 2|3|4`" | 2–4 children; the bounds are the reference's own |
| the `columns: 2|3|4` property | §3, optional | representable and validated; **emission profile-gated**, because the target does not strip a property header inside `columns` (§7.3's quirk, identical to `divider`) |
| palette tokens on a picture `frame:` | §3 `curl / none / mat / black / white / red / gold` | accepted; `shadow` and `oval` kept as legacy so older documents read back unchanged |
| a title wrapped over two `#` lines | §6 — one `#` is "a corpus convention, not a syntax requirement" | `h1-count` is a **warning** |
| a heading level skip | §6 asks for a preserved hierarchy, not an unbroken sequence | `heading-skips-level` is a **warning** |
| nesting depth 4 | §3 allows `align` inside a `column`, so `columns > column > align > image` is ordinary | budget raised 3 → 4 |
| a line over 2200 characters | the reference states no ceiling | `line-too-long` is a **warning**, kept as an under-segmentation detector |

**The severity split now follows §0.** `MUST` — a parser, renderer, value,
nesting or path constraint — is an error; `SHOULD` and `MAY` are warnings,
however strong the preference. Three checks were errors on preferences the
reference states as conventions, which made conforming documents fail and taught
every consumer of the `errors=` column to distrust it.

### 20.3 `align` containing `frame`: legal, pointless, and neither rejected nor rewritten

`new_karta`'s reference nests a `::: frame` inside an `::: align`. The user
settled it: not a rule violation, but the inversion is what makes sense — a
frame occupies the full width of its container, so an `align` around one has no
slack to work with, while `frame` wrapping `align` is exactly "a bordered notice
with centred contents".

`BioMD-Reference.md` §2 now records this, and it constrains implementations in
both directions: a validator MAY advise, MUST NOT reject, and **MUST NOT
rewrite**. `makeAlign` already accepted it — the `BoundedContent` comment
claiming otherwise was describing a check that never existed — and the validator
now emits `align-wraps-frame` at warning severity, with the inverted shape tested
for non-firing.

### 20.4 `---` and `***` are one construct — an instrument correction

Declared as an isolated instrument change under invariant 2. §1 of the reference
now states the equivalence outright: `---`, `***` and `___` are three spellings
of one thematic break, and the difference MUST NOT be reported.

`structdiff.ts` was reporting it, as `separator.spelling`. One instance across
the 22 documents — three references write `***` at least once while every
produced document writes `---` — and it is precisely the "invisible Markdown
difference" the project objective names as something not to chase. Removed;
`break.missing` and `break.spurious` are untouched and tested for non-firing,
because a separator that is absent or added is a claim about the document rather
than about how it is typed.

### 20.5 Measured effect — output byte-identical, no rung regressed

| | before (§20.1 baseline) | after |
|---|---|---|
| L0 typecheck | clean | clean |
| L0 tests | 369 | **388** (+19 contracts) |
| L0 FAILED conversions | 0 | **0** |
| **`bench/out/` bytes** | — | **identical, all 22 documents** |
| L1 overall | 90.3 | **90.3** |
| L1 clean share | 4.5 % (1 of 22) | **9.1 % (2 of 22)** |
| L2 findings / converter-defect | 746 / 581 | **745 / 580** |
| L3 findings | 287 | **287** |

The only L2 movement is the one `separator.spelling` finding, which is the
instrument correction and nothing else — no other class moved by a single
instance. Conversion quality cannot have changed, because the conversion did not
change: every output byte is the same.

Validation diagnostics corpus-wide are now 24 `table-header-empty` errors (the
known hook territory, §5.3), 7 `complexity-budget` errors and 3 `line-too-long`
warnings. `new_geyzel04` went `REVIEW` → `ok`: §16.5 recorded it as "nesting
depth 4 against a budget of 3", and the budget was the thing that was wrong.

### 20.6 What was deliberately *not* changed, with the measurement that decided it

**`enforceSingleTitle` was left alone.** §6 no longer requires a single `#`, so
the guard is no longer mandatory — but it never fires: **0 title repairs across
23 manifests, and all 22 produced documents already emit exactly one `#`.**
Relaxing it would therefore change nothing measurable and could not be falsified.

The two references that write a wrapped masthead as two `#` lines inside an
`::: align` — `new_bach`, `new_lagq2` — are not blocked by that guard. They need
*heading recovery* to recognise a title split across two lines, which is a rule
change with its own contract, its own false friend (two `#` separated by content
are two titles, not one wrapped one) and its own four-rung adjudication. It is
refinement work, not a permissions fix, and it is queued as such.

### 20.7 Killed hypotheses added

- **A type union can carry a per-container nesting rule.** `BoundedContent`
  claimed to exclude `columns` and `nav`; it never did — `BlockContent` is
  augmented with every directive. The three containers forbid *different* things,
  so the constraint is only statable per container, which is where it already
  lived. A comment asserting a check that does not exist is worse than no check.
- **A validator error is the right home for a strong preference.** Three were,
  and the cost was not pedantry: `errors=` became a column nobody could act on,
  and a conforming wrapped masthead was indistinguishable from a broken document.
  Severity must track `MUST` vs `SHOULD`, not how strongly the implementer feels.
- **A guard that is no longer required should be removed.** Not without measuring
  whether it fires. `enforceSingleTitle` is now optional and still inert;
  deleting it would have been an unfalsifiable change presented as a fix.

### 20.8 State

| rung | value |
|---|---|
| L0 | 388 tests, typecheck clean, 0 FAILED conversions |
| L1 | 90.3 over 22 documents |
| L2 | 745 findings — **580 converter-defect** · 81 ambiguous · 84 reference-inconsistency |
| L3 | 287 findings, identity 0, deterministic |

**Open, in order.** (a) `new_lagq2` — its reference gives the seven album records
6 `::: columns` / 12 `::: column` and the converter emits **zero**, so §19.4's
question is answered *yes* and the `recovery.test.ts` DATA-path contract and the
CATALOG width gate must now be revisited **together**. Take it first, out of rank
order. (b) `new_karta` answers §17.5 Q1: variable-arity records become GFM tables
with supplied labels, the unnamed link columns headed with a link glyph — which
also makes the two `analyze.md` requests L5 filed as "proposals" reference-attested
work. (c) The mini-image → glyph family: specified in `mini_images_to_md_guide.md`,
attested in 10 of 22 references (25 glyph instances), and entirely absent from
`src/`. (d) Wrapped-masthead heading recovery (§20.6). (e) The 0.5–0.95 ambiguous
corridor, still uncalibrated, now over 81 findings.

## 21. Four mechanisms, and the page frame was three of them (2026-08-08)

The first refinement iteration against the 22-document baseline. Four accepted
changes, one conceptual mechanism each, every one adjudicated on all four rungs.

| rung | §20.8 | now | reproduce with |
|---|---|---|---|
| L0 | 388 tests, 0 FAILED | **405 tests**, typecheck clean, 0 FAILED | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | 90.3 | **92.6** | `sh bench/run.sh` |
| L2 | 745 findings · 580 converter-defect | **508 · 327** | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | 287 | **149** | `l3 -c bench/biomd.config.json` |
| validator errors | 23 | 28 | `corpus run -c bench/biomd.config.json` |

Per document, converter-defects: `new_dyens` 34 → **0** · `new_lagq2` 84 → **9**
· `new_karta` 60 → **7** · `new_geyzel04` 92 → **7** · `new_bach` 42 → **5** ·
`williams2` 4 → **35** (a recorded reference-inconsistency, §21.5).

### 21.1 `paragraph.containment` was not one mechanism — it was three

141 instances over 7 documents, ranked first, and the standing hypothesis was
that it was the missing-lane story. Grouping the findings by *what moved where*
took ten minutes and split the class immediately:

| shape | inst | documents |
|---|---|---|
| reference top level → produced inside `columns/column` | 91 | `new_geyzel04` 75, `new_bach` 16 |
| reference inside `columns/column` → produced top level | 40 | `new_lagq2` |
| `frame/align/paragraph` → `frame/paragraph` | 6 | `new_lendle2`, `news` |

The dominant half is the **opposite** of the missing-lane hypothesis: spurious
lanes wrapping ordinary prose, not absent ones. **Group a class by the direction
of its findings before believing a single explanation of it.**

### 21.2 The page frame, and why it produced two different defects

Every one of the 22 documents draws the same site template — a one-row,
three-column band, measured `[116, 529, 115]` in a 760 px row: an empty margin
cell, the article, and a decorated rail. On nineteen documents the rail is empty
and `layoutFrom` correctly emits one lane and flattens. On three it is not:

| document | rail holds | produced | reference |
|---|---|---|---|
| `new_geyzel04` | side menu | `columns` + 82-block lane + **empty lane** | no `columns` |
| `williams2` | side menu | `columns` + 26-block lane + **empty lane** | `columns` + **one** lane |
| `new_bach` | off-site credit badge | `columns` + 28-block lane + 1-block lane | no `columns` |

Two mechanisms, both accepted:

**(a) Lane occupancy was measured on the wrong input.** `laneColumnsOf` read the
*source* grid while the region was assembled from the *lowered* blocks. A cell
holding nothing but a menu is source-occupied and lane-empty, because
`layoutFrom` folds a `nav` out of the lane by design — `navFromGrid`'s own header
says "`layoutFrom` folds the resulting lane away", and it did not. The emptied
rail contributed a `::: column`, and that column was the second one keeping the
region alive. `laneColumnsOf` now takes an occupancy predicate; the default still
reads the source cell, which is right for a grid nobody has lowered yet.

One trap worth recording: cells *absent* from a row (colspan continuations) must
stay skipped rather than counting as empty lanes. Treating them alike added five
spurious regions to `new_lendle2` and two to `news_2007` in an intermediate
version, and L1 caught it at 90.2 before anything else did.

**(b) `pageRailColumns` — the rails are decoration, by geometry and position.**
The row's middle column is the widest and both outer columns are far narrower.
Keying on what the flanks *are* rather than on what they hold is what makes one
rule cover a rail with a menu, a rail with a badge, and twenty empty ones.
`MAX_RAIL_SHARE` swept 0.3 – 0.9: L1 is 92.6 at every value, because the corpus
measures 0.22 for both real rails and 1.00 for the nearest non-rail.

### 21.3 `new_lagq2` answered §19.4: the CATALOG gate was wrong, the contract was not

The tier-1 CATALOG gate asked for two lanes of near-equal width plus an image
density. A 150 px cover beside a tracklist has no reason to be 50/50 —
`new_lagq2` splits **37/63**, missed the gate, scored DATA at tier 2, and a DATA
verdict that cannot be planned falls straight to linear flow.

`picturePairedRows` measures the relation the gate was reaching for: the share of
content rows in which one cell is a bare picture and the other carries words.
Corpus-wide it is non-zero on nine grids and 1.00 on seven; the new tier-1 gate
fires on `paired === 1` with a two-row recurrence requirement and changes the
routing of **exactly one grid** in the corpus.

So §19.4's pre-registered question resolves *without* touching
`recovery.test.ts`'s "leaves a DATA verdict on the flow path" contract or §18.3's
killed hypothesis: the grid simply never becomes DATA now. Classification, not
routing, was the thing that was wrong.

### 21.4 A table nobody could name is still a table

`synthesizeHeader` was all-or-nothing: a column with no recurring label got an
empty header cell, but if *no* column had one it returned null and the whole
table was abandoned. The ledger said so in plain words — "classified DATA but not
representable as a table (no source header row and the classifier abstained);
emitted as flow" — and the cost was the matrix. `new_dyens`'s five score records
came out as twenty loose `::: align` blocks with three work titles read as
quotations, which is the false friend §16.4 traced to exactly this.

A blank header row is not conformant either: `BioMD-Reference.md` §1 (Tables) —
"Every GFM table column MUST have a header". So the fix is the header the
references write. `isLinkColumn` asks whether every populated cell of a column is
a short anchor, and such a column is headed with U+1F517 LINK SYMBOL.

That is not invention, and the human record settles it rather than the references
doing so alone: `analyze/analyze.md` asks for this symbol in the same words on
three separate pages — *"&#128279; просто показывает символ ссылки (Link) — он
универсальный"* — and the references write it 16 times across six documents.
A symbol for "link" asserts nothing the source does not already state by holding
the link. The **subject** column stays empty: `Название`, `Композиция` and
`Формат` appear nowhere in any source, so naming it would be §16.3 invention, and
L2 already triages every such reference cell as `reference-inconsistency`.

New lexical data file `src/convert-core/glyphs.ts` (`CLAUDE.md` §3.5), which is
also the home the unbuilt icon → glyph map of open item (c) needs.

**Instrument correction, both sides re-baselined.** `stripMarkup` now resolves
numeric character references. `CLAUDE.md` §4 already lists entity decoding among
what L2 adjudicates and it did not, so the link glyph against the references'
`&#128279;` read as a difference for output that was exactly right. The fold
changes a character's *spelling*, never which character it is, so the typography
blind spot next door is untouched — `«` versus `"` is still a finding, and the
contract asserts that `&#9654;` still differs from `&#128279;`.

**Validator errors 23 → 28**, and the increase is honest rather than hidden: all
of it is `table-header-empty` on the subject column of tables that previously did
not exist at all, less one on `kiselev` that the glyph filled. The column has no
attested name; the alternative to the error is losing the records.

### 21.5 `williams2` — a reference-inconsistency, recorded not chased

`williams2` went 4 → 35 converter-defects, and every one of them is the same
fact: its reference wraps the whole article in a `::: columns` containing
**one** `::: column`, and the converter now emits linear flow.

- `BioMD-Reference.md` §2 requires `columns` to have **≥2 `column`** children, so
  the reference's region is not conformant. (Our own validator does not check
  this — recorded as instrument debt, not fixed here.)
- The two other documents whose source frame is byte-identical in the relevant
  respect — `new_geyzel04`, `new_bach`, both rails holding a folded menu or badge
  — have references with **no** `columns` at all.
- `layoutFrom`'s own long-standing comment already says a one-lane region "would
  claim a layout the author did not draw".

The references therefore disagree with each other on identical input, and no rule
can produce both. Verdict 3, `reference-inconsistency`. Flagged to the user
rather than closed by a special case.

### 21.6 Killed hypotheses added

- **`paragraph.containment` is the missing-lane mechanism.** 91 of its 141
  instances were the opposite defect — spurious lanes wrapping prose. Grouping by
  the direction of the move falsified it in one query.
- **A narrow flank beside a dominant column is a page rail.** Falsified *before*
  it was written: `new_blackmore`'s reference lanes measure **29/71** with the
  *text* in the narrow lane, so the rule would have cemented its three open
  `column.missing` findings. Being flanked on **both** sides is the discriminator;
  width alone is not.
- **An mdast `html` node is a way to emit a character reference.** It serializes
  correctly and then trips `raw-html` *and* `table-cell-block-content`, both
  correctly. Emit the character and fold the spelling in the instrument instead.
- **The all-empty header row was a different question from the empty header
  cell.** It was the same answer repeated, and treating it as a separate case
  cost two whole record matrices.

### 21.7 State and queue

**Open, in order** — re-ranked over 22 documents after the four changes:

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 405 | `paragraph.containment` | 27 | 5 | **19 are `williams2` §21.5 and not a target**; the real remainder is 8 |
| 288 | `align.spurious` | 12 | 8 | alignment residue; the region work has now settled, so re-read the family together |
| 252 | `retyped.paragraph-to-align` | 12 | 7 | same family |
| 165 | `retyped.paragraph-to-list` | 11 | 5 | blocked on a hook design (§15.2), unchanged |
| 162 | `align.missing` | 9 | 6 | same family as the two above |
| 84 | `image.size.value` | 21 | 4 | a threshold in `media.ts`; sweep it, do not pick it |

The alignment family is now the largest actionable thing in the corpus (33
instances across three classes and 9 documents) and is the natural next
mechanism. Also still open and unchanged from §20.8: the mini-image → glyph map
(c) — `glyphs.ts` now exists to hold it — wrapped-masthead heading recovery (d),
and the uncalibrated 0.5–0.95 ambiguous corridor (e), now 94 findings.

`new_blackmore`'s three `column.missing` findings are open by *decision*: their
grids are one row each, so the pairing gate's recurrence requirement excludes
them. Their evidence is recurrence across sibling grids on the page, which the
classifier does not see. Dropping the requirement to reach them would admit the
figure-over-caption false friend; the right fix is to give the classifier that
cross-grid view, which is a corpus-pass change and its own mechanism.

## 22. Cross-grid recurrence, and a one-row table that stays killed (2026-08-08)

| rung | §21 | now |
|---|---|---|
| L0 | 405 tests | **406 tests**, typecheck clean, 0 FAILED |
| L1 | 92.6 | **92.7**, clean share 9.1 % → **13.6 %** |
| L2 | 508 · 327 converter-defect | **481 · 300** |
| L3 | 149 | **140** |
| validator | 28 errors | 28 |

### 22.1 Recurrence may come from a sibling grid

§21.7 left `new_blackmore`'s three `column.missing` open *by decision*: the
picture-pairing gate wanted two paired rows inside the grid, and `new_blackmore`
writes each of its three interview cards as its own one-row table with prose
between them. The recurrence is real; it is simply invisible from inside any one
grid.

`classifyTable` now takes an optional `PageEvidence`, computed once in
`pipeline.ts`'s classification loop where every grid is already in hand. The gate
accepts **two paired rows in the grid, or one paired row plus a picture-paired
sibling elsewhere on the page.** That honours `CLAUDE.md` §5's recurrence
requirement rather than relaxing it — the shape must still repeat with content
between occurrences — and the false friend stays refused: one picture beside one
line with nothing like it on the page is a figure over its caption, and belongs
to `media.ts`.

`new_blackmore` 35 → **8** converter-defects, L1 93.4 → **96.4** (dirs 62.5 →
92.7). The three `retyped.paragraph-to-align` findings downstream of the missing
lanes closed with them, which is worth noting on its own: **a third of the
alignment family was a symptom of the region family**, exactly as §10.2 recorded
the first time.

### 22.2 The one-row record table: killed again, and now for a better reason

Three documents put a single media record in a one-row grid and the converter
flattens all three into `::: align` blocks — `borislova`'s `WMA`, `new_karta`'s
`WMA`, `new_kolpakov`'s `Венгерка | WMA | (1,7 Mb)`. Those account for most of
the `align.spurious` class, and `new_kolpakov` is the corpus's weakest document
at L1 67.9 with `tables=0/1`.

§17.4 killed "recurrence among accepted peers licenses a one-row table" on a
*measured* blocker: "`tableFromPlan` cannot synthesize a header from one row".
§21.4 removed that blocker, so the hypothesis was legitimately reopenable — new
measurement, not argument.

It was reopened, measured, and is dead again. A predicate for the shape — a
one-row grid of 2–4 columns whose first cell carries words and whose others hold
a single short anchor each — matches **exactly three grids in the corpus**:

| document | grid | reference emits |
|---|---|---|
| `borislova` | 1×2 | a table |
| `new_karta` | 1×4 | a table |
| **`williams2`** | 1×2 | **`::: align`**, text and `[MP3]` on two lines |

The references disagree 2–1 on structurally identical input, and the dissenter is
in the regression corpus. `new_kolpakov`'s row is not even covered by the
predicate — its third cell is `(1,7 Mb)`, an unlinked size annotation, and
widening the predicate to admit it also admits every two-cell layout row.

So: three instances, no majority to follow, a regression-corpus document on the
other side, and no intra-grid recurrence available by construction. `minRows: 2`
stands. Recorded rather than shipped.

### 22.3 Killed hypotheses added

- **A one-row media record licenses a one-row table.** Reopened legitimately once
  §21.4 removed the emitter blocker §17.4 killed it on, then killed again on
  better evidence: the shape occurs three times corpus-wide and the references
  split 2–1, with `williams2` — regression corpus — writing `::: align`.
- **The alignment family is its own mechanism.** A third of it closed as a side
  effect of the region work in §21.2 and §22.1 without an alignment rule being
  touched. Read the family *after* the region and table families have settled,
  not alongside them.

### 22.4 State and queue

**Open, in order** — *measured* 2026-08-08 over 22 documents:

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 405 | `paragraph.containment` | 27 | 5 | 19 are `williams2` §21.5 and **not a target**; real remainder 8 |
| 288 | `align.spurious` | 12 | 8 | 4 are `williams2` §21.5, 3 are §22.2. Real remainder ≈5, and thin |
| 165 | `retyped.paragraph-to-list` | 11 | 5 | blocked on a hook design (§15.2) |
| 162 | `align.missing` | 9 | 6 | |
| 162 | `retyped.paragraph-to-align` | 9 | 6 | |
| 120 | `image.spurious` | 8 | 5 | |
| 84 | `image.size.value` | 21 | 4 | a threshold in `media.ts`; sweep it, do not pick it |

Two observations for whoever takes the next iteration. First, **the top of the
ledger is now thin**: after removing `williams2`'s reference-inconsistency and
§22.2's dead class, no open class has more than about ten actionable instances,
and the largest single-document concentration left is `goya2`'s 16
`image.size.value` — a `media.ts` threshold, which the sweep discipline covers.
Second, the two biggest remaining *documents* are `news` (49) and `goya2` (43),
both regression corpus and both long-known; they are worth a document-shaped
read rather than a class-shaped one.

Unchanged and still open from §20.8: the mini-image → glyph map (`glyphs.ts` now
exists to hold it), wrapped-masthead heading recovery, and the uncalibrated
0.5–0.95 ambiguous corridor (94 findings).

## 23. Two author adjudications, and the re-baseline they require (2026-08-08)

Both open questions were put to the reference author and both were answered. The
answers changed two references, so this section is a **re-baseline**, not an
improvement: no converter code changed between §22 and the numbers below.

| rung | §22 | after the reference corrections |
|---|---|---|
| L0 | 406 tests, 0 FAILED | **406 tests**, typecheck clean, 0 FAILED, identity contract green |
| L1 | 92.7 | **92.7** (`williams2` 98.6 → **99.5**) |
| L2 | 481 · 300 converter-defect | **453 · 271** |
| L3 | 140 | **110** |
| validator | 28 errors | 28 |

`williams2` 35 → **3** converter-defects. `new_blackmore` 8 → **11**, and the
three new ones are a real converter defect the old reference was hiding.

### 23.1 `williams2`'s one-lane `::: columns` was a mistake in the reference

§21.5 recorded the converter's flattening as a `reference-inconsistency` and put
the side-by-side to the author. Ruled: **the wrapper was an accidental reference
mistake, not a layout choice.** The author removed it, and the spec-compliant
flattened representation is authoritative for this shape.

So §21.5's 31 findings were never a target and are now simply gone. The three
documents that draw the site's page frame — `new_geyzel04`, `new_bach`,
`williams2` — now agree with each other and with `BioMD-Reference.md` §2.

**Do not re-investigate this.** It is a human-adjudicated reference correction.

One factual correction to §21.5 while it is being read: the wrapper was properly
closed. The `git diff` of the author's edit removes two openers *and* their two
closers; a fence-walk during adjudication reported it as unclosed and that was
wrong. The arity — one `::: column` where §2 requires ≥2 — was the real defect
and is what the ruling turned on.

### 23.2 The wrapped masthead is not a reference disagreement — it is two rules

§20.6 and OPEN §3.1 recorded the three mastheads as references contradicting each
other. **That was a stale index entry, and the fixture on disk contradicted it.**
`new_blackmore`'s reference does not join its title; it carries two headings at
two levels, and the author had already corrected it. Verify against
`fixtures/out/`, never against a summary of it.

Ruled by the author, and it splits into two different shapes:

| document | reference | what it is |
|---|---|---|
| `new_blackmore` | `# Ричи Блэкмор Ritchie` + `## Blackmore & Blackmore's Night` | a **title and its subtitle** — two headings, two levels |
| `new_bach` | `::: align` + `# Иоганн Себастьян` + `# Бах` | **one headline** split across two lines |
| `new_lagq2` | `::: align` + `# Лос-Анджелесский` + `# гитарный квартет` | the same |

The author's reasoning for the second shape, recorded because it is not derivable
from the spec: the two lines are *one contextually related heading*. It could be
joined into a single line, but the renderer displays consecutive `#` lines inside
an `::: align` across two lines, which is the intended visual — and `#` + `##`
is **wrong** for it, because that would assert a hierarchy the headline does not
have. The author also rates it **not critical: a visualisation matter, not a
correctness one.**

All three are therefore converter defects, and the converter currently gets all
three wrong in the same direction — it emits one `#` and demotes the rest:

| document | produced |
|---|---|
| `new_blackmore` | `# Ричи Блэкмор Ritchie Blackmore & Blackmore's Night` — both headings joined |
| `new_bach` | `# Иоганн Себастьян`, then `::: align` holding a bare paragraph `Бах` |
| `new_lagq2` | `# Лос-Анджелесский`, then a bare paragraph `гитарный квартет` |

**The discriminator is source typography, and it is available.** Two masthead
lines of the *same* prominence are one headline split, and become two `# ` lines
inside the `::: align`. Two lines of *different* prominence are a title and its
subtitle, and become `#` + `##`. The false friend for both is the one §20.6
already named: two headings separated by content are two headings, not one
wrapped one — the lines must be adjacent inside the same masthead region.

Queued, not built: the author de-prioritised it, and it is a heading-recovery
rule with its own contract and its own four-rung adjudication.

### 23.3 What this says about the record

Two of the four "reference disagreements" this campaign has recorded turned out
to be a reference mistake and a stale index entry. Neither survived contact with
`fixtures/out/`. The standing instruction in `.claude-memory/INDEX.md` — *"where
this index and a repository file disagree, the repository file wins and this
index gets fixed"* — earned its place twice in one session; **read the fixture,
not the summary of the fixture**, before recording a reference as inconsistent.

The two adjudications also confirm the value of asking. §21.5 correctly refused
to close the finding by special-casing the converter, and refused to edit the
reference; putting the side-by-side to the author resolved in one exchange what
no amount of deterministic evidence could have.

## 24. Five mechanisms: the wrapped masthead, the drawn rule, and three instruments that were lying (2026-08-08)

One iteration, five accepted changes, one commit each with the measured
before/after on every rung in the message. Nothing regressed on any document.

| rung | §23 | after |
|---|---|---|
| L0 | 406 tests, 0 FAILED | **420 tests**, typecheck clean, 0 FAILED |
| L1 | 92.7 | **93.0** |
| L2 | 453 · 271 converter-defect | **432 · 252** |
| L3 | 110, 20 critical | **97, 10 critical** |
| validator | 28 errors | 28 |

Per document, L2 converter-defects: `new_bach` 5 → **2**, `new_lagq2` 9 → **6**,
`new_blackmore` 11 → **8**, `pavlov_azancheev` 9 → **7**, `segovia` 14 → **13**,
`tarrega` 6 → **5**, `news` 49 → **48**. `goya2` 43 → 44 and `new_bach` gained one
finding of its own; both are explained in §24.4.

### 24.1 The wrapped masthead is containment × typography

§23.2's author ruling settled the *levels*. Building it produced the rest of the
rule, because the ruling's two cases are two cells of a four-cell table and the
corpus fills all four. The two questions are **containment** — did the author
draw the lines as separate blocks, or hand-wrap one block with `<br>` to fit the
458 px cell — and **typography** — are the lines set the same way as each other:

| lines are | set | representation | attested by |
|---|---|---|---|
| separate blocks | the same | consecutive `#` inside the box's `::: align` | `new_bach`, `new_lagq2` |
| separate blocks | differently | `#`, then the smaller line as its own block | `goya2`, `new_karta` |
| one block, `<br>` | the same | one joined `#` — the break is a hand-wrap | `segovia1`, `new_geyzel04` |
| one block, `<br>` | differently | `#` then `##` — a title and its subtitle | `new_blackmore` |

Only rows 1 and 4 are new; rows 2 and 3 are what the converter already did, and
are now attested rather than accidental. **The first implementation claimed rows
1 and 2 and regressed `segovia1`, `new_geyzel04` and `goya2` in one run** — the
containment half was found by that regression, not by reading the sources.

`markWrappedMasthead` in `headings.ts`. The masthead *box* is the outermost
ancestor of the title candidate reachable without crossing a layout cell whose
whole text is still headline-sized; that cap is what excludes two headings with
an article between them (§20.6's false friend). `SAME_SIZE_TOLERANCE` swept over
22 documents: L1 92.8 at 0, 0.10 and 0.30, 92.7 at 0.35 — flat across the whole
plausible range with the cliff exactly where a third of a size stops counting as
a difference. A limit, not a discriminator.

`enforceSingleTitle` now treats **adjacent** `#` lines as one title. Titles
separated by content are still competing titles and still demoted. §20.6 recorded
the guard as inert; it stopped being inert the moment a document legitimately
wanted two.

### 24.2 Two folds that destroyed the evidence they were recording

The `<br>` half of the masthead needed the typography of *part* of a line, and
`normalize` was throwing it away twice over.

`annotate` folded a presentational wrapper's `size` onto its **parent** and then
unwrapped the wrapper. Where the wrapper covered only part of the parent that
fold is simply false — it asserts a size of text the wrapper never covered — and
the unwrap then erased where the distinction began and ended. A wrapper that is a
partial cover is now **kept**, carrying the evidence on itself. Measured alone:
**no change on any rung**, on any of the 22.

Keeping *full* covers as well was implemented and measured: it costs
`new_lagq2`'s `## ДИСКОГРАФИЯ` and `### The Best of the L.A.G.Q` and
`new_lendle2`'s `## Дискография`, because the kept `<font>` becomes the innermost
carrier of the text and reports the smaller size the whole label is set in.
`textFontPx` reads the folded value instead, and is scoped to run-to-run
comparison for exactly that reason: block *ranking* keeps `effectiveFontPx`.

### 24.3 A rule the author drew, and the byline it exposed

`* * *` and `• • •` between two passages are the dinkus this era used where it
had no `<hr>` it liked. Kept as a paragraph the construct is lost and the reader
gets `\* \* \*`. The invariant is **cardinality, not typography**: one ornament
repeated at least three times and nothing else in the block, no link, no image.
That is what excludes every false friend the corpus contains — `• Из письма
А.Максимова` is a bulleted label, a lone `*` is a footnote marker. `RULE_GLYPHS`
is lexical data in `glyphs.ts`; an unlisted ornament stays a paragraph.

Closed `retyped.paragraph-to-break`: **5 instances, 5 documents, all regression
corpus**.

It immediately exposed a defect that was already open in two others.
`promoteSectionAfterRule` reads the short line under an author-drawn rule as a
section label, and with one more rule on the page `Владимир МАРКУШЕВИЧ` became
`## Владимир МАРКУШЕВИЧ`. `new_blackmore` already did the same to `Александр
НЕВЕРОВ`. The rule's own docstring names the discriminator: the line it is for
"carries no weight, no size and no centring … its position is the whole
evidence", so a block carrying its **own** positional evidence is answering a
different question. A short line set **right** of the column is a credit
(`BioMD-Reference.md` §3 has a directive for the shape) and both references write
these as `::: align position: right`.

Only `right`. Excluding every distinctively aligned block was measured and costs
`borislova` the centred discography label the rule was built for.

### 24.4 Two instruments that were lying, and what they hid

**The chrome fingerprint hashed the raw `width` attribute.** `news` writes every
width in its page frame with a `px` suffix — which the attribute does not accept,
so a browser drops it — and no other page in the corpus does. Its banner, menu
button and side rails therefore matched no recurring structure and were emitted
as content: the document opened with the site's strapline and `album.gif` instead
of `# Новости`. The chrome model *is* a recurrence model, so anything splitting
one recurring shape into two is a defect in the instrument's own terms.
Normalizing the length before hashing (a percentage keeps its unit) cost L3 13
findings on its own: **106 → 93**. Requires `corpus scan`.

**`followsImage` returned true for any preceding sibling containing an image
anywhere inside it.** It decides caption against section label, and the picture
has to be one still looking for its words. `new_blackmore` sets each reprinted
interview under a small table holding the paper's date and a linked masthead
image; two of seven article titles read as captions of a newspaper logo. `goya2`
lost `ДРУГИЕ АЛЬБОМЫ` the same way. A preceding block carrying a picture **and
its own visible text** has already said what it is.
`retyped.paragraph-to-heading2` 6 instances / 4 documents → **4 / 3**, and L3's
critical `layout.order.mismatch` halved, 20 → 10.

It also raised L2 by two, and both are worth recording rather than absorbing:

- **`goya2`'s reference wraps the recovered `## ДРУГИЕ АЛЬБОМЫ` in an `::: align
  position: center`.** `alignedGroup` and `alignableRunMember` both decline
  headings, and correctly — §2 positions a heading by its own construct — so
  recovering the heading trades one `retyped.paragraph-to-heading2` for an
  `align.missing` plus a `heading.containment`. **Open question for the author**,
  because the references disagree with each other about it (see §24.5).
- **`new_bach` writes six chapter titles as `<p ALIGN="CENTER">…</p>`**,
  byte-identical shapes in one series. Its reference makes five `##` and the
  sixth an `::: align` holding plain text. The converter now treats all six
  alike. Verdict 3, `reference-inconsistency`; the source attests the produced
  side and nothing attests the reference's exception.

### 24.5 What the references disagree about — for the author

One source shape, `<p align="center">SHORT LABEL</p>` above its own body, is
written three ways across two references:

| document | source | reference |
|---|---|---|
| `new_bach` ×5 | `<p ALIGN="CENTER">Веймарский период (1708-17)</p>` | `## Веймарский период (1708-17)` |
| `new_bach` ×1 | `<p ALIGN="CENTER">Годы странствий (1703-08)</p>` | `::: align` + plain text, no heading |
| `goya2` ×1 | `<p align="center">ДРУГИЕ АЛЬБОМЫ</p>` | `::: align` + `## ДРУГИЕ АЛЬБОМЫ` |

The converter currently emits a bare `##` for all of them, which is internally
consistent and matches the majority reading. The question is whether a recovered
centred section label **keeps its `::: align`**, as `goya2` has it. It is the same
construct the masthead rule already emits for a split headline, so the answer is
a reusable rule, not a per-document choice.

**Answered by the author, 2026-08-08: a bare `##`, and the centring is dropped.**
The heading level carries the structure and `BioMD-Reference.md` §2 positions a
heading by its own construct; the wrapper is for a *split headline*, where it is
what makes consecutive `#` lines one heading, and for nothing else. So the
converter's current output is authoritative for all three cases and **no code
changes**. The two findings §24.4 recorded as open on `goya2` —
`align.missing` at `/align[71]` and `heading.containment` at
`/align[71]/heading[0]` — are `reference-inconsistency`, verdict 3, and are not
targets. Do not re-investigate.

Second, smaller: `new_blackmore`'s reference splits its masthead
`# Ричи Блэкмор Ritchie` / `## Blackmore & Blackmore's Night`. Measured in the
browser, the source renders `Ричи Блэкмор` at 26.7 px and `Ritchie Blackmore &
Blackmore's Night` at 16 px as **two line boxes**, so the reference moves one word
across a boundary the source draws twice — a `<br>` and a font-size change. The
produced split is `# Ричи Блэкмор` / `## Ritchie Blackmore & Blackmore's Night`.
Recorded as `reference-inconsistency`; two minor `heading.content.edited` remain.

### 24.6 Killed hypotheses added

- **An inert guard should not be shipped.** True, and the measurement has to
  cover both paths. The masthead-box exclusion in the section loop fires on
  nothing across the 22 documents *measured*; it was removed on that evidence and
  a contract immediately failed, because **unmeasured** the folded `<font size>`
  is all the evidence there is and `goya2`'s `(дискография)` gets promoted. A
  guard that holds the measured and unmeasured paths together is not inert.
- **A masthead written as `<center>` is reachable by this rule.** It is not:
  `normalize` unwraps `<center>` before heading recovery runs, so the lines have
  no box to be lines of. All 22 mastheads in the corpus use a `<div>`; recorded
  as a known limit rather than chased.
- **Same prominence across two masthead lines always means two `#`.** No — that
  is true across sibling *blocks* and false inside one block, where a `<br>`
  between lines set the same way is a hand-wrap. Killed by `segovia1` and
  `new_geyzel04`, whose references join theirs.

### 24.8 A menu keeps its label, and a lane is not a frame

`align.spurious` was the top-ranked class when §24.7 was written, and its two
`news` / `news_2007` instances were both the same construct: `• Архив новостей •`
emitted as a loose centred paragraph above the year bar.

**The label above a menu titles it.** §11 already says so and the existing branch
already implemented it — for a *recovered heading*. Both news pages set theirs in
a tinted, bordered, centred cell of its own, where no typographic rule reaches
it, so it arrived as an aligned paragraph and the branch never saw it. Position
is the evidence in both cases; which construct the label happened to land in is
not. The matched bullets are decoration, and **symmetry** is what says so — which
is what keeps the rule off a label that merely *starts* with a marker, since a
leading bullet is a list marker and `stripLabelGlyphs` answers that case
differently. False friend, tested: a sentence above a menu, refused on length,
word count and terminal punctuation at once, because absorbing one would move
body text into a directive property.

**`navFrom` refused every bounded context.** `BioMD-Reference.md` §2 forbids
`nav` inside a `frame` and forbids `align` wrapping one; it does **not** forbid a
`column` — `column→Markdown+leaf+align+nav` is in the nesting table, and the side
rail a menu arrives in *is* a lane. `navFromGrid` already draws that line and its
header says why. So `news_2007`'s year bar — the same bar `news` emits as a
`nav`, one lane deeper — came out as ten bracketed links in a paragraph.

The third instrument-shaped defect of the iteration, and the one most at risk of
being reasoned into rather than measured: §18.3's trap is exactly "these two
paths should agree". It was **measured**, and `recovery.test.ts` and
`lanes.test.ts` were grepped for nav contracts first; both still pass. L1 92.9 →
**93.0**, L2 440 · 258 → **432 · 252**, `news` 48 → 46 and `news_2007` 9 → 5
converter-defects, L3 flat.

The `align` half needs no guard of its own: `alignedGroup` refuses inner content
containing a `nav`, and `isBounded` keeps one out of `groupAlignedRuns`' runs.

### 24.9 State

**Open, in order**, *measured* after all five mechanisms:

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 120 | `retyped.paragraph-to-list` | 10 | 4 | blocked on the hook design of §15.2; 7 are `kiselev` |
| 90 | `align.spurious` | 6 | 5 | 3 are the one-row media table §22.2 killed twice |
| 90 | `retyped.paragraph-to-align` | 6 | 5 | mostly inside `frame` / `columns` |
| 84 | `image.size.value` | 21 | 4 | 16 are `goya2`; a threshold in `media.ts` — sweep it |
| 84 | `align.missing` | 7 | 4 | `goya2`'s is ruled reference-inconsistency (§24.5) |
| 84 | `image.spurious` | 7 | 4 | |
| 60 | `break.missing` | 10 | **6** | widest in the ledger; the entry-separator family |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |

`break.missing` is the widest class left and has never been examined: the
references draw a `---` at structural boundaries the derived-rule logic in
`decomposeFrom` does not reach — `authors` wants two and the converter emits
none, though its only source `<hr>` is the footer's and is correctly dropped.

The mini-image → glyph map remains specified, attested in 10 of 22 references and
unimplemented; `glyphs.ts` now holds `LINK_GLYPH` and `RULE_GLYPHS`, so it has a
home and two neighbours.

## 25. `break.missing` was five mechanisms, and one of them was a setext heading (2026-08-08)

The widest class in the ledger — 10 instances, 6 documents, never examined —
adjudicated instance by instance. It is not a class. It is five unrelated
mechanisms sharing a name, which is §14.1's and §21.1's pattern for the third
time. Two were worth building; two are not targets; one is measured and returned
to the queue.

| rung | §24 | after |
|---|---|---|
| L0 | 420 tests, 0 FAILED | **423 tests**, typecheck clean, 0 FAILED |
| L1 | 93.0 | **93.1** |
| L2 | 432 · 252 converter-defect | **429 · 250** |
| L3 | 97, 10 critical | **95, 10 critical** |
| validator | 28 errors | 28 |

Per document, L2 converter-defects: `kiselev` 17 → **16** (total 56 → 53),
`news` 46 → **45**, `new_blackmore` 8 → **7**. `pavlov_azancheev` 7 → **8**, and
that one is a gain — see §25.1. L3: `news` 16 → **14**, no document higher.

### 25.1 One "missing break" was a setext heading, and three parsers read it three ways

`pavlov_azancheev`'s `break.moved` was not a break. The converter was emitting

```
М.ПАВЛОВ-АЗАНЧЕЕВ (1888-1963).\
(Краткая биография, нотное наследие, первые исполнители, неизвестные письма и документы).
-----------------------------------------------------------------------------------------
```

— a **setext heading**, the only one in the corpus. `mdast-util-to-markdown`
falls back to setext when a heading of depth < 3 contains a `break`, and
`headingPhrasing` exists to guarantee it never does. Its docstring states the
invariant correctly; the implementation folded only *top-level* children, and
`dropEmphasis` runs afterwards and lifts a `strong`'s children back out. So a
`<br>` inside the emphasis survived — and `<b>Title<br></b>subtitle` is how this
era wrote a two-line title with only its first line bold.

**Three readings of one line, which is what makes this a validity defect rather
than a cosmetic one:** `src/eval/blocks.ts` has no setext case and reads the
89-hyphen underline as a `thematicBreak`; `src/eval/facts.ts` *does* have one, so
L1 and L2 disagreed about the same file; `biomd-ast/read()` passes the Markdown
run through opaquely and warns about nothing; CommonMark makes it an `h2` that
swallows the line above. `BioMD-Reference.md` §1 lists `#`…`######` and nothing
else.

`foldBreaks` recurses and copies containers rather than mutating them. It is
scoped to headings by construction — `liftBreaks` stays the path everywhere
else, where a break is meaning rather than line-fitting — and the contract
asserts non-firing there.

The fix cost `pavlov_azancheev` one L2 finding and that is the point: the
phantom `break.moved` is replaced by `retyped.heading2-to-paragraph`, which is
**true**. The reference writes that block as `::: align position: center` with a
bold first line; the converter recovers a `##`. Open, unadjudicated, recorded
here so it is not rediscovered as a break.

It also gained `new_blackmore` two headings it had been losing to the same fold:
L1 95.7 → 97.3, head axis 62.5 → 77.8. Nothing on the page suggested a
connection; only the corpus run found it.

### 25.2 A rule the author drew is a *line*, and it stays in its own block

§24.3 accepted `* * *` and `• • •` on the invariant "the whole **block** and
nothing else". `<br>` is how this era ended a line inside a block, so a rule
drawn above a signature shares its `<p>` with the signature —
`-------------------------<br>Олег Киселев: …` — and no block-level test can see
it. The reader got `\-------------------------`.

The unit is now the line. The five whole-block dinkuses are the degenerate case
where every line is one, so the change subsumes §24.3 rather than competing with
it. The link/image veto moved to the line for the same reason: the signature
*is* such a line, and asking the question of the block suppressed the rule the
question was not about.

**Measured alone this made L3 worse** — `kiselev` 4 → 6 — because the recovered
rule was hoisted out of the `::: align` its source `<p>` belongs to. The second
half fixes that and is general: **a rule may join an alignment run and never open
one.** It carries no text, so it cannot nominate an alignment; but `blocksFrom`
already records the source element's alignment on *every* block that element
produced, and `alignableRunMember` was discarding it with a blanket
`thematicBreak` exclusion. `groupAlignedRuns` now emits a run with no
text-carrying member bare, which is what keeps a lone dinkus at the root and is
the tested false friend.

The align half acts on its own: it closed `news`'s `break.containment` (a rule
produced inside a `frame` the reference puts it outside) with no drawn rule
involved — `news` L2 46 → 45, L3 16 → 14, L1 dirs axis 97.7 → 98.9.

`break.containment` and `break.moved` are both closed, 3 instances, 3 documents.

### 25.3 The three that are not targets, with the evidence

**`authors` ×2 — no source attestation.** Its four biographies are one `<td>` of
`<p class="t">` siblings; the only `<hr>` on the page is the footer's and is
correctly dropped. The reference draws `---` after the first entry's press
clipping and before the last entry, but **not** between the second and third,
which are the same shape. The vertical gaps rank the three boundaries
2 `<br>` + `&nbsp;` > 1 `<br>` + `&nbsp;` > margins alone, and the reference
separates the largest and the *smallest* and skips the middle. No deterministic
signal orders them that way. Verdict 3/4, not a target.

**`news` ×4 — the reference is inconsistent about the same shape.** Measured by
listing the 33 content rows of the entry grid against both files (probe in the
session scratchpad): the author used spacer rows as the entry device but omitted
them at 8 boundaries. The reference draws `---` at rows 20, 21, 24 and 28 and
**not** at 18 and 19 — five sibling `<tr>`s of identical shape, `17→18→19→20→21`,
separated at only the last two. Separating every content-row boundary would close
4 and open 2; §3340's comment already records that separating every row
over-emits by ten. Neither device is right and no third one is attested.
Ambiguous — L4/author territory.

Also measured, and worth keeping: the reference never draws a rule before a
**framed** notice (rows 4, 6, 17, 23, 26, 33, 40, 43 — eight of eight). The
frame is its own boundary. The converter already agrees.

**`new_lagq2` ×1 — the blanket rule is killed by 8 counterexamples.** Its
seventh album sits in a `colspan=2` row because it has no cover art, and the
lane planner draws its entry separator only before a row with ≥2 populated
lanes. "A single-populated-cell row after a laned row is an entry boundary" was
probed corpus-wide (`DBG_SPAN`): the shape occurs **9 times in 5 documents** —
`new_lendle2` ×4 (album titles that *introduce* the next laned row),
`kiselev` ×2 (contact lines), `goya2` ×1 (an empty spacer), `news_2007` ×1 (the
nav title), `new_lagq2` ×1. The references want a rule for **one** of the nine.
Killed on measurement.

### 25.4 The image-size calibration table, for whoever takes `image.size.value`

21 instances, 4 documents, and it is **not** a threshold to sweep — the errors
run in both directions and the reference's own labels overlap on width. Built
from all 22 reference pairs (declared `<img width>` ↔ the token the reference
chose):

| token | n | min | median | max |
|---|---:|---:|---:|---:|
| `small` | 62 | 16 | 150 | 225 |
| `medium` | 50 | 140 | 280 | 410 |
| `large` | 10 | 369 | 418 | 420 |

150 px is `small` in five documents (`goya2` ×17, `new_lagq2` ×6, `tarrega`,
`new_blackmore`, `williams2`) and `medium` in `authors` ×3. `news` calls 225 px
`small` and 269 px `medium`; `new_lendle2` calls 180 px `medium`. `media.ts`'s
docstring cites "a 152 px portrait in a 422 px column at `small`" as the
calibration, and the 22-document table contradicts it.

A share-of-container rule inverts too: `goya2`'s 150 px covers sit in a ~196 px
lane (share 0.77) and are `small`, while `authors`' 150 px portraits sit in the
529 px column (share 0.28) and are `medium`. Whatever decides this is a **role**
— catalogue thumbnail, portrait beside prose, full-width plate — not a width and
not a ratio. Minor severity, no content or ordering consequence: deferred to the
closing fine-tuning phase, with the table above so it is not re-derived.

### 25.5 Killed hypotheses added

- **`break.missing` is a class.** It is six documents' worth of five unrelated
  mechanisms. Ranking by `instances × severity × generality` put it top of the
  unexamined queue on exactly the property — 6 documents — that turned out to
  mean "six different causes". Generality is a tiebreaker, not evidence that one
  mechanism is present.
- **A single-populated-cell row after a laned row is an entry boundary.** Nine
  instances across five documents; the references want a rule for one.
- **`image.size.value` is a threshold in `media.ts` to sweep** (§24.9's own
  note). The reference's tokens overlap 140–225 px and the errors run both ways;
  no monotone threshold and no container-share rule reproduces them.
- **A rule may not sit in an `align`.** `alignableRunMember`'s blanket
  `thematicBreak` exclusion conflated "cannot nominate an alignment" with
  "cannot be inside one". `BioMD-Reference.md` §2 allows Markdown in `align`,
  and the run-level guard (no text-carrying member ⇒ no wrapper) is what the
  exclusion was actually protecting.

### 25.6 State

**Open, in order**, *measured* after both mechanisms:

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 120 | `retyped.paragraph-to-list` | 10 | 4 | blocked on the hook design of §15.2; 7 are `kiselev` |
| 90 | `emphasis.span` | 34 | 10 | only **9** are converter-defect; widest reach in the ledger |
| 90 | `align.spurious` | 6 | 5 | 3 are the one-row media table §22.2 killed twice |
| 90 | `retyped.paragraph-to-align` | 6 | 5 | mostly inside `frame` / `columns` |
| 84 | `image.size.value` | 21 | 4 | **not a threshold** — §25.4 |
| 84 | `align.missing` | 7 | 4 | `goya2`'s is reference-inconsistency (§24.5) |
| 84 | `image.spurious` | 7 | 4 | |
| 63 | `paragraph.containment` | 7 | 3 | |
| 60 | `retyped.paragraph-to-lead` | 10 | 2 | new to the top ten; never examined |
| 60 | `break.missing` | 10 | 6 | **decomposed — §25.3.** 7 of 10 are not targets |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |

`break.missing`'s remaining reachable instances are `new_bach` ×1 (a `---` where
the right rail folds into the flow) and `segovia` ×1; both unexamined.
`retyped.paragraph-to-lead` — 10 instances, 2 documents — is the one class in the
top ten nobody has looked at.

Environment note: `sh bench/run.sh` requires Chromium (`visual: always`). A fresh
machine needs `npx playwright install chromium` or every document reports "no
output produced". This repository also carries a multi-pack-index that git 2.45
cannot read; `git config core.multiPackIndex false` unblocks it locally.

## 26. `retyped.paragraph-to-lead`: an author ruling, and no rule (2026-08-08)

Investigated instance by instance, as §25 taught. **No code change** beyond a
docstring correction, and that is the result rather than a failure to find one:
the class is now settled by the reference author instead of sitting unexamined
in the top ten.

| rung | §25 | after |
|---|---|---|
| L0 | 423 tests, 0 FAILED | 423 tests, typecheck clean, 0 FAILED |
| L1 | 93.1 | 93.1 |
| L2 | 429 · 250 converter-defect | 429 · 250 |
| L3 | 95, 10 critical | 95, 10 critical |

Unchanged on every rung and every document, which is what a comment-only change
must produce.

### 26.1 The class is the whole construct, not a regression in one

All **10** `::: lead` in the 22 references are these 10 findings: 9 in
`new_rechin4`, 1 in `news`. `convert-core` emits `::: lead` **never** — the
directive is built in `biomd-ast/builders.ts`, typed, serialized and validated,
and no pass has ever produced one.

What made this look like a live mechanism was a **docstring for a function that
does not exist**, sitting immediately above `enforceSingleTitle`'s: *"Promote the
first substantial paragraph to `::: lead` when the source marked it as an
introduction. Deliberately conservative…"*. A reader — and the previous
session's queue entry — takes that as a shipped, conservative pass being
outvoted, rather than as an unbuilt construct. It is now replaced by the finding
below. **This is the third orphaned specification found in this campaign**, after
the mini-image glyph map and `frame`'s unused `title:`; the pattern is a written
policy with no call site, and it costs a session every time.

### 26.2 The author's ruling — authoritative, do not re-investigate

> *"A decision regarding `::: lead` should be made in two situations: if every
> paragraph in the document begins with a specifically highlighted bold or
> capitalised letter, or if the article consists of large, long paragraphs. In
> the second case, a long text with such paragraphs becomes visually more
> appealing and easier to read. The decision to use `::: lead` was made purely
> for aesthetic reasons, rather than on the basis of HTML structure. It was
> purely my human decision."* — 2026-08-08

Both criteria are judgements about the **finished page**, and the second is a
readability decision the source cannot state. This is the same shape as §24.5's
ruling: an author decision recorded as a ceiling, with **no code changed**.

Asked whether the absence of `lead` elsewhere was an oversight, the author
confirmed and went further:

> *"I only applied the change to `::: lead` to one document, so it isn't
> reflected in the others. This is purely a visual adjustment and is not
> critical. If it is applied and there is a discrepancy with the reference, it is
> a visual improvement and should not adversely affect the metrics or evaluation
> criteria."* — 2026-08-08

So the ruling is **symmetric, and it is the operative one**: `lead` is a visual
nicety, and a discrepancy in *either* direction is not a fidelity defect.

- Not emitting `lead` where a reference has one — the present state, all 10
  findings — is **not a target**.
- Emitting `lead` where a reference has none is likewise **not a regression**,
  provided it is a visual improvement. Any future `lead` rule is therefore
  judged on rendered quality (L3, the browser), never on agreement with
  `fixtures/out/`, and L2's `lead` classes must not be read as converter defects
  in either direction.

`new_rechin4` ×9 is the "long paragraphs" case; `news` ×1 is a genuine editorial
intro. §16.3 is not the barrier — a directive wrapper invents no text — but
`CLAUDE.md` §5's rule contract is: there is no invariant to key on, and now no
metric that would confirm one if there were.

### 26.3 What was measured, so the criteria are not re-tested

**Typography attests nothing.** `BioMD-Reference.md` §3 allows `lead` for "a
semantic lead **or** a distinctly styled introductory source region". Measured
through the real Chromium measurer:

- `news`'s intro is `p.t1` and the archive it introduces is `p.t2`; both compute
  **13.33 px, weight 400, upright, `rgb(51,51,40)`**, differing only in a
  `text-align` that occurs in both. Different class, identical rendering. The
  second licence is therefore unavailable, and the first is a judgement.
- `new_rechin4`'s four `<p class="t">` blocks are the entire prose of the page —
  17596, 3819, 3591 and 1498 characters, split at `<br><br>` into the 9
  paragraphs the reference wraps. All compute **14.67 px / 400 / justify**. With
  9 of 9 wrapped there is no unwrapped prose to contrast against; the construct
  *is* the page, which is exactly the majority-test trap `bodyProminenceOf`'s
  header records.

**Length does not recover it.** Over all 22 references, classifying every
top-level body paragraph by whether it sits inside a `lead`:

| | n | min | p25 | median | p90 | max |
|---|---:|---:|---:|---:|---:|---:|
| inside `lead` | 11 | 220 | 612 | 839 | — | 4164 |
| plain | 570 | 7 | 46 | 139 | 695 | 3136 |

The distributions overlap through the whole of the `lead` range. **29 plain
paragraphs in 15 documents exceed 900 characters** — `williams2` 3136,
`williams2` 1665, `segovia` 1587, `jovicic` 1354 — all longer than seven of the
nine `new_rechin4` leads. And `news`'s two leads are **413 and 220**, shorter
than a plain 1303-character paragraph on the same page, so length is
*anti*-correlated with `lead` there. No paragraph-level threshold exists.

**A per-document median separates it, with one positive.** Median body-paragraph
length: `new_rechin4` **839**; then `authors` 631, `new_kolpakov` 605,
`williams2` 540, `jovicic` 540, `new_dyens` 498, `new_bach` 334, and down to
`new_karta` 17. Any threshold in (631, 839] selects `new_rechin4` and nothing
else — a single-instance discriminator with the nearest negative analogue 1.33×
away, which §12.1's sweep lesson calls a cliff rather than a mechanism. Its
payoff would be **rewrapping an entire document body**, the largest blast radius
in the pipeline, on the other ~987 pages, from one supporting document.

**Criterion (a) is not exercised by this corpus.** No document wraps in `lead`
because of highlighted initials. The drop-cap shape does occur — `new_lagq2`'s
`**R**ecital` and `***T***he Best of the L.A.G.Q`, `new_lendle2`'s album titles —
but on *labels*, not on every paragraph, and neither reference uses `lead`. So
the criterion has zero positive instances and its false friend is already in the
corpus. Nothing to build against.

### 26.4 Killed hypotheses added

- **`retyped.paragraph-to-lead` is a defect in a working pass.** There is no
  pass. The class is the entire `lead` construct, unbuilt.
- **`lead` is recoverable from a distinctly styled source region.** Measured on
  both documents: `news`'s intro and body render identically, and
  `new_rechin4`'s page has exactly one prose style. §3's second licence does not
  apply to either instance the corpus has.
- **`lead` is recoverable from paragraph length.** 29 plain paragraphs in 15
  documents are longer than most `lead` paragraphs; `news`'s leads are shorter
  than its own plain prose.
- **`lead` is recoverable from a positional signal** — prose between the title
  and the page's first author-drawn `<hr>`. Fires on `kiselev`, `new_bach` and
  `new_lagq2` as well, where the references write a plain paragraph. It also
  cannot satisfy §5's recurrence requirement, since there is at most one lead per
  page by definition.
- **A hook should take it.** §6 puts judgement in a hook, and the skill warns
  against parking a broad class for want of an elegant rule — but this is one
  aesthetic decision per document, the author has stated it is not derived from
  the source, and no acceptance check for "this reads better wrapped" can be
  written. A hook needs a deterministic check that can reject it; this has none.
- **The 10 findings are a gap to close.** They are not. The author's symmetric
  ruling (§26.2) makes `lead` a visual nicety in both directions, so closing
  them would move an instrument without improving the conversion — and a rule
  that emitted `lead` correctly by the author's criteria would still show as 10
  findings plus new ones. This class can never reach zero and should not be
  scored.

### 26.5 State

Unchanged from §25.6 on every rung. The queue changes only by removing this
class:

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 120 | `retyped.paragraph-to-list` | 10 | 4 | blocked on the hook design of §15.2; 7 are `kiselev` |
| 90 | `emphasis.span` | 34 | 10 | only **9** are converter-defect — verify the split first |
| 90 | `align.spurious` | 6 | 5 | 3 are the one-row media table §22.2 killed twice |
| 90 | `retyped.paragraph-to-align` | 6 | 5 | mostly inside `frame` / `columns` |
| 84 | `image.size.value` | 21 | 4 | **not a threshold** — §25.4 |
| 84 | `align.missing` | 7 | 4 | `goya2`'s is reference-inconsistency (§24.5) |
| 84 | `image.spurious` | 7 | 4 | |
| 63 | `paragraph.containment` | 7 | 3 | |
| 60 | ~~`retyped.paragraph-to-lead`~~ | 10 | 2 | **off the queue — §26.2. Visual-only in both directions, author-ruled; never score it** |
| 60 | `break.missing` | 10 | 6 | decomposed (§25.3); 7 of 10 not targets |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |

Three of the last four classes examined — `break.missing`, `image.size.value`,
`retyped.paragraph-to-lead` — turned out to be ceilings, instrument artefacts or
several mechanisms rather than one actionable defect. **The ledger's rank column
is measuring how much an instrument noticed, not how much work is available**,
and at this stage of the campaign the top of the queue is increasingly made of
things that cannot be closed. The next class taken should be adjudicated on two
or three instances *before* any survey work, and `emphasis.span` — where only 9
of 34 instances are converter-defect — should have that split confirmed first.

## 27. Cheap triage first: five classes downgraded, one mechanism found outside them (2026-08-08)

Ranking by finding count stopped. §25 and §26 both ended with a top-ranked class
that could not be closed, so this iteration began with **cheap triage** — two or
three instances per class, no surveys, no code — across the five highest-ranked
unresolved classes. Four were downgraded in about twenty minutes. The mechanism
that was actually worth building **ranked fifteenth by finding count** and was
not among the five.

| rung | §26 | after |
|---|---|---|
| L0 | 423 tests, 0 FAILED | **424 tests**, typecheck clean, 0 FAILED |
| L1 | 93.1 | **93.2** |
| L2 | 429 · 250 converter-defect | **413 · 238**, critical 20 → **15** |
| L3 | 95, 10 critical | **92**, 11 critical |

`new_lendle2` is the only document that moved on any rung: L2 29/20 → **13/8**
(429 − 413 = 29 − 13 exactly), L3 5 → **2**, L1 96.1 → **98.2**.

### 27.1 The triage table

| class | inst | "defects" | docs | mechanisms | deterministic signal | verdict |
|---|---:|---:|---:|---|---|---|
| `emphasis.span` | 34 | 9 | 10 | **≥3** | none | **downgrade** |
| `align.missing` | 7 | 7 | 4 | 3 | shadow of others | **dissolve** |
| `retyped.paragraph-to-align` | 6 | 6 | 5 | 2 | shadow of others | **dissolve** |
| `paragraph.containment` | 7 | 7 | 3 | 2 | shadow of others | **dissolve** |
| `image.spurious` | 7 | 7 | 4 | 1 | contested | **downgrade** |

**`emphasis.span` — the label is not reliable.** Of 34, 25 are already
`reference-inconsistency`, and the 9 remaining split into three unrelated
mechanisms: 3 are emphasis inside a *heading* that `dropEmphasis` strips by a
documented decision, 4 are `news` paragraphs inside `frame>align` that are
entangled with a containment mismatch at the same node, 2 are emphasis
*segmentation* inside long paragraphs. Decisively: the **same source shape is
labelled differently in different documents** — `new_lagq2`'s `strong:*T` drop
cap is `converter-defect` while `new_lendle2`'s `strong:*Variations
capricieuses` is `reference-inconsistency`. A class whose verdict flips on
identical evidence cannot be worked.

**Three classes were not classes.** `align.missing`,
`retyped.paragraph-to-align` and `paragraph.containment` fire at *the same node
paths* as each other and as `frame.moved`. They are downstream shadows: when a
container is missing, L2 reports the container, its position property, the
alignment inside it, the containment of every block beneath it, and the emphasis
of those blocks. On `new_lendle2` that is **18 findings in five classes from one
missing `frame`** — 21 of the document's 23. Ranking by class hides this
completely; the shadows outrank their own cause.

**`image.spurious` — contested by the references.** All 7 are small linked
navigation gifs (11–16 px inside an `<a>`). One source shape gets **five
different reference treatments**: `new_karta` keeps `main/next.gif` as a full
`::: image` with `size: small`; `new_bach` and `segovia` write the glyph
`&#9658;`/`▶`; `new_geyzel04` writes the `alt` text as a link label;
`new_rechin4` writes two glyphs in an `::: align`; `segovia1` merges the glyph
into the adjacent link's label inside `::: columns`. `new_karta`'s 16 px linked
`next.gif` is byte-identical in shape to `new_geyzel04`'s and is kept as an
image — so the negative control is indistinguishable from the positives. One
sub-claim is clean and was verified — **no reference ever groups icon-sized
images into `::: images`**, and the converter does it twice — but fixing only
that turns the group into two standalone `::: image` blocks, which the reference
still does not have, so it closes nothing. Not built.

### 27.2 A panel drawn with a background tint

The mechanism worth building was `frame.moved` (5 instances, 1 document,
rank 15) plus its four shadows.

`new_lendle2` writes `border: 1 solid #D5A96F` on five album panels. **The width
is unitless, so the whole shorthand is invalid** and Chromium computes
`border-style: none`, width 0 — measured on all five, the same trap
`learned-patterns.md` records for `margin-left: 25`. `frameEvidenceFor` reads
borders only, so it saw nothing and emitted zero frames against the reference's
five.

What the reader still sees is the background: `rgb(252,243,216)` against the
page's `rgb(247,231,175)`. `paletteFor` already maps that to `white`, which is
exactly what the reference names five times. A tint differing from the nearest
painted ancestor is the same construct as a border.

**The invariant is occupancy — not colour, and not recurrence.** `goya2` tints
**fifteen** cells identically, with the same dead unitless borders, and its
reference frames none: they are `width="50%"` *lane* cells, two to a catalog
row. `new_lendle2`'s five are `colspan="2" width="100%"` and own their row.
Recurrence is useless here and would invert the answer — `goya2` recurs fifteen
times to `new_lendle2`'s five — so the contract states occupancy instead and
tests the `goya2` shape for non-firing.

**The fallback had to move ahead of the `border-style: none` early return.**
Behind it, none of the five panels reached the new code; the probe printed
nothing at all, which is the pre-filter trap `learned-patterns.md` names and the
second time this campaign has hit it.

### 27.3 Known limit, measured and reverted

Four of the five panels are framed. `Heitor Villa-Lobos` is 18 characters and
the shared 20-character floor rejects it, which also creates the one new L3
critical: `layout.order.mismatch` 10 → 11, the pairing artefact of four produced
frames against five reference ones.

Dropping the floor for the tint path was implemented and measured. The argument
was sound — `spansItsRow` is a stronger occupancy claim than a character count —
and it worked: fifth panel emitted, L3 **92 → 90**, critical **11 → 10**. But
the same floor is the only thing keeping the *menu-label* cells out. `news` and
`news_2007` each set `• Архив новостей •` in a spanning tinted cell and each
gained a **spurious frame** (9 → 10, 1 → 2); L1 fell 93.2 → 93.1 and L2 rose
413 · 238 → 418 · 241. **Reverted.** A box the author did not draw, on two
regression-corpus documents, outranks two L3 findings on one.

### 27.4 Killed hypotheses added

- **`emphasis.span` is workable.** Its verdicts are not stable across documents
  for identical evidence; 25 of 34 are already reference-inconsistency.
- **`align.missing`, `retyped.paragraph-to-align` and `paragraph.containment`
  are defect classes.** They are shadows cast by a missing container, and they
  outrank their own cause in the ledger.
- **A background-tint frame can be gated by recurrence.** `CLAUDE.md` §5's
  recurrence law is the wrong instrument here: the false friend recurs three
  times as often as the positive.
- **Icon-sized linked images have one correct treatment.** Five references
  choose five different ones for the same asset, and `new_karta` keeps as an
  `::: image` exactly what `new_geyzel04` turns into a text link.
- **Dropping the tint path's length floor is free.** It costs two spurious
  frames on `news` and `news_2007`.

### 27.5 State

**Open, in order.** The ranking below is by finding count because that is what
the ledger computes, but §27.1 is the reason it must not be followed blindly —
**read the shadows column first.**

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 120 | `retyped.paragraph-to-list` | 10 | 4 | blocked on the hook design of §15.2; 7 are `kiselev` |
| 90 | `emphasis.span` | 34 | 10 | **downgraded §27.1** — verdicts unstable across documents |
| 90 | `align.spurious` | 6 | 5 | 3 are the one-row media table §22.2 killed twice |
| 84 | `image.size.value` | 21 | 4 | not a threshold — §25.4 |
| 84 | `image.spurious` | 7 | 4 | **downgraded §27.1** — five reference treatments of one shape |
| 84 | `align.missing` | 4 | 3 | **shadow class** — down from 7/4 |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |

The two biggest documents are now `news` (45 defects) and `goya2` (44), and
together they are a third of the ledger. Neither has been attacked as a
*document*; every pass at them so far has come through a class. **Given that
three of the last four class-led attempts closed nothing, the next iteration
should triage `goya2` and `news` document-first** — take the worst document,
enumerate its findings by node path rather than by class, and look for the
shared container defect the way §27.2 found `new_lendle2`'s. `new_lendle2` went
from third-worst to mid-table on one mechanism found exactly that way.

## 28. Reference correction: `new_karta`'s nav glyph — re-baseline (2026-08-08)

Author correction to `fixtures/out/new_karta.bio.md`, in two steps, with no code
change. **§27.1's downgrade of `image.spurious` is void** — see below.

The document ended with

```
::: image
src: main/next.gif
position: center
size: small
link: /#/karta2
:::
```

for a 16×16 `next.gif` inside an `<a>`. The author confirms this was a mistake in
the reference and replaced it with the glyph, matching `new_bach` and `segovia`:

```
::: align
position: center

[&#9658;](/#/karta2)

:::
```

An intermediate revision carried `new_bach`'s prose with it — `*См. также:* \[ О
ЛЮТНЕВЫХ ПРОИЗВЕДЕНИЯХ И.С.БАХА ]`, byte-identical to `new_bach`'s block but for
the href — which `new_karta.htm` does not contain (0 occurrences of `ЛЮТНЕВЫХ`
and of `См. также`; `new_bach.htm` has one). L2 flagged it independently as
`paragraph.missing.unattested`. Raised and corrected the same session; recorded
only so the intermediate state is not mistaken for evidence.

### 28.1 What the ruling unlocks

`new_karta` was the **single counterexample** that made §27.1 downgrade
`image.spurious`: it kept a 16×16 linked `next.gif` as an `::: image` while
`new_bach` and `segovia` glyphed the identical asset, so the negative control was
indistinguishable from the positives. With it corrected the corpus is consistent
on the core claim — **an icon-sized linked gif is never a picture** — and the
remaining references differ only in the *label*, deterministically:

| shape | label | attested by |
|---|---|---|
| icon, no `alt` | the glyph from the icon map | `new_bach`, `segovia`, `new_karta`, `new_rechin4` |
| icon with `alt` | the `alt` text as the link label | `new_geyzel04` |
| icon beside a text link sharing its href | merged into that link's label | `segovia1` |

`mini_images_to_md_guide.md` is normative for this family and its 29-entry map is
sanctioned lexical data (`CLAUDE.md` §2); `glyphs.ts` is its home. **7 instances,
4 documents, now with consistent references behind them.** This is the strongest
open candidate.

### 28.2 Two things to know before taking it

- **A glyph will always read as unattested.** `paragraph.missing.unattested` on
  `/align[23]/paragraph[0]` persists on the corrected reference, because `►`
  stands for an *image* and L2's attestation check is word coverage over source
  *text*. Expected instrument behaviour, not a defect, and not closable.
- **`new_karta` is now the only reference ending in `---`**, and its source's only
  `<hr>` is the footer's `<hr width="35%">` — chrome that every document drops.
  `break.missing` at `/break[24]` is therefore a `low`-confidence reference
  expectation with no source attestation. It invents no text, so it is not a §16.3
  matter; flagged, not chased.

### 28.3 Re-baseline — reference edit only, no code changed

| rung | §27 | after the correction |
|---|---|---|
| L0 | 424 tests, 0 FAILED | 424 tests, typecheck clean, 0 FAILED |
| L1 | 93.2 | **92.7** |
| L2 | 413 · 238 | **417 · 241** |
| L3 | 92 | 92 |

All movement is `new_karta`: L1 88.0 → **78.0** (img axis 100.0 → **0.0**), L2
28/7 → **32/10**. The drop is honest and expected — the reference no longer holds
an image at that point, so the `::: image` the converter still emits is now a
true `image.spurious`, and the img axis has nothing to agree with. **This is the
new floor**; the pre-correction 93.2 / 413 · 238 is not comparable.

---

## 29. A reference revision that closed two ceilings, and the linked-icon mechanism (2026-08-08)

### 29.1 `06eeafb` changed 21 of 22 references, `BioMD-Reference.md`, and added `/new_rules.md`

The author revised the corpus wholesale and wrote down a set of house conventions. **Baseline
before attribution** applied literally here: the revision moves every rung with no code change at
all, so every number in §21–§28 is measured against references that no longer exist.

*Measured, no code change, immediately after `06eeafb`:*

| rung | §27/§28 floor | after the revision |
|---|---|---|
| L1 | 92.7 % | **93.0 %** |
| L2 | 417 findings · 241 defect · 13 crit | **335 · 192 · 13** |
| L3 | 92 | **85** |
| L0 | 424 tests, 28 validator errors | 424 tests, 28 validator errors |

**Two recorded ceilings closed themselves.** `retyped.paragraph-to-lead` (10 instances, off the
queue on the §26.2 author ruling) is gone because the revision deleted all eight `::: lead` blocks
from `new_rechin4` — the ruling is now *in* the corpus. `new_blackmore`'s masthead split point
(§24.5, recorded as reference-inconsistency after a browser measurement) was corrected to the
boundary the source draws, so the converter's split is now the reference's. The §24.5 ruling that a
recovered centred section label gets a bare `##` is likewise now applied in `goya2`, `new_bach`,
`news_2007` and `segovia1`, which removes the shadow `align.missing`/`heading.containment` pairs
those documents carried.

This is the second time (after §28) that an author correction has voided a downgrade. The lesson is
narrower than "re-check everything": **grep the code comments and `OPEN.md` for the documents that
changed**, because a guard's named false friend can disappear with the reference that motivated it.

`new_rules.md` also states rules the converter does not yet implement — a table-header label
vocabulary, `==` for long quoted sentences, `_` as a synonym for `*`, no de-hyphenation inside URLs,
merging consecutive same-alignment `::: align`, dropping an empty trailing table column, and
`::: signature` rather than `::: nav` for a source list. `BioMD-Reference.md` gained `_` as an
italic spelling. None of these were taken this iteration; the largest, the header vocabulary, is
the recorded next step.

### 29.2 Two cheap probes that decided the iteration

**`table.header.cell` — 43 instances, 7 documents, the largest class in the ledger and 0 % defect.**
Probed three instances rather than surveying. Two facts came out of it. First, the converter is not
losing a source header: `new_karta`'s source contains no `Композиция`, no `Формат` and no
`Ноты (TAB)` anywhere, so the *old* references invented those labels exactly as the new ones invent
`Название`/`Аудиоформат`. All 43 are the synthesized path (`synthesizeHeader`), which means nothing
attested has to be rewritten — the §16.3 objection to the whole class dissolves. Second, and against
expectation, the class appeared to fix no validator error, which dropped it to priority 4/5/6.
**That second finding was wrong and §30.2 corrects it** — it closes 15 of the 28. The claim was
*inferred* from a standalone `validate` run, never measured against `corpus run`.

*A measurement error worth recording, because it cost a wrong statement.* `node dist/cli/index.js
validate <file>` resolves a laxer profile than the bench config and reports **0 errors** on a file
that `corpus run` reports one error for. The trustworthy figure is the `errors=` column in
`bench/last-run.txt`. Total across the corpus: 28, before and after this iteration.

**`image.spurious` — 8 instances, 5 documents, 100 % converter-defect.** Every instance is a
page-footer navigation icon shipped as `::: image src: ../main/back.gif`, which renders as a broken
image (no asset tree exists) and asserts that a UI glyph is a photograph. Priority 2 and 4 against
the header class's 4/5/6, so §1's lexicographic ordering chose it even though it is a fifth the
size. Direct targets were checked first and **nothing was lost** — a dropped icon leaves an empty
`<a>` whose href becomes the label, which is why `barrios` already produced
`[/#/barrios1](/#/barrios1)`, the very form the revised reference adopts.

### 29.3 The mechanism: `dropDecorative` and `runImages` disagreed about what an image is

`isDecorative` had classified `../main/back.gif` as furniture the whole time. `dropDecorative`
iterates a run's **direct children**; `runImages` **descends through `IMAGE_WRAPPERS`, which
includes `<a>`**. A navigation icon is always inside the link it operates, so the filter never saw
it and the grouper always did — one `::: image` per icon, or `::: images columns: 2` for a pair.

The tell, and the reason a name-based hypothesis would have been wrong: `back.gif` **is** in
`isDecorative`'s name regex and `previous.gif` **is not**, and the two produced identical wrong
output. When a guard's presence and absence give the same answer, the guard is not the deciding
code. One instrumented run (`DBG_ICON` in `imageFrom`, printing the call stack) located it in
minutes; the stack read `imagesFrom ← flushInline`, which is downstream of the filter.

Fifth containment-vs-filter mismatch of the campaign, and the third to be found by instrumenting
rather than reading.

**What was built.** `ICON_GLYPHS` in `src/convert-core/glyphs.ts` — the guide's 29 entries, keyed on
the **asset stem**, lower-cased, without directory or extension. The extension cannot be part of the
key: the guide spells the score icon `score3.gif` and the only page that uses it writes `score3.jpg`.
`isUiIcon` in `media.ts` names nothing and asks three questions — containment in an `<a href>`,
icon geometry (≤ 32 px both dimensions, the guide's own figure), and membership in the table.
`runImages` skips a UI icon; `inlineFrom`'s `img` case emits the glyph, after which the existing
`<a>` case builds `[glyph](href)` with no further change.

**The label rule is unanimous in the corpus and was read off the data, not chosen:** `alt` when the
author wrote one, else the mapped glyph, else the pre-existing href fallback. Exactly two of the
eight icons carry `alt` (`new_geyzel04`'s pair, labelled `Главы 8-9` and `Владимир Вавилов`) and
their reference uses that text; the other six carry none and their references draw glyphs.

**Recurrence is not required here, and the contract says so.** A pager is drawn once per page —
`new_karta` has exactly one arrow — so `CLAUDE.md` §5's recurrence requirement, which is a law for
shapes repeating *within* a document, would refuse every true positive. The recurring evidence is
cross-document (one shared asset across the site) and is precisely what the table records. The
named false friend is a linked thumbnail: the size cap does not separate it (a 32 px thumbnail is
legal) but table membership does, since a thumbnail is article-specific and therefore never a shared
asset. `../main/km.gif` is the corpus's near-miss — linked, icon-ish, captioned, unlisted — and a
contract asserts it keeps its `::: image`.

**The ledger verb is `removed`, not `mergedInto`.** Image conservation accounts for source images
only through `ledger.removals()`, so `mergedInto` left two `new_geyzel04` icons unaccounted and the
document flipped `ok` → `REVIEW` with its printed counters unchanged. Conservation was right and the
first verb was wrong: the *asset* does leave the output. The `<a>` is not removed, so its target is
still required to appear — which keeps target conservation honest.

### 29.4 Measured outcome

| rung | after `06eeafb` | after `55e7a8c` |
|---|---|---|
| L0 | 424 tests, 28 validator errors, clean share 13.6 % | **429** tests, **28**, **13.6 %**, 0 FAILED |
| L1 | 93.0 % | **94.3 %** |
| L2 | 335 · 192 defect · 13 crit | **322 · 180 · 9** |
| L3 | 85 | **85** |

`image.spurious`: **8 instances / 5 documents → 0. Closed.** Per document, L1:
`new_geyzel04` 88.3 → 96.7 · `new_rechin4` 88.6 → 96.2 · `new_karta` 78.1 → 88.5 ·
`new_lendle2` 98.2 → 99.3 · `segovia1` 97.1 → 98.0. Conservation text recall rose on three
regression documents (`barrios` 94.9 → 95.5, `segovia` 98.0 → 98.3, `tarrega` 94.3 → 94.6).
L3 is flat because an inline link label carries no geometry.

**The tradeoff, stated rather than buried.** `barrios`, `tarrega` and `williams2` each gain two L2
findings with **flat defect counts**. All three are one sub-case — an icon standing beside visible
text, where the revised reference either substitutes the raw route (`[/#/barrios1](/#/barrios1)`) or
drops the icon (`[К началу биографии]` for a source that draws `◀` before those words). The guide
ranks a known mapping above both and puts a raw URL label **last** in its fallback ladder, and `▶`
renders better than a route the reader cannot use. Classified `visual-improvement` under skill §2.
Restricting the rule to standalone icons would have kept those three matching, at the cost of a rule
that treats one asset two ways depending on the text beside it — a special case in a general rule's
clothing. Two of the six new findings are an instrument artefact: `link.label.content.empty` reports
`critical` about a label that is `▶`, which is not empty.

### 29.5 What did not get built, and why

- **The unlinked half of the icon map.** `score3` ×10 in `tarrega` sits *inside table cells*, and
  `tarrega`'s two PDF tables already fail to plan (they ship as bulleted lists). Whether the icon is
  what blocks the planner is an open edge worth probing **before** the glyph is emitted, because a
  table recovered is worth more than ten characters. `smile` ×1 in `news_2007` collides with an
  existing contract that deliberately keeps squarish 15 px emoticons as content.
- **Two guide/reference divergences**, both decided for the guide (`CLAUDE.md` §2.3 ranks
  `mini_images_to_md_guide.md` above `fixtures/`, and the guide states known mapping has highest
  priority), both worth an author confirmation because they are one character each:
  `h2.gif` → guide `&#9679;` ● vs `new_rechin4`'s `&#128904;`; `smile.gif` → guide `&#9787;` ☻ vs
  `news_2007`'s `&#128578;` 🙂.

---

## 30. A reverted alignment rule, and the column vocabulary (2026-08-08)

Two attempts this iteration. The first was reverted on its own measurement; the second landed and
corrected a wrong number in §29.2. Both are recorded, because the reverted one is the more
instructive.

### 30.1 Killed: a word-less block may open an alignment run because it carries a target

**The hypothesis.** After §29 turned four footer pagers from `::: image` into paragraphs, they lost
the centring the image directive had been carrying, and `retyped.paragraph-to-align` rose to rank 1
(8 instances, 8 documents — the widest reach in the ledger). Probing all eight showed 7 of 8 have
*identical text on both sides* and differ only in their container, so the label was one coherent
mechanism rather than the shadow class §27.1 had recorded.

**Two causes, separated by instrumentation, not by reading.** `DBG_ALIGN` at the decision point in
`alignableRunMember`, one run each on `new_karta` and `tarrega`:

- `new_karta` — `align=center`, `bounded=true`, **`label=false`**. Rejected by
  `isAlignableLabelText`, which requires a letter or a digit; `▶` has neither.
- `tarrega` — `align=justify`. Rejected four lines earlier, and `justify` is the page default this
  corpus computes almost everywhere (`CLAUDE.md` §4). A different question, left alone.

**The fix, and why it looked safe.** `isAlignableLabelText`'s named false friend is a rule the
author drew out of punctuation (`* * *`, `— — —`). A pager row is distinguishable from one by
*relational* evidence rather than a character class — it carries a link, and a drawn rule never
does. So the guard was left untouched and an alternative added beside it: a word-less block may
join a run when `carriesTarget(block)`. A character test could not have done this job anyway, since
`●` is itself a member of `RULE_GLYPHS`.

Both contracts passed, including non-firing on `* * *`.

**What the corpus said.** L2 322 → 324, defects flat at 180, L3 85 → **87**, L1 94.3 → 94.2.
`new_karta` and `new_lendle2` each lost a defect as intended; `segovia1` gained **two**, and L3's
containment and alignment classes each rose by one.

**Why: the real false friend was never `* * *`.** `segovia1`'s footer is a four-cell table row —
`◀`, *Андрес Сеговия*, *Владимир Бобри*, `▶` — which the reference writes as `::: columns
columns: 4`. Two of those four cells are word-less glyphs, so the new rule made them alignable, and
`groupAlignedRuns` swept **all four into one `::: align`**, collapsing the lanes. Four
`align.spurious`, a `columns.missing`, four `retyped.paragraph-to-column`, and a displaced frame.
A structural loss (priority 3) on a regression-corpus document, which outranks the two defects
fixed, so the change was reverted whole and the floor restored exactly.

**The lesson, and why no guard was added instead.** `segovia1` already carried `columns.missing`
*before* this change: the four-lane region is not being recognised, and the loose blocks that
result are a **symptom of that upstream failure**. Guarding the alignment rule against them would
have cemented the missing region and hidden it from every instrument — the exact move `CLAUDE.md`
§5 and §10.2/§16.4 forbid. The reachable mechanism here is the missing `columns` region, not the
alignment.

Recorded as killed: *a word-less block may open an alignment run because it carries a target.*
Falsifier: `segovia1`'s lane cells are word-less glyphs, and admitting them merges four lanes into
one. Reopens only on the `columns` region being recovered first.

### 30.2 The column vocabulary — and the number §29.2 got wrong

`/new_rules.md` states the label vocabulary outright: `Название` for the column that indexes the
records, `Аудиоформат` for a column of resource links, and a synonym list folding `TAB`, `MIDI`,
`Формат MP3`, `Ноты (TAB)` and the rest onto the second. `column-labels.ts` holds it as
language-tagged data under invariant 5; `synthesizeHeader` consults it at the decision point it
already had, and an unrecognised label passes through untouched.

**§16.3 is not engaged, and §29.2's probe is why.** Every affected table has *no source header at
all* — `new_karta`'s source contains no `Композиция`, no `Формат`, no `Ноты (TAB)` — so the old
references invented their labels exactly as the new ones do. Only the synthesized path is touched;
a table whose source names its columns never reaches this code.

**A standing contract was superseded, not deleted.** `data-table.test.ts` asserted `LINK_GLYPH` for
a resource column and an **empty** leading column, on the grounds that naming it would be
invention, citing `analyze/analyze.md` on three pages and sixteen references. `06eeafb` replaced
all sixteen and the author wrote the rule down. The contract now states the new rule *and* why the
old one was right about the corpus it was written against — an author ruling is the one thing that
legitimately retires a named decision, and it is worth being able to see that it happened.

**Measured.**

| rung | before | after |
|---|---|---|
| L0 | 429 tests, **28** validator errors | **431**, **13**, 0 FAILED, clean share 13.6 % |
| L1 | 94.3 | **94.4** |
| L2 | 322 · 180 defect · 9 crit | **287 · 180 · 9** |
| L3 | 85 | **85** |

`table.header.cell` 43 → **8**, all `reference-inconsistency`, none a defect. Per document:
`new_karta` 30 → 13 · `kiselev` 48 → 43 · `new_dyens` 10 → 6 · `tarrega` 11 → 8 · `barrios` 5 → 2 ·
`new_bach` 3 → 1. **No document got worse.** Validator errors fell on seven documents:
`barrios` 1→0, `kiselev` 3→1, `new_bach` 1→0, `new_dyens` 1→0, `new_karta` 10→3, `segovia` 5→3,
`tarrega` 2→1.

**§29.2 is corrected.** It recorded that this class "fixes no validator error", which dropped it
from priority 2 to 4/5/6 and is why the icon mechanism was taken first. It closes **15 of the 28**.
The claim was *inferred* from the standalone `validate <file>` reporting zero — a laxer profile
than the bench config — and never checked against `corpus run`'s `errors=` column, which is the
only trustworthy source. The ordering decision it influenced was still correct on other grounds,
but the number was not measured and should not have been written.

**A conservation figure that fell with no content change.** `new_karta`'s text recall goes
96.1 → 91.9. The A/B of the produced file is **seven changed lines, every one a header row**.
Recall is a shingle-based similarity measure, so three invented header words per table break every
shingle straddling the header boundary — the effect KILLED.md already records for legitimate block
splits, arriving here from the other direction.

### 30.3 Residual, and what is next

The 8 remaining `table.header.cell` are all `reference-inconsistency` and split three ways:
`new_bach` wants `Произведение` where the convention (and rule 14) folds it to `Название`; four
columns hold a single link and so miss `isLinkColumn`'s recurrence gate of two, staying empty; and
`segovia`'s MP3 track table wants an empty leading column where the rule now writes `Название`.
None is worth a rule.

The author also corrected `new_rechin4`'s `h2.gif` to `&#9679;` and `news_2007`'s `smile.gif` to
`&#9787;` (commit `3097a48`), so **there are no remaining guide-vs-reference conflicts** in the icon
family. Neither moved a rung: L2 folds numeric character references before comparing, and
`news_2007`'s smiley sits in a paragraph the converter does not emit at all — which is its own,
larger, unexamined defect.

## 31. A holistic sweep: one lying property class, one missing group (2026-08-08)

A single pass asked three questions at once — which rules the reference revision made obsolete,
which are correct but improvable, and what could be corrected immediately. Two mechanisms landed.
Both were found by **adjudicating the two heaviest documents rather than the ranked classes**:
`news` (45 defects) and `goya2` (34) held 44 % of the ledger between them and neither had ever been
attacked as a document (§27.5 said so; this is that step).

### 31.1 `src` was adjudicated as layout, and 19 defects were phantom

`compareDirective` assigned `content` evidence to prose properties (`caption`, `alt`, `title`,
`active`) and `structure` to everything else. `triage` returns `converter-defect` for structural
evidence **unconditionally**, on the rule that layout is always actionable — which is right for a
lane, a wrapper or a separator, and wrong for a URL. `BioMD-Reference.md` §0 ranks targets second
behind content and §16.3 names `href`/`src` outright, so the one property class §16.3 protects by
name was the one class routed past the attestation test.

**Measured.** All 19 `image.src.value` findings on `news` report the produced `main/magazines/X.jpg`
against a reference `/../main/magazines/X.jpg`. The source writes `main/magazines/X.jpg`; the `/../`
prefix occurs in **no source in the corpus and in exactly one of the 22 references**. The converter
was verbatim-correct and following the reference would have invented a target.

Two things had to move together. `isTargetProp` is `src` **only**: an asset path is carried through
verbatim, whereas `links.ts` rewrites `../menu.htm` to `/#/menu`, so neither side of a `link`
finding can ever appear in the source and attestation would answer "unattested" about a correct
value. And attestation for a target reads the **raw decoded HTML** — `stripTags` throws attributes
away and `fold` erases `/`, `.` and `_`, which is all a URL is made of, so the folded index called
two different destinations the same content.

L2 287 → 275 findings, **180 → 152 converter-defect**, 40 → 59 reference-inconsistency. Output
byte-identical; L0, L1 and L3 unmoved. **This is an instrument correction and not a conversion
improvement** — it removes work that never existed, which is worth more than closing it would have
been, but it must never be reported as the converter getting better.

### 31.2 A flattened grid row that is nothing but pictures is one row

`goya2` draws its "ДРУГИЕ АЛЬБОМЫ" plates as three table rows of two covers each. The grid does not
plan as records, `layoutFrom`'s lane attempt rolls back, and `decomposeFrom` shipped **six loose
`::: image` blocks** where the reference groups each pair as `::: images columns: 2`.

Both existing `::: images` paths (`figureOf`, `imagesFrom`) read an *inline* run — images inside one
`<p>`. This corpus draws the other half of its plates as a row per plate, which reached neither.
`imageRowFrom` asks §8's question of a flattened row instead: two or more standalone images and
nothing else.

**Recurrence does not apply and the contract says so** — the `<tr>` is adjacency *declared* by the
author, not inferred from typography, so it needs no corroboration; same exemption as `isUiIcon`.
The **false friend is a record row**, a picture beside the words about it — `goya2`'s own album grid
and `williams2`'s track list — refused by testing the *whole* row rather than the images in it, and
tested for non-firing. `recovery.test.ts` was grepped first (`learned-patterns.md`: a symmetry
argument is not evidence): no contract governed this path, so the asymmetry was an oversight and
not a decision, unlike the DATA→lanes case §18.3 killed.

**Measured, 22 documents.** L0 431 → **434 tests**, 0 FAILED, validator **13 → 13**, typecheck clean.
L1 **94.4 → 94.4** (flat). L2 287 → **275** · 180 → **152 defect**. L3 **85 → 70**.

Only `goya2`'s output changed, so the whole L3 fall of 15 is its. Produced `::: images` counts now
**equal the references on all 22 documents**. `goya2` 41/34 → 29/25.

**The tradeoff, stated.** The 18 findings the old shape produced are replaced by 12 new ones:
`image.position.missing` ×6 and `image.size.missing` ×6, because the reference keeps `position` and
`size` on its grouped children. `BioMD-Reference.md` §4.1 states child `position/size` are
"**omitted/ignored**" and its property table gives a child `image` only `src` + `alt|caption|link|
frame`; `makeGroupedImage` throws on either. So those 12 are `reference-quirk` and emitting them
would be a conformance violation. Net −12 findings, −9 defects, and the *structure* is now identical.

### 31.3 What the sweep measured and did not build — reach figures, so nobody re-derives them

`/new_rules.md` still holds six unimplemented author rules (§29.1). Their reach, **measured** over
the 22 pairs this pass, which is the number that decides whether any is worth a rule:

| rule | measured reach | verdict |
|---|---|---|
| drop an empty trailing table column | **0** tables, either side | no reach in this corpus |
| `_` ≡ `*` italic | **0** real spans — every `_` match in `fixtures/out/` is a filename underscore inside a URL | not a class; but see the risk below |
| merge consecutive same-alignment `::: align` | the **references keep 5 such pairs unmerged** (`goya2`, `new_geyzel04`, `new_karta`, `williams2` ×2) against 8 the converter has and they do not | the rule is permissive ("можно"), not mandatory — a blanket merge breaks 5 agreements to fix 8 |
| URL integrity, no line split in a link label | **0** instances on either side | already correct |
| `::: signature` for a source list rather than `::: nav` | 1 document (`new_kolpakov` — the reference writes `signature`, the converter `nav`); `new_blackmore` emits a `nav` the reference has none of, `new_rechin4` the reverse | small but real, vocabulary is stated outright |
| `==` for a long quoted sentence | 6 spans, 3 documents (`jovicic` 1, `new_blackmore` 1, `new_rechin4` 4) — and 2 of `new_rechin4`'s are **under** the stated 64-character floor and are not in quotes, so the rule as written does not explain its own corpus | needs the author; also needs the triage half of rule 18 |

`goya2`'s 7 `image.caption.missing` are **not work**: the reference keeps the album title in
`column[0]` *and* repeats it as the cover's `caption` in `column[1]`. The source states it once and
`CLAUDE.md` §5 says to emit a visible caption once, not twice. Triage cannot see this — it is a
whole-document echo question, and `structdiff` already has the machinery (`homeOf`, the
`.caption-echo` sub-class) but applies it only to orphan insertions, never to a property deletion.
That is the cheapest remaining instrument improvement and it is worth more than the 7 findings.

**A risk the `_` probe turned up.** Every `_` in the references is a URL underscore. Nothing has
checked whether `eval/blocks.ts` reads `abmv8_4.txt` as an emphasis span; if it does, part of
`emphasis.span` (24 instances, already downgraded) is an artefact. One cheap probe, not taken.

### 31.4 New floor

| rung | value |
|---|---|
| L0 | **434 tests**, typecheck clean, 0 FAILED, validator **13**, clean share 13.6 % |
| L1 | **94.4 %** |
| L2 | **275 findings — 152 converter-defect** · 64 ambiguous · 59 reference-inconsistency · 9 critical |
| L3 | **70 findings**, identity 0, deterministic |

The §30 floor was 431 / 94.4 / 287 · 180 / 85. Of the 28-defect fall, **19 are the instrument
telling the truth** and 9 are the converter improving; say which is which whenever this is quoted.

## 32. The caption echo: asking the owning side instead of the other one (2026-08-08)

§31.3 left this as the cheapest remaining instrument improvement, worth more than the seven findings
it closes. It was, and the reason is in the shape of the question rather than in the count.

### 32.1 `homeOf` asks the wrong side about a caption

`homeOf` sub-classifies an orphan by "where did the *other* side put this text", which is the right
question for a block and an ill-posed one for a figure label. A caption and the line it labels are
routinely **both present and both correct** — the reference binds `caption: 1.000.000 Platinum` to a
cover *and* keeps `**1.000.000 Platinum**` in the lane beside it. Asked of the other side, the
produced document does hold those words, in that same lane paragraph, and the answer says nothing
about whether anything was lost. `compareDirective` never asked at all, so every absent `caption:`
was reported as content the converter dropped.

The decidable question is asked of the **owning** side: *does this document say the words twice?*
`CLAUDE.md` §5 rules on exactly that — a visible caption is emitted **once, not twice** — so the
side that repeats is the side that moved, and `triage` reads the direction:

| class | who repeats | verdict |
|---|---|---|
| `<d>.caption.missing.self-echo` | the reference | `reference-inconsistency` |
| `<d>.caption.spurious.self-echo` | the converter | `converter-defect` |

The second is the mirror of the `.caption-echo` rule already in `triage`, which has always called
the converter's own duplication a defect "however attested the words are". Implementing only the
first half would have been an instrument that excuses one side; both halves are contracted and the
mirror is tested for firing.

**Restricted to `caption` and `alt`** — the figure-label family §5 rules on. A `nav` `active` echoes
its own item by construction and a `frame` `title` names a region rather than repeating a line, so
neither is the same question and neither would have been a truthful hit.

**False friend, tested for non-firing: a caption the converter failed to bind.** There the reference
states the text *once*, in the caption, and the produced leaves it loose below the figure. The
owning side does not echo, no suffix is added, and the finding stays the converter defect it is.
That asymmetry is the entire reason for asking the owning side rather than the other one.

### 32.2 Where it stops, and why that is the honest place

`lines` is consulted as well as `paragraphs`, for the reason `homeOf` consults it — a block boundary
on one side is a line ending on the other. `goya2` writes one lane as `**Historia de un Amor**` and
`1999` in a single hard-break run, so the paragraph key carries the year and only the line key is
the title. A label repeated as a *line* is repeated just as visibly.

**Two of the seven are left wrong on purpose.** Those captions merge two sibling blocks —
`**Francis Goya Plays His Favourite Hits**` and `**Vol. 1**` are one `caption: … vol. 1` — and
neither index holds the joined key. Recognising it needs a concatenation search across siblings: a
weaker claim about a smaller shape, and reaching for it here would have been chasing the last two
findings rather than making the instrument truer. They remain `converter-defect` and are wrong about
it. Recorded, not tuned away — the distinction invariant 2 exists to protect.

### 32.3 Measured

| rung | §31 floor | after |
|---|---|---|
| L0 | 434 tests, validator 13 | **438**, **13**, 0 FAILED, typecheck clean |
| L1 | 94.4 % | **94.4 %** |
| L2 | 275 · 152 defect · 59 ref-inc | **275 · 147 · 64** |
| L3 | 70 | **70** |

Output byte-identical; `eval/` is diagnostic-only and `convert-core` never imports it. Total
findings unchanged by construction — this reclassifies, it does not remove. `goya2` 25 → 20 defect
and **no other document moved**, which is the measurement that says the rule is narrow: five
instances in one document, and the corpus contains no other caption either side states twice.

**The running total is now three instrument corrections against one converter mechanism this
campaign** (§31.1 `src`, §32 the echo, versus §31.2 the image row). "Check the instrument before the
rule" is attested seven times. Both of these were found by adjudicating a *document* rather than a
ranked class, which is now the method that has paid every time it has been tried.
