# BioMD Lite Biography and Encyclopedia Markup

**Working name:** `BioMD Lite`  
**File extension:** `.bio.md`  
**Version:** 1.5  
**Status:** normative format specification

BioMD Lite is a deliberately small Markdown extension for biographies and closely related encyclopedia pages. It stores article content, semantic grouping, and a limited amount of responsive layout intent. Metadata belongs in a separate file.

The format is intended to be:

- readable and useful as plain Markdown;
- easy for people and agentic LLMs to author;
- independent of a particular font, color palette, or framework;
- expressive enough for biographies, rosters, project/about pages, news feeds, discographies, and media catalogs;
- constrained enough to render consistently on desktop and mobile.

The key words **MUST**, **SHOULD**, and **MAY** describe required, recommended, and optional behavior.

> **Authoring guide for the 1.3 additions** (`::: align`, the image `frame` property, `::: nav`, and the now-honoured `alt`/`link` properties): see [`Biography-Markup-Appendix-1.3.md`](Biography-Markup-Appendix-1.3.md). This specification stays normative; the appendix explains correct usage, examples, and diagnostics.

---

## 1. Preservation model

BioMD preserves the *meaningful design relationships* of a source, not its legacy rendering mechanism.

When requirements compete, use this priority order:

1. preserve the complete article text and meaningful link/media targets;
2. preserve semantic grouping, sequence, and hierarchy;
3. preserve relative relationships such as portrait beside biography, cover beside track list, grouped images, framed notice, or parallel columns;
4. preserve coarse emphasis and alignment when they carry meaning;
5. discard exact widths, line wrapping, manual hyphenation, fonts, colors, backgrounds, and pixel spacing.

The document's source order is its canonical reading order. Wide-screen placement is a hint layered over that order; it MUST NOT make the mobile or non-visual reading sequence incoherent.

### 1.1 Content that normally belongs in BioMD

- one article title and meaningful section headings;
- paragraphs in their logical order;
- meaningful bold, italic, highlighted, quoted, and list content;
- portraits, illustrations, covers, scans, captions, and image click targets;
- related-page and external links;
- downloadable or embeddable documents and media;
- real tables, including recording/resource matrices;
- content-specific navigation, notices, credits, footnotes, and signatures.

### 1.2 Content that normally does not belong in BioMD

- global site headers, footers, and repeated menus;
- counters, advertisements, tracking, PHP fragments, and copy-protection handlers;
- JavaScript, inline event handlers, CSS, and raw HTML;
- ornamental page-shell cells, backgrounds, spacer images, and empty elements;
- exact coordinates, widths, margins, colors, fonts, and forced line breaks used only for wrapping.

A side rail is not automatically chrome. A content-specific badge, image, caption, or navigation menu in a side cell MUST be preserved and moved into the logical article flow.

---

## 2. Document structure

Every document MUST have exactly one level-one heading.

```md
# Laurindo Almeida

::: lead

Laurindo Almeida connected classical guitar, Brazilian music, and jazz.

:::

::: image
src: images/laurindo-almeida.jpg
position: right
size: medium
alt: Laurindo Almeida holding a classical guitar
caption: Laurindo Almeida
:::

## Biography

Article text begins here.
```

Recommended high-level order:

1. `#` title;
2. optional subtitle;
3. page-level `nav`, lead, or opening image;
4. article sections in reading order;
5. recordings, works, documents, and related links;
6. footnote definitions, sources, credits, or signature.

Do not create an empty `## Biography` merely for uniformity. Add a heading only when it improves a real section hierarchy.

### 2.1 Subtitle

Keep a secondary title line as an italic paragraph directly below the title. Use a `lead` instead only when it is a genuine introductory statement.

```md
# Аудио-карта

*Сводный каталог аудио, нот и табулатур*
```

There is still only one `#` title.

### 2.2 Roster and multi-entry pages

A roster such as an authors page uses one article title and one `##` heading per person or entry. A thematic separator MAY be placed between entries.

```md
# Авторы проекта

## Тавровский Сергей Викторович

::: image
src: photo/t/tavrovsky_sv.jpg
position: right
size: medium
alt: Тавровский Сергей
:::

Biography text.

---

## Тавровский Виктор Владимирович
```

A roster is a valid BioMD document even when it does not map one-to-one to a single-person metadata record.

### 2.3 Adjacent encyclopedia page patterns

- **News feed:** keep entries in source order, begin with a bold date only when
  the source supplies one, separate ordinary entries with `---`, and use
  `frame` for semantic notices.
- **Media catalog:** use a subtitle when present, `nav` for page ranges,
  headings for performer/composer groups, and real resource tables.
- **Multi-page article or series:** keep one BioMD file per source page and use
  `nav` or a normal continuation link. Retarget only destinations confirmed by
  the conversion manifest.
- **Project/about page:** preserve its internal headings, links, credits, and
  closing signature; decorative page-shell art remains outside BioMD.

---

## 3. Plain Markdown

Prefer ordinary Markdown whenever it can express the content without losing a meaningful relationship.

### 3.1 Paragraphs and line breaks

A blank line separates paragraphs.

```md
First paragraph.

Second paragraph.
```

A Markdown hard break MAY preserve lineation in a postal address, short signature, verse, programme, or similar content. Do not use hard breaks to imitate legacy line wrapping.

Two spellings are equivalent — a trailing backslash and two trailing spaces:

```md
**Ядвига Ричардовна**\
**КОВАЛЕВСКАЯ**
```

Prefer the backslash: trailing spaces are invisible in an editor and are silently
eaten by many tools. A hard break only joins two lines **inside one block**, so it
is meaningless — and per CommonMark renders as a *visible* `\` — at the end of a
paragraph, a heading, or a list item:

```md
- Том I Клубника со сливками (1984–1993)\   ← wrong: shows a stray backslash
- Том II Рок-н-ролл (1986–1994)             ← each item is already its own block
```

A break in that position carries no content, so a renderer SHOULD **drop** it
rather than display it — the same cleanup licence as section 1 priority 5 and
16.3 — and SHOULD warn, so the source gets corrected too. To end a line with a
*literal* backslash, escape it (`\\`); an escaped one is never touched.

### 3.2 Headings

- `#` — the single article title;
- `##` — a major article section or roster entry;
- `###` — a subdivision such as one album within a recordings section.

Heading levels MUST NOT skip solely to reproduce visual size.

### 3.3 Emphasis

```md
**Strong text**

*Composition, publication, or ordinary emphasis*

==Semantically highlighted text==
```

`==...==` is a BioMD inline extension. Use it only when the source intentionally stresses meaning, not merely because a span had a different color or small-caps style.

`---` creates a thematic separator. It MUST NOT be repeated to simulate borders or spacing.

### 3.4 Lists

Use normal Markdown bullet and numbered lists.

```md
- First award
- Second award

1. First track
2. Second track
```

Convert both real HTML lists and fake lists made from bullets plus `<br>`. Use numbering only when the source supplies numbers or sequence is meaningful, such as a track order.

Preserve a consistent leading-zero marker when the source shows one:

```md
01. First track
02. Second track
```

This is still an ordinary Markdown ordered list. A renderer SHOULD keep the
marker width and display `01`, `02`, …; a plain Markdown fallback MAY show
ordinary decimal markers. A converter MUST NOT replace explicit source numbers
with repeated `1.` markers, and MUST NOT invent padding the source does not have.

### 3.5 Quotations and compact secondary blocks

Use a Markdown block quote for a genuine quotation. Keep attribution in the final quoted paragraph.

```md
> Я с большим удовольствием констатирую, что музыкант добился огромных успехов.
>
> — Андрес Сеговия, 4 августа 1961 года
```

Do not turn titles, scare quotes, ordinary dialogue fragments, or every pair of quotation marks into a block quote.

A block quote MAY also carry a coherent commentary, annotation, or source-credit
block that the source deliberately subordinates to the main prose — shown by
combined evidence such as a consistently smaller font *plus* deeper indentation
or separate alignment, never by font size alone. A renderer SHOULD present such a
block as visibly subordinate and MAY set it slightly smaller. Do not apply this
to an outer `<blockquote>` used only as the legacy page's global margin.

### 3.6 Links

Use ordinary Markdown links for websites, email addresses, related articles, and files that do not need a document block.

```md
[Official website](https://example.org)

[Related biography](other-musician.bio.md)

[guitar@example.org](mailto:guitar@example.org)
```

Link text MUST remain meaningful without surrounding layout or a decorative arrow icon.

#### Linking to another catalogue entry

Two forms are equivalent and both open the target inside the codex:

```md
[Related biography](other-musician.bio.md)   ← the article's file name
[Related biography](#/other-musician)        ← the entry's route
```

The **slug** is the article's file name with `.bio.md` or `.md` removed, and
the route is `#/{slug}`. Slugs are unique across the catalogue and are defined
by [`Catalog-Index.md`](Catalog-Index.md) §4.2.

- The target MUST exist as a row in `pages/index.json`. A link to an article
  that is not indexed resolves to nothing and is silently inert.
- A target that is **not a biography** — an *about*, *sources* or continuation
  page, whose file is named `<slug>.md` — is a perfectly valid link target and
  opens in the codex's page mode.
- A target marked `type: "hidden"` is also valid: hidden entries are excluded
  from the catalogue grid and from search, but remain fully linkable.
- Do **not** write the language directory into the link. Editions resolve
  automatically; `[…](ru/other-musician.bio.md)` is wrong.

### 3.7 Footnotes

New documents MUST use Markdown footnotes.

```md
**Барриос[^barrios-name] (Мангори) Агустин** ...

[^barrios-name]: Другая транскрипция фамилии — Баррьос.
```

Footnote identifiers are internal and SHOULD be short, stable, and descriptive. Definitions normally appear after the section or at the end of the article. They MAY contain multiple paragraphs, links, or a block quote when the source note is complex.

Legacy BioMD 1.0/1.1 files may contain manually written Unicode markers such as `¹`; renderers SHOULD continue to display them, but converters MUST prefer `[^id]` syntax for new work.

### 3.8 Tables

Use a Markdown table only when row/column relationships are part of the information.

```md
| Work | Tablature | Audio / MIDI | Scores / archives |
|---|---|---|---|
| La Catedral | [TAB](music/tab/example.txt) | [MIDI](music/midi/example.mid) | [1](music/scores/page1.jpg), [ZIP](music/scores/archive.zip) |
```

Rules:

- provide a meaningful header for every column;
- combine legacy continuation rows into the logical parent row when this loses no information;
- use `—` for an intentionally empty value;
- keep all meaningful resource links;
- do not reproduce `rowspan`, `colspan`, spacer cells, or percentage widths;
- do not use a table for page layout, paired images, or text beside a cover.

The renderer MUST keep a wide table usable on a narrow screen, for example through contained horizontal scrolling or a labeled stacked-row view. It MUST NOT force the entire page to scroll horizontally.

---

## 4. Directive syntax

A directive is a fenced block beginning with `::: name` and ending with `:::`.

```md
::: name
property: value

Optional body content.
:::
```

Rules:

- directive and property names are lowercase ASCII;
- one property appears per line;
- a property value is the remainder of its line and is not YAML;
- a blank line separates properties from body content;
- a closing fence closes the most recently opened directive;
- indentation is not layout and SHOULD be omitted;
- undocumented properties MUST produce a warning;
- an unknown directive MUST preserve and render its readable body content rather than deleting it.

### 4.1 Content model

| Directive | Required | Optional | Body |
|---|---|---|---|
| `lead` | — | — | ordinary Markdown |
| `align` | `position` | — | Markdown and leaf media directives |
| `image` (standalone) | `src`, `position`, `size` | `alt`, `caption`, `link`, `frame` | none |
| `image` inside `images` | `src` | `alt`, `caption`, `link`, `frame` | none |
| `images` | `columns` | `frame` | two or more `image` children |
| `document` | `src`, `title`, `mode` | — | none |
| `columns` | at least two `column` children | `columns`, `divider` | `column` children only |
| `column` | — | — | Markdown and leaf media directives |
| `nav` | one or more Markdown links | `title`, `active` | Markdown link list |
| `frame` | — | `frame`, `title` | Markdown and leaf media directives |
| `signature` | — | — | short Markdown paragraphs |

Nesting constraints:

- `images` contains only `image` children;
- `columns` contains only `column` children;
- a `column` MUST NOT contain another `columns` block;
- a `frame` MUST NOT contain another `frame` or a `nav`;
- a `signature` SHOULD contain only text, links, and hard line breaks;
- an `align` block MUST NOT contain a `columns` block and MUST NOT wrap a `nav`;
  it MAY appear inside `lead`, `column`, or `frame`;
- nesting deeper than the relationships above is invalid.

A directive that appears where it is not allowed MUST NOT delete its content: the
renderer emits a warning and renders the offending block's readable body in place,
without its own layout (section 17).

---

## 5. Lead paragraph (`::: lead`)

Use a lead for a genuine introductory summary that deserves emphasis.

```md
::: lead

Laurindo Almeida connected classical guitar, Brazilian music, and jazz throughout a long international career.

:::
```

The theme MAY render it with larger type or a drop capital. Do not use `lead` merely to obtain a larger font.

---

## 6. Single image (`::: image`)

```md
::: image
src: photo/b/barrios.jpg
position: right
size: small
alt: Агустин Барриос
caption: Агустин Барриос
:::
```

### 6.1 Properties

- `src` — required resource target;
- `position` — required on a standalone image: `left`, `right`, `center`, or `full`;
- `size` — required on a standalone image: `small`, `medium`, `large`, or `full`;
- `alt` — optional accessibility text; strongly recommended for meaningful images;
- `caption` — optional visible caption;
- `link` — optional click target for a thumbnail, cover, or scan;
- `frame` — optional theme frame treatment (see 6.5).

`alt` and `caption` are different. `alt` describes the image for a non-visual reader; `caption` is visible editorial context. If `alt` is absent, the renderer MAY fall back to the caption. It MUST NOT use a filename as visible alternative text.

### 6.2 Position semantics

- `left` — image precedes and may be wrapped by the following related prose on wide screens;
- `right` — image precedes and may be wrapped by the following related prose on wide screens;
- `center` — standalone centered figure without text wrapping;
- `full` — standalone figure using the available article width.

Place a left/right image immediately before the paragraph it accompanies. A following heading, separator, centered/full image, image group, columns block, navigation block, or frame automatically clears wrapping.

### 6.3 Size semantics

Sizes are theme-relative, not source pixels:

- `small` — badge, stamp, small portrait, or cover;
- `medium` — ordinary portrait or cover;
- `large` — prominent illustration;
- `full` — use the available article width.

The renderer MUST preserve intrinsic aspect ratio unless a product-specific crop is explicitly requested outside BioMD.

### 6.4 Clickable image

When HTML uses `<a><img></a>`, preserve both targets in one image block.

```md
::: image
src: photo/t/tavrovsky_rg2002.jpg
position: center
size: large
link: articles/about_us/rg_2002.jpg
alt: Заметка о проекте в альманахе «Ренессанс гитары — 2002»
caption: Один из первых печатных отзывов о проекте
:::
```

Do not add a duplicate “open image” link unless a separate visible fallback is required by the product.

### 6.5 Picture frame

`frame` is an optional property of `::: image`. On `::: images` it sets the default for children that do not carry their own `frame`; a child value always wins. It names a **theme-defined** treatment around the picture:

| Value | Meaning |
|---|---|
| *(absent)* | identical to `curl` — the theme's default photographic frame |
| `curl` | the default treatment, stated explicitly (useful to override an inherited group frame) |
| `none` | no decorative frame and no frame shadow — a plain image |
| `mat` | ivory mount (passe-partout) with a hairline |
| `black` | broad dark-ink border |
| `white` | broad ivory-white border |
| `red` | broad deep-red border |
| `gold` | broad muted-gold border |

The four colour borders are deliberately substantial rather than hairlines, so the frame reads as part of the picture.

```md
::: image
src: photo/b/barrios.jpg
position: center
size: large
alt: Агустин Барриос с гитарой
caption: Агустин Барриос
frame: black
:::
```

Rules:

- exact thickness, shade, radius, mat width, and hover treatment remain renderer/theme decisions; `frame` only names the intent;
- literal colours (hex, `rgb()`, CSS variables, class names, gradients, URLs) are **not** accepted; an unrecognized value MUST produce a warning and fall back to the default frame;
- `frame` changes presentation only — never aspect ratio, size, position, caption, `alt`, click target, loading behaviour, or source order;
- it frames the image, not the caption or the surrounding article;
- an ordinary Markdown image (`![alt](src)`) has no frame property: convert it to `::: image` when a frame is needed. No inline-attribute syntax is added;
- **`frame` (an image property) and `::: frame` (the bordered notice/callout of section 11) are unrelated**: the first draws a picture frame, the second encloses article prose.

---

## 7. Image group (`::: images`)

Use an image group when two or more adjacent source images form one visual row or gallery.

```md
::: images
columns: 2

::: image
src: photo/j/jovicic1.jpg
alt: Йован Йовичич
caption: Йован Йовичич
:::

::: image
src: photo/j/jovicic.jpg
alt: Йован Йовичич
caption: Йован Йовичич
:::

:::
```

`columns` MUST be `2`, `3`, or `4`. A child image requires only `src`; its placement and responsive size come from the group. Child `position` and `size` properties SHOULD be omitted and are ignored if present.

Keep the source order. Do not group images separated by substantial prose merely because they have similar dimensions.

---

## 8. Document (`::: document`)

Use a document block for a PDF, scan set, audio document, or another BioMD document that should appear as a document card or embed.

```md
::: document
src: documents/almeida-discography.pdf
title: Selected Discography
mode: link
:::
```

`mode` is:

- `link` — show a document link or card;
- `embed` — embed when supported.

Every embed MUST retain an accessible link fallback. Ordinary individual MP3, MIDI, WMA, TAB, score-page, and ZIP references MAY remain Markdown links, especially inside a resource table.

---

## 9. Columns (`::: columns` and `::: column`)

Use columns only when two or three parallel content groups have a meaningful side-by-side relationship.

```md
::: columns
divider: true

::: column

Album description and track list.

:::

::: column

::: image
src: photo/album-cover.jpg
position: center
size: medium
alt: Album cover
:::

:::

:::
```

`divider` is optional and accepts `true` or `false`; the default is `false`.

Good uses:

- album description beside its cover;
- two source columns of grouped works;
- parallel short biographies or facts;
- a compact multi-column catalogue or record grid;
- a layout whose visible vertical divider is meaningful.

Bad uses:

- recreating page margins;
- forcing a narrow text measure;
- centering or narrowing one continuous list or prose block;
- placing unrelated consecutive sections side by side;
- reproducing an entire desktop page shell.

On narrow screens columns stack in source order. A vertical divider is removed or becomes a horizontal separator.

### 9.1 Explicit track count

`columns` accepts an optional `columns` property — `2`, `3`, or `4` — exactly as
`::: images` does. It states how many tracks the grid has, so **one** block can
hold a whole multi-row record grid instead of being repeated once per row.

```md
::: columns
columns: 2
divider: true

::: column
**Сюита № 1**
:::

::: column
1957
:::

::: column
**Сюита № 2**
:::

::: column
1961
:::

:::
```

- when `columns` is present the block MAY contain any number of `column`
  children; they fill the grid in source order, left to right, and a new row
  begins after every *n*-th child;
- when `columns` is absent the grid has as many tracks as there are `column`
  children (two or three) — the behaviour of every document written before 1.5;
- `2` and `3` suit prose; use `4` only for short cells;
- leave a trailing incomplete row ragged; do not pad it with empty columns;
- `divider: true` draws the vertical rule between the tracks of every row;
- on narrow screens every cell stacks in source order, exactly as before.

A record grid is still not a data table: when the cells form a real header/row
matrix, use a Markdown table (section 3.8).

### 9.2 Parallel source lanes

Do not assume that a continuous number range makes two source cells fungible.
Collapse a split into one Markdown list only when the split is a one-off
presentational wrap with no independent source-lane evidence. Keep `columns` for a
numbered grid when the source proves both cells are intentional parallel lanes:
they share a row, have stable geometry, each holds a non-empty numbered range, and
the pattern recurs.

For a repeated multi-column catalogue, keep every cover, title, and track list as
one indivisible group, and preserve the source item numbers so the visual order
stays explicit. Two mappings are available; choose by what matters more:

- **persistent lanes** — items `1, 3, 5, …` in the first `column` and `2, 4, 6, …`
  in the second, when the source's vertical lanes are the relationship;
- **row-major reading** — one `column` per item with an explicit track count
  (section 9.1), or one paired `columns` block per source row, when narrow-screen
  reading order matters more than the lanes.

---

## 10. Navigation (`::: nav`)

Use `nav` for a compact group of links that functions as page-level or section-level navigation.

```md
::: nav
title: Дискография

- [1995–2002](williams_cd1.bio.md)
- [1989–1994](williams_cd2.bio.md)
- [1979–1988](williams_cd3.bio.md)
- [1971–1979](williams_cd4.bio.md)
- [1958–1970](williams_cd5.bio.md)
:::
```

Properties:

- `title` — optional visible label;
- `active` — optional plain-text label of the current item.

```md
::: nav
title: Аудио-карта
active: А – Бартоли

- [А – Бартоли](karta.bio.md)
- [Бах – Г](karta2.bio.md)
- [Д – Л](karta3.bio.md)
- [М – О](karta4.bio.md)
- [П – Я](karta5.bio.md)
:::
```

Rules:

- the body is a Markdown bullet list containing one link per item, except that a
  source-backed current item MAY be plain text instead of a link — the renderer
  presents it as the current item, exactly as `active` would;
- `active` matches the rendered plain-text label of exactly one item and makes
  that item current/non-clickable;
- duplicate labels are invalid when `active` is used;
- merge adjacent source anchors that form one visual label and share one target;
- a prominent side menu that applies to the whole page normally moves directly below the title or lead;
- navigation belonging to one later section goes immediately before that section;
- a single continuation link MAY remain an ordinary Markdown link;
- do not use `nav` for unrelated inline links;
- `nav` items SHOULD target another catalogue entry (`*.bio.md`, `<slug>.md`, or `#/{slug}` — see §3.6), a fragment, or an absolute URL. Media targets (audio, images, tablature) are not navigation and are rendered as plain links, without media widgets;
- a nav that spans a multi-part work (a discography split across five pages, an alphabetical map) SHOULD point at entries marked `type: "hidden"` in `pages/index.json`, so the continuation pages stay reachable and linkable without each appearing as a separate card in the catalogue grid.

The renderer presents a nav as a single **centered horizontal bar** of links. On narrow screens it wraps or scrolls within its own container and MUST NOT create page-level overflow. Authored source line breaks do not shape its rows — the bar reflows on available width alone.

Nav items are links, not controls: a conforming renderer emits real anchors, marks the `active` item with `aria-current`, and MUST NOT present the bar as tabs that switch a panel in place.

---

## 11. Frame / callout (`::: frame`)

Use a frame when the source intentionally encloses an article-specific notice or aside.

```md
::: frame
frame: black

**14 августа 2020 года** в возрасте 87 лет скончался выдающийся британский гитарист и лютнист.

**Джулиан Брим**

:::
```

Properties:

- `frame` — `gold` (default), `black`, `red` or `white`;
- `title` — optional internal heading.

Typical frame values:

- dark obituary, funeral, or in-memoriam region → `black`;
- congratulation or source accent region → `red`;
- ceremonial or prominent source border → `gold`;
- another source-backed semantic border → `white`.

The body may contain paragraphs, emphasis, lists, links, an `align` block, and leaf media directives. A frame is semantic; it MUST NOT reproduce the article's outer border, background panel, or spacer cells. Border thickness, color, and background remain theme decisions.

A frame MUST enclose the **complete** source-bounded region, not a fragment of it.
When the source border encloses a picture together with its announcement, that
`::: image` stays inside the same frame. A renderer SHOULD distinguish the tokens
by mood — `black` restrained and funereal, `red` celebratory — rather than by
border colour alone.

`frame` here and the identically named image property (6.5) share their palette
tokens but not their scope: this one encloses a whole semantic region, the other
decorates one picture or image group. Use both when the source has both
relationships.

---

## 12. Signature (`::: signature`)

Use a signature for a short closing author/place/credit block whose end alignment is part of its identity.

```md
::: signature

*Авторы проекта «Гитаристы и композиторы»*  
*Виктор и Сергей Тавровские*  
*Кишинёв — Киев — Харьков*

:::
```

The renderer SHOULD present it as a compact closing block aligned toward the reading-end edge on wide screens and as an ordinary readable block on narrow screens. Do not use `signature` for generic right-aligned prose, long footnotes, or arbitrary positioning.

A source citation that is not a signature normally remains a short italic paragraph, optionally after `---`.

---

## 13. Alignment (`::: align`)

Use `align` when horizontal alignment carries meaning — a centered dedication or concert programme, a right-aligned archival dateline. Alignment is a coarse presentation hint (section 1, priority 4), not structure.

```md
::: align
position: center

*Посвящается памяти Андреса Сеговии*

:::
```

Properties:

- `position` — **required**: `left`, `center`, or `right`.

Rules:

- the block changes visual alignment only; it never changes source, reading, copy, or keyboard-focus order;
- use it for a bounded group — a short paragraph, dedication, small heading group, or credit line. Do not wrap a whole article, and prefer default alignment for long prose (centered or right-aligned body text is harder to read);
- a child directive's own layout rule wins: `image.position` remains the authoritative placement rule for a standalone image;
- the renderer treats the block as a new block that ends an earlier left/right image wrap (the same rule as 6.2);
- a missing or unrecognized `position` MUST produce a warning and render the body at the document's default alignment — never delete content;
- an `align` block MAY appear inside `lead`, `column`, or `frame`; it MUST NOT wrap `columns` or `nav`, and two `align` blocks MUST NOT be used to imitate columns;
- `left` and `right` are physical values, consistent with `image.position`. Logical `start`/`end` values MAY be considered in a later revision if right-to-left content is introduced;
- for a genuine closing author/place/credit block use `::: signature`, not `align`;
- do not use `align` to recreate margins, columns, indentation, or spacing.

---

## 14. Responsive rendering contract

A conforming renderer MUST:

- treat source order as reading, focus, copy, and screen-reader order;
- keep all content within the article viewport;
- make left/right images ordinary centered or edge-aligned blocks when wrapping would make text too narrow;
- preserve image aspect ratio and keep captions attached;
- preserve bounded text alignment without changing reading or focus order;
- reduce or stack image groups when necessary;
- stack columns in source order;
- adapt or contain wide tables without page-level horizontal overflow;
- wrap or locally scroll navigation;
- keep frames readable at full available width;
- retain document-link fallbacks;
- render headings, text, links, quotations, lists, footnotes, and tables usefully without client-side JavaScript.

BioMD does not encode breakpoints, pixel widths, text-column widths, source line wrapping, or hyphenation. Those belong to the renderer and language-aware CSS.

---

## 15. Resource and link resolution

Targets may be:

- fragment links such as `#works`;
- `mailto:` or another supported URI scheme;
- absolute `http://` or `https://` URLs;
- application-root or resource-base paths;
- relative article, image, media, or document paths.

Relative resource targets resolve against the application's configured resource base, whose default is `/pages`, not against the application's deployment prefix. For example, an application deployed at `/fable/` still resolves:

```text
music/mp/track.mp3 -> /pages/music/mp/track.mp3
```

A leading slash does not change this: `/music/mp/track.mp3` resolves identically. Absolute URLs and fragment links remain unchanged.

### 15.1 Reaching outside the resource base

Part of the archive lives beside the resource base rather than inside it. Two forms reach it, and both are resolved by the application, not left to the browser's URL parser:

```text
^/main/cover.jpg      -> /main/cover.jpg     anchored at the resource root
/../main/cover.jpg    -> /main/cover.jpg     climbs out of the base
```

A target beginning with `^` is anchored at the **resource root** — the base is skipped entirely. `.` and `..` segments are applied normally and clamped at that root, so `..` cannot escape above it.

Authors SHOULD prefer `^`. It states the intent and holds however deep the base is configured, whereas `..` must match the base segment for segment: with a base of `/content/pages`, `/../main/x.jpg` lands at `/content/main/x.jpg`, while `^/main/x.jpg` still lands at `/main/x.jpg`.

Neither form is a way to reach a *different host*. Use an absolute URL for that.

Conversion MUST preserve target identity. If source and BioMD documents have different base locations, the converter must resolve the original target first and then rebase it deliberately for the BioMD resource model. It MUST NOT blindly copy or strip a `pages/` prefix.

Retarget an `.htm` link to `.bio.md` only when a conversion manifest confirms the destination exists or will be produced. Otherwise preserve the original target.

Missing local assets MUST remain recorded under their intended target and in the conversion audit. A publishable conversion MUST NOT silently substitute unrelated external placeholder media. A temporary preview placeholder is allowed only when explicitly marked as incomplete outside the BioMD document.

---

## 16. HTML migration rules

Before discarding a source's CSS, inventory its class usage and the declarations
that affect hierarchy or grouping — font size, indentation, alignment, borders,
backgrounds. The values themselves are never preserved, but a *repeated*
difference is evidence: it may establish a subtitle, a secondary note, a source
credit, a frame, a caption, or another semantic relationship that would otherwise
be lost.

### 16.1 Element mapping

| HTML source pattern | BioMD |
|---|---|
| visible article title | single `#` |
| meaningful subsection label | `##` or `###` |
| `<p>` / repeated content `<br>` | Markdown paragraphs |
| `<strong>`, `<b>` | `**text**` when semantically strong |
| `<em>`, `<i>` | `*text*` when semantically emphasized |
| `<ul>`, `<ol>`, or repeated bullet + `<br>` | Markdown list |
| genuine quotation | Markdown `>` |
| coherent smaller/indented commentary or source credit | Markdown `>` as a secondary block (3.5) |
| `<a>` | Markdown link |
| linked `<img>` | `image` with `link` |
| floated portrait | standalone `image` with `left`/`right` |
| adjacent image row | `images` |
| text beside cover/image | `columns` |
| meaningful vertical rule | `columns` with `divider: true` |
| real data/resource table | Markdown table |
| layout table | normal flow, `image`, `images`, or `columns` |
| vertical side menu / pagination | `nav` |
| horizontal row of page links (table- or `<br>`-based menu) | `nav` |
| bordered notice / obituary | `frame` |
| right-aligned closing signature | `signature` |
| `<center>`, `align="center"`, meaningful `text-align` on a block | `align` with `position` |
| `<img border="…">`, colored/bordered `<td>` around an article image | `image` with `frame` |
| `<sup>` plus anchor note | Markdown footnote |
| decorative drop-cap image plus word remainder | reconstructed plain text |
| colored font / small caps / letter spacing | plain text or semantic emphasis, never copied styling |
| PDF or embeddable document | `document` |

### 16.2 Table classification

Classify every source table before converting it:

1. **page shell** — repeated header, footer, side background, or spacer grid: remove;
2. **layout table** — position is the relationship: rewrite as flow, images, or columns;
3. **data table** — cells form a record matrix: convert to a Markdown table;
4. **hybrid table** — data mixed with layout, nested rows, or covers: separate the semantic records from the visual arrangement, then use a table and/or columns.

Border presence alone does not make a table data. Lack of borders does not make it layout.

### 16.3 Text cleanup boundary

Safe cleanup:

- decode HTML entities;
- convert non-breaking spaces used for indentation to normal spaces;
- remove soft hyphens and join confidently identified layout-only word breaks;
- discard source line wrapping;
- reconstruct a decorative first-letter image when the missing letter is certain;
- remove empty paragraphs and spacer breaks.

In manually wrapped legacy prose, classify every line break before touching it:
wrapping, paragraph boundary, meaningful lineation, or spacing. Join only text that
is contextually continuous within one paragraph or sentence; never join verse, song
lyrics, addresses, or programme lines.

Editorial change:

- correcting a spelling mistake or name;
- modernizing facts, dates, transliteration, or terminology;
- paraphrasing;
- silently changing punctuation that can affect meaning;
- inventing a caption, heading, alt description, or link target.

Editorial changes require an explicit policy and audit trail. The default conversion is conservative transcription.

### 16.4 Layout-specific images

Do not discard an image merely because it is outside the central content cell. Preserve a side badge, stamp, award, cover, or contextual illustration and move it near the paragraph or section it belongs to. Discard only repeated chrome, counters, spacers, and ornaments with no article-specific meaning.

---

## 17. Engine interpretation

Recommended parsing order:

1. read UTF-8 and normalize line endings;
2. identify directive fences and build a nested directive tree;
3. validate each directive's properties and content model;
4. parse ordinary Markdown, including tables and footnotes, inside permitted bodies;
5. resolve links and resources;
6. emit semantic HTML;
7. apply the selected responsive theme.

Required recovery behavior:

- an unknown directive preserves its readable body and emits a warning;
- an unknown property is ignored with a warning;
- a missing required property renders a visible diagnostic or safe fallback rather than deleting neighboring content;
- an unresolvable embed remains a normal link;
- malformed nesting must not consume the rest of the document silently.

---

## 18. Authoring and validation checklist

Before accepting a document, verify:

- exactly one `#` title and a non-skipping heading hierarchy;
- logical source/mobile order;
- balanced directive fences and valid nesting;
- required directive properties and allowed values;
- every `align` bounded, with a valid `position`, and not used as layout or spacing;
- every picture frame and semantic frame naming an allowed theme token;
- every `nav` containing navigation items only, relying on responsive wrapping;
- meaningful `alt` text or a documented reason it is absent;
- captions remain attached to their images;
- every meaningful source image, link, and file target is preserved or explicitly audited;
- linked images retain both `src` and `link`;
- no raw HTML, CSS, JavaScript, or whitespace-based positioning remains;
- layout tables are not mistaken for data tables, and real tables have headers;
- footnote references and definitions match;
- no silent placeholder substitutions or unverified `.htm` → `.bio.md` retargeting;
- desktop and narrow-screen rendering remain readable and complete.

The source remains authoritative for factual text. BioMD controls structure and responsive presentation, not editorial rewriting.

---

# Changelog

## v1.5

- Added an optional `columns` property to `::: columns` (`2`, `3`, or `4`), mirroring `::: images`: one block can now hold a whole multi-row record grid whose cells flow row by row, instead of the block being repeated once per row (section 9.1).
- Documented the parallel-lane rules for repeated multi-column catalogues, and named "centering or narrowing one continuous list" as a misuse of `columns` (section 9.2).
- Added source-faithful leading-zero ordered-list markers (`01.`, `02.`; section 3.4).
- Allowed a block quote to carry a deliberately subordinate commentary or source-credit block, on combined evidence rather than font size alone (section 3.5).
- Allowed a `nav`'s current item to be plain text instead of a link, and stated that authored line breaks do not shape the bar's rows (section 10).
- Required a `::: frame` to enclose its complete source-bounded region, including an image that the source border encloses with the announcement; permitted `align` in its body (section 11).
- Stated where an `align` block may appear (`lead`, `column`, `frame`) and that two of them must not imitate columns (sections 4.1, 13).
- Required a misplaced directive to be rendered as readable content with a warning rather than dropped (section 4.1).
- Added the CSS-evidence inventory and legacy line-break classification to the migration rules, plus a mapping row for subordinate commentary (sections 16, 16.1, 16.3).
- Added bounded-alignment preservation to the responsive contract and three items to the validation checklist (sections 14, 18).
- Merged the parallel 1.3–1.6 fork of this specification; that document is retired. Its stricter re-definitions were **not** adopted, because they break documents that are valid under 1.4: `divider: false` stays legal, and `::: frame`'s `frame` token stays optional with a `gold` default.
- No change to existing documents: every addition is a new optional property, a new permission, or renderer guidance.

## v1.4

- Added the `^` resource prefix: a target beginning with `^` is anchored at the resource root, skipping the resource base (section 15.1). Preferred over `..` for reaching archive material that lives outside the base.
- Specified that `.` and `..` segments in resource targets are resolved by the application and clamped at the resource root, instead of being left to the browser's URL parser (section 15.1).
- No change to existing documents: `^` is new syntax, and `..` keeps the meaning it already had in practice.

## v1.3

- Added the `::: align` directive with a required `position: left|center|right` for meaningful horizontal alignment (section 13).
- Added the optional `frame` property to `::: image` and `::: images` (theme-named picture frames: `curl`, `none`, `mat`, `black`, `white`, `red`, `gold`; section 6.5). Literal colours are not accepted.
- Clarified that `frame` (an image property) and `::: frame` (a callout block) are unrelated.
- Clarified `nav` rendering: one centered horizontal bar of real links that wraps inside its own container; media targets stay plain links.
- No change to existing documents: every addition is a new directive or an optional property.

## v1.2

- Reorganized the specification around a normative preservation hierarchy and responsive content model.
- Added `::: signature` for meaningful closing author/credit blocks.
- Made Markdown footnotes the required syntax for new documents.
- Defined directive grammar, nesting, child-image requirements, and recovery behavior.
- Clarified image wrapping boundaries, nav placement, roster pages, hybrid tables, and adaptive table rendering.
- Added conservative transcription, path-rebasing, target-retargeting, and missing-asset rules.
- Clarified that semantic content in legacy side rails must be preserved.

## v1.1

- Added `::: nav` and `::: frame`.
- Added `link` and `alt` to `::: image`.
- Added `divider` to `::: columns`.
- Documented subtitles, lists, drop caps, emphasis, signatures, multi-page series, and news datelines.

## v1.0

- Initial BioMD Lite specification.
