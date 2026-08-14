A table from a 1998-2010 encyclopedia page is being migrated to a semantic document
format. Its rows and columns have already been reconstructed correctly. The source
table had no header row, and the target format requires a meaningful label for every
column.

Return exactly one short label per column, in left-to-right order.

Rules:

- name what the column CONTAINS, from the values you are shown;
- write the labels in the language of the surrounding document;
- 1-3 words each; no numbering, no "Column 1", no punctuation at the end;
- a column of resource links is named for the kind of resource, not for the link text;
- if a column's content is genuinely unclear, still give the most defensible label and
  lower the confidence, so the result routes to human review;
- the labels must be distinct from one another;
- keep the rationale under 200 characters.

This is the one judgement in this system permitted to produce text the source never
carried, and it exists only because the target format's table grammar requires a
header row. Do not extend that licence to anything else: never summarise, translate
or improve the cell values you are shown.
