## Legacy UI icons / linked micro-images

Legacy HTML often uses tiny GIF/PNG images as **navigation glyphs, buttons, letter labels, status markers, or link icons**. These are UI text-equivalents, not article media.

### Classification

**MUST NOT** automatically convert every `<img>` to Markdown/BioMD image syntax.

Treat a source image as a **UI icon** when a known `src` mapping exists, or when multiple independent signals indicate UI semantics:

- image is inside `<a href>`, navigation, menu, pager, index, or another control;
- intrinsic/rendered size is small, typically `<=32×32` px or similarly icon-sized;
- filename/path is icon-like: `next`, `previous`, `back`, `forward`, `home`, `up`, `reply`, `www`, `url`, `new`, `arrow`, etc.;
- `alt`/`title` describes an action, direction, letter/index marker, or navigation target rather than visual content;
- the same asset is reused across many pages;
- surrounding text/context identifies previous/next/home/back/index/navigation behavior.

**Small size alone is insufficient.** A small linked image may be a content thumbnail.

Prefer **content image** classification when any strong evidence exists:

- `<figure>` / `<figcaption>` or visible image caption;
- descriptive `alt` describing depicted content;
- link points to a larger image/scan version;
- image is article-specific rather than a repeated site asset;
- source context clearly treats it as a photograph, portrait, cover, illustration, score, scan, etc.

For unknown images, classify as UI icon only when **at least two independent UI signals** agree and no strong content-image signal conflicts. If still ambiguous, preserve it as an image rather than guessing.

For lookup/classification, filename matching MAY ignore case and `src` query/fragment suffixes; always preserve original resolved targets in output.

### Conversion

A classified UI icon **MUST NOT** become `![...](...)`, `::: image`, or gallery media. Replace it with compact inline text or a Unicode/HTML numeric character reference.

Known replacement mapping has highest priority.

```html
<a href="/#/bach_lute"><img src="/main/next.gif"></a>
```

→

```md
[&#9654;](/#/bach_lute)
```

General forms:

```text
linked icon only        -> [replacement](href)
unlinked meaningful icon -> replacement
linked text + icon      -> [replacement Text](href)
text + trailing icon    -> [Text replacement](href)
```

Preserve source order when combining icon and text.

Avoid redundant labels:

```html
<a href="next.html"><img src="next.gif"> Next</a>
```

Prefer:

```md
[&#9654; Next](next.html)
```

not:

```md
[&#9654; Next &#9654;](next.html)
```

If no known mapping exists:

1. infer a canonical glyph from unambiguous `alt`/`title`/filename/context;
2. otherwise use concise meaningful `alt`/`title` text as the link label;
3. if the icon is purely decorative and equivalent visible link text already exists, omit the icon;
4. if semantics remain uncertain, keep the original image representation.

Preserve the original `href`; only replace the **visual representation** of the icon.

For bitmap letters/ranges, replace the image with styled text:

```md
***А***
***А-К***
```

If linked:

```md
[***А-К***](target)
```

For source colors that BioMD cannot reproduce, preserve the closest **shape/state distinction**, not the exact color.

### Known icon replacements

| image | meaning | replacement |
| --- | --- | --- |
| `/main/reply.gif` | reply / return link | `&#8617;` |
| `/main/www.gif` | URL / WWW / external link | `&#8599;` |
| `/main/v.gif` | Russian uppercase letter `В` | `***В***` |
| `/main/up.gif` | up / previous level | `&#9650;` |
| `/main/kkk.gif` | up / previous level | `&#9650;` |
| `/main/ty.gif` | Russian letter range `Т-Я` | `***Т-Я***` |
| `/main/smile.gif` | smile | `&#9787;` |
| `/main/score3.gif` | sheet music / score | `&#9835;` |
| `/main/sad.gif` | sad / frown | `&#9785;` |
| `/main/previous.gif` | previous / backward link | `&#9664;` |
| `/main/p.gif` | Russian uppercase letter `Р` | `***Р***` |
| `/main/o.gif` | Russian uppercase letter `О` | `***О***` |
| `/main/next.gif` | next / forward link | `&#9654;` |
| `/main/new.gif` | new / newly added item | `&#9733;` |
| `/main/n.gif` | Russian uppercase letter `Н` | `***Н***` |
| `/main/m.gif` | Russian uppercase letter `М` | `***М***` |
| `/main/ls.gif` | Russian letter range `Л-С` | `***Л-С***` |
| `/main/k.gif` | Russian uppercase letter `К` | `***К***` |
| `/main/ja.gif` | Russian uppercase letter `Я` | `***Я***` |
| `/main/h2.gif` | current page / selected item | `&#9679;` |
| `/main/h1.gif` | home link | `&#8962;` |
| `/main/go.gif` | next / forward link | `&#9654;` |
| `/main/forward.gif` | next / forward link | `&#9654;` |
| `/main/c1.gif` | Russian uppercase letter `С` | `***С***` |
| `/main/c.gif` | Russian uppercase letter `С` | `***С***` |
| `/main/kk.gif` | small square marker | `&#9642;` |
| `/main/bggb1.gif` | square marker | `&#9632;` |
| `/main/back.gif` | back / return link | `&#9664;` |
| `/main/ak.gif` | Russian letter range `А-К` | `***А-К***` |

**Priority:** known mapping > strong semantic inference > meaningful text fallback > preserve original image.