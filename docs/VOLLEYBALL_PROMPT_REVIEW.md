# Volleyball master prompt → code

Prompt: VOLLEYBALL PREDICTION MASTER PROMPT v1.0. Implementation: `engine/volleyball_engine.js`, `engine/volleyball_writer.js`, `engine/volleyball_data.js`, `volleyball.html`.

| Prompt step | Code | Test |
|---|---|---|
| WIN MATCH: last-5 form, last month double-weighted as last 5 | `scoreRecentForm` | `tests/volleyball_engine.test.mjs` |
| 5-win streak / straight-set streak / opponent 2-loss bonuses | same | strong-favourite fixture |
| H2H last 5 with last 3 double-weighted | `scoreH2H` + `orientMeetings` | oriented from tape `winner` |
| Odds American bands; trap if shorter than -300 with H2H < 60% | `scoreOddsAndValue` | missing odds recorded, never invented |
| Attack rank 1–3 / 5 / 10 | `scoreAttackingQuality` | missing when no kills/blocks feed |
| Home 65% / 50–64% / poor; back-to-back −5 | `scoreHomeAdvantage` | EuroVolley QFs marked `neutral` |
| SET SCORE 3-0 / 3-1 / 3-2 tables | `scoreSetScoreOutcomes` | 3-2 never HIGH without 3× five-set H2H |
| HIGH ≥70, MEDIUM ≥50 with ≥2 factors, else SKIP | `scoreVolleyballMatch` | thin match SKIP |
| Missing field → `missing[]` + penalty | `applyMissingFieldPenalty` | attacking missing test |
| Writer: 40 words, bold in first 20, no digits except **3-x**, unique opener, Confidence: BAND | `engine/volleyball_writer.js` | `tests/volleyball_writer.test.mjs` |
| NCAA ≠ EuroVolley | `enrichVolleyballMatch` family filter | isolation test |
| Generate button | `assets/js/volleyball-page.js` `#generate` | `tests/dom_smoke.test.mjs` |

Substitutions (named, not hidden):

- Odds-from-two-books → ESPN single-book or none (IR-VB-02); HIGH capped live.
- Kills/blocks → missing (IR-VB-03).
- Injuries / player names → never collected, writer forbids them.
- Total points / handicap → OLBG review only.
