/**
 * Tests for engine/baseball_writer.js — Step 4 output rules and the style
 * requirements, enforced mechanically by validateBaseballTip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBaseballTip, validateOpenerUniqueness, writeTip, writeBaseballCard,
  buildBaseballFormattedCardText, BANNED_PHRASES, OPENERS, MIN_WORDS,
} from '../engine/baseball_writer.js';
import { scoreBaseballCard, MARKETS, CONFIDENCE } from '../engine/baseball_engine.js';

const fullTeam = (over = {}) => ({
  name: 'Tampa Bay Rays', abbrev: 'TB',
  form: { last5: ['W', 'W', 'W', 'W', 'L'], winStreak: 4 },
  runDiffPerGame: 2.7, runsPerGameRecent: 5.4, runsAgainstPerGameRecent: 2.7,
  avgWinMarginLast5Wins: 3.1,
  starter: { name: 'Starter One', era: 2.62, confirmed: true, qualityStartsLast4: 3, qualityStartsLast3: 2, avgInningsPerStart: 6.4 },
  bullpenRank: 4, bullpenLeagueSize: 30,
  odds: { american: -200, decimal: 1.5 },
  ...over,
});
const weakTeam = (over = {}) => fullTeam({
  name: 'Chicago White Sox', abbrev: 'CWS',
  form: { last5: ['L', 'L', 'W', 'L', 'L'], winStreak: 0 },
  runDiffPerGame: -1.1, runsPerGameRecent: 3.2, runsAgainstPerGameRecent: 4.3,
  avgWinMarginLast5Wins: 1.1,
  starter: { name: 'Starter Two', era: 5.41, confirmed: true, qualityStartsLast4: 0, qualityStartsLast3: 0, avgInningsPerStart: 4.8 },
  bullpenRank: 27, bullpenLeagueSize: 30,
  odds: { american: 170, decimal: 2.7 },
  ...over,
});

const h2h = { meetings: 10, winsA: 7, winsB: 3, last10WinsA: 7, last10WinsB: 3, last3StreakA: true, last3StreakB: false };

const scoredCard = () => scoreBaseballCard([
  {
    id: 'g1', league: 'mlb', leagueName: 'Major League Baseball', dateISO: '2026-09-04',
    startUtc: '2026-09-04T18:10Z', h2h,
    home: fullTeam(), away: weakTeam({ runsPerGameRecent: 5.5 }),
  },
  {
    id: 'g2', league: 'mlb', leagueName: 'Major League Baseball', dateISO: '2026-09-04',
    startUtc: '2026-09-04T22:10Z', h2h,
    home: fullTeam({ name: 'Boston Red Sox', abbrev: 'BOS', runsPerGameRecent: 4.2 }),
    away: weakTeam({ name: 'Baltimore Orioles', abbrev: 'BAL', runsPerGameRecent: 4.1 }),
  },
]);

test('MIN_WORDS is 40, the floor the prompt sets for every tip', () => {
  assert.equal(MIN_WORDS, 40);
});

test('BANNED_PHRASES covers every filler phrase the prompt names', () => {
  for (const p of ['this should be a low-scoring affair', 'hard to look past', 'the pitching matchup favours', 'on current form', 'could go either way', 'both lineups', 'a tight contest']) {
    assert.ok(BANNED_PHRASES.includes(p), `"${p}" is banned`);
  }
});

test('every opener word is distinct', () => {
  const words = OPENERS.map((o) => o.word.toLowerCase());
  assert.equal(new Set(words).size, words.length);
});

test('a written win tip passes validation: bolded, 40+ words, no digits, confidence stated', () => {
  const card = writeBaseballCard(scoredCard().results, { dateISO: '2026-09-04' });
  const tip = card.tips.find((t) => t.market === MARKETS.WIN && t.matchId === 'g1');
  assert.ok(tip.validation.ok, tip.validation.violations.join('; '));
  assert.match(tip.text, /\*\*Tampa Bay Rays\*\*/);
  assert.match(tip.text, /Confidence: (HIGH|MEDIUM|LOW)/);
});

test('a written total tip states Over or Under, a run line tip states cover', () => {
  const card = writeBaseballCard(scoredCard().results, { dateISO: '2026-09-04' });
  const total = card.tips.find((t) => t.market === MARKETS.TOTAL && t.matchId === 'g1');
  const runLine = card.tips.find((t) => t.market === MARKETS.RUN_LINE && t.matchId === 'g1');
  assert.match(total.text, /\b(OVER|UNDER)\b/i);
  assert.match(runLine.text, /cover/i);
});

test('no two non-skip tips in a card open with the same word', () => {
  const card = writeBaseballCard(scoredCard().results, { dateISO: '2026-09-04' });
  assert.equal(card.openerProblems.length, 0, card.openerProblems.join('; '));
});

test('the formatted card text is copy-paste ready with the summary and gambling line', () => {
  const card = writeBaseballCard(scoredCard().results, { dateISO: '2026-09-04' });
  const text = buildBaseballFormattedCardText(card, '2026-09-04');
  assert.match(text, /BASEBALL PREDICTIONS — 2026-09-04/);
  assert.match(text, /SUMMARY/);
  assert.match(text, /gamble responsibly/i);
});

test('the validator refuses digits, banned fillers, forbidden words, and short tips', () => {
  const bad = validateBaseballTip('A **win** with a 3-1 scoreline and a 2.50 ERA. Confidence: HIGH.', { market: MARKETS.WIN });
  assert.equal(bad.ok, false);
  const filler = validateBaseballTip(`**${'x'.repeat(20)}** ${'this should be a low-scoring affair '.repeat(4)} Confidence: HIGH.`, { market: MARKETS.TOTAL });
  assert.equal(filler.ok, false);
  const word = validateBaseballTip(`**Over** ${'the away side travels well '.repeat(8)} Confidence: MEDIUM.`, { market: MARKETS.TOTAL });
  assert.equal(word.ok, false);
  const short = validateBaseballTip('**Over** a short tip. Confidence: HIGH.', { market: MARKETS.TOTAL });
  assert.equal(short.ok, false);
});

test('a total tip without Over/Under and a run line tip without cover are refused', () => {
  const total = validateBaseballTip(`**X** ${'a fairly long set of words '.repeat(6)} Confidence: HIGH.`, { market: MARKETS.TOTAL });
  assert.equal(total.ok, false);
  const runLine = validateBaseballTip(`**X** ${'a fairly long set of words '.repeat(6)} Confidence: HIGH.`, { market: MARKETS.RUN_LINE });
  assert.equal(runLine.ok, false);
});

test('a SKIP verdict is a single digit-free sentence beginning with SKIP', () => {
  const text = 'SKIP — WIN MATCH OUTRIGHT: the sourced evidence does not reach the standard required for a play on this fixture.';
  assert.equal(validateBaseballTip(text, { market: MARKETS.WIN, expectSkip: true }).ok, true);
  const bad = validateBaseballTip('the sourced evidence does not reach the standard required for a play on this fixture. And another sentence. And a third.', { market: MARKETS.WIN, expectSkip: true });
  assert.equal(bad.ok, false);
});
