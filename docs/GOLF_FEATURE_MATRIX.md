# Golf feature matrix — what the site does, where, and how it is proven

| Requirement (user) | Delivered | Where | Proof |
|---|---|---|---|
| Golf page separated from other sports, reachable from the sport rail and home tiles | ✅ `golf.html` with its own controller; `sport.html?sport=golf` hands over to it | `assets/js/golf-page.js`, `engine/registry.js` (`page: 'golf.html'`), `assets/js/ui.js`, `assets/js/home.js` | DOM smoke tests "golf.html boots…", "sport.html?sport=golf hands over" |
| Scoreboard: past results, current, upcoming, per tour | ✅ leaderboards for PGA TOUR, DP World Tour, LPGA, PGA TOUR Champions, fetched live from ESPN in the browser with the committed snapshot as fallback; full field, positions, to-par, thru, R1–R4, tee times for upcoming events, cut line | `assets/js/golf-collector.js`, `leaderboardHtml()` | fixture-driven DOM test renders Crans-sur-Sierre field |
| Calendar with past / today / upcoming, per tour | ✅ month grid with tournament counts and names, date strip, week jumps, per-tour season list with click-to-load | `renderCalendar`, `renderSeasonList` | DOM test asserts calendar counts |
| OLBG golf markets on the board | ✅ committed OLBG golf slate (tournaments, team events, editorial tables) in the rail and on the markets page; rows matched to the event in the analysis panel (display only) | `scripts/collect_golf_olbg.py`, `renderOlbg`, `assets/js/markets.js` | `tests/test_golf_olbg_parse.py` |
| Auto-generated predictions for every upcoming event | ✅ every PGA TOUR / DP World Tour event on the board is scored and written on load | `loadDate → generateAll` | DOM test asserts a pill and rail entries without a click |
| Working "Generate predictions" button | ✅ rebuilds every card, re-renders, toasts the count; disabled/re-enabled correctly | `wireControls()` | DOM test "the golf Generate button actually generates" |
| Copy-pasteable predictions with confidence | ✅ per-event "Copy card" and "Copy all cards"; each tip carries `Confidence: …`; summary table included | `buildGolfCardText` | writer tests |
| Every fact backed by official links | ✅ ESPN leaderboard + JSON, ESPN player pages, OWGR profile, PGA TOUR stat page, Open-Meteo request, OLBG index — listed per card and per selection | `buildSources`, `detailHtml` | DOM test checks `https` + `rel=noopener` on every link |
| Irregularities flagged for review | ✅ per-card flags (amateurs, shared headliners, guard swaps, value fallback), per-candidate `missing[]`, event-level `missing[]`, register in docs and provenance | `scoreGolfEvent.flags`, `docs/GOLF_IRREGULARITIES.md`, `data/golf_provenance.json` | engine tests assert flags |
| Prompt output rules obeyed exactly | ✅ validator enforces every Step 4 rule on every card; card shows "CARD VALIDATED" | `validateGolfCard` | writer tests + DOM test |
| Backtesting | ✅ walk-forward over the two-season tape per market with source URL per row; ledger | `scripts/backtest_golf.mjs` → `data/golf_backtest.json`, `data/golf_predictions.json` | runs in CI after collection |
| Forward collection | ✅ `golf-collect.yml` on push to this branch + `collect.yml` on the daily schedule; incremental results tape; weather inside seven days | `.github/workflows/*.yml`, `ci/*.yml` | `python3 scripts/build_data.py --strict` validates every file |
| Free public APIs only | ✅ ESPN key-less JSON, OWGR public JSON, PGA TOUR public pages, Open-Meteo, OLBG public HTML | `docs/GOLF_SOURCES.md` | — |
| No hallucination | ✅ every unsourced factor → `missing[]` + 0 points; no market can read HIGH on partial evidence; no selection at all without evidence | `golf_engine.js` | engine tests "refuses to pick without evidence" |

## What is not delivered (and why)

- **Odds, per-event strokes gained, course/grass type, links classification**
  — no free source (IR-GOLF-01/02/03). Substitutes are named where measurable;
  otherwise the factor is missing.
- **LPGA / Champions predictions** — outside the prompt's men's-tour rules
  (IR-GOLF-08); leaderboards and calendars only.
- **Data files on this branch** — the sandbox cannot reach the sources
  (IR-GOLF-13). The first `golf-collect.yml` run on this branch populates
  `data/golf_*.json`; until then the page loads live leaderboards in the
  browser and records history factors as missing.
