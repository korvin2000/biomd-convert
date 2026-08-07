# OPEN — live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history — history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-08**, after the first refinement iteration (PROGRESS §21). Facts marked
*measured* were taken then; facts marked *recorded* are quoted and have not been re-measured.

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. Four mechanisms accepted in the first iteration — all
four rungs improved or held, one commit each, full before/after in every message.

**Current state, *measured* 2026-08-08 (PROGRESS §21):**

| rung | value |
|---|---|
| L0 | 405 tests, typecheck clean, 0 FAILED |
| L1 | **92.6 %** (was 90.3), clean share 9.1 % |
| L2 | 508 findings — **327 converter-defect** · 94 ambiguous · 87 reference-inconsistency, 90 classes |
| L3 | 149 findings, identity 0, deterministic |
| validator | 28 errors, all `table-header-empty` — see §3.2 |

That is the floor. Nothing accepted from here may regress it.

**Next mechanism: the alignment family** — `align.spurious` (12/8 docs), `retyped.paragraph-to-align`
(12/7), `align.missing` (9/6), `retyped.align-to-paragraph`. 33+ instances over 9 documents, and the
region/lane work they were entangled with has now settled, so they can finally be read together
rather than one at a time. PROGRESS §10.2 already recorded once that a spurious centre align was a
*symptom* of collapsed lanes upstream — check that first, because three lane defects just closed.

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

## 3. Questions for the user

### 3.1 A wrapped masthead: one `#` or two? *(carried from §20.6, unchanged)*

`h1-count` is a warning, so two `#` validates; the converter emits exactly one on all 22 and
`enforceSingleTitle` never fires. Producing the reference shape needs heading recovery to *recognise*
a two-line title, with the false friend that two `#` separated by content are two titles.
`new_blackmore` joins its two-part title into one heading while `new_bach` and `new_lagq2` split
theirs, so the discriminator must come from the **source**, not from the reference set.

### 3.2 `williams2`'s one-lane `::: columns` — *new, and the one open triage call*

The converter now flattens the page frame to linear flow on all three documents that have a
non-empty rail. `new_geyzel04`'s and `new_bach`'s references agree. `williams2`'s reference instead
keeps a `::: columns` containing a **single** `::: column` around the whole article — which
`BioMD-Reference.md` §2 forbids (`columns` requires ≥2 `column`). The sources are the same construct,
so no rule produces both.

Recorded as `reference-inconsistency` and **not** chased; it costs `williams2` 31 L2 findings that
are all the same fact. Confirm the reading, or say the wrapper is wanted and it becomes a rule
question instead. PROGRESS §21.5.

---

## 4. Open defect classes — *measured* 2026-08-08 over 22 documents

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 405 | `paragraph.containment` | 27 | 5 | 19 are `williams2` §3.2 and **not a target**; real remainder 8 |
| 288 | `align.spurious` | 12 | 8 | **next mechanism** |
| 252 | `retyped.paragraph-to-align` | 12 | 7 | same family |
| 165 | `retyped.paragraph-to-list` | 11 | 5 | blocked on a hook design (PROGRESS §15.2) |
| 162 | `align.missing` | 9 | 6 | same family |
| 120 | `image.spurious` | 8 | 5 | |
| 84 | `image.size.value` | 21 | 4 | a threshold in `media.ts`; sweep it, do not pick it |

Open **by decision**, not by oversight: `new_blackmore`'s 3 `column.missing`. Its picture-paired
grids are one row each, so the pairing gate's recurrence requirement excludes them; their evidence is
recurrence across *sibling grids on the page*, which the classifier cannot see. Dropping the
requirement admits the figure-over-caption false friend. The fix is a corpus-pass change and its own
mechanism.

Also carried: `image.src.value` (19, all `goya2` — mechanical, single-document) · `borislova`/
`jovicic` want a quote the recurrence gate declines (`MIN_SUBORDINATED_BLOCKS` is 2, each has 1) ·
`frame`'s `title:` property unused (one instance corpus-wide).

## 5. Instrument debt — what to distrust, in order

1. **The 0.5–0.95 `ambiguous` word-coverage corridor is set, not calibrated** — now 94 findings, the
   largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant behind
   the `containment` classes.
2. **The validator does not check `columns` ≥ 2 `column`**, which is a `BioMD-Reference.md` §2 MUST.
   Found while adjudicating §3.2; recorded, not fixed.
3. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides*.
4. **L3 pairs by rendered text, deliberately independent of L2.** A block rewritten past 0.65
   similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
5. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
6. **L4 is not built.** Do not report an L4 number.
