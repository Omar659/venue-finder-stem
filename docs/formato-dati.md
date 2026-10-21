# Formato dei dati

I dati dell'app sono in `data/` e sono JSON semplici, modificabili a mano. Non serve ricompilare nulla.

| File | Contenuto |
|---|---|
| `data/conferences.json` | Conferenze |
| `data/journals.json` | Journal |
| `data/tags.json` | Tassonomia gerarchica delle aree di ricerca |
| `data/meta.json` | Data dell'ultima verifica ed edizioni dei ranking |

## Regole generali

- Ogni dato rilevante (deadline, rank, metriche, acceptance rate) ha una **fonte**: `{ "url": "...", "verified": "YYYY-MM-DD", "note": "facoltativa" }`.
- Se un dato non è verificabile, lascialo vuoto (`null` o lista vuota): l'app lo mostra come "non disponibile".
- Gli `id` sono univoci, minuscoli e compaiono nell'URL del dettaglio (`index.html#v=neurips`).

## Campi comuni

| Campo | Tipo | Note |
|---|---|---|
| `id` | string | univoco |
| `type` | `"conference"` \| `"journal"` | |
| `field` | string | area disciplinare (oggi `"stem"`) |
| `name`, `acronym` | string | |
| `tags` | string[] | id definiti in `data/tags.json` |
| `website` | url | sito ufficiale |
| `topics` | object | `{ intro, items[], text, source }`: topic della main track o aims & scope |
| `notes` | string \| null | avvertenze sul dato |

## Conferenze

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
    "edition": { "label": "CVPR 2027", "year": 2027, "city": "Seattle", "country": "USA", "format": "in-person",
                 "start": "2027-06-20", "end": "2027-06-25", "note": null, "source": { "url": "...", "verified": "..." } },
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
- `tz`: `"AoE"` (UTC−12), `"UTC"` o un fuso IANA (`"America/Los_Angeles"`). Senza `time` la scadenza è alle 23:59. Se la fonte non indica il fuso, aggiungi `"tzStated": false`.
- `recurrence`: `1` annuale, `2` biennale.
- `rolling: true` per le conferenze a sottomissione continua (nessuna deadline né stima).
- `previousCycle`: deadline dell'edizione precedente, usate solo per stimare la prossima quando quelle nuove non sono ancora uscite.
- `workshops.items[]`: `{ name, url, topics, when, deadline }`.

### Deadline ufficiali e stimate

- Le deadline in `deadlines` sono **ufficiali**; quelle passate appaiono come chiuse.
- Se non c'è una scadenza di sottomissione futura (`abstract`, `paper` o `commitment`), l'app **stima** la prossima spostando di `recurrence` anni le date del ciclo più recente (`deadlines`, oppure `previousCycle`). Le date stimate sono sempre etichettate come tali.
- Le special issue dei journal non vengono mai stimate.

## Journal

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
- Le metriche sono storiche: aggiungi un elemento per anno. Con almeno due anni il dettaglio mostra il grafico dell'andamento.
- L'Impact Factor va inserito solo se dichiarato pubblicamente (es. dall'editore), con anno e fonte.
- `indexing`: `true`/`false` se verificato, `null` se non verificato.

## Tag

```json
{ "id": "dl", "parent": "ml", "label": "Deep learning" }
```

Filtrando per un tag si includono tutti i suoi discendenti.

## Aggiungere o aggiornare una venue

1. Copia una voce simile in `conferences.json` o `journals.json` e cambia `id`.
2. Compila i campi con fonte e data di verifica.
3. Per una nuova edizione di una conferenza aggiorna `edition` e `deadlines`; puoi spostare le vecchie deadline in `previousCycle`.
4. Rank CORE: cerca la conferenza su <https://portal.core.edu.au/conf-ranks/> (edizione più recente).
5. Aggiorna `lastVerified` in `data/meta.json`.
6. Controlla i dati:

   ```bash
   python3 tools/validate.py         # struttura e formato
   python3 tools/verify_sources.py   # link e valori contro le fonti citate
   ```

`verify_sources.py` segnala come "NON TROVATO" i valori che non riesce a ritrovare nella fonte: vanno controllati a mano (spesso la data è scritta come intervallo, o il sito blocca le richieste automatiche). Le risposte 403/429/503 indicano di solito siti che bloccano gli script ma funzionano nel browser.
