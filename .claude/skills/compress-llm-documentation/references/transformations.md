# Transformation patterns

Concrete before/after moves for stage 7, plus the per-class budgets that decide how hard to push
on each kind of content. Ordered by return on investment.

- [Per-class budgets](#per-class-budgets)
- [Prose to directive](#prose-to-directive)
- [Modality normalisation](#modality-normalisation)
- [Default plus exception](#default-plus-exception)
- [Prose to decision table](#prose-to-decision-table)
- [Prose to guarded pseudocode](#prose-to-guarded-pseudocode)
- [Prose to grammar, type, formula](#prose-to-grammar-type-formula)
- [Payload to pointer](#payload-to-pointer)
- [State snapshot to query](#state-snapshot-to-query)
- [Diagram to edge list](#diagram-to-edge-list)
- [Legacy folding](#legacy-folding)
- [Hoisted scope](#hoisted-scope)
- [Memory: chronology to state](#memory-chronology-to-state)
- [Micro-optimisation, last](#micro-optimisation-last)

---

## Per-class budgets

Uniform ratios are the failure mode of naive "compress this doc" prompts. Different content earns
different treatment, and publishing the split makes the pass predictable and reviewable.

| Class | Tolerance | Treatment |
|---|---:|---|
| exact command, path, version, schema, error string | **0%** | verbatim; lossless-only zone |
| safety, destructive action, prohibition | 0–15% | wording may shrink; semantics exact |
| project invariant | 10–30% | preserve condition and action |
| gotcha | 10–40% | keep whenever non-obvious |
| procedure | 20–50% | keep the steps, cut the narration; consider promoting to a script |
| reference table | 20–40% | or relocate whole to on-demand |
| example | 30–70% | basis set only |
| rationale | 50–90% | keep only decision-changing why |
| generic overview, motivation | 80–100% | usually delete outright |
| historical narrative | 80–100% | replace with current state plus the decision |

These are tolerances, not quotas. A rationale that fully earns its tokens stays at 0%.

## Prose to directive

```diff
- Before pushing your changes, it is generally recommended that you make sure the type
- checker has been run, since CI will otherwise fail.
+ Run `pnpm typecheck` before pushing. CI fails otherwise.
```

21 words to 9, and now greppable, diffable and individually deletable. Preserved: trigger, object,
action, consequence. Do **not** reduce further to "Avoid type errors" — that loses the command,
which is the only part the agent cannot derive.

## Modality normalisation

| Found | Becomes |
|---|---|
| must · never · always · required · critical | **MUST** / **NEVER** |
| should · prefer · recommended · typically | plain imperative (the default) |
| may · can · optionally · feel free | OPTIONAL — usually delete |
| consider · it might be nice · you may want to | **delete** |

Rule of thumb: if you cannot decide between MUST and delete, it is delete. A rule nobody can
classify is a rule nobody will follow, and it still costs tokens on every turn.

## Default plus exception

```diff
- Use the fast parser for ordinary inputs. For signed inputs, the fast parser cannot
- validate the signature, so use the validating parser. Malformed input must stop the workflow.
+ - Default: fast parser.
+ - Signed input: validating parser (fast parser cannot validate signatures).
+ - Malformed input: stop.
```

Safe **only** if the branches are exhaustive or a fallback is stated. The parenthetical survives
because it is generalising rationale, not motivation — it tells the agent when the rule extends.

## Prose to decision table

Use a table only when every row answers the same questions:

```markdown
| Change touches   | Required before commit                     | Stop condition   |
|------------------|--------------------------------------------|------------------|
| `db/migrations/` | `scripts/migrate.py --verify` + full suite | verifier fails   |
| `api/`           | `make openapi` + contract tests            | contract fails   |
| anything else    | unit tests                                 | none             |
```

Tables express overlap and precedence that prose cannot express cheaply.

**Counter-rule:** pipe punctuation and the delimiter row cost real tokens. Below roughly 4 rows ×
3 columns, `key: value` lines are cheaper. Keep prose when rows need qualifications, sequence,
nested exceptions, or long code.

## Prose to guarded pseudocode

For branching policy **with priority**, a guard ladder beats a table, because it forces you to
state precedence and a default:

```text
on task:
  if touches(secrets/ | .env)   -> STOP, ask human
  elif touches(db/migrations/)  -> run the migration verifier
  elif touches(api spec)        -> regenerate spec, run contract tests
  else                          -> run unit tests
  always: open a PR; never commit to the default branch
```

Unsafe if it omits actor, exceptions, transaction boundaries, concurrency, fallbacks or errors.

## Prose to grammar, type, formula

Use a formal form when the content **is already formal**. Pair unfamiliar notation with one plain
sentence.

```text
commit  := <type>(<scope>): <subject>
type    := feat | fix | chore | docs | refactor | test
subject := imperative, lowercase, <=72 chars, no trailing period

retry:  delay = min(2^n * 100ms, 30s), n <= 5, jitter +-20%
branch: ^(feat|fix)/[a-z0-9-]+$
```

```python
def render(report: Report, *, fmt: Literal["md","html"] = "md", charts: bool = True) -> Path
```

A signature carries argument names, types, optionality, defaults, keyword-only-ness and return
type in one line — the highest value-per-token artifact available.

Reject forms that need a legend:

```text
U ∧ M -> X; ¬A => Q
```

It cannot be audited without a decoder, and it hides modality and domain meaning. In-distribution
symbols only: `->`, `<=`, `|`, `:=`, regex, CLI flags.

## Payload to pointer

| Instead of | Write |
|---|---|
| a 40-line pasted function | `src/auth/session.py::refresh_token` |
| a full schema dump | `rg -n "CREATE TABLE" migrations/` |
| an enumerated directory tree | 3 real entry points plus `rg --files -g '*.tsx' src/` |
| copied API docs | `reference/api.md — full endpoint list. Read before adding a route.` |
| a 300-word incident history | `Never edit src/generated/**; regenerate via scripts/gen-api.sh.`<br>`History: docs/incidents/generated-client.md` |

The last row is the general pattern: **the operational rule stays hot, the evidence goes cold.**

Prefer symbol references and grep patterns to line numbers — line numbers rot on the next commit,
and a wrong pointer is worse than no pointer.

## State snapshot to query

```diff
- Current packages: react 18.2, vite 5.1, typescript 5.4, vitest 1.6
+ Read versions from `package.json`; never infer them from this file.
```

Shorter, staleness-proof, and it names the single source of truth. Apply this to any fact the repo
already stores in a machine-readable place: versions, ports, script names, env var lists.

## Diagram to edge list

```diff
- [30 lines of Mermaid flowchart]
+ ingest -> validate -> normalize -> persist -> index
+ validate fails -> quarantine/ (manual review; never auto-retry)
```

Keep Mermaid in the human README or a read-on-demand `.mmd` file. **Exception:** genuinely visual
tasks — UI layout, form geometry, chart styling — where letting a multimodal model *look* is the
point.

## Legacy folding

```markdown
## Current method
Use the v2 endpoint: `api.example.com/v2/messages`

## Old patterns
<details><summary>Legacy v1 API (removed 2025-08)</summary>
`api.example.com/v1/messages` — no longer supported.
</details>
```

Better than a dated conditional ("before August 2025, use…"), which becomes *wrong* rather than
merely old. **Caveat:** `<details>` is a rendering affordance, not lazy loading — the text still
enters context, so this is a clarity win, not a token win.

## Hoisted scope

```diff
- - For files under `api/`, validate the schema before editing.
- - For files under `api/`, preserve field order.
- - For files under `api/`, run the compatibility check.
+ Under `api/`:
+ - validate the schema before editing;
+ - preserve field order;
+ - run the compatibility check.
```

Never hoist across a heading or paragraph boundary if that widens the condition.

## Memory: chronology to state

```diff
- Yesterday we tried X and it failed because of the cache, after that we discussed Y and
- eventually decided to look at Z, which is still open...
+ ## Current facts
+ - Build: `pnpm build`. Node 24 breaks plugin X; use Node 22.
+ ## Decisions
+ - 2026-08-03: keep REST v1 until the mobile client migrates. Rejected: dual-stack (ops cost).
+ ## Open
+ - Cache invalidation in `foo.ts` — hypothesis only, unverified.
+ ## Superseded
+ - ~~Node 20~~ -> Node 22 since 2026-07-18.
```

Delete: obsolete hypotheses, resolved debugging branches, repeated observations, stale plans,
conversational chronology. Preserve: current state, decisions **and rejected alternatives**,
unresolved questions, evidence pointers, exact identifiers, and the provenance of each fact
(user-stated vs tool-observed vs inferred).

Repeated compaction must merge by decision and artifact identity. **Never re-summarise the previous
summary** — that is generational loss, and it is irreversible.

## Micro-optimisation, last

After the earlier layers have yielded tens of percent, these yield single digits:

- ASCII punctuation instead of smart quotes, em dashes and non-breaking spaces
- flatten nesting past two levels
- drop badges, box-drawing and decorative rules
- `-` for unordered lists, consistently
- no manual line wrapping inside paragraphs
- one blank line between blocks, never three

Never on identifiers, never inside fences, and never at the cost of clarity. Consistency within a
document matters more than which convention you pick — mixing separators section to section
measurably shifts model behaviour.
