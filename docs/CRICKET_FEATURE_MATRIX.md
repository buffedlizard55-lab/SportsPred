# Cricket prompt → feature matrix

Status legend: ✅ done & tested · ⚠️ rules built, data partial · ❌ blocked (see irregularities).

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Active scoreboard (past / live / upcoming) | `cricket-collector.js` scorepanel + `app.js` | ✅ |
| 2 | Calendar with per-day match dots & navigation | `renderCalendar` (cricket counts) | ✅ |
| 3 | OLBG cricket markets board | `renderCricketOlbg`, `cricket_slate.json` | ✅ |
| 4 | Four-market engine (Win, MoM, Top Batter ×2) | `cricket_engine.js` | ✅ |
| 5 | Man of the Match candidate scoring (top 3) | `scoreMomCandidate` | ✅ |
| 6 | All-rounder identification & +5 elevation | engine + summary roster roles | ✅ |
| 7 | Spin/pace vs opposition matchup | `scoreBowlingMatchup` / `playerMatchup` | ✅ rules; weakness scouting ⚠️ |
| 8 | Pitch & weather weighting | engine fields present | ⚠️ structured source ❌ CR-IR-02 |
| 9 | Odds value bands & value zones | `normaliseOdds`, odds components | ⚠️ rules done; odds source ❌ CR-IR-01 |
| 10 | Confidence thresholds & SKIP | decision rules | ✅ |
| 11 | Correlation cap (max 3 player markets) | engine | ✅ |
| 12 | T20 / ODI / Test format logic | `classifyFormat` + modifiers | ✅ |
| 13 | Confirmed starters only (no availability speculation) | summary roster `starter` | ✅ |
| 14 | Written 40+ word tips, bolded pick, no digits, unique voices | `cricket_writer.js` (48 openers, validator) | ✅ |
| 15 | One-click copy per tip + full card | app copy buttons | ✅ |
| 16 | Summary table + value flag + RG reminder | `buildCricketFormattedCardText` | ✅ |
| 17 | Copy/paste ready predictions | clipboard outputs | ✅ |
| 18 | Sport-separated navigation (Cricket / Handball / Tennis) | sport pills + `multi_sport.js` | ✅ |
| 19 | League/format filter & search | filter bar | ✅ |
| 20 | Backtest / settlement ledger | `cricket_predictions.json` + recorder | ⚠️ ledger wired; settles as collector runs |
| 21 | Data-quality / sources tab | `renderQuality` + provenance | ✅ |
| 22 | Manual-review official links on every card | Scorecard/OLBG links | ✅ |
| 23 | Team form last-5 + H2H | 30-day scorepanel tape | ✅ (window limited; CR-IR-03) |
| 24 | Player last-5 aggregates | fields present | ⚠️ single-match stats now; tape pass later |
