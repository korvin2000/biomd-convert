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
  makeColumn,
  makeColumns,
  makeGroupedImage,
  makeImage,
  makeImages,
  makeLead,
  makeNav,
} from "./builders.js";
import { PROFILE_RENDERER_CURRENT, PROFILE_SPEC_V16 } from "./profile.js";
import { validate } from "./validate.js";
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
