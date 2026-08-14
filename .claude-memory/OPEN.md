# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-14**, after PROGRESS §55.
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, **27 sources / 27 compared**. Every number written before 2026-08-14 is
superseded: the author added `xtra_garcia_lorca`, edited eighteen references, parked the holdout
**source and reference together** in `fixtures/html2/` + `out2/`, and **removed
`fixtures/gen_corpus/`**. Do not reach for the 946 pages; they are gone and gitignored.

> **The "28 convert / 26 compared" leak detector no longer applies.** Both counts are 27. The holdout
> is fully outside the pipeline now -- outside the conservation and validator gate as well as outside
> L1/L2/L3 -- so it costs nothing and proves nothing until it is measured deliberately.

**Current state, *measured* 2026-08-14, after PROGRESS §55:**

| rung | value |
|---|---|
| L0 | **828 tests**, typecheck clean, 0 FAILED, **0 validator errors**, conservation ok |
| L1 | **98.9 %** over the 27 |
| L2 | **150 findings -- 85 converter-defect** · 17 ambiguous · 48 reference-inconsistency · 3 critical · 41 major |
| L3 | **22** over 27 documents, **0 critical** |
| removals, all 30 sources | **0 targets missing, 0 images missing**; no removal reason discards prose (§53.5) |

> **The author committed `bd40160` mid-session** ("updated reference file", `xtra_garcia_lorca`).
> The §55 baseline was therefore re-measured with the code stashed: **L2 201/137/2, L3 22**.
> The 203/138/2 written here before §55 predates that edit. Baseline before attribution.

> **The author's baseline moved before any code did.** The reference edits alone took L2 from
> 320/198/9 to **206/141/2** and L3 to 36. Quote that, or §53's three commits read as five times the
> work they were.

> **`bench/out/` is not the operator's output, and §53 forgot that.** The author converts through a
> job directory (`my-migration/`) with its **own corpus profile**, and the profile decides how much of
> a page is deleted. §53's audit measured one configuration and reported it as covering the workflow.
> **When a report is about a produced file, find the file the operator is looking at** (§54).

**The report that the gen-corpus *rules* deleted content on `xtra_garcia_lorca` is disproved** (§53) --
but the report that *content was being deleted* was correct, and §54 found the cause.
A build at `b8704e2` -- before §46, before every gen-corpus rule -- converts that page
**byte-identically to HEAD**. The real defect was `case "pre"` collapsing whitespace, present since
the initial commit and never exercised because no earlier fixture had a `<pre>`.

**Landed in §53, one commit each.**
- A preformatted block's whitespace is its content (`9ab1f86`). L2 206 → 204, L3 36 → 30, L1 flat.
- A gutter between two lanes is the author saying "side by side" (`43ec047`). L1 98.8 → 98.9,
  L2 → 203/139, L3 30 → 25, L3's last critical closes.
- A preformatted block is placed by its container (`3944fa2`). L2 defects → 138, L3 25 → 23.

**Landed in §54, one commit each.** Recurrence needs two observations to exist (`eba86c8`): a corpus
of one makes `frequency = 1/1` for every structure on the page, so 43 of 45 fingerprints became
`stableChrome` and **`removeBoilerplate` took 18.1 % of the page while `classify.ts`'s `SHELL` deleted
three whole tables** -- at a reported `Text recall: 100.00%`. Guarded at the producer and at both
consumers, and the CLI now prints the pipeline's warnings, which it never had. · Chrome removal reports
what it took (`f9c4eed`): a `Chrome:` line on every conversion. Author's workflow **5931 → 9882 bytes**;
the 27 unchanged on every rung.

**Landed in §55, one commit each.** A section label stands alone (`67b377d`): two or more
blocks of one template with nothing between them are one label the author broke across
lines, not two sections. Closes `xtra_garcia_lorca`'s three stacked `##`; L1 that document
97.1 → 97.5, head axis 71.4 → 75.0. · A record grid is not a sequence of entries
(`d90d9b8`): a `---` between laned rows claims one entry ended and the next began, and
`isEntryRow` asks whether the rows are entries — compound, or date-labelled. `xtra_shelechov`
21 rules → 0, `goya2`/`news_2007`/`kiselev`/`new_lagq2`/`new_lendle2`/`segovia1`/`barrios`
unchanged. **L2 201/137 → 150/85, major 79 → 41.**

**Next, in order. Probe before committing (SKILL §6).**
0a. **`xtra_shelechov`'s `align.spurious` x2** — new frontier, and the clearest thing left on
   that page now the 55 shadows are gone. `**I отделение**` and `**II отделение**` are wrapped
   in `::: align position: right`; the source cell is `<td class="t1" colspan="2">` and
   declares no alignment. Two `paragraph.containment` findings are its shadows, so the real
   count is 4 of the document's remaining 7.
0b. **The two `break.missing` on the same page** (§55.4). The reference divides the concert
   at the source's own spacer row, before the spanning `II отделение` label. A spanning
   single-cell band inside a laned region is the candidate signal; the spacer-driven form
   modelled on `layoutFrom` lands the divider one band late and was rejected on paper.
0. **The conservation gate still cannot audit boilerplate removal** (§54.6). The `Chrome:` line makes
   it visible, not gated; `sourceText` is captured after the pass, and moving it means moving it before
   dehyphenation and normalization too. A `SHELL` verdict deletes a table on `corpusFrequency` alone,
   with no share bound. **And no test covers the CLI's report** -- two of the three reasons §54 was
   silent were presentation, not conversion.
1. **`layout.containment.mismatch`, 13 over 9** -- the broadest untouched L3 class and the rung that
   answers priority 4. Unchanged from §51.6, and now L3's largest by a wider margin.
2. **One isolated instrument-truthfulness step**: `paragraph.content`'s blanket `critical` severity
   (§5.0aa) and the property-line-as-paragraph artefact (§5.0b).
3. **`structdiff`'s `code.text`** compares whitespace-collapsed values -- new debt from §53.2, listed
   in §5 below.
4. **The proper-name hyphenation tail, §50.6** -- `Бориславовна`, `Феррере`, `аккомпанементов`.
   Needs a stem-tolerant lexicon lookup; measure its false-friend rate first.
5. **`retyped.paragraph-to-align`: probe `segovia` alone.** The other four are the twice-killed
   glyph/footer family. §44.1.
6. **The shell-depth root cause, §40.6.** Three replacements built, all three reverted on measurement.

**Killed in §55** -- reopen on new measurement only:
**`xtra_shelechov`'s grid divergence is a ceiling, "8 references to 1"** (§55.3 -- 55 of its
62 findings were the shadow of 21 separators on a different code path; `column.containment`,
`retyped.column-to-paragraph`, `column.missing`, `columns.spurious`, `column.spurious` and
`paragraph.containment` all went to 0 with no rule written about any of them) ·
**`retyped.heading2-to-paragraph` is unworkable** (§55.1 -- §53.6 killed it for want of a
*source* discriminator; the author supplied an *output-shape* one instead, and the reference's
two `##` are now a named divergence rather than a target).

**Killed in §53** -- reopen on new measurement only:
**the gen-corpus rules (§46--§51) cost `xtra_garcia_lorca` content** (§53 -- byte-identical build
comparison across the whole span, plus a removal-reason audit over all 30 sources in which no reason
discards prose and no document loses a target or an image) ·
**`retyped.heading2-to-paragraph` is workable** (§53.6 -- six blocks in one identical source template,
four written `**bold**` and two `##` by the reference, nothing in the source separating them) ·
**the unconditional `too-small` → `layoutFrom` reconsideration** (§53.3 -- it *is* §18.3's killed form
and three existing contracts caught it in one run; the guttered-lane guard is the survivor).

**No open author question.**

**`npm install` before anything** -- §41's `dictionary-ru`/`nspell` optional deps are not in a fresh
clone and `tsc` fails on the missing declarations.

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) -- run
> `npx playwright install chromium` or every document reports "no output produced". And this repo
> carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false` unblocks it.
> `corpus scan` is **not** needed: `bench/corpus/corpus-profile.json` is committed and built from 22
> files. Without it the masthead banner survives and every page gains a spurious frame (§39.5).

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
14. **A stack of same-level `##`/`###` is poor design, in the output *and in a reference*.**
    *Ruled 2026-08-14:* *"if reference files overuse such headings too, treat it as poor
    design in reference files and ignore such references... The main goal is a beautiful
    visual result and good design in output markdown documents, not 100% adherence to
    metrics and reference files."* Implemented in §55.1. It retires §53.6's reading of
    `xtra_garcia_lorca`'s six-`p.t2` family as a reference-internal ceiling: the four written
    `**bold**` are the rule and the two written `##` are a named divergence. **Depth 1 is
    excluded** — a masthead split across two blocks is consecutive `#` inside `::: align`,
    which is §3.1/§3.2 above and `enforceSingleTitle`'s standing contract.
15. **A `---` after every single row of a table is poor design.** *Ruled 2026-08-14*, on
    `xtra_shelechov`: it *"makes the page too long and cluttered... takes up too much
    vertical space compared to the compact visual representation in the original HTML."*
    Implemented in §55.2 as "a record grid is not a sequence of entries". The `goya2` and
    `news_2007` separators `analyze.md` asks for are unaffected and tested for non-firing.
13. **`xtra_karta5`'s table headings are the outlier; work the table *content*.** *Ruled 2026-08-11:*
    *"the table headings in `xtra_karta5.bio.md` may conflict with the rules for table headings in the
    other reference files, so for the time being, please ignore the table headings in
    `xtra_karta5.bio.md` and focus on the content of the tables themselves"*. Its source structure is
    identical to `new_karta`'s, and its reading is 1 against 4 -- it lifts the composer name into the
    header cell, leaves link columns unheaded, and right-aligns them. 42 of that document's 50
    converter-defects are this and are a ceiling. PROGRESS §42.4.

## 4. Open defect classes -- *measured* 2026-08-14 after §55

**Read the ceiling column first**, and read §55.3 before trusting it: five of the classes
that stood here as "ceiling" through thirteen sections went to **0** in §55 without a rule
being written about any of them. They were the shadow of a construct in another class on
another code path. A ceiling with a document count of 1 is a hypothesis, not a finding.

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 75 | `retyped.paragraph-to-align` | 5 | 5 | 5 | **split mechanisms.** 4 are the twice-killed glyph/footer family; `segovia` is a long italic quotation shifted by margin (§44.1) |
| 68 | `table.align` | 34 | 34 | 2 | **ceiling, both documents** — `xtra_karta5`'s author-ruled ignorable; `new_kolpakov`'s 3 killed on a 12-to-1 sweep (§43.5) |
| 28 | `emphasis.span` | 25 | 4 | 7 | downgraded; §39.6.2 has the cause. **And the reader mis-splits `***x***`** — OPEN §5.0aaaaa. Do not implement |
| 18 | `retyped.paragraph-to-heading2` | 3 | 3 | 2 | **named divergence, §55.1** — 2 are `xtra_garcia_lorca`'s stacked `##`, which the author ruled poor design in the reference. Not a target |
| 12 | `link.inline.missing` · `paragraph.spurious.in-paragraph` · `retyped.paragraph-to-list` | 2 each | 2 | 2 | the tail |
| 10 | `paragraph.content` | 2 | 1 | 2 | **severity artefact** — blanket `critical`, OPEN §5.0aa |
| 9 | `paragraph.hyphenation.unjoined` | 3 | 3 | 3 | the proper-name tail, §50.6 |
| 6 | `align.spurious` | 2 | 2 | 1 | **new frontier, §55.4** — `xtra_shelechov`'s two spanning programme labels, source declares no alignment |
| 6 | `break.missing` | 3 | 3 | 2 | 2 are `xtra_shelechov`'s section boundary and grid close (§55.4) |
| -- | ~~`column.containment` 29 · `retyped.column-to-paragraph` 22 · `column.missing` 8 · `columns.spurious` 5 · `column.spurious` 3~~ | **0** | 0 | 0 | **not a ceiling.** All shadows of §55.2's 21 separators; dissolved with their cause |
| -- | ~~`break.spurious`~~ | 20 -> **0** | 0 | 0 | closed by §55.2 |
| -- | ~~`paragraph.spurious.in-table`~~ | 16 -> **0** | 0 | 0 | dissolved in §55 |
| -- | ~~`paragraph.containment`~~ | 6 -> **2** | 2 | 1 | the 2 are `align.spurious`'s shadows |
| -- | ~~`table.cell.content`~~ · ~~`retyped.columns-to-table`~~ · ~~`paragraph.missing.in-table`~~ · ~~`image.position.value`~~ | **0** | 0 | 0 | closed by §43.3, §43.4, §42.6, §44 |

Per document, converter-defect: `xtra_karta5` 33 (**ceiling**) · `xtra_shelechov` **7** (was
62) · `xtra_garcia_lorca` 6 (**2 the named divergence**) · `new_karta` 5 · `new_rechin4` 5 ·
`new_kolpakov` 4 (**all 4 ceiling**) · `news_2007` 4 · `jovicic` 3 · `kiselev` 3 ·
`pavlov_azancheev` 3 · `segovia` 3 · rest <= 2. **`authors`, `barrios`, `goya2`, `new_bach`,
`new_dyens`, `new_lagq2`, `segovia1`, `williams2`, `xtra_albeniz` and `xtra_rodrigo` are at 0.**

**The holdout is spent.** Measured once at the end of §43, exactly as §42.8 intended:
`xtra_oyanguren` 3 findings / 3 defects, `xtra_mikulka` 2 / 2 / 2 L3 — unchanged, both §43 rules
neutral there. §44 and §45 had no holdout.

**Closed in §48:** one-row DATA grid holding one standalone image beside text that substantially
repeats its source-backed image label. The converter now binds the visible text as that figure's
caption. Corpus reach: exactly `bogdanovic`; text recall 98.44% -> 100%, directives 4 -> 3, no
target/image/validator loss. Seven contract tests cover positive, mutation and false-friend shapes.

## 5. Instrument debt -- what to distrust, in order

0aaaa. **The conservation gate is structurally blind to chrome removal.** `sourceText` is captured
   *after* `removeBoilerplate` detaches, so recall is 100 % by construction however much that pass
   eats — 18.1 % of a page in §54, under `Text recall: 100.00%`, `Targets: conserved`,
   `Images: conserved`. `SHELL` removal is equally invisible. **A removal reason is a claim, not a
   measurement**, and §53.5's audit read the claims.
0aaaaa. **`structdiff`'s `emphasis.span` mis-splits a triple delimiter.** `***x***` is
   reported as three spans — `em:*`, `em:*`, `strong:*x`. The produced markup is
   well-formed and the validator is silent; the reader in `facts.ts` is wrong. New in §55.1,
   where the refused labels keep the `<i><b>` their source gave them. Fix the class.
0aaa. **`structdiff`'s `code.text` compares whitespace-collapsed values.** It could not see
   §53.2's defect -- six poems emitted as six single lines -- and it cannot see the fix either: the
   class reported "ambiguous, sides equal" before and after. A fenced block's *line structure* is
   currently unadjudicated by L2 in both directions. L3's `layout.overflow` was the only rung that
   noticed, and it named the symptom. Fix the class in an isolated truthfulness step.
0aa. **`paragraph.content` reports `critical` regardless of how small the difference is.** `barrios`'s
   single missing space after a footnote marker is the corpus's 9th critical (§51.5). Severity in this
   class is not proportional to the size of the difference. Fix the class in an isolated truthfulness
   step; §51.6 pairs it with §5.0b below, which owns `xtra_shelechov`'s two.
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
8. ~~**No mutation harness.**~~ **Built in §46.4** — `src/convert-core/metamorphic.test.ts`, 140
   properties over the 28 sources, swept over the 946 unlabelled pages with real Chromium:
   determinism, class/id renaming and attribute-order permutation each **946/946 byte-identical**.
   Invariant 5 now has a measurement, not only a review convention. Still missing from §5's list:
   `<font>`/`<b>` ↔ CSS equivalence, Latin↔Cyrillic label swaps, dropped closing tags, viewport
   changes, encodings — add them to the same file as they earn a falsifier.
9. **L4 is not built.** Do not report an L4 number.
10. **`diff` does not skip a document whose produced output is absent.** Pointed at `fixtures/out2` it
    reported 25 findings and 19 criticals for `new_karta5`, whose source lives in `fixtures/html2` and
    was never converted; it printed `note: no output produced` and counted it anyway. `l3` skips it
    correctly. Check which documents produced output before reading any holdout comparison. §43.7.
