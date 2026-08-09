#!/usr/bin/env python3
"""Baseline + mechanical detectors for LLM-facing Markdown.

One invocation replaces a dozen ripgrep passes: it measures the file, extracts
the anchor set that must survive compression, inventories the directives, runs
every detector, and snapshots the originals so verify.py can diff against them
later.

The script produces candidates, evidence and confidence. It never concludes that
a unit is worthless -- regex cannot tell a decorative "note" from a load-bearing
one, and a detector that deletes is a detector nobody can trust.

Usage
    python analyze.py FILE [FILE ...] [--out DIR] [--repo-root PATH] [--json-only]

Writes
    DIR/analysis.json     full detail, machine readable
    DIR/original/<name>   byte copies of the inputs, for verify.py

Exit code is always 0: analysis is not a gate. verify.py is the gate.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mdlib as M  # noqa: E402

# --------------------------------------------------------------------------
# detector definitions
#
# severity: H = usually a real saving or a real risk, M = worth a look,
#           L = cosmetic. Severity ranks attention, it never authorises deletion.
# --------------------------------------------------------------------------

LINE_DETECTORS = [
    (
        "generic-filler",
        "H",
        re.compile(
            r"(?i)(best practices?|clean code|readable code|maintainable code|production[- ]ready|"
            r"be thorough|think step by step|as appropriate|high[- ]quality|industry standard|"
            r"well[- ]documented|follow (?:the )?conventions|use your best judgment|"
            r"it is important to|it's important to|please note that|keep in mind|"
            r"remember to always|make sure to always|carefully consider)"
        ),
        "T1.2 delete: zero surprisal, non-zero cost, induces extra exploration",
    ),
    (
        "lint-leakage",
        "H",
        re.compile(
            r"(?i)\b(indentation|[24] spaces|tabs? (?:vs|over|instead of)|camelCase|snake_case|"
            r"PascalCase|kebab-case|line length|max(?:imum)? line|import order|semicolons?|"
            r"single quotes|double quotes|trailing comma|trailing whitespace|"
            r"prettier|eslint|ruff|black|gofmt|rustfmt|editorconfig|clang-format)\b"
        ),
        "T1.1 candidate: pass E-GATE first, then keep only the invocation + exceptions",
    ),
    (
        "open-enumeration",
        "M",
        re.compile(r"(?i)(\betc\.?(?:\s|$|\))|and so on|among others|as needed|"
                   r"where appropriate|and (?:many )?more\b|the like\b)"),
        "T1.9 close the list: 'etc.' is an instruction to invent",
    ),
    (
        "hedge",
        "M",
        M._HEDGE,
        "T1.8 normalise modality or delete: hedging transfers the priority decision to the model",
    ),
    (
        "mutable-state",
        "H",
        re.compile(
            r"(?i)(\bas of \w+|\bcurrently\b|\bat the moment\b|\bright now\b|\bfor now\b|"
            r"\blatest version\b|\bcoming soon\b|\bwill be (?:added|removed|migrated)\b|"
            r"\bas of \d{4}|\bsince \d{4}-\d{2})"
        ),
        "T1.7 replace the snapshot with a query instruction, or T1.11 if provably stale",
    ),
    (
        "unsupported-control",
        "H",
        re.compile(r"(@include\b|\{\{\s*include|\bload_if\s*:|\bpriority\s*:\s*\d|"
                   r"\btokens\s*:\s*\d|<transclude|!\[\[|\{%\s*include)"),
        "X10 imaginary control syntax: inert at best, misleading at worst",
    ),
    (
        "decoration",
        "L",
        re.compile(r"[─-╿▀-▟]|shields\.io|!\[[^\]]*\]\(https?://img\."),
        "T1.15 box-drawing and badges cost tokens per glyph and carry no instruction",
    ),
    (
        "emoji",
        "L",
        re.compile("[\U0001F300-\U0001FAFF☀-➿⬀-⯿️]"),
        "X6 measured at 2-4+ tokens each with no signal; ASCII keywords do the same job",
    ),
    (
        "smart-punctuation",
        "L",
        re.compile("[‘’“”–—… ]"),
        "T1.15 ASCII equivalents tokenise cheaper and survive copy-paste",
    ),
    (
        "multi-option-menu",
        "M",
        re.compile(r"(?i)(you (?:can|could|may) (?:either|also)|"
                   r"(?:option|approach|alternative) [123abc][:.)]|one (?:option|approach) is)"),
        "Vendor guidance: give one default with an escape hatch, never a menu of equals",
    ),
]


def _iter_prose(doc):
    return doc.prose_lines()


def run_line_detectors(doc):
    findings = {}
    for line_no, line in _iter_prose(doc):
        stripped = line.strip()
        if not stripped:
            continue
        for name, sev, pat, note in LINE_DETECTORS:
            m = pat.search(line)
            if m:
                findings.setdefault(name, {"severity": sev, "note": note, "hits": []})
                findings[name]["hits"].append(
                    {"line": line_no, "match": m.group(0)[:60], "text": stripped[:160]}
                )
    return findings


# --------------------------------------------------------------------------
# structural detectors
# --------------------------------------------------------------------------


def detect_structure(doc, stats):
    out = {}

    deep = [h["line"] for h in doc.headings if h["level"] >= 4]
    if deep:
        out["heading-depth"] = {
            "severity": "M",
            "note": "Headings below H3 fragment retrieval; flatten or split (T2.3)",
            "hits": [{"line": ln} for ln in deep],
        }

    deep_bullets = []
    for line_no, line in doc.prose_lines():
        m = M.LIST_ITEM.match(line)
        if m and len(m.group(1).replace("\t", "    ")) >= 6:
            deep_bullets.append(line_no)
    if deep_bullets:
        out["bullet-nesting"] = {
            "severity": "L",
            "note": "Nesting past 2 levels: flatten or hoist the shared condition (T6.10)",
            "hits": [{"line": ln} for ln in deep_bullets],
        }

    long_paras = []
    for block in doc.blocks():
        first = block["text"].lstrip()
        if first.startswith(("#", "|", "-", "*", ">", "`")) or "\n" not in block["text"]:
            continue
        words = len(re.findall(r"\S+", block["text"]))
        if words > 90:
            long_paras.append({"line": block["start"], "words": words})
    if long_paras:
        out["prose-block"] = {
            "severity": "M",
            "note": "Long narrative block: candidate for T6.1 prose->directive or T6.4 table",
            "hits": long_paras,
        }

    has_toc = any(
        "](#" in line for _, line in doc.prose_lines()[: min(60, len(doc.lines))]
    )
    if stats["lines"] > 100 and not has_toc and doc.artifact in ("reference", "generic"):
        out["missing-toc"] = {
            "severity": "M",
            "note": "Reference over 100 lines needs a ToC so partial reads know the scope [V4]",
            "hits": [{"line": 1}],
        }
    return out


def detect_links(doc):
    out = {}
    blind, broken, unresolved, backslash = [], [], [], []
    for link in M.extract_links(doc):
        route = M.is_route(link)
        if route and not M.link_has_pitch(link):
            blind.append({"line": link["line"], "target": link["target"]})
        exists, resolved = M.resolve_link(link, doc)
        if exists is False and not M.is_placeholder(link["target"]):
            # A route that does not resolve is a defect. A path merely mentioned in a
            # rule is a staleness hint -- worth reporting, not worth blocking on.
            (broken if route else unresolved).append(
                {"line": link["line"], "target": link["target"]}
            )
        if "\\" in link["target"] and not link["target"].startswith("http"):
            backslash.append({"line": link["line"], "target": link["target"]})
    if blind:
        out["blind-reference"] = {
            "severity": "H",
            "note": "T1.5 every route needs path - what - when; a bare path is ignored or slurped whole",
            "hits": blind,
        }
    if broken:
        out["broken-reference"] = {
            "severity": "H",
            "note": "Route points at nothing. Fix or delete before compressing anything else",
            "hits": broken,
        }
    if unresolved:
        out["unresolved-path"] = {
            "severity": "M",
            "note": "A rule names a path that does not exist here. Stale rule, or a path outside "
                    "this checkout - confirm which before acting on the rule",
            "hits": unresolved,
        }
    if backslash:
        out["backslash-path"] = {
            "severity": "M",
            "note": "Forward slashes always, including on Windows [V4]",
            "hits": backslash,
        }
    return out


def detect_duplicates(docs, threshold=0.72, min_tokens=8):
    """Near-duplicate blocks within and across the input files.

    Textual similarity is a candidate detector only. Two passages are duplicates
    only if they agree on scope, modality, exceptions and anchors too -- that is
    the D-GATE, and it needs a reader.
    """
    entries = []
    for doc in docs:
        for block in doc.blocks():
            text = block["text"]
            if text.lstrip().startswith("#"):
                continue
            tokens = M.shingle(text)
            if len(tokens) < min_tokens:
                continue
            entries.append(
                {
                    "file": doc.path.name,
                    "start": block["start"],
                    "end": block["end"],
                    "tokens": tokens,
                    "preview": re.sub(r"\s+", " ", text)[:120],
                }
            )
    pairs = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            score = M.jaccard(entries[i]["tokens"], entries[j]["tokens"])
            if score >= threshold:
                pairs.append(
                    {
                        "score": round(score, 3),
                        "a": {k: entries[i][k] for k in ("file", "start", "end", "preview")},
                        "b": {k: entries[j][k] for k in ("file", "start", "end", "preview")},
                    }
                )
    pairs.sort(key=lambda p: -p["score"])
    return pairs[:40]


def detect_conflicts(docs):
    """Directives that share an anchor but disagree on modality.

    Reported, never resolved: published automated conflict detection runs at
    modest precision, and a polished document with the wrong winner is worse
    than a verbose one that exposes the conflict.
    """
    by_anchor = {}
    for doc in docs:
        for d in M.extract_directives(doc):
            for anchor in d["anchors"]:
                if len(anchor) < 3:
                    continue
                by_anchor.setdefault(anchor, []).append((doc.path.name, d))
    conflicts = []
    for anchor, items in by_anchor.items():
        modalities = {d["modality"] for _, d in items}
        if "NEVER" in modalities and modalities & {"MUST", "IMPERATIVE"}:
            conflicts.append(
                {
                    "anchor": anchor,
                    "statements": [
                        {"file": f, "line": d["line"], "modality": d["modality"], "text": d["text"][:160]}
                        for f, d in items
                    ],
                }
            )
    return conflicts[:20]


# --------------------------------------------------------------------------
# budgets -- review triggers, never success conditions
# --------------------------------------------------------------------------


def check_budgets(doc, stats):
    """Crossing a threshold means 'look at this file', not 'this file is wrong'.

    Only limits marked [V] are platform-verified; the rest are corpus folklore
    reported with their provenance so a reader can discount them.
    """
    flags = []
    art = doc.artifact

    def flag(level, msg, tag):
        flags.append({"level": level, "message": msg, "provenance": tag})

    if art in ("root-rules", "rules-file"):
        if stats["lines"] > 200:
            flag("HIGH", "%d lines: over the 200-line target; longer files reduce adherence"
                 % stats["lines"], "[V3] Claude Code memory docs")
        elif stats["lines"] > 150:
            flag("REVIEW", "%d lines: past the 150-line review trigger" % stats["lines"], "[C] corpus")
        if stats["sections"] > 10:
            flag("REVIEW", "%d H2 sections (observed median ~10)" % stats["sections"], "[C] corpus")

    if art == "memory":
        if stats["lines"] > 200 or stats["bytes"] > 25 * 1024:
            flag("HIGH", "memory files load only the first 200 lines / 25 KB; content past that "
                 "is NOT loaded (currently %d lines, %.1f KB)" % (stats["lines"], stats["bytes"] / 1024),
                 "[V3] hard limit")

    if art == "skill":
        if stats["lines"] > 500:
            flag("HIGH", "SKILL.md body %d lines: over the 500-line guidance" % stats["lines"],
                 "[V4] Agent Skills best practices")
        desc = doc.frontmatter.get("description", "")
        name = doc.frontmatter.get("name", "")
        if not desc:
            flag("HIGH", "frontmatter has no description: the skill cannot be routed to", "[V4] hard limit")
        elif len(desc) > 1024:
            flag("HIGH", "description %d chars: max is 1024" % len(desc), "[V4] hard limit")
        elif len(desc) < 40 or len(desc.split()) < 6:
            # A present-but-thin description is functionally close to a missing one: it is
            # the single most common cause of a skill that exists but never triggers, and
            # that failure is silent -- nothing errors, the skill just never gets consulted.
            flag("HIGH", "description %d chars / %d words: too thin to carry both what the "
                 "skill does and when to use it" % (len(desc), len(desc.split())),
                 "[C] skill-creator triggering guidance")
        if name and (len(name) > 64 or not re.fullmatch(r"[a-z0-9-]+", name)):
            flag("HIGH", "name must be <=64 chars of [a-z0-9-]; found %r" % name[:80], "[V4] hard limit")

    if art == "reference" and stats["lines"] > 100:
        head = "\n".join(doc.lines[: min(60, len(doc.lines))])
        if "](#" not in head:
            flag("REVIEW", "reference over 100 lines with no ToC", "[V4] guidance")

    if stats["max_heading_level"] > 3:
        flag("REVIEW", "heading depth H%d" % stats["max_heading_level"], "[C] corpus")
    return flags


# --------------------------------------------------------------------------
# report assembly
# --------------------------------------------------------------------------


def analyse_file(path, repo_root):
    doc = M.Doc(path, repo_root=repo_root)
    stats = doc.stats()
    anchors = M.extract_anchors(doc)
    directives = M.extract_directives(doc)

    findings = {}
    findings.update(run_line_detectors(doc))
    findings.update(detect_structure(doc, stats))
    findings.update(detect_links(doc))

    return doc, {
        "file": str(path),
        "name": Path(path).name,
        "artifact": doc.artifact,
        "stats": stats,
        "budget_flags": check_budgets(doc, stats),
        "anchors": {cls: sorted(vals) for cls, vals in anchors.items()},
        "anchor_counts": {cls: len(vals) for cls, vals in anchors.items()},
        "anchor_total": sum(len(v) for v in anchors.values()),
        "directives": directives,
        "modality": M.modality_census(directives),
        "headings": doc.headings,
        "fences": [{"start": f["start"], "end": f["end"], "lang": f["lang"]} for f in doc.fences],
        "comments": doc.comments,
        "findings": findings,
    }


SEV_ORDER = {"H": 0, "M": 1, "L": 2}


def digest(report):
    """Compact human/agent-readable summary. Script output costs context: keep it tight."""
    out = []
    files = report["files"]
    for f in files:
        s = f["stats"]
        est = "" if s["token_method"] != "ESTIMATE" else " EST"
        out.append("== %s  [%s]" % (f["name"], f["artifact"]))
        out.append(
            "   %s B | %d lines | ~%d tok%s (%s) | %d H2 | Hmax %d | %d fences"
            % (format(s["bytes"], ","), s["lines"], s["tokens"], est, s["token_method"],
               s["sections"], s["max_heading_level"], s["fences"])
        )
        mod = f["modality"]
        out.append(
            "   directives %d  (NEVER %d / MUST %d / hedge %d / imperative %d)   anchors %d"
            % (mod["total"], mod["NEVER"], mod["MUST"], mod["HEDGE"], mod["IMPERATIVE"],
               f["anchor_total"])
        )
        for bf in f["budget_flags"]:
            out.append("   ! BUDGET %-6s %s  %s" % (bf["level"], bf["message"], bf["provenance"]))
        if not f["budget_flags"]:
            out.append("   . budgets ok")

        items = sorted(
            f["findings"].items(),
            key=lambda kv: (SEV_ORDER.get(kv[1]["severity"], 3), -len(kv[1]["hits"])),
        )
        if items:
            out.append("   FINDINGS")
        for name, data in items:
            lines = [str(h["line"]) for h in data["hits"][:6]]
            more = "" if len(data["hits"]) <= 6 else ",+%d" % (len(data["hits"]) - 6)
            out.append(
                "   %s %-20s %3d  L%s%s"
                % (data["severity"], name, len(data["hits"]), ",".join(lines), more)
            )
            out.append("       -> %s" % data["note"])
        out.append("")

    dupes = report["duplicates"]
    if dupes:
        out.append("DUPLICATE CANDIDATES (D-GATE before merging any of these)")
        for p in dupes[:8]:
            out.append(
                "   %.2f  %s:%d-%d  ~  %s:%d-%d"
                % (p["score"], p["a"]["file"], p["a"]["start"], p["a"]["end"],
                   p["b"]["file"], p["b"]["start"], p["b"]["end"])
            )
            out.append("        %s" % p["a"]["preview"][:100])
        if len(dupes) > 8:
            out.append("   ... %d more in analysis.json" % (len(dupes) - 8))
        out.append("")

    conflicts = report["conflicts"]
    if conflicts:
        out.append("CONFLICT CANDIDATES (report to the user; never auto-resolve)")
        for c in conflicts[:6]:
            out.append("   anchor %s" % c["anchor"][:60])
            for st in c["statements"][:4]:
                out.append("      %s:%d %-9s %s" % (st["file"], st["line"], st["modality"], st["text"][:90]))
        out.append("")

    t = report["totals"]
    out.append(
        "TOTAL  %d file(s) | %s B | %d lines | ~%d tok (%s) | %d directives | %d anchors"
        % (t["files"], format(t["bytes"], ","), t["lines"], t["tokens"], t["token_method"],
           t["directives"], t["anchors"])
    )
    out.append("originals snapshot: %s" % report["original_dir"])
    out.append("full detail:        %s" % report["json_path"])
    out.append("")
    if t["fast_path"]:
        out.append(
            "FAST PATH: 0 H-severity findings, 0 HIGH budget flags, 0 conflicts. Skip the full "
            "unit-by-unit ledger (stage 3) -- confirm there is nothing worth a human decision "
            "(check any M/L findings and duplicate candidates above), then go straight to a short "
            "stage-9 report. Do not edit the file just to demonstrate effort."
        )
    else:
        out.append(
            "%d H-severity finding(s), %d HIGH budget flag(s), %d conflict(s) -- walk the full "
            "ledger at stage 3." % (t["h_severity_findings"], t["high_budget_flags"], len(report["conflicts"]))
        )
    return "\n".join(out)


def main(argv=None):
    M.safe_stdout()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="Markdown files to analyse")
    ap.add_argument("--out", help="work directory (default: a fresh temp dir, path is printed)")
    ap.add_argument("--repo-root", help="root for resolving relative links (default: cwd)")
    ap.add_argument("--json-only", action="store_true", help="suppress the stdout digest")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else Path.cwd()
    out_dir = Path(args.out) if args.out else Path(tempfile.gettempdir()) / (
        "compress-llm-docs-%s" % time.strftime("%Y%m%d-%H%M%S")
    )
    original_dir = out_dir / "original"
    original_dir.mkdir(parents=True, exist_ok=True)

    docs, file_reports = [], []
    for raw in args.files:
        path = Path(raw)
        if not path.exists():
            print("SKIP (not found): %s" % path, file=sys.stderr)
            continue
        doc, rep = analyse_file(path, repo_root)
        docs.append(doc)
        file_reports.append(rep)
        shutil.copy2(path, original_dir / path.name)

    if not docs:
        print("No readable input files.", file=sys.stderr)
        return 0

    conflicts = detect_conflicts(docs)

    h_hits = sum(
        len(data["hits"])
        for f in file_reports
        for data in f["findings"].values()
        if data["severity"] == "H"
    )
    high_budget = sum(
        1 for f in file_reports for bf in f["budget_flags"] if bf["level"] == "HIGH"
    )
    # Fast path: nothing an H-severity detector or a hard platform limit flagged, and no
    # reported conflict. This is a green light to skip straight to a short report at stage
    # 3 -- not a promise the file is perfect, just that the expensive full ledger is
    # unlikely to earn its tokens. M/L findings and duplicate candidates still deserve a
    # human glance if the level is medium/max, but they do not block the fast path.
    fast_path = h_hits == 0 and high_budget == 0 and not conflicts

    totals = {
        "files": len(file_reports),
        "bytes": sum(f["stats"]["bytes"] for f in file_reports),
        "lines": sum(f["stats"]["lines"] for f in file_reports),
        "tokens": sum(f["stats"]["tokens"] for f in file_reports),
        "token_method": file_reports[0]["stats"]["token_method"],
        "directives": sum(f["modality"]["total"] for f in file_reports),
        "anchors": sum(f["anchor_total"] for f in file_reports),
        "h_severity_findings": h_hits,
        "high_budget_flags": high_budget,
        "fast_path": fast_path,
    }

    report = {
        "tool": "compress-llm-documentation/analyze.py",
        "version": 1,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "repo_root": str(repo_root),
        "original_dir": str(original_dir),
        "json_path": str(out_dir / "analysis.json"),
        "files": file_reports,
        "duplicates": detect_duplicates(docs),
        "conflicts": conflicts,
        "totals": totals,
    }

    (out_dir / "analysis.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    if not args.json_only:
        print(digest(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
