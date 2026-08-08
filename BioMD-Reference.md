# BioMD Lite — LLM/Converter Reference

**Target:** authoring + HTML→`.bio.md` conversion. **Stack:** CommonMark → `react-markdown` + `remark-gfm` + BioMD parser/directives. **Base:** BioMD Lite 1.5.

## 0. Contract

`MUST` = parser/renderer/value/nesting/path constraint. `SHOULD` = fidelity heuristic; override when another supported mapping preserves the source better. `MAY` = supported option.

Preserve, in order: **visible text + real targets → reading/source order → hierarchy/grouping → coarse layout → visible distinctions**. Do not fabricate factual text, captions, headings, `href`/`src`, or targets.

Exact 1-to-1 HTML styling is not required. When unsupported, map a visible distinction to the nearest supported construct (`**`, `*`, `==`, `~~`, heading, quote, `frame`, `align`, `columns`, etc.) if readability/fidelity improves. Drop only unrepresentable style details: exact pixels, fonts, arbitrary colors/backgrounds, margins/padding, coordinates, breakpoints, scripted behavior. Responsive stacking MUST retain coherent source order.

## 1. Markdown surface

Canonical output SHOULD use compact, unambiguous syntax.

| Intent | Syntax | Notes |
|---|---|---|
| headings | `#`…`######` | preserve real hierarchy; one `#` is preferred for a normal single-title page, not a Markdown limitation |
| paragraph | blank line | prose block |
| strong / emphasis / highlight | `**x**` / `*x*` / `==x==` | `==` is BioMD-only; MAY preserve visual emphasis, not only strict semantics |
| strikethrough | `~~x~~` | `remark-gfm`; canonical double tilde |
| quote/inset | `> x` | quote **or** visible note/comment/subordinate block when useful |
| lists | `- x`, `1. x` | nested lists allowed; preserve meaningful numbering |
| task list | `- [ ] x`, `- [x] x` | `remark-gfm`; preserve checklist state |
| link / autolink | `[label](url)` / bare URL | labeled preferred; GFM autolinks supported |
| image | `![alt](src)` | simple image; use `::: image` for caption/layout/frame/link |
| footnote | `x[^id]` + `[^id]: note` | `remark-gfm` |
| table | GFM pipe table | alignment: `:---`, `---:`, `:---:` |
| separator | `---` or `***` | thematic/visual separation; the two spellings are **the same construct** |
| hard break | trailing `\` | inside one logical block only |
| code | `` `x` `` / fenced ``` or `~~~` | preserve real `<code>/<pre>` content |
| escape | `\*`, `\#`, … | literal syntax punctuation |

`remark-gfm` may accept `~x~` when `singleTilde:true` (default); generate `~~x~~` for portability. Soft line breaks remain prose; use `\` only for significant source line breaks. A trailing `\` at block end is literal.

`---`, `***` and `___` are interchangeable spellings of one thematic break and MUST be treated as equivalent — by parsers, validators, comparison tools and any conversion diff. `---` is canonical for generated output; a document that writes `***` is not different from one that writes `---`, and the difference MUST NOT be reported.

Raw HTML/CSS/JS/JSX/MDX **MUST NOT** be emitted by BioMD contract. Convert/adopt visible HTML output to supported syntax/directives.

### Tables

Every GFM table column MUST have a header; no `rowspan`, `colspan`, widths, CSS, or spacer-cell positioning. Renderer handles overflow/responsiveness.

PREFER tables when source rows/columns remain intelligible. Layout tables MAY become `columns`/`images`/`frame`/blocks; a simple visually tabular layout MAY remain a Markdown table if that best preserves it.

## 2. Directive grammar

```md
::: name
property: value

Optional Markdown body.
:::
```

Names/properties MUST be lowercase ASCII; one property/line; value = rest of line; not YAML; blank line separates properties/body; no indentation; fences MUST balance. Unknown directive/property/value SHOULD warn and retain readable content.

| Directive | Required | Optional | Body |
|---|---|---|---|
| `lead` | — | — | Markdown + `align` |
| `align` | `position` | — | Markdown + leaf media |
| standalone `image` | `src`,`position`,`size` | `alt`,`caption`,`link`,`frame` | none |
| child `image` | `src` | `alt`,`caption`,`link`,`frame` | none |
| `images` | `columns` | `frame` | ≥2 `image` only |
| `document` | `src`,`title`,`mode` | — | none |
| `columns` | ≥2 `column` | `columns`,`divider` | `column` only |
| `column` | — | — | Markdown + leaf media |
| `nav` | nav list | `title`,`active` | bullet list |
| `frame` | — | `frame`,`title` | Markdown + leaf media + `align` |
| `signature` | — | — | short Markdown |

Leaf media = `image`,`images`,`document`.

Allowed nesting: `images→image`; `columns→column`; `column→Markdown+leaf+align+nav`; `frame→Markdown+leaf+align`; `lead→Markdown+align`; `align→Markdown+leaf+frame`.

Forbidden: `columns` in `column`; nested `frame`; `nav` in `frame`; `columns|nav` in `align`; arbitrary deeper nesting. Invalid nesting MUST degrade in place to readable content, never deletion.

**`align` and `frame` together.** `frame` inside `align` is permitted and is not an error, but it accomplishes nothing: a frame occupies the full width of its container, so the alignment has nothing to act on. `align` inside `frame` is the intended shape and is what a bordered notice with centred text should be written as. A converter SHOULD emit `frame→align`; a validator MAY advise on `align→frame` but MUST NOT reject it, and MUST NOT rewrite it.

## 3. Directive behavior

### `lead`
Prominent intro block. MAY represent a semantic lead **or** a distinctly styled introductory source region.

### `image`
```md
::: image
src: img/a.jpg
position: right
size: medium
alt: Person with guitar
caption: Person, 1968
link: img/a-large.jpg
frame: mat
:::
```

- `position: left|right|center|full`; `size: small|medium|large|full`.
- `frame: curl|none|mat|black|white|red|gold`; absent = `curl`.
- `left|right` may wrap; `center` standalone centered; `full` article width; size is theme-relative; aspect ratio preserved.
- Preserve source `alt`/caption; if absent, do not hallucinate. `alt` is non-visual, caption visible.
- `link` preserves click target. Accepted BioMD image-link forms: relative, fragment, `http(s)`, `mailto:`; unsupported/unsafe schemes are dropped with warning. Absent `link` uses `src` per renderer.
- Arbitrary CSS/hex/rgb values are invalid; MAY choose closest supported token.
- Plain `![alt](src)` is preferred when directive-only features are unnecessary.

### `images`
`columns: 2|3|4` REQUIRED; ≥2 child images; child `position/size` omitted/ignored; group `frame` inherited unless child overrides; preserve order. MAY represent galleries, pairs, contact sheets, or other image groups.

### `document`
`src`, `title`, `mode: link|embed` REQUIRED. Use for document/media card/embed; embed MUST retain accessible link fallback. Ordinary resources MAY remain links.

### `columns` / `column`
`columns: 2|3|4` optional; `divider: true|false` default `false`; children flow row-major; never pad incomplete last row; narrow screens stack in source order. Legacy/pre-1.5 form may omit `columns` for 2–3 children.

Use for source side-by-side/grid relationships that remain readable stacked: text+image, cards, grouped facts/lists/catalogs. PREFER a table for true header/record data.

### `nav`
Body = one bullet item/navigation entry. `active`, if present, MUST match exactly one rendered label; labels then unique. Targets: catalogue entries, fragments, absolute URLs. Use for source navigation/pagination/series controls.

### `frame`
`frame: gold|black|red|white`, default `gold`; optional `title`. MAY preserve notices, callouts, bordered/accent/background-like regions, cards, memorial/accent boxes, or other visually grouped source regions. Enclose the complete represented region. Choose nearest valid theme token; never invent unsupported color syntax.

Image `frame:` and `::: frame` share theme concepts but differ in scope.

### `align`
`position: left|center|right` REQUIRED. Alignment only; never changes source order. Allowed inside `lead|column|frame`; MUST NOT wrap `columns|nav`. MAY preserve semantic **or purely visual** bounded alignment; do not use as margins/indentation/spacing/fake columns.

It MAY contain a `frame`, but see §2 — a frame is full-width, so `frame` wrapping `align` is the shape that expresses "a bordered notice, centred inside it".

### `signature`
Compact signature/credit/author/place block. Best for closing or source-credit groups; keep short.

## 4. Paths and links

General targets: fragment `#x`, `mailto:`, absolute `http(s)://`, relative article/media/document paths.

Relative BioMD resources resolve against configured base, default `/pages`:

```text
media/a.mp3    -> /pages/media/a.mp3
/media/a.mp3   -> /pages/media/a.mp3
^/main/a.jpg   -> /main/a.jpg
/../main/a.jpg -> /main/a.jpg   # legacy
```

Use absolute URL for another host.

Catalogue: `name.bio.md` ≡ `#/name`; slug = filename minus `.bio.md`/`.md`; target MUST exist in `pages/index.json`; indexed hidden/non-biography pages are valid; do not add language directory.

For linked images preserve distinct display `src` and click `link`.

## 5. HTML→BioMD mapping

Use direct structure first; visual fallback second.

| HTML/source intent | BioMD |
|---|---|
| `h1`…`h6` | `#`…`######` |
| `p` / text | paragraphs |
| `strong/b` / bold | `**` |
| `em/i` / italic | `*` or `_` |
| highlight/accent | `==` when useful |
| `del/s/strike` | `~~` |
| `blockquote` | `>` |
| visible note/comment/inset | `>` or `frame` |
| `ul/ol/li` | lists |
| checkboxes | task list |
| `a[href]` | link; preserve target |
| simple `img` | Markdown image |
| image + caption/link/layout/frame | `image` |
| gallery/group | `images` |
| `<br>` / `<hr>` | hard break / `---` |
| table | GFM table if representable; else layout constructs |
| flex/grid/side-by-side | `columns` |
| border/accent/background callout | `frame` |
| bounded text alignment | `align` |
| prominent intro | `lead` |
| page/section navigation | `nav` |
| PDF/document card/embed | `document` |
| signature/credit | `signature` |
| `code/pre` | inline/fenced code |
| note reference | footnote |
| unsupported font/color/size | nearest supported visual distinction; otherwise drop style only |

Do not generate empty blocks, repeated hard breaks, whitespace, padding cells, or fake text for positioning.

When mappings compete:  
`content > targets > reading order > hierarchy/grouping > layout > visible distinction > exact style`.

## 6. Heading policy

CommonMark supports `h1`–`h6`; “exactly one `#`” is therefore a corpus convention, not a syntax requirement.

SHOULD: use one `#` for a source with one clear page title; preserve trustworthy heading levels; normalize obviously CSS-driven/nonsemantic levels only when it improves hierarchy; do not invent headings merely for size.

## 7. Validation

Before output verify:

1. visible content + real `href/src` preserved;
2. source/mobile order coherent;
3. no raw HTML/CSS/JS/JSX/MDX;
4. directive fences/nesting/required fields/enums valid;
5. footnote refs resolve;
6. catalogue slugs are indexed;
7. linked images retain `src` + distinct `link`;
8. no fabricated factual captions/headings/targets;
9. unsupported styling is approximated only with valid constructs or dropped as style-only;
10. result remains readable when columns/images stack and tables reflow.
