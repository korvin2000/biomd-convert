/**
 * BioMD Lite 1.6 abstract syntax tree.
 *
 * The content model of `Biography-Markup.md` §4.1 is encoded in these types, so
 * that a structurally invalid document is a compile error rather than a lint
 * finding. Ordinary block content reuses mdast; only the ten directive
 * constructs are bespoke.
 *
 * Emission of `frame`, `signature` and the `columns.divider` property is gated
 * by a TargetProfile (see profile.ts) rather than removed from the type system:
 * the reader must still be able to represent a document that contains them, and
 * the validator must be able to diagnose them precisely.
 */
import type { BlockContent, DefinitionContent, List, Paragraph, RootContent } from "mdast";

/** `Biography-Markup.md` §7.2 — position semantics for a standalone image. */
export type ImagePosition = "left" | "right" | "center" | "full";
/** §7.3 — size semantics. */
export type ImageSize = "small" | "medium" | "large" | "full";
/** §6 — bounded horizontal alignment. */
export type AlignPosition = "left" | "center" | "right";
/** §7.1 — decorative picture frame. Distinct from the `::: frame` directive. */
export type PictureFrame = "none" | "curl" | "mat" | "shadow" | "oval";
/** §12 — semantic frame palette token. */
export type FramePalette = "black" | "red" | "gold" | "white";
/** §9 — document presentation mode. */
export type DocumentMode = "link" | "embed";
/** §8 — image group column count. */
export type ImagesColumns = 2 | 3 | 4;

/** Provenance carried by every emitted node. Never serialized. */
export interface BiomdProvenance {
  /** IR item ids this node was lowered from. */
  sourceIds?: string[];
  /** Decision ids that produced it. */
  decisionIds?: string[];
}

interface BiomdBase {
  data?: BiomdProvenance & Record<string, unknown>;
}

/** §5 — `::: lead`. Body: ordinary Markdown. No properties. */
export interface BiomdLead extends BiomdBase {
  type: "biomdLead";
  children: BlockContent[];
}

/** §6 — `::: align`. Required `position`. Body: bounded Markdown and leaf media. */
export interface BiomdAlign extends BiomdBase {
  type: "biomdAlign";
  position: AlignPosition;
  children: BoundedContent[];
}

/**
 * §7 — `::: image`.
 *
 * `position` and `size` are required when standalone and forbidden when nested
 * inside `images`; `standalone` records which contract applies so the validator
 * and serializer do not have to infer it from the parent.
 */
export interface BiomdImage extends BiomdBase {
  type: "biomdImage";
  src: string;
  standalone: boolean;
  position?: ImagePosition;
  size?: ImageSize;
  alt?: string;
  caption?: string;
  link?: string;
  frame?: PictureFrame;
}

/** §8 — `::: images`. Required `columns`, two or more `image` children. */
export interface BiomdImages extends BiomdBase {
  type: "biomdImages";
  columns: ImagesColumns;
  frame?: PictureFrame;
  children: BiomdImage[];
}

/** §9 — `::: document`. All three properties required, no body. */
export interface BiomdDocument extends BiomdBase {
  type: "biomdDocument";
  src: string;
  title: string;
  mode: DocumentMode;
}

/** §10 — `::: columns`. Exactly two or three `column` children. */
export interface BiomdColumns extends BiomdBase {
  type: "biomdColumns";
  /** Emitted only when the target profile supports it (see profile.ts). */
  divider?: true;
  children: [BiomdColumn, BiomdColumn] | [BiomdColumn, BiomdColumn, BiomdColumn];
}

/** §10 — `::: column`. Body: Markdown and leaf media directives. */
export interface BiomdColumn extends BiomdBase {
  type: "biomdColumn";
  children: BoundedContent[];
}

/** §11 — `::: nav`. Body is exactly one bullet list. */
export interface BiomdNav extends BiomdBase {
  type: "biomdNav";
  title?: string;
  /** Must match the text of exactly one item in `list`. */
  active?: string;
  list: List;
}

/** §12 — `::: frame`. Required palette token. Gated by target profile. */
export interface BiomdFrame extends BiomdBase {
  type: "biomdFrame";
  frame: FramePalette;
  title?: string;
  children: BoundedContent[];
}

/** §13 — `::: signature`. Short paragraphs only. Gated by target profile. */
export interface BiomdSignature extends BiomdBase {
  type: "biomdSignature";
  children: Paragraph[];
}

/** Any BioMD directive node. */
export type BiomdDirective =
  | BiomdLead
  | BiomdAlign
  | BiomdImage
  | BiomdImages
  | BiomdDocument
  | BiomdColumns
  | BiomdColumn
  | BiomdNav
  | BiomdFrame
  | BiomdSignature;

export type BiomdDirectiveType = BiomdDirective["type"];

/**
 * Content permitted inside `align`, `column` and `frame`.
 *
 * §4.1 nesting constraints: a `column` MUST NOT contain `columns`; an `align`
 * MUST NOT contain `columns` or `nav`; a `frame` MUST NOT contain `frame` or
 * `nav`. The union below excludes `columns` and `nav` outright, which is the
 * intersection of the three rules and therefore safe for all of them — a
 * slightly stricter type than the spec demands, in exchange for one union.
 * (`nav` inside a `column` is legal per spec but is rejected by the validator
 * only, not the type, to keep this union shared.)
 */
export type BoundedContent = BlockContent | DefinitionContent | BiomdLeafDirective;

/** Directives permitted in a bounded context (leaf media only). */
export type BiomdLeafDirective = BiomdImage | BiomdImages | BiomdDocument;

/** Top-level document content. */
export type BiomdContent = RootContent | BiomdDirective;

/** A whole `.bio.md` document. */
export interface BiomdRoot extends BiomdBase {
  type: "root";
  children: BiomdContent[];
}

// mdast module augmentation: makes the directive nodes assignable wherever
// mdast content is expected, and gives `mdast-util-to-markdown` the node names.
declare module "mdast" {
  interface RootContentMap {
    biomdLead: BiomdLead;
    biomdAlign: BiomdAlign;
    biomdImage: BiomdImage;
    biomdImages: BiomdImages;
    biomdDocument: BiomdDocument;
    biomdColumns: BiomdColumns;
    biomdColumn: BiomdColumn;
    biomdNav: BiomdNav;
    biomdFrame: BiomdFrame;
    biomdSignature: BiomdSignature;
  }
  interface BlockContentMap {
    biomdLead: BiomdLead;
    biomdAlign: BiomdAlign;
    biomdImage: BiomdImage;
    biomdImages: BiomdImages;
    biomdDocument: BiomdDocument;
    biomdColumns: BiomdColumns;
    biomdNav: BiomdNav;
    biomdFrame: BiomdFrame;
    biomdSignature: BiomdSignature;
  }
}

export const DIRECTIVE_TYPES: readonly BiomdDirectiveType[] = [
  "biomdLead",
  "biomdAlign",
  "biomdImage",
  "biomdImages",
  "biomdDocument",
  "biomdColumns",
  "biomdColumn",
  "biomdNav",
  "biomdFrame",
  "biomdSignature",
] as const;

/** Maps an AST node type to the `::: name` written in the document. */
export const DIRECTIVE_NAME: Record<BiomdDirectiveType, string> = {
  biomdLead: "lead",
  biomdAlign: "align",
  biomdImage: "image",
  biomdImages: "images",
  biomdDocument: "document",
  biomdColumns: "columns",
  biomdColumn: "column",
  biomdNav: "nav",
  biomdFrame: "frame",
  biomdSignature: "signature",
};

/** Inverse of {@link DIRECTIVE_NAME}. */
export const DIRECTIVE_TYPE_BY_NAME: Record<string, BiomdDirectiveType> = Object.fromEntries(
  Object.entries(DIRECTIVE_NAME).map(([type, name]) => [name, type as BiomdDirectiveType]),
) as Record<string, BiomdDirectiveType>;

/** Property names each directive documents, in canonical emission order (§4.1). */
export const DIRECTIVE_PROPERTIES: Record<BiomdDirectiveType, readonly string[]> = {
  biomdLead: [],
  biomdAlign: ["position"],
  biomdImage: ["src", "position", "size", "alt", "caption", "link", "frame"],
  biomdImages: ["columns", "frame"],
  biomdDocument: ["src", "title", "mode"],
  biomdColumns: ["divider"],
  biomdColumn: [],
  biomdNav: ["title", "active"],
  biomdFrame: ["frame", "title"],
  biomdSignature: [],
};

export const IMAGE_POSITIONS: readonly ImagePosition[] = ["left", "right", "center", "full"];
export const IMAGE_SIZES: readonly ImageSize[] = ["small", "medium", "large", "full"];
export const ALIGN_POSITIONS: readonly AlignPosition[] = ["left", "center", "right"];
export const PICTURE_FRAMES: readonly PictureFrame[] = ["none", "curl", "mat", "shadow", "oval"];
export const FRAME_PALETTES: readonly FramePalette[] = ["black", "red", "gold", "white"];
export const DOCUMENT_MODES: readonly DocumentMode[] = ["link", "embed"];
export const IMAGES_COLUMNS: readonly ImagesColumns[] = [2, 3, 4];

export function isBiomdDirective(node: { type: string }): node is BiomdDirective {
  return (DIRECTIVE_TYPES as readonly string[]).includes(node.type);
}
