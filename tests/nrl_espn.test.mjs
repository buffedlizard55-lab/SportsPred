import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mergeMatches, canonicalClubs } from '../scripts/collect_nrl_espn.mjs';
import { buildNrlSeason, nrlLadderAt } from '../engine/nrl_data.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const teamsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'nrl_teams.json'), 'utf8'));
const clubs = canonicalClubs(teamsDoc);

const match = (over = {}) => ({
  date: '2026-07-11',
  home: 'Penrith Panthers',
  away: 'Melbourne Storm',
  homeScore: null,
  awayScore: null,
  round: 19,
  status: 'scheduled',
  venue: null,
  ...over,
});

test('canonicalClubs is the 17 NRL clubs and no representative sides', () => {
  assert.equal(clubs.size, 17);
  assert.ok(clubs.has('Wests Tigers'));
  for (const rep of ['New South Wales', 'Queensland', 'NSW', 'QLD']) {
    assert.ok(!clubs.has(rep), `${rep} must not be treated as an NRL club`);
  }
});

// --- the two failures the 2026-09-04 CI run hit ------------------------------

test('a match the tape already holds under the neighbouring date merges instead of duplicating', () => {
  // Round 1 was played in Las Vegas: 2026-02-28 local is 2026-03-01 in UTC.
  // ESPN dates it in UTC, so it must fold into the committed row (NRL-13).
  const committed = [
    match({ date: '2026-02-28', home: 'Newcastle Knights', away: 'North Queensland Cowboys',
      homeScore: 28, awayScore: 18, round: 1, status: 'completed' }),
  ];
  const fetched = [
    match({ date: '2026-03-01', home: 'Newcastle Knights', away: 'North Queensland Cowboys',
      homeScore: 28, awayScore: 18, round: 1, status: 'completed',
      venue: 'Allegiant Stadium', kickoffUtc: '2026-03-01T02:15Z', espnId: '603254' }),
  ];

  const r = mergeMatches(committed, fetched, { clubs });

  assert.equal(r.added, 0, 'the Vegas game must not be added a second time');
  assert.equal(r.matches.length, 1);
  // it still backfills the fields the tape was missing
  assert.equal(r.matches[0].venue, 'Allegiant Stadium');
  assert.equal(r.matches[0].kickoffUtc, '2026-03-01T02:15Z');
  assert.equal(r.matches[0].espnId, '603254');
  // and leaves the local date the rest of the tape uses alone
  assert.equal(r.matches[0].date, '2026-02-28');
});

test('the same pairing later in the season is not mistaken for the earlier one', () => {
  // Bulldogs v Dragons met twice in 2026: the Vegas opener and again in round 25.
  const committed = [
    match({ date: '2026-02-28', home: 'Canterbury-Bankstown Bulldogs', away: 'St George Illawarra Dragons',
      homeScore: 15, awayScore: 14, round: 1, status: 'completed' }),
    match({ date: '2026-08-22', home: 'Canterbury-Bankstown Bulldogs', away: 'St George Illawarra Dragons',
      homeScore: 14, awayScore: 44, round: 25, status: 'completed' }),
  ];
  const fetched = [
    match({ date: '2026-03-01', home: 'Canterbury-Bankstown Bulldogs', away: 'St George Illawarra Dragons',
      homeScore: 15, awayScore: 14, round: 1, status: 'completed', venue: 'Allegiant Stadium' }),
  ];

  const r = mergeMatches(committed, fetched, { clubs });

  assert.equal(r.added, 0);
  assert.equal(r.matches.length, 2);
  const byRound = Object.fromEntries(r.matches.map((m) => [m.round, m]));
  assert.equal(byRound[1].venue, 'Allegiant Stadium', 'the round 1 row takes the venue');
  assert.equal(byRound[25].venue, null, 'the round 25 row is untouched');
});

test('State of Origin arrives in the NRL feed and is kept off the tape', () => {
  const committed = [match()];
  const fetched = [
    match({ date: '2026-05-27', home: 'New South Wales', away: 'Queensland',
      homeScore: 22, awayScore: 20, round: 12, status: 'completed', venue: 'Accor Stadium' }),
    match({ date: '2026-07-08', home: 'Queensland', away: 'New South Wales',
      homeScore: 12, awayScore: 30, round: 18, status: 'completed', venue: 'Suncorp Stadium' }),
  ];

  const r = mergeMatches(committed, fetched, { clubs });

  assert.equal(r.skipped, 2);
  assert.equal(r.added, 0);
  assert.equal(r.matches.length, 1);
  const sides = new Set(r.matches.flatMap((m) => [m.home, m.away]));
  for (const rep of ['New South Wales', 'Queensland']) {
    assert.ok(!sides.has(rep), `${rep} must not reach nrl_matches.json`);
  }
});

// --- behaviour that must not regress -----------------------------------------

test('a genuinely new fixture is added, and new scores overwrite stale ones', () => {
  const committed = [
    match({ date: '2026-07-11', homeScore: null, awayScore: null, status: 'scheduled' }),
  ];
  const fetched = [
    match({ homeScore: 24, awayScore: 18, status: 'completed', venue: 'BlueBet Stadium' }),
    match({ date: '2026-07-12', home: 'Wests Tigers', away: 'Dolphins', round: 19 }),
  ];

  const r = mergeMatches(committed, fetched, { clubs });

  assert.equal(r.added, 1);
  assert.equal(r.updated, 2);
  assert.equal(r.matches.length, 2);
  assert.equal(r.matches[0].homeScore, 24);
  assert.equal(r.matches[0].status, 'completed');
});

test('an exact-date match still wins over a same-round neighbour', () => {
  const committed = [
    match({ date: '2026-07-11', home: 'Wests Tigers', away: 'Dolphins', round: 19, venue: 'A' }),
    match({ date: '2026-07-12', home: 'Wests Tigers', away: 'Dolphins', round: 19, venue: 'B' }),
  ];
  const fetched = [match({ date: '2026-07-12', home: 'Wests Tigers', away: 'Dolphins', round: 19, espnId: 'X' })];

  const r = mergeMatches(committed, fetched, { clubs });

  assert.equal(r.added, 0);
  assert.equal(r.matches.find((m) => m.venue === 'B').espnId, 'X');
  assert.equal(r.matches.find((m) => m.venue === 'A').espnId, undefined);
});

test('replaying the four events CI collected on 2026-09-04 leaves the committed tape unchanged', () => {
  // Verbatim from the run that failed strict validation: two duplicated Las
  // Vegas round-1 games and two Origin games.
  const committedDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'nrl_matches.json'), 'utf8'));
  const before = committedDoc.matches;
  const fetched = [
    { round: 1, date: '2026-03-01', home: 'Newcastle Knights', away: 'North Queensland Cowboys',
      homeScore: 28, awayScore: 18, venue: 'Allegiant Stadium', kickoffUtc: '2026-03-01T02:15Z',
      status: 'completed', espnId: '603254' },
    { round: 1, date: '2026-03-01', home: 'Canterbury-Bankstown Bulldogs', away: 'St George Illawarra Dragons',
      homeScore: 15, awayScore: 14, venue: 'Allegiant Stadium', kickoffUtc: '2026-03-01T05:30Z',
      status: 'completed', espnId: '603255' },
    { round: 12, date: '2026-05-27', home: 'New South Wales', away: 'Queensland',
      homeScore: 22, awayScore: 20, venue: 'Accor Stadium', kickoffUtc: '2026-05-27T09:05Z',
      status: 'completed', espnId: '603251' },
    { round: 18, date: '2026-07-08', home: 'Queensland', away: 'New South Wales',
      homeScore: 12, awayScore: 30, venue: 'Suncorp Stadium', kickoffUtc: '2026-07-08T09:05Z',
      status: 'completed', espnId: '603253' },
  ];

  const r = mergeMatches(before, fetched, { clubs });

  assert.equal(r.added, 0, 'nothing in that batch is a new NRL fixture');
  assert.equal(r.skipped, 2, 'the two Origin games are skipped');
  assert.equal(r.matches.length, before.length, 'the tape is the same length as before');
  assert.equal(new Set(r.matches.flatMap((m) => [m.home, m.away])).size, 17);

  // and the ladder after round 26 still matches the published table
  const season = buildNrlSeason({ matches: r.matches }, teamsDoc);
  const table = Object.fromEntries(
    nrlLadderAt(season, { throughRound: 26 }).map((row) => [row.team, row]));
  for (const [team, pts] of [['Newcastle Knights', 32], ['North Queensland Cowboys', 32],
    ['Canterbury-Bankstown Bulldogs', 28], ['St George Illawarra Dragons', 14]]) {
    assert.equal(table[team].Pts, pts, `${team} ladder points after round 26`);
  }
});
