# Configuration

## Where settings live

Five sources, highest precedence first:

| # | Source | Example |
|---|---|---|
| 1 | CLI flag | `--visual never` |
| 2 | Environment variable | `BIOMD_VISUAL=never` |
| 3 | Project config | `./biomd.config.json`, searched upward from cwd |
| 4 | User config | `~/.config/biomd/config.json`, or `%APPDATA%\biomd\config.json` |
| 5 | Built-in default | — |

```bash
biomd config path     # which files are consulted
biomd config show     # effective values, each tagged with where it came from
```

`config show` is the answer to "why is it doing that?" — every line ends with
`[default]`, `[user-config]`, `[project-config]`, `[env]` or `[flag]`.

**Why two config files.** The project config is meant to be committed: paths,
profile, layout policy — the things your team shares. The user config is *not*
in your repository, which is where API keys belong. `biomd config set-key`
writes there deliberately, and chmods it to `0600` where the filesystem allows.

A `.env` file next to the project config is loaded automatically. Real
environment variables take precedence over it.

---

## Creating a config

```bash
biomd config init
```

Writes an annotated `biomd.config.json`. Comments are allowed — the file is
parsed as JSONC — so it can explain itself.

---

## Conversion settings

```jsonc
{
  "profile": "renderer-current",
  "layoutFidelity": "simplified",
  "visual": "always",
  "lang": "ru",

  "inputDir": "./html",
  "assetRoot": "./html",
  "outDir": "./out",
  "workDir": ".biomd-work",
  "corpus": "corpus/corpus-profile.json",
  "jobs": 4
}
```

| Setting | Values | Meaning |
|---|---|---|
| `profile` | `renderer-current` · `spec-1.6` | What the consuming renderer can render. `renderer-current` never emits `::: frame`, `::: signature` or `columns.divider`, because the current renderer mishandles all three. See [the profile table](../README.md#target-profiles). |
| `layoutFidelity` | `simplified` · `faithful` | `simplified` collapses presentational lanes into linear flow — recommended, and what a phone shows anyway. `faithful` preserves lanes wherever measured geometry proves them. |
| `visual` | `always` · `auto` · `never` | Browser measurement. `never` needs no Chromium but makes table classification materially worse. |
| `lang` | `ru`, `en`, `de`, … | Primary language, for hyphenation patterns and sentence handling. |
| `inputDir` | path | Default source directory, so `corpus run` needs no argument. |
| `assetRoot` | path | Where images referenced by the pages live. Serving the real files during measurement gives exact intrinsic sizes, which decides `size: small/medium/large`. |
| `jobs` | integer | Concurrency. Capped at 4 when the browser is in use, since browser contexts are the scarce resource. |

Every one has a matching CLI flag for one-off overrides:
`--profile`, `--layout-fidelity`, `--visual`, `--lang`, `--asset-root`,
`--out-dir`, `--work-dir`, `--corpus`, `--jobs`.

---

## LLM gateways

**Nothing here is required.** The pipeline is deterministic-first: with
`"enabled": false` it produces complete, validated output. Configure a gateway
only to resolve the residual ambiguity — and only after `corpus run` has told
you your Green share, so you know how much there is to resolve.

The converter never calls a provider API directly. It speaks the
OpenAI-compatible `/v1/chat/completions` protocol to a gateway of your choosing.

### OpenRouter

Yes, OpenRouter works. It is an OpenAI-compatible gateway.

**The base URL is `https://openrouter.ai/api/v1`** — *not*
`https://openrouter.ai/api/v1/chat/completions`. The client appends
`/chat/completions` itself. (If you paste the full endpoint anyway, the tool
strips it and tells you.)

Fastest path:

```bash
biomd config set-gateway openrouter \
  --url https://openrouter.ai/api/v1 \
  --fast "deepseek/deepseek-v4-flash" \
  --deep "anthropic/claude-sonnet-5" \
  --structured json_schema \
  --no-enforce-identity \
  --activate

biomd config set-key openrouter     # prompts, so the key stays out of shell history
biomd config test                   # one real request
```

Or in `biomd.config.json`:

```jsonc
{
  "llm": {
    "enabled": true,
    "gateway": "openrouter",
    "gateways": {
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",

        // Name the variable, don't paste the key into a committed file.
        "apiKeyEnv": "OPENROUTER_API_KEY",

        "headers": {
          // Both optional; they attribute usage on OpenRouter's leaderboards.
          "HTTP-Referer": "https://your-site.example",
          "X-OpenRouter-Title": "biomd-convert"
        },

        "models": {
          "fast": "deepseek/deepseek-v4-flash",
          "balanced": "deepseek/deepseek-v4-flash",
          "deep": "anthropic/claude-sonnet-5"
        },

        // OpenRouter documents response_format: json_schema. Tool-calling
        // support varies by upstream provider, so this is the safer choice here.
        "structuredOutput": "json_schema",

        // Route only to providers that honour the parameters we send.
        "extraBody": { "provider": { "require_parameters": true } },

        // OpenRouter may resolve an alias (e.g. ~openai/gpt-latest) to a
        // concrete model, so an exact echo of the requested id is not expected.
        "enforceModelIdentity": false
      }
    }
  }
}
```

With the key in `.env` next to the config:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

### LiteLLM (self-hosted)

```jsonc
{
  "llm": {
    "enabled": true,
    "gateway": "litellm",
    "gateways": {
      "litellm": {
        "baseUrl": "http://localhost:4000/v1",
        "apiKeyEnv": "LITELLM_API_KEY",
        "models": { "fast": "claude-haiku-4-5", "balanced": "claude-sonnet-5", "deep": "claude-opus-5" },
        "structuredOutput": "tools",
        "enforceModelIdentity": true
      }
    }
  }
}
```

LiteLLM is the recommended self-hosted option: it is the only gateway confirmed
to carry every capability this pipeline uses, including `cache_control`
passthrough with cache-token reporting, and its virtual keys give you a
server-side USD budget that a bug in this tool cannot bypass.

### Gateway fields

| Field | Default | Notes |
|---|---|---|
| `baseUrl` | — | API base, **not** the endpoint. |
| `apiKey` | — | Literal key. Use only in the *user* config. |
| `apiKeyEnv` | — | Name of an env var holding the key. Preferred in a project config. |
| `headers` | `{}` | Extra request headers. |
| `models.fast` / `.balanced` / `.deep` | — | Escalation tiers. `fast` handles volume; `deep` handles hard cases. Setting one is fine — the others fall back to it. |
| `structuredOutput` | `tools` | `tools` · `json_schema` · `json_object`. See below. |
| `extraBody` | `{}` | Merged into the request body, for gateway-specific options. |
| `enforceModelIdentity` | `true` | Fail if the gateway used a different model than requested. |
| `timeoutMs` | `120000` | Per request. |

### Choosing `structuredOutput`

Every hook returns typed data, and there are three ways to ask for it:

- **`tools`** — function calling. Universally supported; the default, and right
  for LiteLLM and most gateways.
- **`json_schema`** — `response_format: {type: "json_schema", strict: true}`.
  What OpenRouter documents. Enforcement varies by upstream provider.
- **`json_object`** — plain JSON mode with the schema stated in the prompt. Last
  resort for models supporting neither.

If `biomd config test` returns a schema violation, try a different mode. **The
choice never affects correctness** — the reply is validated locally regardless,
and an invalid one is retried, escalated, then routed to review.

### Why `enforceModelIdentity` exists

Through a gateway, `claude-sonnet-5` is a *server-side config alias*. If someone
repoints it, cache keys stay byte-identical while the model behind them changes
— silently. The tool reads the resolved model back from the response and, by
default, refuses to continue if it differs.

Turn it off for gateways whose IDs are documented aliases (OpenRouter resolves
`~openai/gpt-latest` by design). The resolved name still keys the cache either
way, so reproducibility holds; only the hard failure is waived.

### Budget

```jsonc
"budget": {
  "maxCalls": 200,
  "maxInputTokens": 2000000,
  "maxEstimatedCostUsd": 5
}
```

Reserved *before* each call and settled against real usage after, so concurrent
workers cannot collectively overspend in the window between checking and
calling. When a cap is hit the item is routed to review rather than dropped.

Pair it with a server-side cap on the gateway (a LiteLLM virtual key, an
OpenRouter credit limit). That one is enforced outside this process and holds
even if the tool is invoked by hand.

### Prices

```jsonc
"prices": {
  "input":  { "deepseek/deepseek-v4-flash": 0.10 },
  "output": { "deepseek/deepseek-v4-flash": 0.30 },
  "cachedInputMultiplier": 0.1
}
```

USD per million tokens. Left empty, cost reports read *unpriced* rather than
showing a confidently wrong number. Take the rates from your gateway.

---

## Environment variables

| Variable | Effect |
|---|---|
| `BIOMD_GATEWAY_URL` | Defines an implicit gateway named `env` and activates it |
| `BIOMD_GATEWAY_KEY` | Its API key |
| `BIOMD_MODEL` | Its model, for all tiers |
| `BIOMD_GATEWAY` | Select a *configured* gateway by name |
| `BIOMD_LLM_ENABLED` | `true` / `false` |
| `BIOMD_PROFILE`, `BIOMD_VISUAL`, `BIOMD_LANG`, `BIOMD_OUT_DIR`, `BIOMD_CORPUS` | Override the matching setting |

The first three are enough to run with no config file at all:

```bash
export BIOMD_GATEWAY_URL=https://openrouter.ai/api/v1
export BIOMD_GATEWAY_KEY=sk-or-v1-...
export BIOMD_MODEL=deepseek/deepseek-v4-flash
biomd config test
```

Useful in CI, where a config file with a key would be the wrong shape.

---

## Verifying a gateway

```bash
biomd config test           # one request: URL, key, model, structured output
biomd config test --full    # the five-test conformance probe
```

The full probe checks what the pipeline actually relies on:

| Test | Blocking? | Why |
|---|---|---|
| Structured output round-trip | **yes** | Every hook returns typed data |
| Image input | no | Only Tier-3 table adjudication; degrades to text-only |
| Prompt caching reported | no | Cost only |
| Request not rewritten in flight | **yes** | A gateway that compresses prompts invalidates the decision cache |
| Resolved model matches request | **yes** | Otherwise the cache serves results from an unknown model |

Two of these are worth stressing. Some gateways advertise **prompt compression**
as a headline feature. Turn it off. The decision cache is keyed on the payload
*sent*; if a middlebox rewrites it, a cache hit no longer identifies what the
model saw, and `--replay` stops being reproducible. The probe measures reported
input tokens against the payload size to catch it.

---

## Full example

`biomd.config.json`, committed:

```jsonc
{
  "profile": "renderer-current",
  "layoutFidelity": "simplified",
  "visual": "always",
  "lang": "ru",
  "inputDir": "./html",
  "assetRoot": "./html",
  "outDir": "./out",
  "corpus": "corpus/corpus-profile.json",
  "jobs": 4,
  "llm": {
    "enabled": true,
    "gateway": "openrouter",
    "gateways": {
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKeyEnv": "OPENROUTER_API_KEY",
        "models": { "fast": "deepseek/deepseek-v4-flash", "deep": "anthropic/claude-sonnet-5" },
        "structuredOutput": "json_schema",
        "extraBody": { "provider": { "require_parameters": true } },
        "enforceModelIdentity": false
      }
    },
    "budget": { "maxCalls": 200, "maxEstimatedCostUsd": 5 }
  }
}
```

`.env`, git-ignored:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

`.gitignore`:

```
.env
out/
corpus/
.biomd-work/
.biomd-cache/
```

Then the whole workflow is two commands:

```bash
biomd corpus scan
biomd corpus run
```
