# MAP-corpus -- 26 compared + 2 holdout (28 converted) + 946 unlabelled, and what each one proves

**Updated 2026-08-12, PROGRESS §46.** Six `xtra_` pairs joined the corpus and the holdout
changed hands in §42; §46 added a fifth role. §1 and §2 below still describe the original 13 and 9;
§2b and §3 are new.

> **`fixtures/gen_corpus/` -- 946 sources, no references at all (PROGRESS §46).** The 15 pages the
> `new_*`/`xtra_*` fixtures were drawn from are held out of it in `fixtures/aaaaaaaaaaaaaaa/`, so it is
> disjoint from the 28. **Blind by construction**: nothing can be tuned to a page that has no
> reference, which makes it a stronger generalization signal than the two-document holdout and the
> reason §46 needed no holdout at all. Its rung is conservation, validator, FAILED count, routing
> outcome and cross-document consistency -- **never** a similarity score, because there is nothing to
> be similar to. Floor: 0 FAILED, 0 validator errors, 1 lost target, 3 lost images. One scan ~2.5 min.
>
> **Read it as a corrective on the tables below, too.** Per document the reference set carries four to
> five times the table evidence of the corpus it stands for: `DATA`→emitted table on 46 % of references
> against 10.5 % of the 946, `::: columns` 50 % against 11 %, `::: frame` 18 % against 4 %. The
> archetypes below are real and they are also *not* a random sample.
>
> Shapes the 946 hold that no reference does: the **footer pager with an unlinked middle marker** (12
> documents, §46.3 -- a priority-1 data loss no reference could have caught), the **adjacent caption
> echo** (8 documents, §46.7), **`<map>`/`<area>` image-map navigation** (7), **`<dl>` definition
> lists** (1, 56 tags), **`<pre>`** (1, 11 tags), real **`<h1>`-`<h6>`** headings (7), and **`<ol>`**
> (7).

Pick a document by **what it can falsify**, not by how many findings it has. A class in one document
is nearly always the wrong target however many instances it has (`CLAUDE.md` §5).

Defect counts for the 13 are the **recorded** figures from PROGRESS §15.4 (2026-08-06, 13-document
ledger) -- a relative ranking, not a current measurement. Reference shapes for the 9 were measured on
2026-08-08 by counting directive fences in `fixtures/out/*.bio.md`.

## 1. Regression corpus -- the original 13. Never regress.

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
| `barrios` | one table per disc | **0 converter defects** -- the reference-revision success case | 0 |

## 2. Refinement set -- the 9 `new_*` pairs. This is where the work happens.

Reference shape, measured 2026-08-08 (`^::: <name>$` fence counts; `tbl` = pipe-table lines):

| document | archetype (PROGRESS §16.6) | reference shape | the question it settles |
|---|---|---|---|
| `new_lagq2` | album records: cover beside tracklist | **columns 6 · column 12 · image 6 · hr 7** | **§19.4, answered YES** -- the reference *does* lane these records; the converter emits 0. Take this first |
| `new_lendle2` | prose + record cards | columns 5 · column 10 · frame 5 · image 5 · align 6 | a CATALOG-classified 10×2 grid that already works -- the control for `new_lagq2` |
| `new_blackmore` | masthead + prose with figures | columns 3 · column 6 · image 5 · align 7 · h2 7 | lanes in a prose page |
| `new_karta` | **per-composer media catalogue**, variable-arity records | tbl 73 · nav 2 · frame 1 · align 2 | **§17.5 Q1, answered** -- variable-arity records become **GFM tables with supplied labels**, the unnamed link columns headed `&#128279;` |
| `new_bach` | masthead + prose | tbl 84 · h2 6 · image 2 · align 3 · **two `#` lines** | works catalogue as tables; and the multi-`#` masthead question (OPEN §3.1) |
| `new_dyens` | prose + multi-column media/score table | tbl 7 · image 3 | the §16.4 false friend: 3 italic work titles wrongly quoted, *because* the table was not emitted |
| `new_kolpakov` | masthead + prose with figures | image 7 · **images 1** · signature 1 | the only `::: images` and the only `::: signature` in the new set |
| `new_geyzel04` | long-form prose, deep nesting | nav 1 · align 3 · image 1 | nesting depth 4 vs budget 3; 48 review escalations (volume, not kind) |
| `new_rechin4` | long-form prose | **lead 9** · h2 4 · nav 1 | **§17.5 Q3** -- the reference segments heavily and uses `::: lead` repeatedly; the converter emitted 11 paragraphs and 2 `line-too-long` |

## 2b. Refinement set -- the 4 `xtra_*` pairs that stayed comparable

Added by the author 2026-08-11 and measured the same day. Reference shapes counted from
`fixtures/out/*.bio.md`.

| document | archetype | what it proves / why you'd open it | defects after §42 |
|---|---|---|---|
| `xtra_albeniz` | media table + bound figures | **the clean one.** A 13x3 record matrix whose score rows subdivide the leading band, `::: image` sizing, and the `/../` asset climb -- all correct on first contact. Open it as the *positive control* for any table change | **0** |
| `xtra_rodrigo` | wide score sheet + two-lane works list | the eleven-column strip (§42.5) and the full-span work title (§42.6) both live here, and both references are unambiguous. **L1 100.0 on every axis** | **1** |
| `xtra_karta5` | catalog of ~20 record tables | the former holdout. Its table *headings* are the corpus outlier and are author-ruled ignorable (OPEN §3.13); its table *content* is the evidence. Holds the six-column Sor matrix that kills any "wide tables are wrong" rule, and the plain full-span section label that is §42.6's false friend | 50 (**42 ceiling**) |
| `xtra_shelechov` | 27x2 concert programme | the row-major-grid divergence, 8 references to 1 (PROGRESS §42.4). Open it to understand the ceiling, not to work it | 101 (**~96 ceiling**) |

## 3. Holdout -- `xtra_oyanguren`, `xtra_mikulka`. Do not open.

Named by the author 2026-08-11. Sources stay in `fixtures/html/`; **only the references moved**, to
`fixtures/out2/`. `eval`, `diff` and `l3` enumerate `expectedDir`, so both are invisible to L1/L2/L3;
`corpus run` follows `inputDir`, so both are still converted, validated and inside the conservation
gate. That is the arrangement PROGRESS §19.2 wanted and the `new_karta5` era lost.

**The leak detector is the pair of counts:** `l3` must print **26 documents**, `bench/run.sh` must
still report **28** converted. If a comparison rung says 28, a reference has been put back.

Chosen because they exercise the `columns`/`images` shapes rather than the tables §42 worked:
`xtra_oyanguren` is a two-lane composer/works list plus an `::: images columns: 2` pair-gallery,
`xtra_mikulka` a three-lane discography with a per-cell image stack.

Measured once, 2026-08-11, before they were named: `xtra_oyanguren` 3 findings / 3 defects,
`xtra_mikulka` 2 / 2 and 2 L3. **Clean from §43 onward, not for §42** -- both references were read
during §42's reconnaissance and `xtra_mikulka` appears in §42.4's `::: columns` survey, though no
rule was designed or tuned against either. PROGRESS §42.8.

The previous holdout `new_karta5` is now `xtra_karta5` in the measured corpus; its stale copies still
sit in `fixtures/html2/` + `fixtures/out2/` and pair with nothing.

## 4. Corpus facts a rule may assume (`CLAUDE.md` §5, geometry-confirmed)

Content is the centre column (~½ viewport) · page chrome and footer drop · right-hand menus fold into
the main flow · most images are captioned and centred or right-aligned · discographies and score/media
lists run 2-5 columns · **>5 columns, or a page dense with blockquotes, is an anomaly** · vertically
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
