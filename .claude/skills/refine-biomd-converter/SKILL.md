---
name: refine-biomd-converter
description: "Explicitly invoked workflow for iteratively refining the existing biomd-convert HTML→BioMD compiler against its reference pairs. Run it with /refine-biomd-converter [description or paths of new or changed data]. Not for automatic activation — the user invokes it when they want a refinement iteration or want new/changed reference pairs folded into the corpus."
---

# Refine the BioMD converter

Improve the **existing** `biomd-convert` compiler one mechanism at a time, against evidence.
Never build a replacement converter, and never repeat setup that `CONVERTER-PROGRESS.md` records as done.

**Optimise for converter quality gained per unit of work.** Take the biggest shared structural defects and
the nearly-free fixes first; leave the middle — moderate effort, one document, no visible difference — for a
closing fine-tuning phase that has not started yet.

## Invocation

```
/refine-biomd-converter                      # continue from the recorded state
/refine-biomd-converter <paths or description>   # fold in new or changed reference pairs first
```

## Authoritative sources — read, do not restate

| what | where |
|---|---|
| **navigation — read first, it routes the rest** | `.claude-memory/INDEX.md` |
| binding rules, the ladder, triage, rule contracts | `CLAUDE.md` |
| normative BioMD Lite syntax and §-numbers | `BioMD-Reference.md` — the baseline profile |
| a BioMD rule the short reference leaves out | `Biography-Markup.md` — **fallback only**, stricter; where the two differ the short reference governs |
| icon / micro-image → glyph policy and the known-icon map | `mini_images_to_md_guide.md` |
| campaign brief, phases, harness tips | `analyze/REFINE-CONVERTER.prompt.md` |
| measured state, killed hypotheses, what remains | `biomd-convert/CONVERTER-PROGRESS.md` |
| current defect ledger (generated) | `analyze/defects.json` |
| human quality record (Russian) + page shots | `analyze/analyze.md`, `analyze/design.png` |
| the manual procedure behind the references | `html-to-biomd_guide.md`, `html-to-biomd_ext_guide.md` |
| source pages ↔ hand-made references | `biomd-convert/fixtures/html/*.htm` ↔ `biomd-convert/fixtures/out/*.bio.md` |
| operational lessons this workflow depends on | `.claude/skills/refine-biomd-converter/learned-patterns.md` |

`CLAUDE.md` §3 invariants and §4 triage govern everything below. This file is the *procedure*; that file is the *law*.

## What counts as better

In this order. The order is the whole policy — everything below is how to spend effort against it.

1. **No content lost, none invented** — text, links, images, targets, reading order.
2. **Valid BioMD that renders** — a document a consumer can parse and a reader can navigate.
3. **Coherent structure** — an outline that matches the page, groupings that hold, relationships
   (figure ↔ caption, label ↔ list, cell ↔ row, heading ↔ body) intact.
4. **Layout intent preserved** where BioMD can express it — ordering, relative position, lanes, alignment.
5. **Generalizes** to the other ~987 pages and to any structurally similar corpus.

Byte-agreement with a reference, pixel fidelity and imitating every human editorial choice are **not** on
this list. They are evidence about 1–5 and never the target.

Which rung answers which: **L0** gates 1–2 · **L1** is a tripwire only · **L2** is the evidence for 3 ·
**L3** is the evidence for 4 and the only rung that can say a layout got *worse* · the holdout and the rule
contracts are the evidence for 5.

## Corpus roles

Three sets with different jobs. `CONVERTER-PROGRESS.md`'s handoff section names the current membership —
read it there, it changes; this table is what each role *means*.

| role | job |
|---|---|
| **regression corpus** | the floor. Its recorded L0/L1/L2/L3 may not be regressed by any accepted change |
| **refinement set** | where the work happens: rank, adjudicate and fix here |
| **holdout** | untouched. Never read, diff, score or tune against it; measure it once, at the end |

**Preserving a holdout costs no code**: `diff`, `l3` and `eval` skip any document with no reference file, so
keeping its `.bio.md` outside `expectedDir` is sufficient. Keeping the `.htm` out of the scanned directory too
is stronger but costs the blind conservation/validation signal. Whichever arrangement is in force, after
placing references **confirm the document count the instruments report** — a holdout that quietly rejoined the
comparison is the one failure mode this has.

A class that appears only in the refinement set is a **generalization** finding. One that spans both sets is a
**rule** finding and outranks it — the regression corpus is evidence too, not just a gate.

## Start

**Always first:** read the last two or three `##` sections of `CONVERTER-PROGRESS.md`. They carry the current
rung numbers, the corpus roles, the ranked open classes, the killed-hypothesis list and the "open, in order"
queue. Do not re-derive any of it, and do not treat the numbers written there as still true — verify by
measuring.

**Skip what is recorded as done.** Bootstrap, the four instrument rungs, the L5 calibration and any completed
blind pass are finished work. A killed hypothesis is not re-openable by argument — only by new evidence that
contradicts the measurement that killed it. `CONVERTER-PROGRESS.md` lists them for exactly this reason.

Then rebuild only what is missing or stale:

```bash
cd biomd-convert && npm run build && sh bench/run.sh
```

`bench/out/` is regenerated by `bench/run.sh` and goes stale the moment you rebuild — **every L2/L3 reading
taken against a stale `bench/out/` is wrong.** Rebuild → re-run bench → then adjudicate. `corpus scan` is
only needed if `bench/corpus/corpus-profile.json` is absent or the corpus changed; it feeds the lexicon.

### No arguments — continue

Re-rank from a fresh ledger (**Priorities**, below) and take the best candidate. The progress file's "open,
in order" queue is the previous session's ranking: use it as a shortlist and as the record of what is
blocked, not as the answer.

### With arguments — new or changed pairs

**Baseline before attribution.** A reference edit moves L1/L2/L3 with no code change at all.

1. **Identify** exactly which pairs are new or changed (`git status`, `git diff --stat` on
   `biomd-convert/fixtures/`). A user who revises references has changed what counts as correct — read the
   diffs before touching code.
2. **Honour the holdout**, confirm the document count, run all four rungs, **record the new baseline**.
3. **Look for guards whose justification has expired.** A revised reference can delete the false friend a
   rule was built around. Grep the code comments for the document that changed.
4. Where the progress file names a document that settles an *open question*, take it early and out of rank
   order: a page that can falsify a standing assumption beats a page with more instances.

**Evaluate three things together, never two.** Source `.htm`, produced `.bio.md` and reference `.bio.md`. Two
of the three can agree and still both be wrong about the third; the source is what adjudicates, and the
reference is strong human evidence that is nonetheless fallible. `inspect` for what the front half saw,
`diff` for structure, `l3` for rendered geometry, the browser for the source itself.

## Priorities — choosing what to take next

**Rank by expected useful gain per unit of work, not by defect count.** The ledger's
`instances × severity × generality` is one input, not the answer: it counts findings, and a finding is a proxy
an instrument computed. Re-rank from a fresh ledger after every accepted change.

```bash
node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json
```

### Pre-empts everything, once confirmed

A FAILED conversion · content lost or invented · BioMD that does not validate or does not render · badly
wrong reading order · a major layout structure collapsed (a table flattened to prose, lanes lost, a region
emitted as loose paragraphs).

**Confirm cheaply before investing.** A severity label is the instrument's opinion. Open the produced document
once and look: `paragraph.missing` topped the ledger with ten instances whose text was all present
(PROGRESS §14.1), and `conservation.text.recall` reports 45 % on documents that lost nothing (§16.2).

### Three queues, roughly 60 / 30 / 10

**A — Strategic, ≈60 %.** Mechanisms that sit **upstream** — decoding, normalization, chrome removal,
routing, table classification, grouping, region and lane formation, heading recovery, media binding — or that
span many documents, cause visible structural damage, close several downstream classes at once, or unblock
other work. Before fixing a symptom, ask which earlier stage produced it.

**B — Quick wins, ≈30 %.** Cheap, source-evidenced, low-risk, measurable. **Batch related ones** into one
acceptance run: what these cost is verification, not implementation.

**C — Instrument and reference maintenance, ≈10 %.** Only when an instrument defect changes a ranking or a
verdict, blocks validating a real change, or a reference makes a target impossible. Never a project of its
own — and never a change that moves a number rather than making the instrument more truthful (`CLAUDE.md` §3.2).

Guidance, not quotas.

### Work the ends of the distribution, not the middle

Highest impact regardless of cost, and near-zero cost regardless of impact. **The middle is what to defer**:
moderate effort, one document, no visible difference. Fine-tuning is the closing phase of the campaign, not
this one.

Normally defer while shared structural work remains — single-document classes · byte, escaping and spelling
differences · anything with no visual or content consequence · classes that close a handful of findings and
unblock nothing. Exceptions: it is nearly free, it is a genuine correctness violation, or it is a clue to a
shared root cause.

### The ROI estimate

Score the top few candidates on small ordinals (0–3) and take the best ratio. The point is to make the
comparison explicit, not to pretend the arithmetic is real:

```
        visible impact × documents × classes it could close × upstream leverage × confidence it is real
ROI  ≈  ─────────────────────────────────────────────────────────────────────────────────────────────────
                             implementation cost × regression risk
```

A mechanism that explains several apparent classes outranks the largest single class. **Confidence is a real
term**: a class nobody has looked at yet scores 1, not 3. **Upstream leverage is the term that pays** — three
of the five mechanisms in PROGRESS §24 were one shared component treating one page differently, and each
general fix was smaller than the special case would have been.

## The loop — one conceptual change per commit

Not one per *iteration*. Independent quick wins may share a full-acceptance run; if the batch moves the wrong
way, bisect it. What may never share a run is a change that depends on another.

1. **Adjudicate before writing code.** For each finding in the candidate class ask `CLAUDE.md` §4's four
   questions and keep only the first verdict:
   - **`converter-defect`** — content lost, BioMD violated, source structure misread, or a worse layout. **Work.**
   - `acceptable-alternative` — different from the reference, same intent, visually equal or better.
   - `reference-inconsistency` — the reference made an unsupported or inferior editorial choice.
   - `ambiguous` — deterministic evidence cannot decide. Hook or judge territory, or a question for the user.

   Test **both sides against the source**, never the produced side alone. When the produced side is attested
   and the reference side is not, the reference is the thing that moved.

2. **Survey the shape corpus-wide before designing the rule.** Find every instance of the *source* shape, not
   only the ones the ledger raised, and note what each reference does with it. This is the cheapest step in
   the loop and skipping it is the most expensive mistake available: the wrapped-masthead rule was designed
   from three instances, and the four it had not looked at regressed three documents in one run (§24.1). A
   `grep` over `fixtures/html/` costs a minute; a regression costs a re-design.

3. **Diagnose upstream before adding a guard.** A false friend that exists only because an earlier stage
   failed is a symptom; guarding against it downstream cements the defect and hides it from every instrument.
   Walk the pipeline in order — routing (which region path was taken), grouping (what the region produced),
   neighbourhood (containment, sibling order, recurrence), only then the element. When a rule does not fire,
   **instrument it at runtime**; never reason from the stylesheet — see the sibling `learned-patterns.md`.

4. **Design the rule** to `CLAUDE.md` §5: a relational invariant with no literal, a recurrence requirement, a
   named false friend tested for non-firing, and mutation robustness. Prefer containment, adjacency, sequence,
   recurrence, geometry, ordering, occupancy, typographic role and semantic role — combinations of them, not
   one signal — over any absolute threshold. Where a threshold is unavoidable, sweep it: a **cliff** means the
   number is not the mechanism and something else is being masked.

5. **Falsify cheaply, and cheapest first.** Name the competing explanations, then find the one measurement
   that separates them: an env toggle around the suspected line, a one-document run with the candidate
   disabled, a threshold sweep, one `DBG_X` probe. A hypothesis that survives because it was never contrasted
   is the most expensive kind. **Effort box:** if two or three probes have not produced a measurement that
   could kill the hypothesis, the mechanism is not ready — return it to the queue with what was learned and
   take the next one. Do not enumerate theoretical edge cases before knowing the mechanism is useful.

6. **Deterministic-first, not deterministic-only.** Reach for the production hooks in
   `biomd-convert/src/llm/hooks.ts` (`table.classify`, `table.records`, `text.segment`) when the source is
   malformed or structurally ambiguous, several conversions stay plausible, correct reconstruction needs
   semantic interpretation, or a deterministic rule would have to become fixture-specific to work. Every hook
   stays schema-validated, budgeted, cached, replayable and **non-authoritative**: it proposes, a
   deterministic check accepts or rejects, the rejection path is tested, and disabling it still yields sane
   output. Adjudicate with LLM off; measure any LLM-on delta as a separate labelled run. **Do not park a
   broad, high-value class indefinitely** because it has no elegant deterministic solution — a hook with a
   named acceptance check beats leaving it open.

7. **Targeted checks while developing** — one document, one class:

```bash
npx vitest run src/convert-core/recovery.test.ts -t "<contract name>"
node dist/cli/index.js diff -c bench/biomd.config.json --doc <name> --class <prefix> -v
node dist/cli/index.js l3   -c bench/biomd.config.json --doc <name> -v
node dist/cli/index.js inspect fixtures/html/<name>.htm
```

8. **Full acceptance once, when the candidate is ready** — all four rungs, in this order:

```bash
cd biomd-convert && npx tsc -p tsconfig.json --noEmit && npm test   # L0
sh bench/run.sh                                                     # L1 + 0 FAILED conversions
node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json   # L2
node dist/cli/index.js l3 -c bench/biomd.config.json                # L3
```

   Each rung answers a different question and is blind to the others — read `learned-patterns.md` before
   concluding "no effect" from any single one. L2 and L3 are diagnostic only; `convert-core` must never
   import them, and no instrument may become the objective.

9. **Keep or revert on the measurement, not on the argument.** A change that raises L2 may still be right —
   say which classes moved which way and why, per document; "the average improved" is not a report. Record
   what died in `CONVERTER-PROGRESS.md`; several of this project's largest defects were found only because a
   plausible first explanation was falsified.

10. **Re-rank** and take the next item.

## References are expert labels, not ground truth

Hand-made, occasionally contradictory, sometimes mistaken, and free to choose among representations the source
does not determine. **When structurally equivalent sources get different references, do not invent two
incompatible rules to reproduce both.**

Decide in this order and stop at the first step that settles it:

1. the source `.htm` — rendered and measured, never read off the stylesheet;
2. `BioMD-Reference.md`, then `Biography-Markup.md` where the short reference is silent;
3. rendered quality (L3, the browser): does it read as well as or better than the source;
4. what the rest of the corpus does with the same shape;
5. the reference;
6. a hook, a judge, or a question to the user — batched, with a concise side-by-side — when it would affect a
   reusable rule or several documents. Decide minor local questions yourself.

Where several representations are visually equivalent, emit the **canonical** one and record the rest as
acceptable alternatives. Invisible Markdown differences, escaping and minor reference inconsistencies are
acceptable alternatives when the rendered result is equivalent or better — do not chase them.

**Never modify a reference fixture.** Record every confirmed author ruling in `CONVERTER-PROGRESS.md` so no
later session re-investigates it (§23 and §24.5 are the precedent — two of four recorded "reference
disagreements" turned out to be a stale index entry and a reference mistake).

L1 (`bench/run.sh`) is a silent-regression tripwire, never a per-change objective. ≈98 % is the project's
acceptance ceiling, not a score to maximise.

## Checkpoints

- Regenerate `analyze/defects.json` after an accepted change whose findings may have moved.
- Update `biomd-convert/CONVERTER-PROGRESS.md` when a defect class closes, a milestone lands, or a durable
  result is discovered — in the style already there: measured numbers, what was implemented, what remains
  reachable, what is provably unreachable, plus the killed-hypothesis list. Batch the write-up at the end of
  an iteration rather than after every commit; it is the most token-expensive step in the loop. Never carry a
  defect count into this skill or into a rule as a permanent assumption.
- Commit verified work at meaningful checkpoints, one conceptual change per commit, with the measured
  before/after on every rung in the message.

## Never

- build a replacement converter, or redo bootstrap, instruments or investigations already recorded as done;
- read, diff, score or tune against the **holdout**;
- optimise the scalar score, or tune `src/eval/score.ts` or any instrument to move a number;
- write a corpus-specific string, class, id, filename or title into a detector;
- trust a reference, an evaluator or a severity label without checking it against the source;
- accept a change that regresses the regression corpus, however much it improves a new page;
- re-open a killed hypothesis on argument rather than on new measurement;
- edit `biomd-convert/fixtures/**`, `analyze/*.md` or `analyze/*.png`;
- buy speed with a fixture-specific patch, a weakened validator or a silent reference edit — the policy above
  is aggressive about *what to work on*, never about what may be skipped;
- put changes that depend on each other into one acceptance run;
- report a number that was not measured or a completion that was not verified.
