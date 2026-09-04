# Championship League Snooker — sources, with review links

Every input the Championship League overlay uses, where it came from, and how
to check it by hand. All links are public and key-less. Verified
**2026-09-04**.

The overlay sits on top of the generic snooker layer; its feeds are documented
in [`SNOOKER_SOURCES.md`](SNOOKER_SOURCES.md) and remain in use for every
other snooker event.

## Primary source — pinned revision

The match tape and the published standings both come from a **single fixed
revision**, so the data can be re-derived exactly rather than re-scraped into
something different:

<https://en.wikipedia.org/w/index.php?title=2026_Championship_League_(ranking)&oldid=1364748219>
(revision 1364748219, 18 July 2026)

A pinned revision is used deliberately. A live page can change under the
build; an `oldid` cannot. Every match and table row in `data/snooker_cls.json`
carries this URL in its `source` field.

## Step 1 inputs → source map

| Prompt input | Source | Status |
|---|---|---|
| Every group match, scoreline and date | pinned revision above, transcribed to `data/raw/cls2026_matches.txt` | ✅ 253 matches |
| Published group standings | pinned revision above, transcribed to `data/raw/cls2026_tables.txt` | ✅ 168 rows across 42 groups |
| Order of play within a day | published match order in the tape | ✅ used for the no-look-ahead cutoff |
| Highest break | published group tables only | ⚠️ per group, never per match (IR-CLS-02) |
| Seed / ranking number | — | ❌ not published in table form; component scores missing (IR-CLS-08) |
| Current prices | — | ❌ no free key-less feed anywhere (IR-CLS-01) |
| Live market slate | OLBG snooker tips index | ✅ display only; vote shares, no prices |
| Event metadata (venue, dates, prize, format) | pinned revision + official site | ✅ Leicester Arena, 22 Jun – 15 Jul 2026, £328,000 |
| Invitational edition format | Wikipedia 2026 invitational article | ✅ groups of seven, best of five, no draws |
| Responsible-gambling helpline | GamCare | ✅ verified live before hard-coding |

## Manual review links

- Ranking edition (pinned): <https://en.wikipedia.org/w/index.php?title=2026_Championship_League_(ranking)&oldid=1364748219>
- Invitational edition: <https://en.wikipedia.org/wiki/2026_Championship_League_(invitational)>
- Championship League official site: <https://championshipleaguesnooker.co.uk/ranking/>
- World Snooker Tour: <https://www.wst.tv/>
- WST rankings: <https://www.wst.tv/rankings>
- snooker.org results: <https://www.snooker.org/res/index.asp>
- OLBG snooker tips: <https://www.olbg.com/betting-tips/Snooker/8>
- GamCare helpline: <https://www.gamcare.org.uk/get-support/talk-to-us-now/>

## Sources checked and rejected

| Source | Why not used |
|---|---|
| `api.snooker.org` | HTTP 401.5, requires authorisation — not key-less |
| ESPN public API | no snooker coverage of any kind |
| CueTracker | JavaScript-only shells; nothing server-rendered to verify against |
| Wikipedia `Championship_League_(snooker)` | no article exists at that title (IR-CLS-04) |
| Any odds aggregator | all require an API key |

## How verification works

`scripts/build_cls_snooker.mjs` does not trust the transcription. It parses
the raw match tape, **recomputes all 42 group tables from the scorelines
alone** under the published points rules, and compares every field of every
row against the published standings. Any single mismatch fails the build.

This is what caught IR-CLS-03: the first run failed with nine mismatches in
Group 3, which turned out to be a genuine expunged result rather than a
transcription error. Current state:

```
253 matches · 168 rows · 42 groups · 0 problems
```

Re-check at any time with `node scripts/build_cls_snooker.mjs --check`.

## Backtest

`scripts/backtest_snooker_cls.mjs` replays every card in date order under the
no-look-ahead rule and settles it against the published result
(`data/snooker_cls_backtest.json`):

| Market | Graded | Correct |
|---|---|---|
| CORRECT SCORE | 187 | 58 |
| MATCH RESULT | 4 | 1 |
| GROUP WINNER | 2 | 0 |
| **Total rows** | 545 | 193 graded, 352 skipped |

The skip rate is high and it is meant to be: with prices and seeds both
unavailable, thirty-five of the hundred match-result points cannot be scored,
so most match-result reads never clear the confidence floor. Group winner
names a pick only twice because the fifteen-point clearance rule is applied
honestly (IR-CLS-05).

**No return-on-investment figure is published.** There are no prices, so any
return figure would be invented. This is a model-accuracy report, not a
betting record.
