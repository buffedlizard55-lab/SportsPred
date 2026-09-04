/**
 * Tests for the CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0
 * overlay: every Step 2 tier, every Step 3 rule, the edition gate, and the
 * Step 4 output rules. Each figure is asserted against a constructed input so
 * no value can drift away from the prompt table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDITIONS, RULES, editionFor,
  scoreShortFormatForm, scoreRankingGap, scoreHeadToHead, scoreBreakBuilding,
  scoreOddsValue, scoreMatchResult, scoreCorrectScore, scoreGroupWinner,
  flagValueCandidate,
} from '../engine/snooker_cls_engine.js';

import {
  MIN_WORDS, BANNED_PHRASES, validateTip, writeMatchResult, writeCorrectScore,
  writeGroupWinner, RESPONSIBLE_GAMBLING, openingWord,
} from '../engine/snooker_cls_writer.js';

const last5 = (results) => ({ name: 'P', last5: results.map((r) => ({ result: r, margin: 3, scoreline: '3-0' })) });

/* ---------------------------------------------------------- edition gate */

test('the edition must be stated before scoring', () => {
  assert.throws(() => editionFor(null), /must be stated/);
  assert.throws(() => editionFor('league'), /must be stated/);
  assert.equal(editionFor('ranking').bestOf, 4);
  assert.equal(editionFor('invitational').bestOf, 5);
});

test('the two editions differ exactly where the prompt says they do', () => {
  assert.equal(EDITIONS.ranking.drawPossible, true);
  assert.equal(EDITIONS.invitational.drawPossible, false);
  assert.deepEqual(EDITIONS.ranking.scorelines, ['3-0', '3-1', '2-2']);
  assert.deepEqual(EDITIONS.invitational.scorelines, ['3-0', '3-1', '3-2']);
  assert.equal(EDITIONS.ranking.points.win, 3);
  assert.equal(EDITIONS.ranking.points.draw, 1);
});

/* ------------------------------------------------- match result, 100 pts */

test('recent short-format form follows the prompt table', () => {
  const m = [];
  assert.equal(scoreShortFormatForm(last5(['win', 'win', 'win', 'win', 'win']), m).points, 30);
  assert.equal(scoreShortFormatForm(last5(['win', 'win', 'win', 'win', 'loss']), m).points, 30);
  assert.equal(scoreShortFormatForm(last5(['win', 'win', 'win', 'loss', 'loss']), m).points, 20);
  assert.equal(scoreShortFormatForm(last5(['win', 'win', 'loss', 'loss', 'loss']), m).points, 10);
  assert.equal(scoreShortFormatForm(last5(['win', 'loss', 'loss', 'loss', 'loss']), m).points, 0);
});

test('no short-format record is recorded missing, never guessed', () => {
  const missing = [];
  const c = scoreShortFormatForm({ name: 'P', last5: [] }, missing);
  assert.equal(c.points, 0);
  assert.equal(c.missing, true);
  assert.equal(missing.length, 1);
});

test('ranking and seeding gap follows the prompt table', () => {
  const m = [];
  assert.equal(scoreRankingGap(1, 100, m).points, 20);
  assert.equal(scoreRankingGap(10, 25, m).points, 12);
  assert.equal(scoreRankingGap(20, 22, m).points, 5);
  assert.equal(scoreRankingGap(60, 10, m).points, 0);
});

test('an unseeded amateur makes the ranking gap missing, not zero-by-guess', () => {
  const missing = [];
  const c = scoreRankingGap(null, 12, missing, { playerName: 'Amateur' });
  assert.equal(c.missing, true);
  assert.match(missing[0], /no seed number/);
});

test('head-to-head uses the prompt tiers including the neutral default', () => {
  assert.equal(scoreHeadToHead({ total: 0, meetings: [] }).points, 8);
  assert.equal(scoreHeadToHead({ total: 3, meetings: [{ result: 'win' }, { result: 'win' }, { result: 'loss' }] }).points, 20);
  assert.equal(scoreHeadToHead({ total: 2, meetings: [{ result: 'win' }, { result: 'loss' }] }).points, 10);
  assert.equal(scoreHeadToHead({ total: 2, meetings: [{ result: 'loss' }, { result: 'loss' }] }).points, 0);
});

test('break-building reads published highest breaks', () => {
  const m = [];
  assert.equal(scoreBreakBuilding([147], m).points, 15);
  assert.equal(scoreBreakBuilding([104, 112], m).points, 15);
  assert.equal(scoreBreakBuilding([101, 60], m).points, 8);
  assert.equal(scoreBreakBuilding([80, 60], m).points, 0);
  const missing = [];
  assert.equal(scoreBreakBuilding([], missing).missing, true);
});

test('odds are recorded missing because no free key-less snooker price feed exists', () => {
  const missing = [];
  const c = scoreOddsValue(null, missing);
  assert.equal(c.points, 0);
  assert.equal(c.missing, true);
  assert.match(missing[0], /no free, key-less snooker price feed/);
  assert.equal(scoreOddsValue(-400, []).points, 15);
  assert.equal(scoreOddsValue(-250, []).points, 11);
  assert.equal(scoreOddsValue(-175, []).points, 7);
  assert.equal(scoreOddsValue(-120, []).points, 4);
});

/* --------------------------------------------------------- draw modifier */

const side = (name, over = {}) => ({
  name, seed: 10, profile: last5(['win', 'win', 'win', 'win', 'win']),
  h2h: { total: 0, meetings: [] }, breaks: [110, 120], odds: null, ...over,
});

test('the draw is raised when the two sides score within eight points with neutral history', () => {
  const mr = scoreMatchResult({ edition: 'ranking', a: side('A'), b: side('B', { seed: 12 }) });
  assert.equal(mr.drawTriggered, true);
  assert.equal(mr.selection.type, 'draw');
});

test('the draw never applies in the invitational edition', () => {
  const mr = scoreMatchResult({ edition: 'invitational', a: side('A'), b: side('B', { seed: 12 }) });
  assert.equal(mr.drawTriggered, false);
  assert.equal(mr.selection.type, 'player');
});

test('a clearly stronger player is picked outright rather than drawn', () => {
  const mr = scoreMatchResult({
    edition: 'ranking',
    a: side('A', { seed: 2, profile: last5(['win', 'win', 'win', 'win', 'win']), breaks: [147] }),
    b: side('B', { seed: 120, profile: last5(['loss', 'loss', 'loss', 'loss', 'loss']), breaks: [40] }),
  });
  assert.equal(mr.selection.type, 'player');
  assert.equal(mr.selection.name, 'A');
});

test('match result confidence follows Step 3', () => {
  const strong = scoreMatchResult({
    edition: 'ranking',
    a: side('A', { seed: 1, odds: -400, h2h: { total: 3, meetings: [{ result: 'win' }, { result: 'win' }, { result: 'loss' }] } }),
    b: side('B', { seed: 120, profile: last5(['loss', 'loss', 'loss', 'loss', 'loss']), breaks: [30] }),
  });
  assert.equal(strong.score >= RULES.matchResult.high, true);
  assert.equal(strong.confidence, 'HIGH');

  const weak = scoreMatchResult({
    edition: 'ranking',
    a: side('A', { seed: null, profile: { name: 'A', last5: [] }, breaks: [], h2h: { total: 0, meetings: [] } }),
    b: side('B', { seed: null, profile: { name: 'B', last5: [] }, breaks: [], h2h: { total: 0, meetings: [] } }),
  });
  assert.equal(weak.confidence, 'SKIP');
  assert.equal(weak.skip, true);
});

/* ---------------------------------------------------------- correct score */

test('correct score uses the edition-correct outcome set', () => {
  const f = { edition: 'ranking', a: side('A'), b: side('B', { seed: 12 }), scorelineHistory: ['2-2'], recentMargins: [0] };
  const mr = scoreMatchResult(f);
  const cs = scoreCorrectScore(f, mr);
  assert.deepEqual(cs.outcomeSet, ['3-0', '3-1', '2-2']);
  assert.equal(cs.selection.scoreline, '2-2');

  const g = { ...f, edition: 'invitational' };
  const mr2 = scoreMatchResult(g);
  const cs2 = scoreCorrectScore(g, mr2);
  assert.deepEqual(cs2.outcomeSet, ['3-0', '3-1', '3-2']);
  assert.notEqual(cs2.selection.scoreline, '2-2');
});

test('correct score components never exceed their caps', () => {
  const f = { edition: 'ranking', a: side('A'), b: side('B'), scorelineHistory: ['3-0', '3-0'], recentMargins: [3, 3] };
  const cs = scoreCorrectScore(f, scoreMatchResult(f));
  for (const c of cs.components) assert.ok(c.points <= c.max, `${c.id} exceeded its cap`);
  assert.ok(cs.score <= 100);
});

/* ----------------------------------------------------------- group winner */

const gp = (name, seed, results, breaks, h2h = []) => ({
  name, seed, profile: last5(results), breaks, groupH2H: h2h,
});

test('a group is marked too open when the leader is not fifteen points clear', () => {
  // Four players indistinguishable on every sourced measure: nobody can be
  // fifteen points clear, so no selection may be named.
  const gw = scoreGroupWinner({
    edition: 'ranking',
    label: 'Group 1',
    players: [
      gp('A', 10, ['win', 'win', 'loss', 'loss', 'draw'], [105]),
      gp('B', 10, ['win', 'win', 'loss', 'loss', 'draw'], [104]),
      gp('C', 10, ['win', 'win', 'loss', 'loss', 'draw'], [103]),
      gp('D', 10, ['win', 'win', 'loss', 'loss', 'draw'], [102]),
    ],
  });
  assert.equal(gw.tooOpen, true);
  assert.equal(gw.selection, null);
  assert.ok(gw.clearBy < RULES.groupWinner.clearBy);
});

test('players level on every sourced measure share a strength tier', () => {
  const gw = scoreGroupWinner({
    edition: 'ranking',
    label: 'Group T',
    players: [
      gp('A', 20, ['win', 'win', 'win', 'loss', 'loss'], [110]),
      gp('B', 20, ['win', 'win', 'win', 'loss', 'loss'], [110]),
      gp('C', 90, ['loss', 'loss', 'loss', 'loss', 'loss'], [40]),
      gp('D', 91, ['loss', 'loss', 'loss', 'loss', 'loss'], [40]),
    ],
  });
  const strengthOf = (n) => gw.candidates.find((c) => c.name === n).components.find((x) => x.id === 'strength').points;
  assert.equal(strengthOf('A'), strengthOf('B'), 'tied players must not be split by sort order alone');
});

test('a dominant candidate is named and clears the fifteen-point rule', () => {
  const gw = scoreGroupWinner({
    edition: 'ranking',
    label: 'Group 2',
    players: [
      gp('Strong', 1, ['win', 'win', 'win', 'win', 'win'], [147], [{ result: 'win' }, { result: 'win' }]),
      gp('Weak1', 120, ['loss', 'loss', 'loss', 'loss', 'loss'], [40], [{ result: 'loss' }, { result: 'loss' }]),
      gp('Weak2', 121, ['loss', 'loss', 'loss', 'draw', 'draw'], [45], [{ result: 'loss' }, { result: 'loss' }]),
      gp('Weak3', 122, ['loss', 'draw', 'draw', 'draw', 'loss'], [50], [{ result: 'loss' }, { result: 'loss' }]),
    ],
  });
  assert.equal(gw.tooOpen, false);
  assert.equal(gw.selection.name, 'Strong');
  assert.ok(gw.clearBy >= RULES.groupWinner.clearBy);
});

test('the points path rewards outright wins over repeated draws', () => {
  const winner = scoreGroupWinner({
    edition: 'ranking', label: 'G',
    players: [
      gp('Winner', 5, ['win', 'win', 'win', 'loss', 'loss'], [110]),
      gp('Drawer', 6, ['draw', 'draw', 'draw', 'draw', 'draw'], [110]),
      gp('X', 90, ['loss', 'loss', 'loss', 'loss', 'loss'], [50]),
      gp('Y', 91, ['loss', 'loss', 'loss', 'loss', 'loss'], [50]),
    ],
  });
  const w = winner.candidates.find((c) => c.name === 'Winner');
  const d = winner.candidates.find((c) => c.name === 'Drawer');
  const pathOf = (c) => c.components.find((x) => x.id === 'path').points;
  assert.ok(pathOf(w) > pathOf(d), 'an outright-win path must outscore a drawing path');
});

/* --------------------------------------------------------- value flagging */

test('a value candidate is only flagged for a live underdog', () => {
  const mr = scoreMatchResult({
    edition: 'ranking',
    a: side('Underdog', { seed: 100, profile: last5(['win', 'win', 'win', 'win', 'win']), breaks: [147], h2h: { total: 3, meetings: [{ result: 'win' }, { result: 'win' }, { result: 'loss' }] } }),
    b: side('Favourite', { seed: 3, profile: last5(['loss', 'loss', 'loss', 'loss', 'loss']), breaks: [40], h2h: { total: 3, meetings: [{ result: 'loss' }, { result: 'loss' }, { result: 'win' }] } }),
  });
  const v = flagValueCandidate(mr);
  assert.ok(v);
  assert.equal(v.name, 'Underdog');
});

/* ------------------------------------------------------- Step 4 / writing */

test('every written tip clears forty words with the pick bolded early', () => {
  const f = {
    edition: 'ranking',
    a: side('Alpha', { seed: 2 }),
    b: side('Beta', { seed: 100, profile: last5(['loss', 'loss', 'loss', 'loss', 'loss']), breaks: [30] }),
    scorelineHistory: ['3-0'], recentMargins: [3],
  };
  const mr = scoreMatchResult(f);
  const cs = scoreCorrectScore(f, mr);
  for (const tip of [writeMatchResult(mr, { index: 0 }), writeCorrectScore(cs, mr, { index: 0 })]) {
    const v = validateTip(tip);
    assert.equal(v.ok, true, `violations: ${v.violations.join('; ')}`);
    assert.ok(tip.text.trim().split(/\s+/).length >= MIN_WORDS);
    assert.match(tip.text.split(/\s+/).slice(0, 20).join(' '), /\*\*[^*]+\*\*/);
  }
});

test('a figure outside the correct score market is rejected', () => {
  const bad = { market: 'MATCH RESULT', confidence: 'HIGH', text: `**Alpha** wins by 3 frames. ${'word '.repeat(50)}` };
  assert.equal(validateTip(bad).ok, false);
  assert.ok(validateTip(bad).violations.some((v) => /figure/.test(v)));
});

test('the correct score market may name its scoreline but no other figure', () => {
  const good = { market: 'CORRECT SCORE', confidence: 'HIGH', text: `**3-1** is the projected margin here. ${'word '.repeat(50)}` };
  assert.equal(validateTip(good).ok, true);
  const bad = { market: 'CORRECT SCORE', confidence: 'HIGH', text: `**3-1** is the margin, 4 of 5 recently. ${'word '.repeat(50)}` };
  assert.equal(validateTip(bad).ok, false);
});

test('every banned phrase from the prompt is rejected', () => {
  for (const phrase of BANNED_PHRASES) {
    const tip = { market: 'MATCH RESULT', confidence: 'HIGH', text: `**Alpha** is the pick and ${phrase} here. ${'word '.repeat(50)}` };
    const v = validateTip(tip);
    assert.equal(v.ok, false, `"${phrase}" should be rejected`);
    assert.ok(v.violations.some((x) => x.includes(phrase)));
  }
});

test('links, citations and handles are rejected', () => {
  for (const bad of ['see https://wst.tv', 'via @snookerhq', 'per Wikipedia', '[link](http://x.com)']) {
    const tip = { market: 'MATCH RESULT', confidence: 'HIGH', text: `**Alpha** is the pick, ${bad}. ${'word '.repeat(50)}` };
    assert.equal(validateTip(tip).ok, false, `"${bad}" should be rejected`);
  }
});

test('confidence must be one of the four permitted bands', () => {
  const tip = { market: 'MATCH RESULT', confidence: 'PROBABLE', text: `**Alpha** is the pick. ${'word '.repeat(50)}` };
  assert.ok(validateTip(tip).violations.some((v) => /confidence must be/.test(v)));
});

test('a below-threshold market is written as SKIP with one explanatory sentence', () => {
  const mr = { skip: true, score: 12, missing: ['odds'], selection: { type: 'player', name: 'A' } };
  const tip = writeMatchResult(mr, { index: 0 });
  assert.equal(tip.pick, 'SKIP');
  assert.equal(tip.confidence, 'SKIP');
  assert.match(tip.text, /^SKIP — /);
  assert.equal(validateTip(tip).ok, true);
});

test('a group with no clear leader is written as too open to call', () => {
  const tip = writeGroupWinner({ tooOpen: true, score: 40, reason: 'the leading candidate is only four points clear of the next' }, { index: 0 });
  assert.equal(tip.pick, 'TOO OPEN');
  assert.match(tip.text, /TOO OPEN TO CALL/);
  assert.equal(validateTip(tip).ok, true);
});

test('the responsible gambling section is substantive and names a real helpline', () => {
  assert.ok(RESPONSIBLE_GAMBLING.paragraphs.length >= 3, 'must not be a single closing line');
  assert.equal(RESPONSIBLE_GAMBLING.helpline.phone, '0808 80 20 133');
  assert.match(RESPONSIBLE_GAMBLING.helpline.name, /GamCare/);
  const all = RESPONSIBLE_GAMBLING.paragraphs.join(' ');
  assert.match(all, /not guarantees/);
  assert.match(all, /comfortable losing/);
  assert.match(all, /limits/);
});

test('openingWord ignores markdown emphasis', () => {
  assert.equal(openingWord('**Alpha** is the pick'), 'alpha');
  assert.equal(openingWord('Expect **3-1** here'), 'expect');
});
