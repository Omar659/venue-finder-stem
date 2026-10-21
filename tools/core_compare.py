#!/usr/bin/env python3
"""Compares the official CORE conference ranking with data/conferences.json.

Usage (from the project root):
    python3 tools/core_compare.py                  # latest CORE edition, A* and A
    python3 tools/core_compare.py --ranks A* A B   # also list missing B conferences
    python3 tools/core_compare.py --report core.md # also write the report to a file

Reports:
  1. whether a newer CORE edition than the one used in the data is available;
  2. rank changes for the conferences already in the data;
  3. ranked conferences that are not in the data yet, grouped by research field,
     minus those listed in tools/core-ignored.json (venues deliberately left out).

It only reads public data from the CORE portal and never modifies the data files:
deciding what to add, and verifying it, is a manual step.
Only the Python standard library is required.
"""
import argparse
import csv
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTAL = "https://portal.core.edu.au/conf-ranks/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# ANZSRC 2020 fields of research used by CORE (division 46, Information and computing sciences).
FIELDS = {
    "46": "Information and computing sciences (general)", "4601": "Applied computing", "4602": "Artificial intelligence",
    "4603": "Computer vision and multimedia computation", "4604": "Cybersecurity and privacy",
    "4605": "Data management and data science", "4606": "Distributed computing and systems software",
    "4607": "Graphics, augmented reality and games", "4608": "Human-centred computing", "4609": "Information systems",
    "4610": "Library and information studies", "4611": "Machine learning", "4612": "Software engineering",
    "4613": "Theory of computation",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def latest_edition():
    """Editions offered by the portal's 'source' selector, newest first (e.g. ICORE2026, CORE2023)."""
    page = get(PORTAL)
    select = re.search(r'<select name="source">(.*?)</select>', page, re.S)
    editions = re.findall(r'<option value="([^"]+)"', select.group(1) if select else "")
    editions = [e for e in editions if re.search(r"\d{4}$", e)]
    return sorted(editions, key=lambda e: int(e[-4:]), reverse=True)


def export(edition):
    query = urllib.parse.urlencode({"search": "", "by": "all", "source": edition, "sort": "atitle", "page": 1, "do": "Export"})
    rows = list(csv.reader(io.StringIO(get(f"{PORTAL}?{query}"))))
    # Columns: id, title, acronym, edition, rank, (flag), field of research 1..3
    return [{"id": r[0].strip(), "title": r[1].strip(), "acronym": r[2].strip(), "rank": r[4].strip(),
             "fields": [f for f in r[6:9] if f.strip()]} for r in rows if len(r) >= 7]


def core_id(v):
    url = (v["conference"]["rank"].get("core") or {}).get("url") or ""
    m = re.search(r"conf-ranks/(\d+)", url)
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ranks", nargs="+", default=["A*", "A"], help="ranks to list among missing conferences")
    ap.add_argument("--edition", help="CORE edition to use (default: the latest one)")
    ap.add_argument("--report", help="also write the Markdown report to this file")
    args = ap.parse_args()

    conferences = json.loads((ROOT / "data/conferences.json").read_text(encoding="utf-8"))["venues"]
    ignored_path = ROOT / "tools/core-ignored.json"
    ignored = {x["coreId"]: x for x in json.loads(ignored_path.read_text(encoding="utf-8")).get("ignored", [])} if ignored_path.exists() else {}

    editions = latest_edition()
    edition = args.edition or (editions[0] if editions else None)
    if not edition:
        sys.exit("Could not read the list of CORE editions from the portal.")
    used = sorted({(v["conference"]["rank"].get("core") or {}).get("edition") for v in conferences} - {None})
    ranking = export(edition)
    by_id = {r["id"]: r for r in ranking}

    out = [f"# CORE comparison ({edition})", ""]
    out += [f"Latest edition on the portal: **{editions[0]}**. Edition used in the data: **{', '.join(used) or 'none'}**.", ""]
    if editions and editions[0] not in used:
        out += [f"> A newer CORE edition ({editions[0]}) is available: update the `rank.core` entries of all conferences.", ""]

    changes, tracked = [], set()
    for v in conferences:
        cid = core_id(v)
        if not cid:
            continue
        tracked.add(cid)
        current = (v["conference"]["rank"].get("core") or {}).get("value")
        new = by_id.get(cid, {}).get("rank")
        if new is None:
            changes.append(f"| {v['acronym']} (`{v['id']}`) | {current} | not in {edition} |")
        elif new != current:
            changes.append(f"| {v['acronym']} (`{v['id']}`) | {current} | {new} |")
    out += ["## Rank changes for conferences in the data", ""]
    out += (["| Conference | In the data | " + edition + " |", "|---|---|---|"] + changes) if changes else ["None."]
    out += [""]

    missing = defaultdict(list)
    for r in ranking:
        if r["rank"] in args.ranks and r["id"] not in tracked and r["id"] not in ignored:
            field = r["fields"][0] if r["fields"] else "?"
            missing[field].append(r)
    total = sum(len(x) for x in missing.values())
    out += [f"## {'/'.join(args.ranks)} conferences not in the data ({total})", ""]
    for field in sorted(missing, key=lambda f: (-len(missing[f]), f)):
        out += [f"### {FIELDS.get(field, field)} ({field})", "", "| Rank | Acronym | Title | CORE |", "|---|---|---|---|"]
        for r in sorted(missing[field], key=lambda r: (r["rank"] != "A*", r["acronym"].lower())):
            out.append(f"| {r['rank']} | {r['acronym']} | {r['title']} | {PORTAL}{r['id']}/ |")
        out.append("")
    out += [f"Ignored on purpose (tools/core-ignored.json): {len(ignored)}."]

    text = "\n".join(out) + "\n"
    print(text)
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
