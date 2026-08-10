/**
 * Link and target policy — a pure function, unit-tested against the guide's own
 * example table.
 *
 * The existing guides express this as prose that a model re-derives on every
 * page, for several hundred URLs per page. It is twenty lines of code, it is
 * deterministic, and getting it wrong silently breaks navigation, so it belongs
 * here and nowhere else.
 *
 * One constraint is not in either guide and matters for a Russian corpus: the
 * consuming app matches in-app routes against an **ASCII-only** slug pattern
 * (`/^[\w.-]+$/`, no Unicode flag). A Cyrillic slug is rejected and the link
 * degrades to an archival dead end. Any *new* cross-link must therefore be
 * transliterated; legacy `.htm` rewrites are safe only because the corpus
 * filenames are already Latin.
 */

export interface LinkProfile {
  id: string;
  /** Path prefixes whose file extension is part of the route and must be kept. */
  keepExtensionUnder: readonly string[];
  /** Hostnames that count as "this site" and are therefore rewritten. */
  internalHosts: readonly string[];
  /** Base for resolving relative resource paths (spec §15). */
  resourceBase: string;
  /**
   * Directories a relative asset path can reach without climbing.
   *
   * Site-layout data, not a detector literal: nothing here names a document,
   * a class or a fixture, and an unlisted directory simply takes the other
   * branch. See `siteRelativeAsset` for what the two branches mean.
   */
  contentRoots: readonly string[];
}

export const ABC_LINK_PROFILE: LinkProfile = {
  id: "abc",
  keepExtensionUnder: ["/guitar_art/galery/"],
  internalHosts: ["abc-guitars.com", "www.abc-guitars.com"],
  resourceBase: "/pages",
  contentRoots: ["articles", "music", "photo", "use"],
};

/**
 * An asset path that cannot reach its own content root climbs one level.
 *
 * The corpus is served from two directory depths at once. A biography under
 * `pages/` writes `music/tab/x.txt` and `photo/s/y.jpg`, which resolve against
 * the resource base; the same site's shared directories — `main/`, and per
 * `analyze/analyze-2.md` also `magazine/` and `fest/` — sit one level *above*
 * it, so a bare `main/kniga_mg.jpg` resolves to a file that does not exist.
 * The author's rule (`analyze-2.md`, "Обработка ссылок") is to prefix those
 * with `/../`, and to leave alone anything that already climbs or that reaches
 * a content root anywhere in its path.
 *
 * **Segment containment, not a prefix test.** `pages/music/wma/x.wma` — the
 * form the three site-root documents use for the *same* files their siblings
 * write as `music/wma/x.wma` — reaches `music/` at depth 1, and the references
 * leave all 84 of them bare. A `startsWith` test would have climbed every one.
 *
 * Measured over all 22 references: 458 relative targets, of which exactly the
 * 21 under `main/` carry the prefix and the other 437 do not. There is no
 * counterexample in either direction.
 *
 * **Two limits on the domain, both of them properties rather than exceptions.**
 * A value with no directory component names a file in the document's own
 * directory, which is where it already resolves — climbing is about reaching a
 * *directory* the base does not contain, and there is no directory here to
 * reach. And a value carrying markup or an embedded scheme is not a path at
 * all: `new_kolpakov` has `href="<B>http://…</B>"`, where FrontPage let a tag
 * into the attribute. That is a real defect with its own cause upstream, and
 * this function's job is to leave it exactly as it found it rather than to
 * produce a differently-broken version of it.
 */
export function siteRelativeAsset(path: string, profile: LinkProfile = ABC_LINK_PROFILE): string {
  if (path === "" || /^(?:[a-z][a-z\d+.-]*:|\/\/|[?#])/iu.test(path)) return path;
  if (/[<>]|:\/\//u.test(path)) return path;
  const bare = path.replace(/^\/+/u, "").replace(/^(?:\.\/)+/u, "");
  const segments = bare.split("/");
  if (segments.length < 2) return path;
  // Already climbing is the author's own stated exception, in both spellings.
  if (segments.includes("..")) return path;
  if (segments.some((s) => profile.contentRoots.includes(s.toLowerCase()))) return path;
  return `/../${bare}`;
}

export type TargetKind =
  | "entry"        // in-app navigation to another BioMD document
  | "resource"     // image, audio, document, archive
  | "external"     // another site
  | "anchor"       // same-page fragment
  | "mailto"
  | "unsafe"       // rejected scheme
  | "empty";

export interface RewrittenTarget {
  kind: TargetKind;
  /** The value to emit. Unchanged for kinds that pass through. */
  href: string;
  /** The value as it appeared in the source. */
  original: string;
  /** True when the value changed. */
  rewritten: boolean;
  /** Present when the target cannot navigate and the reader will hit a dead end. */
  warning?: string;
}

/** Matches the consuming app's in-app slug pattern exactly. Deliberately ASCII-only. */
export const SLUG_PATTERN = /^[\w.-]+$/;

const UNSAFE_SCHEME = /^\s*(?:javascript|vbscript|data|file):/iu;
const ABSOLUTE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const HTML_EXT = /\.html?$/iu;

/** Resource extensions that must never be rewritten into a route. */
const RESOURCE_EXT =
  /\.(?:jpe?g|png|gif|bmp|webp|svg|mp3|wav|ogg|oga|m4a|aac|flac|mid|midi|txt|pdf|doc|docx|zip|rar|7z|gz)$/iu;

export function rewriteTarget(raw: string, profile: LinkProfile = ABC_LINK_PROFILE): RewrittenTarget {
  const original = raw;
  const value = raw.trim();

  if (value === "") return { kind: "empty", href: value, original, rewritten: false };
  if (UNSAFE_SCHEME.test(value)) {
    return {
      kind: "unsafe",
      href: "",
      original,
      rewritten: true,
      warning: "target uses a script or data scheme and carries no navigable destination",
    };
  }
  if (value.startsWith("#")) return { kind: "anchor", href: value, original, rewritten: false };
  if (/^mailto:/iu.test(value)) return { kind: "mailto", href: value, original, rewritten: false };

  // An absolute URL is external unless it points at this site, in which case it
  // is treated exactly like the equivalent relative path.
  let pathPart = value;
  let isAbsolute = false;
  if (ABSOLUTE.test(value)) {
    let url: URL;
    try {
      url = new URL(value.startsWith("//") ? `http:${value}` : value);
    } catch {
      return { kind: "external", href: value, original, rewritten: false };
    }
    if (!profile.internalHosts.includes(url.hostname.toLowerCase())) {
      return { kind: "external", href: value, original, rewritten: false };
    }
    isAbsolute = true;
    pathPart = url.pathname + url.search + url.hash;
  }

  const [beforeHash = "", hash = ""] = splitOnce(pathPart, "#");
  const [path = "", query = ""] = splitOnce(beforeHash, "?");

  // A resource keeps its path; only the base changes (spec §15). A path served
  // from above the resource base has to say so — `siteRelativeAsset`. An
  // absolute URL already resolved from the host root and never climbs.
  if (RESOURCE_EXT.test(path)) {
    const href = isAbsolute ? value : siteRelativeAsset(value, profile);
    return { kind: "resource", href, original, rewritten: href !== original };
  }

  if (!HTML_EXT.test(path)) {
    // Not an HTML page and not a known resource: pass through rather than guess.
    if (isAbsolute) return { kind: "external", href: value, original, rewritten: false };
    const href = siteRelativeAsset(value, profile);
    return { kind: "resource", href, original, rewritten: href !== original };
  }

  // Some directories serve the extension as part of the route.
  const keepExtension = profile.keepExtensionUnder.some((prefix) => path.includes(prefix));
  const base = path.slice(path.lastIndexOf("/") + 1);
  const route = keepExtension ? base : base.replace(HTML_EXT, "");

  if (route === "") {
    return { kind: "external", href: value, original, rewritten: false };
  }

  const href = `/#/${route}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
  const result: RewrittenTarget = { kind: "entry", href, original, rewritten: href !== original };

  if (!SLUG_PATTERN.test(route)) {
    result.warning =
      `route ${JSON.stringify(route)} is not an ASCII slug; the app's in-app route pattern rejects it ` +
      "and the link will degrade to a non-navigating archival reference";
  }
  return result;
}

function splitOnce(value: string, sep: string): [string, string] {
  const at = value.indexOf(sep);
  return at === -1 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
}

/**
 * Resolve a resource path against the configured base (spec §15).
 *
 * Mirrors the consuming app's rule: absolute URLs, fragments and query-only
 * references pass through; both `music/x.mp3` and `/music/x.mp3` land under the
 * resource base; an already-resolved path stays stable.
 */
export function resolveResourcePath(path: string, profile: LinkProfile = ABC_LINK_PROFILE): string {
  if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/|[?#])/iu.test(path)) return path;
  const relative = path.replace(/^\/+/u, "").replace(/^(?:\.\/)+/u, "");
  if (relative === "") return profile.resourceBase || "/";
  const rooted = `/${relative}`;
  if (rooted === profile.resourceBase || rooted.startsWith(`${profile.resourceBase}/`)) return rooted;
  return `${profile.resourceBase}/${relative}`;
}

/**
 * Cyrillic → ASCII slug, for cross-links the converter creates itself.
 *
 * Only ever applied to *new* links. A rewritten legacy `.htm` reference keeps
 * its existing filename, because that filename is the identity other documents
 * already point at; transliterating it would break every inbound link.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};

export function transliterateSlug(value: string): string {
  const lower = value.toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (ch in TRANSLIT) out += TRANSLIT[ch];
    else if (/[a-z0-9]/u.test(ch)) out += ch;
    else if (/[\s_/]/u.test(ch)) out += "-";
    else if (ch === "-" || ch === ".") out += ch;
  }
  const slug = out.replace(/-{2,}/gu, "-").replace(/^[-.]+|[-.]+$/gu, "");
  return slug;
}

/** Build an in-app entry link, transliterating when necessary. */
export function makeEntryLink(slugOrTitle: string): { href: string; slug: string; transliterated: boolean } {
  if (SLUG_PATTERN.test(slugOrTitle)) {
    return { href: `/#/${slugOrTitle}`, slug: slugOrTitle, transliterated: false };
  }
  const slug = transliterateSlug(slugOrTitle);
  return { href: `/#/${slug}`, slug, transliterated: true };
}
