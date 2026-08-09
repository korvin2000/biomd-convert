# Validation

> Compression without verification is vandalism.

Run cheapest first. Each layer catches a different loss channel, and no single layer is sufficient.
Read this at stage 8.

- [The ladder](#the-ladder)
- [Layer 1: static checks](#layer-1-static-checks)
- [Layer 2: semantic probes](#layer-2-semantic-probes)
- [Layer 3: idempotency](#layer-3-idempotency)
- [Layer 4: behavioural A/B/C](#layer-4-behavioural-abc)
- [Reviewer discipline](#reviewer-discipline)
- [Scoring rubric](#scoring-rubric)
- [Fail and rollback](#fail-and-rollback)
- [Coverage matrix](#coverage-matrix)

---

## The ladder

```text
1 static checks      seconds   scripts/verify.py            mandatory, every run
2 semantic probes    minutes   model, no repo context       mandatory above `safe`
3 idempotency        seconds   run the pass twice           mandatory, every run
4 behavioural A/B/C  hours     real tasks, three arms       when the file governs real work
```

Stop climbing when the remaining risk is smaller than the cost of the next layer — and say in the
report which layers you ran and which you did not. An untested high-impact field is a finding, not
a silence.

## Layer 1: static checks

```bash
python scripts/verify.py --work WORKDIR --after FILE... --plan WORKDIR/plan.json --json result.json
```

| Check | Catches | Cannot catch |
|---|---|---|
| Anchor diff, both directions | missing or changed commands, paths, IDs, URLs, versions | a preserved command under the wrong condition |
| Anchor invention | fabricated commands, paths and thresholds | a fabricated *claim* carrying no new literal |
| Prohibition survival | a NEVER-rule with no match in the output | a prohibition whose scope silently widened |
| Modality weakening | MUST or NEVER downgraded to a hedge | synonym-level softening |
| Route resolution and pitch | broken links, bare paths with no what+when | a valid target that is now irrelevant |
| Reference depth | chains that need two hops to reach content | — |
| Unsupported control syntax | imaginary frontmatter, `@include`, transclusion | harness-specific keys this profile has not seen |
| Structure | unterminated fences, unparseable frontmatter | syntax validity is not fidelity |
| Budgets | platform hard limits still exceeded | nothing about meaning |

The anchor rule is absolute in both directions:

```text
before_anchors - after_anchors  ->  empty, or every loss listed in the plan with a reason
after_anchors  - before_anchors ->  empty, except paths the approved plan created
```

An unexplained addition is a hallucination and fails the run. Losses go in `plan.json` under
`released_anchors`, each with a reason in `released_reason` — that turns "it disappeared" into "we
decided", which is the whole difference between compression and damage. Do not type that list by
hand: `python scripts/verify.py --work WORKDIR --after DRAFT --emit-plan WORKDIR/plan.json`
scaffolds `released_anchors` from what a draft already dropped, leaving only the reasons to write.

## Layer 2: semantic probes

Static checks see literals. Probes see meaning. Give a fresh model the **compressed file only** and
compare against the original.

**Fact recall.** Generate 15–30 questions from the *original*, answer them from the *compressed
file alone*. Must-keep facts require 100%. Cover: every hard prohibition and approval gate, each
path or platform condition and its exceptions, exact commands and output shapes, representative
precedence cases, when to stop / verify / retry / escalate, and which reference answers a given
task prompt.

**Rule enumeration.** The single most valuable probe, because it catches *silent omission* — rules
that are present in the text but dropped under instruction load, which is the dominant failure mode
and the only signal that tells you whether you are over the instruction budget rather than the
token budget.

```text
Read this file. List every rule you would follow while working in this repository,
one per line, in the order you would prioritize them. Do not add rules of your own.
```

Run it against the original and the compressed file, then diff the two lists. A rule that appears
for the original and not for the candidate is a real loss even if the sentence is still on disk.

**Route location.** Give a task prompt that needs relocated material and check the model finds the
right reference from the route alone. This is the only honest test of a stage-6 move.

Probes are coverage tools, not proof. Rotate the questions between runs, and trace every answer
back to a ledger row — otherwise the compressor quietly overfits the probe set.

## Layer 3: idempotency

```bash
python scripts/verify.py --idempotency first_run.md second_run.md
```

Run the whole pass again on its own output. The second run must be byte-identical. Continued
shrinkage means generational loss, unstable classification or ratio chasing — and a non-idempotent
pass also thrashes the prompt cache and produces diffs nobody can review.

## Layer 4: behavioural A/B/C

```text
A = agent + original docs
B = agent + compressed docs
C = agent + NO docs               <-- never omit this arm
```

Same harness, model version, reasoning setting, tools, sandbox, tasks and grader. Enough runs to
expose variance.

| Outcome | Reading |
|---|---|
| `B > A` | compression improved signal-to-noise. This is a real and repeatedly observed result |
| `B = A` | cheaper equivalent — ship it |
| `B < A` | over-compression, or a bad restructuring |
| `C >= A` | **the original docs were unnecessary or harmful.** Say so; that is the most valuable finding available |

Measure task success and functional correctness, hard-rule compliance and unsafe actions, steps and
tool calls and retries, input/output/reasoning tokens where exposed, wall time, re-reads and
rediscovery, and route activation accuracy.

```text
Primary metric:  cost per successful, policy-compliant task
Compression ratio is a diagnostic, not the objective.
```

## Reviewer discipline

If a second model reviews the diff, give it the original, the candidate, the ledger, the diff **and
the static-check results**, and instruct it to *find losses*, not to rate prose. Name the
unacceptable loss classes explicitly: dropped behavioural rule · removed threshold or exact value ·
lost edge-case branch · over-generalised instruction · broken cross-reference · invented content.

A different model reduces correlated failure; it does not remove it. Never treat a single LLM judge
or a similarity score as proof of preservation.

## Scoring rubric

Report every row. Fidelity rows gate; efficiency rows inform. The ordering is deliberate.

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Anchor loss | 0 unapproved | — | any |
| Invented anchors | 0 | — | any |
| Must-keep fact recall | 100% | — | <100% |
| Prohibitions preserved | all | — | any missing |
| Unresolved conflicts surfaced | all | — | any silently resolved |
| Idempotent on second run | yes | — | no |
| Broken routes | 0 | — | any |
| Unpitched links | 0 | 1–2 | ≥3 |
| Reference depth | 1 | 2 | ≥3 |
| Unsupported control syntax | 0 | — | any |
| Expected always-loaded tokens | reduced | unchanged | increased |
| Token reduction | context only — **never a pass/fail gate** | | |
| Imperative count | reported, never gated | | |

There is no imperative-count gate on purpose. Published budgets for always-on instructions span a
5× range and measure different things; substituting a fabricated cap for a missing measurement is
exactly the metric theatre this skill is supposed to detect. Count them, report them, flag a large
jump, and move on.

## Fail and rollback

Fail the candidate on any of: a missing or weakened hard constraint · a changed scope, trigger,
exception, precedence, default or stop condition · a changed anchor without authorisation · an
invented operational fact · a broken or misleading route · unsupported harness syntax presented as
functional · a success or safety regression past the tolerance declared at stage 1 · savings that
depend on hiding the original with no recovery path.

Rollback is the snapshot: `git checkout -- FILE`, or restore from `WORKDIR/original/`. Say in the
report which one applies, so recovery does not require reading the transcript.

## Coverage matrix

No single check is sufficient. For every ledger field, record at least one validation method **or
state that it is untested**.

| What can fail | Primary check | Corroborating check |
|---|---|---|
| exact literal or interface | anchor diff | source-linked spot check |
| modality, scope, condition, exception, precedence | ledger comparison | semantic probes |
| routing and availability | harness load trace | task prompt locates the reference |
| representation fidelity | boundary-case round trip | reviewer diff |
| behavioural utility and safety | fresh-session A/B/C | rule-violation and tool-trace analysis |
| lifecycle and canonicality | second-run idempotency | regenerate from the canonical source |

A green token report cannot compensate for an untested high-impact field.
