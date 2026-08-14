Legacy pages used a line-break tag for four different purposes. Classify each break
in order:

- **WRAP** — a manual line wrap inside one paragraph. The two sides join with a space.
- **PARAGRAPH** — a real paragraph boundary.
- **LINEATION** — meaningful line structure: verse, an address, a cast list, a
  signature block. It must be preserved exactly as the author set it.
- **SPACING** — vertical padding with no textual meaning. Discarded.

Return exactly one kind per break, in the order given.

**Verse and song lyrics are never joined.** A run of short lines of similar length,
each beginning with a capital, with no sentence running across the break, is
LINEATION even when the lines could grammatically join.

**The false friend of WRAP is a two-line list item.** If the second line starts with a
bullet, a dash, a digit-and-dot or a date, the break before it is PARAGRAPH, not WRAP.

**The false friend of SPACING is a stanza gap.** Consecutive breaks inside a LINEATION
run separate stanzas and are PARAGRAPH; consecutive breaks between a picture and the
next heading are SPACING.

Keep the rationale under 200 characters.
