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

**Corpus roles -- verified 2026-08-08.** Instruments must report **22** documents, not 23.

| role | members | rule |
|---|---|---|
| regression corpus | the original **13** (`authors barrios borislova goya2 jovicic kiselev news news_2007 pavlov_azancheev segovia segovia1 tarrega williams2`) | the floor. Never regress it |
| refinement set | **9** `new_*` pairs in `fixtures/html/` ↔ `fixtures/out/` | where the work happens |
| holdout | **`new_karta5`** -- `fixtures/html2/new_karta5.htm` ↔ `fixtures/out2/new_karta5.bio.md` | never read, diff, score or tune against it |

> Holdout note: the source moved *out* of `fixtures/html/`, so unlike the arrangement PROGRESS §19.2
> describes, `corpus run` no longer converts it and its blind conservation/validation signal is gone.
> Measuring it means copying it into `fixtures/html/` deliberately, at the end.

**Next action** -- see [OPEN.md](OPEN.md) §1. In short: `c92c009` **normalized 11 references and
added `analyze/analyze-2.md`**, an in-depth complaint record for `news`, `goya2`, `new_karta` and
`kiselev` with new house rules stated as prose, so **every number in PROGRESS §21-§34 predates the
current corpus** (PROGRESS §35.1). Six mechanisms landed since -- a link column is headed `🔗` again,
reversing §30.2 (§35.3); a child `image`'s `position`/`size` is outside the profile so its absence is
not a defect (§35.4, instrument); an asset outside the content roots climbs one level (§35.5); a
one-record table is still a table, which un-parked §34.1 (§35.6); two lines pushed in by the same
amount are two lines (§35.7); a column no row fills is spacing (§35.8).
Current floor: L0 **463 tests / 27 validator errors**, L1 **96.4**, L2 **167 · 91 defect · 4 crit**,
L3 **68**.

**The validator rise is an author ruling, not a regression** -- 22 of the 27 are `table-header-empty`,
one per empty header cell, because `| | 🔗 |` leaves the title column empty. It needs a decision, not
a fix: OPEN.md §2.

The word-less alignment rule has now been **killed twice**, on two different falsifiers (§30.1,
§35.10) -- read both before touching `retyped.paragraph-to-align`, which is two mechanisms wearing
one name.

> **Fourteen of this iteration's 21-defect fall were the instrument becoming truthful, seven the
> conversion improving.** Quote the defect count with that split or it reads as work that happened.

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
| the human quality record (Russian, per page) | `analyze/analyze.md` (614 ln) + `analyze/design.png` | grep by page name |
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
