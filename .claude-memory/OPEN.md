# OPEN — live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history — history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-08**, after PROGRESS §27. Facts marked
*measured* were taken then; facts marked *recorded* are quoted and have not been re-measured.

---

## 1. Where we are, and the exact next step

Reference-guided refinement, 22 documents. **One mechanism accepted this iteration** (PROGRESS
§27) after cheap triage downgraded four of the five top-ranked classes. All four rungs improved;
`new_lendle2` is the only document that moved.

**Current state, *measured* 2026-08-08 (PROGRESS §27):**

| rung | value |
|---|---|
| L0 | **424 tests**, typecheck clean, 0 FAILED |
| L1 | **93.2 %**, clean share 13.6 % |
| L2 | **413 findings — 238 converter-defect** · 92 ambiguous · 83 reference-inconsistency |
| L3 | **92 findings** (11 critical), identity 0, deterministic |
| validator | 28 errors, all `table-header-empty` — PROGRESS §21.4 |

That is the floor. Nothing accepted from here may regress it.

> **Two environment traps.** `sh bench/run.sh` needs Chromium (`visual: always`) — run
> `npx playwright install chromium` or every document reports "no output produced". And this repo
> carries a multi-pack-index git 2.45 cannot read; `git config core.multiPackIndex false` unblocks
> it. **`corpus scan` is still required after a fresh clone** — §24.4 changed the chrome
> fingerprint and a cached `bench/corpus/corpus-profile.json` from before it makes `news` regress.

**Next: go document-first, not class-first.** `news` (45 defects) and `goya2` (44) are a third of
the whole ledger and neither has ever been attacked *as a document*. Enumerate one of them by node
path, not by class, and look for the shared container defect — that is exactly how §27.2 found
`new_lendle2`'s missing frame, which took it from third-worst to mid-table in one change.

**Downgraded in §27.1, do not take on rank alone:** `emphasis.span` (verdicts flip on identical
evidence across documents; 25 of 34 already reference-inconsistency) · `image.spurious` (five
different reference treatments of one source shape) · `align.missing`,
`retyped.paragraph-to-align`, `paragraph.containment` (**shadow classes** — they fire at the same
node paths as the missing container that causes them, and outrank their own cause).

Off the queue entirely: `retyped.paragraph-to-lead` (author ruling §26.2), `image.size.value`
(§25.4), 7 of `break.missing`'s 10 (§25.3).

> **The rank column measures what an instrument noticed, not what work is available.** Four of the
> last five classes taken from the top were ceilings, shadows or several mechanisms wearing one
> name. §27 spent twenty minutes triaging five classes and found the mechanism worth building at
> **rank 15**. Triage 2–3 instances *before* surveying, always.

---

## 2. What this iteration settled

### 2.0 A panel drawn with a background tint is a frame

`new_lendle2` writes `border: 1 solid #D5A96F` on five album panels — **unitless**, so Chromium
drops the shorthand and computes `border-style: none`. The tint (`rgb(252,243,216)` on the page's
`rgb(247,231,175)`) is the only evidence left, and `paletteFor` already maps it to the `white` the
reference names. **Occupancy is the invariant, not recurrence**: `goya2` tints fifteen cells the
same way and its reference frames none — they are `width="50%"` lane cells, while `new_lendle2`'s
are `colspan="2"` and own their row. Recurrence would invert the answer. The fallback had to move
*ahead* of the `border-style: none` early return — the pre-filter trap, hit twice now. One missing
frame had been producing 18 defects across five classes. PROGRESS §27.2.

### 2.1 A heading is one line — at every depth

`headingPhrasing` folded only top-level `break`s, and `dropEmphasis` runs after it and lifts a
`strong`'s children back out — so `<b>Title<br></b>subtitle` produced the corpus's one **setext
heading**. `eval/blocks.ts` read the 89-hyphen underline as a thematic break, `eval/facts.ts` read it
as a heading, `read()` warned about nothing, CommonMark made it an `h2` swallowing the line above.
`foldBreaks` recurses. Fifth instrument-shaped defect of the campaign. PROGRESS §25.1.

### 2.2 A drawn rule is a line, and a rule may join an alignment run

§24.3's `* * *` rule keyed on "the whole *block*"; `<br>` is how this era ended a line inside a
block, so `kiselev`'s `-------------------------<br>Олег Киселев: …` was unreachable and shipped as
`\-------------------------`. The unit is now the line. Placing it needed the second half: a
`thematicBreak` carries no text so it cannot *nominate* an alignment, but `blocksFrom` already
records its source element's alignment on it, and the blanket exclusion in `alignableRunMember`
hoisted it out of the block it divides. It may now join a run and never open one; a run with no
text-carrying member is emitted bare. PROGRESS §25.2.

### 2.3 Still open, unchanged: mini-image → glyph

`mini_images_to_md_guide.md` defines a 29-entry known-icon map; `src/` implements none of it. The
references use numeric character references in 10 of 22 documents. `glyphs.ts` holds `LINK_GLYPH`
and `RULE_GLYPHS`, so the map has a home and two neighbours. One divergence to settle: the guide
maps *next* to `&#9654;` (▶) while `new_bach` uses `&#9658;` (►).

---

## 3. Answered by the reference author — do not re-investigate

1. **A recovered centred section label gets a bare `##`; the centring is dropped.** *Ruled
   2026-08-08.* The `::: align` wrapper is for a **split headline**, where it is what makes
   consecutive `#` lines one heading, and for nothing else. The converter already does this, so no
   code changed. `goya2`'s `align.missing` + `heading.containment` at `/align[71]` and `new_bach`'s
   `retyped.heading2-to-align` are `reference-inconsistency`. PROGRESS §24.5.
2. **`new_blackmore`'s masthead split point** — settled deterministically in the browser: the source
   draws two line boxes at 26.7 px and 16 px, and the reference moves one word across that boundary.
   Reference-inconsistency; two minor `heading.content.edited` remain. PROGRESS §24.5.
3. **`::: lead` is aesthetic, not structural, and the ruling is symmetric.** *Ruled 2026-08-08.*
   Applied when every paragraph opens with a highlighted initial, or when the article is built from
   long paragraphs that read better broken up — and applied to **one document only**, so its absence
   elsewhere is deliberate. A `lead` discrepancy in **either** direction is visual, not a fidelity
   defect: emitting one where a reference has none is not a regression if it reads better. The
   converter emits `lead` nowhere and that stays correct. All 10 findings are off the queue; the
   measurements that rule out typography, length and position are in PROGRESS §26.3, so do not
   re-derive them.

## 4. Open defect classes — *measured* 2026-08-08 over 22 documents

| rank | class | inst | docs | note |
|---:|---|---:|---:|---|
| 120 | `retyped.paragraph-to-list` | 10 | 4 | blocked on a hook design (PROGRESS §15.2); 7 are `kiselev` |
| 90 | `emphasis.span` | 34 | **10** | **downgraded §27.1** — verdicts flip on identical evidence |
| 90 | `align.spurious` | 6 | 5 | 3 are the one-row media table §22.2 killed **twice** |
| 84 | `image.size.value` | 21 | 4 | **not a threshold** — table in PROGRESS §25.4 |
| 84 | `image.spurious` | 7 | 4 | **downgraded §27.1** — five reference treatments of one shape |
| 84 | `align.missing` | 4 | 3 | **shadow class** §27.1; was 7/4 |
| ~~60~~ | ~~`retyped.paragraph-to-lead`~~ | 10 | 2 | **off the queue** — author ruling §26.2, visual-only both ways |
| 60 | `break.missing` | 10 | 6 | decomposed (§25.3); 7 of 10 not targets |
| 57 | `image.src.value` | 19 | 1 | all `goya2` — mechanical, single-document |

Also carried: `pavlov_azancheev`'s `retyped.heading2-to-paragraph` at `/align[6]/paragraph[0]` is
new and **unadjudicated** — the reference writes the article title as a centred bold paragraph, the
converter recovers a `##` (§25.1) · `borislova`/`jovicic` want a quote the recurrence gate declines
(`MIN_SUBORDINATED_BLOCKS` is 2, each has 1) · `frame`'s `title:` property unused · `new_kolpakov`
is the weakest document at L1 67.9, and PROGRESS §22.2 explains why that is a ceiling.

## 5. Instrument debt — what to distrust, in order

1. **`src/eval/blocks.ts` has no setext case and `src/eval/facts.ts` does**, so L1 and L2 disagreed
   about the same file until §25.1 removed the only setext heading. The converter no longer emits
   one, but the L2 blind spot is still there and would misread any that appeared.
2. **The 0.5–0.95 `ambiguous` word-coverage corridor is set, not calibrated** — 92 findings, the
   largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant
   behind the `containment` classes.
3. **The validator does not check `columns` ≥ 2 `column`**, which is a `BioMD-Reference.md` §2 MUST.
   Found while adjudicating the `williams2` wrapper (PROGRESS §21.5); recorded, not fixed.
4. **L3 reports `layout.align.mismatch` on blocks with no text** — it did so on a `thematicBreak`,
   where alignment is meaningless. §25.2 removed that instance by fixing the converter; the
   instrument still asks the question.
5. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides*.
6. **L3 pairs by rendered text, deliberately independent of L2.** A block rewritten past 0.65
   similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
7. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
8. **No mutation harness.** `CLAUDE.md` §5 asks for one and it has never been built.
9. **L4 is not built.** Do not report an L4 number.
