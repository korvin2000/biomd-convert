/**
 * What every hook in the catalogue shares.
 *
 * Three things, and they are shared because getting any of them wrong once per
 * hook is how a catalogue of twenty becomes twenty slightly different contracts:
 *
 *   - **the reply shape.** Every hook returns a verdict, a confidence and a
 *     rationale. The confidence drives escalation and review routing; the
 *     rationale goes to the provenance ledger and never to the document.
 *   - **`UNCERTAIN` is a member of every verdict enum.** A hook that cannot
 *     abstain forces a guess, and a forced guess on an ambiguous page is worse
 *     than the deterministic default it would replace. Abstention is the reply
 *     that keeps the rule's answer and files a review item.
 *   - **the templates.** Instructions live in `src/llm/prompts`; this module is
 *     the only place that knows how a hook id maps onto a file name.
 */
import { z } from "zod";
import { renderTemplate, type TemplateValue } from "../prompt-template.js";

/**
 * How much rationale is kept.
 *
 * Enforced by truncation at the point of use, never by rejection: throwing away
 * an otherwise-correct verdict because the model explained itself in 430
 * characters instead of 400 wastes the call *and* leaves the item unresolved.
 * Brevity is asked for in the prompt, where asking is free.
 */
export const RATIONALE_LIMIT = 400;

/** The two fields every reply carries, so `runHook` can route on them uniformly. */
export const CONFIDENCE = z.number().min(0).max(1);
export const RATIONALE = z.string().max(4000);

/**
 * Every verdict enum in the catalogue ends with this member.
 *
 * Spelled once so no hook can be defined without it: a hook that cannot abstain
 * forces a guess, and a forced guess is worse than the deterministic default it
 * would be replacing. `hooks/catalogue.test.ts` asserts the property across the
 * whole catalogue rather than trusting each definition to remember.
 */
export const UNCERTAIN = "UNCERTAIN";

/** Load a hook's stable instruction prefix. */
export function systemPrompt(template: string, vars: Readonly<Record<string, TemplateValue>> = {}): string {
  return renderTemplate(`${template}.system`, vars);
}

/** Render a hook's per-item payload. */
export function userPrompt(template: string, vars: Readonly<Record<string, TemplateValue>>): string {
  return renderTemplate(`${template}.user`, vars);
}

/** Trim a rationale to what the ledger keeps. */
export function trimRationale(text: string): string {
  return text.slice(0, RATIONALE_LIMIT);
}

/**
 * Reject a batch reply whose length does not match the batch.
 *
 * The common failure of a batched hook, and the one that silently corrupts:
 * verdict *n* applied to item *n+1* is a wrong answer that looks like a right
 * one. Checked here so every batched hook checks it the same way.
 */
export function expectLength(got: number, want: number, noun: string): string[] {
  return got === want ? [] : [`expected ${want} ${noun}, received ${got}`];
}

/**
 * Quote a value for a prompt without letting it break the payload's framing.
 *
 * Source text on these pages contains newlines, braces and the occasional stray
 * backtick. `JSON.stringify` is the cheapest way to make a value unambiguously
 * one token of the payload, and it is what the existing hooks already use.
 */
export function quote(value: string, max = 240): string {
  const clipped = value.length > max ? `${value.slice(0, max)}…` : value;
  return JSON.stringify(clipped.replace(/\s+/gu, " ").trim());
}

/** Render a numbered candidate list, the shape every "choose one" hook shares. */
export function numbered(items: readonly { text: string; note?: string }[], max = 240): string {
  return items
    .map((item, i) => `  ${i}. ${quote(item.text, max)}${item.note ? `  — ${item.note}` : ""}`)
    .join("\n");
}
