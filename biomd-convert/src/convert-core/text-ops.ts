/**
 * Text operations.
 *
 * Raw text is immutable. Every change to it is an operation with an exact
 * before/after span, a reason and a status, and the normalized text is *derived*
 * by replaying accepted operations. That gives two things a direct rewrite
 * cannot: a reviewer can see precisely what changed and why, and a post-check
 * can assert that only patched spans differ from the source.
 *
 * The editorial policy is expressed as a set of permitted kinds. Mechanical
 * repairs are on by default; anything that changes meaning is off unless a
 * profile explicitly enables it, which matches the specification's
 * conservative-transcription default.
 */

export type TextOperationKind =
  /** Collapse runs of whitespace. */
  | "collapse-space"
  /** A source line break inside prose becomes a space. */
  | "line-to-space"
  /** Remove a discretionary U+00AD. */
  | "remove-soft-hyphen"
  /** Rejoin a word split across a line end. */
  | "join-hyphenated-word"
  /** Keep a break that looked like a wrap but is not. */
  | "preserve-break"
  /** Decode an HTML entity. */
  | "entity"
  /** Reconstruct a decorative first letter rendered as an image. */
  | "dropcap"
  // ---- everything below changes meaning and is denied by default ----
  | "spelling"
  | "punctuation"
  | "transliteration"
  | "paraphrase";

export interface TextOperation {
  id: string;
  kind: TextOperationKind;
  /** IR items the operation applies to. */
  sourceIds: string[];
  before: string;
  after: string;
  /** Rule ids or evidence references that justify it. */
  evidenceIds: string[];
  confidence: number;
  status: "proposed" | "accepted" | "review" | "rejected";
  note?: string;
}

/** Operations that repair transcription without changing what the text says. */
export const MECHANICAL_KINDS: readonly TextOperationKind[] = [
  "collapse-space",
  "line-to-space",
  "remove-soft-hyphen",
  "join-hyphenated-word",
  "preserve-break",
  "entity",
  "dropcap",
];

export const EDITORIAL_KINDS: readonly TextOperationKind[] = [
  "spelling",
  "punctuation",
  "transliteration",
  "paraphrase",
];

export interface EditorialPolicy {
  /** Kinds permitted to reach `accepted`. */
  allow: readonly TextOperationKind[];
}

/**
 * The default policy.
 *
 * `join-hyphenated-word` is mechanical and therefore on. That is a deliberate
 * choice worth stating: de-hyphenation errors corrupt words silently and
 * neither the conservation gate nor a render check will catch them, so the
 * cascade that produces them is conservative by construction (§dehyphenate) and
 * the policy can still demote the kind wholesale if a corpus needs it.
 */
export const DEFAULT_EDITORIAL_POLICY: EditorialPolicy = { allow: MECHANICAL_KINDS };

export interface ApplyResult {
  text: string;
  applied: TextOperation[];
  rejected: TextOperation[];
  warnings: string[];
}

/**
 * Apply operations to a source string.
 *
 * Operations are located by matching `before` at a cursor that only moves
 * forward, so an operation can never be applied twice and overlapping
 * operations are detected rather than silently compounding.
 */
export function applyOperations(
  source: string,
  operations: readonly TextOperation[],
  policy: EditorialPolicy = DEFAULT_EDITORIAL_POLICY,
): ApplyResult {
  const applied: TextOperation[] = [];
  const rejected: TextOperation[] = [];
  const warnings: string[] = [];

  let out = "";
  let cursor = 0;

  for (const op of operations) {
    if (op.status === "rejected") {
      rejected.push(op);
      continue;
    }
    if (!policy.allow.includes(op.kind)) {
      rejected.push({ ...op, status: "rejected" });
      warnings.push(`Operation ${op.id} of kind ${op.kind} is not permitted by the editorial policy.`);
      continue;
    }
    if (op.status === "review") {
      // A reviewable operation is not applied, but it is not lost either: it
      // surfaces in the review queue with its proposed replacement intact.
      rejected.push(op);
      continue;
    }

    const at = source.indexOf(op.before, cursor);
    if (at === -1) {
      warnings.push(
        `Operation ${op.id} could not be located (${JSON.stringify(truncate(op.before))}); skipped. ` +
          "This usually means two operations overlap.",
      );
      rejected.push({ ...op, status: "rejected" });
      continue;
    }

    out += source.slice(cursor, at) + op.after;
    cursor = at + op.before.length;
    applied.push(op);
  }

  out += source.slice(cursor);
  return { text: out, applied, rejected, warnings };
}

/**
 * Post-check: assert that only patched spans differ.
 *
 * Recomputes the result from the source and the applied operations and compares
 * it to what was actually emitted. A mismatch means some pass mutated text
 * outside the operation ledger, which is the failure mode the whole mechanism
 * exists to prevent.
 */
export function verifyOnlyPatchedSpansDiffer(
  source: string,
  emitted: string,
  applied: readonly TextOperation[],
): { ok: boolean; message?: string } {
  const replay = applyOperations(source, applied, { allow: [...MECHANICAL_KINDS, ...EDITORIAL_KINDS] });
  if (replay.text === emitted) return { ok: true };
  return {
    ok: false,
    message:
      "Emitted text differs from the source with the recorded operations replayed. " +
      "Some pass changed text outside the operation ledger.",
  };
}

function truncate(value: string, max = 40): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
