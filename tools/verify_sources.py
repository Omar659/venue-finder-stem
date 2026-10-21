#!/usr/bin/env python3
"""Verifies the sources cited in data/*.json.

Usage (from the project root):
    python3 tools/verify_sources.py            # link check + content check
    python3 tools/verify_sources.py --links    # link check only
    python3 tools/verify_sources.py --ieee     # also compare IEEE journals with the IEEE Xplore metadata
   python3 tools/verify_sources.py --report report.md   # also write a Markdown report (used by the weekly workflow)

1. Link check: every cited URL is requested; HTTP status codes are summarised.
   403/429/503 usually mean the site blocks automated requests (SCImago, ACM DL,
   Elsevier, Springer...): open those links in a browser to check them by hand.
2. Content check: for every deadline, event start date, acceptance figure,
   impact factor/CiteScore and special-issue deadline, the cited page (or PDF)
   is downloaded and the value is searched in its text, in several formats
   ("2026-11-16", "Nov 16", "16 November", "16,092", "25.8"...).
   "NOT FOUND" does not necessarily mean the value is wrong: the source may
   write it differently (e.g. a range "3 - 7 May 2027") or serve an anti-bot
   page. Every such case must be checked by hand.

Only the Python standard library is required; PDF sources are read if the
optional package `pypdf` is installed (pip install pypdf), otherwise skipped.
"""
import argparse
import collections
import concurrent.futures as cf
import datetime
import html
import io
import logging
import time
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
BLOCKED = {"403", "429", "503", "520"}


def fetch(url, headers=None, timeout=40):
    """Returns (status, bytes). Status is a string ('200', '403', 'ERR: ...')."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/pdf,*/*", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return str(r.status), r.read()
    except urllib.error.HTTPError as e:
        return str(e.code), b""
    except Exception as e:  # DNS errors, timeouts, TLS...
        return f"ERR: {type(e).__name__}", b""


def to_text(raw):
    if raw[:4] == b"%PDF":
        try:
            from pypdf import PdfReader
            logging.getLogger("pypdf").setLevel(logging.ERROR)
        except ImportError:
            return None
        try:
            t = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)
        except Exception:
            return ""
    else:
        t = raw.decode("utf-8", "replace")
        t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
        t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t).lower()


def date_variants(ds):
    d = datetime.date.fromisoformat(ds)
    m, m3, dd = MONTHS[d.month - 1], MONTHS[d.month - 1][:3], d.day
    out = [ds, f"{m} {dd}", f"{m} {dd:02d}", f"{m3} {dd:02d}", f"{m3} {dd}", f"{m3}. {dd}", f"{dd} {m}", f"{dd} {m3}",
           f"{dd:02d} {m3}", f"{d.month}/{dd}/{d.year}", f"{d.month:02d}/{dd:02d}/{d.year}"]
    for suf in ("st", "nd", "rd", "th"):
        out += [f"{m} {dd}{suf}", f"{dd}{suf} {m}"]
    return [x.lower() for x in out]


def date_in_text(text, ds):
    """True if the date appears in `text` (already lowercased), as a single date or as the
    start/end of a range such as "Sep 8–12", "10–14 May 2027" or "8th-12th of August"."""
    if any(x in text for x in date_variants(ds)):
        return True
    d = datetime.date.fromisoformat(ds)
    mon = f"(?:{MONTHS[d.month - 1].lower()}|{MONTHS[d.month - 1][:3].lower()})\\.?"
    day = f"0?{d.day}(?:st|nd|rd|th)?"
    num = "\\d{1,2}(?:st|nd|rd|th)?"
    dash = "\\s*[-–—]\\s*"
    patterns = [
        f"{mon}\\s+{day}{dash}{num}\\b",              # Sep 8–12 (start)
        f"{mon}\\s+{num}{dash}{day}\\b",              # Oct 24-31 (end)
        f"\\b{day}{dash}{num}\\s+(?:of\\s+)?{mon}",     # 8–12 September (start)
        f"\\b{num}{dash}{day}\\s+(?:of\\s+)?{mon}",     # 3-10 July (end)
        f"\\b{day}\\s+(?:to|through|until)\\s+{num}\\s+{mon}",  # 22 to 26 March
    ]
    return any(re.search(p, text) for p in patterns)


def num_variants(x):
    if isinstance(x, float) and not x.is_integer():
        return [f"{x}", f"{x}".replace(".", ",")]
    n = int(x)
    return [str(n), f"{n:,}", f"{n:,}".replace(",", "."), f"{n:,}".replace(",", " ")]


def load_venues():
    venues = []
    for name in ("conferences.json", "journals.json"):
        venues += json.loads((DATA / name).read_text(encoding="utf-8"))["venues"]
    return venues


def collect_urls(venues):
    urls = collections.defaultdict(set)

    def walk(o, vid):
        if isinstance(o, dict):
            if isinstance(o.get("url"), str) and o["url"].startswith("http"):
                urls[o["url"]].add(vid)
            for x in o.values():
                walk(x, vid)
        elif isinstance(o, list):
            for x in o:
                walk(x, vid)

    for v in venues:
        walk(v, v["id"])
        urls[v["website"]].add(v["id"])
    return urls


def collect_checks(venues):
    """(venue id, description, url, variants)"""
    checks = []  # variants=None means "date": matched with date_in_text
    for v in venues:
        vid = v["id"]
        if v["type"] == "conference":
            c = v["conference"]
            dls = (c.get("deadlines") or []) + ((c.get("previousCycle") or {}).get("deadlines") or []) + \
                  ((c.get("workshops") or {}).get("deadlines") or [])
            for d in dls:
                if d.get("source"):
                    checks.append((vid, f"deadline {d['phase']} {d['date']}", d["source"]["url"], d["date"]))
            e = c.get("edition") or {}
            if e.get("start") and e.get("source"):
                checks.append((vid, f"event start {e['start']}", e["source"]["url"], e["start"]))
            for a in c.get("acceptance") or []:
                vals = [x for x in (a.get("submitted"), a.get("accepted")) if x] or ([a["rate"]] if a.get("rate") is not None else [])
                for x in vals:
                    checks.append((vid, f"acceptance {a['year']}: {x}", a["source"]["url"], num_variants(x)))
        else:
            j = v["journal"]
            for kind in ("jif", "citescore"):
                for m in j["metrics"].get(kind) or []:
                    if "ieeexplore.ieee.org/xpl" in m["source"]["url"]:
                        continue  # covered by --ieee
                    checks.append((vid, f"{kind} {m['value']}", m["source"]["url"], num_variants(float(m["value"]))))
            for si in j.get("specialIssues") or []:
                if si.get("deadline"):
                    checks.append((vid, f"special issue {si['deadline']['date']}", si["source"]["url"], si["deadline"]["date"]))
    return checks


SUBMISSION_PHASES = {"abstract", "paper", "commitment"}


def shift_years(ds, years):
    d = datetime.date.fromisoformat(ds)
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb on a non-leap year
        return d.replace(year=d.year + years, day=28)


def estimated_soon(venues, days):
    """Conferences whose next submission deadline is only estimated and falls within `days` days:
    the official dates are probably about to be published."""
    today = datetime.date.today()
    out = []
    for v in venues:
        c = v.get("conference")
        if not c or c.get("rolling"):
            continue
        official = [d for d in c.get("deadlines") or [] if d["phase"] in SUBMISSION_PHASES]
        if any(datetime.date.fromisoformat(d["date"]) >= today for d in official):
            continue
        base = official or [d for d in ((c.get("previousCycle") or {}).get("deadlines") or []) if d["phase"] in SUBMISSION_PHASES]
        if not base:
            continue
        rec = c.get("recurrence", 1)
        k = rec
        while max(shift_years(d["date"], k) for d in base) < today and k < 40:
            k += rec
        upcoming = sorted(x for x in (shift_years(d["date"], k) for d in base) if x >= today)
        if upcoming and (upcoming[0] - today).days <= days:
            out.append((v["id"], v["acronym"], upcoming[0].isoformat(), v["website"]))
    return sorted(out, key=lambda x: x[2])


def load_known(path):
    """Known false positives, already checked by hand: tools/known-issues.json."""
    if not path or not Path(path).exists():
        return set(), set()
    k = json.loads(Path(path).read_text(encoding="utf-8"))
    return ({(x["venue"], x["check"]) for x in k.get("notFound", [])}, {x["url"] for x in k.get("unreachable", [])})


def write_report(path, unreachable, missing, ieee_diffs, soon):
    lines = ["Automated weekly check of the data against the cited sources (`tools/verify_sources.py`).", ""]
    if unreachable:
        lines += ["## Unreachable links", "", "| Status | URL | Venues |", "|---|---|---|"]
        lines += [f"| {st} | {u} | {', '.join(vs)} |" for u, st, vs in unreachable] + [""]
    if missing:
        lines += ["## Values not found in their source", "",
                  "The page may have changed (new edition, corrected date) or may write the value differently.", "",
                  "| Venue | Check | Source |", "|---|---|---|"]
        lines += [f"| {vid} | {what} | {url} |" for vid, what, url in missing] + [""]
    if ieee_diffs:
        lines += ["## IEEE Xplore values that changed", ""] + [f"- {d}" for d in ieee_diffs] + [""]
    if soon:
        lines += ["## Estimated deadlines coming up", "",
                  "The next deadline of these conferences is only estimated and is close: the official dates may be out.", "",
                  "| Venue | Estimated date | Website |", "|---|---|---|"]
        lines += [f"| {acr} (`{vid}`) | {date} | {web} |" for vid, acr, date, web in soon] + [""]
    lines += ["False positives that were checked by hand can be added to `tools/known-issues.json`."]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def ieee_check(venues):
    ok, diffs = 0, []
    for v in venues:
        if v["type"] != "journal" or v["journal"]["publisher"] != "IEEE":
            continue
        pn = re.search(r"punumber=(\d+)", v["website"]).group(1)
        # IEEE Xplore rate-limits bursts (HTTP 502/429): pause between requests and retry with backoff.
        for attempt in range(4):
            time.sleep(1.5 * (attempt + 1))
            st, raw = fetch(f"https://ieeexplore.ieee.org/rest/publication/home/metadata?pubid={pn}",
                            {"Referer": f"https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber={pn}", "Accept": "application/json"})
            if st == "200":
                break
        if st != "200":
            print(f"  {v['acronym']}: IEEE Xplore not reachable ({st})")
            continue
        d, j = json.loads(raw), v["journal"]
        latest = lambda lst: max(lst, key=lambda m: m.get("year") or 0)["value"] if lst else None
        pairs = [("ISSN online", d.get("electronicIssn"), j["issn"]["online"]),
                 ("ISSN print", d.get("printIssn"), j["issn"]["print"]),
                 ("Impact Factor", float(d["impactFactor"]) if d.get("impactFactor") else None, latest(j["metrics"]["jif"])),
                 ("CiteScore", float(d["citeScore"]) if d.get("citeScore") else None, latest(j["metrics"]["citescore"])),
                 ("APC", d.get("apc"), (j.get("apc") or {}).get("amount")),
                 ("accesso", {"T": "open", "H": "hybrid"}.get(d.get("openAccess"), "subscription"), j["access"])]
        for name, api, ours in pairs:
            if api == ours:
                ok += 1
            else:
                diffs.append(f"{v['id']} | {name}: IEEE Xplore={api!r}, data={ours!r}")
                print(f"  DIFFERENT {v['acronym']} {name}: IEEE Xplore={api!r} data={ours!r}  (IEEE updates IF/CiteScore every June)")
    print(f"IEEE: {ok} matching values, {len(diffs)} differences")
    return diffs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--links", action="store_true", help="link check only")
    ap.add_argument("--ieee", action="store_true", help="also compare IEEE journals with IEEE Xplore")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--known", default=str(Path(__file__).resolve().parent / "known-issues.json"),
                    help="JSON file with known false positives to ignore (default: tools/known-issues.json)")
    ap.add_argument("--report", help="write a Markdown report of the problems to this file")
    ap.add_argument("--soon-days", type=int, default=60, help="window for the estimated-deadline reminder (days)")
    args = ap.parse_args()
    known_missing, known_unreachable = load_known(args.known)

    venues = load_venues()
    urls = collect_urls(venues)
    print(f"1) Link check: {len(urls)} unique URLs…")
    with cf.ThreadPoolExecutor(args.workers) as ex:
        results = dict(zip(urls, ex.map(fetch, urls)))
    # Second, sequential attempt for timeouts/network errors (often caused by too many parallel requests to one host).
    retry = [u for u, r in results.items() if r[0].startswith("ERR")]
    if retry:
        print(f"   sequential retry for {len(retry)} URLs with network errors…")
        for u in retry:
            results[u] = fetch(u, timeout=60)
            time.sleep(1)
    status = {u: r[0] for u, r in results.items()}
    print("   results:", dict(collections.Counter("blocked (anti-bot)" if s in BLOCKED else s for s in status.values())))
    broken = [u for u, s in status.items() if s not in BLOCKED and not s.startswith(("2", "3")) and u not in known_unreachable]
    for u in sorted(broken):
        print(f"   UNREACHABLE [{status[u]}] {u}  <- {', '.join(sorted(urls[u]))}")
    unreachable = [(u, status[u], sorted(urls[u])) for u in sorted(broken)]
    missing, ieee_diffs = [], []

    if not args.links:
        checks = collect_checks(venues)
        print(f"2) Content check: {len(checks)} values…")
        texts = {u: to_text(r[1]) for u, r in results.items() if r[0] == "200"}
        stat = collections.Counter()
        for vid, what, url, variants in checks:
            t = texts.get(url)
            if t is None:
                stat["source not readable (blocked, error or PDF without pypdf)"] += 1
            elif (date_in_text(t, variants) if isinstance(variants, str) else any(x in t for x in variants)):
                stat["OK"] += 1
            elif (vid, what) in known_missing:
                stat["known false positive"] += 1
            else:
                stat["NOT FOUND"] += 1
                missing.append((vid, what, url))
        print("   results:", dict(stat))
        for vid, what, url in missing:
            print(f"   NOT FOUND {vid} | {what} | {url}")
        if missing:
            print("   (check NOT FOUND cases by hand: the value is often written as a range or in another format)")

    if args.ieee:
        print("3) Comparison with IEEE Xplore…")
        ieee_diffs = ieee_check(venues)

    soon = estimated_soon(venues, args.soon_days)
    print(f"4) Estimated deadlines within {args.soon_days} days: {len(soon)}")
    for vid, acr, date, _ in soon:
        print(f"   {acr} ({vid}): ~{date}")

    problems = len(unreachable) + len(missing) + len(ieee_diffs) + len(soon)
    if args.report:
        if problems:
            write_report(args.report, unreachable, missing, ieee_diffs, soon)
        elif Path(args.report).exists():
            Path(args.report).unlink()
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
