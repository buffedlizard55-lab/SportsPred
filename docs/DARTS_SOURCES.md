# Darts sources — every feed, verified, with review links

The darts layer implements **DARTS PREDICTION MASTER PROMPT v1.0**. It is
built on public data: dartsrankings.com republishes the two-year PDC Order of
Merit, Wikipedia's event pages carry printed match scores and (when stated)
three-dart averages, and OLBG is the market/slate index. All endpoints below
are public and key-less and were verified working on **2026-09-03**.

## Step 1 inputs → source map

| Prompt requirement (Step 1) | Source | Endpoint / page | Verified |
|---|---|---|---|
| Fixture/slate of today's matches | OLBG darts tips index (market rows + tipster consensus) | `https://www.olbg.com/betting-tips/Darts/15` | ✅ two outrights on 2026-09-03 (World Series Finals `event_id=31293`, PDC WC 2027 `event_id=26023`); no two-player match events |
| Current betting odds (odds strength) | — | no free key-less feed | ❌ **never scored** (IR-DARTS-01); OLBG server HTML carries no prices |
| Recent form (last 5 completed matches) | Wikipedia Hungarian Darts Trophy match reports | `https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy` | ✅ 30 printed matches, 28–30 Aug 2026 |
| 3-dart average | same Wikipedia reports, only when printed | same | ⚠️ stored only when the source prints a figure (IR-DARTS-02) |
| Head-to-head record | same tape | same | ✅ zero meetings = missing, never "even" |
| Official Order of Merit | dartsrankings.com PDC Live OoM | `https://www.dartsrankings.com/` | ✅ top-40 snapshot dated 30 Aug 2026 after ET11; Ross Smith 15th (£555.75k) |
| Tournament stage | Wikipedia round labels | same | ✅ First / Second / Third round, QF, SF, Final |
| Checkout %, 180s, first-9 | — | no free structured source | ❌ not scored (IR-DARTS-07) |
| Czech Open pairings | Wikipedia 2026 Czech Darts Open | `https://en.wikipedia.org/wiki/2026_Czech_Darts_Open` | ❌ seeded field only; pairings **never invented** (IR-DARTS-06) |
| PDC.tv player / ranking pages | — | `https://www.pdc.tv/players` | ❌ JS-rendered; review link only (IR-DARTS-03) |

## Manual review links

- OLBG darts index: <https://www.olbg.com/betting-tips/Darts/15>
- OLBG World Series Finals outright: <https://www.olbg.com/betting-tips/Darts/All_Darts/All_Events/World_Series_of_Darts_Finals/15?event_id=31293>
- Wikipedia 2026 Hungarian Darts Trophy: <https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy>
- Wikipedia 2026 Czech Darts Open: <https://en.wikipedia.org/wiki/2026_Czech_Darts_Open>
- dartsrankings.com PDC Live Order of Merit: <https://www.dartsrankings.com/>
- PDC official site: <https://www.pdc.tv/>
- PDC players / Order of Merit: <https://www.pdc.tv/players>

## Data shapes (verified)

**OLBG index** — list-item blocks with an event anchor
(`…/Darts/All_Darts/All_Events/{slug}/15?event_id=31293`), a date/time label
("17 Sept 13:15"), the current tipster-consensus selection, the market it
belongs to ("Win Tournament"), and "x/y Win Tips" plus a percentage. No price
field exists.

**Wikipedia results** — printed scores with optional three-dart averages.
Unprinted later-round scores are omitted rather than reconstructed from
seed-exit labels (IR-DARTS-05).

**dartsrankings.com** — public table of ranks 1+ with prize money in £1,000
units (Littler = 3125.5 = £3,125,500). Snapshot used here is after ET11.

## Honesty constraints

- No value is ever invented. A missing factor is recorded in `missing[]`,
  shown in the analysis panel, and lowers the confidence ceiling.
- OLBG tipster votes are display-only market context and are **never** fed
  into scoring.
- No price appears anywhere in the darts documents: the collector tests,
  build validation and the write path all reject price-like fields.
- Czech Open pairings are never synthesised from a seed list.
