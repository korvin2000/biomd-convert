# OPEN -- live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history -- history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-13**, after PROGRESS §51.
Facts marked *measured* were taken then; facts marked *recorded* are quoted and not re-measured.

- [1. Where we are, and the exact next step](#1-where-we-are-and-the-exact-next-step)
- [2. Closed -- the spec was amended, not the converter](#2-closed----the-spec-was-amended-not-the-converter)
- [3. Answered by the reference author -- do not re-investigate](#3-answered-by-the-reference-author----do-not-re-investigate)
- [4. Open defect classes](#4-open-defect-classes----measured-2026-08-12-after-45)
- [5. Instrument debt -- what to distrust, in order](#5-instrument-debt----what-to-distrust-in-order)

---

## 1. Where we are, and the exact next step

Reference-guided refinement, **28 sources / 26 compared**. The author added six `xtra_` pairs and
promoted the old holdout into the corpus; §42 recalculated everything, landed two table mechanisms
and refilled the holdout.

> **28 sources convert; 26 are compared.** `xtra_karta5` *is* the former holdout `new_karta5`
> (byte-identical reference, CRLF-normalized source), promoted by the author into the corpus. The
> holdout was refilled the same day with **`xtra_oyanguren`** and **`xtra_mikulka`**: only their
> *references* moved, to `fixtures/out2/`, so both are still converted, validated and inside the
> conservation gate while being invisible to L1/L2/L3. **`l3` must print 26 and `bench/run.sh` must
> still convert 28** — that pair of counts is the leak detector. PROGRESS §42.1, §42.8.

> **Two things moved the baseline with no code change**, and both must be quoted or the numbers read
> wrong: commit `92b7e67` *"fixed reference files"* landed after §41 and edited 16 references (the
> original 22 alone went L2 141/67 → 106/56, L3 44 → 25); and the six new pairs added 299 findings on
> arrival. PROGRESS §42.2.

**Current state, *measured* 2026-08-13, after PROGRESS §51:**

| rung | value |
|---|---|
| L0 | **739 tests**, typecheck clean, 0 FAILED, conservation ok, `read()` warnings 0 |
| L1 | **98.6 %** over the 26 compared |
| L2 | **320 findings -- 198 converter-defect** · 28 ambiguous · 94 reference-inconsistency · 9 critical |
| L3 | **59** over 26 documents, identity 0, deterministic |
| validator | **0 errors on all 28 produced documents**, holdout included |
| **946 unlabelled** | **0 FAILED**, 0 validator errors, lost targets **0**, lost images **0** |
| **wrap hyphens surviving** | **6 over 6** of the 946 (was 167/108); **0** of the 28 produced (was 7/7) |
| **word fusions** | **0** on the 946 (was 24/16 docs) and **0** on the 28 produced (was 2) |

> **L2's total has risen 10 across §50 and §51 while converter-defect fell 199 → 198.** The added
> findings are `paragraph.hyphenation.joined` (6, §50) and the word-boundary spaces (§51) — all
> triaged **ambiguous** or **reference-inconsistency**. Both sections state their tradeoff as a
> priority-6 loss bought with a higher-priority gain. Quote the split or the number reads as damage
> that did not happen.
>
> **The 9th critical is `barrios`, and it is `ambiguous`, not a defect** — a one-space footnote
> difference reported at `critical` because that is `paragraph.content`'s blanket severity. Instrument
> debt, listed in §5 below.

**Next:** **`layout.containment.mismatch`, 13 instances over 9 documents** — the broadest untouched L3
class and the rung that answers priority 4. `new_karta` carries 3 of them plus 3
`layout.align.mismatch`. Then the isolated instrument-truthfulness step (§51.6 items 2–3).

> **Every conservation loss in the corpus is closed (§47).** The only `severity: error` diagnostic
> left on the 946 is `complexity-budget`, on **90** documents — a plan/lint threshold whose
> provenance is unchecked (§46.9 item 6), not a BioMD validator error. It rose 89 → 90 because
> `assad_b` now emits the discography it was deleting.

That is the floor. Nothing accepted from here may regress it.

> **There is a fifth corpus role now: `fixtures/gen_corpus/`, 946 sources with no references**
> (PROGRESS §46). Disjoint from the 28 — the 15 pages the `new_*`/`xtra_*` fixtures came from sit in
> `fixtures/aaaaaaaaaaaaaaa/`. It is **blind by construction**: nothing can be tuned to a page that
> has no reference, so it is a better generalization signal than a two-document holdout. One scan is
> ~2.5 min with Chromium at 4 jobs; run it every iteration. Its numbers are conservation, validator,
> FAILED count, routing outcome and cross-document consistency — never a similarity score, because
> there is nothing to be similar to.
>
> **Per document the reference set is 4–5× richer in table evidence than the corpus it stands for**
> (`DATA`→table 46 % vs 10.5 %, `::: columns` 50 % vs 11 %, `frame` 18 % vs 4 %). Weight accordingly.

> **141 of the 199 are recorded divergences and quirks, not work.** `xtra_shelechov` ~96,
> `xtra_karta5` 42, `new_kolpakov` 3 (§43.5). The honest open count is **~58**. Quote the split or the
> ledger reads as a collapse in quality that did not happen.
>
> **The 8 criticals remain only in the two recorded-divergence documents** (`xtra_karta5` 6,
> `xtra_shelechov` 2); none gained a converter mechanism in §45.

**`npm install` before anything** — §41's `dictionary-ru`/`nspell` optional deps are not in a fresh
clone and `tsc` fails on the missing declarations. That is a build failure, not a degradation.

**Landed in §43, one commit each.** A numbered strip is one value, not several columns (`4f6e048`;
`xtra_albeniz` → **L1 100.0 on every axis**, L2 criticals 14 → 8) · an empty row at the foot of a
table is bottom margin (`0826f53`; `new_karta` L1 95.9 → 98.0, 6 → 5 defects,
`retyped.columns-to-table` → 0).

**Landed in §44.** Standalone images keep their own computed right/distinctive-centre placement or a
floated one-column figure ancestor; floated multi-column grids and the left prose baseline are false
friends. `image.position.value` **2 → 0**, L2 317/206 → **315/204**, L3 65 → **61**, L1 flat 98.6.

**Landed in §45.** A short full-row tinted record label may bypass the 20-character frame floor only
when the same palette/occupancy role recurs in the same table with populated content between labels.
The one-off archive/menu label and repeated half-row catalogue cells remain false friends.
`new_lendle2` gains its fifth frame: L1 99.3 → 99.8, L2 11/7 → 6/2, L3 4 → 2;
corpus L2 315/204 → **310/199**, L3 61 → **59**, overall L1 flat 98.6.

**Landed in §46, one commit each.** A figure never swallows a link (`558eafd`): `otherContent`
measured text, and a link whose whole label is a control glyph has none, so every footer pager whose
middle marker is unlinked lost **both arrows and both destinations at 100 % text recall**.
`hasOrphanTarget` counts a target as content and asks containment, so the linked thumbnail still
becomes a figure. · An unlinked icon in a strip of linked ones is a control too (`120e7b8`):
`inControlStrip` promotes the pager's current-page marker, which can never have an `<a>` ancestor.
· The mutation harness `CLAUDE.md` §5 has always asked for (`e0cdf3a`).
**946 pages: lost targets 17 → 1, lost images 19 → 3, 12 documents changed and no others.
The 26 are byte-identical — the shape occurs in none of the 28 reference sources.**

> **Start a table iteration with the routing survey, not the ledger (§43.2).** One
> `convert … | grep '^Tables:'` per source prints `CLASS→table[r×c]` / `CLASS→flow(failure)`, which is
> the only view showing a table's *outcome* beside its *class*. Both §43 mechanisms came out of it and
> neither was near the top of the ledger; one was on a document the defect column called clean.
> **§46.5 generalizes it into a consistency instrument:** reduce every table to the classifier's own
> view (class, tier, rounded score vector) and a view with more than one *outcome* is an inconsistency
> by construction. 3332 tables, 62 views, **7 split, 32 minority decisions** — no reference needed.

**Landed in §47, one commit each.** A list with no items is not a list (`e4513f9`): `listFrom`
skipped every non-`li` child silently, so FrontPage's indent `<ul>` deleted `assad_b`'s whole
discography — table, 3 covers, 23 of 194 shingles — at 88 % recall. · A merged nav anchor is
accounted for, not lost (`d442c63`): `navFromGrid` folds two same-href anchors into one link by
design, and the multiset gate read the folded one as dropped; `williams1`'s "lost target" was never
lost. · A picture lane beside a lane of matter is a lane (`a251a96`): `planDataTable` refuses a
`media-lane` grid *because* it is §16.1's text-beside-a-cover, then the router flattened it anyway.
**946: lost targets 1 → 0, lost images 3 → 0. The 26 are byte-identical on all three rungs.**

> **The first version of the media-lane rule was too wide and cost `goya2` 20 findings in one run**
> (3 → 23 converter-defects) — a *gallery* has no worded lane to pair covers with and its reference
> writes `::: images`. **L1 did not move at all**: `goya2` sat at 99.5 on both sides. The two
> refusals are now told apart by name, `media-lane` vs `media-catalog`, not by degree.

**Landed in §50, one commit each.** A break the language forbids is still a break (`c5f37bc`): rule 6
required a legal Hyphenopoly break *and* dictionary membership, and the break position is the 1998
typist's choice, not the language's — rule 6b puts the second signal on the fragments instead (a wrap
cuts one word into pieces that are not words; a compound joins two things that are). · A break markup
put in a box of its own (`75b9b24`): `изда<span lang="en-us">-</span>вал` splits the word across three
IR nodes, so no node holds a hyphen between two letters and the pre-filter skipped every one.
**946: surviving wrap hyphens 167 → 6; the 28 produced 7 → 0; 115 documents changed and every applied
edit is a hyphen removal.**

**Landed in §51, one commit (`1e91d58`).** A word boundary hidden inside inline markup survives.
`<i>Доменикони </i>Карло` fused two words because Markdown cannot write `*x *`; the space is now
hoisted out of the delimiters at three sites — a mark's edge, a transparent `<span>`/`<font>` wrapper
one level down, and a mark holding nothing but whitespace (`<em> </em>`, which also emitted an
unclosed `**`). **Only across a word boundary**, and the references chose that cut: letter-to-letter
they keep the space 3 to 1, against punctuation they drop it 27 to 1.
**946: word fusions 24 → 0, 74 documents changed, recall up on 49 and down on none.**

> **The wide form was built first and measured wrong.** Hoisting at every boundary took `new_lagq2`
> from L1 100.0 to **45.6** on its text axis and the corpus from 98.6 to 98.0 — its 26
> `<i>COMPOSER </i>- Work` rows each gained a space the reference does not have. Narrowing to the word
> boundary restored it. **Sweep the boundary condition, not just the threshold.**

**Next, in order. Probe before committing (SKILL §6).**
0. **Nothing table-shaped is both open and general *among the 26*.** §43.9 still holds there — and the
   post-§51 routing survey leaves the corpus question exactly where §47.6 did: `DATA`→flow is **27
   `too-small` + 5 `media-lane` + 3 `media-catalog` + 3 `cell-crosses-band`**, `LAYOUT`→flat flow
   **2048** against 14 `::: columns`, `UNKNOWN`→flat flow **974** against 56.
   **§51.2 closed the `LAYOUT t2` 17-against-15 split**: it is a page shell on one side and an inner
   region on the other, both correct, and the classifier view carries no geometry to tell them apart.
1. **The proper-name hyphenation tail, §50.6 — the one open item with reference backing.**
   `Бориславовна` (`borislova`), `Феррере` (`news_2007`), `аккомпанементов` (`xtra_shelechov`) are
   still `paragraph.hyphenation.unjoined` **converter-defects**: the reference joined and we did not.
   Hunspell rejects all three, and rule 4 cannot help because the lexicon indexes exact forms
   (`lex(joined)=0`). A stem-tolerant lexicon lookup is the next signal; measure its false-friend rate
   first. Corpus counterparts: `Чайковского` ×3, `Петропавловске`.
2. ~~**A layout fallback for an unplannable DATA table.**~~ **Downgraded in §50.1 — stop returning to
   it.** Probed four times now. `too-small` is 27 instances in four unrelated shapes: `1×3` 7, `1×2` 7,
   `1×4` 3, `1×5` 1, and 9 that are a one-column table where flattening is correct. §48/§49 took the
   coherent caption subsets. Do not widen `isSingleRecordRow` or use text length: both have recorded
   counterexamples. `LAYOUT t2` splitting flat against `::: columns` remains the only live form of the
   question.
3. **`paragraph.missing.in-paragraph` is downgraded, 3 → 2.** `new_lendle2` was the known
   directive-property parser artefact and dissolved when its frame returned. `new_lagq2` and
   `news_2007` visibly contain the named value on both sides and each has L3 0; no missing-data or
   shared converter mechanism remains. Fix the evaluator only in an isolated truthfulness step.
4. ~~**`williams1.htm`** and **`assad_b.htm`**~~ — **both closed in §47**, and neither was the
   diagnosis §46.9 wrote down: `williams1` had lost nothing (the gate was counting a deliberate
   merge), and `assad_b`'s three covers were the visible corner of a whole deleted discography.
   **Read a conservation finding as a pointer, never as the defect.**
5. **`retyped.paragraph-to-align`: probe `segovia` alone.** The other four are the twice-killed
   glyph/footer family. `segovia` is a long italic quotation shifted by `margin-left: 140`, not the
   same signal; decide whether the current `align` is a visual regression before touching code. §44.1.
6. **The shell-depth root cause, PROGRESS §40.6** — the "one table is the page shell" constant is
   wrong on 8 of 22 and load-bearing in five rules. Three replacements built, all three reverted on
   measurement. Start from `headingLineOf`.

**No open author question.**

**The two-document holdout is still spent (§43.7), and §46 needed none.** The 946 unlabelled pages are
blind by construction — no reference exists for any of them, so nothing can be tuned to them. Use the
gen-corpus scan as the generalization signal instead of naming a new holdout; it is strictly stronger.

**Do not re-take these; §37-§43 settled them.** Everything §41's list named, plus:
`xtra_rodrigo`'s score table and its two work titles · `segovia`'s work title · `xtra_karta5`'s
bumblebee strip, its merged score table (1-to-1, §43.6) and its heading convention (author-ruled) ·
`xtra_shelechov`'s row-major grid (8-to-1, and its interior empty rows are the grouping evidence).

**Killed in §37-§43** -- reopen on new measurement only: everything §41's list named, plus
**cell content weight as the per-row/grid discriminator** (§42.4 — falsified by `news_2007`) ·
**raising `planDataTable`'s `maxCols`** (§42.5 — `xtra_karta5`'s Sor table is a legitimate six-column
matrix) · **every wholly empty row is padding** (§43.4 — interior empty rows are separators; the
general form cost L1 98.5 → 96.0 and 8 → 13 criticals) · **column alignment from a right-placed
table** (§43.5 — 13 documents wrap a table in `<div align="right">` and 12 references write `| - |`).

**Killed in §51** — reopen on new measurement only:
**`LAYOUT t2`'s 17-against-15 routing split is a converter inconsistency** (§51.2 — instrumented at
the decision point: the flow side is the page shell, `w=[116,529,115]` with `pageRailColumns` finding
rails `{0,2}`; the columns side is an inner content region with no rails. Both correct. The classifier
view carries no geometry, so a split view is evidence about the *view* as often as about the
converter) ·
**`xtra_karta5`'s four table criticals are available work** (§51.1 — `xtra_rodrigo`'s reference writes
`| **Ноты**\*\* | I. | […] | [zip] |`, the four-column score strip the converter produces. §43.6's
recorded ceiling holds, this time read rather than quoted).

**Killed in §50** — reopen on new measurement only:
**the adjacent title/caption echo is a defect** (§50.1 — 141 of the 174 produced echoes are the
portrait caption repeating the document title, and `fixtures/out/barrios.bio.md` writes exactly that
shape; 6 mid-document echoes remain, in 6 different shapes on 6 documents) ·
**`::: align` sometimes wraps nothing** (§50.1 — the probe was misreading a `Location: …` body line as
a property line; `read()` over all 946 reports 0 empty directive nodes and 0 warnings) ·
**§41.3's "weakening the two-signal gate trades residue for corruption"** (§50.3 — the gate was never
weakened; one of its two signals measured the wrong thing. 131 simulated joins, not one a compound,
and the one true false friend `лит-ре` is refused by the replacement signal).

**Killed in §47** — reopen on new measurement only:
**every `media-lane` refusal is a lane** (§47.4 — `goya2` 3 → 23 converter-defects in one run. A
gallery, where *every* column is bare covers, has no worded lane to pair them with, and its
reference writes one `::: images` row. The narrow form that survived requires a picture lane **and**
a matter lane, and excludes a resource matrix by the same test the tier-1 DATA gate uses).

**Killed in §46** — reopen on new measurement only:
**low text recall means data loss** (§46.6 — `baden_powell2` is a cover gallery with 193 characters of
visible text and loses nothing; recall's denominator includes the chrome the converter is meant to
remove, so it is not comparable across pages of different text volume. `new_lagq2` sits at 45.25 % in
the *reference* set with L1 99.8. Never read recall as loss without checking the page's text budget) ·
**the 946-page chrome model caused the pager loss** (§46.6 — byte-identical with the 28-page profile;
one command) · **`new_page.htm`'s 0.00 % recall is a defect** (§46.6 — it is the author's blank
template and converts correctly).

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

## 4. Open defect classes -- *measured* 2026-08-12 after §45

**Read the ceiling column first.** Recorded divergences and quirks account for 141 of the 199
converter-defects; see PROGRESS §42.4, §43.5 and §43.6 before treating any large class here as
available work.

| rank | class | inst | defect | docs | note |
|---:|---|---:|---:|---:|---|
| 87 | `column.containment` | 29 | 29 | 1 | **ceiling** — `xtra_shelechov`'s row-major grid, 8 references to 1 |
| 75 | `retyped.paragraph-to-align` | 5 | 5 | 5 | **split mechanisms.** 4 are the twice-killed glyph/footer family; `segovia` is a long italic quotation shifted by margin (§44.1) |
| 66 | `retyped.column-to-paragraph` | 22 | 22 | 1 | **ceiling** — same divergence |
| 58 | `table.align` | 29 | 29 | 2 | **ceiling, both documents** — `xtra_karta5`'s 26 author-ruled ignorable; `new_kolpakov`'s 3 killed on a 12-to-1 sweep (§43.5) |
| 48 | `paragraph.spurious.in-table` | 16 | 16 | 1 | **ceiling** — `xtra_karta5`'s name-in-header-cell |
| 24 | `column.missing` · `columns.spurious` · `column.spurious` | 8 · 5 · 3 | | 1 | **ceiling** — same divergence |
| 24 | `retyped.align-to-paragraph` | 4 | 4 | 2 | `goya2`'s author-declared alternative (§37.8) |
| 21 | `emphasis.span` | 23 | 3 | 7 | downgraded; §39.6.2 has the cause. Do not implement |
| 20 | `break.spurious` | 20 | 20 | 1 | **ceiling** — the rules between `xtra_shelechov`'s programme rows |
| 18 | `paragraph.containment` | 6 | 6 | 1 | `xtra_shelechov` divergence; `new_lendle2` shadow closed in §45 |
| 15 | `table.row.missing` | 3 | 3 | 1 | **ceiling, checked in §43.6** — the source holds two `<table>`s, `xtra_karta5`'s reference merges them, `xtra_rodrigo`'s does not. 1 to 1 |
| 12 | `paragraph.missing.in-paragraph` | 2 | 2 | 2 | **evaluator/placement artefacts; downgraded §45.1** |
| 12 | `link.inline.missing` · `retyped.paragraph-to-list` | 2 each | 2 | 2 | the tail; `align.missing` is now 1 |
| -- | ~~`table.cell.content`~~ | 6 -> **0** | 0 | 0 | closed by §43.3 — was 6 of the corpus's 14 criticals |
| -- | ~~`retyped.columns-to-table`~~ | 1 -> **0** | 0 | 0 | closed by §43.4 |
| -- | ~~`align.spurious`~~ | 26 -> **2** | 2 | 1 | closed by §42.5; one more shadow dissolved in §45 |
| -- | ~~`paragraph.missing.in-table`~~ | 3 -> **0** | 0 | 0 | closed by §42.6 |
| -- | ~~`image.position.value`~~ | 2 -> **0** | 0 | 0 | closed by §44 — computed placement + floated one-column figure containment |

Per document, converter-defect: `xtra_shelechov` 101 (**~96 ceiling**) · `xtra_karta5` 50
(**42 ceiling**) · `new_rechin4` 5 · `new_karta` 5 · `news` 5 · `new_kolpakov` 4
(**all 4 ceiling**) · `news_2007` 4 · `segovia` 3 · `goya2` 3 · `new_lendle2` 2 · rest <= 3.
`authors`, `barrios`, `new_bach`, `new_dyens`, `segovia1`, `williams2` and **`xtra_albeniz`** are at
**0**. `xtra_rodrigo` is at **1** and at **L1 100.0 on every axis**.

**The holdout is spent.** Measured once at the end of §43, exactly as §42.8 intended:
`xtra_oyanguren` 3 findings / 3 defects, `xtra_mikulka` 2 / 2 / 2 L3 — unchanged, both §43 rules
neutral there. §44 and §45 had no holdout.

**Closed in §48:** one-row DATA grid holding one standalone image beside text that substantially
repeats its source-backed image label. The converter now binds the visible text as that figure's
caption. Corpus reach: exactly `bogdanovic`; text recall 98.44% -> 100%, directives 4 -> 3, no
target/image/validator loss. Seven contract tests cover positive, mutation and false-friend shapes.

## 5. Instrument debt -- what to distrust, in order

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
