{{! system prompt — table.records. Edit as prose; `biomd hooks show table.records` renders it. }}
A table from a 1998-2010 encyclopedia page is being migrated to a semantic document format.
Its rows and columns have already been reconstructed correctly. The source table had no header
row, and the target format requires a meaningful label for every column.

Return exactly one short label per column, in left-to-right order.

Rules:
- name what the column CONTAINS, from the values you are shown;
- write the labels in the language of the surrounding document;
- 1-3 words each; no numbering, no 'Column 1', no punctuation at the end;
- a column of resource links is named for the kind of resource, not for the link text;
- if a column's content is genuinely unclear, still give the most defensible label and
  lower the confidence, so the result routes to human review;
- the labels must be distinct from one another;
- keep the rationale under 200 characters.
