# NPB — Sources

Every page the NPB layer reads, with the URL a reviewer can open. All are
official Nippon Professional Baseball pages (npb.jp); none needs a key. The
field maps are quoted in [`engine/npb_source.js`](../engine/npb_source.js)
next to the URL each came from.

**How they were verified.** The development sandbox has no outbound network,
so each page was read on **2026-09-03** through a page-rendering fetch and the
rendered text was saved verbatim as a dated capture under
`tests/fixtures/npb_*.CAPTURE.md` (header = URL + fetch date, body = the page
as rendered). The parsers are proven against those captures in
`tests/npb_source.test.mjs`, and the committed `data/npb_*.json` documents were
built from them by `scripts/build_npb_seed.mjs` (`mode: "seed"`). The CI
collector `scripts/collect_npb.mjs` reads the live HTML and replaces the seed
on its first green run; it refuses to overwrite the committed documents if the
live parse shrinks the tape, loses standings rows or produces no fixtures
(`NPB-PARSE-DRIFT`).

## npb.jp English BIS (results tape, standings)

| Page | What it supplies | Review link |
|---|---|---|
| `https://npb.jp/bis/eng/2026/calendar/index_MM.html` | Month grid of every game: `HOME score - score AWAY` with a link to the English box score; `S * - * C` marks a postponement; unplayed rows carry the JST first pitch. Home club is listed first (confirmed against the Japanese schedule and box headers). | [July](https://npb.jp/bis/eng/2026/calendar/index_07.html) · [August](https://npb.jp/bis/eng/2026/calendar/index_08.html) · [September](https://npb.jp/bis/eng/2026/calendar/index_09.html) |
| `https://npb.jp/bis/eng/2026/games/gm2026MMDD.html` | Day page linking each game's English box score | [2026-09-03](https://npb.jp/bis/eng/2026/games/gm20260903.html) |
| `https://npb.jp/bis/eng/2026/games/s2026MMDD0NNNN.html` | English box score: header `Game NN ( Team: W - L (T) )`, venue, start time, attendance, linescore, batting and pitching (IP, BF, H, BB, HB, SO, ER; W/L/H/S markers) | [F 1-1 H, 2026-09-02](https://npb.jp/bis/eng/2026/games/s2026090201768.html) |
| `https://npb.jp/bis/eng/2026/stats/std_c.html` / `std_p.html` | Central / Pacific standings: W, L, **T**, PCT, GB, home/road, per-opponent W-L-T, interleague | [Central](https://npb.jp/bis/eng/2026/stats/std_c.html) · [Pacific](https://npb.jp/bis/eng/2026/stats/std_p.html) |
| `https://npb.jp/bis/eng/2026/stats/idp1_<code>.html` | Team pitching register (season lines; `*` = left-handed) — used for handedness only | [Hawks](https://npb.jp/bis/eng/2026/stats/idp1_h.html) |
| `https://npb.jp/bis/eng/2026/stats/idb1_<code>.html` | Team batting register (season lines, no team totals row) | [Swallows](https://npb.jp/bis/eng/2026/stats/idb1_s.html) |

Club codes on npb.jp: `T` Hanshin, `G` Yomiuri, `DB` Yokohama DeNA, `S` Tokyo
Yakult, `C` Hiroshima, `D` Chunichi (Central); `H` SoftBank, `L` Seibu,
`F` Nippon-Ham, `B` ORIX, `M` Lotte, `E` Rakuten (Pacific).

Captured 2026-09-03 (page header dated Wednesday, September 2, 2026):
Central — T 69-50-1, G 64-55-2, DB 55-62-3, S 53-66-1, C 49-64-4, D 52-71-1;
Pacific — H 73-44-3, L 69-50-3, F 68-53-2, B 57-63-2, M 53-60-3, E 47-71-1.

## npb.jp Japanese pages (announced starters, weather, pitching lines)

| Page | What it supplies | Review link |
|---|---|---|
| `https://npb.jp/games/2026/schedule_MM_detail.html` | Per-game rows: date, card (home first), venue + JST start, remarks (`予備日` reserve dates, neutral sites such as 秋田/盛岡/ほっと神戸), and either the decision (勝/敗/分 pitchers) for played games or **予告先発** announced starters plus a JMA weather icon for upcoming games. Footer: 「（天気）出典：気象庁HP」. Runs about a day ahead of the English BIS. | [September](https://npb.jp/games/2026/schedule_09_detail.html) |
| `https://npb.jp/scores/2026/MMDD/<home>-<away>-<n>/box.html` | Japanese live box score published the same evening: header (date, venue, 試合終了), start/end/duration/attendance, away section first, pitching table 投手 / 投球数 / 打者 / 投球回 / 安打 / 本塁打 / 四球 / 死球 / 三振 / 暴投 / ボーク / 失点 / 自責点; first row is the starter | [S 4-7 T, 2026-09-03](https://npb.jp/scores/2026/0903/s-t-21/box.html) |
| `https://npb.jp/img/common/weather/NN.gif` | Weather icon codes mapped in `WEATHER_ICON` (02 sunny then cloudy · 08 cloudy · 10 cloudy with rain · 15 rain · 17 rain with breaks · 20 rain then cloudy) | shown inline on the schedule page |

Venue enclosure table (`VENUE_ROOF`): dome — Tokyo Dome, Vantelin Dome,
Kyocera Dome, Belluna Dome; retractable — ES CON FIELD, Mizuho PayPay Dome;
open — Yokohama, Koshien, Mazda Stadium, Jingu, ZOZO Marine, Rakuten Mobile
Park, plus the regional open-air sites (Akita, Morioka, Hotto Motto Kobe).

## Cross-checks

- Calendar score vs Japanese box-score score for the same game must agree;
  a mismatch raises `NPB-XCHECK` (high) and blocks the collector commit.
- Home/away orientation was confirmed three ways: calendar first code,
  Japanese schedule left-hand club, box-score header order.
- Draw handling: `F 1 - 1 H` (2026-09-02, 12 innings) appears as a draw on the
  calendar, as 分 on the schedule, and as a tie in both standings rows.

## What is **not** sourced (and never invented)

| Prompt input | Why not | Register |
|---|---|---|
| Three-way moneyline / run line / total prices | No key-less NPB price feed exists; OLBG lists no NPB rows | `IR-NPB-01` |
| Opposing lineup vs starter handedness (last 30 days) | Not published by npb.jp | `IR-NPB-03` |
| Wind direction and speed | Only the JMA forecast icon is published | `IR-NPB-04` |
| Per-game foreign-player registrations | Not published in a parseable feed | `IR-NPB-05` |
| Recent Over/Under trends | Requires a posted total line | `IR-NPB-01` |

## Other feeds checked and rejected

- `statsapi.mlb.com/api/v1/schedule?sportId=31` — returns no games (NPB is not
  carried).
- ESPN site API — no NPB league; `baseball/npb` returns 400.
- OLBG Baseball tips index (`/betting-tips/Baseball/12`) — MLB rows only,
  no prices, zero NPB rows (checked 2026-09-03).
