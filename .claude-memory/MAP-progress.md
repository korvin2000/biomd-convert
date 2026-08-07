# MAP-progress — `biomd-convert/CONVERTER-PROGRESS.md` in line ranges

2309 lines, ~47k tokens. **Never read it whole.** Find the row, then
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

## Read-this-first set

A session resuming cold needs **§19 (2175–2309)** and **§16.6–16.7 (1904–1930)** — 160 lines, and
that is the whole handoff. Add §18.3 (2098–2138) before touching table routing.

## Recorded checkpoint — §19.1, **not re-measured since 2026-08-06**

| rung | recorded | reproduce with |
|---|---|---|
| L0 | 369 tests, typecheck clean, 0 FAILED | `npx tsc -p tsconfig.json --noEmit && npm test` |
| L1 | 93.8 % | `sh bench/run.sh` |
| L2 | 314 findings — 188 converter-defect · 76 ambiguous · 50 reference-inconsistency | `diff -c bench/biomd.config.json --json ../analyze/defects.json` |
| L3 | 82 findings, identity 0, deterministic | `l3 -c bench/biomd.config.json` |

`analyze/defects.json` on disk (checked 2026-08-08) matches those totals over **13** `perDocument`
entries — i.e. it is the **pre-new-reference** ledger and is stale for the 22-document corpus.
