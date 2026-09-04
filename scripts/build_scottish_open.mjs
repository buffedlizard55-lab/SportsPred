#!/usr/bin/env node
/**
 * SportsPred — build data/golf_scottish_open.json.
 *
 * The venue dossier behind the SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0.
 * Two kinds of content, kept strictly apart:
 *
 *   VERIFIED  — every claim carries the source URL, the words that source uses
 *               and the date it was checked. Anything the prompt asserts about
 *               the event (host since 2019, title sponsor, the week before The
 *               Open, the closing stretch of the season points race, the range
 *               of winning scores) is checked here line by line.
 *   MEASURED  — the 2024/2025/2026 editions are read out of the committed ESPN
 *               results tape, so winner, score, field size, cut and yardage
 *               come from a row that carries its own leaderboard URL.
 *
 * Nothing is estimated. The next edition's dates are recorded as UNCONFIRMED
 * when no official source publishes them, with the secondary source named,
 * because the prompt itself says to confirm dates at the time of use.
 *
 * Usage:  node scripts/build_scottish_open.mjs [--check]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const RESULTS = join(DATA, 'golf_results.json');
const OUT = join(DATA, 'golf_scottish_open.json');

const VERIFIED_AT = '2026-09-04';

/** Line-by-line verification of the prompt's factual claims. */
export const FACTS = [
  {
    id: 'host-since-2019',
    claim: 'The Renaissance Club, North Berwick, Scotland has hosted the event since 2019.',
    status: 'CONFIRMED',
    source: 'https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/',
    evidence: '"The Genesis Scottish Open has reached new heights since finding its home at The Renaissance Club in 2019"; "The Renaissance Club to host Genesis Scottish Open through to 2030".',
    secondary: ['https://www.scotlandsgolfcoast.com/members/the-renaissance-club/ ("The Renaissance Club has hosted the Genesis Scottish Open since 2019.")'],
  },
  {
    id: 'host-tenure-to-2030',
    claim: 'The venue is confirmed as host through 2030, so the overlay does not go stale next season.',
    status: 'CONFIRMED',
    source: 'https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/',
    evidence: '"we are delighted to be able to call it our home through to 2030" — Rory Colville, Genesis Scottish Open Championship Director.',
    secondary: ['https://irishgolfer.ie/latest-golf-news/2026-04-22/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/'],
  },
  {
    id: 'title-sponsor',
    claim: 'The current title sponsor is Genesis (the event is the Genesis Scottish Open).',
    status: 'CONFIRMED',
    source: 'https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tickets-packages/',
    evidence: 'The DP World Tour event page is titled "Genesis Scottish Open", 09 - 12 Jul 2026, The Renaissance Club, North Berwick, Scotland.',
    secondary: ['https://www.europeantour.com/dpworld-tour/rolex/news/articles/detail/the-renaissance-club-to-host-genesis-scottish-open-through-to-2026/ ("Tournament boasts luxury automotive brand Genesis as title sponsor", 2 August 2022)'],
  },
  {
    id: 'week-before-the-open',
    claim: 'The event is played the week immediately before The Open Championship.',
    status: 'CONFIRMED',
    source: 'https://golfweek.usatoday.com/story/sports/golf/majors/british-open/2026-06-22/when-is-the-2026-open-championship-at-royal-birkdale/90641242007/',
    evidence: 'The 2026 PGA TOUR schedule ahead of the Open lists "Genesis Scottish Open, July 9-12" before The Open at Royal Birkdale, July 16-19.',
    secondary: [
      'https://en.wikipedia.org/wiki/2026_Open_Championship ("Dates: 16–19 July 2026, Royal Birkdale Golf Club")',
      'https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/ ("While The Open Championship takes place at Royal Birkdale…")',
    ],
  },
  {
    id: 'co-sanctioned',
    claim: 'The event is co-sanctioned by the DP World Tour and the PGA TOUR and counts on the Race to Dubai Rankings and the FedExCup.',
    status: 'CONFIRMED',
    source: 'https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/',
    evidence: '"Scotland\'s national open is co-sanctioned by the DP World Tour and PGA TOUR, counting on both the Race to Dubai Rankings delivered by DP World and the FedExCup".',
    secondary: ['https://trcaa.com/scottish-open/'],
  },
  {
    id: 'closes-the-season-points-race',
    claim: 'The event opens the closing stretch of the season-long points race, giving contenders extra incentive.',
    status: 'CONFIRMED',
    source: 'https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/',
    evidence: '"Starting with a Rolex Series event at the Genesis Scottish Open… it is the fifth of the five Global Swings on the Race to Dubai"; the Closing Swing table lists Jul 9-12, Genesis Scottish Open, 5,000 swing points.',
    secondary: ['https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tv-schedule ("Scotland\'s national open marks the start of the Closing Swing on the 2026 Race to Dubai.")'],
  },
  {
    id: 'open-qualification',
    claim: 'The winner earns a Masters invite and the leading finishers earn Open Championship places — a real incentive layer on top of the prize fund.',
    status: 'CONFIRMED',
    source: 'https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/',
    evidence: '"The winner of the Genesis Scottish Open will also earn an invite to the Masters Tournament, with the top three finishers not already exempt who make the cut qualifying for The Open."',
    secondary: ['https://en.wikipedia.org/wiki/2026_Open_Championship (Open Qualifying Series table lists "Genesis Scottish Open, 12 Jul 2026, 3 spots")'],
  },
  {
    id: 'winning-score-range',
    claim: 'Winning scores at this venue have ranged from the low twenties under par down to single figures under par — far wider than a typical tour stop.',
    status: 'CONFIRMED',
    source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/',
    evidence: 'Renaissance Club winners: 2019 −22, 2020 −11, 2021 −18, 2022 −7, 2023 −15. The 2024-2026 scores (−18, −15, −17) are measured directly from the committed ESPN results tape.',
    secondary: [
      'https://www.bettingsites.co/sports/golf/tournaments/scottish-open/ (same eight scores, same years)',
      'https://www.marca.com/en/golf/2026-07-12/genesis-scottish-open-winners-complete-list-of-winners-at-the-renaissance-club-1.html',
    ],
  },
  {
    id: 'layout-reroute-2026',
    claim: 'The championship layout was rerouted for 2026, so venue history across the reroute is not a like-for-like sample.',
    status: 'CONFIRMED',
    source: 'https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/',
    evidence: '"This season, the Championship layout will be rerouted to build an exciting closing stretch… the fan-favourite par 3 sixth hole The Thistle now becomes the 15th hole."',
    secondary: [],
  },
  {
    id: 'course-par-and-length',
    claim: 'The championship course is a par 70.',
    status: 'CONFIRMED',
    source: 'https://www.espn.com/golf/leaderboard?tournamentId=401811955',
    evidence: 'The committed ESPN leaderboard rows for the 2024, 2025 and 2026 editions all record par 70; yardage was 7,237 in 2024 and 7,282 in 2025 and 2026 (data/golf_results.json).',
    secondary: ['https://en.wikipedia.org/wiki/Scottish_Open_(golf) (infobox: Par 70)'],
  },
  {
    id: 'national-open-status',
    claim: 'This is the confirmed national open of the host nation, so the home-nation bonus is larger than a generic home-conditions adjustment.',
    status: 'CONFIRMED',
    source: 'https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/',
    evidence: '"Scotland\'s national open is co-sanctioned by the DP World Tour and PGA TOUR…"; the DP World Tour page calls it "Scotland\'s national open".',
    secondary: ['https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tv-schedule'],
  },
  {
    id: 'next-edition-dates',
    claim: 'The 2027 edition dates.',
    status: 'UNCONFIRMED',
    source: 'https://www.eventmasters.co.uk/golf-hospitality/scottish-open-hospitality.html',
    evidence: 'A hospitality reseller lists "Thursday 8 July to Sunday 11 July 2027 at The Renaissance Club". No DP World Tour, PGA TOUR or R&A page publishing 2027 dates was found as at the verification date, so this is recorded as unconfirmed and must be re-checked at the time of use.',
    secondary: [],
    irregularity: 'IR-GOLF-23',
  },
];

/** Winning scores at The Renaissance Club. 2019-2023 from the cited history
 *  tables; 2024 onwards MEASURED from the committed ESPN results tape. */
export const PUBLISHED_HISTORY = [
  { year: 2019, winner: 'Bernd Wiesberger', toPar: -22, margin: 'playoff', provenance: 'secondary', source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/' },
  { year: 2020, winner: 'Aaron Rai', toPar: -11, margin: 'playoff', provenance: 'secondary', source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/' },
  { year: 2021, winner: 'Min Woo Lee', toPar: -18, margin: 'playoff', provenance: 'secondary', source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/' },
  { year: 2022, winner: 'Xander Schauffele', toPar: -7, margin: '1 stroke', provenance: 'secondary', source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/' },
  { year: 2023, winner: 'Rory McIlroy', toPar: -15, margin: '1 stroke', provenance: 'secondary', source: 'https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/' },
];

const EVENT_NAME = /scottish open/i;

function editionsFromTape(resultsDoc) {
  const players = resultsDoc?.players || {};
  const out = [];
  for (const [eventId, ev] of Object.entries(resultsDoc?.events || {})) {
    if (!EVENT_NAME.test(ev.name || '')) continue;
    const rows = (ev.rows || []).map((r) => ({ athleteId: String(r[0]), position: r[1] ?? null, result: r[2] ?? null, toPar: r[3] ?? null, rounds: [r[4], r[5], r[6], r[7]] }))
      .filter((r) => r.position !== null)
      .sort((a, b) => a.position - b.position);
    const winner = rows[0] || null;
    out.push({
      eventId,
      year: Number(String(ev.startDate || '').slice(0, 4)) || null,
      name: ev.name,
      tour: ev.tour,
      tournamentId: ev.tournamentId != null ? String(ev.tournamentId) : null,
      startDate: ev.startDate,
      endDate: ev.endDate,
      courseName: ev.courseName,
      courseId: ev.courseId != null ? String(ev.courseId) : null,
      yards: ev.yards,
      par: ev.par,
      purse: ev.purse,
      fieldSize: ev.fieldSize ?? (ev.rows || []).length,
      cutCount: ev.cutCount ?? null,
      winner: winner ? { athleteId: winner.athleteId, name: players[winner.athleteId]?.name || null, country: players[winner.athleteId]?.country || null, toPar: winner.toPar, rounds: winner.rounds } : null,
      top5: rows.slice(0, 5).map((r) => ({ name: players[r.athleteId]?.name || null, country: players[r.athleteId]?.country || null, position: r.position, toPar: r.toPar })),
      provenance: 'measured',
      sourceUrl: ev.sourceUrl || `https://www.espn.com/golf/leaderboard?tournamentId=${eventId}`,
    });
  }
  return out.sort((a, b) => (a.year || 0) - (b.year || 0));
}

function build() {
  const resultsDoc = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : null;
  const editions = resultsDoc ? editionsFromTape(resultsDoc) : [];
  const measured = editions.map((e) => ({ year: e.year, winner: e.winner?.name || null, toPar: e.winner?.toPar ?? null, margin: null, provenance: 'measured', source: e.sourceUrl }));
  const scores = [...PUBLISHED_HISTORY, ...measured].filter((r) => r.year);
  const toPars = scores.map((r) => r.toPar).filter((v) => Number.isFinite(v));
  const warnings = [];
  if (!editions.length) warnings.push('no Scottish Open edition is present in the committed results tape yet; the venue history panel will be empty until the golf collector runs');
  const years = editions.map((e) => e.year);
  for (let y = 2019; y <= new Date().getUTCFullYear(); y += 1) if (!years.includes(y) && !PUBLISHED_HISTORY.some((r) => r.year === y)) warnings.push(`${y}: no verified winning score recorded for this edition`);

  return {
    schema_version: 1,
    sport: 'Golf',
    event: {
      key: 'scottish-open',
      name: 'Genesis Scottish Open',
      prompt: 'SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0',
      promptDoc: 'docs/SCOTTISH_OPEN_MASTER_PROMPT.md',
      reviewDoc: 'docs/SCOTTISH_OPEN_PROMPT_REVIEW.md',
      ruleset: 'SCOTTISH-OPEN-v1.0',
      host: 'The Renaissance Club, North Berwick, East Lothian, Scotland',
      espnCourseId: '10906',
      espnTournamentId: '4161',
      tours: ['pga', 'eur'],
      olbg: [
        { label: 'OLBG Golf betting tips index', url: 'https://www.olbg.com/betting-tips/Golf/5' },
        { label: 'OLBG All Golf — All Events', url: 'https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/5' },
      ],
    },
    verified_at_utc: VERIFIED_AT,
    facts: FACTS,
    venue_history: {
      note: '2019-2023 winning scores are taken from the cited published history tables (secondary sources). Editions present in the committed ESPN results tape are measured directly from leaderboard rows and carry their own source URL. Nothing is estimated.',
      rows: scores,
      winningScoreRange: toPars.length ? { best: Math.min(...toPars), worst: Math.max(...toPars), sample: toPars.length } : null,
    },
    editions,
    warnings,
    irregularities: [
      { id: 'IR-GOLF-17', note: 'Odds for the win, first-round-leader, top American, top European and top GB & Ireland markets are not published by any free key-less source; OWGR rank within the field stands in for market favouritism, and the two-bookmaker cross-reference cannot be performed.' },
      { id: 'IR-GOLF-18', note: 'Strokes gained exists only as PGA TOUR season averages and only for PGA TOUR members; the last-eight-events window and the tour-wide first-round ranking are field-relative substitutes.' },
      { id: 'IR-GOLF-19', note: 'Links and wind-exposed classification is not published by any feed. data/golf_links_courses.json holds eight cited venues plus The Open Championship itself; every other venue is unclassified and scores zero. Whether a prior edition here was windy is likewise unverifiable, so the venue bonus is credited on the finish alone and the condition is disclosed.' },
      { id: 'IR-GOLF-20', note: 'Ball flight, spin and trajectory are not published, so the low-flight half of the course-fit category and its eight-point penalty are never scored; twelve of twenty is the ceiling, which also makes the prompt\'s mandatory value test unreachable as written.' },
      { id: 'IR-GOLF-21', note: 'Per-round wind for completed events is not published, so the twenty-point "in notable wind" fast-start tier is unreachable and the twelve-point tier is used.' },
      { id: 'IR-GOLF-22', note: 'Race to Dubai standings, travel intent and social/analyst sentiment have no free key-less feed, so those bonuses are unassessed and never assumed.' },
      { id: 'IR-GOLF-23', note: 'The 2027 dates are published only by a hospitality reseller as at the verification date and are recorded as UNCONFIRMED.' },
    ],
  };
}

function main() {
  const check = process.argv.includes('--check');
  const doc = build();
  if (!check) {
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`[scottish-open] wrote data/golf_scottish_open.json — ${doc.facts.length} verified fact(s), ${doc.editions.length} measured edition(s)`);
    for (const w of doc.warnings) console.log(`  ! ${w}`);
    return;
  }
  if (!existsSync(OUT)) { console.error('[scottish-open] --check: data/golf_scottish_open.json is missing'); process.exit(1); }
  const committed = JSON.parse(readFileSync(OUT, 'utf8'));
  const key = (d) => JSON.stringify((d.facts || []).map((f) => [f.id, f.status, f.source]));
  if (key(committed) !== key(doc)) { console.error('[scottish-open] --check: the verified facts are out of date with scripts/build_scottish_open.mjs; re-run without --check'); process.exit(1); }
  if (JSON.stringify((committed.editions || []).map((e) => [e.eventId, e.winner?.name, e.winner?.toPar])) !== JSON.stringify(doc.editions.map((e) => [e.eventId, e.winner?.name, e.winner?.toPar]))) {
    console.error('[scottish-open] --check: the measured editions are out of date with the committed results tape; re-run without --check');
    process.exit(1);
  }
  console.log(`[scottish-open] --check ok — ${doc.facts.length} verified fact(s), ${doc.editions.length} measured edition(s)`);
}

main();
