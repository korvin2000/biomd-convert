# Operational patterns

Working knowledge this workflow depends on that is not stated in `CLAUDE.md` (the law), the
`CONVERTER-PROGRESS.md` campaign sections (the narrative), or `analyze/REFINE-CONVERTER.prompt.md` (the
brief). Killed *hypotheses* live in `CONVERTER-PROGRESS.md` under the section that killed them; what follows
is *method*.

## What each rung can and cannot see

Reading a null result from the wrong rung wastes an iteration, and reading a movement from the wrong rung
invents one.

| rung | sees | blind to |
|---|---|---|
| **L0** `npm test` | contracts, conservation, validator errors, 0-FAILED, identity | anything not asserted |
| **L1** `bench/run.sh` | seven multiset F1 axes: text, head, link, img, dirs, cells, shape | **every directive property, block quotes, block order, hard breaks, emphasis, typography, cell coordinates, link labels** |
| **L2** `biomd diff` | localized structural findings at full resolution, both sides quoted | rendering — it cannot say which of two layouts looks better |
| **L3** `biomd l3` | rendered geometry: containment, order, alignment, lanes | text content and spelling |

Consequences worth remembering: a block-quote change moves L2 and leaves L1 flat. A pure re-parenting moves
L3 and can leave L1 flat. A hyphenation change moves L2 and leaves L3 flat. **"L1 did not move" is not
evidence that nothing happened.**

## Instrument at runtime; never reason from the stylesheet

Every rule in this converter keys on *computed* style, and the source's declarations routinely do not survive
the cascade. Reading `.t8 { margin-left: 25 }` and concluding the block is indented is wrong — the value is
unitless, therefore invalid CSS, therefore dropped, and the computed inset is 0.

When a rule does not fire, add one line at the decision point, run one document, then remove it:

```ts
if (process.env["DBG_X"]) console.error(`[x] ${field}=${value} :: ${textOf(el).trim().slice(0, 40)}`);
```

```bash
DBG_X=1 node dist/cli/index.js convert fixtures/html/<name>.htm -c bench/biomd.config.json -o "$SCRATCH/probe.md" 2>&1 | grep '\[x\]'
```

Write the output into the session scratchpad, not `/dev/null`: this is Git Bash on Windows, where `/dev/null`
resolves to a **file named `nul` created in the working directory**. One has been committed to this repo by
accident already.

Three separate defects this campaign were invisible from the source and obvious in one such run: a detector
that was never called at all, a guard rejecting on a value the author had explicitly declared, and a
pre-filter skipping the node before the rule saw it.

**A pre-filter is part of the rule.** If a pass is gated by a cheap `test()` before the real pattern runs,
widening the pattern alone changes nothing and looks exactly like the rule being wrong.

## Two things a computed value cannot tell you

- **Intent.** `#000000` declared and `#000000` inherited are the same value. A rule that needs to know which
  one the author wrote must read `el.attrs["style"]` or the HTML attribute, not `el.style`.
- **A baseline, when the thing you are measuring dominates the page.** `bodyProminenceOf` samples the longest
  blocks; on a page that is an archive of quoted letters, the longest blocks *are* the letters, so the
  baseline becomes the quoted matter and every comparison inverts. Prefer a **contrast** test ("is there any
  ordinary prose to differ from?") over a **majority** test ("is most of the page like this?") — a majority
  test lets a dominant construct disqualify itself.

## The test harness does not measure

`convert()` falls back to `NullMeasurer`, which deliberately leaves `el.style` undefined rather than inventing
values. So any rule keyed on computed style — alignment, frames, subordination — **cannot be exercised
end-to-end by a plain `md()` test**, and a contract written against one silently tests the degraded
attribute-heuristic path instead.

`src/convert-core/recovery.test.ts` carries a stand-in measurer and an `mdMeasured()` helper for exactly this.
It fills in only what the element declares (`text-align`, `font-style`, the border longhands and shorthand) and
leaves everything else alone — a double that changes unrelated decisions is a second, worse cascade rather
than a stand-in for measurement. Extend it when a new rule needs a new computed property.

## Thresholds

Sweep before believing. A monotone curve means the number is doing real work; a **cliff** means it is masking
something. When raising a cap made L3 worse in one step and not the two before it, the cap was hiding a
missing exclusion — the fix was the exclusion, after which the sweep went flat and the exact number stopped
mattering. A number the result is insensitive to is a ceiling, which is the right shape for a limit; a number
the result is sensitive to is a discriminator, which should have been relational evidence instead.

## Reference revisions expire guards

When the user revises `fixtures/out/`, a guard's justification can disappear with it — the false friend a rule
was built around may now be the thing the reference does. Grep the code comments for the document that
changed. Two guards in this campaign were arguing against a reading the references had since abandoned.

## Editing discipline

Edit source with the `Edit` tool. Multi-line regex replacement through `node -e` has silently swallowed a
whole loop body here, producing a converter that emitted one byte per document — and the failure surfaced
several measurements later, not at the edit. If a scripted edit is unavoidable, re-read the touched region
afterwards.

Long-running commands: `npm run build` before `sh bench/run.sh` before `diff`/`l3`, always in that order.
`bench/out/` is a generated directory and is not tracked.

## A symmetry argument is not evidence — grep the contracts first

Three times in this campaign the same reasoning produced a real fix: *"this question is answered by evidence
on one path and by construction on another, so ask it everywhere."* Frames became notices in whichever path
reached them; subordination became subordination in whichever path reached it; a home question asked of one
side got asked of both.

The fourth time it was wrong. A DATA-classified table that cannot be *planned* falls to linear flow while an
UNKNOWN one is reconsidered as a layout region — the identical shape, and the identical argument. It was
implemented, and `recovery.test.ts` already carried a contract refusing it by name, with the rationale
written out: **losing a table to lanes is the defect this reconsideration would introduce.** The corpus
agreed — L1 dropped and three regression documents changed.

Before building on "these paths should agree", **grep the test files for the path you are about to change**.
An asymmetry with a named false friend and a test is a decision, not an oversight. The contracts in this repo
are where previous sessions recorded what they already tried.

## Test a conservation claim against stripped source text, never raw HTML

`new_lagq2` appeared to emit a track twice that the source contained once — until the same search ran over
the tag-stripped text, where both occurrences are present. Markup had split one of them. The same trap runs
the other way: a word that "vanished" is often intact and merely re-tokenized (`**E**vening`, `Villa-Lobos`).

`conservation.text.recall` is a **structure-similarity** measure, not a loss measure: it is built on word
shingles, and every shingle straddling a block boundary breaks when the converter legitimately splits a run.
One blind page reported 45.3 % recall with zero words, links or images missing. Read `targets.missing`,
`images.missing` and a word-level check before believing any recall figure.
