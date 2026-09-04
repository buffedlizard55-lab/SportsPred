# NBA / Basketball — live verification report (2026-09-03)

This is a dated, line-by-line verification of the basketball (NBA v5.0) path,
recorded against live sources on 2026-09-03. It supplements
`NBA_PROMPT_REVIEW.md`, which describes the standing implementation matrix.
Everything below was read from the live public endpoints listed; nothing is
reconstructed or assumed.

## 1. Live source checks (performed 2026-09-03)

| # | Claim | Source | Result |
|---|-------|--------|--------|
| 1 | ESPN NBA scoreboard is live and returns the 2026-27 season calendar | `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020` | ✅ 200. Season year 2027 (ESPN label), startDate 2026-09-30. Opening-week events present (e.g. Boston Celtics at Detroit Pistons, 2026-10-20T19:00Z). |
| 2 | ESPN NBA scoreboard on 2026-09-03 | `…/basketball/nba/scoreboard?dates=20260903` | ✅ 200, `events: []` — the NBA is in offseason; no games until 3 October (preseason) / 20 October (regular season). |
| 3 | ESPN WNBA scoreboard is live | `…/basketball/wnba/scoreboard?dates=20260917` | ✅ 200. Events present (e.g. Connecticut Sun at Atlanta Dream, 2026-09-17T23:30Z) with team statistics, records and PPG leaders. |
| 4 | ESPN WNBA scoreboard on 2026-09-03 | `…/basketball/wnba/scoreboard?dates=20260903` | ✅ 200, `events: []` — playoff break; next WNBA games 17-18 September. |
| 5 | OLBG basketball index is live and lists NBA + WNBA + Euroleague | `https://www.olbg.com/betting-tips/Basketball/4` | ✅ 200. 13 events on the visible card (see §2). |

**Conclusion:** the data pipeline is healthy. The reason the NBA scoreboard and
the "Generate predictions" button looked empty on 3 September is not a broken
feed — it is that **there are no basketball games on 3 September 2026** (NBA
offseason, WNBA playoff break). The next WNBA slate is 17-18 September; the
NBA regular season opens 20 October.

## 2. OLBG basketball markets currently available (read live 2026-09-03)

Transcribed to `data/basketball_slate.json` with per-event `url`, `league`,
`consensus.market`, `consensus.selection`, and tip counts where published.
OLBG publishes **tipster-consensus counts, not bookmaker odds**; where no count
was shown the field is `null` rather than invented.

WNBA (17-18 Sept): WAS Mystics @ CHI Sky, LA Sparks @ DAL Wings, CON Sun @ ATL
Dream, PHX Mercury @ POR Fire, LV Aces @ SEA Storm, NY Liberty @ MIN Lynx, IND
Fever @ TOR Tempo, POR Fire @ GS Valkyries.
NBA (20-23 Oct): PHI 76ers @ NY Knicks, BOS Celtics @ DET Pistons, CLE
Cavaliers @ PHI 76ers, HOU Rockets @ SA Spurs.
Euroleague (24 Sept): Barcelona vs Anadolu Efes.

Markets seen across the card: **Money Line, Pointspread, Game Totals** (the
three markets the NBA v5.0 prompt scores).

Note: OLBG also carries further basketball leagues (German Bundesliga, EuroCup,
Korean KBL, NBL Australia) and NBA Finals outrights. Those were not on the
visible card at fetch time and are therefore not transcribed — they remain
listed for manual review via the linked OLBG index.

## 3. Fixes made this pass

### 3.1 "The button doesn't generate predictions" (root cause + fix)

**Root cause.** `sport.html?sport=basketball` (and the cross-sport
`predictions.html`) default to *today*. On an empty slate — the NBA in
offseason, the WNBA between rounds — the board rendered a blank date, so the
Generate button re-scored zero matches and appeared to do nothing.

**Fix (assets/js/sport-page.js).**
- Added `nextGameDay()` — the smallest ESPN-calendar date with a registered
  fixture strictly after the current date (from the league calendars already
  parsed from the scoreboard responses).
- Added `maybeAutoAdvance()` — on load, when the date has no fixtures for a
  predictable sport, hop **forward once** to the next game day so the page
  lands on a real slate instead of a blank one. Manual navigation is never
  hijacked (one hop max, forward only).
- `renderBoard()` now distinguishes a genuinely empty date from a
  filter-produced empty list, and on a genuinely empty date shows the next game
  day with a "Jump to …" button.

Regression test added in `tests/dom_smoke.test.mjs`:
`sport.html on an empty (offseason) date auto-advances to the next game day`.

### 3.2 Basketball OLBG slate

- Added `data/basketball_slate.json` (13 verified events, §2).
- Wired it into `loadOlbg()` so the basketball page's "OLBG market slate" rail
  now shows the verified market rows with the official index link, instead of
  the previous "no committed snapshot yet" notice.

### 3.3 Test-suite repair

- `tests/dom_smoke.test.mjs` volleyball "3 September" test hard-coded
  "Nebraska Cornhuskers" as the NCAA team on that date; the committed tape now
  lists different schools. Made it read the NCAA team names from
  `data/volleyball_matches.json` so it tracks the collector output.

## 4. Irregularities flagged for review

| ID | Irregularity | Status / mitigation |
|----|--------------|---------------------|
| IR-NBA-01 | No free multi-source **closing odds** feed exists. ESPN's scoreboard republishes one book's odds (DraftKings), not the two independently archived sources the v5.0 prompt requires. | Price-dependent Step 3 gates are skipped rather than guessed; confidence is capped. Documented in `NBA_PROMPT_REVIEW.md`. |
| IR-NBA-02 | No key-less **date-specific injury/availability** feed is used for the generic engine. The prompt's per-player impact assessment is therefore unavailable. | The affected market is withheld; the official NBA injury report is linked for manual review. |
| IR-NBA-03 | **ATS (last 10) and head-to-head** are not consistently exposed by the generic ESPN response for NBA. | Scored as missing; never inferred from the final score alone. |
| IR-NBA-04 | `data/olbg_sports.json` records Basketball `events: 3`, but the visible index actually listed 13 events on 2026-09-03. | The top-level counter under-counts (likely counts only one market type / first page). The detailed `data/basketball_slate.json` is the authoritative per-event record; the top-level counter is display-only. |
| IR-NBA-05 | `data/baseball_provenance.json` is referenced by `baseball-page.js` but not committed. | Degrades gracefully; noted by `verify_site.mjs`. Unrelated to basketball, flagged for completeness. |

## 5. Manual review links

- ESPN NBA scoreboard: https://www.espn.com/nba/scoreboard
- ESPN NBA scoreboard API: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
- ESPN WNBA scoreboard API: https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard
- NBA official stats: https://www.nba.com/stats
- NBA official injury report: https://official.nba.com/nba-injury-report-2025-26-season/
- OLBG Basketball tips: https://www.olbg.com/betting-tips/Basketball/4
- NBA v5.0 implementation matrix: `docs/NBA_PROMPT_REVIEW.md`
