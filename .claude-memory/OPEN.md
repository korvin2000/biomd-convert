# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-17**, after PROGRESS §61.
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

> **§61 retracted §60.4 on the author's instruction and replaced it with the source.**
> *"Don't try to guess align, but rather determine it based on the HTML layout and
> table layout"* — named on `xtra_rodrigo`'s last two tables, whose numerals and work
> titles had been set against the right margin. The written brief never asked for
> more: `TODO_Rules.md` §2 says the later columns *"могут"* be right-aligned — **may**,
> not must. §60.4 read a permission as an instruction.
>
> **The source states alignment per cell and always did.** Measured in Chromium:
> `xtra_rodrigo` computes `start` on exactly the two columns the author boxed, and
> the `<center>` wrapping the page does **not** leak into the cells. `cellAlign`
> asks the browser first, falls back to the attribute walked cell → row → row
> group, and stops below `<table>` — `align` there positions the table, not its text.
>
> **L2 135 → 161, and the whole delta is `table.align` 48 → 75**, minor, priority 6.
> Non-alignment findings 87 → 86. Criticals and majors unmoved, L1 unmoved, L3 unmoved.
> Movement runs both ways: `new_karta` 20 → 17 and `segovia` 8 → 7 lose invented
> alignment; `xtra_karta5` 0 → 31 and `new_kolpakov` 1 → 3 are the two references
> that write `--:` over cells their source states `center` on.
>
> **§56.5 is closed by an author edit, not by a rule.** `fixtures/out/williams2.bio.md`
> now reads `Em`, not `Em\*\*` — the reference agrees with what the converter already
> produced, and the standing question below is answered.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, **28 sources / 28 compared**. The author added the
`xtra_alexandro` pair during §56 — a near-clone of the spent holdout `xtra_oyanguren`, same
1998 template, different subject and dates — and re-edited `xtra_garcia_lorca`, whose three
stacked `##` are now `***bold italic***`. The holdout (`fixtures/html2/` + `out2/`) is
outside every rung and stays spent. `fixtures/gen_corpus/` is gone; do not reach for the
946 pages.

**Current state — all four rungs *measured* 2026-08-17 after §61, LLM-off:**

| rung | value |
|---|---|
| L0 | **998 tests**, typecheck clean, 0 FAILED, `--replay` byte-identical |
| L1 | **99.7 %** over the 28 |
| L2 | **161 findings — 114 converter-defect** · 12 ambiguous · 35 reference-inconsistency · **1 critical** · 27 major |
| L3 | **14** over 28 documents, 0 critical |

With `--hooks text.label` on a self-hosted `gemma4-31b-local`: 113 escalation points,
6 model calls, 2 resolved, 4 refused (**all "the line reads as SENTENCE"** — the
acceptance check working), L2 **137 / 89**. LLM-off output byte-identical, `--replay`
byte-identical with 0 calls. **The hook is off, and every number the project reports
is the LLM-off column.**

> **Baseline before attribution, every time.** §56's baseline is 28 documents at **`4b5d1b0`**
> (L1 99.0, L2 145/81/2/38, L3 22) -- the author committed the `xtra_alexandro` pair mid-session,
> as they did with `bd40160` during §55. `OPEN.md`'s pre-§56 numbers were for 27 and do not
> compare. **Check `git log` for an author commit before attributing any delta to your own work.**

> **`bench/out/` is not the operator's output** (§54). The author converts through
> `my-migration/` with its own corpus profile, and the profile decides how much of a page
> is deleted. When a report is about a produced file, find the file the operator is looking at.

**Landed in §60, one commit each.**
- `text.list` ships disabled again (`114d501`). The author's `b645b7b` flipped it on;
  L0 was red in HEAD and four pinned tests were failing.
- **An underline outside a link marks the words it holds** (`6643158`). `<u>` had no
  case in the inline lowering at all. Two false friends tested: the hand-underlined
  link label (400+ of the corpus's 414 `<u>`) and `tarrega`'s `<u>*</u>` footnote
  marker outside its anchor.
- **A strip of nothing but targets keeps its placement** (`8feb967`, Rule 3). Four
  sources state `align="center"` on their pager; `isAlignableLabelText` refused it
  for the separator's reason. L2 126 → 122, L3 20 → 14, L1 99.6 → 99.7.
- **A resource matrix sets its resources against its names** (`6f8d0b3`, Rule 2).
  `isLinkColumn` asked of the non-leading columns, once per table. `xtra_karta5`
  31 → 0; twelve other documents 0 → 47. Reopens §43.5 on rung-1 instruction.
- **A standalone line can be a section label** (`db7254c`, Rule 1). Promotes only on
  a shout or a section-opening word; abstains on the terms prose shares.
- **`text.label`, the fourth decision point and plugin, shipped disabled** (`f9d36d2`).

**Next, in order. Probe before committing (SKILL §6).**
0. **One question for the author, and it is the only thing §61 left open.**
   **No reference writes `:-:` anywhere** — 14 references with tables, 2 that align
   at all, both writing only `--:`. `TODO_Rules.md` §2's vocabulary lists `-`, `--:`
   and `:--` and never mentions centre, while `BioMD-Reference.md` §1 admits `:---:`
   normatively and the validator is silent. So the source says centre, the measured
   layout confirms it (26-60 % slack), the spec allows it, and the hand-made corpus
   has never used it. Whether a column the HTML centres should be written `:-:` or
   left at the default is one predicate either way; nothing above priority 6 turns
   on it. **Do not re-derive this — ask.**
0a. **`table.align` is 75 over 13 documents and is not work.** 31 are `xtra_karta5`
   and 3 `new_kolpakov` — references that write `--:` over cells their source states
   `center` on — and the rest are references that write nothing where the source
   states something. Every instance is priority 6. `new_karta`'s 13 and
   `xtra_rodrigo`'s 7 are this, not defects.
0b. **`xtra_shelechov`'s two `break.missing`** (§55.4) — unchanged by §60 and still
   the cleanest untouched mechanism. §59.2 named the spanning band the divider sits
   beside.
0c. **The conservation gate still cannot audit boilerplate removal** (§54.6).
1. **`layout.containment.mismatch`, 9 over 7** — down from 12 over 9 without being
   aimed at; re-probe before assuming the remainder is one mechanism.
2. **`emphasis.span` is now 24 over 7 and 6 are converter-defects** — five are
   `xtra_rodrigo`'s one-colon scope disagreement (§60.2), which is a reference
   divergence wearing a defect verdict. And the reader still mis-splits `***x***`
   (§5.0aaaaa).
3. **One isolated instrument-truthfulness step**: `paragraph.content`'s blanket
   `critical` (§5.0aa), the property-line-as-paragraph artefact (§5.0b), and
   **L3 does not model table cell alignment at all** — new debt, found by §60.4
   moving 48 findings without L3 noticing.
4. **`structdiff`'s `code.text`** compares whitespace-collapsed values — §53.2 debt.
5. **The proper-name hyphenation tail, §50.6.**
6. **`retyped.paragraph-to-align`: probe `segovia` alone.** Now 2, not 5.

**The hook budget is spent for this iteration.** `text.label` is it. A second candidate
found now is a rule that has not been found yet — go back to `LLM-HOOKS.md` §10.1 step 1.

**§56.5 is CLOSED, by an author edit rather than by a rule.** The brief's §4
(*"Одиночный `*` или несколько подряд стоящих `*` … не должны фильтроваться"*) never
applied to `williams2`: that cell has **no asterisk in the source** — it is
`<i>&nbsp;</i>`, an empty italic, and the reference's two stars were an artefact of the
manual conversion. Every literal asterisk in all 28 sources already survives and escapes
(`Em**` → `Em\*\*`, `Em*` → `Em\*`, a lone `*` → `\*`), which was measured in §60.
**`fixtures/out/williams2.bio.md` now reads `Em`** — the author removed the stars rather
than asking for them to be emitted. Do not re-investigate.

**Two false positives of the quotation rule, named rather than patched.** It marks
`new_rechin4`'s quoted thesis heading and `jovicic`'s prize citation only if the
"holds a sentence" clause is removed; with it, both are excluded and no known false positive
remains in the 28. Reach is 14 spans over 6 documents; 12 sit on references that write no `==`.

**Killed in §55** — reopen on new measurement only: **`xtra_shelechov`'s grid divergence is a
ceiling, "8 references to 1"** (§55.3) · **`retyped.heading2-to-paragraph` is unworkable**
(§55.1).

**Killed in §53** — reopen on new measurement only: **the gen-corpus rules cost
`xtra_garcia_lorca` content** (§53) · **`retyped.heading2-to-paragraph` is workable** (§53.6) ·
**the unconditional `too-small` → `layoutFrom` reconsideration** (§53.3).

**One open author question — §1.0 above:** whether a column the HTML centres should be
written `:-:` or left at the default. One further thing the author may want to rule on:
whether a quotation highlight should also cover `xtra_shelechov`'s four long review
quotes, which no reference adjudicates.

**`npm install` before anything** — §41's `dictionary-ru`/`nspell` optional deps are not in a
fresh clone and `tsc` fails on the missing declarations.

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) — run
> `npx playwright install chromium` or every document reports "no output produced". And this
> repo carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false`
> unblocks it. `corpus scan` is **not** needed: `bench/corpus/corpus-profile.json` is committed.

> **Two of §56's four mechanisms were named in the code that refused them**, and neither
> appeared in `analyze/defects.json` at any rank. Grep the contracts for the shape you are
> about to build and read what they refuse and why — a comment that names a document as the
> reason for a rule and then excludes it is a recorded defect wearing a justification.

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
16. **A catalogue is a list, everywhere — and its items carry no trailing hard break.**
    *Ruled 2026-08-16*, on the two questions `text.list` raised. A run of parallel work,
    track, volume or programme titles is a list wherever it appears, so `xtra_rodrigo`,
    `borislova`, `new_lendle2` and `new_bach` — whose references keep exactly that shape as
    hard-break paragraphs — are **named divergences, not defects**. Do not build a
    document-specific rule to preserve their reading, and do not read their
    `retyped.list-to-paragraph` findings as converter-defects. And the item is written clean:
    the references write `- Том I …\` with a trailing break on every item but the last, but
    a break at the end of a list item separates nothing, and `listFromBlockquoteRun` — which
    produces `kiselev`'s own album track lists **without** the backslash, in the very same
    reference file — is the reading that leaves the rule system least contradictory. One
    emission (`listOfLines`) serves all five list rules. PROGRESS §59.1.
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

## 4. Open defect classes -- *measured* 2026-08-16 after §60, LLM-off

**Read the ceiling column last, not first.** §55.3 dissolved five classes that had stood here
as "ceiling" for thirteen sections, without a rule being written about any of them, and §56
closed two mechanisms that appeared in this table at **no rank at all**. A ceiling with a
document count of 1 is a hypothesis; an empty ledger row is not evidence of a clean document.
And §60 is the reverse case: `table.align` was a two-document ceiling and is now the largest
class in the ledger **because a rung-1 instruction was obeyed**.

| class | inst | defect | docs | note |
|---|---:|---:|---:|---|
| `table.align` | 75 | 75 | 13 | **not work, and re-measured after §61.** Every emitted alignment is now attested by the source; these are references that write something else. `xtra_karta5` 31 · `new_karta` 13 · `xtra_rodrigo` 7 · `segovia` 5 · `kiselev`/`new_kolpakov`/`tarrega` 3 · rest ≤ 2. Minor, priority 6. **Do not "fix" it by guessing again** |
| `emphasis.span` | 22 | 6 | 6 | 5 of the 6 defects are `xtra_rodrigo`'s one-colon scope disagreement (§60.2) — the source puts the colon outside `<u>`, the reference inside. **And the reader mis-splits `***x***`** (§5.0aaaaa) |
| `break.missing` | 4 | 4 | 3 | **the frontier.** 2 are `xtra_shelechov`'s section boundary and grid close (§55.4); 1 is `xtra_karta5`'s footer rule, newly visible |
| `paragraph.hyphenation.unjoined` · `.mixed` | 3 each | 3 | 3 / 2 | the proper-name lexicon tail, §50.6 |
| `retyped.paragraph-to-list` | 2 | 2 | 2 | `kiselev` + `jovicic`. **Closed by `text.list` when the hook is on** (§59.1). Not a rule to write |
| `retyped.paragraph-to-align` | 2 | 2 | 2 | was 5. What remains is the §44.1 right-aligned-prose family on `segovia` and `tarrega` |
| `link.inline.missing` · `paragraph.spurious.in-paragraph` · `table.cell.hyphenation.mixed` | 2 each | 2 | 2 / 2 / 1 | the tail |
| `break.containment` | 1 | 1 | 1 | **new in §60.3**, `new_rechin4`'s `<hr>` inside the centred pager group. The references disagree about this shape; recorded, not worked |
| 11 singleton classes | 1 each | 1 | 1 | `align.moved` · `align.position.missing` · `heading.missing.absorbed` · `paragraph.missing.in-paragraph` · `retyped.columns-to-paragraph` · `retyped.paragraph-to-frame` · `retyped.paragraph-to-heading2` · `retyped.paragraph-to-lead` · `retyped.paragraph-to-quote` · `signature.position.spurious` · `heading.content.edited` |
| -- | 0 | 0 | 0 | ~~`align.missing`~~ · ~~`retyped.paragraph-to-heading3`~~ · ~~`align.spurious`~~ · ~~`paragraph.containment`~~ closed by §59.2 and §60 |

Per document, converter-defect, *measured* after §61: **`xtra_karta5` 32** (**31 are
`table.align`**) · `new_karta` 17 (**13**) · `xtra_rodrigo` 12 (**7 `table.align`, 5 the
colon scope**) · `segovia` 7 (**5**) · `kiselev` 6 · `tarrega` 5 · `new_kolpakov` 4 (**3**) ·
`new_rechin4` 4 · `news_2007` 4 · `jovicic` 3 · `pavlov_azancheev` 3 · `xtra_shelechov` 3 ·
rest <= 2. **Read the `table.align` column out before ranking anything**: strip it and the
real queue is `kiselev` 6, `tarrega` 5, `new_rechin4` 4, `news_2007` 4, `new_karta` 4.

**Three classes L2 cannot see at all.** §56 found two by reading the source rather than the
ledger — a section label absorbed into an image's `caption:` property, and an inline construct
the converter could not emit. §59 adds the third: **an abstention is invisible to every rung**.
`retyped.paragraph-to-list` was rank 12 and named only two of the 34 runs the compiler declines
to classify; the other 32 produce no finding at all, because a hard-break paragraph is a
perfectly valid block and no instrument asks whether it should have been something else.
`escalations: consulted` in the run report is the only place that number appears.

**The holdout is spent.** Measured once at the end of §43: `xtra_oyanguren` 3 findings / 3
defects, `xtra_mikulka` 2 / 2 / 2 L3. §56 added `xtra_alexandro`, a near-clone of
`xtra_oyanguren` from the same template — the holdout is now also *represented* in the
refinement set, which is a further reason not to re-take it as evidence.

**Closed in §48:** one-row DATA grid holding one standalone image beside text that substantially
repeats its source-backed image label. **Closed in §56.1:** the same relationship stacked — one
column, image row over caption row, with no `alt` anywhere to match against.

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
