/**
 * Target profiles — what the consuming renderer actually supports.
 *
 * The plan's §12 established that the normative spec (`Biography-Markup.md`
 * v1.6) and the one real parser have drifted. Rather than hard-code the
 * narrower reality, the divergence lives here as data: the builders refuse to
 * construct an unsupported construct, the validator diagnoses it, and a single
 * flag re-enables it when a renderer patch lands.
 *
 * Nothing in this file imports, executes or depends on the renderer. These are
 * recorded observations about the output format, equivalent to a compatibility
 * table.
 */

export interface TargetProfile {
  readonly id: string;
  readonly description: string;

  /**
   * Constructs the target can render. A `false` entry means the converter must
   * never emit it — see `downgrade.ts` for what is emitted instead.
   */
  readonly supports: {
    /** Block-level `::: frame` (spec §12). Distinct from the picture `frame:` property. */
    readonly frameDirective: boolean;
    /** `::: signature` (spec §13). */
    readonly signatureDirective: boolean;
    /** `columns` → `divider: true` (spec §10). */
    readonly columnsDivider: boolean;
    /** Leading-zero ordered-list markers `01.` `02.` (spec §3.4). */
    readonly leadingZeroListMarkers: boolean;
    /** Raw HTML passthrough. */
    readonly rawHtml: boolean;
  };

  /**
   * Emit a blank line between a directive's property block and its body even
   * where the spec would tolerate its absence.
   *
   * Guards the `splitPropsAndBody` landmine: a body whose first line looks like
   * `Label: text` is otherwise silently consumed as a bogus property. Costs one
   * newline; prevents content loss.
   */
  readonly alwaysBlankLineAfterProperties: boolean;

  /** Physical line ceiling (spec §16.3). */
  readonly maxLineLength: number;
}

/**
 * The renderer as it exists today. Derived from reading its parser; its own
 * header self-labels against spec v1.3 while the spec here is v1.6.
 *
 * Rationale for each `false`:
 *  - frameDirective     — no `case "frame"`; falls through to a bare `<div>`,
 *                         losing palette, border and notice semantics silently.
 *  - signatureDirective — same fallback.
 *  - columnsDivider     — actively broken: the `columns` handler does not strip
 *                         a property header, so the literal text `divider: true`
 *                         is pushed as the first column. Corrupts the layout.
 *  - leadingZero…       — no `ol`/`li` override; `01.` is parsed as `start: 1`.
 *  - rawHtml            — `rehype-raw` is not enabled; raw HTML vanishes without
 *                         an error, which is why the conservation gate matters.
 */
export const PROFILE_RENDERER_CURRENT: TargetProfile = {
  id: "renderer-current",
  description: "BioMD renderer as observed (bespoke line parser, react-markdown + remark-gfm leaves)",
  supports: {
    frameDirective: false,
    signatureDirective: false,
    columnsDivider: false,
    leadingZeroListMarkers: false,
    rawHtml: false,
  },
  alwaysBlankLineAfterProperties: true,
  maxLineLength: 2200,
};

/** The normative specification, for validating hand-authored documents. */
export const PROFILE_SPEC_V16: TargetProfile = {
  id: "spec-1.6",
  description: "Biography-Markup.md v1.6 as written",
  supports: {
    frameDirective: true,
    signatureDirective: true,
    columnsDivider: true,
    leadingZeroListMarkers: true,
    rawHtml: false,
  },
  alwaysBlankLineAfterProperties: true,
  maxLineLength: 2200,
};

export const PROFILES: Record<string, TargetProfile> = {
  [PROFILE_RENDERER_CURRENT.id]: PROFILE_RENDERER_CURRENT,
  [PROFILE_SPEC_V16.id]: PROFILE_SPEC_V16,
};

/** Conversion output targets the renderer that exists, not the spec as written. */
export const DEFAULT_PROFILE = PROFILE_RENDERER_CURRENT;

export function resolveProfile(id: string | undefined): TargetProfile {
  if (!id) return DEFAULT_PROFILE;
  const found = PROFILES[id];
  if (!found) {
    throw new Error(
      `Unknown target profile ${JSON.stringify(id)}. Known: ${Object.keys(PROFILES).join(", ")}`,
    );
  }
  return found;
}
