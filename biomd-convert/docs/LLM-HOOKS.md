# LLM hooks

The converter is deterministic-first. It converts the corpus with no model at
all, and every measured number in `CONVERTER-PROGRESS.md` is taken with the LLM
off. A hook exists for one purpose: to answer a question a deterministic rule
**already refused to answer**.

This document is the contract for writing one.

---

## 1. The disposition, in four sentences

1. **A hook fills an abstention.** It is reached only where a rule produced no
   answer at all. It can therefore never overturn a decision a rule made.
2. **A hook decides; deterministic code mutates.** A reply is a narrow typed
   verdict against stable ids — a class name, a list of labels. It is never
   Markdown, never a rewritten paragraph, never a target or an `href`.
3. **A hook may always be refused.** A gate declines before anything is spent, a
   schema check discards a malformed reply, and an acceptance check in
   `convert-core` refuses a well-formed one that this document does not support.
4. **Abstention beats an uncertain change.** Every failure path — closed gate,
   dead gateway, exhausted budget, low confidence, refused acceptance — lands in
   the same place: the deterministic answer stands and the item stays a review
   item.

The last point is the safety property the whole design rests on, and it has a
name: **assistance is monotonic in safety.** Turning a hook on can resolve an
abstention. It cannot damage anything else.

---

## 2. Where the pieces live

| what | where |
|---|---|
| the framework | `src/llm/kernel/` — contract, registry, templates, runner, limiter, events |
| one hook | `src/llm/plugins/<name>/` — `hook.ts`, `prompts/*.md`, `hook.test.ts` |
| the escalation points | `src/convert-core/decisions.ts` — one per place a rule abstains |
| the seam | `src/convert-core/resolver.ts` — `DecisionResolver.decide(point, request)` |
| assembly from config | `src/cli/llm-session.ts` |
| the operator surface | `biomd hooks list | show | test | cache-clear` |

Layering is unchanged and one-directional: `cli → {convert-core, llm, eval} →
{ladom, biomd-ast}`. **`convert-core` never imports `src/llm`.** It declares
decision points in its own vocabulary; a hook claims one by id.

There is **no list of hook names** anywhere. Discovery is by directory.

---

## 3. Adding a hook

### 3.1 Pass the three entry tests first

A hook that fails any of these should not be written. They are cheaper to apply
on paper than to discover after a corpus run.

**Abstention.** Name the state in which the deterministic path produced *no
answer at all*, and derive the residual from the rule's own candidate
collection. If the only honest description is "improving an answer a rule
already gave", the fix is the rule.

**Acceptance check.** Name what stops a wrong reply, *before* building the hook.
Watch for the circular case: if a check strong enough to catch the bad answer
would have answered the question deterministically, the hook cannot exist.

**Visible failure.** Prefer a hook whose wrong answers are noticeable in the
output. A heading that reads oddly gets fixed; a silently corrupted word reads
as a fact and nobody questions it.

### 3.2 Declare the decision point

In `src/convert-core/decisions.ts`, beside the rule that abstains:

```ts
export const MY_POINT: DecisionPoint<MyRequest, MyDecision> = {
  id: "my.point",
  question: "What the deterministic path could not decide.",
  itemId: (request) => `${request.sourceName ?? "?"}:${request.node.id}`,
  accept(reply, request) {
    // Re-establish every property this site depends on. The hook's schema has
    // proved the reply is well formed; this proves it is applicable *here*.
    if (!plausible(reply, request)) return refused("why not");
    return accepted(value);
  },
};
```

Then call it from the pipeline, only where the rule abstained:

```ts
const decided = await resolver.decide(MY_POINT, request);
if (decided) { /* apply it */ }
```

`decide` returns `null` for every failure. There is no error path to handle.

### 3.3 Write the plugin

```
src/llm/plugins/my-point/
  hook.ts
  prompts/system.md
  prompts/user.md
  hook.test.ts
```

```ts
export const hook = defineHook<HookInvocation<MyRequest>, MyReply>({
  id: "my.point",
  title: "Short noun phrase",
  summary: "One sentence: what judgement, and why a rule cannot make it.",
  version: "1",
  stability: "experimental",
  decisionPoint: "my.point",
  enabledByDefault: false,          // always, for a new hook — see §5
  moduleUrl: import.meta.url,       // how the prompts are found
  input: InputSchema,
  output: ReplySchema,              // include an UNCERTAIN member
  templates: { system: "prompts/system.md", user: "prompts/user.md" },
  defaults: { tier: "fast", maxTier: "deep", escalateBelow: 0.6 },

  gate(input) { /* deterministic, free, returns a reason either way */ },
  render(input) { return { vars: { … } }; },
  validate(out, input) { return []; },
});
```

Nothing else changes. No registry entry, no CLI flag, no config schema edit.

### 3.4 The prompts are files

Prose lives in `prompts/*.md`; data assembly stays in `render`. The template
syntax is four constructs and no logic:

```
{{name}}               substitute; an unsupplied name is an error, not a blank
{{#name}} … {{/name}}  include when present and non-empty
{{^name}} … {{/name}}  include when absent
{{! … }}               an authoring note that never reaches the model
```

A missing variable **throws**. The alternative is a prompt containing the literal
text `{{caption}}`, which is invisible in the run and expensive in the reply.

Every template is hashed, and the hash keys the decision cache: an edited prompt
is a different question and is never answered from the old prompt's cache.

### 3.5 Write the contract test

`hook.test.ts` beside the plugin. `plugins.test.ts` already asserts the
tree-wide properties — prompts load, schema converts, enum can abstain, gate is
total, policy resolves. Your test adds the hook-specific ones:

- the gate closes on the cases that are not worth a request, *by name*;
- `render` supplies every variable the template asks for;
- `validate` rejects the wrong-shaped reply you expect to see;
- **the acceptance check refuses the plausible-but-wrong verdict** — this is the
  one that matters, and it lives in `decisions.ts`, not in the plugin.

---

## 4. Testing and refining a hook

```bash
biomd hooks list
```
Every hook, whether it is enabled, **whether its decision point is wired**, and
which setting decided. A hook whose point nothing raises is reported as inert
rather than looking like a bug.

```bash
biomd hooks show table.classify
```
Rendered prompts, template hashes, reply schema, resolved policy, directory.

```bash
biomd hooks test table.classify --input item.json
```
One item, in isolation. **Dry by default**: it prints the gate verdict, the
rendered prompts, the model that would be used and the estimated input tokens,
and sends nothing. Add `--live` to actually call.

```bash
biomd hooks cache-clear table.classify
```
Drop that hook's cached decisions so a prompt change can be re-measured.

A refinement round therefore looks like: `show` the prompt → edit
`prompts/system.md` → `cache-clear` → `test --input` a few items → run the
corpus with `--hooks <id>` → compare against the LLM-off baseline on L1/L2/L3.

---

## 5. Configuration

Everything is per-hook, and nothing is per-hook on the command line.

```jsonc
"llm": {
  "enabled": true,
  "gateway": "litellm",
  "hooks": {
    "paths": ["../candidate-hooks"],     // out-of-tree plugin directories
    "enable": ["text.segment"],
    "disable": [],                       // "*" disables everything
    "defaults": { "maxTier": "balanced" },
    "overrides": {
      "table.classify": { "tier": "balanced", "acceptAbove": 0.8, "maxCalls": 50 }
    }
  },
  "concurrency": { "default": 1, "perModel": { "local-model": 4 } },
  "budget": { "maxCalls": 200, "maxEstimatedCostUsd": 5 }
}
```

Resolution order: a hook's own `enabledByDefault` → `enable` → `--hooks` →
`--no-hooks` → `disable` → `overrides.<id>.enabled`. **An unknown id is a
startup error**, never a silent no-op.

Policy resolution: the hook's `defaults` → `hooks.defaults` → `overrides.<id>`.
An override says only what it overrides.

Command line: `--llm off|assist`, `-g/--gateway`, `--hooks a,b`, `--no-hooks`,
`--replay`, `--log-level`, `-v`, `--debug`, `--no-run-log`.

### The default set is empty

**No hook is enabled by default — not even with `llm.enabled: true`.** Turning
the subsystem on builds a transport and nothing else; the hooks that run are the
ones an operator named, in `llm.hooks.enable` or `--hooks`.

> **A hook ships disabled.** A previous generation of this subsystem shipped
> twenty-one hooks with seven on by default, three of which re-decided questions
> rules had already answered. `table.classify` and `table.records` were
> grandfathered through the first cleanup and are no longer. `--llm assist` with
> nothing named is byte-identical to `--llm off`, unconditionally.

`src/llm/plugins/plugins.test.ts` pins the set empty and asserts every
discovered plugin declares `enabledByDefault: false`, so a hook that turns
itself on fails the build rather than the corpus.

Two consequences worth stating, because both look like bugs otherwise:

- a fresh checkout with `llm.enabled: true` and a working gateway converts
  **exactly** as it does with the model off, and `hooks list` shows why;
- enabling a hook is a **conversion change**. It belongs to a run that measures
  it against the LLM-off baseline, not to a plugin's own opinion of itself.

### Cost control

- **`gate`** — deterministic, free, and the only thing that authorises a call.
  It is the first and cheapest brake, and its reason is what the progress line
  prints when it says why a hook fired.
- **decision cache** — keyed on the resolved model, the rendered prompts and the
  template hashes. Committed alongside a corpus, a cache makes CI offline and
  free, and `--replay` refuses to reach the network at all.
- **in-flight coalescing** — the same ambiguous chrome table on forty pages
  produces one call, not forty, even when the pages convert concurrently.
- **`concurrency`** — bounded per endpoint, default 1. A corpus run also clamps
  its own worker count while hooks are active.
- **budget** — reserved *before* a request is built, so concurrent workers
  cannot overspend between check and call. `maxCalls` additionally caps one hook.

---

## 6. Observability

Progress goes to **stderr**; stdout stays machine-readable.

| level | terminal |
|---|---|
| `quiet` | failures and warnings only |
| `normal` | live progress line, plus every accepted/refused/abandoned escalation with its reason |
| `verbose` | adds per-file lines, gate verdicts, calls, escalations, queueing |
| `debug` | adds cache misses and every internal event |

The live line carries elapsed time, stage, `n/total`, current file, the
review/failed tally, and — while hooks are active — calls made, calls in flight,
cache hits and the hook that is running. A **heartbeat**
(`log.heartbeatSeconds`, default 20) fires when nothing else has happened, so a
long measurement or a slow model never looks like a hang.

**The level decides the terminal, never the log.** Every run writes
`<workDir>/runs/<id>/run.jsonl` — the full event timeline — and `report.json`,
which carries the engine and node versions, the effective configuration, the
gateway and models, every enabled hook with its policy and template hashes, the
per-file outcome with text recall, errors, review items, table counts,
escalations and **which deterministic passes fired**, and the LLM totals with
token usage, cost and the grouped failure reasons. `--no-run-log` turns it off.

---

## 7. What the framework will not let a hook do

- rewrite text, targets, `href`s, captions or Markdown — the schema is a verdict;
- run where a rule decided — the escalation site is inside an abstention branch;
- apply a reply `convert-core` did not accept — `accept` is the last word;
- change behaviour when disabled — with no hook enabled, no transport is built;
- spend without a gate, a budget reservation and a queue slot;
- reinterpret a cached decision after its schema or prompt changed.

---

## 8. Promising future hook categories

Recorded so a later iteration starts from evidence rather than enthusiasm. None
of these is implemented. Each names its abstention, its acceptance check and its
failure visibility, because a category that cannot fill in all three is not
ready.

| candidate | abstention | acceptance check | visible when wrong |
|---|---|---|---|
| **is this block a list** | a multi-line block where geometry gives no bullet glyph, no consistent indent and no numbering | line count preserved, no text added or removed, every line non-empty | a paragraph rendered as bullets, immediately |
| **is this verse or lyrics** | a `<br>` run whose lineation the deterministic reader could not settle — the `text.segment` plugin already exists, unwired | one verdict per break, count preserved, and joining is refused unless every break agrees | poetry flattened to a paragraph — this is `PROGRESS §53.2`, six poems as six strings |
| **is this a section label or a caption** | a short shouted line with no trailing colon that both the heading recogniser and the caption binder declined | the line is unchanged; only its role changes | a heading that reads as a caption, or the reverse |
| **which of two lanes continues the reading order** | a multi-column region where geometry ties | the permutation is a permutation — no block gained, lost or duplicated | reading order visibly wrong |

Two shapes are **deliberately excluded** and should not be revisited without new
measurement: anything that touches de-hyphenation (a wrong join reads as a real
word and nobody questions it) and anything that supplies an image caption from
outside the source (invented text under §16.3, invisible when wrong).

---

## 9. Related

- `CLAUDE.md` — invariants, the evaluation ladder, rules-vs-hooks policy
- `docs/CONFIGURATION.md` — gateways, keys, budgets, the R1/R2/R3 transport rules,
  and what a self-hosted `llama-server` needs that a hosted gateway does not
- `biomd-convert/CONVERTER-PROGRESS.md` — measured state
