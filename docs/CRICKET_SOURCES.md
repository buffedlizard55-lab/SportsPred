# Cricket data sources — verification status

Every factor the CRICKET PREDICTION MASTER PROMPT v1.0 asks for is traced to a
specific source. A factor with no verified source is **never estimated** — it is
recorded in the result's `missing[]` list and penalised in scoring. All endpoints
below were verified live on **2026-09-01**.

## Live, key-less, CORS-enabled (used by the browser collector)

| ID | Source | Endpoint | Provides | Status |
|----|--------|----------|----------|--------|
| `espn-scorepanel` | ESPN public scorepanel | `https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel?dates=YYYYMMDD` | Fixtures, live scores, results, winners, venue, city/country, format (`class.eventType`: T20/ODI/Test), match status, series | ✅ Verified |
| `espn-summary` | ESPN match summary | `https://site.web.api.espn.com/apis/site/v2/sports/cricket/{leagueId}/summary?event={eventId}` | Confirmed playing XI (roster), batting positions, batting style, bowling style, runs, balls, strike rate, fours/sixes, wickets, economy, toss, venue, officials | ✅ Verified |
| `espn-header` | ESPN personalized header | `https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in` | Discovery of every active series with numeric league id, event ids and smart dates | ✅ Verified |
| `espncricinfo` | ESPNcricinfo (manual review) | https://www.espncricinfo.com/live-cricket-score | Human-review scorecards, reports, series schedule/results | ✅ Verified |

### Verified example payloads (2026-09-01)

- **South Africa v Zimbabwe, 4th Match, Namibia T20I Tri-Series** — event
  `1549527`, league `1549518`. South Africa 185/7 beat Zimbabwe 142 by 43 runs.
  Summary exposed confirmed XIs, batting positions and full batting/bowling stats
  (e.g. LG Pretorius 94 off 51 at SR 184.31; Dewald Brevis 41 at SR 151.85).
  Venue: Namibia Cricket Ground, Windhoek.
- **St Kitts & Nevis Patriots v Barbados Tridents, CPL 2026** — event `1534201`,
  league `8623`, Warner Park Basseterre, T20 (live at capture).
- **England Women v Ireland Women, 1st ODI** — event `1496552`, league `1496536`,
  Leicester; England won by 6 wickets.
- **South Africa A v Bangladesh A, 2nd unofficial Test** — event `1550137`,
  league `24694`, Senwes Park Potchefstroom; Towhid Hridoy 204* (from the ESPN
  day-3 close-of-play note).

## Markets (OLBG)

| ID | Source | URL | Provides | Status |
|----|--------|-----|----------|--------|
| `olbg-cricket` | OLBG Cricket Tips | https://www.olbg.com/betting-tips/Cricket/16 | Match tips with market type (**Win Match, Man Of The Match, Draw No Bet**), tipster consensus counts (`n/m Win Tips`, percentage, comments), and outright tournament markets (Outright Winner) | ✅ Verified |

**Important:** OLBG publishes tipster *consensus counts*, not bookmaker odds.
The parser (`scripts/lib/cricket_olbg_parse.py`) extracts event ids, teams,
markets and consensus. It is tested against a reconstructed fixture
(`tests/fixtures/olbg_cricket_index.RECONSTRUCTED.html`) built from the live page.

## What is intentionally not sourced (no free key-less feed)

See [`CRICKET_IRREGULARITIES.md`](CRICKET_IRREGULARITIES.md):

- **Bookmaker odds** (match price, Man-of-the-Match price, top-batsman price).
- **Structured pitch reports and weather forecasts.**
- **Rolling last-5 player aggregates** (the summary gives full per-match data,
  but a key-less player-season tape is not exposed in one call).
- **Injuries / squad-availability feeds and social/analyst sentiment.**

## Manual review links

Every match card on the site carries a direct **Scorecard ↗** link (ESPNcricinfo)
and, where an OLBG event matches, an **OLBG Event ↗** link — so every displayed
figure can be checked by hand against the official source.
