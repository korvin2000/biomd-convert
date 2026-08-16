---
name: refine-biomd-converter
description: "Explicitly invoked workflow for iteratively refining the existing biomd-convert HTML→BioMD compiler against its reference pairs. Run it with /refine-biomd-converter [description or paths of new or changed data]. Not for automatic activation — the user invokes it when they want a refinement iteration or want new/changed reference pairs folded into the corpus."
---

# Refine the BioMD converter

Improve the **existing** `biomd-convert` compiler against evidence. Never build a replacement, and
never repeat setup that `CONVERTER-PROGRESS.md` records as done.

**The objective is final conversion quality, not diagnostic counts.** Findings are sensors. The job
is to choose, at each step, the most valuable *solvable* path — which is rarely the largest number in
the ledger. In the last iteration **all five** top-ranked classes triaged were downgraded, while the
mechanism worth building sat at **rank 15** (PROGRESS §27). Plan; do not consume the queue.

## Invocation

```
/refine-biomd-converter
```

```
/refine-biomd-converter <paths or description of new or changed pairs>
```

## Authoritative sources — read, do not restate

| what | where |
|---|---|
| **navigation — read first, it routes the rest** | `.claude-memory/INDEX.md` |
| binding rules, invariants, the ladder | `CLAUDE.md` |
| normative BioMD Lite syntax and §-numbers | `BioMD-Reference.md` — the baseline profile |
| a BioMD rule the short reference leaves out | `Biography-Markup.md` — **fallback only**; where they differ the short reference governs |
| icon / micro-image → glyph policy and the known-icon map | `mini_images_to_md_guide.md` |
| campaign brief, phases, harness tips | `analyze/REFINE-CONVERTER.prompt.md` |
| measured state, killed hypotheses, what remains | `biomd-convert/CONVERTER-PROGRESS.md` |
| live frontier, decisions, open questions | `.claude-memory/OPEN.md` |
| current defect ledger (generated) | `analyze/defects.json` |
| human quality record (Russian) + page shots | `analyze/analyze.md`, `analyze/design.png` |
| the manual procedure behind the references | `html-to-biomd_guide.md`, `html-to-biomd_ext_guide.md` |
| **how to author, wire, run and refine an LLM hook** | `biomd-convert/docs/LLM-HOOKS.md` — read before §10 |
| source pages ↔ hand-made references | `biomd-convert/fixtures/html/*.htm` ↔ `fixtures/out/*.bio.md` |
| operational lessons this workflow depends on | `.claude/skills/refine-biomd-converter/learned-patterns.md` |

`CLAUDE.md` §3 invariants govern everything below. This file is the *procedure*; that file is the
*law*. Where this file refines `CLAUDE.md` §4's four-way triage it does so by subdividing it, never
by overriding it — the mapping is in **Classify every difference**.

---

## 0. Start

**Always first:** `.claude-memory/INDEX.md`, then `OPEN.md`, then the last two or three `##` sections
of `CONVERTER-PROGRESS.md`. They carry the rung numbers, corpus roles, live frontier, killed
hypotheses and author rulings. Do not re-derive any of it — and do not trust the numbers written
there. Verify by measuring.

**Skip what is recorded as done.** Bootstrap, the four instrument rungs, the L5 calibration and any
completed blind pass are finished work. Rebuild only what is stale:

```bash
cd biomd-convert && npm run build && sh bench/run.sh
```

`corpus scan` is needed only when `bench/corpus/corpus-profile.json` is absent or the corpus changed —
it rebuilds the lexicon and changes behaviour on every document.

**With arguments — new or changed pairs.** A reference edit moves L1/L2/L3 with no code change at all,
so **baseline before attribution**:

1. Identify exactly which pairs are new or changed (`git status`, `git diff` on `fixtures/`) and read
   the diffs — a revised reference has changed what counts as correct.
2. **Check the revision against the source before building on it.** An edited reference can carry text
   the source does not have; two of four recorded "reference disagreements" turned out to be mistakes
   (PROGRESS §23, §24.5). Quote the side-by-side to the user rather than working around it.
3. Honour the holdout, confirm the document count, run all four rungs, **record the new baseline**.
4. **Look for guards whose justification has expired.** A revised reference can delete the false friend
   a rule was built around, and can revive a candidate downgraded because that reference was its
   counterexample. Grep the code comments and `OPEN.md` for the document that changed.
5. Take a page that settles a standing question early and out of rank order.

## 1. What counts as better — the hard priority hierarchy

Lexicographic. A gain at a higher level justifies a loss at a lower one; the reverse never holds.

1. **Data preservation** — no text, link, image, target or reading order lost or invented.
2. **Semantic correctness** — the document means what the source means.
3. **Structural correctness** — outline, grouping, and relationships (figure↔caption, label↔list,
   cell↔row, heading↔body) intact.
4. **Major rendering/layout correctness** — lanes, regions, ordering, alignment as rendered.
5. **Broad deterministic improvements** — rules that generalize to the other ~987 pages.
6. **Reference fidelity** — agreement with `fixtures/out/`.
7. **Cosmetic similarity** — escaping, byte-level and invisible differences.

**Never trade 1–4 for 6–7.** Levels 1–4 are hard constraints on the regression corpus: a change that
loses data, breaks meaning, breaks structure or makes a rendered layout worse is rejected however
many findings it closes. Levels 5–7 are where tradeoffs are legitimate and expected.

Which rung answers which: **L0** gates 1–2 · **L2** is the evidence for 3 · **L3** is the evidence for
4 and the only rung that can say a layout got *worse* · holdout and rule contracts are the evidence
for 5 · **L1** is a tripwire for 6, never an objective.

## 2. Classify every difference

Every produced/reference difference gets exactly one label. Only the first four are regressions.

| label | meaning | `CLAUDE.md` §4 verdict |
|---|---|---|
| `data-loss` | content, target or order lost or invented | converter-defect |
| `semantic-error` | the output asserts something the source does not | converter-defect |
| `structural-error` | grouping, outline or relationship broken | converter-defect |
| `visual-regression` | rendered layout worse than source or reference | converter-defect |
| `neutral-variation` | different representation, equal rendering | acceptable-alternative |
| `visual-improvement` | differs from the reference and reads better | acceptable-alternative |
| `reference-quirk` | unsupported, inconsistent or editorial reference choice | reference-inconsistency |
| *(undecidable)* | deterministic evidence cannot decide | ambiguous |

**A reference mismatch is acceptable** when all of: no information lost · semantics correct · rendering
equal or better · the rule is deterministic and general · corpus-wide effects measured and acceptable.

## 3. Reference policy

References are strong evidence, **not** ground truth. They are hand-made, occasionally contradictory,
sometimes mistaken, and free to choose among representations the source does not determine. The corpus
contains document-specific, editorial and historically accidental choices, and the author has ruled
that some are aesthetic and non-binding in *both* directions (PROGRESS §26.2).

Estimate confidence before relying on one:

- **high** — source evidence *and* a repeated consistent pattern across documents.
- **medium** — plausible, incomplete, one or two instances.
- **low** — isolated, internally inconsistent, arbitrary, or visible only in the reference.

Decide in this order, stopping at the first step that settles it:

1. the source `.htm` — rendered and measured, never read off the stylesheet;
2. `BioMD-Reference.md`, then `Biography-Markup.md` where it is silent;
3. rendered quality (L3, the browser) — does it read as well as or better than the source;
4. what the rest of the corpus does with the same shape;
5. the reference;
6. a hook, a judge, or a batched question to the user — when it would affect a reusable rule or
   several documents. Decide minor local questions yourself.

**When fixture metrics disagree with rendered quality, rendered quality wins.** Do not reject a
deterministic visual improvement solely because it diverges from a reference. Do not chase a reference
whose confidence is `low`. **Never edit a fixture**; record confirmed author rulings in
`CONVERTER-PROGRESS.md` so no later session re-investigates them.

## 4. Corpus roles

`CONVERTER-PROGRESS.md`'s handoff section names current membership — read it there, it changes.

| role | job |
|---|---|
| **regression corpus** | the floor for priorities 1–4. Never regressed |
| **refinement set** | where the work happens |
| **holdout** | never read, diffed, scored or tuned against; measured once, at the end |

Preserving a holdout costs no code: `diff`, `l3` and `eval` skip any document with no reference. After
placing references, **confirm the document count the instruments report** — a holdout that quietly
rejoined the comparison is the one failure mode this has.

A class appearing only in the refinement set is a **generalization** finding; one spanning both sets is
a **rule** finding and outranks it.

---

## 5. The decision model

### 5.1 Candidates are a graph, not a queue

Nodes are candidate **root mechanisms**, not diagnostic labels. One label routinely hides several
mechanisms, and one mechanism routinely produces several labels — on `new_lendle2` a single missing
`frame` produced 18 findings across five classes, and the shadow classes outranked their own cause.

Edges worth recording:

```
A -> B      A may fix or reduce B
A <-> B     likely shared cause
A + B       synergy: cheaper or better together
A requires B  dependency
A subsumes B  the broader fix removes B entirely
A conflicts B regression or tradeoff risk
A ? B       suspected relation, worth a cheap probe
```

Prefer upstream mechanisms with broad downstream effects to isolated leaf symptoms.

### 5.2 The compact matrix

Keep roughly 5–10 live candidates. Coarse `L/M/H` or 0–3 ordinals. **Do not manufacture precise
numbers from weak evidence, and do not render this matrix into a report unless asked.**

```
candidate | severity | reach | P(fix) | direct gain | downstream gain | info value | effort | risk | ref-confidence | relations | status
```

### 5.3 Expected value

Guidance, not arithmetic:

```
EV ≈ P(success) × (direct gain + downstream/unlock gain) + information value − effort − regression risk
```

Then apply §1 lexicographically first: a priority-1 or -2 defect pre-empts EV ranking once confirmed.
Within a priority band, rank by EV.

**Information value is real.** A cheap probe that kills a plausible hypothesis, or reveals that a class
is an instrument artefact, is worth spending on even when the candidate is rejected — it removes work
from every future session. High uncertainty alone is not grounds for rejection when impact is high and
the probe is cheap.

### 5.4 Cost of failure

Score these separately; they behave differently:

- **failure-cost** — tokens lost if the hypothesis dies mid-investigation.
- **opportunity-cost** — better candidates delayed.
- **regression-risk** — probability × blast radius of damaging working behaviour.
- **lock-in-risk** — a local workaround that makes the later root fix harder. Weigh heavily.
- **ambiguity-risk** — source and reference evidence may never yield a general rule. This is what
  makes a large class worthless; probe for it early and cheaply.

A large class with low `P(fix)` and high investigation cost ranks **below** a small, highly solvable
root cause. A difficult candidate ranks **high** when it blocks several downstream improvements.

### 5.5 Root-cause preference

Before treating any finding as its own problem, ask:

- Which converter stage produced it? What upstream representation caused it?
- Which other findings share that code or data path?
- Could one general upstream fix remove several classes?
- Would fixing this make other planned work unnecessary?
- Is it a symptom, an instrument artefact, or a reference quirk rather than a defect at all?

Fix at the **earliest safe abstraction layer that explains several symptoms**. A false friend that
exists only because an earlier stage failed is a symptom: guarding against it downstream cements the
defect and hides it from every instrument.

---

## 6. Probe before commitment

**Never deep-investigate a candidate straight from the ledger ranking, and never survey a shape
corpus-wide before its fixability is established.** The survey is expensive and only earns its cost
once a mechanism is real.

A probe is 2–3 representative instances — different documents where possible, positive *and* negative
controls, defect *and* non-defect examples — plus a look at the shared producing code path and at which
other findings originate there. **The probe's objective is not to solve the candidate.** It answers:

1. Is there a real converter problem, or an instrument/reference artefact?
2. Is there one coherent mechanism, or several wearing one label?
3. Is a deterministic source signal plausible?
4. How trustworthy is the reference here?
5. Rough `P(fix)`, direct payoff, and what else this root cause touches.
6. Investigation + implementation + regression cost.
7. Is further investigation worth its token cost?
8. If no deterministic signal separates positives from negatives, **is the answer in the source at
   all?** Present but hard to read → still a rule. Genuinely absent → unreachable, or §10.

**Downgrade immediately** — do not investigate further — when the label combines unrelated mechanisms ·
the reference intent is ambiguous or its verdicts flip on identical evidence across documents · no
deterministic signal separates positives from negatives · it is primarily evaluator, reference or
calibration noise · a fix would need document-specific heuristics.

Of those five, only the last two may instead route to §10, and only on question 8's answer. **The
other three disqualify a hook as well.** A model cannot resolve a label that hides several mechanisms,
a reference that contradicts itself, or an instrument artefact — it will answer confidently and the
class will not move. A hook resolves ambiguity in the *source*; nothing resolves ambiguity in the
*reference* or in the *instrument*.

## 7. Lookahead

Before committing, compare **2–4 plausible short paths**, each 2–4 moves deep. Do not build an
exhaustive tree — lookahead must save tokens, not spend them.

```
A: fixes ~4 directly, likely unlocks B and C worth ~20   →  beats
D: fixes ~8, no downstream effect

A: 70% × +15, cheap probe                                 →  usually beats
B: 95% × +3, expensive implementation
```

Think bounded best-first search: keep several branches alive, probe uncertainty cheaply, pursue the
best expected path, and **re-evaluate after every new measurement**. Never continue a previously chosen
path once evidence has changed.

## 8. The loop

1. Refresh the frontier from a fresh ledger, `OPEN.md`, and anything the last measurement changed.
2. **Probe** the cheap unknowns (§6).
3. Update the matrix (§5.2) and the relation graph (§5.1).
4. Estimate `P(fix)`, downstream gain, reference confidence.
5. Compare 2–4 short paths (§7); choose the best expected path.
6. Deep-investigate **only its first actionable root mechanism**.
7. Now — and only now — survey that shape corpus-wide, including the instances the ledger did *not*
   raise, and note what each reference does with it.
8. Design the smallest general rule (§9); implement minimally.
9. Measure corpus-wide (§11).
10. Classify every movement: real gain, regression, or reference-only change (§2).
11. Keep or revert on the measurement, not the argument. Remove solved, subsumed and dead candidates.
12. Record the decision compactly (§12); update probabilities and relations; replan.

## 9. Designing the rule

Every rule carries a **rule contract** in the test file beside it. `CLAUDE.md` §5 states it in full —
invariant without literals, recurrence requirement, named false friend tested for non-firing, mutation
robustness. Three things this file adds:

- **Recurrence is not universal.** State it where the shape genuinely recurs and say so when it does
  not. It inverts the answer when the false friend recurs more often than the positive (PROGRESS
  §27.2), and it cannot apply to a construct that occurs once per page by definition. Where recurrence
  fails, reach for occupancy, containment or role instead.
- **Sweep any unavoidable threshold.** A **cliff** means the number is not the mechanism and something
  else is being masked; a flat curve means it is a limit, which is the right shape for one.
- **Many small composable passes** beat one universal rule; run new passes through `runPass`/`Ledger`
  so provenance and conservation stay auditable.

**Deterministic-first, not deterministic-only.** When the rule cannot be written because the *source*
does not state the answer, the fallback is a hook that supplies the missing judgement **to** a
deterministic rule — §10. Do not park a broad, high-value class indefinitely for want of an elegant
deterministic rule; equally, do not reach for a hook until §10.1's cheaper options are spent.

**Instrument at runtime; never reason from the stylesheet.** When a rule does not fire, add one debug
line at the decision point and run one document. A pre-filter is part of the rule: widening a pattern
behind a cheap early return changes nothing and looks exactly like the rule being wrong. See
`learned-patterns.md` — this has cost two iterations.

## 10. When a rule cannot decide — the hook path

The converter is already good with no model at all: every measured number in `CONVERTER-PROGRESS.md`
is taken **LLM-off**, and that is the number the project reports. A hook is a supplement for the small
residue of genuine judgement — classification, role, lineation — and never a shortcut past a rule that
is merely hard to write.

**Authoring contract: `biomd-convert/docs/LLM-HOOKS.md`.** Read it before writing one; do not restate
it here. This section is only *when* to reach for a hook, and how a refinement iteration handles one.

### 10.1 The rule is almost always the answer

Exhaust these first, in order. Most candidates that feel like they need judgement die at step 1.

1. **Look upstream** (§5.5). A block that "needs a model to classify" is usually a block an earlier
   stage misrouted. Fixing the misroute removes the question instead of answering it.
2. **A narrower rule with a named false friend** (§9) — relational evidence, containment, recurrence.
3. **Abstain, and leave a review item.** An honest abstention that reaches `Ledger.review()` is a
   legitimate ship state. It is better than a hook, because it is visible and costs nothing.
4. Only now, a hook.

**Anti-overuse budget.** At most one new hook per iteration, and never as the first response to a new
class. If an iteration produces two hook candidates, at least one of them is a rule that has not been
found yet — go back to step 1 for the weaker one. A hook is also the wrong tool for a class that is
large: breadth is what rules are for, and a per-item model call across the other ~987 pages is a cost
the deterministic path does not have.

### 10.2 The three entry tests gate the work, not the write-up

`LLM-HOOKS.md` §3.1 states them; all three must pass **on paper, before code**:

- **abstention** — name the state where the rule produced *no answer at all*, derived from the rule's
  own candidate collection. "Improving an answer a rule already gave" means the fix is the rule.
- **acceptance check** — name what stops a wrong reply before building anything. Watch the circular
  case: a check strong enough to catch the bad answer would have decided deterministically, and then
  the hook cannot exist.
- **visible failure** — prefer wrong answers that are noticeable. A wrong heading gets fixed; a
  corrupted word reads as fact. De-hyphenation and source-absent captions stay excluded (§16.3).

`LLM-HOOKS.md` §8 already carries four candidate categories with all three tests filled in, and two
shapes ruled out. Start there rather than re-deriving; if a candidate is not on that list, it has to
pass the tests from scratch before any code is written.

### 10.3 A hook feeds a rule — it does not replace one

This is the shape to build, and the architecture already enforces it: the reply is a **verdict against
stable ids** — a class name, a label list, a per-break boolean — and deterministic code in
`convert-core` decides what to do with it. Never Markdown, never a rewritten paragraph, never an
`href`.

So **design the consumer first**: write the deterministic rule that would fire if a human handed you
the label, and only then the hook that supplies the label. Two things fall out of that ordering —

- if the consumer cannot be written without the label, the abstention is named correctly;
- if the consumer *is* the reply applied verbatim, it is a rewriter, not a hook, and the framework
  will not run it.

The seam: `DecisionPoint` in `src/convert-core/decisions.ts`, declared beside the abstaining rule,
carrying `accept` — deterministic, and **the last word**. The plugin is a directory,
`src/llm/plugins/<name>/` = `hook.ts` + `prompts/*.md` + `hook.test.ts`, discovered from the
filesystem. There is no list of hook names and no CLI flag per hook.

### 10.4 Enabling, disabling, and what gets reported

- **Every hook ships `enabledByDefault: false`, and the default-enabled set is empty** — pinned by
  `src/llm/plugins/plugins.test.ts`, which also asserts no discovered plugin declares otherwise. A hook
  that turns itself on fails the build, not the corpus.
- **The config file is `bench/biomd.config.json` for bench work**, or whatever `-c` names; the hook
  block is `llm.hooks` (`enable`, `disable`, `defaults`, `overrides.<id>`, `paths`). `biomd config init`
  emits an annotated template. Enabling a hook there is a **conversion change** and belongs to a
  measured run — never a convenience left switched on afterwards.
- **`llm.enabled: true` does not enable a hook.** It builds a transport; the hooks that run are the
  ones an operator named. `--llm assist` with nothing named is byte-identical to `--llm off`,
  unconditionally — re-verify that after touching the framework.
- **All adjudication is LLM-off.** `bench/run.sh` uses `bench/biomd.config.json`, which pins
  `"llm": { "enabled": false }`. L1/L2/L3, `defects.json` and every PROGRESS number stay on that side.
  Never report a hook-on number as the project number; label the delta separately (`CLAUDE.md`).
- Current state: `table.classify` and `table.records` are wired but off; `text.segment` is migrated,
  has no escalation site, and is **inert** — `hooks list` says so. That is a report, not a bug.

### 10.5 Turning one on, and measuring it

**On the fly, for one run — this is the tuning loop, and it touches no file:**

```bash
cd biomd-convert && node dist/cli/index.js convert fixtures/html/<name>.htm -c bench/biomd.config.json -o out.md --llm assist --hooks table.classify -v
```

`--hooks <ids>` is comma-separated and enables **exactly** those for that run; `--no-hooks` forces all
off; `--replay` allows only cached decisions and never reaches the network. An unknown id is a startup
error, not a silent no-op. Both flags exist on `convert` and `corpus run` only — **not** on
`hooks list`, which reports what the *config* resolves to, so it cannot preview a `--hooks` run.

**Persistently, for a campaign** — `llm.hooks.enable` in the config file (§10.4), which is also the
only way to set per-hook policy. Resolution order, later wins:
`enabledByDefault` (now always false) → `llm.hooks.enable` → `--hooks` → `--no-hooks` →
`llm.hooks.disable` (`"*"` = everything) → `llm.hooks.overrides.<id>.enabled`.

**Inspecting and refining:**

```bash
cd biomd-convert && node dist/cli/index.js hooks list -c bench/biomd.config.json
```

Every hook, whether it is on, whether its decision point is **wired**, and which setting decided.
Then `hooks show <id>` for rendered prompts, template hashes and resolved policy;
`hooks test <id> -i item.json` for one item — **dry by default**, `--live` to actually call;
`hooks cache-clear <id>` after any prompt edit.

A refinement round: `hooks show` → edit `prompts/system.md` → `cache-clear` → `hooks test -i` a few
items → one document with `--hooks <id>` → corpus with `--hooks <id>` → compare to the LLM-off
baseline. Escalate the scope only while the previous step looks right; a bad prompt is cheapest to
catch on one item.

Four traps, in the order they bite:

- **An LLM-on corpus run through `bench/biomd.config.json` overwrites `bench/out/`**, and `eval`,
  `diff` and `l3` all read whatever is there. Every later reading then reports hook-on output as the
  baseline. Use a separate config with its own `outDir`, or re-run `bench/run.sh` immediately after.
- **Prompt edits are cache-keyed** — the template hash travels in the request, so an edited prompt is
  a different question. A re-measure that comes back byte-identical usually means the prompt did not
  reach the run, not that it did nothing.
- **`--replay` must reproduce byte-identically** (invariant 6). A hook that breaks determinism under
  replay is rejected whatever its quality.
- **Read the escalation tally in `report.json`** — accepted / refused / abandoned, with reasons. A
  hook whose replies are mostly refused has either a bad prompt or a wrongly-named abstention, and the
  refusal reasons say which. Do not weaken `accept` to raise the acceptance rate.

### 10.6 Accepting one

On top of §11, all of these:

- **the LLM-off output is byte-identical to before** — a hook must not move the deterministic baseline;
- L0 clean, including the pinned default set and a contract that feeds `accept` the
  **plausible-but-wrong** verdict and asserts it refuses (that test lives with `decisions.ts`);
- with the hook on, a real gain at some §1 priority *on the items that escalate*, and no priority 1–4
  loss anywhere;
- `--replay` byte-identical; the gate closes on the cases not worth a call; call count and cost
  bounded and stated;
- it ships **disabled**, and the record says what turning it on is worth.

Reject or revert when `accept` had to be weakened to let replies through · most replies are refused ·
or the only gain is at **priority 6**, reference fidelity — a hook that buys nothing but agreement
with a fixture is not worth its cost.

## 11. Measurement and acceptance

Targeted, while developing — one document, one class:

```bash
node dist/cli/index.js diff -c bench/biomd.config.json --doc <name> --class <prefix> -v
```

```bash
node dist/cli/index.js l3 -c bench/biomd.config.json --doc <name> -v
```

Full acceptance, once, when the candidate is ready. **Rebuild → re-run bench → then adjudicate**;
every L2/L3 reading taken against a stale `bench/out/` is wrong.

```bash
cd biomd-convert && npx tsc -p tsconfig.json --noEmit && npm test
```

```bash
cd biomd-convert && sh bench/run.sh
```

```bash
cd biomd-convert && node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json
```

```bash
cd biomd-convert && node dist/cli/index.js l3 -c bench/biomd.config.json
```

**Acceptance is by net outcome under §1, not by every metric improving.** Each rung is blind to what
the others see — read `learned-patterns.md` before concluding "no effect" from any single one.

Accept when: L0 is clean and 0 FAILED · no priority 1–4 loss on the regression corpus · a real gain at
some priority level · every loss classified and stated. A change may legitimately raise L2 or lower L1
while improving structure or rendering — say which classes moved which way and why, per document.
"The average improved" is not a report, and neither is "nothing regressed" without the classification.

**Never hide a tradeoff.** State it with its label from §2 and the measurement that decided it.

This whole sequence is **LLM-off** — that is what `bench/biomd.config.json` pins, and what the accepted
numbers mean. A hook is measured separately and additionally, against this baseline, under §10.5–10.6.

## 12. Records — write once, cheaply

- Regenerate `analyze/defects.json` after an accepted change whose findings may have moved.
- **`.claude-memory/OPEN.md`** carries the live frontier, one line per candidate:
  `candidate | mechanism | evidence | P(fix) | value | cost/risk | relations | status`.
  Rejected branches keep enough evidence to prevent rediscovery, and nothing more.
- **`CONVERTER-PROGRESS.md`** gets the durable result when a mechanism closes, a milestone lands or a
  hypothesis dies: measured numbers, what was implemented, what remains reachable, what is provably
  unreachable, killed hypotheses, author rulings. Batch this at the end of an iteration — it is the
  most token-expensive step in the loop.
- Commit verified work at meaningful checkpoints, **one conceptual change per commit**, with the
  measured before/after on every rung in the message. Independent changes may share one acceptance run
  and be committed separately; changes that depend on each other may not share a run.
- A hook that ships gets its abstention, acceptance check and measured on/off delta recorded — and a
  hook candidate that **failed** an entry test is worth more: record which test and why, so the next
  session does not re-derive it. Hook rejections belong in `OPEN.md` like any other killed branch.
- Never carry a defect count into this skill or into a rule as a permanent assumption.

## 13. Token discipline for the planning itself

The decision process must stay cheaper than the work it directs. Do **not**:

- survey every diagnostic before prioritising, or survey any shape before its fixability is shown;
- derive precise scores from weak evidence, or render the matrix into prose for a report;
- re-read settled investigations, or re-prove a rejected hypothesis — a killed hypothesis reopens on
  new **measurement** only, never on argument;
- optimise the prioritisation model instead of the converter.

Bounded reconnaissance: route through `.claude-memory/INDEX.md`, read `CONVERTER-PROGRESS.md` by line
range, never end to end. Scratch scripts and probes belong in the session scratchpad, never in the repo.

## 14. Lessons this skill exists to encode

- **High finding count ≠ high fixability or value.** The ledger's rank measures what an instrument
  noticed, not what work is available. `break.missing` was five mechanisms, `retyped.paragraph-to-lead`
  an author ruling, and the whole §27 top five downgraded on cheap probes.
- **One label can hide several mechanisms**, and one mechanism can cast several labels as shadows that
  outrank their own cause.
- **Reference inconsistency creates artificial ceilings.** A class whose verdicts flip on identical
  evidence across documents cannot be worked.
- **Some findings are instrument artefacts** — a phantom class, a parser that reads one construct two
  ways, a severity label nobody checked.
- **Some valid improvements deliberately differ from the reference.**
- **Expensive surveys before fixability is proven waste context.**
- **Requiring every metric to improve is too strict**; requiring priorities 1–4 to hold is not.
- **Locally attractive fixes lose to upstream fixes with downstream leverage.**
- **Check the instrument before the rule** — attested five times in this campaign.
- **A model cannot answer a question the source never asked.** Hooks fail on reference contradictions
  and instrument artefacts exactly as rules do — they merely fail confidently. A previous generation of
  the subsystem shipped twenty-one hooks, seven enabled, three of which re-decided questions rules had
  already answered (`LLM-HOOKS.md` §5). Assistance is monotonic in safety only while it stays inside an
  abstention.

## Never

- build a replacement converter, or redo bootstrap, instruments or investigations recorded as done;
- read, diff, score or tune against the **holdout**;
- tune `src/eval/score.ts` or any instrument to move a number, or let any instrument become the
  objective; instruments change only to become *more truthful*, in isolated declared steps;
- write a corpus-specific string, class, id, filename or title into a detector — lexical knowledge
  lives in documented, language-tagged data files and degrades gracefully;
- trust a reference, an evaluator or a severity label without checking it against the source;
- accept a loss at priority 1–4 on the regression corpus, however many findings it closes;
- re-open a killed hypothesis on argument rather than on new measurement;
- edit `biomd-convert/fixtures/**`, `analyze/*.md` or `analyze/*.png`;
- buy speed with a fixture-specific patch, a weakened validator or a silent reference edit;
- reach for a hook before §10.1 is spent, enable one by default, let one run where a rule already
  decided, let one emit text/targets/Markdown instead of a verdict, or weaken an `accept` check to
  raise its acceptance rate;
- adjudicate, baseline or report the project's numbers with hooks on, or leave hook-on output sitting
  in `bench/out/` where the next `eval`/`diff`/`l3` will read it as the baseline;
- report a number that was not measured or a completion that was not verified.
