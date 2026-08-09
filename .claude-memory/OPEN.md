# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-09**, after `segovia1`'s footer (PROGRESS §33). Facts marked *measured* were
taken then; facts marked *recorded* are quoted and have not been re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. What this iteration settled](#2-what-this-iteration-settled)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [3b. `/new_rules.md` -- reach measured](#3b-new_rulesmd----reach-measured-so-nobody-re-derives-it-progress-313)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-08-over-22-documents-after-486e9c9)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. **The author revised 21 of 22 references plus
`BioMD-Reference.md` in `06eeafb`, and added `/new_rules.md`.** That moved every rung with no code
change; the numbers below are re-baselined against the revised references, and any figure quoted
from PROGRESS §21-§28 predates them.

**Current state, *measured* 2026-08-09, after `segovia1`'s footer (PROGRESS §33):**

| rung | value |
|---|---|
| L0 | **441 tests**, typecheck clean, 0 FAILED, conservation ok, clean share 13.6 % |
| L1 | **94.5 %** |
| L2 | **269 findings -- 141 converter-defect** · 64 ambiguous · 64 reference-inconsistency · 8 critical |
| L3 | **68 findings**, identity 0, deterministic |
| validator | **13 errors** (unchanged). Reachable **only** through `corpus run`'s `errors=` column: `validate <file>` on its own resolves a laxer profile and reports **0**. A session mis-stated this twice -- once as "no errors exist", once as "the header class closes none of them" (it closed 15). Never quote a validator figure from anywhere else |

That is the floor. Nothing accepted from here may regress it.

**Re-baselining, for attribution.** The reference revision alone (no code change) took L1 92.7 → 93.0,
L2 417 → 335 findings / 241 → 192 defect, L3 92 → 85. The icon mechanism took it from there to the
table above. Several §21-§28 ceilings were **corrected by the revision** and closed themselves:
`retyped.paragraph-to-lead` (the 8 `::: lead` blocks are gone from `new_rechin4`), `new_blackmore`'s
masthead split point (OPEN §3.2), and the centred-section-label ruling of §24.5 now applied in
`goya2`, `new_bach`, `news_2007` and `segovia1`.

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) -- run
> `npx playwright install chromium` or every document reports "no output produced". And this repo
> carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false` unblocks
> it. **`corpus scan` is still required after a fresh clone** -- §24.4 changed the chrome
> fingerprint and a cached `bench/corpus/corpus-profile.json` from before it makes `news` regress.

**Closed since the last entry:** `image.spurious` 8/5 → 0 (`55e7a8c`, §2.0) · `table.header.cell`
43/7 → 8, none a defect (`f5665c4`, PROGRESS §30.2) · the two guide-vs-reference glyph conflicts,
corrected by the author in `3097a48` -- **the icon family now has no open question** ·
`goya2`'s `images.*` cluster 18 → 0 (`da7246e`, PROGRESS §31.2) · `image.src.value` 19 defects → 0,
by fixing the instrument, not the converter (`486e9c9`, PROGRESS §31.1) · `columns.missing` (1 → 0)
and `retyped.paragraph-to-column` (4 → 0) on `segovia1`, PROGRESS §33.

> **Of the 28-defect fall through §31, 19 were the instrument telling the truth and 9 the converter
> improving.** Never quote a drop without checking the split.

**Next: `new_kolpakov`/`borislova`/`new_karta`'s single-track discography rows, or `news`/`kiselev`
document-first.** `segovia1`'s footer (PROGRESS §33) turned out to be a DATA-classification ceiling,
not the `layoutFrom` column cap the frontier guessed -- `dataRegionFrom`'s DATA branch never retried
`layoutFrom` on a planning failure, only the adjacent UNKNOWN branch did. Fixed for a **bare-link
row** (a pager: every cell is exactly one link, nothing else). The same sweep found three more
single-row tables hitting the identical `planDataTable` `minRows: 2` ceiling, but wanting the
*opposite* shape -- a table with a synthesized header, not `::: columns` -- because their cells carry
a title (prose, no link) beside a format link: `borislova`'s `"Estrelluvio" … | WMA`,
`new_kolpakov`'s `Венгерка | WMA | (1,7 Mb)`, `new_karta`'s `El Puerto, da Suite Iberia … | WMA`.
**Do not build this next without solving the `williams2` false friend first**: it shares the exact
title-plus-link shape and its current output (two `::: align` blocks) already matches the reference,
so a naive "relax `minRows` when a title cell is present" rule regresses a regression-corpus
document. No deterministic separator was found in the budget spent probing it (§33.6) -- try source
recurrence of the shape elsewhere on `williams2`'s own page, or position relative to a discography
heading, before designing a rule; it may be `reference-quirk` the corpus is simply inconsistent
about, in which case say so rather than force a rule.

**Document-first is attested three times now** (`news`/`goya2` in §31, `segovia1` in §33) and has
paid every time. `news` still holds 26 defects and no single mechanism above 4 -- it is the next
document to enumerate by node path if the discography-row question above is parked. `kiselev` (43
findings, 12 defect) has never been looked at either.

**Done (PROGRESS §32):** the caption echo. `selfEcho` asks the *owning* side whether it states the
label twice, which is decidable where "where did the other side put it" is not. 5 of `goya2`'s 7
moved to reference-inconsistency; **2 are deliberately left wrong** -- their caption merges two
sibling blocks (`**…Favourite Hits**` + `**Vol. 1**`) and joining them needs a concatenation search.
Do not take those two for their own sake.

**Probed, negative (PROGRESS §33 session):** `eval/blocks.ts`'s emphasis-span regex does **not**
read a URL underscore as emphasis on any of the 22 references or `bench/out` -- every `_`-delimited
match found (`new_blackmore` 1, `new_dyens` 3) is a genuine `_..._` italic span. `emphasis.span`'s
downgrade stands on its original grounds, not on this; the class is not an instrument artefact via
this mechanism.

**A second gap the `segovia1` fix exposed and closed in the same pass:** `biomdColumns`'s serializer
never emitted its own `columns:` count -- only `divider`. Never needed before (every existing lane
region has 2-3 children, which Reference §3's legacy form omits the property for). `resolveColumnsCount`
(new, `downgrade.ts`) mirrors `resolveDivider`'s profile-gated omission. PROGRESS §33.3.

**Downgraded, do not take on rank alone:** `emphasis.span` (verdicts flip on identical evidence
across documents; 17 of 24 already reference-inconsistency, and the 7 defects are one *different*
mechanism -- `news` keeps only the first `strong` run in a paragraph) · `retyped.paragraph-to-align`
(now rank 1 at 8 docs, but a **shadow class**: it fires at the same node paths as the missing
container that causes it) · `align.spurious`, `paragraph.containment` (same) ·
`retyped.paragraph-to-list` (killed on measurement, §15.2/15.3 -- shape overlap is total).

Off the queue entirely: `retyped.paragraph-to-lead` (author ruling §26.2), `image.size.value`
(§25.4), 7 of `break.missing`'s 10 (§25.3).

> **The rank column measures what an instrument noticed, not what work is available.** Four of the
> last five classes taken from the top were ceilings, shadows or several mechanisms wearing one
> name. §27 spent twenty minutes triaging five classes and found the mechanism worth building at
> **rank 15**. Triage 2-3 instances *before* surveying, always.

---

## 2. What this iteration settled

### 2.0 A linked micro-image is a control, not a picture

`dropDecorative` inspects a run's **direct children**; `runImages` **descends through `<a>`**. A nav
arrow is always inside the link it operates, so it was invisible to the filter and visible to the
grouper, and five footers shipped as `::: image src: ../main/back.gif` -- a broken image asserting
that a UI glyph is a photograph. `isDecorative` had said `true` about it the whole time. Fifth
containment-vs-filter mismatch of the campaign; the tell was that `previous.gif` (not in the old
name regex) and `back.gif` (in it) produced *identical* wrong output, which means the regex was
never the deciding code.

`ICON_GLYPHS` in `glyphs.ts` now carries the guide's 29 entries, keyed on the **asset stem** -- the
guide spells the score icon `score3.gif` and the page that uses it writes `score3.jpg`, so the
extension cannot be part of the key. Label rule, unanimous in the corpus: `alt` when the author
wrote one (2 icons), else the mapped glyph (6), else the pre-existing href fallback. Restricted to
**linked** icons on purpose -- see §2.4 for the unlinked half.

The two guide/reference divergences this raised (`h2.gif`, `smile.gif`) were **decided for the
guide and then confirmed by the author** in `3097a48`, which changed both references to match. The
icon family has no open question left. Neither correction moved a rung: L2 folds numeric character
references before comparing.

### 2.0b A synthesized column header gets the house name

`/new_rules.md` supplies the vocabulary; `column-labels.ts` holds it as language-tagged data;
`synthesizeHeader` consults it. §16.3 is not engaged because these tables have **no source header
at all** -- the old references invented `Композиция` exactly as the new ones write `Название`. This
retired a standing contract (`LINK_GLYPH` for a resource column, an empty leading column) on the
author's ruling; `data-table.test.ts` records why the old one was right about the corpus it was
written against. **Validator errors 28 → 13**, L2 322 → 287, no document worse. PROGRESS §30.2.

### 2.1 A panel drawn with a background tint is a frame

`new_lendle2` writes `border: 1 solid #D5A96F` on five album panels -- **unitless**, so Chromium
drops the shorthand and computes `border-style: none`. The tint (`rgb(252,243,216)` on the page's
`rgb(247,231,175)`) is the only evidence left, and `paletteFor` already maps it to the `white` the
reference names. **Occupancy is the invariant, not recurrence**: `goya2` tints fifteen cells the
same way and its reference frames none -- they are `width="50%"` lane cells, while `new_lendle2`'s
are `colspan="2"` and own their row. Recurrence would invert the answer. The fallback had to move
*ahead* of the `border-style: none` early return -- the pre-filter trap, hit twice now. One missing
frame had been producing 18 defects across five classes. PROGRESS §27.2.

### 2.2 A heading is one line -- at every depth

`headingPhrasing` folded only top-level `break`s, and `dropEmphasis` runs after it and lifts a
`strong`'s children back out -- so `<b>Title<br></b>subtitle` produced the corpus's one **setext
heading**. `eval/blocks.ts` read the 89-hyphen underline as a thematic break, `eval/facts.ts` read it
as a heading, `read()` warned about nothing, CommonMark made it an `h2` swallowing the line above.
`foldBreaks` recurses. Fifth instrument-shaped defect of the campaign. PROGRESS §25.1.

### 2.3 A drawn rule is a line, and a rule may join an alignment run

§24.3's `* * *` rule keyed on "the whole *block*"; `<br>` is how this era ended a line inside a
block, so `kiselev`'s `-------------------------<br>Олег Киселев: …` was unreachable and shipped as
`\-------------------------`. The unit is now the line. Placing it needed the second half: a
`thematicBreak` carries no text so it cannot *nominate* an alignment, but `blocksFrom` already
records its source element's alignment on it, and the blanket exclusion in `alignableRunMember`
hoisted it out of the block it divides. It may now join a run and never open one; a run with no
text-carrying member is emitted bare. PROGRESS §25.2.

### 2.4 Still open: the *unlinked* half of the icon map

`isUiIcon` requires link containment, so an unlinked known icon is still left to `isDecorative`,
which drops it. Two shapes remain, and they were held back deliberately because their risk differs
from the linked case:

- **`score3` ×10, `tarrega`, 32×14, inside table cells.** The edge *"does the icon block the
  planner?"* is **probed and dead**: the icons are in the big music table, which converts fine, not
  in the two PDF tables that fail. `tarrega`'s `retyped.list-to-table` ×2 is a separate, unexplained
  mechanism (L1 shape 33.3 %) and the icon has nothing to do with it.
- **`smile` ×1, `news_2007`, 15×15.** `isDecorative` deliberately keeps squarish 15 px emoticons as
  content and a contract asserts it -- yet the produced `news_2007` has no smiley, because the whole
  paragraph containing it is absent from the output. That missing paragraph is the real defect and
  it has never been examined. The reference now writes `&#9787;`, matching the guide.

---

## 3. Answered by the reference author -- do not re-investigate

1. **A recovered centred section label gets a bare `##`; the centring is dropped.** *Ruled
   2026-08-08.* The `::: align` wrapper is for a **split headline**, where it is what makes
   consecutive `#` lines one heading, and for nothing else. The converter already does this, so no
   code changed. `goya2`'s `align.missing` + `heading.containment` at `/align[71]` and `new_bach`'s
   `retyped.heading2-to-align` are `reference-inconsistency`. PROGRESS §24.5.
2. **`new_blackmore`'s masthead split point** -- settled deterministically in the browser: the source
   draws two line boxes at 26.7 px and 16 px, and the reference moves one word across that boundary.
   Reference-inconsistency; two minor `heading.content.edited` remain. PROGRESS §24.5.
3. **`::: lead` is aesthetic, not structural, and the ruling is symmetric.** *Ruled 2026-08-08.*
   Applied when every paragraph opens with a highlighted initial, or when the article is built from
   long paragraphs that read better broken up -- and applied to **one document only**, so its absence
   elsewhere is deliberate. A `lead` discrepancy in **either** direction is visual, not a fidelity
   defect: emitting one where a reference has none is not a regression if it reads better. The
   converter emits `lead` nowhere and that stays correct. All 10 findings are off the queue; the
   measurements that rule out typography, length and position are in PROGRESS §26.3, so do not
   re-derive them.

## 3b. `/new_rules.md` -- reach measured, so nobody re-derives it (PROGRESS §31.3)

Six author rules remain unimplemented. Four have **no reach in this corpus** and are not work:

| rule | measured reach |
|---|---|
| drop an empty trailing table column | **0** tables, either side |
| `_` ≡ `*` italic | **0** real spans -- every `_` in `fixtures/out/` is a URL underscore |
| URL integrity, no line split in a link label | **0** instances, either side |
| merge consecutive same-alignment `::: align` | the **references keep 5 such pairs unmerged**; the rule says "можно", so a blanket merge breaks 5 agreements to fix 8 |

Two are live: **`::: signature` for a source list** (stated vocabulary; `new_kolpakov`'s reference
writes `signature` where the converter writes `nav`, `new_blackmore` emits a `nav` the reference has
none of, `new_rechin4` the reverse) and **`==` for a long quoted sentence** (6 spans, 3 documents) --
but 2 of `new_rechin4`'s 4 are under the stated 64-character floor and are not in quotes, so the
rule as written does not explain its own corpus, and its second half asks the *instrument* to ignore
the difference. Ask the author before building either.

## 4. Open defect classes -- *measured* 2026-08-09 over 22 documents, after PROGRESS §33

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| ~~--~~ | ~~`table.header.cell`~~ | ~~43~~ | 0 | ~~7~~ | **closed to 8** by `f5665c4`; the 8 residuals are all reference-inconsistency |
| 192 | `retyped.paragraph-to-align` | 8 | 8 | 8 | **A different mechanism from `segovia1`'s** (§30.1/§33): those 8 pagers lost centring when a `::: image` became a paragraph, not a missing `columns` region. Untouched by §33. A rule for it was built and **reverted** -- PROGRESS §30.1 |
| 132 | `retyped.paragraph-to-list` | 11 | 11 | 4 | killed on measurement §15.2/§15.3 -- shape overlap total |
| 96 | `retyped.align-to-paragraph` | 8 | 8 | 4 | 6→8: `segovia1`'s 2 new instances are the known, deliberately-unguarded nested-align residue (PROGRESS §33.4), not a new mechanism |
| ~~--~~ | ~~`image.src.value`~~ | 19 | **0** | 1 | **all `news`, not `goya2` as this table said.** Now reference-inconsistency: the `/../` prefix is in no source and 1 of 22 references |
| 42 | `emphasis.span` | 24 | 7 | 6 | downgraded -- the 7 defects are a *different* mechanism. Probed for a URL-underscore artefact and cleared (session 2026-08-09) |
| 36 | `align.spurious` | 4 | 4 | 3 | 2 of `segovia1`'s 6 **closed** by PROGRESS §33; the rest are the one-row media table §22.2 killed **twice** |
| 33 | `table.cell.content.edited` | 33 | 0 | 2 | not a target |
| ~~--~~ | ~~`image.spurious`~~ | ~~8~~ | -- | ~~5~~ | **closed** by `55e7a8c` |
| ~~--~~ | ~~`retyped.paragraph-to-lead`~~ | ~~10~~ | -- | ~~2~~ | **closed** -- `06eeafb` removed the `::: lead` blocks |
| ~~--~~ | ~~`columns.missing`~~ | ~~1~~ | -- | ~~1~~ | **closed** -- `segovia1`'s footer, PROGRESS §33 |
| ~~--~~ | ~~`retyped.paragraph-to-column`~~ | ~~4~~ | -- | ~~1~~ | **closed** -- same fix |

Also carried: `pavlov_azancheev`'s `retyped.heading2-to-paragraph` at `/align[6]/paragraph[0]` is
new and **unadjudicated** -- the reference writes the article title as a centred bold paragraph, the
converter recovers a `##` (§25.1) · `borislova`/`jovicic` want a quote the recurrence gate declines
(`MIN_SUBORDINATED_BLOCKS` is 2, each has 1) · `frame`'s `title:` property unused · `new_kolpakov`
is the weakest document at L1 67.9, and PROGRESS §22.2 explains why that is a ceiling.

## 5. Instrument debt -- what to distrust, in order

0. **`link.label.content.empty` fires on labels that are not empty.** It reports `critical` when the
   produced label is `▶` and the reference's is a raw route -- 2 instances, `barrios` and `tarrega`,
   both after `55e7a8c`. The class name states a condition the finding does not meet, and a
   severity nobody has checked. Fix the class, not the converter.
1. **`src/eval/blocks.ts` has no setext case and `src/eval/facts.ts` does**, so L1 and L2 disagreed
   about the same file until §25.1 removed the only setext heading. The converter no longer emits
   one, but the L2 blind spot is still there and would misread any that appeared.
2. **The 0.5-0.95 `ambiguous` word-coverage corridor is set, not calibrated** -- 92 findings, the
   largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant
   behind the `containment` classes.
3. **The validator does not check `columns` ≥ 2 `column`**, which is a `BioMD-Reference.md` §2 MUST.
   Found while adjudicating the `williams2` wrapper (PROGRESS §21.5); recorded, not fixed.
4. **L3 reports `layout.align.mismatch` on blocks with no text** -- it did so on a `thematicBreak`,
   where alignment is meaningless. §25.2 removed that instance by fixing the converter; the
   instrument still asks the question.
5. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides*.
6. **L3 pairs by rendered text, deliberately independent of L2.** A block rewritten past 0.65
   similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
7. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
8. **No mutation harness.** `CLAUDE.md` §5 asks for one and it has never been built.
9. **L4 is not built.** Do not report an L4 number.
