# Handball Model Backtesting & Settlement Report

## Methodology

The handball prediction model is evaluated via walk-forward grading:
1. **Pre-Match Features Only:** Predictions are formed using exclusively pre-match information (prior form, standings, H2H, goals per game averages, rest).
2. **Deterministic Evaluation:** Once a match finishes, the official score is settled against the predicted selections across:
   - **Win Match:** Winner vs Pick
   - **Point Spread:** Margin vs Handicap line ($Home - Away > Spread$)
   - **Game Total:** Aggregate score vs Line ($Goals > Line$)

---

## Performance Summary

```
Total Tracked Predictions: 9
Settled Matches Graded:    3 (German HBL, Danish Herreligaen, French LNH)

Market Performance:
- WIN MATCH:    3/3 (100.0% Hit Rate) | HIGH Confidence: 3/3 (100.0%)
- POINT SPREAD: 3/3 (100.0% Hit Rate) | HIGH Confidence: 3/3 (100.0%)
- GAME TOTAL:   3/3 (100.0% Hit Rate) | HIGH Confidence: 1/1 (100.0%)
```

### Calibration & Staking
- Flat 1-unit staking on HIGH confidence selections produces positive simulated yield across settled cards.
- Predictions with insufficient evidence or contradictory pace/defensive scores are assigned `CONFIDENCE.SKIP` and excluded from selections.
