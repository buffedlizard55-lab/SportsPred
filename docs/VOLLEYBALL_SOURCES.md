# FIVB VNL Women sources and collection boundaries

This page lists what the VNL Women model is permitted to read. Every collector row needs a direct `https` review URL. A source page is **not** evidence for an individual match until the collector has parsed and preserved the relevant row.

| Source | Intended evidence | Current use | Manual review |
|---|---|---|---|
| FIVB — 2026 VNL match schedule announcement | Authoritative season window, hosts and schedule context | Season-status guard | [FIVB schedule announcement](https://www.fivb.com/volleyball-world-reveals-2026-vnl-match-schedule/) |
| Volleyball World VNL schedule & results | Individual fixtures, final results, set scores, pools and venues | Required source for `data/volleyball_vnl.json` result/fixture rows | [Schedule & results](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/schedule/) |
| Volleyball World VNL women’s standings | Match count, result split, VNL points, set/point ratios, Finals cut-off context | Required source for standings/stakes fields | [Women’s standings](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/standings/women/) |
| Volleyball World VNL statistics | Attacking, blocking and serving source review | Required source for the set-quality-gap inputs | [VNL statistics](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/statistics/) |
| Volleyball World VNL teams/news | Official roster and match-news review | Only confirmed match-specific availability can populate roster status | [Women’s teams](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/teams/women/) |
| OLBG volleyball index and event page | Open event discovery, market headings and community vote display | **Display-only market monitor. Never odds or model evidence.** | [Index](https://www.olbg.com/betting-tips/Volleyball/21) · [verified open event snapshot](https://www.olbg.com/betting-tips/Volleyball/All_Volleyball/All_Events/Turkiye_W_vs_Serbia_W/21?event_id=36520) |
| GamCare | Responsible-gambling support contact in Great Britain | Card footer after checked contact review | [GamCare support](https://www.gamcare.org.uk/get-support/talk-to-us-now/) |
| National Council on Problem Gambling | Responsible-gambling support contact in the United States | Card footer after checked contact review | [NCPG announcement](https://www.ncpgambling.org/news/1-800-my-reset-announcement/) |

## Sources explicitly rejected for VNL model scoring

- **OLBG tipster percentages:** votes are neither a named sportsbook price nor a statistical forecast supplied by the model. They stay out of every score.
- **ESPN NCAA volleyball:** different competition, player pool and calendar. It cannot contribute form, H2H, rank or a score to VNL Women.
- **EuroVolley, domestic club and generic volleyball rows:** different competition family. They cannot serve as a substitute VNL tape.
- **Search snippets, social posts and unsourced tables:** discovery aids only. They are never committed as player stats, roster status, match times, standings or results.

## Required source record for a future VNL row

```json
{
  "id": "official-match-id",
  "family": "vnl-women",
  "phase": "upcoming",
  "startUtc": "verified UTC timestamp",
  "home": "Team name",
  "away": "Team name",
  "context": { "week": 1, "pool": "Pool 1", "hostCity": "…" },
  "source_url": "https://en.volleyballworld.com/.../schedule/..."
}
```

A result row also requires `winner`, an oriented `setScore`, and its own source URL. A team-rate, roster, standing or price field likewise requires its own source URL/fetch time. Missing inputs remain missing; they are never backfilled from this document.
