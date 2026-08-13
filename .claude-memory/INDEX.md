# .claude-memory -- root router

**Read this file first, every session. Read nothing else until it routes you.**

This directory is a *navigation index*, never a source of truth. It answers **"where do I look"**
and **"what did we already try"** in one read, so that the expensive files are opened at the right
offset instead of end to end. Precedence is unchanged: `CLAUDE.md` (law) → `BioMD-Reference.md`
(syntax) → `fixtures/` (evidence) → `CONVERTER-PROGRESS.md` (measured state) → this index.

**Every number here is a pointer, not a fact.** Numbers go stale within one iteration; the
measurement commands in §3 are the only trustworthy source. If this index and a repository file
disagree, the repository file wins and this index gets fixed.

---

## 1. Sixty-second orientation

| | |
|---|---|
| project | deterministic-first HTML→BioMD Lite 1.6 compiler for ~1000 1998-era FrontPage Russian guitarist biographies |
| phase | **reference-guided refinement.** The blind phase is closed (PROGRESS §16-§18). Do not repeat it. |
| where the work happens | `biomd-convert/` -- one general mechanism per iteration, four-rung acceptance |
| how to start an iteration | `/refine-biomd-converter` |
| the deliverable | (1) a rule system that generalizes to the other ~987 pages; (2) an evaluation apparatus that localizes defects. Both. |
| the objective | source fidelity > visual layout quality > generality. **Never** byte-agreement with the references. |

**Corpus roles -- verified 2026-08-11.** **28 sources convert; 26 are compared.** The "22" every
earlier note quotes is superseded: the author added six `xtra_*` pairs and promoted the old holdout.

| role | members | rule |
|---|---|---|
| regression corpus | the original **13** (`authors barrios borislova goya2 jovicic kiselev news news_2007 pavlov_azancheev segovia segovia1 tarrega williams2`) | the floor. Never regress it |
| refinement set | **9** `new_*` + **4** `xtra_*` (`albeniz karta5 rodrigo shelechov`) | where the work happens |
| holdout | **`xtra_oyanguren`**, **`xtra_mikulka`** -- sources in `fixtures/html/`, references in `fixtures/out2/` | never read, diff, score or tune against them. **Spent since §43.7** |
| **generalization corpus** | **946** sources in `fixtures/gen_corpus/`, **no references at all** (the 15 pages the fixtures came from are held out in `fixtures/aaaaaaaaaaaaaaa/`) | **blind by construction** — nothing can be tuned to a page with no reference. Rung = conservation + validator + FAILED + routing consistency, **never** a similarity score. PROGRESS §46 |

> **Which count an instrument reports tells you whether the holdout leaked.** `eval`, `diff` and `l3`
> all enumerate **`expectedDir`** (`fixtures/out/`), so they must say **26**; `corpus run` and
> `bench/run.sh` follow `inputDir` and must still convert **28**. That arrangement is deliberate and
> better than the old `new_karta5` one, which moved the *source* out and lost the blind
> conservation/validation signal with it. If `l3` says 28, a reference has been put back.

> `xtra_karta5` *is* the former holdout `new_karta5`, promoted by the author into the measured corpus;
> the stale copies still sit in `fixtures/html2/`+`out2/`. PROGRESS §42.1, §42.8.

**Next action** -- see [OPEN.md](OPEN.md) §1. In short: **PROGRESS §51** closed a **word boundary
hidden inside inline markup** (`1e91d58`). `<i>Доменикони </i>Карло` fused two words, because Markdown
cannot write `*x *` and the serializer dropped the space rather than hoisting it — **silent semantic
corruption that no rung in the ladder measures**: recall is shingle-based, the validator has no
opinion, L3 measures geometry, and L1 sees one token instead of two among thousands. **Word fusions:
24 over 16 of the 946 → 0; the 28 produced 2 → 0.** §50 before it closed the **wrap hyphen** twice
(`c5f37bc`, `75b9b24`, 167 → 6); §48/§49 bound one visible caption to each figure and gallery image
(`743e463`, `ca78c45`); §47 closed the last conservation losses (`e4513f9`, `d442c63`, `a251a96`).
Current floor: L0 **739 tests**, **0 validator errors on every produced document**, L1 **98.6**,
L2 **320 · 198 defect · 9 critical**, L3 **59 over 26**, and on the **946: 0 FAILED, 0 validator
errors, 0 lost targets, 0 lost images**.
**L2's total rose 10 across §50 and §51 while converter-defect fell 199 → 198**, and the 9th critical
is `barrios`'s one-space footnote, triaged *ambiguous*. Quote the split, and read §51.5 before
treating any of it as damage.
**141 of those 199 are recorded divergences and quirks, not work** — `xtra_shelechov`'s row-major grid
(~96, 8 references to 1), `xtra_karta5`'s table headings (42, author-ruled ignorable) and
`new_kolpakov`'s column alignment (3, killed 12-to-1 in §43.5). The honest open count is **~58**;
the 8 criticals remain only in the two recorded-divergence documents. Quote the split.
**`npm install` first** — §41's optional `dictionary-ru`/`nspell` are absent on a fresh clone and
`tsc` fails on the missing declarations.
Next candidates after §51: **`layout.containment.mismatch`, 13 instances over 9 documents** — the
broadest untouched L3 class and the rung that answers priority 4; then one **isolated
instrument-truthfulness step** for `paragraph.content`'s blanket `critical` severity (OPEN §5.0aa) and
the property-line-as-paragraph artefact (§5.0b), which together own 3 of the 9 criticals; then the
**proper-name hyphenation tail** (needs a stem-tolerant lexicon lookup), `segovia`'s
`retyped.paragraph-to-align`, and §40.6's shell-depth root cause.
**Two routing candidates are closed, not open:** `DATA`→flow `too-small` is 27 instances in four
unrelated shapes, probed five times (§50.1), and `LAYOUT t2`'s 17-against-15 split is a page shell on
one side and an inner region on the other (§51.2). **Nothing table-shaped is open and general among
the 26** (§43.9); every table candidate now lives on the 946.

> **A conservation finding is a pointer, not the defect.** Both of §46.9's named losses were
> mis-diagnosed by the finding that raised them: `williams1`'s "lost target" had lost nothing (the
> gate counted a deliberate same-href anchor merge), and `assad_b`'s "3 lost images" were the
> visible corner of an entire deleted discography. Convert the document and read the output.

> **Start a table iteration with the routing survey, not the ledger (§43.2).** One
> `convert … | grep '^Tables:'` per source prints `CLASS→table[r×c]` / `CLASS→flow(failure)` — the only
> view that shows a table's *outcome* beside its *class*. Both §43 mechanisms came out of it; neither
> was near the top of the ledger, and one was on a document the defect column called clean.
> **§46.5 makes it a consistency instrument that needs no reference:** reduce every table to the
> classifier's own view (class, tier, rounded score vector); a view with more than one *outcome* is an
> inconsistency by construction. 3332 tables → 62 views → **7 split, 32 minority decisions**.

> **Scan the 946 before reading the ledger (§46.2).** One pass, ~2.5 min, records per document: state,
> recall, missing targets/images, diagnostics, REVIEW reasons, REMOVED reasons, every table's class and
> outcome, and a fingerprint of the produced Markdown. Both §46 mechanisms came out of it and **neither
> is visible to any reference** — the shape occurs in none of the 28 sources. Also note what it says
> about the fixtures themselves: per document they carry **4–5× more table evidence** than the corpus
> they stand for (`DATA`→table 46 % vs 10.5 %).

> **Text recall is not a loss signal (§46.6, killed).** Its denominator includes the chrome the
> converter is meant to remove, so a text-poor page scores terribly while losing nothing:
> `baden_powell2` is 40 % with 193 characters of visible text and everything conserved, and
> `new_lagq2` is **45 %** inside the reference set at L1 99.8. Check the page's text budget first.

**The reference normalization settled three standing items with no code change** (PROGRESS §39.1):
`news`'s frame/align ceiling · `williams2`'s `retyped.table-to-align`, which **dissolves §36.5's
named divergence** · most of `link.label.content.empty`. Re-measure before trusting any number
written before it.

**The authority order changed -- read this before citing a spec rule (PROGRESS §36.1).**
`analyze/analyze.md` + `analyze-2.md` + `analyze-3.md` are now rung **1**, the `fixtures/` pairs rung 2, and
`BioMD-Reference.md` rung 3 and **amendable**: a rule there that contradicts them is wrong and is
corrected there, never worked around in the converter. That is how §35.9 closed -- an empty header
**cell** is now legal, and validator errors fell 27 -> 5. Invariant 1 gains one exception: an author
correction stated explicitly and by name.

The word-less alignment rule has now been **killed twice**, on two different falsifiers (§30.1,
§35.10) -- read both before touching `retyped.paragraph-to-align`, which is two mechanisms wearing
one name. Its residue, `align` inside `column`, is closed by §37.3.

**Mine `analyze/analyze.md`, `analyze-2.md` and `analyze-3.md` before the ledger.** Two of §37's five
mechanisms came out of `analyze-2.md`'s `goya2` section, five of §38's six out of `analyze.md`'s
`segovia` section, and **all four of §39's out of `analyze-3.md`** -- together with three killed
hypotheses and **six author rulings** that close open questions for free (OPEN §3.9-§3.12), including
the one conflict §38 had left for the author. They are rung 1, they name defects the instruments rank
low or cannot see, and they state which differences the author considers non-defects.

> **A defect count can move because the instrument became truthful, because the conversion improved,
> because a difference became newly *visible*, or because the references were edited.** All four have
> happened — §38.5 raised `segovia`'s total while halving its defects; §39.1 moved every rung with no
> code at all; §39.5 raised L2 by 7 while giving two documents the frames the author asked for. Quote
> which, or the number reads as work that happened, or as damage that did not.

> **The ledger's rank measures what an instrument noticed, not what work is available.** Three of
> the last four classes taken from the top were ceilings or several mechanisms sharing a name.
> Adjudicate two or three instances before surveying.

**Three setup traps on a fresh clone:** `npx playwright install chromium` (L1 needs it), `corpus
scan` (§24.4 changed the chrome fingerprint), and `git config core.multiPackIndex false` (this
repo's midx is a version git 2.45 rejects).

---

## 2. Route by question

| I need to know... | go to | cost |
|---|---|---|
| what is binding / triage verdicts / rule contracts | `CLAUDE.md` | loaded already |
| BioMD syntax, directive grammar, nesting, validation list | `BioMD-Reference.md` (204 ln) | cheap |
| a BioMD rule the short reference omits | `Biography-Markup.md` (1054 ln) -- **fallback only**; the short reference is the baseline | grep it |
| what is open right now, and what the new references just settled | [OPEN.md](OPEN.md) | cheap |
| what was already tried and killed | [KILLED.md](KILLED.md) | cheap |
| which document proves what / archetypes / reference shapes | [MAP-corpus.md](MAP-corpus.md) | cheap |
| which module owns a rule, which test file holds its contract | [MAP-repo.md](MAP-repo.md) | cheap |
| the detail behind any PROGRESS claim | [MAP-progress.md](MAP-progress.md) → `Read` at the offset | **saves ~45k tokens** |
| the iteration procedure | `.claude/skills/refine-biomd-converter/SKILL.md` | cheap |
| harness lessons that cost hours (debug probes, `/dev/null` on Git Bash, NullMeasurer) | `.claude/skills/refine-biomd-converter/learned-patterns.md` | cheap |
| the human quality record (Russian, per page) -- **rung 1, above the syntax reference** | `analyze/analyze.md` (614 ln) + `analyze-2.md` (386 ln, `news`/`goya2`/`new_karta`/`kiselev` + house rules) + `analyze-3.md` (337 ln, 12 documents + 6 rulings, `snapshot_23`-`27`) + `analyze/design.png` | grep by page name |
| mini-image / icon → glyph policy | `mini_images_to_md_guide.md` -- normative; the map is built for **linked** icons (`glyphs.ts` `ICON_GLYPHS`), unlinked half still open, OPEN.md §2.4. No reference conflicts remain | cheap |
| the author's house conventions, newest ground truth | `/new_rules.md` (repo root) -- the column vocabulary is built (`column-labels.ts`); the rest is **not yet implemented**, inventory in PROGRESS §29.1 | cheap |
| the manual procedure behind the references | `html-to-biomd_guide.md`, `html-to-biomd_ext_guide.md` -- advisory, possibly stale | grep |
| history, superseded | `CONVERTER-ASSESSMENT.md`, `htm-to-md_utility_plan.md`, `how_to_fix_table_parsing_and_reconstruction.md` | avoid |

**Never open end to end:** `CONVERTER-PROGRESS.md` is append-only and grows every iteration (`wc -l` it
before assuming a size). Route through [MAP-progress.md](MAP-progress.md); it maps every `##`/`###` to a
line range and a one-line summary.

---

## 3. The four rungs -- command, sight, blindness

Run in this order, always. `bench/out/` goes stale the moment you rebuild: **build → bench → adjudicate.**

| rung | command (from `biomd-convert/`) | sees | blind to |
|---|---|---|---|
| **L0** gate | `npx tsc -p tsconfig.json --noEmit && npm test` | contracts, conservation, validator, 0-FAILED | anything unasserted |
| **L1** tripwire | `sh bench/run.sh` | 7 multiset F1 axes | directive properties, quotes, block order, hard breaks, emphasis, typography, cell coordinates, link labels |
| **L2** primary | `node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json` | localized structural findings, both sides quoted | rendering -- cannot say which layout looks better |
| **L3** rendered | `node dist/cli/index.js l3 -c bench/biomd.config.json --json ../analyze/l3.json` | geometry: containment, order, alignment, lanes | text content and spelling |

Targeted: `diff --doc <name> --class <prefix> -v` · `l3 --doc <name> -v` · `inspect fixtures/html/<name>.htm`
· `npx vitest run src/convert-core/recovery.test.ts -t "<contract>"`.

`corpus scan` only when `bench/corpus/corpus-profile.json` is absent or the corpus changed -- it rebuilds
the lexicon and therefore changes behaviour on every document.

**"L1 did not move" is not evidence that nothing happened.** A quote change moves L2 only; a
re-parenting moves L3 only; a hyphenation change moves L2 only. L1's honest target is ≈98 %, and it is
a silent-regression detector, never a per-change objective.

---

## 4. Standing prohibitions (pointers, not restatements)

`CLAUDE.md` §3 is the law. The five that get violated by accident:

1. **Never edit** `fixtures/**`, `analyze/*.md`, `analyze/*.png` -- not even to close a finding.
2. **No literals** in a detector: no corpus string, class, id, filename or title. Lexical knowledge
   (bullet glyphs, label vocabularies, border palettes, **icon maps**) goes in a documented,
   language-tagged data file, and the rule degrades gracefully when the list misses.
3. **No instrument may become the objective.** Do not tune `src/eval/score.ts` or any rung to move a number.
4. **A killed hypothesis reopens on new measurement only**, never on argument. See [KILLED.md](KILLED.md).
5. **Grep the contracts before building.** `recovery.test.ts` records what previous sessions already
   tried; an asymmetry with a named false friend is a decision, not an oversight.

---

## 5. Maintaining this index

Cheap to keep true; useless once false.

- **After an accepted change:** update [OPEN.md](OPEN.md) only. It is the volatile file by design.
- **After a new `##` section lands in PROGRESS:** append one row to [MAP-progress.md](MAP-progress.md)
  and any corpses to [KILLED.md](KILLED.md). Earlier line ranges are stable -- PROGRESS is append-only.
- **After a corpus change:** [MAP-corpus.md](MAP-corpus.md) and §1 above.
- **Never** copy a measured number in here without its date and the command that produced it.

Regenerate the PROGRESS line map with:

```bash
grep -n "^## \|^### " biomd-convert/CONVERTER-PROGRESS.md
```
