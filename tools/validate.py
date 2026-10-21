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
            err(where, "fonte mancante")
        return
    if not isinstance(src, dict) or not str(src.get("url", "")).startswith("http"):
        err(where, "fonte senza url valido")
    if not DATE.match(str(src.get("verified", ""))):
        err(where, "fonte senza data di verifica (YYYY-MM-DD)")


def check_tz(where, tz):
    if tz in ("AoE", "UTC"):
        return
    try:
        ZoneInfo(tz)
    except Exception:
        err(where, f"fuso orario non valido: {tz!r} (usa AoE, UTC o un nome IANA)")


def check_deadline(where, d, need_source=True):
    if d.get("phase") not in PHASES:
        err(where, f"phase non valida: {d.get('phase')!r}")
    if not DATE.match(str(d.get("date", ""))):
        err(where, f"data non valida: {d.get('date')!r}")
    if "time" in d and not TIME.match(str(d["time"])):
        err(where, f"ora non valida: {d['time']!r}")
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
            err(w, "id duplicato")
        seen.add(w)
        for f in ("type", "name", "tags", "website", "topics"):
            if not v.get(f):
                err(w, f"campo obbligatorio mancante: {f}")
        for t in v.get("tags", []):
            if t not in tags:
                err(w, f"tag sconosciuto: {t}")
        check_source(f"{w}.topics", (v.get("topics") or {}).get("source"))

        if v.get("type") == "conference":
            c = v.get("conference") or {}
            if c.get("recurrence") not in (1, 2):
                err(w, "recurrence deve essere 1 (annuale) o 2 (biennale)")
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
                    err(w, f"edition.{k} non valida")
            if not (c.get("rank") or {}).get("core"):
                warnings.append(f"{w}: rank CORE assente")
        elif v.get("type") == "journal":
            j = v.get("journal") or {}
            if not (j.get("issn") or {}).get("print") and not (j.get("issn") or {}).get("online"):
                err(w, "ISSN mancante")
            if j.get("access") not in ("open", "hybrid", "subscription"):
                err(w, "access deve essere open | hybrid | subscription")
            for kind in ("sjr", "jif", "citescore"):
                for i, m in enumerate((j.get("metrics") or {}).get(kind) or []):
                    check_source(f"{w}.metrics.{kind}[{i}]", m.get("source"))
            for i, si in enumerate(j.get("specialIssues") or []):
                check_source(f"{w}.specialIssues[{i}]", si.get("source"))
                if si.get("deadline"):
                    dl = dict(si["deadline"], phase="paper")
                    check_deadline(f"{w}.specialIssues[{i}].deadline", dl, need_source=False)
        else:
            err(w, f"type non valido: {v.get('type')!r}")

    for x in warnings:
        print("ATTENZIONE", x)
    for x in errors:
        print("ERRORE", x)
    n_c = sum(1 for v in venues if v.get("type") == "conference")
    print(f"{n_c} conferenze, {len(venues) - n_c} journal, {len(errors)} errori, {len(warnings)} avvisi")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
