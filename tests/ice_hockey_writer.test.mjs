/**
 * Tests for engine/ice_hockey_writer.js — Step 4 output rules and the style
 * requirements, enforced mechanically by validateIceHockeyTip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateIceHockeyTip, validateOpenerUniqueness, writeTip, writeIceHockeyCard,
  buildIceHockeyFormattedCardText, BANNED_PHRASES, OPENERS, MIN_WORDS,
} from '../engine/ice_hockey_writer.js';
import { scoreIceHockeyCardMixed, MARKETS, CONFIDENCE } from '../engine/ice_hockey_engine.js';

const fullTeam = (over = {}) => ({
  name: 'Ottawa Senators', abbrev: 'OTT',
  form: { last5: ['W', 'W', 'W', 'W', 'L'], winStreak: 4 },
  odds: { american: -260, decimal: 1.385 },
  goaltender: { savePctg: 0.924, isBackup: false, confirmed: true, last5SavePctg: 0.921 },
  shotsForRank: 4, shotsAgainstRank: 9, leagueSize: 32,
  powerPlayPctg: 28.4, penaltyKillPctg: 81.2, powerPlayOpportunitiesPerGame: 3.6,
  homeWinPctg: 63.4, goalsForPerGame: 3.62, avgWinMarginLast5Wins: 2.2,
  puckLineCovers: { of: 10, covered: 7 }, injuries: { keyForwardLineMissing: false },
  ...over,
});
const weakTeam = (over = {}) => fullTeam({
  name: 'Philadelphia Flyers', abbrev: 'PHI',
  form: { last5: ['L', 'L', 'W', 'L', 'L'], winStreak: 0 },
  odds: { american: 220, decimal: 3.2 },
  goaltender: { savePctg: 0.896, isBackup: false, confirmed: true, last5SavePctg: 0.891 },
  shotsForRank: 24, shotsAgainstRank: 27, powerPlayPctg: 17.1, penaltyKillPctg: 71.0,
  homeWinPctg: 41.0, backToBack: true, goalsForPerGame: 3.55, avgWinMarginLast5Wins: 1.1,
  puckLineCovers: { of: 10, covered: 3 }, injuries: { keyForwardLineMissing: true },
  ...over,
});

const scoredCard = () => scoreIceHockeyCardMixed([
  {
    id: 'g1', league: 'nhl', leagueName: 'National Hockey League', dateISO: '2026-10-08',
    total: { line: 5.5 }, home: fullTeam(), away: weakTeam(),
  },
  {
    id: 'g2', league: 'nhl', leagueName: 'National Hockey League', dateISO: '2026-10-08',
    total: { line: 4.5 },
    home: fullTeam({ name: 'Boston Bruins', abbrev: 'BOS', goalsForPerGame: 3.7, recentTotals: { games: 5, overs: 4, unders: 1 } }),
    away: weakTeam({ name: 'Montreal Canadiens', abbrev: 'MTL', goalsForPerGame: 3.6, recentTotals: { games: 5, overs: 3, unders: 2 } }),
  },
]);

test('MIN_WORDS is 40, the floor the prompt sets for every tip', () => {
  assert.equal(MIN_WORDS, 40);
});

test('BANNED_PHRASES covers every filler phrase the prompt names', () => {
  for (const phrase of [
    'this should be a high scoring affair',
    'hard to look past',
    'the better goaltender',
    'on current form',
    'could go either way',
    'both teams',
  ]) {
    assert.ok(BANNED_PHRASES.some((b) => b.includes(phrase.toLowerCase()) || phrase.toLowerCase().includes(b)),
      `banned phrase not covered: ${phrase}`);
  }
});

test('every opener word is distinct so no two tips can open alike', () => {
  const words = OPENERS.map((o) => o.word.toLowerCase());
  assert.equal(new Set(words).size, words.length);
  assert.ok(OPENERS.length >= 30, 'need at least 30 angles for a full card of tips');
});

test('three markets are written per match in the order the prompt demands', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  assert.equal(card.tips.length, 6);
  assert.deepEqual(card.tips.map((t) => t.label).slice(0, 3), ['OUTRIGHT WINNER', 'PUCK LINE', 'GAME TOTAL']);
});

test('every written tip passes its own validator', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  for (const tip of card.tips) {
    assert.equal(tip.validation.ok, true, `${tip.label}: ${tip.validation.violations.join('; ')}\n${tip.text}`);
  }
});

test('no two tips in one card open with the same word', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  assert.deepEqual(card.openerProblems, []);
});

test('the bolded outcome sits inside the first 20 words of every active tip', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  for (const tip of card.tips.filter((t) => !t.skip)) {
    const before = tip.text.slice(0, tip.text.indexOf('**')).split(/\s+/).filter(Boolean).length;
    assert.ok(before < 20, `${tip.label} bolds at word ${before + 1}`);
  }
});

test('no tip may contain a digit, so odds, lines and totals cannot leak', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  for (const tip of card.tips) {
    assert.equal(/\d/.test(tip.text.replace(/\*\*/g, '')), false, `digit found in ${tip.label}`);
  }
});

test('a puck line tip states who covers and never the line number', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  const puck = card.tips.find((t) => t.market === MARKETS.PUCK_LINE && !t.skip);
  assert.match(puck.text, /cover/i);
});

test('a game total tip states Over or Under and never the total', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  const total = card.tips.find((t) => t.market === MARKETS.TOTAL && !t.skip);
  assert.match(total.text, /\*\*(OVER|UNDER)\*\*/);
});

test('the validator rejects a banned filler phrase', () => {
  const bad = 'Both teams have shown flashes of quality recently and this could go either way, but **Boston Bruins** look the stronger group across the sixty minutes of this contest and the value sits there. Confidence: MEDIUM.';
  const v = validateIceHockeyTip(bad, { market: MARKETS.OUTRIGHT });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('banned filler phrase')));
});

test('the validator rejects a tip with no bolded outcome and no confidence', () => {
  const v = validateIceHockeyTip('A long enough body of text to clear the word floor but missing every structural requirement the prompt sets out for a published tip on this fixture. ', { market: MARKETS.OUTRIGHT });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('no bolded outcome')));
  assert.ok(v.violations.some((x) => x.includes('confidence level')));
});

test('the validator rejects links, brackets and internal vocabulary', () => {
  const v = validateIceHockeyTip('**Boston Bruins** to win — the model edge and implied probability are clear [1](https://example.com) and the backtest supports the play with plenty of room to spare on the numbers. Confidence: HIGH.', { market: MARKETS.OUTRIGHT });
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('forbidden token')));
});

test('a below-threshold match is written as SKIP with a single explanatory sentence', () => {
  const poor = scoreIceHockeyCardMixed([
    { id: 'p1', league: 'Finland SM Liiga', dateISO: '2026-09-04', home: { name: 'Pelicans' }, away: { name: 'Sport' } },
  ]).results;
  const card = writeIceHockeyCard(poor, { dateISO: '2026-09-04' });
  assert.equal(card.tips.length, 3);
  for (const tip of card.tips) {
    assert.equal(tip.skip, true);
    assert.match(tip.text, /^SKIP — /);
    assert.equal(tip.validation.ok, true, tip.validation.violations.join('; '));
    assert.equal(tip.confidence, CONFIDENCE.SKIP);
  }
});

test('a data-poor card still publishes a summary, a back-to-back note and the reminder', () => {
  const poor = scoreIceHockeyCardMixed([
    { id: 'p1', dateISO: '2026-09-04', home: { name: 'Pelicans', backToBack: true }, away: { name: 'Sport' } },
  ]).results;
  const card = writeIceHockeyCard(poor, { dateISO: '2026-09-04' });
  assert.match(card.backToBackNote, /Pelicans/);
  assert.match(card.responsibleGambling, /responsibly/i);
  assert.deepEqual(card.summary.active, []);
});

test('a card with no back-to-back sides says so rather than staying silent', () => {
  const rested = scoreIceHockeyCardMixed([
    {
      id: 'g3', leagueName: 'National Hockey League', dateISO: '2026-10-08', total: { line: 5.5 },
      home: fullTeam(), away: weakTeam({ backToBack: false }),
    },
  ]).results;
  const card = writeIceHockeyCard(rested, { dateISO: '2026-10-08' });
  assert.match(card.backToBackNote, /no side on this card/);
});

test('a card with a tired side names that side in the flag note', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  assert.match(card.backToBackNote, /Philadelphia Flyers/);
});

test('the summary table lists active picks with their confidence and honours the cap', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  assert.ok(card.summary.active.length > 0);
  for (const row of card.summary.active) {
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(row.confidence));
    assert.ok(row.selection && row.selection.length > 1);
  }
  assert.ok(card.summary.active.length <= 6);
});

test('the formatted card text is copy-paste ready and carries every section', () => {
  const card = writeIceHockeyCard(scoredCard().results, { dateISO: '2026-10-08' });
  const text = card.formattedText;
  assert.match(text, /ICE HOCKEY PREDICTIONS — 2026-10-08/);
  assert.match(text, /OUTRIGHT WINNER/);
  assert.match(text, /PUCK LINE/);
  assert.match(text, /GAME TOTAL/);
  assert.match(text, /SUMMARY/);
  assert.match(text, /Back-to-back flag/);
  assert.match(text, /gamble responsibly/i);
  assert.equal(buildIceHockeyFormattedCardText(card, '2026-10-08'), text);
});

test('writeTip returns the numeric reason alongside a digit-free SKIP tip', () => {
  const poor = scoreIceHockeyCardMixed([
    { id: 'p1', dateISO: '2026-09-04', home: { name: 'Pelicans' }, away: { name: 'Sport' } },
  ]).results[0];
  const tip = writeTip(poor, MARKETS.OUTRIGHT, 0);
  assert.equal(tip.skip, true);
  assert.equal(/\d/.test(tip.text), false);
  assert.ok(tip.reason && tip.reason.length > 0);
});

test('opener uniqueness checking catches a repeated opening word', () => {
  const problems = validateOpenerUniqueness([
    { text: 'Goaltending dominance frames this one.', market: 'outright' },
    { text: 'Goaltending structure decides this one.', market: 'puck_line' },
  ]);
  assert.equal(problems.length, 1);
});
