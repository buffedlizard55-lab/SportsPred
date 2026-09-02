# Volleyball irregularities

Machine-readable copy: `data/volleyball_provenance.json`, rendered on [sources.html#volleyball](../sources.html#volleyball).

| Id | Finding | Effect |
|---|---|---|
| IR-VB-01 | ESPN is college-only; OLBG's open card on 2026-09-02 was EuroVolley Women QFs | Families never joined. Internationals without a tape are SKIPPED. |
| IR-VB-02 | No free multi-book volleyball moneyline | Odds missing; live confidence cannot read HIGH. |
| IR-VB-03 | No key-less kills/blocks per set | Attacking quality scores 0. |
| IR-VB-04 | Germany 3-0 Hungary 25 Aug printed `(25-17, 7-4)` | Win/loss kept; set-score components ignore the match. |
| IR-VB-05 | Belgium vs Spain 22 Aug listed 3-2 with a fifth set `8-15` | Match omitted. Not invented. |
| IR-VB-06 | OLBG 09:00/12:00 vs Wikipedia 16:00/19:00 Istanbul | Date 2026-09-03 from Wikipedia; `startUtc` left null. |

U-02 (OLBG relative dates) and U-07 (sandbox cannot reach ESPN/OLBG) also apply.
