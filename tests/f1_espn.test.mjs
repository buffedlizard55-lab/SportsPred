/**
 * ESPN F1 parser tests. Pure fixtures, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseF1Scoreboard, parseCompetitions, parseSession, parseStatus,
  parseStatistics, parseStandings, parseCoreEvent, parseCircuit,
  resultFromRace, gridFromRace, sessionKey,
} from '../engine/f1_espn.js';

test('sessionKey normalises OLBG/ESPN session types', () => {
  assert.equal(sessionKey('Race'), 'Race');
  assert.equal(sessionKey('Qual'), 'Qualifying');
  assert.equal(sessionKey('FP1'), 'FP1');
  assert.equal(sessionKey('SS'), 'Sprint Shootout');
  assert.equal(sessionKey('Sprint'), 'Sprint');
});

test('parseSession reads order, startOrder, winner and vehicle from core payload', () => {
  const s = parseSession({
    id: 'race-1',
    date: '2026-08-23T13:00Z',
    type: { abbreviation: 'Race', text: 'Race' },
    status: { type: { state: 'post', completed: true } },
    competitors: [
      {
        id: '5579', type: 'athlete', order: 1, startOrder: 1, winner: true,
        athlete: { fullName: 'Lando Norris' },
        vehicle: { number: '1', manufacturer: 'McLaren' },
      },
      {
        id: '5829', type: 'athlete', order: 2, startOrder: 3, winner: false,
        athlete: { fullName: 'Kimi Antonelli' },
        vehicle: { number: '12', manufacturer: 'Mercedes' },
      },
    ],
  });
  assert.equal(s.type, 'Race');
  assert.equal(s.completed, true);
  assert.equal(s.competitors[0].name, 'Lando Norris');
  assert.equal(s.competitors[0].team, 'McLaren');
  assert.equal(s.competitors[1].startOrder, 3);

  const result = resultFromRace(s);
  assert.equal(result[0].position, 1);
  assert.equal(result[0].winner, true);
  const grid = gridFromRace(s);
  assert.equal(grid[0].grid, 1);
});

test('parseStatus distinguishes classified from retired', () => {
  assert.equal(parseStatus({ type: { name: 'STATUS_CLASSIFIED' } }).retired, false);
  assert.equal(parseStatus({ type: { name: 'STATUS_RETIRED' } }).retired, true);
  assert.equal(parseStatus({}).retired, false, 'absent status is not treated as a DNF');
});

test('parseStatistics extracts the published race stats', () => {
  const p = parseStatistics({
    splits: { categories: [{ stats: [
      { name: 'place', value: 1 }, { name: 'wins', value: 1 }, { name: 'pole', value: 1 },
      { name: 'lapsCompleted', value: 72 }, { name: 'lapsLead', value: 1 },
      { name: 'pitsTaken', value: 3 }, { name: 'championshipPts', value: 31 },
      { name: 'totalTime', value: 7484859, displayValue: '2:04:44.859' },
    ] }] },
  });
  assert.equal(p.place, 1);
  assert.equal(p.pitsTaken, 3);
  assert.equal(p.pointsEarned, 31);
  assert.equal(p.finishTime, '2:04:44.859');
  assert.equal(p.lapsCompleted, 72);
});

test('parseScoreboard extracts calendar and events', () => {
  const p = parseF1Scoreboard({
    leagues: [{
      id: '2030', name: 'Formula 1', season: { year: 2026 },
      calendar: [{ label: 'Pirelli Italian Grand Prix', startDate: '2026-09-04T13:30Z', endDate: '2026-09-06T16:00Z', event: { $ref: '.../events/600057442' } }],
    }],
    events: [{
      id: '600057442', name: 'Pirelli Italian Grand Prix', date: '2026-09-04T10:30Z', endDate: '2026-09-06T13:00Z',
      season: { year: 2026 },
      competitions: [
        { id: 'c1', type: { abbreviation: 'FP1' }, status: { type: { state: 'post', completed: true } }, date: '2026-09-04T10:30Z', competitors: [{ id: '5829', athlete: { fullName: 'Kimi Antonelli' }, order: 1 }] },
        { id: 'c2', type: { abbreviation: 'Race' }, status: { type: { state: 'pre', completed: false } }, date: '2026-09-06T13:00Z', competitors: [] },
      ],
    }],
  });
  assert.equal(p.seasonYear, 2026);
  assert.equal(p.seasonCalendar[0].eventId, '600057442');
  assert.equal(p.events[0].sessions.length, 2);
  assert.equal(p.events[0].race.completed, false);
});

test('parseStandings separates drivers and constructors with per-race points', () => {
  const p = parseStandings({
    children: [
      { name: 'Driver Standings', standings: { entries: [
        { athlete: { id: '5829', displayName: 'Kimi Antonelli' }, stats: [
          { name: 'rank', value: 1 }, { name: 'points', value: 242 },
          { name: 'AUS', abbreviation: 'AUS', id: '600057427', played: true, value: 18 },
          { name: 'ITA', abbreviation: 'ITA', id: '600057442', played: false, value: 0 },
        ] },
      ] } },
      { name: 'Constructor Standings', standings: { entries: [
        { team: { id: '106921', displayName: 'Mercedes', color: '00D2BE' }, stats: [
          { name: 'rank', value: 1 }, { name: 'points', value: 300 },
          { name: 'AUS', id: '600057427', played: true, value: 33 },
        ] },
      ] } },
    ],
  });
  assert.equal(p.drivers[0].name, 'Kimi Antonelli');
  assert.equal(p.drivers[0].rank, 1);
  assert.equal(p.drivers[0].perRace['600057427'].points, 18);
  assert.equal(p.constructors[0].name, 'Mercedes');
  assert.equal(p.constructors[0].perRace['600057427'].points, 33);
});

test('parseCircuit and parseCoreEvent read verified ESPN fields', () => {
  const c = parseCircuit({
    id: '615', fullName: 'Autodromo Nazionale Monza',
    address: { city: 'Monza', country: 'Italy' }, length: '5.793 km', laps: 53, turns: 11,
    fastestLapDriver: { $ref: '.../athletes/5579' }, fastestLapTime: '1:20.901', fastestLapYear: 2025,
    diagrams: [{ href: 'https://x/1.svg', rel: ['full'] }],
  });
  assert.equal(c.fullName, 'Autodromo Nazionale Monza');
  assert.equal(c.fastestLapDriverId, '5579');
  assert.equal(c.fastestLapTime, '1:20.901');

  const ev = parseCoreEvent({
    id: '600057442', abbreviation: 'ITA', name: 'Pirelli Italian Grand Prix',
    circuit: { $ref: '.../circuits/615' },
    venues: [{ $ref: '.../venues/259' }],
    defendingChampion: { driver: { $ref: '.../athletes/4665' }, manufacturer: { $ref: '.../manufacturers/106921' } },
  });
  assert.equal(ev.circuitId, '615');
  assert.equal(ev.abbreviation, 'ITA');
  assert.equal(ev.defendingChampionDriverId, '4665');
});

test('parseSiteEvent marks a race completed from the inline STATUS_FINAL status', () => {
  // REGRESSION: the CORE competitions payload exposes session status only as a
  // $ref, so the collector must take completion from the SITE scoreboard.
  // Verified against the live Dutch GP payload (2026-08-23).
  const p = parseF1Scoreboard({
    leagues: [{ id: '2030', season: { year: 2026 }, calendar: [] }],
    events: [{
      id: '600057441', name: 'Heineken Dutch Grand Prix',
      date: '2026-08-21T10:30Z', endDate: '2026-08-23T13:00Z', season: { year: 2026 },
      competitions: [
        {
          id: '401839093', type: { abbreviation: 'FP1' }, date: '2026-08-21T10:30Z',
          status: { period: 36, type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true } },
          competitors: [{ id: '5829', order: 1, athlete: { fullName: 'Kimi Antonelli' } }],
        },
        {
          id: '401839097', type: { abbreviation: 'Race' }, date: '2026-08-23T13:00Z',
          status: { type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true } },
          competitors: [
            { id: '5579', order: 1, startOrder: 1, winner: true, athlete: { fullName: 'Lando Norris' }, vehicle: { manufacturer: 'McLaren', number: '1' } },
            { id: '5829', order: 2, startOrder: 3, winner: false, athlete: { fullName: 'Kimi Antonelli' }, vehicle: { manufacturer: 'Mercedes', number: '12' } },
          ],
        },
      ],
    }],
  });
  const ev = p.events[0];
  assert.equal(ev.raceCompleted, true, 'inline STATUS_FINAL must mark the race completed');
  assert.equal(ev.race.completed, true);
  assert.equal(ev.raceState, 'post');
  const res = resultFromRace(ev.race);
  assert.equal(res[0].name, 'Lando Norris');
  assert.equal(res[0].team, 'McLaren');
  const grid = gridFromRace(ev.race);
  assert.equal(grid[1].grid, 3, 'grid comes from startOrder, not finishing order');
});

test('parseCoreEvent resolves circuitId from the $ref (never a raw field)', () => {
  // REGRESSION: the collector previously read payload.circuitId, which ESPN
  // does not publish — every event ended up with a null circuit.
  const core = parseCoreEvent({
    id: '600057442', abbreviation: 'ITA',
    circuit: { $ref: 'http://sports.core.api.espn.com/v2/sports/racing/leagues/f1/circuits/615?lang=en' },
    venues: [{ $ref: 'http://sports.core.api.espn.com/v2/sports/racing/venues/259?lang=en' }],
  });
  assert.equal(core.circuitId, '615');
  assert.equal(core.venueId, '259');
  assert.equal(parseCoreEvent({ id: '1' }).circuitId, null, 'absent circuit stays null, never guessed');
});

test('parseCompetitions handles a core competitions payload', () => {
  const p = parseCompetitions({
    count: 2,
    items: [
      { id: 'c1', type: { abbreviation: 'FP1' }, competitors: [] },
      { id: 'c2', type: { abbreviation: 'Race' }, competitors: [] },
    ],
  });
  assert.equal(p.length, 2);
  assert.equal(p[1].type, 'Race');
});
