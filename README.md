# Events in Estonia · Sündmused Eestis · События в Эстонии

A static website that collects concerts, theatre, parties, lectures, exhibitions, meetups and
other events across Estonia into one searchable, filterable list. Hosted on GitHub Pages; the
data is refreshed automatically by a GitHub Actions workflow every six hours.

## Data sources

| Source | What it covers | How it is read |
| --- | --- | --- |
| [Piletilevi](https://www.piletilevi.ee) | Most ticketed events in Estonia: theatre, concerts, sport, museums | Public JSON API (`/api/v1/events`) |
| [Fienta](https://fienta.com) | Small and mid-size events: workshops, lectures, parties, courses, village dances | Documented public API (`/api/v1/public/events`) |
| [Tartu Kultuuriaken](https://kultuuriaken.tartu.ee) | Tartu and South Estonia culture calendar, including free events | Public JSON API (`/api/events`) |
| [Eventbrite](https://www.eventbrite.com) | Expat and English-language events | schema.org JSON-LD embedded in the search pages |
| [Meetup](https://www.meetup.com) | Meetups in Tallinn and Tartu | Page data embedded in the search page |

Facebook Events has no public API and actively blocks scraping, so it is not included.
Eventbrite blocks requests coming from GitHub-hosted runners (HTTP 405), so its events only
appear when the scraper is run from a normal network, e.g. locally, and the result is committed.
See "Adding a source" below for other candidates.

## How it works

- `scripts/fetch-events.mjs` (Node 20+, no dependencies) fetches every source, normalises
  the events into one schema, detects which languages each event's text is in (ET / RU / EN),
  maps source categories onto a common set, de-duplicates events that appear in several
  sources, and writes `data/events.json`.
- `index.html` + `assets/app.js` + `assets/style.css` is the site. It loads the JSON once and
  does all filtering in the browser: free-text search, date presets, city, category,
  content language, source, free only, online, long-running events. Filters live in the URL
  hash so a filtered view can be shared.
- `.github/workflows/update-events.yml` runs the script on a schedule and commits the
  refreshed data. GitHub Pages serves the repository root.

## Run locally

```bash
node scripts/fetch-events.mjs
npx serve .          # or: python -m http.server
```

Then open http://localhost:3000 (the page needs to be served over HTTP, not opened as a file,
because it fetches `data/events.json`).

## Deploy to GitHub Pages

1. Push this repository to GitHub (public repo, branch `main`).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Settings → Actions → General → Workflow permissions: *Read and write permissions*.
4. Actions → "Update events" → *Run workflow* to populate the data immediately.

## Adding a source

Add a `fetchXyz()` function in `scripts/fetch-events.mjs` that returns an array of objects with
the fields used by the other fetchers (`title`, `start`, `end`, `venue`, `city`, `categories`,
`url`, `image`, …), then add it to the `Promise.all` list in `main()`. Times must be Tallinn
wall-clock strings (`YYYY-MM-DDTHH:mm`); use `toLocal()` for UTC dates.

Candidates not yet included: teater.ee (full theatre schedule, mostly overlaps Piletilevi),
Resident Advisor (club nights), Visit Tallinn / Visit Estonia event calendars, individual venues
(Kultuurikatel, Fotografiska, Sveta, HALL), university public lecture calendars.

## Event schema (`data/events.json`)

Compact keys to keep the file small:

| key | meaning |
| --- | --- |
| `id` | `<source prefix>-<source id>` |
| `src` | sources the event was found in |
| `t`, `d` | title, short plain-text description |
| `s`, `e` | start / end as Tallinn local time `YYYY-MM-DDTHH:mm` (date only when time unknown) |
| `v`, `a`, `c`, `co` | venue, address, city, county |
| `cat` | categories: music, theatre, comedy, exhibition, film, lecture, party, family, sport, festival, food, dance, community, business, tour, market, other |
| `l` | languages detected in the text: `et`, `ru`, `en` |
| `u`, `tu` | event page, ticket page (if different) |
| `img` | image URL |
| `p`, `pt`, `f` | lowest price (number), price text, is free |
| `on`, `ong`, `tbd` | online event, long-running (more than 3 days), start time unknown |
| `org` | organiser |
