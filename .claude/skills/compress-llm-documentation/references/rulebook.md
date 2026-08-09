# Rulebook — ranked moves and the four gates

Every compression move, ordered by effect × safety, plus the gates that decide whether a move is
admissible at all. Work top-down and stop when the remaining moves need a level you were not
granted.

- [How to read the grades](#how-to-read-the-grades)
- [The ladder, one screen](#the-ladder-one-screen)
- [Tier 1 — high effect, low risk](#tier-1--high-effect-low-risk)
- [The four gates](#the-four-gates)
- [Tier 2 — high effect, medium risk](#tier-2--high-effect-medium-risk)
- [Unit decision procedure](#unit-decision-procedure)
- [Stop conditions](#stop-conditions)
- [Rejected outright](#rejected-outright)
- [Two contested rules, resolved narrowly](#two-contested-rules-resolved-narrowly)

---

## How to read the grades

`E` = expected improvement in cost per completed task (4 = architectural, 1 = cosmetic).
`R` = loss risk assuming a competent but fallible compressor:

| | Meaning | Handling |
|---|---|---|
| R0 | presentation only, mechanically checkable | just do it |
| R1 | low once literals and structure are validated | do it, then anchor-diff |
| R2 | conditional; needs semantic review | review it; keep the diff reversible |
| R3 | high; needs behavioural evidence | explicit authorisation plus a target eval |
| R4 | unacceptable as default behaviour | reject |

A high-risk technique does not become safe because many sources repeat it.

## The ladder, one screen

```text
TIER 0  PREREQUISITES                              cannot be skipped, cost nothing
  artifact type + harness + load semantics + authority
  semantic ledger; anchor set extracted separately
  snapshot; failure thresholds defined before editing

TIER 1  HIGH EFFECT, LOW RISK                      ~80% of real savings live here
  1.1  delete tool-enforced duplicates      (E-GATE)   E4 R1   most common smell by far
  1.2  delete generic model-known advice                E4 R1
  1.3  delete/merge duplicate payload       (D-GATE)   E4 R1
  1.4  replace payload with pointer                     E4 R1
  1.5  pitch every link: path - what - when             E4 R1
  1.6  keep unknowable-trigger gotchas hot              E4 R1   preservation = saving
  1.7  replace a state snapshot with a query            E3 R1
  1.8  one directive per line, verb first, modality normalised   E3 R1
  1.9  close enumerations; add stop + failure branch    E3 R1
  1.10 canonical terminology; headings as retrieval keys E3 R1
  1.11 delete proven-stale content                      E4 R1
  1.12 cache-aware order; make the pass idempotent      E2 R0
  1.13 state the normal case once, then exceptions      E3 R1
  1.14 hoist a condition shared by adjacent rules       E2 R1
  1.15 safe whitespace and punctuation normalisation    E1 R0

TIER 2  HIGH EFFECT, MEDIUM RISK                   gate each move, usually review it
  2.1  promote a deterministic rule -> script/hook/CI/type/schema  (E-GATE)  E4 R2
  2.2  relocate conditional material to a verified on-demand tier  (R-GATE)  E4 R2
  2.3  split into references: one level, every link pitched        (R-GATE)  E4 R2
  2.4  path-scope rules to the subtree that owns them              (R-GATE)  E4 R3
  2.5  representation change: table / pseudocode / grammar / formula (F-GATE) E3 R2
  2.6  curate examples to a basis set                                        E3 R2
  2.7  memory: chronology -> state + decisions + open + superseded           E4 R2
  2.8  reorder by observed violation frequency                               E3 R2
  2.9  presentation-heavy HTML -> semantic Markdown                (F-GATE)  E4 R2
  2.10 cross-file dedup behind a canonical pointer                 (D-GATE)  E3 R2
```

Tier 1 is licensed at **safe**. Tier 2 rows 2.2, 2.3, 2.5, 2.6, 2.7 are licensed at **medium**.
Rows 2.1, 2.4, 2.9, 2.10 need **max**. Nothing below is licensed at any level.

## Tier 1 — high effect, low risk

| ID | Rule | Why it ranks here |
|---|---|---|
| 1.1 | Delete a written rule a linter, formatter, type checker, hook or CI already enforces — after E-GATE | The most common smell in surveyed files. The tool *is* the constraint; restating costs tokens forever and drifts |
| 1.2 | Delete generic advice the base model already follows | Zero surprisal, non-zero cost, and measurably negative — such phrases induce extra exploration, which is the mechanism behind the >20% cost finding |
| 1.3 | Delete duplicate payload after picking one canonical home — after D-GATE | Value is information that exists nowhere else. Keep a pointer only where availability needs it |
| 1.4 | Replace payload with a pointer: `src/auth/session.py::refresh_token`, `rg -n "CREATE TABLE" migrations/` | ~10 tokens and never stale. Prefer symbols and grep patterns to line numbers — line numbers rot on the next commit |
| 1.5 | Give every pointer a what + when pitch | A bare path is either ignored or eagerly slurped. Cheapest high-value fix in the catalog |
| 1.6 | Keep non-obvious gotchas in the earliest context guaranteed to load, before the mistake is possible | If the agent cannot know to look for the exception until after it errs, retrieval cannot save it. This rule *prevents* savings, and is why the compressor is trustworthy |
| 1.7 | Replace a mutable state snapshot with a query instruction | `Read versions from package.json; never infer them from this file.` Shorter, staleness-proof, one source of truth |
| 1.8 | One directive per line, verb first; normalise modality to MUST / default / OPTIONAL, and delete below OPTIONAL | Greppable, diffable, individually deletable, survives a partial read. "Consider maybe" hands the priority decision to the model |
| 1.9 | Close every enumeration; give every procedure a stop condition and a failure branch | `etc.` is an instruction to invent, and inventing is exploration |
| 1.10 | One canonical term per concept; headings are the phrase an agent would grep for | Synonym drift forces coreference resolution and breaks grep, which is how agents actually navigate |
| 1.11 | Remove content **proven** stale or superseded; keep provenance if future readers need it | "Old" must be evidence-based, not age-based. Stale sections get executed, so they do real damage |
| 1.12 | Stable content first, volatile last; make the pass idempotent | Caching keys on an exact prefix: editing line 3 invalidates everything, editing the last line almost nothing |
| 1.13 | Express the normal case once, then explicit exceptions and a fallback | Only valid if the branches are exhaustive or a fallback is stated |
| 1.14 | Hoist a condition shared by adjacent rules | Never hoist across a heading if that widens the condition |
| 1.15 | Normalise safe whitespace and punctuation | Protect hard line breaks, fences, YAML, and render-sensitive text |

## The four gates

### E-GATE — enforcement equivalence (1.1, 2.1)

Do not delete a written rule because a tool "mentions the topic". Confirm all six:

1. the tool covers the same scope, modality, conditions, exceptions **and values**;
2. it runs automatically, or the agent is guaranteed to invoke it before the risky action;
3. failure **blocks** or clearly reports, rather than emitting an ignorable warning;
4. its output tells the agent how to recover without losing the original boundary;
5. the written rationale is not needed to *avoid* the action before a late check fires;
6. the tool config is canonical, present in the target environment, and not itself stale.

Any failure → keep a compact preventive rule. All pass → keep the invocation, the timing, the
failure contract and any decision-changing rationale; delete only the duplicated enforcement detail.

Always use the highest enforcement mechanism that works:

```text
1 impossible   types, schema, API design, file permissions      0 tokens, 0 failures
2 automatic    formatter, codegen, pre-commit hook              0 tokens
3 checkable    linter, test, CI gate, validator script          ~5 tokens of output
4 runnable     "run scripts/check_x.py"                         ~10 tokens
5 written rule one line in the rules file                       ~15-40 tokens, forever
6 prose        a paragraph                                      avoid
```

Every rule sitting at 5–6 that could live at 1–3 is waste. A rules file is context, not enforced
configuration: to actually block an action you need a hook, not a sentence.

### R-GATE — relocation safety (2.2, 2.3, 2.4)

Before moving hot content into a scoped file, skill, reference, asset or script, confirm all seven:

1. the need is recognisable **before** the agent can make the relevant mistake;
2. a route exists in guaranteed-loaded context and states what and when;
3. the harness actually supports the intended on-demand behaviour — see [harnesses.md](harnesses.md);
4. the target is reachable under sandbox, offline, path and network constraints;
5. the retrieved unit is self-contained enough to apply correctly in isolation;
6. retrieval plus miss/rework cost is less than residency cost for the real workload;
7. a safe fallback exists when loading or activation fails.

> **Relocation without availability proof is deletion.**

Any failure on a high-impact unit → keep it hot, or duplicate only the minimum non-drifting gate.

### D-GATE — deduplication equivalence (1.3, 2.10)

Two passages are duplicates only if they match on **all** of: authority and lifecycle status ·
actor, audience, scope · trigger, modality, action, object · conditions, exceptions, precedence,
defaults, fallbacks · exact anchors and verify/stop semantics.

Textual similarity is a candidate detector only. If one copy adds a local exception, a
compatibility alias, a route or stronger authority, merge the shared payload and **preserve that
delta**. Never let majority wording override a higher-authority source.

### F-GATE — representation fidelity (2.5, 2.9)

Before converting prose into a table, pseudocode, grammar, schema, formula or diagram, confirm:
the target form naturally represents this relationship shape · every ledger field has an
unambiguous location · ordering, overlap, precedence, defaults, exceptions and failure paths stay
explicit · anchors stay exact and runnable material stays runnable · the target models parse it
without a hidden prompt tax · **end-to-end** cost or behaviour improves, not just source token count.

If the form needs a private legend, loses qualifications, or only saves tokens once you ignore its
decoder and retry cost — keep familiar Markdown. Format studies find no aggregate winner across
models, so format humility is the correct posture.

## Tier 2 — high effect, medium risk

| ID | Rule | Note |
|---|---|---|
| 2.1 | Promote a deterministic rule into config, schema, type, hook, linter, test or script | Highest ceiling in the catalog. Scripts execute without loading their contents — but output, invocation and errors all cost context, so this is output-only, not free |
| 2.2 | Relocate conditional material to a verified on-demand tier | The other half of the largest win. Fails silently if the harness loads eagerly |
| 2.3 | Split one file into references: one level deep, every link pitched, ToC above 100 lines | Nested chains get partially previewed and the agent then works from partial information |
| 2.4 | Path-scope rules to the subtree that owns them | Real conditional loading where supported. R3 because discovery, precedence and reload semantics differ per harness |
| 2.5 | Representation change: decision table, guarded pseudocode, grammar, type signature, formula, edge list | Denser *and* less ambiguous only for a matching shape |
| 2.6 | Curate examples to a basis set | Map to atoms first. Under-compress here rather than over |
| 2.7 | Memory: replace chronology with state, decisions, open questions, artifacts, risks, next, superseded | Memory is not a policy file. Preserve provenance and unresolved constraints |
| 2.8 | Order rules by observed violation frequency × cost | The only honest way to decide what earns a MUST. Needs transcripts; skip rather than guess |
| 2.9 | Convert presentation-heavy HTML to semantic Markdown | Largest single win on ingested web content. Validate code, tables, tab labels and hidden primary content first |
| 2.10 | Cross-file dedup behind a canonical pointer | Only when the consumer can retrieve the source cheaply |

Handle with particular care, because each one looks like free savings and is not: removing HTML
comments (they carry GAP markers, provenance and maintainer contracts) · removing frontmatter
fields (they drive discovery, scoping and publishing) · removing a ToC (required above 100 lines
for partial-read scope) · shortening code comments and examples (the comment may be the only
statement of an invariant).

## Unit decision procedure

Apply per semantic unit — never per line or token window:

```text
if authority, scope, or conflict is unresolved:
    REVIEW; preserve both statements verbatim; do not rewrite the apparent winner
elif unit is a protected atom or an unknowable-trigger gotcha:
    KEEP HOT in the earliest guaranteed context; compress wording only if semantics revalidate
elif unit is an exact semantic duplicate:                        # D-GATE
    select a canonical home; keep a route only where availability requires it
elif unit appears tool-enforced:                                 # E-GATE
    if the gate passes: keep invocation + failure contract; drop duplicated detail
    else:               keep a compact preventive rule
elif unit is needed only under a recognisable condition:         # R-GATE
    KEEP-SCOPED or KEEP-ON-DEMAND only if every check passes; else keep it hot
elif unit is generic, discoverable, stale, or low-value:
    prove it by source inspection; DELETE only with recorded evidence
elif its information shape matches a safe representation:        # F-GATE
    transform, then round-trip the boundary cases
else:
    keep it, and apply low-risk lexical compression (1.8-1.10, 1.13-1.15)
```

There is deliberately **no `target ratio reached` branch**. Classification and preservation decide;
file length does not.

## Stop conditions

Stop and keep the current candidate when any of these holds:

- the remaining savings need a level the user has not granted;
- any content, availability, representation or lifecycle check fails;
- canonical authority or harness loading cannot be established;
- marginal residency saving is smaller than the added retrieval, rework or drift risk;
- another pass changes a previously stable result or removes a preserved distinction;
- every remaining unit has a traced operational role.

> "No worthwhile safe compression remains" is a successful outcome. Never manufacture a bigger
> diff to satisfy a requested percentage.

## Rejected outright

Never automatic behaviour, at any level:

| Practice | Why |
|---|---|
| Invent a missing command, threshold, condition, verifier, timing or example | Changes the operational contract. Valuable only as a separately labelled *proposal* |
| Delete or truncate by position, including "compress the middle harder" | Position is not importance; the next task often needs exactly what got pruned |
| Blanket-strip comments, frontmatter, metadata, ToCs, rationale or examples | Each can carry a contract, a route or a GAP marker. Classify roles first |
| Base64-encode text "to save tokens" | Backwards: it destroys BPE merges and inspectability, and expands tokens |
| Translate to another language for density | Tokenizer-dependent, breaks grep, diff review and terminology |
| Emoji as semantic flags or modality replacement | Multi-token, ambiguous, inaccessible. An emoji legend is a worse table |
| Private abbreviation dictionaries, symbol legends, hash-only references | Moves tokens into decode state; losing one legend entry corrupts every reference |
| Enforce a line, word, rule-count or ratio target as a success condition | Thresholds are review triggers, not fidelity criteria |
| Delete everything "discoverable in code" without pricing retrieval | The agent must know *what* to search and *which* source is authoritative |
| Assume scripts, references or images cost zero tokens | Output, errors and invocation all cost context |
| Emit unsupported `load_if`, `priority`, `@include` or transclusion syntax | Imaginary controls are inert at best, misleading at worst |
| Compress an already-compressed output without the original and the ledger | Generational loss. Always start from the newest human-authored source |
| Create unrequested `removed.md` / `original.md` / `*.notes.md` in runtime scope | Adds clutter and may itself get loaded. Version control is safer |
| Use lexical similarity or a single LLM judge as proof of preservation | Misses rare decisive constraints and shares blind spots with the compressor |

## Two contested rules, resolved narrowly

**Repeating critical rules at top and bottom.** Primacy covers the top and recency the bottom, and
the middle is where rules die — but neither side of this argument measured tail duplication
specifically. Default **off**: one canonical block, strong placement, strong heading, real
enforcement. If a project insists, permit at most a ≤5-line closing recap of the top three
safety-critical rules, **mechanically generated from the head block** so the two cannot drift.

**Negative phrasing.** Two questions get conflated. *Are NEVER-rules high value?* Unanimously yes —
negative knowledge has the highest probability of error if absent, so cut obvious positive rules
before touching a single gotcha. *Should a rule be phrased as a negation?* Genuinely split. Prefer
a positive replacement **where one fully specifies the safe alternative** (`Use httpx for all HTTP
calls` beats `Don't use requests`). Retain explicit prohibition for genuine cliffs — data loss,
security, irreversibility — and keep that list short, around seven items, so each stays salient.
**Never delete a gotcha to satisfy a phrasing preference.**
