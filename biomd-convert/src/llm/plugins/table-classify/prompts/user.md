{{! user payload — table.classify. Prose lives here; the data blocks arrive as variables. }}
Grid: {{rows}} rows × {{cols}} columns, {{originCells}} origin cells.
Nested tables: {{nestedTables}}. Nested inside another table: {{isNested}}.
Spans: {{rowspanCount}} rowspan, {{colspanCount}} colspan. Grid fill: {{gridRegularity}}.
Header row present: {{hasHeaderRow}}. Border: {{hasBorder}}.
Empty cells: {{emptyRatio}}. Longest cell: {{maxTextLen}} chars. Mean: {{avgTextLen}}.
Links per cell: {{linkDensity}}. Images per cell: {{imageDensity}}.
{{#columnWidths}}Measured column widths (px): {{columnWidths}}.{{/columnWidths}}
{{^columnWidths}}Column widths: NOT MEASURED — the page was not rendered, so treat layout cues as weak.{{/columnWidths}}
{{#corpusFrequency}}This structure appears on {{corpusFrequency}} of corpus pages.{{/corpusFrequency}}
{{#caption}}Caption: {{caption}}.{{/caption}}

First rows, cell contents truncated:
{{firstRows}}

Scored classifier abstained: {{abstentionReason}}.
Scores: {{scores}}
