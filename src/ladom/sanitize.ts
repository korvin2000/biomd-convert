/**
 * S1 — pre-render sanitization: behaviour out, layout evidence untouched.
 *
 * The ordering constraint is the whole point. Stage 3 measures the *rendered*
 * page, so anything with visual extent that is removed before rendering
 * silently changes the geometry every later decision depends on. S1 therefore
 * removes only things that cannot affect layout — scripts, handlers, server
 * fragments, trackers — and leaves every `width`, `align`, `bgcolor`, `<font>`
 * and spacer cell in place. Those are discarded later, in normalize and
 * boilerplate removal, *after* they have been measured.
 *
 * This is deliberately a hand-written denylist rather than `rehype-sanitize`.
 * That library exists to make untrusted HTML safe to re-display and strips
 * exactly the presentational attributes this pipeline reads; using it here
 * would run cleanly and destroy the design.
 */
import { type LadomNode, walk } from "./types.js";
import { computeMetrics } from "./parse.js";

export interface HeadFacts {
  /** Charset declaration, already consumed by the decode stage. */
  charset: string | null;
  /** `<base href>` — affects every relative target on the page. */
  baseHref: string | null;
  /** Document title. Recorded as provenance and never used as the article title. */
  title: string | null;
  /** Inline `<style>` bodies, retained for the render pass only. */
  inlineStyles: string[];
  /** Local stylesheet hrefs, retained for the render pass only. */
  stylesheets: string[];
  /** Other metadata, kept for the audit. */
  meta: Record<string, string>;
}

export interface RemovalRecord {
  /** Node id that was removed. */
  id: string;
  tag: string;
  reason: string;
  /** Text content lost, if any — must be empty for a behaviour-only strip. */
  textLost: string;
  /** Targets carried by the removed subtree, preserved for the ledger. */
  targets: string[];
  /**
   * Set when an ancestor removal already detached this node. The record is kept
   * so every removable node has its own ledger entry rather than being silently
   * folded into an ancestor's.
   */
  subsumedBy?: string;
}

/**
 * Removals whose text loss is expected and need not be warned about: the head's
 * title, and the source text of behaviour elements.
 */
const SILENT_TEXT_LOSS = new Set(["head", "script", "noscript", "template", "#comment", "style"]);

export interface SanitizeResult {
  head: HeadFacts;
  removals: RemovalRecord[];
  /** Attributes stripped in place (handlers, unsafe URL schemes). */
  attributesRemoved: Array<{ id: string; attr: string; value: string; reason: string }>;
  warnings: string[];
}

/** Elements whose entire subtree is behaviour, never content. */
const BEHAVIOUR_TAGS = new Set(["script", "noscript", "template"]);

/** Dead plugin content. The resource reference is preserved as a target record. */
const PLUGIN_TAGS = new Set(["applet", "object", "embed", "param"]);

/** Legacy site search and forms. Flagged, removed only once corpus-confirmed. */
const FORM_TAGS = new Set(["form", "input", "select", "button", "textarea", "label", "fieldset", "legend"]);

const EVENT_ATTR = /^on[a-z]+$/u;
const UNSAFE_SCHEME = /^\s*(?:javascript|vbscript|data:text\/html|file):/iu;

/** Attributes that carry a URL and therefore a target worth preserving. */
const URL_ATTRS = ["href", "src", "data", "poster", "srcset", "background", "action", "codebase"];

export interface SanitizeOptions {
  /**
   * Remove `<form>` subtrees. Default false: a legacy page occasionally puts
   * real content inside a dead form, and boilerplate detection has better
   * evidence for this decision than a static list does.
   */
  removeForms?: boolean;
  /**
   * Remove `<style>` and `<link rel=stylesheet>`. Default false, because the
   * conversion pipeline needs them for the render pass.
   *
   * Callers that never render — the corpus pass — must set this. A `<style>`
   * body is a text node like any other, so leaving it in place feeds
   * `font-family` and `sans-serif` into the corpus lexicon, where they become
   * hyphenated-form evidence for the de-hyphenation cascade.
   */
  removeStyles?: boolean;
  /** Hostnames whose images are counters/trackers. */
  trackerHosts?: readonly string[];
}

const DEFAULT_TRACKER_HOSTS = [
  "counter.rambler.ru", "top.list.ru", "top.mail.ru", "yandex.ru/cy",
  "spylog.com", "hitbox.com", "google-analytics.com", "mc.yandex.ru",
];

export function sanitizeS1(root: LadomNode, options: SanitizeOptions = {}): SanitizeResult {
  const trackerHosts = options.trackerHosts ?? DEFAULT_TRACKER_HOSTS;
  const removals: RemovalRecord[] = [];
  const attributesRemoved: SanitizeResult["attributesRemoved"] = [];
  const warnings: string[] = [];

  const head = harvestHead(root);

  // Collect first, mutate after: removing during traversal invalidates it.
  const toRemove: Array<{ node: LadomNode; reason: string }> = [];

  for (const node of walk(root)) {
    if (node.kind === "comment") {
      // Comments are removed from the content tree but their text is retained
      // in the removal ledger: legacy comments occasionally hold real content,
      // and conditional comments can hold live markup.
      toRemove.push({ node, reason: "comment" });
      continue;
    }
    if (node.kind !== "element") continue;

    if (BEHAVIOUR_TAGS.has(node.tag)) {
      toRemove.push({ node, reason: `behaviour element <${node.tag}>` });
      continue;
    }
    // `<head>` is deliberately NOT removed here. It carries the stylesheets the
    // measurement stage needs; dropping it before rendering would destroy the
    // very geometry the pipeline is about to read. It is removed by dropHead()
    // once measurement has run.
    if (node.tag === "head") continue;
    if (PLUGIN_TAGS.has(node.tag)) {
      toRemove.push({ node, reason: `dead plugin element <${node.tag}>` });
      continue;
    }
    if (options.removeForms === true && FORM_TAGS.has(node.tag)) {
      toRemove.push({ node, reason: `form element <${node.tag}>` });
      continue;
    }
    if (options.removeStyles === true && (node.tag === "style" || node.tag === "link")) {
      toRemove.push({ node, reason: `stylesheet <${node.tag}>` });
      continue;
    }
    if (node.tag === "img" && isTracker(node, trackerHosts)) {
      toRemove.push({ node, reason: "tracking pixel or counter" });
      continue;
    }

    // Attribute-level strips. These never change layout: an event handler and a
    // javascript: target have no visual extent.
    for (const [name, value] of Object.entries(node.attrs)) {
      if (EVENT_ATTR.test(name)) {
        attributesRemoved.push({ id: node.id, attr: name, value, reason: "event handler" });
        delete node.attrs[name];
        continue;
      }
      if (URL_ATTRS.includes(name) && UNSAFE_SCHEME.test(value)) {
        attributesRemoved.push({ id: node.id, attr: name, value, reason: "unsafe URL scheme" });
        delete node.attrs[name];
      }
    }
    if (node.tag === "meta" && (node.attrs["http-equiv"] ?? "").toLowerCase() === "refresh") {
      toRemove.push({ node, reason: "meta refresh" });
    }
  }

  // Pre-order guarantees ancestors are considered before descendants, so a
  // subtree removal is always seen first. A descendant that is also on the list
  // is still recorded — with the ancestor that subsumed it — because the ledger
  // must state what happened to every node individually, not just to the
  // outermost one that happened to be detached.
  const detached: Array<{ node: LadomNode; record: RemovalRecord }> = [];

  for (const { node, reason } of toRemove) {
    const subsumer = detached.find((d) => isDescendantOf(node, d.node));
    const record = describeRemoval(node, reason);
    if (subsumer) {
      record.subsumedBy = subsumer.record.id;
      removals.push(record);
      continue;
    }
    if (record.textLost.length > 0 && !SILENT_TEXT_LOSS.has(record.tag)) {
      warnings.push(
        `S1 removed <${record.tag}> (${reason}) carrying ${record.textLost.length} characters of text; ` +
          "check the removal ledger.",
      );
    }
    removals.push(record);
    detach(node);
    detached.push({ node, record });
  }

  computeMetrics(root);
  return { head, removals, attributesRemoved, warnings };
}

function isTracker(node: LadomNode, hosts: readonly string[]): boolean {
  const src = node.attrs["src"] ?? "";
  if (hosts.some((h) => src.includes(h))) return true;
  const w = Number.parseInt(node.attrs["width"] ?? "", 10);
  const h = Number.parseInt(node.attrs["height"] ?? "", 10);
  // A declared 1x1 or zero-area image is a spacer or a counter, never content.
  return Number.isFinite(w) && Number.isFinite(h) && w <= 1 && h <= 1;
}

/**
 * Drop `<head>` — the second half of the S1 split.
 *
 * Must run *after* measurement: the stylesheets it contains are what resolve
 * `<font>`, `align=` and class rules into the computed styles the layout
 * analysis reads. Call it once geometry is captured.
 */
export function dropHead(root: LadomNode): RemovalRecord[] {
  const records: RemovalRecord[] = [];
  for (const node of [...walk(root)]) {
    if (node.kind !== "element" || node.tag !== "head") continue;
    if (node.parent === null) continue;
    records.push(describeRemoval(node, "document head, after fact harvesting and measurement"));
    detach(node);
  }
  computeMetrics(root);
  return records;
}

function isDescendantOf(node: LadomNode, ancestor: LadomNode): boolean {
  let cur: LadomNode | null = node.parent;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

function detach(node: LadomNode): void {
  const parent = node.parent;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parent = null;
}

function describeRemoval(node: LadomNode, reason: string): RemovalRecord {
  const targets: string[] = [];
  let text = "";
  for (const n of walk(node)) {
    if (n.kind === "text") text += n.value ?? "";
    if (n.kind === "comment") text += n.value ?? "";
    if (n.kind === "element") {
      for (const attr of URL_ATTRS) {
        const value = n.attrs[attr];
        if (typeof value === "string" && value.trim() !== "") targets.push(value);
      }
    }
  }
  return {
    id: node.id,
    tag: node.kind === "element" ? node.tag : `#${node.kind}`,
    reason,
    textLost: text.replace(/\s+/gu, " ").trim(),
    targets,
  };
}

/**
 * Harvest everything useful from `<head>` before it is discarded.
 *
 * Four things must be taken out first, or later stages lose information they
 * cannot recover: the charset (already used), stylesheets (needed by the render
 * pass), `<base href>` (changes what every relative target means), and the
 * title (recorded as provenance, and explicitly *not* an article-title
 * candidate — the repeated site title is never the article title).
 */
export function harvestHead(root: LadomNode): HeadFacts {
  const facts: HeadFacts = {
    charset: null,
    baseHref: null,
    title: null,
    inlineStyles: [],
    stylesheets: [],
    meta: {},
  };

  for (const node of walk(root)) {
    if (node.kind !== "element") continue;
    switch (node.tag) {
      case "meta": {
        const charset = node.attrs["charset"];
        if (charset) facts.charset = charset;
        const name = node.attrs["name"];
        const content = node.attrs["content"];
        if (name && content) facts.meta[name.toLowerCase()] = content;
        break;
      }
      case "base": {
        const href = node.attrs["href"];
        if (href && facts.baseHref === null) facts.baseHref = href;
        break;
      }
      case "title": {
        if (facts.title === null) {
          const text = node.children
            .filter((c) => c.kind === "text")
            .map((c) => c.value ?? "")
            .join("")
            .replace(/\s+/gu, " ")
            .trim();
          if (text) facts.title = text;
        }
        break;
      }
      case "style": {
        const css = node.children
          .filter((c) => c.kind === "text")
          .map((c) => c.value ?? "")
          .join("");
        if (css.trim()) facts.inlineStyles.push(css);
        break;
      }
      case "link": {
        const rel = (node.attrs["rel"] ?? "").toLowerCase();
        const href = node.attrs["href"];
        if (rel.includes("stylesheet") && href) facts.stylesheets.push(href);
        break;
      }
      default:
        break;
    }
  }

  return facts;
}
