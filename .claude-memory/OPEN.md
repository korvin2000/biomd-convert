# OPEN — live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history — history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-08**, after the second refinement iteration (PROGRESS §24). Facts marked
*measured* were taken then; facts marked *recorded* are quoted and have not been re-measured.

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. **Four mechanisms accepted this iteration** (PROGRESS
§24), one commit each, all four rungs improved or held on every one, no document regressed.

**Current state, *measured* 2026-08-08 (PROGRESS §24):**

| rung | value |
|---|---|
| L0 | **418 tests**, typecheck clean, 0 FAILED |
| L1 | **92.9 %**, clean share 13.6 % |
| L2 | **440 findings — 258 converter-defect** · 95 ambiguous · 87 reference-inconsistency |
| L3 | **97 findings** (10 critical, was 20), identity 0, deterministic |
| validator | 28 errors, all `table-header-empty` — PROGRESS §21.4 |

That is the floor. Nothing accepted from here may regress it.

> **`corpus scan` is required after a fresh clone.** §24.4 changed the chrome fingerprint, so a
> cached `bench/corpus/corpus-profile.json` from before that commit is wrong and `news` regresses.

**Next: `align.spurious`** — 8 instances, 7 documents, now the top-ranked class. §22.3's advice to
read the alignment family only after the region and table families settle has been honoured for
three iterations; the region work is done and the class is still there, so the deferral has expired.
Three of the eight are `WMA` / `(1,7 Mb)` cells and two are `• Архив новостей •`.

Then, in order: `image.spurious` (7, 4 docs) · `image.size.value` (21, 4 docs, 16 of them `goya2` —
a threshold in `media.ts`, sweep it, do not pick it) · `break.missing` (10, **6 docs**, the widest
class in the ledger — the entry-separator family) · the mini-image → glyph map (§2.3 below).

`retyped.paragraph-to-list` (11, 5 docs) stays blocked on the hook design of PROGRESS §15.2.

---

## 2. What this iteration settled

### 2.1 The wrapped masthead — closed, four documents, one rule

Containment × typography, all four cells attested (PROGRESS §24.1). Separate blocks + equal
prominence ⇒ consecutive `#` inside the box's `::: align`; one block + `<br>` + equal prominence ⇒
one joined `#`, because the break is a hand-wrap to fit a 458 px cell; one block + `<br>` + unequal
⇒ `#` + `##`. `enforceSingleTitle` now treats adjacent `#` lines as one title.

### 2.2 Two instruments were lying — both fixed, both cheap

The chrome fingerprint hashed `width` verbatim, so `news`'s `width="760px"` frame matched no
recurring structure and shipped as content (L3 106 → 93 on that alone). `followsImage` read any
block *containing* an image as a photograph awaiting a caption, so a dated newspaper banner cost two
`new_blackmore` article titles their heading. Details in §24.4 — **check the instrument before the
rule** is now attested three times in this campaign.

### 2.3 Still open, unchanged: mini-image → glyph

`mini_images_to_md_guide.md` defines a 29-entry known-icon map; `src/` implements none of it. The
references use numeric character references in 10 of 22 documents. `glyphs.ts` now holds
`LINK_GLYPH` and `RULE_GLYPHS`, so the map has a home and two neighbours. One divergence to settle:
the guide maps *next* to `&#9654;` (▶) while `new_bach` uses `&#9658;` (►).

---

## 3. Questions for the reference author — batched, not yet asked

Both affect a reusable rule and several documents, so `CLAUDE.md` §4 says ask rather than decide.

1. **Does a recovered centred section label keep its `::: align`?** One source shape,
   `<p align="center">SHORT LABEL</p>` above its own body, is written three ways across two
   references: `new_bach` gives five of them a bare `##` and the sixth an `::: align` with no
   heading at all; `goya2` gives `ДРУГИЕ АЛЬБОМЫ` an `::: align` **containing** the `##`. The
   converter emits a bare `##` for all of them. Same construct as the split headline, so the answer
   is a rule. PROGRESS §24.5.
2. **`new_blackmore`'s masthead split point.** The reference writes `# Ричи Блэкмор Ritchie` /
   `## Blackmore & Blackmore's Night`. Measured in the browser, the source renders `Ричи Блэкмор` at
   26.7 px and `Ritchie Blackmore & Blackmore's Night` at 16 px as two line boxes — the reference
   moves one word across a boundary the source draws twice. Recorded as reference-inconsistency;
   two minor findings remain. PROGRESS §24.5.

## 4. Open defect classes — *measured* 2026-08-08 over 22 documents

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 168 | `align.spurious` | 8 | 7 | next |
| 165 | `retyped.paragraph-to-list` | 11 | 5 | blocked on a hook design (PROGRESS §15.2); 7 are `kiselev` |
| 90 | `retyped.paragraph-to-align` | 6 | 5 | mostly inside `frame`/`columns` |
| 84 | `image.size.value` | 21 | 4 | 16 are `goya2`; a threshold in `media.ts` |
| 84 | `align.missing` | 7 | 4 | one is question 1 above |
| 84 | `image.spurious` | 7 | 4 | |
| 63 | `paragraph.containment` | 7 | 3 | |
| 60 | `break.missing` | 10 | **6** | widest in the ledger; the entry-separator family |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |
| 36 | `retyped.paragraph-to-heading2` | 4 | 3 | was 6/4 before §24.4 |

Also carried: `borislova`/`jovicic` want a quote the recurrence gate declines
(`MIN_SUBORDINATED_BLOCKS` is 2, each has 1) · `frame`'s `title:` property unused (one instance
corpus-wide) · `new_kolpakov` is the weakest document at L1 67.9, and PROGRESS §22.2 explains why
that is a ceiling rather than an open defect.

## 5. Instrument debt — what to distrust, in order

1. **The 0.5–0.95 `ambiguous` word-coverage corridor is set, not calibrated** — 95 findings, the
   largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant
   behind the `containment` classes.
2. **The validator does not check `columns` ≥ 2 `column`**, which is a `BioMD-Reference.md` §2 MUST.
   Found while adjudicating the `williams2` wrapper (PROGRESS §21.5); recorded, not fixed.
3. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides*.
4. **L3 pairs by rendered text, deliberately independent of L2.** A block rewritten past 0.65
   similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
5. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
6. **No mutation harness.** `CLAUDE.md` §5 asks for one and it has never been built; §24's rules
   carry a renamed-class / permuted-attribute contract each instead.
7. **L4 is not built.** Do not report an L4 number.
