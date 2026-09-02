/**
 * Golf engine tests — Step 2 scoring tables, Step 3 bands and guard rules,
 * missing-factor honesty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreOutrightBase, scoreTop6Mods, scoreFrl, scoreEuropeanMods, scoreAmericanMods, scoreBritishIrishMods,
  bandOutright, bandTop6, bandFrl, bandRegional, scoreGolfEvent, hasEvidence, RULES, CONFIDENCE, MARKETS,
} from '../engine/golf_engine.js';

function form(over = {}) {
  return {
    starts: 8, last5: [], winIn6w: false, top3In6w: false, top10Last5: 0, top20Last5: 0, backToBackTop10: false,
    comparableFieldTop10: false, winIn6m: false, elevatedWin12m: false, careerWinsInWindow: 0, majorsWonLast2y: 0,
    starts12m: 12, top10s12m: 3, top10Rate12m: 0.25, mcLast2Consecutive: false, noMcLast2: true, lastStartDaysAgo: 7,
    competedLast3Weeks: true, tourWinIn: () => false, tourTop3In: () => false, ...over,
  };
}

function profile(over = {}) {
  return {
    athleteId: 'p1', name: 'Alpha Golfer', country: 'England', countryCode: 'ENG', amateur: false, teeTime: '2026-09-03T07:00Z',
    region: { european: true, american: false, britishIrish: true, known: true },
    form: form(),
    event: { appearances: 2, last4: [], top5Last3: false, top10Last3: false, madeCutNoTop20Last3: true, mcLast3: false, mcMostRecent: false, top15In2of3: false, madeCutEachLast3: false },
    r1: { rounds: 8, avgR1ToPar: -2.1, fastStarts: 3, fastStartSample: 5 },
    course: { class: 'mid', record: { starts: 6, avgFinishPct: 0.2, top10Rate: 0.33 }, bestClass: 'mid', bestClassStarts: 6, longCourse: false, drivingDistance: 300, shortHitter: false, longHitter: false },
    owgr: { rank: 8, lastWeekRank: 9, trajectory: 1 },
    stats: null,
    sg: { app: { rank: 3, avg: 0.7 }, putt: { rank: 12, avg: 0.2 }, t2g: { rank: 5, avg: 1.1 } },
    historyStarts: 8,
    sources: {},
    ...over,
  };
}

function ctx(over = {}) {
  return {
    sgAppInField: new Map([['p1', 2]]), sgPuttInField: new Map([['p1', 8]]), sgT2gInField: new Map([['p1', 4]]), sgCoverage: 60,
    owgrInField: new Map([['p1', 3]]), r1InField: new Map([['p1', 5]]), r1Sample: 80,
    medianTee: Date.parse('2026-09-03T10:00Z'), weather: { r1: { trend: 'deteriorating' } },
    europeanRank: new Map([['p1', 1]]), americanRank: new Map(), britishIrishRank: new Map([['p1', 1]]),
    regionCounts: { european: 40, american: 20, britishIrish: 10 }, priorEditionsInTape: 2, layoutEarlyScoring: true, ...over,
  };
}

test('outright form tiers follow the prompt table (25/19/14/8/0) with bonuses', () => {
  const c = ctx();
  const pts = (f) => scoreOutrightBase(profile({ form: form(f) }), c).categories.form;
  assert.equal(pts({ winIn6w: true }), 25);
  assert.equal(pts({ top3In6w: true }), 19);
  assert.equal(pts({ top10Last5: 2 }), 14);
  assert.equal(pts({ top10Last5: 1 }), 8);
  assert.equal(pts({ top20Last5: 0 }), 0);
  const b = scoreOutrightBase(profile({ form: form({ winIn6w: true, backToBackTop10: true, comparableFieldTop10: true }) }), c);
  assert.ok(b.components.some((x) => x.id === 'form_b2b' && x.points === 5));
  assert.ok(b.components.some((x) => x.id === 'form_field' && x.points === 5));
});

test('strokes gained approach scores by field rank (25/17/10/0) and is missing without a source', () => {
  const at = (rank) => scoreOutrightBase(profile(), ctx({ sgAppInField: new Map([['p1', rank]]) })).categories.sg;
  assert.equal(at(5), 25);
  assert.equal(at(15), 17);
  assert.equal(at(30), 10);
  assert.equal(at(31), 0);
  const none = scoreOutrightBase(profile({ sg: null }), ctx());
  assert.equal(none.categories.sg, 0);
  assert.ok(none.coreMissing);
  assert.ok(none.missing.some((m) => m.includes('strokes gained approach')));
});

test('course history 20/13/6/0 and course-fit strong/moderate/weak with the weakness penalty', () => {
  const c = ctx();
  const hist = (e) => scoreOutrightBase(profile({ event: { ...profile().event, ...e } }), c).categories.courseHistory;
  assert.equal(hist({ top5Last3: true }), 20);
  assert.equal(hist({ top10Last3: true }), 13);
  assert.equal(hist({ madeCutNoTop20Last3: true }), 6);
  assert.equal(hist({ madeCutNoTop20Last3: false, mcLast3: true }), 0);
  const noEdition = scoreOutrightBase(profile(), ctx({ priorEditionsInTape: 0 }));
  assert.equal(noEdition.categories.courseHistory, 0);
  assert.ok(noEdition.missing.some((m) => m.includes('course history')));

  const fit = (rec, extra = {}) => scoreOutrightBase(profile({ course: { ...profile().course, record: rec, ...extra } }), c);
  assert.equal(fit({ starts: 5, avgFinishPct: 0.2, top10Rate: 0.4 }).categories.courseFit, 20);
  assert.equal(fit({ starts: 5, avgFinishPct: 0.4, top10Rate: 0.2 }).categories.courseFit, 12);
  assert.equal(fit({ starts: 5, avgFinishPct: 0.7, top10Rate: 0.0 }).categories.courseFit, 3);
  const pen = fit({ starts: 5, avgFinishPct: 0.2, top10Rate: 0.4 }, { longCourse: true, shortHitter: true });
  assert.ok(pen.components.some((x) => x.id === 'course_fit_pen' && x.points === -8));
  const thin = fit({ starts: 2, avgFinishPct: 0.2, top10Rate: 0.5 });
  assert.equal(thin.categories.courseFit, 0);
  assert.ok(thin.coreMissing);
});

test('ranking 10/7/4/1 plus elevated-win and multiple-win bonuses; missing without OWGR', () => {
  const c = ctx();
  const at = (rank) => scoreOutrightBase(profile({ owgr: { rank } }), c).categories.ranking;
  assert.equal(at(10), 10); assert.equal(at(20), 7); assert.equal(at(50), 4); assert.equal(at(51), 1);
  const b = scoreOutrightBase(profile({ form: form({ elevatedWin12m: true, careerWinsInWindow: 2 }) }), c);
  assert.ok(b.components.some((x) => x.id === 'owgr_elev' && x.points === 5));
  assert.ok(b.components.some((x) => x.id === 'owgr_wins' && x.points === 3));
  const none = scoreOutrightBase(profile({ owgr: null }), c);
  assert.ok(none.coreMissing);
});

test('a full-evidence profile totals exactly the prompt maxima', () => {
  const p = profile({
    form: form({ winIn6w: true, backToBackTop10: true, comparableFieldTop10: true, elevatedWin12m: true, careerWinsInWindow: 3 }),
    event: { ...profile().event, top5Last3: true },
    course: { ...profile().course, record: { starts: 6, avgFinishPct: 0.1, top10Rate: 0.5 } },
    owgr: { rank: 1 },
  });
  const b = scoreOutrightBase(p, ctx({ sgAppInField: new Map([['p1', 1]]), sgT2gInField: new Map([['p1', 1]]) }));
  // 25+5+5 + 25+5+3 + 20+5 + 20 + 10+5+3 = 131
  assert.equal(b.score, 131);
  assert.equal(b.coreMissing, false);
});

test('top-six modifiers: rate tiers, event history, missed-cut penalty, OWGR tiers', () => {
  const mods = (over, evOver = {}) => scoreTop6Mods(profile({ form: form(over), event: { ...profile().event, ...evOver } }), []);
  const rate = (o) => mods(o).find((x) => x.id === 't6_rate').points;
  assert.equal(rate({ top10Rate12m: 0.4 }), 15);
  assert.equal(rate({ top10Rate12m: 0.3 }), 8);
  assert.equal(rate({ top10Rate12m: 0.1 }), -5);
  assert.equal(rate({ top10Rate12m: 0.22 }), 0);
  assert.ok(mods({}, { top15In2of3: true }).some((x) => x.id === 't6_event' && x.points === 10));
  assert.ok(mods({}, { mcMostRecent: true }).some((x) => x.id === 't6_mc' && x.points === -12));
  assert.ok(mods({ noMcLast2: true }).some((x) => x.id === 't6_b2b' && x.points === 5));
  const owgr = (rank) => scoreTop6Mods(profile({ owgr: { rank } }), []).find((x) => x.id === 't6_owgr')?.points ?? 0;
  assert.equal(owgr(15), 8); assert.equal(owgr(30), 4); assert.equal(owgr(40), 0); assert.equal(owgr(51), -3);
});

test('first round leader: R1 rank tiers, tee/weather matrix, putting, fast start', () => {
  const r1 = (rank) => scoreFrl(profile(), ctx({ r1InField: new Map([['p1', rank]]) })).components.find((x) => x.id === 'frl_r1').points;
  assert.equal(r1(10), 35); assert.equal(r1(20), 24); assert.equal(r1(40), 14); assert.equal(r1(41), 0);
  const tee = (teeTime, trend) => scoreFrl(profile({ teeTime }), ctx({ weather: { r1: { trend } } })).components.find((x) => x.id === 'frl_tee').points;
  assert.equal(tee('2026-09-03T07:00Z', 'deteriorating'), 25);
  assert.equal(tee('2026-09-03T07:00Z', 'stable'), 12);
  assert.equal(tee('2026-09-03T13:00Z', 'improving'), 8);
  assert.equal(tee('2026-09-03T13:00Z', 'deteriorating'), 0);
  const noTee = scoreFrl(profile({ teeTime: null }), ctx());
  assert.ok(noTee.components.find((x) => x.id === 'frl_tee').missing);
  assert.ok(noTee.missing.some((m) => m.includes('tee time')));
  const noWx = scoreFrl(profile(), ctx({ weather: null }));
  assert.ok(noWx.components.find((x) => x.id === 'frl_tee').missing);
  const putt = (rank, avg = 0.2) => scoreFrl(profile({ sg: { ...profile().sg, putt: { rank, avg } } }), ctx({ sgPuttInField: new Map([['p1', rank]]) })).components.find((x) => x.id === 'frl_putt').points;
  assert.equal(putt(10), 20); assert.equal(putt(25), 13); assert.equal(putt(50), 6); assert.equal(putt(5, -0.3), 0);
  const fast = scoreFrl(profile(), ctx()).components.find((x) => x.id === 'frl_fast');
  assert.equal(fast.points, 20);
  const layout = scoreFrl(profile({ r1: { ...profile().r1, fastStarts: 1 } }), ctx({ layoutEarlyScoring: true })).components.find((x) => x.id === 'frl_fast');
  assert.equal(layout.points, 15);
  const full = scoreFrl(profile(), ctx({ r1InField: new Map([['p1', 1]]), sgPuttInField: new Map([['p1', 1]]) }));
  assert.equal(full.score, 100);
  assert.equal(full.teeWeatherEdge, true);
});

test('regional modifiers follow the prompt and name unsourced links bonuses as missing', () => {
  const eu = scoreEuropeanMods(profile({ form: form({ tourTop3In: (t, d) => t === 'eur' && d === 42, mcLast2Consecutive: true }) }), ctx(), []);
  assert.ok(eu.some((x) => x.id === 'eu_top3' && x.points === 10));
  assert.ok(eu.some((x) => x.id === 'eu_dpwt' && x.points === 8));
  assert.ok(eu.some((x) => x.id === 'eu_mc' && x.points === -10));
  const euMissing = [];
  scoreEuropeanMods(profile(), ctx(), euMissing);
  assert.ok(euMissing.some((m) => m.includes('links record')));

  const us = scoreAmericanMods(profile({ region: { american: true }, course: { ...profile().course, longCourse: true, longHitter: true }, form: form({ tourWinIn: (t, d) => t === 'pga' && d === 90, majorsWonLast2y: 2 }), sg: { app: { rank: 50, avg: -0.2 } } }), ctx({ americanRank: new Map([['p1', 2]]) }), []);
  assert.ok(us.some((x) => x.id === 'us_top3' && x.points === 10));
  assert.ok(us.some((x) => x.id === 'us_pga' && x.points === 8));
  assert.ok(us.some((x) => x.id === 'us_power' && x.points === 6));
  assert.ok(us.some((x) => x.id === 'us_majors' && x.points === 5));
  assert.ok(us.some((x) => x.id === 'us_app_neg' && x.points === -10));

  const bi = scoreBritishIrishMods(profile({ form: form({ tourWinIn: (t, d) => t === 'eur' && d === 120, competedLast3Weeks: false, lastStartDaysAgo: 30 }), event: { ...profile().event, madeCutEachLast3: true } }), ctx(), []);
  assert.ok(bi.some((x) => x.id === 'bi_top2' && x.points === 10));
  assert.ok(bi.some((x) => x.id === 'bi_dpwt' && x.points === 8));
  assert.ok(bi.some((x) => x.id === 'bi_cuts' && x.points === 6));
  assert.ok(bi.some((x) => x.id === 'bi_rust' && x.points === -8));
});

test('Step 3 bands: thresholds verbatim and HIGH unreachable on partial evidence', () => {
  assert.equal(bandOutright(75, false), CONFIDENCE.HIGH);
  assert.equal(bandOutright(75, true), CONFIDENCE.MEDIUM);
  assert.equal(bandOutright(60, false), CONFIDENCE.MEDIUM);
  assert.equal(bandOutright(59, false), CONFIDENCE.LOW);
  assert.equal(bandTop6(65, false), CONFIDENCE.HIGH);
  assert.equal(bandTop6(55, false), CONFIDENCE.MEDIUM);
  assert.equal(bandTop6(54, false), CONFIDENCE.SKIP);
  assert.equal(bandFrl(75, true, false), CONFIDENCE.HIGH);
  assert.equal(bandFrl(75, false, false), CONFIDENCE.MEDIUM, 'HIGH needs the tee/weather edge');
  assert.equal(bandFrl(65, true, false), CONFIDENCE.MEDIUM);
  assert.equal(bandFrl(55, true, false), CONFIDENCE.LOW);
  assert.equal(bandFrl(54, true, false), CONFIDENCE.SKIP);
  assert.equal(bandRegional(70, false), CONFIDENCE.HIGH);
  assert.equal(bandRegional(55, false), CONFIDENCE.MEDIUM);
  assert.equal(bandRegional(54, false), CONFIDENCE.LOW);
  assert.equal(bandRegional(80, false, { coSelected: true }), CONFIDENCE.MEDIUM, 'co-selection caps at MEDIUM');
  assert.equal(RULES.top6.max, 6);
  assert.equal(RULES.frl.max, 5);
});

/* ---------- event-level rules ---------- */

function field(n, { history = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const id = `g${i}`;
    const rank = i + 1;
    const strong = i < 4;
    out.push(profile({
      athleteId: id, name: `Golfer ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
      country: i % 3 === 0 ? 'USA' : i % 3 === 1 ? 'England' : 'Spain', countryCode: i % 3 === 0 ? 'USA' : i % 3 === 1 ? 'ENG' : 'ESP',
      region: { european: i % 3 !== 0, american: i % 3 === 0, britishIrish: i % 3 === 1, known: true },
      form: history ? form({ winIn6w: strong, top10Last5: strong ? 3 : i < 20 ? 2 : 0, top10Rate12m: strong ? 0.5 : 0.3, starts: 10 }) : form({ starts: 0, top10Rate12m: null }),
      event: { ...profile().event, top5Last3: i === 17 || strong, madeCutNoTop20Last3: !strong },
      course: { ...profile().course, record: history ? { starts: 6, avgFinishPct: strong || i === 17 ? 0.1 : 0.4, top10Rate: strong || i === 17 ? 0.5 : 0.2 } : { starts: 0 } },
      owgr: history ? { rank } : null,
      sg: null,
      r1: history ? profile().r1 : { rounds: 0, avgR1ToPar: null, fastStarts: 0, fastStartSample: 0 },
      teeTime: history ? `2026-09-03T${String(7 + (i % 8)).padStart(2, '0')}:00Z` : null,
      historyStarts: history ? 10 : 0,
    }));
  }
  return out;
}

function fieldCtx(profiles, over = {}) {
  const owgrInField = new Map(profiles.map((p, i) => [p.athleteId, i + 1]));
  const rr = (flag) => new Map(profiles.filter((p) => p.region[flag]).map((p, i) => [p.athleteId, i + 1]));
  return ctx({
    sgAppInField: new Map(), sgPuttInField: new Map(), sgT2gInField: new Map(), sgCoverage: 0,
    owgrInField, r1InField: new Map(profiles.filter((p) => p.r1?.avgR1ToPar !== null).map((p, i) => [p.athleteId, i + 1])), r1Sample: profiles.filter((p) => p.r1?.avgR1ToPar !== null).length,
    europeanRank: rr('european'), americanRank: rr('american'), britishIrishRank: rr('britishIrish'),
    regionCounts: { european: rr('european').size, american: rr('american').size, britishIrish: rr('britishIrish').size },
    weather: null, ...over,
  });
}

test('scoreGolfEvent: outright always names a value pick outside the top-five favourites', () => {
  const profiles = field(60);
  const r = scoreGolfEvent({ id: 'e1', name: 'Test Open' }, profiles, fieldCtx(profiles));
  const out = r.markets.outright;
  assert.equal(out.selections.length, 2, 'top pick plus value pick');
  assert.ok(out.selections[0].fieldRank <= 5);
  const v = out.selections[1];
  assert.ok(v.fieldRank > 5, 'value pick is outside the top five favourites');
  assert.ok(v.valuePick || v.valueFallback);
  assert.ok(out.missing.some((m) => m.includes('odds')));
  assert.equal(out.candidates.length <= 25, true);
});

test('scoreGolfEvent: top-six guard never lists six top-six favourites', () => {
  const profiles = field(60);
  // make the first six overwhelming and a 20th-ranked player also qualify
  for (let i = 0; i < 6; i += 1) profiles[i].form = form({ winIn6w: true, top10Last5: 3, top10Rate12m: 0.5, starts: 10 });
  profiles[19].form = form({ winIn6w: true, top10Rate12m: 0.4, starts: 10 });
  const r = scoreGolfEvent({ id: 'e1' }, profiles, fieldCtx(profiles));
  const sel = r.markets.top6.selections;
  assert.ok(sel.length <= 6);
  assert.ok(sel.some((s) => s.fieldRank >= 15), 'at least one selection ranked fifteenth or worse');
  assert.ok(sel.every((s) => s.band !== CONFIDENCE.SKIP));
  assert.ok(r.flags.some((f) => f.startsWith('top-six guard')));
});

test('scoreGolfEvent: regional markets pick one, co-select within five points, skip with no eligible players', () => {
  const profiles = field(30);
  const r = scoreGolfEvent({ id: 'e1' }, profiles, fieldCtx(profiles));
  for (const key of ['top_european', 'top_american', 'top_british_irish']) {
    const m = r.markets[key];
    assert.ok(m.selections.length >= 1 && m.selections.length <= 2, `${key} has one or two selections`);
    if (m.selections.length === 2) {
      assert.ok(m.coSelected);
      assert.ok(Math.abs(m.selections[0].score - m.selections[1].score) <= 5);
      assert.equal(m.selections[0].band, CONFIDENCE.MEDIUM);
    }
  }
  const onlyAmericans = profiles.map((p) => ({ ...p, region: { european: false, american: true, britishIrish: false, known: true } }));
  const r2 = scoreGolfEvent({ id: 'e2' }, onlyAmericans, fieldCtx(onlyAmericans));
  assert.equal(r2.markets.top_european.selections.length, 0);
  assert.equal(r2.markets.top_european.eligible, 0);
  assert.ok(r2.markets.top_european.missing[0].includes('no eligible player'));
});

test('scoreGolfEvent: excludes amateurs, flags shared headliners, refuses to pick without evidence', () => {
  const profiles = field(30);
  profiles[0].amateur = true;
  const r = scoreGolfEvent({ id: 'e1' }, profiles, fieldCtx(profiles));
  assert.ok(r.flags.some((f) => f.includes('amateurs excluded')));
  for (const k of Object.keys(r.markets)) assert.ok(!r.markets[k].selections.some((s) => s.athleteId === 'g0'));
  assert.ok(r.flags.some((f) => f.includes('same player heads')));

  const blank = field(30, { history: false });
  const r2 = scoreGolfEvent({ id: 'e3' }, blank, fieldCtx(blank, { priorEditionsInTape: 0 }));
  for (const k of Object.keys(r2.markets)) assert.equal(r2.markets[k].selections.length, 0, `${k} makes no selection without evidence`);
  assert.ok(r2.missing.some((m) => m.includes('course history')));
  assert.equal(hasEvidence({ score: 0, components: [] }), false);
  assert.equal(scoreGolfEvent({ id: 'e4' }, [], fieldCtx([])).unscored, true);
  assert.equal(MARKETS.frl, 'FIRST ROUND LEADER');
});
