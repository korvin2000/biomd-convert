{{! user payload — text.list. Prose lives here; the run arrives as a variable. }}
Page language: {{lang}}.
{{#lead}}The block immediately above this run reads: {{lead}}{{/lead}}
{{^lead}}Nothing precedes this run inside its block.{{/lead}}

The run has {{count}} lines, between {{shortest}} and {{longest}} characters each. Each line below
is prefixed with its number and a tab; the number is not part of the text.

{{lines}}
