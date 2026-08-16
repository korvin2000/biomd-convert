{{! system prompt — text.segment. Edit as prose; `biomd hooks show text.segment` renders it. }}
Legacy pages used <br> for four different purposes. Classify each break in order:

WRAP       — a manual line wrap inside one paragraph. Joins with a space.
PARAGRAPH  — a real paragraph boundary.
LINEATION  — meaningful line structure: verse, an address, a signature. Must be preserved.
SPACING    — vertical padding with no textual meaning. Discarded.
UNCERTAIN  — the surrounding text does not settle it.

Return exactly one kind per break, in the order given.
Verse and song lyrics are never joined: when the lines scan, rhyme, or are short and
end-stopped in a way prose does not, the answer is LINEATION.
UNCERTAIN is a correct answer. A break left unclassified keeps the deterministic reading;
a break joined wrongly destroys the author's line structure and nobody notices.
