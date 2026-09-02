/**
 * Ice hockey integration test — the "does the button actually produce
 * predictions" check, run against the REAL committed documents on disk.
 *
 * This exercises exactly the path the Generate button runs:
 *   load data/ice_hockey_*.json → enrichIceHockeyFixture → scoreIceHockeyCardMixed
 *   → writeIceHockeyCard → formatted card text
 *
 * The DOM-level version of this check lives in tests/dom_smoke.test.mjs and
 * needs jsdom; this one needs nothing but Node, so it runs on a clean checkout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { enrichIceHockeyFixture } from '../engine/ice_hockey_data.js';
import { scoreIceHockeyCardMixed, CONFIDENCE, MAX_ACTIVE_PICKS_PER_DAY } from '../engine/ice_hockey_engine.js';
import { writeIceHockeyCard } from '../engine/ice_hockey_writer.js';
import { parseNhlScoreboard, parseNhlStandings, parseEspnHockeyInjuries } from '../engine/ice_hockey_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, 'data', p), 'utf8'));

const fixturesDoc = load('ice_hockey_fixtures.json');
const standingsDoc = load('ice_hockey_standings.json');
const tapeDoc = load('ice_hockey_tape.json');
const goaliesDoc = load('ice_hockey_goalies.json');
const injuriesDoc = load('ice_hockey_injuries.json');
const slateDoc = load('ice_hockey_slate.json');
const provenance = load('ice_hockey_provenance.json');
const backtest = load('ice_hockey_backtest.json');

const docs = { standings: standingsDoc, tape: tapeDoc, goalies: goaliesDoc, injuries: injuriesDoc, slate: slateDoc };

function cardsByDate() {
  const byDate = new Map();
  for (const f of fixturesDoc.fixtures) {
    const d = f.dateISO;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(f);
  }
  const out = new Map();
  for (const [dateISO, list] of byDate) {
    const enriched = list.map((f) => enrichIceHockeyFixture(f, docs));
    const scored = scoreIceHockeyCardMixed(enriched);
    out.set(dateISO, { matches: enriched, scored, written: writeIceHockeyCard(scored.results, { dateISO }) });
  }
  return out;
}

test('the committed fixture list is non-empty and every row carries provenance', () => {
  assert.ok(fixturesDoc.fixtures.length >= 5, `expected fixtures, found ${fixturesDoc.fixtures.length}`);
  assert.ok(fixturesDoc.endpoints.length >= 2);
  for (const e of fixturesDoc.endpoints) assert.match(e.url, /^https:\/\//);
  for (const f of fixturesDoc.fixtures) {
    assert.ok(f.id && f.dateISO && f.startUtc, `fixture ${f.id} is missing identity fields`);
    assert.ok(f.home?.name && f.away?.name, `fixture ${f.id} is missing competitor names`);
    assert.ok(['nhl-api-scoreboard', 'espn-scoreboard'].includes(f.source), `fixture ${f.id} has an unknown source`);
  }
});

test('every fixture date produces a card with three markets per match', () => {
  const cards = cardsByDate();
  assert.ok(cards.size >= 2, `expected several fixture dates, found ${cards.size}`);
  for (const [dateISO, card] of cards) {
    assert.equal(card.written.tips.length, card.matches.length * 3, `${dateISO}: three tips per match`);
    assert.deepEqual(
      card.written.tips.slice(0, 3).map((t) => t.label),
      ['OUTRIGHT WINNER', 'PUCK LINE', 'GAME TOTAL'],
      'markets appear in the order the prompt demands'
    );
  }
});

test('every written tip on the real card passes the Step 4 validator', () => {
  for (const [, card] of cardsByDate()) {
    for (const tip of card.written.tips) {
      assert.equal(tip.validation.ok, true, `${tip.label}: ${tip.validation.violations.join('; ')}`);
    }
    assert.deepEqual(card.written.openerProblems, [], 'no two tips open alike');
  }
});

test('with the standings table empty the engine reports gaps instead of guessing', () => {
  assert.equal(Object.keys(standingsDoc.teams || {}).length, 0, 'the committed standings table is empty by design');
  const card = cardsByDate().get('2026-10-05');
  const r = card.scored.results[0];
  assert.ok(r.missing.length >= 5, `expected recorded gaps, found ${r.missing.length}`);
  assert.match(r.missing.join(' '), /goalsForPerGame|form\.last5|odds\.moneyline/);
  // No factor was invented, so no confident play is possible.
  assert.equal(r.outright.decision.confidence, CONFIDENCE.SKIP);
  assert.equal(r.pipeline.noBet, true);
  assert.ok(r.pipeline.risk.veto, 'a veto reason is stated, not left blank');
});

test('a data-poor card still writes every section a reader needs', () => {
  const card = cardsByDate().get('2026-10-05');
  const text = card.written.formattedText;
  assert.match(text, /ICE HOCKEY PREDICTIONS — 2026-10-05/);
  assert.match(text, /OUTRIGHT WINNER/);
  assert.match(text, /PUCK LINE/);
  assert.match(text, /GAME TOTAL/);
  assert.match(text, /SUMMARY/);
  assert.match(text, /Back-to-back flag/);
  assert.match(text, /gamble responsibly/i);
});

test('the daily cap is applied to the real card', () => {
  for (const [, card] of cardsByDate()) {
    assert.ok(card.scored.cap.active <= MAX_ACTIVE_PICKS_PER_DAY);
    assert.equal(card.scored.cap.limit, MAX_ACTIVE_PICKS_PER_DAY);
  }
});

test('provenance names every source with a URL, a status and what it provides', () => {
  assert.ok(provenance.sources.length >= 6);
  for (const s of provenance.sources) {
    assert.match(s.url, /^https:\/\//, `${s.name} has a review URL`);
    assert.equal(s.status, 200, `${s.name} was verified live`);
    assert.ok(s.provides?.length, `${s.name} states what it provides`);
    assert.ok(s.verified_utc, `${s.name} records when it was verified`);
  }
});

test('the irregularity register states the effect of each gap on the output', () => {
  const ids = provenance.irregularities.map((i) => i.id);
  for (const id of ['IR-HOCKEY-01', 'IR-HOCKEY-02', 'IR-HOCKEY-03', 'IR-HOCKEY-04', 'IR-HOCKEY-05']) {
    assert.ok(ids.includes(id), `${id} is registered`);
  }
  for (const i of provenance.irregularities) {
    assert.ok(i.effect && i.effect.length > 30, `${i.id} explains its effect on output`);
  }
});

test('the backtest document says plainly what cannot be graded', () => {
  assert.equal(backtest.results.puck_line.graded, 0);
  assert.match(backtest.results.puck_line.reason, /closing puck line/);
  assert.equal(backtest.results.roi, null);
  assert.match(backtest.results.roi_reason, /no price/);
  assert.ok(backtest.ungraded_inputs.length >= 3);
});

test('the OLBG slate carries no price on any row', () => {
  assert.ok(slateDoc.events.length >= 1);
  for (const e of slateDoc.events) {
    assert.equal(e.odds, null, 'OLBG publishes tipster consensus, never a price');
    assert.match(e.url, /^https:\/\/www\.olbg\.com\/betting-tips\/Ice_Hockey\//);
  }
});

/* ---------- parsers over verified payload shapes ---------- */

test('parseNhlScoreboard reads the official payload shape', () => {
  const payload = {
    focusedDate: '2026-10-05',
    gamesByDate: [{
      date: '2026-10-05',
      games: [{
        id: 2026020041, season: 20262027, gameType: 2, gameDate: '2026-10-05',
        gameCenterLink: '/gamecenter/ott-vs-bos/2026-10-05/2026020041',
        venue: { default: 'TD Garden' }, startTimeUTC: '2026-10-05T23:30:00Z', gameState: 'FUT',
        awayTeam: { id: 9, abbrev: 'OTT', name: { default: 'Ottawa Senators' }, record: '44-27-11' },
        homeTeam: { id: 6, abbrev: 'BOS', name: { default: 'Boston Bruins' }, record: '45-27-10' },
      }],
    }],
  };
  const parsed = parseNhlScoreboard(payload);
  assert.equal(parsed.games.length, 1);
  const g = parsed.games[0];
  assert.equal(g.home.abbrev, 'BOS');
  assert.equal(g.away.name, 'Ottawa Senators');
  assert.equal(g.home.record.wins, 45);
  assert.equal(g.home.record.points, 100);
  assert.equal(g.phase, 'upcoming');
  assert.equal(g.gameCenterLink, 'https://api-web.nhle.com/gamecenter/ott-vs-bos/2026-10-05/2026020041');
  assert.deepEqual(parsed.warnings, []);
});

test('parseNhlStandings derives per-game rates and home splits from the official table', () => {
  const parsed = parseNhlStandings({
    standingsDateTimeUtc: '2026-09-02T22:36:45Z',
    standings: [{
      teamAbbrev: { default: 'COL' }, teamName: { default: 'Colorado Avalanche' },
      gamesPlayed: 82, goalFor: 302, goalAgainst: 203, goalsForPctg: 3.68, points: 121,
      winPctg: 0.670732, wins: 55, losses: 16, otLosses: 11,
      homeGamesPlayed: 41, homeWins: 26, homeLosses: 9, homeOtLosses: 6,
      homeGoalsFor: 157, homeGoalsAgainst: 108, roadGamesPlayed: 41, roadWins: 29,
      roadLosses: 7, roadOtLosses: 5, l10Wins: 7, l10Losses: 2, l10OtLosses: 1,
      streakCode: 'W', streakCount: 3, leagueSequence: 1, divisionSequence: 1, conferenceSequence: 1,
      seasonId: 20252026,
    }],
  });
  const col = parsed.teams.COL;
  assert.equal(col.goalsForPerGame, 3.683);
  assert.equal(col.goalsAgainstPerGame, 2.476);
  assert.equal(col.home.winPctg, 63.41);
  assert.equal(col.ranks.league, 1);
  assert.equal(col.ranks.leagueSize, 1);
  // Not published by this endpoint — must stay null, never defaulted.
  assert.equal(col.powerPlayPctg, null);
  assert.equal(col.shotsForPerGame, null);
});

test('parseEspnHockeyInjuries flags a thinned forward group by team abbreviation', () => {
  const parsed = parseEspnHockeyInjuries({
    timestamp: '2026-09-02T22:35:35Z',
    injuries: [{
      id: '25', displayName: 'Anaheim Ducks',
      injuries: [
        { id: '1', status: 'Out', date: '2026-07-04T19:03Z', athlete: { displayName: 'A One', position: { abbreviation: 'L' }, team: { abbreviation: 'ANA' } } },
        { id: '2', status: 'Out', date: '2026-07-05T19:03Z', athlete: { displayName: 'B Two', position: { abbreviation: 'C' }, team: { abbreviation: 'ANA' } } },
        { id: '3', status: 'Out', date: '2026-07-06T19:03Z', athlete: { displayName: 'C Three', position: { abbreviation: 'R' }, team: { abbreviation: 'ANA' } } },
      ],
    }],
  });
  assert.equal(parsed.teams, 1);
  assert.equal(parsed.byTeam.ANA.count, 3);
  assert.equal(parsed.byTeam.ANA.keyForwardLineMissing, true);
  assert.equal(parsed.byTeam.ANA.entries[0].athlete, 'A One');
});
