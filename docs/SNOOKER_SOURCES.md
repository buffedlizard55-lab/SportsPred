# Snooker sources — every feed, verified, with review links

The snooker layer implements **SNOOKER PREDICTION MASTER PROMPT v3.0**. It is
built on official data: the World Snooker Tour (WST) ranking table is the
sport's ranking authority, snooker.org's results database (maintained by
Hermund Årdalen) is the public results authority, and OLBG is the market/slate
index. All endpoints below are public and key-less and were verified working
on **2026-09-02**.

## Step 1 inputs → source map

| Prompt requirement (Step 1) | Source | Endpoint / page | Verified |
|---|---|---|---|
| Fixture/slate of today's matches | OLBG snooker tips index (market rows + tipster consensus) | `https://www.olbg.com/betting-tips/Snooker/8` | ✅ event link, kick-off label, consensus selection, tip counts |
| Current betting odds (odds strength) | — | no free key-less feed | ❌ **never scored** (IR-SNOOKER-01); OLBG server HTML carries no prices |
| Recent form (last 5 completed matches) | snooker.org player season pages | `https://www.snooker.org/res/index.asp?player={id}&season=2026` (Pang id 1257, Joyce id 48) | ✅ every row with score, round, opponent |
| Head-to-head record | snooker.org H2H page | `https://www.snooker.org/res/index.asp?player1=1257&player2=48&season=-1` | ✅ shows only the upcoming fixture → zero previous meetings (IR-SNOOKER-07) |
| Official world ranking | WST rankings page | `https://www.wst.tv/rankings/abfba8fe-1423-5a2a-a96b-d77e8b413ca8?showLive=false` | ✅ full top-36 snapshot, prize money included |
| Tournament stage + prize | snooker.org event page | `https://www.snooker.org/res/index.asp?event=2547` | ✅ Rd3 = Last 32, loser £6,000 |
| Tournament name, venue, dates | snooker.org event page | same | ✅ The Centaur, Cheltenham, 31 Aug – 6 Sep 2026 |
| Start time | WST match centre + OLBG + BBC + snooker.org | see IR-SNOOKER-03 | ⚠️ sources disagree (15:00 / 17:00 / 21:00 / 16:00 NY) — `start_utc` left null, never inferred |
| Frame-by-frame results | BBC Sport snooker results | `https://www.bbc.com/sport/snooker/results` | ✅ confirms match dates; no per-frame data |
| CueTracker player/H2H pages | — | cuetracker.net player pages | ❌ pages render JS-only shells via the fetch tool — manual-review link only (IR-SNOOKER-06) |
| snooker.org REST API | — | `https://api.snooker.org/` | ❌ HTTP 401.5 (auth required) — use the HTML pages (IR-SNOOKER-04) |
| WST player profile pages | — | `https://www.wst.tv/players/…` | ❌ 404 for the players checked — use match-centre/ranking URLs (IR-SNOOKER-04) |

## Manual review links

- WST official rankings:
  <https://www.wst.tv/rankings/abfba8fe-1423-5a2a-a96b-d77e8b413ca8?showLive=false>
- WST match centre (Pang v Joyce, Rd3):
  <https://www.wst.tv/match-centre/4e7a310c-d41f-4042-bec2-77f20b24dd04>
- snooker.org British Open event:
  <https://www.snooker.org/res/index.asp?event=2547>
- snooker.org British Open results stream (newest first):
  <https://www.snooker.org/res/index.asp?template=22&event=2547>
- snooker.org live scores:
  <https://www.snooker.org/res/index.asp?template=21&event=2547>
- snooker.org Pang Junxu season 2026:
  <https://www.snooker.org/res/index.asp?player=1257&season=2026>
- snooker.org Mark Joyce season 2026:
  <https://www.snooker.org/res/index.asp?player=48&season=2026>
- snooker.org H2H Pang v Joyce:
  <https://www.snooker.org/res/index.asp?player1=1257&player2=48&season=-1>
- OLBG snooker index:
  <https://www.olbg.com/betting-tips/Snooker/8>
- OLBG Pang v Joyce event:
  <https://www.olbg.com/betting-tips/Snooker/All_Snooker/All_Events/Pang_Junxu_v_Mark_Joyce/8?event_id=9573>
- BBC Sport snooker results: <https://www.bbc.com/sport/snooker/results>

## Data shapes (verified)

**OLBG index** — list-item blocks with an event anchor
(`…/Snooker/All_Snooker/All_Events/{slug}/8?event_id=9573`), a Today/Tomorrow
kick-off label, the current tipster-consensus selection ("Mark Joyce to win
4-2"), the market it belongs to ("Frame Betting"), and "x/y Win Tips" plus a
percentage. The event page renders the same selection blocks under market
headers (Win Match, Handicap Betting, Frame Betting); full per-selection
tables hydrate client-side, so the collector records what is visibly printed.

**snooker.org results** — rows with the two player links (player IDs), score,
round link and optional WST match-centre "Details" link. Times shown are
**registration times in America/New_York** — never converted, never treated
as start times (IR-SNOOKER-05, IR-SNOOKER-08).

**WST rankings** — official list of ranks 1+ with prize money; Joyce is not on
it (amateur, IR-SNOOKER-02) and Pang is ranked 27.

## Honesty constraints

- No value is ever invented. A missing factor is recorded in `missing[]`,
  shown in the analysis panel, and lowers the confidence ceiling.
- OLBG tipster votes are display-only market context and are **never** fed
  into scoring.
- No price appears anywhere in the snooker documents: the collector tests,
  build validation and the write path all reject price-like fields.
- Snooker.org registration times are never converted to UTC; the start time
  is left `null` because the public sources disagree (IR-SNOOKER-03).
