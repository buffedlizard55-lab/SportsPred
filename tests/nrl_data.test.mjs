/**
 * NRL data layer + the committed tape.
 *
 * The lodestar test here is the ladder check: the tape is transcribed from
 * published sources, so the only way to prove it is not mistyped is to
 * recompute the competition table from it and compare with the published
 * ladder. One wrong or missing score breaks the check for at least one club.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildNrlSeason, nrlLadderAt, nrlLadderHistory, nrlTeamFor, nrlForm, nrlH2H,
  nrlTotalsProfile, nrlSeasonMeanTotal, nrlCloseFinishes, nrlRestAndBye,
  nrlTravelContext, nrlWeatherFor, nrlMarketLines, nrlOriginContext,
  enrichNrlMatch, nrlUpcoming, nrlCalendar, haversineKm, canonicalNrlTeam,
} from '../engine/nrl_data.js';
import { buildNrlDocs } from '../engine/nrl_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

const docs = buildNrlDocs({
  matches: j('nrl_matches.json'),
  teams: j('nrl_teams.json'),
  slate: j('nrl_slate.json'),
  weather: j('nrl_weather.json'),
  origin: j('nrl_origin.json'),
});

test('the tape is the 2026 season: 27 rounds, 8 or fewer matches each, 17 clubs', () => {
  const rounds = new Set(docs.season.raw.map((m) => m.round));
  assert.equal(rounds.size, 27);
  const clubs = new Set();
  for (const m of docs.season.raw) { clubs.add(m.home); clubs.add(m.away); }
  assert.equal(clubs.size, 17);
  for (const r of rounds) {
    const n = docs.season.raw.filter((m) => m.round === r).length;
    assert.ok(n >= 5 && n <= 8, `round ${r} has ${n} matches`);
  }
  // every completed match has both scores, every scheduled one has neither
  for (const m of docs.season.completed) {
    assert.ok(Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore));
  }
  for (const m of docs.season.scheduled) {
    assert.equal(m.homeScore, null);
    assert.equal(m.awayScore, null);
  }
});

test('the tape reproduces the published ladder after round 26 (the anti-typo check)', () => {
  // Published table after round 26, 2026: club, played, won, lost, differential, points.
  const published = [
    ['New Zealand Warriors', 23, 17, 6, 309, 40],
    ['Penrith Panthers', 23, 17, 6, 308, 40],
    ['Dolphins', 23, 16, 7, 152, 38],
    ['Sydney Roosters', 23, 16, 7, 148, 38],
    ['Cronulla-Sutherland Sharks', 23, 14, 9, 153, 34],
    ['South Sydney Rabbitohs', 23, 13, 10, 83, 32],
    ['Newcastle Knights', 24, 14, 10, 42, 32],
    ['North Queensland Cowboys', 23, 13, 10, -64, 32],
    ['Manly Warringah Sea Eagles', 23, 11, 12, 100, 28],
    ['Canterbury-Bankstown Bulldogs', 23, 11, 12, -46, 28],
    ['Melbourne Storm', 23, 10, 13, 14, 26],
    ['Canberra Raiders', 23, 10, 13, -65, 26],
    ['Parramatta Eels', 23, 9, 14, -179, 24],
    ['Wests Tigers', 23, 8, 15, -226, 22],
    ['Brisbane Broncos', 23, 7, 16, -220, 20],
    ['Gold Coast Titans', 23, 6, 17, -182, 18],
    ['St George Illawarra Dragons', 23, 4, 19, -327, 14],
  ];
  const table = nrlLadderAt(docs.season, { throughRound: 26 });
  assert.equal(table.length, 17);
  for (const [name, P, W, L, PD, Pts] of published) {
    const row = table.find((r) => r.team === name);
    assert.ok(row, `${name} present in the computed table`);
    assert.deepEqual(
      [row.P, row.W, row.L, row.PD, row.Pts], [P, W, L, PD, Pts],
      `${name}: computed ${row.P}/${row.W}/${row.L}/${row.PD}/${row.Pts} v published ${P}/${W}/${L}/${PD}/${Pts}`,
    );
  }
  // ordering: points, then differential
  assert.deepEqual(table.slice(0, 2).map((r) => r.team), ['New Zealand Warriors', 'Penrith Panthers']);
});

test('competition points follow the NRL system: two a win, one a draw, two for a bye', () => {
  const table = nrlLadderAt(docs.season, { throughRound: 26 });
  for (const r of table) {
    assert.equal(r.Pts, 2 * r.W + r.D + 2 * r.B);
    assert.equal(r.P, r.W + r.D + r.L);
  }
  const knights = table.find((r) => r.team === 'Newcastle Knights');
  assert.equal(knights.B, 2, 'the Knights have two byes, everyone else three at this point');
});

test('the ladder is walk-forward: a match cannot see its own round', () => {
  const before = nrlLadderAt(docs.season, { beforeDate: '2026-09-04' });
  const after = nrlLadderAt(docs.season, { beforeDate: '2026-09-05' });
  const bulldogs = (t) => t.find((r) => r.team === 'Canterbury-Bankstown Bulldogs');
  assert.equal(bulldogs(before).P, bulldogs(after).P, 'the 3 September match is already counted by 4 September');
  const early = nrlLadderAt(docs.season, { beforeDate: '2026-03-01' });
  assert.equal(early.find((r) => r.team === 'Newcastle Knights').P, 1, 'only round 1 is visible on 1 March');
});

test('form is walk-forward and recency weighted', () => {
  const f = nrlForm(docs.season, 'Dolphins', '2026-09-04', 6, docs.history);
  assert.ok(f.sample >= 3);
  assert.equal(f.matches[0].date < f.matches[f.matches.length - 1].date, false, 'most recent first');
  assert.ok(f.weightedShare >= 0 && f.weightedShare <= 1);
  // recency: a win in the most recent match is worth more than one six games ago
  const synthetic = {
    completed: [
      { date: '2026-08-01', round: 20, home: 'A', away: 'Z', homeScore: 0, awayScore: 5, status: 'completed' },
      { date: '2026-08-02', round: 20, home: 'A', away: 'Z', homeScore: 30, awayScore: 0, status: 'completed' },
    ],
    raw: [], scheduled: [],
  };
  const s = buildNrlSeason({ matches: synthetic.completed }, { teams: {} });
  const recent = nrlForm(s, 'A', '2026-08-03', 6);
  assert.ok(recent.weightedShare > 0.5, 'the recent win outweighs the older loss');
  const stale = { ...s, completed: [...s.completed].reverse() };
  assert.ok(nrlForm(stale, 'A', '2026-08-03', 6).weightedShare < 0.5, 'an older win is worth less than a recent one');
});

test('head-to-head is measured between the two clubs only, and before the date', () => {
  const h = nrlH2H(docs.season, 'Gold Coast Titans', 'Dolphins', '2026-09-04', 3);
  assert.ok(h.n >= 1 && h.n <= 3);
  const mirror = nrlH2H(docs.season, 'Dolphins', 'Gold Coast Titans', '2026-09-04', 3);
  assert.equal(h.wins, mirror.losses);
  assert.equal(nrlH2H(docs.season, 'Dolphins', 'Gold Coast Titans', '2026-03-01', 3), null, 'no meetings yet → null, never zero');
});

test('totals profile, close finishes and rest all read strictly before the date', () => {
  const t = nrlTotalsProfile(docs.season, 'New Zealand Warriors', '2026-09-05', 5, 50.5);
  assert.equal(t.n, 5);
  assert.equal(t.referenceLine, 50.5);
  assert.equal(t.overs + t.unders <= 5, true);
  const c = nrlCloseFinishes(docs.season, 'New Zealand Warriors', '2026-09-05', 6);
  assert.ok(c.closeCount <= c.n);
  const rest = nrlRestAndBye(docs.season, 'Canberra Raiders', 27, '2026-09-05');
  assert.equal(rest.offBye, true, 'Canberra had the round 26 bye');
  assert.ok(rest.daysSince >= 7);
});

test('the season mean total is computed, not assumed', () => {
  const mean = nrlSeasonMeanTotal(docs.season);
  assert.ok(mean > 35 && mean < 60, `implausible mean total ${mean}`);
  const manual = docs.season.completed.reduce((a, m) => a + m.homeScore + m.awayScore, 0) / docs.season.completed.length;
  assert.equal(mean, Math.round(manual * 100) / 100);
});

test('the Warriors are the only trans-Tasman trip', () => {
  const nz = nrlTravelContext('New Zealand Warriors', 'Manly Warringah Sea Eagles', docs.teams);
  assert.equal(nz.transTasman, true);
  assert.equal(nz.homeTravelBurden, 'normal', 'the home side in Auckland is not travelling');
  assert.equal(nz.awayTravelBurden, 'trans-tasman');
  const domestic = nrlTravelContext('Penrith Panthers', 'Wests Tigers', docs.teams);
  assert.equal(domestic.transTasman, false);
  assert.equal(domestic.km, 0, 'both clubs list CommBank Stadium as their 2026 home ground');
  assert.ok(haversineKm(-33.8, 151.0, -19.3, 146.7) > 1500, 'Sydney to Townsville is long-haul');
});

test('weather is classified against the prompt thresholds', () => {
  // The forecast is refreshed in CI, so the classification rules are asserted
  // against a fixed document rather than against whatever the sky is doing.
  const fixed = {
    venues: {
      'Dry Park': { daily: [{ date: '2026-09-04', precip_mm: 0, precip_prob_max: 0, wind_max_kmh: 12 }] },
      'Wet Park': { daily: [{ date: '2026-09-04', precip_mm: 9.4, precip_prob_max: 100, wind_max_kmh: 45 }] },
      'Showery Park': { daily: [{ date: '2026-09-04', precip_mm: 2.1, precip_prob_max: 55, wind_max_kmh: 10 }] },
    },
  };
  const dry = nrlWeatherFor(fixed, 'Dry Park', '2026-09-04');
  assert.equal(dry.dry, true);
  assert.equal(dry.heavyRain, false);
  assert.equal(dry.strongWind, false);
  const wet = nrlWeatherFor(fixed, 'Wet Park', '2026-09-04');
  assert.equal(wet.heavyRain, true);
  assert.equal(wet.strongWind, true);
  assert.equal(nrlWeatherFor(fixed, 'Showery Park', '2026-09-04').lightRain, true);
  // nothing is invented: an unknown venue and an unforecast day are both null
  assert.equal(nrlWeatherFor(fixed, 'Nowhere Stadium', '2026-09-04'), null, 'unknown venue → null, not a default');
  assert.equal(nrlWeatherFor(fixed, 'Dry Park', '2026-09-09'), null, 'unforecast date → null, not a default');
});

test('the committed forecast joins on the venue names the clubs actually carry', () => {
  // Regression: the forecast was first committed with keys like
  // "Cbus Super Stadium, Gold Coast" while nrl_teams.json carries "Cbus Super
  // Stadium", so every lookup missed and the factor was silently unsourced.
  const known = new Set(Object.values(docs.teams.teams).map((t) => t.venue));
  const venues = docs.weather.venues || {};
  assert.ok(Object.keys(venues).length > 0, 'nrl_weather.json has no venues');
  for (const [name, v] of Object.entries(venues)) {
    assert.ok(known.has(name),
      `nrl_weather.json venue "${name}" is not a venue in nrl_teams.json, so the forecast can never join`);
    const day = (v.daily || [])[0];
    assert.ok(day && day.date, `${name} carries no forecast day`);
    const w = nrlWeatherFor(docs.weather, name, day.date);
    assert.ok(w, `${name} on ${day.date} must resolve against the committed forecast`);
    assert.equal(w.venue, name);
    assert.equal(w.source, 'Open-Meteo daily forecast (key-less)');
    // the tape writes some grounds as "Venue, City"; both spellings must resolve
    const withCity = nrlWeatherFor(docs.weather, `${name}, Somewhere`, day.date);
    assert.ok(withCity, `"${name}, Somewhere" must resolve to the ${name} forecast`);
    assert.equal(withCity.precip_mm, w.precip_mm);
  }
});

test('the weather factor resolves for every upcoming fixture', () => {
  // The factor is 10 points. If the venue join misses it silently scores zero,
  // so the card is checked rather than the lookup in isolation.
  const upcoming = nrlUpcoming(docs);
  assert.ok(upcoming.length > 0);
  for (const m of upcoming) {
    assert.ok(m.weather, `${m.home} v ${m.away} at ${m.venue}: weather resolved`);
    assert.equal(m.weather.venue, m.venue);
  }
});

test('market lines come from the OLBG slate and are labelled with their source', () => {
  const lines = nrlMarketLines(docs.slate, 'Gold Coast Titans', 'Dolphins');
  assert.equal(lines.handicapLine, 12.5);
  assert.equal(lines.handicapLineSource, 'olbg_event_page');
  assert.equal(lines.totalLine, 57.5);
  assert.deepEqual(lines.marketsOffered, ['To Win', 'Handicap (2-way)', 'Total Points']);
  assert.equal(nrlMarketLines(docs.slate, 'Nobody', 'Nowhere'), null);
});

test('the Origin window decides whether Origin duty is even possible', () => {
  const now = nrlOriginContext(docs.origin, '2026-09-05');
  assert.equal(now.sourced, true);
  assert.equal(now.originDutyPossible, false, 'the 2026 series ended on 8 July');
  assert.ok(now.daysSinceLastOriginGame > 30);
  const during = nrlOriginContext(docs.origin, '2026-06-18');
  assert.equal(during.originDutyPossible, true, 'inside the series window');
  assert.equal(nrlOriginContext(null, '2026-09-05').sourced, false);
});

test('enrichment keeps unsourced fields null instead of inventing them', () => {
  const upcoming = nrlUpcoming(docs);
  assert.equal(upcoming.length, 7);
  for (const m of upcoming) {
    assert.ok(m.homeRow && m.awayRow, `${m.home} v ${m.away}: ladder rows present`);
    assert.equal(typeof m.form.home.ppgFor, 'number');
    assert.ok(m.origin.sourced);
    assert.equal(m.origin.originDutyPossible, false);
  }
  const noVenue = enrichNrlMatch({ home: 'Melbourne Storm', away: 'Wests Tigers', date: '2026-09-20', round: 28, status: 'scheduled' }, docs);
  assert.equal(noVenue.weather, null, 'no venue → no forecast is invented');
});

test('the calendar counts every date that carries a match', () => {
  const counts = nrlCalendar(docs);
  assert.ok(counts.get('2026-09-05') >= 3);
  assert.ok(counts.size > 60);
});

test('club aliases resolve to canonical names', () => {
  assert.equal(canonicalNrlTeam('North Qld', docs.teams), 'North Queensland Cowboys');
  assert.equal(canonicalNrlTeam('St Geo Illa', docs.teams), 'St George Illawarra Dragons');
  assert.equal(canonicalNrlTeam('Warriors', docs.teams), 'New Zealand Warriors');
});
