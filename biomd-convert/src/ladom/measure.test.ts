import { afterAll, describe, expect, it } from "vitest";
import { parseHtml } from "./parse.js";
import { ChromiumMeasurer, NullMeasurer, createMeasurer, type Measurer } from "./measure.js";
import { walkElements } from "./types.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const LAYOUT_PAGE = `<html><head><style>
  body { margin: 0; font-family: sans-serif; }
  .rail { width: 116px; vertical-align: top; }
  .main { width: 529px; vertical-align: top; }
</style></head><body>
<table width="760" border="0" cellspacing="0"><tr>
  <td class="rail">rail</td>
  <td class="main"><p>Основной текст страницы.</p></td>
  <td class="rail">rail2</td>
</tr></table>
</body></html>`;

let measurer: Measurer | null = null;

afterAll(async () => {
  await measurer?.close();
});

describe("NullMeasurer", () => {
  it("reports that it did not measure and leaves boxes undefined", async () => {
    const doc = parseHtml(LAYOUT_PAGE);
    const result = await new NullMeasurer().measure(LAYOUT_PAGE, doc);
    expect(result.measured).toBe(false);
    expect(doc.measured).toBe(false);
    // No invented numbers: a later pass can tell "unmeasured" from "measured zero".
    for (const el of walkElements(doc.root)) expect(el.box).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/geometry unavailable/u);
  });

  it("still estimates visibility from attributes", async () => {
    const doc = parseHtml('<body><img src="a.gif" width="1" height="1"><p>x</p></body>');
    await new NullMeasurer().measure("", doc);
    const img = [...walkElements(doc.root)].find((e) => e.tag === "img");
    expect(img?.visible).toBe(false);
  });
});

describe("ChromiumMeasurer", () => {
  it("resolves real geometry and computed style, matched by node path", async () => {
    measurer = await createMeasurer("always");
    if (!measurer.available) {
      // The pipeline is required to work without a browser; skipping here is
      // the correct behaviour, not a hidden failure.
      expect(measurer).toBeInstanceOf(NullMeasurer);
      return;
    }
    expect(measurer).toBeInstanceOf(ChromiumMeasurer);

    const doc = parseHtml(LAYOUT_PAGE);
    const result = await measurer.measure(LAYOUT_PAGE, doc, { width: 1024, height: 768 });

    expect(result.measured).toBe(true);
    expect(doc.measured).toBe(true);

    const cells = [...walkElements(doc.root)].filter((e) => e.tag === "td");
    expect(cells).toHaveLength(3);

    // This is the point of the whole stage: the *rendered* widths, resolved from
    // a stylesheet class, not from any attribute present on the element.
    const widths = cells.map((c) => Math.round(c.box?.w ?? 0));
    expect(widths[0]).toBeGreaterThan(100);
    expect(widths[1]).toBeGreaterThan(widths[0] as number);
    expect(widths[2]).toBeGreaterThan(100);

    // None of these cells declares a width attribute; the geometry came from CSS.
    for (const cell of cells) expect(cell.attrs["width"]).toBeUndefined();

    const main = cells[1];
    expect(main?.style?.verticalAlign).toBe("top");
    expect(main?.visible).toBe(true);

    // Boxes are laid out side by side, which is what lane detection reads.
    const xs = cells.map((c) => c.box?.x ?? 0);
    expect(xs[0]).toBeLessThan(xs[1] as number);
    expect(xs[1]).toBeLessThan(xs[2] as number);
  });

  it("resolves relative asset URLs and substitutes missing ones", async () => {
    if (!measurer?.available) return;
    // Relative srcs are the norm in this corpus. Without a base to resolve
    // against they would never load and every image would measure at its
    // alt-text size, which is exactly the geometry lane detection reads.
    const html = '<body><img src="photos/missing.jpg" width="200" height="150"><p>x</p></body>';
    const doc = parseHtml(html);
    const result = await measurer.measure(html, doc, { assetRoot: process.cwd() });

    expect(result.measured).toBe(true);
    const img = [...walkElements(doc.root)].find((e) => e.tag === "img");
    // The declared attributes still determine the box, so lane maths stays sane.
    expect(Math.round(img?.box?.w ?? 0)).toBe(200);
    expect(Math.round(img?.box?.h ?? 0)).toBe(150);
    expect(result.warnings.join(" ")).toMatch(/placeholder/u);
  });

  it("serves a real local asset so intrinsic size is exact", async () => {
    if (!measurer?.available) return;
    // A 1x1 PNG on disk, referenced with no width/height attributes at all:
    // the box can only come from the real file.
    const dir = await mkdtemp(join(tmpdir(), "biomd-assets-"));
    await mkdir(join(dir, "photos"), { recursive: true });
    await writeFile(join(dir, "photos", "dot.png"), Buffer.from(ONE_PX_PNG, "base64"));

    const html = '<body><img src="photos/dot.png"><p>x</p></body>';
    const doc = parseHtml(html);
    const result = await measurer.measure(html, doc, { assetRoot: dir });

    const img = [...walkElements(doc.root)].find((e) => e.tag === "img");
    expect(Math.round(img?.box?.w ?? 0)).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/served from the local corpus/u);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses to read outside the corpus root", async () => {
    if (!measurer?.available) return;
    const dir = await mkdtemp(join(tmpdir(), "biomd-assets-"));
    const html = '<body><img src="../../../etc/passwd" width="10" height="10"></body>';
    const doc = parseHtml(html);
    const result = await measurer.measure(html, doc, { assetRoot: dir });
    // Traversal resolves outside the root, so it is treated as missing.
    expect(result.warnings.join(" ")).toMatch(/placeholder/u);
    expect(result.warnings.join(" ")).not.toMatch(/served from the local corpus/u);
    await rm(dir, { recursive: true, force: true });
  });

  it("produces a screenshot on request", async () => {
    if (!measurer?.available) return;
    const doc = parseHtml(LAYOUT_PAGE);
    const result = await measurer.measure(LAYOUT_PAGE, doc, { screenshot: true });
    expect(result.screenshot).toBeInstanceOf(Uint8Array);
    // PNG magic number.
    expect(Array.from(result.screenshot!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
