Document language: {{lang}}.

The line in question, exactly as the page carries it:
{{line}}

How it is set: {{typography}}.

{{#openHeading}}
The heading currently open is "{{.}}" at level {{openDepth}}.
{{/openHeading}}
{{^openHeading}}
No heading is open above this line.
{{/openHeading}}

The block immediately before it:
{{before}}

The block immediately after it:
{{after}}

Other lines on this page set the same way, which the compiler could not place either:
{{siblings}}
