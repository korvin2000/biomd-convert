# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-10**, after the normalized references and `analyze-2.md` (PROGRESS §35).
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Open question for the author](#2-open-question-for-the-author----the-validator-disagrees-with-the-house-rule)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-10-over-22-documents)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. `c92c009` **normalized 11 references and added
`analyze/analyze-2.md`** -- an in-depth complaint record for `news`, `goya2`, `new_karta` and
`kiselev`, with new house rules stated as prose. Every figure quoted from PROGRESS §21-§34 predates
it. Re-baselined before attribution: the reference edit alone took L1 94.5 -> 94.6, L2 263 -> 257
findings / 135 -> 112 defect, L3 flat.

**Current state, *measured* 2026-08-10, after PROGRESS §35:**

| rung | value |
|---|---|
| L0 | **463 tests**, typecheck clean, 0 FAILED, conservation ok, clean share 13.6 %, `read()` warnings 0 |
| L1 | **96.4 %** |
| L2 | **167 findings -- 91 converter-defect** · 31 ambiguous · 45 reference-inconsistency · **4 critical** |
| L3 | **68**, identity 0, deterministic |
| validator | **27** errors, up from 13 -- **22 of them are one author ruling**, see §2 |

That is the floor. Nothing accepted from here may regress it.

> **Of the iteration's 21-defect fall, 14 were the instrument becoming truthful and 7 the conversion
> improving.** Never quote the drop without the split.

**Landed this iteration (PROGRESS §35):** a link column is headed `🔗` again, reversing §30.2 on the
author's newer ruling (§35.3) · a child `image`'s `position`/`size` is outside the profile, so its
absence is not a defect -- 12 of goya2's 19 were phantom (§35.4) · an asset outside the content roots
climbs one level, and all **565** relative targets now agree on both sides (§35.5) · a one-record
table is a table (§35.6) · two lines pushed in by the same amount are two lines, closing both
`paragraph.content` criticals (§35.7) · a column no row fills is spacing, 30 closed (§35.8).

**Next, in order.**
1. **`news`'s frame/align shape** -- 7 defects, the largest single unexamined cluster now, and the
   normalized reference restructured exactly this: obituary notices re-split between the frame and an
   inner `::: align`, and `title: ПОЗДРАВЛЯЕМ` replaced by a `##` heading inside the frame.
2. **`align` inside `column`** -- named by §35.10's revert. The produced side has **32**, the
   references **26**; the work is separating the 26 wanted (`goya2`, `kiselev`, `new_blackmore`) from
   the 6 unwanted (`new_karta`, `segovia1`). Would close `segovia1`'s 2 `retyped.align-to-paragraph`.
3. **`goya2`'s "Moscow Nights" `rowspan` lane** -- the author supplies the reading and a screenshot in
   `analyze-2.md`: a `rowspan="2"` text cell beside two images the browser stacks into the right half,
   written as `::: columns` with both images in one column. Understood, not built.

**Killed twice now: the word-less alignment rule.** §30.1 killed it and named its reopening condition
("only on the `columns` region being recovered first"); §33 met it, the rule was rebuilt and
re-measured, and it failed on a **different** falsifier -- `segovia1`'s recovered lanes want no
`::: align` inside them at all, so it went 2 -> 4 `retyped.align-to-paragraph` and L3 rose 68 -> 70.
Reverted whole. Do not rebuild it as a whole; the residue is candidate 2 above.

**Downgraded on measurement this iteration.** *"A uniformly indented run subordinate to a lead-in is a
list"* -- fires **21** times across the corpus and only 2 want a list; `borislova`'s sixteen movement
runs keep hard-break lines in their own reference. Only the colon-announced form was built.
*"Carry a container's right alignment into GFM column alignment"* -- would close `new_kolpakov`'s
3 `table.align` and recover `williams2`'s right-hug, but **1 of 21** reference tables uses column
alignment.

**Off the queue entirely:** `retyped.paragraph-to-lead` (author ruling §26.2) · `image.size.value`
(§25.4) · 7 of `break.missing`'s 10 (§25.3) · the long drawn separator and `new_karta`'s linked icon
(both `analyze-2.md` complaints, both already closed by §25.2/§29.3 and verified, PROGRESS §35.11).

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) -- run
> `npx playwright install chromium` or every document reports "no output produced". And this repo
> carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false` unblocks it.
> **`corpus scan` is still required after a fresh clone.**

---

## 2. Open question for the author -- the validator disagrees with the house rule

`analyze-2.md` asks for `| | 🔗 |`: a synthesized header names link columns `&#128279;` and leaves
every other column, **including the record's own title column**, empty. That is now implemented and
16 of the corpus's 21 synthesized headers agree with it.

`BioMD-Reference.md` §1 says every GFM table column MUST have a header, and the converter's own §3.8
check enforces it. So **22 of the 27 validator errors are now `table-header-empty`, one per empty
header cell** -- the direct consequence of the ruling, not a converter defect. The references would
fail identically if they went through the conversion path (`validate <file>` reports 0 only because
it resolves a laxer profile).

This cannot be closed by changing the converter without disobeying one of the two. **Do not "fix" it
by re-inventing a title label** -- that is exactly what §30.2 did and what `c92c009` reverted.

One more inconsistency in the same document, decided for the references: `analyze-2.md` writes
`&#128279;` (🔗) for a link column at line 261 and `&#9654;` (▶) at line 375 for `kiselev`'s. All 16
normalized references use 🔗, so 🔗 was implemented; ▶ remains the *icon* glyph.

## 3. Answered by the reference author -- do not re-investigate

1. **A recovered centred section label gets a bare `##`; the centring is dropped.** *Ruled
   2026-08-08.* The `::: align` wrapper is for a **split headline** and nothing else. PROGRESS §24.5.
2. **`new_blackmore`'s masthead split point** -- settled deterministically in the browser; the source
   draws two line boxes at 26.7 px and 16 px and the reference moves one word across the boundary.
   Reference-inconsistency. PROGRESS §24.5.
3. **`::: lead` is aesthetic, not structural, and the ruling is symmetric.** *Ruled 2026-08-08.*
   A `lead` discrepancy in **either** direction is visual, not a fidelity defect. The measurements
   ruling out typography, length and position are in PROGRESS §26.3 -- do not re-derive them.
4. **A link column is headed `🔗`; the title column is left empty.** *Ruled 2026-08-10*, reversing
   the `/new_rules.md` vocabulary of §30.2. Implemented; see §2 for its one consequence.
5. **A relative asset outside `articles|music|photo|use` climbs one level** (`/../`). *Ruled
   2026-08-10.* Implemented; segment containment, not a prefix test. PROGRESS §35.5.
6. **A column no row fills is dropped**, and **a one-row table is still a table.** *Ruled
   2026-08-10.* Both implemented. PROGRESS §35.6, §35.8.

## 4. Open defect classes -- *measured* 2026-08-10 over 22 documents

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 216 | `retyped.paragraph-to-align` | 9 | 9 | 8 | **two mechanisms wearing one name.** 4 are a centred glyph pager (`new_karta`, `new_lendle2`, `new_rechin4`, `tarrega`) and are the rule killed twice, §35.10 -- do not rebuild it whole. The other 5 (`new_lagq2`, `news` x2, `pavlov_azancheev`, `segovia`) are a centred prose block and have never been probed |
| 60 | `retyped.paragraph-to-list` | 5 | 5 | 4 | includes `kiselev`'s "Том I/Том II…" volume list, §15.2's named third mechanism. §35.7 built the indent machinery; the font-size half is not built |
| 30 | `retyped.align-to-paragraph` | 5 | 5 | 2 | `segovia1`'s 2 are candidate 2 in §1 -- `align` inside `column` |
| 24 | `paragraph.spurious.in-paragraph` | 4 | 4 | 2 | `news` x2, unexamined |
| 16 | `paragraph.content.edited` | 11 | 2 | 8 | mostly reference-inconsistency |
| 15 | `emphasis.span` | 18 | 3 | 5 | downgraded -- verdicts flip on identical evidence across documents. Probed for a URL-underscore artefact and cleared (2026-08-09) |
| 15 | `paragraph.hyphenation.mixed` | 5 | 5 | 3 | |
| -- | ~~`table.header.cell`~~ | 40 -> **7** | 0 | 3 | closed by §35.3; the 7 are `tarrega` x4, `kiselev` x2, `segovia` x1 -- three files `c92c009` did not normalize |
| -- | ~~`image.src.value`~~ | 19 -> **0** | 0 | 0 | closed by §35.5 |
| -- | ~~`image.position.missing` / `image.size.missing`~~ | 14 -> 0 defect | 0 | 2 | reclassified `.off-profile` by §35.4 -- the spec forbids these on a child image |
| -- | ~~`table.geometry.cols`~~, ~~`table.cell.content.edited`~~ | 30 -> 0 | 0 | 0 | closed by §35.8 |

Per document, defect count: `segovia` 10 · `new_rechin4` 9 · `goya2` 7 · `new_lendle2` 7 · `news` 7 ·
`new_kolpakov` 5 · `pavlov_azancheev` 5 · `tarrega` 5 · `new_blackmore` 4 · `news_2007` 4 ·
`segovia1` 4 · `williams2` 4 · rest ≤ 3. `new_bach` and `new_dyens` are at **0**.

Also carried: `new_kolpakov`'s 3 `table.align` (column alignment, 1 of 21 references uses it) ·
`williams2`'s 3 new findings are the stated §35.6 tradeoff, not a regression to fix ·
`frame`'s `title:` property is now *unused by the references too* -- `news` replaced its one use with
a `##` heading inside the frame.

## 5. Instrument debt -- what to distrust, in order

0. **`link.label.content.empty` fires on labels that are not empty.** Reports `critical` when the
   produced label is `▶` and the reference's is a raw route -- 2 instances, `barrios` and `tarrega`.
   The class name states a condition the finding does not meet. Fix the class, not the converter.
1. **`src/eval/blocks.ts` has no setext case and `src/eval/facts.ts` does.** The converter no longer
   emits one, but the blind spot would misread any that appeared.
2. **The 0.5-0.95 `ambiguous` word-coverage corridor is set, not calibrated**, and so is the **0.65**
   reconciliation constant behind the `containment` classes.
3. **The validator does not check `columns` ≥ 2 `column`**, a `BioMD-Reference.md` §2 MUST.
4. **L3 reports `layout.align.mismatch` on blocks with no text.**
5. **L3's renderer is a model of the target, not the target** -- where the real renderer differs
   undocumented, L3 is wrong *in the same direction on both sides*.
6. **L3 pairs by rendered text.** A block rewritten past 0.65 similarity is unpaired, and unpaired
   blocks yield no L3 finding. This bit in §35.6: L3 said nothing about `williams2`'s new table and
   the browser had to be measured directly.
7. **One viewport (1024 px).** Nothing asserts a finding is stable across widths.
8. **No mutation harness.** `CLAUDE.md` §5 asks for one; it has never been built.
9. **L4 is not built.** Do not report an L4 number.
