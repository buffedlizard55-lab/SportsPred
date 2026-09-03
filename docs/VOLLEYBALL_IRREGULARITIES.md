# FIVB VNL Women irregularities

The machine-readable register is [`data/volleyball_provenance.json`](../data/volleyball_provenance.json), rendered at [sources.html#volleyball](../sources.html#volleyball). This document intentionally repeats the blockers so manual reviewers do not need to inspect application code.

| ID | Status | Finding | Output effect |
|---|---|---|---|
| IR-VB-01 | Resolved | Legacy NCAA and EuroVolley data was being used under a VNL Women prompt. | The scorer has an exact `vnl-women` family guard. Other events only appear in the monitor. |
| IR-VB-02 | Open | OLBG’s public pages show community votes, not two named sportsbook moneylines. | No odds proxy; without two named books the model does not select a favourite. |
| IR-VB-03 | Open | No complete parse-verified official VNL Women schedule/results export is committed. | VNL fixture/result arrays and the backtest remain empty rather than transcribed from narrative pages. |
| IR-VB-04 | Open | There is no source-tagged automated roster/travel adapter. | Roster and travel claims are omitted; a missing roster scores zero. |
| IR-VB-05 | Open | The prompt’s 100-point winner allocation conflicts with a stated extra five host points. | Stakes are capped at 20 and the cap is documented. |
| IR-VB-06 | Resolved | The requested US helpline wording was outdated. | Current NCPG contact wording uses 1-800-MY-RESET, with a reminder to recheck before publishing. |
| IR-VB-07 | Open | The direct OLBG request in this sandbox ended in a TLS EOF. | Collector preserves the previous snapshot on failure; the page labels its snapshot timestamp. |

A zero-row backtest and a SKIP are intended safety outcomes, not errors to mask.
