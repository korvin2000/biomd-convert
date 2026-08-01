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
 * Every stage is deterministic. Nothing here calls a model; the hook points
 * exist (see ../llm) but the default path resolves them with rules, and a run
 * with no gateway configured must produce usable output.
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
import { type Classification, classifyTable } from "./classify.js";
import { type LayoutFidelity, recoverStructure } from "./structure.js";
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
  lang?: string;
  /** Directory to resolve relative assets from during measurement. */
  assetRoot?: string;
  /** Classification overrides, e.g. resolved by a hook. */
  classifications?: Map<string, Classification>;
  /** Structural fingerprint frequencies from the corpus pass. */
  corpusFrequency?: Map<string, number>;
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

  // ---- Stage 10: text reconstruction -------------------------------------
  // Runs before normalization, because the evidence a wrap decision rests on is
  // the source newline after the hyphen, and collapsing whitespace destroys it.
  const dehyphenateOptions: DehyphenateOptions = {
    lexicon,
    oracle: options.oracle ?? NULL_ORACLE,
    lang: options.lang ?? "ru",
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
  const classifications = grids.map((grid) => ({
    tableId: grid.id,
    classification:
      options.classifications?.get(grid.id) ?? classifyTable(grid, options.corpusFrequency?.get(grid.id)),
  }));
  const classificationMap = new Map(classifications.map((c) => [c.tableId, c.classification]));

  // ---- Stage 9: structure recovery ---------------------------------------
  const structure = recoverStructure(doc.root, grids, {
    profile,
    links,
    ...(options.layoutFidelity ? { layoutFidelity: options.layoutFidelity } : {}),
    classifications: classificationMap,
  });
  warnings.push(...structure.warnings);
  for (const entry of structure.ledger) ledger.record({ ...entry, pass: entry.pass || "structure" });

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

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const reviews = ledger.reviews().length;
  const state: ConvertResult["state"] = !conservation.ok || hasErrors
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
    warnings,
    state,
    measured: measurement.measured,
  };
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
