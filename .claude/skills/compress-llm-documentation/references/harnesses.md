# Harness profiles — what actually loads, and when

This file decides whether the Tier-2 architectural moves are legal at all. **Splitting a file is
not compression if every piece loads at startup.** Read it at stage 1, and again at stage 6 before
any move.

- [The general rule](#the-general-rule)
- [Claude Code](#claude-code)
- [Choosing a relocation target](#choosing-a-relocation-target)
- [Agent Skills packages](#agent-skills-packages)
- [Codex and AGENTS.md](#codex-and-agentsmd)
- [Unknown harness](#unknown-harness)
- [Platform drift](#platform-drift)

---

## The general rule

```text
link / pointer           -> potentially lazy   (verify before claiming a saving)
import / include         -> often EAGER        (assume eager unless proven otherwise)
path-scoped instruction  -> conditionally eager
UI collapse (<details>)  -> NEVER lazy         (it is a rendering affordance, nothing more)
```

If you cannot prove a piece loads lazily, report the change as **organisation**, not as a token
saving. Overstating a saving is how a compression report becomes fiction.

## Claude Code

Verified 2026-08-09 against the official memory documentation. Re-check before relying on any row.

| Behaviour | What it does | What it means for you |
|---|---|---|
| Ancestor files | `CLAUDE.md` / `CLAUDE.local.md` above the working directory load **in full at launch**, concatenated root → cwd | Ancestor content is always resident. Compress it hardest |
| Descendant files | subdirectory `CLAUDE.md` files load **on demand when Claude reads files in those directories** | A genuine conditional tier. R-GATE check 3 passes here |
| `@path` imports | imported files "still load and enter the context window at launch"; max depth 4 hops; imports inside backticks are not expanded | **Splitting by import is organisation, not compression.** Never report it as a saving |
| `.claude/rules/` | one topic per file, discovered recursively; **without** `paths:` they load at launch | A rules file is not automatically cheaper than the root file |
| `paths:` frontmatter | glob-scoped rules apply "only when Claude is working with files matching the patterns", and trigger when it reads a matching file — not on every tool use | The **real** conditional-loading mechanism, and the preferred target for path-scoping |
| Block HTML comments | stripped from `CLAUDE.md` before injection; comments **inside code blocks are preserved**; still visible on a direct Read | Rationale and `GAP` markers can live in block comments at zero injected cost — in this harness only |
| `/compact` | project-root `CLAUDE.md` is re-read and re-injected; nested `CLAUDE.md` and `paths:` rules are **not** re-injected until a matching file is read again | **Availability risk.** A safety-critical rule moved to a path rule can silently vanish mid-session |
| Enforcement | `CLAUDE.md` is "context, not enforced configuration", delivered as a user message after the system prompt; to block an action you need a `PreToolUse` hook | Confirms the E-GATE hierarchy: hooks outrank prose |
| `AGENTS.md` | Claude Code reads `CLAUDE.md`, not `AGENTS.md`; bridge with an `@AGENTS.md` import or a symlink | Emit both only via a bridge. Never duplicate the content into two files |
| `InstructionsLoaded` hook | logs exactly which instruction files load, when, and why | **This is the load trace R-GATE check 2 wants.** Use it to prove a relocation instead of assuming one |
| `claudeMdExcludes` | glob-based exclusion of ancestor `CLAUDE.md` files | In a monorepo, excluding another team's file can beat compressing it |
| `/doctor` | proposes trims to a checked-in `CLAUDE.md`: cuts directory layouts, dependency lists and architecture overviews; keeps pitfalls, rationale and conventions that differ from tool defaults | First-party validation of the delete rules — and the baseline this skill has to beat |

The two rows that change plans most often: **`@` imports do not save anything**, and **path-scoped
rules do not survive `/compact`**. A safety-critical rule therefore stays in the root file even
when it is only relevant to one subtree.

## Choosing a relocation target

| The unit is… | Send it to | Why |
|---|---|---|
| needed on nearly every task | stay hot in the root file | residency is the point |
| a hard safety boundary, even if narrow in scope | stay hot in the root file | must survive `/compact`; must be present before the mistake |
| relevant only when working inside one subtree, and not safety-critical | subdirectory `CLAUDE.md`, or `.claude/rules/` with `paths:` | genuine conditional load |
| a deep procedure or schema needed occasionally | `references/*.md` with a pitched route | read only when the route fires |
| deterministic and checkable | a script, hook, linter config or CI gate | the tool becomes the constraint; only its output costs tokens |
| a whole task-specific workflow | its own skill | routed by name and description, body loads on activation |
| historical evidence | a docs file, linked from the rule that survives | keeps the rule hot, the evidence cold |

Leave a `path — what — when` route at every consumer. A move with no route is a deletion with extra
steps.

## Agent Skills packages

Verified 2026-08-09 against the authoring best-practices documentation.

- At startup **only** `name` + `description` are pre-loaded from each skill. The body is read when
  the skill becomes relevant; other files only as needed.
- Reference files "don't consume context tokens until actually read".
- Scripts "can be executed through bash without loading their full contents into context. **Only
  the script's output consumes tokens**" — output-only, not zero. Invocation and errors cost too.
- Make execution intent explicit: *"Run `analyze_form.py`"* (execute) versus *"See
  `analyze_form.py` for the algorithm"* (read). Those have very different costs.
- References **one level deep**; nested references get partially read. ToC on anything over 100
  lines. Name files descriptively — the filename is part of the retrieval index.
- Partition references by domain so a question about sales never loads finance schemas. Ship grep
  recipes instead of content where you can.
- Provide **one default with an escape hatch**, never a menu of equal options.
- Hard limits: `description` ≤1024 chars, `name` ≤64 chars of `[a-z0-9-]`. Body under 500 lines.
- Test against every model you plan to use — what works for the largest model may need more detail
  for the smallest. **Calibrate to the weakest target model.**
- Treat navigation as signal: unexpected exploration means the structure is not intuitive; a
  file that is never accessed should be deleted or re-signalled; a file read on every run belongs
  in the body.

## Codex and AGENTS.md

**Not verified in this pass — do not encode these as facts.** Corpus-reported behaviour: project
instructions are assembled from the project root toward the current working directory with closer
files taking precedence; a nested `AGENTS.md` is *not* discovered merely because the agent later
edits a file below it; the default `project_doc_max_bytes` is 32 KiB.

If that is accurate, nested `AGENTS.md` is conditional on launch topology rather than a free
retrieval tier, the byte cap is a harness limit rather than a content target, and safety-critical
scope must stay in the root or be minimally duplicated.

<!-- GAP: the canonical Codex AGENTS.md documentation URL is disputed in the source corpus and was
not verified. Confirm discovery, precedence and the byte cap before relying on any of it. -->

Until that is settled, treat Codex as an unknown harness for relocation purposes: compress in
place, and propose splits as suggestions the user can verify.

## Unknown harness

Fall back to **one portable Markdown file plus explicit pointers**. Specifically:

- do all the Tier-1 work — it is harness-independent;
- do not claim a saving for any split;
- never invent magic syntax to express conditional loading;
- record the harness assumption in the report so a later reader can re-test it.

## Platform drift

Load behaviour, frontmatter fields, budgets and discovery rules all change. Every row above carries
a verification date for that reason. Before making a structural change that depends on one of
them, re-check the current documentation — and if you cannot, say in the report that the move rests
on an unverified assumption.
