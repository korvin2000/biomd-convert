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

**Corpus roles -- verified 2026-08-14, after §56.** **28 sources convert; 28 are compared.** Every
earlier count ("22", "27", "28 / 26") is superseded. The author added the `xtra_alexandro` pair in
§56, parked the holdout **source and reference together**, and **deleted `fixtures/gen_corpus/`**.

| role | members | rule |
|---|---|---|
| regression corpus | the original **13** (`authors barrios borislova goya2 jovicic kiselev news news_2007 pavlov_azancheev segovia segovia1 tarrega williams2`) | the floor. Never regress it |
| refinement set | **9** `new_*` + **6** `xtra_*` (`albeniz alexandro garcia_lorca karta5 rodrigo shelechov`) | where the work happens |
| holdout | `xtra_oyanguren`, `xtra_mikulka`, `new_karta5` -- sources in `fixtures/html2/`, references in `fixtures/out2/` | never read, diff, score or tune against them. **Spent since §43.7** |
| ~~generalization corpus~~ | **removed.** `fixtures/gen_corpus/` is gone and gitignored | do not reach for it; §46--§52's 946-page numbers are history, not a signal you can re-take |

> **The old leak detector is retired.** `eval`, `diff`, `l3`, `corpus run` and `bench/run.sh` all say
> **28** now, because the holdout's source moved out with its reference and `xtra_alexandro` moved in. That also means the holdout
> is outside the conservation and validator gate -- it costs nothing and proves nothing until it is
> measured deliberately.

**Next action** -- see [OPEN.md](OPEN.md) §1. In short: **PROGRESS §56** landed four
author-directed mechanisms over 28 documents. A caption belongs to the picture it shares a box
with -- a one-column two-row figure box binds (`xtra_alexandro`'s stamp, which has no `alt`
anywhere), and a caption run now stops at a block the *next* block claims, which un-swallows
`segovia`'s `## ДИСКОГРАФИЯ`. An icon a sentence carries is a glyph, not a picture --
`main/smile.gif` was the last `main/` asset still shipping as an image. And the corpus gained
the mark it had no name for: `==` for a run the author set apart inline, and for a long
quotation embedded in prose.
Current floor: L0 **914 tests** (863 before §57), 0 FAILED, conservation ok, L1 **99.5**,
L2 **138 · 76 defect · 2 critical · 36 major**, L3 **22 over 28 with no criticals**.
**PROGRESS §57 rebuilt the LLM subsystem as a plugin framework and moved no conversion byte** —
L1/L2/L3 re-measured identical. A hook is a directory under `src/llm/plugins/`; the acceptance
check lives in `convert-core/decisions.ts`; authoring contract in `biomd-convert/docs/LLM-HOOKS.md`.
**Read the baseline before reading the delta.** The author added a pair mid-iteration, so §56's
baseline was re-measured over 28: **145/81/2/38**, L1 99.0.
**The biggest lesson is §56.6, and like §55.3 it is about the ledger, not the converter.** Two of
the four mechanisms were **named in the code that refused them** -- `promoteLabelBeforeList`'s doc
comment cites `ДИСКОГРАФИЯ` as its motivating example while its recurrence floor makes that
example unreachable, and `isUiIcon`'s cites the guide's unlinked clause while requiring an
`<a href>`. Neither was in `analyze/defects.json` at any rank: a `caption:` property is not a
block, so nothing compared it, and a construct the converter cannot emit is one no instrument
reports as missing. **Grep the contracts for the shape you are about to build, and read what they
refuse and why.**
Next candidates: **`xtra_shelechov`'s `align.spurious` x2** and its 2 `break.missing`
(OPEN §1.0a/0b); then **`layout.containment.mismatch`, 13 over 9**, the broadest untouched L3
class; then the isolated instrument-truthfulness steps -- `paragraph.content`'s blanket
`critical` (OPEN §5.0aa), the property-line-as-paragraph artefact (§5.0b), `code.text`'s
whitespace-collapsed comparison (§5.0aaa) and **`emphasis.span`'s mis-split of `***x***`**
(§5.0aaaaa).

> **A conservation finding is a pointer, not the defect.** Both of §46.9's named losses were
> mis-diagnosed by the finding that raised them: `williams1`'s "lost target" had lost nothing (the
> gate counted a deliberate same-href anchor merge), and `assad_b`'s "3 lost images" were the
> visible corner of an entire deleted discography. Convert the document and read the output.

> **And a *clean* conservation report is not a clean conversion.** §53.2 is the sharpest case in the
> campaign: every word, target and image present, recall 99.46 %, validator silent, L1 unmoved --
> and six poems flattened into six paragraph-shaped strings. Structure that no rung measures is
> exactly where the next defect of this kind will be.

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
| mini-image / icon → glyph policy | `mini_images_to_md_guide.md` -- normative; the map is `glyphs.ts` `ICON_GLYPHS`. Linked icons, pager markers and (since §56.2) an icon a sentence carries all become glyphs; a score mark that opens a resource cell stays a picture. **`analyze.md`:431 and the guide:111 disagree on the smiley** -- the guide is normative and the author confirmed it | cheap |
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
