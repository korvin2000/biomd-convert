# Artifact playbooks

One Markdown minifier applied to every file type is a design error: a memory file and a tool schema
have almost nothing in common except syntax. Read the playbook for the artifact you are holding,
at stage 1.

- [Quick routing](#quick-routing)
- [Root rules file](#root-rules-file)
- [SKILL.md](#skillmd)
- [Memory and handoff files](#memory-and-handoff-files)
- [Nested and path-scoped rules](#nested-and-path-scoped-rules)
- [Reference guides](#reference-guides)
- [Tool schemas, contracts and code](#tool-schemas-contracts-and-code)

---

## Quick routing

| Artifact | Loading | Keep hot | Move or retrieve | Primary hazard |
|---|---|---|---|---|
| Root `CLAUDE.md` / `AGENTS.md` | every relevant session | authority, scope, non-standard commands, invariants, permissions, gotchas, completion criteria | tutorials, component workflows, long references | auto-generated encyclopedia |
| Nested / path-scoped rule | harness- and path-dependent | only rules unique to that scope | shared policy stays canonical above | assumed precedence; assumed reload after compaction |
| `SKILL.md` | metadata at discovery, body on activation | trigger, workflow, gates, routing, critical invariants | deep reference, schemas, examples, scripts | bloated body or a weak trigger |
| Memory / handoff | startup, retrieval or compaction dependent | current goal and state, decisions, rejected alternatives, artifacts, risks, next action | raw history, closed investigations | narrative drift; stale note promoted to permanent policy |
| Reference guide | on demand **if** routing works | a self-contained topic contract plus its anchors | unrelated topics | blind links, deep chains |
| Tool / API schema | passed with the tool | names, types, descriptions, required fields, error semantics | unrelated tools | shortening the exact interface |
| Source / code example | on demand | the semantics the lesson needs | repetitive boilerplate, only if the omission is labelled | breaking runnable or contractual code |

## Root rules file

A compact root file answers seven questions and nothing else:

1. What authority and scope does this file have?
2. What must the agent do differently **in this repository**?
3. Which exact commands or checks are non-obvious?
4. What is forbidden, and what requires approval?
5. Which gotchas cannot be discovered cheaply?
6. Where should task-specific detail be read, and **when**?
7. What proves the task is complete?

Target shape:

```markdown
# Project instructions

## Commands
| Task | Command | Authority |
|---|---|---|
| Test  | `...` | see <config file> |
| Lint  | `...` | config is source of truth |
| Build | `...` | |

## Invariants
- <non-obvious, always true, expensive to violate>

## Scope
- `backend/**`: ...
- `frontend/**`: ...

## Gotchas
- <what the agent cannot discover before it errs>

## Boundaries
NEVER: <cliffs only, <=7 items>
ASK:   <approval-gated actions>

## Read when needed
| Topic | File | When |
|---|---|---|

## Done
- <verifiable completion criteria>
```

Note what is absent: no directory tour, no dependency list, no framework advice, no motivation.
Repository overviews measurably do not help agents find files faster, and the vendor's own trim
tool cuts exactly those three categories while keeping pitfalls, rationale and conventions that
differ from tool defaults.

Order matters as much as content: stable invariants first (they anchor the prompt cache), hot rules
next, reference material in the middle, volatile notes last. Attention is weakest in the middle, so
every line added there pushes existing lines deeper into the weak zone.

## SKILL.md

Compress in two stages; they optimise different things and mixing them produces a worse result than
doing either alone.

**Stage 1 — the routing description.** The `description` is the only part loaded at startup, so it
is the highest-leverage text in the whole package. It must carry **what the skill does and when to
use it**, in the third person, with the vocabulary a user would actually type. A description that
merely names the capability under-triggers. Hard limits: ≤1024 chars; `name` ≤64 chars of
`[a-z0-9-]`.

**Stage 2 — the body.** Classify every block into one of three buckets:

| Bucket | Test | Destination |
|---|---|---|
| actionable core | the model needs it on *every* invocation | stays in `SKILL.md` |
| supplementary | needed only for one branch, format or edge case | `references/*.md` with a pitched route |
| removable | base-model knowledge, restated general advice, duplicated explanation | delete |

Then check the package rules: body under 500 lines · references **one level deep** · ToC on any
reference over 100 lines · descriptive filenames, since the filename is part of the retrieval index
· explicit execute-versus-read intent for every script · one default with an escape hatch instead
of a menu of options · no time-sensitive phrasing.

A reference that is never opened should be deleted or re-signalled. A reference opened on every run
belongs in the body.

## Memory and handoff files

Memory is not a policy file, and compressing it like one destroys the part that matters. Restructure
chronology into state — the pattern is in [transformations.md](transformations.md).

Keep: current state, decisions **with the rejected alternatives and why**, unresolved questions,
evidence pointers, exact identifiers, and the provenance of each fact (user-stated, tool-observed
or inferred). "Evaluated X, rejected because Y" is the highest-value content here, because git
records decisions but cannot record non-decisions.

Delete: obsolete hypotheses, resolved debugging branches, repeated observations, superseded plans,
conversational narration.

Two specific hazards:

- **Load truncation.** Some harnesses load only the first 200 lines or 25 KB of a memory file and
  silently drop the rest. Content past the cut is not compressed, it is *absent* — check the limit
  before assuming a long memory file is being read at all.
- **Promotion drift.** A temporary observation that survives three compactions starts reading like
  permanent policy. Date facts, and keep a `Superseded` section rather than deleting silently.

Never re-summarise a previous summary. Merge by decision and artifact identity, always from the
newest human-authored source.

## Nested and path-scoped rules

Only rules unique to that scope belong in a scoped file; shared policy stays canonical above it.
Two traps:

- **Precedence is assumed, not stated.** Write which file wins when scopes overlap, or the agent
  will pick one.
- **Reload semantics differ.** In Claude Code, path-scoped rules are not re-injected after
  compaction until a matching file is read again. A safety-critical rule therefore does not belong
  in a path-scoped file, however narrow its subject.

## Reference guides

Each reference is a self-contained topic contract: it must be applicable in isolation, because that
is how it will be read. Give it a ToC above 100 lines so a partial read still knows the scope, and
keep it one level from the entry file.

Partition by domain, not by size, so a question about one area never loads another's material. Where
the content is bulky and searchable, ship a grep recipe instead of the content:

```markdown
`reference/finance.md` — revenue and cost schemas. Search it: `grep -i "revenue" reference/finance.md`
```

## Tool schemas, contracts and code

Do not summarise away interface names, required fields, types, enum values, error semantics or exact
output. Better levers, in order: expose only the tools the task needs · remove duplicated
descriptions once selection still works · generate schemas from a canonical source · fetch large
schemas on demand · shorten the examples *around* the contract rather than the contract.

"Preserve all code byte-for-byte" is also too broad. A tutorial may omit conventional boilerplate
**if it labels the omission**. A runnable command, migration, schema, regex, or an example that is
the only statement of an output contract may not be touched at all.
