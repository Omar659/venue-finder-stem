# Data format

The app's data lives in `data/` as plain JSON files that can be edited by hand. Nothing needs to be rebuilt.

| File | Content |
|---|---|
| `data/conferences.json` | Conferences |
| `data/journals.json` | Journals |
| `data/tags.json` | Hierarchical taxonomy of research areas (with translated labels) |
| `data/meta.json` | Date of the last verification and ranking editions |

Data is written in English. Only the user interface and the research-area labels are translated (see [Translations](#translations)).

## General rules

- Every relevant data point (deadline, rank, metric, acceptance rate) has a **source**: `{ "url": "...", "verified": "YYYY-MM-DD", "note": "optional" }`.
- If a value cannot be verified, leave it empty (`null` or an empty list): the app shows it as "not available".
- `id`s are unique, lowercase, and appear in the detail URL (`index.html#v=neurips`).

## Common fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | unique |
| `type` | `"conference"` \| `"journal"` | |
| `field` | string | discipline (currently `"stem"`) |
| `name`, `acronym` | string | |
| `tags` | string[] | ids defined in `data/tags.json` |
| `website` | url | official website |
| `topics` | object | `{ intro, items[], text, source }`: main-track topics or aims & scope |
| `notes` | string \| null | caveats about the data |

## Conferences

```json
{
  "id": "cvpr", "type": "conference", "field": "stem",
  "name": "IEEE/CVF Conference on Computer Vision and Pattern Recognition", "acronym": "CVPR",
  "tags": ["cv", "dl", "ml"], "website": "https://cvpr.thecvf.com/",
  "topics": { "intro": "...", "items": ["..."], "text": null, "source": { "url": "...", "verified": "2026-10-21" } },
  "notes": null,
  "conference": {
    "rank": { "core": { "value": "A*", "edition": "ICORE2026", "url": "https://portal.core.edu.au/conf-ranks/604/", "verified": "2026-10-21" } },
    "recurrence": 1,
    "rolling": false,
    "edition": { "label": "CVPR 2027", "year": 2027, "city": "Seattle", "country": "United States", "countryCode": "US",
                 "format": "in-person", "start": "2027-06-20", "end": "2027-06-25", "note": null,
                 "source": { "url": "...", "verified": "..." } },
    "deadlines": [
      { "phase": "paper", "date": "2026-11-16", "time": "23:59", "tz": "AoE", "label": null, "cycle": null,
        "source": { "url": "...", "verified": "2026-10-21" } }
    ],
    "previousCycle": { "label": "CVPR 2026", "deadlines": [] },
    "workshops": { "note": "...", "url": "...", "items": [], "deadlines": [] },
    "proceedings": { "publisher": "IEEE / CVF", "series": "...", "indexing": ["IEEE Xplore", "DBLP"], "url": "...", "openAccess": true },
    "acceptance": [ { "year": 2026, "rate": 25.4, "submitted": 16092, "accepted": 4089, "track": "main", "note": null,
                      "source": { "url": "...", "verified": "2026-10-21" } } ]
  }
}
```

- `phase`: `abstract`, `paper`, `supplementary`, `reviews`, `rebuttal`, `commitment`, `notification`, `camera_ready`.
- `tz`: `"AoE"` (UTC−12), `"UTC"` or an IANA time zone (`"America/Los_Angeles"`). Without `time` the deadline is 23:59. If the source does not state the time zone, add `"tzStated": false`.
- `countryCode`: ISO 3166-1 alpha-2 code, used to show the country name in the user's language.
- `recurrence`: `1` annual, `2` biennial.
- `rolling: true` for conferences with rolling submission (no deadlines, no estimates).
- `previousCycle`: deadlines of the previous edition, used only to estimate the next one while the new dates are not published.
- `workshops.items[]`: `{ name, url, topics, when, deadline }`.

### Official and estimated deadlines

- Deadlines in `deadlines` are **official**; past ones are shown as closed.
- If there is no upcoming submission deadline (`abstract`, `paper` or `commitment`), the app **estimates** the next one by shifting the most recent cycle (`deadlines`, or `previousCycle`) by `recurrence` years. Estimated dates are always labelled as such.
- Journal special-issue deadlines are never estimated.

## Journals

```json
{
  "id": "ieee-tpami", "type": "journal", "field": "stem", "name": "...", "acronym": "TPAMI",
  "tags": ["cv", "ml"], "website": "https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=34",
  "topics": { "intro": null, "items": [], "text": "Aims & scope...", "source": { "url": "...", "verified": "..." } },
  "journal": {
    "issn": { "print": "0162-8828", "online": "1939-3539" },
    "publisher": "IEEE", "society": "IEEE Computer Society",
    "access": "hybrid",
    "apc": { "amount": 2800, "currency": "USD", "note": null, "source": { "url": "...", "verified": "..." } },
    "indexing": { "scopus": true, "wos": true, "doaj": false, "note": null, "source": { "url": "...", "verified": "..." } },
    "metrics": {
      "sjr": [ { "year": 2025, "value": 4.829, "quartile": "Q1", "source": { "url": "...", "verified": "..." } } ],
      "jif": [ { "year": 2025, "value": 20.4, "source": { "url": "...", "verified": "..." } } ],
      "citescore": [ { "year": 2025, "value": 41.1, "source": { "url": "...", "verified": "..." } } ]
    },
    "acceptance": [],
    "review": { "firstDecisionDays": 37, "text": "...", "source": { "url": "...", "verified": "..." } },
    "specialIssues": [ { "title": "...", "url": "...", "deadline": { "date": "2027-01-15", "tz": "AoE" },
                         "source": { "url": "...", "verified": "..." } } ],
    "submitUrl": "https://..."
  }
}
```

- `access`: `open` (fully open access), `hybrid`, `subscription`.
- Metrics are historical: add one entry per year. With at least two years the detail panel shows a trend chart.
- Add an Impact Factor only if it is publicly stated (e.g. by the publisher), with year and source.
- `indexing`: `true`/`false` if verified, `null` if not verified.

## Tags

```json
{ "id": "dl", "parent": "ml", "label": { "en": "Deep learning", "it": "Deep learning", "es": "Aprendizaje profundo", "...": "..." } }
```

Selecting a tag in the filters also selects all of its descendants. A label missing in a language falls back to English.

## Adding or updating a venue

1. Copy a similar entry in `conferences.json` or `journals.json` and change the `id`.
2. Fill in the fields, each with its source and verification date.
3. For a new conference edition, update `edition` and `deadlines`; you can move the old deadlines to `previousCycle`.
4. CORE rank: look the conference up at <https://portal.core.edu.au/conf-ranks/> (latest edition).
5. Update `lastVerified` in `data/meta.json`.
6. Check the data:

   ```bash
   python3 tools/validate.py         # structure and format
   python3 tools/verify_sources.py   # links and values against the cited sources
   ```

`verify_sources.py` reports as "NOT FOUND" the values it cannot find in their source: check those by hand (dates are often written as ranges, or the site blocks automated requests). HTTP 403/429/503 responses usually mean the site blocks scripts but works in a browser.

## Translations

- UI strings: `assets/i18n/<lang>.json` (flat key → string maps). English (`en.json`) is the reference and the fallback for missing keys; `{name}` placeholders must be kept.
- Guide page: `assets/guide/<lang>.html` (HTML fragment loaded by `guide.html`).
- Research-area labels: the `label` object in `data/tags.json`.
- To add a language: create the two files above, add the labels to `data/tags.json`, and register the language in the `LANGUAGES` list in `assets/js/i18n.js`.
