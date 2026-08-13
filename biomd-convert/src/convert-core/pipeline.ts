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
import { recoverHeadings } from "./headings.js";
import { type DecisionResolver, NULL_RESOLVER, type ResolverStats } from "./resolver.js";
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
}

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

export async function convert(bytes: Uint8Array | Buffer, options: ConvertOptions = {}): Promise<ConvertResult> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const links = options.links ?? ABC_LINK_PROFILE;
  const measurer = options.measurer ?? new NullMeasurer();
  const lexicon = options.lexicon ?? new Lexicon();
  const warnings: string[] = [];
  const ledger = new Ledger();

  // ---- Stage 1: decode ---------------------------------------------------
  const decoded = decodeHtml(bytes);
  warnings.push(...decoded.decision.warnings);

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
  const boilerplate = removeBoilerplate(doc.root, options.corpusProfile ?? null);
  warnings.push(...boilerplate.warnings);
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
  const resolver = options.resolver ?? NULL_RESOLVER;
  const escalations = { consulted: 0, resolved: 0 };

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
      escalations.consulted += 1;
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
        ledger.record({
          id: grid.id,
          terminal: { kind: "EMITTED", to: `class:${resolved.class}` },
          pass: "table.classify",
          decidedBy: "llm:table.classify",
          confidence: resolved.confidence,
          note: resolved.reason,
        });
      } else if (fabricating && resolved) {
        warnings.push(
          `${grid.id}: model called this DATA at confidence ${resolved.confidence.toFixed(2)}, but the ` +
            "region does not carry its own evidence for a record matrix. Left as a review item.",
        );
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

    escalations.consulted += 1;
    const headers = await resolver.tableHeaders({
      grid,
      plan: planned.plan,
      classification,
      ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    });
    if (!headers) continue;
    escalations.resolved += 1;
    tableHeaders.set(tableId, headers);
    ledger.record({
      id: tableId,
      terminal: { kind: "EMITTED", to: "table-header" },
      pass: "table.records",
      decidedBy: "llm:table.records",
      confidence: 0.8,
      note: `column labels supplied: ${headers.join(" | ")}`,
    });
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
    resolverStats: { ...resolver.stats(), ...escalations },
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
    .replace(/[*_`~]/gu, "")
    .replace(/\\(.)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
