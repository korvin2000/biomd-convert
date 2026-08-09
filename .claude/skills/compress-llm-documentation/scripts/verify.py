#!/usr/bin/env python3
"""Fidelity gate for compressed LLM-facing Markdown.

Compression without verification is vandalism. This script is the cheap,
mechanical half of the check ladder: it proves that every command, path,
version, identifier and URL survived, that nothing was invented, that routes
still resolve, and that no prohibition quietly evaporated.

It cannot prove that a preserved command still sits under the right condition.
That is what the semantic probes in references/validation.md are for.

Usage
    python verify.py --work DIR [--after FILE ...] [--plan plan.json] [--json OUT]
    python verify.py --idempotency FIRST_RUN.md SECOND_RUN.md

--work DIR is the directory analyze.py wrote (it holds original/ and analysis.json).
--after defaults to the same paths that were analysed, i.e. in-place edits.

Plan file (optional, JSON) authorises deliberate changes:
    {
      "mode": "medium",
      "new_files": ["references/testing.md"],
      "released_anchors": ["`npm run legacy-build`"],
      "released_reason": {"`npm run legacy-build`": "removed 2025-08, proven stale"}
    }

--emit-plan OUT.json skips the gate and instead scaffolds a plan: it diffs the anchors that
are already lost between before/after (a draft compression already written to --after) and
writes them into released_anchors with a placeholder reason, merging with --plan if one was
given. Hand-copying every dropped command string into plan.json is busywork a script should
do; the model's job is to supply the *reason*, not retype the anchor. Re-run without
--emit-plan (pointing --plan at the same file) once the reasons are filled in for the real gate.

Exit codes
    0  PASS (possibly with warnings), or --emit-plan / --idempotency completed
    1  FAIL -- at least one fidelity check failed
    2  usage error
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mdlib as M  # noqa: E402

FAIL, WARN, INFO = "FAIL", "WARN", "INFO"


class Result:
    def __init__(self):
        self.checks = []

    def add(self, name, status, detail, items=None):
        self.checks.append(
            {"check": name, "status": status, "detail": detail, "items": items or []}
        )

    @property
    def failed(self):
        return any(c["status"] == FAIL for c in self.checks)

    @property
    def warned(self):
        return any(c["status"] == WARN for c in self.checks)


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------


def load_side(paths, repo_root):
    docs = [M.Doc(p, repo_root=repo_root) for p in paths if Path(p).exists()]
    anchors = set()
    directives = []
    text = []
    for d in docs:
        anchors |= M.flatten_anchors(M.extract_anchors(d))
        directives.extend(dict(x, file=d.path.name) for x in M.extract_directives(d))
        text.append(d.text)
    return docs, anchors, directives, M.normalise("\n".join(text))


def load_plan(path):
    if not path:
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("plan must be a JSON object")
    return data


def emit_plan(before, after, after_text, plan, out_path):
    """Scaffold released_anchors from anchors already missing in a draft --after.

    Only genuine losses need a reason: a string that survives as plain prose (de-emphasised,
    not deleted) is left out, same rule check_anchors uses for anchor-de-emphasis. Anchors the
    plan already covers keep their existing reason untouched -- this is safe to re-run as a
    draft evolves.
    """
    released = set(plan.get("released_anchors") or [])
    reasons = dict(plan.get("released_reason") or {})
    added = []
    for flat in sorted(before - after):
        cls, val = M.anchor_class(flat), M.anchor_value(flat)
        if val in released or flat in released:
            continue
        if M.normalise(val) and M.normalise(val) in after_text:
            continue
        released.add(val)
        reasons.setdefault(val, "<GAP: state why this was released>")
        added.append(val)

    scaffold = {
        "mode": plan.get("mode", "<GAP: safe|medium|max>"),
        "new_files": plan.get("new_files", []),
        "released_anchors": sorted(released),
        "released_reason": reasons,
    }
    Path(out_path).write_text(json.dumps(scaffold, indent=1), encoding="utf-8")

    if added:
        print("plan scaffold: %d newly-lost anchor(s) added to %s with a GAP placeholder reason."
              % (len(added), out_path))
        print("Fill in released_reason for each real deletion, then run verify.py --plan %s "
              "(without --emit-plan) for the actual gate." % out_path)
    else:
        print("plan scaffold: no new unapproved losses vs. the current draft -- %s already "
              "covers this diff." % out_path)
    return 0


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------


def check_anchors(before, after, before_text, after_text, plan, res):
    """Bidirectional and non-negotiable.

    Losses must be approved; additions are hallucinations unless the plan created
    the path. Two deliberate softenings keep the signal usable: a string that
    merely stopped being formatted as code is a de-emphasis, not a loss, and a
    string that gained backticks is a promotion, not an invention.
    """
    released = set(plan.get("released_anchors") or [])
    reasons = plan.get("released_reason") or {}
    new_files = {p.replace("\\", "/").lstrip("./") for p in (plan.get("new_files") or [])}

    lost_hard, lost_soft, approved = [], [], []
    for flat in sorted(before - after):
        cls, val = M.anchor_class(flat), M.anchor_value(flat)
        if val in released or flat in released:
            approved.append({"anchor": val, "class": cls, "reason": reasons.get(val, "released by plan")})
        elif M.normalise(val) and M.normalise(val) in after_text:
            lost_soft.append({"anchor": val, "class": cls})
        else:
            lost_hard.append({"anchor": val, "class": cls})

    before_idents = M.identifier_tokens(before_text)
    invented, promoted, reencoded, allowed_new = [], [], [], []
    for flat in sorted(after - before):
        cls, val = M.anchor_class(flat), M.anchor_value(flat)
        norm = val.replace("\\", "/").lstrip("./")
        if cls == "path" and any(norm == nf or norm.startswith(nf) or nf.startswith(norm)
                                 for nf in new_files):
            allowed_new.append({"anchor": val, "class": cls})
        elif M.normalise(val) and M.normalise(val) in before_text:
            promoted.append({"anchor": val, "class": cls})
        elif cls == "fence_line" and M.identifier_tokens(val) <= before_idents:
            # Converting prose into a guard ladder or an edge list creates fence lines
            # that never existed as literals. The line introduces no identifier the
            # source lacks, so this is a re-encoding to review, not a fabricated command.
            reencoded.append({"anchor": val, "class": cls})
        else:
            invented.append({"anchor": val, "class": cls})

    if lost_hard:
        res.add("anchor-loss", FAIL,
                "%d anchor(s) vanished with no approval. Restore them, or list them in the plan's "
                "released_anchors with a reason." % len(lost_hard), lost_hard[:60])
    else:
        res.add("anchor-loss", INFO, "0 unapproved losses (%d approved by plan)" % len(approved),
                approved[:30])

    if invented:
        res.add("anchor-invention", FAIL,
                "%d anchor(s) appear in the output but nowhere in the source. A compressor may not "
                "add facts; write <!-- GAP: ... --> instead." % len(invented), invented[:60])
    else:
        res.add("anchor-invention", INFO, "0 invented anchors", [])

    if lost_soft:
        res.add("anchor-de-emphasis", WARN,
                "%d string(s) lost their code formatting but survive as plain text. Confirm each is "
                "still unambiguous." % len(lost_soft), lost_soft[:30])
    if reencoded:
        res.add("anchor-reencoded", WARN,
                "%d fenced line(s) are new text built entirely from source vocabulary — typical of "
                "prose→pseudocode. Check each one still says what the prose said." % len(reencoded),
                reencoded[:20])
    if promoted:
        res.add("anchor-promotion", INFO,
                "%d string(s) gained code formatting (present in the source as prose)" % len(promoted),
                promoted[:20])
    if allowed_new:
        res.add("new-routes", INFO, "%d new path(s) authorised by the plan" % len(allowed_new),
                allowed_new[:20])


def line_units(docs):
    """Every substantive line of the output, as match targets.

    Survival is asked of the whole document, not just of lines the extractor
    happened to classify as directives: a rule often survives as a declarative
    invariant ("`x.json` is generated") that no imperative pattern matches.
    """
    units = []
    for d in docs:
        for ln, line in d.prose_lines():
            s = line.strip().lstrip("-*+ ").strip()
            if len(s) < 8:
                continue
            units.append(
                {
                    "file": d.path.name,
                    "line": ln,
                    "text": s,
                    "anchors": sorted({m.group(1).strip() for m in M.INLINE_CODE.finditer(line)}),
                    "modality": M.classify_modality(s),
                }
            )
        for f in d.fences:
            for i, raw in enumerate(f["content"].split("\n")):
                s = raw.strip()
                if len(s) < 8:
                    continue
                units.append(
                    {
                        "file": d.path.name,
                        "line": f["start"] + 1 + i,
                        "text": s,
                        "anchors": [],
                        "modality": M.classify_modality(s),
                    }
                )
    return units


def check_prohibitions(before_dirs, after_dirs, res):
    """A NEVER-rule that cannot be found in the output is the most expensive loss there is."""
    lost, weakened = [], []
    for d in before_dirs:
        if d["modality"] != "NEVER":
            continue
        score, idx = M.match_directive(d, after_dirs)
        if score < 0.45:
            lost.append({"line": d["line"], "file": d["file"], "text": d["text"][:140], "best": round(score, 2)})
        elif after_dirs[idx]["modality"] != "NEVER":
            weakened.append(
                {
                    "line": d["line"],
                    "file": d["file"],
                    "text": d["text"][:120],
                    "became": after_dirs[idx]["modality"],
                    "after_text": after_dirs[idx]["text"][:120],
                }
            )
    if lost:
        res.add("prohibition-survival", WARN,
                "%d prohibition(s) have no close match in the output. Each is either an approved "
                "merge or a silent deletion -- say which in the report." % len(lost), lost[:20])
    else:
        res.add("prohibition-survival", INFO, "every NEVER-rule has a match in the output", [])
    if weakened:
        res.add("modality-weakening", WARN,
                "%d prohibition(s) survive with weaker modality. Positive replacement is allowed only "
                "when it fully specifies the safe alternative." % len(weakened), weakened[:20])


def check_directive_coverage(before_dirs, after_dirs, res):
    unmatched = []
    for d in before_dirs:
        score, _ = M.match_directive(d, after_dirs)
        if score < 0.4:
            unmatched.append(
                {"line": d["line"], "file": d["file"], "modality": d["modality"], "text": d["text"][:140]}
            )
    strong = [u for u in unmatched if u["modality"] in ("NEVER", "MUST")]
    res.add(
        "directive-coverage",
        INFO,
        "%d of %d source directives have no close match in the output (%d of them MUST/NEVER). "
        "Deleting a directive is legitimate -- account for each one in the report."
        % (len(unmatched), len(before_dirs), len(strong)),
        (strong + [u for u in unmatched if u not in strong])[:40],
    )


def check_routes(after_docs, before_docs, res):
    """A route the compressor broke is a failure; one it inherited is a finding."""
    inherited = set()
    for doc in before_docs:
        for link in M.extract_links(doc):
            if M.resolve_link(link, doc)[0] is False:
                inherited.add(link["target"])

    broken, stale, blind = [], [], []
    for doc in after_docs:
        for link in M.extract_links(doc):
            if not M.is_route(link) or M.is_placeholder(link["target"]):
                continue
            exists, _ = M.resolve_link(link, doc)
            if exists is False:
                bucket = stale if link["target"] in inherited else broken
                bucket.append({"file": doc.path.name, "line": link["line"], "target": link["target"]})
            if not M.link_has_pitch(link):
                blind.append({"file": doc.path.name, "line": link["line"], "target": link["target"]})
    if broken:
        res.add("route-resolution", FAIL,
                "%d route(s) introduced by this pass point at a path that does not exist. "
                "Relocation without availability is deletion." % len(broken), broken[:30])
    else:
        res.add("route-resolution", INFO, "every route this pass created resolves", [])
    if stale:
        res.add("route-inherited-broken", WARN,
                "%d route(s) were already broken in the source. Not caused here, but do not ship "
                "them silently -- fix or report." % len(stale), stale[:20])
    if blind:
        res.add("route-pitch", WARN if len(blind) < 3 else FAIL,
                "%d route(s) carry no what+when pitch. A bare path is either ignored or eagerly "
                "slurped; both are failures." % len(blind), blind[:30])
    else:
        res.add("route-pitch", INFO, "every route carries a pitch", [])


def check_reference_depth(after_docs, entry_names, res):
    """References must be one level deep: nested chains get head -100 previewed."""
    entry = {n.lower() for n in entry_names}
    deep = []
    for doc in after_docs:
        if doc.path.name.lower() in entry:
            continue
        for link in M.extract_links(doc):
            t = link["target"]
            if t.endswith(".md") and not t.startswith(("http://", "https://", "#")):
                if Path(t).name.lower() not in entry:
                    deep.append({"file": doc.path.name, "line": link["line"], "target": t})
    if deep:
        res.add("reference-depth", WARN,
                "%d link(s) chain from one reference to another. Flatten to one level from the "
                "entry file." % len(deep), deep[:20])
    else:
        res.add("reference-depth", INFO, "reference depth is 1", [])


UNSUPPORTED = re.compile(r"(@include\b|\{\{\s*include|\bload_if\s*:|\bpriority\s*:\s*\d|"
                         r"\btokens\s*:\s*\d|<transclude|!\[\[|\{%\s*include)")


def check_unsupported(after_docs, res):
    hits = []
    for doc in after_docs:
        for line_no, line in doc.prose_lines():
            m = UNSUPPORTED.search(line)
            if m:
                hits.append({"file": doc.path.name, "line": line_no, "match": m.group(0)})
    if hits:
        res.add("unsupported-control", FAIL,
                "%d imaginary control directive(s). Unsupported syntax presented as functional is "
                "worse than prose." % len(hits), hits[:20])
    else:
        res.add("unsupported-control", INFO, "no unsupported control syntax", [])


def check_structure(after_docs, res):
    problems = []
    for doc in after_docs:
        for f in doc.fences:
            if f.get("unterminated"):
                problems.append({"file": doc.path.name, "line": f["start"], "issue": "unterminated code fence"})
        if doc.lines and doc.lines[0].strip() == "---" and not doc.frontmatter_range:
            problems.append({"file": doc.path.name, "line": 1, "issue": "frontmatter never closes"})
    if problems:
        res.add("structure", FAIL, "%d structural defect(s)" % len(problems), problems)
    else:
        res.add("structure", INFO, "markdown structure parses", [])


def check_budgets(after_docs, res):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from analyze import check_budgets as budgets  # local import keeps mdlib the only hard dep

    flags = []
    for doc in after_docs:
        for f in budgets(doc, doc.stats()):
            flags.append(dict(f, file=doc.path.name))
    high = [f for f in flags if f["level"] == "HIGH"]
    if high:
        res.add("budgets", WARN, "%d hard platform limit(s) still exceeded after compression" % len(high), flags)
    elif flags:
        res.add("budgets", INFO, "%d review trigger(s), no hard limits exceeded" % len(flags), flags)
    else:
        res.add("budgets", INFO, "within every budget", [])


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

RUBRIC_ORDER = [
    "anchor-loss",
    "anchor-invention",
    "prohibition-survival",
    "modality-weakening",
    "route-resolution",
    "route-inherited-broken",
    "route-pitch",
    "unsupported-control",
    "structure",
    "reference-depth",
    "anchor-reencoded",
    "anchor-de-emphasis",
    "anchor-promotion",
    "new-routes",
    "directive-coverage",
    "budgets",
]
MARK = {FAIL: "FAIL", WARN: "warn", INFO: "ok  "}


def render(res, sizes):
    out = ["FIDELITY REPORT", ""]
    order = {n: i for i, n in enumerate(RUBRIC_ORDER)}
    for c in sorted(res.checks, key=lambda c: order.get(c["check"], 99)):
        out.append("  [%s] %-22s %s" % (MARK[c["status"]], c["check"], c["detail"]))
        for item in c["items"][:8]:
            bits = [str(v) for k, v in item.items() if k in ("file", "line", "anchor", "target", "match", "class")]
            txt = item.get("text") or item.get("issue") or item.get("reason") or ""
            out.append("        - %s %s" % (" ".join(bits), txt[:100]))
        if len(c["items"]) > 8:
            out.append("        ... %d more (see --json output)" % (len(c["items"]) - 8))
    out.append("")
    b, a = sizes["before"], sizes["after"]
    for key, label in (("bytes", "bytes"), ("lines", "lines"), ("tokens", "tokens")):
        delta = a[key] - b[key]
        pct = (delta / b[key] * 100) if b[key] else 0.0
        out.append("  %-7s %9s -> %9s   %+.1f%%" % (label, format(b[key], ","), format(a[key], ","), pct))
    out.append("  method  %s%s" % (sizes["method"], "  (ratios fine, absolute budgets not)"
                                   if sizes["method"] == "ESTIMATE" else ""))
    out.append("")
    verdict = "FAIL" if res.failed else ("PASS with warnings" if res.warned else "PASS")
    out.append("  VERDICT: %s" % verdict)
    if res.failed:
        out.append("  Fidelity gates failed. Do not ship: restore the losses or record the approval,")
        out.append("  then re-run. Compression ratio is never a reason to accept a FAIL.")
    return "\n".join(out)


def side_sizes(docs):
    tot = {"bytes": 0, "lines": 0, "tokens": 0}
    method = "ESTIMATE"
    for d in docs:
        s = d.stats()
        tot["bytes"] += s["bytes"]
        tot["lines"] += s["lines"]
        tot["tokens"] += s["tokens"]
        method = s["token_method"]
    return tot, method


# --------------------------------------------------------------------------


def main(argv=None):
    M.safe_stdout()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", help="directory produced by analyze.py")
    ap.add_argument("--after", nargs="*", help="compressed files (default: the analysed paths)")
    ap.add_argument("--before", nargs="*", help="explicit originals, instead of --work")
    ap.add_argument("--plan", help="JSON file authorising deliberate changes")
    ap.add_argument("--emit-plan", help="scaffold released_anchors from the current diff into "
                    "this path instead of gating; fill in reasons and re-run for real")
    ap.add_argument("--repo-root", help="root for resolving relative links (default: cwd)")
    ap.add_argument("--json", dest="json_out", help="write the full result here")
    ap.add_argument("--idempotency", nargs=2, metavar=("FIRST", "SECOND"),
                    help="byte-compare two runs and exit")
    args = ap.parse_args(argv)

    if args.idempotency:
        a, b = (M.read_text(p) for p in args.idempotency)
        same = a == b
        print("idempotency: %s" % ("PASS - second run is byte-identical" if same else
                                   "FAIL - the second run kept changing the file"))
        if not same:
            print("  Continued shrinkage means generational loss, unstable classification, or ratio")
            print("  chasing. A non-idempotent pass also thrashes the prompt cache on every run.")
        return 0 if same else 1

    repo_root = Path(args.repo_root).resolve() if args.repo_root else Path.cwd()

    before_paths, analysed = [], []
    if args.work:
        work = Path(args.work)
        orig = work / "original"
        if not orig.is_dir():
            print("No original/ snapshot in %s -- run analyze.py first." % work, file=sys.stderr)
            return 2
        before_paths = sorted(p for p in orig.iterdir() if p.is_file())
        aj = work / "analysis.json"
        if aj.exists():
            analysed = [f["file"] for f in json.loads(aj.read_text(encoding="utf-8"))["files"]]
    elif args.before:
        before_paths = [Path(p) for p in args.before]
    else:
        print("Pass --work DIR (from analyze.py) or --before FILE...", file=sys.stderr)
        return 2

    after_paths = [Path(p) for p in (args.after or analysed)]
    if not after_paths:
        print("Nothing to verify: pass --after FILE...", file=sys.stderr)
        return 2
    missing = [p for p in after_paths if not p.exists()]
    if missing:
        print("Missing output file(s): %s" % ", ".join(str(m) for m in missing), file=sys.stderr)
        return 2

    plan = load_plan(args.plan)

    b_docs, b_anchors, b_dirs, b_text = load_side(before_paths, repo_root)
    a_docs, a_anchors, a_dirs, a_text = load_side(after_paths, repo_root)

    if args.emit_plan:
        return emit_plan(b_anchors, a_anchors, a_text, plan, args.emit_plan)

    res = Result()
    check_anchors(b_anchors, a_anchors, b_text, a_text, plan, res)
    a_units = line_units(a_docs)
    check_prohibitions(b_dirs, a_units, res)
    check_routes(a_docs, b_docs, res)
    check_unsupported(a_docs, res)
    check_structure(a_docs, res)
    check_reference_depth(a_docs, [p.name for p in after_paths[:1]] + [p.name for p in before_paths], res)
    check_directive_coverage(b_dirs, a_units, res)
    check_budgets(a_docs, res)

    b_size, method = side_sizes(b_docs)
    a_size, _ = side_sizes(a_docs)
    sizes = {"before": b_size, "after": a_size, "method": method}

    print(render(res, sizes))

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(
                {
                    "verdict": "FAIL" if res.failed else ("WARN" if res.warned else "PASS"),
                    "checks": res.checks,
                    "sizes": sizes,
                    "before_files": [str(p) for p in before_paths],
                    "after_files": [str(p) for p in after_paths],
                    "plan": plan,
                },
                indent=1,
            ),
            encoding="utf-8",
        )
    return 1 if res.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
