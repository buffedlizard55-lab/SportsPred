/**
 * Golf writer tests — Step 4 output format and style rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateGolfTip, validateGolfCard, writeGolfCard, buildGolfCardText, buildWeatherNote,
  BANNED_PHRASES, FORBIDDEN_TOKENS, GOLF_OPENERS, MIN_WORDS, factClauses,
} from '../engine/golf_writer.js';
import { CONFIDENCE, MARKETS } from '../engine/golf_engine.js';

const GOOD = 'Approach play decides most weeks on tour, and **Alpha Golfer** arrives with a victory inside the last six weeks, a top-five finish here in a recent edition, and a strong record on courses of this length. That combination makes Alpha Golfer the strongest outright claim in this field, with the pieces that usually decide a seventy-two-hole test all pointing the same way. Confidence: HIGH.';

test('a compliant tip passes and the rule set matches the prompt', () => {
  const v = validateGolfTip(GOOD);
  assert.deepEqual(v, { ok: true, violations: [] });
  assert.equal(MIN_WORDS, 40);
  for (const phrase of ['hard to look past', 'the class of the field', 'in fine form', 'a natural fit', 'on current form', 'one to watch', 'looks the part', 'could go well here']) {
    assert.ok(BANNED_PHRASES.includes(phrase), `banned: ${phrase}`);
  }
  for (const tok of ['odds', 'olbg', 'espn', 'owgr', 'strokes gained', 'stake', 'http']) assert.ok(FORBIDDEN_TOKENS.includes(tok));
});

test('validator rejects every style violation the prompt names', () => {
  const bad = (t, re) => assert.ok(validateGolfTip(t).violations.some((v) => re.test(v)), `${re} on: ${t.slice(0, 40)}`);
  bad('Short tip **Name**. Confidence: HIGH.', /under 40 words/);
  bad(GOOD.replace('**Alpha Golfer**', 'Alpha Golfer'), /no bolded player name/);
  bad(`one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ${GOOD}`, /after 15 words/);
  bad(GOOD.replace('six weeks', '6 weeks'), /numerals/);
  bad(GOOD.replace('recent edition', 'recent edition (last year)'), /bracketed/);
  bad(GOOD.replace('Approach play decides most weeks on tour', 'It is hard to look past this player'), /banned phrase/);
  bad(GOOD.replace('strong record', 'strong odds'), /forbidden token: "odds"/);
  bad(GOOD.replace('strong record', 'strong strokes gained record'), /forbidden token: "strokes gained"/);
  bad(GOOD.replace(' Confidence: HIGH.', ''), /confidence not declared/);
  const named = validateGolfTip(GOOD.replace('this field', 'the Omega European Masters field'), { forbiddenNames: ['Omega European Masters'] });
  assert.ok(named.violations.some((v) => /names a tournament/.test(v)));
});

test('SKIP tips must be NO SELECTION plus exactly one sentence', () => {
  assert.equal(validateGolfTip('NO SELECTION — No player reaches the scoring threshold for this market on the sourced evidence available, so no selection is made. Confidence: LOW.', { expectSkip: true }).ok, true);
  assert.equal(validateGolfTip('No pick here. Confidence: LOW.', { expectSkip: true }).ok, false);
  assert.equal(validateGolfTip('NO SELECTION — First sentence. Second sentence. Confidence: LOW.', { expectSkip: true }).ok, false);
});

test('every opener bolds the name inside fifteen words and starts with a distinct word', () => {
  const firsts = new Set();
  for (const o of GOLF_OPENERS) {
    const before = o.slice(0, o.indexOf('**')).split(/\s+/).filter(Boolean).length;
    assert.ok(before < 15, `opener bolds late: ${o}`);
    assert.ok(!/\d/.test(o));
    firsts.add(o.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''));
  }
  assert.equal(firsts.size, GOLF_OPENERS.length, 'no two openers share an opening word');
});

function cand(name, id, comps, over = {}) {
  return { athleteId: id, name, score: comps.reduce((a, c) => a + c.points, 0), band: CONFIDENCE.HIGH, components: comps.map((c) => ({ id: c.id, points: c.points, missing: false })), missing: [], fieldRank: over.fieldRank ?? 1, profile: { starts: 8 }, coreMissing: false, ...over };
}

function scoredFixture() {
  const strong = [{ id: 'form', points: 25 }, { id: 'course_hist', points: 20 }, { id: 'course_fit', points: 20 }, { id: 'sg_app', points: 25 }, { id: 'owgr', points: 10 }];
  const mid = [{ id: 'form', points: 14 }, { id: 'course_hist', points: 13 }, { id: 'course_fit', points: 12 }, { id: 'sg_app', points: 17 }, { id: 'owgr', points: 7 }, { id: 't6_rate', points: 15 }];
  const frl = [{ id: 'frl_r1', points: 35 }, { id: 'frl_tee', points: 25 }, { id: 'frl_putt', points: 20 }, { id: 'frl_fast', points: 20 }];
  const names = ['Ann Archer', 'Ben Baker', 'Cal Cooper', 'Dan Dyer', 'Eve Ellis', 'Finn Ford', 'Gus Grant', 'Hal Hunt', 'Ian Innes', 'Jay Jones', 'Kim Knox', 'Lee Lowe'];
  const c = (i, comps, over) => cand(names[i], `p${i}`, comps, { fieldRank: i + 1, ...over });
  return {
    flags: ['same player heads OUTRIGHT WINNER and TOP EUROPEAN — each market is written separately as the prompt requires'],
    missing: ['odds (no free key-less bookmaker odds source)'],
    markets: {
      outright: { key: 'outright', label: MARKETS.outright, selections: [c(0, strong), c(9, mid, { valuePick: true, band: CONFIDENCE.MEDIUM })], candidates: [], missing: [] },
      top6: { key: 'top6', label: MARKETS.top6, selections: [c(0, strong), c(1, mid), c(2, mid), c(3, mid), c(4, mid), c(5, mid, { band: CONFIDENCE.MEDIUM })], candidates: [], missing: [] },
      frl: { key: 'frl', label: MARKETS.frl, selections: [c(6, frl), c(7, frl, { band: CONFIDENCE.MEDIUM }), c(8, frl, { band: CONFIDENCE.MEDIUM })], candidates: [], missing: [] },
      top_european: { key: 'top_european', label: MARKETS.top_european, selections: [c(0, [...strong, { id: 'eu_top3', points: 10 }])], candidates: [], missing: [], eligible: 30 },
      top_american: { key: 'top_american', label: MARKETS.top_american, selections: [c(10, [...mid, { id: 'us_top3', points: 10 }], { band: CONFIDENCE.MEDIUM }), c(11, mid, { band: CONFIDENCE.MEDIUM, coSelection: true })], candidates: [], missing: [], eligible: 20, coSelected: true },
      top_british_irish: { key: 'top_british_irish', label: MARKETS.top_british_irish, selections: [], candidates: [], missing: ['TOP BRITISH & IRISH: no eligible player in the field'], eligible: 0 },
    },
  };
}

const EVENT = { id: 'e1', name: 'Grand Test Open', shortName: 'Test Open', startDate: '2026-09-03T04:00Z', course: { name: 'Lakeside Golf Club', city: 'Lakeside' }, tourName: 'DP World Tour' };

test('writeGolfCard follows the Step 4 block order and validates clean', () => {
  const written = writeGolfCard(scoredFixture(), EVENT, { available: true, days: [{ windMaxKmh: 40, precipProbPct: 10 }] });
  assert.deepEqual(written.blocks.map((b) => b.key), ['block1', 'block2', 'top_european', 'top_american', 'top_british_irish']);
  const b1 = written.blocks[0].tips;
  assert.equal(b1[0].marketKey, 'outright');
  assert.equal(b1[1].marketKey, 'outright');
  assert.equal(b1[1].valuePick, true);
  assert.equal(b1.filter((t) => t.marketKey === 'top6').length, 5, 'top pick plus five more top-six tips');
  assert.ok(!b1.some((t) => t.marketKey === 'top6' && t.athleteId === 'p0'), 'the outright headliner is not repeated as a top-six tip');
  assert.equal(written.blocks[1].tips.length, 3);
  assert.equal(written.blocks[3].tips.length, 2, 'co-selection produces two regional tips');
  assert.equal(written.blocks[3].tips[1].coSelection, true);
  assert.equal(written.blocks[4].tips[0].skip, true);
  assert.match(written.blocks[4].tips[0].text, /^NO SELECTION/);

  const v = validateGolfCard(written);
  assert.deepEqual(v.issues, []);
  assert.ok(v.ok);
  for (const t of written.tips) {
    if (t.skip) continue;
    assert.ok(t.text.split(/\s+/).length >= MIN_WORDS);
    assert.match(t.text, /Confidence: (HIGH|MEDIUM|LOW)\.$/);
    assert.ok(!/Grand Test Open|Lakeside|DP World/.test(t.text), 'no tournament, course or tour names');
    assert.ok(!/\d/.test(t.text.replace(/\*\*[^*]+\*\*/g, '')), 'no numerals');
  }
  assert.equal(written.valuePicks.length, 1);
  assert.equal(written.valuePicks[0].name, 'Jay Jones');
  assert.match(written.weatherNote, /strong wind/);
  assert.ok(written.summary.length >= 14);
  assert.ok(written.summary.some((r) => r.market === MARKETS.top_british_irish && r.selection === 'NO SELECTION'));
});

test('card text carries the table, value summary, weather note and RG line, and openers are unique', () => {
  const written = writeGolfCard(scoredFixture(), EVENT, null);
  const text = buildGolfCardText(written);
  assert.match(text, /\| Market \| Selection \| Confidence \|/);
  assert.match(text, /VALUE PICK/);
  assert.match(text, /Value picks: Jay Jones/);
  assert.match(text, /Weather note: no forecast was available/);
  assert.match(text, /Responsible gambling/);
  assert.match(text, /OUTRIGHT WINNER AND TOP SIX/);
  const firstWords = written.tips.filter((t) => !t.skip).map((t) => t.text.split(/\s+/)[0].toLowerCase());
  assert.equal(new Set(firstWords).size, firstWords.length, 'no two tips share an opening word');
});

test('weather note is words only and reacts to wind and rain', () => {
  assert.match(buildWeatherNote({ available: true, days: [{ windMaxKmh: 10, precipProbPct: 5 }] }), /no material weather disruption/);
  assert.match(buildWeatherNote({ available: true, days: [{ windMaxKmh: 36, precipProbPct: 60 }] }), /strong wind.*rain is likely/);
  assert.match(buildWeatherNote(null), /no forecast/);
  for (const w of [null, { available: true, days: [{ windMaxKmh: 36, precipProbPct: 60 }] }]) assert.ok(!/\d/.test(buildWeatherNote(w)));
});

test('fact clauses never expose figures and reflect the components that fired', () => {
  const c = cand('X', 'x', [{ id: 'form', points: 25 }, { id: 'sg_app', points: 25 }, { id: 'course_hist', points: 20 }, { id: 'owgr', points: 10 }]);
  const clauses = factClauses(c, 'outright');
  assert.ok(clauses.includes('a victory inside the last six weeks'));
  assert.ok(clauses.includes('elite approach play this season'));
  for (const cl of clauses) assert.ok(!/\d/.test(cl));
  const frl = factClauses(cand('Y', 'y', [{ id: 'frl_r1', points: 35 }, { id: 'frl_tee', points: 25 }]), 'frl');
  assert.equal(frl[0], 'some of the best opening-round scoring in this field');
});
