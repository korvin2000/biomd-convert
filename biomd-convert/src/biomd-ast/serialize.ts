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
import { defaultHandlers, toMarkdown, type Options as ToMarkdownOptions, type State } from "mdast-util-to-markdown";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { gfmFootnoteToMarkdown } from "mdast-util-gfm-footnote";
import type { ListItem, Nodes, Parents } from "mdast";
import { DEFAULT_PROFILE, type TargetProfile } from "./profile.js";
import {
  DIRECTIVE_NAME,
  type BiomdAlign,
  type BiomdAnchor,
  type BiomdHighlight,
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
      // `columns` and `divider` are only reachable when the profile permits
      // them; makeColumns() refuses to set either otherwise.
      const props: Prop[] = [];
      if (node.columns !== undefined && profile.supports.columnsProperty) {
        props.push(["columns", String(node.columns)]);
      }
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

    // The one directive with no fence. `::anchor{#id}` is a whole line and
    // nothing else; `containerFlow` supplies the blank line on either side, so
    // the marker can never be absorbed into the paragraph that follows it.
    // Nothing is escaped here and nothing needs to be: `makeAnchor` has already
    // refused every character that could end the shorthand early.
    biomdAnchor: ((node: BiomdAnchor) => `::anchor{#${node.identifier}}`) as AnyHandler,

    // The one BioMD-only phrasing mark. `state.containerPhrasing` runs the
    // ordinary inline machinery on the children, so escaping, nesting and word
    // boundaries behave exactly as they do inside `**` or `*`.
    biomdHighlight: ((node: BiomdHighlight, _p: unknown, state: State, info: unknown) => {
      const exit = state.enter("emphasis" as never);
      const inner = state.containerPhrasing(node as unknown as Parents, {
        ...(info as Parameters<State["containerPhrasing"]>[1]),
        before: "=",
        after: "=",
      });
      exit();
      return `==${inner}==`;
    }) as AnyHandler,

    /**
     * An ordered item whose marker the source wrote down keeps that marker.
     *
     * mdast has nowhere to put `01.` — a list carries one `start` and the
     * default handler counts up from it — so a numbering that pads, or that
     * skips a number, cannot survive a round trip through `start + index`.
     * `Biography-Markup.md` §3.4 forbids exactly that rewriting, so the token
     * travels on the item as `data.biomdMarker` and is written verbatim.
     *
     * The default handler does everything else — indentation, continuation
     * lines, the whole container flow — and takes the marker through
     * `state.bulletCurrent`, which it uses **as given** for an unordered
     * parent. Presenting the parent as unordered for the length of this one
     * call is what stops it prefixing its own number to the token.
     */
    listItem: ((node: ListItem, parent: unknown, state: State, info: unknown) => {
      const marker = (node.data as { biomdMarker?: unknown } | undefined)?.biomdMarker;
      const fallback = defaultHandlers.listItem as unknown as AnyHandler;
      const item = node as never;
      if (typeof marker !== "string" || marker === "") return fallback(item, parent, state, info);
      const outer = state.bulletCurrent;
      state.bulletCurrent = marker;
      try {
        return fallback(item, { ...(parent as { type: string }), ordered: false }, state, info);
      } finally {
        state.bulletCurrent = outer;
      }
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
 *
 * The guard is on **two** colons, not three, because `::anchor{#x}` is a
 * directive too and is one colon shorter. Widening it costs nothing on this
 * corpus — no line in the 22 produced or 22 reference documents begins with
 * `::` — and closes the case where source prose would be read back as a marker.
 */
const BIOMD_UNSAFE: NonNullable<ToMarkdownOptions["unsafe"]> = [
  { atBreak: true, character: ":", after: ":" },
];

export function serialize(root: BiomdRoot, options: SerializeOptions = {}): string {
  const profile = options.profile ?? DEFAULT_PROFILE;

  const out = toMarkdown(root as unknown as Nodes, {
    // `tablePipeAlign` pads every cell to the widest one in its column. A legacy
    // resource table has one 300-character cell and twenty-five short ones, so
    // padding turns a readable table into 300-character lines of spaces. The
    // rendered result is identical either way.
    extensions: [gfmTableToMarkdown({ tablePipeAlign: false }), gfmFootnoteToMarkdown()],
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
    // Always `[label](target)`, never the `<https://…>` autolink shorthand.
    // The autolink is a CommonMark spelling the BioMD renderer does not
    // recognise, so a link whose label happens to equal its href — the whole
    // "источники" section of a legacy page — silently stopped being a link.
    // A `mailto:` autolink is worse: it drops the scheme from the output text.
    resourceLink: true,
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
