/**
 * Target conformance suite.
 *
 * Input `.bio.md` → expected parse behaviour, derived from the observed target
 * parser rather than from the specification's prose. This is the real contract
 * between the converter and whatever consumes its output; it is static data and
 * requires no renderer to run.
 */
import { describe, expect, it } from "vitest";
import { directiveNames, markdownRuns, read } from "./read.js";
import { serialize } from "./serialize.js";
import {
  makeAlign,
  makeAnchor,
  makeColumn,
  makeColumns,
  makeFrame,
  makeGroupedImage,
  makeImage,
  makeImages,
  makeLead,
  makeNav,
} from "./builders.js";
import { PROFILE_RENDERER_CURRENT, PROFILE_SPEC_V16 } from "./profile.js";
import { lintText, validate } from "./validate.js";
import { paragraph } from "./text.js";
import type { BiomdRoot } from "./types.js";

const h1 = (text: string) =>
  ({ type: "heading", depth: 1, children: [{ type: "text", value: text }] }) as const;

function doc(...children: BiomdRoot["children"]): BiomdRoot {
  return { type: "root", children };
}

describe("fence and property mechanics", () => {
  it("reads a property header terminated by a blank line", () => {
    const { children, warnings } = read("::: align\nposition: center\n\nТекст.\n\n:::\n");
    expect(warnings).toEqual([]);
    expect(children).toHaveLength(1);
    const block = children[0];
    if (block?.kind !== "directive") throw new Error("expected directive");
    expect(block.name).toBe("align");
    expect(block.props).toEqual({ position: "center" });
    expect(markdownRuns([block])).toEqual(["Текст."]);
  });

  it("LANDMINE: a Latin-script label line is absorbed as a property when the blank line is missing", () => {
    // The failure the serializer's unconditional separator prevents. A single
    // Latin word followed by a colon is indistinguishable from a property.
    const { children } = read("::: align\nposition: center\nAndante: вторая часть\n\nТекст.\n\n:::\n");
    const block = children[0];
    if (block?.kind !== "directive") throw new Error("expected directive");
    expect(block.props).toEqual({ position: "center", Andante: "вторая часть" });
    // The label line is gone from the body — silently, with no warning.
    expect(markdownRuns([block])).toEqual(["Текст."]);
  });

  it("BOUNDARY: a Cyrillic label cannot trigger it — the property pattern is ASCII-anchored", () => {
    // `^([A-Za-z][\w-]*):` never matches `Дата:`, so the property header ends
    // at that line and the text survives. This narrows the real exposure to
    // Latin-script labels: musical terms, and the en/de editions.
    const { children } = read("::: align\nposition: center\nДата: 1893 год\n\nТекст.\n\n:::\n");
    const block = children[0];
    if (block?.kind !== "directive") throw new Error("expected directive");
    expect(block.props).toEqual({ position: "center" });
    expect(markdownRuns([block]).join("\n")).toContain("Дата: 1893 год");
  });

  it("the serializer never produces that shape, for either script", () => {
    for (const label of ["Andante: вторая часть", "Дата: 1893 год"]) {
      const out = serialize(doc(makeAlign({ position: "center", children: [paragraph(label)] })));
      const { children } = read(out);
      const block = children[0];
      if (block?.kind !== "directive") throw new Error("expected directive");
      expect(block.props).toEqual({ position: "center" });
      expect(markdownRuns([block])).toEqual([label]);
    }
  });

  it("tolerates an unclosed fence by running content to EOF, with a warning", () => {
    const { children, warnings } = read("::: lead\n\nВступление.\n");
    expect(warnings.map((w) => w.code)).toContain("unclosed-fence");
    expect(markdownRuns(children)).toEqual(["Вступление."]);
  });

  it("closes the most recently opened directive, name-agnostically", () => {
    const { children } = read("::: columns\n\n::: column\n\nA\n\n:::\n\n::: column\n\nB\n\n:::\n\n:::\n");
    expect(directiveNames(children)).toEqual(["columns", "column", "column"]);
  });
});

describe("the columns/divider corruption", () => {
  it("REPRODUCES: divider: true becomes a stray markdown run inside columns", () => {
    // The `columns` handler segments its body without stripping a property
    // header, so the property line survives as content and is promoted to a
    // synthetic first column.
    const source = [
      "::: columns",
      "divider: true",
      "",
      "::: column",
      "",
      "A",
      "",
      ":::",
      "",
      "::: column",
      "",
      "B",
      "",
      ":::",
      ":::",
      "",
    ].join("\n");
    const { children, warnings } = read(source);
    const block = children[0];
    if (block?.kind !== "directive") throw new Error("expected directive");

    expect(block.props).toEqual({}); // not read as a property at all
    expect(markdownRuns([block])).toContain("divider: true"); // rendered as content
    expect(warnings.map((w) => w.code)).toContain("stray-content-in-container");
  });

  it("the builder refuses to construct it against the current target", () => {
    expect(() =>
      makeColumns({
        children: [makeColumn([paragraph("A")]), makeColumn([paragraph("B")])],
        divider: true,
        profile: PROFILE_RENDERER_CURRENT,
      }),
    ).toThrow(/cannot render `divider`/u);
  });

  it("output for the current target contains no stray content inside columns", () => {
    const out = serialize(
      doc(makeColumns({ children: [makeColumn([paragraph("A")]), makeColumn([paragraph("B")])] })),
    );
    const { warnings } = read(out);
    expect(warnings).toEqual([]);
  });
});

describe("profile-gated constructs", () => {
  it("validator rejects frame and signature against the current target", () => {
    const frameTree = doc(h1("T"), {
      type: "biomdFrame",
      frame: "gold",
      children: [paragraph("Внимание.")],
    });
    const result = validate(frameTree, { profile: PROFILE_RENDERER_CURRENT });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("frame-unsupported");

    // The same tree is valid against the specification as written.
    expect(validate(frameTree, { profile: PROFILE_SPEC_V16 }).ok).toBe(true);
  });
});

describe("round trip", () => {
  it("serialize → read recovers the directive structure and properties", () => {
    const tree = doc(
      h1("Андрес Сеговия"),
      makeLead([paragraph("Испанский гитарист и педагог.")]),
      makeImage({ src: "photo/s.jpg", position: "right", size: "medium", alt: "Портрет" }),
      makeColumns({
        children: [makeColumn([paragraph("Слева.")]), makeColumn([paragraph("Справа.")])],
      }),
      makeImages({
        columns: 2,
        children: [makeGroupedImage({ src: "a.jpg" }), makeGroupedImage({ src: "b.jpg" })],
      }),
      makeNav({
        list: {
          type: "list",
          ordered: false,
          spread: false,
          children: [
            { type: "listItem", spread: false, children: [paragraph("Биография")] },
            { type: "listItem", spread: false, children: [paragraph("Записи")] },
          ],
        },
        active: "Записи",
      }),
    );

    const text = serialize(tree);
    const skeleton = read(text);

    expect(skeleton.warnings).toEqual([]);
    expect(directiveNames(skeleton.children)).toEqual([
      "lead",
      "image",
      "columns",
      "column",
      "column",
      "images",
      "image",
      "image",
      "nav",
    ]);

    const image = skeleton.children.find((c) => c.kind === "directive" && c.name === "image");
    if (image?.kind !== "directive") throw new Error("expected image");
    expect(image.props).toEqual({
      src: "photo/s.jpg",
      position: "right",
      size: "medium",
      alt: "Портрет",
    });
  });

  it("is idempotent: reading serialized output and re-reading is stable", () => {
    const tree = doc(h1("T"), makeLead([paragraph("Вступление.")]), paragraph("Текст."));
    const once = serialize(tree);
    const twice = read(once);
    expect(twice.warnings).toEqual([]);
    // All prose survives byte-for-byte through the fence layer.
    expect(markdownRuns(twice.children).join("\n")).toContain("Вступление.");
    expect(markdownRuns(twice.children).join("\n")).toContain("Текст.");
  });

  it("prose that looks like a fence survives as prose", () => {
    const out = serialize(doc(h1("T"), paragraph("::: lead")));
    const { children, warnings } = read(out);
    expect(warnings).toEqual([]);
    expect(directiveNames(children)).toEqual([]); // no directive was created
  });
});

/**
 * What the revised `BioMD-Reference.md` permits.
 *
 * Every case below was refused by this codebase before the reference was
 * revised, and every one of them is a document the format allows. The contract
 * is the same in each: **the converter may narrow what it emits, but nothing
 * here may refuse what the reference admits.** A narrowing that is a claim
 * about the renderer belongs in a `TargetProfile`; a narrowing that is a claim
 * about the format is a defect.
 */
describe("reference permissions the implementation used to refuse", () => {
  describe("columns arity — §2 '≥2 column', §3 'columns: 2|3|4'", () => {
    const lane = () => makeColumn([paragraph("x")]);

    it("accepts four columns", () => {
      const node = makeColumns({ children: [lane(), lane(), lane(), lane()] });
      expect(node.children).toHaveLength(4);
      expect(validate(doc(h1("T"), node)).diagnostics.filter((d) => d.code === "columns-arity")).toEqual([]);
    });

    it("still refuses one, and still refuses five — the bounds are the reference's own", () => {
      expect(() => makeColumns({ children: [lane()] })).toThrow(/between 2 and 4/u);
      expect(() => makeColumns({ children: [lane(), lane(), lane(), lane(), lane()] })).toThrow(
        /between 2 and 4/u,
      );
    });

    it("FALSE FRIEND: a declared `columns:` that disagrees with the child count is still an error", () => {
      // Widening the arity must not weaken the one thing the property asserts.
      // A reader that trusts `columns: 3` over three children in a two-lane grid
      // lays out the wrong number of tracks.
      expect(() =>
        makeColumns({ children: [lane(), lane()], columns: 3, profile: PROFILE_SPEC_V16 }),
      ).toThrow(/disagrees with 2 column children/u);
    });

    it("the `columns` property is gated on the target, not on the format", () => {
      expect(makeColumns({ children: [lane(), lane()], columns: 2, profile: PROFILE_SPEC_V16 }).columns).toBe(2);
      // Same document, target that cannot strip a property header inside `columns`.
      expect(() =>
        makeColumns({ children: [lane(), lane()], columns: 2, profile: PROFILE_RENDERER_CURRENT }),
      ).toThrow(/bogus first column/u);
    });
  });

  describe("picture frames — §3 'curl|none|mat|black|white|red|gold'", () => {
    it("accepts the palette tokens the revised reference added", () => {
      for (const frame of ["black", "white", "red", "gold"] as const) {
        expect(makeImage({ src: "a.jpg", position: "center", size: "medium", frame }).frame).toBe(frame);
      }
    });

    it("still accepts the two legacy tokens, so older documents read back unchanged", () => {
      for (const frame of ["shadow", "oval"] as const) {
        expect(makeImage({ src: "a.jpg", position: "center", size: "medium", frame }).frame).toBe(frame);
      }
    });

    it("rejects a value from neither list", () => {
      expect(() =>
        makeImage({ src: "a.jpg", position: "center", size: "medium", frame: "#c0c0c0" }),
      ).toThrow(/must be one of/u);
    });
  });

  describe("heading policy — §6 'a corpus convention, not a syntax requirement'", () => {
    const wrappedMasthead = doc(
      makeAlign({ position: "center", children: [h1("Иоганн Себастьян"), h1("Бах")] }),
      paragraph("Текст."),
    );

    it("a title wrapped over two `#` lines validates", () => {
      const result = validate(wrappedMasthead, { profile: PROFILE_SPEC_V16 });
      expect(result.ok).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "h1-count" && d.severity === "error")).toEqual([]);
    });

    it("…and is still reported, as a warning: the count is a real recovery signal", () => {
      const warnings = validate(wrappedMasthead).diagnostics.filter((d) => d.code === "h1-count");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.severity).toBe("warning");
    });

    it("a document with no title is a warning too, not a failure", () => {
      const result = validate(doc(paragraph("Текст.")));
      expect(result.diagnostics.some((d) => d.code === "h1-count" && d.severity === "warning")).toBe(true);
      expect(result.ok).toBe(true);
    });

    it("a level skip is a fidelity smell, not a grammar violation", () => {
      const skipped = doc(h1("T"), {
        type: "heading",
        depth: 3,
        children: [{ type: "text", value: "S" }],
      });
      const found = validate(skipped).diagnostics.filter((d) => d.code === "heading-skips-level");
      expect(found).toHaveLength(1);
      expect(found[0]?.severity).toBe("warning");
    });
  });

  describe("align and frame — §2 'permitted … but MUST NOT reject it, and MUST NOT rewrite it'", () => {
    const framedInsideAlign = () =>
      makeAlign({
        position: "center",
        children: [makeFrame({ frame: "black", children: [paragraph("Объявление.")], profile: PROFILE_SPEC_V16 })],
      });

    it("builds, and the frame is preserved in place rather than unwrapped", () => {
      const node = framedInsideAlign();
      expect(node.children.map((c) => c.type)).toEqual(["biomdFrame"]);
    });

    it("validates, with advice rather than an error", () => {
      const result = validate(doc(h1("T"), framedInsideAlign()), { profile: PROFILE_SPEC_V16 });
      expect(result.ok).toBe(true);
      const advice = result.diagnostics.filter((d) => d.code === "align-wraps-frame");
      expect(advice).toHaveLength(1);
      expect(advice[0]?.severity).toBe("warning");
    });

    it("FALSE FRIEND: the inverted, intended shape draws no advice at all", () => {
      const intended = makeFrame({
        frame: "black",
        children: [makeAlign({ position: "center", children: [paragraph("Объявление.")] })],
        profile: PROFILE_SPEC_V16,
      });
      const result = validate(doc(h1("T"), intended), { profile: PROFILE_SPEC_V16 });
      expect(result.diagnostics.filter((d) => d.code === "align-wraps-frame")).toEqual([]);
    });

    it("`columns` and `nav` inside an `align` are still refused — §2 forbids those by name", () => {
      expect(() =>
        makeAlign({
          position: "center",
          children: [makeColumns({ children: [makeColumn([paragraph("a")]), makeColumn([paragraph("b")])] })],
        }),
      ).toThrow(/must not contain/u);
    });
  });

  describe("nesting depth — §3 allows `align` inside a `column`", () => {
    it("columns > column > align > image is four deep and within budget", () => {
      const tree = doc(
        h1("T"),
        makeColumns({
          children: [
            makeColumn([
              makeAlign({
                position: "center",
                children: [makeImage({ src: "a.jpg", position: "center", size: "small" })],
              }),
            ]),
            makeColumn([paragraph("x")]),
          ],
        }),
      );
      const result = validate(tree);
      expect(result.complexity.maxNestingDepth).toBe(4);
      expect(result.diagnostics.filter((d) => d.code === "complexity-budget")).toEqual([]);
    });
  });

  describe("line length — the reference states no ceiling", () => {
    it("an over-long line warns instead of failing", () => {
      const long = `${"а".repeat(3000)}\n`;
      const found = lintText(long).filter((d) => d.code === "line-too-long");
      expect(found).toHaveLength(1);
      expect(found[0]?.severity).toBe("warning");
    });
  });
});

describe("::anchor — the leaf directive", () => {
  it("serializes as one line with no fence", () => {
    const out = serialize(doc(h1("T"), makeAnchor("12"), paragraph("текст")));
    expect(out).toContain("\n::anchor{#12}\n");
    // No closing fence was emitted for it, and the line is complete on its own.
    expect(out.split("\n").filter((l) => l === ":::")).toHaveLength(0);
  });

  it("round-trips through read() with no warnings", () => {
    const out = serialize(doc(makeAnchor("раздел"), paragraph("текст")));
    const skeleton = read(out);
    expect(skeleton.warnings).toEqual([]);
    expect(directiveNames(skeleton.children)).toEqual(["anchor"]);
    const block = skeleton.children[0];
    expect(block?.kind).toBe("directive");
    if (block?.kind === "directive") {
      expect(block.props).toEqual({ id: "раздел" });
      expect(block.children).toEqual([]);
      expect(block.unclosed).toBe(false);
    }
    // The identifier is syntax, not prose: it must not reach the Markdown runs.
    expect(markdownRuns(skeleton.children).join("\n")).not.toContain("раздел");
  });

  it("does not consume the block that follows it", () => {
    const skeleton = read("::anchor{#a}\n\nОбычный абзац.\n\n::anchor{#b}\nСледующая строка.\n");
    expect(directiveNames(skeleton.children)).toEqual(["anchor", "anchor"]);
    expect(markdownRuns(skeleton.children)).toEqual(["Обычный абзац.", "Следующая строка."]);
  });

  it("a line that only looks like one stays prose", () => {
    // Anchored to end of line on purpose: trailing text means the author wrote a
    // sentence, not a marker, and the serializer escapes the leading colons so
    // the two spellings can never be confused.
    const skeleton = read("::anchor{#a} и ещё текст\n");
    expect(directiveNames(skeleton.children)).toEqual([]);
    expect(markdownRuns(skeleton.children)).toEqual(["::anchor{#a} и ещё текст"]);
  });

  it("warns rather than guessing when the shorthand is malformed", () => {
    expect(read("::anchor{}\n").warnings.map((w) => w.code)).toEqual(["malformed-property-line"]);
    expect(read("::signpost{#a}\n").warnings.map((w) => w.code)).toEqual(["unknown-directive"]);
  });

  it("escapes prose that begins with two colons", () => {
    const out = serialize(doc(paragraph("::anchor{#not-a-marker} писал автор")));
    expect(read(out).warnings).toEqual([]);
    expect(directiveNames(read(out).children)).toEqual([]);
  });

  it("is valid, and a duplicate identifier is not", () => {
    expect(validate(doc(h1("T"), makeAnchor("a"), makeAnchor("b"))).ok).toBe(true);
    const twice = validate(doc(h1("T"), makeAnchor("a"), makeAnchor("a")));
    expect(twice.ok).toBe(false);
    expect(twice.diagnostics.map((d) => d.code)).toContain("anchor-duplicate");
  });

  it("refuses an identifier that could not be read back", () => {
    expect(() => makeAnchor("two words")).toThrow(/shorthand cannot carry/u);
    expect(() => makeAnchor("  ")).toThrow(/required/u);
  });

  it("reports a fragment link that reaches no anchor, as a warning", () => {
    const link = {
      type: "paragraph",
      children: [{ type: "link", url: "#12", children: [{ type: "text", value: "к альбому" }] }],
    } as const;
    const missing = validate(doc(h1("T"), link as never));
    expect(missing.diagnostics.filter((d) => d.code === "anchor-target-missing")).toHaveLength(1);
    expect(missing.diagnostics.find((d) => d.code === "anchor-target-missing")?.severity).toBe("warning");
    expect(missing.ok).toBe(true);

    const resolved = validate(doc(h1("T"), makeAnchor("12"), link as never));
    expect(resolved.diagnostics.filter((d) => d.code === "anchor-target-missing")).toEqual([]);
  });

  it("does not count against the complexity budget", () => {
    // 40 markers is `goya2`'s shape and then some; none of them models layout.
    const markers = Array.from({ length: 40 }, (_, i) => makeAnchor(`a${i}`));
    const result = validate(doc(h1("T"), ...markers, paragraph("слово ".repeat(300))));
    expect(result.complexity.directivesTotal).toBe(0);
    expect(result.diagnostics.filter((d) => d.code === "complexity-budget")).toEqual([]);
  });
});
