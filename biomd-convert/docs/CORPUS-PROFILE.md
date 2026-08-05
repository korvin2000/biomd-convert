# The corpus profile

`corpus/corpus-profile.json` is **generated**, not written by hand. It does not
exist until you run:

```bash
biomd corpus scan            # uses inputDir from your config
biomd corpus scan ./html     # or an explicit directory
```

It is safe to delete and regenerate at any time, and safe to leave out of
version control.

## Why it exists

Some questions cannot be answered from one page. This file answers them once,
for the whole corpus, and turns each into a lookup:

**Which structures are site chrome?** A navigation table that appears with
near-identical text on 400 of 412 pages is chrome, whatever it looks like. One
page in isolation cannot tell you that — and without it, your site menu ends up
in every converted document.

**What words does this corpus use?** Deciding whether `гита-\nрист` should be
rejoined into `гитарист` needs to know that `гитарист` is a word here. A
single-domain corpus contains exactly the composer names, place names and
instrument vocabulary a general dictionary lacks.

**What is a normal content column on this site?** The width histogram makes
"the central cell is about 529 px" a measurement rather than a hardcoded guess.

Running without it is supported and the tool warns when you do. Chrome removal
and de-hyphenation are both materially weaker.

## Structure

```jsonc
{
  // How many files were scanned.
  "files": 412,

  // Structural fingerprint → fraction of pages carrying it (0..1).
  // The fingerprint hashes the tag/class/id/width skeleton of a subtree,
  // deliberately excluding page-specific text: the point is to recognise the
  // same *scaffold* carrying different content.
  "fingerprintFrequency": {
    "07e51d83f79b5477": 0.97,
    "cc6d6485278c033e": 1.0,
    "a1b2c3d4e5f60718": 0.02
  },

  // Fingerprints that recur AND whose visible text barely varies: chrome.
  // A discography table recurs on every page but says something different each
  // time, so it is a content template and is deliberately NOT listed here.
  "stableChrome": [
    "07e51d83f79b5477",
    "cc6d6485278c033e"
  ],

  // Word frequencies over the whole corpus.
  "lexicon": {
    // Unhyphenated forms. Drives de-hyphenation rule 4 ("the joined form is
    // attested, so joining is safe").
    "counts": {
      "гитарист": 214,
      "композитор": 189,
      "сеговия": 96
    },
    // Forms that appear hyphenated. Drives rule 5 ("the hyphenated form is
    // attested and the joined form never is, so preserve").
    "hyphenated": {
      "из-за": 63,
      "римский-корсаков": 12,
      "кто-то": 31
    }
  },

  // Declared vs chosen charset per file. Batch anomalies surface here before
  // they become mojibake in the output.
  "encodings": {
    "segovia.html": { "declared": "windows-1251", "chosen": "windows-1251", "uncertain": false },
    "odd-page.html": { "declared": null, "chosen": "koi8-r", "uncertain": true }
  },

  // Rendered content-column widths, when measurement ran.
  "columnWidthHistogram": {},

  // Files that could not be processed, and why.
  "warnings": []
}
```

## Reading it

```bash
# Which files have a doubtful encoding? Check these by hand.
node -e "const p=require('./corpus/corpus-profile.json');
for (const [f,e] of Object.entries(p.encodings))
  if (e.uncertain) console.log(f, e.declared, '→', e.chosen)"

# How big is the vocabulary?
node -e "const p=require('./corpus/corpus-profile.json');
console.log(Object.keys(p.lexicon.counts).length, 'forms,',
            Object.keys(p.lexicon.hyphenated).length, 'hyphenated')"

# How many structures were classified as chrome?
node -e "const p=require('./corpus/corpus-profile.json');
console.log(p.stableChrome.length, 'of', Object.keys(p.fingerprintFrequency).length)"
```

## Tuning

```bash
biomd corpus scan --chrome-threshold 0.5
```

A structure must appear on at least this fraction of pages to be considered
chrome. Default `0.7`.

- **Site menu still in the output?** Lower it. With few files, or a site whose
  chrome varies between sections, 0.7 may be too strict.
- **Real content being removed?** Raise it, and check `stableChrome` — a
  structure listed there that carries article content is the thing to
  investigate. The secondary guard is that text must *also* be near-identical
  across pages, which is what keeps a recurring discography table out.

## When to regenerate

- after adding or removing a meaningful number of source files
- after changing `--chrome-threshold`
- after upgrading the tool, if the fingerprint algorithm changed

It is cheap: linear in corpus size, no browser, no model calls.
