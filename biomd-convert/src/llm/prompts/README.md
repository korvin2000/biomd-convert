# Prompt templates

Every judgement this converter escalates is specified here, in Markdown, named for
the judgement rather than for the code that asks it. A prompt is a specification;
a specification inside a `.join("\n")` array is one nobody reviews and nobody diffs.

## Layout

    <domain>/<judgement>.system.md    the stable instruction prefix
    <domain>/<judgement>.user.md      the per-item payload, with {{slots}}

Domains are the compiler's own stages: `table`, `layout`, `text`, `media`,
`document`. The file name says what is being decided, not which function calls it.

## Template syntax

Three constructs, deliberately no more (`src/llm/prompt-template.ts`):

| form | meaning |
|---|---|
| `{{name}}` | substitute. A slot the caller never supplied is a **throw**, not an empty string |
| `{{#name}}…{{/name}}` | keep the block when `name` is present and non-empty; `{{.}}` is the value |
| `{{^name}}…{{/name}}` | keep the block when `name` is absent or empty |

There are no loops. A prompt needing a repeated part gets it pre-rendered by the
caller, which is the only place it can be sampled, truncated and budgeted.

## The standing contract every system prompt inherits

These hold for all of them and are restated per file only where a reader could
plausibly doubt them:

1. **The deterministic rule has already run and has already abstained.** You are
   not being asked to review a decision; you are being asked because there was
   none. Answering `UNCERTAIN` is a correct and useful answer — it keeps the
   deterministic default and files a review item, which is better than a guess.
2. **Never invent visible text.** Where a judgement needs text, you choose from
   candidates that were taken out of the source. The one exception is
   `table/synthesize-column-labels`, which exists because the target format
   requires a header row the source never wrote, and which the project author
   sanctioned by name.
3. **Report the confidence you actually have.** Low confidence routes to human
   review. Confidence is not a politeness setting.
4. **Rationale is a diagnostic, not content.** It is written to the provenance
   ledger and never to the document. Name the evidence; do not restate the
   definitions you were given.

## Changing a template

The decision cache is keyed on the *rendered* system and user text, so editing a
file here invalidates exactly the decisions that file produced. `Hook.version`
is for schema changes, which the hash cannot see.
