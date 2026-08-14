/**
 * The conversion pipeline.
 *
 * Stage order is load-bearing in two places and both are easy to get subtly
 * wrong:
 *
 *   1. Quarantine runs *before* parsing, and preserves offsets, so provenance
 *      spans stay valid.
 *   2. Measurement runs *before* the head is dropped and before normalization,
 *      because those discard the very evidence being measured.
 *
 * Every stage is deterministic *first*. Two points escalate — an ambiguous table
 * class, and column labels for a table whose source had no header — and both go
 * through `DecisionResolver`, which defaults to one that never escalates. A run
 * with no gateway configured therefore produces exactly the output it always
 * did, and must still be usable.
 */
import {
  type Measurer,
  NullMeasurer,
  decodeHtml,
  dropHead,
  harvestHead,
  materializeAllGrids,
  normalize,
  parseHtml,
  quarantineServerMarkup,
  sanitizeS1,
  textOf,
  walkElements,
} from "../ladom/index.js";
import type { HeadFacts } from "../ladom/sanitize.js";
import type { TableGrid } from "../ladom/grid.js";
import {
  DEFAULT_PROFILE,
  type Diagnostic,
  type TargetProfile,
  serialize,
  validate,
  lintText,
  type ComplexityReport,
} from "../biomd-ast/index.js";
import { ABC_LINK_PROFILE, type LinkProfile, rewriteTarget } from "./links.js";
import { Ledger, type LedgerEntry } from "./ledger.js";
import { Lexicon } from "./lexicon.js";
import { removeBoilerplate } from "./boilerplate.js";
import { type Classification, classifyTable, picturePairedRows } from "./classify.js";
import { type CorpusProfile, frequencyForDocument } from "./corpus.js";
import { planDataTable } from "./data-table.js";
import { recoverHeadings, residualLabelCandidates } from "./headings.js";
import { writeAdvice } from "./advice.js";
import { neighbourhoodOf, unknownIconCandidates } from "./escalation.js";
import { type DecisionResolver, NULL_RESOLVER, type ResolverStats, type ReviewFinding } from "./resolver.js";
import { type LayoutFidelity, type TableOutcome, enforceSingleTitle, recoverStructure } from "./structure.js";
import { checkConservation, type ConservationReport } from "./conservation.js";
import {
  type DehyphenateOptions,
  type HyphenationOracle,
  NULL_ORACLE,
  dehyphenateDocument,
} from "./dehyphenate.js";
import type { TextOperation } from "./text-ops.js";

export interface ConvertOptions {
  /** Source file name, for provenance. */
  sourceName?: string;
  profile?: TargetProfile;
  links?: LinkProfile;
  layoutFidelity?: LayoutFidelity;
  measurer?: Measurer;
  /** Corpus lexicon; an empty one still works, just with weaker de-hyphenation. */
  lexicon?: Lexicon;
  oracle?: HyphenationOracle;
  /** Optional external word dictionary; paired with the hyphenation oracle. */
  dictionary?: (word: string) => boolean;
  lang?: string;
  /** Directory to resolve relative assets from during measurement. */
  assetRoot?: string;
  /** Classification overrides, e.g. resolved by a hook. */
  classifications?: Map<string, Classification>;
  /**
   * The Stage 0 corpus profile.
   *
   * Preferred over `corpusFrequency`: the frequency map has to be keyed by node
   * id, and node ids are only stable within one traversal of one tree. Computing
   * it from the profile *inside* the pipeline is what makes chrome detection
   * actually match — a map built by the caller was keyed against a differently
   * sanitized parse and missed every entry.
   */
  corpusProfile?: CorpusProfile;
  /** Pre-computed fingerprint frequencies. Superseded by `corpusProfile`. */
  corpusFrequency?: Map<string, number>;
  /**
   * Recover `##` section headings from typography as well as the title.
   * Default true; turn it off for a corpus whose section labels are unreliable.
   */
  recoverSections?: boolean;
  /**
   * Consulted where the deterministic path abstains. Defaults to one that never
   * escalates, so a run with no gateway behaves exactly as it always did.
   */
  resolver?: DecisionResolver;
  /**
   * Told what the conversion is doing, as it does it.
   *
   * A thousand-file run that prints one line per file is a run whose operator
   * cannot tell a slow page from a stuck one, cannot see which rule decided
   * what, and cannot see which stage the escalations are being spent in. Every
   * event is a fact that already existed; nothing is computed for the sake of
   * reporting it.
   */
  onProgress?: (event: ConvertEvent) => void;
}

/**
 * Something worth telling the operator about, while it happens.
 *
 * ## Why `changes` is not optional decoration
 *
 * The first version of this channel reported *that* a stage ran and *that* an
 * escalation happened, with a count. That is enough to watch a run and useless
 * for the question an operator actually has, which is **what did it do to my
 * document?** A hook that rewrote a word, cancelled a deletion or renamed a
 * column showed up as `+ text.hyphenation  1 resolved` — indistinguishable from
 * a hook that had done something correct. Every event that changes the document
 * therefore carries the change itself, as `before → after`, and the printer
 * shows it. A stage carries the same for its own decisions, so `-v` is a
 * readable account of the deterministic passes and not only of the model.
 */
export type ConvertEvent =
  | {
      type: "stage";
      stage: string;
      detail: string;
      elapsedMs: number;
      /** What this pass decided, one line each, already clipped for a terminal. */
      changes?: readonly string[];
    }
  | {
      type: "escalation";
      hook: string;
      item: string;
      /** `resolved` applied it; `declined` got no answer; `refused` failed the acceptance check. */
      outcome: "asked" | "resolved" | "declined" | "refused";
      detail?: string;
      /** What the reply did to the document. Present only on `resolved`. */
      before?: string;
      after?: string;
      /** Why the model said so, when it said. */
      reason?: string;
    }
  | { type: "note"; text: string };

export interface ConvertResult {
  /** The emitted document. */
  markdown: string;
  /** Structurally repaired HTML — a retained deliverable of step 1. */
  repairedHtml: string;
  /** Content HTML after behaviour and chrome removal. */
  cleanHtml: string;
  head: HeadFacts;
  encoding: ReturnType<typeof decodeHtml>["decision"];
  ledger: LedgerEntry[];
  textOperations: TextOperation[];
  conservation: ConservationReport;
  diagnostics: Diagnostic[];
  complexity: ComplexityReport;
  classifications: Array<{ tableId: string; classification: Classification }>;
  /**
   * What became of every source table.
   *
   * Text recall cannot see the difference between a table and the same words
   * spilled into paragraphs, so structure needs its own audit: a region
   * classified DATA that emitted no Markdown table has lost its rows and
   * columns, silently, at 100% recall.
   */
  tables: TableOutcome[];
  /** What the escalation boundary did, so autonomy is measurable per file. */
  resolverStats: ResolverStats;
  /**
   * Places a reading review flagged. Always empty without a resolver.
   *
   * Advisory by construction: these never changed the output, so a run with them
   * and a run without them produce the same bytes. What they change is what the
   * operator is told to look at.
   */
  reviewFindings: ReviewFinding[];
  /**
   * What chrome removal took, so the one pass the conservation gate cannot audit
   * is still visible. The gate captures its inventory *after* this pass, which
   * is why a misfiring profile once deleted a third of a document at a reported
   * text recall of 100 %.
   */
  chrome: { documentText: number; removedText: number; structures: number };
  warnings: string[];
  /** Terminal state, per the plan's completion-state ladder. */
  state:
    | "decoded"
    | "structurally-repaired"
    | "sanitized-content"
    | "conversion-review-required"
    | "biomd-structurally-valid"
    | "conversion-complete";
  measured: boolean;
}

/**
 * How many standalone lines one page may spend an escalation on.
 *
 * A **call** bound, not a payload one: the role of a line depends on what
 * surrounds it, so there is one request per line. A page with forty short
 * centred lines is a menu, and asking forty times to be told forty times that it
 * is a menu is not a measurement, it is a bill.
 *
 * **Measured, so the bound is not a guess:** it binds on three of the
 * twenty-eight reference sources (`news`, `segovia1`, `xtra_karta5`), all three
 * of which carry a menu or an index — which is the shape the bound is for. It is
 * still a budget and not a discriminator: a page whose seventh ambiguous label
 * is the real one keeps it as a review item, exactly as it would have been
 * without any of this.
 */
const MAX_BLOCK_ROLE_QUESTIONS = 6;

/** One line of a document, clipped to something a terminal can show. */
function brief(text: string, limit = 72): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export async function convert(bytes: Uint8Array | Buffer, options: ConvertOptions = {}): Promise<ConvertResult> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const links = options.links ?? ABC_LINK_PROFILE;
  const measurer = options.measurer ?? new NullMeasurer();
  const lexicon = options.lexicon ?? new Lexicon();
  const warnings: string[] = [];
  const ledger = new Ledger();
  const resolver = options.resolver ?? NULL_RESOLVER;
  const lang = options.lang ?? "ru";
  const escalations: Pick<ResolverStats, "consulted" | "resolved" | "byHook"> = {
    consulted: 0,
    resolved: 0,
    byHook: {},
  };

  const started = Date.now();
  const emit = options.onProgress ?? ((): void => undefined);
  const stage = (name: string, detail: string, changes?: readonly string[]): void => {
    emit({
      type: "stage",
      stage: name,
      detail,
      elapsedMs: Date.now() - started,
      ...(changes && changes.length > 0 ? { changes } : {}),
    });
  };
  /**
   * Record one escalation, in the ledger and on the progress channel at once.
   *
   * Both or neither: a decision applied to the document without a ledger entry
   * is exactly the unaccountable second author this design exists to prevent,
   * and a ledger entry nobody sees during a thousand-file run is an audit
   * nobody reads.
   *
   * `before`/`after` are required in spirit for `resolved` and cannot be
   * required by the type, because two of the surviving hooks resolve into a
   * plan rather than over an existing value. Where there is a prior value, pass
   * it: the printer's whole job is to show what changed.
   */
  const escalated = (
    outcome: "asked" | "resolved" | "declined" | "refused",
    hook: string,
    item: string,
    detail?: string,
    change?: { before?: string; after?: string; reason?: string },
  ): void => {
    if (outcome === "asked") escalations.consulted += 1;
    if (outcome === "resolved") escalations.resolved += 1;
    emit({
      type: "escalation",
      hook,
      item,
      outcome,
      ...(detail ? { detail } : {}),
      ...(change?.before !== undefined ? { before: change.before } : {}),
      ...(change?.after !== undefined ? { after: change.after } : {}),
      ...(change?.reason ? { reason: change.reason } : {}),
    });
  };

  /**
   * Count an open question whether or not anything can answer it.
   *
   * `consulted` is documented as the answer to *"how much would turning the LLM
   * on actually do?"*, and that answer is only useful before one is configured —
   * which means it has to be counted by the pipeline, from the residual the
   * rules actually left, and not by the resolver. Guarding the count behind
   * `resolver.x` would make every deterministic run report the escalation
   * surface as the size of the part of it that existed before this catalogue.
   *
   * The progress channel is separate and stays honest the other way: a run with
   * no resolver prints no escalation lines, because nothing was asked.
   */
  const openQuestions = (hook: string, item: string, count: number, answerable: boolean, detail?: string): void => {
    if (count <= 0) return;
    escalations.consulted += count;
    const bucket = (escalations.byHook[hook] ??= { consulted: 0, calls: 0, cacheHits: 0, unresolved: 0 });
    bucket.consulted += count;
    if (answerable) emit({ type: "escalation", hook, item, outcome: "asked", ...(detail ? { detail } : {}) });
  };

  // ---- Stage 1: decode ---------------------------------------------------
  const decoded = decodeHtml(bytes);
  warnings.push(...decoded.decision.warnings);
  stage("decode", `${decoded.decision.codec} via ${decoded.decision.source}, ${bytes.length} bytes`);

  // ---- Stage 2a: quarantine, then parse ----------------------------------
  const quarantined = quarantineServerMarkup(decoded.text);
  warnings.push(...quarantined.warnings);

  const doc = parseHtml(quarantined.text);
  warnings.push(...doc.warnings);
  const repairedHtml = doc.repairedHtml;

  // Head facts must be harvested before anything discards them.
  const head = harvestHead(doc.root);

  // ---- Stage 2b: S1, behaviour only, layout preserved --------------------
  const s1 = sanitizeS1(doc.root);
  warnings.push(...s1.warnings);
  for (const record of s1.removals) {
    ledger.record({
      id: record.id,
      terminal: { kind: "REMOVED", reason: record.reason },
      pass: "sanitize-s1",
      decidedBy: "rule",
      confidence: 1,
      ...(record.subsumedBy ? { note: `subsumed by ${record.subsumedBy}` } : {}),
    });
  }

  // ---- Stage 3: measure --------------------------------------------------
  const measurement = await measurer.measure(repairedHtml, doc, {
    ...(options.assetRoot ? { assetRoot: options.assetRoot } : {}),
  });
  warnings.push(...measurement.warnings);

  // ---- Stage 2b (second half) + Stage 4: drop head, normalize ------------
  for (const record of dropHead(doc.root)) {
    ledger.record({
      id: record.id,
      terminal: { kind: "REMOVED", reason: record.reason },
      pass: "drop-head",
      decidedBy: "rule",
      confidence: 1,
    });
  }

  // ---- Stage 5: boilerplate removal --------------------------------------
  // Before normalization, while the chrome is still a table rather than a
  // paragraph, and after measurement, so nothing that was measured has moved.
  //
  // **No escalation is consulted here, and the one that was is deleted.** It
  // read the removals this pass was sure of and could cancel them, on the
  // argument that recurrence cannot distinguish a standing section from a
  // footer. What it actually did was put the site's masthead — the dictionary
  // title that recurs on every page — back onto pages the deterministic profile
  // had correctly stripped it from, because a masthead reads exactly like
  // content when you show a model four hundred characters of it. The pass's own
  // evidence, recurrence across a thousand pages, is *better* evidence than a
  // reading of one page, and a hook that overrides the stronger evidence with
  // the weaker one is not a safeguard. If chrome removal is wrong on a page, the
  // profile is what to fix.
  const boilerplate = removeBoilerplate(doc.root, options.corpusProfile ?? null);
  warnings.push(...boilerplate.warnings);
  stage(
    "chrome",
    `${boilerplate.removals.length} structure(s) removed, ${boilerplate.removedText} of ` +
      `${boilerplate.documentText} chars`,
    boilerplate.removals.slice(0, 8).map((r) => `− ${r.tag} ${brief(r.text)} (recurs on ${(r.frequency * 100).toFixed(0)}%)`),
  );
  for (const record of boilerplate.removals) {
    ledger.record({
      id: record.id,
      terminal: { kind: "REMOVED", reason: record.reason },
      pass: "boilerplate",
      decidedBy: "classifier",
      confidence: record.frequency,
    });
  }
  if (!options.corpusProfile) {
    warnings.push(
      "No corpus profile: site chrome cannot be identified from a single page and will be kept. " +
        "Run `biomd corpus scan` first.",
    );
  }

  // ---- Stage 10: text reconstruction -------------------------------------
  // Runs before normalization, because the evidence a wrap decision rests on is
  // the source newline after the hyphen, and collapsing whitespace destroys it.
  const dehyphenateOptions: DehyphenateOptions = {
    lexicon,
    oracle: options.oracle ?? NULL_ORACLE,
    lang: options.lang ?? "ru",
    dictionary: options.dictionary,
  };
  // **No escalation is consulted here either.** The deleted `text.hyphenation`
  // hook asked a model about the words the cascade left as review items and
  // applied every `JOIN` it received; `когда-то` came back joined and shipped as
  // `когдато`. A hyphen the cascade preserves is a hyphen the output keeps, and
  // the cascade's residual stays a review item — which is a visible, harmless,
  // correctable state, and silent text corruption is none of those.
  const dehyphenation = dehyphenateDocument(doc.root as never, dehyphenateOptions);
  const textOperations: TextOperation[] = dehyphenation.operations;
  for (const op of textOperations) {
    if (op.status !== "review") continue;
    ledger.record({
      id: op.id,
      terminal: { kind: "REVIEW", reason: op.note ?? "uncertain word join" },
      pass: "dehyphenate",
      decidedBy: "rule",
      confidence: op.confidence,
    });
  }
  stage(
    "text",
    `${textOperations.length} hyphen decision(s), ${textOperations.filter((o) => o.status === "review").length} unresolved`,
    // Every word the cascade joined, and every one it refused to. This is the
    // pass that was corrupting text, so it is the pass whose decisions an
    // operator most needs to be able to read back.
    textOperations
      .slice(0, 20)
      .map((op) => `${op.status === "review" ? "kept" : "join"}  ${op.before} → ${op.after}`),
  );

  const normalized = normalize(doc.root, { useGeometry: measurement.measured });
  warnings.push(...normalized.warnings);

  // ---- Stage 8: document outline ----------------------------------------
  // After normalization, because `<font size>` has to be folded onto the nodes
  // that carried it before prominence can be read off them.
  const headings = recoverHeadings(doc.root, {
    ...(options.recoverSections === false ? { sections: false } : {}),
  });
  for (const heading of headings) {
    ledger.record({
      id: heading.id,
      terminal: { kind: "EMITTED", to: `heading-${heading.depth}` },
      pass: "headings",
      decidedBy: "rule",
      confidence: Math.min(1, heading.score / 2),
      note: heading.reason,
    });
  }
  if (headings.length === 0) {
    warnings.push("No heading could be recovered from typography; the document will have no title.");
  }

  // The outline rule has marked what it was sure of. What it weighed and let go
  // is a band of short lines where a section label, a caption, a menu item, a
  // signature and a date are one measurement — and one of them really is a
  // heading. `БЛАГОДАРНОСТИ:` set slightly apart from its prose is the case
  // this exists for: the rule is right to decline, and declining leaves a real
  // heading flattened.
  //
  // Only `SECTION_LABEL` is applied, and it reaches the tree through the same
  // attribute the rule writes, so nothing downstream learns an escalation
  // happened. Nothing the rule claimed can be reached: a node it marked is never
  // in the residual.
  {
    const askBlockRole = resolver.blockRole?.bind(resolver);
    const residual = residualLabelCandidates(doc.root, {
      ...(options.recoverSections === false ? { sections: false } : {}),
    }).slice(0, MAX_BLOCK_ROLE_QUESTIONS);
    openQuestions("text.block-role", options.sourceName ?? "?", residual.length, askBlockRole !== undefined);

    const openHeading = headings.at(-1);
    for (const candidate of residual) {
      if (!askBlockRole) break;
      const around = neighbourhoodOf(candidate.node);
      emit({
        type: "escalation",
        hook: "text.block-role",
        item: brief(candidate.text, 40),
        outcome: "asked",
        detail: candidate.typography,
      });
      const answer = await askBlockRole({
        id: candidate.node.id,
        line: candidate.text,
        before: around.before,
        after: around.after,
        typography: candidate.typography,
        ...(openHeading ? { openHeading: openHeading.text, openDepth: openHeading.depth } : {}),
        siblingLines: residual.filter((r) => r !== candidate).slice(0, 4).map((r) => r.text),
        ...(options.sourceName ? { sourceName: options.sourceName } : {}),
      });
      if (!answer) {
        escalated("declined", "text.block-role", brief(candidate.text, 40));
        continue;
      }

      // The acceptance check. A depth is required for a label and refused for
      // anything else; a label may not be deeper than one step below the
      // section that is open, because a heading two levels below its parent is
      // an outline the source cannot have stated. Everything else is recorded
      // and applied to nothing — the rule's answer, "not a heading", stands.
      const openDepth = openHeading?.depth ?? 1;
      const depth =
        answer.role === "SECTION_LABEL" &&
        answer.depth !== undefined &&
        answer.depth >= 2 &&
        answer.depth <= Math.min(3, openDepth + 1)
          ? answer.depth
          : undefined;
      if (depth === undefined) {
        escalated("refused", "text.block-role", brief(candidate.text, 40), `read as ${answer.role}; left as prose`);
        ledger.record({
          id: candidate.node.id,
          terminal: { kind: "REVIEW", reason: `escalation read this line as ${answer.role}: ${answer.reason}` },
          pass: "text.block-role",
          decidedBy: "llm:text.block-role",
          confidence: answer.confidence,
        });
        continue;
      }

      writeAdvice(candidate.node, { blockRole: answer.role, headingDepth: depth }, "text.block-role");
      escalated("resolved", "text.block-role", brief(candidate.text, 40), undefined, {
        before: "paragraph",
        after: `${"#".repeat(depth)} ${brief(candidate.text, 50)}`,
        reason: brief(answer.reason, 110),
      });
      ledger.record({
        id: candidate.node.id,
        terminal: { kind: "EMITTED", to: `heading-${depth}` },
        pass: "text.block-role",
        decidedBy: "llm:text.block-role",
        confidence: answer.confidence,
        note: answer.reason,
      });
    }
  }

  stage(
    "headings",
    `${headings.length} recovered from typography`,
    headings.map((h) => `h${h.depth}  ${brief(h.text)}  (${h.reason})`),
  );
  for (const record of normalized.records) {
    ledger.record({
      id: record.id,
      terminal:
        record.action === "remove"
          ? { kind: "REMOVED", reason: record.reason }
          : { kind: "MERGED_INTO", to: "parent" },
      pass: "normalize",
      decidedBy: "rule",
      confidence: 1,
      note: record.reason,
    });
  }

  // Source inventory, captured after chrome removal and before emission, so the
  // conservation gate compares like with like.
  const sourceText = textOf(doc.root);
  const sourceTargets: string[] = [];
  const sourceImages: string[] = [];
  for (const el of walkElements(doc.root)) {
    if (el.tag === "a") {
      const rewritten = rewriteTarget(el.attrs["href"] ?? "", links);
      if (rewritten.href !== "" && rewritten.kind !== "unsafe") sourceTargets.push(rewritten.href);
    }
    if (el.tag === "img") {
      const src = el.attrs["src"] ?? "";
      if (src !== "") sourceImages.push(src);
    }
  }

  const cleanHtml = doc.root.children.map((c) => htmlOf(c)).join("");

  // ---- Stage 7: classify tables ------------------------------------------
  const grids: TableGrid[] = materializeAllGrids(doc.root);
  for (const grid of grids) warnings.push(...grid.warnings);
  // Computed here, against the tree the grids came from, so ids line up.
  const corpusFrequency = options.corpusProfile
    ? frequencyForDocument(doc.root, options.corpusProfile)
    : options.corpusFrequency;

  // Page-level evidence, computed once: which grids are wholly picture-paired.
  // A one-row card cannot see that two of its siblings are the same shape, and
  // that is the recurrence its classification depends on.
  const picturePaired = new Set(grids.filter((g) => picturePairedRows(g) === 1).map((g) => g.id));

  const classifications: Array<{ tableId: string; classification: Classification }> = [];
  for (const grid of grids) {
    const override = options.classifications?.get(grid.id);
    const frequency = corpusFrequency?.get(grid.id);
    const page = { picturePairedPeers: picturePaired.size - (picturePaired.has(grid.id) ? 1 : 0) };
    let classification = override ?? classifyTable(grid, frequency, page);

    // Escalation point 1. An abstention is not a verdict, and flattening an
    // ambiguous region to prose is a decision with consequences — so ask,
    // rather than defaulting quietly.
    if (!override && classification.class === "UNKNOWN") {
      openQuestions("table.classify", grid.id, 1, resolver.canAnswer?.("table.classify") ?? false, brief(classification.reason));
      const resolved = await resolver.classifyTable({
        grid,
        deterministic: classification,
        ...(frequency !== undefined ? { corpusFrequency: frequency } : {}),
        ...(options.sourceName ? { sourceName: options.sourceName } : {}),
      });
      // A model verdict promoting an abstention straight to DATA is the one
      // upgrade that *fabricates* structure rather than describing it, so it
      // carries its own evidence bar. Asked "is this a data table?", a model
      // says yes to a dated news list and to a two-lane album catalog alike,
      // and the result is two invented headers over something that was never a
      // matrix. Measured against the reference conversions, the discriminator is
      // width: a record matrix the deterministic tiers missed has three or more
      // semantic columns, while "label plus paragraph" — the classic false
      // positive — has exactly two.
      const fabricating =
        resolved?.class === "DATA" && (resolved.confidence < 0.75 || !isWideEnoughForData(grid));
      if (resolved && !fabricating) {
        escalations.resolved += 1;
        classification = resolved;
        emit({
          type: "escalation",
          hook: "table.classify",
          item: grid.id,
          outcome: "resolved",
          before: "UNKNOWN",
          after: resolved.class,
          reason: brief(resolved.reason, 120),
        });
        ledger.record({
          id: grid.id,
          terminal: { kind: "EMITTED", to: `class:${resolved.class}` },
          pass: "table.classify",
          decidedBy: "llm:table.classify",
          confidence: resolved.confidence,
          note: resolved.reason,
        });
      } else if (fabricating && resolved) {
        escalated(
          "refused",
          "table.classify",
          grid.id,
          `DATA at ${resolved.confidence.toFixed(2)} — region carries no record-matrix evidence`,
        );
        warnings.push(
          `${grid.id}: model called this DATA at confidence ${resolved.confidence.toFixed(2)}, but the ` +
            "region does not carry its own evidence for a record matrix. Left as a review item.",
        );
      } else if (resolver.canAnswer?.("table.classify")) {
        escalated("declined", "table.classify", grid.id);
      }
    }
    classifications.push({ tableId: grid.id, classification });
  }
  const classificationMap = new Map(classifications.map((c) => [c.tableId, c.classification]));

  // Escalation point 2. The semantic matrix is reconstructed deterministically;
  // what a rule cannot supply is a *name* for a column the source never named.
  // §3.8 requires one, §16.3 forbids the converter from inventing it, so a table
  // with no source header is either labelled here or stays a review item.
  const tableHeaders = new Map<string, string[]>();
  for (const { tableId, classification } of classifications) {
    if (classification.class !== "DATA" && classification.class !== "UNKNOWN") continue;
    const grid = grids.find((g) => g.id === tableId);
    if (!grid) continue;
    // Never ask about a region that would not become a table even with labels;
    // the answer would be unused, and paying for an unused answer is the whole
    // failure mode a hook budget exists to prevent.
    if (classification.class === "UNKNOWN" && !isWideEnoughForData(grid)) continue;
    const planned = planDataTable(grid);
    if (!planned.plan || !planned.plan.headerSynthesized) continue;

    openQuestions(
      "table.records",
      tableId,
      1,
      resolver.canAnswer?.("table.records") ?? false,
      `${planned.plan.bands.length} unnamed column(s)`,
    );
    const headers = await resolver.tableHeaders({
      grid,
      plan: planned.plan,
      classification,
      ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    });
    if (!headers) {
      if (resolver.canAnswer?.("table.records")) escalated("declined", "table.records", tableId);
      continue;
    }
    escalations.resolved += 1;
    tableHeaders.set(tableId, headers);
    escalated("resolved", "table.records", tableId, undefined, {
      before: "(no header row in source)",
      after: headers.join(" | "),
    });
    ledger.record({
      id: tableId,
      terminal: { kind: "EMITTED", to: "table-header" },
      pass: "table.records",
      decidedBy: "llm:table.records",
      confidence: 0.8,
      note: `column labels supplied: ${headers.join(" | ")}`,
    });
  }

  stage(
    "tables",
    `${grids.length} grid(s): ${summarizeClasses(classifications)}`,
    classifications.map(
      ({ tableId, classification }) => `${classification.class.padEnd(8)} ${tableId}  (${brief(classification.reason, 90)})`,
    ),
  );

  // ---- Stage 8b: unknown marks -------------------------------------------
  // Runs against the tree structure recovery is about to read, and writes its
  // answer onto the node rather than into a side table, so a node that is later
  // discarded takes its advice with it.
  //
  // `image.caption` stood here too, choosing a picture's caption from lines the
  // page already carried. It is deleted: binding the wrong line to a picture is
  // a content error that reads as a fact, and no caption at all is the honest
  // output when the caption rule matched nothing.
  {
    const candidates = unknownIconCandidates(doc.root);
    const askImageRole = resolver.imageRole?.bind(resolver);
    openQuestions("image.role", options.sourceName ?? "?", candidates.length, askImageRole !== undefined);
    for (const request of candidates) {
      if (!askImageRole) break;
      const node = doc.index.get(request.id);
      if (!node) continue;
      emit({ type: "escalation", hook: "image.role", item: request.id, outcome: "asked", detail: request.size });
      const answer = await askImageRole({
        ...request,
        ...(options.sourceName ? { sourceName: options.sourceName } : {}),
      });
      if (!answer) {
        escalated("declined", "image.role", request.id);
        continue;
      }

      // The acceptance check. An `ICON` needs a mark the project's own table
      // already sanctions — `writeAdvice` drops anything else and `isUiIcon`
      // refuses it again — so the only thing this escalation can do is swap one
      // mark for another mark the guide already licenses. Every other verdict
      // leaves the image exactly as it was.
      if (answer.role === "ICON" && answer.glyph !== undefined) {
        writeAdvice(node, { imageRole: "ICON", imageGlyph: answer.glyph }, "image.role");
        escalated("resolved", "image.role", request.id, undefined, {
          before: `image ${request.size}`,
          after: `glyph ${answer.glyph}`,
          reason: brief(answer.reason, 100),
        });
        ledger.record({
          id: request.id,
          terminal: { kind: "EMITTED", to: `glyph:${answer.glyph}` },
          pass: "image.role",
          decidedBy: "llm:image.role",
          confidence: answer.confidence,
          note: answer.reason,
        });
      } else {
        escalated("refused", "image.role", request.id, `${answer.role}, kept as a picture`);
      }
    }
  }

  // ---- Stage 9: structure recovery ---------------------------------------
  const structure = recoverStructure(doc.root, grids, {
    profile,
    links,
    ...(options.layoutFidelity ? { layoutFidelity: options.layoutFidelity } : {}),
    classifications: classificationMap,
    tableHeaders,
  });
  warnings.push(...structure.warnings);
  for (const entry of structure.ledger) ledger.record({ ...entry, pass: entry.pass || "structure" });

  // §2 is an invariant of the plan, not a finding of the validator: a file that
  // is written and then reported as invalid is a file that ships.
  const title = enforceSingleTitle(structure.root);
  warnings.push(...title.changes);

  // ---- Stage 12: serialize ------------------------------------------------
  const markdown = serialize(structure.root, { profile });

  // ---- Stage 13: verify ---------------------------------------------------
  const validation = validate(structure.root, { profile });
  const diagnostics = [...validation.diagnostics, ...lintText(markdown, { profile })];

  // Content the ledger explains may legitimately be absent. Chrome removed as
  // SHELL is the common case: correct to drop, and correct only because
  // something recorded why.
  const accounted = collectAccountedRemovals(doc, ledger, links);

  const conservation = checkConservation({
    sourceText,
    outputText: plainTextOf(markdown),
    sourceTargets,
    outputTargets: structure.targets,
    sourceImages,
    outputImages: structure.images,
    accounted,
  });

  // Structural conservation: a region the classifier called DATA must have
  // produced a table. Reported as a warning rather than folded into the
  // conservation report so the failure names the table, not the corpus.
  const lostTables = structure.tables.filter((t) => t.classification === "DATA" && !t.emittedTable);
  for (const lost of lostTables) {
    warnings.push(
      `${lost.tableId}: classified DATA but no table was emitted (${lost.failure ?? "unknown"}); ` +
        "rows and columns are absent from the output even though the words survived.",
    );
  }

  // ---- Stage 14: reading review ------------------------------------------
  // After everything. Nothing below changes the document — findings become
  // review items, which is what makes it safe to run on a document every gate
  // was happy with, and those are precisely the documents whose defects have
  // shipped.
  const reviewFindings: ReviewFinding[] = [];
  if (resolver.reviewDocument) {
    escalated("asked", "document.review", options.sourceName ?? "?", `${markdown.length} chars produced`);
    const found = await resolver.reviewDocument({
      sourceName: options.sourceName ?? "(unnamed)",
      sourceText: sourceText.replace(/\s+/gu, " ").trim(),
      output: markdown,
      summary: [
        `Language: ${lang}.`,
        `${grids.length} source table(s): ${summarizeClasses(classifications)}.`,
        `${headings.length} heading(s) recovered from typography.`,
        `${boilerplate.removals.length} structure(s) removed as page chrome ` +
          `(${boilerplate.removedText} of ${boilerplate.documentText} visible characters).`,
        `${structure.images.length} image(s) and ${structure.targets.length} link target(s) emitted.`,
        measurement.measured ? "The page was rendered, so geometry was available." : "The page was not rendered.",
      ].join("\n"),
      ...(warnings.length > 0 ? { warnings: warnings.slice(0, 12) } : {}),
    });

    if (found) {
      // The acceptance check, and it is the only one available for an
      // open-ended reading: a finding must quote the produced document
      // verbatim. One that does not is about a document that does not exist,
      // and it is dropped alone rather than discrediting the rest of the reply.
      const haystack = markdown.replace(/\s+/gu, " ");
      for (const finding of found) {
        const needle = finding.quote.replace(/\s+/gu, " ").trim();
        if (needle === "" || !haystack.includes(needle)) {
          escalated("refused", "document.review", finding.class, "quote is not in the produced document");
          continue;
        }
        reviewFindings.push(finding);
        ledger.record({
          id: options.sourceName ?? "(document)",
          terminal: { kind: "REVIEW", reason: `${finding.severity} ${finding.class}: ${finding.note}` },
          pass: "document.review",
          decidedBy: "llm:document.review",
          confidence: 0.6,
          note: finding.quote.slice(0, 120),
        });
      }
      escalated(
        reviewFindings.length > 0 ? "resolved" : "declined",
        "document.review",
        options.sourceName ?? "?",
        `${reviewFindings.length} finding(s)`,
      );
    } else {
      escalated("declined", "document.review", options.sourceName ?? "?");
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const reviews = ledger.reviews().length;
  const state: ConvertResult["state"] = !conservation.ok || hasErrors || lostTables.length > 0
    ? "conversion-review-required"
    : reviews > 0
      ? "biomd-structurally-valid"
      : "conversion-complete";

  return {
    markdown,
    repairedHtml,
    cleanHtml,
    head,
    encoding: decoded.decision,
    ledger: ledger.toJSON(),
    textOperations,
    conservation,
    diagnostics,
    complexity: validation.complexity,
    classifications,
    tables: structure.tables,
    resolverStats: mergeByHook(resolver.stats(), escalations),
    reviewFindings,
    chrome: {
      documentText: boilerplate.documentText,
      removedText: boilerplate.removedText,
      structures: boilerplate.removals.length,
    },
    warnings,
    state,
    measured: measurement.measured,
  };
}

/**
 * Fold the pipeline's per-hook `consulted` counts into the resolver's own.
 *
 * The two halves are counted in different places for a reason that is worth
 * keeping: the pipeline knows which questions *exist*, including on a run with
 * no model, and the resolver knows which of them cost a request. Neither can
 * report the other's half, and overwriting one with the other — which a spread
 * would do — loses exactly the number an operator wants before spending money.
 */
function mergeByHook(
  stats: ResolverStats,
  pipeline: Pick<ResolverStats, "consulted" | "resolved" | "byHook">,
): ResolverStats {
  const byHook: ResolverStats["byHook"] = { ...stats.byHook };
  for (const [hook, counts] of Object.entries(pipeline.byHook)) {
    const existing = byHook[hook] ?? { consulted: 0, calls: 0, cacheHits: 0, unresolved: 0 };
    byHook[hook] = { ...existing, consulted: existing.consulted + counts.consulted };
  }
  return { ...stats, consulted: pipeline.consulted, resolved: pipeline.resolved, byHook };
}

/** `DATA×3 LAYOUT×1` — what the classifier made of a page, in one field. */
function summarizeClasses(classifications: ReadonlyArray<{ classification: Classification }>): string {
  const counts = new Map<string, number>();
  for (const { classification } of classifications) {
    counts.set(classification.class, (counts.get(classification.class) ?? 0) + 1);
  }
  return (
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `${name}×${n}`)
      .join(" ") || "none"
  );
}

/**
 * Whether a region carries enough of its own evidence to become a table on a
 * model's say-so.
 *
 * A source header row is the author stating the column model outright. Failing
 * that, three or more inferred semantic columns is the width at which "these are
 * records" stops being an interpretation.
 */
function isWideEnoughForData(grid: TableGrid): boolean {
  const planned = planDataTable(grid);
  if (!planned.plan) return false;
  return !planned.plan.headerSynthesized || planned.plan.bands.length >= 3;
}

/**
 * Gather the text, targets and images of every subtree the ledger recorded as
 * REMOVED, so the conservation gate can discharge them.
 *
 * Only `REMOVED` counts. A `REVIEW` item is unresolved, not excused, and must
 * still show up as a conservation failure if its content vanished.
 */
function collectAccountedRemovals(
  doc: { index: Map<string, { attrs: Record<string, string>; tag: string }> },
  ledger: Ledger,
  links: LinkProfile,
): { text: string; targets: string[]; images: string[] } {
  const texts: string[] = [];
  const targets: string[] = [];
  const images: string[] = [];

  for (const entry of ledger.removals()) {
    const node = doc.index.get(entry.id) as unknown as Parameters<typeof textOf>[0] | undefined;
    if (!node) continue;
    texts.push(textOf(node));
    for (const el of walkElements(node)) {
      if (el.tag === "a") {
        const rewritten = rewriteTarget(el.attrs["href"] ?? "", links);
        if (rewritten.href !== "" && rewritten.kind !== "unsafe") targets.push(rewritten.href);
      }
      if (el.tag === "img") {
        const src = el.attrs["src"] ?? "";
        if (src !== "") images.push(src);
      }
    }
  }

  return { text: texts.join(" "), targets, images };
}

/** Minimal HTML serialization of a LADOM node, for the clean-content artifact. */
function htmlOf(node: { kind: string; tag?: string; value?: string; attrs?: Record<string, string>; children?: unknown[] }): string {
  if (node.kind === "text") return escapeHtml(node.value ?? "");
  if (node.kind === "comment") return "";
  const tag = node.tag ?? "div";
  if (tag === "#root") return (node.children ?? []).map((c) => htmlOf(c as never)).join("");
  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeHtml(v).replace(/"/gu, "&quot;")}"`)
    .join("");
  const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "area", "base", "col", "embed", "source", "wbr"]);
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${(node.children ?? []).map((c) => htmlOf(c as never)).join("")}</${tag}>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/**
 * Visible text of an emitted document, for the conservation comparison.
 *
 * Strips fences, property lines and Markdown syntax so the comparison is
 * against what a reader sees, not against the source's punctuation.
 */
export function plainTextOf(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let inDirectiveHeader = false;

  for (const line of lines) {
    // A leaf directive is a whole line of syntax carrying no reader-visible
    // text. Left in, `::anchor{#12}` would reach the conservation gate as prose
    // the source never had, and a page with a long fragment index would report
    // dozens of invented words.
    if (/^::[A-Za-z][\w-]*\{[^}]*\}\s*$/u.test(line)) continue;
    if (/^:::\s*[A-Za-z][\w-]*\s*$/u.test(line)) {
      inDirectiveHeader = true;
      continue;
    }
    if (/^:::\s*$/u.test(line)) {
      inDirectiveHeader = false;
      continue;
    }
    if (inDirectiveHeader) {
      if (line.trim() === "") {
        inDirectiveHeader = false;
        continue;
      }
      const prop = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
      if (prop) {
        // `alt`, `caption` and `title` are visible text; the rest is syntax.
        const key = prop[1] as string;
        if (["alt", "caption", "title"].includes(key)) kept.push(prop[2] as string);
        continue;
      }
      inDirectiveHeader = false;
    }
    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*\|/gmu, " ")
    .replace(/\|/gu, " ")
    .replace(/^\s*-{3,}\s*$/gmu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/==/gu, "")
    .replace(/[*_`~]/gu, "")
    .replace(/\\(.)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
