# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-10**, after PROGRESS §39 (which follows §38).
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-10-after-39)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. `1214860` added **`analyze/analyze-3.md`** (337 lines,
`snapshot_23`-`27`) *and normalized eleven references in the same commit*, so **every number in
PROGRESS §21-§38 predates the current corpus** (PROGRESS §39.1). §39 re-baselined first, then landed
four mechanisms, killed three hypotheses on measurement, and recorded six author rulings.

**Current state, *measured* 2026-08-10, after PROGRESS §39:**

| rung | value |
|---|---|
| L0 | **502 tests**, typecheck clean, 0 FAILED, conservation ok, `read()` warnings 0 |
| L1 | **98.4 %** |
| L2 | **134 findings -- 73 converter-defect** · 18 ambiguous · 43 reference-inconsistency · 4 critical |
| L3 | **47**, identity 0, deterministic |
| validator | **0 errors on every produced document** |

That is the floor. Nothing accepted from here may regress it.

> **No converter-defect is critical.** Three of the four criticals are `link.label.content.empty` on
> the two references the normalization did not reach; the fourth is the `blocks.ts` artefact §5.0b
> records. Quote that split, or the number reads as four open defects.

**Landed in §39, one commit each.** A hyphen inside an identifier is not a wrap (`68275ab`, and the
only thing `analyze-3.md` calls critical) · a dot leader is the column it was drawing (`260698c`,
`tarrega` 87.4 -> 96.7) · one block is not the mass of text around it (`ef125e6`, the `proseAlign`
baseline, L3 49 -> 46) · a hairline round a lone cell is a box, not a grid (`1deca7e`, both frames
`analyze-3.md` asks for).

**The normalization settled three standing items by itself, with no code change** (PROGRESS §39.1):
`news`'s frame/align ceiling (the reference dropped the align) · `williams2`'s `retyped.table-to-align`
(the reference became the table, so §36.5's named divergence **no longer exists**) · most of
`link.label.content.empty` (`▶`/`◀` are now written in the references).

**Next, in order. Probe before committing (SKILL §6).**
1. **`new_geyzel04`'s four headings** -- four large bold centred titles; the converter makes none of
   them a heading and binds one to the picture above it as a caption (`snapshot_24`). The author asks
   for consistency across all four and says the caption misattribution needs a rule keyed on distance
   from the image and type size. 3 converter-defects. PROGRESS §39.10.
2. **The image bound one block too late**, `williams2` and `tarrega`. Same direction, same distance,
   two documents -- a *rule* finding, not two instances. `snapshot_27` is the evidence.
3. **De-hyphenation** -- the root cause is now measured (PROGRESS §39.8): hyphenopoly is **not
   installed**, so cascade rule 6 never fires and every wrap falls to rule 7's PRESERVE; and even
   installed it cannot JOIN without `options.dictionary`, which `pipeline.ts` never supplies. There
   is also a scan gap -- the pattern consumes the right fragment, so `Информационно-аналити-ческого`
   is only ever decided once. The first move is a decision about the oracle dependency, not more
   probing.
4. **`pavlov_azancheev`'s two-line headline** -- a real defect with a known shape and a known false
   friend, but **two attempts were reverted on measurement** (PROGRESS §39.6). Read that before
   trying again: the fix belongs where `data-biomd-heading` is *set*, the weight relation alone is
   not the discriminator, and the test has to be page-level recurrence of the shape.
5. **`new_karta`'s trailing `[▶]` wants centring** (`align.missing`, 1) and **`new_kolpakov`'s
   `::: signature`** (1 of 22 references uses it; never emitted).

**No open question for the author.** §38's one conflict -- `segovia`'s right-aligned quote, `>` in
`analyze.md` and italic in the corrected reference -- is **answered** by `analyze-3.md`'s ruling 5 in
§3 below: both readings are correct, so the reference's stands.

**Do not re-take these; §37-§39 settled them.** `news`'s frame/align cluster · `align` inside
`column` · `goya2`'s Moscow `rowspan` lane · `new_kolpakov`'s broken href and its footer ·
`new_rechin4`'s pager · `segovia`'s bulleted "см. также" and its `<ol>` quotation · `tarrega`'s
dot-leader list · `new_lagq2`'s centred tail · `segovia1`'s and `new_karta`'s notices ·
`new_karta`'s one-record `::: columns` (**ruled equally correct**, §3.9).

**Killed in §37-§39** -- reopen on new measurement only:
merging adjacent same-position `::: align` siblings (§37.9; `new_lagq2` is the document that merges,
and it is still the minority) · hoisting *every* edge break out of a link label without the
doubled-break guard (§38.3) · source containment as the guard for a nav title (§38.4) ·
**right-aligned columns for a narrow table in a right-aligned container** (§39.6.1) ·
**emphasis from a CSS class's `font-style`** (§39.6.2) · **two forms of the `pavlov` heading fix**
(§39.6.3).

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) -- run
> `npx playwright install chromium` or every document reports "no output produced". And this repo
> carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false` unblocks it.
> **`corpus scan` is still required after a fresh clone** -- and PROGRESS §39.5 now depends on it:
> without the profile the masthead banner survives and every page gains a spurious frame.

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

## 2b. SUPERSEDED -- one-record table vs. `::: align`: the references now agree

`1214860` rewrote `williams2`'s single-record `::: align position: right` as the two-column table,
which was the **last** `::: align` reading of this shape. The split is now `williams2` /
`borislova` / `new_kolpakov` / `new_karta` x2 -> **table, unanimously**, `retyped.table-to-align` is
at 0, and §36.5's "known, named divergence" no longer has anything to name.

Four sessions of ruled-out signals are kept in PROGRESS §35.6 and §36.5 in case a genuine `::: align`
instance ever reappears. Until one does there is nothing here to decide. The general principle §36.5
established -- *take the reading that leaves the rule system least contradictory* -- stands, and §3.8
below is where it lives now.

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
   PROGRESS §36.5; §2b above records why its worked example has since dissolved.
9. **`new_karta`'s one-record `::: columns` is equally correct.** *Ruled 2026-08-10*, `analyze-3.md`:
   *"по-смыслу равнозначно, тоже таблица, но без заголовка. Это равноценное решение, а не реальная
   проблема. Такие случаи нужно игнорировать."* Closes the third standing candidate of §38's queue.
10. **`news.htm` has no errors at all** -- *"ошибок нет"*. Every remaining `news` converter-defect
    finding is a non-defect.
11. **A right-aligned quoted passage may be `>` or `_`, and both are correct.** *Ruled 2026-08-10*,
    on `pavlov_azancheev` and repeated on `borislova`: *"тут оба варианта одинаково верны и хороши --
    выбирай тот, который более гармонично вписывается в текущие правила"*. **This answers §38's one
    open question** about `segovia`'s quote after the `* * *` separator: `analyze.md` wants `>`, the
    corrected reference writes italic, and both are right -- so the reference's reading stands and
    nothing changes. The trailing `\` in that block is explicitly *not* settled by the author
    (*"я их поставл на угад"*), so a hard-break difference there is never evidence of a defect.
12. **`williams2`'s two smaller-font indented blocks are italic by the author's own choice**
    (`snapshot_25`, `snapshot_26`), and **`jovicic`'s trailing `-` list is a design decision** --
    *"Чисто человеческое дизайнерское решение."* Both reference-inconsistency by declaration.

## 4. Open defect classes -- *measured* 2026-08-10 after §39

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 147 | `retyped.paragraph-to-align` | 7 | 7 | 7 | **two mechanisms wearing one name.** 4 are the centred glyph pager (`new_karta`, `new_lendle2`, `new_rechin4`, `tarrega`) and are the rule killed twice, §30.1/§35.10 -- do not rebuild it whole. `news`'s went with the normalization. Of the rest, `new_lagq2`'s is now the §37.9 align-merge residue; `pavlov_azancheev`'s and `segovia`'s have never been probed |
| 24 | `emphasis.span` | 19 | 4 | 6 | downgraded, and §39.6.2 now gives the **cause**: computed italic from a CSS class exists on 9 documents and hundreds of blocks, and exactly one reference honours it. Do not implement |
| 18 | `paragraph.content.edited` | 11 | 3 | 6 | mostly reference-inconsistency |
| 18 | `paragraph.spurious.in-paragraph` | 3 | 3 | 2 | one of `news`'s two is the `::: lead` shadow (§26.2, off the queue), and `news` is now ruled clean outright (§3.10) |
| 15 | `paragraph.hyphenation.mixed` | 5 | 5 | 3 | root cause measured, PROGRESS §39.8. Not a detector problem: the oracle is absent, and rule 6 could not JOIN even if it were |
| 12 | `frame.moved` · `heading.missing.caption-echo` · `image.moved` · `image.position.value` · `link.inline.missing` · `paragraph.missing.in-paragraph` · `retyped.paragraph-to-heading2` · `retyped.paragraph-to-list` | 2 each | 2 | 2 | the tail. **`image.moved` is candidate 2 in §1** -- `williams2` and `tarrega`, same direction, same distance |
| 9 | `paragraph.hyphenation.unjoined` | 3 | 3 | 3 | same cause as `.mixed` |
| 9 | `retyped.align-to-paragraph` | 3 | 3 | 1 | `goya2`'s author-declared alternative (§37.8) |
| 4 | `frame.position.spurious` | 2 | 2 | 2 | new in §39.5 -- the frames now exist and the two sides nest them differently |
| 3 | `table.align` | 3 | 3 | 1 | `new_kolpakov`. **Killed in §39.6.1** on a 10-table browser sweep; not a target |
| -- | ~~`retyped.list-to-table`~~ | 2 -> **0** | 0 | 0 | closed by §39.3 |
| -- | ~~`link.label.hyphenation.joined`~~ | 2 -> **0** | 0 | 0 | closed by §39.2 -- the one thing `analyze-3.md` calls critical |
| -- | ~~`retyped.table-to-align`~~, ~~`table.header.cell` on `kiselev`/`tarrega`~~ | -> **0** | 0 | 0 | closed by the `1214860` reference normalization, no code change |
| -- | ~~`retyped.columns-to-table`~~ on `new_karta` | -- | -- | -- | **ruled equally correct** by the author (§3.9); still counted by L2, never a target |

Per document, converter-defect: `new_lendle2` 7 · `new_rechin4` 6 · `segovia` 6 · `new_karta` 6 ·
`news` 5 · `pavlov_azancheev` 5 · `goya2` 4 · `new_kolpakov` 4 · `news_2007` 4 · `segovia1` 4 ·
rest <= 3. `barrios`, `new_bach` and `new_dyens` are at **0**; `new_bach`, `new_blackmore`,
`new_dyens` and `williams2` are at **L1 100.0**.

> `new_karta` 3 -> 6 and `segovia1` 2 -> 4 are **not regressions**. §39.5 gave both documents the
> frame `analyze-3.md` asks for, and every added finding is about how the two sides *nest* the
> directive, not about the region. The full accounting is in PROGRESS §39.5 -- quote it or the
> numbers read as damage.

Also carried: `new_kolpakov`'s `::: signature` wrapper (`signature` appears in **1** of 22 references
and has never been emitted) · `frame`'s `title:` property is unused by the references too.

## 5. Instrument debt -- what to distrust, in order

0. **`link.label.content.empty` fires on labels that are not empty.** Reports `critical` when the
   produced label is `▶` and the reference's is a raw route. `1214860` normalized most of these away
   -- **3** instances remain (`segovia` x2, `tarrega`) and they are 3 of the corpus's 4 criticals, all
   reference-inconsistency. The class name still states a condition the finding does not meet, and the
   remaining three are simply references the normalization did not reach. Fix the class, not the
   converter.
0b. **`blocks.ts` reads a directive property line as a paragraph.** When the two sides nest a
   directive differently -- `::: align` wrapping a `::: frame` on one side only -- the `frame: gold`
   property line pairs against prose and is reported as `paragraph.missing.unattested` or
   `.spurious.unattested`, at **critical**. It produced `segovia1`'s old critical and now produces
   `new_karta`'s, with the sides swapped (PROGRESS §39.5). A property is not a block.
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
