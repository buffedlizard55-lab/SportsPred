/**
 * NPB engine — NPB BASEBALL PREDICTION MASTER PROMPT v1.0, Steps 2–3.
 * Synthetic, fully-sourced inputs so every band and gate is exercised
 * deterministically; the evidence floors are tested by removing inputs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreNpbMatch, scoreNpbCard, rateStarter, scoreRecentForm, scoreDrawLikelihood, scoreRunLineSide, scoreTotalMarket,
  decideWinMatch, decideRunLine, decideTotal, seasonWindow,
  CONFIDENCE, MIN_SOURCED_POINTS_TOTAL, MIN_SOURCED_POINTS_WIN, MIN_STARTS_FOR_RATING, RAINY_SEASON, TYPHOON_SEASON,
} from '../engine/npb_engine.js';

const sp = (qs4, qs3, { ip = 6.5, runs = 2, n = 4, confirmed = true } = {}) => ({
  name: 'X', confirmed, qualityStartsLast4: qs4, qualityStartsLast3: qs3,
  last4: Array.from({ length: n }, () => ({ ip, runs })), shortRest: false, avgInningsPerStart: ip,
});
const side = (over = {}) => ({
  name: 'Team', displayName: 'Team', code: 'X', league: 'central',
  form: { last5: ['W', 'W', 'W', 'W', 'L'] }, starter: sp(3, 2), runDiffPerGame: 1.0, drawRate: 0.03,
  bullpen: { effective: true, fatigued: false }, runsPerGameRecent: 3.2, avgWinMarginLast5Wins: 2.6,
  odds: { american: -150 }, vsStarterHandednessAvg: 0.25, recentTotals: { overs: 1, unders: 4 },
  ...over,
});
const match = (over = {}) => ({
  id: 'm1', dateISO: '2026-09-04', league: 'central', roof: 'open', forecast: 'sunny', leagueDrawRate: 0.02,
  home: side({ name: 'Hanshin Tigers', displayName: 'Hanshin Tigers', code: 'T' }),
  away: side({ name: 'Yomiuri Giants', displayName: 'Yomiuri Giants', code: 'G', form: { last5: ['L', 'L', 'W', 'L', 'L'] }, starter: sp(0, 0, { runs: 5, ip: 4.5 }), runDiffPerGame: -1.2, odds: { american: 130 }, avgWinMarginLast5Wins: 1.2, runsPerGameRecent: 3.0 }),
  h2h: { sameLeague: { meetings: 10, winsA: 7, winsB: 3, draws: 0, recentClose: { qualifies: false, detail: '1 of last 5 close' } } },
  ...over,
});

test('season windows: rainy 6/1–7/20, typhoon 8/1–10/15, otherwise null', () => {
  assert.deepEqual([RAINY_SEASON.from, RAINY_SEASON.to, TYPHOON_SEASON.from, TYPHOON_SEASON.to], ['06-01', '07-20', '08-01', '10-15']);
  assert.equal(seasonWindow('2026-06-15'), 'rainy');
  assert.equal(seasonWindow('2026-09-04'), 'typhoon');
  assert.equal(seasonWindow('2026-04-10'), null);
});

test('starter rating is form-based (quality starts), never ERA; needs 2+ sourced starts', () => {
  assert.equal(rateStarter(sp(3, 2)).rating, 'strong');
  assert.equal(rateStarter(sp(1, 1)).rating, 'solid');
  assert.equal(rateStarter(sp(0, 0, { runs: 3, ip: 5.5 })).rating, 'inconsistent');
  assert.equal(rateStarter(sp(0, 0, { runs: 6 })).rating, 'poor');
  assert.equal(rateStarter(sp(0, 0, { confirmed: false })).rating, 'unconfirmed');
  assert.equal(rateStarter({ name: 'Y', confirmed: true }).rating, null, 'announced but no sourced starts → missing, not guessed');
  assert.equal(MIN_STARTS_FOR_RATING, 2);
  assert.equal(rateStarter({ name: 'Y', confirmed: true, last4: [{ ip: 7, runs: 0 }] }).rating, null, 'one start is not a form read');
});

test('recent form bands: 4+ = 25, 3 = 16, 2 = 7, ≤1 = 0; draws break streaks; opponent-collapse +4', () => {
  const m = [];
  const f = (last5, opp = ['W', 'W', 'W', 'W', 'W']) => scoreRecentForm({ form: { last5 } }, { form: { last5: opp } }, m);
  const pts = (r) => r.components.reduce((a, c) => a + c.points, 0);
  assert.equal(pts(f(['W', 'W', 'W', 'L', 'W'])), 25);
  assert.equal(pts(f(['W', 'W', 'W', 'L', 'L'])), 16);
  assert.equal(pts(f(['W', 'W', 'L', 'L', 'L'])), 7);
  assert.equal(pts(f(['W', 'L', 'L', 'L', 'L'])), 0);
  assert.equal(pts(f(['W', 'W', 'W', 'W', 'L'])), 30, 'streak of 4+ adds 5');
  assert.equal(pts(f(['W', 'W', 'D', 'W', 'W'])), 25, 'a draw breaks the streak but is not a loss');
  assert.equal(pts(f(['W', 'W', 'W', 'L', 'W'], ['L', 'L', 'L', 'L', 'W'])), 29, 'opponent lost 4 of 5 → +4');
});

test('fully sourced favourite: HIGH win pick, run line active, missing[] empty', () => {
  const r = scoreNpbMatch(match());
  assert.equal(r.selection, 'home');
  assert.ok(r.winMatch.home.score >= 70, `home score ${r.winMatch.home.score}`);
  assert.equal(r.winMatch.home.sourcedPoints, 100);
  assert.equal(r.winMatch.decision.confidence, CONFIDENCE.HIGH);
  assert.equal(r.winMatch.decision.outcome, 'side');
  assert.ok(r.draw.score < 55, `draw ${r.draw.score}`);
  assert.equal(r.runLine.decision.side, 'favourite');
  assert.notEqual(r.runLine.decision.confidence, CONFIDENCE.SKIP);
  assert.deepEqual(r.missing, []);
});

test('draw likelihood: all five blocks fire → 100; draw override when sides within 10; run line blocked at 55+', () => {
  const m = match({
    away: side({ name: 'Yomiuri Giants', displayName: 'Yomiuri Giants', code: 'G', runDiffPerGame: 0.8 }),
    h2h: { sameLeague: { meetings: 10, winsA: 5, winsB: 4, draws: 1, recentClose: { qualifies: true, detail: '3 of last 5 decided by 1 run or drawn' } } },
  });
  const r = scoreNpbMatch(m);
  assert.equal(r.draw.score, 100);
  assert.deepEqual(r.draw.components.map((c) => [c.id, c.points]), [['draw_starters', 30], ['draw_bullpens', 25], ['draw_gap', 20], ['draw_rate', 15], ['draw_h2h', 10]]);
  assert.ok(r.winMatch.gap <= 10, `gap ${r.winMatch.gap}`);
  assert.equal(r.winMatch.decision.outcome, 'draw');
  assert.equal(r.winMatch.decision.confidence, CONFIDENCE.HIGH);
  assert.equal(r.draw.flag, 'primary');
  assert.equal(r.runLine.decision.confidence, CONFIDENCE.SKIP);
  assert.match(r.runLine.decision.reason, /draw likelihood 100 is 55 or higher/);
});

test('draw is independent: unsourced starters/bullpens mark the blocks missing rather than scoring zero silently', () => {
  const missing = [];
  const d = scoreDrawLikelihood({ league: 'central', leagueDrawRate: 0.02, home: { runDiffPerGame: 0.1 }, away: { runDiffPerGame: 0.3 } }, null, null, missing);
  assert.equal(d.score, 20, 'only the run-differential gap could be sourced');
  assert.ok(d.components.find((c) => c.id === 'draw_starters').missing);
  assert.ok(d.components.find((c) => c.id === 'draw_bullpens').missing);
  assert.ok(missing.some((x) => /bullpen/.test(x)));
  assert.ok(missing.some((x) => /drawRate/.test(x)));
  const inter = scoreDrawLikelihood({ league: 'interleague', home: {}, away: {} }, 'strong', 'strong', []);
  assert.match(inter.components.find((c) => c.id === 'draw_h2h').detail, /interleague/);
});

test('draw secondary flag: 55–64 or sides too far apart → run line withheld but draw is not the pick', () => {
  const fav = { score: 80, sourcedPoints: 100, strongFactors: 3 };
  const dog = { score: 40, sourcedPoints: 100 };
  const d = decideWinMatch(fav, dog, { score: 70 });
  assert.equal(d.outcome, 'side', 'gap of 40 blocks the override even at draw 70');
  const rl = decideRunLine({ score: 80, supportsCovering: true }, 80, 60, {}, {});
  assert.equal(rl.confidence, CONFIDENCE.SKIP);
});

test('Step 3 win gates: 70 HIGH, 55–69 needs 2 strong factors, <55 SKIP; −300 gate', () => {
  const ok = { sourcedPoints: 100 };
  assert.equal(decideWinMatch({ ...ok, score: 70 }, { score: 30 }, { score: 0 }).confidence, CONFIDENCE.HIGH);
  assert.equal(decideWinMatch({ ...ok, score: 60, strongFactors: 2 }, { score: 30 }, { score: 0 }).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideWinMatch({ ...ok, score: 60, strongFactors: 1 }, { score: 30 }, { score: 0 }).confidence, CONFIDENCE.SKIP);
  assert.equal(decideWinMatch({ ...ok, score: 54, strongFactors: 3 }, { score: 30 }, { score: 0 }).confidence, CONFIDENCE.SKIP);
  const heavy = decideWinMatch({ ...ok, score: 85, american: -320, starterMax: false, runDiffPerGame: 3 }, { score: 20 }, { score: 0 });
  assert.equal(heavy.confidence, CONFIDENCE.SKIP);
  assert.match(heavy.reason, /−300/);
  assert.equal(decideWinMatch({ ...ok, score: 85, american: -320, starterMax: true, runDiffPerGame: 2.6 }, { score: 20 }, { score: 0 }).confidence, CONFIDENCE.HIGH);
});

test('evidence floor (C-4): a win score built on fewer than 60 sourced points is SKIP even when it clears 70', () => {
  assert.equal(MIN_SOURCED_POINTS_WIN, 60);
  const d = decideWinMatch({ score: 72, sourcedPoints: 45, strongFactors: 3 }, { score: 10, sourcedPoints: 45 }, { score: 0 });
  assert.equal(d.confidence, CONFIDENCE.SKIP);
  assert.match(d.reason, /only 45 of 100 win-match points were sourced/);
  // A real match with no starter log, no odds and no bullpen: form + rundiff + h2h = 55 sourced → below 60.
  const thin = match({
    home: side({ name: 'Hanshin Tigers', displayName: 'Hanshin Tigers', code: 'T', starter: { name: 'A', confirmed: true }, odds: null, bullpen: null, vsStarterHandednessAvg: null }),
    away: side({ name: 'Yomiuri Giants', displayName: 'Yomiuri Giants', code: 'G', form: { last5: ['L', 'L', 'L', 'L', 'L'] }, starter: { name: 'B', confirmed: true }, odds: null, bullpen: null, runDiffPerGame: -2, vsStarterHandednessAvg: null }),
  });
  const r = scoreNpbMatch(thin);
  assert.ok(r.winMatch.home.sourcedPoints < 60, `sourced ${r.winMatch.home.sourcedPoints}`);
  assert.equal(r.winMatch.decision.confidence, CONFIDENCE.SKIP);
  assert.ok(r.missing.some((x) => /starter/.test(x)) && r.missing.some((x) => /odds/.test(x)));
});

test('run line: never −1.5 when average win margin < 2; +1.5 underdog route needs starter 17+ and supporting bullpen', () => {
  const missing = [];
  const rl = scoreRunLineSide(side({ avgWinMarginLast5Wins: 1.5 }), side(), { nonH2H: [], starterRating: 'strong' }, missing);
  assert.equal(rl.supportsCovering, false);
  const d = decideRunLine(rl, 80, 20, { starterScore: 9, bullpenSupports: true }, {});
  assert.equal(d.confidence, CONFIDENCE.SKIP);
  assert.match(d.reason, /below 2 runs/);
  const dog = decideRunLine(rl, 80, 20, { starterScore: 17, bullpenSupports: true }, {});
  assert.deepEqual([dog.side, dog.confidence], ['underdog', CONFIDENCE.MEDIUM]);
  assert.equal(decideRunLine({ score: 80, supportsCovering: true }, 59, 20, {}, {}).confidence, CONFIDENCE.SKIP, 'win score under 60 never activates the run line');
  const strong = scoreRunLineSide(side({ avgWinMarginLast5Wins: 3.2, runDiffPerGame: 2.4 }), side({ bullpen: { effective: false, fatigued: true } }), { nonH2H: [], starterRating: 'strong' }, []);
  assert.deepEqual(strong.components.filter((c) => c.points > 0).map((c) => [c.id, c.points]), [['margin', 20], ['rl_starter', 10], ['rl_bullpen', 8], ['rl_opp_bullpen', 8], ['rl_rundiff', 8]]);
});

test('game total: rain at an open-air park in the typhoon window → Under 5; enclosed venue → weather does not apply; floor 60', () => {
  assert.equal(MIN_SOURCED_POINTS_TOTAL, 60);
  const m = match({ forecast: 'rain' });
  const t = scoreTotalMarket(m, 'strong', 'strong', []);
  const w = [...t.under].find((c) => c.id === 'weather');
  assert.equal(w.points, 5);
  assert.match(w.detail, /typhoon/);
  assert.equal(t.sourcedPoints, 100);
  assert.equal(decideTotal(t).side, 'UNDER');
  const dome = scoreTotalMarket(match({ roof: 'dome', forecast: 'rain' }), 'strong', 'strong', []);
  assert.equal(dome.neutral.find((c) => c.id === 'weather').points, 0);
  assert.match(dome.neutral.find((c) => c.id === 'weather').detail, /enclosed/);
  const thin = scoreTotalMarket({ ...match(), home: { runsPerGameRecent: 3.0 }, away: { runsPerGameRecent: 2.8 } }, null, null, []);
  assert.ok(thin.sourcedPoints < 60);
  const d = decideTotal(thin);
  assert.equal(d.confidence, CONFIDENCE.SKIP);
  assert.match(d.reason, /points were sourced/);
  assert.equal(decideTotal({ overScore: 40, underScore: 20, sourcedPoints: 100 }).confidence, CONFIDENCE.HIGH);
  assert.equal(decideTotal({ overScore: 35, underScore: 20, sourcedPoints: 100 }).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideTotal({ overScore: 30, underScore: 20, sourcedPoints: 100 }).confidence, CONFIDENCE.SKIP);
});

test('scoreNpbCard: unscored on missing names, never throws on an empty side', () => {
  const c = scoreNpbCard([{ id: 'x', home: {}, away: {} }, match()]);
  assert.equal(c.results[0].unscored, true);
  assert.equal(c.results[1].unscored, undefined);
  assert.equal(c.prompt, 'NPB BASEBALL PREDICTION MASTER PROMPT v1.0');
});
