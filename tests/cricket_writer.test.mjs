import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreCricketCard } from '../engine/cricket_engine.js';
import {
  writeCricketCard,
  writeCricketTip,
  validateCricketTip,
  buildCricketFormattedCardText,
  CRICKET_OPENERS,
  BANNED_PHRASES,
} from '../engine/cricket_writer.js';

const match = {
  event_id: 'e1', format: 'T20', home: 'Alpha XI', away: 'Beta XI',
  pitch: { favours: 'spin' },
  homeTeamObj: {
    name: 'Alpha XI', odds: { win: 1.6 }, form: { last5: ['W', 'W', 'W', 'W', 'L'], winStreak: 4 },
    bowling: { style: 'spin' }, batting: { weakness: null, inFormBatsmen: ['a', 'b', 'c'] },
    momCandidates: [{ id: 'm1', name: 'Spin Allrounder', role: 'allrounder', battingPosition: 6, bowlingStyle: 'spin', opensBowling: true,
      odds: { mom: 600 }, recent: { fiftyOrWicket3: 3, allRoundContributions: 2, scoresOver40: 2 }, strikeRateVsTeamAvg: 'slightly_above' }],
    batsmanCandidates: [{ id: 'b1', name: 'Alpha Opener', role: 'batsman', battingPosition: 1, battingStyle: 'aggressive',
      odds: { topBatsman: 300 }, recent: { scoresOver40: 3, fiftyLastMatch: true }, strikeRateVsTeamAvg: 'above', powerplayRecord: 'strong' }],
  },
  awayTeamObj: {
    name: 'Beta XI', odds: { win: 2.6 }, form: { last5: ['L', 'L', 'W', 'L', 'L'] },
    bowling: { style: 'pace' }, batting: { weakness: 'spin', inFormBatsmen: ['d'] },
    momCandidates: [{ id: 'm2', name: 'Beta Tail', role: 'bowler', battingPosition: 9, bowlingStyle: 'pace', opensBowling: true,
      odds: { mom: 2000 }, recent: { fiftyOrWicket3: 1 } }],
    batsmanCandidates: [{ id: 'b2', name: 'Beta Lower', role: 'batsman', battingPosition: 7,
      odds: { topBatsman: 400 }, recent: { scoresOver40: 1 }, strikeRateVsTeamAvg: 'average' }],
  },
  h2h: { totalMeetings: 10, teamWins: 7, recentMeetings: ['W', 'W', 'W'], sameVenueType: true },
};

test('every opener has a unique opening word', () => {
  const words = CRICKET_OPENERS.map((o) => o.word.toLowerCase());
  assert.equal(new Set(words).size, words.length);
});

test('a full card produces four tips per match in mandated order', () => {
  const card = scoreCricketCard([match]);
  const written = writeCricketCard(card.results);
  assert.equal(written.violations.filter((v) => !v.openerPoolExhausted).length, 0, JSON.stringify(written.violations));
  const okTips = written.tips.filter((t) => t.ok);
  assert.equal(okTips.length, 4);
  assert.deepEqual(okTips.map((t) => t.market),
    ['win_match', 'man_of_the_match', 'top_team1_batsman', 'top_team2_batsman']);
});

test('every non-skip tip passes validation: 40+ words, bold in first 20, no digits', () => {
  const card = scoreCricketCard([match]);
  const written = writeCricketCard(card.results);
  for (const t of written.tips) {
    if (!t.ok || t.skip) continue;
    const v = validateCricketTip(t.text);
    assert.ok(v.ok, `tip ${t.market}: ${JSON.stringify(v.violations)}\n${t.text}`);
  }
});

test('no two non-skip tips open with the same word', () => {
  const card = scoreCricketCard([match, { ...match, event_id: 'e2' }]);
  const written = writeCricketCard(card.results);
  const openers = written.tips.filter((t) => t.ok && !t.skip).map((t) => t.text.split(/\s+/)[0].toLowerCase());
  assert.equal(new Set(openers).size, openers.length, `duplicate openers: ${openers.join(', ')}`);
});

test('SKIP tips are a single sentence starting with SKIP', () => {
  const card = scoreCricketCard([{
    event_id: 'e3', format: 'T20', home: 'X', away: 'Y',
    homeTeamObj: { name: 'X', form: { last5: [] }, bowling: {}, batting: {}, momCandidates: [], batsmanCandidates: [] },
    awayTeamObj: { name: 'Y', form: { last5: [] }, bowling: {}, batting: {}, momCandidates: [], batsmanCandidates: [] },
    h2h: null, pitch: null,
  }]);
  const written = writeCricketCard(card.results);
  for (const t of written.tips.filter((t) => t.ok && t.skip)) {
    assert.ok(/^SKIP/.test(t.text));
    const sentences = t.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.equal(sentences.length, 1, t.text);
  }
});

test('banned phrases never appear', () => {
  const card = scoreCricketCard([match, { ...match, event_id: 'e4' }, { ...match, event_id: 'e5' }]);
  const written = writeCricketCard(card.results);
  for (const t of written.tips) {
    const lower = (t.text || '').toLowerCase();
    for (const p of BANNED_PHRASES) assert.ok(!lower.includes(p), `banned phrase "${p}" in: ${t.text}`);
  }
});

test('formatted card contains summary table and responsible gambling note', () => {
  const card = scoreCricketCard([match]);
  const text = buildCricketFormattedCardText(card.results, '2026-09-01');
  assert.ok(text.includes('SUMMARY TABLE'));
  assert.ok(text.includes('RESPONSIBLE GAMBLING REMINDER'));
  assert.ok(text.includes('VALUE FLAG'));
});

test('tip names bolded outcome within first 20 words', () => {
  const card = scoreCricketCard([match]);
  const written = writeCricketCard(card.results);
  const winTip = written.tips.find((t) => t.market === 'win_match' && t.ok && !t.skip);
  const before = winTip.text.slice(0, winTip.text.indexOf('**')).split(/\s+/).filter(Boolean).length;
  assert.ok(before <= 20);
  assert.ok(winTip.text.includes('**Alpha XI**'));
});
