# OPEN — live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history — history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-08**, after the first refinement iteration (PROGRESS §21–§23). Facts marked
*measured* were taken then; facts marked *recorded* are quoted and have not been re-measured.

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. **Five mechanisms accepted** — all four rungs improved or
held on every one, one commit each, full before/after in every message — then two author
adjudications that corrected two references and forced a re-baseline (PROGRESS §23).

**Current state, *measured* 2026-08-08 (PROGRESS §23):**

| rung | value |
|---|---|
| L0 | 406 tests, typecheck clean, 0 FAILED |
| L1 | **92.7 %** (was 90.3), clean share 13.6 % (was 9.1) |
| L2 | 453 findings — **271 converter-defect** (was 580) · 95 ambiguous · 87 reference-inconsistency |
| L3 | **110** findings (was 287), identity 0, deterministic |
| validator | 28 errors (was 23), all `table-header-empty` — PROGRESS §21.4 |

That is the floor. Nothing accepted from here may regress it.

**Next mechanism: the wrapped masthead** (PROGRESS §23.2). No longer a reference disagreement — the
author ruled, and all three documents are converter defects. Two shapes, one discriminator:

- two masthead lines of the **same** typographic prominence are *one headline split*, and become two
  consecutive `# ` lines inside the `::: align` (`new_bach`, `new_lagq2`). Never `#` + `##` — that
  would assert a hierarchy the headline does not have;
- two lines of **different** prominence are a *title and its subtitle*, and become `#` + `##`
  (`new_blackmore`).

False friend, already named in §20.6: two headings separated by content are two headings, not one
wrapped one — the lines must be adjacent inside the same masthead region. The author rates this
**not critical, a visualisation matter**, so it is the right size for one iteration rather than a
priority.

**Do not open the alignment family as a mechanism.** A third of it closed as a *side effect* of the
region work in §21.2 and §22.1 with no alignment rule touched, and 3 of `align.spurious`'s remaining
9 are the dead class of §22.2. Re-measure it after the next region or table change, never before.

After that, the ledger is thin enough that a **document-shaped** iteration beats a class-shaped one:
`news` (49 converter-defects) and `goya2` (43) are the two biggest and both are long-known
regression-corpus documents.

---

## 2. What the first iteration settled

### 2.1 The page frame — closed, three documents, two mechanisms

All 22 documents draw the same template: a one-row three-column band measured `[116, 529, 115]` in a
760 px row — empty margin, article, decorated rail. Nineteen have an empty rail and were always
right. The three that were not are fixed by (a) measuring lane occupancy on *lowered* content rather
than on the source grid, and (b) `pageRailColumns`, which rejects a flank pair by geometry **and
position** (middle column widest, both outer far narrower). Details in PROGRESS §21.2.

### 2.2 `new_lagq2` closed §19.4 — and did **not** move the DATA contract

The CATALOG gate was wrong, not the routing. `picturePairedRows` replaces the near-equal-width
requirement with the relation it was reaching for: every content row pairs a bare picture with worded
matter. `recovery.test.ts`'s "leaves a DATA verdict on the flow path" contract is untouched and
§18.3's killed hypothesis stays killed. PROGRESS §21.3.

### 2.3 `new_karta`/`new_dyens` closed §17.5 Q1 — supply the header, never the noun

A table whose columns have no recurring label is no longer abandoned. An unnamed **links** column is
headed with U+1F517; the **subject** column stays empty, because `Название`/`Композиция`/`Формат`
appear in no source and naming one would be §16.3 invention. `src/convert-core/glyphs.ts` is the new
lexical data file and is also the home the unbuilt icon map needs. PROGRESS §21.4.

### 2.4 Still open, unchanged: mini-image → glyph

`mini_images_to_md_guide.md` defines a 29-entry known-icon map; `src/` implements none of it. The
references use numeric character references in 10 of 22 documents. `glyphs.ts` now exists to hold the
map. One divergence to settle: the guide maps *next* to `&#9654;` (▶) while `new_bach` uses
`&#9658;` (►).

---

## 3. Answered by the reference author — do not re-investigate

Both questions this iteration raised were put to the author and both were ruled on. The rulings
changed two fixtures; the numbers in §1 are already re-baselined against them (PROGRESS §23).

- **`williams2`'s one-lane `::: columns`** was an *accidental reference mistake*, not a layout
  choice. The author removed it. The flattened, spec-compliant shape is authoritative, and the three
  page-frame documents now agree with each other. `williams2` 35 → 3 converter-defects.
- **The wrapped masthead** is two rules, not a reference disagreement — see §1. `new_blackmore`'s
  reference already carried the two-level correction; OPEN's old §3.1 table said otherwise and was
  simply stale.

**Both were index errors or reference errors, not converter questions.** Read `fixtures/out/` before
recording a reference as inconsistent — a summary of a fixture is not a fixture.

## 4. Open defect classes — *measured* 2026-08-08 over 22 documents

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 216 | `align.spurious` | 9 | 8 | 3 are the dead class of PROGRESS §22.2 |
| 165 | `retyped.paragraph-to-list` | 11 | 5 | blocked on a hook design (PROGRESS §15.2); 7 are `kiselev` |
| 120 | `align.missing` | 8 | 5 | |
| 120 | `image.spurious` | 8 | 5 | |
| 105 | `retyped.paragraph-to-align` | 7 | 5 | |
| 96 | `paragraph.containment` | 8 | 4 | was 141 and ranked first; `williams2`'s 19 are gone with the reference correction |
| 84 | `image.size.value` | 21 | 4 | 16 are `goya2`; a threshold in `media.ts`, sweep it, do not pick it |

Also carried: `image.src.value` (19, all `goya2` — mechanical, single-document) · `borislova`/
`jovicic` want a quote the recurrence gate declines (`MIN_SUBORDINATED_BLOCKS` is 2, each has 1) ·
`frame`'s `title:` property unused (one instance corpus-wide).

`new_kolpakov` is the weakest document at L1 67.9 with `tables=0/1`, and PROGRESS §22.2 explains why
that is a ceiling rather than an open defect: the one-row table it wants is the shape the references
split 2–1 on.

## 5. Instrument debt — what to distrust, in order

1. **The 0.5–0.95 `ambiguous` word-coverage corridor is set, not calibrated** — now 94 findings, the
   largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant behind
   the `containment` classes.
2. **The validator does not check `columns` ≥ 2 `column`**, which is a `BioMD-Reference.md` §2 MUST.
   Found while adjudicating the `williams2` wrapper (PROGRESS §21.5); recorded, not fixed. Still
   worth having: the mistake it would have caught was in a hand-written reference.
3. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides*.
4. **L3 pairs by rendered text, deliberately independent of L2.** A block rewritten past 0.65
   similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
5. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
6. **L4 is not built.** Do not report an L4 number.
