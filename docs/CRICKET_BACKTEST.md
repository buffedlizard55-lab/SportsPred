# Cricket backtest & settlement method

## Forward collection (live)

The browser collector (`assets/js/cricket-collector.js`) builds each card from
ESPN's key-less public endpoints:

1. **Scorepanel** for the selected date → fixtures, scores, winners, venue,
   format, status.
2. **A rolling 30-day scorepanel tape** → team last-5 form and head-to-head
   (prompt: recent results, last-two-weeks double weighted, H2H).
3. **Match summaries** → confirmed playing XIs, batting positions, roles,
   bowling/batting style, and this-match runs/strike-rate/wickets/economy.

`scripts/record_cricket_predictions.mjs` validates the append-only ledger
`data/cricket_predictions.json`; predictions are recorded for upcoming matches
and settled from confirmed scorepanel winners (state `post`).

## Settlement rules

- **Win Match:** settled against `competitors[].winner` in the scorepanel.
- **Man of the Match:** settled against the confirmed player-of-the-match where
  the summary exposes it; otherwise marked `unsettled` (never inferred).
- **Top Team Batsman:** settled against each team's highest confirmed run scorer
  from the summary batting lines (sourced, not guessed).

## Backtest metrics (once the ledger has settled rows)

The grader mirrors the tennis/handball harness: hit rate per market, Brier
score, log loss and ROI vs. priced odds. ROI is **not** reported until a real
odds feed is connected (CR-IR-01); reporting ROI without real prices would be
fabricated.

## Current status

- Engine, writer, collector and data plumbing: implemented and unit-tested
  (`tests/cricket_engine.test.mjs`, `tests/cricket_writer.test.mjs`,
  `tests/cricket_data.test.mjs`, `tests/test_cricket_olbg_parse.py`).
- Verified snapshot fixtures for 2026-09-01 ship in `data/cricket_matches.json`
  so the scoreboard renders even with no network.
- Odds-dependent confidence stays capped until CR-IR-01 is resolved; player
  last-5 aggregates expand as the player-tape pass lands (CR-IR-03).
