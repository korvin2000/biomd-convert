# Detectors

What each finding from `scripts/analyze.py` means, what to do about it, and how to reproduce the
detection by hand when Python is unavailable. Read at stage 2 when a finding is unclear.

- [How to read the output](#how-to-read-the-output)
- [Detector reference](#detector-reference)
- [Detectors that need a reader](#detectors-that-need-a-reader)
- [Ripgrep fallbacks](#ripgrep-fallbacks)
- [The amnesia probe](#the-amnesia-probe)

---

## How to read the output

Detectors produce **candidates, evidence and confidence** — never verdicts. A regex cannot tell a
decorative "note" from a load-bearing one, and severity ranks attention, not permission:

```text
H  usually a real saving or a real risk    look first
M  worth a look                            look after the H items
L  cosmetic                                batch these into the micro-optimisation pass
```

Nothing here authorises a deletion. Authorisation comes from the four gates in
[rulebook.md](rulebook.md) — read it before acting on any H finding — and from the protected atoms
in [preservation.md](preservation.md), which lists what may never be touched at all.

## Detector reference

| Finding | What it means | Safe response |
|---|---|---|
| `generic-filler` | Advice the base model already follows. Zero surprisal, non-zero cost, and it induces extra exploration | Delete. This is the single safest large saving in the catalog |
| `lint-leakage` | Prose restating what a formatter, linter, type checker or editorconfig enforces | Run E-GATE. If it passes, keep the invocation and any non-obvious exception; drop the restated detail. Never delete on the regex alone |
| `open-enumeration` | `etc.`, "and so on", "as appropriate" | Close the list. An open enumeration is an instruction to invent, and inventing is exploration you pay for |
| `hedge` | should / may / consider / typically | Normalise modality, or delete. Hedging hands the priority decision to the model |
| `mutable-state` | A fact with no owner and no refresh path: versions, dates, "currently" | Replace with a query instruction pointing at the machine-readable source. Delete only if provably stale |
| `unsupported-control` | `@include`, `load_if:`, `priority:`, transclusion syntax | Remove the claim of function or target a documented harness. Imaginary controls are inert at best |
| `blind-reference` | A path or link with no what+when on the same line | Add the pitch. A bare path is either ignored or eagerly slurped whole — both are failures |
| `broken-reference` | The target does not exist | Fix or delete **before** compressing anything else; a broken route poisons every later decision about relocation |
| `backslash-path` | Windows separators in a link | Forward slashes always |
| `heading-depth` | Headings below H3 | Flatten, or split the section into a reference |
| `bullet-nesting` | Nesting past two levels | Flatten, or hoist the shared condition |
| `prose-block` | A narrative block over ~90 words | Candidate for prose→directive or prose→table. Check first that it is not rationale that earns its tokens |
| `missing-toc` | A reference over 100 lines with no ToC | Add one: a partial read otherwise cannot tell what the file covers |
| `decoration` / `emoji` / `smart-punctuation` | Cost per glyph with no instruction content | Batch into the micro-optimisation pass, last |
| `multi-option-menu` | "You can either… or…" | Give one default with an escape hatch. A menu of equals makes the model choose, and choosing costs tokens and consistency |
| Budget flags | A threshold was crossed | A review trigger, never a failure. Only rows tagged `[V3]`/`[V4]` are platform-verified; the rest are corpus folklore, reported with provenance so you can discount them |

## Detectors that need a reader

Three findings are deliberately left unresolved by the script, because automating them causes more
damage than it prevents.

**Duplicate candidates.** Reported with a similarity score and both locations. Textual similarity is
a candidate detector only — clear D-GATE before merging. If one copy carries a local exception, a
compatibility alias, a route, or higher authority, merge the shared payload and **keep that delta**.

**Conflict candidates.** Directives that share an anchor but disagree on modality. Never
auto-resolve: published automated conflict detection runs at modest precision, so a confident
automatic pick is often confidently wrong. Report both statements with their scopes and authority
and ask.

**Fossilisation.** The script cannot see repository history. Check it yourself:

```bash
git log --oneline -- FILE | wc -l     # 1 commit in an active repo means a generated fossil
git log -1 --format=%cs -- FILE       # last touched, versus how much the code has moved since
```

A file written once by an init command and never revisited is the classic case: it describes a
repository that no longer exists, and stale sections get *executed*, so they do real damage rather
than mild annoyance. Staleness must be evidence-based, never age-based.

## Ripgrep fallbacks

When Python is unavailable, these reproduce most of the mechanical layer.

```bash
# size and structure
wc -l FILE
rg -c '^## ' FILE                      # section count
rg -n '^#{4,}' FILE                    # heading deeper than H3
rg -n '^\s{6,}[-*]' FILE               # bullet nesting past 2 levels

# instruction budget (report it, never gate on it)
rg -c -i '^\s*[-*0-9.]*\s*(must|never|always|do not|don.t|use |run |avoid|prefer|ensure|make sure)' FILE

# hedging, open enumerations, generic filler
rg -n -i '\b(should|may|might|consider|recommended|typically|generally|feel free|if possible)\b' FILE
rg -n -i '\b(etc\.?|and so on|among others|as needed|where appropriate)\b' FILE
rg -n -i '(best practice|clean code|maintainable|production.ready|be thorough|think step by step)' FILE

# lint leakage — candidates for E-GATE, never auto-delete
rg -n -i '(indent|spaces|tabs|camelCase|snake_case|PascalCase|line length|import order|semicolon|quotes)' FILE

# blind references: a link or path with no pitch on the same line
rg -n '\[[^]]+\]\([^)]+\)|`[a-zA-Z0-9_./-]+\.(md|py|ts|json|ya?ml)`' FILE \
  | rg -v ' — | - .*(read|when|contains|use)'

# decoration and cost per glyph
rg -n '[│┌┐└┘├┤─╔╗╚╝═║]|!\[.*\]\(.*shields\.io' FILE
rg -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' FILE
rg -n $'[‘’“”— ]' FILE

# every referenced path must exist
rg -o '`[a-zA-Z0-9_./-]+\.(py|ts|tsx|go|rs|md|ya?ml|json)`' FILE | tr -d '`' | sort -u \
  | while read -r p; do [ -e "$p" ] || echo "MISSING: $p"; done

# the anchor set — the thing that must be identical before and after
{ rg -o '`[^`]+`' FILE
  rg -o 'https?://[^ )>]+' FILE
  rg -o '\b[A-Z][A-Z0-9_]{2,}\b' FILE
} | sort -u > anchors.before.txt
```

Diff `anchors.before.txt` against the same extraction on the output. Both directions: a missing
anchor is a loss, a new one is an invention.

## The amnesia probe

An optional way to get *evidence* that a claim is ambient knowledge rather than repository-specific.
Ask a cheap model the question a claim answers, with no repository context:

```text
Repo type: {stack}. Question: {the question this claim answers}.
Answer in one line. If you would need to inspect the repo, answer exactly: NEED-REPO.
```

| Response | Reading |
|---|---|
| matches the doc | AMBIENT — a deletion candidate |
| contradicts the doc | HIGH VALUE — keep it, and consider promoting it |
| `NEED-REPO` | keep; compress the wording only |

Two constraints. Agreement is *evidence* for deletion, not authorisation — the fact must still be
discoverable another way, and the gates still apply. And the probe must pass on the **weakest**
model you target, since what one model knows ambiently another does not.
