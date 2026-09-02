# Volleyball sources

Every volleyball figure on this site is traceable to one of the feeds below. A missing feed is listed in `missing[]` and scored as zero — never estimated.

| Source | What we take | What we do not take | Review |
|---|---|---|---|
| ESPN site API `volleyball/womens-college-volleyball` and `mens-college-volleyball` | Fixtures, live/final status, records, curated rank, competitor.form, **linescores as set points** | Kills/blocks per set, multi-book odds (oddsSeen was false on 2026-09-02) | [scoreboard](https://site.api.espn.com/apis/site/v2/sports/volleyball/womens-college-volleyball/scoreboard) |
| the-sports.org Women's European Championship 2026 | Pool A/C set scores and dates for EuroVolley Women | Invented set lines when the print is incomplete | [epr139365](https://www.the-sports.org/volleyball-european-championship-women-2026-epr139365.html) |
| Wikipedia 2026 Women's European Volleyball Championship | Knockout pairing and 3 September quarter-final date | Kickoff UTC (OLBG clocks are untrusted) | [page](https://en.wikipedia.org/wiki/2026_Women's_European_Volleyball_Championship) |
| OLBG `/betting-tips/Volleyball/21` | Event list, Win Match / Set Score market names, tipster consensus (display only) | Prices, calendar placement from relative "Tomorrow" labels | [index](https://www.olbg.com/betting-tips/Volleyball/21) |
| CEV / FIVB | Official-body links for review | No key-less JSON used | [CEV](https://www.cev.eu/) · [FIVB](https://www.fivb.com/) |

## Competition families (never mixed)

- `ncaa` — ESPN college volleyball only.
- `eurovolley-w` — committed CEV Women's Euro 2026 tape only.

Poland vs Netherlands on 3 September 2026 is EuroVolley. It is not scored from Nebraska, Wisconsin, or any other NCAA side.

## Markets in scope

The master prompt scores **WIN MATCH** and **SET SCORE** (`3-0` / `3-1` / `3-2`) only. OLBG Total Points and Points Handicap are listed for review and never scored.
