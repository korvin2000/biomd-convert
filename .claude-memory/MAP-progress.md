# MAP-progress — `biomd-convert/CONVERTER-PROGRESS.md` in line ranges

3090 lines, ~62k tokens. **Never read it whole.** Find the row, then
`Read(file_path, offset=<start>, limit=<len>)`.

The file is **append-only**: new `##` sections land at the end, so every range below stays valid.
Regenerate with `grep -n "^## \|^### " biomd-convert/CONVERTER-PROGRESS.md`. Verified 2026-08-08.

Legend — **HOT** read often · **REF** on demand · **HIST** superseded, avoid unless doing archaeology.

| § | lines | what is in it | |
|---|---|---|---|
| 1 Result | 15–48 | first aggregate table; **per-document column does not reproduce** | HIST |
| 2 Assessment right | 49–60 | what `CONVERTER-ASSESSMENT.md` got right | HIST |
| 3 Evidence contradicts | 61–121 | the four original misreadings; the reference ceiling; eval scored stale output | REF |
| 4 What was implemented | 122–215 | break-run segmentation `4.1:130` · media binding `4.2:141` · outline recovery `4.3:158` · **`enforceSingleTitle` `4.4:180`** · frame+align `4.5:186` | REF |
| 5 What is left | 216–252 | the original reachable/unreachable split | HIST |
| 6 Iteration 0 — the ladder | 253–442 | baseline `6.1:259` · **why the scalar cannot be the instrument `6.2:285`** · L2 built `6.3:310` · first ledger `6.4:332` · instrument defects `6.5:354` · **L5 calibration table `6.6:384`** · L2 weaknesses `6.7:414` · holdout `6.8:430` | REF |
| 7 L3 built | 443–597 | modules `7.1:450` · identity+determinism `7.2:481` · **target quirks modelled not fixed `7.3:489`** · L3↔`analyze.md` `7.4:507` · corpus result `7.5:541` · `readingOrder` non-transitive `7.6:558` · **what to distrust in L3 `7.7:573`** | REF |
| 8 Three ranked classes | 598–864 | **alignment family, the whole measured story `8.1:611`** · catalog row segmentation closed `8.2:751` · enumerated lists reverted `8.2a:793` · `paragraph.spurious` refined `8.3:822` | REF |
| 9 Evaluation policy | 865–952 | three `triage()` corrections `9.1:870` · **two user-authoritative decisions `9.2:904`** · L3 rule pairing by anchors `9.3:919` | REF |
| 10 Region family closed | 953–1068 | inconclusive ≠ not-a-region `10.1:966` · **centre alignment: false friend was a symptom `10.2:979`** · empty lane keeps its place `10.3:996` · caption echo `10.4:1028` | REF |
| 11 References moved | 1069–1219 | **visible line outranks `alt` `11.1:1087`** · directive scaffolding is not evidence `11.2:1108` · align in bounded containers `11.3:1131` · **menu written as a table `11.4:1162`** · no end-to-end align test `11.5:1182` | REF |
| 12 The label ceiling | 1220–1351 | `ALIGN_LABEL_MAX_CHARS` sweep, cliff at 300→400 `12.1:1228` · **subordination/blockquote rule + two measurement traps `12.2:1266`** · corpses `12.3:1312` | REF |
| 13 Frames | 1352–1504 | a named colour is a choice `13.1:1361` · **de-hyphenation ran on nothing `13.2:1396`** · references inconsistent about hyphenation `13.3:1424` · corpses `13.4:1459` | REF |
| 14 Phantom top class | 1505–1663 | **`paragraph.missing` contained no missing paragraphs `14.1:1513`** · `<blockquote>` is not evidence `14.2:1566` · corpses `14.3:1614` | REF |
| 15 Two classes, not one | 1664–1801 | over-split class was the reference merging `15.1:1676` · **record-list vs verse is not decidable by shape `15.2:1710`** · corpses `15.3:1761` · **development corpus frozen `15.4:1798`** | REF |
| 16 Blind check, 10 pages | 1802–1930 | gates held `16.1:1811` · **`conservation.text.recall` is not a loss measure `16.2:1829`** · per-composer media catalogue `16.3:1845` · false friend is a symptom `16.4:1875` · **archetype map `16.6:1904`** · what generalizes `16.7:1916` | **HOT** |
| 17 Blind improvement | 1931–2054 | one-row table rule killed `17.1:1944` · unbacked centring / null align baseline `17.2:1983` · corpses `17.4:2029` · **what the references must settle `17.5:2045`** | **HOT** |
| 18 Second blind pass | 2055–2174 | sweep results `18.1:2066` · empty lane not judgeable blind `18.2:2077` · **DATA→lanes killed by an existing contract `18.3:2098`** · corpses `18.5:2149` | **HOT** |
| 19 Handoff | 2175–2309 | **checkpoint `19.1:2182` · corpus roles `19.2:2198` · exact next step `19.3:2217` · the `new_lagq2` question `19.4:2233` · two blind findings `19.5:2275`** | **HOT** |
| 20 22-doc baseline + permissions | 2310–2461 | **the 22-document baseline `20.1:2315`** · implementation stricter than its format `20.2:2337` · `align`/`frame` `20.3:2361` · `---`≡`***` `20.4:2376` · **measured effect, output byte-identical `20.5:2390`** · what was *not* changed `20.6:2413` · corpses `20.7:2427` · state + queue `20.8:2442` | REF |
| 21 four mechanisms | 2463–2650 | **a class that was three mechanisms `21.1:2480`** · **the page frame `21.2:2496`** · **§19.4 answered: the CATALOG gate, not the contract `21.3:2532`** · **table headers without invention `21.4:2550`** · `williams2` reference-inconsistency `21.5:2590` · corpses `21.6:2609` · state + queue `21.7:2626` | **HOT** |
| 22 cross-grid recurrence | 2652–2753 | recurrence from a sibling grid `22.1:2662` · **one-row table killed again `22.2:2685`** · corpses `22.3:2717` · state + queue `22.4:2728` | **HOT** |
| 23 author adjudications | 2755–2846 | **`williams2`'s wrapper was a reference mistake `23.1:2772`** · **the wrapped masthead is two rules `23.2:2791`** · read the fixture, not the summary `23.3:2834` | **HOT** |
| 24 five mechanisms | 2848–3090 | **masthead = containment × typography `24.1:2866`** · **two lossy folds in `normalize` `24.2:2899`** · drawn rule + the byline it exposed `24.3:2918` · **two lying instruments: chrome fingerprint, `followsImage` `24.4:2945`** · **author ruling: a recovered centred `##` keeps no `::: align` `24.5:2981`** · corpses `24.6:3016` · **nav title + `nav` is legal in a `column` `24.8:3033`** · state + queue `24.9:3068` | **HOT** |
| 25 `break.missing` decomposed | 3092–3288 | **a "missing break" that was a setext heading `25.1:3112`** · **a drawn rule is a line; a rule may join an align run `25.2:3153`** · **the three that are not targets, with the evidence `25.3:3183`** · **image-size calibration table — not a threshold `25.4:3218`** · corpses `25.5:3244` · state + queue `25.6:3262` | **HOT** |
| 26 `lead` ruled a ceiling | 3290–3439 | the class is the whole unbuilt construct `26.1:3307` · **author ruling: `lead` is aesthetic, not structural `26.2:3324`** · **what was measured — typography, length, position `26.3:3343`** · corpses `26.4:3391` · **state + "rank measures what an instrument noticed" `26.5:3413`** | **HOT** |
| 27 triage first; the tinted panel | 3467–3615 | **the triage table — 4 classes downgraded `27.1:3486`** · **a dead unitless border; occupancy not recurrence `27.2:3530`** · **the length floor, measured and reverted `27.3:3560`** · corpses `27.4:3576` · **state + go document-first on `goya2`/`news` `27.5:3592`** | **HOT** |
| 28 `new_karta` corrected; re-baseline | 3617–3697 | **the ruling voids §27.1's `image.spurious` downgrade `28.1:3652`** · a glyph always reads unattested `28.2:3672` · **new floor 424 / 92.7 / 417 · 241 / 92 `28.3:3684`** | **HOT** |
| 29 revision re-baseline; the linked icon | 3701–3843 | **`06eeafb` moved every rung with no code change; two ceilings closed themselves `29.1:3703`** · **two cheap probes chose the smaller class on priority, not size `29.2:3738`** · **`dropDecorative` vs `runImages` — direct children vs descend-through-`<a>` `29.3:3762`** · **new floor 429 / 94.3 / 322 · 180 / 85 `29.4:3806`** · what was held back, and two guide-vs-reference glyphs to confirm `29.5:3832` | **HOT** |

## Read-this-first set

A session resuming cold needs **§29 (3701–3843)**, **§28 (3617–3697)**, **§27 (3467–3615)**, **§26 (3290–3439)**, **§25 (3092–3288)**, **§24 (2848–3090)**, **§23 (2755–2846)** and
**§21 (2463–2650)** — the current state, the author adjudications, and the queue. Add §19.2 (2198–2216) for the corpus roles and
§16.6–16.7 (1904–1930) for the archetype map. Before touching table routing read §18.3 (2098–2138)
and §21.3 (2532–2549) together: the first killed a fallback, the second is why the classification was
the thing that had to move instead.

## Checkpoint — §28, measured 2026-08-08 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | 424 tests, typecheck clean, 0 FAILED | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **92.7 %**, clean share 13.6 % | `sh bench/run.sh` |
| L2 | 417 findings — **241 converter-defect** · 92 ambiguous · 84 reference-inconsistency | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **92** findings (11 critical), identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | 28 errors, all `table-header-empty` (§21.4) | `corpus run -c bench/biomd.config.json` |

`bench/run.sh` needs Chromium — `npx playwright install chromium` on a fresh machine, or every
document reports "no output produced". §24's figures were 420 / 93.0 / 432 · 252 / 97.

§24 changed the chrome fingerprint, so `bench/corpus/corpus-profile.json` must be rebuilt with
`corpus scan` after a fresh clone or a corpus change — otherwise the cached profile is from the
old fingerprint and `news` regresses.

Superseded: §23's 406 / 92.7 / 453 · 271 / 110 was the same 22 documents before this iteration.
Two references were corrected by their author in §23, so §22's 481 / 140 are not comparable, and
§20.8's 388 / 90.3 / 745 / 287 predates those corrections.
§19.1's 369 / 93.8 / 314 / 82 was the **13**-document corpus and is not comparable at all.
