/**
 * Corpus-wide L2 roll-up and the defect ledger.
 *
 * Progress on this project is reported as **classes closed and instances
 * remaining per class**, never as an average — a mean over thirteen documents
 * cannot say what to do next, and this is the artifact that can. Work is ranked
 * by `instances × severity × generality`, where generality is the number of
 * documents sharing the class, because a class recurring in six documents
 * teaches more about the other ~987 pages than a larger one in a single
 * document.
 */
import type { Finding, Severity } from "./structdiff.js";
import type { Verdict } from "./triage.js";

export interface LedgerFinding extends Finding {
  verdict: Verdict;
}

export interface ClassEntry {
  class: string;
  severity: Severity;
  instances: number;
  /** Documents exhibiting the class — the generality term. */
  documents: string[];
  verdicts: Record<Verdict, number>;
  /** `instances × severity weight × generality`. Work order. */
  rank: number;
  /** One instance, so the class is inspectable without opening the JSON. */
  example: { doc: string; path: string; produced: string | null; reference: string | null };
}

export interface Ledger {
  generated: string;
  totals: {
    findings: number;
    converterDefects: number;
    acceptableAlternatives: number;
    referenceInconsistencies: number;
    ambiguous: number;
    bySeverity: Record<Severity, number>;
  };
  perDocument: Array<{ doc: string; findings: number; converterDefects: number; critical: number; major: number; minor: number }>;
  classes: ClassEntry[];
  findings: LedgerFinding[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 5, major: 3, minor: 1 };

export function buildLedger(findings: readonly LedgerFinding[], docs: readonly string[]): Ledger {
  const byClass = new Map<string, LedgerFinding[]>();
  for (const f of findings) {
    const list = byClass.get(f.class) ?? [];
    list.push(f);
    byClass.set(f.class, list);
  }

  const classes: ClassEntry[] = [];
  for (const [cls, list] of byClass) {
    // Only `converter-defect` instances are rankable work. An acceptable
    // alternative and a reference inconsistency both mean "not a target", and
    // neither may pull a class up the queue (invariant 4, `CLAUDE.md` §4).
    const actionable = list.filter((f) => f.verdict === "converter-defect");
    const documents = [...new Set(list.map((f) => f.doc))].sort();
    const severity = worst(list.map((f) => f.severity));
    const verdicts: Record<Verdict, number> = {
      "converter-defect": 0,
      "acceptable-alternative": 0,
      "reference-inconsistency": 0,
      ambiguous: 0,
    };
    for (const f of list) verdicts[f.verdict] += 1;
    const head = actionable[0] ?? (list[0] as LedgerFinding);
    classes.push({
      class: cls,
      severity,
      instances: list.length,
      documents,
      verdicts,
      rank: actionable.length * SEVERITY_WEIGHT[severity] * documents.length,
      example: { doc: head.doc, path: head.path, produced: head.produced, reference: head.reference },
    });
  }
  classes.sort((a, b) => b.rank - a.rank || b.instances - a.instances || a.class.localeCompare(b.class));

  const byDoc = docs.map((doc) => {
    const list = findings.filter((f) => f.doc === doc);
    return {
      doc,
      findings: list.length,
      converterDefects: list.filter((f) => f.verdict === "converter-defect").length,
      critical: list.filter((f) => f.severity === "critical").length,
      major: list.filter((f) => f.severity === "major").length,
      minor: list.filter((f) => f.severity === "minor").length,
    };
  });

  return {
    generated: new Date().toISOString(),
    totals: {
      findings: findings.length,
      converterDefects: findings.filter((f) => f.verdict === "converter-defect").length,
      acceptableAlternatives: findings.filter((f) => f.verdict === "acceptable-alternative").length,
      referenceInconsistencies: findings.filter((f) => f.verdict === "reference-inconsistency").length,
      ambiguous: findings.filter((f) => f.verdict === "ambiguous").length,
      bySeverity: {
        critical: findings.filter((f) => f.severity === "critical").length,
        major: findings.filter((f) => f.severity === "major").length,
        minor: findings.filter((f) => f.severity === "minor").length,
      },
    },
    perDocument: byDoc,
    classes,
    findings: [...findings].sort((a, b) => a.doc.localeCompare(b.doc) || (a.referenceLine ?? 0) - (b.referenceLine ?? 0)),
  };
}

function worst(severities: readonly Severity[]): Severity {
  if (severities.includes("critical")) return "critical";
  if (severities.includes("major")) return "major";
  return "minor";
}

/** Human-readable roll-up. Classes and instances; deliberately no total score. */
export function renderLedger(ledger: Ledger, limit = 30): string {
  const out: string[] = [];
  const t = ledger.totals;
  out.push(
    `${t.findings} findings — ${t.converterDefects} converter-defect · ${t.ambiguous} ambiguous · ` +
      `${t.acceptableAlternatives} acceptable-alternative · ${t.referenceInconsistencies} reference-inconsistency`,
  );
  out.push(`severity: ${t.bySeverity.critical} critical · ${t.bySeverity.major} major · ${t.bySeverity.minor} minor`);
  out.push("");
  out.push("document           total  defect   crit    maj    min");
  out.push("-------------------------------------------------------");
  for (const d of [...ledger.perDocument].sort((a, b) => b.converterDefects - a.converterDefects)) {
    out.push(
      `${d.doc.padEnd(18)}${String(d.findings).padStart(5)}${String(d.converterDefects).padStart(8)}${String(d.critical).padStart(7)}${String(d.major).padStart(7)}${String(d.minor).padStart(7)}`,
    );
  }
  out.push("");
  const actionable = ledger.classes.filter((c) => (c.verdicts["converter-defect"] ?? 0) > 0);
  out.push(`top converter-defect classes by instances × severity × generality (${actionable.length} classes):`);
  out.push("");
  out.push("rank  class                                  inst  defect  docs  sev");
  out.push("--------------------------------------------------------------------");
  for (const c of actionable.slice(0, limit)) {
    out.push(
      `${String(c.rank).padStart(4)}  ${c.class.padEnd(38)}${String(c.instances).padStart(4)}${String(c.verdicts["converter-defect"]).padStart(8)}${String(c.documents.length).padStart(6)}  ${c.severity}`,
    );
  }
  const ceiling = ledger.classes.filter((c) => (c.verdicts["converter-defect"] ?? 0) === 0);
  if (ceiling.length > 0) {
    out.push("");
    out.push(`not a target — no converter-defect instance (${ceiling.length} classes):`);
    for (const c of ceiling.slice(0, limit)) {
      out.push(`      ${c.class.padEnd(38)}${String(c.instances).padStart(4)}  ${c.documents.length} doc(s)`);
    }
  }
  return `${out.join("\n")}\n`;
}
