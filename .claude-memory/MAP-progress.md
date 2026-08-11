# MAP-progress -- `biomd-convert/CONVERTER-PROGRESS.md` in line ranges

Thousands of lines and growing every iteration -- `wc -l` it before trusting a size claim anywhere.
**Never read it whole.** Find the row, then `Read(file_path, offset=<start>, limit=<len>)`.

The file is **append-only**: new `##` sections land at the end, so every range below stays valid.
Regenerate with `grep -n "^## \|^### " biomd-convert/CONVERTER-PROGRESS.md`. Row table verified 2026-08-09;
rows added after that date are current by construction (append-only).

Legend -- **HOT** read often · **REF** on demand · **HIST** superseded, avoid unless doing archaeology.

| § | lines | what is in it | |
|---|---|---|---|
| 1 Result | 15-48 | first aggregate table; **per-document column does not reproduce** | HIST |
| 2 Assessment right | 49-60 | what `CONVERTER-ASSESSMENT.md` got right | HIST |
| 3 Evidence contradicts | 61-121 | the four original misreadings; the reference ceiling; eval scored stale output | REF |
| 4 What was implemented | 122-215 | break-run segmentation `4.1:130` · media binding `4.2:141` · outline recovery `4.3:158` · **`enforceSingleTitle` `4.4:180`** · frame+align `4.5:186` | REF |
| 5 What is left | 216-252 | the original reachable/unreachable split | HIST |
| 6 Iteration 0 -- the ladder | 253-442 | baseline `6.1:259` · **why the scalar cannot be the instrument `6.2:285`** · L2 built `6.3:310` · first ledger `6.4:332` · instrument defects `6.5:354` · **L5 calibration table `6.6:384`** · L2 weaknesses `6.7:414` · holdout `6.8:430` | REF |
| 7 L3 built | 443-597 | modules `7.1:450` · identity+determinism `7.2:481` · **target quirks modelled not fixed `7.3:489`** · L3↔`analyze.md` `7.4:507` · corpus result `7.5:541` · `readingOrder` non-transitive `7.6:558` · **what to distrust in L3 `7.7:573`** | REF |
| 8 Three ranked classes | 598-864 | **alignment family, the whole measured story `8.1:611`** · catalog row segmentation closed `8.2:751` · enumerated lists reverted `8.2a:793` · `paragraph.spurious` refined `8.3:822` | REF |
| 9 Evaluation policy | 865-952 | three `triage()` corrections `9.1:870` · **two user-authoritative decisions `9.2:904`** · L3 rule pairing by anchors `9.3:919` | REF |
| 10 Region family closed | 953-1068 | inconclusive ≠ not-a-region `10.1:966` · **centre alignment: false friend was a symptom `10.2:979`** · empty lane keeps its place `10.3:996` · caption echo `10.4:1028` | REF |
| 11 References moved | 1069-1219 | **visible line outranks `alt` `11.1:1087`** · directive scaffolding is not evidence `11.2:1108` · align in bounded containers `11.3:1131` · **menu written as a table `11.4:1162`** · no end-to-end align test `11.5:1182` | REF |
| 12 The label ceiling | 1220-1351 | `ALIGN_LABEL_MAX_CHARS` sweep, cliff at 300→400 `12.1:1228` · **subordination/blockquote rule + two measurement traps `12.2:1266`** · corpses `12.3:1312` | REF |
| 13 Frames | 1352-1504 | a named colour is a choice `13.1:1361` · **de-hyphenation ran on nothing `13.2:1396`** · references inconsistent about hyphenation `13.3:1424` · corpses `13.4:1459` | REF |
| 14 Phantom top class | 1505-1663 | **`paragraph.missing` contained no missing paragraphs `14.1:1513`** · `<blockquote>` is not evidence `14.2:1566` · corpses `14.3:1614` | REF |
| 15 Two classes, not one | 1664-1801 | over-split class was the reference merging `15.1:1676` · **record-list vs verse is not decidable by shape `15.2:1710`** · corpses `15.3:1761` · **development corpus frozen `15.4:1798`** | REF |
| 16 Blind check, 10 pages | 1802-1930 | gates held `16.1:1811` · **`conservation.text.recall` is not a loss measure `16.2:1829`** · per-composer media catalogue `16.3:1845` · false friend is a symptom `16.4:1875` · **archetype map `16.6:1904`** · what generalizes `16.7:1916` | **HOT** |
| 17 Blind improvement | 1931-2054 | one-row table rule killed `17.1:1944` · unbacked centring / null align baseline `17.2:1983` · corpses `17.4:2029` · **what the references must settle `17.5:2045`** | **HOT** |
| 18 Second blind pass | 2055-2174 | sweep results `18.1:2066` · empty lane not judgeable blind `18.2:2077` · **DATA→lanes killed by an existing contract `18.3:2098`** · corpses `18.5:2149` | **HOT** |
| 19 Handoff | 2175-2309 | **checkpoint `19.1:2182` · corpus roles `19.2:2198` · exact next step `19.3:2217` · the `new_lagq2` question `19.4:2233` · two blind findings `19.5:2275`** | **HOT** |
| 20 22-doc baseline + permissions | 2310-2461 | **the 22-document baseline `20.1:2315`** · implementation stricter than its format `20.2:2337` · `align`/`frame` `20.3:2361` · `---`≡`***` `20.4:2376` · **measured effect, output byte-identical `20.5:2390`** · what was *not* changed `20.6:2413` · corpses `20.7:2427` · state + queue `20.8:2442` | REF |
| 21 four mechanisms | 2463-2650 | **a class that was three mechanisms `21.1:2480`** · **the page frame `21.2:2496`** · **§19.4 answered: the CATALOG gate, not the contract `21.3:2532`** · **table headers without invention `21.4:2550`** · `williams2` reference-inconsistency `21.5:2590` · corpses `21.6:2609` · state + queue `21.7:2626` | **HOT** |
| 22 cross-grid recurrence | 2652-2753 | recurrence from a sibling grid `22.1:2662` · **one-row table killed again `22.2:2685`** · corpses `22.3:2717` · state + queue `22.4:2728` | **HOT** |
| 23 author adjudications | 2755-2846 | **`williams2`'s wrapper was a reference mistake `23.1:2772`** · **the wrapped masthead is two rules `23.2:2791`** · read the fixture, not the summary `23.3:2834` | **HOT** |
| 24 five mechanisms | 2848-3090 | **masthead = containment × typography `24.1:2866`** · **two lossy folds in `normalize` `24.2:2899`** · drawn rule + the byline it exposed `24.3:2918` · **two lying instruments: chrome fingerprint, `followsImage` `24.4:2945`** · **author ruling: a recovered centred `##` keeps no `::: align` `24.5:2981`** · corpses `24.6:3016` · **nav title + `nav` is legal in a `column` `24.8:3033`** · state + queue `24.9:3068` | **HOT** |
| 25 `break.missing` decomposed | 3092-3288 | **a "missing break" that was a setext heading `25.1:3112`** · **a drawn rule is a line; a rule may join an align run `25.2:3153`** · **the three that are not targets, with the evidence `25.3:3183`** · **image-size calibration table -- not a threshold `25.4:3218`** · corpses `25.5:3244` · state + queue `25.6:3262` | **HOT** |
| 26 `lead` ruled a ceiling | 3290-3439 | the class is the whole unbuilt construct `26.1:3307` · **author ruling: `lead` is aesthetic, not structural `26.2:3324`** · **what was measured -- typography, length, position `26.3:3343`** · corpses `26.4:3391` · **state + "rank measures what an instrument noticed" `26.5:3413`** | **HOT** |
| 27 triage first; the tinted panel | 3467-3615 | **the triage table -- 4 classes downgraded `27.1:3486`** · **a dead unitless border; occupancy not recurrence `27.2:3530`** · **the length floor, measured and reverted `27.3:3560`** · corpses `27.4:3576` · **state + go document-first on `goya2`/`news` `27.5:3592`** | **HOT** |
| 28 `new_karta` corrected; re-baseline | 3617-3697 | **the ruling voids §27.1's `image.spurious` downgrade `28.1:3652`** · a glyph always reads unattested `28.2:3672` · **new floor 424 / 92.7 / 417 · 241 / 92 `28.3:3684`** | **HOT** |
| 29 revision re-baseline; the linked icon | 3701-3843 | **`06eeafb` moved every rung with no code change; two ceilings closed themselves `29.1:3703`** · **two cheap probes chose the smaller class on priority, not size `29.2:3738`** · **`dropDecorative` vs `runImages` -- direct children vs descend-through-`<a>` `29.3:3762`** · **new floor 429 / 94.3 / 322 · 180 / 85 `29.4:3806`** · what was held back, and two guide-vs-reference glyphs to confirm `29.5:3832` | **HOT** |
| 30 a revert, and the column vocabulary | 3848-3962 | **KILLED: a word-less block may open an align run because it carries a target -- `segovia1`'s lane cells merged four lanes into one `30.1:3854`** · **the column vocabulary; §16.3 not engaged; a superseded contract `30.2:3902`** · **new floor 431 / 94.4 / 287 · 180 / 85, validator 28 → 13 `30.2`** · residual + no guide-vs-reference conflicts left `30.3:3950` | **HOT** |
| 31 a holistic sweep | 3964-4065 | **`src` adjudicated as layout -- 19 phantom defects `31.1:3968`** · **a flattened all-picture row is one `::: images` `31.2:3993`** · **`/new_rules.md` reach measured; 4 of 6 have zero reach `31.3:4021`** · **new floor 434 / 94.4 / 275 · 152 / 70 `31.4:4055`** | **HOT** |
| 32 the caption echo | 4067-4136 | **`homeOf` asks the wrong side about a caption; ask the *owning* side `32.1:4071`** · **two left wrong on purpose -- a caption merging two blocks `32.2:4103`** · **275 · 147 / 438 / 70; three instrument corrections to one converter mechanism `32.3:4117`** | **HOT** |
| 33 `segovia1`'s footer, a pager | 4138-4258 | **the hypothesis was wrong; the real ceiling is DATA-classification, not the `layoutFrom` cap `33.1:4142`** · **the rule: a row of nothing but links is a pager `33.2:4159`** · **serializer never emitted `biomdColumns`' own `columns:` count `33.3:4182`** · **known residue left alone -- nested `align` in a bare-link column `33.4:4195`** · **new floor 441 / 94.5 / 269 · 141 / 68 `33.5:4207`** · **next: `williams2` false friend blocks the discography-row fix `33.6:4232`** | **HOT** |
| 34 `kiselev`'s track lists | 4260-4368 | **probed `williams2` vs the discography three -- no invariant, parked with `analyze.md` evidence `34.1`** · **the rule: a non-quoted `<blockquote>` lowering to one paragraph is a record list `34.2`** · **exposed: `promoteLabelBeforeList`/`promoteSectionAfterRule` had no record-region guard `34.3`** · **new floor 444 / 94.5 / 263 · 135 / 68 `34.4`** · **next: `news` document-first `34.5`** | **HOT** |

## Read-this-first set

A session resuming cold needs **§32 (4067-4136)**, **§31 (3964-4065)**, **§30 (3848-3962)**, **§29 (3701-3843)**, **§28 (3617-3697)**, **§27 (3467-3615)**, **§26 (3290-3439)**, **§25 (3092-3288)**, **§24 (2848-3090)**, **§23 (2755-2846)** and
**§21 (2463-2650)** -- the current state, the author adjudications, and the queue. Add §19.2 (2198-2216) for the corpus roles and
§16.6-16.7 (1904-1930) for the archetype map. Before touching table routing read §18.3 (2098-2138)
and §21.3 (2532-2549) together: the first killed a fallback, the second is why the classification was
the thing that had to move instead.

## Checkpoint -- §28, measured 2026-08-08 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | 424 tests, typecheck clean, 0 FAILED | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **92.7 %**, clean share 13.6 % | `sh bench/run.sh` |
| L2 | 417 findings -- **241 converter-defect** · 92 ambiguous · 84 reference-inconsistency | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **92** findings (11 critical), identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | 28 errors, all `table-header-empty` (§21.4) | `corpus run -c bench/biomd.config.json` |

`bench/run.sh` needs Chromium -- `npx playwright install chromium` on a fresh machine, or every
document reports "no output produced". §24's figures were 420 / 93.0 / 432 · 252 / 97.

§24 changed the chrome fingerprint, so `bench/corpus/corpus-profile.json` must be rebuilt with
`corpus scan` after a fresh clone or a corpus change -- otherwise the cached profile is from the
old fingerprint and `news` regresses.

Superseded: §23's 406 / 92.7 / 453 · 271 / 110 was the same 22 documents before this iteration.
Two references were corrected by their author in §23, so §22's 481 / 140 are not comparable, and
§20.8's 388 / 90.3 / 745 / 287 predates those corrections.
§19.1's 369 / 93.8 / 314 / 82 was the **13**-document corpus and is not comparable at all.

| 35 Normalized refs | 4370-4573 | re-baseline `35.1:4376` · end state `35.2:4387` · **the 🔗 header reversal `35.3:4401`** · off-profile child image, instrument `35.4:4414` · the `/../` asset rule `35.5:4425` · **a one-record table is a table, un-parking §34.1 `35.6:4440`** · indent-aware lines + the announced list `35.7:4470` · the empty-column drop `35.8:4501` · **the validator/author conflict, open `35.9:4517`** · the word-less alignment rule killed a second time `35.10:4533` · already-closed complaints verified `35.11:4553` · not reached `35.12:4561` | HOT |

## Checkpoint -- §35, measured 2026-08-10 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | 463 tests, typecheck clean, 0 FAILED, `read()` warnings 0 | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **96.4 %**, clean share 13.6 % | `sh bench/run.sh` |
| L2 | 167 findings -- **91 converter-defect** · 31 ambiguous · 45 reference-inconsistency · 4 critical | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **68** findings, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **27** errors, 22 of them `table-header-empty` | `corpus run -c bench/biomd.config.json` |

**The validator figure is the author's convention, not a regression.** §21.4 recorded 28 errors "all
`table-header-empty`"; §30.2's `Название` label took it to 13 by filling the title column, and §35.3
reversed that on the author's newer ruling, so it is back where it was. Read §35.9 before treating it
as work.

Superseded: §34's 444 / 94.5 / 263 · 135 / 68 and §28's 424 / 92.7 / 417 · 241 / 92 both predate
`c92c009`'s normalized references. The reference edit alone, no code change, took L1 94.5 -> 94.6,
L2 263 -> 257 findings / 135 -> 112 defect, L3 flat -- so §21-§34 figures are not comparable to these.

| 36 Author rulings | 4575-4705 | the authority order corrected, analysis docs outrank the spec `36.1:4579` · empty header cell legalised, validator 27 -> 5 `36.2:4598` · `analyze-2.md` 373/375 corrected `36.3:4615` · `williams2`'s reference corrected `36.4:4623` · **the tie-break when evidence runs out `36.5:4659`** · state `36.6:4697` | HOT |
| 37 Five mechanisms | 4707-4867 | end state `37.1:4714` · **a rule between two aligned lines divides them `37.2:4728`** · **a pager's lane places its own link, closing §33.4's residue `37.3:4743`** · **a `rowspan` holds its rows in one region `37.4:4760`** · a link label is one line `37.5:4777` · **a numbered run split in two is one run `37.6:4794`** · validator errors split by side `37.7:4812` · downgraded on evidence `37.8:4824` · killed: merging adjacent `align` `37.9:4844` · what is next `37.10:4853` | HOT |

## Checkpoint -- §37, measured 2026-08-10 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | **476** tests, typecheck clean, 0 FAILED, `read()` warnings 0 | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **96.6 %** | `sh bench/run.sh` |
| L2 | **157** findings -- **83 converter-defect** · 28 ambiguous · 46 reference-inconsistency · 4 critical | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **52** findings, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **0** on every produced document; **4** on the *references*, all `fence-unbalanced` | `validate bench/out/<name>.bio.md` |

**The validator figure is now split by side, and §36.2's "5" was not.** Do not read the 5 -> 0 as
attributable work; §37.7 states what was measured and what was not.

| 38 segovia/rechin4/kolpakov | 4869-5021 | end state `38.1:4876` · markup stripped from a target `38.2:4895` · **a source credit is not a menu, and §37.5 corrected `38.3:4907`** · **the page you are on is an item, plus a second `navTitleFrom` false friend `38.4:4935`** · a hand-drawn bullet is a list `38.5:4955` · **a quotation spanning a block boundary is a block quote — the last converter critical `38.6:4973`** · what `analyze.md` still asks of `segovia` `38.7:4993` · still open elsewhere `38.8:5013` | HOT |

## Checkpoint -- §38, measured 2026-08-10 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | **488** tests, typecheck clean, 0 FAILED, `read()` warnings 0 | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **96.8 %** | `sh bench/run.sh` |
| L2 | **151** findings -- **73 converter-defect** · 29 ambiguous · 49 reference-inconsistency · 5 critical | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **47** findings, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **0** on every produced document; **4** on the *references*, all `fence-unbalanced` | `validate bench/out/<name>.bio.md` |

**Converter-defect criticals: 0.** All five criticals are reference-inconsistency and four are the
`link.label.content.empty` class OPEN.md §5.0 records as broken. Never quote "5 critical" bare.

| 39 analyze-3 | 5023-5328 | **normalization alone, no code** `39.1:5029` · a hyphen inside an identifier is not a wrap `39.2:5051` · **a dot leader is the column, with the 4-dot sweep** `39.3:5071` · one block is not the mass of text around it `39.4:5112` · **a hairline round a lone cell is a box, 24-instance sweep + the L2-rose-while-structure-improved accounting** `39.5:5142` · **three killed hypotheses** `39.6:5185` · **six author rulings** `39.7:5235` · **the de-hyphenation root cause, measured** `39.8:5260` · end state `39.9:5289` · what is next `39.10:5308` |
| 40 four mechanisms | 5329-5511 | end state `40.1:5335` · **four titles in one template are four headings, and a jump orphans a level not a heading** `40.2:5354` · **a floated figure belongs beside its own paragraph** `40.3:5384` · **a headline over a lighter line is not a section label -- recurrence inverted** `40.4:5401` · **a colon then quotation marks is a quotation** `40.5:5426` · **the page shell is not one table deep: measured wrong on 8/22, three replacements reverted, NOT landed** `40.6:5444` · **killed on a sweep: `::: signature`** `40.7:5481` · not re-taken `40.8:5491` · what is next `40.9:5503` |
| 41 de-hyphenation oracle | 5513-5578 | author-approved optional Hunspell dependency · **Hyphenopoly v6 Node integration repaired** · repeated-break lookahead scan · multi-part proper-name guard · measured common-word gains and ambiguous joined findings · residual tail and next step | HOT |

## Checkpoint -- §39, measured 2026-08-10 over **22 documents**

| rung | value | reproduce with |
|---|---|---|
| L0 | **502** tests, typecheck clean, 0 FAILED, `read()` warnings 0 | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **98.4 %** | `sh bench/run.sh` |
| L2 | **134** findings -- **73 converter-defect** · 18 ambiguous · 43 reference-inconsistency · 4 critical | `diff -c bench/biomd.config.json` |
| L3 | **47** findings, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **0** on every produced document | `validate bench/out/<name>.bio.md` |

**Converter-defect criticals: 0.** Three of the four are the broken `link.label.content.empty` class
(OPEN §5.0) and the fourth is the `blocks.ts` directive-property artefact (OPEN §5.0b). Never quote
"4 critical" bare.

**A large part of this checkpoint is not attributable work.** `1214860` normalized eleven references
in the same commit that added `analyze-3.md`, moving L1 96.8 -> 98.0, L2 151 -> 134 and L3 47 -> 49
with no code change at all. §39.1 separates the two.

| 39 analyze-3 | 5023-5328 | four mechanisms, three killed hypotheses, six author rulings | |
| 40 geyzel/figure/headline | 5330-5511 | four titles are four headings · a floated figure beside its paragraph · a headline over a lighter line · a colon then quotation marks | |
| 41 de-hyphenation oracle | 5513-5578 | the dependency was present, its integration was broken | |
| 42 the six `xtra_` pairs | 5580-end | **corpus 22 -> 28, holdout promoted away `42.1`, refilled `42.8`** · `92b7e67` moved every rung with no code `42.2` · baseline `42.3` · **two reference divergences recorded, not worked `42.4`** · the numbered-slot strip `42.5` · the full-span table title `42.6` · what remains `42.7` · **the holdout refilled, sources in / references out `42.8`** | HOT |

## Checkpoint -- §42, measured 2026-08-11 over **26 compared documents** (28 converted)

| rung | value | reproduce with |
|---|---|---|
| L0 | **526** tests, typecheck clean, 0 FAILED, `read()` warnings 0, validator 0 on all **28** produced | `npm install && npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **98.4 %** over 26 | `sh bench/run.sh` -- must still say `Converted+Needs review = 28` |
| L2 | **324** findings -- **207 converter-defect** · 24 ambiguous · 93 reference-inconsistency · 14 critical | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **65** findings over **26** documents, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **0** on every produced document | `validate bench/out/<name>.bio.md` |

**Never quote the 207 bare.** 138 of them (67 %) are the two reference divergences PROGRESS §42.4
records -- `xtra_shelechov`'s row-major grid (~96) and `xtra_karta5`'s table headings (42, ruled
ignorable by the author). The honest open count is **~69**.

| 43 the routing survey | 5781-5923 | **`describeTables` over the corpus is the table instrument the ledger is not `43.2`** · a numbered strip is one value, not several columns `43.3` · **an empty row at the foot of a table is bottom margin, and the general form is measured damage `43.4`** · killed: column alignment from a right-placed table, 12 refs to 1 `43.5` · **two ceilings checked against the source rather than quoted `43.6`** · **holdout measured once and spent `43.7`** · end state `43.8` · what is next `43.9` | HOT |

## Checkpoint -- §43, measured 2026-08-11 over **26 compared documents** (28 converted)

| rung | value | reproduce with |
|---|---|---|
| L0 | **535** tests, typecheck clean, 0 FAILED, `read()` warnings 0, validator 0 on all **28** produced | `npm install && npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **98.6 %** over 26 | `sh bench/run.sh` -- must still say `Converted+Needs review = 28` |
| L2 | **317** findings -- **206 converter-defect** · 18 ambiguous · 93 reference-inconsistency · **8 critical** | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **65** findings over **26** documents, identity 0, deterministic | `l3 -c bench/biomd.config.json` |
| validator | **0** on every produced document | `validate bench/out/<name>.bio.md` |

**Never quote the 206 bare.** 141 are recorded divergences and quirks (§42.4's two, plus §43.5's
`new_kolpakov`); the honest open count is **~65**. And **none of the 8 criticals has a mechanism to
build** -- 4 are §43.6's 1-to-1 divergence, 3 the broken `link.label.content.empty` class, 1 the
`blocks.ts` directive-property artefact.

| 44 figure placement | 5924-end | baseline reproduced · `retyped.paragraph-to-align` split on probe · **standalone image keeps computed placement or floated one-column figure containment** · floated multi-column false friend rejected · `image.position.value` 2 → 0 · L3 65 → 61 | HOT |

## Checkpoint -- §44, measured 2026-08-12 over **26 compared documents** (28 converted)

| rung | value | reproduce with |
|---|---|---|
| L0 | **539** tests, typecheck clean, 0 FAILED, `read()` warnings 0, validator 0 on all **28** produced | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | **98.6 %** over 26 | `sh bench/run.sh` -- must still say `Converted+Needs review = 28` |
| L2 | **315** findings -- **204 converter-defect** · 18 ambiguous · 93 reference-inconsistency · **8 critical** | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | **61** findings over **26** documents, identity 0, deterministic | `l3 -c bench/biomd.config.json --json ../analyze/l3.json` |
| validator | **0** on every produced document | `bench/run.sh` corpus summary |

**Never quote the 204 bare.** 141 are recorded divergences and quirks, so the honest open count is
~63. None of the 8 criticals has a mechanism to build; the split remains §43.8's.
