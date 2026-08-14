/**
 * The subordination contract: **a hook may not disrupt a rule that decided.**
 *
 * This is the property the whole escalation design rests on, and it is the one a
 * reviewer cannot check by reading — twenty consult sites each look correct in
 * isolation, and the claim is about all of them at once. So it is measured, and
 * it is measured adversarially: the resolver used here answers *every* question
 * with the most disruptive verdict its schema allows. It calls every recurring
 * structure content, joins every hyphen, promotes every line to a heading,
 * declares every unknown image an icon, and binds the first candidate it is
 * offered as a caption.
 *
 * If a hook could reach a decision a rule had already made, this resolver would
 * find it.
 *
 * The two assertions that matter:
 *
 *   1. **the deterministic run and the adversarial run agree** wherever a rule
 *      was confident — checked by converting the same sources both ways and
 *      comparing the output;
 *   2. **an escalation is offered only the residual** — checked by recording
 *      every item each hook was asked about and asserting it is a subset of what
 *      the rules left open.
 */
import { describe, expect, it } from "vitest";
import { convert } from "./pipeline.js";
import { adviceOf, hasAdvice, writeAdvice } from "./advice.js";
import type { DecisionResolver } from "./resolver.js";
import { emptyStats } from "./resolver.js";
import { parseHtml } from "../ladom/parse.js";

/**
 * A resolver that says yes to everything, as loudly as its schemas allow.
 *
 * Every method returns the answer that would change the most. Nothing here is a
 * plausible model reply; that is the point — a plausible reply tests the prompt,
 * and this tests the boundary.
 */
class AdversarialResolver implements DecisionResolver {
  readonly asked: Array<{ hook: string; item: string }> = [];

  async classifyTable(): Promise<null> {
    return null;
  }
  async tableHeaders(): Promise<null> {
    return null;
  }

  async auditChrome(request: Parameters<NonNullable<DecisionResolver["auditChrome"]>>[0]) {
    for (const c of request.candidates) this.asked.push({ hook: "layout.chrome-audit", item: c.id });
    // Cancel every deletion the pass proposed.
    return request.candidates.map(() => "CONTENT" as const);
  }

  async resolveHyphenation(request: Parameters<NonNullable<DecisionResolver["resolveHyphenation"]>>[0]) {
    for (const c of request.cases) this.asked.push({ hook: "text.hyphenation", item: c.id });
    // Join every broken word, including the ones that are real compounds.
    return request.cases.map(() => "JOIN" as const);
  }

  async blockRole(request: Parameters<NonNullable<DecisionResolver["blockRole"]>>[0]) {
    this.asked.push({ hook: "text.block-role", item: request.id });
    return { role: "SECTION_LABEL" as const, depth: 2 as const, confidence: 1, reason: "adversarial" };
  }

  async imageRole(request: Parameters<NonNullable<DecisionResolver["imageRole"]>>[0]) {
    this.asked.push({ hook: "image.role", item: request.id });
    return { role: "ICON" as const, glyph: "▶", confidence: 1, reason: "adversarial" };
  }

  async bindImageCaption(request: Parameters<NonNullable<DecisionResolver["bindImageCaption"]>>[0]) {
    this.asked.push({ hook: "image.caption", item: request.id });
    return 0;
  }

  stats() {
    return emptyStats();
  }
}

/**
 * A page whose every rule is confident.
 *
 * A titled article with a real heading, a picture with an author-written `alt`,
 * and two ordinary paragraphs. Nothing here is ambiguous, so nothing here may
 * move.
 *
 * **It carries no hyphenated word, and that omission is the point.** The first
 * draft of this fixture used `вице-президентом` on the strength of a comment in
 * the cascade naming it as a compound the rules refuse to join — but that
 * refusal comes from the *dictionary*, and a conversion with no dictionary
 * configured, which is this test and also the default, leaves the word as a
 * review item. The adversarial resolver then joined it, correctly: it was in the
 * residual. A fixture that is confident has to be confident under the
 * configuration it is converted with.
 */
const CONFIDENT = `<html><body>
  <p style="font: bold 24pt Arial">Агустин Барриос</p>
  <p style="font-size: 12pt">Барриос родился в Парагвае и много выступал по всей
  Южной Америке.</p>
  <p><img src="photo/barrios.jpg" width="300" height="400" alt="Барриос с гитарой, 1910"></p>
  <p style="font-size: 12pt">Второй абзац обычного текста, ничем не выделенный.</p>
</body></html>`;

async function markdownOf(html: string, resolver?: DecisionResolver): Promise<string> {
  const result = await convert(Buffer.from(html, "utf8"), {
    sourceName: "subordination.htm",
    ...(resolver ? { resolver } : {}),
  });
  return result.markdown;
}

describe("advice is subordinate to the rules", () => {
  it("does not change a document whose rules were all confident", async () => {
    const deterministic = await markdownOf(CONFIDENT);
    const adversarial = await markdownOf(CONFIDENT, new AdversarialResolver());
    // Byte-identical. Not "similar", not "no worse" — a hook that could not be
    // reached cannot have changed anything, and that is the claim.
    expect(adversarial).toBe(deterministic);
  });

  it("never offers an escalation an item a rule already decided", async () => {
    const resolver = new AdversarialResolver();
    await markdownOf(CONFIDENT, resolver);

    // The picture carries an author-written `alt`, so `captionFor` answered and
    // the caption question is settled; it must not appear in the queue.
    expect(resolver.asked.filter((a) => a.hook === "image.caption")).toHaveLength(0);
    // The picture is 300×400: far above the size at which a mark could be a
    // control, so the icon question cannot be asked about it either.
    expect(resolver.asked.filter((a) => a.hook === "image.role")).toHaveLength(0);
    // Nothing on this page is broken across a line, so there is no hyphen
    // question at all.
    expect(resolver.asked.filter((a) => a.hook === "text.hyphenation")).toHaveLength(0);
  });

  it("keeps the title the outline rule recovered, against a resolver calling everything a section", async () => {
    const adversarial = await markdownOf(CONFIDENT, new AdversarialResolver());
    // Exactly one `#`, and it is the line the prominence rule marked.
    expect(adversarial.match(/^# /gmu) ?? []).toHaveLength(1);
    expect(adversarial).toContain("# Агустин Барриос");
  });

  it("cannot promote a line to a heading past the depth the outline allows", async () => {
    // The adversarial resolver answers depth 2 for everything. A document with
    // no open section may not gain a `###`, and one with an open `##` may not
    // gain a heading deeper than `###` — the acceptance check owns this, not the
    // reply.
    const adversarial = await markdownOf(CONFIDENT, new AdversarialResolver());
    expect(adversarial).not.toMatch(/^#{4,}\s/mu);
  });
});

describe("the advice channel itself", () => {
  const nodeOf = (html: string): ReturnType<typeof parseHtml>["root"] => parseHtml(html).root;

  it("round-trips every field it accepts", () => {
    const root = nodeOf("<p>x</p>");
    writeAdvice(root, { blockRole: "CAPTION", headingDepth: 3, caption: "a line", lineation: true }, "test");
    expect(adviceOf(root)).toMatchObject({
      blockRole: "CAPTION",
      headingDepth: 3,
      caption: "a line",
      lineation: true,
    });
    expect(hasAdvice(root)).toBe(true);
  });

  it("drops a value outside its vocabulary rather than writing it to the tree", () => {
    const root = nodeOf("<p>x</p>");
    writeAdvice(root, { blockRole: "NONSENSE" as never, imageRole: "PICTURE" }, "test");
    expect(adviceOf(root).blockRole).toBeUndefined();
    expect(adviceOf(root).imageRole).toBe("PICTURE");
  });

  it("reports no advice for a node nobody was asked about", () => {
    const root = nodeOf("<p>x</p>");
    expect(hasAdvice(root)).toBe(false);
    expect(adviceOf(root)).toEqual({});
    expect(adviceOf(null)).toEqual({});
  });

  it("writes nothing at all when the advice is empty", () => {
    const root = nodeOf("<p>x</p>");
    writeAdvice(root, {}, "test");
    expect(hasAdvice(root)).toBe(false);
  });
});
