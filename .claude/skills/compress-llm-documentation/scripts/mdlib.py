"""Shared Markdown analysis primitives for compress-llm-documentation.

Facts only. Nothing in this module decides that a unit is worthless -- that
judgement belongs to the caller. Standard library only, Python 3.9+, so the
skill runs wherever Python does.

Used by analyze.py (baseline + detectors) and verify.py (fidelity gate).
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path


def safe_stdout():
    """Anchors can contain any glyph the source used; consoles often cannot.

    Windows terminals default to a legacy codepage, so printing a box-drawing
    character or a smart quote raises UnicodeEncodeError and kills the run. The
    analysis is worth more than the exact glyph.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # pragma: no cover - non-reconfigurable stream
            pass


# --------------------------------------------------------------------------
# reading
# --------------------------------------------------------------------------


def read_text(path):
    """Decode a file to str with normalised line endings. Never raises on encoding."""
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - latin-1 cannot fail
        text = raw.decode("latin-1", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


# --------------------------------------------------------------------------
# token estimation
# --------------------------------------------------------------------------

_TIKTOKEN = None
_TIKTOKEN_TRIED = False


def _tiktoken():
    global _TIKTOKEN, _TIKTOKEN_TRIED
    if not _TIKTOKEN_TRIED:
        _TIKTOKEN_TRIED = True
        try:  # optional dependency; absence is normal
            import tiktoken  # type: ignore

            _TIKTOKEN = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _TIKTOKEN = None
    return _TIKTOKEN


def count_tokens(text):
    """Return (count, method). method is 'cl100k_base' or 'ESTIMATE'.

    The estimate splits ASCII from non-ASCII because chars/4 underestimates CJK
    several-fold. Report the method everywhere; an estimate is fine for ratios
    and wrong for absolute budgets.
    """
    enc = _tiktoken()
    if enc is not None:
        return len(enc.encode(text)), "cl100k_base"
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    wide = len(text) - ascii_chars
    return int(ascii_chars / 3.9 + wide / 1.5), "ESTIMATE"


# --------------------------------------------------------------------------
# document model
# --------------------------------------------------------------------------

FENCE_OPEN = re.compile(r"^(\s{0,3})(`{3,}|~{3,})\s*([A-Za-z0-9_+#.-]*)\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$")
HTML_COMMENT = re.compile(r"<!--(.*?)-->", re.DOTALL)
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+")

ARTIFACT_PATTERNS = [
    ("skill", re.compile(r"(?i)^skill\.md$")),
    ("root-rules", re.compile(r"(?i)^(claude|agents|claude\.local|gemini|copilot-instructions)\.md$")),
    ("memory", re.compile(r"(?i)^(memory|memory\.md|.*[-_]memory|notes|scratchpad)\.md$")),
    ("rules-file", re.compile(r"(?i)\.(mdc|cursorrules)$")),
]


def classify_artifact(path, text=""):
    """Best-effort artifact type. Drives which budgets and playbook apply."""
    name = Path(path).name
    parent = Path(path).parent.name.lower()
    for kind, pat in ARTIFACT_PATTERNS:
        if pat.match(name):
            return kind
    if parent in ("rules", ".rules") or "/.claude/rules/" in str(path).replace("\\", "/"):
        return "rules-file"
    if parent in ("references", "reference", "docs", "doc"):
        return "reference"
    if text.lstrip().startswith("---") and re.search(r"^name\s*:", text, re.M):
        return "skill"
    return "generic"


class Doc:
    """Parsed Markdown document. Line numbers in the public API are 1-based."""

    def __init__(self, path, text=None, repo_root=None):
        self.path = Path(path)
        self.text = read_text(path) if text is None else text.replace("\r\n", "\n")
        self.repo_root = Path(repo_root) if repo_root else self.path.parent
        self.lines = self.text.split("\n")
        self.artifact = classify_artifact(self.path, self.text)

        self.frontmatter_range = None  # (start, end) 1-based inclusive
        self.frontmatter = {}
        self._parse_frontmatter()

        self.in_fence = [False] * len(self.lines)
        self.fences = []  # dicts: start, end, lang, content
        self._parse_fences()

        self.comments = []  # dicts: start, end, text, block
        self._parse_comments()

        self.headings = []  # dicts: line, level, text
        self._parse_headings()

    # -- parsing ---------------------------------------------------------

    def _parse_frontmatter(self):
        if not self.lines or self.lines[0].strip() != "---":
            return
        for i in range(1, min(len(self.lines), 200)):
            if self.lines[i].strip() in ("---", "..."):
                self.frontmatter_range = (1, i + 1)
                body = self.lines[1:i]
                key = None
                for raw in body:
                    m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", raw)
                    if m:
                        key = m.group(1)
                        self.frontmatter[key] = m.group(2).strip()
                    elif key and raw.startswith((" ", "\t")):
                        self.frontmatter[key] = (self.frontmatter[key] + " " + raw.strip()).strip()
                return

    def _parse_fences(self):
        start = None
        marker = ""
        lang = ""
        fm_end = self.frontmatter_range[1] if self.frontmatter_range else 0
        for idx, line in enumerate(self.lines):
            if idx < fm_end:
                continue
            m = FENCE_OPEN.match(line)
            if start is None:
                if m:
                    start, marker, lang = idx, m.group(2)[0] * 3, m.group(3)
                    self.in_fence[idx] = True
            else:
                self.in_fence[idx] = True
                closing = line.strip()
                if closing.startswith(marker) and set(closing) <= {marker[0]}:
                    self.fences.append(
                        {
                            "start": start + 1,
                            "end": idx + 1,
                            "lang": lang,
                            "content": "\n".join(self.lines[start + 1 : idx]),
                        }
                    )
                    start = None
        if start is not None:  # unterminated fence
            self.fences.append(
                {
                    "start": start + 1,
                    "end": len(self.lines),
                    "lang": lang,
                    "content": "\n".join(self.lines[start + 1 :]),
                    "unterminated": True,
                }
            )

    def _parse_comments(self):
        offsets = [0]
        for line in self.lines:
            offsets.append(offsets[-1] + len(line) + 1)

        def line_of(pos):
            lo, hi = 0, len(offsets) - 1
            while lo < hi - 1:
                mid = (lo + hi) // 2
                if offsets[mid] <= pos:
                    lo = mid
                else:
                    hi = mid
            return lo + 1

        for m in HTML_COMMENT.finditer(self.text):
            s, e = line_of(m.start()), line_of(m.end() - 1)
            before = self.text[: m.start()].rsplit("\n", 1)[-1].strip()
            after = self.text[m.end() :].split("\n", 1)[0].strip()
            self.comments.append(
                {
                    "start": s,
                    "end": e,
                    "text": m.group(1).strip(),
                    "block": before == "" and after == "",
                }
            )

    def _parse_headings(self):
        for idx, line in enumerate(self.lines):
            if self.in_fence[idx]:
                continue
            m = HEADING.match(line)
            if m:
                self.headings.append({"line": idx + 1, "level": len(m.group(1)), "text": m.group(2).strip()})

    # -- derived views ---------------------------------------------------

    def prose_lines(self):
        """(1-based line number, text) for every line outside fences and frontmatter."""
        fm_end = self.frontmatter_range[1] if self.frontmatter_range else 0
        out = []
        for idx, line in enumerate(self.lines):
            if idx < fm_end or self.in_fence[idx]:
                continue
            out.append((idx + 1, line))
        return out

    def heading_at(self, line_no):
        """Nearest enclosing heading text for a line, '' if none."""
        best = ""
        for h in self.headings:
            if h["line"] <= line_no:
                best = h["text"]
            else:
                break
        return best

    def blocks(self):
        """Blank-line separated blocks outside frontmatter. Fences stay whole."""
        fm_end = self.frontmatter_range[1] if self.frontmatter_range else 0
        out, cur, start = [], [], None
        for idx in range(fm_end, len(self.lines)):
            line = self.lines[idx]
            if line.strip() == "" and not self.in_fence[idx]:
                if cur:
                    out.append({"start": start + 1, "end": idx, "text": "\n".join(cur)})
                    cur, start = [], None
                continue
            if start is None:
                start = idx
            cur.append(line)
        if cur:
            out.append({"start": start + 1, "end": len(self.lines), "text": "\n".join(cur)})
        return out

    def stats(self):
        tokens, method = count_tokens(self.text)
        body = self.text
        if self.frontmatter_range:
            body = "\n".join(self.lines[self.frontmatter_range[1] :])
        body_tokens, _ = count_tokens(body)
        fence_lines = sum(1 for f in self.in_fence if f)
        return {
            "bytes": len(self.text.encode("utf-8")),
            "lines": len(self.lines),
            "tokens": tokens,
            "body_tokens": body_tokens,
            "token_method": method,
            "sections": sum(1 for h in self.headings if h["level"] == 2),
            "headings": len(self.headings),
            "max_heading_level": max([h["level"] for h in self.headings], default=0),
            "fences": len(self.fences),
            "fence_lines": fence_lines,
            "comments": len(self.comments),
            "block_comments": sum(1 for c in self.comments if c["block"]),
            "frontmatter": bool(self.frontmatter_range),
            "frontmatter_keys": sorted(self.frontmatter.keys()),
            "artifact": self.artifact,
        }


# --------------------------------------------------------------------------
# anchors -- the invariant set that must survive compression bit-exact
# --------------------------------------------------------------------------

INLINE_CODE = re.compile(r"`([^`\n]{1,300})`")
URL = re.compile(r"https?://[^\s)>\]\"'`]+")
MD_LINK = re.compile(r"\[([^\]\n]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
PATHISH = re.compile(
    r"^[\w@./~-]*[/.][\w@./~-]*\.(?:md|mdc|py|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh|bash|ps1|"
    r"go|rs|rb|java|kt|swift|c|h|cpp|hpp|cs|sql|txt|cfg|conf|ini|lock|env|xml|proto|graphql|tf)$"
)
VERSION = re.compile(r"(?<![\w.])[<>=^~]{0,2}v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?(?![\w.])")
ENVCONST = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")
NUM_UNIT = re.compile(
    r"(?<![\w.])\d+(?:\.\d+)?\s?"
    r"(?:%|ms|s|m|h|d|KB|MB|GB|TB|KiB|MiB|GiB|B|px|x|"
    r"lines?|tokens?|chars?|bytes?|hops?|items?|files?|rows?|columns?|"
    r"days?|weeks?|months?|hours?|minutes?|seconds?|retries|attempts|levels?|deep)\b"
)

ANCHOR_CLASSES = ("code", "fence_line", "url", "path", "version", "const", "number_unit")

# Lines inside fences that are pure structure/noise, not operational content.
_FENCE_SKIP = re.compile(r"^\s*(?:[#/*]|--|<!--|\.\.\.|\}|\{|\)|\]|$)")


def extract_anchors(doc):
    """Return {class: set(str)}. These are the strings a compressor may not alter.

    Deliberately precise rather than exhaustive: a noisy anchor set gets ignored,
    and an ignored check protects nothing.
    """
    out = {c: set() for c in ANCHOR_CLASSES}

    for _, line in doc.prose_lines():
        for m in INLINE_CODE.finditer(line):
            frag = m.group(1).strip()
            if frag:
                out["code"].add(frag)
                if PATHISH.match(frag) or ("/" in frag and " " not in frag):
                    out["path"].add(frag.lstrip("./"))
        for m in URL.finditer(line):
            out["url"].add(m.group(0).rstrip(".,;:"))
        for m in MD_LINK.finditer(line):
            target = m.group(2)
            if not target.startswith("#"):
                if target.startswith(("http://", "https://")):
                    out["url"].add(target)
                else:
                    out["path"].add(target.split("#")[0].lstrip("./"))
        for m in VERSION.finditer(line):
            out["version"].add(m.group(0))
        for m in ENVCONST.finditer(line):
            out["const"].add(m.group(0))
        for m in NUM_UNIT.finditer(line):
            out["number_unit"].add(re.sub(r"\s+", " ", m.group(0)).strip())

    for fence in doc.fences:
        for raw in fence["content"].split("\n"):
            frag = raw.strip()
            if not frag or _FENCE_SKIP.match(frag) or len(frag) < 3:
                continue
            out["fence_line"].add(frag)

    return out


def flatten_anchors(anchor_map):
    """{class: set} -> set of 'class::value' for cheap set arithmetic."""
    return {"%s::%s" % (cls, val) for cls, vals in anchor_map.items() for val in vals}


def anchor_value(flat):
    return flat.split("::", 1)[1]


def anchor_class(flat):
    return flat.split("::", 1)[0]


# --------------------------------------------------------------------------
# directives -- the rules a reader would be expected to obey
# --------------------------------------------------------------------------

MODALITY_ORDER = ("NEVER", "MUST", "HEDGE", "IMPERATIVE")

_NEVER = re.compile(
    r"(?i)\b(never|must\s+not|may\s+not|shall\s+not|do\s+not|don'?t|cannot|can'?t|"
    r"avoid|prohibited|forbidden|refuse|no\s+longer)\b"
)
_MUST = re.compile(
    r"(?i)\b(must|always|required|require[sd]?|shall|mandatory|non-?negotiable|"
    r"ensure|make\s+sure|only\s+ever|is\s+critical)\b"
)
_HEDGE = re.compile(
    r"(?i)\b(should|may\b|might|consider|recommend(?:ed|s)?|typically|generally|usually|"
    r"often|prefer(?:ably|red)?|feel\s+free|if\s+possible|where\s+appropriate|"
    r"it'?s?\s+a\s+good\s+idea|try\s+to|ideally)\b"
)
_IMPERATIVE = re.compile(
    r"(?i)^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?"
    r"(run|use|add|remove|delete|create|write|read|check|verify|keep|set|call|start|stop|"
    r"update|install|build|test|commit|push|pull|open|close|apply|make|include|exclude|copy|"
    r"move|rename|document|log|report|validate|format|lint|deploy|rollback|escalate|ask|"
    r"confirm|snapshot|extract|classify|measure|reorder|relocate|rewrite|prefix|append|"
    r"replace|regenerate|restart|configure|enable|disable|treat|assume|place|store)\b"
)


def classify_modality(line):
    """Strongest modality expressed by a line, or None."""
    if _NEVER.search(line):
        return "NEVER"
    if _MUST.search(line):
        return "MUST"
    if _HEDGE.search(line):
        return "HEDGE"
    if _IMPERATIVE.match(line):
        return "IMPERATIVE"
    return None


def extract_directives(doc):
    """Lines that read as rules, with modality, scope hint, and their anchors.

    Heuristic by construction: use the output as a review signal and a coverage
    checklist, never as a pass/fail count (see references/budgets in the skill).
    """
    out = []
    for line_no, line in doc.prose_lines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ">", "|", "---", "===")):
            continue
        if len(stripped) < 8:
            continue
        modality = classify_modality(stripped)
        if not modality:
            continue
        anchors = sorted(
            {m.group(1).strip() for m in INLINE_CODE.finditer(line)}
            | {m.group(0) for m in URL.finditer(line)}
        )
        out.append(
            {
                "line": line_no,
                "modality": modality,
                "text": stripped[:400],
                "anchors": anchors,
                "heading": doc.heading_at(line_no),
            }
        )
    return out


def modality_census(directives):
    census = {m: 0 for m in MODALITY_ORDER}
    for d in directives:
        census[d["modality"]] += 1
    census["total"] = len(directives)
    return census


# --------------------------------------------------------------------------
# normalisation helpers (duplicate detection, fuzzy directive matching)
# --------------------------------------------------------------------------

_WORD = re.compile(r"[a-z0-9_./-]+")
_STOP = frozenset(
    "a an the this that these those is are was were be been being to of in on for with and or "
    "but if then else when while as at by from it its you your we our they their there here do "
    "does did not no yes so such than very can may will would should could must always never".split()
)


def normalise(text):
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"`+", "", text)
    return text


def _stem(word):
    """Crude singularisation so 'deploy' and 'deploys' match. Good enough for scoring."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def shingle(text, keep_stopwords=False):
    """Content-word set used for near-duplicate and fuzzy matching.

    Edge punctuation is stripped so `manually.` matches `manually`, while internal
    dots and slashes survive so `foo.py` and `src/api` stay single tokens.
    """
    words = [_stem(w.strip("./-_")) for w in _WORD.findall(normalise(text))]
    words = [w for w in words if w]
    if keep_stopwords:
        return set(words)
    return {w for w in words if w not in _STOP and len(w) > 1}


_IDENTISH = re.compile(r"[\w.@/\\:^~<>=+-]{3,}")


def identifier_tokens(text):
    """Tokens that look like identifiers rather than English: paths, flags, versions, symbols.

    Used to tell a re-encoding from an invention. Rewording prose inside a fenced
    block is a legitimate transformation; introducing a command, path or version
    that appears nowhere in the source is not.
    """
    out = set()
    for raw in _IDENTISH.findall(text):
        tok = raw.strip(".,;:!?()[]{}\"'`")
        if len(tok) < 3:
            continue
        if re.search(r"[/\\._:@^~<>=+-]", tok) or re.search(r"\d", tok) or re.search(r"[A-Z]", tok):
            out.add(tok.lower())
    return out


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if not inter:
        return 0.0
    return inter / len(a | b)


def best_match(needle_tokens, haystack):
    """(score, index) of the closest entry in haystack (list of token sets)."""
    best, best_i = 0.0, -1
    for i, tokens in enumerate(haystack):
        score = jaccard(needle_tokens, tokens)
        if score > best:
            best, best_i = score, i
    return best, best_i


def match_directive(source, candidates):
    """(score, index) for 'did this rule survive?'.

    A shared anchor is far stronger evidence than shared vocabulary: "Do not edit
    `src/api/openapi.json` directly" and "Never edit `src/api/openapi.json` by
    hand" have little wording in common and are obviously the same rule. Fall
    back to token overlap only when the source rule carries no anchor.
    """
    src_anchors = {a for a in source.get("anchors", []) if len(a) > 2}
    if src_anchors:
        best, best_i = 0.0, -1
        for i, cand in enumerate(candidates):
            shared = src_anchors & {a for a in cand.get("anchors", []) if len(a) > 2}
            if not shared:
                continue
            score = 0.6 + 0.4 * (len(shared) / len(src_anchors))
            if score > best:
                best, best_i = score, i
        if best_i >= 0:
            return best, best_i
    return best_match(shingle(source["text"]), [shingle(c["text"]) for c in candidates])


# --------------------------------------------------------------------------
# link and reference integrity
# --------------------------------------------------------------------------

PITCH_HINT = re.compile(
    r"(?i)(—|--|:|\bread\b|\bwhen\b|\bcontains?\b|\buse\b|\bsee\b|\bfor\b|\bbefore\b|"
    r"\bafter\b|\bwhile\b|\bif\b|\blist\b|\bfull\b|\bhow\b|\bwhat\b)"
)


def extract_links(doc):
    """Every outward reference with enough context to judge pitch and resolution."""
    links = []
    for line_no, line in doc.prose_lines():
        for m in MD_LINK.finditer(line):
            target = m.group(2)
            links.append(
                {
                    "line": line_no,
                    "kind": "md-link",
                    "text": m.group(1),
                    "target": target,
                    "context": line.strip()[:300],
                }
            )
        for m in INLINE_CODE.finditer(line):
            frag = m.group(1).strip()
            if PATHISH.match(frag):
                links.append(
                    {
                        "line": line_no,
                        "kind": "code-path",
                        "text": frag,
                        "target": frag,
                        "context": line.strip()[:300],
                    }
                )
    return links


READ_CUE = re.compile(
    r"(?i)\b(see|read|refer|reference[sd]?|details?|docs?|documentation|guide|runbook|"
    r"described in|listed in|defined in|consult|full \w+ (?:in|at)|more (?:in|at))\b"
)
_BARE_PATH_LINE = re.compile(r"^\s*(?:[-*+]\s+|\|\s*)")


PLACEHOLDER = re.compile(
    r"(<[^>]*>|\.\.\.|\*|^path/to/|^your/|(^|/)[A-Z][A-Z0-9_]{2,}(/|$)|example\.com)"
)


def is_placeholder(target):
    """`WORKDIR/plan.json` and `path/to/file.md` are illustrations, not broken links."""
    return bool(PLACEHOLDER.search(target))


def is_route(link):
    """A route is a pointer the reader is meant to follow; not every path is one.

    `Never edit src/api/openapi.json` names the object of a rule -- demanding a
    what+when pitch there would force noise into every directive. A table-of-contents
    entry points inside the same file and is required above 100 lines, so it is not a
    route either. A bare code path counts only when the line reads like a referral, or
    when the path is the entire list item.
    """
    if link["kind"] == "md-link":
        return not link["target"].startswith("#")
    # The cue must come from the surrounding sentence, not from the path: every
    # target under references/ or docs/ would otherwise look like a referral.
    rest = link["context"].replace(link["target"], " ")
    if READ_CUE.search(rest):
        return True
    if _BARE_PATH_LINE.match(link["context"]):
        return not re.search(r"[A-Za-z]{2,}", re.sub(r"[`\[\]()|*_-]+", " ", rest))
    return False


def link_has_pitch(link):
    """A route needs what + when on the same line, or it is ignored or slurped whole."""
    ctx = link["context"]
    for token in (link["target"], link["text"]):
        if token:
            ctx = ctx.replace(token, " ")
    ctx = re.sub(r"[\[\]()`|#*_>-]+", " ", ctx)
    words = [w for w in re.findall(r"[A-Za-z]{2,}", ctx)]
    return len(words) >= 4 and bool(PITCH_HINT.search(link["context"]))


def resolve_link(link, doc):
    """(exists, resolved_path_or_None). Anchors, URLs and mailto are 'not checkable'."""
    target = link["target"]
    if target.startswith(("http://", "https://", "mailto:", "#")):
        return None, None
    clean = target.split("#")[0].strip()
    if not clean:
        return None, None
    candidates = [doc.path.parent / clean, doc.repo_root / clean]
    for cand in candidates:
        try:
            if cand.exists():
                return True, str(cand)
        except OSError:
            continue
    return False, clean
