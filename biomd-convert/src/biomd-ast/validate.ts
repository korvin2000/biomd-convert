/**
 * BioMD grammar, target-conformance and lint validation.
 *
 * Most structural rules are already unrepresentable through the builders; this
 * is defence in depth, and it is also the only check available for
 * hand-authored documents and for output produced before a profile changed.
 *
 * Every finding carries a stable `code` so the repair loop and the review UI
 * can act on it without string matching.
 *
 * **`error` means the document is wrong, not merely unusual.** The severity
 * split follows `BioMD-Reference.md` §0: `MUST` (a parser, renderer, value,
 * nesting or path constraint) is an error; `SHOULD` and `MAY` are warnings,
 * however strong the preference. Three checks were errors on preferences the
 * reference states as conventions — `h1-count`, `heading-skips-level` and
 * `line-too-long` — which made conforming documents fail and taught every
 * consumer of the `errors=` column to distrust it. They still fire; they no
 * longer condemn.
 */
import type { Nodes, Parents, Table } from "mdast";
import { DEFAULT_PROFILE, type TargetProfile } from "./profile.js";
import { navItemLabels } from "./builders.js";
import { normalizeLabel, plainText } from "./text.js";
import {
  ALIGN_POSITIONS,
  COLUMNS_COUNTS,
  COLUMNS_MAX_CHILDREN,
  COLUMNS_MIN_CHILDREN,
  DOCUMENT_MODES,
  FRAME_PALETTES,
  IMAGE_POSITIONS,
  IMAGE_SIZES,
  IMAGES_COLUMNS,
  PICTURE_FRAMES,
  isBiomdDirective,
  type BiomdRoot,
} from "./types.js";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  /** Directive path to the offending node, e.g. `root/biomdColumns[0]/biomdColumn[1]`. */
  path: string;
}

export interface ComplexityBudget {
  /** Directives per 1000 words of body text. */
  maxDirectiveDensity: number;
  maxNestingDepth: number;
  maxDirectivesTotal: number;
  /**
   * Word count below which the density ratio is not meaningful and is not
   * enforced.
   *
   * Density is a ratio, so it diverges on short documents: a gallery page that
   * is legitimately six images and twenty words of caption scores far worse
   * than a 600-word biography with the same six directives. Enforcing it there
   * would flag exactly the pages where a high directive count is correct. The
   * absolute count and nesting-depth limits still apply at every size.
   */
  minWordsForDensity: number;
}

/**
 * Defaults are a starting point to be calibrated on the golden corpus, not a
 * claim. A 600-word biography emitting 30 directives is modelling layout rather
 * than meaning; these numbers are set to catch that shape.
 */
export const DEFAULT_COMPLEXITY_BUDGET: ComplexityBudget = {
  maxDirectiveDensity: 25,
  // Four, because the reference reaches four legitimately and the old value of
  // three made a conforming shape a budget violation: §3 allows `align` inside
  // a `column`, §2 allows `column` inside `columns` and leaf media inside an
  // `align`, so `columns > column > align > image` is four deep and entirely
  // ordinary. Five is still a smell — nothing in the reference composes that far.
  maxNestingDepth: 4,
  maxDirectivesTotal: 40,
  minWordsForDensity: 200,
};

export interface ValidateOptions {
  profile?: TargetProfile;
  budget?: ComplexityBudget;
  /** Skip the complexity budget (useful when validating an intermediate tree). */
  skipComplexity?: boolean;
}

export interface ComplexityReport {
  words: number;
  directivesTotal: number;
  directiveDensity: number;
  maxNestingDepth: number;
  /** False when the document is too short for the density ratio to mean anything. */
  densityEnforced: boolean;
  withinBudget: boolean;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  complexity: ComplexityReport;
  /** True when no `error`-severity diagnostic was produced. */
  ok: boolean;
}

/** Depth-first walk over an mdast/BioMD tree, tracking a readable path. */
function walk(
  node: Nodes,
  path: string,
  visit: (node: Nodes, path: string, ancestors: readonly Nodes[]) => void,
  ancestors: Nodes[] = [],
): void {
  visit(node, path, ancestors);
  const kids = childrenOf(node);
  const next = [...ancestors, node];
  kids.forEach((child, index) => walk(child, `${path}/${child.type}[${index}]`, visit, next));
}

/** Children of any node, including the non-standard slots on BioMD directives. */
function childrenOf(node: Nodes): Nodes[] {
  if (node.type === "biomdNav") return [(node as { list: Nodes }).list];
  const kids = (node as Partial<Parents>).children;
  return Array.isArray(kids) ? (kids as Nodes[]) : [];
}

export function validate(root: BiomdRoot, options: ValidateOptions = {}): ValidationResult {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const budget = options.budget ?? DEFAULT_COMPLEXITY_BUDGET;
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, severity: Severity, message: string, path: string) =>
    diagnostics.push({ code, severity, message, path });

  let headingH1 = 0;
  let previousDepth = 0;
  let directivesTotal = 0;
  let maxNestingDepth = 0;
  let words = 0;
  const footnoteDefs = new Set<string>();
  const footnoteRefs = new Map<string, string>();

  walk(root as unknown as Nodes, "root", (node, path, ancestors) => {
    const directiveDepth = ancestors.filter((a) => isBiomdDirective(a as { type: string })).length;

    if (isBiomdDirective(node as { type: string })) {
      directivesTotal += 1;
      maxNestingDepth = Math.max(maxNestingDepth, directiveDepth + 1);
      checkDirective(node, path, profile, ancestors, add);
    }

    switch (node.type) {
      case "heading": {
        if (node.depth === 1) headingH1 += 1;
        if (previousDepth !== 0 && node.depth > previousDepth + 1) {
          add(
            "heading-skips-level",
            "warning",
            `Heading jumps from h${previousDepth} to h${node.depth}. Reference §6 asks for a hierarchy that ` +
              "is preserved and normalized where that improves it, not for an unbroken sequence — so this " +
              "is a fidelity smell, not a grammar violation.",
            path,
          );
        }
        previousDepth = node.depth;
        if (plainText(node).trim() === "") {
          add("heading-empty", "error", "Heading has no text.", path);
        }
        break;
      }
      case "html": {
        if (!profile.supports.rawHtml) {
          add(
            "raw-html",
            "error",
            "Raw HTML is not rendered by the target and disappears without an error at render time; " +
              "it must never reach the output.",
            path,
          );
        }
        break;
      }
      case "table":
        checkTable(node, path, add);
        break;
      case "footnoteDefinition":
        footnoteDefs.add(node.identifier);
        break;
      case "footnoteReference":
        footnoteRefs.set(node.identifier, path);
        break;
      case "text":
        words += countWords(node.value);
        checkHighlight(node.value, path, add);
        break;
      case "inlineCode":
        words += countWords(node.value);
        break;
      default:
        break;
    }

    // A directive nested inside a blockquote or list item can never be
    // recognised: the target matches fences with line-anchored patterns and the
    // `> ` / `  ` prefix defeats them.
    if (isBiomdDirective(node as { type: string })) {
      const blocked = ancestors.find((a) => a.type === "blockquote" || a.type === "listItem");
      if (blocked) {
        add(
          "directive-inside-prefixed-block",
          "error",
          `Directive nested inside ${blocked.type}; the fence would be prefixed and never parsed as a directive.`,
          path,
        );
      }
    }
  });

  // Reference §6 is explicit: "CommonMark supports h1–h6; 'exactly one #' is
  // therefore a corpus convention, not a syntax requirement", and the policy it
  // states is a SHOULD. Reporting it as an error made a conforming document
  // fail validation — and, worse, made every consumer of `errors=` treat a
  // masthead wrapped over two lines as broken output.
  //
  // Still reported, because it is the single most reliable sign that heading
  // recovery misfired: zero means no title was found, three means three
  // candidates were promoted. A warning says "look at this", which is true; an
  // error said "this file is invalid", which was not.
  if (headingH1 !== 1) {
    diagnostics.push({
      code: "h1-count",
      severity: "warning",
      message:
        `Found ${headingH1} level-1 heading(s). Reference §6 prefers exactly one for a page with one clear ` +
        "title, but treats that as a convention rather than a syntax rule.",
      path: "root",
    });
  }

  for (const [identifier, path] of footnoteRefs) {
    if (!footnoteDefs.has(identifier)) {
      diagnostics.push({
        code: "footnote-undefined",
        severity: "error",
        message: `Footnote reference [^${identifier}] has no definition.`,
        path,
      });
    }
  }
  for (const identifier of footnoteDefs) {
    if (!footnoteRefs.has(identifier)) {
      diagnostics.push({
        code: "footnote-unreferenced",
        severity: "warning",
        message: `Footnote definition [^${identifier}] is never referenced.`,
        path: "root",
      });
    }
  }

  const directiveDensity = words > 0 ? (directivesTotal * 1000) / words : directivesTotal > 0 ? Infinity : 0;
  const densityApplies = words >= budget.minWordsForDensity;
  const complexity: ComplexityReport = {
    words,
    directivesTotal,
    directiveDensity: Number.isFinite(directiveDensity) ? Number(directiveDensity.toFixed(2)) : directiveDensity,
    maxNestingDepth,
    densityEnforced: densityApplies,
    withinBudget: true,
  };

  if (!options.skipComplexity) {
    const violations: string[] = [];
    if (densityApplies && complexity.directiveDensity > budget.maxDirectiveDensity) {
      violations.push(
        `density ${complexity.directiveDensity}/1000 words exceeds ${budget.maxDirectiveDensity}`,
      );
    }
    if (complexity.maxNestingDepth > budget.maxNestingDepth) {
      violations.push(`nesting depth ${complexity.maxNestingDepth} exceeds ${budget.maxNestingDepth}`);
    }
    if (complexity.directivesTotal > budget.maxDirectivesTotal) {
      violations.push(`${complexity.directivesTotal} directives exceeds ${budget.maxDirectivesTotal}`);
    }
    if (violations.length > 0) {
      complexity.withinBudget = false;
      diagnostics.push({
        code: "complexity-budget",
        severity: "error",
        message:
          `Output models layout rather than meaning: ${violations.join("; ")}. ` +
          "Review the structure before shipping (plan §7.5).",
        path: "root",
      });
    }
  }

  return { diagnostics, complexity, ok: !diagnostics.some((d) => d.severity === "error") };
}

function checkDirective(
  node: Nodes,
  path: string,
  profile: TargetProfile,
  ancestors: readonly Nodes[],
  add: (code: string, severity: Severity, message: string, path: string) => void,
): void {
  switch (node.type) {
    case "biomdAlign": {
      if (!ALIGN_POSITIONS.includes(node.position)) {
        add("align-position", "error", `Invalid align position ${JSON.stringify(node.position)}.`, path);
      }
      // Advisory only, and deliberately so: Reference §2 permits the nesting and
      // forbids rejecting or rewriting it. A frame fills its container's width,
      // so an `align` around one has nothing to align; `frame` wrapping `align`
      // is the shape that expresses a bordered notice with centred contents.
      if (node.children.some((c) => c.type === "biomdFrame")) {
        add(
          "align-wraps-frame",
          "warning",
          "`align` contains a `frame`. A frame occupies the full width of its container, so the alignment " +
            "has no effect; `frame` wrapping `align` is the intended shape (Reference §2). Legal either way.",
          path,
        );
      }
      break;
    }
    case "biomdImage": {
      if (!node.src) add("image-src", "error", "`src` is required.", path);
      if (node.standalone) {
        if (!node.position || !IMAGE_POSITIONS.includes(node.position)) {
          add("image-position", "error", "A standalone image requires a valid `position` (§4.1).", path);
        }
        if (!node.size || !IMAGE_SIZES.includes(node.size)) {
          add("image-size", "error", "A standalone image requires a valid `size` (§4.1).", path);
        }
      } else if (node.position !== undefined || node.size !== undefined) {
        add("image-grouped-layout", "error", "An image inside `images` must not carry position/size.", path);
      }
      if (node.frame !== undefined && !PICTURE_FRAMES.includes(node.frame)) {
        add("image-frame", "error", `Invalid picture frame ${JSON.stringify(node.frame)}.`, path);
      }
      if (node.link !== undefined && node.link.trim() === "") {
        add("image-link-empty", "error", "`link` is present but empty; omit it instead.", path);
      }
      break;
    }
    case "biomdImages": {
      if (!IMAGES_COLUMNS.includes(node.columns)) {
        add("images-columns", "error", `\`columns\` must be 2, 3 or 4; found ${node.columns}.`, path);
      }
      if (node.children.length < 2) {
        add("images-children", "error", "`images` requires two or more image children (§4.1).", path);
      }
      if (node.children.some((c) => c.type !== "biomdImage")) {
        add("images-children-kind", "error", "`images` contains only `image` children (§4.1).", path);
      }
      break;
    }
    case "biomdDocument": {
      if (!node.src || !node.title) add("document-props", "error", "`src` and `title` are required.", path);
      if (!DOCUMENT_MODES.includes(node.mode)) {
        add("document-mode", "error", `\`mode\` must be link or embed; found ${JSON.stringify(node.mode)}.`, path);
      }
      break;
    }
    case "biomdColumns": {
      const n = node.children.length;
      if (n < COLUMNS_MIN_CHILDREN || n > COLUMNS_MAX_CHILDREN) {
        add(
          "columns-arity",
          "error",
          `\`columns\` requires between ${COLUMNS_MIN_CHILDREN} and ${COLUMNS_MAX_CHILDREN} columns; ` +
            `found ${n} (Reference §2, §3).`,
          path,
        );
      }
      if (node.children.some((c) => c.type !== "biomdColumn")) {
        add("columns-children", "error", "`columns` contains only `column` children (Reference §2).", path);
      }
      if (node.columns !== undefined) {
        if (!COLUMNS_COUNTS.includes(node.columns)) {
          add("columns-count", "error", `\`columns\` must be 2, 3 or 4; found ${node.columns}.`, path);
        } else if (node.columns !== n) {
          add(
            "columns-count-mismatch",
            "error",
            `\`columns: ${node.columns}\` disagrees with ${n} column children.`,
            path,
          );
        }
        if (!profile.supports.columnsProperty) {
          add(
            "columns-property-unsupported",
            "error",
            `Target ${JSON.stringify(profile.id)} does not strip a property header inside \`columns\`; ` +
              "`columns:` is pushed into the tree as a bogus first column and corrupts the layout.",
            path,
          );
        }
      }
      if (node.divider === true && !profile.supports.columnsDivider) {
        add(
          "divider-unsupported",
          "error",
          `Target ${JSON.stringify(profile.id)} does not strip a property header inside \`columns\`; ` +
            "`divider: true` is pushed into the tree as a bogus first column and corrupts the layout.",
          path,
        );
      }
      break;
    }
    case "biomdNav": {
      if (node.list.ordered) add("nav-ordered", "error", "A nav body must be a bullet list (§11).", path);
      if (node.list.children.length === 0) add("nav-empty", "error", "A nav requires at least one item.", path);
      if (node.active !== undefined) {
        const labels = navItemLabels(node.list);
        const hits = labels.filter((l) => l === normalizeLabel(node.active as string)).length;
        if (hits !== 1) {
          add("nav-active", "error", `\`active\` must match exactly one item; matched ${hits} (§11).`, path);
        }
      }
      const insideAlign = ancestors.some((a) => a.type === "biomdAlign");
      if (insideAlign) add("nav-in-align", "error", "An `align` must not contain a `nav` (§4.1).", path);
      break;
    }
    case "biomdFrame": {
      if (!profile.supports.frameDirective) {
        add(
          "frame-unsupported",
          "error",
          `Target ${JSON.stringify(profile.id)} does not implement \`::: frame\`; it renders as a bare ` +
            "container and loses palette, border and notice semantics silently.",
          path,
        );
      }
      if (!FRAME_PALETTES.includes(node.frame)) {
        add("frame-palette", "error", `Invalid frame palette ${JSON.stringify(node.frame)}.`, path);
      }
      if (ancestors.some((a) => a.type === "biomdFrame")) {
        add("frame-nested", "error", "A `frame` must not contain another `frame` (§4.1).", path);
      }
      break;
    }
    case "biomdSignature": {
      if (!profile.supports.signatureDirective) {
        add(
          "signature-unsupported",
          "error",
          `Target ${JSON.stringify(profile.id)} does not implement \`::: signature\`; it renders as ` +
            "ordinary paragraphs.",
          path,
        );
      }
      break;
    }
    default:
      break;
  }
}

/**
 * C1 — GFM table cells are inline-only.
 *
 * A cell that needs block content means the source region was HYBRID, not DATA.
 * Catching it here turns a rendering artifact into a classification finding.
 */
function checkTable(
  table: Table,
  path: string,
  add: (code: string, severity: Severity, message: string, path: string) => void,
): void {
  const rows = table.children;
  if (rows.length === 0) {
    add("table-empty", "error", "Table has no rows.", path);
    return;
  }
  const header = rows[0];
  const width = header ? header.children.length : 0;

  if (header) {
    header.children.forEach((cell, index) => {
      const label = plainText(cell).trim();
      // An empty header **cell** is legal; the header **row** is what is
      // required. `BioMD-Reference.md` §1 (Tables) says so outright, and the
      // house convention depends on it: a column of links is headed
      // `&#128279;` and every other unnamed column — including the leading one
      // that carries each record's name — is left empty rather than given an
      // invented noun. This rule used to report one error per such cell, 22 of
      // them across ten documents, all for obeying the convention. PROGRESS
      // §36; the amendment to §1 is what makes this correct rather than lax.
      if (label !== "" && /^(?:Поле|Field|Column|Столбец)\s*\d+$/iu.test(label)) {
        add(
          "table-header-placeholder",
          "error",
          `Column ${index + 1} header ${JSON.stringify(label)} is a placeholder, not a meaning (§3.8).`,
          path,
        );
      }
    });
  }

  rows.forEach((row, rowIndex) => {
    if (row.children.length !== width) {
      add(
        "table-ragged",
        "error",
        `Row ${rowIndex + 1} has ${row.children.length} cells, header has ${width}.`,
        path,
      );
    }
    row.children.forEach((cell, cellIndex) => {
      for (const child of cell.children) {
        if (!isPhrasing(child.type)) {
          add(
            "table-cell-block-content",
            "error",
            `Cell (${rowIndex + 1},${cellIndex + 1}) contains block content (${child.type}). GFM cells are ` +
              "inline-only — decompose the region into sections or lists instead (C1).",
            path,
          );
        }
      }
    });
  });
}

const PHRASING = new Set([
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "break",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "footnoteReference",
]);

function isPhrasing(type: string): boolean {
  return PHRASING.has(type);
}

/**
 * C3 — `==highlight==` is implemented narrowly: it splits text nodes on
 * `/==([^=\n]+)==/g`, so a span cannot cross a line or contain `=`.
 */
function checkHighlight(
  value: string,
  path: string,
  add: (code: string, severity: Severity, message: string, path: string) => void,
): void {
  const marks = value.match(/==/gu);
  if (!marks) return;
  if (marks.length % 2 !== 0) {
    add("highlight-unbalanced", "warning", "Unbalanced `==` highlight markers in text.", path);
  }
}

function countWords(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}

/**
 * Text-level lints that only make sense on serialized output.
 *
 * The physical line ceiling (§16.3) is a property of the emitted file, not of
 * the tree, so it is checked here rather than in {@link validate}.
 */
export function lintText(text: string, options: ValidateOptions = {}): Diagnostic[] {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const diagnostics: Diagnostic[] = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    if (line.length > profile.maxLineLength) {
      diagnostics.push({
        code: "line-too-long",
        // A warning, not an error: `BioMD-Reference.md` states no line ceiling,
        // and a long line renders correctly. It is kept because it is a good
        // *under-segmentation* detector — a 4000-character line usually means a
        // whole section landed in one paragraph — but that is a conversion
        // quality signal, not a conformance failure.
        severity: "warning",
        message:
          `Line ${index + 1} is ${line.length} characters against a soft ceiling of ${profile.maxLineLength}. ` +
          "Not a conformance failure; usually a sign that a region was not segmented.",
        path: `line:${index + 1}`,
      });
    }
  });

  // Unbalanced fences would make the target consume the rest of the document.
  let depth = 0;
  lines.forEach((line, index) => {
    if (/^:::[ \t]*[A-Za-z][\w-]*[ \t]*$/u.test(line)) depth += 1;
    else if (/^:::[ \t]*$/u.test(line)) {
      depth -= 1;
      if (depth < 0) {
        diagnostics.push({
          code: "fence-unbalanced",
          severity: "error",
          message: `Closing fence at line ${index + 1} has no matching directive.`,
          path: `line:${index + 1}`,
        });
        depth = 0;
      }
    }
  });
  if (depth !== 0) {
    diagnostics.push({
      code: "fence-unbalanced",
      severity: "error",
      message: `${depth} directive fence(s) left unclosed at end of file.`,
      path: `line:${lines.length}`,
    });
  }

  if (/<\?php|<\?=|<%|<!--#/u.test(text)) {
    diagnostics.push({
      code: "server-markup-leaked",
      severity: "error",
      message: "Server-side markup (PHP/ASP/SSI) reached the output.",
      path: "document",
    });
  }

  return diagnostics;
}
