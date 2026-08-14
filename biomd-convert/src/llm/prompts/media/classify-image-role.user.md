Document language: {{lang}}.
Declared size: {{size}}.
{{#alt}}
Alternative text the author wrote: {{.}}.
{{/alt}}
{{^alt}}
The image carries no alternative text.
{{/alt}}
Inside a link: {{inLink}}.
{{#linkTarget}}
The link points at: {{.}}.
{{/linkTarget}}
Occurrences of this same asset on this page: {{occurrences}}.
{{#inRunningProse}}
It stands inside a sentence, after {{.}} characters of prose.
{{/inRunningProse}}

Its immediate surroundings, in document order:
{{surroundings}}
