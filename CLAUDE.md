# biomd-convert -- project constitution

Binding rules for every repository session. Keep only durable policy here: measured state -> `biomd-convert/CONVERTER-PROGRESS.md`; precise open defects -> `analyze/defects.json`. Do not duplicate either.
**Communicate with the user in English, not German.** Preserve original technical terms/code identifiers.
After context loss, re-orient from this file, `CONVERTER-PROGRESS.md`, `analyze/defects.json`, and `TaskList`.

## Project and routes
- Current refinement campaign -> `analyze/REFINE-CONVERTER.prompt.md`.
- Durable measured state / remaining / unreachable -> `biomd-convert/CONVERTER-PROGRESS.md`.
- Generated L2 defect state -> `analyze/defects.json`.
- Deterministic-first legacy HTML -> BioMD Lite 1.6 compiler; corpus ~1000 Russian biographies from malformed/presentational 1998-era Microsoft FrontPage HTML.
- Source notes 13 hand-made reference conversions in `biomd-convert/fixtures/`; ground-truth tier below lists 22 pairs (13 regression + 9 refinement). Treat references as evidence, not the target; generalization to the other ~987 pages and structurally similar corpora plus precise evaluation are both deliverables.
- Fidelity = BioMD conformance + structural/visual equivalence to reference layout intent (not pixels) + no content loss/invention. Improving one while breaking another is regression.
- Environment: Windows; Node ≥ 22; TypeScript/ESM; vitest; parse5; optional Playwright (Chromium measurement); zod; commander; PowerShell + Bash.

```bash
cd biomd-convert && npm run build && npm test
cd biomd-convert && sh bench/run.sh
cd biomd-convert && node dist/cli/index.js diff -c bench/biomd.config.json --json ../analyze/defects.json
cd biomd-convert && npm run biomd -- inspect fixtures/html/segovia.htm
```

## Authority: highest precedence first
1. `analyze/analyze.md`, `analyze/analyze-2.md` (Russian, per-page complaints + stated house rules) + `analyze/design.png` (green=convert, red=drop chrome) + `analyze/snapshot_*.png` -- the author's own quality judgement, and **the highest authority in the project**. Where later contradicts earlier, later wins.
2. `biomd-convert/fixtures/html/*.htm` ↔ `fixtures/out/*.bio.md` -- 22 hand-made pairs (13 regression + 9 refinement); evidence of intent, and authoritative over the syntax reference.
3. `BioMD-Reference.md` -- normative BioMD Lite syntax; §0 no-fabrication ("Do not fabricate factual text, captions, headings, `href`/`src`, or targets"); precedence `content > targets > reading order > hierarchy/grouping > layout > visible distinction > exact style`; permissiveness is normative: implementation may narrow what it emits, never what it accepts. **Amendable**: where a rule here contradicts 1 or 2, the rule is wrong and must be corrected here rather than worked around -- see §35.9/§36 for the worked example.
4. `Biography-Markup.md` -- older/stricter fallback only where the short reference is silent; short reference wins conflicts; its `§` numbers differ, so name the document when citing a `§`.
5. `mini_images_to_md_guide.md` -- normative icon/micro-image -> glyph policy + known-icon map; map is lexical data under invariant 5, never detector literals.
6. `html-to-biomd_guide.md`, `html-to-biomd_ext_guide.md` -- advisory/manual procedure; possibly stale; `fixtures/out/` wins contradictions and the conflict must be stated.
7. `biomd-convert/CONVERTER-PROGRESS.md` -- current measured state; verify, do not trust.
8. `CONVERTER-ASSESSMENT.md`, `htm-to-md_utility_plan.md`, `how_to_fix_table_parsing_and_reconstruction.md` -- historical; PROGRESS §3 records prior measurable errors.
- `.claude-memory/INDEX.md` is navigation only; it routes to these sources and `CONVERTER-PROGRESS.md` by line range, never overrides them.

## Invariants
Everything not forbidden by these invariants is allowed, including large architectural changes.
1. **Reference integrity:** never edit `fixtures/html/`, `fixtures/out/`, `analyze/*.md`, or `analyze/*.png` -- not to close a finding, not to make a rule fit. The single exception is a correction the author states explicitly and by name; record it and say what changed.
2. **Metric integrity:** never tune `src/eval/score.ts` or any instrument merely to move a number. Instrument changes must make measurement more truthful, be isolated/declared, and re-baseline both sides.
3. **No instrument as objective:** scalar score, structural diff, visual diff, LLM judge are defect detectors, not optimization targets. If optimizing an instrument rather than conversion, stop and say so.
4. **No invented content (§16.3):** source-absent reference text is an unreachable ceiling; never fabricate to close it. §16.3 constrains text, not layout: wrapping existing text in a directive, splitting a lane, drawing a separator, or reading size from geometry invents nothing and remains actionable.
5. **No literals law:** detectors contain no corpus-specific string/class/id/filename/title. Lexical knowledge (bullet glyphs, label vocabularies, border palettes) belongs in documented language-tagged data and must degrade gracefully on no-match; a detector can never name a document.
6. **Determinism:** same input + `--replay` => byte-identical output. Diagnostics are deterministic or explicitly non-deterministic and never gate alone.
7. **Honest measurement:** report no unmeasured number or unverified completion; a crashed conversion invalidates that run's measurements.

## Evaluation ladder
A level matters only when every higher gate is clean.
- **L0 Gate, every change:** `npm test`; mutation suite (§5); zero FAILED conversions in `corpus run`; `biomd validate` errors not increased; produced-output `biomd-ast/read()` warnings = 0; conservation ledger clean. Red L0 invalidates lower levels.
- **L1 scalar tripwire, every change:** `sh bench/run.sh`; detect silent regressions outside the area under study. Unchanged score proves little: `score.ts` averages seven multiset F1 axes and misses directive properties, link labels, cell coordinates, block order, hard breaks, emphasis, typography. Legitimate project ceiling ≈ 98 %, not 100 %: remaining ~2 % is §16.3-forbidden reference editorializing (invented headings, copyedited prose, `segovia` deleted MP3 track table). Never optimize per-change for L1.
- **L2 structural adjudication, primary, BUILT:** `src/eval/blocks.ts`, `src/eval/structdiff.ts`, `src/eval/triage.ts`, `src/eval/rollup.ts`; contracts `src/eval/structdiff.test.ts`; surfaced as `biomd diff`; diagnostic-only, so `convert-core` must never import it. Output localized findings, never averages. Compare directive name/properties; heading level/order/nesting; table cell coordinates/alignment; link label↔target; image `alt`↔`caption`↔`size`↔`align`↔`link`; list type/depth; separators; blank/hard-break structure; emphasis; inline typography; entity decoding; hyphenation; whitespace. If a class is not directly actionable, refine the class, not tolerance. Require identity (same document twice => zero findings) and determinism.
- **L3 rendered/geometric adjudication, NOT YET BUILT -- PROGRESS §7:** build `tools/render-biomd.ts` from `BioMD-Reference.md`, reproducing renderer quirks documented by `src/biomd-ast/read.ts`: `PROPERTY_HEADER_DIRECTIVES` asymmetry and `columns.divider` -> synthetic first column; `src/biomd-ast/conformance.test.ts` asserts them. Diagnostic-only; converter never imports it. Both `.bio.md` sides must render through identical code; same file twice => byte-identical output. In the built-in browser over HTTP via `.claude/launch.json`, compare source `.htm` ↔ produced `.bio.md` ↔ reference `.bio.md`; use `read_page`, `javascript_tool` (`getBoundingClientRect`/`getComputedStyle`), `computer`, and `resize_window`. Goal: produced layout visually equal/better than source.
- **L3 corpus gotchas:** presentational attributes lie (`pavlov_azancheev.htm`: `align="center"` on `p.t8` 17×, `p.t` 16×, `p.t1`, `p.st`, `p.lt` all compute `justify`; only `p.t3` 3× is centred). Chromium computed `text-align` may be `-webkit-center`/`-webkit-left`; never raw-compare computed value with `=== "center"`; fold via `isCenteredAlign`/`foldTextAlign` in `src/ladom/style.ts`. Remaining `=== "center"` uses already-folded values or raw HTML attributes. No asset tree exists: every image/PDF/MP3 reference 404s; broken rendered assets are not conversion defects.
- **L4 LLM adjudication:** judge path over `src/llm`, strictly separate from production hooks; side-blind (randomize A/B, run both orders, retain swap-stable findings); localized + zod-schema-validated (quoted spans both sides, node path, severity, defect class, source-backing verdict; prose/score output = misconfigured); strong model `claude-opus-5` via `deep`, not production `fast`; calibrate against defects named in `analyze/analyze.md` and `analyze-2.md`, and report agreement; advisory only, confirm hypotheses with L2/L3.
- **L5 human record:** map every `analyze/analyze.md` and `analyze-2.md` complaint and `design.png` red/green region to closed/open-with-owner/unreachable defect class. Human record wins instrument disagreements; fix the instrument.

### Triage, evidence, cadence
Before work, classify every mismatch:
1. `converter-defect`: content loss, BioMD violation, source-structure misread, or worse layout -> work.
2. `acceptable-alternative`: different reference, intent preserved, visually equal/better -> record; exclude from targets.
3. `reference-inconsistency`: unsupported/inconsistent/inferior reference editorial choice -> record as ceiling; §16.3 forbids closing.
4. `ambiguous`: deterministic evidence cannot decide -> L4 or user.
- Verdicts 2/3 are not targets. Test produced and reference sides against source; if only produced is source-attested, the reference moved.
- Layout structure is always verdict 1 under invariant 4; presentational structure (emphasis spans, hard breaks, inline typography) is not layout and requires source attestation.
- Never edit a reference to close a finding. If a questionable reference would change a reusable rule or several documents, present concise side-by-side evidence and ask which reading is authoritative; batch related questions; decide minor local cases yourself.
- `analyze/defects.json` is regenerated by L2, appended by L3/L4/L5. Per finding: stable id, class, severity, evidence, node path, both-side line numbers/quoted spans, source-backing verdict; per class: instances, documents, backing breakdown, rank, example.
- Report classes closed + instances remaining, never averages; show L1 only as tripwire. Rank `instances × severity × generality`; generality = affected documents/archetypes and breaks ties.
- Cadence: L0+L1 every change; L2 every iteration and corpus-wide before every commit; L3 every touched document and all 13 at milestones; L4 batched per iteration, cost-capped; L5 at milestones.
- Never tune on all 13. Hold out 3-4 while designing a rule; measure only after rule + tests; rotate and report both sides. Weak holdout behavior => generalize or drop the special case. Beyond the 13, crashes, validation errors, `read()` warnings, conservation reports, and `review()` escalations must not rise on any non-reference input, including mutation fixtures.

## Rule design for generalization
Every changed/added rule gets a test-file contract:
- **Invariant:** evidence without document/class/id/literal names; use geometry, recurrence, containment, ordering, cardinality, typographic role; prefer relational evidence ("centred on a page whose prose is not") over absolute thresholds ("width < 400 px").
- **Recurrence requirement:** shape repeats on page with content between occurrences; all surviving detectors required this and single-block typographic thresholds regressed. This is a design law, not heuristic.
- **False friend:** name/test the near-identical non-match (caption/heading, menu/section label, record/section label, copyright/signature).
- **Mutation robustness:** fixture-derived harness; L2-assert same output shape under renamed classes/ids, permuted attributes, wrapper nesting changes, dropped/duplicated closing tags, equivalent `<font>`/`<b>`↔CSS, Latin↔Cyrillic labels, viewport changes, encodings.
- **Shape catalog:** document archetypes: masthead+prose; prose+bound figures; discography grid; multi-column media/score table; dated news list; link farm; mixed single→multi→single column flow; include entry/exit evidence + defect classes; new pages map to a known shape or declare unmapped.
- Prefer many small passes over one universal rule; route new passes through `runPass`/`Ledger` for auditable provenance/conservation.
- Read neighborhood before element-level rules: containment, sequence, recurrence, geometry, semantic role. Check routing/grouping upstream first; do not cement upstream defects with downstream guards.
- **Captions:** visible structurally associated line outranks `alt`; use `alt` only when no reliable visible caption. Bind by containment, immediate sibling order, proximity, repetition, shared layout region, never filename/fixture text. Minor wording differences -> keep visible source text once. Nearby prose needs clear structural/repeated evidence.
- Corpus facts usable by rules because geometry confirms them corpus-wide: content center column ~½ viewport; chrome/footer drop; right-hand menus fold into main flow; most images captioned and centred/right-aligned; discographies and score/media lists use 2-5 columns; >5 columns or blockquote-dense page is anomalous; vertically aligned multi-column blocks are semantically paired, so several small tables may preserve pairing. Prefer original layout; if geometry is unprovable, cleaner equal-quality Markdown-native layout beats guessing.
- Content is Russian; do not "correct" beyond demonstrated reference behavior.

## Rules vs hooks
- Rules handle source-stated facts; hooks only what source does not state.
- Every production hook is zod-schema-validated, budgeted, cached, replayable, non-authoritative: hook proposes; deterministic check accepts/rejects; rejection path is tested. Add only when evidence rules cannot supply the judgement and its acceptance check can be named; hooks also own judgement that will not generalize. Disabled hooks must degrade to sane deterministic output.
- Keep production hooks and L4 judge strictly separate by models/prompts/purpose. Adjudicate with LLM off for comparability; measure LLM-on delta separately and label it. Existing hooks: `table.classify`, `table.records`, `text.segment` in `src/llm/hooks.ts`.

## Instrumentation
- Front-half view: `biomd inspect <file>`; per-job artifacts `my-migration/.biomd-work/<name>-<hash>/`; `Ledger`.`review()` = unresolved-decision queue.
- Corpus evidence: `biomd corpus scan`; general detectors must be discoverable there, not per document.
- HTML structure: parse5/LADOM via throwaway `node --experimental-strip-types` script; never regex `.htm`.
- Text quick-look only: `git diff --no-index --word-diff fixtures/out/X.bio.md bench/out/X.bio.md`; L2 adjudicates.
- External FrontPage/CSS knowledge: `WebSearch`/`WebFetch` when needed; cheaper than a wrong hypothesis.
- Scratch scripts/probes/notes -> session scratchpad, never repo.

## Reporting and stop
- Report defect classes + instances, not averages. Include failure output. If blocked, finish independent work then state exactly what/why.
- At milestones update `CONVERTER-PROGRESS.md` in its existing measured-number style: implemented, remaining reachable, provably unreachable; also shape catalog, instrument calibration record, killed-hypothesis list.
- Stop only when all hold: no open `source-backed` defect above minor severity unless it requires a hook with undefinable acceptance check; L0 clean; L1 not regressed and near ≈ 98 %; holdout gap small/explained; mutation suite passing; L3 finds no structural/ordering difference on any of the 13 and rates each produced layout equal/better than source; calibrated L4 opens no new source-backed class for two consecutive rounds; every `analyze.md` and `analyze-2.md` complaint closed or unreachable with reason.
- Then report ceiling/cause; what would break it; which rules should hold on other ~987 pages and which likely fail first; least-trusted instrument + evidence.

## Compaction
Preserve current phase/active task; accepted changes + measured results; rejected hypotheses + falsifiers; open defect classes; unresolved risks; exact next action.
Repository files are authoritative. Do not revive completed work after compaction.
