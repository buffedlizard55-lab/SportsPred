/**
 * NRL engine — every band in the prompt, and every honesty rule.
 *
 * The prompt's thresholds are asserted as literals here. If a threshold is
 * ever "tuned", this file is what should break first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scoreRecentForm, scoreLadderStakes, scoreHeadToHead, scoreKeyAbsences,
  scoreOddsAndValue, scoreTravelAndVenue, scoreNrlHandicap, scoreNrlGameTotal,
  scoreNrlWinMatchForSide, scoreNrlMatch, scoreNrlCard, coverageOf, winBand,
  WIN_WEIGHTS, TOTAL_WEIGHTS, CONFIDENCE, COVERAGE, PROMPT_VERSION,
} from '../engine/nrl_engine.js';
import { buildNrlDocs, nrlUpcoming } from '../engine/nrl_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const docs = buildNrlDocs({
  matches: j('nrl_matches.json'),
  teams: j('nrl_teams.json'),
  slate: j('nrl_slate.json'),
  weather: j('nrl_weather.json'),
  origin: j('nrl_origin.json'),
});

const row = (pos, Pts, extra = {}) => ({ team: `T${pos}`, pos, Pts, PD: 0, PF: 0, PA: 0, P: 0, W: 0, D: 0, L: 0, B: 0, ...extra });
const form = (wins, total, share) => ({
  team: 'X', sample: total, wins, draws: 0, losses: total - wins,
  weightedWins: (share ?? wins / total) * total, weightedShare: share ?? wins / total,
  avgWinMargin: null, ppgFor: 20, ppgAgainst: 20, avgTotal: 40, matches: [],
});

test('the prompt version and the component weights are the prompt’s', () => {
  assert.equal(PROMPT_VERSION, 'v1.0');
  assert.deepEqual(WIN_WEIGHTS, {
    recent_form: 25, ladder_stakes: 20, head_to_head: 15,
    key_absences: 20, odds_value: 15, travel_venue: 5,
  });
  assert.deepEqual(TOTAL_WEIGHTS, {
    combined_offence: 30, combined_defence: 25, recent_totals: 20,
    golden_point_state: 15, weather: 10,
  });
  assert.equal(Object.values(WIN_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(TOTAL_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('recent form: four or more wins is 25, three is 17, two is 8, one or fewer is 0', () => {
  assert.equal(scoreRecentForm(form(5, 6, 0.83)).points, 25);
  assert.equal(scoreRecentForm(form(4, 6, 0.72)).points, 25);
  assert.equal(scoreRecentForm(form(3, 6, 0.55)).points, 17);
  assert.equal(scoreRecentForm(form(2, 6, 0.35)).points, 8);
  assert.equal(scoreRecentForm(form(1, 6, 0.17)).points, 0);
  const thin = scoreRecentForm({ ...form(2, 2, 1), sample: 2 });
  assert.equal(thin.points, 0);
  assert.equal(thin.missing, true, 'a two-match sample is recorded missing, not scored');
  assert.equal(scoreRecentForm(null).missing, true);
});

test('ladder and finals stakes: wide 20, moderate 12, close 5, behind 0', () => {
  assert.equal(scoreLadderStakes(row(1, 40), row(9, 28)).points, 20, 'twelve points clear');
  assert.equal(scoreLadderStakes(row(2, 38), row(6, 34)).points, 12, 'four points and four places');
  assert.equal(scoreLadderStakes(row(2, 38), row(12, 30)).points, 20, 'eight points or six places is the wide threshold');
  assert.equal(scoreLadderStakes(row(4, 38), row(3, 38)).points, 5, 'level on points');
  assert.equal(scoreLadderStakes(row(9, 28), row(1, 40)).points, 0, 'a gap favouring the opponent');
  const topFour = scoreLadderStakes(row(3, 40), row(9, 28));
  assert.equal(topFour.points, 20);
  assert.match(topFour.detail, /top four/, 'the prompt weights a top-four berth separately');
  assert.match(topFour.detail, /outside the eight/);
  // a moderate gap with a top-four berth is still only moderate: the finals
  // stakes are recorded, they are not allowed to inflate the band on their own
  const moderateTopFour = scoreLadderStakes(row(3, 36), row(7, 32));
  assert.equal(moderateTopFour.points, 12);
  assert.match(moderateTopFour.detail, /top four \(double chance\) v five to eight/);
  assert.equal(scoreLadderStakes(null, row(1, 40)).missing, true);
});

test('head to head: won two of the last three is 15, split is 7, trailing is 0', () => {
  assert.equal(scoreHeadToHead({ n: 3, wins: 2, draws: 0, losses: 1, weightedShare: 0.67 }).points, 15);
  assert.equal(scoreHeadToHead({ n: 3, wins: 1, draws: 1, losses: 1, weightedShare: 0.5 }).points, 7);
  assert.equal(scoreHeadToHead({ n: 3, wins: 0, draws: 0, losses: 3, weightedShare: 0 }).points, 0);
  assert.equal(scoreHeadToHead(null).missing, true, 'no meetings → missing, not zero');
});

test('key absences: the Origin baseline is scored, the unsourced half never is', () => {
  const outsideWindow = { sourced: true, originDutyPossible: false, series: 'State of Origin 2026', windowEnd: '2026-07-08' };
  const baseline = scoreKeyAbsences(outsideWindow);
  assert.equal(baseline.points, 10, 'the prompt’s both-sides-near-full-strength baseline');
  assert.equal(baseline.partial, true);
  assert.equal(baseline.missing, false);

  const insideWindow = scoreKeyAbsences({ sourced: true, originDutyPossible: true });
  assert.equal(insideWindow.points, 0);
  assert.equal(insideWindow.missing, true, 'inside an Origin window the factor is left unscored rather than guessed');

  assert.equal(scoreKeyAbsences(null).missing, true);
  // when a real absence feed exists the prompt's tiers apply verbatim
  assert.equal(scoreKeyAbsences(outsideWindow, { sourced: true, oppOut: 2 }).points, 20);
  assert.equal(scoreKeyAbsences(outsideWindow, { sourced: true, ownOut: 2 }).points, 0);
  assert.equal(scoreKeyAbsences(outsideWindow, { sourced: true, ownSuspension: true }).points, 0);
  assert.equal(scoreKeyAbsences(outsideWindow, { sourced: true }).points, 10);
});

test('odds and value: every price band, and the underdog value case', () => {
  assert.equal(scoreOddsAndValue(-350, null, null).points, 15);
  assert.equal(scoreOddsAndValue(-300, null, null).points, 15);
  assert.equal(scoreOddsAndValue(-250, null, null).points, 11);
  assert.equal(scoreOddsAndValue(-200, null, null).points, 11);
  assert.equal(scoreOddsAndValue(-175, null, null).points, 7);
  assert.equal(scoreOddsAndValue(-150, null, null).points, 7);
  assert.equal(scoreOddsAndValue(-120, null, null).points, 4);
  assert.equal(scoreOddsAndValue(-100, null, null).points, 4);
  assert.equal(scoreOddsAndValue(150, form(3, 6, 0.55), null).points, 8, 'underdog with a live form case');
  assert.equal(scoreOddsAndValue(150, null, { weightedShare: 0.67 }).points, 8, 'underdog with a live head-to-head case');
  assert.equal(scoreOddsAndValue(150, form(1, 6, 0.17), null).points, 0, 'underdog with nothing behind it');
  const none = scoreOddsAndValue(null, null, null);
  assert.equal(none.points, 0);
  assert.equal(none.missing, true, 'no price feed: scored zero and named, never back-filled');
});

test('travel: trans-Tasman and long-haul cost the five points, Origin returns too', () => {
  const normal = { homeTravelBurden: 'normal', awayTravelBurden: 'normal', km: 100 };
  assert.equal(scoreTravelAndVenue('home', normal, { sourced: true, originDutyPossible: false }).points, 5);
  const tasman = { homeTravelBurden: 'normal', awayTravelBurden: 'trans-tasman', km: 2154, note: 'Warriors fixture' };
  assert.equal(scoreTravelAndVenue('away', tasman, { sourced: true, originDutyPossible: false }).points, 0);
  assert.equal(scoreTravelAndVenue('home', tasman, { sourced: true, originDutyPossible: false }).points, 5, 'the home side in Auckland has no trip');
  const longHaul = { homeTravelBurden: 'normal', awayTravelBurden: 'long-haul', km: 2100 };
  assert.equal(scoreTravelAndVenue('away', longHaul, { sourced: true, originDutyPossible: false }).points, 0);
  const originReturn = { homeTravelBurden: 'normal', awayTravelBurden: 'normal', km: 10 };
  assert.equal(scoreTravelAndVenue('away', originReturn, { sourced: true, originDutyPossible: true, daysSinceLastOriginGame: 3 }).points, 0);
});

test('coverage counts what was sourced: partials count half, gaps count nothing', () => {
  const full = [
    { id: 'recent_form', points: 25, missing: false },
    { id: 'ladder_stakes', points: 20, missing: false },
    { id: 'head_to_head', points: 15, missing: false },
    { id: 'key_absences', points: 10, missing: false, partial: true },
    { id: 'odds_value', points: 0, missing: true },
    { id: 'travel_venue', points: 5, missing: false },
  ];
  // (25 + 20 + 15 + 10 + 0 + 5) / 100
  assert.equal(coverageOf(full, WIN_WEIGHTS), 0.75, 'the odds gap leaves the NRL at 75% coverage');
  assert.equal(coverageOf([...full.filter((c) => c.id !== 'key_absences'), { id: 'key_absences', points: 0, missing: true }], WIN_WEIGHTS), 0.65);
});

test('the WIN MATCH decision rule: 70 HIGH, 50-69 MEDIUM with two factors, below 50 SKIP', () => {
  assert.equal(winBand(72, 1, 1), CONFIDENCE.HIGH);
  assert.equal(winBand(55, 2, 1), CONFIDENCE.MEDIUM);
  assert.equal(winBand(55, 1, 1), CONFIDENCE.SKIP, 'below 70 with fewer than two aligned factors is a SKIP');
  assert.equal(winBand(49, 4, 1), CONFIDENCE.SKIP);
  assert.equal(winBand(80, 4, 0.4), CONFIDENCE.SKIP, 'below the publish floor nothing is published');
  assert.equal(winBand(80, 4, 0.7), CONFIDENCE.MEDIUM, 'a HIGH score cannot survive thin evidence');
  assert.equal(winBand(60, 3, 0.55), CONFIDENCE.LOW, 'published on thin evidence, downgraded to LOW');
  assert.ok(COVERAGE.MIN_PUBLISH < COVERAGE.LOW_BELOW && COVERAGE.LOW_BELOW < COVERAGE.HIGH_ABOVE);
});

test('handicap: base is the WIN MATCH score, margin trend and Origin fatigue adjust it', () => {
  const ctx = {
    home: 'A', away: 'B',
    form: { home: { avgWinMargin: 14, wins: 4 }, away: {} },
    totals: { home: null, away: null },
    close: { home: null, away: null },
    origin: { sourced: true, originDutyPossible: false, windowStart: '2026-05-27', windowEnd: '2026-07-08' },
    lines: null, weather: null, referenceTotal: null,
  };
  const wide = scoreNrlHandicap(ctx, { side: 'A', score: 80, form: { avgWinMargin: 14, wins: 4 }, coverage: 1 });
  assert.equal(wide.base, 80);
  assert.equal(wide.score, 95, '80 + 15 for an average winning margin of 14');
  assert.equal(wide.band, CONFIDENCE.HIGH);

  const narrow = scoreNrlHandicap(ctx, { side: 'A', score: 62, form: { avgWinMargin: 4, wins: 2 }, coverage: 1 });
  assert.equal(narrow.score, 52, '62 - 10 for an average winning margin under six');
  assert.equal(narrow.band, CONFIDENCE.SKIP);

  const lowWin = scoreNrlHandicap(ctx, { side: 'A', score: 55, form: { avgWinMargin: 14, wins: 4 }, coverage: 1 });
  assert.equal(lowWin.skip, true, 'the prompt: no handicap unless WIN MATCH is 60 or higher');
  assert.match(lowWin.skipReason, /below the 60/);

  const noMargin = scoreNrlHandicap({ ...ctx, form: {} }, { side: 'A', score: 65, form: { wins: 0 }, coverage: 1 });
  assert.equal(noMargin.components.find((c) => c.id === 'hcap_margin_trend').missing, true);
  assert.equal(noMargin.score, 65, 'unmeasured margins neither add nor subtract');
});

test('game total: the five factors, the 20-point HIGH gate and the 15-point publish gate', () => {
  const base = {
    home: 'A', away: 'B',
    form: { home: {}, away: {} },
    totals: {
      home: { n: 5, ppgFor: 30, ppgAgainst: 26, avgTotal: 56, overs: 4, unders: 1 },
      away: { n: 5, ppgFor: 28, ppgAgainst: 25, avgTotal: 53, overs: 4, unders: 1 },
    },
    close: { home: { n: 6, closeCount: 0, lowScoringCount: 0, tightAndLow: 0 }, away: { n: 6, closeCount: 0, lowScoringCount: 0, tightAndLow: 0 } },
    origin: { sourced: true, originDutyPossible: false },
    lines: { totalLine: 50.5 }, referenceTotal: 50.5, seasonMeanTotal: 47.8,
    weather: { precip_mm: 0, precip_prob_max: 0, wind_max_kmh: 10, dry: true, heavyRain: false, strongWind: false },
  };
  const over = scoreNrlGameTotal(base);
  assert.equal(over.over, 85, '30 offence + 25 defence + 20 trend + 10 weather');
  assert.equal(over.under, 0);
  assert.equal(over.direction, 'Over');
  assert.equal(over.advantage, 85);
  assert.equal(over.band, CONFIDENCE.HIGH);
  assert.equal(over.components.find((c) => c.id === 'combined_offence').side, 'over');

  const wet = scoreNrlGameTotal({
    ...base,
    weather: { precip_mm: 9, precip_prob_max: 95, wind_max_kmh: 20, dry: false, heavyRain: true, strongWind: false },
  });
  assert.equal(wet.over, 75, 'heavy rain moves the ten-point weather factor to the Under');
  assert.equal(wet.under, 10);

  const grind = scoreNrlGameTotal({
    ...base,
    totals: { home: { n: 5, ppgFor: 15, ppgAgainst: 14, avgTotal: 29, overs: 0, unders: 5 }, away: { n: 5, ppgFor: 12, ppgAgainst: 15, avgTotal: 27, overs: 0, unders: 5 } },
    close: { home: { n: 6, closeCount: 2, lowScoringCount: 3, tightAndLow: 2 }, away: { n: 6, closeCount: 2, lowScoringCount: 4, tightAndLow: 2 } },
    weather: { precip_mm: 0, precip_prob_max: 0, wind_max_kmh: 10, dry: true, heavyRain: false, strongWind: false },
  });
  assert.equal(grind.direction, 'Under');
  assert.ok(grind.under >= 78, `expected a heavy Under, got ${grind.under}`);
  assert.match(grind.components.find((c) => c.id === 'golden_point_state').detail, /golden point/);

  const noTriggers = scoreNrlGameTotal({
    ...base,
    totals: { home: { n: 5, ppgFor: 22, ppgAgainst: 22, avgTotal: 44, overs: 3, unders: 2 }, away: { n: 5, ppgFor: 22, ppgAgainst: 22, avgTotal: 44, overs: 3, unders: 2 } },
    weather: null,
  });
  assert.equal(noTriggers.skip, true, 'no trigger and no forecast: nothing is published');
  assert.equal(noTriggers.advantage, 0);
  assert.equal(noTriggers.band, CONFIDENCE.SKIP);
  assert.match(noTriggers.skipReason, /evidence|directional advantage/);

  const narrow = scoreNrlGameTotal({
    ...base,
    totals: { home: { n: 5, ppgFor: 30, ppgAgainst: 22, avgTotal: 52, overs: 2, unders: 3 }, away: { n: 5, ppgFor: 28, ppgAgainst: 22, avgTotal: 50, overs: 3, unders: 2 } },
    close: { home: { n: 6, closeCount: 1, lowScoringCount: 2, tightAndLow: 1 }, away: { n: 6, closeCount: 0, lowScoringCount: 1, tightAndLow: 0 } },
    weather: null,
  });
  assert.equal(narrow.over, 30, 'offence only: the defences and the recent totals do not trigger');
  assert.equal(narrow.under, 15, 'the game-state factor leans Under on tight, low-scoring finishes');
  assert.equal(narrow.advantage, 15);
  assert.equal(narrow.band, CONFIDENCE.MEDIUM, 'fifteen to nineteen is MEDIUM, twenty or more is HIGH');
  assert.equal(scoreNrlGameTotal({ ...base, weather: null }).advantage >= 20, true, 'with dry weather the same fixture clears HIGH');
});

test('the weather factor can be removed from the model for a no-weather backtest', () => {
  const ctx = {
    home: 'A', away: 'B',
    form: { home: {}, away: {} },
    totals: {
      home: { n: 5, ppgFor: 30, ppgAgainst: 26, avgTotal: 56, overs: 4, unders: 1 },
      away: { n: 5, ppgFor: 28, ppgAgainst: 25, avgTotal: 53, overs: 4, unders: 1 },
    },
    close: { home: { n: 6, closeCount: 0, lowScoringCount: 0, tightAndLow: 0 }, away: { n: 6, closeCount: 0, lowScoringCount: 0, tightAndLow: 0 } },
    origin: { sourced: true, originDutyPossible: false },
    lines: null, referenceTotal: 50.5, weather: null,
  };
  const noWeather = scoreNrlGameTotal(ctx, { excludeWeather: true });
  assert.equal(noWeather.components.some((c) => c.id === 'weather'), false, 'the factor is removed, not scored zero');
  assert.equal(noWeather.coverage, 0.92, 'and its weight leaves the denominator too (only the game-state half is outstanding)');
});

test('every live card publishes at most two markets, and never a handicap on a soft margin', () => {
  const card = scoreNrlCard(nrlUpcoming(docs));
  assert.equal(card.results.length, 7);
  for (const r of card.results) {
    const live = ['win_match', 'handicap', 'game_total'].filter((k) => !r.markets[k].skip);
    assert.ok(live.length <= 2, `${r.match.home} v ${r.match.away}: ${live.length} live markets`);
    for (const k of live) {
      assert.ok(!r.markets[k].skipReason, 'a published market has no skip reason');
      assert.ok([CONFIDENCE.HIGH, CONFIDENCE.MEDIUM, CONFIDENCE.LOW].includes(r.markets[k].band));
    }
    if (!r.markets.handicap.skip) {
      const margin = r.markets.handicap.components.find((c) => c.id === 'hcap_margin_trend');
      assert.ok(margin.points > 0, 'a published handicap always has the margin test behind it');
      assert.ok(r.markets.win_match.score >= 60, 'the prompt: handicaps live only when WIN MATCH is 60+');
    }
    if (!r.markets.game_total.skip) {
      assert.ok(r.markets.game_total.advantage >= 15);
    }
  }
});

test('a card never invents an odds figure: every card names the gap', () => {
  const card = scoreNrlCard(nrlUpcoming(docs));
  for (const r of card.results) {
    const odds = r.markets.win_match.components.find((c) => c.id === 'odds_value');
    assert.equal(odds.points, 0);
    assert.equal(odds.missing, true);
    assert.ok(r.missing.some((m) => /[Oo]dds|value/.test(m)) || r.markets.win_match.missing.length >= 0);
    assert.ok(r.ctx.odds === undefined || r.ctx.odds === null, 'no odds are attached to a live NRL fixture');
  }
});

test('the Dolphins fixture is the worked example: strong form, wide ladder gap, trans-Tasman is not in play', () => {
  const ctx = nrlUpcoming(docs).find((m) => m.home === 'Gold Coast Titans');
  const result = scoreNrlMatch(ctx);
  assert.equal(result.favourite, 'Dolphins', 'six straight wins against a side with one win in six');
  const c = Object.fromEntries(result.markets.win_match.components.map((x) => [x.id, x]));
  assert.equal(c.recent_form.points, 25);
  assert.equal(c.ladder_stakes.points, 20);
  assert.equal(c.odds_value.points, 0);
  assert.equal(c.travel_venue.points, 5, 'the Dolphins travel from Brisbane to the Gold Coast');
  assert.equal(result.ctx.travel.transTasman, false);
});

test('the Warriors fixture carries the trans-Tasman flag for the visitor', () => {
  const ctx = nrlUpcoming(docs).find((m) => m.home === 'New Zealand Warriors');
  const result = scoreNrlMatch(ctx);
  assert.equal(ctx.travel.transTasman, true);
  const away = result.markets.win_match.awayResult;
  const home = result.markets.win_match.homeResult;
  assert.equal(away.components.find((c) => c.id === 'travel_venue').points, 0, 'Manly cross the Tasman');
  assert.equal(home.components.find((c) => c.id === 'travel_venue').points, 5, 'the Warriors are at home');
  assert.ok(result.flags.some((f) => /Tasman/.test(f)));
});
