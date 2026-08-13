/**
 * L3 contracts.
 *
 * The two properties `CLAUDE.md` §4 names for L3 come first, because every
 * geometric finding is worthless without them: **identity** — the same file
 * rendered as either side produces byte-identical output — and
 * **determinism**. Then one contract per rendering rule the adjudicator
 * depends on, and one per modelled target quirk.
 *
 * The quirk tests are the ones worth reading twice. They assert that the
 * renderer reproduces a *corruption* rather than the author's intent, and a
 * future contributor "fixing" the renderer to be more correct will fail them —
 * which is the point.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boxAlignment,
  isDistinctive,
  lanesOf,
  normalizeTextAlign,
  overflowsHorizontally,
  proseAlignment,
  readingOrder,
  readingRanks,
  resolveAlignment,
  rowBands,
} from "./geometry.js";
import { compareRendered } from "./compare.js";
import type { BlockGeometry, PageProbe } from "./probe.js";
import { renderBiomd } from "./render.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "out");

function fixtures(): Array<{ name: string; source: string }> {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".bio.md"))
    .sort()
    .map((f) => ({ name: f.replace(/\.bio\.md$/u, ""), source: readFileSync(join(FIXTURES, f), "utf8") }));
}

/**
 * The rendered markup alone, without the stylesheet.
 *
 * Asserting `not.toContain` against the whole document is a trap: the CSS
 * mentions every class the renderer can emit, so a negative assertion on a
 * class name passes or fails for the wrong reason.
 */
function body(html: string): string {
  const start = html.indexOf("<article");
  const end = html.lastIndexOf("</article>");
  return start >= 0 && end > start ? html.slice(start, end) : html;
}

// ---------------------------------------------------------------------------

describe("L3 renderer — the two properties everything else rests on", () => {
  it("is deterministic: the same source renders byte-identically", () => {
    for (const { name, source } of fixtures()) {
      const a = renderBiomd(source).html;
      const b = renderBiomd(source).html;
      expect(a, name).toBe(b);
    }
  });

  it("renders both sides through identical code: the same file as produced and as reference is identical", () => {
    // The invariant `CLAUDE.md` states for L3. There is no side parameter, so
    // this can only fail if someone adds one — which is exactly what it guards.
    for (const { name, source } of fixtures()) {
      const asProduced = renderBiomd(source, { title: name });
      const asReference = renderBiomd(source, { title: name });
      expect(asProduced.html, name).toBe(asReference.html);
    }
  });

  it("finds no reference document that leaves a fence unclosed", () => {
    // This assertion has already earned its place. On L3's first run over the
    // corpus, `pavlov_azancheev.bio.md` ended with an `::: align position:
    // right` that was never closed — the file finished on a `---` thematic
    // break — so the target would have swallowed the closing credit line and
    // the trailing rule into the right-aligned region. The reference was
    // corrected (2026-08-06).
    //
    // The defect was invisible to every other rung: L2 reads both sides through
    // the same reader, so the identical mis-parse happened twice and cancelled,
    // and L1 folds the whole document to multisets. Only a renderer that has to
    // decide where the block *ends* has to notice.
    const unclosed = fixtures()
      .filter(({ source }) => renderBiomd(source).warnings.some((w) => w.code === "unclosed-fence"))
      .map(({ name }) => name);
    expect(unclosed).toEqual([]);
  });

  it("emits a line number for every block, so a finding can be localized", () => {
    const { html } = renderBiomd("# T\n\nprose\n\n::: align\nposition: center\n\nx\n\n:::\n");
    const blocks = [...html.matchAll(/data-l3="[^"]*"/gu)];
    const lines = [...html.matchAll(/data-line="(\d+)"/gu)];
    expect(blocks.length).toBeGreaterThan(0);
    expect(lines.length).toBe(blocks.length);
    expect(lines.every((m) => Number(m[1]) >= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("L3 renderer — modelled target quirks", () => {
  it("promotes a `divider` line inside ::: columns to a synthetic first column", () => {
    // `read()` documents this: `columns` is not a property-header directive, so
    // the line is never read as a property and the target promotes it. Rendering
    // the intent instead would hide why `divider` must never be emitted.
    const { html } = renderBiomd(
      "::: columns\ndivider: true\n\n::: column\n\nA\n\n:::\n\n::: column\n\nB\n\n:::\n\n:::\n",
    );
    expect(html).toContain('data-tracks="3"');
    expect(html).toContain('data-promoted="1"');
    expect(html).toContain('data-quirk="promoted-property-line"');
  });

  it("gives a clean ::: columns exactly as many tracks as it has column children", () => {
    const { html } = renderBiomd("::: columns\n\n::: column\n\nA\n\n:::\n\n::: column\n\nB\n\n:::\n\n:::\n");
    expect(html).toContain('data-tracks="2"');
    expect(html).not.toContain("data-promoted");
    expect(html).not.toContain("promoted-property-line");
  });

  it("leaves a ::: frame property line as body text, because the target never reads it", () => {
    const { html } = renderBiomd("::: frame\nframe: black\n\nText.\n\n:::\n");
    expect(html).toContain('data-quirk="property-not-read"');
    // The palette falls back to §11's default rather than to what was asked for.
    expect(html).toContain('data-frame="gold"');
    expect(html).not.toContain('data-frame="black"');
  });

  it("does read a property header on the directives the target strips one from", () => {
    const { html } = renderBiomd("::: align\nposition: center\n\nx\n\n:::\n");
    expect(html).toContain('data-position="center"');
    // The property line was consumed as a property, so it must not also survive
    // as visible body text — the failure mode the `columns` quirk above *is*.
    expect(html).not.toContain("position: center");
  });
});

// ---------------------------------------------------------------------------

describe("L3 renderer — spec rendering rules", () => {
  it("§13: marks an unrecognized align position instead of guessing at it", () => {
    const { html } = renderBiomd("::: align\nposition: sideways\n\nx\n\n:::\n");
    expect(html).toContain('data-invalid-position="sideways"');
    expect(html).not.toContain('data-position="sideways"');
    expect(html).toContain("x");
  });

  it("§6: carries position and size onto a standalone image and not onto a group child", () => {
    const standalone = renderBiomd("::: image\nsrc: a.jpg\nposition: right\nsize: small\n:::\n").html;
    expect(standalone).toContain("pos-right");
    expect(standalone).toContain("width:22%");

    const grouped = body(renderBiomd("::: images\ncolumns: 2\n\n::: image\nsrc: a.jpg\n:::\n\n::: image\nsrc: b.jpg\n:::\n\n:::\n").html);
    expect(grouped).toContain('data-columns="2"');
    expect(grouped).toContain('data-standalone="false"');
    // §7: "Child `position` and `size` properties SHOULD be omitted and are
    // ignored if present." Asserted on the markup, not on the whole document —
    // the stylesheet naturally mentions every position class.
    expect(grouped).not.toContain("pos-right");
  });

  it("§6.5: a group frame is the default for children, and a child value wins", () => {
    const { html } = renderBiomd(
      "::: images\ncolumns: 2\nframe: mat\n\n::: image\nsrc: a.jpg\n:::\n\n::: image\nsrc: b.jpg\nframe: black\n:::\n\n:::\n",
    );
    expect(html).toContain("frame-mat");
    expect(html).toContain("frame-black");
  });

  it("§3.1: a hard break becomes <br> and a soft one becomes a space", () => {
    const { html } = renderBiomd("line one\\\nline two\nline three\n");
    expect(html).toContain("<br>");
    expect(html.match(/<br>/gu)?.length).toBe(1);
  });

  it("§3.8: applies per-column alignment and marks an all-empty header", () => {
    const { html } = renderBiomd("| a | b |\n| :-- | --: |\n| 1 | 2 |\n");
    expect(html).toContain('class="ta-left"');
    expect(html).toContain('class="ta-right"');
    expect(html).toContain('data-cell="0,1"');

    const empty = renderBiomd("|  |  |\n| --- | --- |\n| 1 | 2 |\n").html;
    expect(empty).toContain('data-header-empty="true"');
  });

  it("§10: renders a nav as one bar and marks the active item with aria-current", () => {
    const { html } = renderBiomd("::: nav\ntitle: T\nactive: B\n- [A](a.md)\n- B\n:::\n");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("nav-title");
    expect(html.match(/<li/gu)?.length).toBe(2);
  });

  it("§15: resolves relative targets against the resource base, and ^ against the root", () => {
    const base = renderBiomd("::: image\nsrc: music/x.jpg\nposition: center\nsize: small\n:::\n").html;
    expect(base).toContain('src="/pages/music/x.jpg"');

    const anchored = renderBiomd("::: image\nsrc: ^/main/cover.jpg\nposition: center\nsize: small\n:::\n").html;
    expect(anchored).toContain('src="/main/cover.jpg"');

    const climbing = renderBiomd("::: image\nsrc: /../main/cover.jpg\nposition: center\nsize: small\n:::\n").html;
    expect(climbing).toContain('src="/main/cover.jpg"');
  });

  it("leaves absolute URLs and fragments untouched", () => {
    const { html } = renderBiomd("[x](https://example.org/a) and [y](#works)\n");
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain('href="#works"');
  });

  it("renders `::anchor` as a destination with no geometry", () => {
    const { html, warnings } = renderBiomd("[к альбому](#20)\n\n::anchor{#20}\n\nАльбом.\n");
    expect(warnings).toEqual([]);
    expect(html).toContain('<a class="anchor" id="20"');
    // `display:none`, so an anchored produced document and an anchor-free
    // reference cannot differ geometrically because of the marker.
    expect(html).toContain(".anchor{display:none}");
    // And the block it precedes is untouched.
    expect(html).toContain("Альбом.");
  });

  it("renders escapes as literal characters rather than as markup", () => {
    const { html } = renderBiomd("\\[Надежда] and 1\\. and \\*not em\\*\n");
    expect(html).toContain("[Надежда]");
    expect(html).toContain("1.");
    expect(html).toContain("*not em*");
    expect(html).not.toContain("<em>");
  });

  it("escapes HTML in content rather than passing it through", () => {
    const { html } = renderBiomd("a < b & c > d\n");
    expect(html).toContain("a &lt; b &amp; c &gt; d");
  });

  it("leaves no protection sentinel in the output", () => {
    for (const { name, source } of fixtures()) {
      expect(renderBiomd(source).html.includes("\u0001"), name).toBe(false);
    }
  });

  it("re-nests a flattened list by item depth without losing an item", () => {
    const { html } = renderBiomd("- a\n  - b\n  - c\n- d\n");
    expect(html.match(/<li/gu)?.length).toBe(4);
    expect(html).toContain('class="nested"');
  });
});

// ---------------------------------------------------------------------------

describe("L3 geometry — the vocabulary the alignment family is decided in", () => {
  it("folds the vendor and logical text-align forms Chromium actually returns", () => {
    // The falsifier for H1. `prominence.ts:138` and `structure.ts:1437` compare
    // with `=== "center"`, which misses every one of the first three.
    expect(normalizeTextAlign("-webkit-center")).toBe("center");
    expect(normalizeTextAlign("-webkit-left")).toBe("left");
    expect(normalizeTextAlign("-webkit-right")).toBe("right");
    expect(normalizeTextAlign("start")).toBe("left");
    expect(normalizeTextAlign("end")).toBe("right");
    expect(normalizeTextAlign("Justify")).toBe("justify");
    expect(normalizeTextAlign("match-parent")).toBe("unknown");
    expect(normalizeTextAlign(undefined)).toBe("unknown");
  });

  it("reads alignment off a shrink-wrapped box when no keyword says anything", () => {
    const container = { x: 0, y: 0, w: 1000, h: 100 };
    expect(boxAlignment({ x: 400, y: 0, w: 200, h: 20 }, container)).toBe("center");
    expect(boxAlignment({ x: 0, y: 0, w: 200, h: 20 }, container)).toBe("left");
    expect(boxAlignment({ x: 800, y: 0, w: 200, h: 20 }, container)).toBe("right");
    // Filling its container: the position says nothing at all.
    expect(boxAlignment({ x: 0, y: 0, w: 1000, h: 20 }, container)).toBe("unknown");
    // Inset on both sides but not symmetrically: not an alignment.
    expect(boxAlignment({ x: 100, y: 0, w: 400, h: 20 }, container)).toBe("unknown");
  });

  it("lets the box win when keyword and position disagree", () => {
    const container = { x: 0, y: 0, w: 1000, h: 100 };
    const centred = { x: 400, y: 0, w: 200, h: 20 };
    expect(resolveAlignment("left", centred, container)).toEqual({ alignment: "center", evidence: "box" });
    expect(resolveAlignment("center", centred, container)).toEqual({ alignment: "center", evidence: "keyword+box" });
    expect(resolveAlignment("center", undefined, undefined)).toEqual({ alignment: "center", evidence: "keyword" });
    expect(resolveAlignment(undefined, undefined, undefined)).toEqual({ alignment: "unknown", evidence: "none" });
  });

  it("weights the prose baseline by text length, not by block count", () => {
    // Forty short centred captions do not make a justified page a centred one.
    const blocks = [
      ...Array.from({ length: 40 }, () => ({ alignment: "center" as const, textLength: 20 })),
      { alignment: "justify" as const, textLength: 900 },
      { alignment: "justify" as const, textLength: 800 },
    ];
    expect(proseAlignment(blocks)).toBe("justify");
  });

  it("ignores short blocks when computing the baseline, since those are what it judges", () => {
    expect(proseAlignment([{ alignment: "center", textLength: 10 }])).toBe("unknown");
  });

  it("treats left and justify as the same reading flow when deciding distinctiveness", () => {
    expect(isDistinctive("left", "justify")).toBe(false);
    expect(isDistinctive("justify", "left")).toBe(false);
    expect(isDistinctive("center", "justify")).toBe(true);
    expect(isDistinctive("right", "left")).toBe(true);
    // The corpus fact that makes an absolute keyword useless: a wholly centred
    // page has no centred blocks.
    expect(isDistinctive("center", "center")).toBe(false);
    expect(isDistinctive("unknown", "left")).toBe(false);
  });

  it("assigns lanes by row, ordering a row by x rather than by a one-pixel y", () => {
    const boxes = [
      { x: 0, y: 0, w: 100, h: 20 },
      { x: 300, y: 1, w: 100, h: 20 }, // same visual row, 1 px lower
      { x: 0, y: 200, w: 100, h: 20 },
    ];
    expect(lanesOf(boxes)).toEqual([0, 1, 0]);
  });

  it("orders two boxes on one visual line left to right, and stacked boxes top to bottom", () => {
    const a = { x: 0, y: 0, w: 100, h: 40 };
    const b = { x: 300, y: 2, w: 100, h: 40 };
    const c = { x: 0, y: 500, w: 100, h: 40 };
    expect(readingOrder(a, b)).toBeLessThan(0);
    expect(readingOrder(c, a)).toBeGreaterThan(0);
  });

  it("bands rows transitively, so one tall cell does not absorb the page", () => {
    // The defect this replaced: a pairwise row test is not transitive — A shares
    // a row with B, B with C, A and C do not overlap — and sorting with it gave
    // an implementation-defined permutation. Comparing against the band's
    // anchor keeps the tall left cell of a two-column region from chaining
    // every box below it into one row.
    const boxes = [
      { x: 0, y: 0, w: 200, h: 400 }, // tall left cell
      { x: 300, y: 0, w: 200, h: 30 }, // beside it: same row
      { x: 300, y: 500, w: 200, h: 30 }, // below both: a new row
    ];
    expect(rowBands(boxes)).toEqual([0, 0, 1]);
  });

  it("produces a total reading order: a permutation, with no rank repeated", () => {
    const boxes = [
      { x: 300, y: 0, w: 100, h: 20 },
      { x: 0, y: 2, w: 100, h: 20 },
      { x: 0, y: 300, w: 100, h: 20 },
      { x: 500, y: 301, w: 100, h: 20 },
    ];
    const ranks = readingRanks(boxes);
    expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Row one reads left to right regardless of the 2 px difference in y.
    expect(ranks[1]).toBeLessThan(ranks[0]!);
    expect(ranks[2]).toBeLessThan(ranks[3]!);
    expect(ranks[0]).toBeLessThan(ranks[2]!);
  });

  it("ranks a set identically however the input is permuted", () => {
    // The property a pairwise comparator cannot offer, and the reason two
    // independently-sorted documents could previously disagree for no reason.
    const boxes = [
      { x: 0, y: 0, w: 100, h: 20 },
      { x: 300, y: 1, w: 100, h: 20 },
      { x: 0, y: 200, w: 100, h: 20 },
      { x: 300, y: 200, w: 100, h: 20 },
    ];
    const direct = readingRanks(boxes);
    const shuffled = [3, 1, 0, 2];
    const permutedRanks = readingRanks(shuffled.map((i) => boxes[i]!));
    shuffled.forEach((original, k) => {
      expect(permutedRanks[k]).toBe(direct[original]);
    });
  });

  it("measures horizontal overflow against the article measure", () => {
    const article = { x: 100, y: 0, w: 800, h: 1000 };
    expect(overflowsHorizontally({ x: 100, y: 0, w: 800, h: 10 }, article)).toBe(0);
    expect(overflowsHorizontally({ x: 100, y: 0, w: 900, h: 10 }, article)).toBe(99);
    expect(overflowsHorizontally({ x: 20, y: 0, w: 100, h: 10 }, article)).toBe(79);
  });
});

// ---------------------------------------------------------------------------

/**
 * Comparator contracts, without a browser.
 *
 * `compareRendered` takes probe *results*, so its behaviour is testable from
 * synthetic ones. The corpus-level identity run — every reference against
 * itself through Chromium, 0 findings — is recorded in `CONVERTER-PROGRESS.md`;
 * this is the version that runs in CI on a machine with no browser.
 */
function block(over: Partial<BlockGeometry> & { path: string }): BlockGeometry {
  return {
    line: 1,
    kind: "paragraph",
    box: { x: 0, y: 0, w: 700, h: 20 },
    container: { x: 0, y: 0, w: 700, h: 1000 },
    textAlign: "start",
    float: "none",
    display: "block",
    text: "",
    textLength: 0,
    ancestors: [],
    imageName: null,
    overflow: 0,
    ...over,
  };
}

function page(blocks: BlockGeometry[]): PageProbe {
  return {
    viewport: { width: 1024, height: 768 },
    article: { x: 0, y: 0, w: 700, h: 4000 },
    blocks,
    documentHeight: 4000,
    warnings: [],
  };
}

describe("L3 comparator", () => {
  const prose = "x ".repeat(120).trim();
  const surface = () =>
    page([
      block({ path: "/paragraph[0]", line: 1, text: prose, textLength: prose.length, box: { x: 0, y: 0, w: 700, h: 200 } }),
      block({ path: "/paragraph[1]", line: 9, text: "- 2 -", textLength: 5, box: { x: 0, y: 300, w: 700, h: 20 } }),
      block({ path: "/paragraph[2]", line: 13, text: prose, textLength: prose.length, box: { x: 0, y: 340, w: 700, h: 200 } }),
    ]);

  it("identity: the same page on both sides yields zero findings", () => {
    expect(compareRendered({ doc: "d", produced: surface(), reference: surface(), source: null }).findings).toEqual([]);
  });

  it("reports an alignment difference only when one side is distinctive", () => {
    const centred = surface();
    centred.blocks[1] = block({ ...centred.blocks[1]!, textAlign: "center" });
    const result = compareRendered({ doc: "d", produced: surface(), reference: centred, source: null });
    const align = result.findings.filter((f) => f.class === "layout.align.mismatch");
    expect(align).toHaveLength(1);
    expect(align[0]!.geometry["referenceAlign"]).toBe("center");
    expect(align[0]!.geometry["producedAlign"]).toBe("left");
    expect(align[0]!.referenceLine).toBe(9);
  });

  it("does not report an alignment difference on a page whose prose is itself centred", () => {
    // The corpus fact §5 turns on: a wholly centred page has no centred blocks.
    //
    // Two prose blocks, not one. `proseAlign` requires a second sample before it
    // will call anything the baseline — one block comparing itself against
    // itself is what let `new_lagq2` declare a justified gallery page centred —
    // so a fixture with a single long block cannot state this premise at all.
    const centredPage = () => {
      const p = surface();
      p.blocks = p.blocks.map((b) => block({ ...b, textAlign: "center" }));
      return p;
    };
    const left = surface();
    left.blocks[1] = block({ ...left.blocks[1]!, textAlign: "-webkit-center" });
    const result = compareRendered({ doc: "d", produced: centredPage(), reference: left, source: null });
    expect(result.findings.filter((f) => f.class === "layout.align.mismatch")).toEqual([]);
  });

  it("anchors a rule to its neighbours instead of pairing rules by ordinal", () => {
    // A `---` carries no text, so every rule on a page has the same pair key.
    // Pairing them in document order makes one extra rule near the top shift
    // every rule after it, and each shift is reported as a move. On `news` that
    // manufactured 26 order findings out of a five-rule difference; the same
    // offset then reappeared as rank drift on the text blocks between them.
    const withRules = (extra: boolean) => {
      const blocks: BlockGeometry[] = [];
      let y = 0;
      const add = (text: string, kind = "paragraph") => {
        blocks.push(block({ path: `/${kind}[${blocks.length}]`, kind, text, textLength: text.length, box: { x: 0, y, w: 700, h: 20 } }));
        y += 40;
      };
      if (extra) add("", "break");
      add("первая запись");
      add("", "break");
      add("вторая запись");
      add("", "break");
      add("третья запись");
      return page(blocks);
    };
    const result = compareRendered({ doc: "d", produced: withRules(true), reference: withRules(false), source: null });
    // The three text blocks pair on their own evidence and sit in the same
    // relative order on both sides, so nothing has moved past anything.
    expect(result.findings.filter((f) => f.class === "layout.order.mismatch")).toEqual([]);
  });

  it("reports containment by the chain of block kinds, not by path index", () => {
    const wrapped = surface();
    wrapped.blocks.push(block({ path: "/columns[2]", kind: "columns", text: "" }));
    wrapped.blocks[1] = block({ ...wrapped.blocks[1]!, ancestors: ["/columns[2]"] });
    const result = compareRendered({ doc: "d", produced: surface(), reference: wrapped, source: null });
    const containment = result.findings.filter((f) => f.class === "layout.containment.mismatch");
    expect(containment).toHaveLength(1);
    expect(containment[0]!.geometry["referenceContainer"]).toBe("columns");
    expect(containment[0]!.geometry["producedContainer"]).toBe("(root)");
  });

  it("never reports a block as moved past itself", () => {
    // The regression the non-transitive comparator caused: one finding whose
    // produced and reference ranks were equal.
    const moved = surface();
    moved.blocks[1] = block({ ...moved.blocks[1]!, box: { x: 0, y: -100, w: 700, h: 20 } });
    const result = compareRendered({ doc: "d", produced: moved, reference: surface(), source: null });
    for (const f of result.findings.filter((x) => x.class === "layout.order.mismatch")) {
      expect(f.geometry["producedRank"]).not.toBe(f.geometry["referenceRank"]);
    }
  });

  it("binds an uncaptioned figure to its source node by image name", () => {
    const figure = block({ path: "/image[0]", kind: "image", text: "", imageName: "x.jpg", textAlign: "center" });
    const produced = page([block({ path: "/image[0]", kind: "image", text: "", imageName: "x.jpg" })]);
    const reference = page([figure]);
    const source = page([
      block({ path: "/html[1]/body[1]/p[1]", kind: "p", text: "", imageName: "x.jpg", textAlign: "-webkit-center", ancestors: ["/html[1]"] }),
    ]);
    const rows = compareRendered({ doc: "d", produced, reference, source }).alignment;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourcePath).toBe("/html[1]/body[1]/p[1]");
    expect(rows[0]!.sourceTextAlignRaw).toBe("-webkit-center");
    expect(rows[0]!.sourceAlignment).toBe("center");
  });
});
