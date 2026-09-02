/**
 * F1 writer tests — Step 4 output rules enforced mechanically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateF1Tip, validateF1Card, writeF1RaceCard, buildF1CardText,
  MIN_WORDS, MAX_SELECTIONS, BANNED_PHRASES,
} from '../engine/f1_writer.js';

const good = (name = 'Lando Norris', band = 'MEDIUM', opener = 'Racing') =>
  `${opener} **${name}** carries recent winning form in the closing rounds. The case rests on sourced race data, not reputation: the pattern above repeats across the rounds that matter. That makes ${name} the strongest claim to the race win for this Grand Prix, with the conditions and the venue both supporting the argument. Confidence: ${band}.`;

test('a compliant 40+ word tip validates', () => {
  assert.equal(validateF1Tip(good()).ok, true);
});

test('under-40-word tips are rejected', () => {
  const v = validateF1Tip(`${good().split(' ').slice(0, 20).join(' ')}.`);
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('words')));
});

test('bolded outcome must appear within the first 20 words', () => {
  const late = `one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone **X** and more words still here. Confidence: HIGH.`;
  const v = validateF1Tip(late);
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('after 20 words')));
});

test('digits, bracket refs, banned phrases and source names are rejected', () => {
  assert.equal(validateF1Tip(good().replace('Racing', 'P 2 3')).ok, false);
  assert.equal(validateF1Tip(good() + ' [source]').ok, false);
  assert.equal(validateF1Tip(good().replace('Racing', 'hard to look past')).ok, false);
  assert.equal(validateF1Tip(good().replace('Racing', 'OLBG w')).ok, false);
});

test('SKIP tips are formatted as NO SELECTION with one sentence + confidence', () => {
  const v = validateF1Tip('NO SELECTION The engine has no sourced evidence for this market. Confidence: LOW.', { expectSkip: true });
  assert.equal(v.ok, true);
  const bad = validateF1Tip('The engine lacks evidence. Second sentence here. Confidence: LOW.', { expectSkip: true });
  assert.equal(bad.ok, false);
  const noBold = validateF1Tip('NO SELECTION One sentence only no confidence here.', { expectSkip: true });
  assert.equal(noBold.ok, false);
});

test('writeF1RaceCard emits all five categories with unique openers and NO SELECTION for fastest lap', () => {
  const scored = {
    markets: {
      race_winner: {
        band: 'MEDIUM', score: 60, selection: 'A',
        missing: ['odds'], components: [],
        candidates: [
          { name: 'A', team: 'T', score: 60, band: 'MEDIUM', profile: { name: 'A', last5Wins: 2, trackWins: 1, championshipRank: 1 } },
          { name: 'B', team: 'T', score: 55, band: 'MEDIUM', profile: { name: 'B', last5Podiums: 3, championshipRank: 2 } },
        ],
      },
      podium_finish: {
        band: 'MEDIUM', score: 58, selection: 'C', missing: [], components: [],
        candidates: [
          { name: 'C', team: 'T', score: 58, band: 'MEDIUM', profile: { name: 'C', last5Podiums: 3, trackPodiums: 1 } },
        ],
      },
      fastest_lap: {
        band: 'SKIP', score: 23, selection: null, missing: ['fastestLapStrategy'], components: [], candidates: [],
      },
      points_finish: {
        band: 'MEDIUM', score: 55, selection: 'D', missing: ['overtakes'], components: [],
        candidates: [
          { name: 'D', team: 'T', score: 55, band: 'MEDIUM', profile: { name: 'D', last5Points: 4, championshipRank: 4 } },
        ],
      },
      top6_finish: {
        band: 'MEDIUM', score: 56, selection: 'E', missing: ['overtakingDifficulty'], components: [],
        candidates: [
          { name: 'E', team: 'T', score: 56, band: 'MEDIUM', profile: { name: 'E', last5Points: 4, trackPoints: 2 } },
        ],
      },
    },
  };
  const written = writeF1RaceCard(scored, { name: 'Italian Grand Prix' });
  assert.equal(written.tips.length, 5);
  assert.equal(written.tips.find((t) => t.market === 'FASTEST LAP').skip, true);
  const validation = validateF1Card(written);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test('no more than six active selections per weekend', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    name: `D${i}`, team: 'T', score: 60 - i, band: 'MEDIUM',
    profile: { name: `D${i}`, last5Wins: 1 },
    missing: [],
  }));
  const scored = {
    markets: {
      race_winner: { band: 'MEDIUM', score: 60, selection: many[0].name, components: [], missing: [], candidates: many.slice(0, 3) },
      podium_finish: { band: 'MEDIUM', score: 60, selection: many[3].name, components: [], missing: [], candidates: many.slice(3, 6) },
      fastest_lap: { band: 'SKIP', score: 0, selection: null, components: [], missing: ['strategy'], candidates: [] },
      points_finish: { band: 'MEDIUM', score: 60, selection: many[6].name, components: [], missing: [], candidates: many.slice(6, 9) },
      top6_finish: { band: 'SKIP', score: 0, selection: null, components: [], missing: [], candidates: [] },
    },
  };
  const written = writeF1RaceCard(scored, {});
  const active = written.tips.filter((t) => !t.skip).length;
  assert.ok(active <= MAX_SELECTIONS, `active=${active} > ${MAX_SELECTIONS}`);
});

test('buildF1CardText includes table, weather note and RG reminder', () => {
  const text = buildF1CardText({ tips: [
    { market: 'RACE WINNER', name: 'A', band: 'MEDIUM', skip: false },
    { market: 'FASTEST LAP', name: null, band: 'SKIP', skip: true },
  ] }, { name: 'Italian Grand Prix', weather: { precipProbPct: 45 } });
  assert.ok(text.includes('Prediction Card'));
  assert.ok(text.includes('Responsible Gambling'));
  assert.ok(text.includes('weather-dependent'));
});

test('BANNED_PHRASES contains every phrase the prompt names', () => {
  for (const p of ['the faster car', 'should be on the podium', 'hard to look past', 'on current form', 'it would be a surprise', 'the class of the field']) {
    assert.ok(BANNED_PHRASES.includes(p), p);
  }
  assert.equal(MIN_WORDS, 40);
});
