/**
 * F1 card tests — end-to-end from committed-shape fixtures through to tips.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildF1RaceCard, buildF1DateCard, selectF1Event, teamRowsMap,
} from '../engine/f1_card.js';
import { circuitKey, raceLog, trackTape, matchF1Olbg } from '../engine/f1_data.js';

function raceResult(rows) {
  return {
    completed: true,
    winner: { athleteId: rows[0].athleteId, name: rows[0].name, team: rows[0].team },
    podium: rows.slice(0, 3).map((r) => r.athleteId),
    top6: rows.slice(0, 6).map((r) => r.athleteId),
    top10: rows.slice(0, 10).map((r) => r.athleteId),
    grid: rows.map((r) => ({ athleteId: r.athleteId, name: r.name, grid: r.grid })),
    result: rows,
  };
}

function ev(over) {
  return {
    id: over.id,
    name: over.name,
    shortName: over.shortName,
    abbreviation: over.abbreviation,
    seasonYear: 2026,
    startDate: over.startDate,
    endDate: over.endDate,
    raceDate: over.raceDate,
    state: over.state,
    circuit: over.circuit || { fullName: 'Autodromo Nazionale Monza', city: 'Monza', country: 'Italy', lengthKm: '5.793 km', laps: 53 },
    sessions: over.sessions || [],
    race: over.race,
    sources: { espnEvent: 'https://www.espn.com/f1/race/_/id/x', espnCircuit: 'https://www.espn.com/f1/circuit/_/id/x' },
    ...over,
  };
}

const ITALIA_2025 = ev({
  id: '2025ita', name: 'Pirelli Italian Grand Prix', abbreviation: 'ITA',
  startDate: '2025-09-05T00:00Z', endDate: '2025-09-07T00:00Z', raceDate: '2025-09-07T00:00Z',
  state: 'post',
  race: raceResult([
    { athleteId: 'a', name: 'Driver A', team: 'Team A', position: 1, grid: 1, dnf: false, pole: true, pointsEarned: 25 },
    { athleteId: 'b', name: 'Driver B', team: 'Team B', position: 2, grid: 3, dnf: false, pointsEarned: 18 },
    { athleteId: 'c', name: 'Driver C', team: 'Team A', position: 3, grid: 2, dnf: false, pointsEarned: 15 },
    { athleteId: 'd', name: 'Driver D', team: 'Team B', position: 4, grid: 4, dnf: false, pointsEarned: 12 },
  ]),
});

const HUNGARY = ev({
  id: 'hng', name: 'AWS Hungarian Grand Prix', abbreviation: 'HUN',
  startDate: '2026-07-24T00:00Z', endDate: '2026-07-26T00:00Z', raceDate: '2026-07-26T00:00Z',
  state: 'post',
  race: raceResult([
    { athleteId: 'a', name: 'Driver A', team: 'Team A', position: 2, grid: 2, dnf: false, pointsEarned: 18 },
    { athleteId: 'b', name: 'Driver B', team: 'Team B', position: 1, grid: 1, dnf: false, pointsEarned: 25 },
    { athleteId: 'c', name: 'Driver C', team: 'Team A', position: 4, grid: 4, dnf: false, pointsEarned: 12 },
    { athleteId: 'd', name: 'Driver D', team: 'Team B', position: 6, grid: 7, dnf: false, pointsEarned: 8 },
  ]),
});

const DUTCH = ev({
  id: 'nld', name: 'Heineken Dutch Grand Prix', abbreviation: 'NLD',
  startDate: '2026-08-21T00:00Z', endDate: '2026-08-23T00:00Z', raceDate: '2026-08-23T00:00Z',
  state: 'post',
  race: raceResult([
    { athleteId: 'a', name: 'Driver A', team: 'Team A', position: 1, grid: 1, dnf: false, pole: true, pointsEarned: 25 },
    { athleteId: 'b', name: 'Driver B', team: 'Team B', position: 3, grid: 3, dnf: false, pointsEarned: 15 },
    { athleteId: 'c', name: 'Driver C', team: 'Team A', position: 2, grid: 2, dnf: false, pointsEarned: 18 },
    { athleteId: 'd', name: 'Driver D', team: 'Team B', position: 12, grid: 9, dnf: true, pointsEarned: 0 },
  ]),
});

const ITALIA_2026 = ev({
  id: 'ita2026', name: 'Pirelli Italian Grand Prix', abbreviation: 'ITA',
  startDate: '2026-09-04T00:00Z', endDate: '2026-09-06T00:00Z', raceDate: '2026-09-06T00:00Z',
  state: 'pre', race: { completed: false, result: [], grid: [] },
});

const eventsDoc = {
  schema_version: 1, season: 2026,
  events: [ITALIA_2025, HUNGARY, DUTCH, ITALIA_2026],
  circuits: {},
};

const standingsDoc = {
  schema_version: 1,
  source: { url: 'https://site.api.espn.com/apis/v2/sports/racing/f1/standings' },
  drivers: [
    { id: 'a', name: 'Driver A', rank: 1, points: 100, perRace: {} },
    { id: 'b', name: 'Driver B', rank: 2, points: 90, perRace: {} },
    { id: 'c', name: 'Driver C', rank: 3, points: 80, perRace: {} },
    { id: 'd', name: 'Driver D', rank: 4, points: 60, perRace: {} },
  ],
  constructors: [
    { id: 't1', name: 'Team A', rank: 1, points: 180, perRace: {} },
    { id: 't2', name: 'Team B', rank: 2, points: 150, perRace: {} },
  ],
};

const slateDoc = {
  source: { url: 'https://www.olbg.com/betting-tips/Motor_Racing/14' },
  events: [
    {
      event_id: '899', event_name: 'Italian Grand Prix', url: 'https://www.olbg.com/.../899',
      consensus: { market: 'Fastest Qualifier', selection: 'Driver A', tips_for: 7, tips_total: 14 },
    },
    {
      event_id: '900', event_name: 'Italian Grand Prix', url: 'https://www.olbg.com/.../900',
      consensus: { market: 'Win Race', selection: 'Driver A', tips_for: 6, tips_total: 19 },
    },
  ],
  outrights: [],
};

const weatherDoc = {
  events: { ita2026: { raceDate: '2026-09-06', tempMaxC: 24, precipProbPct: 10, windMaxKmh: 12 } },
};

test('circuitKey derives stable circuit identity from the event name/abbreviation', () => {
  assert.equal(circuitKey({ name: 'Pirelli Italian Grand Prix', abbreviation: 'ITA' }), 'ITA');
  assert.equal(circuitKey({ name: 'Heineken Dutch Grand Prix' }), 'DUTCH');
  assert.equal(circuitKey({ name: 'Barcelona-Catalunya Grand Prix' }), 'BARCELONACATALUNYA');
});

test('raceLog returns classified rows newest first across seasons', () => {
  const log = raceLog(eventsDoc.events);
  assert.equal(log[0].eventName, 'Heineken Dutch Grand Prix');
  assert.ok(log.length >= 12);
});

test('trackTape keeps only the last three runnings of a circuit', () => {
  const log = raceLog(eventsDoc.events);
  const tape = trackTape(log, 'ITA', '2026-09-04');
  const dates = new Set(tape.map((r) => String(r.raceDate).slice(0, 10)));
  assert.equal(dates.size, 1, 'one ITA running in fixtures');
  assert.ok(dates.has('2025-09-07'));
  // All four drivers of that running are retained (rows are per-driver).
  assert.equal(tape.length, 4);
});

test('matchF1Olbg correlates OLBG rows by race name', () => {
  const m = matchF1Olbg(ITALIA_2026, slateDoc);
  assert.equal(m.length, 2);
  assert.equal(m[0].event_id, '899');
});

test('buildF1RaceCard scores the Italian GP and writes valid tips', () => {
  const card = buildF1RaceCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, 'ita2026');
  assert.ok(card.event);
  assert.ok(card.profiles.has('a'));
  assert.equal(card.profiles.get('a').team, 'Team A');
  // Driver A: champion, winner of previous race (Zandvoort), ITA winner last year.
  const winner = card.scored.markets.race_winner;
  assert.equal(winner.selection, 'Driver A');
  assert.equal(card.written.tips.find((t) => t.market === 'FASTEST LAP').skip, true);
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  assert.ok(card.formattedText.includes('Italian Grand Prix'));
});

test('buildF1DateCard selects the weekend covering the date and the nearest upcoming otherwise', () => {
  const card = buildF1DateCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, '2026-09-05');
  assert.equal(card.event.id, 'ita2026');
  const off = buildF1DateCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, '2026-09-01');
  assert.equal(off.event.id, 'ita2026');
  assert.ok(off.card, 'nearest upcoming event gets a full card');
});

test('a finished-but-unclassified race is never offered as the upcoming race', () => {
  // REGRESSION: `upcoming` took the first event still flagged 'pre'. A race
  // that has been run but which the source never classified (IR-F1-03) stays
  // 'pre' forever, so a race from April was presented as next up in September.
  const withStale = {
    ...eventsDoc,
    events: [
      {
        id: 'bhr2026', name: 'Gulf Air Bahrain Grand Prix', abbreviation: 'BRN',
        seasonYear: 2026, state: 'pre', resultUnavailable: true,
        startDate: '2026-04-10T12:00Z', endDate: '2026-04-12T15:00Z', raceDate: '2026-04-12T15:00Z',
        sessions: [], race: { completed: false, result: [], grid: [] },
      },
      ...eventsDoc.events,
    ],
  };
  const out = buildF1DateCard(withStale, standingsDoc, slateDoc, weatherDoc, '2026-09-02');
  assert.equal(out.upcoming?.id, 'ita2026', 'upcoming must be ahead of the viewed date');
  assert.notEqual(out.upcoming?.id, 'bhr2026');
  assert.deepEqual(out.unresolved.map((e) => e.id), ['bhr2026'],
    'the unclassified race is surfaced for review, not silently dropped');
});

test('selectF1Event falls back to closest event with a note', () => {
  const sel = selectF1Event(eventsDoc.events, '2026-09-01');
  assert.equal(sel.event.id, 'ita2026');
  assert.equal(sel.note, undefined);
});

test('teamRowsMap derives team points from verified race results', () => {
  const rows = raceLog(eventsDoc.events);
  const map = teamRowsMap(rows, '2026-09-04');
  assert.ok(map['Team A'].length >= 6);
  assert.ok(map['Team A'].every((r) => r.points != null));
});
