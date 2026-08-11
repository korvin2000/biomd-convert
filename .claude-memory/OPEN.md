# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-11**, after PROGRESS §42.
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-11-after-42)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, **28 documents**. The author added six `xtra_` pairs and promoted the
old holdout into the corpus; §42 recalculated everything and landed two table mechanisms.

> **The corpus is 28, not 22, and `xtra_karta5` *is* the former holdout `new_karta5`** (byte-identical
> reference, CRLF-normalized source). **The holdout role is empty.** All 28 have now been diffed, so
> none can serve retroactively — the next iteration must name one before designing a rule.
> PROGRESS §42.1.

> **Two things moved the baseline with no code change**, and both must be quoted or the numbers read
> wrong: commit `92b7e67` *"fixed reference files"* landed after §41 and edited 16 references (the
> original 22 alone went L2 141/67 → 106/56, L3 44 → 25); and the six new pairs added 299 findings on
> arrival. PROGRESS §42.2.

**Current state, *measured* 2026-08-11, after PROGRESS §42:**

| rung | value |
|---|---|
| L0 | **526 tests**, typecheck clean, 0 FAILED, conservation ok, `read()` warnings 0 |
| L1 | **98.5 %** |
| L2 | **329 findings -- 212 converter-defect** · 24 ambiguous · 93 reference-inconsistency · 14 critical |
| L3 | **67** over 28 documents, identity 0, deterministic |
| validator | **0 errors on every produced document** |

That is the floor. Nothing accepted from here may regress it.

> **65 % of the 212 are two recorded reference divergences, not work.** `xtra_shelechov` ~96 and
> `xtra_karta5` 42. The honest open count is **~74**. Quote the split or the ledger reads as a
> collapse in quality that did not happen.

**`npm install` before anything** — §41's `dictionary-ru`/`nspell` optional deps are not in a fresh
clone and `tsc` fails on the missing declarations. That is a build failure, not a degradation.

**Landed in §42, one commit each.** A strip of numbered slots is one column, not eight (`8ad896c`;
`xtra_rodrigo` 45 findings/20 defect/16 critical → 15/3/0, `xtra_karta5` 141/69/28 → 99/50/6,
L2 criticals 52 → 14) · a full-span leading row is the table's title, not a record (`d17286f`;
`xtra_rodrigo` → **L1 100.0 on every axis**, `segovia` 8/5 → 7/4, and `positionedByConstruct` keeps a
construct's lowered-out block out of the align-run pass).

**Next, in order. Probe before committing (SKILL §6).**
1. **Name a holdout.** The role is empty and nothing else in the queue is safe to design without one.
   Ask the author, or hold the next pair they supply.
2. **`retyped.paragraph-to-align`** — 5 instances, 5 documents, the largest genuinely general class
   left. 4 are the centred glyph pager and are the rule killed twice (§30.1/§35.10) — do not rebuild
   it whole. `segovia`'s has still never been probed.
3. **`image.position.value` 3/3 docs** and **`paragraph.missing.in-paragraph` 3/3** — the only other
   classes spanning three documents.
4. **The shell-depth root cause, PROGRESS §40.6** — the "one table is the page shell" constant is
   wrong on 8 of 22 and load-bearing in five rules. Three replacements built, all three reverted on
   measurement. Start from `headingLineOf`.

**No open author question.** The one raised this session was answered in the same turn (§3.13).

**Do not re-take these; §37-§42 settled them.** Everything §41's list named, plus:
`xtra_albeniz` (0 defects on first contact) · `xtra_rodrigo`'s score table and its two work titles ·
`segovia`'s work title · `xtra_karta5`'s bumblebee strip.

**Killed in §37-§42** -- reopen on new measurement only: everything §41's list named, plus
**cell content weight as the per-row/grid discriminator** (§42.4 — falsified by `news_2007`, whose
short-celled multi-row news list is read per-row) and **raising `planDataTable`'s `maxCols`**
(§42.5 — `xtra_karta5`'s Sor table is a legitimate six-column matrix).

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
13. **`xtra_karta5`'s table headings are the outlier; work the table *content*.** *Ruled 2026-08-11:*
    *"the table headings in `xtra_karta5.bio.md` may conflict with the rules for table headings in the
    other reference files, so for the time being, please ignore the table headings in
    `xtra_karta5.bio.md` and focus on the content of the tables themselves"*. Its source structure is
    identical to `new_karta`'s, and its reading is 1 against 4 -- it lifts the composer name into the
    header cell, leaves link columns unheaded, and right-aligns them. 42 of that document's 50
    converter-defects are this and are a ceiling. PROGRESS §42.4.

## 4. Open defect classes -- *measured* 2026-08-11 after §42

**Read the ceiling column first.** Two recorded reference divergences account for 138 of the 212
converter-defects; see PROGRESS §42.4 before treating any large class here as available work.

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 87 | `column.containment` | 29 | 29 | 1 | **ceiling** — `xtra_shelechov`'s row-major grid, 8 references to 1 |
| 75 | `retyped.paragraph-to-align` | 5 | 5 | 5 | **the largest genuinely general class left.** 4 are the centred glyph pager, the rule killed twice (§30.1/§35.10) — do not rebuild whole. `segovia`'s has never been probed |
| 66 | `retyped.column-to-paragraph` | 22 | 22 | 1 | **ceiling** — same divergence |
| 58 | `table.align` | 29 | 29 | 2 | **ceiling** — `xtra_karta5`'s `--:` columns, author-ruled ignorable this session |
| 48 | `paragraph.spurious.in-table` | 16 | 16 | 1 | **ceiling** — `xtra_karta5`'s name-in-header-cell |
| 42 | `paragraph.containment` | 7 | 7 | 2 | mostly the `xtra_shelechov` divergence |
| 27 | `image.position.value` | 3 | 3 | 3 | **open, 3 documents** |
| 27 | `paragraph.missing.in-paragraph` | 3 | 3 | 3 | **open, 3 documents** |
| 24 | `column.missing` · `columns.spurious` · `column.spurious` | 8 · 5 · 3 | | 1 | **ceiling** — same divergence |
| 24 | `retyped.align-to-paragraph` | 4 | 4 | 2 | `goya2`'s author-declared alternative (§37.8) |
| 21 | `emphasis.span` | 23 | 3 | 7 | downgraded; §39.6.2 has the cause. Do not implement |
| 20 | `break.spurious` | 20 | 20 | 1 | **ceiling** — the rules between `xtra_shelechov`'s programme rows |
| 15 | `table.row.missing` | 3 | 3 | 1 | `xtra_karta5`'s score table, which its reference appends to the preceding record table and `xtra_rodrigo`'s keeps separate. A third named divergence, 1 to 1 |
| 12 | `link.inline.missing` · `retyped.paragraph-to-list` · `retyped.paragraph-to-heading2` · `align.missing` | 2 each | 2 | 2 | the tail |
| -- | ~~`align.spurious`~~ | 26 -> **3** | 3 | 2 | closed by §42.5 |
| -- | ~~`paragraph.missing.in-table`~~ | 3 -> **0** | 0 | 0 | closed by §42.6 |
| -- | ~~`paragraph.spurious.unattested`~~ | 41 -> 1 | 1 | 1 | the `blocks.ts` artefact (§5.0b), mostly dissolved with §42.5 |

Per document, converter-defect: `xtra_shelechov` 101 (**~96 ceiling**) · `xtra_karta5` 50
(**42 ceiling**) · `new_lendle2` 7 · `new_karta` 6 · `new_rechin4` 6 · `news` 5 · `segovia` 4 ·
`new_kolpakov` 4 · `news_2007` 4 · `goya2` 3 · rest <= 3.
`authors`, `barrios`, `new_bach`, `new_dyens`, `segovia1`, `williams2` and **`xtra_albeniz`** are at
**0**. `xtra_rodrigo` is at **1** and at **L1 100.0 on every axis**.

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
