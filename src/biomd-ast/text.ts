/** Small mdast text utilities shared by the builders, validator and lints. */
import type { Nodes, PhrasingContent, RootContent } from "mdast";

/**
 * Concatenate the human-visible text of a node, mdast's `toString` semantics
 * without the dependency. Image alt text is included because `nav.active`
 * matching and heading identity both depend on it.
 */
export function plainText(node: Nodes | Nodes[] | null | undefined): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(plainText).join("");
  if ("value" in node && typeof node.value === "string") {
    return node.type === "html" || node.type === "code" ? node.value : node.value;
  }
  if (node.type === "image" || node.type === "imageReference") {
    return typeof node.alt === "string" ? node.alt : "";
  }
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as Nodes[]).map(plainText).join("");
  }
  return "";
}

/** Collapse runs of whitespace and trim — for comparing labels. */
export function normalizeLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** A property value is the remainder of its line, so it cannot contain breaks. */
export function isSingleLine(value: string): boolean {
  return !/[\r\n]/u.test(value);
}

/** Build a plain paragraph from literal text. */
export function paragraph(text: string): RootContent & { type: "paragraph" } {
  return { type: "paragraph", children: [{ type: "text", value: text }] };
}

/** Build phrasing content from literal text. */
export function textRun(value: string): PhrasingContent {
  return { type: "text", value };
}
