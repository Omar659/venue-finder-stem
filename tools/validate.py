#!/usr/bin/env python3
"""Validates the data files of Venue Finder STEM.

Usage (from the project root):  python3 tools/validate.py
Checks: unique ids, known tags, date formats, valid time zones, sources with
url + verification date, required fields per venue type. Exit code 1 on errors.
"""
import json
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent / "data"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^\d{2}:\d{2}$")
PHASES = {"abstract", "paper", "supplementary", "reviews", "rebuttal", "commitment", "notification", "camera_ready"}
errors, warnings = [], []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def check_source(where, src, required=True):
    if src is None:
        if required:
            err(where, "missing source")
        return
    if not isinstance(src, dict) or not str(src.get("url", "")).startswith("http"):
        err(where, "source without a valid url")
    if not DATE.match(str(src.get("verified", ""))):
        err(where, "source without a verification date (YYYY-MM-DD)")


def check_tz(where, tz):
    if tz in ("AoE", "UTC"):
        return
    try:
        ZoneInfo(tz)
    except Exception:
        err(where, f"invalid time zone: {tz!r} (use AoE, UTC or an IANA name)")


def check_deadline(where, d, need_source=True):
    if d.get("phase") not in PHASES:
        err(where, f"invalid phase: {d.get('phase')!r}")
    if not DATE.match(str(d.get("date", ""))):
        err(where, f"invalid date: {d.get('date')!r}")
    if "time" in d and not TIME.match(str(d["time"])):
        err(where, f"invalid time: {d['time']!r}")
    check_tz(where, d.get("tz", "AoE"))
    if need_source:
        check_source(where, d.get("source"))


def main():
    tags = {t["id"] for t in json.loads((ROOT / "tags.json").read_text(encoding="utf-8"))["tags"]}
    venues = []
    for name in ("conferences.json", "journals.json"):
        venues += json.loads((ROOT / name).read_text(encoding="utf-8"))["venues"]

    seen = set()
    for v in venues:
        w = v.get("id", "?")
        if w in seen:
            err(w, "duplicate id")
        seen.add(w)
        for f in ("type", "name", "tags", "website", "topics"):
            if not v.get(f):
                err(w, f"missing required field: {f}")
        for t in v.get("tags", []):
            if t not in tags:
                err(w, f"unknown tag: {t}")
        check_source(f"{w}.topics", (v.get("topics") or {}).get("source"))

        if v.get("type") == "conference":
            c = v.get("conference") or {}
            if c.get("recurrence") not in (1, 2):
                err(w, "recurrence must be 1 (annual) or 2 (biennial)")
            for i, d in enumerate(c.get("deadlines") or []):
                check_deadline(f"{w}.deadlines[{i}]", d)
            for i, d in enumerate(((c.get("previousCycle") or {}).get("deadlines")) or []):
                check_deadline(f"{w}.previousCycle[{i}]", d)
            for i, a in enumerate(c.get("acceptance") or []):
                check_source(f"{w}.acceptance[{i}]", a.get("source"))
                if a.get("rate") is not None and not 0 < a["rate"] <= 100:
                    err(w, f"acceptance rate fuori scala: {a['rate']}")
            e = c.get("edition") or {}
            for k in ("start", "end"):
                if e.get(k) and not DATE.match(e[k]):
                    err(w, f"invalid edition.{k}")
            if not (c.get("rank") or {}).get("core"):
                warnings.append(f"{w}: no CORE rank")
        elif v.get("type") == "journal":
            j = v.get("journal") or {}
            if not (j.get("issn") or {}).get("print") and not (j.get("issn") or {}).get("online"):
                err(w, "missing ISSN")
            if j.get("access") not in ("open", "hybrid", "subscription"):
                err(w, "access must be open | hybrid | subscription")
            for kind in ("sjr", "jif", "citescore"):
                for i, m in enumerate((j.get("metrics") or {}).get(kind) or []):
                    check_source(f"{w}.metrics.{kind}[{i}]", m.get("source"))
            for i, si in enumerate(j.get("specialIssues") or []):
                check_source(f"{w}.specialIssues[{i}]", si.get("source"))
                if si.get("deadline"):
                    dl = dict(si["deadline"], phase="paper")
                    check_deadline(f"{w}.specialIssues[{i}].deadline", dl, need_source=False)
        else:
            err(w, f"invalid type: {v.get('type')!r}")

    for x in warnings:
        print("WARNING", x)
    for x in errors:
        print("ERROR", x)
    n_c = sum(1 for v in venues if v.get("type") == "conference")
    print(f"{n_c} conferences, {len(venues) - n_c} journals, {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
