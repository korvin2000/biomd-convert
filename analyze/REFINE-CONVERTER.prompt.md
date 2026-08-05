<binding>
`CLAUDE.md` at the repository root is the project constitution: ground-truth precedence, the seven
invariants, the L0–L5 evaluation ladder with its cadence, the defect ledger and triage rules, rule-contract
requirements for generalization, and the rules-vs-hooks policy. It is loaded automatically and it is binding.
Read it before acting. This document is the campaign brief and does not repeat it.
</binding>

<mission>
You are the maintainer of `biomd-convert`. This is late-stage refinement: the coarse defects are gone, and
what remains is decided by differences a scalar metric cannot see. Operate autonomously and empirically —
hypothesize, localize, measure, keep what survives, record what died.

Your product is two things, both deliverables:
1. a rule system that **generalizes** to the ~987 unconverted pages and to any structurally similar corpus;
2. an evaluation apparatus that **localizes** defects precisely enough to act on.

The thirteen reference pairs are evidence, never the target. A change that fixes `segovia1.htm` and teaches
nothing transferable is a defect even when a number improves.
</mission>

<latitude>
You have wide architectural freedom and are expected to use it. Nothing is off limits merely because it is
large:

- introduce or replace an intermediate representation, add or delete pipeline passes, restructure module
  boundaries, change the AST, rewrite a detector family from scratch;
- build substantial new tooling — the structural differ (L2), the diagnostic renderer (L3) and the judge
  pipeline (L4) are expected to be *built*, not merely used; likewise mutation generators, shape catalogs,
  scoring sub-reports, harness hooks;
- add synthetic derived fixtures, clearly marked and excluded from reference scoring, to pin a shape;
- challenge the metric, the guides, the assessment documents, `CLAUDE.md` or this brief when you have
  evidence. Say so explicitly, then act.

Creativity is expected in hypothesis generation, mechanism design and instrument design. Rigour is required
in measurement and reporting. Do not trade the second for the first. Where you would normally ask permission
for ordinary refactoring inside this repo, proceed and report instead.
</latitude>

<phases>
**Phase 1 — instruments.** Bootstrap, reproduce the L1 baseline, then build and calibrate L2, then L3.
No rule changes in this phase: late-stage work without localization is guesswork, and a mis-aligning differ
produces consistently wrong findings that poison every later iteration invisibly.
Advance only when: L2 localizes every defect `analyze/analyze.md` already names, and emits no finding
without a node path; and L3 given the same file twice renders byte-identical output.

**Phase 2 — grind.** One defect class per iteration through `<loop>`, suitable for `/loop`. Build and
calibrate L4 in the first iteration of this phase, against the pages whose defects the human record names;
report its agreement rate before relying on it.
</phases>

<open_items>
Current state per `CONVERTER-PROGRESS.md` §5. Re-derive rather than accept — and note that several of these
are invisible to L1 by construction, so L2/L3/L4 are what adjudicate them.

Deterministically reachable:
- **catalog row-pattern segmentation** in `layoutFrom()` — 114 of 127 missing directives, mostly `goya2`,
  whose reference emits one `columns` pair per album (label | cover) and one per track range, split by `---`,
  while the converter still emits one persistent lane per physical column;
- **table continuation-row merge** in `data-table.ts` — `tarrega`'s "Ноты" row belongs in the fourth column
  of the work above it; the machinery exists, the merge predicate is missing;
- **outline recovery** still short of the source-backed heading subset.

Hook territory: empty table headers (12 of 14 validation errors; `table.records` already resolves all 12);
outline invention for a page that has none; copyediting (« », en-dashes, `(1913-42)` → `(1913–1942)`);
wrap-artifact de-hyphenation.

Treat this list as a starting hypothesis set, not as the work plan. The L2 roll-up decides the work plan.
</open_items>

<seeded_findings>
Verified live before this brief was written, by exactly the method it prescribes. Use them as **calibration
cases**: L2 and L3 must be able to find and localize these on their own. An instrument that cannot reproduce
them is not yet trustworthy.

**1. `-webkit-center` under-detection (a live defect, unfixed on purpose).**
Reproduce: start the `fixtures` server, open `http://localhost:8123/pavlov_azancheev.htm`, and read
`getComputedStyle(el).textAlign` across `p`, `div`, `td`. Result: `align="center"` sits on `p.t8` (17×),
`p.t` (16×), `p.t1`, `p.st`, `p.lt` — all computing to `justify`; only `p.t3` (3×) is truly centred, which is
PROGRESS §3.1 reproduced. Beyond that finding: Chromium returns **`-webkit-center`** for nodes centred by an
ancestor's `align` attribute (seen on unclassed `p`/`div` and on `div.advsp`). `prominence.ts:132` and
`structure.ts:1809` accept that value; **`prominence.ts:138` and `structure.ts:1437` compare against
`"center"` only** and therefore under-detect. It was left unfixed so that it is measured, not assumed: run it
through `<loop>` like any other class, and check whether a shared `isCenteredValue()` predicate is the right
shape rather than a third ad-hoc comparison.

**2. No asset tree.** Both HTML directories hold `.htm` files only; every referenced image, PDF and MP3 404s.
Rendered pages show broken images by construction. Never triage that as a conversion defect.
</seeded_findings>

<harness>
`CLAUDE.md` already exists. `.claude/launch.json` provides two verified static servers —
`fixtures` (port 8123, over `biomd-convert/fixtures/html`) and `rendered` (port 8124, over `analyze/rendered`,
which you create when you build L3) — backed by `.claude/serve-static.mjs`, a dependency-free Node server:
`npx http-server` cannot start in a sandboxed session, and a diagnostic that needs a download is not a
diagnostic. `preview_start` with the config name, then `navigate`.

**Bootstrap, first turn:** load deferred tools in a *single* `ToolSearch` —
`select:TaskCreate,TaskUpdate,TaskList,TaskGet,EnterPlanMode,ExitPlanMode,Monitor,EnterWorktree,ExitWorktree,WebSearch,WebFetch`.
Seed memory (`C:\Users\TavrovsA\.claude\projects\C--work-ai-claude-project\memory\`, indexed in `MEMORY.md`;
currently empty) with what only *you* will learn: the reproduced baseline, instrument calibration results,
killed hypotheses, confirmed reference ceilings. Do not duplicate `CLAUDE.md` there. Allowlist your
read-only commands in `.claude/settings.json` so long autonomous stretches are not interrupted (the
`update-config` skill does this correctly; `fewer-permission-prompts` can derive the list); consider a
`PostToolUse` hook running `npm run typecheck` after edits under `src/**`.

**Goal state** (there is no `/goal` command in this installation; this is its equivalent): `TaskCreate` one
task per defect class you intend to close, `TaskUpdate` through `in_progress`/`completed`, `TaskList` to
re-orient after a context reset. Tasks are the working ledger, `analyze/defects.json` the precise state,
`CONVERTER-PROGRESS.md` the durable record. Keep all three true.

**Divergent work parallel, convergent decisions serial:**
- `Explore` subagents for read-only fan-out — several documents adjudicated concurrently, findings only.
  Launch them in one message so they run in parallel.
- `Plan` subagent when a mechanism needs an architect's read before you commit.
- **Competing implementations in `isolation: "worktree"` subagents.** When two hypotheses both survive
  falsification, build both in isolated worktrees, adjudicate both with L2/L3, keep the winner, discard the
  loser without argument. The strongest lever available for hard classes — use it deliberately.
- All edits to the main tree and all measurement runs stay serialized in the main thread. Parallel
  measurement is meaningless measurement.

**Long-running work:** run `bench/run.sh`, `corpus run`, Playwright measurement and L4 batches with
`run_in_background: true` and keep adjudicating while they execute; you are re-invoked on exit. Use `Monitor`
to wait on a condition rather than polling. Never `sleep` in the foreground.

**Under `/loop`:** one complete iteration per wake — adjudicate, diagnose, change, re-adjudicate, record —
then `ScheduleWakeup` with the same prompt; long fallback delay (1200 s+) when a background run is the real
wake signal; `ScheduleWakeup{stop:true}` the moment the stop condition is met. Never end an iteration with an
unadjudicated change in the tree.

**Other leverage:** `EnterPlanMode` / `ExitPlanMode` before a large restructuring;
`mcp__ccd_session__spawn_task` for real defects found outside the current class, so they neither derail the
iteration nor get lost; `mark_chapter` at phase boundaries; `/simplify` on the diff once a mechanism is
proven; `Artifact` with the `dataviz` skill when the defect ledger or a gallery of L3 screenshots across 13
documents reads better as a page than as a table; `PushNotification` only when genuinely blocked on a
decision only the user can make.
</harness>

<brainstorm>
Run this divergence gate on every defect class before writing code. Its purpose is to stop you implementing
the first mechanism that comes to mind, which in this project has been wrong more often than right.

1. **Diverge — at least three mechanistically different hypotheses, not three variants of one.** Three are
   mandatory every round, because each has already been the truth here:
   *(a) the evidence is present but read wrongly* — PROGRESS §3.1: `align` preferred over computed style,
   `flushInline()` inspecting direct children only, `collapseAdjacentText()` deleting the break that
   mattered; four of the largest wins in this project were misreadings, not missing features;
   *(b) the reference is what is wrong* — PROGRESS §3.2: unreachable invented headings and copyedited prose;
   *(c) my own instrument is what is wrong* — PROGRESS §3.3: eval scoring stale output. With L2–L4 in play,
   a false finding from your own differ, renderer or judge is a first-class hypothesis.
   For anchoring-free divergence, generate hypotheses in parallel `Explore` subagents that cannot see each
   other's output, then merge.
2. **Pre-register.** Before testing, write for each hypothesis: the cheapest observation that would
   *falsify* it, and the defect instances it should close. Written predictions make a wrong hypothesis cheap;
   unwritten ones make it invisible.
3. **Test in order of falsification cost, not plausibility.** A five-minute `getComputedStyle` probe that
   kills a hypothesis outranks an hour implementing the likeliest one.
4. **Converge.** One survivor: implement it. Two: worktree subagents, adjudicate, keep the winner. Zero: the
   class is misdiagnosed — re-triage and say so.
5. **Record the corpses** in memory and `CONVERTER-PROGRESS.md`. Re-deriving dead ends across sessions is the
   main tax on work of this length.
</brainstorm>

<loop>
1. Refresh L0 + L1. Regenerate the L2 corpus roll-up. Reconcile `analyze/defects.json`.
2. Rank open `source-backed` classes by `instances × severity × generality`. Pick one. `TaskCreate` it with
   the instances you expect to close.
3. Gather evidence in order: reference output → produced output → the L2 edit script for that node path →
   source HTML → rendered geometry (L3) → the `analyze.md` entry for that page. Think hard here; this is
   where the iteration is won or lost.
4. Run the divergence gate. Pre-register predictions.
5. Write the rule contract and its tests first — invariant, recurrence, false friend, mutations — then make
   them pass.
6. Re-adjudicate: L0, L1 as tripwire, L2 corpus-wide, L3 on every document touched. One conceptual change per
   adjudication. A change that closes instances in one document while opening them elsewhere is unfinished:
   explain or revert. Then measure the rotating holdout and report the gap.
7. Keep only green: L0 clean, L1 not regressed, net defect instances down, no unaccounted new class, mutation
   suite passing. `/simplify` the diff. `TaskUpdate` done.
8. Batch L4 over the iteration's documents; triage its findings into the ledger as new hypotheses.
9. Record what you *learned*, not what you changed, then take the next class.
</loop>

<reporting>
One compact block per iteration: defect class targeted → hypotheses and which observation killed each →
change → adjudication (instances closed/opened per class, L1 delta, holdout, L3 verdict on touched documents,
L0 status) → kept or reverted, and why. Include the rule contract for anything new. Classes and instances,
never averages. Conventions in `CLAUDE.md` §8 apply.
</reporting>

<stop>
Stop when all of these hold:
- no open `source-backed` defect class above minor severity remains that does not require a hook whose
  acceptance check you cannot define;
- L0 clean, L1 not regressed, holdout gap small and explained, mutation suite passing;
- L3 finds no structural or ordering difference on any of the 13, and judges the produced layout equal to or
  better than the source on each;
- L4, calibrated, opens no new source-backed class across two consecutive rounds;
- every `analyze.md` complaint is closed or classified unreachable with its reason.

Then report: the ceiling and its cause; what would be needed to break it; which of your rules you expect to
hold on the other ~987 pages and which you expect to break first; and which of your instruments you trust
least, with the evidence for that mistrust.
</stop>

<first_turn>
Bootstrap the harness, reproduce the L1 baseline, read the ground-truth sources in precedence order, then
begin Phase 1. Present: the L1 reconciliation, your plan for L2 including the alignment algorithm you chose
and why, your holdout split, and the calibration cases from `analyze.md` you will use to prove L2 works.
Proceed without waiting for approval unless an invariant is in tension or a restructuring is large enough to
warrant plan mode.
</first_turn>
