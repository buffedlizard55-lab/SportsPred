/**
 * Tests for the universal ESPN parser, engine and writer.
 *
 * The soccer fixture is a trimmed excerpt of a real ESPN response read on
 * 2026-09-02 (see its _provenance block). Expected values below were computed
 * by hand from that payload, so a parser regression fails the suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  americanToDecimal, decimalToImplied, devig, parseRecord, parseForm, formRate,
  parseOdds, parseScoreboard, buildLeagueContext, headToHead, formFromTape, restDays,
} from '../engine/espn_universal.js';
import {
  scoreUniversalMatch, scoreUniversalCard, modelProbabilities, confidenceScore,
  WEIGHTS, MIN_SIGNALS, RULESET_VERSION,
} from '../engine/universal_engine.js';
import {
  writeUniversalTip, writeUniversalCard, validateUniversalTip, countWords,
  BANNED_PHRASES, buildCopyText,
} from '../engine/universal_writer.js';
import { SPORTS, getSport, allOlbgIndexes, OLBG_TIPSTER_ONLY } from '../engine/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/espn_soccer_eng1.EXCERPT.json'), 'utf8'));

/* ------------------------------------------------------------------ *
 * odds maths
 * ------------------------------------------------------------------ */

test('americanToDecimal converts both signs and rejects junk', () => {
  assert.equal(americanToDecimal('+125'), 2.25);
  assert.equal(americanToDecimal(125), 2.25);
  assert.equal(americanToDecimal('-200'), 1.5);
  assert.equal(americanToDecimal(0), null);
  assert.equal(americanToDecimal(null), null);
  assert.equal(americanToDecimal(''), null);
  assert.equal(americanToDecimal('abc'), null);
});

test('decimalToImplied inverts the price and rejects impossible prices', () => {
  assert.equal(decimalToImplied(2), 0.5);
  assert.equal(decimalToImplied(1), null);
  assert.equal(decimalToImplied(null), null);
});

test('devig normalises a 3-way book to exactly 1 and refuses partial input', () => {
  const out = devig([0.45, 0.35, 0.28]);
  const sum = out.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.equal(devig([0.5, null]), null);
});

/* ------------------------------------------------------------------ *
 * record / form parsing
 * ------------------------------------------------------------------ */

test('parseRecord handles W-L-D and W-L, and refuses empty seasons', () => {
  assert.deepEqual(parseRecord('1-1-0'), { wins: 1, losses: 1, draws: 0, played: 2, winPct: 0.5 });
  assert.deepEqual(parseRecord('10-2'), { wins: 10, losses: 2, draws: 0, played: 12, winPct: 0.833333 });
  assert.equal(parseRecord('0-0-0'), null);
  assert.equal(parseRecord(''), null);
  assert.equal(parseRecord('   '), null);
  assert.equal(parseRecord('1-2-3-4'), null);
  assert.equal(parseRecord('x-y'), null);
  assert.equal(parseRecord(undefined), null);
});

test('parseForm keeps only W/D/L and returns null when absent', () => {
  assert.deepEqual(parseForm('WWDLW'), ['W', 'W', 'D', 'L', 'W']);
  assert.equal(parseForm(''), null);
  assert.equal(parseForm(null), null);
  assert.equal(formRate(['W', 'W', 'D', 'L', 'W']), 0.7);
  assert.equal(formRate([]), null);
});

/* ------------------------------------------------------------------ *
 * scoreboard parsing against the real excerpt
 * ------------------------------------------------------------------ */

test('parseScoreboard reads the real Premier League excerpt exactly', () => {
  const { league, matches, warnings } = parseScoreboard(fixture, {
    sportKey: 'football', leagueSlug: 'eng.1', leagueName: 'English Premier League',
  });
  assert.equal(warnings.length, 0);
  assert.equal(league.id, '700');
  assert.equal(league.name, 'English Premier League');
  assert.equal(league.seasonYear, 2026);
  assert.ok(league.calendar.includes('2026-09-05'));

  assert.equal(matches.length, 1);
  const m = matches[0];
  assert.equal(m.id, '401879286');
  assert.equal(m.dateISO, '2026-09-05');
  assert.equal(m.phase, 'upcoming');
  assert.equal(m.venue, "St. James' Park");
  assert.equal(m.neutral, false);
  assert.equal(m.home.name, 'Newcastle United');
  assert.equal(m.away.name, 'AFC Bournemouth');
  assert.deepEqual(m.home.form, ['W', 'W', 'D', 'L', 'W']);
  assert.deepEqual(m.away.form, ['D', 'L', 'D', 'D', 'W']);
  assert.equal(m.home.record.winPct, 0.5);
  assert.equal(m.away.record.winPct, 0.25);
  assert.equal(m.winner, null);
});

test('parseOdds reads the DraftKings block: moneyline, spread, total, de-vig', () => {
  const comp = fixture.events[0].competitions[0];
  const odds = parseOdds(comp);
  assert.equal(odds.provider, 'DraftKings');
  assert.equal(odds.moneyline.home.american, 125);
  assert.equal(odds.moneyline.home.decimal, 2.25);
  assert.equal(odds.moneyline.away.decimal, 2.9);
  assert.equal(odds.moneyline.draw.decimal, 3.7);
  // de-vigged three-way probabilities must sum to 1
  const sum = odds.moneyline.home.fairProb + odds.moneyline.away.fairProb + odds.moneyline.draw.fairProb;
  assert.ok(Math.abs(sum - 1) < 1e-5, `fair probs sum ${sum}`);
  // home is favourite at +125 so its fair prob must be the largest
  assert.ok(odds.moneyline.home.fairProb > odds.moneyline.away.fairProb);
  assert.equal(odds.spread.homeLine, -0.5);
  assert.equal(odds.total.line, 2.5);
});

test('parseOdds returns null when ESPN sends no odds block', () => {
  assert.equal(parseOdds({ odds: [] }), null);
  assert.equal(parseOdds({}), null);
});

/* ------------------------------------------------------------------ *
 * league context is measured, never assumed
 * ------------------------------------------------------------------ */

function fakeResult(home, away, hs, as, date) {
  return {
    id: `${home}-${away}-${date}`, phase: 'results', startUtc: `${date}T12:00Z`,
    home: { name: home, score: hs }, away: { name: away, score: as },
    winner: hs > as ? 'home' : hs < as ? 'away' : 'draw',
  };
}

test('buildLeagueContext refuses to publish a baseline on a thin sample', () => {
  const ctx = buildLeagueContext([fakeResult('A', 'B', 2, 1, '2026-08-01')], { threeWay: true });
  assert.equal(ctx.sufficient, false);
  assert.equal(ctx.homeWinRate, null);
});

test('buildLeagueContext measures home/draw rates and the scoring mean', () => {
  const tape = [];
  for (let i = 0; i < 12; i += 1) {
    // 6 home wins, 3 draws, 3 away wins; total goals 3 per game
    if (i < 6) tape.push(fakeResult(`H${i}`, `A${i}`, 2, 1, `2026-08-0${(i % 9) + 1}`));
    else if (i < 9) tape.push(fakeResult(`H${i}`, `A${i}`, 1, 1, `2026-08-0${(i % 9) + 1}`));
    else tape.push(fakeResult(`H${i}`, `A${i}`, 1, 2, `2026-08-0${(i % 9) + 1}`));
  }
  const ctx = buildLeagueContext(tape, { threeWay: true });
  assert.equal(ctx.sufficient, true);
  assert.equal(ctx.sample, 12);
  assert.equal(ctx.homeWinRate, 0.5);
  assert.equal(ctx.drawRate, 0.25);
  assert.equal(ctx.awayWinRate, 0.25);
  assert.equal(ctx.meanTotal, 2.75); // 6x(2-1)=18 + 3x(1-1)=6 + 3x(1-2)=9 -> 33/12
});

test('headToHead and formFromTape never see matches at or after the cut-off', () => {
  const tape = [
    fakeResult('A', 'B', 2, 0, '2026-01-01'),
    fakeResult('B', 'A', 0, 1, '2026-02-01'),
    fakeResult('A', 'B', 0, 3, '2026-08-01'), // after the cut-off
  ];
  const h = headToHead(tape, 'A', 'B', '2026-03-01T00:00Z');
  assert.equal(h.meetings, 2);
  assert.equal(h.homeWins, 2); // A won both pre-cutoff meetings
  const f = formFromTape(tape, 'A', '2026-03-01T00:00Z');
  assert.deepEqual(f, ['W', 'W']);
  assert.equal(restDays(tape, 'A', '2026-02-11T12:00Z'), 10);
  assert.equal(restDays(tape, 'A', null), null);
});

/* ------------------------------------------------------------------ *
 * engine
 * ------------------------------------------------------------------ */

function eng1Match() {
  return parseScoreboard(fixture, { sportKey: 'football', leagueSlug: 'eng.1', leagueName: 'English Premier League' }).matches[0];
}

const richCtx = {
  threeWay: true,
  leagueContext: { sufficient: true, sample: 40, homeWinRate: 0.45, drawRate: 0.25, awayWinRate: 0.3, meanTotal: 3.1 },
  h2h: { meetings: 6, homeWins: 4, awayWins: 1, draws: 1 },
  rest: { home: 7, away: 4 },
};

test('modelProbabilities records a source for every signal it uses', () => {
  const m = modelProbabilities(eng1Match(), richCtx);
  for (const s of m.signals) {
    assert.ok(s.id, 'signal has an id');
    assert.ok(s.source, `signal ${s.id} has a source`);
    assert.equal(typeof s.points, 'number');
  }
  assert.ok(m.pHome > 0 && m.pHome < 1);
  assert.ok(Math.abs(m.pHome + m.pAway + (m.pDraw || 0) - 1) < 1e-6);
});

test('every unavailable factor lands in missing[] with a reason, not a default', () => {
  const bare = {
    id: 'x', leagueName: 'Test', dateISO: '2026-09-05',
    home: { name: 'H' }, away: { name: 'A' }, odds: null,
  };
  const m = modelProbabilities(bare, { threeWay: false });
  const ids = m.missing.map((x) => x.id);
  assert.ok(ids.includes('FORM-01'));
  assert.ok(ids.includes('REC-01'));
  assert.ok(ids.includes('H2H-01'));
  for (const miss of m.missing) assert.ok(miss.reason && miss.reason.length > 10, `${miss.id} has a real reason`);
});

test('a match with no sourced signals is SKIPped, never guessed', () => {
  const bare = {
    id: 'x', leagueName: 'Test', dateISO: '2026-09-05',
    home: { name: 'H' }, away: { name: 'A' }, odds: null,
  };
  const r = scoreUniversalMatch(bare, { threeWay: false });
  assert.equal(r.markets.match_result.band, 'SKIP');
  assert.equal(r.scoreable, false);
  assert.equal(r.markets.match_result.reason, 'insufficient sourced signals');
});

test('the Premier League fixture scores a real, priced selection', () => {
  const r = scoreUniversalMatch(eng1Match(), richCtx);
  assert.equal(r.ruleset, RULESET_VERSION);
  assert.equal(r.scoreable, true);
  const mr = r.markets.match_result;
  assert.equal(mr.label, 'Full Time Result');
  assert.equal(mr.priced, true);
  assert.equal(mr.provider, 'DraftKings');
  assert.ok(['Newcastle United', 'AFC Bournemouth', 'Draw'].includes(mr.selection));
  assert.ok(mr.score > 0 && mr.score <= 100);
  assert.ok(r.sources.length >= 3, 'a scored match must carry review links');
  for (const s of r.sources) assert.match(s.url, /^https:\/\//);
});

test('confidence is capped when the baseline is unmeasured or the price is missing', () => {
  const capped = confidenceScore({ prob: 0.95, signalCount: 5, priced: true, edge: 0.2, baselineMeasured: false });
  assert.ok(capped.score <= 62, `unmeasured baseline capped at 62, got ${capped.score}`);
  const noPrice = confidenceScore({ prob: 0.95, signalCount: 5, priced: false, edge: null, baselineMeasured: true });
  assert.ok(noPrice.score <= 74, `unpriced capped at 74, got ${noPrice.score}`);
  const thin = confidenceScore({ prob: 0.95, signalCount: 1, priced: true, edge: 0.2, baselineMeasured: true });
  assert.equal(thin.score, 0);
  assert.equal(thin.band, 'SKIP');
});

test('MIN_SIGNALS and the weights are declared, frozen hyperparameters', () => {
  assert.equal(MIN_SIGNALS, 2);
  assert.ok(Object.isFrozen(WEIGHTS));
  assert.equal(typeof WEIGHTS.marketWeight, 'number');
  assert.ok(WEIGHTS.marketWeight > 0 && WEIGHTS.marketWeight < 1);
});

test('handicap and total markets SKIP with a reason when nothing is priced', () => {
  const m = eng1Match();
  m.odds = null;
  const r = scoreUniversalMatch(m, richCtx);
  assert.equal(r.markets.handicap.band, 'SKIP');
  assert.match(r.markets.handicap.reason, /no handicap line/);
  assert.equal(r.markets.total.band, 'SKIP');
  assert.match(r.markets.total.reason, /no total line/);
});

test('scoreUniversalCard separates scored results from unscored matches', () => {
  const good = eng1Match();
  const bad = { id: 'z', leagueName: 'T', home: { name: 'X' }, away: { name: 'Y' }, odds: null };
  const card = scoreUniversalCard([good, bad], (m) => (m.id === 'z' ? { threeWay: false } : richCtx));
  assert.equal(card.results.length, 1);
  assert.equal(card.unscored.length, 1);
  assert.equal(card.unscored[0].matchId, 'z');
});

/* ------------------------------------------------------------------ *
 * writer
 * ------------------------------------------------------------------ */

test('a written tip is valid, bolded, sourced and copyable', () => {
  const r = scoreUniversalMatch(eng1Match(), richCtx);
  const tip = writeUniversalTip(r);
  assert.equal(tip.ok, true, `violations: ${tip.violations.join('; ')}`);
  assert.deepEqual(tip.violations, []);
  assert.ok(tip.words >= 55 && tip.words <= 170, `word count ${tip.words}`);
  assert.match(tip.text, /^\*\*.+\*\* is the call/);
  assert.ok(tip.text.includes(r.headline.selection));
});

test('the writer refuses to write a tip for an unscoreable match', () => {
  const bare = { id: 'x', leagueName: 'T', home: { name: 'H' }, away: { name: 'A' }, odds: null };
  const r = scoreUniversalMatch(bare, { threeWay: false });
  const tip = writeUniversalTip(r);
  assert.equal(tip.ok, false);
  assert.equal(tip.text, null);
});

test('validateUniversalTip catches every output-rule breach', () => {
  const head = { selection: 'Newcastle United', band: 'HIGH' };
  assert.ok(validateUniversalTip('', head).includes('empty tip'));
  assert.ok(validateUniversalTip('Short **Newcastle United** tip.', head).some((v) => /under the 55-word minimum/.test(v)));
  const long = `**Newcastle United** ${'word '.repeat(200)}`;
  assert.ok(validateUniversalTip(long, head).some((v) => /over the 170-word maximum/.test(v)));
  const noBold = `Newcastle United is the call. ${'word '.repeat(60)}`;
  assert.ok(validateUniversalTip(noBold, head).includes('no bolded selection'));
  const wrongBold = `**Arsenal** is the call. ${'word '.repeat(60)}`;
  assert.ok(validateUniversalTip(wrongBold, head).includes('bolded text does not match the scored selection'));
  const skip = `**Newcastle United** is the call. ${'word '.repeat(60)}`;
  assert.ok(validateUniversalTip(skip, { selection: 'Newcastle United', band: 'SKIP' })
    .includes('SKIP market must not be written as a selection'));
});

test('every banned phrase is actually rejected', () => {
  const head = { selection: 'Newcastle United', band: 'HIGH' };
  for (const phrase of BANNED_PHRASES) {
    const text = `**Newcastle United** is the call, a ${phrase} here. ${'word '.repeat(60)}`;
    const v = validateUniversalTip(text, head);
    assert.ok(v.some((x) => x.includes(phrase)), `"${phrase}" must be rejected`);
  }
});

test('the writer can only cite signals the engine actually produced', () => {
  const r = scoreUniversalMatch(eng1Match(), { threeWay: true, leagueContext: { sufficient: false } });
  const tip = writeUniversalTip(r);
  if (tip.ok) {
    // no league baseline was measured, so the tip must not claim a measured one
    assert.ok(!/measured, and/.test(tip.text));
  }
});

test('buildCopyText produces a plain-text card with sources and no markdown bold', () => {
  const card = scoreUniversalCard([eng1Match()], richCtx);
  const written = writeUniversalCard(card);
  const text = buildCopyText(written, { title: 'Football predictions', dateISO: '2026-09-05' });
  assert.match(text, /Football predictions — 2026-09-05/);
  assert.ok(!text.includes('**'));
  assert.match(text, /source: /);
  assert.match(text, /Not betting advice/);
});

test('countWords ignores whitespace runs', () => {
  assert.equal(countWords('  a   b \n c '), 3);
  assert.equal(countWords(''), 0);
});

/* ------------------------------------------------------------------ *
 * registry honesty
 * ------------------------------------------------------------------ */

test('every registry sport carries an OLBG id and at least one official link', () => {
  assert.ok(SPORTS.length >= 20);
  const ids = new Set();
  for (const s of SPORTS) {
    assert.ok(Number.isInteger(s.olbgId), `${s.key} has an integer OLBG id`);
    assert.ok(s.officialLinks.length >= 1, `${s.key} has official links`);
    for (const l of s.officialLinks) assert.match(l.url, /^https:\/\//);
    ids.add(`${s.olbgSlug}/${s.olbgId}`);
  }
  assert.equal(ids.size, SPORTS.length, 'no duplicate OLBG sport index');
});

test('a sport with no statistics feed is never marked predictable', () => {
  for (const s of SPORTS) {
    if (!s.espnSport && !s.specialistEngine) {
      assert.equal(s.predictable, false, `${s.key} has no feed so it must not be predictable`);
      assert.ok(s.notes?.length, `${s.key} must explain why`);
    }
  }
});

test('OLBG ids match the sitemap transcription', () => {
  const expected = {
    football: 1, 'horse-racing': 2, tennis: 3, basketball: 4, golf: 5, cricket: 7,
    snooker: 8, 'rugby-union': 9, 'rugby-league': 10, 'american-football': 11,
    baseball: 12, 'ice-hockey': 13, 'motor-racing': 14, darts: 15, mma: 16,
    cycling: 17, handball: 20, volleyball: 21, 'gaelic-football': 25, greyhounds: 28,
  };
  for (const [key, id] of Object.entries(expected)) {
    assert.equal(getSport(key)?.olbgId, id, `${key} OLBG id`);
  }
  assert.equal(OLBG_TIPSTER_ONLY.length, 2);
});

test('allOlbgIndexes yields one reviewable OLBG URL per sport', () => {
  const rows = allOlbgIndexes();
  assert.equal(rows.length, SPORTS.length);
  for (const r of rows) assert.match(r.url, /^https:\/\/www\.olbg\.com\/betting-tips\/[A-Za-z_]+\/\d+$/);
});
