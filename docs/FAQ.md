# FAQ

## Setup

### Do I need an API key or an LLM to use this?

No. The pipeline is deterministic-first and produces complete, validated output
with no model configured. Two decisions escalate when a gateway exists — what an
ambiguous table region is, and what to call a column the source never named —
and `corpus run` counts them either way, reporting `N escalation point(s) left
as review items`.

Configure a gateway to resolve those, preferably after you know how many there
are.

### Do I need Chromium?

Not strictly, but it is strongly recommended. The converter renders each page to
read *actual* column widths and box positions, which is how it distinguishes a
data table from a layout scaffold. Without it, that falls back to guessing from
`width="45%"` attributes.

```bash
npx playwright install chromium
```

The tool reports `Measured: no` and warns when running degraded, so you always
know which mode produced a result.

### Why does the same page convert differently with and without Chromium?

Because the evidence differs. With measurement, "these two cells are equal
width" is a fact; without it, it is an inference from an attribute that may not
reflect what the browser did. Pick one mode for a corpus and stay with it.

---

## LLM gateway

### Can I use OpenRouter?

Yes. It is an OpenAI-compatible gateway and works out of the box.

### What is the correct OpenRouter URL?

**`https://openrouter.ai/api/v1`**

Not `https://openrouter.ai/api/v1/chat/completions`. The `baseUrl` setting is
the API *base*; the client appends `/chat/completions`. If you paste the full
endpoint the tool strips it and tells you, so either works — but the base is the
correct value.

| Gateway | `baseUrl` |
|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` |
| LiteLLM (local) | `http://localhost:4000/v1` |
| OpenAI-compatible generally | whatever precedes `/chat/completions` |

### How do I store my API key so I don't type it every time?

```bash
biomd config set-key openrouter
```

It prompts (so the key never enters shell history) and writes to your **user**
config — `~/.config/biomd/config.json` or `%APPDATA%\biomd\config.json` — which
is outside your repository and cannot be committed by accident.

Three alternatives:

```bash
# 1. An environment variable named by the project config
#    ("apiKeyEnv": "OPENROUTER_API_KEY")
export OPENROUTER_API_KEY=sk-or-v1-...

# 2. A .env file beside biomd.config.json (git-ignore it)
echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .env

# 3. Fully via environment, no config file at all
export BIOMD_GATEWAY_URL=https://openrouter.ai/api/v1
export BIOMD_GATEWAY_KEY=sk-or-v1-...
export BIOMD_MODEL=deepseek/deepseek-v4-flash
```

Never put a key in `biomd.config.json` if that file is committed.

### How do I choose the model?

Three tiers, cheapest first:

```jsonc
"models": {
  "fast":     "deepseek/deepseek-v4-flash",   // high-volume classification
  "balanced": "deepseek/deepseek-v4-flash",
  "deep":     "anthropic/claude-sonnet-5"     // escalations only
}
```

Setting only one is fine; the others fall back to it. A hook starts at `fast`
and escalates on an invalid reply or low confidence, so the expensive tier
handles a small minority.

### How do I check my configuration is right?

```bash
biomd config show     # every value, and which file it came from
biomd config test     # one real request end to end
biomd config test --full   # the five-test conformance probe
```

`config test` proves URL, key, model and structured output all work together. A
401 means the request shape was fine and only the key was rejected — which is
still useful information.

### `config test` fails. What now?

The failure message lists the usual causes. In order of likelihood:

1. **baseUrl includes `/chat/completions`.** It should not.
2. **Key missing or wrong.** `biomd config show` shows a redacted key and where
   it came from; `(not set)` means nothing resolved it.
3. **Model unavailable on that gateway.** Check the exact id.
4. **`structuredOutput` unsupported by that model.** Try `json_schema` on
   OpenRouter, `tools` elsewhere. This never affects correctness — the reply is
   validated locally either way.

### Which `structuredOutput` should I use?

`tools` (function calling) is the safest default and right for LiteLLM.
`json_schema` is what OpenRouter documents. `json_object` is a last resort.

If one fails, try another; local validation is the authority regardless.

### Why does it refuse to run when the gateway returns a different model?

Because a gateway model name is a server-side alias. If someone repoints it,
cache keys stay identical while the model behind them changes — silently, and
your cached decisions would then come from an unknown model.

Set `"enforceModelIdentity": false` for gateways whose IDs are documented
aliases (OpenRouter's `~openai/gpt-latest` resolves by design). The resolved
name still keys the cache, so reproducibility holds.

### Does prompt caching work? Does the Batch API?

Caching: yes on OpenRouter and LiteLLM — the tool sends `cache_control` and
reads back cached-token counts. `config test --full` confirms it per deployment.

Batch API: gateway-dependent, and generally not proxied. Both are **cost-only**.
Losing them raises spend and changes no output byte; the dominant savings come
from the deterministic path and the local decision cache, which are
transport-independent.

### Should I turn off my gateway's "prompt compression" feature?

Yes, always. The decision cache is keyed on the payload *sent*; if a middlebox
rewrites the prompt, a cache hit no longer identifies what the model saw and
replay stops being reproducible. `config test --full` tries to detect it by
comparing reported input tokens against payload size.

---

## The corpus profile

### Where is `corpus/corpus-profile.json`? It doesn't exist.

It is generated. Run:

```bash
biomd corpus scan
```

See [CORPUS-PROFILE.md](CORPUS-PROFILE.md) for its structure and what each part
is used for.

### Do I have to run `corpus scan` first?

Conversion works without it, and the tool warns when it is missing. But two
things get materially worse: chrome detection (your site menu stays in every
document) and de-hyphenation (fewer wrapped words are confidently rejoined).
Run it once per corpus.

### The site menu is still in every output file.

The corpus pass did not recognise it as chrome. Either you skipped
`corpus scan`, or the structure appears on fewer than 70% of pages:

```bash
biomd corpus scan --chrome-threshold 0.5
```

Check `stableChrome` in the profile afterwards — if it is empty, nothing was
classified as chrome.

---

## Output and quality

### What does "conversion-review-required" mean? Did it fail?

No — the document was written. It means a gate flagged something: conservation
found missing content, or the validator found an error. Exit code `2`. Look at
`.biomd-work/<job>/08-validation/report.json`.

### Text recall is below 100%. What is missing?

`conservation.text.missingExamples` in the validation report lists the exact
word sequences that did not reach the output. Content removed on purpose (page
chrome) is excused automatically — anything still listed genuinely went missing.

### Where did a specific paragraph go?

The ledger. Every source element has exactly one terminal state:

```bash
node -e "for (const e of require('./.biomd-work/<job>/05-ir/ledger.json'))
  if (e.terminal.kind === 'REMOVED') console.log(e.id, '→', e.terminal.reason)"
```

This is enforced, not aspirational: a pass that fails to account for an element
throws rather than losing it quietly.

### Why is `::: frame` / `::: signature` / `divider: true` never emitted?

Because the current renderer mishandles all three, and `divider` actively
corrupts the page — the property text is parsed as content and becomes a bogus
first column. The default profile refuses to emit them and degrades
deterministically instead.

To emit them anyway (e.g. targeting a fixed renderer):

```bash
biomd convert page.htm --profile spec-1.6
```

### Why did my two-column layout become a single flat sequence?

`layoutFidelity: simplified`, the default. Presentational lanes collapse into
linear reading order — which is exactly what a phone shows anyway, since lanes
stack. Use `--layout-fidelity faithful` to preserve them where geometry proves
them.

### A word was joined that should not have been (or vice versa).

Check `05-ir/text-operations.json`: every join records the rule that decided it
and its confidence. The cascade is deterministic and documented in
[../README.md](../README.md#the-parts-that-carry-the-design).

The usual fix is the corpus lexicon — a bigger `corpus scan` gives rules 4 and 5
more evidence. Uncertain cases are left alone and marked `REVIEW` rather than
guessed.

---

## Operations

### Can I interrupt a corpus run and resume?

Yes. Each file is a content-addressed job under `.biomd-work/`, and a stage is
reused only when its input hash, engine version and profile all match. Re-run
the same command.

### Is the output deterministic?

Yes, for the deterministic path: same bytes in, byte-identical output. With
measurement enabled it also depends on the pinned Chromium version and bundled
fonts. Model decisions are cached by content hash, so a re-run replays rather
than re-asks.

### How do I convert just one file?

```bash
biomd convert html/segovia.html
```

### How do I validate a `.bio.md` I already have?

```bash
biomd validate out/segovia.bio.md
```

Checks it against the target profile — fences, properties, nesting, line length,
leaked server markup.

### How do I see what the parser makes of a page without converting it?

```bash
biomd inspect html/segovia.html
```

Encoding decision, server-side islands found, parse errors, element count.
Start here when a page behaves strangely.
