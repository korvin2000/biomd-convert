/**
 * L3 — the diagnostic BioMD renderer.
 *
 * `.bio.md` → deterministic HTML, built from `Biography-Markup.md` and from the
 * target-behaviour model already encoded in `biomd-ast/read.ts`. Its purpose is
 * to make the question L1 and L2 cannot ask answerable: *what does this document
 * look like*, and is the produced layout equal to or better than the source's.
 *
 * Three properties are contracts, asserted in `render.test.ts`:
 *
 *  1. **One code path.** There is a single entry point and no parameter that
 *     distinguishes a produced document from a reference one. Rendering the same
 *     bytes twice — or the same file as each side of a comparison — must give
 *     byte-identical HTML. Without this, every geometric finding is suspect.
 *  2. **Determinism.** No clock, no randomness, no filesystem, no network, no
 *     iteration over an unordered collection. The output is a pure function of
 *     the input string and the options.
 *  3. **The quirks are modelled, not fixed.** `read()` documents where the
 *     target's implementation diverges from the specification; this renderer
 *     reproduces the *consequences* of those divergences rather than quietly
 *     rendering what the author meant. A `divider: true` line inside
 *     `::: columns` is not a property — the target promotes it to a synthetic
 *     first column, and so does this. Rendering the intent instead would hide
 *     exactly the corruption that makes `divider` unemittable.
 *
 * Diagnostic-only. Nothing in `convert-core` may import it; nothing here may
 * import `convert-core`.
 */
import type { Block, DirectiveNode, Inline, ListBlock, TableBlock } from "../eval/blocks.js";
import { readBlocks } from "../eval/blocks.js";

export interface RenderOptions {
  /** `<title>`, and the diagnostic caption in the page header. Default `""`. */
  title?: string;
  /**
   * Resource base for relative targets (§15). Default `/pages`, the spec's own
   * default. Only affects the `data-resolved` diagnostic attribute and `src`;
   * no asset is ever fetched by this module.
   */
  resourceBase?: string;
  /**
   * Draw a thin outline around every block and label its kind. Off by default so
   * geometry is measured on the real layout; on for the human-facing pages,
   * where seeing the block boundaries is the point.
   */
  annotate?: boolean;
}

export interface RenderResult {
  html: string;
  /** Parse notes from `read()` — an unclosed fence, a promoted property line. */
  warnings: Array<{ code: string; message: string; line: number }>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render a whole `.bio.md` document.
 *
 * The one function both sides of every comparison go through. It takes no
 * side, document name, or per-file switch, and that is deliberate: the moment a
 * renderer can be told which side it is rendering, a geometric difference stops
 * being evidence about the documents.
 */
export function renderBiomd(source: string, options: RenderOptions = {}): RenderResult {
  const { blocks, warnings } = readBlocks(source);
  const ctx: Ctx = {
    resourceBase: options.resourceBase ?? "/pages",
    counter: new Map<string, number>(),
  };
  const body = renderBlocks(blocks, ctx, "");
  const title = options.title ?? "";
  const classes = options.annotate === true ? "biomd annotate" : "biomd";

  return {
    html: [
      "<!doctype html>",
      '<html lang="ru">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      `<style>${STYLESHEET}</style>`,
      "</head>",
      "<body>",
      `<article class="${classes}" id="biomd-article">`,
      body,
      "</article>",
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    warnings,
  };
}

interface Ctx {
  resourceBase: string;
  /** Per-path occurrence counters, so `data-l3` is unique and stable. */
  counter: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderBlocks(blocks: readonly Block[], ctx: Ctx, parentPath: string): string {
  return blocks.map((b, i) => renderBlock(b, ctx, `${parentPath}/${kindOf(b)}[${i}]`)).join("\n");
}

function kindOf(block: Block): string {
  return block.kind === "directive" ? block.name : block.kind;
}

/**
 * Attributes every rendered block carries.
 *
 * `data-line` is the whole reason a geometric finding can be acted on: a probe
 * reports "this box is centred and its counterpart is not", and `data-line`
 * turns that into a line in a `.bio.md` file. Without it L3 would produce
 * pictures rather than findings.
 */
function attrs(block: Block, path: string, extra: Record<string, string | undefined> = {}): string {
  const all: Record<string, string | undefined> = {
    "data-l3": path,
    "data-line": String(block.line),
    "data-kind": kindOf(block),
    ...extra,
  };
  return Object.entries(all)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escapeAttr(v as string)}"`)
    .join("");
}

function renderBlock(block: Block, ctx: Ctx, path: string): string {
  switch (block.kind) {
    case "heading": {
      const d = Math.min(Math.max(block.depth, 1), 6);
      return `<h${d}${attrs(block, path)}>${renderInline(block.inline, ctx)}</h${d}>`;
    }
    case "paragraph":
      return `<p${attrs(block, path)}>${renderParagraphLines(block.lines, block.hardBreaks, ctx)}</p>`;
    case "list":
      return renderList(block, ctx, path);
    case "table":
      return renderTable(block, ctx, path);
    case "quote":
      return `<blockquote${attrs(block, path)}>\n${renderBlocks(block.children, ctx, path)}\n</blockquote>`;
    case "break":
      return `<hr${attrs(block, path, { "data-marker": block.marker })}>`;
    case "code":
      return `<pre${attrs(block, path)}><code>${escapeHtml(block.value)}</code></pre>`;
    case "directive":
      return renderDirective(block, ctx, path);
  }
}

/**
 * A paragraph's physical lines.
 *
 * A hard break is rendered as `<br>` and a soft one as a space, which is what
 * CommonMark specifies and — more to the point for this corpus — what makes the
 * difference *visible*. `blocks.ts` keeps `hardBreaks` precisely because a hard
 * break is frequently the only surviving trace of a line the author drew, and a
 * renderer that folded them away would put that back out of reach.
 */
function renderParagraphLines(lines: readonly string[], hardBreaks: readonly boolean[], ctx: Ctx): string {
  const out: string[] = [];
  lines.forEach((line, i) => {
    out.push(renderInlineRaw(line, ctx));
    if (i < lines.length - 1) out.push(hardBreaks[i] === true ? "<br>\n" : " ");
  });
  return out.join("");
}

/**
 * Lists, with nesting reconstructed from `ListItem.depth`.
 *
 * `blocks.ts` flattens a list to depth-tagged items because that is the right
 * model for adjudication. Rendering needs the tree back, so the depths are
 * re-nested here; a depth that jumps by more than one is clamped rather than
 * dropped, since losing an item would be a rendering defect masquerading as a
 * source defect.
 */
function renderList(block: ListBlock, ctx: Ctx, path: string): string {
  const tag = block.ordered ? "ol" : "ul";
  const out: string[] = [`<${tag}${attrs(block, path)}>`];
  let depth = 0;
  block.items.forEach((item, i) => {
    const target = Math.max(0, item.depth);
    while (depth < target) {
      out.push(`<${tag} class="nested">`);
      depth += 1;
    }
    while (depth > target) {
      out.push(`</${tag}>`);
      depth -= 1;
    }
    out.push(`<li data-line="${item.line}" data-l3="${escapeAttr(`${path}/item[${i}]`)}">${renderInline(item.inline, ctx)}</li>`);
  });
  while (depth > 0) {
    out.push(`</${tag}>`);
    depth -= 1;
  }
  out.push(`</${tag}>`);
  return out.join("\n");
}

/**
 * A GFM table, with per-column alignment applied.
 *
 * Cell coordinates are emitted as `data-cell="r,c"` so a geometric finding can
 * name a cell the same way L2 does. A table with an entirely empty header row
 * is marked rather than hidden: 21 of the ledger's ceiling findings are exactly
 * that shape, and seeing an empty header band in the rendered page is how a
 * human confirms the classification.
 */
function renderTable(block: TableBlock, ctx: Ctx, path: string): string {
  const headerEmpty = block.header.every((c) => c.text.trim() === "");
  const out: string[] = [`<table${attrs(block, path, { "data-header-empty": headerEmpty ? "true" : undefined })}>`];
  const alignAttr = (c: number) => {
    const a = block.align[c];
    return a === null || a === undefined ? "" : ` class="ta-${a}"`;
  };

  out.push("<thead><tr>");
  block.header.forEach((cell, c) => {
    out.push(`<th${alignAttr(c)} data-cell="h,${c}">${renderInline(cell, ctx)}</th>`);
  });
  out.push("</tr></thead>");

  out.push("<tbody>");
  block.rows.forEach((row, r) => {
    out.push("<tr>");
    row.forEach((cell, c) => {
      out.push(`<td${alignAttr(c)} data-cell="${r},${c}">${renderInline(cell, ctx)}</td>`);
    });
    out.push("</tr>");
  });
  out.push("</tbody></table>");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

/** §7.3 — theme-relative sizes, fixed here so geometry is comparable. */
const SIZE_WIDTH: Record<string, string> = {
  small: "22%",
  medium: "42%",
  large: "68%",
  full: "100%",
};

function renderDirective(block: DirectiveNode, ctx: Ctx, path: string): string {
  switch (block.name) {
    case "lead":
      return `<div class="lead"${attrs(block, path)}>\n${renderBlocks(block.children, ctx, path)}\n</div>`;
    case "align":
      return renderAlign(block, ctx, path);
    case "image":
      return renderImage(block, ctx, path, true);
    case "images":
      return renderImages(block, ctx, path);
    case "document":
      return renderDocument(block, ctx, path);
    case "columns":
      return renderColumns(block, ctx, path);
    case "column":
      return `<div class="column"${attrs(block, path)}>\n${renderBlocks(block.children, ctx, path)}\n</div>`;
    case "nav":
      return renderNav(block, ctx, path);
    case "frame":
      return renderFrame(block, ctx, path);
    case "signature":
      return `<div class="signature"${attrs(block, path)}>\n${renderBlocks(block.children, ctx, path)}\n</div>`;
    default:
      // §4 leaves unknown directives undefined; `read()` warns and keeps the
      // body. Rendering it as a plain region keeps the content visible and
      // makes the unknown name inspectable rather than silently dropping it.
      return `<div class="unknown-directive"${attrs(block, path, { "data-directive": block.name })}>\n${renderBlocks(block.children, ctx, path)}\n</div>`;
  }
}

/**
 * §13 — `::: align`.
 *
 * A missing or unrecognized `position` "MUST produce a warning and render the
 * body at the document's default alignment — never delete content". The
 * fallback is marked so a probe can distinguish "aligned left" from "alignment
 * was not understood", which are different defects.
 */
function renderAlign(block: DirectiveNode, ctx: Ctx, path: string): string {
  const raw = (block.props["position"] ?? "").trim().toLowerCase();
  const known = raw === "left" || raw === "center" || raw === "right";
  return (
    `<div class="align"${attrs(block, path, {
      "data-position": known ? raw : undefined,
      "data-invalid-position": known ? undefined : raw === "" ? "missing" : raw,
    })}>\n${renderBlocks(block.children, ctx, path)}\n</div>`
  );
}

/**
 * §6 / §7 — a standalone image, or one child of an image group.
 *
 * No asset tree exists for this corpus: every referenced image 404s, by
 * construction, and `CLAUDE.md` records that chasing broken images as a
 * conversion defect is a mistake. So the picture box is sized entirely from the
 * `size` token and a fixed aspect ratio, and never from an intrinsic size that
 * will never arrive. That is a *stated limitation*: L3 adjudicates the layout
 * the tokens produce, not the layout the real pictures would produce.
 */
function renderImage(block: DirectiveNode, ctx: Ctx, path: string, standalone: boolean): string {
  const src = block.props["src"] ?? "";
  const position = (block.props["position"] ?? "").trim().toLowerCase();
  const size = (block.props["size"] ?? "").trim().toLowerCase();
  const alt = block.props["alt"] ?? "";
  const caption = block.props["caption"] ?? "";
  const link = block.props["link"] ?? "";
  const frame = (block.props["frame"] ?? "").trim().toLowerCase();

  const posClass = standalone && position !== "" ? ` pos-${sanitizeToken(position)}` : "";
  const sizeStyle = standalone && SIZE_WIDTH[size] ? ` style="width:${SIZE_WIDTH[size]}"` : "";

  const picture =
    `<span class="picture${frame ? ` frame-${sanitizeToken(frame)}` : ""}">` +
    `<img src="${escapeAttr(resolveTarget(src, ctx))}" alt="${escapeAttr(alt)}" data-src="${escapeAttr(src)}">` +
    "</span>";

  const inner = link !== "" ? `<a href="${escapeAttr(resolveTarget(link, ctx))}" data-link="${escapeAttr(link)}">${picture}</a>` : picture;
  const figcaption = caption !== "" ? `\n<figcaption>${renderInlineRaw(caption, ctx)}</figcaption>` : "";

  return (
    `<figure class="image${posClass}"${sizeStyle}${attrs(block, path, {
      "data-position": position || undefined,
      "data-size": size || undefined,
      "data-standalone": standalone ? "true" : "false",
      "data-has-caption": caption !== "" ? "true" : undefined,
    })}>\n${inner}${figcaption}\n</figure>`
  );
}

/** §7 — `::: images`, a grid of 2, 3 or 4 tracks. */
function renderImages(block: DirectiveNode, ctx: Ctx, path: string): string {
  const declared = Number.parseInt(block.props["columns"] ?? "", 10);
  const columns = declared === 2 || declared === 3 || declared === 4 ? declared : 2;
  const groupFrame = (block.props["frame"] ?? "").trim().toLowerCase();

  const children = block.children.map((child, i) => {
    const childPath = `${path}/${kindOf(child)}[${i}]`;
    if (child.kind === "directive" && child.name === "image") {
      // §6.5: a group `frame` is the default for children that do not carry
      // their own; a child value always wins.
      const merged: DirectiveNode =
        groupFrame !== "" && child.props["frame"] === undefined
          ? { ...child, props: { ...child.props, frame: groupFrame } }
          : child;
      return renderImage(merged, ctx, childPath, false);
    }
    // Stray content inside a container: `read()` warns about it, and the target
    // promotes it. Kept visible for the same reason as in `columns`.
    return `<div class="stray"${attrs(child, childPath, { "data-quirk": "stray-in-images" })}>\n${renderBlock(child, ctx, childPath)}\n</div>`;
  });

  return (
    `<div class="images"${attrs(block, path, {
      "data-columns": String(columns),
      "data-declared-columns": block.props["columns"] ?? undefined,
    })} style="--tracks:${columns}">\n${children.join("\n")}\n</div>`
  );
}

/** §8 — `::: document`. A card, or an embed that always keeps a link fallback. */
function renderDocument(block: DirectiveNode, ctx: Ctx, path: string): string {
  const src = block.props["src"] ?? "";
  const title = block.props["title"] ?? "";
  const mode = (block.props["mode"] ?? "link").trim().toLowerCase();
  return (
    `<div class="document"${attrs(block, path, { "data-mode": mode })}>` +
    `<a href="${escapeAttr(resolveTarget(src, ctx))}" data-src="${escapeAttr(src)}">${escapeHtml(title)}</a>` +
    "</div>"
  );
}

/**
 * §9 — `::: columns`, and the quirk that makes `divider` unemittable.
 *
 * `read()` records that `columns` is **not** a property-header directive: its
 * handler segments the body directly, so a `divider: true` or `columns: 2` line
 * written inside the block is never read as a property. It survives as an
 * ordinary Markdown run and the target promotes it to a synthetic **first
 * column**, shifting every real column one track to the right.
 *
 * This renders that corruption rather than the author's intent. A produced
 * document that emits `divider` therefore *looks wrong here*, which is the
 * entire point: `conformance.test.ts` already asserts the asymmetry exists, and
 * L3 is where its layout consequence becomes visible.
 */
function renderColumns(block: DirectiveNode, ctx: Ctx, path: string): string {
  const tracks: string[] = [];
  let promoted = 0;

  block.children.forEach((child, i) => {
    const childPath = `${path}/${kindOf(child)}[${i}]`;
    if (child.kind === "directive" && child.name === "column") {
      tracks.push(`<div class="column"${attrs(child, childPath)}>\n${renderBlocks(child.children, ctx, childPath)}\n</div>`);
      return;
    }
    promoted += 1;
    tracks.push(
      `<div class="column promoted"${attrs(child, childPath, { "data-quirk": "promoted-property-line" })}>\n` +
        `${renderBlock(child, ctx, childPath)}\n</div>`,
    );
  });

  // §9.1: an explicit track count would come from a `columns` property — which,
  // per the quirk above, can never arrive. The grid therefore has as many tracks
  // as it has children, which is the pre-1.5 behaviour and the only one the
  // target actually implements.
  const count = Math.max(1, tracks.length);
  return (
    `<div class="columns"${attrs(block, path, {
      "data-tracks": String(count),
      "data-promoted": promoted > 0 ? String(promoted) : undefined,
    })} style="--tracks:${count}">\n${tracks.join("\n")}\n</div>`
  );
}

/**
 * §10 — `::: nav`.
 *
 * "The renderer presents a nav as a single centered horizontal bar of links…
 * Authored source line breaks do not shape its rows — the bar reflows on
 * available width alone." Modelled with a wrapping flex row, so a probe that
 * resizes the viewport can prove a nav is not viewport-dependent in some other
 * way.
 */
function renderNav(block: DirectiveNode, ctx: Ctx, path: string): string {
  const title = block.props["title"] ?? "";
  const active = (block.props["active"] ?? "").trim();
  const items: string[] = [];

  const collect = (blocks: readonly Block[]): void => {
    for (const child of blocks) {
      if (child.kind === "list") {
        for (const item of child.items) {
          const isActive = active !== "" && item.inline.text.trim() === active;
          items.push(
            `<li data-line="${item.line}"${isActive ? ' class="active" aria-current="page"' : ""}>${renderInline(item.inline, ctx)}</li>`,
          );
        }
      } else if (child.kind === "quote" || child.kind === "directive") {
        collect(child.children);
      }
    }
  };
  collect(block.children);

  const heading = title !== "" ? `<div class="nav-title">${renderInlineRaw(title, ctx)}</div>` : "";
  return (
    `<nav class="nav"${attrs(block, path, { "data-title": title || undefined, "data-active": active || undefined })}>` +
    `${heading}<ul>${items.join("")}</ul></nav>`
  );
}

/**
 * §11 — `::: frame`.
 *
 * `frame` is not a property-header directive in the target either, so its
 * `frame:` and `title:` lines arrive as body text. Reproduced: the palette falls
 * back to the default and the property line is rendered as the literal
 * paragraph the reader would actually see. The `data-quirk` marks it so a
 * finding can say *why* the frame is not the colour the author asked for.
 */
function renderFrame(block: DirectiveNode, ctx: Ctx, path: string): string {
  const declared = (block.props["frame"] ?? "").trim().toLowerCase();
  const palette = declared !== "" ? sanitizeToken(declared) : "gold"; // §11 default
  const unreadProperty = block.children.some(
    (c) => c.kind === "paragraph" && /^(?:frame|title):/u.test(c.lines[0] ?? ""),
  );
  return (
    `<div class="frame frame-${palette}"${attrs(block, path, {
      "data-frame": palette,
      "data-declared-frame": declared || undefined,
      "data-quirk": unreadProperty ? "property-not-read" : undefined,
    })}>\n${renderBlocks(block.children, ctx, path)}\n</div>`
  );
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/**
 * Sentinel wrapping a protected span while the remaining constructs are applied.
 *
 * U+0001 rather than a printable marker: it cannot occur in this corpus, it is
 * not a regex metacharacter, and a leaked sentinel shows up as a control
 * character rather than as plausible text.
 */
const PLACEHOLDER = "";

function renderInline(inline: Inline, ctx: Ctx): string {
  return renderInlineRaw(inline.raw, ctx);
}

/**
 * One run of inline Markdown → HTML.
 *
 * Escapes first, then protects backslash escapes, then applies constructs, then
 * restores. The order is what makes `\[Надежда]` render as literal brackets
 * rather than as a broken link, and `1\.` as `1.` — both of which occur in the
 * reference set, because the serializer escapes them.
 */
export function renderInlineRaw(raw: string, ctx: Ctx): string {
  const protectedChars: string[] = [];
  let s = escapeHtml(raw).replace(/\\([\\`*_{}[\]()#+\-.!|>~])/gu, (_m, ch: string) => {
    protectedChars.push(ch);
    return `${PLACEHOLDER}${protectedChars.length - 1}${PLACEHOLDER}`;
  });

  // Code first: its content must not be interpreted as anything else.
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/gu, (_m, body: string) => {
    codeSpans.push(body);
    return `${PLACEHOLDER}c${codeSpans.length - 1}${PLACEHOLDER}`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/gu, (_m, alt: string, src: string) => {
    return `<img class="inline-image" src="${escapeAttr(resolveTarget(unprotect(src, protectedChars, codeSpans), ctx))}" alt="${escapeAttr(alt)}" data-src="${escapeAttr(src)}">`;
  });
  s = s.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/gu, (_m, label: string, target: string) => {
    return `<a href="${escapeAttr(resolveTarget(unprotect(target, protectedChars, codeSpans), ctx))}" data-target="${escapeAttr(target)}">${label}</a>`;
  });

  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/gu, "<strong>$2</strong>");
  s = s.replace(/(?<![*\w])(\*|_)(?=\S)((?:[^*_]|\*\*)*?\S)\1(?![*\w])/gu, "<em>$2</em>");

  return unprotect(s, protectedChars, codeSpans);
}

function unprotect(value: string, chars: readonly string[], codeSpans: readonly string[]): string {
  return value
    .replace(new RegExp(`${PLACEHOLDER}c(\\d+)${PLACEHOLDER}`, "gu"), (_m, i: string) => `<code>${codeSpans[Number(i)] ?? ""}</code>`)
    .replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "gu"), (_m, i: string) => escapeHtml(chars[Number(i)] ?? ""));
}

/**
 * §15 — resource resolution.
 *
 * Reproduced because a target that resolves differently *lays out* differently:
 * a link the renderer cannot resolve is still a link, but an image whose `src`
 * never resolves has no box. Nothing is fetched; this only decides the `src`
 * attribute the page will (fail to) request.
 */
export function resolveTarget(target: string, ctx: Ctx): string {
  const t = target.trim();
  if (t === "") return "";
  if (/^[a-z][a-z0-9+.-]*:/iu.test(t) || t.startsWith("#") || t.startsWith("//")) return t;

  // §15.1 — `^/x` is anchored at the resource root, skipping the base entirely.
  if (t.startsWith("^")) return normalizePath(t.slice(1).replace(/^\/*/u, "/"));
  // §15.1 — `/../x` climbs out of the base, clamped at the root.
  if (t.startsWith("/../") || t.startsWith("../")) {
    return normalizePath(`${ctx.resourceBase}/${t.replace(/^\//u, "")}`);
  }
  return normalizePath(`${ctx.resourceBase}/${t.replace(/^\/+/u, "")}`);
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop(); // clamped at the root: never escapes above it
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/gu, "&quot;");
}

/** A class-name fragment from a spec token. Never a source literal. */
function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9-]/giu, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

/**
 * The rendering contract of §14, expressed as CSS.
 *
 * Fixed and inline: an external stylesheet would make the page's geometry
 * depend on a fetch, and a fetch that fails silently would make every
 * measurement wrong in the same direction on both sides — the most dangerous
 * kind of instrument error, because it does not show up in a comparison.
 *
 * The article is a centred measure of bounded width, which is the corpus fact
 * `CLAUDE.md` §5 records: content is the centre column, about half the
 * viewport. Everything else is deliberately plain — this models layout, not a
 * theme, and any decoration that changed a box would be noise in a finding.
 */
const STYLESHEET = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#1a1a1a;
  font:16px/1.55 "DejaVu Serif",Georgia,"Times New Roman",serif}
.biomd{max-width:44rem;margin:0 auto;padding:2rem 1rem 6rem;overflow-wrap:break-word}

h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em;font-weight:700;clear:both}
h1{font-size:2em;margin-top:0}
h2{font-size:1.5em}
h3{font-size:1.22em}
h4{font-size:1.06em}
h5,h6{font-size:1em}
p{margin:0 0 1em}
hr{clear:both;border:0;border-top:1px solid #bbb;margin:2em 0}
blockquote{margin:1em 0;padding:.2em 0 .2em 1.1em;border-left:3px solid #ccc;color:#333}
ul,ol{margin:0 0 1em;padding-left:1.6em}
ul.nested,ol.nested{margin:0}
li{margin:.2em 0}
pre{overflow-x:auto;background:#f4f4f4;padding:.7em;margin:0 0 1em}
a{color:#14509b}

table{border-collapse:collapse;margin:1em 0;width:100%;clear:both;display:block;overflow-x:auto}
th,td{border:1px solid #c4c4c4;padding:.34em .55em;text-align:left;vertical-align:top}
th{background:#f0f0f0;font-weight:700}
table[data-header-empty="true"] thead{opacity:.5}
.ta-left{text-align:left}.ta-center{text-align:center}.ta-right{text-align:right}

.lead{font-size:1.15em;margin:0 0 1.4em}
.lead>p:first-child::first-letter{font-size:2.2em;line-height:1;float:left;padding:.05em .08em 0 0}

/* §13 — bounded alignment. Reading order is untouched by construction. */
.align{margin:0 0 1em;clear:both}
.align[data-position="left"]{text-align:left}
.align[data-position="center"]{text-align:center}
.align[data-position="right"]{text-align:right}
.align[data-invalid-position]{outline:2px dashed #d33;outline-offset:2px}
.align>*:last-child{margin-bottom:0}

/* §6 — image position and size. */
figure.image{margin:0 0 1.1em;padding:0}
figure.image .picture{display:block}
figure.image img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;
  background:repeating-linear-gradient(45deg,#e9e9e9 0 8px,#e0e0e0 8px 16px);border:0}
figure.image figcaption{font-size:.86em;color:#444;margin-top:.35em;line-height:1.4}
figure.image.pos-left{float:left;margin:.2em 1.2em .8em 0}
figure.image.pos-right{float:right;margin:.2em 0 .8em 1.2em}
figure.image.pos-center{margin-left:auto;margin-right:auto;text-align:center}
figure.image.pos-full{width:100%!important;margin-left:0;margin-right:0}
.frame-none img{box-shadow:none;border:0}
.frame-curl img{box-shadow:0 1px 4px rgba(0,0,0,.35)}
.frame-mat img{border:10px solid #f4efe2;box-shadow:0 0 0 1px #cfc7b4}
.frame-black img{border:9px solid #191919}
.frame-white img{border:9px solid #fbfbf7}
.frame-red img{border:9px solid #7d1420}
.frame-gold img{border:9px solid #9c7b2e}

/* §7 — image groups, and §9 — columns. Both are grids of --tracks. */
.images,.columns{display:grid;grid-template-columns:repeat(var(--tracks,2),1fr);
  gap:1rem;margin:0 0 1.2em;clear:both;align-items:start}
.images figure.image{margin:0}
.images figure.image img{aspect-ratio:4/3}
.column>*:last-child{margin-bottom:0}
/* The corruption modelled in renderColumns(), made visible. */
.column.promoted{outline:2px dashed #d33;outline-offset:-2px}

/* §10 — a single centred horizontal bar; source line breaks do not shape it. */
.nav{margin:1.2em 0;clear:both;text-align:center}
.nav .nav-title{font-weight:700;margin-bottom:.35em}
.nav ul{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;
  gap:.3em 1em;margin:0;padding:0;max-width:100%;overflow-x:auto}
.nav li{margin:0}
.nav li.active{font-weight:700;color:#555}

/* §11 — a semantic bordered region, never the article's own border. */
.frame{border:3px solid #9c7b2e;padding:1em 1.2em;margin:1.2em 0;clear:both}
.frame.frame-black{border-color:#191919}
.frame.frame-red{border-color:#7d1420}
.frame.frame-white{border-color:#d8d4c8}
.frame.frame-gold{border-color:#9c7b2e}
.frame>*:last-child{margin-bottom:0}

/* §12 — a compact closing block toward the reading-end edge on wide screens. */
.signature{margin:2em 0 0;text-align:right;font-size:.95em;clear:both}
.signature>*:last-child{margin-bottom:0}

.document{margin:1em 0;padding:.6em .8em;border:1px solid #c4c4c4;background:#fafafa;clear:both}
.stray,.unknown-directive{outline:2px dashed #d33;outline-offset:2px}
img.inline-image{max-width:100%;height:auto;vertical-align:middle}

/* §14 — stack on narrow screens, in source order. */
@media (max-width:44rem){
  .images,.columns{grid-template-columns:1fr}
  figure.image.pos-left,figure.image.pos-right{float:none;width:100%!important;margin:0 0 1.1em}
  .signature{text-align:left}
}

/* Annotation, off unless asked for: block outlines and a kind label. */
.annotate [data-l3]{outline:1px solid rgba(20,80,155,.28);outline-offset:1px;position:relative}
.annotate [data-l3]::after{content:attr(data-kind) " @" attr(data-line);position:absolute;
  top:0;right:0;font:9px/1 monospace;color:#14509b;background:#eef3fa;padding:1px 2px;
  pointer-events:none;opacity:.75}
`.trim();
