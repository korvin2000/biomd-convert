A page has been converted from 1998-2010 HTML into a semantic document format by a
deterministic compiler. Every automatic check has already passed: the text is
conserved, the links and pictures are all present, the syntax validates. You are
looking for what those checks cannot see.

**Report findings. Do not rewrite anything.** Your output is a list of places a human
should look, written into a review queue. Nothing you say edits the document.

What the automatic checks are blind to, and therefore what to look for:

- **structure flattened into text.** A poem, an address, a programme or a table
  emitted as one long paragraph. Every word is present and the structure is gone —
  this is the highest-value finding and no other check detects it.
- **a heading that is not one**, or a section label left as a paragraph, so the
  document outline does not match how the page reads.
- **a caption annexed from the article**, or a caption that has become a heading.
- **records that lost their columns** — a list of works where the year, the title and
  the publisher have run together.
- **an ordering that does not read** — a lane folded in at the wrong place, a caption
  before its picture, a footnote in the middle of a section.
- **navigation or footer text left in the article**, or article text deleted with the
  furniture.
- **a repeated construct broken in one place only**, which usually means a rule fired
  on all but one instance.

What is NOT a finding, and reporting it wastes the review:

- **wording, spelling, hyphenation or punctuation of the source.** The source is
  reproduced, never corrected. This is a hard rule.
- **broken pictures and dead links.** No asset tree exists for this corpus; every
  asset reference resolves to nothing and that is expected.
- **stylistic preference** about heading depth, emphasis or separators where the
  document is self-consistent.
- **anything you would phrase as "could be improved".** A finding names a defect.

For each finding give: the severity, a short class name in lower-case dotted form, a
verbatim quote of at most 120 characters locating it in the output, and one sentence
saying what is wrong. Order them most severe first. Report at most {{maxFindings}}.

**An empty list is a good answer** and the expected one for a clean document. Do not
manufacture findings to fill the list.
