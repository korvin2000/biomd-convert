/**
 * BioMD AST → `.bio.md` text.
 *
 * The single owner of every `:::` fence, property line and Markdown escape in
 * the system. Nothing else in the converter concatenates output strings.
 *
 * Markdown-level correctness (escaping, table padding, list markers, footnote
 * definitions, tight/loose lists) is delegated to `mdast-util-to-markdown`;
 * this module contributes one handler per directive plus the BioMD-specific
 * escaping rules.
 */
import { toMarkdown, type Options as ToMarkdownOptions, type State } from "mdast-util-to-markdown";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { gfmFootnoteToMarkdown } from "mdast-util-gfm-footnote";
import type { Nodes, Parents } from "mdast";
import { DEFAULT_PROFILE, type TargetProfile } from "./profile.js";
import {
  DIRECTIVE_NAME,
  type BiomdAlign,
  type BiomdColumn,
  type BiomdColumns,
  type BiomdDirective,
  type BiomdDocument,
  type BiomdFrame,
  type BiomdImage,
  type BiomdImages,
  type BiomdLead,
  type BiomdNav,
  type BiomdRoot,
  type BiomdSignature,
} from "./types.js";

export interface SerializeOptions {
  profile?: TargetProfile;
}

type AnyHandler = (node: never, parent: unknown, state: State, info: unknown) => string;

/** A `key: value` property line. Order is fixed by DIRECTIVE_PROPERTIES. */
type Prop = readonly [name: string, value: string | undefined];

function propertyLines(props: readonly Prop[]): string[] {
  const lines: string[] = [];
  for (const [name, value] of props) {
    if (value === undefined || value === "") continue;
    lines.push(`${name}: ${value}`);
  }
  return lines;
}

/**
 * Assemble a directive.
 *
 * Layout is deliberately uniform:
 *
 *   ::: name
 *   prop: value          ← zero or more
 *                        ← blank line, ALWAYS, when a body follows
 *   body
 *                        ← blank line before the closing fence
 *   :::
 *
 * The blank line after the property block is not cosmetic. The renderer ends an
 * `align`/`nav` property header at the first line that does not parse as
 * `key: value`, so a body whose first line reads `Дата: …` would otherwise be
 * silently consumed as a bogus property and vanish. Emitting the separator
 * unconditionally costs one newline and removes the whole class of failure.
 */
function assemble(name: string, props: readonly Prop[], body: string | null): string {
  const lines = [`::: ${name}`, ...propertyLines(props)];
  if (body !== null && body.length > 0) {
    lines.push("", body, "");
  }
  lines.push(":::");
  return lines.join("\n");
}

/**
 * Serialize a directive's block children through the standard flow machinery.
 *
 * The casts are confined to this one seam: `containerFlow` is typed against
 * mdast's closed node union, which by construction cannot include the custom
 * directive nodes registered by module augmentation.
 */
function flowChildren(state: State, node: unknown, info: unknown): string {
  const tracker = state.createTracker(info as Parameters<State["createTracker"]>[0]);
  return tracker.move(state.containerFlow(node as never, tracker.current()));
}

/** Wrap arbitrary nodes in a synthetic parent so containerFlow can be reused. */
function flowNodes(state: State, children: readonly Nodes[], info: unknown): string {
  return flowChildren(state, { type: "root", children }, info);
}

function makeHandlers(profile: TargetProfile): Record<string, AnyHandler> {
  const enter = (state: State, node: BiomdDirective) => state.enter(DIRECTIVE_NAME[node.type] as never);

  return {
    biomdLead: ((node: BiomdLead, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble("lead", [], flowChildren(state, node as unknown as Parents, info));
      exit();
      return out;
    }) as AnyHandler,

    biomdAlign: ((node: BiomdAlign, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble(
        "align",
        [["position", node.position]],
        flowChildren(state, node as unknown as Parents, info),
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdImage: ((node: BiomdImage, _p: unknown, state: State) => {
      const exit = enter(state, node);
      const out = assemble(
        "image",
        [
          ["src", node.src],
          ["position", node.position],
          ["size", node.size],
          ["alt", node.alt],
          ["caption", node.caption],
          ["link", node.link],
          ["frame", node.frame],
        ],
        null,
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdImages: ((node: BiomdImages, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble(
        "images",
        [
          ["columns", String(node.columns)],
          ["frame", node.frame],
        ],
        flowNodes(state, node.children as unknown as Nodes[], info),
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdDocument: ((node: BiomdDocument, _p: unknown, state: State) => {
      const exit = enter(state, node);
      const out = assemble(
        "document",
        [
          ["src", node.src],
          ["title", node.title],
          ["mode", node.mode],
        ],
        null,
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdColumns: ((node: BiomdColumns, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      // `divider` is only reachable when the profile permits it; makeColumns()
      // refuses to set it otherwise.
      const props: Prop[] = [];
      if (node.divider === true && profile.supports.columnsDivider) props.push(["divider", "true"]);
      const out = assemble("columns", props, flowNodes(state, node.children as unknown as Nodes[], info));
      exit();
      return out;
    }) as AnyHandler,

    biomdColumn: ((node: BiomdColumn, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble("column", [], flowChildren(state, node as unknown as Parents, info));
      exit();
      return out;
    }) as AnyHandler,

    biomdNav: ((node: BiomdNav, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble(
        "nav",
        [
          ["title", node.title],
          ["active", node.active],
        ],
        flowNodes(state, [node.list], info),
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdFrame: ((node: BiomdFrame, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble(
        "frame",
        [
          ["frame", node.frame],
          ["title", node.title],
        ],
        flowChildren(state, node as unknown as Parents, info),
      );
      exit();
      return out;
    }) as AnyHandler,

    biomdSignature: ((node: BiomdSignature, _p: unknown, state: State, info: unknown) => {
      const exit = enter(state, node);
      const out = assemble("signature", [], flowChildren(state, node as unknown as Parents, info));
      exit();
      return out;
    }) as AnyHandler,
  };
}

/**
 * Escapes that keep literal source text from being re-read as BioMD syntax.
 *
 * A paragraph that legitimately begins with `:::` — legacy prose does contain
 * such runs — must not become a directive fence on the way back in. A leading
 * backslash renders as a literal colon in CommonMark and defeats the renderer's
 * line-anchored `^:::` match.
 */
const BIOMD_UNSAFE: NonNullable<ToMarkdownOptions["unsafe"]> = [
  { atBreak: true, character: ":", after: "::" },
];

export function serialize(root: BiomdRoot, options: SerializeOptions = {}): string {
  const profile = options.profile ?? DEFAULT_PROFILE;

  const out = toMarkdown(root as unknown as Nodes, {
    extensions: [gfmTableToMarkdown(), gfmFootnoteToMarkdown()],
    handlers: makeHandlers(profile) as unknown as ToMarkdownOptions["handlers"],
    unsafe: BIOMD_UNSAFE,
    bullet: "-",
    bulletOther: "*",
    listItemIndent: "one",
    rule: "-",
    ruleRepetition: 3,
    emphasis: "*",
    strong: "*",
    fence: "`",
    fences: true,
    incrementListMarker: true,
    resourceLink: false,
    tightDefinitions: true,
  });

  return normalizeOutput(out);
}

/**
 * Final text normalization.
 *
 * `toMarkdown` already guarantees a single trailing newline and no trailing
 * whitespace on content lines; this collapses the extra blank lines that
 * directive assembly can introduce at nesting boundaries, so output is stable
 * and diffable.
 */
function normalizeOutput(value: string): string {
  const collapsed = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n");
  return collapsed.endsWith("\n") ? collapsed : `${collapsed}\n`;
}
