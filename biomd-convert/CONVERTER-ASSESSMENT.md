# BioMD converter: implementation assessment and development plan

## 1. Executive conclusion

The current converter is a sound **compiler skeleton**, but not yet the semantic/layout recovery system described by `BioMD-Reference.md`, `html-to-biomd_guide.md`, and `html-to-biomd_ext_guide.md`.

Its strongest work is foundational: tolerant decoding and parsing, browser-backed geometry, physical table-grid reconstruction, typed BioMD AST/builders, deterministic serialization, target rewriting, provenance/conservation checks, bounded LLM transport, caching, budgets, and structural validation. These are worth retaining.

Its main defect is architectural incompleteness between normalized DOM and BioMD AST. The guides require a semantic intermediate representation containing roles, relations, evidence, reading order, and confidence. The implementation instead lowers LADOM almost directly in `convert-core/structure.ts`. Consequently it can preserve words while failing to recover the document the words form.

This is visible in the 13 reference pairs:

| Observable | Current output | Reference | Delta |
|---|---:|---:|---:|
| Headings | 24 | 83 | 59 fewer net |
| Image directives / `src` properties | 61 | 97 | 36 fewer |
| Captions | 0 | 80 | 80 fewer |
| `align` directives | 0 | 22 | 22 fewer |
| `images` groups | 0 | 5 | 5 fewer |
| `frame` directives | 0 | 9 | 9 fewer |
| Separators | 11 | 85 | 74 fewer net |
| Hard line breaks | 841 | 202 | 639 extra |

A clean deterministic conversion with Chromium measurement produced an official weighted similarity of **82.33%** against the 13 references. Per-axis document scores reveal the same structural gap: heading F1 ranges from 11.8% to 66.7%; several directive scores are 0–26%; and every file remains `conversion-review-required`. The fresh run's mean source-conservation recall is **97.79%**, including two files at 100%, but the corpus has **0% clean share**, 27 unresolved LLM escalation points, and 15 validation errors. High recall is therefore not evidence of conversion quality.

**Priority decision:** do not tune more thresholds in the current direct lowering path first. Add the missing semantic planning layer, relation recovery, break segmentation, media binding, and typed LLM operation boundary. Threshold tuning before those changes will optimize the wrong representation.

---

## 2. Scope, authority, and evidence

### 2.1 Authorities studied

1. `BioMD-Reference.md` — normative syntax and preservation model.
2. `html-to-biomd_guide.md` — migration rules and ABC link policy.
3. `html-to-biomd_ext_guide.md` — detailed preprocessing, semantic transformation, and verification procedure.
4. `htm-to-md_utility_plan.md` — intended implementation architecture, including semantic IR and LLM hook catalogue.
5. `how_to_fix_table_parsing_and_reconstruction.md` — prior table failure analysis.

The governing preservation order is content/targets, hierarchy and order, meaningful relationships, coarse emphasis/alignment, then discard pixel-level styling. The converter must preserve author wording, emit exactly one `#`, classify every table, preserve captions and media relationships, prefer Markdown, and use only legal BioMD directives.

### 2.2 Code and data examined

- `src/ladom`: encoding, parse5 repair, sanitization, Chromium measurement, normalization, grid materialization.
- `src/convert-core`: corpus profile, boilerplate, dehyphenation, prominence/headings, table classification/planning, direct structure recovery, links, ledger, conservation.
- `src/biomd-ast`: typed nodes, builders, serializer, parser, profile and validator.
- `src/llm`: hooks, resolver, transport, cache, budget and conformance probe.
- `src/eval`: fact extraction, multi-axis scoring, report rendering.
- All 13 `fixtures/html` → `fixtures/out` pairs and corresponding `my-migration/out` products.
- Browser inspection at 1024×768 for `segovia.htm`, `goya2.htm`, `authors.htm`, and `news.htm`.
- Existing `.biomd-work/*/08-validation/report.json` artifacts.

### 2.3 Fresh reproducibility and tool limitations

After the obsolete lockfile was removed, `npm install` completed successfully. The project builds and typechecks cleanly; all **216 tests in 14 files pass**. Playwright Chromium was installed and launched through the converter. A fresh corpus scan covered all 13 fixtures, finding 421 distinct fingerprints, 9 stable chrome structures, 5,942 lexical forms, and no uncertain encodings.

The fresh conversion used `spec-1.6`, faithful layout, `visual: always`, Chromium measurement, the newly generated corpus profile, and LLM off. All 13 files converted without process failure, but all 13 require review. The official evaluator reports **0.8233107816 overall similarity**. Validation produced 15 errors: 12 `table-header-empty`, one `h1-count`, one `heading-skips-level`, and one `line-too-long`.

The user supplied a temporary OpenRouter key for isolated evaluation. The gateway probe passed structured JSON, request-integrity, and model-identity checks with `deepseek/deepseek-v4-flash`. Vision failed because that model has no image-capable endpoint, and prompt caching was not reported; both are capability/cost limitations rather than transport corruption. A temporary config named the key through `OPENROUTER_API_KEY`; no credential was written into the repository. Debugger launch remained unavailable because the environment provides only `debugpy`, not a Node/TypeScript adapter.

---

## 3. What is implemented well

### 3.1 Legacy input handling

`ladom/encoding.ts` has the right shape: declaration/BOM inspection, strict UTF-8, scored Cyrillic candidates, alias normalization, and nonfatal uncertainty. This follows the guides' requirement to continue a batch while recording decoding risk.

`ladom/parse.ts` correctly uses parse5 rather than regex. It retains source locations, builds stable browser-reproducible IDs, and exposes repaired HTML. This is the correct basis for malformed FrontPage-era markup.

`ladom/sanitize.ts` separates behavior removal from layout removal. Scripts/event handlers/unsafe schemes are removed without immediately destroying CSS/layout evidence. This ordering is important and correct.

### 3.2 Measurement and physical layout evidence

`ladom/measure.ts` uses Chromium, disables JavaScript, intercepts all requests, resolves local assets under `assetRoot`, aborts external network, and collects resolved styles and boxes. This is safer and more accurate than trying to implement CSS manually.

Browser inspection confirmed why this is useful:

- In `segovia.htm`, `segovia_a.jpg` renders at 323×452, `segovia_1936_1.jpg` at 420×315, and `segovia3.jpg` at 174×176 with `float:right`.
- In `authors.htm`, portraits render at 152×204 and float right inside a 422px content cell; the linked review image renders 420×294.
- In `goya2.htm`, the catalog table renders as two equal 250px lanes. Row 0 is label beside cover; row 1 is a numbered track range split across the two lanes.

The physical occupancy grid in `ladom/grid.ts` is also strong: it handles malformed rows, `rowspan`, `colspan`, nested-table exclusion, holes, and denial-of-service span limits.

### 3.3 Table data recovery

`convert-core/data-table.ts` is the most mature semantic component. It distinguishes physical slots from semantic columns, infers stable column bands, refuses block content in GFM cells, merges continuation rows, and audits the plan. This directly addresses the Barrios failure documented in `how_to_fix_table_parsing_and_reconstruction.md`.

`convert-core/classify.ts` correctly treats border presence as weak evidence, combines grid/content/geometry features, and permits abstention. The `DATA` structural-conservation check catches the otherwise silent failure where words survive but rows/columns disappear.

### 3.4 Output safety

The BioMD AST/builders/serializer/validator separation is good engineering:

- builders enforce property enums and nesting constraints;
- the target profile records renderer/spec drift explicitly;
- the serializer owns directive syntax and property ordering;
- validation detects one-H1 violations, heading jumps, raw HTML, malformed tables, unsupported constructs, nesting, and excessive complexity;
- `alwaysBlankLineAfterProperties` avoids directive-body text being misparsed as properties.

This is much safer than allowing an LLM to author free-form BioMD.

### 3.5 Traceability and conservation

`ledger.ts` and `conservation.ts` are useful defenses. Text shingles plus target/image multisets catch losses that rendering would silently hide. Review states and classification outcomes are retained. Existing reports correctly expose missing H1, skipped heading levels, empty table headers, and line-length failures.

### 3.6 LLM infrastructure

The transport layer is production-minded: gateway abstraction, structured output, model identity checks, bounded retries, content-addressed caching, replay mode, concurrency-safe budget reservations, pricing configuration, and transport conformance probes. The rule that resolver failure never aborts conversion is appropriate for a thousand-file unattended run.

Keep this infrastructure. The problem is not its quality; it is that almost none of the required semantic decisions are wired through it.

---

## 4. Principal architectural shortcomings

### 4.1 The semantic IR from the plan is missing

The plan specifies `IrNode`, immutable evidence, explicit decisions, semantic relations (`caption-of`, `floats-beside`, `parallel-with`, `continues`, `belongs-to`), and graph-based reading order. No equivalent exists in `src`.

Current flow:

```text
LADOM → heading marks + table classes → recoverStructure() → BioMD AST
```

Required flow:

```text
LADOM + geometry + corpus evidence
  → region/block IR
  → role and relation proposals
  → document plan / reading-order graph
  → typed semantic groups
  → BioMD AST
```

Without the middle layer, `structure.ts` must infer heading, image, caption, alignment, table role, order, and directive choice locally while walking nodes. It cannot represent uncertainty or revise a group after seeing later context.

**Remedy:** introduce `semantic-ir/` with immutable source facts and separately writable decisions. Every emitted AST node must cite source IDs; every source block/target/media item must end as emitted, merged, removed with reason, or review.

Suggested core types:

```ts
type BlockRole =
  | "title" | "subtitle" | "lead" | "heading" | "prose"
  | "quote" | "secondary-note" | "caption" | "signature"
  | "nav" | "record-label" | "separator";

type Relation =
  | { type: "caption-of"; from: NodeId; to: NodeId }
  | { type: "floats-beside"; from: NodeId; to: NodeId }
  | { type: "parallel-with"; from: NodeId; to: NodeId }
  | { type: "continues"; from: NodeId; to: NodeId }
  | { type: "belongs-to"; from: NodeId; to: NodeId };

interface Decision<T> {
  value?: T;
  confidence: number;
  decidedBy: "rule" | "classifier" | `llm:${string}` | "human";
  rationale: EvidenceRef[];
  status: "accepted" | "review";
}
```

### 4.2 The implementation covers only a subset of BioMD constructs

AST builders exist for all directives, but structure recovery calls only `makeImage`, `makeGroupedImage`, `makeColumns`, `makeColumn`, `makeNav`, and one heuristic `makeLead`. There are no production calls to `makeAlign`, `makeImages`, `makeFrame`, `makeSignature`, or `makeDocument`.

That explains the fixture totals: no `align`, `images`, or `frame` output despite 22, 5, and 9 respective reference uses. This is missing implementation, not a bad threshold.

**Remedy:** add semantic-group lowering functions after role/relation resolution:

- aligned bounded group → `align`;
- adjacent related images → `images`;
- meaningful border/background bounded block → `frame`;
- right-aligned terminal credit → `signature` or profile downgrade;
- document/media card → `document`;
- subtitle vs lead vs ordinary paragraph must be an explicit role decision.

### 4.3 Layout tables are lowered by column index, not semantic row pattern

`layoutFrom()` emits one persistent BioMD column for each physical grid column, collecting all rows in that column. This is sometimes right for durable parallel lanes but wrong for alternating catalog row pairs.

The browser showed `goya2` has:

```text
row 0: [album label] [cover]
row 1: [tracks 01–25] [tracks 26–…]
row 2: [next label] [next cover]
row 3: [next track range] [continuation]
```

Current output instead places many album labels/tracks into the left global column and images into the right global column, creates 337 extra hard breaks, omits 35 separators, and misses most semantic groups. The reference uses a repeated sequence of label/cover columns, separator, then track-range columns.

**Remedy:** classify and segment rows before lowering. Add table subtypes and plans:

```ts
type LayoutSubtype =
  | "persistent-lanes"
  | "label-media-pairs"
  | "split-numbered-track-grid"
  | "news-entries"
  | "image-gallery"
  | "mixed-records";

interface LayoutPlan {
  groups: Array<{
    sourceRows: number[];
    construct: "flow" | "columns" | "images" | "nav" | "frame";
    lanes: NodeId[][];
    separatorAfter: boolean;
  }>;
}
```

Detect alternating shape signatures, numbering continuity, equal lane widths, image/text alternation, and stable row pairs. Let `table.toLayout` resolve only uncertain plans.

### 4.4 Reading order is not modeled

The guides require a DAG combining DOM order, geometry, table continuity, floats, captions, and mobile reading order. Current decomposition is row-major; faithful tables become column-major across all rows. Neither is universally correct.

`news_2007` demonstrates the consequence: the current output places `10 апреля`, `4 марта`, and archive navigation in the first column, then the festival notice and their bodies in the second. The reference restores each date with its own entry and keeps the archive nav at the end.

**Remedy:** build weighted order edges and topologically sort semantic groups. Strong edges: DOM within prose, numbered continuity, caption after image, date before entry. Weak edges: x/y geometry. Conflicts enter `order.resolve`; the LLM may add/remove edges but may not rewrite content.

### 4.5 Break handling is effectively absent

`inlineFrom()` turns every `<br>` into an mdast hard break. `textSegmentHook` exists but is never called. This is the direct cause of 640 extra hard breaks and malformed paragraph/list reconstruction.

The guides distinguish:

- `WRAP` → space or validated dehyphenation;
- `PARAGRAPH` → paragraph boundary;
- `LINEATION` → hard break;
- `SPACING` → discard;
- repeated bullets/numbered lines → list items.

**Remedy:** create break-run IR before inline lowering. Features: x reset, y gap relative to line height, adjacent block geometry, punctuation, capitalization, numbering/bullets, repeated pattern, containing cell width, and source newline. Deterministic high-confidence rules first; call `text.segment` for residual ambiguity. Never serialize a raw `<br>` until classified.

### 4.6 Heading recovery is globally thresholded and structurally shallow

`recoverHeadings()` selects the single most prominent short candidate as title, then only candidates sufficiently below that title and above a global body baseline as `##`. It cannot model page type, repeated roles, date labels, roster entries, album titles, or a subtitle.

Observed failures:

- 24 headings versus 83 expected;
- `goya2` starts with two `##` and no H1, triggering `h1-count`;
- `news` promotes some text incorrectly but fails to model entry boundaries;
- roster names in `authors` remain prose, losing four expected section headings;
- date entries in `news_2007` remain plain paragraphs.

**Remedy:** split title selection from role classification. Candidate features should include repetition, neighbor pattern, source tag, font delta, weight, alignment, surrounding whitespace, date/name/record-title shape, link density, following block role, and page archetype. Infer hierarchy by repeated role clusters, not only absolute prominence. Ensure exactly one accepted title before AST construction; if no candidate is safe, use a review decision rather than emit invalid output.

### 4.7 Media semantics are underimplemented
`imageFrom()` copies `alt` but never creates `caption`. It does not bind adjacent prose, reconstruct groups, infer frames, or distinguish decorative article media from meaningful images beyond spacer removal. Inline adjacent images remain inline Markdown, causing missing image directives.

Size is estimated against the nearest measured ancestor. This is frequently the `<p>` that intrinsically fits the image, producing ratio≈1 and `full`, or another local box rather than the article content width. The checked output therefore uses 16 `full` and 32 `large`, while references use no `full`, 33 `small`, 45 `medium`, and 17 `large`.

Position defaults to `center` for every non-float; `left` is never inferred from geometry. The implementation also omits captions entirely, though alt text often supplies the same visible label in this corpus.

**Remedy:**

1. Detect the article content box from corpus/layout evidence; size against that box, not the first ancestor.
2. Calibrate semantic size from rendered width ranges and reference policy, with intrinsic dimensions as secondary evidence.
3. Infer position using x-offset, float, parent alignment, and text-wrap relationship.
4. Bind captions from `<figcaption>`, adjacent `.ph`/small centered blocks, nearby text with matching width, title/alt reuse, and linked-image labels.
5. Cluster adjacent images by y-overlap, gaps, common parent, equal dimensions, and intervening prose absence; emit `images`.
6. Preserve linked images as one directive with `link`, not an image plus invented generic link.

Example:

```ts
interface MediaBinding {
  imageIds: NodeId[];
  position: "left" | "right" | "center" | "full";
  size: "small" | "medium" | "large" | "full";
  captionId?: NodeId;
  altSource: "alt" | "caption" | "context" | "empty";
  linkId?: TargetId;
  frame?: PictureFrame;
  confidence: number;
}
```

### 4.8 Style evidence is collected, then mostly discarded

Chromium records `textAlign`, font metrics, colors, backgrounds, borders, padding and margins. Normalization folds a narrow subset. Downstream code uses style mainly for title prominence, float, image size, and table features.

Missing semantic uses include:
- centered/right bounded groups → `align`;
- small/indented source credits → blockquote secondary note;
- right-aligned terminal credit → signature;
- border/background/padding → semantic frame candidate;
- repeated centered `.ph` blocks → caption;
- indentation/vertical rhythm → paragraphs/lists/quotes;
- meaningful emphasis versus purely decorative bold/italic.

`normalize()` also records folded color even though no downstream consumer uses it. `columnWidthHistogram` is declared in the corpus profile but always emitted as `{}`. Measurement's `documentHeight` is unused. Screenshot capture exists only in tests and is not requested by the conversion pipeline.

**Remedy:** retain normalized style evidence on IR blocks until semantic decisions are complete. Populate corpus layout statistics during a visual scan: content-box widths, rail widths, common font clusters, class-role clusters, image-width modes, and repeated border/background signatures.

### 4.9 Corpus profiling is too structural

The freshly generated corpus profile covers all 13 fixtures, but `columnWidthHistogram` remains empty even though the conversion was browser-measured. Structural fingerprint depth is capped and fingerprints include shape but no robust spatial role. This helps chrome removal but cannot learn page templates, content regions, class semantics, or archetypes.

**Remedy:** profile the full production corpus before conversion and learn:
- DOM+geometry template clusters;
- recurring chrome with exception regions;
- dominant content/rail boxes;
- class/style role statistics;
- page archetypes (biography, roster, news, discography, resource matrix);
- table-layout subtype priors;
- image-size modes;
- stable date/name/album label patterns;
- lexicon with source-aware hyphen candidates.

Use profile version + input corpus hash in every job manifest. A stale or partial profile should cause an explicit warning and quality downgrade.

---

## 5. LLM integration: good infrastructure, insufficient authority

### 5.1 What is actually wired

The production resolver exposes only:

1. ambiguous table class;
2. missing table headers.

`text.segment` is declared but unused. The planned hooks `document.plan`, `boilerplate.adjudicate`, `table.toLayout`, `text.role`, `text.operations`, `media.bind`, `order.resolve`, `biomd.map`, `review.audit`, and `repair.patch` are absent.

The `table.classify` hook can accept a crop, but `GatewayResolver.classifyTable()` never supplies one. The pipeline does not request a screenshot. Thus the comments promise vision evidence that the actual call path cannot provide.

The assisted run resolved **26 of 27** escalation points using 16 model calls and 11 cache hits, consuming 13,081 input and 1,731 output tokens. It removed all 12 empty-table-header validation errors, reducing total validation errors from 15 to 3. However, it did not make any file publishable: all 13 still require review, clean share remains 0%, and mean source-conservation recall fell from 97.79% to 96.90%.

Official similarity moved only from **82.331% to 82.401%** (+0.070 percentage points). Three documents improved, four regressed, and six were unchanged. `borislova` improved by 6.42 points and `jovicic` by 3.69 because LLM table classifications caused previously flattened regions to become `columns`. The most important counterexample is `news_2007`, which regressed by 9.65 points: LLM table classification caused an incorrect columns layout, reduced text F1 by 9.94 points, and reduced directive F1 by 66.67 points. Thus the present hooks are useful for header completion and some table classification, but an accepted schema-valid classification is not guaranteed to improve semantic layout.

This empirically validates the report's main recommendation: LLM decisions need copy-apply verification, per-item metric/conservation monotonicity, richer layout subtypes, and rollback when the deterministic result is safer. The current resolver can remove validator symptoms while degrading reference similarity and content recall.

### 5.2 Recommended LLM architecture

LLMs should operate on typed decisions, never raw output text.

### Pass A: whole-document planner

Input:

- compact block outline with stable IDs;
- page archetype priors;
- full-page screenshot at canonical viewport;
- title candidates and region boxes;
- table/media summaries;
- no executable HTML.

Output schema:

```ts
interface DocumentPlanReply {
  archetype: "biography" | "roster" | "news" | "discography" | "catalog" | "mixed";
  titleId: NodeId;
  regionRoles: Array<{ id: NodeId; role: BlockRole; confidence: number }>;
  groupHints: Array<{ ids: NodeId[]; kind: "entry" | "record" | "gallery" | "notice" }>;
  orderEdges: Array<{ before: NodeId; after: NodeId }>;
}
```

The reply may reference only packet IDs. It cannot create/delete text or targets.

### Pass B: focused executors

| Hook | Call only when | Typed result |
|---|---|---|
| `boilerplate.adjudicate` | recurring region has article-like exception | keep/remove/extract children |
| `table.toLayout` | table class is layout/catalog/hybrid and row-pattern planner abstains | row groups, lanes, separators, subtype |
| `text.segment` | break-run classifier confidence below threshold | per-break enum |
| `text.role` | short styled block has competing roles | role + heading level |
| `text.operations` | dehyphenation/line-join remains unresolved | accept/reject existing proposals |
| `media.bind` | caption/group/position/size has competing candidates | binding IDs and semantic tokens |
| `order.resolve` | order graph has conflict/cycle or close alternatives | edge operations only |
| `biomd.map` | one approved semantic group maps to multiple legal constructs | smallest legal construct |

### Pass C: final audit and repair

`review.audit` receives final AST facts, unresolved ledger items, metric failures, and relevant crops. It returns findings, not prose edits. `repair.patch` receives validator/conservation findings and may apply a small whitelist of AST/decision operations to a copy.

Allowed operations should look like:

```ts
type PatchOp =
  | { op: "set-role"; id: NodeId; role: BlockRole }
  | { op: "bind-caption"; imageId: NodeId; captionId: NodeId }
  | { op: "group"; ids: NodeId[]; construct: "images" | "columns" | "frame" }
  | { op: "set-order-edge"; before: NodeId; after: NodeId }
  | { op: "set-image-token"; id: NodeId; size?: ImageSize; position?: ImagePosition };
```

Each patch is applied to a copy, then AST validation, ledger totality, conservation, and complexity are rerun. Accept only if no protected metric regresses and the targeted failure improves.

### 5.3 Escalation policy

Use deterministic rules when evidence is decisive. Escalate when:

- top two role/class scores are close;
- ordering has incompatible strong edges;
- media has multiple plausible captions;
- table row pattern is mixed or alternating;
- exactly-one-H1 cannot be achieved confidently;
- final structure differs sharply from archetype/reference expectations;
- conservation or validator failures persist after deterministic repair.

For high-risk actions—chrome removal, content reorder, target change, text operation—require higher confidence or dual-pass agreement. LLMs must never test URLs, invent missing captions, silently edit wording, or rewrite resource identity.

### 5.4 Persist LLM evidence

Every job should retain:

```text
05-decisions/
  document-plan.request.json
  document-plan.response.json
  media-bind-*.request.json
  media-bind-*.response.json
  applied-operations.json
  rejected-operations.json
  resolver-stats.json
  screenshots/full.png
  crops/<node-id>.png
```

Redact secrets; record model identity, hook/prompt version, cache key, tokens, latency, validation issues, and accepted/rejected status.

---

## 6. Specific correctness problems and proposed fixes

### P0 — Output can be invalid and still be written

Examples in retained reports: no H1 (`goya2`), heading level skip (`news`), empty table header (`barrios`), overlong physical line (`williams2`). Pipeline state becomes review-required, but the output remains present in `out`.

**Fix:** separate candidate output from publishable output. `corpus run` may retain candidate BioMD under work artifacts, but only atomically promote to `out` when grammar/conservation policy passes or an explicit reviewed override exists.

### P0 — Conservation reports count expected output assets as “extra”

Several reports list all output targets/images as unexpected while missing is empty. Source inventories are collected after normalization and chrome removal, while emitted structures may retain items accounted under transformed/removed ancestors. This makes the multiset comparison noisy and can mask real defects.

**Fix:** use stable target/media symbol-table entries captured before destructive passes. Every transform carries identity forward. Compare symbol IDs first, normalized targets second. Distinguish invented, duplicated, moved, intentionally removed, and source-preserved.

### P0 — H1 must be a planning invariant

Do not wait for the validator to discover zero/multiple H1. Resolve title before section roles. If the source title is visually split (`Френсис Гойя` + `дискография`), permit title plus italic subtitle or bounded aligned heading according to evidence, but emit one H1.

### P0 — `<br>` classification must precede Markdown construction

Hard-break serialization should be impossible without a break decision. This single change will improve paragraphs, lists, track grids, news entries, line-length errors, and dehyphenation.

### P1 — Image caption/group/size recovery

Make media binding a first-class pass. Calibrate token mapping against content width and reference fixtures. Child images inside `images` should omit ignored `position`/`size` properties.

### P1 — Catalog/news/roster archetypes

Add page-specific but reusable schemas:

- biography: title, portrait, lede, prose, quotations, sources/resources;
- roster: title, repeated person heading + portrait + biography + separator;
- news: title/archive subtitle, repeated date + entry + separator, final nav;
- discography/catalog: section nav, repeated record label/cover/tracks, separators;
- resource matrix: heading + semantic data table.

These are domain roles, not filename rules.

### P1 — Table planner needs hybrid decomposition

A `HYBRID` table cannot simply fall through to generic layout. Split nested semantic groups, classify each, and preserve the relationship between cover, title, track list, and resources.

### P1 — Alignment/frame/signature recovery

Use bounded groups only. Paragraph-wide `text-align:justify` is ordinary prose and must not become `align`. Center/right becomes semantic only when the block is short, bounded, and distinct from surrounding prose. Border/background becomes `frame` only when it groups a meaningful notice, not when it styles a photograph or page shell.

### P2 — Better title/heading model

Cluster relative typography within a page and role patterns across the corpus. Add date, person-name, album-label, and resource-section detectors. Enforce logical hierarchy and avoid headings inside nav/columns when the target grammar disallows or renders them poorly.

### P2 — Profile and visual-mode honesty

Config says visual `always`, but `createMeasurer()` silently returns `NullMeasurer` when Playwright or Chromium is unavailable. In `always` mode, silent downgrade contradicts user intent.

**Fix:** `always` should fail the job or at least mark it review-required with a prominent machine-readable diagnostic. `auto` may degrade. Persist `measured`, viewport, stylesheet failures, node match ratio, and asset-resolution warnings.

### P2 — Complete job artifacts

The intended work layout includes decoded, repaired, measured, normalized, classified, IR, decisions, screenshots, and audit artifacts. Checked work directories retain only source, output, and validation report. Retain the intermediate evidence needed to reproduce misclassification.

---

## 7. Evaluation methodology

### 7.1 Separate gates from similarity

A single weighted score must not decide publishability.

### Hard gates

- parses as BioMD;
- exactly one H1 and coherent hierarchy;
- no unsupported/raw HTML;
- target/image identity conservation;
- no unaccounted content removal;
- every source table/media/region has a terminal ledger state;
- every `DATA` table emits a table or reviewed exception;
- directives satisfy grammar/profile;
- no unresolved high-risk decision;
- output renderer smoke test succeeds.

### Quality axes

Report each separately:

1. prose sequence F1;
2. heading label + level + order F1;
3. entry/section boundary F1;
4. target identity/order/duplication F1;
5. media source/order/binding F1;
6. caption exactness/binding F1;
7. image position and size-token accuracy;
8. directive tree edit distance, not only directive counts;
9. table count, headers, shape, cell contents, row order;
10. list count, ordered markers, item boundaries;
11. quote/note/signature role accuracy;
12. reading-order pair accuracy;
13. separator placement F1;
14. invalid/review rate and LLM calls/cost.

Current evaluator strengths: multiset precision/recall penalizes duplication; table shape is separate from prose; axes are visible. Weaknesses: directive counts ignore nesting and grouping, headings ignore order, media ignores captions/position/size/link binding, no separators/lists/quotes/order axis, no validity penalty in the weighted score, and averages allow catastrophic documents to hide behind good ones.

### 7.2 Reference-set protocol

Partition by archetype and failure class, not randomly:

- 15–20 biographies;
- 10 rosters/multi-entry pages;
- 10 news pages;
- 15 discography/catalog pages;
- 10 resource/data-table pages;
- malformed/encoding adversarial cases;
- rare constructs: image groups, frames, signatures, nested tables, drop caps, footnotes.

Keep a locked holdout set. Fixtures used to tune thresholds/prompts cannot be the only release evidence. Each reference should include sidecar annotations for page archetype, region boundaries, relation edges, table subtype, and intentional editorial choices. This makes failures localizable rather than merely producing a lower document score.

### 7.3 Differential refinement loop

For each iteration:

1. run corpus scan with visual measurement;
2. convert all training and holdout fixtures from clean work dirs;
3. run hard gates;
4. compute all quality axes;
5. rank failures by corpus frequency × severity × confidence;
6. inspect one representative and one counterexample in browser;
7. fix the earliest wrong decision stage, not serializer symptoms;
8. add a behavioral regression test for the recovered invariant;
9. rerun the complete fixture suite and compare metric deltas;
10. reject changes that improve aggregate score while regressing a hard gate or archetype minimum.

Store a machine-readable baseline and require non-regression per archetype. Suggested initial promotion policy:

```text
validity:            100%
content recall:      >= 99.5% per document
missing targets:     0
missing images:      0 unless ledger-approved decoration
heading F1:          >= 95% corpus, >= 85% per archetype
media binding F1:    >= 95%
table structure F1:  >= 98%
reading-order pairs: >= 99%
review rate:         tracked, not hidden
```

Thresholds should be calibrated from the locked set; these are starting targets, not observed current performance.

### 7.4 Behavioral tests to add

Tests should defend observable contracts:

- alternating label/cover + split track rows become repeated semantic groups;
- date label remains attached to its news body across table columns;
- roster names become sibling `##` sections;
- adjacent images with shared context become one `images` group;
- caption text is emitted once and bound to the correct image;
- 152px portrait in a 422px content column maps to calibrated token, not ancestor-intrinsic `full`;
- `<br>` wrap, paragraph, lineation, spacing, bullet, and numbered-list cases;
- centered short notice maps to `align`/`frame`; justified prose does not;
- right-aligned terminal credit maps to signature/profile downgrade;
- no title candidate produces review-required candidate, never an H1-less published file;
- LLM patch referencing an unknown ID is rejected;
- valid but conservation-regressing LLM operation is rejected;
- `visual:always` cannot silently use `NullMeasurer`.

### 7.5 Renderer-level smoke test

For each BioMD construct, render source and converted BioMD at desktop and mobile widths. Compare semantic layout facts rather than pixels:

- source/mobile reading order;
- image side/center placement and coarse width bucket;
- columns collapse order;
- gallery grouping;
- nav containment;
- table scroll containment;
- frame/signature treatment;
- no literal directive property leakage.

A perceptual screenshot diff can triage changes, but DOM/ARIA/layout facts should decide correctness because exact fonts/colors are intentionally discarded.

---

## 8. Phased implementation plan

### Phase 0 — Reproducible baseline

1. Restore dependency installation and run `npm test`, typecheck, official `biomd eval`, and a clean corpus conversion.
2. Persist full evaluator JSON and per-job resolver stats.
3. Complete the corpus profile with all fixture/production files and visual statistics.
4. Make `visual:always` explicit and enforceable.
5. Add fixture sidecars for archetype, boundaries, relations, and table subtypes.

**Exit:** every baseline claim can be reproduced from a clean checkout; no stale checked-in output is mistaken for current behavior.

### Phase 1 — Semantic IR and invariants

1. Add region/block/media/target IR and relation graph.
2. Move ledger accounting to stable symbol IDs.
3. Resolve exactly one title before AST lowering.
4. Add explicit reading-order graph and terminal states.
5. Retain intermediate IR/evidence artifacts.

**Exit:** direct LADOM→AST lowering no longer owns semantic decisions.

### Phase 2 — Breaks, roles, and archetypes

1. Implement break-run segmentation and list reconstruction.
2. Add title/subtitle/lead/heading/date/person/album/note/signature role classifiers.
3. Add biography, roster, news, catalog, and data-table planners.
4. Wire `text.segment` and `text.role` only for abstentions.

**Exit:** heading, paragraph, list, separator, and hard-break axes meet archetype targets.

### Phase 3 — Media and layout recovery

1. Detect content box and calibrate image tokens.
2. Bind captions, click targets, frames, and alt text.
3. Cluster image groups.
4. Add table row-pattern segmentation and hybrid decomposition.
5. Add order conflict resolution.
6. Wire `media.bind`, `table.toLayout`, and `order.resolve`.

**Exit:** media/group/size/position and catalog/news order targets pass.

### Phase 4 — Final audit and safe repair

1. Implement `document.plan` for globally ambiguous pages.
2. Implement typed `review.audit` and `repair.patch`.
3. Apply on copies with invariant rechecks and metric monotonicity.
4. Add confidence/risk policy and optional second-model adjudication for destructive operations.
5. Persist all decisions and cost data.

**Exit:** LLM assistance reduces review rate without weakening conservation or deterministic reproducibility.

### Phase 5 — Production rollout

1. Shadow-convert the full 1,000-page corpus.
2. Cluster unresolved reviews by failure signature.
3. Fix high-frequency deterministic patterns before increasing LLM spend.
4. Convert representative clusters with LLM assist and inspect sampled outputs.
5. Publish only hard-gate-clean outputs; quarantine the rest.
6. Freeze engine/profile/prompt versions for the production batch.

**Exit:** measured clean share, per-archetype minima, cost/file, cache hit rate, and review queue are acceptable and auditable.

---

## 9. Files most likely to require revision

| Area | Current files | Recommended change |
|---|---|---|
| Pipeline | `convert-core/pipeline.ts` | orchestrate IR/planner passes; request screenshots/crops; enforce publish gate |
| Direct lowering | `convert-core/structure.ts` | shrink to typed semantic-group→AST lowering; remove local semantic guessing |
| Headings | `convert-core/headings.ts`, `prominence.ts` | role classifier + hierarchy planner + archetype features |
| Breaks/text | `structure.ts`, `dehyphenate.ts`, `text-ops.ts` | break-run IR, list/paragraph segmentation, source-span-safe operations |
| Media | new module plus `structure.ts` | caption/group/position/size/frame/link binding |
| Layout tables | `classify.ts`, `data-table.ts`, new layout planner | row-pattern segmentation, hybrid recursive groups, lane/order plans |
| Corpus | `corpus.ts`, CLI scan path | geometry/class/archetype/template statistics; populate width histogram |
| LLM | `convert-core/resolver.ts`, `llm/resolver.ts`, `llm/hooks.ts` | add planner/executor/audit typed hooks; pass crops; operation application checks |
| Conservation | `conservation.ts`, ledger | stable identity graph, duplication and binding checks, order axes |
| Evaluation | `eval/facts.ts`, `score.ts`, `report.ts` | directive tree, caption/media tokens, lists, separators, order, hard-gate summary |
| Artifacts/CLI | `cli/index.ts`, `cli/store.ts` | retain all stages and resolver evidence; promote only publishable outputs |
| Tests | current unit tests + fixture integration | archetype and behavioral contracts, full reference regression suite |

---

## 10. Final assessment

The project has not failed because malformed HTML is intrinsically too difficult. The browser and physical grid already recover much of the raw evidence correctly. The failure occurs after evidence collection: the converter lacks the semantic planning, relation graph, break classification, media binding, row-pattern decomposition, and reading-order model required to turn that evidence into BioMD.

The correct strategy is therefore:

1. retain decoding, parse5 repair, measurement, grid, AST, serializer, validator, conservation, transport, cache, and budget infrastructure;
2. stop expanding ad hoc rules inside `structure.ts`;
3. add the missing semantic IR and document/layout planners;
4. wire focused LLM hooks at explicit abstention points with screenshots/crops and typed operations;
5. validate every proposed change against hard invariants and multi-axis reference metrics;
6. publish only clean outputs and preserve all evidence needed to audit the rest.

That path directly addresses the observed failures—image size/position, missing captions/groups, wrong or absent directives, centering/style loss, headings, news/catalog order, and excess hard breaks—without surrendering content integrity or determinism to free-form model generation.
