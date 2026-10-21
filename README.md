# Venue Finder STEM

Web app per scegliere **dove pubblicare** in area STEM, con particolare attenzione a informatica e ingegneria: cerca e confronta conferenze e journal, con ranking, deadline e topic.

È un sito completamente statico (HTML, CSS e JavaScript, senza build né dipendenze) pensato per GitHub Pages.

## Funzionalità

- Ricerca per nome, acronimo, ISSN, area o topic.
- Filtri per tipo (conferenze/journal), area di ricerca (tag gerarchici), paese, rank CORE, deadline aperta/chiusa, quartile, open access e special issue aperte.
- Ordinamento per prossima deadline, rank/quartile, acceptance rate o nome.
- Countdown live delle deadline in AoE e nell'ora locale, con distinzione tra date **ufficiali** e **stimate**.
- Scheda di dettaglio con:
  - per le conferenze: topic della main track, workshop, proceedings e storico dell'acceptance rate;
  - per i journal: aims & scope, metriche (SJR, Impact Factor, CiteScore), indicizzazione, APC e special issue.
- Confronto affiancato fino a 4 venue.
- Guida introduttiva al mondo delle pubblicazioni (`guide.html`).
- Tema chiaro/scuro, layout responsive.

## Avvio in locale

I dati vengono caricati via `fetch`, quindi serve un server statico (aprire `index.html` con `file://` non funziona):

```bash
python3 -m http.server 8000
```

Poi apri <http://localhost:8000/>.

## Struttura

```
index.html          app principale
guide.html          guida
assets/             CSS e JavaScript
data/               dati (conferenze, journal, tag, metadati)
docs/               documentazione del formato dei dati
tools/              script di controllo dei dati
```

## Dati

I dati sono in `data/*.json` e si possono aggiornare senza toccare il codice. Ogni informazione rilevante riporta il link alla fonte e la data di verifica, visibili anche nell'app. I dati non verificabili sono lasciati vuoti e mostrati come "non disponibile".

Fonti principali:

- ranking delle conferenze: [CORE](https://portal.core.edu.au/conf-ranks/) (edizione ICORE2026);
- date, deadline e topic: siti ufficiali delle conferenze;
- metriche dei journal: [SCImago](https://www.scimagojr.com/) (SJR e quartili) e siti degli editori (Impact Factor, CiteScore, APC).

Formato dei file e istruzioni per aggiungere o aggiornare una venue: [docs/formato-dati.md](docs/formato-dati.md).

Controlli sui dati (Python 3.9+, nessuna dipendenza obbligatoria):

```bash
python3 tools/validate.py          # struttura e formato dei JSON
python3 tools/verify_sources.py    # link e valori confrontati con le fonti citate
```

## Pubblicazione

Il sito usa solo percorsi relativi e funziona su GitHub Pages anche da una sottocartella (`utente.github.io/nome-repo/`): basta pubblicare il branch principale dalla root del repository.

## Avvertenze

Deadline, ranking e metriche cambiano nel tempo: prima di sottomettere verifica sempre le informazioni sul sito ufficiale della venue. Le deadline stimate sono un'indicazione basata sul ciclo precedente, non date ufficiali.
