# Historical backtest

A walk-forward backtest of the win-match and first-set markets, run on real
data from the verified Sackmann dataset mirror.

```
node scripts/backtest_historical.mjs              # download + backtest (ATP 2024–2025)
node scripts/backtest_historical.mjs --years 2025 # a single season
node scripts/backtest_historical.mjs --json       # machine-readable output
```

## Data source

- **Mirror:** [`Kadantte/tennis_atp`](https://github.com/Kadantte/tennis_atp) —
  a fork of Jeff Sackmann's deleted `tennis_atp` repository (results, rankings
  and match stats, 1968–2026). Redistributed under **CC BY-NC-SA 4.0** with
  attribution to Jeff Sackmann. Verified reachable 2026-08-31 via the GitHub API.
- **Files used:** `atp_matches_2024.csv`, `atp_matches_2025.csv` (6,020 rows).
- **Excluded:** 643 rows — Davis Cup / Olympics / Tour Finals (non-standard
  draws) and any match missing a rank or surface. Listed in the report.

## Method

1. Rows are sorted chronologically by `(tourney_date, match_num)`.
2. For each match, features are built **only from prior matches**:
   - `form.last5` — the player's last five results.
   - `surface.wins/losses` — prior 12 months on the same surface.
   - `form.firstSetWinRateLast10` — first-set win rate over the last 10 matches
     on the surface.
   - `form.straightSetsLast3` — straight-set wins over the last 3 matches.
   - `serve.firstServePct`, `serve.acesPerMatch` — from the match's own stats
     (known pre-match, since they describe the player, not the outcome).
   - rank — `winner_rank` / `loser_rank` published in the row.
3. The favourite is the better-ranked player (there is no historical odds source).
4. The live engine (`engine/engine.js`) scores `win_match` and `first_set`.
5. Picks are graded against the recorded winner / first-set winner.

Known limitations, stated plainly:

- **No odds, no H2H, no injury data** in the mirror, so those factors are
  missing and the engine's anti-hallucination guard caps every pick's band at
  LOW. The report therefore also buckets by raw score so score→outcome
  calibration is visible.
- The raw score is a points total, not a calibrated probability.
- Same-week ordering is approximate (`IR-15`).

## Results (2024–2025 ATP, run 2026-08-31)

| Market | Picks | Hit rate | Brier* | Log loss* |
|---|---|---|---|---|
| Win match | 5,377 | **63.9%** | 0.347 | 0.943 |
| First set | 5,336 | 59.8% | 0.332 | 1.750 |

*Brier/log loss are descriptive figures on `rawScore/100`, not calibrated
probabilities.

Win-match hit rate by model raw-score bucket (higher score ⇒ higher win rate):

| Raw score | Picks | Hit rate |
|---|---|---|
| 0–29 | 3,033 | 58.1% |
| 30–49 | 1,636 | 68.9% |
| 50–69 | 686 | 77.0% |
| 70–100 | 22 | 95.5% |

The monotonic trend across the score buckets is the meaningful result: the
scoring rules rank match confidence in the right order. It does **not** say the
model beats the market — there are no odds here, so no value or profitability
claim is made or implied.

## Reproduce

```bash
# in a GitHub Actions runner or any host with egress to github.com:
node scripts/backtest_historical.mjs
```

The CSVs are cached under `data/.cache/sackmann/` (git-ignored). To re-download,
delete that directory.

> Sandbox note (verified 2026-08-31): in a TLS-intercepting sandbox Node may
> fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` while `curl` works. Run with the
> system trust store, e.g.
> `NODE_EXTRA_CA_CERTS=/usr/lib/ssl/cert.pem node scripts/backtest_historical.mjs`.
> The figures above were reproduced this way in that environment (2024–2025,
> 6,020 rows, 5,377 scored, 63.9% win-match hit rate — identical to the table).
