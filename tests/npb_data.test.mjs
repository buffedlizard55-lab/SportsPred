/**
 * NPB data layer + committed seed documents.
 *  - factor derivation from the tape is walk-forward (strictly before the date)
 *  - gaps are recorded as missing, never filled
 *  - the committed data/npb_*.json documents have the shapes the page relies on
 *  - the seed predictions are honest: with no odds and one box score, every
 *    market on the seed card is SKIP
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  teamFactors, headToHead, starterProfile, bullpenState, enrichNpbFixture, buildNpbCard, runNpbBacktest,
  WINDOW_DAYS, H2H_CLOSE_MAX_TOTAL, H2H_CLOSE_MAX_MARGIN, H2H_CLOSE_MIN, SHORT_REST_DAYS, BULLPEN_EFFECTIVE_RA9, BULLPEN_FATIGUE_DAYS,
} from '../engine/npb_data.js';
import { CONFIDENCE } from '../engine/npb_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (n) => JSON.parse(readFileSync(join(ROOT, 'data', `npb_${n}.json`), 'utf8'));
const DOCS = { fixtures: doc('fixtures'), tape: doc('tape'), standings: doc('standings'), pitchers: doc('pitchers'), predictions: doc('predictions'), backtest: doc('backtest'), provenance: doc('provenance') };

test('hyperparameters are the documented values', () => {
  assert.deepEqual([WINDOW_DAYS, H2H_CLOSE_MAX_TOTAL, H2H_CLOSE_MAX_MARGIN, H2H_CLOSE_MIN, SHORT_REST_DAYS, BULLPEN_EFFECTIVE_RA9, BULLPEN_FATIGUE_DAYS], [30, 7, 1, 3, 5, 3.5, 3]);
});

test('teamFactors is walk-forward: only games strictly before the date count; draws are D', () => {
  const tape = DOCS.tape.games;
  const f = teamFactors(tape, 'F', '2026-09-03');
  assert.equal(f.recent[0].dateISO, '2026-09-02');
  assert.equal(f.recent[0].result, 'D', 'F 1-1 H on 9/2 is a draw');
  assert.equal(f.form.last5[0], 'D');
  const before = teamFactors(tape, 'F', '2026-09-02');
  assert.equal(before.recent[0].dateISO, '2026-09-01', 'the 9/2 game is invisible on 9/2 itself');
  assert.equal(teamFactors(tape, 'F', '2026-07-01'), null, 'no history → null, never a default');
  assert.ok(f.form.monthGames <= 31);
  assert.equal(typeof f.runDiffPerGame, 'number');
  for (const r of f.recent) assert.match(r.url, /^https:\/\/npb\.jp\//);
});

test('headToHead: same-league block for CL pairs, interleague block otherwise, current-season tape only', () => {
  const tape = DOCS.tape.games;
  const st = headToHead(tape, 'S', 'T', '2026-09-04');
  assert.ok(st.sameLeague && !st.interleague);
  assert.equal(st.sameLeague.meetings, st.sameLeague.winsA + st.sameLeague.winsB + st.sameLeague.draws);
  assert.match(st.sameLeague.window, /current season tape only/);
  assert.ok(st.sameLeague.games.every((g) => g.dateISO < '2026-09-04'));
  assert.equal(headToHead(tape, 'T', 'H', '2026-09-04'), null, 'no interleague games in the Jul–Sep window → null');
});

test('starterProfile and bullpenState only use the parsed box lines and never invent a log', () => {
  const p = DOCS.pitchers;
  const masui = starterProfile(p, 'S', '増居', '2026-09-08');
  assert.equal(masui.sourcedStarts, 1);
  assert.deepEqual([masui.last4[0].ip, masui.last4[0].er, masui.qualityStartsLast4], [3, 4, 0]);
  assert.equal(masui.daysSinceLastStart, 5);
  assert.equal(masui.shortRest, false);
  const unknown = starterProfile(p, 'S', '高梨', '2026-09-04');
  assert.deepEqual([unknown.last4, unknown.qualityStartsLast4, unknown.shortRest, unknown.source], [[], null, null, null]);
  assert.equal(starterProfile(p, 'S', '増居', '2026-09-03').sourcedStarts, 0, 'a start on the day itself is not visible before the game');
  const bp = bullpenState(p, 'D', '2026-09-04');
  assert.equal(bp, null, 'no box lines for Chunichi → bullpen null (missing), not "fresh"');
});

test('enrichNpbFixture: DH, import rule, roof, forecast, standings only when dated at or before the game', () => {
  const fx = DOCS.fixtures.fixtures.find((f) => f.dateISO === '2026-09-04' && f.home.code === 'S');
  const e = enrichNpbFixture(fx, DOCS);
  assert.equal(e.league, 'central');
  assert.equal(e.dh.dh, false);
  assert.equal(e.foreignPlayers.limit, 4);
  assert.deepEqual([e.roof, e.forecast, e.wind], ['open', 'cloudy with rain', null]);
  assert.equal(e.home.starter.name, '高梨');
  assert.equal(e.home.starter.confirmed, true);
  assert.equal(e.home.odds, null);
  assert.equal(e.home.recordSummary, '53-66-1', 'record from the captured standings');
  assert.equal(e.home.drawRate, 0.0083);
  assert.ok(e.leagueDrawRate > 0);
  const past = enrichNpbFixture({ ...fx, dateISO: '2026-08-10' }, DOCS, { asOf: '2026-08-10' });
  assert.equal(past.home.provenance.standings, null, 'standings captured 9/3 are not applied to an 8/10 game');
});

test('committed seed documents: shapes, counts, provenance', () => {
  for (const [k, d] of Object.entries(DOCS)) {
    assert.equal(d.schema_version, 1, k);
    assert.equal(d.mode, 'seed', k);
    assert.equal(d.league, 'npb', k);
  }
  assert.equal(DOCS.tape.count, DOCS.tape.games.length);
  assert.equal(DOCS.tape.draws, DOCS.tape.games.filter((g) => g.draw).length);
  assert.equal(DOCS.tape.draws, 4);
  assert.equal(DOCS.tape.postponed, 8);
  assert.ok(DOCS.tape.games.every((g) => /^https:\/\/npb\.jp\//.test(g.url)));
  assert.ok(DOCS.tape.games.every((g) => g.postponed || (Number.isInteger(g.homeScore) && Number.isInteger(g.awayScore))));
  assert.equal(DOCS.fixtures.count, DOCS.fixtures.fixtures.length);
  assert.ok(DOCS.fixtures.fixtures.every((f) => f.dateISO && f.home?.code && f.away?.code && f.status));
  assert.equal(DOCS.fixtures.fixtures.filter((f) => f.dateISO === '2026-09-04').length, 5);
  assert.equal(DOCS.fixtures.upcomingWithStarters, 5);
  assert.equal(DOCS.standings.central.teams.length + DOCS.standings.pacific.teams.length, 12);
  assert.equal(DOCS.standings.asOfISO, '2026-09-03');
  assert.equal(DOCS.pitchers.count, DOCS.pitchers.lines.length);
  assert.equal(DOCS.pitchers.boxes.length, 1);
  assert.equal(DOCS.pitchers.coverage.matchedInWindow, 0, 'the one box (9/3) post-dates the tape, so window coverage is honestly zero');
  const ids = DOCS.provenance.irregularities.map((i) => i.id);
  assert.ok(ids.includes('NPB-SEED'));
  assert.ok(ids.includes('NPB-BOX-COVERAGE'), 'thin box coverage is flagged');
  assert.equal(DOCS.provenance.irregularities.find((i) => i.id === 'NPB-BOX-COVERAGE').severity, 'high');
  assert.ok(DOCS.provenance.notSourced.some((s) => /three-way/.test(s)));
  assert.ok(DOCS.provenance.sources.length >= 4 && DOCS.provenance.sources.every((s) => /^https:\/\/npb\.jp\//.test(s.url)));
  assert.equal(DOCS.provenance.coverage.tapeGames, DOCS.tape.count);
});

test('seed predictions are all SKIP (no odds, no starter logs) and say so — nothing is filled in', () => {
  const preds = DOCS.predictions.predictions;
  assert.ok(preds.length >= 5);
  for (const p of preds) {
    assert.equal(p.win.confidence, CONFIDENCE.SKIP, `${p.id} win`);
    assert.equal(p.runLine.confidence, CONFIDENCE.SKIP, `${p.id} run line`);
    assert.equal(p.total.confidence, CONFIDENCE.SKIP, `${p.id} total`);
    assert.ok(p.missing.some((m) => /odds/.test(m)));
    assert.ok(p.missing.some((m) => /starter|bullpen/.test(m)));
    assert.equal(typeof p.win.drawScore, 'number', 'draw is scored on every match regardless');
  }
  // and the live builder reproduces the same verdicts from the same docs
  const card = buildNpbCard(DOCS, { dateISO: '2026-09-04' });
  assert.equal(card.scored.results.length, 5);
  assert.ok(card.written.tips.every((t) => t.skip));
  assert.match(card.written.formattedText, /Draw flag: no fixture on this card reached the draw likelihood threshold/);
});

test('backtest is walk-forward and leak-free: the committed report matches a rerun, no row scores from its own result', () => {
  const b = DOCS.backtest;
  assert.deepEqual(b.range, { from: '2026-07-01', to: '2026-09-02' });
  assert.equal(b.games, b.rows.length);
  assert.equal(b.drawsOnTape, 4);
  assert.equal(b.markets.total.ungradeable, b.markets.total.n, 'totals cannot be graded without a posted line');
  assert.equal(b.skipped.win + b.markets.win.n, b.games);
  assert.equal(b.skipped.runLine + b.markets.runLine.n, b.games);
  assert.match(b.method, /strictly before the game/);
  const rerun = runNpbBacktest(DOCS, { fromISO: '2026-08-25', toISO: '2026-09-02' });
  const committed = b.rows.filter((r) => r.dateISO >= '2026-08-25');
  assert.equal(rerun.rows.length, committed.length);
  for (let i = 0; i < rerun.rows.length; i += 1) {
    assert.equal(rerun.rows[i].id, committed[i].id);
    assert.equal(rerun.rows[i].winScore, committed[i].winScore);
    assert.equal(rerun.rows[i].drawScore, committed[i].drawScore);
    assert.deepEqual(rerun.rows[i].win ?? null, committed[i].win ?? null);
  }
  // leak check: flip the result of one game and the score for that game must not move
  const mutated = JSON.parse(JSON.stringify(DOCS));
  const g = mutated.tape.games.find((x) => x.dateISO === '2026-09-02' && x.home === 'S');
  [g.homeScore, g.awayScore] = [g.awayScore, g.homeScore]; g.winner = g.winner === 'S' ? 'T' : 'S';
  const after = runNpbBacktest(mutated, { fromISO: '2026-09-02', toISO: '2026-09-02' });
  const rowBefore = b.rows.find((r) => r.id === g.id); const rowAfter = after.rows.find((r) => r.id === g.id);
  assert.equal(rowAfter.winScore, rowBefore.winScore, 'the scoring inputs never include the game being predicted');
  assert.equal(rowAfter.drawScore, rowBefore.drawScore);
  assert.notEqual(rowAfter.actual, rowBefore.actual);
});

test('no scratch references leak into the repo', () => {
  assert.equal(existsSync(join(ROOT, 'assets', 'js', 'npb-page.js')), true);
  for (const f of ['engine/npb_data.js', 'engine/npb_engine.js', 'engine/npb_writer.js', 'engine/npb_source.js', 'assets/js/npb-page.js', 'scripts/collect_npb.mjs', 'scripts/npb_build_docs.mjs', 'scripts/build_npb_seed.mjs']) {
    assert.ok(!/\.scratch/.test(readFileSync(join(ROOT, f), 'utf8')), `${f} references .scratch`);
  }
});
