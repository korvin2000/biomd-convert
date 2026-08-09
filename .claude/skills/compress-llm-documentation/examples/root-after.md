# CLAUDE.md

Orders API — FastAPI service. Setup: `uv sync`, then `alembic upgrade head`.

## Commands

| Task | Command | Authority |
|---|---|---|
| Test | `pytest` (unit only: `pytest tests/unit`) | CI runs the full suite |
| Lint | `ruff check .` | the ruff config is the source of truth for style |
| Types | `mypy src/` | |
| New migration | `alembic revision --autogenerate -m "description"` then `alembic upgrade head` | |
| Regenerate API schema | `scripts/gen_openapi.py` | run after changing any router |

## Invariants

- Migrations are append-only — production replays them from zero on restore. So: never edit an
  applied migration, never reorder, add a new one to fix.
- `src/api/openapi.json` is generated. Never edit it by hand; `scripts/gen_openapi.py` overwrites it.
- Migrations live in `alembic/versions/`.
- Error responses use this exact envelope — the mobile client parses it positionally:

```json
{"error": {"code": "ORDER_NOT_FOUND", "message": "...", "trace_id": "..."}}
```

## Branching

```text
feature -> feat/something
bugfix  -> fix/something
hotfix  -> branch from the release tag
always: open a pull request; never push to main (protected, pushes are rejected)
```

## Boundaries

NEVER deploy manually — deploys happen from CI.
ASK in #eng-platform before any manual deploy.

## Config

Copy `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `STRIPE_SECRET_KEY`.

<!-- GAP: dependency versions were pinned in prose here. The original names no manifest or
     lockfile, so no query instruction can be written without inventing a path. -->

## Read when needed

| Topic | Where | When |
|---|---|---|
| Architecture | `docs/architecture.md` | before adding a service or changing module boundaries |

<!-- GAP: the original also said "see the runbook" with no path. Location unknown. -->
