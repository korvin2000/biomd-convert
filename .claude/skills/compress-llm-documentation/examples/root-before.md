# CLAUDE.md

![build](https://img.shields.io/badge/build-passing-green)
![python](https://img.shields.io/badge/python-3.12-blue)

## 🎯 Project Overview

Welcome to the Orders API! This is a Python web service built with FastAPI that handles customer
orders for our e-commerce platform. It follows modern best practices and aims to be clean,
maintainable, production-ready code. Please make sure to always write clean code and be thorough
when making changes to this repository.

The service exposes a REST API. REST stands for Representational State Transfer and is an
architectural style for designing networked applications, where resources are identified by URLs
and manipulated with standard HTTP verbs. Our API returns JSON responses, which are parsed by the
frontend.

## 📁 Directory Structure

```
orders-api/
├── src/
│   ├── api/          # FastAPI routers
│   ├── models/       # SQLAlchemy models
│   ├── services/     # business logic
│   └── db/           # session management
├── tests/
│   ├── unit/
│   └── integration/
├── scripts/
└── alembic/
```

## Dependencies

We currently use the following packages:

- fastapi 0.115
- sqlalchemy 2.0
- pydantic 2.9
- alembic 1.13
- pytest 8.3
- ruff 0.6
- mypy 1.11

## Getting Started

First, you should install the dependencies. We use `uv` for dependency management because it is
much faster than pip and has better lockfile support. Run `uv sync` to install everything. After
that you will probably want to run the database migrations, which you can do with
`alembic upgrade head`.

## Code Style

We care a lot about code style and consistency. Please follow these conventions:

- Use 4 spaces for indentation, never tabs.
- Maximum line length is 100 characters.
- Use snake_case for functions and variables, PascalCase for classes.
- Imports should be sorted: standard library first, then third party, then local.
- Always use double quotes for strings.
- Add a trailing comma to multi-line collections.
- Type annotations are required on all public functions.

You should run `ruff check .` to check style and `mypy src/` for type checking.

## Testing

Testing is very important and you should generally try to write tests for your changes. The test
suite can be run with `pytest`. It is usually a good idea to run the tests before you commit
anything. You may also want to run `pytest tests/unit` if you only changed unit-level code, since
that is faster.

Please make sure the tests pass before pushing. CI will run `pytest` anyway, plus `ruff check .`
and `mypy src/`, so it is better to catch problems locally.

## Database Migrations

Migrations live in `alembic/versions/`. To create one, run
`alembic revision --autogenerate -m "description"`. Then run `alembic upgrade head` to apply it.

Note that migrations are append-only because production replays them from zero during restore.

## The API Schema

The OpenAPI schema is generated, not written by hand. Run `scripts/gen_openapi.py` after changing
any router. Do not edit `src/api/openapi.json` directly — it will be overwritten. This has bitten
us more than once.

## Error Responses

All errors must use this exact envelope, because the mobile client parses it positionally:

```json
{"error": {"code": "ORDER_NOT_FOUND", "message": "...", "trace_id": "..."}}
```

## Branching

For branching we generally follow a fairly standard flow. If you are working on a feature, you
should create a branch named `feat/something`. If you are fixing a bug, you might prefer
`fix/something` instead. Either way, when you are done, you should open a pull request rather than
pushing to `main`, since `main` is protected and direct pushes will be rejected anyway. Reviewers
will typically want to see tests, a description of what changed, and so on. For hotfixes there is a
slightly different process where you branch from the release tag, but that is rare.

Before August 2025 we used a `develop` branch as an integration point, but we do not do that any
more.

## Deployment

Deploys happen from CI. Do not deploy manually. If you absolutely must, ask in #eng-platform first.

## Environment Variables

The service reads `DATABASE_URL`, `REDIS_URL`, and `STRIPE_SECRET_KEY` from the environment. There
is a `.env.example` file you can copy.

## Notes

See docs/architecture.md

Also see the runbook.

## Testing (again)

Remember that you can run the tests with `pytest`. Please run them before committing.
