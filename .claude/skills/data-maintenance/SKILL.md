---
name: data-maintenance
description: Maintain the Venue Finder STEM dataset. Use when the user pastes a "Weekly data check" GitHub issue (label data-check), or asks to update, fix or extend the conferences/journals data (new deadlines, broken sources, new editions, new venues to add).
---

# Data maintenance for Venue Finder STEM

The dataset lives in `data/*.json` (format: `docs/data-format.md`). A weekly GitHub Actions run of
`tools/verify_sources.py` opens a single issue labelled `data-check` when something needs attention.
This skill turns that issue into verified data updates and, while at it, looks for relevant new venues.

## Non-negotiable data rules

- **No invented data, no false positives.** Every value comes from an online source checked in this
  session: official venue website, CORE portal, publisher site, SCImago, official proceedings/front matter.
  Aggregators (deadline trackers, wikis) are only leads: always confirm on the primary source.
- If a value cannot be verified, leave it empty (`null` / empty list). Never estimate it.
- Every deadline, rank, metric and acceptance rate carries `source: { url, verified: <today, YYYY-MM-DD>, note? }`.
  When a site blocks automated access and the value was read through a search index, say so in `note`.
- Data text is written in **English** (the UI is translated, the data is not).
- Deadlines: `tz` is `AoE`, `UTC` or an IANA zone; if the source does not state it, add `"tzStated": false`.
- Only official deadlines go in `deadlines`. The app estimates future ones by itself: never write estimated dates.
- Journals: only venues indexed in Scopus and/or Web of Science from recognized publishers. Impact Factor only if
  publicly stated (e.g. by the publisher), with year. Metrics are history: append a new year, do not overwrite.
- Scope: STEM, with priority on computer science and engineering (the areas in `data/tags.json`).

## Workflow

### 1. Read the issue
The issue body has up to four sections. Make a checklist from it:
- **Unreachable links**: URL, HTTP status, venues using it.
- **Values not found in their source**: venue id, check (e.g. `deadline paper 2026-11-16`), source URL.
- **IEEE Xplore values that changed**: usually the yearly June release of IF/CiteScore.
- **Estimated deadlines coming up**: conferences whose official dates may now be published.

If the user did not paste an issue, run `python3 tools/verify_sources.py --ieee` to produce the same list.

### 2. Fix each item (one venue at a time)
- **Unreachable link** → find the current official URL (search on the official domain). Update every place
  where the URL is used. If the page is gone for good, replace it with the closest official page that still
  states the same value, or remove the value if nothing confirms it anymore.
- **Value not found** → open the source and decide:
  - the site moved to a **new edition** → update `edition` (label, dates, city, country + `countryCode`),
    move the old deadlines to `previousCycle` (label = old edition), add the new official deadlines,
    refresh `topics` from the new call, workshops and proceedings if changed;
  - the value was **corrected** → update it with today's verification date;
  - it is a **false positive** (value written differently, page rendered with JavaScript, anti-bot page)
    → confirm it by reading the page, then add it to `tools/known-issues.json` with a short `reason`.
- **IEEE value changed** → append a new `{year, value, source}` entry to `metrics.jif` / `metrics.citescore`
  (IEEE Xplore shows the June release: JIF/CiteScore of the previous year). Check the SJR of the same journals
  if a new SCImago year is out and append it too.
- **Estimated deadline coming up** → look for the new call on the official website. If it is out, add the
  official deadlines as above; if not, leave the data as it is (the estimate stays, clearly labelled).

### 3. Look for relevant new venues (always, while an issue is open)
- Conferences: run `python3 tools/core_compare.py`. It reports a newer CORE edition (if any), rank changes
  for tracked conferences, and A*/A conferences not in the data grouped by field.
  - If a newer CORE edition exists, update `rank.core` (value, edition, url) of every conference, keeping
    the old value in `rank.core.previous`.
  - From the missing list, shortlist the venues that fit the app's areas (A* first). **Show the shortlist to
    the user and let them choose**; do not add anything on your own.
  - Venues the user rejects go to `tools/core-ignored.json` (`coreId`, `acronym`, `reason`) so they are not
    proposed again.
- Journals: only if the user asks. Propose candidates in the app's areas (Q1/Q2 in SCImago, Scopus/WoS indexed,
  recognized publisher) and let the user choose.
- Every venue the user picks is researched and entered with the same completeness and rules as the existing
  ones: official site, CORE rank or SJR/quartile, current edition and official deadlines (or `previousCycle`),
  main-track topics from the call (or aims & scope), proceedings or publisher data, acceptance rates only from
  primary sources, tags from `data/tags.json`.

### 4. Check before handing over
```bash
python3 tools/validate.py                  # must report 0 errors
python3 tools/verify_sources.py --ieee     # the issue's problems must be gone (or listed in known-issues)
```
- Set `lastVerified` in `data/meta.json` to today.
- If anything under `assets/` changed, bump the asset version (`?v=` in `index.html` and `guide.html`,
  `ASSET_VERSION` in `assets/js/i18n.js`). Data-only changes need no bump.
- If the app code changed, smoke-test it locally: `python3 -m http.server 8000` and open the page.

### 5. Report to the user
Summarize, in the user's language: what changed (per venue), what was added to `known-issues.json` and why,
which new venues were added or ignored, and anything left unverified. Then suggest the commands:
```bash
git add -A
git commit -m "Data update: <short summary> (closes #<issue number>)"
git push
```
Do not commit or push yourself unless the user asks. The issue also closes automatically at the next weekly
run once every check passes.
