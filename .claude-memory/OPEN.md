# OPEN — live state, the queue, and the questions

**The volatile file.** Everything here changes every iteration; update it after each accepted change
and do not let it accumulate history — history belongs in `CONVERTER-PROGRESS.md`.

Last touched **2026-08-08**. Facts marked *measured* were taken this session; facts marked *recorded*
are quoted from PROGRESS and have **not** been re-measured since 2026-08-06.

---

## 1. Where we are, and the exact next step

The blind phase is closed (PROGRESS §16–§18). The **9 new references have been placed** in
`fixtures/out/` (untracked, *measured*), the holdout is parked in `fixtures/html2/` + `fixtures/out2/`,
and `analyze/defects.json` on disk is still the **13-document** ledger (*measured*: 314 findings /
188 converter-defect / 13 `perDocument` entries). Nothing has been re-baselined yet.

**Step 1 — baseline before attribution.** Reference edits move every rung with no code change. Build,
re-run all four rungs over the 22-document corpus, record the numbers, and only then attribute
anything. Confirm the instruments report **22** documents, not 23.

```bash
cd biomd-convert && npm run build && sh bench/run.sh
```

**Step 2 — rank**, keeping the 13 and the 9 visible separately. A class in both sets is a *rule*
finding and outranks a class only in the new set, which is a *generalization* finding.

**Step 3 — take `new_lagq2` first, out of rank order** (§2.1 below). It settles a standing question no
other document can.

---

## 2. What the new references settled — *measured 2026-08-08*

### 2.1 `new_lagq2`: PROGRESS §19.4 is answered, and the answer is **yes**

The reference gives the seven album records **6 `::: columns` / 12 `::: column`**, cover in lane 1 and
tracklist in lane 2, separated by `---` (7 rules). The converter emits **zero** — the region is
flattened entirely.

So the pre-registered consequence applies: **the contract and the CATALOG gate have to be revisited
together.**

- `src/convert-core/recovery.test.ts` → *"leaves a DATA verdict on the flow path — the false friend"*
  forbids the only mechanism that would produce them, on the stated rationale that *losing a table to
  lanes is the defect this reconsideration could otherwise introduce*. Reconsidering DATA→lanes was
  implemented and reverted once: L1 93.8 → 93.6, `borislova`/`goya2`/`williams2` all changed (§18.3).
- `src/convert-core/classify.ts`'s tier-1 CATALOG gate wants `ratio` 0.45–0.55 **and**
  `imageDensity > 0.3`. *Recorded* (PROGRESS §19.4, not re-measured): `goya2` 35×2 / 0.50 / 0.16 →
  CATALOG · `new_lendle2` 10×2 / 0.50 / 0.33 → CATALOG · **`new_lagq2` 7×2 / 0.37 / 0.46 → DATA
  0.50**. A 150 px cover beside a tracklist
  has no reason to be 50/50. Widening it alone reaches `barrios` (0.67) and `news_2007` (0.27), both
  regression documents — so widen it *with* the routing decision, never on its own.
- `new_lendle2` is the control: same archetype, already CATALOG, already laned.

### 2.2 `new_karta`: PROGRESS §17.5 Q1 is answered — **tables with supplied labels**

Variable-arity media records become **GFM tables**, and the columns the source does not name are
headed with a link glyph:

```
| Композиция | Формат | &#128279; | &#128279; |
```

Two consequences. First, `dominantLabel`/`tableFromPlan` needing a recurring label across three body
rows is the blocker, and the reference shows what to supply instead. Second — the memory note that
*"abstracting guessed table headers and replacing a bare URL label with a link glyph are proposals in
`analyze.md`, not reference-attested"* is **now false**: `&#128279;` occurs **16 times across 7
references** (`tarrega` 5, `barrios` 3, `new_dyens` 3, `new_karta` 2, `kiselev` 2, `borislova` 1) and
the `analyze.md` requests are attested. This changes the L5 verdict on those two complaints from
*proposal* to *work*.

### 2.3 `new_rechin4`: PROGRESS §17.5 Q3 points at under-segmentation

The reference is 78 lines with **9 `::: lead`** and 4 `##`; the converter produced 11 paragraphs for a
33 KB source and two `line-too-long` errors (4156 and 2850 chars against a 2200 ceiling). The two
over-long lines are under-segmentation, not faithful long paragraphs. `::: lead` used nine times in
one document is an idiom no other reference uses — check `BioMD-Reference.md` §3 (`lead` "MAY
represent … a distinctly styled introductory source region") before assuming it is a defect.

### 2.4 New class: **mini-image → glyph is specified, attested, and unimplemented**

`mini_images_to_md_guide.md` defines the policy and a 29-entry known-icon map. *Measured*: the
references use numeric character references in **10 of 22** documents — `&#128279;` ×16 (link),
`&#9664;` ×2 (previous), `&#9658;` ×1, `&#128904;` ×1, `&#128578;` ×1 — and **`src/` contains no icon
map at all** (`media.ts`'s decorative filter drops such images on rendered geometry instead, and
`bench/out/` contains zero `&#`).

Building it must respect `CLAUDE.md` §3.5: the map is a **documented, language-tagged data file**, the
detector consults it and **degrades gracefully when the list does not match**, and classification
needs ≥2 independent UI signals with no strong content-image signal conflicting. Note one divergence
to settle: the guide maps *next* to `&#9654;` (U+25B6 ▶) while `new_bach` uses `&#9658;` (U+25BA ►).

Also unreferenced anywhere until now: this guide is not named in `CLAUDE.md` §2's ground-truth list.
It is now named in the skill's sources table.

---

## 3. Questions for the user — batched, none blocking

### 3.1 A wrapped masthead: one `#` or two? *(affects a reusable rule and ≥2 documents)*

The new references disagree with the old idiom **and with each other**:

| | reference writes |
|---|---|
| `new_blackmore` | `# Ричи Блэкмор Ritchie Blackmore & Blackmore's Night` — one heading, joined |
| `segovia1`, `goya2`, `borislova`, `williams2`, `new_kolpakov` | one `#`, sometimes inside `::: align` |
| **`new_bach`**, **`new_lagq2`** | `::: align` containing **two consecutive `# ` lines** (`# Иоганн Себастьян` / `# Бах`) |

`enforceSingleTitle()` (PROGRESS §4.4) enforces exactly one `#` and no level skips, and `h1-count` is
a validation rule — so the two-`#` form is currently unreachable by construction.
`BioMD-Reference.md` §6 permits it ("exactly one `#` is a corpus convention, not a syntax
requirement"). **Which reading is authoritative:** keep one `#` per page and join a wrapped title, or
relax `enforceSingleTitle` so a visually two-line masthead can stay two headings?

### 3.2 `::: frame` inside `::: align` — reference vs `BioMD-Reference.md` §2

`new_karta` nests a `::: frame` inside an `::: align position: center`. §2's allowed-nesting list is
`align → Markdown + leaf media` (leaf = `image`, `images`, `document`), and "arbitrary deeper nesting"
is forbidden. **To verify by running `biomd validate` against the reference before treating it as
either a defect or a licence** — if the validator accepts it the list is under-specified, and if it
rejects it the reference has an invalid construct that no rule may reproduce.

### 3.3 Not a question — recorded so nobody chases it

`***` appears as a thematic break in `new_bach`, `news` and `tarrega` (once each) alongside `---`.
Both parse to the same node. This is an invisible Markdown difference and an **acceptable
alternative**; do not open a class for it.

---

## 4. Open defect classes — *recorded* PROGRESS §15.4, 13-document ledger, **re-rank before using**

Per document, converter defects: `news` 49 · `goya2` 43 · `kiselev` 17 · `borislova` 16 · `segovia` 14
· `pavlov_azancheev` 10 · `news_2007` 9 · `authors` 7 · `segovia1` 7 · `jovicic` 6 · `tarrega` 6 ·
`williams2` 4 · **`barrios` 0**.

| class | why it is still open |
|---|---|
| `image.src.value` (19, all `goya2`) | one path-resolution rule; mechanical, single-document |
| `image.size.value` (21, 4 docs) | a threshold in `media.ts`; sweep it, do not pick it |
| alignment residue — `align.spurious`, `retyped.paragraph-to-align`, `retyped.align-to-paragraph` (16, 5 docs) | the region, menu and frame work has settled; re-read them together |
| `retyped.paragraph-to-list` | real, and **blocked on a hook design**: the discriminator does not exist in the shape (§15.2). Candidate is an `ITEM` kind for `text.segment`, whose acceptance check must be named first — may change block *type* only, never text, never line count, never fire where §3.5's evidence says verse |
| `borislova`/`jovicic` want a quote the recurrence gate declines | `MIN_SUBORDINATED_BLOCKS` is 2 and each has 1. Ceiling until a second signal exists |
| `frame`'s `title:` property unused | `news` puts `ПОЗДРАВЛЯЕМ` in it; one instance corpus-wide, recorded not acted on |

## 5. Instrument debt — what to distrust, in order

1. **The 0.5–0.95 `ambiguous` word-coverage corridor is set, not calibrated** — ~76 findings, and the
   single largest piece of unexamined instrument behaviour. So is the **0.65** reconciliation constant
   behind the `containment` classes; the class split has never been measured at 0.55 or 0.75.
2. **L3's renderer is a model of the target, not the target.** Where the real renderer differs in a
   way `read()` does not document, L3 is wrong *in the same direction on both sides* — the one error
   class a comparison cannot reveal.
3. **L3 pairs by rendered text, deliberately independent of L2.** A block the migrator rewrote past
   0.65 similarity is unpaired, and unpaired blocks yield no L3 finding. Presence stays L2's question.
4. **One viewport (1024 px).** Nothing yet asserts a finding is stable across widths.
5. **L4 is not built.** The judge pipeline in `CLAUDE.md` §4 — side-blind, schema-validated,
   `claude-opus-5` via the `deep` slot, calibrated before trusted, advisory only — does not exist yet.
   Do not report an L4 number.
