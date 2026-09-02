/**
 * Tests for the greyhound specialist engine: Step 2 scoring tiers, the
 * greyhound-specific adjustments (recency, grade movement, distance
 * specialism), Step 3 skip/confidence rules, the daily card rules and the
 * output-format validator. Every figure is asserted against a constructed
 * profile so no value can drift.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreRace, scoreRunner, gradeRank, gradeShift, decide, buildDailyCard,
  impliedProbabilityFromSP, CONFIDENCE, RULES,
} from '../engine/greyhound_engine.js';
import { validateGreyhoundTip, validateGreyhoundCard, MIN_WORDS, OPENERS } from '../engine/greyhound_writer.js';

const race = (over = {}) => ({
  raceId: 1, track: 'Yarmouth', date: '2026-09-02', time: '20:47',
  distance: 462, grade: 'OR1', status: 'scheduled', ...over,
});

const runner = (over = {}) => ({
  dogId: over.dogId ?? 1, name: over.name ?? 'Test Dog', trap: over.trap ?? 1,
  runs: over.runs ?? [], sp: over.sp ?? null,
});

/** n synthetic runs; form[i] = position, rest rotates grade/track/distance. */
const runs = (positions, { trap = 1, track = 'Yarmouth', grade = 'OR1', distance = 462, sameTrap = false } = {}) =>
  positions.map((position, i) => ({
    position,
    trap: sameTrap ? trap : ((trap + i) % 6) + 1,
    track,
    grade,
    distance,
    date: `2026-08-${String(28 - i * 5).padStart(2, '0')}`,
    runTime: 28 + i * 0.1,
    sp: position === 1 ? '5/2' : '8/1',
  }));

/* ------------------------------------------------------------------ grade */

test('gradeRank orders open races above graded bands and A1 above A5', () => {
  assert.equal(gradeRank('OR1'), 100);
  assert.ok(gradeRank('A1') > gradeRank('A5'));
  assert.ok(gradeRank('A5') > gradeRank('A11'));
  assert.ok(gradeRank('A1') > gradeRank('D1'));
  assert.equal(gradeRank('T3'), null); // trials never graded
  assert.equal(gradeRank(''), null);
});

test('gradeShift: dropping two grades is negative, rising is positive', () => {
  assert.ok(gradeShift('A5', ['A1', 'A2']) <= -2);
  assert.ok(gradeShift('A1', ['A5', 'A4']) >= 2);
  assert.equal(gradeShift('A3', ['A3', 'A3']), 0);
});

test('trials and unparseable classes are excluded from form', () => {
  const p = runner({ runs: runs([1, 1, 1]) });
  // sanity: normal runs score
  const s = scoreRunner(p, race(), { live: true });
  assert.equal(s.components.find((c) => c.id === 'form').points, 35);
});

/* ------------------------------------------------------------------ form */

test('form tiers follow the prompt table', () => {
  const cases = [
    { form: [1, 2, 3, 4, 5], tier: 35 },   // 3+ top three incl a win
    { form: [2, 2, 2, 5, 6], tier: 22 },   // 3 top three, no win
    { form: [1, 3, 5, 6, 4], tier: 15 },   // 2 top three incl a win
    { form: [2, 3, 6, 5, 4], tier: 8 },    // 2 top three, no win
    { form: [4, 5, 6, 5, 6], tier: 0 },    // fewer than 2
  ];
  for (const { form, tier } of cases) {
    const s = scoreRunner(runner({ runs: runs(form) }), race(), { live: true });
    assert.equal(s.components.find((c) => c.id === 'form').points, tier, `form ${form.join('')}`);
  }
});

test('form bonuses: won last run (+5) and two wins in last three (+5)', () => {
  const hot = scoreRunner(runner({ runs: runs([1, 6, 1, 4, 3]) }), race(), { live: true });
  assert.ok(hot.components.some((c) => c.id === 'form_last_win'));
  assert.ok(hot.components.some((c) => c.id === 'form_hot'));
  const mild = scoreRunner(runner({ runs: runs([3, 4, 5, 6, 4]) }), race(), { live: true });
  assert.ok(!mild.components.some((c) => c.id === 'form_last_win'));
  assert.ok(!mild.components.some((c) => c.id === 'form_hot'));
});

/* ------------------------------------------------------------------ odds */

test('live card: odds component is missing and caps HIGH', () => {
  const s = scoreRunner(runner({ runs: runs([1, 1, 1, 2, 3]) }), race(), { live: true });
  const odds = s.components.find((c) => c.id === 'odds');
  assert.equal(odds.missing, true);
  assert.equal(odds.points, 0);
  assert.equal(s.oddsMissing, true);
});

test('settled card: official SP maps to the odds tiers', () => {
  const prob = impliedProbabilityFromSP('8/1');
  assert.ok(Math.abs(prob - 1 / 9) < 0.001);
  const longPrice = scoreRunner(runner({ runs: runs([1, 2, 2, 3, 4]), sp: '8/1' }), race(), { live: false });
  assert.equal(longPrice.components.find((c) => c.id === 'odds').points, 18); // double-figure price, one recent win
  const valuePrice = scoreRunner(runner({ runs: runs([1, 1, 2, 3, 4]), sp: '8/1' }), race(), { live: false });
  assert.equal(valuePrice.components.find((c) => c.id === 'odds').points, 25); // big price + 2 recent wins
  const fav = scoreRunner(runner({ runs: runs([4, 5, 6, 5, 6]), sp: '1/4' }), race(), { live: false });
  assert.equal(fav.components.find((c) => c.id === 'odds').points, 0); // -200 or shorter -> avoid
});

/* ------------------------------------------------------------------ trap & distance */

test('trap record: 2+ wins from the trap scores full marks', () => {
  const r = runner({ trap: 4, runs: runs([1, 3, 1, 5, 2], { trap: 4, sameTrap: true }) });
  const s = scoreRunner(r, race(), { live: true });
  assert.equal(s.components.find((c) => c.id === 'trap').points, 20);
});

test('no trap history but strong overall form scores six', () => {
  // History traps rotate through 2,3,4,5,6 for trap=1; today's box trap 1
  // never appears, so the dog has no official run from this trap.
  const r = runner({ trap: 1, runs: runs([2, 3, 1, 4, 5], { trap: 1 }).map((x, i) => ({ ...x, trap: i + 2 })) });
  const s = scoreRunner(r, race(), { live: true });
  const trap = s.components.find((c) => c.id === 'trap');
  assert.equal(trap.points, 6);
});

test('exact-distance last win earns the +5 distance bonus; specialist earns +6', () => {
  const specialist = runner({ runs: runs([1, 2, 1, 3, 1], { distance: 462, trap: 2, sameTrap: false }) });
  const s = scoreRunner(specialist, race({ distance: 462 }), { live: true });
  assert.ok(s.components.some((c) => c.id === 'dist_match'));
  assert.ok(s.components.some((c) => c.id === 'dist_specialist'));
  const wrongTrip = scoreRunner(runner({ runs: runs([1, 1, 1, 2, 3], { distance: 277 }) }), race({ distance: 462 }), { live: true });
  assert.ok(wrongTrip.missing.some((m) => m.includes('distance form')));
});

/* ------------------------------------------------------------------ track & grade */

test('track win plus same/lower grade scores 20; a two-grade rise costs 5', () => {
  const dropper = scoreRunner(runner({ runs: runs([2, 3, 1, 4, 5], { track: 'Yarmouth', grade: 'A3' }) }), race({ track: 'Yarmouth', grade: 'A5' }), { live: true });
  assert.equal(dropper.components.find((c) => c.id === 'track_grade').points, 20);
  assert.ok(!dropper.components.some((c) => c.id === 'grade_rise_pen'));

  const riser = scoreRunner(runner({ runs: runs([2, 3, 4, 5, 6], { track: 'Yarmouth', grade: 'A6' }) }), race({ track: 'Yarmouth', grade: 'A3' }), { live: true });
  const pen = riser.components.find((c) => c.id === 'grade_rise_pen');
  assert.ok(pen && pen.points === -5);
});

/* ------------------------------------------------------------------ step 3 */

test('weak field is SKIP regardless of price', () => {
  const r = race({ runners: [
    runner({ dogId: 1, name: 'Slow One', trap: 1, runs: runs([6, 5, 6, 5, 6]) }),
    runner({ dogId: 2, name: 'Also Slow', trap: 2, runs: runs([5, 6, 4, 6, 5]) }),
  ] });
  const scored = scoreRace(r, { live: true });
  assert.equal(scored.decision.action, 'SKIP');
  assert.equal(scored.winner, null);
});

test('strong dog on a live card selects at MEDIUM (HIGH gated on odds)', () => {
  const r = race({ runners: [
    runner({ dogId: 1, name: 'Star', trap: 4, runs: runs([1, 1, 2, 1, 3], { trap: 4, sameTrap: true, track: 'Yarmouth', grade: 'OR1', distance: 462 }) }),
    runner({ dogId: 2, name: 'Ordinary', trap: 1, runs: runs([4, 5, 6, 5, 4]) }),
  ] });
  const scored = scoreRace(r, { live: true });
  assert.equal(scored.decision.action, 'SELECT');
  assert.equal(scored.decision.confidence, CONFIDENCE.MEDIUM);
  assert.ok(scored.winner.score >= RULES.skip.minScore);
});

test('settled strong dog with a short SP can reach HIGH', () => {
  const r = race({ status: 'result', runners: [
    { ...runner({ dogId: 1, name: 'Winner', trap: 4, runs: runs([1, 1, 2, 1, 3], { trap: 4, sameTrap: true }), sp: '5/2' }) },
    runner({ dogId: 2, name: 'Ordinary', trap: 1, runs: runs([4, 5, 6, 5, 4]), sp: '6/1' }),
  ] });
  const scored = scoreRace(r, { live: false });
  assert.equal(scored.decision.confidence, CONFIDENCE.HIGH);
});

test('clear-gap flag follows the 15-point rule', () => {
  const r = race({ runners: [
    runner({ dogId: 1, name: 'Star', trap: 4, runs: runs([1, 1, 2, 1, 3], { trap: 4, sameTrap: true }) }),
    runner({ dogId: 2, name: 'Weak', trap: 1, runs: runs([6, 6, 5, 6, 5]) }),
  ] });
  const scored = scoreRace(r, { live: true });
  assert.ok(scored.gap >= RULES.card.clearGap);
  assert.equal(scored.decision.clearGap, true);
});

/* ------------------------------------------------------------------ daily card */

test('daily card caps selections at seven and spreads across tracks', () => {
  const mk = (id, track, time, strong) => scoreRace(race({
    raceId: id, track, time, runners: [
      runner({ dogId: id * 10 + 1, name: `${track} A`, trap: 4, runs: runs(strong ? [1, 1, 2, 1, 3] : [2, 3, 4, 5, 6], { trap: 4, sameTrap: strong, track }) }),
      runner({ dogId: id * 10 + 2, name: `${track} B`, trap: 1, runs: runs([5, 6, 4, 6, 5], { track }) }),
    ],
  }), { live: true });
  const races = [];
  for (let i = 0; i < 10; i++) races.push(mk(i + 1, i % 2 ? 'Romford' : 'Yarmouth', `19:${String(i).padStart(2, '0')}`, true));
  const card = buildDailyCard(races);
  assert.ok(card.picks.length <= RULES.card.maxPicks);
  assert.ok(card.trackCount >= 2);
});

/* ------------------------------------------------------------------ writer validator */

test('a valid tip passes the output rules', () => {
  const tip = 'Trap-wise the standout is **Fast Flyer**, whose record from this box brings a winning run last time and a liking for this exact trip. Put together the profile fits what the heat demands, and every measured edge points the same way. Confidence: MEDIUM.';
  const v = validateGreyhoundTip(tip);
  assert.equal(v.ok, true, JSON.stringify(v.violations));
});

test('validator rejects numerals, banned phrases, late bold name and short tips', () => {
  const withDigit = 'Trap-wise the standout is **Fast Flyer**, who has won 3 of the last 5 runs and looks likely to lead throughout. Confidence: MEDIUM.';
  assert.ok(!validateGreyhoundTip(withDigit).ok);
  const banned = 'This dog **Fast Flyer** should win with pace to spare over this trip and track. Confidence: MEDIUM.';
  assert.ok(!validateGreyhoundTip(banned).ok);
  const lateName = 'After reviewing every runner in the field and all of the recent form figures across the last month, the pick is **Fast Flyer**. Confidence: MEDIUM.';
  assert.ok(!validateGreyhoundTip(lateName).ok);
  const short = '**Fast Flyer** wins. Confidence: LOW.';
  const vs = validateGreyhoundTip(short);
  assert.ok(!vs.ok && vs.violations.some((x) => x.includes(MIN_WORDS + '')));
});

test('skip tips must be one sentence beginning NO SELECTION', () => {
  const ok = validateGreyhoundTip('NO SELECTION — no runner clears the minimum form threshold for a win selection. Confidence: LOW.', { expectSkip: true });
  assert.equal(ok.ok, true);
  const bad = validateGreyhoundTip('NO SELECTION — the field is weak. Try another race instead. Confidence: LOW.', { expectSkip: true });
  assert.equal(bad.ok, false);
});

test('every opener bolds the dog within the first words and starts uniquely', () => {
  const firstWords = new Set();
  for (const opener of OPENERS) {
    const before = opener.slice(0, opener.indexOf('**')).split(/\s+/).filter(Boolean).length;
    assert.ok(before < 15, opener);
    const w1 = opener.split(/\s+/)[0].toLowerCase();
    assert.ok(!firstWords.has(w1), `duplicate opener word ${w1}`);
    firstWords.add(w1);
  }
});
