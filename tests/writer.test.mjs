/**
 * Writer tests — these enforce Step 4 of the master prompt mechanically.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreMatch, scoreCard } from '../engine/engine.mjs';
import { writeTip, writeCard, validateTip, BANNED_PHRASES, MIN_WORDS, OPENERS as ANGLES } from '../engine/writer.mjs';

function dominantMatch(eventId = 99) {
  return {
    event_id: eventId,
    surface: 'hard',
    tournament: { level: 'GS', round: 'QF' },
    h2h: { sameSurfaceLowerRankedWonOfLast3: 0 },
    opponentRank: 140,
    players: [
      {
        name: 'Carlos Alcaraz', rank: 4,
        odds: { decimal: 1.3, american: -333 },
        firstSetOdds: { decimal: 1.45, american: -222 },
        handicapOdds: { decimal: 1.91, american: -110 },
        form: {
          last5: ['W', 'W', 'W', 'W', 'W'], tournamentWinStreak: 3,
          straightSetsLast3: [true, true, true], beatHigherRankedThisEvent: true,
          documentedSlowStarter: false,
        },
        surface: { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.78, dominantMarginGames: { bigWins: 4, of: 6 } },
        serve: { firstServePct: 0.68, acesPerMatch: 9 },
        rest: { played3SetsLast24h: false, physicalConcernCited: false },
      },
      {
        name: 'Roman Safiullin', rank: 140,
        odds: { decimal: 3.6, american: 260 },
        form: { lastMatchStraightSetLoss: true },
        surface: { wins: 3, losses: 9, poorRecordOnSurface: true },
        serve: { firstServePct: 0.58, acesPerMatch: 4 },
        rest: { played3SetsLast24h: true, physicalConcernCited: false },
      },
    ],
  };
}

test('every market on a strong match produces a tip that passes all Step 4 rules', () => {
  const result = scoreMatch(dominantMatch());
  for (const market of ['win_match', 'first_set', 'games_handicap']) {
    const out = writeTip({
      match: dominantMatch(), result, market,
      angle: ANGLES[['win_match', 'first_set', 'games_handicap'].indexOf(market)],
    });
    assert.ok(out.ok, `${market} failed validation: ${JSON.stringify(out.violations)}\n${out.text}`);
  }
});

test('a tip is at least 40 words and bolds the outcome inside the first 20 words', () => {
  const result = scoreMatch(dominantMatch());
  const out = writeTip({ match: dominantMatch(), result, market: 'win_match', angle: ANGLES[0] });
  assert.ok(out.ok, JSON.stringify(out.violations));
  const words = out.text.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= MIN_WORDS, `only ${words.length} words: ${out.text}`);
  assert.ok(out.text.indexOf('**') >= 0);
});

test('a tip contains no digits, so no odds, lines, set scores or game totals can leak', () => {
  const result = scoreMatch(dominantMatch());
  for (const market of ['win_match', 'first_set', 'games_handicap']) {
    const out = writeTip({ match: dominantMatch(), result, market, angle: ANGLES[0] });
    if (out.skip) continue;
    assert.equal(/\d/.test(out.text), false, `${market} leaked a numeral: ${out.text}`);
  }
});

test('no player name is used more than once in a tip', () => {
  const m = dominantMatch();
  const result = scoreMatch(m);
  for (const market of ['win_match', 'first_set', 'games_handicap']) {
    const out = writeTip({ match: m, result, market, angle: ANGLES[1] });
    if (out.skip) continue;
    for (const n of ['Carlos Alcaraz', 'Roman Safiullin']) {
      const count = (out.text.match(new RegExp(n, 'g')) || []).length;
      assert.ok(count <= 1, `${market}: "${n}" appears ${count} times`);
    }
  }
});

test('the validator catches a banned filler phrase', () => {
  const bad = '**Player A** is the pick on Win Match. This should be straightforward given everything ' +
    'about the matchup, and the recent results only reinforce that view from every angle considered. Confidence: HIGH.';
  const v = validateTip(bad, { market: 'win_match', names: { favourite: 'Player A', opponent: 'Player B' } });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('banned phrase')));
});

test('the validator catches a leaked handicap line', () => {
  const bad = '**Player A** covers on Games Handicap. Margins of victory on this court have been ' +
    'comfortable rather than marginal, and the record supports the same view throughout the season. ' +
    'A -5.5 spread is well within reach here. Confidence: HIGH.';
  const v = validateTip(bad, { market: 'games_handicap', names: { favourite: 'Player A', opponent: 'Player B' } });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('numerals')));
});

test('the validator catches a missing confidence level', () => {
  const bad = '**Player A** is the pick on Win Match. The record on this court is emphatic and the ' +
    'standing between the two reflects a full season of results rather than a flattering week.';
  const v = validateTip(bad, { market: 'win_match', names: { favourite: 'Player A', opponent: 'Player B' } });
  assert.ok(v.violations.some((x) => x.includes('confidence')));
});

test('a SKIP tip is one sentence and starts with SKIP', () => {
  const m = dominantMatch();
  m.players[0].form.straightSetsLast3 = [false, false, false];
  m.players[0].form.last5 = ['L', 'L', 'W', 'L', 'L'];
  const result = scoreMatch(m);
  const out = writeTip({ match: m, result, market: 'games_handicap', angle: ANGLES[0] });
  assert.equal(out.ok, true, JSON.stringify(out.violations));
  assert.equal(out.skip, true);
  assert.match(out.text, /^SKIP/);
  assert.equal(out.text.split(/(?<=[.!?])\s+/).length, 1);
});

test('no two tips in a card share an opening word', () => {
  const matches = [101, 102, 103].map((id) => dominantMatch(id));
  const card = scoreCard(matches);
  const { tips, violations } = writeCard(card.results);
  const emitted = tips.filter((t) => t.ok);
  assert.ok(emitted.length > 0, 'expected at least one tip');
  const openers = emitted.map((t) => t.text.split(/\s+/)[0].toLowerCase());
  const unique = new Set(openers);
  assert.equal(unique.size, openers.length, `duplicate openers: ${openers.join(', ')}`);
  assert.equal(violations.length, 0, JSON.stringify(violations));
});

test('writeCard emits all three markets for every match', () => {
  const matches = [201, 202].map((id) => dominantMatch(id));
  const card = scoreCard(matches);
  const { tips } = writeCard(card.results);
  assert.equal(tips.length, matches.length * 3);
  const markets = tips.map((t) => t.market);
  assert.equal(markets.filter((m) => m === 'win_match').length, matches.length);
  assert.equal(markets.filter((m) => m === 'first_set').length, matches.length);
  assert.equal(markets.filter((m) => m === 'games_handicap').length, matches.length);
});

test('BANNED_PHRASES covers every phrase the prompt names', () => {
  for (const p of ['this should be straightforward', 'a tough match', 'could go either way',
    'hard to call', 'the better player', 'on paper']) {
    assert.ok(BANNED_PHRASES.includes(p), `missing banned phrase: ${p}`);
  }
});
