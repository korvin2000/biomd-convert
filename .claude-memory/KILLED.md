# KILLED -- falsified hypotheses and standing traps

**A killed hypothesis reopens on new measurement only, never on argument** (`CLAUDE.md` §3.4).
Re-deriving these across sessions is the main tax on work of this length. `§` = section in
`biomd-convert/CONVERTER-PROGRESS.md`; route through [MAP-progress.md](MAP-progress.md).

## 1. Converter-rule hypotheses

| claim | what killed it | § |
|---|---|---|
| The defect is a missing semantic IR | most loss was four local misreadings in the existing lowering path | 3.1 |
| Indentation is blockquote evidence | the stylesheets write unitless `margin-left: 25`; invalid CSS, Chromium drops it, **computed inset is 0 corpus-wide** | 12.3 |
| Font size proves subordination | on an archive page the longest blocks *are* the quotes, so `bodyProminenceOf` measures them and the comparison inverts | 12.3 |
| A majority test against a page baseline works | a dominant construct disqualifies itself. Ask for **contrast**, not majority | 12.3 |
| A computed colour testifies to authorial intent | `#000000` declared and inherited are the same value; read the declaration | 13.4 |
| `<blockquote>` is evidence of a quotation | in this corpus it is an indent as often as a quotation -- wrong on ~half the corpus | 14.3 |
| A page-level recurrence gate substitutes for content evidence | `subordinationRecurs` is **true** on both pages that must not quote | 14.3 |
| A record list can be told from verse by shape | measured over 78 runs: line count, line length, variance and lineation **all overlap**. `borislova`'s poems and `kiselev`'s track lists are the same shape | 15.2/15.3 |
| `retyped.paragraph-to-list` and `paragraph.spurious.in-break-run` are one mechanism | shared substrate (`<br>` runs), nothing else. One is a missing detector, the other was an instrument over-claim | 15.3 |
| Enumerated break-runs → lists (implemented, worked) | **reverted**: L2 source-backed 528 → 600, because it exposed a reference editorial (`<i>4.07</i>` → `— 4.07`) 25 times | 8.2a |
| A rejected DATA table implies a missed table | `new_karta5`'s records have no shared column schema; a table would need an invented header | 17.4 |
| Recurrence among accepted peers licenses a one-row table | the rule fired exactly where measured and still emitted nothing: `tableFromPlan` cannot synthesize a header from one row. **Check what the emitter can express, not only what the detector can justify** | 17.4 |
| A null alignment baseline is repaired by dropping the length threshold | unrestricted weighted majority on that page is `left`, so centred blocks stay distinctive and nothing changes | 17.4 |
| An empty `::: column` is degraded output | `goya2`'s reference **keeps five**; dropping them shifts 30 records out of alignment. Correct and incorrect shapes are byte-identical | 18.2/18.5 |
| A failed DATA table should be reconsidered as a layout region | symmetric with the UNKNOWN path, **measurably worse** (L1 93.8 → 93.6, three regression documents changed), and already refused by a named contract in `recovery.test.ts` | 18.3 |
| Every `media-lane` refusal is a lane | `goya2` 3 → **23** converter-defects in one run. A *gallery* — every column bare covers — has no worded lane to pair them with and its reference writes one `::: images` row. **L1 did not move at all** (99.5 both sides). The narrow form that survived requires a picture lane **and** a matter lane, and excludes a resource matrix by the tier-1 DATA gate's own test | 47.4 |
| CATALOG's near-equal-lane gate is over-fitted *and is the cause* | over-fitted: probably. The cause of `new_lagq2`: no -- widening it reaches `barrios` (0.67) and `news_2007` (0.27) | 18.5 |
| Centre alignment cannot be admitted (4 guards tried) | it could -- the false friend was a **symptom** of collapsed lanes upstream. §10.1 gave those documents their lanes back and spurious aligns fell 15 → 4 | 10.2 |
| A corpus-level `.chrome` sub-class by cross-document text recurrence | fires on **nothing** across the 13; removed rather than shipped on the argument that it would fire on the other ~987 | 8.3 |
| `paragraph.containment` is the missing-lane mechanism | 91 of its 141 instances were the **opposite** defect -- spurious lanes wrapping prose. Grouping the class by the *direction* of its findings falsified it in one query | 21.1 |
| A narrow flank beside a dominant column is a page rail | killed **before it was written**: `new_blackmore`'s reference lanes measure 29/71 with the *text* in the narrow one, so the rule would have cemented its 3 open `column.missing`. Flanked on **both** sides is the discriminator; width alone is not | 21.6 |
| An all-empty table header is a different question from an empty header cell | it is the same answer repeated. Treating it as a special case aborted the whole table and cost two record matrices -- `new_dyens` came out as 20 loose aligned paragraphs | 21.4 |
| An mdast `html` node is a way to emit a character reference | it serializes correctly and then trips `raw-html` **and** `table-cell-block-content`, both correctly. Emit the character; fold the spelling in the instrument | 21.4 |
| A one-row media record licenses a one-row table | reopened legitimately once §21.4 removed the emitter blocker §17.4 killed it on -- then killed again on better evidence. The shape occurs **three times corpus-wide** and the references split **2-1**, with `williams2` (regression corpus) writing `::: align`. `new_kolpakov`'s row is not even covered: its third cell is an unlinked `(1,7 Mb)` | 22.2 |
| The alignment family is its own mechanism | a third of it closed as a *side effect* of the region work in §21.2 and §22.1, with no alignment rule touched. Read it **after** the region and table families settle | 22.3 |
| Same prominence across two masthead lines always means two `#` | true across sibling *blocks*, false inside one block: a `<br>` between lines set the same way is a hand-wrap to fit a 458 px cell. `segovia1` and `new_geyzel04` join theirs. The first implementation regressed both plus `goya2` in one run | 24.1 |
| A masthead written as `<center>` is reachable by heading recovery | `normalize` unwraps `<center>` before recovery runs, so the lines have no box to be lines of. All 22 corpus mastheads use a `<div>`; recorded as a limit, not chased | 24.6 |
| A guard that fires on nothing should be removed | measure **both paths** first. The masthead-box exclusion is inert measured and load-bearing unmeasured, where a folded `<font size>` is the only evidence there is | 24.6 |
| `isDecorative`'s filename regex is why nav arrows shipped as pictures | `back.gif` **is** in the regex, `previous.gif` **is not**, and both produced identical wrong output. When a guard's presence and absence give the same answer the guard is not the deciding code -- `dropDecorative` reads direct children, `runImages` descends through `<a>`, and an icon is always inside its link | 29.3 |
| ~~`table.header.cell` closes no validator error~~ | **this entry was itself wrong** -- it closes **15 of the 28**. The mistake was inferring from `validate <file>` (a laxer profile, reports 0) instead of measuring `errors=` in `bench/last-run.txt`. Kept as a corpse of the *method*, not the claim: never quote a validator figure from anywhere but `corpus run` | 29.2 / 30.2 |
| A word-less block may open an alignment run because it carries a target | the false friend was never `* * *`. `segovia1`'s footer is a four-cell lane row whose outer two cells are bare glyphs; making them alignable swept **all four lanes into one `::: align`**. L2 322→324, L3 85→**87**, and a structural loss on a regression document. The loose blocks are a *symptom* of the missing `columns` region -- guarding against them downstream would cement it | 30.1 |
| The converter is dropping a source header row on `new_karta` | the source has no header text at all: no `Композиция`, no `Формат`, no `Ноты (TAB)`. The old references invented them exactly as the new ones invent `Название`/`Аудиоформат` | 29.2 |

## 2. Instrument hypotheses -- your own differ/renderer/judge is a first-class suspect

| claim | what killed it | § |
|---|---|---|
| Sibling alignment alone can adjudicate a document | containment defects are invisible to it; one `goya2` mechanism defect appeared as 42 unrelated `paragraph.spurious` until reconciliation went global | 6.5 |
| Two paragraphs with no shared vocabulary are one rewritten paragraph | they are a deletion **and** an insertion with different owning rules; collapsing them hides the deletion | 6.5 |
| Traceback can re-derive the fill's decision by float equality | one ulp fell through every branch, `j` walked past zero, infinite hang on `goya2`. Store backpointers | 6.5 |
| Similarity may tokenize without folding intra-word hyphens | a paragraph scored **zero** against its own de-hyphenated self -- the blind spot sat exactly on the defect the class exists to raise | 6.5 |
| Structural findings can be triaged by text attestation | put `columns.missing` (43 inst, 5 docs) in the *ceiling* list -- the largest reachable class in the corpus | 6.5 |
| `structure` evidence is safe for any placement finding | correct for layout; **wrong** for anything claiming how the same content is *set*. A block boundary vs a line ending is presentation | 15.3 |
| A directive's own name and properties are evidence about the source | `align center Francis Goya in Moscow` appears in no document, so every spurious directive read as unattested -- and every *missing* one as reference editorializing | 11.2 |
| Source attestation can adjudicate hyphenation | the source contains the hyphen either way -- *that is the artifact*. The class reported "the reference is right" 24 times out of 24 on evidence that says nothing | 13.3 |
| A pairwise "same row?" test can be handed to `Array.sort` | not transitive → implementation-defined permutation; it manufactured a finding where both ranks were **equal** | 7.6 |
| Textless blocks (`---`) can be paired ordinally | one extra rule near the top shifted every rule after it; on `news`, 26 of 32 order findings *were the rules*. Pair by **anchors** | 9.3 |
| An instrument's own key may fold differently from the rest of the instrument | `homeKey` split on hyphens while `similarityTokens` joined them → a class asserting content loss for text one function over could see | 14.3 |
| `paragraph.missing` reports missing paragraphs | all ten had their text in the produced document. A class reporting content loss where none exists outranked every real class | 14.1 |
| `conservation.text.recall` is a content-loss measure | it is built on word shingles, so a legitimate block split breaks every straddling shingle. 45.3 % recall with **zero** words, links or images missing | 16.2 |
| A structural fingerprint may hash a declared length verbatim | `width="760"` and `width="760px"` split one site template into two shapes, so `news`'s banner, menu button and rails matched nothing and shipped as content. Normalizing the length cost L3 13 findings on its own | 24.4 |
| `navFrom` must refuse every bounded context | §2 forbids `nav` in a `frame` and `align` wrapping one; a `column` is explicitly allowed (`column→Markdown+leaf+align+nav`). `news_2007`'s year bar came out as ten bracketed links because of it. **Measured**, not argued from symmetry -- the nav contracts in `recovery.test.ts` and `lanes.test.ts` were grepped first and still pass | 24.8 |
| A block containing a picture is a picture, for the caption guard | `followsImage` read a dated newspaper banner as "a photograph above" and cost two article titles their heading. A picture **with its own words** has already said what it is | 24.4 |
| Folding a presentational wrapper onto its parent is lossless | twice wrong: a partial cover asserts a size of text it never covered, and where the parent is measured the folded value is shadowed by the parent's own computed size and disappears | 24.2 |

## 3. Standing method traps

- **A pre-filter is part of the rule.** Widening `dehyphenateText`'s pattern while
  `dehyphenateDocument`'s gate stayed narrow produced a null result that looked like the rule being
  wrong. Two hours; one instrumented run would have found it in ten minutes. (§13.4)
- **A shared evidence set is only shared where it is recorded.** `ctx.subordinated` covers element
  children, not inline runs, so two consumers saw nothing on the one page the rule was for. Check what
  *populates* a set before keying a second rule on it. (§14.3)
- **A symmetry argument is not evidence -- grep the contracts first.** "This question is answered by
  evidence on one path and by construction on another" produced three real fixes and one revert. An
  asymmetry with a named false friend and a test is a decision, not an oversight. (§18.3)
- **A false friend that exists only because an earlier stage failed is a symptom.** Guarding against it
  downstream cements the upstream defect and hides it from every instrument. (§10.2, §16.4)
- **Sweep a threshold before believing it.** A monotone curve means the number does real work; a
  **cliff** means it is masking a missing exclusion. `ALIGN_LABEL_MAX_CHARS` at 400 centred a whole
  discography because `alignableRunMember` excluded tables and headings but not lists. (§12.1)
- **Test a conservation claim against stripped source text, never raw HTML.** `new_lagq2` looked like
  it emitted a track twice; markup had split the second occurrence. (§19.5)
- **Instrument at runtime; never reason from the stylesheet.** Three separate defects this campaign
  were invisible in the source and obvious in one `DBG_X=1` run: a detector never called, a guard
  rejecting a declared value, and a pre-filter skipping the node. (`learned-patterns.md`)

- **A word-less block may open an alignment run because it carries a target -- killed twice, on two
  different falsifiers.** §30.1 killed it: `segovia1`'s four footer lane cells became alignable and
  `groupAlignedRuns` swept them into one `::: align`. It named its own reopening condition -- *only
  once the `columns` region is recovered first* -- §33 met it, and the rule was rebuilt and
  re-measured, which is the correct process. It then failed for a **new** reason: the recovered lanes
  want no `::: align` inside them at all, so `segovia1` went 2 -> 4 `retyped.align-to-paragraph`,
  L3 rose 68 -> 70, and L2 was net zero. Reverted whole. Do not rebuild it; the residue is a
  narrower, separate candidate -- `align` inside `column`, where the references want 26 and the
  produced side has 32. (§35.10)
- **A uniformly indented run subordinate to a lead-in is a list.** Fires **21** times across the 22
  sources and only 2 want a list: `borislova`'s sixteen movement runs keep hard-break lines in their
  own reference, `pavlov_azancheev`'s letter has no unindented lead-in, `tarrega`'s two nine-line
  runs want a table. Only the *colon-announced* form was built, and it fires on exactly the right 2.
  The lesson generalises: an indent alone means "continuation" as often as "item" -- `goya2` indents
  the continuation of a wrapped track title *under* it. Equality and announcement are the evidence,
  presence is not. (§35.7)
- **Carry a container's right alignment into GFM column alignment.** Would close `new_kolpakov`'s
  three `table.align` findings and recover `williams2`'s right-hug after §35.6 -- but exactly **1 of
  the corpus's 21 reference tables** uses column alignment. Not a rule, a single reference choice.
  Reopens only if a second and third instance appear. (§35.6)
- **Merge adjacent sibling `::: align` blocks that share a position.** The obvious reading of
  `goya2`'s Vol. 2 cell, and it would close its three `retyped.align-to-paragraph`. The references
  **keep** adjacent same-position `align` siblings in `goya2` (Vol. 1), `kiselev`, `new_geyzel04`,
  `new_karta` and `williams2`, and merge in `goya2` (Vol. 2, 1988, 1999) alone -- four documents to
  one, and the one contradicts itself: the `Vol. 1` and `Vol. 2` source cells are structurally
  identical (`margin-top: 5` then `margin-top: 0`, both `align="center"`) twenty lines apart.
  §36.5's tie-break decides it, and `analyze-2.md` then confirms outright that the author "сэкономил"
  and that either spelling is allowed. Reopens on nothing short of a reference that merges where
  another *cannot*. (§37.9)
- **"Link-only cell" as the guard for `align` inside a pager lane -- killed in §33.4, and correctly.**
  `kiselev`'s link-only contact block *is* wrapped by its reference, so no cell-level test can
  separate them. It is recorded here so nobody rebuilds it: the working guard is the **region**
  (`isBareLinkRow`), a signal §33.2 created in the same iteration that recorded the residue, and
  §37.3 uses it. The lesson is the general one -- *when a cell-level test dies, ask whether the
  container knows.* (§37.3)
- **Hoist *every* edge break out of a link label.** The first form of §37.5's correction, and it is
  right for `new_kolpakov` (`<a>x<br></a>` with nothing after it) and wrong where the division is
  drawn on **both** sides of the anchor boundary. `borislova`'s `<a>ДИСКОГРАФИЯ<br></a><br>` then
  emitted two breaks, which a browser really does draw as a blank line (measured: 14 px line height,
  a 28 px step where every other step is 14) — but in Markdown a blank line is a paragraph boundary,
  and it split one credit block in two, took its opening link out of the block, and cascaded through
  L2's positional link alignment to **3 -> 8 defect with 2 criticals**. The guard is that the hoisted
  break gives way to the authored one; §1's hierarchy is lexicographic and structure outranks a
  14 px gap. (§38.3)
- **Source containment as the guard for a nav title.** The obvious fix for `new_rechin4`'s strapline
  being absorbed into `title:` — require the label and the menu to come from the same source
  container. `news` puts its label in a bordered tinted cell of its **own**, a different container
  from the bar it names, and wants the title anyway. Adjacency in the flow is the position §11
  describes; the source's box structure is not. The working guard is the label's own shape: an
  ornament *between* phrases means the line is a series, and a title names one thing. (§38.4)
- **Right-aligned columns for a narrow table inside a right-aligned container.** `analyze-3.md`
  states the reasoning for `new_kolpakov` — *"нет указаний на центрирование по правому краю, но
  таблица узкая / маленькая, занимает 3-ть ширины и находится внутри `<div align="right">`"*, and
  markdown cannot size a table so the workaround is to align its **content**. Swept in Chromium at
  1024 px: **ten** multi-cell tables sit in a `right`- or `centre`-placed container across nine
  documents — `new_bach` 0.90, `kiselev` 0.80 ×2, `tarrega` 0.75, `barrios` 0.70, `new_dyens` 0.68,
  `borislova` 0.65, `williams2` 0.65, `segovia` 0.50, `new_kolpakov` **0.40** (share of the parent's
  width). Exactly **one** reference uses `--:`. The only separator is width share, and 0.40 against a
  next-nearest 0.50 is a cliff one document wide — §9 says a cliff means the number is standing in
  for something else. Cost of leaving it: 3 minor findings on 1 document. (§39.6.1)
- **Emphasis from a CSS class's `font-style: italic`.** `analyze-3.md` on `new_dyens` quotes the CSS:
  `.l { … font-style: italic }`, and its reference italicizes all three `.l` cells. Swept in the
  browser for computed-italic text carrying no `<i>`/`<em>`: **nine documents, several hundred
  blocks** — `new_bach` 78, `kiselev` 34, `tarrega` 32, `barrios` 27, `pavlov_azancheev` 17,
  `new_dyens` 3, `segovia` 2, `borislova` 1, `new_kolpakov` 1. One reference honours it; at least
  five do not, and `new_kolpakov`'s `Венгерка` is `class="l"` in the source and upright in its
  reference. Verdicts flip on identical evidence, which is the standing downgrade condition — and
  this is the **cause** of `emphasis.span`'s 19 instances, which had been downgraded for the same
  reason without knowing why. Implementing it italicizes hundreds of cells on six documents to close
  three on one. (§39.6.2)
- **Both attempted forms of `pavlov_azancheev`'s two-line-headline fix.** The defect is real and
  `analyze-3.md` names it, but:
  *(a)* vetoing the candidate in `headings.ts`'s centred-recurrence pass when a block's `<br>`-runs
  are not of uniform weight **also killed the page's own two real headings** — `## I. Краткая
  биография…` and `## II. Неизвестные письма…`, both of which the reference keeps — because
  `morePromintentThan` compares dominant font size before weight and two `<b>` runs need not report
  identical sizes. L1 98.4 → 98.3, `pavlov` heading axis 96.8 → **85.7**, L2 134 → 138.
  *(b)* declining in `headingLineOf` on `followingText === 0` is **inert**: `blockFrom`'s
  `data-biomd-heading` branch returns before any line splitting, so `headingLineOf` never sees a
  block the typographic pass already marked. All four rungs byte-identical; reverted rather than
  committed as dead code.
  **Superseded by §40.4, which landed the third form.** The next attempt must act where `data-biomd-heading` is *set*, and the discriminator is **page-level
  recurrence of the shape**, not the shape: `borislova` writes `<b>1990-1993<br></b>` over unbolded
  works **ten times**, structurally identical, and every one is a heading the reference keeps. (§39.6.3)

- **A closing source credit is a `::: signature`.** `new_kolpakov`'s reference uses it and
  `BioMD-Reference.md` §`signature` does say "source-credit groups". Swept over the trailing block of
  all 22 references: **five** documents end in a distinctively aligned block, and `authors`,
  `kiselev`, `pavlov_azancheev` and `tarrega` all keep `::: align position: right`. Verdicts flip on
  identical evidence, and §36.5's tie-break makes it 4 to 1. `signature` remains a directive the
  converter never emits. (§40.7)
- **A relational replacement for the "one table is the page shell" constant -- three forms, all
  reverted on measurement.** The constant *is* wrong: measured, 8 of 22 documents wrap their article
  in two or three tables, which kills `recoverCenteredSections` outright on those pages and demotes
  every section label they do recover. But it is load-bearing in five rules calibrated against it.
  *Median prose depth* -> L1 98.4 -> **96.9** (`news` head 100 -> 14.3: on a dated-news page the
  prose **is** the record content, so the baseline becomes the records). *Occupancy* -> 97.8; the
  assumed bimodal split does not exist (shell tables and discography tables both occupy 0.89-1.00 of
  the page). *Wrapper-vs-grid* -> `news`/`new_lendle2`/`new_lagq2` recovered but `new_bach` head
  100 -> **36.4**, and `new_geyzel04` is still not fixed because its content table is a page rail.
  Reopen with wrapper-vs-grid **plus a page-rail exemption**, re-deriving `headingLineOf`'s guard
  first. (§40.6)
- **`new_karta`'s trailing `[▶]` wants centring.** Not attempted: it is `retyped.paragraph-to-align`,
  the word-less alignment rule already killed twice (§30.1, §35.10), at 1 instance. The narrower
  residue worth a future look is *an image the icon policy replaced with a glyph keeps the
  `position:` the image had* -- a different claim, and one that must exclude anything inside a
  recovered lane, which is what killed the rule the second time. (§40.8)

- **Cell content weight as the per-row / row-major-grid discriminator for `::: columns`.** The
  obvious reading -- *rows of single short cells are one list, rows of blocks are separate records* --
  is falsified by `news_2007`, whose dated news list is one multi-row 2-column table of short cells
  (source lines 99-136) and whose reference emits **one region per row with a rule between them**.
  `news_2007` and `xtra_shelechov` are the corpus's only two text-beside-text multi-row cases and
  they disagree, so verdicts flip on identical evidence. The majority is 8 documents to 1 and
  `xtra_shelechov`'s grid is recorded as a named divergence instead. (§42.4)
- **Raising `planDataTable`'s `maxCols` to keep a wide table.** `xtra_karta5`'s Sor table is a
  legitimate **six**-column record matrix its reference keeps whole, so the cap is not the mechanism;
  the eleven-column score sheet is a strip the source subdivided, and folding the strip is the fix.
  (§42.5)

- **Every wholly empty row in a table is padding.** Only the run at the *foot* is. An empty row
  *between* records is a separator and real structural evidence: `news_2007` groups its two news lists
  that way and `xtra_shelechov` its programme (rows 1, 10, 12), and both references honour the
  grouping with `::: columns` per record. The general form flipped all three documents to tables and
  cost L1 98.5 -> **96.0**, L2 318 -> **342** findings, 207 -> 232 defect, 8 -> **13** criticals.
  Anchored at the foot -- where a row has nothing after it to separate -- it flips exactly one table
  in the corpus and is landed as `0826f53`. Position is the mechanism; emptiness is not. (§43.4)
- **Column alignment inherited from a right-placed table.** `new_kolpakov`'s reference writes
  `| --: | --: | --: |` over a `40%` table inside `<div align="right">`, which looks source-attested
  and general. **Thirteen documents wrap a table in `<div align="right">` and twelve of their
  references write `| - |`.** Only two references in the corpus use a non-default alignment row at
  all, and the author already ruled the other (`xtra_karta5`) ignorable. 12 to 1; `table.align` is a
  reference quirk on both documents and its 3 `new_kolpakov` instances are mis-triaged as
  converter-defect. (§43.5)

## §46 -- killed on the 946-page unlabelled corpus (2026-08-12)

| hypothesis | falsifier | cost to re-kill |
|---|---|---|
| **Low text recall means data loss.** 34 documents below 90 %, `baden_powell2/3/4` at 40 % -- the largest priority-1 signal in the scan | `baden_powell2` is an album-cover gallery with **193 characters of visible text**: title, `[ 1 ] [ 2 ] [ 3 ] [ 4 ]` pager, one heading and twelve covers, **all conserved**. Recall's denominator includes the chrome the converter is *meant* to remove, so on a text-poor page each removed banner word costs a large fraction. The reference set already said so: **`new_lagq2` sits at 45.25 % with L1 99.8 and 2 defects** | one `cat` of the produced file |
| **The 946-page chrome model causes the pager loss.** That profile removes structures recurring at 99 %, 88 % and 77 % where the 28-page one sees only 100 % and 91 % | Converting the same documents with `bench/corpus/corpus-profile.json` gives **byte-identical** loss | one command |
| **`new_page.htm`'s 0.00 % recall is a defect** | It is the author's blank template -- *"Имя и фамилия"*, *"Текст биографии"* repeated -- and it converts correctly | one `cat` |

**Downgraded, not killed:** the **adjacent caption echo** (§46.7). The defect is real and measured --
9 instances on 8 documents, against **zero** at that distance in the hand-made references -- but one
label covers three shapes, and separating `bogdanovic`'s 64-character caption from `borislova`'s and
`jovicic`'s reference-attested 1×2 text-lane-beside-cover needs a **swept** text-length threshold.
Reopen with the sweep, not with an argument.

## §50 -- killed on the 946-page corpus and on one reader call (2026-08-13)

| hypothesis | falsifier | cost to re-kill |
|---|---|---|
| **The adjacent title/caption echo is a defect.** 174 produced captions repeat an adjacent visible line across 147 documents -- the largest text-duplication signal in the corpus | **141 are the portrait caption repeating the document title**, and `fixtures/out/barrios.bio.md` writes exactly that: `# Агустин Барриос` at line 1, `caption: Агустин Барриос` at line 7. Reference-attested, in every biography. Only 6 mid-document echoes remain, in 6 different shapes on 6 documents | one `head -18` of a reference |
| **`::: align` sometimes wraps nothing.** A probe found 46 empty `align` directives on 24 documents | The probe read a body line of the form `Location: Buenos Aires` as a directive property line and ignored the blank line that ends the property block. `biomd-ast/read()` over all 946 reports **0 empty directive nodes and 0 warnings** | one `read()` loop |
| **§41.3: weakening rule 6's two-signal gate trades visible residue for silent corruption** | The gate was never weakened -- one of its two signals measured the wrong thing. Hyphenopoly answers "where *may* this word break", and these pages were typed from print by hand, so the hyphen is where the typist put it. Simulated over all 974 documents, the replacement signal joins **131 occurrences of 112 forms and not one is a compound**; the real false friend `лит-ре` (`литре` is a different word, both halves are words) is refused by it | the simulation, ~2 min |
| **`DATA` to flow `too-small` is a mechanism.** Largest reachable routing class, four iterations running | 27 instances in four unrelated shapes -- `1×3` 7, `1×2` 7, `1×4` 3, `1×5` 1, and **9 that are a one-column table where flattening is correct**. §48 and §49 removed the two coherent caption subsets; what is left is a mixture. Probed §46.9, §47.7, §48.1, §49.1, §50.1 | one aggregate over the scan |

**Not killed, still true and still unbuilt:** the proper-name hyphenation tail. `Бориславовна`,
`Феррере`, `аккомпанементов` are reference-attested `paragraph.hyphenation.unjoined` **defects** --
the reference joined and the converter did not -- and Hunspell rejects all three. Rule 4 cannot help
because the lexicon indexes exact forms. A stem-tolerant lookup is the named next signal.

## §51 -- killed by instrumenting the decision point, and by reading a reference instead of quoting it (2026-08-13)

| hypothesis | falsifier | cost to re-kill |
|---|---|---|
| **`LAYOUT t2` splitting 17 flat against 15 `::: columns` is a converter inconsistency.** The largest split in §46.5's reference-free consistency instrument -- 32 tables on identical classifier evidence, and OPEN's standing routing item | Both sides are right. Instrumented at the decision point: on the flow side (`zanon`, `dylla`, `perroy`) the table is the **page shell**, `w=[116,529,115]`, `pageRailColumns` finds rails `{0,2}`, one lane survives, flatten is correct. On the columns side (`parkening`, `walker`, `rechin`) the shell is `LAYOUT t1` and the `t2` table is an inner content region with no rails, `w=[229,130]`. **The classifier view carries no geometry, so a page frame and a two-lane region collapse into one string.** A split view is evidence about the view as often as about the converter | one `DBG_LANE` line, six documents |
| **`xtra_karta5`'s four table criticals are available work.** Half the corpus's criticals, on the document whose *table content* the author explicitly asked for (OPEN §3.13) | `xtra_rodrigo`'s reference writes `\| **Ноты**\*\* \| I. \| […] \| [zip] \|` -- the **four-column** score strip the converter produces for `xtra_karta5`. The converter's reading is attested by the other reference; `xtra_karta5`'s 2-column merge is §43.6's recorded 1-to-1 minority | one `grep` of a reference |
| **Hoisting mark-boundary whitespace is right at every boundary.** The obvious general form of the §51 rule | `new_lagq2` text axis **100.0 → 45.6**, corpus L1 98.6 → **98.0**: its 26 `<i>COMPOSER </i>- Work` rows each gained a space the reference does not have. The references cut it by what stands on the other side -- letter-to-letter keep 3 to 1, punctuation drop **27 to 1** -- which is `BioMD-Reference.md`'s own precedence, content above exact style | one bench run |

**Not killed, and it is instrument debt, not a defect:** the 9th critical. `barrios`'s footnote gains
the space its source draws, and `paragraph.content` reports any paragraph mismatch at `critical`
however small. The corpus's only other footnote definition (`new_dyens`) writes the space, so the
references are 1-to-1 and the source breaks the tie. Fix the severity ladder, not the converter.

## §53 -- killed by building an old commit, and by reading one reference against itself (2026-08-14)

| hypothesis | falsifier | cost to re-kill |
|---|---|---|
| **The generalization-corpus rules (§46--§51) deleted content from `xtra_garcia_lorca`.** The author's own report, and the reason this iteration was called | A build at `b8704e2` -- the last commit before §46, therefore before every one of those rules -- converts the page **byte-identically to HEAD**, 9464 bytes both sides. `git log -L` on `case "pre"` returns one commit, the initial version. Backed by a removal-reason audit over all 30 sources: **no reason discards prose, 0 lost targets, 0 lost images** | one `git worktree add` + one build (~4 min) |
| **`retyped.heading2-to-paragraph` on `xtra_garcia_lorca` is available work.** 3 converter-defects, the document's largest remaining class | The source sets **six** blocks in one identical template, `<p class="t2"><i><b>…</b></i></p>` at the body's own 11 pt. The reference writes four of them `**bold**` and two of them `##`, with nothing in the source separating the groups. Corpus-wide the heading family is 5 findings over 3 documents and splits **both** ways | one `grep` of source and reference |
| **Route every `too-small` DATA refusal to `layoutFrom`.** All four rungs improved and exactly one document changed | It *is* the reconsideration §18.3 killed. Three existing contracts failed in one run: `jovicic`'s label lane beside its cover became `::: columns`, and §48's figure-beside-caption binding was bypassed. The survivor requires a **gutter** -- a never-populated column between two populated ones -- which no record matrix has, and is byte-identical to the wide form on all 27 | one `npm test` |

**The lesson §53.2 leaves:** a clean conservation report is not a clean conversion. Every word,
target and image was present, recall 99.46 %, validator silent, L1 unmoved -- and six poems were
flattened into single lines. Structure that no rung measures is where the next defect of this kind
will be.

