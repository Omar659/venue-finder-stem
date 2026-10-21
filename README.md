# Venue Finder STEM

A web app to help choose **where to publish** in STEM, with a focus on computer science and engineering: search and compare conferences and journals by ranking, deadlines and topics.

It is a fully static site (HTML, CSS and JavaScript, no build step, no dependencies) designed for GitHub Pages.

**Live site:** <https://omar659.github.io/venue-finder-stem/>

## Features

- Search by name, acronym, ISSN, research area or topic.
- Filters by type (conferences/journals), research area (hierarchical tags), country, CORE rank, open/closed deadline, quartile, open access and open special issues.
- Sorting by next deadline, rank/quartile, acceptance rate or name.
- Live deadline countdowns in AoE and local time, clearly distinguishing **official** from **estimated** dates.
- Detail panel with:
  - conferences: main-track topics, workshops, proceedings and acceptance-rate history;
  - journals: aims & scope, metrics (SJR, Impact Factor, CiteScore), indexing, APCs and special issues.
- Side-by-side comparison of up to 4 venues.
- A beginner's guide to scientific publishing (`guide.html`).
- Interface in English (default), Italian, Spanish, French, German, Portuguese and Chinese.
- Light/dark theme, responsive layout.

## Running locally

Data is loaded with `fetch`, so the site needs a static web server (opening `index.html` via `file://` does not work):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Project structure

```
index.html          main app
guide.html          publishing guide
assets/css/         styles
assets/js/          app logic (time zones and deadlines, i18n, charts, UI)
assets/i18n/        UI translations
assets/guide/       guide content per language
data/               data (conferences, journals, tags, metadata)
docs/               data format documentation
tools/              data checking scripts
```

## Data

The data lives in `data/*.json` and can be updated without touching the code. Every relevant data point links to its source and verification date, which are also shown in the app. Values that could not be verified are left empty and shown as "not available".

The data is a snapshot: it is not fetched live from the venues' websites. Deadlines move automatically from "open" to "closed" and, for recurring conferences, the next deadline is estimated from the previous cycle until the official one is added to the data.

Main sources:

- conference rankings: [CORE](https://portal.core.edu.au/conf-ranks/) (ICORE2026 edition);
- dates, deadlines and topics: official conference websites;
- journal metrics: [SCImago](https://www.scimagojr.com/) (SJR and quartiles) and publishers' websites (Impact Factor, CiteScore, APCs).

File format and instructions for adding or updating a venue: [docs/data-format.md](docs/data-format.md).

Data checks (Python 3.9+, no required dependencies):

```bash
python3 tools/validate.py          # structure and format of the JSON files
python3 tools/verify_sources.py    # links and values checked against the cited sources
```

The same check runs every Monday through GitHub Actions (`.github/workflows/weekly-data-check.yml`): when something needs attention it opens a `data-check` issue, which is closed automatically once all checks pass. Known false positives, already checked by hand, are listed in `tools/known-issues.json`.

## Deployment

The site only uses relative paths, so it works on GitHub Pages from a project subpath (`user.github.io/repo-name/`): publish the default branch from the repository root.
## Disclaimer

Deadlines, rankings and metrics change over time: always check the venue's official website before submitting. Estimated deadlines are a hint based on the previous cycle, not official dates.
