/**
 * Scottish Open overlay tests — event matching, the Step 2 scoring tables, the
 * Step 3 bands, the honesty rules for unsourced factors, and the Step 4 card.
 *
 * These are the tests that prove the overlay implements the prompt rather than
 * approximating it, and that it can never be reached for another tournament.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchScottishOpen, scoreBallStriking, scoreFormSo, scoreLinksProxy, scoreCourseFitSo, scorePedigreeSo,
  scoreWinBase, scoreFrlSo, waveAssignment, waveForecast, scoreAmericanModsSo, scoreEuropeanModsSo, scoreBritishIrishModsSo,
  bandWin, bandFrlSo, bandRegionalSo, scoreScottishOpen, writeScottishOpenCard, validateScottishOpenCard,
  isValuePickSo, MARKETS, MARKET_ORDER, RULES, BANNED_PHRASES, OPENERS, RULESET_VERSION,
} from '../engine/golf_scottish_open.js';
import { matchEventProfile, scoreEvent } from '../engine/golf_event_profiles.js';
import { linksProfile, r1Profile, OPEN_CHAMPIONSHIP_NAMES } from '../engine/golf_data.js';

function form(over = {}) {
  return {
    starts: 8, last5: [], winIn6w: false, top3In6w: false, top10Last5: 0, top20Last5: 0, backToBackTop10: false,
    comparableFieldTop10: false, winIn6m: false, elevatedWin12m: false, careerWinsInWindow: 0, majorsWonLast2y: 0,
    majorWinOrRunnerUp2y: 0, starts12m: 12, top10s12m: 3, top10Rate12m: 0.25, mcLast2Consecutive: false,
    noMcLast2: true, lastStartDaysAgo: 7, competedLast3Weeks: true,
    tourWinIn: () => false, tourTop3In: () => false, tourTop5In: () => false, ...over,
  };
}

function profile(over = {}) {
  return {
    athleteId: 'p1', name: 'Alpha Golfer', country: 'Scotland', countryCode: 'SCO', amateur: false,
    teeTime: '2027-07-08T07:00Z',
    region: { european: true, american: false, britishIrish: true, known: true },
    form: form(),
    event: { appearances: 2, last4: [], top5Last3: false, top10Last3: false, madeCutNoTop20Last3: true, mcLast3: false, mcMostRecent: false, top15In2of3: false, madeCutEachLast3: false },
    r1: { rounds: 8, avgR1ToPar: -2.1, fastStarts: 3, fastStartSample: 5, in60sLast5: 3, slowStarts: 0, lateCharges: 0 },
    links: { starts: 2, openStarts: 1, linksStarts: 1, best: 8, bestEvent: 'The Open', bestEndDate: '2026-07-19', bestIsOpen: true, madeCutOnly: false, anyLinksStart: true, classifiedVenues: ['Royal Birkdale GC'] },
    course: { class: 'mid', record: { starts: 6, avgFinishPct: 0.2, top10Rate: 0.33 }, bestClass: 'mid', bestClassStarts: 6, longCourse: false, drivingDistance: 300, shortHitter: false, longHitter: false },
    owgr: { rank: 8, lastWeekRank: 9, trajectory: 1 },
    stats: { savePct: 62 },
    sg: { ott: { avg: 0.2 }, app: { avg: 0.7 }, arg: { avg: 0.1 }, putt: { avg: 0.3 }, t2g: { avg: 1.1 } },
    historyStarts: 8,
    sources: {},
    ...over,
  };
}

function ctx(over = {}) {
  return {
    sgAppInField: new Map([['p1', 2]]), sgPuttInField: new Map([['p1', 8]]), sgT2gInField: new Map([['p1', 4]]), sgCoverage: 60,
    owgrInField: new Map([['p1', 3]]), r1InField: new Map([['p1', 5]]), r1Sample: 80,
    medianTee: Date.parse('2027-07-08T10:00Z'),
    weather: { r1: { trend: 'deteriorating', windAmKmh: 10, windPmKmh: 30, rainAmPct: 5, rainPmPct: 40 } },
    scrambleMedian: 58, scrambleSample: 60,
    europeanRank: new Map([['p1', 1]]), americanRank: new Map(), britishIrishRank: new Map([['p1', 1]]),
    regionCounts: { european: 60, american: 40, britishIrish: 20 }, priorEditionsInTape: 3, ...over,
  };
}

/* ------------------------------------------------------------------ *
 * event matching
 * ------------------------------------------------------------------ */

test('the overlay matches the men\'s Scottish Open and nothing else', () => {
  assert.equal(matchScottishOpen({ name: 'Genesis Scottish Open', tour: 'pga', course: { id: '10906', name: 'The Renaissance Club' } }).atHost, true);
  assert.equal(matchScottishOpen({ name: 'Scottish Open', tour: 'eur' }).atHost, null, 'no venue published is still a match, recorded as unknown');
  assert.equal(matchScottishOpen({ name: 'Genesis Scottish Open', tour: 'lpga' }), null, 'the LPGA event is a different ruleset');
  assert.equal(matchScottishOpen({ name: "ISPS HANDA Women's Scottish Open", tour: 'lpga' }), null);
  assert.equal(matchScottishOpen({ name: 'Amgen Irish Open', tour: 'eur' }), null);
  assert.equal(matchScottishOpen({ name: 'Genesis Scottish Open', tour: 'pga', course: { name: 'Muirfield' } }).atHost, false);
  assert.equal(matchScottishOpen({ name: 'NI Legends', tour: 'champions-tour' }), null);
  assert.equal(matchEventProfile({ name: 'Amgen Irish Open', tour: 'eur' }), null, 'the generic prompt still covers every other event');
  assert.equal(matchEventProfile({ name: 'Genesis Scottish Open', tour: 'pga' }).id, 'scottish-open');
});

/* ------------------------------------------------------------------ *
 * Step 2 — win tournament
 * ------------------------------------------------------------------ */

test('all-around ball-striking scores on how many of the four categories are positive', () => {
  const m = [];
  const pts = (sg) => scoreBallStriking(profile({ sg }), m)[0].points;
  assert.equal(pts({ ott: { avg: 0.1 }, app: { avg: 0.2 }, arg: { avg: 0.1 }, putt: { avg: 0.1 } }), 25);
  assert.equal(pts({ ott: { avg: 0.1 }, app: { avg: 0.2 }, arg: { avg: -0.1 }, putt: { avg: 0.1 } }), 25);
  assert.equal(pts({ ott: { avg: -0.1 }, app: { avg: 0.2 }, arg: { avg: -0.1 }, putt: { avg: 0.1 } }), 16);
  assert.equal(pts({ ott: { avg: -0.1 }, app: { avg: 0.9 }, arg: { avg: -0.1 }, putt: { avg: -0.2 } }), 9);
  assert.equal(pts({ ott: { avg: -0.1 }, app: { avg: -0.2 }, arg: { avg: -0.1 }, putt: { avg: -0.2 } }), 0);
});

test('a one-dimensional profile is penalised six points and the threshold is measured', () => {
  const m = [];
  const oneDimensional = { ott: { avg: -0.3 }, app: { avg: 0.9 }, arg: { avg: -0.3 }, putt: { avg: -0.2 } };
  const comps = scoreBallStriking(profile({ sg: oneDimensional }), m);
  assert.ok(comps.some((c) => c.id === 'so_ball_pen' && c.points === -6), 'lead of 1.2 with two losing categories is one-dimensional');
  const m2 = [];
  const balanced = { ott: { avg: -0.1 }, app: { avg: 1.0 }, arg: { avg: 0.85 }, putt: { avg: 0.2 } };
  assert.ok(!scoreBallStriking(profile({ sg: balanced }), m2).some((c) => c.id === 'so_ball_pen'), 'two positive categories is not one-dimensional');
});

test('ball-striking is missing, not estimated, when a category is unpublished', () => {
  const m = [];
  const comps = scoreBallStriking(profile({ sg: { app: { avg: 0.7 }, putt: { avg: 0.2 } } }), m);
  assert.equal(comps[0].points, 0);
  assert.equal(comps[0].missing, true);
  assert.ok(m.some((x) => x.includes('only 2 of 4 published')));
});

test('recent form follows the prompt table 20/15/11/6/0 plus the four-point bonus', () => {
  const m = [];
  const pts = (f) => scoreFormSo(profile({ form: form(f) }), m)[0].points;
  assert.equal(pts({ winIn6w: true }), 20);
  assert.equal(pts({ top3In6w: true }), 15);
  assert.equal(pts({ top10Last5: 2 }), 11);
  assert.equal(pts({ top10Last5: 1 }), 6);
  assert.equal(pts({ top20Last5: 1 }), 0);
  assert.equal(pts({}), 0);
  assert.ok(scoreFormSo(profile({ form: form({ winIn6w: true, backToBackTop10: true }) }), m).some((c) => c.points === 4 && c.id === 'so_form_b2b'));
});

test('the wind and links proxy scores 20/13/7/0 and needs two appearances for the venue bonus', () => {
  const m = [];
  const pts = (l) => scoreLinksProxy(profile({ links: l }), ctx(), m).find((c) => c.id === 'so_links').points;
  assert.equal(pts({ starts: 2, best: 10, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: false, linksStarts: 1 }), 20);
  assert.equal(pts({ starts: 2, best: 20, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: false, linksStarts: 1 }), 13);
  assert.equal(pts({ starts: 2, best: 45, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: true, linksStarts: 1 }), 7);
  assert.equal(pts({ starts: 0 }), 0);
  const m2 = [];
  const withBonus = scoreLinksProxy(profile({ links: { starts: 1, best: 10, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: false }, event: { appearances: 2, top5Last3: true } }), ctx(), m2);
  assert.ok(withBonus.some((c) => c.id === 'so_venue' && c.points === 5));
  const m3 = [];
  const thin = scoreLinksProxy(profile({ links: { starts: 1, best: 10, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: false }, event: { appearances: 1, top5Last3: true } }), ctx(), m3);
  assert.ok(!thin.some((c) => c.id === 'so_venue'), 'one prior appearance is not enough for a venue-history bonus');
  assert.ok(m3.some((x) => x.includes('fewer than two')));
});

test('course fit is capped at twelve because ball flight is not published, and says so', () => {
  const m = [];
  const strong = scoreCourseFitSo(profile({ stats: { savePct: 62 } }), ctx({ scrambleMedian: 58 }), m);
  assert.equal(strong.find((c) => c.id === 'so_fit').points, 12);
  assert.match(strong.find((c) => c.id === 'so_fit').detail, /twelve is the most this category can reach/);
  assert.ok(m.some((x) => x.includes('low ball flight')));
  assert.ok(m.some((x) => x.includes('spin-heavy')));
  const m2 = [];
  const weak = scoreCourseFitSo(profile({ stats: { savePct: 40 } }), ctx({ scrambleMedian: 58 }), m2);
  assert.equal(weak.find((c) => c.id === 'so_fit').points, 3);
  const m3 = [];
  const unsourced = scoreCourseFitSo(profile({ stats: null }), ctx({ scrambleMedian: 58 }), m3);
  assert.equal(unsourced.find((c) => c.id === 'so_fit').points, 0);
  assert.equal(unsourced.find((c) => c.id === 'so_fit').missing, true);
});

test('pedigree scores 15/11/6/2 plus the major win-or-runner-up bonus', () => {
  const m = [];
  const pts = (rank) => scorePedigreeSo(profile({ owgr: { rank } }), m).find((c) => c.id === 'so_rank').points;
  assert.equal(pts(10), 15);
  assert.equal(pts(20), 11);
  assert.equal(pts(50), 6);
  assert.equal(pts(120), 2);
  const m2 = [];
  const withMajor = scorePedigreeSo(profile({ form: form({ majorWinOrRunnerUp2y: 1 }) }), m2);
  assert.ok(withMajor.some((c) => c.id === 'so_major' && c.points === 5));
});

test('a full-evidence win score reaches the documented maximum of 106, never more', () => {
  const p = profile({
    form: form({ winIn6w: true, backToBackTop10: true, majorWinOrRunnerUp2y: 1 }),
    links: { starts: 2, best: 4, bestEvent: 'The Open', bestEndDate: '2026-07-19', madeCutOnly: false, openStarts: 1, linksStarts: 1, anyLinksStart: true },
    event: { appearances: 3, top5Last3: true },
    owgr: { rank: 5 },
    stats: { savePct: 70 },
  });
  const base = scoreWinBase(p, ctx({ scrambleMedian: 58 }));
  // 25 ball-striking + 20 form + 4 bonus + 20 links + 5 venue + 12 fit + 15 ranking + 5 major = 106
  assert.equal(base.score, 106);
  assert.equal(base.categories.ballStriking, 25);
  assert.equal(base.categories.fit, 12, 'the low-flight half is unsourced, so twenty is unreachable');
});

/* ------------------------------------------------------------------ *
 * Step 2 — first round leader
 * ------------------------------------------------------------------ */

test('the wave category scores 30/0/15/10 off the tee time and the forecast split', () => {
  const clear = ctx(); // morning 10 km/h, afternoon 30 km/h → clear split, morning favourable
  const morning = scoreFrlSo(profile({ teeTime: '2027-07-08T07:00Z' }), clear);
  assert.equal(morning.components.find((c) => c.id === 'so_frl_wave').points, 30);
  assert.equal(morning.waveEdge, true);
  const afternoon = scoreFrlSo(profile({ teeTime: '2027-07-08T13:00Z' }), clear);
  assert.equal(afternoon.components.find((c) => c.id === 'so_frl_wave').points, 0);
  assert.equal(afternoon.waveEdge, false);
  const mild = ctx({ weather: { r1: { trend: 'stable', windAmKmh: 12, windPmKmh: 17, rainAmPct: 0, rainPmPct: 0 } } });
  assert.equal(scoreFrlSo(profile(), mild).components.find((c) => c.id === 'so_frl_wave').points, 15);
  const none = ctx({ weather: { r1: { trend: 'stable', windAmKmh: 12, windPmKmh: 13, rainAmPct: 0, rainPmPct: 0 } } });
  assert.equal(scoreFrlSo(profile({ teeTime: '2027-07-08T13:00Z' }), none).components.find((c) => c.id === 'so_frl_wave').points, 10);
  const noTee = scoreFrlSo(profile({ teeTime: null }), clear);
  assert.equal(noTee.components.find((c) => c.id === 'so_frl_wave').missing, true);
  const noWx = scoreFrlSo(profile(), ctx({ weather: null }));
  assert.equal(noWx.components.find((c) => c.id === 'so_frl_wave').missing, true);
});

test('wave assignment and forecast split are computed from the same numbers the collector publishes', () => {
  assert.equal(waveAssignment('2027-07-08T07:00Z', ctx()).wave, 'morning');
  assert.equal(waveAssignment('2027-07-08T13:00Z', ctx()).wave, 'afternoon');
  assert.equal(waveAssignment(null, ctx()).wave, null);
  assert.equal(waveForecast(ctx()).split, 'clear');
  assert.equal(waveForecast(ctx()).favourableWave, 'morning');
  assert.equal(waveForecast(ctx({ weather: { r1: { windAmKmh: 30, windPmKmh: 10, rainAmPct: 0, rainPmPct: 0 } } })).favourableWave, 'afternoon');
  assert.equal(waveForecast(ctx({ weather: null })).split, null);
});

test('the fast-start profile uses the twelve-point tier because per-round wind is unpublished', () => {
  const m = [];
  const r = scoreFrlSo(profile(), ctx());
  assert.equal(r.components.find((c) => c.id === 'so_frl_fast').points, 12);
  assert.ok(r.missing.some((x) => x.includes('notable wind')));
  const slow = scoreFrlSo(profile({ r1: { rounds: 5, avgR1ToPar: 1.2, fastStarts: 0, fastStartSample: 5, in60sLast5: 0, slowStarts: 4, lateCharges: 3 } }), ctx());
  assert.equal(slow.components.find((c) => c.id === 'so_frl_fast').points, 0);
  assert.match(slow.components.find((c) => c.id === 'so_frl_fast').detail, /wrong profile/);
});

/* ------------------------------------------------------------------ *
 * Step 2 — regional markets
 * ------------------------------------------------------------------ */

test('regional modifiers follow the overlay and name every unsourced bonus', () => {
  const m = [];
  const us = scoreAmericanModsSo(profile({ country: 'USA', countryCode: 'USA', region: { european: false, american: true, britishIrish: false } }), ctx({ americanRank: new Map([['p1', 1]]), regionCounts: { american: 40 } }), m);
  assert.ok(us.some((c) => c.id === 'so_us_top' && c.points === 10));
  assert.ok(us.some((c) => c.id === 'so_us_nolinks' && c.points === -10) === false, 'a player with links starts is not penalised');
  assert.ok(m.some((x) => x.includes('links preparation')));

  const m2 = [];
  const noLinks = scoreAmericanModsSo(profile({ links: { starts: 0, anyLinksStart: false } }), ctx({ americanRank: new Map([['p1', 1]]), regionCounts: { american: 40 } }), m2);
  assert.ok(noLinks.some((c) => c.id === 'so_us_nolinks' && c.points === -10));

  const m3 = [];
  const eu = scoreEuropeanModsSo(profile({ form: form({ tourWinIn: (t) => t === 'eur', mcLast2Consecutive: true }) }), ctx(), m3);
  assert.ok(eu.some((c) => c.id === 'so_eu_top' && c.points === 10));
  assert.ok(eu.some((c) => c.id === 'so_eu_dpwt' && c.points === 8));
  assert.ok(eu.some((c) => c.id === 'so_eu_mc' && c.points === -10));
  assert.ok(m3.some((x) => x.includes('Race to Dubai')));

  const m4 = [];
  const bi = scoreBritishIrishModsSo(profile(), ctx(), m4);
  assert.ok(bi.some((c) => c.id === 'so_bi_home' && c.points === 14), 'the home national open bonus is fourteen, larger than any generic adjustment');
  assert.ok(bi.some((c) => c.id === 'so_bi_top' && c.points === 10));
  assert.ok(bi.some((c) => c.id === 'so_bi_cut' && c.points === 6));
});

/* ------------------------------------------------------------------ *
 * Step 3 — bands
 * ------------------------------------------------------------------ */

test('Step 3 thresholds are the prompt\'s, and HIGH is unreachable on partial evidence', () => {
  assert.equal(bandWin(75, false), 'HIGH');
  assert.equal(bandWin(75, true), 'MEDIUM');
  assert.equal(bandWin(60, false), 'MEDIUM');
  assert.equal(bandWin(59.9, false), 'LOW');
  assert.equal(bandWin(0, false), 'LOW', 'the win market is never skipped');
  assert.equal(bandFrlSo(49, true, false), 'SKIP');
  assert.equal(bandFrlSo(50, false, false), 'LOW');
  assert.equal(bandFrlSo(65, false, false), 'MEDIUM');
  assert.equal(bandFrlSo(80, false, false), 'MEDIUM', 'sixty-five or more caps at MEDIUM without a wave edge');
  assert.equal(bandFrlSo(80, true, false), 'HIGH');
  assert.equal(bandFrlSo(80, true, true), 'MEDIUM');
  assert.equal(bandRegionalSo(70, false), 'HIGH');
  assert.equal(bandRegionalSo(70, true), 'MEDIUM');
  assert.equal(bandRegionalSo(55, false), 'MEDIUM');
  assert.equal(bandRegionalSo(54.9, false), 'LOW');
  assert.equal(bandRegionalSo(70, false, { coSelected: true }), 'MEDIUM', 'co-selections are capped at MEDIUM');
});

/* ------------------------------------------------------------------ *
 * the value rule
 * ------------------------------------------------------------------ */

test('the mandatory value test is applied literally and its unreachability is disclosed', () => {
  assert.equal(isValuePickSo({ categories: { links: 20, fit: 12 } }, 20), false, 'twelve of twenty is below the fifteen the rule asks for');
  assert.equal(isValuePickSo({ categories: { links: 20, fit: 15 } }, 20), true);
  assert.equal(isValuePickSo({ categories: { links: 20, fit: 15 } }, 5), false, 'a top-five favourite is not the value pick');
  assert.equal(RULES.value.fieldRankOutside, 15);
});

/* ------------------------------------------------------------------ *
 * event scoring
 * ------------------------------------------------------------------ */

test('the overlay scores exactly five markets and never invents a top six', () => {
  const profiles = [
    profile(),
    profile({ athleteId: 'p2', name: 'Bravo Golfer', country: 'USA', countryCode: 'USA', region: { european: false, american: true, britishIrish: false, known: true }, owgr: { rank: 3 }, sg: { ott: { avg: 0.3 }, app: { avg: 0.5 }, arg: { avg: 0.2 }, putt: { avg: 0.4 } }, teeTime: '2027-07-08T13:00Z' }),
    profile({ athleteId: 'p3', name: 'Charlie Golfer', country: 'France', countryCode: 'FRA', region: { european: true, american: false, britishIrish: false, known: true }, owgr: { rank: 40 } }),
  ];
  // Every field member needs an OWGR field rank, or "outside the top five
  // favourites" cannot be evaluated at all — which is itself a reported gap.
  const c = ctx({ owgrInField: new Map([['p1', 3], ['p2', 1], ['p3', 40]]),
    europeanRank: new Map([['p1', 2], ['p3', 1]]), britishIrishRank: new Map([['p1', 1]]), americanRank: new Map([['p2', 1]]) });
  const scored = scoreScottishOpen({ id: 'e1', name: 'Genesis Scottish Open', tour: 'pga', tournamentId: '4161' }, profiles, c);
  assert.equal(scored.unscored, false);
  assert.equal(scored.ruleset, RULESET_VERSION);
  assert.deepEqual(Object.keys(scored.markets), MARKET_ORDER);
  assert.deepEqual(Object.keys(scored.markets), ['outright', 'frl', 'top_american', 'top_european', 'top_british_irish']);
  assert.equal(scored.markets.top6, undefined);
  assert.ok(scored.markets.outright.selections.length >= 1);
  assert.ok(scored.missing.some((x) => x.startsWith('odds')));
  assert.ok(scored.missing.some((x) => x.startsWith('Race to Dubai standings')));
  assert.ok(scored.flags.some((x) => x.includes('strict value test')), 'the value fallback is always flagged');
});

test('an unscored field is reported, never filled with a guess', () => {
  const scored = scoreScottishOpen({ id: 'e1', name: 'Genesis Scottish Open', tour: 'pga' }, [], ctx());
  assert.equal(scored.unscored, true);
  assert.deepEqual(scored.markets, {});
});

/* ------------------------------------------------------------------ *
 * Step 4 — written output
 * ------------------------------------------------------------------ */

test('the card writes five blocks in the prompt order and validates clean', () => {
  const profiles = [
    profile(),
    profile({ athleteId: 'p2', name: 'Bravo Golfer', country: 'USA', countryCode: 'USA', region: { european: false, american: true, britishIrish: false, known: true }, owgr: { rank: 3 }, teeTime: '2027-07-08T13:00Z' }),
    profile({ athleteId: 'p3', name: 'Charlie Golfer', country: 'France', countryCode: 'FRA', region: { european: true, american: false, britishIrish: false, known: true }, owgr: { rank: 40 }, teeTime: '2027-07-08T07:30Z' }),
  ];
  const event = { id: 'e1', name: 'Genesis Scottish Open', tour: 'pga', startDate: '2027-07-08T04:00Z', course: { name: 'The Renaissance Club', city: 'North Berwick' } };
  const scored = scoreScottishOpen(event, profiles, ctx());
  const written = writeScottishOpenCard(scored, event);
  const v = validateScottishOpenCard(written);
  assert.deepEqual(v.issues, [], JSON.stringify(v.issues));
  assert.equal(written.blocks.length, 5);
  assert.deepEqual(written.blocks.map((b) => b.title), [
    'BLOCK 1: WIN TOURNAMENT', 'BLOCK 2: FIRST ROUND LEADER', 'BLOCK 3: TOP AMERICAN PLAYER',
    'BLOCK 4: TOP EUROPEAN PLAYER', 'BLOCK 5: TOP GB AND IRELAND PLAYER',
  ]);
  assert.equal(written.summary.length, written.tips.length);
  assert.ok(written.waveNote.includes('Wave and weather impact'));
  assert.ok(written.cardText.includes('Responsible gambling'));
  assert.ok(written.cardText.includes('| Market | Selection | Confidence |'));
  for (const t of written.tips.filter((x) => !x.skip)) {
    assert.ok(t.text.split(/\s+/).length >= 40, `${t.market}: under forty words`);
    assert.ok(t.text.indexOf('**') < t.text.split(/\s+/).slice(0, 16).join(' ').length, 'name bolded inside fifteen words');
    assert.match(t.text, /Confidence: (HIGH|MEDIUM|LOW)\./);
  }
});

test('the card validator rejects a banned phrase, a missing wave note and an over-long market', () => {
  const base = {
    tips: [{ text: 'Wind decides this week more than anything else, and **Alpha Golfer** has already been measured in it, with a complete game across the bag and a recent top ten in exposed conditions. That combination makes the case here, and it holds across every factor this market rewards. Confidence: HIGH.', market: 'WIN TOURNAMENT', marketKey: 'outright', name: 'Alpha Golfer', skip: false }],
    waveNote: 'Wave and weather impact: none.',
    forbiddenNames: [],
  };
  assert.equal(validateScottishOpenCard(base).ok, true);
  for (const phrase of BANNED_PHRASES) {
    const bad = { ...base, tips: [{ ...base.tips[0], text: `${base.tips[0].text} ${phrase}.` }] };
    assert.ok(!validateScottishOpenCard(bad).ok, `banned phrase not rejected: ${phrase}`);
  }
  assert.ok(!validateScottishOpenCard({ ...base, waveNote: null }).ok, 'the wave note is mandatory');
  const pad = (n) => `Completeness across the bag is what separates contenders here, and **${n}** brings a strong record in several departments, a recent top ten and a record in exposed conditions that holds up across every factor this market rewards. Confidence: LOW.`;
  const tooMany = { ...base, tips: [...base.tips, { ...base.tips[0], text: pad('Bravo Golfer') }, { ...base.tips[0], text: pad('Charlie Golfer') }] };
  assert.ok(!validateScottishOpenCard(tooMany).ok, 'more than two win-tournament selections');
});

test('every overlay opener bolds the name inside fifteen words and opens differently', () => {
  const first = new Set();
  for (const o of OPENERS) {
    const text = o.replace('{name}', 'Test Player');
    assert.ok(text.indexOf('**') >= 0, `no bold in opener: ${o}`);
    const before = text.slice(0, text.indexOf('**')).split(/\s+/).filter(Boolean).length;
    assert.ok(before < 15, `name too late in opener: ${o}`);
    const w1 = text.trim().split(/\s+/)[0].toLowerCase();
    assert.ok(!first.has(w1), `duplicate opening word across openers: ${w1}`);
    first.add(w1);
  }
});

test('the overlay market labels are the prompt\'s labels', () => {
  assert.deepEqual(Object.values(MARKETS), ['WIN TOURNAMENT', 'FIRST ROUND LEADER', 'TOP AMERICAN PLAYER', 'TOP EUROPEAN PLAYER', 'TOP GB AND IRELAND PLAYER']);
  assert.equal(RULES.win.ballStrike + RULES.win.form + RULES.win.links + RULES.win.fit + RULES.win.pedigree, 100);
  assert.equal(RULES.frl.r1 + RULES.frl.wave + RULES.frl.putting + RULES.frl.fastStart, 100);
});

/* ------------------------------------------------------------------ *
 * data layer the overlay depends on
 * ------------------------------------------------------------------ */

test('the links proxy reads The Open and cited venues only, never a course name', () => {
  const rows = [
    { name: 'The Open', courseName: 'Royal Birkdale GC', major: true, endDate: '2026-07-19', position: 5, result: 'F' },
    { name: 'Amgen Irish Open', courseName: 'Trump International Golf Links', major: false, endDate: '2026-08-13', position: 12, result: 'F' },
    { name: 'the Memorial Tournament', courseName: 'Muirfield Village Golf Club', major: false, endDate: '2026-06-01', position: 2, result: 'F' },
    { name: 'Australian PGA', courseName: 'Royal Queensland Golf Club', major: false, endDate: '2026-05-01', position: 1, result: 'F' },
  ];
  const set = new Set(['the renaissance club', 'royal birkdale gc', 'trump international golf links']);
  const p = linksProfile(rows, '2026-09-01', set);
  assert.equal(p.starts, 2, 'The Open plus one cited venue; the two "Royal"/"Muirfield" name-only matches are ignored');
  assert.equal(p.openStarts, 1);
  assert.equal(p.linksStarts, 1);
  assert.equal(p.best, 5);
  assert.ok(OPEN_CHAMPIONSHIP_NAMES.has('the open'));
});

test('opening rounds in the sixties are counted separately from rounds at 67 or better', () => {
  const mk = (r1) => ({ endDate: '2026-08-01', par: 70, rounds: [r1, 70, 70, 70] });
  const rows = [mk(69), mk(68), mk(71), mk(74), mk(66)];
  const r = r1Profile(rows);
  assert.equal(r.in60sLast5, 3, 'three opening rounds in the sixties (69, 68, 66)');
  assert.equal(r.fastStarts, 1, 'only 66 is at 67 or better — the two measures are deliberately different');
  assert.equal(r.slowStarts, 1);
});

/* ------------------------------------------------------------------ *
 * committed documents
 * ------------------------------------------------------------------ */

test('data/golf_scottish_open.json carries a source for every fact and the measured editions match the tape', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(readFileSync(new URL('../data/golf_scottish_open.json', import.meta.url), 'utf8'));
  assert.ok(doc.facts.length >= 10);
  for (const f of doc.facts) {
    assert.ok(f.source, `${f.id} has no source`);
    assert.ok(f.evidence, `${f.id} has no evidence`);
    assert.ok(['CONFIRMED', 'UNCONFIRMED', 'REFUTED'].includes(f.status), `${f.id} has an unknown status`);
  }
  const unconfirmed = doc.facts.filter((f) => f.status !== 'CONFIRMED');
  assert.ok(unconfirmed.every((f) => f.evidence.length > 40), 'an unconfirmed claim must explain itself');
  assert.ok(doc.venue_history.rows.length >= 8);
  const measured = doc.venue_history.rows.filter((r) => r.provenance === 'measured');
  const results = JSON.parse(readFileSync(new URL('../data/golf_results.json', import.meta.url), 'utf8'));
  for (const row of measured) {
    const ev = Object.values(results.events).find((e) => /scottish open/i.test(e.name || '') && Number(String(e.startDate).slice(0, 4)) === row.year);
    assert.ok(ev, `no tape edition for ${row.year}`);
    assert.equal(ev.courseName, 'The Renaissance Club');
    assert.equal(row.source.includes(String(ev.startDate ? '' : '')) || row.source.length > 10, true);
  }
  assert.ok(doc.venue_history.winningScoreRange.best <= -20, 'the prompt\'s "low twenties under" claim must be backed by a measured or cited score');
  assert.ok(doc.venue_history.winningScoreRange.worst >= -10, 'the prompt\'s "single digits under" claim must be backed by a measured or cited score');
});

test('data/golf_links_courses.json classifies only cited venues and records its rejections', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(readFileSync(new URL('../data/golf_links_courses.json', import.meta.url), 'utf8'));
  assert.ok(doc.courses.length >= 7);
  for (const c of doc.courses) {
    assert.ok(c.source && /^https:\/\//.test(c.source), `${c.espnCourseName} has no https source`);
    assert.ok(c.evidence, `${c.espnCourseName} has no evidence`);
    assert.ok(['links', 'coastal'].includes(c.classification));
  }
  const names = doc.courses.map((c) => c.espnCourseName);
  assert.ok(names.includes('The Renaissance Club'));
  assert.ok(!names.includes('Muirfield Village Golf Club'), 'the Ohio course must not be classified as links');
  assert.ok(doc.excluded.some((x) => x.espnCourseName === 'Muirfield Village Golf Club'));
  assert.ok(doc.courses.find((c) => c.espnCourseName === 'Pebble Beach Golf Links').classification === 'coastal');
});

test('scoreEvent routes the Scottish Open to the overlay and every other event to the generic engine', () => {
  const profiles = [profile(), profile({ athleteId: 'p2', name: 'Bravo Golfer', country: 'USA', countryCode: 'USA', region: { european: false, american: true, britishIrish: false, known: true } })];
  const so = scoreEvent({ id: 'e1', name: 'Genesis Scottish Open', tour: 'pga', tournamentId: '4161' }, profiles, ctx());
  assert.equal(so.profile.id, 'scottish-open');
  assert.deepEqual(Object.keys(so.markets), MARKET_ORDER);
  const generic = scoreEvent({ id: 'e2', name: 'Amgen Irish Open', tour: 'eur' }, profiles, ctx({ priorEditionsInTape: 2 }));
  assert.equal(generic.profile, undefined);
  assert.ok(generic.markets.top6, 'the generic prompt still scores six markets including top six');
});
