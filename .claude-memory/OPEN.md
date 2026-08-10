# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-10**, after PROGRESS §37 (which follows §36).
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [2b. Ruled -- one-record table vs. `::: align`](#2b-ruled----one-record-table-vs--align-the-table-stays)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-10-after-37)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. §37 took the whole standing queue and closed **five**
mechanisms; the authority order and the §36 rulings are unchanged.

**Current state, *measured* 2026-08-10, after PROGRESS §37:**

| rung | value |
|---|---|
| L0 | **476 tests**, typecheck clean, 0 FAILED, conservation ok, `read()` warnings 0 |
| L1 | **96.6 %** |
| L2 | **157 findings -- 83 converter-defect** · 28 ambiguous · 46 reference-inconsistency · **4 critical** |
| L3 | **52**, identity 0, deterministic |
| validator | **0 errors on every produced document**; 4 remain on the *references* (`fence-unbalanced`) |

That is the floor. Nothing accepted from here may regress it.

**Landed in §37, one commit each.** A rule drawn between two aligned lines divides them (`730614a`,
`news`) · a pager's lane is what places its link (`523dea8`, `segovia1`, and it closes §33.4's
residue on the *region*-level signal §33.2 built) · a `rowspan` holds its rows in one region
(`be5bdca`, `goya2`'s Moscow lane, now byte-identical to its reference) · a link label is one line
(`96e5673`, `goya2` + `new_kolpakov`) · a numbered run the source split in two is one run
(`9b88d67`, `goya2`, and it took L3 61 -> 52 on its own).

**Next, in order. Nothing here is a queue -- probe before committing (SKILL §6).**
1. **`segovia` (10) and `new_rechin4` (9)** are the two largest per-document counts and **neither has
   been probed this campaign**. Adjudicate two or three instances before surveying either.
2. **`new_karta`'s one-record row** -- one `::: columns` where the reference writes the two-column
   link table. §35.6 built exactly this mechanism; this instance escapes it. Also the cause of
   `new_karta`'s one spurious `align` inside a `column`, which is a shadow, not an align defect.
3. **`new_kolpakov`'s href carries markup** -- the source writes `<a href="<B>http://...</B>">` and
   the produced target keeps the tags where the reference has the clean URL. Small, general,
   4 instances on one document. Spotted while fixing §37.5, not built.
4. **`analyze-2.md`'s "ДРУГИЕ АЛЬБОМЫ" request** -- `::: images` with `columns: 2` for `goya2`'s
   two-up album plates. `::: images` is already emitted; the `columns:` property is not. **Check the
   reference first** -- it may not carry it either.

**Do not re-take these; §37 settled them.**
- `news`'s frame/align cluster is **done**: one mechanism (the divider) fixed, and 3 of the remaining
  6 are ceilings -- 2 are the `::: lead` (§26.2, aesthetic in both directions) and 1 is the reference
  centring the Paco de Lucía obituary's prose, which **computes `justify` in the browser** exactly
  like the two obituaries the same reference leaves unwrapped.
- `align` inside `column` is **done**: `segovia1`'s 2 fixed; `goya2`'s 3 are an author-declared
  alternative (`analyze-2.md`, and the `Vol. 1`/`Vol. 2` sources are structurally identical while the
  reference writes them differently); `new_karta`'s 1 is item 2 above wearing another name.
- `goya2`'s Moscow `rowspan` lane is **done** and byte-identical.

**Killed this iteration: merging adjacent same-position `::: align` siblings.** Four references keep
them (`goya2` Vol. 1, `kiselev`, `new_geyzel04`, `new_karta`, `williams2`), one merges (`goya2`
Vol. 2/1988/1999) and contradicts itself on identical source. §36.5's tie-break. PROGRESS §37.9.

**Still killed twice: the word-less alignment rule.** §30.1 and §35.10, two different falsifiers.
Its residue was candidate `align`-inside-`column`, which §37.3 has now closed.

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

## 2b. RULED -- one-record table vs. `::: align`: the table stays

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

**Ruled 2026-08-10: keep the table; do not re-open this.** The author confirmed the general
principle -- *choose the rules that leave the rule system least contradictory, therefore most
generalizable, and that cost the metrics least, in that order.* Keeping the table costs 1 defect on
1 document; reverting to `align` costs 4 on 3 and brings the record-shattering back. `williams2`'s
`retyped.table-to-align` is therefore a **known, named divergence**, not a target: it is the minority
reading of a shape three other documents settle the other way, and no special case exists that only
one document could ever justify.

Reopens only if a second `::: align` instance appears, which would make the split 2-3 rather than
1-3 and put a real distinction back on the table. Until then the honest alternative remains the
`table.classify` hook with `isSingleRecordRow` as its deterministic acceptance check -- not worth 1
finding.

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
7. **The analysis documents outrank `BioMD-Reference.md`, which is amendable.** *Ruled 2026-08-10.*
   A spec rule that contradicts them is corrected in the spec, never worked around in the converter.
   `CLAUDE.md` authority ladder rewritten; §35.9 closed this way. PROGRESS §36.1, §36.2.
8. **When evidence runs out, take the reading that leaves the rule system least contradictory** --
   fewest inconsistencies, therefore most generalizable, and least metric damage, in that order.
   *Ruled 2026-08-10.* Now the stated tie-break for verdict 4 in `CLAUDE.md`. A minority reference
   reading is recorded as a named divergence, never patched into a one-document special case.
   PROGRESS §36.5; the worked example is §2b above.

## 4. Open defect classes -- *measured* 2026-08-10 after §37

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 192 | `retyped.paragraph-to-align` | 8 | 8 | 8 | **two mechanisms wearing one name.** 4 are a centred glyph pager (`new_karta`, `new_lendle2`, `new_rechin4`, `tarrega`) and are the rule killed twice, §35.10 -- do not rebuild it whole. Of the other 4 (`new_lagq2`, `news`, `pavlov_azancheev`, `segovia`), **`news`'s is now adjudicated a ceiling** (§37.8, the browser says `justify`); the remaining 3 have never been probed |
| 60 | `retyped.paragraph-to-list` | 5 | 5 | 4 | includes `kiselev`'s "Том I/Том II…" volume list, §15.2's named third mechanism. §35.7 built the indent machinery; the font-size half is not built |
| 24 | `emphasis.span` | 19 | 4 | 6 | downgraded -- verdicts flip on identical evidence across documents. Probed for a URL-underscore artefact and cleared (2026-08-09) |
| 24 | `paragraph.content.edited` | 12 | 3 | 8 | mostly reference-inconsistency |
| 18 | `paragraph.spurious.in-paragraph` | 3 | 3 | 2 | one of `news`'s two is the `::: lead` shadow (§26.2, off the queue) |
| 15 | `paragraph.hyphenation.mixed` | 5 | 5 | 3 | |
| 12 | `frame.moved` · `heading.missing.caption-echo` · `image.moved` · `image.position.value` · `paragraph.missing.in-paragraph` · `retyped.list-to-paragraph` · `retyped.paragraph-to-heading2` | 2 each | 2 | 2 | the tail: seven classes at 2 instances on 2 documents each. None probed |
| -- | ~~`retyped.align-to-paragraph`~~ | 5 -> **3** | 3 | 1 | `segovia1`'s 2 closed by §37.3; the 3 left are `goya2`'s author-declared alternative (§37.8) |
| -- | ~~`break.containment`~~, ~~`image.containment`~~, ~~`list.item.missing`~~, ~~`paragraph.spurious.in-list`~~ | -> **0** | 0 | 0 | closed by §37.2, §37.4, §37.6 |
| -- | ~~`link.label.content.edited`~~, ~~`list.item.content.edited`~~ | -> **0** | 0 | 0 | closed by §37.5 |

Per document, converter-defect: `segovia` 10 · `new_rechin4` 9 · `new_lendle2` 7 · `news` 6 ·
`new_kolpakov` 5 · `pavlov_azancheev` 5 · `tarrega` 5 · `goya2` 4 · `new_blackmore` 4 · `news_2007` 4 ·
rest ≤ 3. `new_bach` and `new_dyens` are at **0**.

Also carried: `new_kolpakov`'s 3 `table.align` (column alignment, 1 of 21 references uses it) ·
`williams2`'s `retyped.table-to-align` is the §36.5 named divergence, not a target ·
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
6b. **`layout.order.mismatch` can name a node whose own neighbourhood is exact.** Ranks are compared
   across the two *whole* documents, so an unrelated divergence elsewhere shifts them. §37.4 closed
   two majors at `goya2`'s second Moscow cover and opened one **critical** there -- on a region that
   is now byte-identical on both sides. It is the largest L3 class at 18. Distrust before working.
7. **One viewport (1024 px).** Nothing asserts a finding is stable across widths.
8. **No mutation harness.** `CLAUDE.md` §5 asks for one; it has never been built.
9. **L4 is not built.** Do not report an L4 number.
