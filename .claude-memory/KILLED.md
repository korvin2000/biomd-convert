# KILLED — falsified hypotheses and standing traps

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
| `<blockquote>` is evidence of a quotation | in this corpus it is an indent as often as a quotation — wrong on ~half the corpus | 14.3 |
| A page-level recurrence gate substitutes for content evidence | `subordinationRecurs` is **true** on both pages that must not quote | 14.3 |
| A record list can be told from verse by shape | measured over 78 runs: line count, line length, variance and lineation **all overlap**. `borislova`'s poems and `kiselev`'s track lists are the same shape | 15.2/15.3 |
| `retyped.paragraph-to-list` and `paragraph.spurious.in-break-run` are one mechanism | shared substrate (`<br>` runs), nothing else. One is a missing detector, the other was an instrument over-claim | 15.3 |
| Enumerated break-runs → lists (implemented, worked) | **reverted**: L2 source-backed 528 → 600, because it exposed a reference editorial (`<i>4.07</i>` → `— 4.07`) 25 times | 8.2a |
| A rejected DATA table implies a missed table | `new_karta5`'s records have no shared column schema; a table would need an invented header | 17.4 |
| Recurrence among accepted peers licenses a one-row table | the rule fired exactly where measured and still emitted nothing: `tableFromPlan` cannot synthesize a header from one row. **Check what the emitter can express, not only what the detector can justify** | 17.4 |
| A null alignment baseline is repaired by dropping the length threshold | unrestricted weighted majority on that page is `left`, so centred blocks stay distinctive and nothing changes | 17.4 |
| An empty `::: column` is degraded output | `goya2`'s reference **keeps five**; dropping them shifts 30 records out of alignment. Correct and incorrect shapes are byte-identical | 18.2/18.5 |
| A failed DATA table should be reconsidered as a layout region | symmetric with the UNKNOWN path, **measurably worse** (L1 93.8 → 93.6, three regression documents changed), and already refused by a named contract in `recovery.test.ts` | 18.3 |
| CATALOG's near-equal-lane gate is over-fitted *and is the cause* | over-fitted: probably. The cause of `new_lagq2`: no — widening it reaches `barrios` (0.67) and `news_2007` (0.27) | 18.5 |
| Centre alignment cannot be admitted (4 guards tried) | it could — the false friend was a **symptom** of collapsed lanes upstream. §10.1 gave those documents their lanes back and spurious aligns fell 15 → 4 | 10.2 |
| A corpus-level `.chrome` sub-class by cross-document text recurrence | fires on **nothing** across the 13; removed rather than shipped on the argument that it would fire on the other ~987 | 8.3 |

## 2. Instrument hypotheses — your own differ/renderer/judge is a first-class suspect

| claim | what killed it | § |
|---|---|---|
| Sibling alignment alone can adjudicate a document | containment defects are invisible to it; one `goya2` mechanism defect appeared as 42 unrelated `paragraph.spurious` until reconciliation went global | 6.5 |
| Two paragraphs with no shared vocabulary are one rewritten paragraph | they are a deletion **and** an insertion with different owning rules; collapsing them hides the deletion | 6.5 |
| Traceback can re-derive the fill's decision by float equality | one ulp fell through every branch, `j` walked past zero, infinite hang on `goya2`. Store backpointers | 6.5 |
| Similarity may tokenize without folding intra-word hyphens | a paragraph scored **zero** against its own de-hyphenated self — the blind spot sat exactly on the defect the class exists to raise | 6.5 |
| Structural findings can be triaged by text attestation | put `columns.missing` (43 inst, 5 docs) in the *ceiling* list — the largest reachable class in the corpus | 6.5 |
| `structure` evidence is safe for any placement finding | correct for layout; **wrong** for anything claiming how the same content is *set*. A block boundary vs a line ending is presentation | 15.3 |
| A directive's own name and properties are evidence about the source | `align center Francis Goya in Moscow` appears in no document, so every spurious directive read as unattested — and every *missing* one as reference editorializing | 11.2 |
| Source attestation can adjudicate hyphenation | the source contains the hyphen either way — *that is the artifact*. The class reported "the reference is right" 24 times out of 24 on evidence that says nothing | 13.3 |
| A pairwise "same row?" test can be handed to `Array.sort` | not transitive → implementation-defined permutation; it manufactured a finding where both ranks were **equal** | 7.6 |
| Textless blocks (`---`) can be paired ordinally | one extra rule near the top shifted every rule after it; on `news`, 26 of 32 order findings *were the rules*. Pair by **anchors** | 9.3 |
| An instrument's own key may fold differently from the rest of the instrument | `homeKey` split on hyphens while `similarityTokens` joined them → a class asserting content loss for text one function over could see | 14.3 |
| `paragraph.missing` reports missing paragraphs | all ten had their text in the produced document. A class reporting content loss where none exists outranked every real class | 14.1 |
| `conservation.text.recall` is a content-loss measure | it is built on word shingles, so a legitimate block split breaks every straddling shingle. 45.3 % recall with **zero** words, links or images missing | 16.2 |

## 3. Standing method traps

- **A pre-filter is part of the rule.** Widening `dehyphenateText`'s pattern while
  `dehyphenateDocument`'s gate stayed narrow produced a null result that looked like the rule being
  wrong. Two hours; one instrumented run would have found it in ten minutes. (§13.4)
- **A shared evidence set is only shared where it is recorded.** `ctx.subordinated` covers element
  children, not inline runs, so two consumers saw nothing on the one page the rule was for. Check what
  *populates* a set before keying a second rule on it. (§14.3)
- **A symmetry argument is not evidence — grep the contracts first.** "This question is answered by
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
