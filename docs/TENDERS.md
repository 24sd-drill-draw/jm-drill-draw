# NAHL Tender Tracker

A running list of every player announced as signing an NAHL tender, scraped from
NAPHL / T1ER press releases, with a browser board for sorting them and measuring
your own players against the cohort.

## Running it

```
node tools/scrape-tenders.mjs
```

Then open `tender-board.html` through a local server (`.claude/serve.ps1`), not
`file://` — the page fetches `data/tenders.json` and browsers block that over
`file://`. If you must use `file://`, the page offers a file picker instead.

| flag | effect |
|---|---|
| *(none)* | incremental — fetches only stories not already in the store |
| `--all` | re-fetches and re-parses every tender story (~660 requests) |
| `--since 2026-06-01` | only stories announced on or after a date |
| `--limit 40` | stop after N stories |
| `--dry-run` | list what it would fetch, write nothing |
| `--no-gapfill` | skip probing story ids no listing page mentions |

Requests are throttled to ~3/second with retries. A full run takes about 8 minutes;
after that, a daily incremental run is a handful of requests.

## What it collects

From each release: player name, position, age, age group, current club, the NAHL
team holding the tender, the season the tender covers, hometown, and the stat line
quoted in the article (GP / G / A / P, or GAA / SV% for goalies). Plus the source
story URL and an EliteProspects search link.

Missing values are stored as `null` and shown as `—`. They are not guessed. Some
releases genuinely quote no points total.

## What it does not collect, and why

- **Jersey numbers.** No source I can reach publishes them, and the number a
  tendered player wears now is his *current AAA club's* number — not what he'll
  wear in the NAHL. The `#` column is yours to fill in by hand.
- **EliteProspects stats.** EP serves a Cloudflare challenge (HTTP 403) to
  anything that isn't a real browser, and their data is licensed. The board links
  to an EP search for each player; paste the real profile URL into the record and
  it becomes a direct link.
- **Tenders announced only on social media or by the NAHL club.** Every team gets
  ten tenders, two reserved for T1ER players. Only the T1ER ones reliably get a
  NAPHL press release. **This tracker is a floor, not a complete league total.**

## Your edits are safe

Jersey numbers, notes, EP profile URLs, watchlist stars and grades you enter in
the board are stored in the browser, and the scraper never overwrites those
fields in `data/tenders.json`. To fold your edits back into the file: **Export
JSON** in the board and drop the download over `data/tenders.json`.

## Comparing your own players

Paste a roster into the side panel, one per line:

```
Ryan Butler, D, 14, 3, 9
```

`Name, Pos, GP, G, A`. Each player is scored as a percentile of points-per-game
against the tendered players *currently in view*, matched by position group — so
filter to the season and age group you actually care about first, or the number
means nothing.

Points-per-game across different AAA leagues is a rough instrument. Treat it as a
sorting tool for who to go watch, not as an evaluation.
