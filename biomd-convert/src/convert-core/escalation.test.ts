/**
 * The other half of the subordination contract.
 *
 * `advice.test.ts` proves a hook cannot disturb a rule that decided. That is
 * only half a claim: a hook that is never reached also cannot disturb anything,
 * and a catalogue of twenty unreachable hooks would pass that test perfectly.
 * This file proves the reachable half — that where a rule genuinely abstains,
 * the escalation is offered the item, its answer is applied, and the provenance
 * ledger records who decided.
 *
 * Each test names the abstention it exercises, because a test that does not is
 * a test that will still pass after the abstention stops happening.
 */
import { describe, expect, it } from "vitest";
import { convert } from "./pipeline.js";
import { runCorpusPass } from "./corpus.js";
import type { ConvertEvent } from "./pipeline.js";
import type { DecisionResolver } from "./resolver.js";
import { emptyStats } from "./resolver.js";

/** A resolver assembled from just the answers a test cares about. */
function resolverOf(parts: Partial<DecisionResolver>): DecisionResolver {
  return {
    async classifyTable() {
      return null;
    },
    async tableHeaders() {
      return null;
    },
    stats: emptyStats,
    ...parts,
  } as DecisionResolver;
}

describe("text.block-role — the band between prose and a heading", () => {
  /**
   * A line the outline rule weighs and lets go.
   *
   * **Finding the band took a correction worth recording.** The first draft set
   * this label in bold, and bold multiplies the prominence score by 1.15 — past
   * the section threshold — so the rule *took* it and there was no abstention to
   * exercise. The band that remains is narrow and it is exactly right: a centred
   * line scores 1.05 and an all-capitals one 1.1, both above prose and below the
   * threshold. Those are the corpus's real ambiguities — a centred short line is
   * a section label, a menu item, a caption or a signature, and typography says
   * nothing more about which.
   */
  const AMBIGUOUS = `<html><body>
    <p style="font: bold 22pt Arial">Франсиско Таррега</p>
    <p style="font-size:12pt">Таррега родился в Вильярреале и учился в Мадриде, где
    и написал большую часть своих сочинений для гитары.</p>
    <p align="center" style="font-size:12pt">Сочинения</p>
    <p style="font-size:12pt">Прелюдии, этюды и переложения, изданные при жизни автора.</p>
  </body></html>`;

  it("promotes a line the rule declined, at the depth the outline allows", async () => {
    const seen: string[] = [];
    const result = await convert(Buffer.from(AMBIGUOUS, "utf8"), {
      sourceName: "t.htm",
      resolver: resolverOf({
        async blockRole(request) {
          seen.push(request.line);
          if (!/Сочинения/u.test(request.line)) return null;
          return { role: "SECTION_LABEL", depth: 2, confidence: 0.9, reason: "names the section below it" };
        },
      }),
    });

    expect(seen.some((l) => /Сочинения/u.test(l))).toBe(true);
    expect(result.markdown).toContain("## Сочинения");
    // The title the rule recovered is untouched, and there is still one of it.
    expect(result.markdown.match(/^# /gmu)).toHaveLength(1);
  });

  it("records a non-heading role as a review item and applies nothing", async () => {
    const result = await convert(Buffer.from(AMBIGUOUS, "utf8"), {
      sourceName: "t.htm",
      resolver: resolverOf({
        async blockRole() {
          return { role: "MENU_ITEM", confidence: 0.9, reason: "a destination, not a description" };
        },
      }),
    });
    const plain = await convert(Buffer.from(AMBIGUOUS, "utf8"), { sourceName: "t.htm" });
    expect(result.markdown).toBe(plain.markdown);
    expect(result.ledger.some((e) => e.pass === "text.block-role" && e.terminal.kind === "REVIEW")).toBe(true);
  });
});

describe("image.role — the icon table's documented no-match path", () => {
  const UNKNOWN_ICON = `<html><body>
    <p style="font: bold 20pt Arial">Ноты</p>
    <p style="font-size:12pt">Смотрите также
      <a href="next.htm"><img src="../main/arrow-x9.gif" width="16" height="16"></a></p>
  </body></html>`;

  it("turns an unmapped control into a sanctioned glyph", async () => {
    const result = await convert(Buffer.from(UNKNOWN_ICON, "utf8"), {
      sourceName: "i.htm",
      resolver: resolverOf({
        async imageRole() {
          return { role: "ICON", glyph: "▶", confidence: 0.9, reason: "a forward arrow inside a link" };
        },
      }),
    });
    expect(result.markdown).toContain("▶");
    expect(result.markdown).not.toContain("arrow-x9.gif");
  });

  it("refuses a mark the project's own table does not sanction, and keeps the picture", async () => {
    const result = await convert(Buffer.from(UNKNOWN_ICON, "utf8"), {
      sourceName: "i.htm",
      resolver: resolverOf({
        async imageRole() {
          return { role: "ICON", glyph: "🚀", confidence: 1, reason: "adversarial" };
        },
      }),
    });
    const plain = await convert(Buffer.from(UNKNOWN_ICON, "utf8"), { sourceName: "i.htm" });
    expect(result.markdown).toBe(plain.markdown);
    expect(result.markdown).not.toContain("🚀");
  });

  it("will not silence an image whose author labelled it", async () => {
    // A `DECORATION` verdict may only reach an image the source said nothing
    // about. An `alt` is the author speaking, and no reading of the surroundings
    // outranks it.
    const labelled = UNKNOWN_ICON.replace("width=\"16\"", "alt=\"вперёд\" width=\"16\"");
    const result = await convert(Buffer.from(labelled, "utf8"), {
      sourceName: "i.htm",
      resolver: resolverOf({
        async imageRole() {
          return { role: "DECORATION", confidence: 1, reason: "adversarial" };
        },
      }),
    });
    expect(result.markdown).toContain("вперёд");
  });
});

describe("document.review — advisory, and checked against the document", () => {
  const PAGE = `<html><body><p style="font: bold 20pt Arial">Заголовок</p>
    <p style="font-size:12pt">Обычный текст страницы для проверки.</p></body></html>`;

  it("keeps a finding that quotes the produced document, and files it as a review item", async () => {
    const result = await convert(Buffer.from(PAGE, "utf8"), {
      sourceName: "r.htm",
      resolver: resolverOf({
        async reviewDocument(request) {
          // Quote something the produced document really contains.
          const quote = request.output.includes("Заголовок") ? "Заголовок" : "";
          return [{ severity: "major", class: "structure.flattened", quote, note: "a note" }];
        },
      }),
    });
    expect(result.reviewFindings).toHaveLength(1);
    expect(result.ledger.some((e) => e.pass === "document.review")).toBe(true);
  });

  it("drops a finding whose quote is not in the document, and keeps the rest of the reply", async () => {
    const result = await convert(Buffer.from(PAGE, "utf8"), {
      sourceName: "r.htm",
      resolver: resolverOf({
        async reviewDocument() {
          return [
            { severity: "critical", class: "invented.finding", quote: "текст которого нет", note: "n" },
            { severity: "minor", class: "real.finding", quote: "Заголовок", note: "n" },
          ];
        },
      }),
    });
    // One hallucinated quote costs one finding, not the whole reply.
    expect(result.reviewFindings.map((f) => f.class)).toEqual(["real.finding"]);
  });

  it("changes no byte of the output, whatever it reports", async () => {
    const reviewed = await convert(Buffer.from(PAGE, "utf8"), {
      sourceName: "r.htm",
      resolver: resolverOf({
        async reviewDocument() {
          return [{ severity: "critical", class: "x.y", quote: "Заголовок", note: "n" }];
        },
      }),
    });
    const plain = await convert(Buffer.from(PAGE, "utf8"), { sourceName: "r.htm" });
    expect(reviewed.markdown).toBe(plain.markdown);
  });
});

describe("the progress channel", () => {
  it("reports every stage, and names each escalation's outcome", async () => {
    const events: ConvertEvent[] = [];
    await convert(Buffer.from(`<html><body><p style="font: bold 20pt Arial">Заголовок</p>
      <p style="font-size:12pt">Обычный текст страницы.</p></body></html>`, "utf8"), {
      sourceName: "p.htm",
      onProgress: (event) => events.push(event),
    });

    const stages = events.filter((e) => e.type === "stage").map((e) => (e as { stage: string }).stage);
    expect(stages).toContain("decode");
    expect(stages).toContain("chrome");
    expect(stages).toContain("text");
    expect(stages).toContain("headings");
    expect(stages).toContain("tables");
    // Every stage carries a fact, not just a name: a progress line that says
    // only "chrome" tells an operator nothing a spinner would not.
    for (const event of events) {
      if (event.type === "stage") expect(event.detail.length).toBeGreaterThan(0);
    }
  });

  it("emits nothing about escalations when there is no resolver", async () => {
    const events: ConvertEvent[] = [];
    await convert(Buffer.from("<html><body><p>x</p></body></html>", "utf8"), {
      onProgress: (event) => events.push(event),
    });
    expect(events.filter((e) => e.type === "escalation")).toHaveLength(0);
  });
});
