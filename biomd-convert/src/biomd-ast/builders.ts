/**
 * Validating constructors.
 *
 * Every directive node is created through one of these. They enforce the
 * required-property and content-model rules of `Biography-Markup.md` §4.1 at
 * construction time, so an invalid tree cannot reach the serializer. This is
 * the "make invalid states unrepresentable" principle where the type system
 * alone cannot reach — value enumerations, cardinality, cross-property
 * requirements and target-profile capability.
 */
import type { BlockContent, List, ListItem, Paragraph } from "mdast";
import { DEFAULT_PROFILE, type TargetProfile } from "./profile.js";
import { isSingleLine, normalizeLabel, plainText } from "./text.js";
import {
  ALIGN_POSITIONS,
  type AlignPosition,
  type BiomdAlign,
  type BiomdColumn,
  type BiomdColumns,
  COLUMNS_COUNTS,
  COLUMNS_MAX_CHILDREN,
  COLUMNS_MIN_CHILDREN,
  type ColumnsCount,
  type BiomdDocument,
  type BiomdFrame,
  type BiomdImage,
  type BiomdImages,
  type BiomdLead,
  type BiomdNav,
  type BiomdSignature,
  type BoundedContent,
  DOCUMENT_MODES,
  type DocumentMode,
  FRAME_PALETTES,
  type FramePalette,
  IMAGE_POSITIONS,
  IMAGE_SIZES,
  IMAGES_COLUMNS,
  type ImagePosition,
  type ImageSize,
  type ImagesColumns,
  PICTURE_FRAMES,
  type PictureFrame,
} from "./types.js";

export class BiomdBuildError extends Error {
  readonly directive: string;
  constructor(directive: string, message: string) {
    super(`::: ${directive} — ${message}`);
    this.name = "BiomdBuildError";
    this.directive = directive;
  }
}

function requireValue(directive: string, prop: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BiomdBuildError(directive, `property ${JSON.stringify(prop)} is required and must be non-empty`);
  }
  if (!isSingleLine(value)) {
    throw new BiomdBuildError(
      directive,
      `property ${JSON.stringify(prop)} must be a single line (a value is the remainder of its line, §4)`,
    );
  }
  return value.trim();
}

function optionalValue(directive: string, prop: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new BiomdBuildError(directive, `property ${JSON.stringify(prop)} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!isSingleLine(trimmed)) {
    throw new BiomdBuildError(directive, `property ${JSON.stringify(prop)} must be a single line`);
  }
  return trimmed;
}

function requireEnum<T extends string | number>(
  directive: string,
  prop: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw new BiomdBuildError(
      directive,
      `property ${JSON.stringify(prop)} must be one of ${allowed.map(String).join(" | ")}; received ${JSON.stringify(value)}`,
    );
  }
  return value as T;
}

function optionalEnum<T extends string | number>(
  directive: string,
  prop: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return requireEnum(directive, prop, value, allowed);
}

function requireNonEmptyChildren(directive: string, children: readonly unknown[]): void {
  if (children.length === 0) {
    throw new BiomdBuildError(directive, "body must not be empty");
  }
}

/**
 * Reference §2 nesting: `align` must not contain `columns` or `nav`; `frame`
 * must not contain `frame` or `nav`; `column` must not contain `columns`.
 *
 * Each container passes its own forbidden list. Nothing is forbidden everywhere,
 * which is why the constraint cannot live in the `BoundedContent` type.
 */
function rejectNested(directive: string, children: readonly BoundedContent[], forbidden: readonly string[]): void {
  for (const child of children) {
    if (forbidden.includes((child as { type: string }).type)) {
      throw new BiomdBuildError(
        directive,
        `must not contain ${JSON.stringify((child as { type: string }).type)} (§4.1 nesting constraints)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// lead
// ---------------------------------------------------------------------------

export function makeLead(children: BlockContent[]): BiomdLead {
  requireNonEmptyChildren("lead", children);
  return { type: "biomdLead", children };
}

// ---------------------------------------------------------------------------
// align
// ---------------------------------------------------------------------------

export interface AlignInit {
  position: AlignPosition | string;
  children: BoundedContent[];
}

/**
 * `::: align` — Reference §3.
 *
 * `columns` and `nav` are refused by name; a `frame` child is **accepted**. It
 * is a legal construct that accomplishes nothing — a frame takes the full width
 * of its container, so there is no slack for the alignment to act on — and
 * §2 records the intended inversion, `frame` wrapping `align`. Refusing it here
 * would reject a document the format permits, and rewriting it would move a
 * reader's content without being asked; the validator advises instead.
 */
export function makeAlign(init: AlignInit): BiomdAlign {
  const position = requireEnum("align", "position", init.position, ALIGN_POSITIONS);
  requireNonEmptyChildren("align", init.children);
  rejectNested("align", init.children, ["biomdColumns", "biomdNav", "biomdColumn"]);
  return { type: "biomdAlign", position, children: init.children };
}

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

export interface ImageInit {
  src: string;
  position?: ImagePosition | string;
  size?: ImageSize | string;
  alt?: string;
  caption?: string;
  link?: string;
  frame?: PictureFrame | string;
}

/**
 * Standalone `::: image` — `position` and `size` are required (§4.1).
 */
export function makeImage(init: ImageInit): BiomdImage {
  const node: BiomdImage = {
    type: "biomdImage",
    src: requireValue("image", "src", init.src),
    standalone: true,
    position: requireEnum("image", "position", init.position, IMAGE_POSITIONS),
    size: requireEnum("image", "size", init.size, IMAGE_SIZES),
  };
  assignImageOptionals(node, init);
  return node;
}

/**
 * `::: image` nested inside `::: images` — only `src` is required, and
 * `position`/`size` are not permitted because the group controls layout.
 */
export function makeGroupedImage(init: ImageInit): BiomdImage {
  if (init.position !== undefined) {
    throw new BiomdBuildError("image", "`position` is not permitted on an image inside `images` (§4.1)");
  }
  if (init.size !== undefined) {
    throw new BiomdBuildError("image", "`size` is not permitted on an image inside `images` (§4.1)");
  }
  const node: BiomdImage = {
    type: "biomdImage",
    src: requireValue("image", "src", init.src),
    standalone: false,
  };
  assignImageOptionals(node, init);
  return node;
}

function assignImageOptionals(node: BiomdImage, init: ImageInit): void {
  const alt = optionalValue("image", "alt", init.alt);
  const caption = optionalValue("image", "caption", init.caption);
  const link = optionalValue("image", "link", init.link);
  const frame = optionalEnum("image", "frame", init.frame, PICTURE_FRAMES);
  if (alt !== undefined) node.alt = alt;
  if (caption !== undefined) node.caption = caption;
  if (link !== undefined) node.link = link;
  if (frame !== undefined) node.frame = frame;
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

export interface ImagesInit {
  columns: ImagesColumns | number;
  frame?: PictureFrame | string;
  children: BiomdImage[];
}

export function makeImages(init: ImagesInit): BiomdImages {
  const columns = requireEnum("images", "columns", init.columns, IMAGES_COLUMNS);
  if (init.children.length < 2) {
    throw new BiomdBuildError("images", `requires two or more image children, received ${init.children.length} (§4.1)`);
  }
  for (const child of init.children) {
    if (child.type !== "biomdImage") {
      throw new BiomdBuildError("images", `contains only image children; found ${JSON.stringify(child)}`);
    }
    if (child.standalone) {
      throw new BiomdBuildError(
        "images",
        "child images must be built with makeGroupedImage() — a grouped image carries no position/size",
      );
    }
  }
  const node: BiomdImages = { type: "biomdImages", columns, children: init.children };
  const frame = optionalEnum("images", "frame", init.frame, PICTURE_FRAMES);
  if (frame !== undefined) node.frame = frame;
  return node;
}

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export interface DocumentInit {
  src: string;
  title: string;
  mode: DocumentMode | string;
}

export function makeDocument(init: DocumentInit): BiomdDocument {
  return {
    type: "biomdDocument",
    src: requireValue("document", "src", init.src),
    title: requireValue("document", "title", init.title),
    mode: requireEnum("document", "mode", init.mode, DOCUMENT_MODES),
  };
}

// ---------------------------------------------------------------------------
// columns / column
// ---------------------------------------------------------------------------

/**
 * A `column` may be empty; every other bounded directive may not.
 *
 * A column is the one construct whose emptiness carries meaning. It is a *track
 * position*, and in a grid where thirty rows pair a title with its cover art,
 * the five rows that have no cover still need their title in the left track —
 * otherwise those five titles run full-width and stop lining up with the rest.
 * The empty right column is what holds the place.
 *
 * §9.1's "leave a trailing incomplete row ragged; do not pad it with empty
 * columns" is a different case: it governs a *trailing* row of a multi-child
 * grid, where padding invents a track the source never had. Here the source
 * itself has an empty cell, so the empty column reports the grid rather than
 * padding it. The references settle it — `goya2` emits five of them and
 * validates with zero errors — and `validate` accepts them, so only this builder
 * was stricter than both the spec and the target.
 */
export function makeColumn(children: BoundedContent[]): BiomdColumn {
  rejectNested("column", children, ["biomdColumns", "biomdColumn"]);
  return { type: "biomdColumn", children };
}

export interface ColumnsInit {
  children: BiomdColumn[];
  /** Declared track count (Reference §3). Omit for the legacy 2–3-child form. */
  columns?: ColumnsCount | number;
  divider?: boolean;
  profile?: TargetProfile;
}

export function makeColumns(init: ColumnsInit): BiomdColumns {
  const profile = init.profile ?? DEFAULT_PROFILE;
  const { children } = init;
  if (children.length < COLUMNS_MIN_CHILDREN || children.length > COLUMNS_MAX_CHILDREN) {
    throw new BiomdBuildError(
      "columns",
      `requires between ${COLUMNS_MIN_CHILDREN} and ${COLUMNS_MAX_CHILDREN} column children, ` +
        `received ${children.length} (Reference §2 "≥2 column", §3 "columns: 2|3|4")`,
    );
  }
  for (const child of children) {
    if (child.type !== "biomdColumn") {
      throw new BiomdBuildError("columns", "contains only column children (Reference §2)");
    }
  }
  const node: BiomdColumns = {
    type: "biomdColumns",
    children,
  };
  if (init.columns !== undefined) {
    const count = requireEnum("columns", "columns", init.columns, COLUMNS_COUNTS);
    if (count !== children.length) {
      throw new BiomdBuildError(
        "columns",
        `\`columns: ${count}\` disagrees with ${children.length} column children; the property declares ` +
          "the track count and a reader that trusts it would lay the grid out wrongly",
      );
    }
    if (!profile.supports.columnsProperty) {
      throw new BiomdBuildError(
        "columns",
        `target profile ${JSON.stringify(profile.id)} cannot render the \`columns\` property — like ` +
          "`divider`, the line is not stripped and becomes a bogus first column. Omit it; the child " +
          "count already states the arity.",
      );
    }
    node.columns = count;
  }
  if (init.divider === true) {
    if (!profile.supports.columnsDivider) {
      throw new BiomdBuildError(
        "columns",
        `target profile ${JSON.stringify(profile.id)} cannot render \`divider\` — the property text is ` +
          "parsed as a stray markdown run and becomes a bogus first column. Omit it, or emit a thematic " +
          "break instead (see downgrade.ts).",
      );
    }
    node.divider = true;
  }
  // `divider: false` is redundant and invalid in new documents (§10); it is
  // simply never representable here.
  return node;
}

// ---------------------------------------------------------------------------
// nav
// ---------------------------------------------------------------------------

export interface NavInit {
  list: List;
  title?: string;
  active?: string;
}

export function makeNav(init: NavInit): BiomdNav {
  const { list } = init;
  if (!list || list.type !== "list") {
    throw new BiomdBuildError("nav", "body must be a Markdown bullet list (§4.1)");
  }
  if (list.ordered) {
    throw new BiomdBuildError("nav", "navigation list must be a bullet list, not an ordered list (§11)");
  }
  if (list.children.length === 0) {
    throw new BiomdBuildError("nav", "requires one or more navigation items (§4.1)");
  }
  const node: BiomdNav = { type: "biomdNav", list };
  const title = optionalValue("nav", "title", init.title);
  if (title !== undefined) node.title = title;

  const active = optionalValue("nav", "active", init.active);
  if (active !== undefined) {
    const labels = navItemLabels(list);
    const matches = labels.filter((label) => label === normalizeLabel(active));
    if (matches.length !== 1) {
      throw new BiomdBuildError(
        "nav",
        `\`active\` must match exactly one item; ${JSON.stringify(active)} matched ${matches.length} of ` +
          `[${labels.map((l) => JSON.stringify(l)).join(", ")}] (§11)`,
      );
    }
    node.active = active;
  }
  return node;
}

/** Visible labels of a nav list's items, normalized for comparison. */
export function navItemLabels(list: List): string[] {
  return list.children.map((item: ListItem) => normalizeLabel(plainText(item)));
}

// ---------------------------------------------------------------------------
// frame / signature — profile-gated
// ---------------------------------------------------------------------------

export interface FrameInit {
  frame: FramePalette | string;
  title?: string;
  children: BoundedContent[];
  profile?: TargetProfile;
}

export function makeFrame(init: FrameInit): BiomdFrame {
  const profile = init.profile ?? DEFAULT_PROFILE;
  if (!profile.supports.frameDirective) {
    throw new BiomdBuildError(
      "frame",
      `target profile ${JSON.stringify(profile.id)} does not implement the block-level frame directive; ` +
        "it renders as a bare container and loses palette and border semantics. Use downgradeNotice().",
    );
  }
  const frame = requireEnum("frame", "frame", init.frame, FRAME_PALETTES);
  requireNonEmptyChildren("frame", init.children);
  rejectNested("frame", init.children, ["biomdFrame", "biomdNav", "biomdColumns", "biomdColumn"]);
  const node: BiomdFrame = { type: "biomdFrame", frame, children: init.children };
  const title = optionalValue("frame", "title", init.title);
  if (title !== undefined) node.title = title;
  return node;
}

export interface SignatureInit {
  children: Paragraph[];
  profile?: TargetProfile;
}

export function makeSignature(init: SignatureInit): BiomdSignature {
  const profile = init.profile ?? DEFAULT_PROFILE;
  if (!profile.supports.signatureDirective) {
    throw new BiomdBuildError(
      "signature",
      `target profile ${JSON.stringify(profile.id)} does not implement the signature directive; ` +
        "it renders as ordinary stacked paragraphs. Use downgradeSignature().",
    );
  }
  requireNonEmptyChildren("signature", init.children);
  for (const child of init.children) {
    if (child.type !== "paragraph") {
      throw new BiomdBuildError("signature", "should contain only short Markdown paragraphs (§13)");
    }
  }
  return { type: "biomdSignature", children: init.children };
}
