/**
 * BioMD Lite 1.6 abstract syntax tree.
 *
 * The content model of **`BioMD-Reference.md` §2** is encoded in these types, so
 * that a structurally invalid document is a compile error rather than a lint
 * finding. Ordinary block content reuses mdast; only the ten directive
 * constructs are bespoke.
 *
 * `BioMD-Reference.md` is the baseline profile and is deliberately more
 * permissive than the older `Biography-Markup.md`, which remains the fallback
 * for anything the short reference leaves unstated. Where the two differ the
 * short reference governs; the `§` numbers below name which document they come
 * from, because the two numbering schemes do not correspond.
 *
 * Emission of `frame`, `signature` and the `columns` / `columns.divider`
 * properties is gated by a TargetProfile (see profile.ts) rather than removed
 * from the type system: the reader must still be able to represent a document
 * that contains them, and the validator must be able to diagnose them precisely.
 */
import type { BlockContent, DefinitionContent, List, Paragraph, RootContent } from "mdast";

/** Reference §3 — position semantics for a standalone image. */
export type ImagePosition = "left" | "right" | "center" | "full";
/** Reference §3 — size semantics. */
export type ImageSize = "small" | "medium" | "large" | "full";
/** Reference §3 — bounded horizontal alignment. */
export type AlignPosition = "left" | "center" | "right";
/**
 * Reference §3 — decorative picture frame. Distinct from the `::: frame`
 * directive: "Image `frame:` and `::: frame` share theme concepts but differ in
 * scope."
 *
 * The revised reference gives the picture frame the palette tokens as well
 * (`curl|none|mat|black|white|red|gold`), so a matted photograph and a black
 * bordered one are both expressible. `shadow` and `oval` predate it and are
 * still accepted so that documents written against `Biography-Markup.md` §7.1
 * read back unchanged; nothing emits them.
 */
export type PictureFrame =
  | "curl"
  | "none"
  | "mat"
  | "black"
  | "white"
  | "red"
  | "gold"
  /** Legacy, pre-reference: accepted on read, never emitted. */
  | "shadow"
  | "oval";
/** Reference §3 — semantic frame palette token; absent means `gold`. */
export type FramePalette = "black" | "red" | "gold" | "white";
/** Reference §3 — document presentation mode. */
export type DocumentMode = "link" | "embed";
/** Reference §3 — image group column count. */
export type ImagesColumns = 2 | 3 | 4;
/**
 * Reference §3 — declared track count of a `::: columns`.
 *
 * Optional: "Legacy/pre-1.5 form may omit `columns` for 2–3 children." Emission
 * is profile-gated, because the current target does not strip a property header
 * inside `columns` and would promote the line to a synthetic first column.
 */
export type ColumnsCount = 2 | 3 | 4;

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

/**
 * Reference §2, §3 — `::: columns`. Two to four `column` children.
 *
 * The reference states the arity twice and consistently: §2's required column
 * is "≥2 `column`", §3's optional `columns` property is `2|3|4`. Four was
 * previously refused by this type, which made a legal four-track grid a build
 * error rather than a layout decision.
 */
export interface BiomdColumns extends BiomdBase {
  type: "biomdColumns";
  /**
   * Declared track count. Optional — "Legacy/pre-1.5 form may omit `columns`
   * for 2–3 children."
   *
   * Emitted only when the target profile supports it, for the same reason as
   * {@link BiomdColumns.divider}: the current renderer does not strip a property
   * header inside `columns`, so the line becomes a synthetic first column.
   */
  columns?: ColumnsCount;
  /** Emitted only when the target profile supports it (see profile.ts). */
  divider?: true;
  children: BiomdColumn[];
}

/** Reference §2 — `::: column`. Body: Markdown, leaf media, `align` and `nav`. */
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
 * Reference §2 nesting: a `column` MUST NOT contain `columns`; an `align` MUST
 * NOT contain `columns` or `nav`; a `frame` MUST NOT contain `frame` or `nav`.
 *
 * Those three rules differ per container, so they are **not** encoded here.
 * `BlockContent` is augmented below with every directive, so this union already
 * admits all of them and the per-container constraint is enforced where it can
 * be stated exactly — `rejectNested()` in the builders, and `validate()` for
 * documents that were read rather than built. An earlier comment here claimed
 * the union excluded `columns` and `nav`; it never did, and believing it would
 * mean trusting a check that does not exist.
 *
 * Two consequences of reading the reference exactly, both previously blocked:
 * `nav` inside a `column` is legal, and `frame` inside an `align` is legal —
 * pointless, since a frame is full-width, but not an error. See §2's note: the
 * intended shape is `frame` wrapping `align`.
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

/** Property names each directive documents, in canonical emission order (Reference §2). */
export const DIRECTIVE_PROPERTIES: Record<BiomdDirectiveType, readonly string[]> = {
  biomdLead: [],
  biomdAlign: ["position"],
  biomdImage: ["src", "position", "size", "alt", "caption", "link", "frame"],
  biomdImages: ["columns", "frame"],
  biomdDocument: ["src", "title", "mode"],
  biomdColumns: ["columns", "divider"],
  biomdColumn: [],
  biomdNav: ["title", "active"],
  biomdFrame: ["frame", "title"],
  biomdSignature: [],
};

export const IMAGE_POSITIONS: readonly ImagePosition[] = ["left", "right", "center", "full"];
export const IMAGE_SIZES: readonly ImageSize[] = ["small", "medium", "large", "full"];
export const ALIGN_POSITIONS: readonly AlignPosition[] = ["left", "center", "right"];
/**
 * Reference §3's seven tokens first, then the two legacy ones.
 *
 * Order matters only for the message a rejected value produces, and leading
 * with the reference's own list keeps that message a quotation.
 */
export const PICTURE_FRAMES: readonly PictureFrame[] = [
  "curl",
  "none",
  "mat",
  "black",
  "white",
  "red",
  "gold",
  "shadow",
  "oval",
];
export const FRAME_PALETTES: readonly FramePalette[] = ["black", "red", "gold", "white"];
export const DOCUMENT_MODES: readonly DocumentMode[] = ["link", "embed"];
export const IMAGES_COLUMNS: readonly ImagesColumns[] = [2, 3, 4];
export const COLUMNS_COUNTS: readonly ColumnsCount[] = [2, 3, 4];
/** Reference §2 — a `::: columns` holds at least this many `column` children. */
export const COLUMNS_MIN_CHILDREN = 2;
/** Reference §3 — …and at most this many, matching the `columns` property's enum. */
export const COLUMNS_MAX_CHILDREN = 4;

export function isBiomdDirective(node: { type: string }): node is BiomdDirective {
  return (DIRECTIVE_TYPES as readonly string[]).includes(node.type);
}
