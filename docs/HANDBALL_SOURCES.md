# Handball Data Sources & Verification Register

All data used for the Handball prediction model is sourced from official tournament organizers, federation databases, and publicly available market directories.

---

## Verified Sources

| Source Name | Organization / Federation | Fields Extracted | Verification Link |
|---|---|---|---|
| **DAIKIN Handball-Bundesliga** | Handball-Bundesliga GmbH (Germany) | Standings, Points, Goal Difference, Head-to-Head, Match Schedules | [daikin-hbl.de/tabelle](https://www.daikin-hbl.de/de/hbl/tabelle) |
| **Tophaandbold** | Dansk Håndbold Forbund (Denmark) | Herreligaen & Kvindeligaen Tables, Fixtures, Scores, Margin Records | [tophaandbold.dk](https://tophaandbold.dk/herreligaen) |
| **Ligue Nationale de Handball** | LNH (France) | Starligue Standings, Results, Goal Averages | [lnh.fr/classement](https://www.lnh.fr/liqui-moly-starligue/classement) |
| **Norges Håndballforbund** | NHF (Norway) | REMA 1000-ligaen (Men & Women) Tables, Head-to-Head, Schedules | [handball.no](https://www.handball.no/) |
| **EHF Champions League** | European Handball Federation | European Club Competition Stages, Two-legged Aggr. Schedules | [ehfcl.eurohandball.com](https://ehfcl.eurohandball.com/) |
| **OLBG Handball Directory** | OLBG.com | Open Slate, 3-Market Listings (Moneyline, Handicap, Total), Tipster Consensus | [olbg.com/betting-tips/Handball/20](https://www.olbg.com/betting-tips/Handball/20) |

---

## Data Policy & Honesty Guard

1. **No Hallucinations:** Every input factor is checked against verified sources. If a factor is unavailable, it is recorded in `missing[]` and penalized via `MISSING_FIELD_PENALTY`.
2. **Machine-Checked Validation:** `scripts/build_data.py --strict` guarantees that every team and match record adheres to provenance contracts.
3. **Traceable Scoring:** Each scored point is accompanied by its rule ID and numerical detail in the scoring components.
