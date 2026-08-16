# biomd-convert

Converts legacy, malformed, mostly-Russian HTML into **BioMD Lite 1.6**
(`.bio.md`). Implements [`htm-to-md_utility_plan.md`](../htm-to-md_utility_plan.md).

**No API key required.** The converter is deterministic-first -- it repairs,
measures, classifies and emits without any model involvement. Two decisions
escalate to a model when one is configured: what an ambiguous table *is*, and
what to call a column the source never named. Both are counted and reported
whether or not a gateway exists, so `escalation point(s)` in a run tells you
exactly how much turning the LLM on would do before you spend anything.

**[Getting started](docs/GETTING-STARTED.md)** · **[Configuration](docs/CONFIGURATION.md)** · **[FAQ](docs/FAQ.md)** · **[Corpus profile](docs/CORPUS-PROFILE.md)**

- [Install](#install) · [Use it in three commands](#use-it-in-three-commands) · [Commands](#commands) · [Why Chromium](#why-chromium)
- [Optional: an LLM gateway](#optional-an-llm-gateway) · [Measuring conversion quality](#measuring-conversion-quality)
- [What it produces](#what-it-produces) · [Layout](#layout) · [The parts that carry the design](#the-parts-that-carry-the-design)
- [Target profiles](#target-profiles) · [Tests](#tests) · [Deviations from the plan](#deviations-from-the-plan)

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
ok      llobet.html   recall=100.0%  errors=0  reviews=0  tables=1/1  llm=0/0
REVIEW  segovia.html  recall=99.2%   errors=1  reviews=2  tables=2/2  llm=0/2

Converted:      412
Needs review:   7
Failed:         0
Clean share:    98.3%
LLM:            off — 19 escalation point(s) left as review items
```

`tables=a/b` is the structural conservation audit: `b` regions were classified
as data, `a` of them became Markdown tables. Text recall cannot see the
difference between a table and the same words spilled into paragraphs, so
structure is counted separately -- a `0/1` there is a silent loss at 100% recall.

**`corpus scan` is not optional in practice.** Site chrome -- the banner, the top
menu, the counter -- is not recognisable from one page; what identifies it is
that it is identical on every page. Without a profile the converter says so and
keeps it.

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
| `biomd inspect <file>` | Encoding, server-side code, parse errors -- no conversion |
| `biomd corpus scan [dir]` | Stage 0: chrome model + corpus lexicon |
| `biomd convert <file>` | Convert one page, with a full report |
| `biomd corpus run [dir]` | Convert a directory, resumable |
| `biomd validate <file>` | Check an existing `.bio.md` against the target |
| `biomd eval [dir]` | Score output against hand-written reference `.bio.md` files |
| `biomd probe` | Five-test gateway conformance probe |

Every command takes `--help`.

## Why Chromium

The converter renders each page to read *actual* geometry -- real column widths,
real box positions. That is how it tells a data table from a layout scaffold,
and `<td width="45%">` does not tell you: two cells declaring the same width
routinely render differently, and two with no width attribute at all often
render as a perfect 50/50 grid.

It works without a browser and says so (`Measured: no`), but table
classification is materially weaker. One 150 MB download, once.

## Optional: an LLM gateway

The converter never calls a provider API directly; it speaks the
OpenAI-compatible protocol to a gateway you choose. **OpenRouter works** --
base URL `https://openrouter.ai/api/v1` (not the `/chat/completions` endpoint).

```bash
biomd config set-gateway openrouter \
  --url https://openrouter.ai/api/v1 \
  --fast "deepseek/deepseek-v4-flash" \
  --structured json_schema --no-enforce-identity --activate

biomd config set-key openrouter    # prompts; stored outside the repo
biomd config test                  # one real request
```

Then run with `--llm assist` (or set `llm.enabled` in the config):

```bash
biomd corpus run --llm assist
biomd corpus run --replay          # re-run offline from the decision cache
```

Hooks are **plugins**, one directory each, discovered rather than listed. See
what exists, what is on and why, and inspect or exercise one without converting:

```bash
biomd hooks list
biomd hooks show table.classify
biomd hooks test table.classify --input item.json     # dry by default
biomd corpus run --llm assist --hooks table.records   # or --no-hooks
```

A new hook ships disabled, and `--llm assist` with nothing enabled is
byte-identical to `--llm off`. Writing one:
**[docs/LLM-HOOKS.md](docs/LLM-HOOKS.md)**.

If a run reports calls that resolved nothing, it now says why -- a mistyped model
id, an expired key and an exhausted budget all produce the same "0 resolved"
line and only the reason distinguishes them. The transport also degrades
`json_schema` → `tools` → `json_object` on its own: `response_format` is
OpenAI-specific, and a provider that ignores it returns an empty message rather
than an error.

Every decision is cached on the *resolved* model identity, so a second run over
the same corpus costs nothing and produces byte-identical output. Budgets are
reserved before a request is built, and a budget refusal, a dead gateway or a
malformed reply all degrade to "the deterministic answer stands, and the item
stays flagged" -- a model can never fail a conversion.

Full details, LiteLLM setup, budgets and the R1/R2/R3 transport rules:
**[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

## Measuring conversion quality

`biomd eval` scores produced output against hand-written reference documents --
what a person decided the conversion *should* look like. It needs a reference
set, which you write yourself: for a handful of pages, the conversion you would
have produced by hand, named after the source (`barrios.htm` → `barrios.bio.md`).
A dozen is plenty; they do not need to cover the corpus.

```bash
biomd eval --expected ./reference -v      # or set `expectedDir` in the config
```

```
file               text   head   link    img   dirs  cells  shape     tables  score
barrios            73.1   33.3   97.9   88.9   57.1   92.7   81.9        1/1   76.7
...
overall similarity to fixtures/out: 82.0
```

Every axis is an F1 over a multiset, so loss and invention are both penalized,
and structure (`cells`, `shape`, `dirs`) carries as much weight as prose. That
split exists because text recall alone stayed near 100% through a defect that
was deleting whole tables.

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
| `src/convert-core/` | Ledger, corpus pass, lexicon, de-hyphenation, link policy, boilerplate removal, table classification, semantic table planning, heading recovery, structure recovery, conservation |
| `src/llm/kernel/` | Hook framework: contract, filesystem discovery, prompt templates, runner, per-endpoint limiter, event stream |
| `src/llm/plugins/` | One directory per hook — definition, prompts, tests |
| `src/llm/` | Gateway transport, decision cache, budget, conformance probe, the resolver that joins the kernel to the compiler |
| `src/eval/` | Similarity scoring against reference documents |
| `src/cli/` | Commands, configuration, job artifact store, run reporter |

Layering is one-directional: `cli → {convert-core, llm, eval} → {ladom,
biomd-ast}`. `convert-core` does not import `llm`; it declares **decision
points** in its own vocabulary — one beside each rule that abstains, each
carrying its own acceptance check — and a hook claims one by id. There is no
list of hook names anywhere. The default resolver never escalates, which is what
makes a run with no gateway behave exactly as it always did.

## The parts that carry the design

**Measurement, not inference.** Legacy layout tables were authored *for a
browser*, so the reliable way to know what a page does is to ask one. This turns
the hardest guessing problem into a lookup.

**Ordering is load-bearing in four places**, each a bug that was found by
running the pipeline rather than reading it:

1. Quarantine before parsing, preserving offsets -- otherwise every provenance
   span shifts.
2. Measurement before `<head>` is dropped and before normalize -- those discard
   the evidence being measured.
3. De-hyphenation before whitespace normalization -- collapsing `\n` destroys the
   wrap evidence a join decision rests on.
4. S1 before reading text in the corpus pass -- a `<style>` body is a text node,
   so otherwise the lexicon learns `font-family` and `sans-serif` and feeds them
   back as hyphenation evidence.

**Invalid output is unrepresentable.** The content model of
`BioMD-Reference.md` §2 lives in the types and the builders (`Biography-Markup.md`
is the fallback for what the short reference leaves unstated). The serializer is
the only component that emits a `:::`.

The rule that keeps this honest: **the converter may narrow what it emits, never
what it accepts.** A narrowing that is a claim about the consuming renderer
belongs in a target profile; anything else is a defect, and three of them were --
a four-track `columns`, the palette tokens on a picture `frame:`, and a page
title wrapped over two `#` lines were all refused by this codebase and all
permitted by the format.

**De-hyphenation is the inverse problem.** No hyphenation library
de-hyphenates; patterns serve as a *validity oracle* at rule 6 of a seven-rule
cascade whose real work is done by the corpus lexicon and measured line
geometry. Every join is a reversible, audited operation.

**Conservation is mechanical, and structural as well as textual.** Text
shingles, link and image multisets, in vs out; content may be absent only where
the ledger records a `REMOVED(reason)`. Separately, every region classified as
data must have produced a table. Both halves are needed: the consuming renderer
discards what it does not understand *without an error*, so nothing downstream
notices a loss -- and text recall alone cannot tell a table from the same words
spilled into twenty-seven paragraphs.

**Three table representations, kept apart.** The repaired tree, the *physical*
occupancy grid (span coverage, origin cells), and the *semantic* record matrix.
Legacy tables routinely use more physical slots than they have columns -- a
FrontPage discography declares nine slots per row in a stable `7 + 1 + 1`
pattern and has three columns -- so the semantic width is inferred from the
dominant complete-row partition, and several physical cells inside one band
become one semantic cell. Requiring the two to be equal is what used to make
whole tables disappear.

**Emission is transactional.** A region is converted, inspected, and sometimes
rejected in favour of a different shape; everything a conversion appends to the
context is undoable. Without that, an abandoned attempt leaves its links behind
and the conservation gate reports them as invented content.

## Target profiles

`BioMD-Reference.md` and the renderer that consumes the output have
drifted. That divergence is data, not hardcoded behaviour
(`src/biomd-ast/profile.ts`):

| Construct | `renderer-current` (default) | `spec-1.6` |
|---|---|---|
| `::: frame` | not emitted -- degrades to a blockquote or titled section | emitted |
| `::: signature` | not emitted -- degrades to paragraphs | emitted |
| `columns` → `divider` | **never emitted** -- the target parses the property line as content, producing a bogus first column | emitted |
| `columns` → `columns: 2\|3\|4` | **never emitted** -- same defect, separate property: no property header inside `columns` is stripped | emitted |
| leading-zero list markers | loss recorded | preserved |

A profile flag is the *only* legitimate reason to emit less than the reference
permits. Everything else is accepted on read and validated on both profiles.

`src/biomd-ast/conformance.test.ts` reproduces each behaviour, so the
compatibility table cannot quietly go stale.

## Tests

```bash
npm test          # count grows over time; the runner prints the current total
npm run typecheck
```

Chromium-dependent tests skip cleanly when the browser is absent -- the pipeline
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
- **PostCSS dropped.** Always-on measurement removed the need --
  `getComputedStyle` resolves the cascade, legacy attributes and inline styles
  in one step.
