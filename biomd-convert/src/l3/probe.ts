/**
 * L3 — rendered geometry.
 *
 * Loads a page in Chromium and reports, per block, where its box actually
 * landed and what its style actually computed to. Three surfaces go through it:
 * the source `.htm`, the produced `.bio.md` rendered by `render.ts`, and the
 * reference `.bio.md` rendered by the same function.
 *
 * The determinism contract is copied deliberately from `ladom/measure.ts` —
 * same launch flags, same viewport, same offline routing, same placeholder for
 * a missing asset. Two reasons, and the second is the important one:
 *
 *  1. geometry that differs between machines makes every finding flaky;
 *  2. the source-side numbers this module reports must be *the same numbers the
 *     converter saw*. An L3 finding that says "the evidence for centring was
 *     present and the rule missed it" is only true if both read the same
 *     browser under the same conditions. A probe with its own viewport would
 *     produce findings the converter could not possibly have acted on.
 *
 * No asset tree exists for this corpus (`CLAUDE.md` §4): every image, PDF and
 * MP3 404s. Missing images are answered with a 1×1 transparent PNG exactly as
 * the converter's measurer does, so a box falls back to its declared
 * width/height rather than collapsing — a collapse would move every box below
 * it and corrupt the whole page's geometry.
 *
 * Diagnostic-only.
 */
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, sep } from "node:path";
import type { Box } from "./geometry.js";

export interface ProbeOptions {
  /** 1024 is the era's design target, and what `ladom/measure.ts` uses. */
  width?: number;
  height?: number;
  /** Serve local assets from here; everything else is aborted. */
  assetRoot?: string;
  timeoutMs?: number;
}

/** One measured block. Raw values only — interpretation belongs to `geometry.ts`. */
export interface BlockGeometry {
  /** `data-l3` on a rendered page; the `/tag[n]` element path on a source page. */
  path: string;
  /** `data-line` — the line in the `.bio.md`. Null on a source page. */
  line: number | null;
  /** Block kind, or the lowercase tag name on a source page. */
  kind: string;
  box: Box;
  /** Content box of the nearest positioned ancestor the box is laid out in. */
  container: Box;
  /**
   * The computed `text-align`, **verbatim**. Not normalized here on purpose:
   * whether Chromium returned `-webkit-center` is itself the evidence for one
   * of the alignment-family hypotheses, and folding it away in the probe would
   * destroy the falsifier.
   */
  textAlign: string;
  float: string;
  display: string;
  /** Visible text, whitespace-collapsed. The pairing key across surfaces. */
  text: string;
  textLength: number;
  /**
   * Basename of the image this block carries, when it carries exactly one.
   *
   * The second pairing key, and the only one an uncaptioned figure has: a
   * `::: image` with no `caption` renders no text at all, so a text-only match
   * cannot bind it to the source `<img>` it came from — and image alignment is
   * precisely one of the questions L3 exists to answer.
   */
  imageName: string | null;
  /** Ancestor `data-l3` / element paths, outermost first. */
  ancestors: string[];
  /** Pixels by which the box escapes the article measure. 0 when contained. */
  overflow: number;
}

export interface PageProbe {
  viewport: { width: number; height: number };
  /** The article content box — the frame everything else is judged against. */
  article: Box;
  blocks: BlockGeometry[];
  documentHeight: number;
  warnings: string[];
}

const DEFAULT_VIEWPORT = { width: 1024, height: 768 } as const;

const SYNTHETIC_ORIGIN = "http://biomd-l3.invalid";

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * The collector, shared by both surfaces.
 *
 * One script, two selectors. Sharing the body is what makes a source box and a
 * rendered box commensurable: the same definition of "container", the same text
 * normalization, the same rounding. Two collectors that agreed only informally
 * would produce differences that are artefacts of the instrument.
 *
 * Coordinates are page-absolute and rounded to 0.01 px. Rounding is not
 * cosmetic — sub-ulp jitter between runs would break the determinism contract
 * that lets a finding id stay stable.
 */
const COLLECT = `(mode) => {
  const round = (n) => Math.round(n * 100) / 100;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: round(r.x + scrollX), y: round(r.y + scrollY), w: round(r.width), h: round(r.height) };
  };
  /* Content box: the area a child is actually laid out in. Using the border box
     would report a padded container as offering more room than it does, and an
     alignment verdict read off it would be wrong by the padding. */
  const contentBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const l = num(cs.paddingLeft) + num(cs.borderLeftWidth);
    const rt = num(cs.paddingRight) + num(cs.borderRightWidth);
    const t = num(cs.paddingTop) + num(cs.borderTopWidth);
    const b = num(cs.paddingBottom) + num(cs.borderBottomWidth);
    return { x: round(r.x + scrollX + l), y: round(r.y + scrollY + t),
             w: round(Math.max(0, r.width - l - rt)), h: round(Math.max(0, r.height - t - b)) };
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  /* Basename, lowercased, query and fragment dropped. Compared across surfaces
     where one side wrote 'photo/w/x.jpg' and the other resolved it to
     '/pages/photo/w/x.jpg', so the path prefix cannot be part of the key. */
  const imageNameOf = (el) => {
    const imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
    if (imgs.length !== 1) return null;
    const raw = imgs[0].getAttribute('data-src') || imgs[0].getAttribute('src') || '';
    const clean = raw.split('?')[0].split('#')[0];
    const name = clean.slice(clean.lastIndexOf('/') + 1);
    return name === '' ? null : name.toLowerCase();
  };

  const article = document.getElementById('biomd-article') || document.body;
  const articleBox = contentBox(article);

  const out = [];
  if (mode === 'rendered') {
    for (const el of document.querySelectorAll('[data-l3]')) {
      const cs = getComputedStyle(el);
      const parent = el.parentElement;
      const container = parent ? contentBox(parent) : articleBox;
      const ancestors = [];
      for (let a = el.parentElement; a; a = a.parentElement) {
        const id = a.getAttribute && a.getAttribute('data-l3');
        if (id) ancestors.push(id);
      }
      ancestors.reverse();
      const text = textOf(el);
      const box = rectOf(el);
      out.push({
        path: el.getAttribute('data-l3'),
        line: Number(el.getAttribute('data-line')) || null,
        kind: el.getAttribute('data-kind') || el.tagName.toLowerCase(),
        box, container,
        textAlign: cs.textAlign, float: cs.float, display: cs.display,
        text, textLength: text.length, ancestors,
        imageName: imageNameOf(el),
        overflow: round(Math.max(0,
          Math.max(box.x + box.w - (articleBox.x + articleBox.w), articleBox.x - box.x))),
      });
    }
  } else {
    /* Source pages: every element, with the same /tag[n] path rule the parser
       and ladom/measure.ts use, so a finding names a node the converter can
       look up by id rather than one it has to search for by text. */
    const walk = (el, path, ancestors) => {
      const cs = getComputedStyle(el);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden';
      const box = rectOf(el);
      const parent = el.parentElement;
      const text = textOf(el);
      if (visible && box.w > 0 && box.h > 0) {
        out.push({
          path,
          line: null,
          kind: el.tagName.toLowerCase(),
          box,
          container: parent ? contentBox(parent) : articleBox,
          textAlign: cs.textAlign, float: cs.float, display: cs.display,
          text, textLength: text.length,
          ancestors: ancestors.slice(),
          imageName: imageNameOf(el),
          overflow: 0,
        });
      }
      const counts = new Map();
      const next = ancestors.concat([path]);
      for (const child of el.children) {
        const tag = child.tagName.toLowerCase();
        const n = (counts.get(tag) || 0) + 1;
        counts.set(tag, n);
        walk(child, path + '/' + tag + '[' + n + ']', next);
      }
    };
    if (document.documentElement) walk(document.documentElement, '/html[1]', []);
  }

  return { blocks: out, article: articleBox, documentHeight: document.documentElement.scrollHeight };
}`;

/**
 * A Chromium instance shared across a whole probing session.
 *
 * Launching one browser per page would triple the cost of a corpus run and,
 * worse, would make geometry depend on which pages happened to share a process.
 */
export class L3Probe {
  #browser: import("playwright").Browser | null = null;

  static async create(): Promise<L3Probe | null> {
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      return null;
    }
    const probe = new L3Probe();
    try {
      probe.#browser = await playwright.chromium.launch({
        // Identical to ladom/measure.ts. Font hinting in particular changes text
        // extents, and a different text extent moves every box below it.
        args: [
          "--font-render-hinting=none",
          "--disable-lcd-text",
          "--disable-remote-fonts",
          "--force-color-profile=srgb",
          "--hide-scrollbars",
        ],
      });
    } catch {
      return null;
    }
    return probe;
  }

  /** A page produced by `render.ts`. Blocks are keyed by `data-l3`. */
  async probeRendered(html: string, options: ProbeOptions = {}): Promise<PageProbe> {
    return this.#probe(html, "rendered", options);
  }

  /** A legacy source page. Blocks are keyed by the `/tag[n]` element path. */
  async probeSource(html: string, options: ProbeOptions = {}): Promise<PageProbe> {
    return this.#probe(html, "source", options);
  }

  async #probe(html: string, mode: "rendered" | "source", options: ProbeOptions): Promise<PageProbe> {
    const browser = this.#browser;
    if (!browser) throw new Error("L3Probe is closed or Chromium is unavailable.");

    const width = options.width ?? DEFAULT_VIEWPORT.width;
    const height = options.height ?? DEFAULT_VIEWPORT.height;
    const warnings: string[] = [];

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      reducedMotion: "reduce",
      colorScheme: "light",
    } as never);
    const page = await context.newPage();

    let missing = 0;
    await page.route(`${SYNTHETIC_ORIGIN}/**`, async (route) => {
      const request = route.request();
      if (request.resourceType() !== "image") return route.abort();
      const local = options.assetRoot ? resolveLocalAsset(options.assetRoot, request.url()) : null;
      if (local) {
        try {
          return await route.fulfill({ status: 200, contentType: contentTypeFor(local), body: await readFile(local) });
        } catch {
          /* fall through to the placeholder */
        }
      }
      missing += 1;
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(TRANSPARENT_PNG, "base64") });
    });
    await page.route("**/*", (route) =>
      route.request().url().startsWith(SYNTHETIC_ORIGIN) ? route.fallback() : route.abort(),
    );

    try {
      await page.setContent(withSyntheticBase(html), { waitUntil: "load", timeout: options.timeoutMs ?? 20_000 });
      const collected = (await page.evaluate(`(${COLLECT})(${JSON.stringify(mode)})`)) as {
        blocks: BlockGeometry[];
        article: Box;
        documentHeight: number;
      };
      if (missing > 0) {
        warnings.push(
          `${missing} asset request(s) answered with a placeholder — expected for this corpus, which has no asset tree. ` +
            "Picture boxes come from declared size, not from an intrinsic one.",
        );
      }
      return {
        viewport: { width, height },
        article: collected.article,
        blocks: collected.blocks,
        documentHeight: collected.documentHeight,
        warnings,
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const browser = this.#browser;
    this.#browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Insert a `<base>` so relative asset URLs resolve to the intercepted origin. */
function withSyntheticBase(html: string): string {
  if (/<base\b/iu.test(html)) return html;
  const base = `<base href="${SYNTHETIC_ORIGIN}/">`;
  if (/<head\b[^>]*>/iu.test(html)) return html.replace(/<head\b[^>]*>/iu, (m) => `${m}${base}`);
  if (/<html\b[^>]*>/iu.test(html)) return html.replace(/<html\b[^>]*>/iu, (m) => `${m}<head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

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
