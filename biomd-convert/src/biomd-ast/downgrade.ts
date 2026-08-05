/**
 * Deterministic downgrades for constructs the target profile cannot render.
 *
 * The converter must never emit `::: frame`, `::: signature` or
 * `columns.divider` against the current renderer (plan §12.3). These helpers
 * produce the replacement content and report what was lost, so structure
 * recovery can record a `TRANSFORM` in the ledger rather than silently
 * changing meaning.
 */
import type { BlockContent, Paragraph } from "mdast";
import type { TargetProfile } from "./profile.js";
import { makeFrame, makeSignature } from "./builders.js";
import type { BiomdContent, BoundedContent, FramePalette } from "./types.js";

export interface Downgrade<T> {
  /** Content to emit. */
  content: T;
  /**
   * Machine-readable reason, empty when the profile supported the construct
   * natively and nothing was changed.
   */
  transforms: DowngradeRecord[];
}

export interface DowngradeRecord {
  construct: "frame" | "signature" | "columns.divider" | "leading-zero-marker";
  profile: string;
  /** Human-readable statement of what the reader loses. */
  effect: string;
}

/** True when the subtree can live inside a blockquote. */
function isQuotable(nodes: readonly BoundedContent[]): boolean {
  // The renderer matches directive fences with line-anchored regexes, so a
  // `> ` prefix prevents a nested directive from ever being recognised. A
  // blockquote is therefore only safe for pure Markdown content.
  return nodes.every((node) => !(node as { type: string }).type.startsWith("biomd"));
}

/**
 * A bordered notice region.
 *
 * Native: `::: frame`. Downgraded: a blockquote when the body is pure Markdown
 * (closest available "bounded region" semantics), otherwise a bold title
 * paragraph followed by the body unchanged — because a directive inside a
 * blockquote would never be parsed as a directive.
 */
export function downgradeNotice(
  profile: TargetProfile,
  init: { frame: FramePalette; title?: string; children: BoundedContent[] },
): Downgrade<BiomdContent[]> {
  if (profile.supports.frameDirective) {
    return { content: [makeFrame({ ...init, profile })], transforms: [] };
  }

  const record: DowngradeRecord = {
    construct: "frame",
    profile: profile.id,
    effect:
      `bordered notice (palette ${init.frame}) rendered as ` +
      (isQuotable(init.children) ? "a blockquote" : "a titled plain section") +
      "; palette and border are not represented",
  };

  const titleParagraph: Paragraph | null = init.title
    ? { type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: init.title }] }] }
    : null;

  if (isQuotable(init.children)) {
    const inner = (titleParagraph ? [titleParagraph, ...init.children] : init.children) as BlockContent[];
    return { content: [{ type: "blockquote", children: inner }], transforms: [record] };
  }

  const out: BiomdContent[] = [];
  if (titleParagraph) out.push(titleParagraph);
  out.push(...(init.children as BiomdContent[]));
  return { content: out, transforms: [record] };
}

/**
 * A closing credit block.
 *
 * Native: `::: signature`. Downgraded: the paragraphs unchanged — which is
 * exactly what the renderer produces for the directive today, minus the
 * end-alignment treatment.
 */
export function downgradeSignature(
  profile: TargetProfile,
  children: Paragraph[],
): Downgrade<BiomdContent[]> {
  if (profile.supports.signatureDirective) {
    return { content: [makeSignature({ children, profile })], transforms: [] };
  }
  return {
    content: [...children],
    transforms: [
      {
        construct: "signature",
        profile: profile.id,
        effect: "closing credit rendered as ordinary paragraphs; distinct end-alignment is not represented",
      },
    ],
  };
}

/**
 * Whether a meaningful column separator can be represented.
 *
 * Native: `divider: true`. Downgraded: the property is omitted entirely. It is
 * not merely ignored by the current renderer — the literal text becomes a bogus
 * first column — so there is no safe partial emission.
 */
export function resolveDivider(
  profile: TargetProfile,
  sourceHasDivider: boolean,
): { divider: true | undefined; transforms: DowngradeRecord[] } {
  if (!sourceHasDivider) return { divider: undefined, transforms: [] };
  if (profile.supports.columnsDivider) return { divider: true, transforms: [] };
  return {
    divider: undefined,
    transforms: [
      {
        construct: "columns.divider",
        profile: profile.id,
        effect: "meaningful column separator omitted; emitting it would corrupt the rendered layout",
      },
    ],
  };
}

/**
 * Whether zero-padded ordered-list markers survive.
 *
 * There is no way to express `01.` in mdast, and the renderer parses it as an
 * ordinary `start: 1`, so the padding is dropped either way. This records the
 * loss rather than pretending it did not happen.
 */
export function resolveListMarkerPadding(
  profile: TargetProfile,
  sourceHadPadding: boolean,
): DowngradeRecord[] {
  if (!sourceHadPadding || profile.supports.leadingZeroListMarkers) return [];
  return [
    {
      construct: "leading-zero-marker",
      profile: profile.id,
      effect: "zero-padded ordered-list markers (01., 02.) emitted unpadded; the renderer does not preserve padding",
    },
  ];
}
