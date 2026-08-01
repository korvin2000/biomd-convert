import { describe, expect, it } from "vitest";
import { serialize } from "./serialize.js";
import {
  makeAlign,
  makeColumn,
  makeColumns,
  makeDocument,
  makeGroupedImage,
  makeImage,
  makeImages,
  makeLead,
  makeNav,
} from "./builders.js";
import { PROFILE_SPEC_V16 } from "./profile.js";
import type { BiomdRoot } from "./types.js";
import { paragraph } from "./text.js";

function doc(...children: BiomdRoot["children"]): BiomdRoot {
  return { type: "root", children };
}

describe("serialize", () => {
  it("emits a heading and paragraph as ordinary Markdown", () => {
    const out = serialize(
      doc(
        { type: "heading", depth: 1, children: [{ type: "text", value: "Андрес Сеговия" }] },
        paragraph("Испанский гитарист."),
      ),
    );
    expect(out).toBe("# Андрес Сеговия\n\nИспанский гитарист.\n");
  });

  it("emits a lead directive with a blank line before the body", () => {
    const out = serialize(doc(makeLead([paragraph("Вступление.")])));
    expect(out).toBe("::: lead\n\nВступление.\n\n:::\n");
  });

  it("emits a standalone image with properties in canonical order and no body", () => {
    const out = serialize(
      doc(
        makeImage({
          src: "photo/segovia.jpg",
          position: "right",
          size: "medium",
          alt: "Портрет",
          caption: "Сеговия, 1955",
        }),
      ),
    );
    expect(out).toBe(
      [
        "::: image",
        "src: photo/segovia.jpg",
        "position: right",
        "size: medium",
        "alt: Портрет",
        "caption: Сеговия, 1955",
        ":::",
        "",
      ].join("\n"),
    );
  });

  it("always separates an align property block from its body", () => {
    // The body's first line looks like a property. Without the blank line the
    // renderer would consume it as one and the text would disappear.
    const out = serialize(doc(makeAlign({ position: "center", children: [paragraph("Дата: 1893 год")] })));
    expect(out).toBe("::: align\nposition: center\n\nДата: 1893 год\n\n:::\n");
    // The dateline must survive as body text, not become a property line.
    const lines = out.split("\n");
    expect(lines.indexOf("Дата: 1893 год")).toBeGreaterThan(lines.indexOf(""));
  });

  it("nests columns and column correctly", () => {
    const out = serialize(
      doc(
        makeColumns({
          children: [makeColumn([paragraph("Левая колонка.")]), makeColumn([paragraph("Правая колонка.")])],
        }),
      ),
    );
    expect(out).toBe(
      [
        "::: columns",
        "",
        "::: column",
        "",
        "Левая колонка.",
        "",
        ":::",
        "",
        "::: column",
        "",
        "Правая колонка.",
        "",
        ":::",
        "",
        ":::",
        "",
      ].join("\n"),
    );
  });

  it("emits divider only when the profile supports it", () => {
    const built = makeColumns({
      children: [makeColumn([paragraph("a")]), makeColumn([paragraph("b")])],
      divider: true,
      profile: PROFILE_SPEC_V16,
    });
    expect(serialize(doc(built), { profile: PROFILE_SPEC_V16 })).toContain("divider: true");
    // Same tree, renderer profile: the property is suppressed rather than
    // emitted into a parser that would turn it into a bogus first column.
    expect(serialize(doc(built))).not.toContain("divider");
  });

  it("emits an images group with grouped children", () => {
    const out = serialize(
      doc(
        makeImages({
          columns: 2,
          children: [
            makeGroupedImage({ src: "a.jpg", alt: "A" }),
            makeGroupedImage({ src: "b.jpg", alt: "B" }),
          ],
        }),
      ),
    );
    expect(out).toBe(
      [
        "::: images",
        "columns: 2",
        "",
        "::: image",
        "src: a.jpg",
        "alt: A",
        ":::",
        "",
        "::: image",
        "src: b.jpg",
        "alt: B",
        ":::",
        "",
        ":::",
        "",
      ].join("\n"),
    );
  });

  it("emits a nav with a bullet list body", () => {
    const list = {
      type: "list" as const,
      ordered: false,
      spread: false,
      children: [
        {
          type: "listItem" as const,
          spread: false,
          children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value: "Биография" }] }],
        },
        {
          type: "listItem" as const,
          spread: false,
          children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value: "Записи" }] }],
        },
      ],
    };
    const out = serialize(doc(makeNav({ list, title: "Разделы", active: "Записи" })));
    expect(out).toBe(
      ["::: nav", "title: Разделы", "active: Записи", "", "- Биография", "- Записи", "", ":::", ""].join("\n"),
    );
  });

  it("emits a document card", () => {
    const out = serialize(doc(makeDocument({ src: "docs/a.pdf", title: "Ноты", mode: "link" })));
    expect(out).toBe("::: document\nsrc: docs/a.pdf\ntitle: Ноты\nmode: link\n:::\n");
  });

  it("emits a GFM table", () => {
    const out = serialize(
      doc({
        type: "table",
        align: [null, null],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "Произведение" }] },
              { type: "tableCell", children: [{ type: "text", value: "Табулатура" }] },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "La Catedral" }] },
              {
                type: "tableCell",
                children: [{ type: "link", url: "music/tab/a.txt", children: [{ type: "text", value: "TAB" }] }],
              },
            ],
          },
        ],
      }),
    );
    // Cells are not padded to the column width. A legacy resource table has one
    // 300-character cell and two dozen short ones, so padding produces lines of
    // several hundred spaces; the rendered table is identical either way.
    expect(out).toBe(
      [
        "| Произведение | Табулатура |",
        "| - | - |",
        "| La Catedral | [TAB](music/tab/a.txt) |",
        "",
      ].join("\n"),
    );
  });

  it("keeps a very wide cell from padding every other row", () => {
    const wide = "и".repeat(300);
    const out = serialize(
      doc({
        type: "table",
        align: [null, null],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "Работа" }] },
              { type: "tableCell", children: [{ type: "text", value: "Ноты" }] },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: wide }] },
              { type: "tableCell", children: [{ type: "text", value: "—" }] },
            ],
          },
        ],
      }),
    );
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("| Работа | Ноты |");
    expect(lines[2]).toBe(`| ${wide} | — |`);
  });

  it("escapes a literal ::: run in prose so it cannot become a fence", () => {
    const out = serialize(doc(paragraph("::: не директива")));
    expect(out.startsWith(":::")).toBe(false);
    expect(out).toContain("не директива");
    // The renderer's FENCE_OPEN is /^:::\s*([A-Za-z][\w-]*)\s*$/ — an escaped
    // leading colon cannot match it.
    expect(/^:::\s*[A-Za-z]/mu.test(out)).toBe(false);
  });

  it("produces exactly one trailing newline and no trailing spaces", () => {
    const out = serialize(doc(paragraph("текст"), makeLead([paragraph("вступление")])));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(/[ \t]+$/mu.test(out)).toBe(false);
  });
});
