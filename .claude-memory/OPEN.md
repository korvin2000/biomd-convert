# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-10**, after the author rulings of PROGRESS §36 (which follow §35).
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
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

**The authority order changed in §36.1** -- `analyze/analyze.md` and `analyze/analyze-2.md` are now
rung 1, the `fixtures/` pairs rung 2, and `BioMD-Reference.md` rung 3 and **amendable**.

**Current state, *measured* 2026-08-10, after PROGRESS §36:**

| rung | value |
|---|---|
| L0 | **463 tests**, typecheck clean, 0 FAILED, conservation ok, clean share 13.6 %, `read()` warnings 0 |
| L1 | **96.5 %** |
| L2 | **165 findings -- 89 converter-defect** · 31 ambiguous · 45 reference-inconsistency · **4 critical** |
| L3 | **68**, identity 0, deterministic |
| validator | **5** errors -- was 27; §35.9 closed by amending the spec, see §2 |

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

## 2. Closed -- the spec was amended, not the converter

**The authority order was corrected (PROGRESS §36.1).** `analyze/analyze.md` + `analyze/analyze-2.md`
are rung 1, the `fixtures/` pairs rung 2, `BioMD-Reference.md` rung 3 and **amendable**: where one of
its rules contradicts them, the rule is wrong and is corrected *there*, never worked around in the
converter. Invariant 1 gains one exception -- an author correction stated explicitly and by name --
and `analyze-2.md` is now routed into L4 calibration, the L5 mapping and the stop condition.

**§35.9 is closed that way.** §1 (Tables) demanded a header for every *column*, which `| | 🔗 |`
cannot satisfy: the leading column carries each record's name and has no label the source ever gave
it. It now requires a header **row**, and states that a header **cell** MAY be empty and MUST NOT be
reported. `validate.ts`'s `table-header-empty` rule is removed. **Validator errors 27 -> 5.**

> **Do not "fix" a header count by re-inventing a title label.** That is what §30.2 did and what
> `c92c009` reverted, and the count has now moved for this reason three times with no conversion
> change behind any of them (§21.4: 28 · §30.2: 13 · §35.3: 27 · §36.2: 5).

`analyze-2.md`'s own `&#9654;`/`&#128279;` inconsistency at lines 373 and 375 was corrected by the
author -- 🔗 was meant throughout, ▶ remains the *icon* glyph. No code changed; §35.3 had already
implemented 🔗 on the strength of the 16 normalized references.

## 2b. Open, needs the author: one-record table vs. `::: align`

`williams2`'s reference was corrected (`2228baf`) to **one** `::: align position: right` holding the
title and the MP3 link, exactly as `analyze.md` item 9 asks. That confirms §35.6's diagnosis -- the
record must stay whole -- and rejects its *representation* for that one document. Cost: exactly
**1** converter-defect, `retyped.table-to-align` at `williams2:/align[26]`.

The split is now `williams2` -> `::: align`, `borislova` / `new_kolpakov` / `new_karta` x2 -> table,
and the author knows all four. **Four sessions have found no DOM or geometric signal.** Ruled out:
title length · column count · width ratio · class names · blockquote depth · container alignment
(`right` for `williams2`, `borislova` *and* `new_kolpakov`) · table width · bracketed size metadata ·
whether the document holds other tables · rendered geometry (`williams2` 87 % / `borislova` 85 %
title share, both a narrow shrink-to-fit line) · and, re-tested this session because a corrected
reference is new measurement, *"the title recurs in the page's prose"* -- `new_kolpakov`'s occurs
**once**, like `williams2`'s, and wants a table.

Probable reason they diverge: the two human complaints are about **different defects on one shape**.
`analyze.md:590` on `borislova` reports the missing **table**; item 9 on `williams2` reports the
missing **alignment**. Neither rules on the other's subject.

Keeping the table everywhere costs 1 defect on 1 document; reverting to `align` everywhere costs 4 on
3 and brings the record-shattering back. Current state is the better of the two. A rule satisfying
both needs either a signal the author can name, or the `table.classify` hook with
`isSingleRecordRow` as its deterministic acceptance check.

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
