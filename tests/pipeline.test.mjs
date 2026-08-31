/**
 * End-to-end pipeline test.
 *
 * Proves that ESPN-shaped input actually flows all the way through
 * parse -> surface -> stage -> player stats -> engine -> writer and produces
 * copy-ready tips that satisfy every Step 4 output rule.
 *
 * The match rows here are ESPN-shaped and internally consistent (they are
 * produced by the same parser the browser uses, from a payload built to the
 * shape recorded in tests/fixtures/espn_scoreboard.EXCERPT.json). The point of
 * the test is the WIRING and the OUTPUT RULES, not the realism of any result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseScoreboard, buildPlayerStats, buildH2H } from '../engine/espn.js';
import { resolveSurface } from '../engine/surface.js';
import { codeStage, h2hForEngine } from '../engine/tournament.js';
import { scoreMatch, scoreCard, CONFIDENCE } from '../engine/engine.js';
import { writeCard, MIN_WORDS, BANNED_PHRASES } from '../engine/writer.js';

const here = dirname(fileURLToPath(import.meta.url));
const surfaces = JSON.parse(readFileSync(join(here, '../data/surfaces.json'), 'utf8'));

/** Build an ESPN-shaped scoreboard payload for a set of matches. */
function payload(matches) {
  return {
    events: [{
      id: '189-2026',
      name: 'US Open',
      groupings: [{
        grouping: { id: '1', slug: 'mens-singles', displayName: "Men's Singles" },
        competitions: matches.map((m, i) => ({
          id: m.id ?? String(190000 + i),
          date: `${m.date}T15:00Z`,
          status: {
            type: {
              state: m.completed ? 'post' : 'pre',
              completed: Boolean(m.completed),
              description: m.completed ? 'Final' : 'Scheduled',
            },
          },
          venue: { fullName: 'New York, USA' },
          format: { regulation: { periods: 5 } },
          competitors: [
            {
              id: m.a.id,
              order: 1,
              winner: m.completed ? m.winner === m.a.id : undefined,
              linescores: (m.sets || []).map(([x]) => ({ value: x })),
              athlete: { displayName: m.a.name },
            },
            {
              id: m.b.id,
              order: 2,
              winner: m.completed ? m.winner === m.b.id : undefined,
              linescores: (m.sets || []).map(([, y]) => ({ value: y })),
              athlete: { displayName: m.b.name },
            },
          ],
          tournamentId: 189,
          type: { id: '1', text: "Men's Singles", slug: 'mens-singles' },
          round: { displayName: m.round ?? 'Quarterfinals' },
        })),
      }],
    }],
  };
}

/** The browser's attach step: sourced surface + coded stage, or nulls. */
function attach(row) {
  const res = resolveSurface(surfaces, row.tournament, row.tour);
  const entry = res.key ? surfaces.tournaments[res.key] : null;
  const stage = codeStage(row.tournament, row.round, entry);
  return { ...row, surface: res.surface, level_code: stage.level, round_code: stage.round };
}

/** Build a dominant-favourite history tape so the card is genuinely scoreable. */
function buildTape(asOf) {
  const rows = [];
  let n = 0;
  const day = (i) => new Date(Date.parse(`${asOf}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
  // FAV beats a series of opponents in straight sets, including OPP twice.
  const opponents = ['O1', 'O2', 'O3', 'OPP', 'O4', 'OPP', 'O5', 'O6'];
  opponents.forEach((opp, i) => {
    rows.push({
      id: `h${n++}`,
      date: day(i + 2),
      completed: true,
      a: { id: 'FAV', name: 'Fav Player' },
      b: { id: opp, name: `Opp ${opp}` },
      winner: 'FAV',
      sets: [[6, 1], [6, 2]],
    });
  });
  // OPP's own recent record: mostly losses.
  ['L1', 'L2', 'L3', 'L4', 'L5'].forEach((x, i) => {
    rows.push({
      id: `o${n++}`,
      date: day(i + 3),
      completed: true,
      a: { id: 'OPP', name: 'Opp Player' },
      b: { id: x, name: `X ${x}` },
      winner: x,
      sets: [[3, 6], [4, 6]],
    });
  });
  return parseScoreboard(payload(rows), 'atp').map(attach);
}

function buildCard(asOf) {
  const tape = buildTape(asOf);
  const today = parseScoreboard(payload([{
    id: '999001',
    date: asOf,
    completed: false,
    round: 'Quarterfinals',
    a: { id: 'FAV', name: 'Fav Player' },
    b: { id: 'OPP', name: 'Opp Player' },
  }]), 'atp').map(attach);

  const ranks = { FAV: { rank: 3, trajectory: 'rising' }, OPP: { rank: 140, trajectory: 'falling' } };

  const matches = today.map((m) => {
    const mk = (p) => {
      const s = buildPlayerStats(p.espn_id, tape, m.surface, asOf);
      return {
        name: p.name,
        rank: ranks[p.espn_id]?.rank ?? null,
        rankTrajectory: ranks[p.espn_id]?.trajectory ?? null,
        odds: null,
        firstSetOdds: null,
        handicapOdds: null,
        form: s.form,
        surface: s.surface,
        serve: s.serve,
        rest: s.rest,
      };
    };
    const [a, b] = m.players.map(mk);
    const raw = buildH2H(m.players[0].espn_id, m.players[1].espn_id, tape, m.surface);
    return {
      event_id: m.competition_id,
      players: [a, b],
      surface: m.surface,
      tournament: { level: m.level_code, round: m.round_code },
      h2h: h2hForEngine(raw, a.rank, b.rank),
      opponentRank: Math.max(a.rank, b.rank),
      home: a.name,
      away: b.name,
      resolved_date: m.date,
    };
  });
  return { matches, tape, today };
}

const AS_OF = '2026-08-31';

test('the pipeline resolves surface and stage for a real tournament', () => {
  const { today } = buildCard(AS_OF);
  assert.equal(today.length, 1);
  assert.equal(today[0].surface, 'Hard');     // from recorded US Open match rows
  assert.equal(today[0].level_code, 'GS');
  assert.equal(today[0].round_code, 'QF');
});

test('player statistics are derived from the tape, not invented', () => {
  const { matches } = buildCard(AS_OF);
  const fav = matches[0].players.find((p) => p.name === 'Fav Player');
  assert.deepEqual(fav.form.last5, ['W', 'W', 'W', 'W', 'W']);
  assert.equal(fav.surface.surface, 'Hard');
  assert.ok(fav.surface.wins >= 5);
  assert.deepEqual(fav.form.straightSetsLast3, [true, true, true]);
  assert.equal(fav.serve, null, 'serve data is unavailable and must stay null');
});

test('head-to-head is computed and oriented to the lower-ranked player', () => {
  const { matches } = buildCard(AS_OF);
  const h = matches[0].h2h;
  assert.equal(h.matches, 2);
  // The favourite won both meetings, so the lower-ranked player won none.
  assert.equal(h.sameSurfaceLowerRankedWonOfLast3, 0);
});

test('a well-sourced match is scoreable and picks the right favourite', () => {
  const { matches } = buildCard(AS_OF);
  const r = scoreMatch(matches[0]);
  assert.equal(r.favourite, 'Fav Player');
  assert.ok(r.markets.win_match.score > 0);
});

test('missing odds are reported as missing rather than silently defaulted', () => {
  const { matches } = buildCard(AS_OF);
  const r = scoreMatch(matches[0]);
  assert.ok(r.missing.some((m) => /odds|price|probability/i.test(m)),
    `expected an odds-related missing factor, got: ${JSON.stringify(r.missing)}`);
});

test('the writer emits copy-ready tips that obey every output rule', () => {
  const { matches } = buildCard(AS_OF);
  const card = scoreCard(matches);
  const written = writeCard(card.results);

  const emitted = written.tips.filter((t) => t.ok && !t.skip);
  assert.ok(emitted.length > 0, 'the pipeline must produce at least one usable tip');
  assert.equal(written.violations.length, 0,
    `no tip may violate the output rules: ${JSON.stringify(written.violations)}`);

  for (const t of emitted) {
    const plain = t.text.replace(/\*\*/g, '');
    // Minimum length.
    const words = plain.split(/\s+/).filter(Boolean);
    assert.ok(words.length >= MIN_WORDS, `tip under ${MIN_WORDS} words: ${plain}`);
    // No numerals anywhere — this is what keeps odds/lines/scores out.
    assert.equal(/\d/.test(plain), false, `tip leaked a digit: ${plain}`);
    // No banned filler.
    for (const p of BANNED_PHRASES) {
      assert.equal(plain.toLowerCase().includes(p), false, `banned phrase "${p}" in: ${plain}`);
    }
    // A bolded outcome inside the first 20 words.
    const boldAt = t.text.split(/\s+/).findIndex((w) => w.includes('**'));
    assert.ok(boldAt > -1 && boldAt < 20, `bolded pick must land in the first 20 words: ${t.text}`);
    // A stated confidence level.
    assert.ok([CONFIDENCE.HIGH, CONFIDENCE.MEDIUM, CONFIDENCE.LOW, CONFIDENCE.SKIP].includes(t.band));
  }
});

test('no two written tips share an opening word', () => {
  const { matches } = buildCard(AS_OF);
  const written = writeCard(scoreCard(matches).results);
  // The uniqueness rule governs written predictions. SKIP entries are required
  // by the prompt to be "a single explanatory sentence", so they are excluded.
  const openers = written.tips
    .filter((t) => t.ok && !t.skip)
    .map((t) => t.text.trim().split(/\s+/)[0].toLowerCase());
  assert.equal(new Set(openers).size, openers.length, `repeated opening word: ${openers.join(', ')}`);
});

test('an unscoreable match yields no invented prediction', () => {
  const bare = {
    event_id: 'x1',
    players: [{ name: 'A', rank: null, odds: null }, { name: 'B', rank: null, odds: null }],
    surface: null,
    tournament: null,
    h2h: null,
    opponentRank: null,
    home: 'A',
    away: 'B',
  };
  const r = scoreMatch(bare);
  assert.equal(r.favourite, null);
  const written = writeCard(scoreCard([bare]).results);
  assert.equal(written.tips.filter((t) => t.ok && !t.skip).length, 0);
  assert.ok(written.unscored.length >= 1, 'the match must be reported as unscored');
});
