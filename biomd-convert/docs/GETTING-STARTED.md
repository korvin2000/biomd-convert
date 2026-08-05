# Getting started

A complete walkthrough, from an empty directory to converted documents. No prior
knowledge of the tool assumed.

**The short version:** the converter is deterministic. You do **not** need an
API key, an LLM, or an account to use it. The model integration is optional and
only resolves cases the rules cannot.

---

## 1. Install

```bash
cd biomd-convert
npm install
npm run build
```

Then, strongly recommended:

```bash
npx playwright install chromium
```

This downloads a browser (~150 MB, once). The converter uses it to *measure* how
each legacy page actually renders — real column widths, real box positions —
which is how it tells a data table from a layout scaffold. Without it the tool
still works, but falls back to guessing from `width="45%"` attributes, and table
detection gets noticeably worse. It will tell you when it is running degraded.

Check it worked:

```bash
node dist/cli/index.js --version
```

> **Tip.** The examples below use `node dist/cli/index.js`. To type just `biomd`,
> run `npm link` once, or add an alias:
> `alias biomd="node $PWD/dist/cli/index.js"`

---

## 2. Set up a project

Make a working directory and put your HTML in it:

```
my-migration/
  html/            ← your .htm / .html files (and their images)
```

From inside `my-migration/`:

```bash
biomd config init
```

That writes an annotated `biomd.config.json`. Open it and set the paths:

```jsonc
{
  "inputDir": "./html",
  "assetRoot": "./html",     // where images referenced by the pages live
  "outDir": "./out",
  "visual": "always"
}
```

Everything else has a sensible default. Confirm what the tool actually sees:

```bash
biomd config show
```

Every value is listed with where it came from — `[default]`, `[project-config]`,
`[env]` or `[flag]`. If a setting is not doing what you expect, this command
tells you which file won.

---

## 3. Look at one page before converting anything

```bash
biomd inspect html/segovia.html
```

```
Encoding:     windows-1251 (via declared)
  declared:   windows-1251
  detected:   windows-1252
Server islands: 1
Parse errors:   1
Elements:       135
  php at line 36: <?php include("right_rail.php"); ?>
     1 × missing-doctype
```

This runs only the front half — decode, quarantine server-side code, parse — and
reports what it found. Use it when a page converts oddly: if the encoding is
wrong here, nothing downstream can be right.

---

## 4. Scan the corpus (do this first, once)

```bash
biomd corpus scan
```

```
Scanning 412 file(s)…
Files scanned:        412
Distinct fingerprints:19
Chrome structures:    5
Lexicon:              14203 forms, 210544 tokens, 892 hyphenated
Uncertain encodings:  3
Written to            .../corpus/corpus-profile.json
```

This produces `corpus/corpus-profile.json` — see
[CORPUS-PROFILE.md](CORPUS-PROFILE.md). **It is not optional in practice.** It
gives the converter two things it cannot derive from a single page:

- **which structures are site chrome.** A navigation table that appears on 400 of
  412 pages is chrome whatever it looks like. Without this, your site menu ends
  up in every converted document.
- **a vocabulary of your corpus.** Used to decide whether `гита-\nрист` should be
  rejoined into `гитарист`. 20 MB of single-domain Russian contains exactly the
  composer and place names a general dictionary lacks.

Re-run it whenever the source set changes materially.

---

## 5. Convert

One file, to look at the result closely:

```bash
biomd convert html/segovia.html
```

```
html/segovia.html → .../out/segovia.bio.md

State:        conversion-complete
Encoding:     windows-1251 (declared)
Measured:     yes
Text recall:  100.00%
Targets:      conserved
Images:       conserved
Complexity:   1 directives, depth 1, 10.75/1000 words
Tables:       DATA, SHELL, LAYOUT
Job:          .biomd-work/segovia-eb186dfc82d5
```

Then the whole corpus:

```bash
biomd corpus run
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

Three numbers to read:

- **`Clean share`** — converted with every gate passed and nothing flagged.
- **`tables=a/b`** — of `b` regions classified as data, `a` became Markdown
  tables. This is a separate audit from text recall on purpose: a table
  flattened into paragraphs loses its rows and columns while keeping every word,
  so recall stays at 100% and nothing else would notice.
- **`escalation point(s)`** — decisions the rules abstained on. They are counted
  whether or not a model is configured, so you can see what an LLM would buy
  before paying for one.

---

## 6. Read the result

Every run writes an audit trail to `.biomd-work/<job>/`:

| File | What it answers |
|---|---|
| `01-decode/encoding-report.json` | Which codec, why, and what the alternatives scored |
| `02-repair/repaired.html` | The structurally repaired HTML — deliverable of step 1 |
| `04-clean/clean-body.html` | Content after scripts, PHP, head and chrome were removed |
| `05-ir/ledger.json` | **Every source element and what happened to it** |
| `05-ir/text-operations.json` | Every word join, with the rule that decided it |
| `08-validation/report.json` | Conservation, diagnostics, table classifications |
| `07-output/document.bio.md` | The output |

The ledger is the one to reach for when content is missing. Every entry has a
terminal state — `EMITTED`, `MERGED_INTO`, `MOVED_TO`, `REMOVED(reason)` or
`REVIEW(reason)` — so "where did that paragraph go?" always has an answer.

```bash
# What was removed, and why?
node -e "for (const e of require('./.biomd-work/segovia-*/05-ir/ledger.json'))
  if (e.terminal.kind==='REMOVED') console.log(e.id, e.terminal.reason)"
```

---

## 7. Understand the exit codes

| Code | Meaning |
|---|---|
| `0` | Converted, all gates passed |
| `2` | Converted, but needs review — conservation failed or a validator error |
| `1` | The command failed |

`conversion-review-required` is not a crash. The document was written; something
about it is worth a human look, and the report says what.

---

## 8. Optional: add a model

Worth doing once you know your escalation count. The run reports it with the
LLM off, so the decision is informed rather than hopeful.

The two escalation points are: what an ambiguous table region *is*, and what to
call a column the source never gave a header. Both are things a rule genuinely
cannot settle — §3.8 requires a meaningful header for every column, and §16.3
classes inventing one as an editorial change, which is precisely why the
converter asks instead of guessing.

See [CONFIGURATION.md](CONFIGURATION.md#llm-gateways) for the full setup. The
short form, with OpenRouter:

```bash
biomd config set-key openrouter        # prompts; stored outside your repo
biomd config test                      # one real request, proves it works
biomd corpus run --llm assist          # escalate the residual ambiguity
biomd corpus run --replay              # re-run offline from the decision cache
```

If the run reports model calls that resolved nothing, the reason is printed
underneath. The commonest cause is a model id the gateway does not recognise —
`biomd probe` confirms it in one request.

Decisions are cached on the resolved model identity, so a second run costs
nothing and produces byte-identical output. A budget refusal, an unreachable
gateway or a malformed reply all fall back to the deterministic answer with the
item still flagged — a model can never fail a conversion.

Then set `"llm": { "enabled": true }` in the config.

---

## Common first-run problems

**"note: no corpus profile at …"**
You skipped step 4. Conversion still works, but chrome removal and
de-hyphenation are weaker. Run `biomd corpus scan`.

**"Measured: no" and a warning about geometry**
Chromium is not installed. Run `npx playwright install chromium`. Table
classification is materially better with it.

**The site menu appears in every output document**
The corpus pass has not identified it as chrome. Either you skipped step 4, or
you scanned too few files for a structure to look "repeated". Chrome detection
needs a structure on ≥70% of pages by default; lower it with
`biomd corpus scan --chrome-threshold 0.5`.

**Text recall below 100% and the run says review required**
Real content went missing. Open `08-validation/report.json` and look at
`conservation.text.missingExamples` — those are the exact word sequences that
did not make it.

**Cyrillic comes out as mojibake**
Check `biomd inspect`. If the declared charset is wrong *and* the scorer picked
the wrong codec, the encoding report shows every candidate and its score. File
this as a bug with that report attached.
