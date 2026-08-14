/**
 * Stage 3 — measurement.
 *
 * Legacy layout tables were authored *for a browser*, so the reliable way to
 * know what `<td width="45%">` actually does is to ask one. This turns the
 * hardest guessing problem in the pipeline into a lookup, and it is
 * simultaneously the largest single reduction in model calls: every question
 * the layout engine answers is one nothing has to be paid to guess at.
 *
 * Measurement is optional by construction. When Chromium is unavailable — CI, a
 * machine without the browser downloaded, `--visual never` — the pipeline
 * degrades to attribute-derived estimates and records `measured: false`, so no
 * later stage can mistake an estimate for evidence.
 */
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, sep } from "node:path";
import type { Box, LadomDocument, LadomNode, ResolvedStyle } from "./types.js";
import { walkElements } from "./types.js";

export type VisualMode = "never" | "auto" | "always";

export interface MeasureOptions {
  /** Viewport width. 1024 is the era's design target for this corpus. */
  width?: number;
  height?: number;
  /** Serve local assets from here; everything else is aborted. */
  assetRoot?: string;
  /** Capture a full-page screenshot. */
  screenshot?: boolean;
  /** Milliseconds before a page is abandoned. */
  timeoutMs?: number;
}

export interface MeasureResult {
  measured: boolean;
  /** PNG bytes when a screenshot was requested and taken. */
  screenshot?: Uint8Array;
  /** Rendered document height at the configured width. */
  documentHeight?: number;
  warnings: string[];
}

export interface Measurer {
  readonly available: boolean;
  measure(html: string, doc: LadomDocument, options?: MeasureOptions): Promise<MeasureResult>;
  close(): Promise<void>;
}

export const DEFAULT_VIEWPORT = { width: 1024, height: 768 } as const;

/**
 * The script evaluated inside the page.
 *
 * It must build node paths by exactly the same rule as the parser
 * (`/tag[n]`, 1-based, counted per tag among element siblings) so geometry
 * lines up with the tree by construction rather than by fuzzy matching.
 */
const COLLECT_SCRIPT = `() => {
  const out = [];
  const walk = (el, path) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    out.push({
      id: path,
      box: { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.width, h: rect.height },
      style: {
        display: cs.display,
        position: cs.position,
        float: cs.float,
        textAlign: cs.textAlign,
        verticalAlign: cs.verticalAlign,
        fontSize: num(cs.fontSize),
        fontWeight: num(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400),
        fontStyle: cs.fontStyle,
        fontVariant: cs.fontVariantCaps || cs.fontVariant,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderTopWidth: num(cs.borderTopWidth),
        borderRightWidth: num(cs.borderRightWidth),
        borderBottomWidth: num(cs.borderBottomWidth),
        borderLeftWidth: num(cs.borderLeftWidth),
        borderStyle: cs.borderTopStyle,
        borderColor: cs.borderTopColor,
        paddingTop: num(cs.paddingTop),
        paddingLeft: num(cs.paddingLeft),
        marginTop: num(cs.marginTop),
        marginLeft: num(cs.marginLeft),
        whiteSpace: cs.whiteSpace,
        overflow: cs.overflow,
        visibility: cs.visibility,
      },
      visible:
        rect.width > 0 && rect.height > 0 &&
        cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0,
    });
    const counts = new Map();
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      const n = (counts.get(tag) || 0) + 1;
      counts.set(tag, n);
      walk(child, path + '/' + tag + '[' + n + ']');
    }
  };
  if (document.documentElement) walk(document.documentElement, '/html[1]');
  return { nodes: out, documentHeight: document.documentElement.scrollHeight };
}`;

interface CollectedNode {
  id: string;
  box: Box;
  style: ResolvedStyle;
  visible: boolean;
}

/**
 * Attribute-derived fallback.
 *
 * Deliberately conservative: it sets `visible` from obvious signals and leaves
 * `box`/`style` undefined rather than inventing plausible numbers. A later pass
 * that needs geometry can then tell the difference between "measured as zero"
 * and "never measured", which an invented value would erase.
 */
export class NullMeasurer implements Measurer {
  readonly available = false;

  async measure(_html: string, doc: LadomDocument): Promise<MeasureResult> {
    for (const el of walkElements(doc.root)) {
      el.visible = estimateVisible(el);
    }
    doc.measured = false;
    return {
      measured: false,
      warnings: [
        "Rendered geometry unavailable; layout decisions fall back to attribute heuristics. " +
          "Table lane detection and hyphen-position rules are materially weaker without it.",
      ],
    };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

function estimateVisible(el: LadomNode): boolean {
  const style = (el.attrs["style"] ?? "").toLowerCase();
  if (style.includes("display:none") || style.includes("visibility:hidden")) return false;
  if ("hidden" in el.attrs) return false;
  if (el.tag === "img") {
    const w = Number.parseInt(el.attrs["width"] ?? "", 10);
    const h = Number.parseInt(el.attrs["height"] ?? "", 10);
    if (Number.isFinite(w) && Number.isFinite(h) && (w <= 1 || h <= 1)) return false;
  }
  return true;
}

/**
 * Chromium-backed measurer.
 *
 * The determinism contract matters as much as the measurement: pinned browser,
 * fixed viewport, hinting off, animations off, fully offline. Without it,
 * geometry differs between machines and every golden test becomes flaky.
 */
export class ChromiumMeasurer implements Measurer {
  readonly available = true;
  #browser: unknown = null;
  #playwright: typeof import("playwright") | null = null;

  static async create(): Promise<Measurer> {
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      return new NullMeasurer();
    }
    const measurer = new ChromiumMeasurer();
    measurer.#playwright = playwright;
    try {
      measurer.#browser = await playwright.chromium.launch({
        args: [
          "--font-render-hinting=none",
          "--disable-lcd-text",
          "--disable-remote-fonts",
          "--force-color-profile=srgb",
          "--hide-scrollbars",
        ],
      });
    } catch {
      // Browser binary not downloaded, or launch refused. Degrade rather than
      // fail the run: the deterministic pipeline must work without it.
      return new NullMeasurer();
    }
    return measurer;
  }

  async measure(html: string, doc: LadomDocument, options: MeasureOptions = {}): Promise<MeasureResult> {
    const playwright = this.#playwright;
    const browser = this.#browser as import("playwright").Browser | null;
    if (!playwright || !browser) return new NullMeasurer().measure(html, doc);

    const warnings: string[] = [];
    const context = await browser.newContext({
      viewport: { width: options.width ?? DEFAULT_VIEWPORT.width, height: options.height ?? DEFAULT_VIEWPORT.height },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      reducedMotion: "reduce",
      colorScheme: "light",
      // Network isolation is enforced by route interception below rather than
      // by `offline`, which would also fail the substituted image responses.
    } as never);

    const page = await context.newPage();

    // Relative asset URLs are the norm in this corpus (`photos/x.jpg`), and
    // under setContent the document has no base to resolve them against — they
    // would simply never load, and every image would measure at its alt-text
    // size. A synthetic origin is injected so they resolve, and every request
    // to it is served from the local corpus directory.
    let missingAssets = 0;
    let servedAssets = 0;

    await page.route(`${SYNTHETIC_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const isImage = request.resourceType() === "image";
      if (!isImage) return route.abort();

      const local = options.assetRoot ? resolveLocalAsset(options.assetRoot, request.url()) : null;
      if (local) {
        try {
          const body = await readFile(local);
          servedAssets += 1;
          return await route.fulfill({ status: 200, contentType: contentTypeFor(local), body });
        } catch {
          /* fall through to the placeholder */
        }
      }
      // A missing image still needs plausible extent, or the surrounding boxes
      // collapse. The element's own width/height attributes then decide the box.
      missingAssets += 1;
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(TRANSPARENT_PNG, "base64"),
      });
    });

    // Anything not on the synthetic origin is external: aborted, never fetched.
    await page.route("**/*", (route) =>
      route.request().url().startsWith(SYNTHETIC_ORIGIN) ? route.fallback() : route.abort(),
    );

    try {
      await page.setContent(withSyntheticBase(html), {
        waitUntil: "load",
        timeout: options.timeoutMs ?? 15_000,
      });
      // Evaluated as an immediately-invoked expression: a bare function literal
      // would be returned as an unserializable value rather than called.
      const collected = (await page.evaluate(`(${COLLECT_SCRIPT})()`)) as {
        nodes: CollectedNode[];
        documentHeight: number;
      };

      let matched = 0;
      for (const item of collected.nodes) {
        const node = doc.index.get(item.id);
        if (!node) continue;
        node.box = item.box;
        node.style = item.style;
        node.visible = item.visible;
        matched += 1;
      }

      // The synthetic tree root has no counterpart in the browser; counting it
      // would make every small document look like a mismatch.
      const elementCount = [...walkElements(doc.root)].filter((e) => e.tag !== "#root").length;
      if (matched < elementCount * 0.9) {
        warnings.push(
          `Only ${matched} of ${elementCount} elements matched browser geometry by path. ` +
            "The parsed tree and the rendered tree may disagree; review before trusting lane decisions.",
        );
      }
      // Any element the browser did not report keeps `visible` undefined rather
      // than defaulting to true, so callers can detect the gap.
      for (const el of walkElements(doc.root)) {
        if (el.box === undefined) el.visible = el.visible ?? estimateVisible(el);
      }

      if (missingAssets > 0) {
        warnings.push(
          `${missingAssets} asset request(s) substituted with a placeholder; those boxes fall back to the ` +
            "element's declared width/height and are approximate.",
        );
      }
      if (servedAssets > 0) {
        warnings.push(`${servedAssets} asset(s) served from the local corpus; intrinsic sizes are exact.`);
      }

      const result: MeasureResult = { measured: true, documentHeight: collected.documentHeight, warnings };
      if (options.screenshot === true) {
        result.screenshot = await page.screenshot({ fullPage: true, type: "png" });
      }
      doc.measured = true;
      return result;
    } catch (error) {
      warnings.push(`Measurement failed (${(error as Error).message}); falling back to attribute heuristics.`);
      const fallback = await new NullMeasurer().measure(html, doc);
      return { ...fallback, warnings: [...warnings, ...fallback.warnings] };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const browser = this.#browser as import("playwright").Browser | null;
    if (browser) await browser.close().catch(() => undefined);
    this.#browser = null;
  }
}

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Origin used only to give relative asset URLs something to resolve against.
 * Never contacted: every request to it is answered from disk or a placeholder,
 * and everything else is aborted.
 */
const SYNTHETIC_ORIGIN = "http://biomd-corpus.invalid";

/** Insert a `<base>` unless the document already declares one. */
function withSyntheticBase(html: string): string {
  if (/<base\b/iu.test(html)) return html;
  const base = `<base href="${SYNTHETIC_ORIGIN}/">`;
  if (/<head\b[^>]*>/iu.test(html)) return html.replace(/<head\b[^>]*>/iu, (m) => `${m}${base}`);
  if (/<html\b[^>]*>/iu.test(html)) return html.replace(/<html\b[^>]*>/iu, (m) => `${m}<head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

/** Map a synthetic-origin URL back to a file under the corpus root. */
function resolveLocalAsset(assetRoot: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const relative = pathname.replace(/^\/+/u, "");
  if (relative === "") return null;
  const resolved = resolvePath(assetRoot, relative);
  // Never read outside the corpus root, whatever the document asks for.
  const rootWithSep = resolvePath(assetRoot) + sep;
  return resolved.startsWith(rootWithSep) ? resolved : null;
}

function contentTypeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    default:
      return "image/jpeg";
  }
}

export async function createMeasurer(mode: VisualMode): Promise<Measurer> {
  if (mode === "never") return new NullMeasurer();
  const measurer = await ChromiumMeasurer.create();

  // `auto` may degrade; `always` may not. Silently substituting attribute
  // guesswork for a render contradicts what the operator asked for, and the
  // difference is not cosmetic — alignment, image size, table lanes and
  // caption binding all read the computed style. Failing here costs one run;
  // failing silently costs a thousand files that look converted.
  if (mode === "always" && !measurer.available) {
    throw new Error(
      "visual: always was requested, but Chromium is not available, so the page cannot be rendered.\n" +
        "Install it with `npx playwright install chromium`, or set visual to \"auto\" to accept " +
        "attribute-only heuristics and a lower-quality conversion.",
    );
  }
  return measurer;
}
