# MAP-corpus — 22 documents + 1 holdout, and what each one proves

Pick a document by **what it can falsify**, not by how many findings it has. A class in one document
is nearly always the wrong target however many instances it has (`CLAUDE.md` §5).

Defect counts for the 13 are the **recorded** figures from PROGRESS §15.4 (2026-08-06, 13-document
ledger) — a relative ranking, not a current measurement. Reference shapes for the 9 were measured on
2026-08-08 by counting directive fences in `fixtures/out/*.bio.md`.

## 1. Regression corpus — the original 13. Never regress.

| document | archetype | what it proves / why you'd open it | rec. defects |
|---|---|---|---:|
| `news` | dated entry list + **9 bordered obituary notices** | frames, `::: align` inside `frame`, entry separators, repeated site masthead as chrome. Worst document | 49 |
| `goya2` | **discography catalog grid 35×2** | row-wise `::: columns` (34 regions / 68 lanes), **5 deliberately empty lanes**, prose baseline `justify`, `image.src.value` | 43 |
| `kiselev` | album + track lists | 3-vs-2 column table geometry, indent-under-label track runs, `<blockquote>` as an indent | 17 |
| `borislova` | prose + **verse** + a 1×2 record card | *the* false friend for any "break run → list" rule: 13 poems the reference keeps as paragraphs | 16 |
| `segovia` | photo essay | 3-line captions bound as a run; reference **deletes** an MP3 track table (ceiling); `<blockquote><i>` subordination | 14 |
| `pavlov_azancheev` | archive of letters and poems | alignment ground truth (`align="center"` computing to `justify` on 5 classes); 34 reference-quoted lines; §3.5 subordination | 10 |
| `news_2007` | dated entries + right-hand menu | menu folding, festival-announcement frame, 1 spurious empty lane | 9 |
| `authors` | prose + scans | visible caption line outranks `alt`; separator density | 7 |
| `segovia1` | 19 captioned figures | `<a href=big><img thumb>` → `::: image` with `link:`; caption line binding | 7 |
| `jovicic` | prose + song lists + 1×2 record card | reached **L1 100.0** after §10.1; inconclusive-verdict routing | 6 |
| `tarrega` | score/media catalogue | dotted-leader pseudo-tables, table continuation rows, a `<blockquote>` swallowing 9 blocks | 6 |
| `williams2` | prose + **menu written as a table** | narrow-text-measure defect only L3 can see; `**- 2 -**`; right-aligned credit | 4 |
| `barrios` | one table per disc | **0 converter defects** — the reference-revision success case | 0 |

## 2. Refinement set — the 9 `new_*` pairs. This is where the work happens.

Reference shape, measured 2026-08-08 (`^::: <name>$` fence counts; `tbl` = pipe-table lines):

| document | archetype (PROGRESS §16.6) | reference shape | the question it settles |
|---|---|---|---|
| `new_lagq2` | album records: cover beside tracklist | **columns 6 · column 12 · image 6 · hr 7** | **§19.4, answered YES** — the reference *does* lane these records; the converter emits 0. Take this first |
| `new_lendle2` | prose + record cards | columns 5 · column 10 · frame 5 · image 5 · align 6 | a CATALOG-classified 10×2 grid that already works — the control for `new_lagq2` |
| `new_blackmore` | masthead + prose with figures | columns 3 · column 6 · image 5 · align 7 · h2 7 | lanes in a prose page |
| `new_karta` | **per-composer media catalogue**, variable-arity records | tbl 73 · nav 2 · frame 1 · align 2 | **§17.5 Q1, answered** — variable-arity records become **GFM tables with supplied labels**, the unnamed link columns headed `&#128279;` |
| `new_bach` | masthead + prose | tbl 84 · h2 6 · image 2 · align 3 · **two `#` lines** | works catalogue as tables; and the multi-`#` masthead question (OPEN §3.1) |
| `new_dyens` | prose + multi-column media/score table | tbl 7 · image 3 | the §16.4 false friend: 3 italic work titles wrongly quoted, *because* the table was not emitted |
| `new_kolpakov` | masthead + prose with figures | image 7 · **images 1** · signature 1 | the only `::: images` and the only `::: signature` in the new set |
| `new_geyzel04` | long-form prose, deep nesting | nav 1 · align 3 · image 1 | nesting depth 4 vs budget 3; 48 review escalations (volume, not kind) |
| `new_rechin4` | long-form prose | **lead 9** · h2 4 · nav 1 | **§17.5 Q3** — the reference segments heavily and uses `::: lead` repeatedly; the converter emitted 11 paragraphs and 2 `line-too-long` |

## 3. Holdout — `new_karta5`. Do not open.

`fixtures/html2/new_karta5.htm` ↔ `fixtures/out2/new_karta5.bio.md`. Chosen because it stresses the
two open questions hardest (PROGRESS §17.1, §17.2). What is already recorded about it from the blind
phase — safe to use, it predates the reference:

- 21 multi-column tables at 1024 px, **12 of them single-row**; the table path emits 4 of 15.
- 39 `::: align` directives, more than any of the 13, **21 with no distinctive source alignment**.
- It is the only document in 23 with **zero** leaf blocks ≥120 chars, so `proseAlignOf` returns a
  **null baseline** and `isDistinctiveAlign` falls back to "centre and right are distinctive on their
  own". Any change to the alignment baseline must be measured knowing this.

Both its source and its reference now sit outside `fixtures/`'s scanned directories, so `corpus run`
does not convert it. Measuring it at the end means copying the `.htm` into `fixtures/html/`
deliberately.

## 4. Corpus facts a rule may assume (`CLAUDE.md` §5, geometry-confirmed)

Content is the centre column (~½ viewport) · page chrome and footer drop · right-hand menus fold into
the main flow · most images are captioned and centred or right-aligned · discographies and score/media
lists run 2–5 columns · **>5 columns, or a page dense with blockquotes, is an anomaly** · vertically
aligned blocks in a multi-column region are semantically paired, and splitting such a region into
several small tables to preserve that pairing is legitimate.

And three that come from measurement, not assumption:

- **Presentational attributes lie.** `align="center"` on `pavlov_azancheev` appears on 5 classes, all
  computing to `justify`; only `p.t3` is truly centred.
- **`-webkit-center` / `-webkit-left`** are what Chromium returns for a node centred by an ancestor's
  `align`. Fold through `isCenteredAlign`/`foldTextAlign`; never compare a computed value raw.
- **No asset tree exists.** Every image, PDF and MP3 404s. Rendered pages show broken images by
  construction, and L3 derives picture boxes from the `size` token at a fixed 4:3 ratio. Never triage
  a broken image, and never expect an aspect-ratio defect to be visible.
