# Worked example

A complete run on a realistic bloated root file: measure → plan → compress → verify. Read it when
you want to see what a finished pass looks like, including the parts that are *not* the new file.

| File | What it is |
|---|---|
| `root-before.md` | A bloated `CLAUDE.md` carrying most of the common smells at once |
| `root-after.md` | The result at **medium** level — 128 → 55 lines, ~59% fewer tokens |
| `plan.json` | The approval record: every anchor deliberately dropped, with a reason |
| `docs/architecture.md` | A stub, so the route in the compressed file actually resolves |

Reproduce it:

```bash
python ../scripts/analyze.py root-before.md --out /tmp/ex --repo-root .
python ../scripts/verify.py --work /tmp/ex --after root-after.md --plan plan.json --repo-root .
```

Expected verdict: **PASS with warnings** — no unapproved anchor loss, no invention.

## What was cut, and on what grounds

| Cut | Rule | Grounds |
|---|---|---|
| Project overview, REST explanation | 1.2 | Base-model knowledge. Zero surprisal, and it induces extra exploration |
| Directory tree | 1.2 | Derivable inventory; repository overviews measurably do not help agents find files |
| Dependency version list | 1.7 | Mutable state with no owner. See the GAP note below |
| Style rules (indent, quotes, naming, imports) | 1.1 | E-GATE passes: `ruff check .` enforces them and is now named as the authority |
| "Testing (again)" section | 1.3 | Exact duplicate of the Testing section; D-GATE clears it |
| `develop` branch paragraph | 1.11 | Dated conditional the source itself says is abandoned |
| Badges | 1.15 | Cost per glyph, no instruction content |
| "much faster than pip" | 4.4 | Motivation. Does not let the model derive an unwritten rule |

## What was deliberately kept

- **Every command**, verbatim, gathered into one table with an authority column.
- **The migrations rationale.** "Production replays them from zero on restore" costs ~14 tokens and
  lets the model derive three rules nobody wrote: never edit an applied migration, never reorder,
  add a new one to fix. That is the test for keeping a *why*.
- **The error envelope**, exactly. It is the only statement of an output contract, so it is not an
  example — it is a specification.
- **The openapi gotcha.** The agent cannot discover "this file is overwritten" before it edits the
  file and loses the work.
- **The precedence in branching**, re-encoded as a guard ladder that makes the default explicit.

## The two GAP markers

The source pins dependency versions in prose but never names a manifest or lockfile. The tempting
move is to write "read versions from `pyproject.toml`" — but that file is never mentioned, so
writing it would be **inventing a fact**, which is the one thing a compressor may never do. The
absence is recorded instead:

```markdown
<!-- GAP: dependency versions were pinned in prose here. The original names no manifest or
     lockfile, so no query instruction can be written without inventing a path. -->
```

The same applies to "Also see the runbook" — a reference with no target. It becomes a GAP, not a
guess. In Claude Code these block comments are stripped before injection, so they cost the agent
nothing while staying visible to a human reviewer.

## Warnings the run legitimately produces

Not every warning is a defect. These three are expected, and the report should explain rather than
suppress them:

- **`anchor-reencoded` (4).** The branching prose became a guard ladder, so four fenced lines are
  new text. They introduce no identifier the source lacks, which is why they warn rather than fail.
- **`route-inherited-broken` (3).** `scripts/gen_openapi.py` and `src/api/openapi.json` do not
  exist in this fixture directory. They were already unresolvable in the source, so the pass did not
  break them — but shipping them silently would still be wrong.
- **`directive-coverage` (14 of 21).** Deletion is the point of the exercise. Each unmatched
  directive appears in the table above or in `plan.json`; an unexplained one would be the defect.
