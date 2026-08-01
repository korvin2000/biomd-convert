# biomd-convert

Converts legacy, malformed, mostly-Russian HTML into **BioMD Lite 1.6**
(`.bio.md`). Implements [`htm-to-md_utility_plan.md`](../htm-to-md_utility_plan.md).

**No API key required.** The converter is deterministic — it repairs, measures,
classifies and emits without any model involvement. LLM support is optional and
exists only to resolve cases the rules cannot.

📖 **[Getting started](docs/GETTING-STARTED.md)** · **[Configuration](docs/CONFIGURATION.md)** · **[FAQ](docs/FAQ.md)** · **[Corpus profile](docs/CORPUS-PROFILE.md)**

---

## Install

```bash
npm install
npm run build
npx playwright install chromium    # recommended, see below
```

## Use it in three commands

```bash
biomd config init      # writes an annotated biomd.config.json — set inputDir
biomd corpus scan      # learns your site's chrome and vocabulary (once)
biomd corpus run       # converts everything
```

```
ok      llobet.html   recall=100.0%  errors=0
ok      segovia.html  recall=100.0%  errors=0

Converted:      412
Needs review:   7
Failed:         0
Green share:    98.3%  (converted with zero model calls)
```

Once configured, no flags are needed. Flags exist for one-off overrides and all
of them mirror a config setting.

> `biomd` here means `node dist/cli/index.js`. Run `npm link`, or
> `alias biomd="node $PWD/dist/cli/index.js"`.

## Commands

| Command | Purpose |
|---|---|
| `biomd config init` | Create an annotated project config |
| `biomd config show` | Effective settings **and where each came from** |
| `biomd config set-key <gw>` | Store an API key outside the repository |
| `biomd config test [--full]` | Verify a gateway really works |
| `biomd inspect <file>` | Encoding, server-side code, parse errors — no conversion |
| `biomd corpus scan [dir]` | Stage 0: chrome model + corpus lexicon |
| `biomd convert <file>` | Convert one page, with a full report |
| `biomd corpus run [dir]` | Convert a directory, resumable |
| `biomd validate <file>` | Check an existing `.bio.md` against the target |
| `biomd probe` | Five-test gateway conformance probe |

Every command takes `--help`.

## Why Chromium

The converter renders each page to read *actual* geometry — real column widths,
real box positions. That is how it tells a data table from a layout scaffold,
and `<td width="45%">` does not tell you: two cells declaring the same width
routinely render differently, and two with no width attribute at all often
render as a perfect 50/50 grid.

It works without a browser and says so (`Measured: no`), but table
classification is materially weaker. One 150 MB download, once.

## Optional: an LLM gateway

The converter never calls a provider API directly; it speaks the
OpenAI-compatible protocol to a gateway you choose. **OpenRouter works** —
base URL `https://openrouter.ai/api/v1` (not the `/chat/completions` endpoint).

```bash
biomd config set-gateway openrouter \
  --url https://openrouter.ai/api/v1 \
  --fast "deepseek/deepseek-v4-flash" \
  --structured json_schema --no-enforce-identity --activate

biomd config set-key openrouter    # prompts; stored outside the repo
biomd config test                  # one real request
```

Full details, LiteLLM setup, budgets and the R1/R2/R3 transport rules:
**[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

---

## What it produces

For each page: a `.bio.md`, plus an audit trail under `.biomd-work/<job>/`.

| Artifact | Answers |
|---|---|
| `01-decode/encoding-report.json` | Which codec, why, what the alternatives scored |
| `02-repair/repaired.html` | The structurally repaired HTML |
| `04-clean/clean-body.html` | Content after scripts, PHP, head and chrome removal |
| `05-ir/ledger.json` | **Every source element and what happened to it** |
| `05-ir/text-operations.json` | Every word join, with the rule that decided it |
| `08-validation/report.json` | Conservation, diagnostics, table classifications |

Exit codes: `0` converted · `2` converted but needs review · `1` failed.

---

## Layout

| Directory | Role |
|---|---|
| `src/biomd-ast/` | Output contract: types, validating builders, serializer, reader, validator, target profiles |
| `src/ladom/` | Input: encoding, server-markup quarantine, parse, S1 sanitize, grid materialization, Chromium measurement, normalize |
| `src/convert-core/` | Ledger, corpus pass, lexicon, de-hyphenation, link policy, table classification, structure recovery, conservation |
| `src/llm/` | Hook runtime, gateway transport, decision cache, budget, conformance probe |
| `src/cli/` | Commands, configuration, job artifact store |

Layering is one-directional: `cli → convert-core → {ladom, biomd-ast}`, with
`llm` called only by `convert-core`.

## The parts that carry the design

**Measurement, not inference.** Legacy layout tables were authored *for a
browser*, so the reliable way to know what a page does is to ask one. This turns
the hardest guessing problem into a lookup.

**Ordering is load-bearing in four places**, each a bug that was found by
running the pipeline rather than reading it:

1. Quarantine before parsing, preserving offsets — otherwise every provenance
   span shifts.
2. Measurement before `<head>` is dropped and before normalize — those discard
   the evidence being measured.
3. De-hyphenation before whitespace normalization — collapsing `\n` destroys the
   wrap evidence a join decision rests on.
4. S1 before reading text in the corpus pass — a `<style>` body is a text node,
   so otherwise the lexicon learns `font-family` and `sans-serif` and feeds them
   back as hyphenation evidence.

**Invalid output is unrepresentable.** The content model of
`Biography-Markup.md` §4.1 lives in the types and the builders. The serializer
is the only component that emits a `:::`.

**De-hyphenation is the inverse problem.** No hyphenation library
de-hyphenates; patterns serve as a *validity oracle* at rule 6 of a seven-rule
cascade whose real work is done by the corpus lexicon and measured line
geometry. Every join is a reversible, audited operation.

**Conservation is mechanical.** Text shingles, link and image multisets, in vs
out. Content may be absent only where the ledger records a `REMOVED(reason)`.
This matters because the consuming renderer discards what it does not
understand *without an error* — nothing downstream would ever notice a loss.

## Target profiles

`Biography-Markup.md` v1.6 and the renderer that consumes the output have
drifted. That divergence is data, not hardcoded behaviour
(`src/biomd-ast/profile.ts`):

| Construct | `renderer-current` (default) | `spec-1.6` |
|---|---|---|
| `::: frame` | not emitted — degrades to a blockquote or titled section | emitted |
| `::: signature` | not emitted — degrades to paragraphs | emitted |
| `columns` → `divider` | **never emitted** — the target parses the property line as content, producing a bogus first column | emitted |
| leading-zero list markers | loss recorded | preserved |

`src/biomd-ast/conformance.test.ts` reproduces each behaviour, so the
compatibility table cannot quietly go stale.

## Tests

```bash
npm test          # 144 tests
npm run typecheck
```

Chromium-dependent tests skip cleanly when the browser is absent — the pipeline
must work without it, so skipping is correct rather than a hidden failure.

## Deviations from the plan

- **Single package, directory-per-module** instead of npm workspaces. The
  boundaries of plan §13.2 are preserved 1:1 and convert mechanically; nothing
  is published separately, so the packaging overhead bought nothing.
- **No Nu Html Checker.** Per the recorded decision, repaired and sanitized HTML
  are retained as deliverables with honest validity levels, without a Java
  dependency.
- **parse5 directly rather than via `rehype-parse`.** It already yields source
  locations and a spec tree.
- **PostCSS dropped.** Always-on measurement removed the need —
  `getComputedStyle` resolves the cascade, legacy attributes and inline styles
  in one step.
