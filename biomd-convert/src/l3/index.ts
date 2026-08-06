/**
 * L3 — rendered and geometric adjudication.
 *
 * Diagnostic-only, exactly like `src/eval`. `convert-core` must never import
 * anything from here, and nothing here may import `convert-core`: an instrument
 * the thing it measures can reach is not an instrument.
 */
export { renderBiomd, renderInlineRaw, resolveTarget, type RenderOptions, type RenderResult } from "./render.js";
export {
  alignmentVerdict,
  boxAlignment,
  isDistinctive,
  lanesOf,
  normalizeTextAlign,
  overflowsHorizontally,
  proseAlignment,
  readingOrder,
  resolveAlignment,
  type AlignEvidence,
  type Alignment,
  type AlignmentVerdict,
  type Box,
} from "./geometry.js";
export { L3Probe, type BlockGeometry, type PageProbe, type ProbeOptions } from "./probe.js";
export {
  compareRendered,
  type AlignmentEvidence,
  type CompareInput,
  type L3Finding,
  type L3Result,
} from "./compare.js";
