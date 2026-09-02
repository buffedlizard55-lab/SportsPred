/**
 * Golf data layer + card tests — leak control, measured factors, name
 * matching, regional classification, event selection, end-to-end card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normName, nameKeys, classifyRegion, courseClass, buildResultsIndex, historyBefore, summariseForm, eventHistory,
  r1Profile, courseClassRecord, buildGolfProfile, buildFieldContext, selectGolfEvents, eventCoversDate, matchGolfOlbg, eventNameKey,
} from '../engine/golf_data.js';
import { buildGolfEventCard, buildGolfDateCard, owgrLookup, matchOwgr, statsLookup, sgLookup, matchSg, golfCalendarCounts } from '../engine/golf_card.js';
import { r1Trend } from '../scripts/collect_golf_weather.mjs';

test('name normalisation handles diacritics, suffixes and initials', () => {
  assert.equal(normName('Ludvig Åberg'), 'ludvig aberg');
  assert.equal(normName('Rasmus Højgaard'), 'rasmus hojgaard');
  assert.equal(normName('J.J. Spaun'), 'j j spaun');
  assert.equal(normName('Sam Burns Jr.'), 'sam burns');
  assert.deepEqual(nameKeys('Rafa Cabrera Bello'), ['rafa cabrera bello', 'rafa bello']);
});

test('regional classification: OWGR region wins, country lists fall back', () => {
  assert.deepEqual(classifyRegion({ country: 'Northern Ireland', countryCode: 'NIR' }), { european: true, american: false, britishIrish: true, known: true });
  assert.deepEqual(classifyRegion({ country: 'USA', countryCode: 'USA' }), { european: false, american: true, britishIrish: false, known: true });
  assert.equal(classifyRegion({ country: 'Spain' }).european, true);
  assert.equal(classifyRegion({ country: 'Spain' }).britishIrish, false);
  assert.equal(classifyRegion({ country: 'South Africa', owgrRegion: 'Africa' }).european, false);
  assert.equal(classifyRegion({ country: 'Unknownland', owgrRegion: 'Europe' }).european, true);
  assert.equal(classifyRegion({}).known, false);
  assert.equal(courseClass(7440), 'long');
  assert.equal(courseClass(7100), 'mid');
  assert.equal(courseClass(6830), 'short');
  assert.equal(courseClass(null), null);
});

function tape() {
  // Two tournaments (tid 1 and tid 2), two seasons each; player A wins tid1 in 2025, MC in tid2.
  const events = {
    e1: { tour: 'pga', name: 'Alpha Open', tournamentId: '1', startDate: '2025-06-05', endDate: '2025-06-08', seasonYear: 2025, major: false, purse: 9000000, yards: 7400, par: 72, fieldSize: 4, rows: [['a', 1, 'F', -10, 66, 68, 67, 69], ['b', 2, 'F', -8, 70, 66, 67, 69], ['c', null, 'CUT', 4, 74, 74, null, null], ['d', 3, 'F', -6, 68, 68, 68, 70]], sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=e1' },
    e2: { tour: 'pga', name: 'Beta Classic', tournamentId: '2', startDate: '2025-07-03', endDate: '2025-07-06', seasonYear: 2025, major: true, purse: 20000000, yards: 7200, par: 70, fieldSize: 4, rows: [['a', null, 'CUT', 6, 74, 72, null, null], ['b', 1, 'F', -12, 65, 66, 67, 70], ['c', 2, 'F', -9, 67, 67, 67, 70], ['d', 10, 'F', -2, 70, 70, 69, 69]], sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=e2' },
    e3: { tour: 'pga', name: 'Alpha Open', tournamentId: '1', startDate: '2026-06-04', endDate: '2026-06-07', seasonYear: 2026, major: false, purse: 9000000, yards: 7400, par: 72, fieldSize: 4, rows: [['a', 4, 'F', -5, 67, 70, 70, 68], ['b', 1, 'F', -11, 66, 66, 68, 69], ['c', 12, 'F', 1, 72, 71, 73, 73], ['d', null, 'WD', 3, 75, null, null, null]], sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=e3' },
    e4: { tour: 'eur', name: 'Gamma Masters', tournamentId: '3', startDate: '2026-08-13', endDate: '2026-08-16', seasonYear: 2026, major: false, purse: 3000000, yards: 6900, par: 70, fieldSize: 4, rows: [['a', 2, 'F', -14, 64, 66, 68, 68], ['b', 20, 'F', -3, 68, 70, 69, 70], ['c', 1, 'F', -15, 65, 65, 67, 68], ['d', 30, 'F', 0, 70, 70, 70, 70]], sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=e4' },
  };
  const players = { a: { name: 'Ann Archer', country: 'England', countryCode: 'ENG' }, b: { name: 'Ben Baker', country: 'USA', countryCode: 'USA' }, c: { name: 'Cal Cooper', country: 'Spain', countryCode: 'ESP' }, d: { name: 'Dan Dyer', country: 'Ireland', countryCode: 'IRL' } };
  return { players, events };
}

test('results index + history are leak-free (strictly before the first round)', () => {
  const index = buildResultsIndex(tape());
  assert.equal(index.events.size, 4);
  const beforeE3 = historyBefore(index, 'a', '2026-06-04');
  assert.deepEqual(beforeE3.map((r) => r.eventId), ['e2', 'e1'], 'most recent first, excludes the event itself and later ones');
  const onDay = historyBefore(index, 'a', '2025-06-08');
  assert.equal(onDay.length, 0, 'an event ending on the as-of date is not history');
});

test('form, event history and opening-round measurements are computed from rows only', () => {
  const index = buildResultsIndex(tape());
  const rowsA = historyBefore(index, 'a', '2026-08-20');
  const f = summariseForm(rowsA, '2026-08-20', { purse: 9000000 });
  assert.equal(f.starts, 4);
  assert.equal(f.top3In6w, true, 'second place on 2026-08-16 is inside six weeks');
  assert.equal(f.winIn6w, false);
  assert.equal(f.top10Last5, 3);
  assert.equal(f.careerWinsInWindow, 1);
  assert.equal(f.top10Rate12m, null, 'fewer than five starts in twelve months -> null, never guessed');
  assert.equal(f.mcLast2Consecutive, false);
  assert.equal(f.competedLast3Weeks, true);
  assert.equal(f.tourWinIn('pga', 400), false);
  assert.equal(f.tourTop3In('eur', 42), true);

  const eh = eventHistory(rowsA, '1');
  assert.equal(eh.appearances, 2);
  assert.equal(eh.top5Last3, true);
  assert.equal(eh.mcMostRecent, false);
  const ehB = eventHistory(historyBefore(index, 'c', '2026-08-20'), '1');
  assert.equal(ehB.mcLast3, true);

  const r1 = r1Profile(rowsA);
  assert.equal(r1.rounds, 4);
  // (64-70) + (67-72) + (74-70) + (66-72) = -6 -5 +4 -6 = -13 / 4
  assert.equal(r1.avgR1ToPar, -3.25);
  assert.equal(r1.fastStarts, 3, 'opening rounds of 64, 67, 66 are 67 or better');

  const rec = courseClassRecord(rowsA, 'long', '2026-08-20');
  assert.equal(rec.starts, 2);
  assert.equal(rec.top10Rate, 1);
});

test('lookups match across sources by normalised name and drop ambiguous keys', () => {
  const owgr = owgrLookup({ rows: [{ rank: 1, owgrId: '1', name: 'Ann Archer' }, { rank: 2, owgrId: '2', name: 'Ben Baker' }, { rank: 3, owgrId: '3', name: 'Ben Baker' }] });
  assert.equal(matchOwgr(owgr, 'Ann Archer').rank, 1);
  assert.equal(matchOwgr(owgr, 'Ben Baker'), null, 'ambiguous name is not matched');
  assert.ok(owgr.ambiguous.has('ben baker'));
  const stats = statsLookup({ espn: { season: 2026, rows: Array.from({ length: 40 }, (_, i) => ({ athleteId: String(i), stats: { yardsPerDrive: 280 + i } })) } });
  assert.equal(stats.distanceQ1, 289);
  assert.equal(stats.distanceQ3, 309);
  const sg = sgLookup({ sg: { available: true, categories: { sg_app: { rows: [{ rank: 1, name: 'Ann Archer', avg: 0.9, rounds: 50 }] }, sg_putt: { rows: [{ rank: 4, name: 'Ann Archer', avg: 0.4, rounds: 50 }] } } } });
  assert.equal(matchSg(sg, 'Ann Archer').app.rank, 1);
  assert.equal(matchSg(sg, 'Ann Archer').putt.avg, 0.4);
  assert.equal(matchSg(sg, 'Nobody'), null);
  assert.equal(matchSg(sgLookup(null), 'Ann Archer'), null);
});

test('event selection covers the date and adds each tour’s next event', () => {
  const events = [
    { id: '1', tour: 'pga', startDate: '2026-09-03T04:00Z', endDate: '2026-09-06T04:00Z' },
    { id: '2', tour: 'eur', startDate: '2026-09-10T04:00Z', endDate: '2026-09-13T04:00Z' },
    { id: '3', tour: 'eur', startDate: '2026-09-17T04:00Z', endDate: '2026-09-20T04:00Z' },
  ];
  assert.equal(eventCoversDate(events[0], '2026-09-05'), true);
  assert.equal(eventCoversDate(events[0], '2026-09-07'), false);
  const sel = selectGolfEvents(events, '2026-09-04');
  assert.deepEqual(sel.map((e) => e.id), ['1', '2']);
  assert.equal(sel[1].nextForTour, true);
  assert.deepEqual(selectGolfEvents(events, '2026-09-04', { tours: ['pga'] }).map((e) => e.id), ['1']);
  const counts = golfCalendarCounts({ events });
  assert.equal(counts.get('2026-09-05'), 1);
  assert.equal(counts.get('2026-09-08'), undefined);
});

test('OLBG matching is by tournament tokens and stays conservative', () => {
  assert.equal(eventNameKey('Omega European Masters'), 'omega european');
  const slate = { events: [{ event_id: '101769', event_name: 'Omega European Masters', url: 'x' }, { event_id: '2', event_name: 'Amgen Irish Open', url: 'y' }] };
  const hits = matchGolfOlbg({ name: 'Omega European Masters' }, slate);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].event_id, '101769');
  assert.equal(matchGolfOlbg({ name: 'Biltmore Championship' }, slate).length, 0);
});

test('weather round-one trend compares afternoon with morning', () => {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-09-03T${String(h).padStart(2, '0')}:00`);
  const wind = hours.map((_, h) => (h >= 13 ? 30 : 10));
  const rain = hours.map(() => 10);
  assert.equal(r1Trend({ time: hours, wind_speed_10m: wind, precipitation_probability: rain }, '2026-09-03').trend, 'deteriorating');
  assert.equal(r1Trend({ time: hours, wind_speed_10m: wind.map((v) => 40 - v), precipitation_probability: rain }, '2026-09-03').trend, 'improving');
  assert.equal(r1Trend({ time: hours, wind_speed_10m: hours.map(() => 12), precipitation_probability: rain }, '2026-09-03').trend, 'stable');
  assert.equal(r1Trend(null, '2026-09-03'), null);
});

test('end-to-end card: profiles, context and validated output from committed-shape documents', () => {
  const resultsDoc = tape();
  const eventsDoc = { events: [{
    id: 'e5', tour: 'pga', name: 'Alpha Open', shortName: 'Alpha Open', seasonYear: 2026, startDate: '2026-09-03T04:00Z', endDate: '2026-09-06T04:00Z', state: 'pre', tournamentId: '1', purse: 9000000,
    course: { id: 'c1', name: 'Alpha Links', city: 'Alphaville', country: 'USA', yards: 7400, par: 72 },
    field: [
      { athleteId: 'a', name: 'Ann Archer', country: 'England', countryCode: 'ENG', teeTime: '2026-09-03T12:00Z', amateur: false },
      { athleteId: 'b', name: 'Ben Baker', country: 'USA', countryCode: 'USA', teeTime: '2026-09-03T17:00Z', amateur: false },
      { athleteId: 'c', name: 'Cal Cooper', country: 'Spain', countryCode: 'ESP', teeTime: '2026-09-03T12:30Z', amateur: false },
      { athleteId: 'd', name: 'Dan Dyer', country: 'Ireland', countryCode: 'IRL', teeTime: '2026-09-03T17:30Z', amateur: false },
      { athleteId: 'z', name: 'Zed Amateur', country: 'USA', countryCode: 'USA', teeTime: null, amateur: true },
    ],
    sources: { espnLeaderboard: 'https://www.espn.com/golf/leaderboard?tournamentId=e5', api: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=e5' },
  }] };
  const rankingsDoc = { rows: [{ rank: 3, owgrId: '1', name: 'Ann Archer', region: 'Europe', profileUrl: 'https://www.owgr.com/playerprofile/ann-archer-1' }, { rank: 1, owgrId: '2', name: 'Ben Baker', region: 'North America' }, { rank: 40, owgrId: '3', name: 'Cal Cooper', region: 'Europe' }], source: { url: 'https://apiweb.owgr.com/x' }, fetched_at_utc: '2026-09-01T00:00:00Z' };
  const weatherDoc = { events: { e5: { available: true, days: [{ date: '2026-09-03', windMaxKmh: 15, precipProbPct: 10 }], r1: { trend: 'deteriorating' }, sourceUrl: 'https://api.open-meteo.com/v1/forecast?x' } } };
  const card = buildGolfEventCard({ eventsDoc, resultsDoc, rankingsDoc, statsDoc: null, weatherDoc, slateDoc: null }, 'e5');
  assert.ok(card);
  assert.equal(card.asOf, '2026-09-03');
  assert.equal(card.coverage.amateurs, 1);
  assert.equal(card.coverage.scored, 4);
  assert.equal(card.coverage.owgrMatched, 3);
  assert.equal(card.coverage.priorEditionsInTape, 2);
  assert.equal(card.ctx.owgrInField.get('b'), 1);
  assert.equal(card.ctx.regionCounts.britishIrish, 2);
  assert.equal(card.ctx.priorEditionR1, null, 'prior edition R1 mean needs twenty rounds; a four-player fixture yields none');

  const profA = card.profiles.find((p) => p.athleteId === 'a');
  assert.equal(profA.event.appearances, 2);
  assert.equal(profA.owgr.rank, 3);
  assert.equal(profA.sg, null, 'no SG document -> null, never estimated');
  assert.equal(profA.region.britishIrish, true);

  assert.equal(card.scored.unscored, false);
  assert.ok(card.scored.missing.some((m) => m.includes('strokes gained')));
  assert.ok(card.written, 'card written');
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  assert.ok(card.written.cardText.includes('Responsible gambling'));
  const heads = card.scored.markets.outright.selections;
  assert.ok(heads.length >= 1);
  assert.ok(!heads.some((s) => s.athleteId === 'z'), 'amateur never selected');
  for (const s of heads) assert.ok(s.band !== 'HIGH', 'no HIGH grade when strokes gained is missing');
  assert.ok(card.sources.some((s) => s.url.includes('owgr.com')));
  assert.ok(card.sources.some((s) => s.url.includes('open-meteo')));

  const day = buildGolfDateCard({ eventsDoc, resultsDoc, rankingsDoc, statsDoc: null, weatherDoc, slateDoc: null }, '2026-09-04');
  assert.equal(day.cards.length, 1);
  assert.equal(buildGolfEventCard({ eventsDoc, resultsDoc }, 'nope'), null);
});
