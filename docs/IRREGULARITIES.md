# Irregularity Report — data coverage vs. published predictions

**Generated:** 2026-09-04 · **Branch:** `arena/01a06ac2-sportspred` · **Commit base:** `a067d25`

This report is produced by reading the committed files in `data/` and running the
engines over them. Every number below was measured, not estimated. Nothing here is
inferred from memory or from any external source that is not linked.

The purpose is the one the brief asks for: **flag irregularities for manual review**
and **provide links so each one can be checked**.

---

## How to reproduce every figure in this report

```bash
npm install
npm test                                       # 896 tests
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/verify_site.mjs
python3 scripts/build_data.py --strict
```

The per-sport coverage counts were measured with the engines directly; see
"Measurement method" at the end of each section.

---

## Summary table

| Sport | Fixtures in `data/` | Publishable tips | Status |
|---|---|---|---|
| Handball | 24 across 6 dates | **37 of 48** on 2026-09-02 | Healthy |
| Volleyball | 216 (180 upcoming) | **0 of 432** | **Blocked — see IRR-002** |
| Ice hockey | 104 upcoming | **0 of 312** | **Blocked — see IRR-003** |

A "publishable tip" is one the writer emitted as a styled recommendation rather
than a `SKIP`. A `SKIP` is not a bug — it is the no-hallucination rule working.
But a sport at **zero** publishable tips means the upstream collection is
incomplete, and that is worth flagging.

---

## IRR-001 — The OLBG sports directory snapshot is stale and cannot be refreshed here

**Severity:** Medium · **Blocks:** the "collect all currently available OLBG markets" requirement

`data/olbg_sports.json` carries `fetched_at_utc: 2026-09-04T04:46:21Z` and lists
20 sports. Two of the per-sport slate snapshots contain **zero events**:

| Slate file | `fetched_at_utc` | Events | Source URL |
|---|---|---|---|
| `data/olbg_sports.json` | 2026-09-04T04:46:21Z | 20 sports | <https://www.olbg.com/sitemap-betting-tips.xml> |
| `data/handball_slate.json` | 2026-09-01T22:00:00Z | 20 | <https://www.olbg.com/betting-tips/Handball/20> |
| `data/cricket_slate.json` | 2026-09-04T04:05:07Z | 3 | <https://www.olbg.com/betting-tips/Cricket/7> |
| `data/volleyball_slate.json` | 2026-09-04T04:06:15Z | **0** | <https://www.olbg.com/betting-tips/Volleyball/21> |
| `data/ice_hockey_slate.json` | 2026-09-04T01:26:44Z | **0** | <https://www.olbg.com/betting-tips/Ice_Hockey/13> |

**Why it cannot be fixed from this environment.** The build sandbox has no
outbound network route to OLBG or ESPN. Verified directly: `curl` to
`olbg.com` and `espn.com` both return status `000` (no connection), while
`https://api.github.com/` returns `200`. Live collection therefore only ever
happens in two places: **GitHub Actions CI** (`.github/workflows/precompute.yml`)
and **the visitor's own browser** when they load the site.

**Action for review:** run the `precompute` workflow on GitHub to refresh the
slates. If volleyball and ice hockey still return zero events afterwards, the
OLBG category pages genuinely have no listed markets at that moment (both sports
are between seasons on the committed dates), and the zero is correct rather than
a collection failure. That distinction cannot be settled from inside the sandbox.

---

## IRR-002 — Volleyball publishes zero tips: the sourced inputs are almost entirely absent

**Severity:** High · **Affects:** all 180 upcoming volleyball fixtures

Running the volleyball engine over every upcoming fixture in
`data/volleyball_matches.json` produces **0 publishable tips out of 432**. Every
market lands on `SKIP`. The missing-factor tally, counted across the 180 upcoming
fixtures, is:

| Missing factor | Fixtures affected |
|---|---|
| `attacking` (kills per set / league attacking rank) | 180 of 180 |
| `odds` (moneyline from at least two bookmakers) | 180 of 180 |
| `odds` (near-even contest indicator for 3-2) | 180 of 180 |
| `h2h` (head-to-head over last 3 years with set scores) | 179 of 180 |
| `h2h.setScores` (straight-set H2H indicator) | 179 of 180 |
| `homeRecord` (home win rate this season) | 178 of 180 |
| `form.last5` (last 5 results) | 178 of 180 |
| `form.last5SetScores` (set scores of last 5) | 178 of 180 |

**Root cause.** `data/volleyball_tape.json` holds only **41 completed matches**,
all from a single competition family (`eurovolley-w`). The form, H2H and
set-score helpers in `engine/volleyball_data.js` filter the tape by `family`, so
any fixture outside that one family finds no history at all and every
history-derived factor is recorded as missing. There is no odds feed committed
for volleyball at all.

**This is correct behaviour, not a defect in the writer.** The engine is refusing
to publish rather than guessing, which is exactly the no-hallucination rule. The
gap is in collection.

**Action for review:** the tape needs to cover the same competitions as the
fixture list before volleyball can publish. Fixture source links are committed
per match, e.g.
<https://en.wikipedia.org/wiki/2026_Women's_European_Volleyball_Championship>,
and results are cross-referenced at
<https://www.the-sports.org/volleyball-european-championship-women-2026-epr139365.html>.

---

## IRR-003 — Ice hockey publishes zero tips: preseason fixtures with no goalie, odds or shot data

**Severity:** High · **Affects:** all 104 upcoming NHL fixtures

Running the ice hockey engine over every fixture in
`data/ice_hockey_fixtures.json` produces **0 publishable tips out of 312**. Each
of the 104 fixtures is vetoed by the Step 3 floor:

| Veto reason | Fixtures |
|---|---|
| score 6 is below the 50 point Step 3 floor | 63 |
| score 10 is below the 50 point Step 3 floor | 22 |
| score 2 is below the 50 point Step 3 floor | 19 |

The missing-factor tally is near-total:

| Missing factor | Fixtures affected |
|---|---|
| `form.last5` | 104 of 104 |
| `odds.moneyline` (from at least two books) | 104 of 104 |
| `goaltender.savePctg` (confirmed starter) | 104 of 104 |
| `shotsForRank` / `shotsAgainstRank` | 104 of 104 |
| `puckLineCovers` (last 10 games) | 104 of 104 |
| `powerPlayOpportunitiesPerGame` | 104 of 104 |
| `recentTotals` (O/U record last 5) | 104 of 104 |
| `avgWinMarginLast5Wins` | 100 of 104 |

**Four distinct root causes, each verified:**

1. **The results tape is nearly empty.** `data/ice_hockey_tape.json` contains
   **3 games**, all from the previous season's playoffs (`gameType: 3`, dated
   2026-06-09). Form, back-to-back flags, H2H and puck-line covers are all
   derived from this tape, so all of them come back null. Meanwhile
   `data/ice_hockey_fixtures.json` reports `{"fixtures": 104, "results": 3,
   "withOdds": 0}` — confirming both the empty tape and the total absence of odds.

2. **The goalie file is empty — the collector was silently rate limited.**
   `data/ice_hockey_goalies.json` has `counts: {"teams": 0}`. Inspecting its
   `endpoints` array shows the real cause: **19 of the 32 club-stats requests
   returned HTTP `429` (rate limited)** and only 13 returned `200`. The
   collector had no retry, so those 19 were simply dropped; the 13 that did
   succeed published no goaltender rows for that season/game type. The run then
   wrote an empty file and **reported success**, which is the worst failure mode
   — it looks identical to "there is genuinely no data".

   **Fixed in this commit.** `scripts/collect_ice_hockey_nhl.mjs` now retries on
   `429`/`5xx` with exponential backoff, honours `Retry-After`, fails fast on
   `4xx` where a retry cannot help, drops burst concurrency from 4 to 2, records
   the attempt count per endpoint in provenance, and writes an explicit
   `irregularities` block plus a console warning when no goaltender is captured.
   Six regression tests in `tests/ice_hockey_collector.test.mjs` pin the
   behaviour. The fix cannot be exercised here (no network); it will take effect
   on the next CI run.

3. **Shot and special-teams ranks are not published by the endpoint used.**
   All 32 teams in `data/ice_hockey_standings.json` have
   `shotsForPerGame: null`. The file documents this itself: *"Shots for/against
   per game, power play % and penalty kill % are not published by this endpoint.
   They stay null and the engine records them as missing."* This one is honest
   and correctly disclosed — it needs a different NHL endpoint, not a bug fix.

4. **The collector overwrote committed data when merely imported.**
   Discovered while writing these tests: `scripts/collect_ice_hockey_nhl.mjs`
   called `main()` at module scope, so any `import()` of the file started a live
   collection. With no network in this sandbox that run wrote **zero fixtures**
   over `data/ice_hockey_fixtures.json` and emptied `data/ice_hockey_tape.json`.
   Both files were restored from git and the module now only runs `main()` when
   executed directly as an entrypoint. This is why a test file must never be
   able to trigger a collection.

**Action for review:** the rate-limit fix (cause 2) ships in this commit but can
only be confirmed by a CI run with network access. Sources for manual verification:
<https://api-web.nhle.com/v1/standings/now> and
<https://api-web.nhle.com/v1/club-stats/COL/20252026/2>.

---

## IRR-004 — `baseball-page.js` fetches a file that is not committed — **RESOLVED**

**Severity:** Low · **Pre-existing** · **Fixed**

`assets/js/baseball-page.js:102` fetched `data/baseball_provenance.json`, which
did not exist in the repository, so the Sources panel on the baseball page
always rendered *"No provenance document committed."* Every other sport emits
its register from its collector, but `scripts/collect_baseball_mlb.mjs` writes
its five data documents and never wrote one.

**Fix.** `scripts/build_baseball_provenance.mjs` now derives the register from
the endpoint arrays already recorded inside the committed baseball documents,
plus a replay of the scoring engine to count missing factors. Nothing in the
file is hand-entered, so it cannot drift from the data it describes:

- **3 sources** — `statsapi.mlb.com` (267 requests, 267 ok), `site.api.espn.com`
  (43/43), and the OLBG baseball index. All requests in the committed run
  returned HTTP 200.
- **Coverage** — 23 dates, `2026-09-04` … `2026-09-26`, 294 fixtures scored,
  882 tips generated, 113 published, 769 skipped.
- **12 missing factors**, each with the number of fixtures it affects.
- **5 irregularities**, each carrying an `evidence` field naming the file and
  key that proves it.

The OLBG slate collector records no HTTP status code, so that source carries
`status: null` rather than an assumed `200`, and the page renderer was changed
to omit the status rather than print `HTTP null`.

`validate_baseball_provenance` in `scripts/build_data.py` now guards the file
under `--strict`: sources must be https, state what they provide and carry a
verification timestamp; a recorded status may be absent but may not be a
failure; and `coverage.fixtures_scored` must equal the committed fixture count
with the tip arithmetic reconciling. 14 Python tests and 9 Node tests cover it.

`node scripts/verify_site.mjs` is now clean: *"checked 21 pages, 106 modules,
130 JSON files — no problems found."*

## IRR-005 — Every OLBG collector reported a failed fetch as an empty schedule — **RESOLVED**

**Severity:** High · **Systemic — all 12 OLBG collectors** · **Fixed**

**Finding.** Each OLBG parser records a warning when an *individual* row is
malformed, but none of them said anything when it found **no rows at all**. A
Cloudflare interstitial, a cookie wall, a truncated body, a redirect shell and a
genuine off-season all produced `events: []` with `warnings: []`. The collector
then wrote an empty slate and exited 0, so a blocked scrape was indistinguishable
from "this sport has no fixtures today".

Reproduced against all twelve parsers by feeding each an empty body, a
Cloudflare page and a cookie wall:

```
parser         empty        bot-block    cookie-wall
baseball       ev=0,w=0     ev=0,w=0     ev=0,w=0
cricket        ev=0,w=0     ev=0,w=0     ev=0,w=0
... (all 12 identical)
```

This is what produced the three zero-event slates — `baseball_slate.json`,
`ice_hockey_slate.json` and `volleyball_slate.json` — with nothing recorded to
explain them. It is the same class of defect as the NHL collector writing an
empty file and exiting 0 (see the standing note below): **a green summary line
is not evidence of success.**

**Ruled out.** The parsers themselves are sound. The baseball parser run against
the committed capture returns four fully-populated events; the ice hockey parser
returns three. The failure was in the collectors' inability to interpret an
empty result, not in their ability to read a populated page.

**Fix.** `scripts/lib/olbg_page_health.py` classifies the delivered bytes into
`ok`, `empty-slate`, `blocked`, `truncated` or `not-a-sport-page`, and every one
of the twelve collectors now writes the verdict to a `page_health` key and
appends any warning to the document. Design decisions worth noting:

- **An empty slate is still a legitimate outcome.** Sports do have off-seasons,
  so the guard does not fail on empty — it makes the *reason* observable. Only a
  full, recognisably-OLBG page that lists nothing is reported as `empty-slate`,
  and that verdict is marked healthy.
- **A page that produced rows is always trusted**, so a consent banner on a
  working page cannot void real fixtures.
- **Signatures are matched against visible text, not script bodies**, so
  analytics code that merely contains the word `captcha` cannot fake a block.
- Every verdict carries the `evidence` that produced it (byte count, matched
  signature) so any claim in a slate can be traced back to the page.

**Verified.** All 12 collectors now return `blocked` for an intercepted page and
`empty-slate` for a genuine off-season, and the committed captures still parse
with zero spurious warnings. Covered by 14 tests in
`tests/test_olbg_page_health.py`.

---

## What is verified healthy

- **Handball** is the one sport with complete committed inputs, and it publishes
  **37 styled tips from 48** on 2026-09-02 with **zero validator violations**
  across 2026-09-02, 2026-09-03 and 2026-09-04. The 11 `SKIP`s are genuine
  below-threshold verdicts.
- **All automated checks pass** at `a067d25`: 896 Node tests (including the
  jsdom DOM suite, 0 skipped), 96 Python tests, `verify_site.mjs` clean apart
  and `build_data.py --strict` reporting *"All committed data files are
  well-formed, complete, and provenance-verified."* IRR-004 is now resolved, so
  `verify_site` reports no problems at all.
- **The Generate button works.** A jsdom boot of `pro.html` with the committed
  data renders 48 handball tips on click, confirmed this session.

---

## Standing note on the no-hallucination rule

Two of the three blocked sports above are blocked *because* the engines refuse to
publish without sourced inputs. That is the intended design: a `SKIP` with a
stated reason is the correct output when the data is not there. The writers were
rewritten so that a clause whose input is null is **omitted entirely** rather
than filled with plausible-sounding prose, and the regression tests in
`tests/handball_writer.test.mjs`, `tests/ice_hockey_writer.test.mjs` and
`tests/volleyball_writer.test.mjs` assert exactly that — they strip the inputs
and require the clauses to disappear.

The honest reading of this report: **the prediction quality problem is solved for
handball and the machinery is in place for hockey and volleyball, but those two
sports cannot publish until their collectors are fixed.**
