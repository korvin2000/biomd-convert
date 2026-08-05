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

Per document:

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
