import test from 'node:test';
import assert from 'node:assert/strict';
import {
  oddsStrength,
  formPoints,
  h2hPoints,
  recordPoints,
  standingsPoints,
  buildStandingsMap,
  contextPoints,
  fatiguePoints,
  scoreNbaMatch,
  scoreNbaCard,
  NBA_RULESET_VERSION,
} from '../engine/nba_engine.js';

/* ------------------------------------------------------------------ *
 * STEP 2 WIN MATCH — odds strength (30)
 * ------------------------------------------------------------------ */
test('oddsStrength maps the prompt tiers exactly', () => {
  assert.equal(oddsStrength(-300), 30);
  assert.equal(oddsStrength(-400), 30); // -300 or lower
  assert.equal(oddsStrength(-200), 22);
  assert.equal(oddsStrength(-250), 22);
  assert.equal(oddsStrength(-150), 14);
  assert.equal(oddsStrength(-175), 14);
  assert.equal(oddsStrength(-100), 6);
  assert.equal(oddsStrength(-120), 6);
  assert.equal(oddsStrength(-110), 6);
  assert.equal(oddsStrength(-105), 6);
  assert.equal(oddsStrength(+100), 0); // near-even to underdog
  assert.equal(oddsStrength(+150), 0);
  assert.equal(oddsStrength(null), null);
});

/* ------------------------------------------------------------------ *
 * STEP 2 WIN MATCH — recent form (25), with the +5 streak bonus
 * ------------------------------------------------------------------ */
test('formPoints maps last-5 wins and the 4+ streak bonus', () => {
  assert.equal(formPoints(['W', 'W', 'W', 'W', 'W']), 25); // 5/5 = 25 (no bonus over cap)
  assert.equal(formPoints(['W', 'W', 'W', 'W', 'L']), 18 + 5); // 4/5 = 18 + streak 4 = 23
  assert.equal(formPoints(['W', 'W', 'W', 'L', 'L']), 10); // 3/5 = 10, streak 3 no bonus
  assert.equal(formPoints(['W', 'W', 'L', 'L', 'L']), 0); // 2 or fewer
  assert.equal(formPoints(['L', 'L', 'L', 'L', 'L']), 0);
  assert.equal(formPoints(null), null);
});

/* ------------------------------------------------------------------ *
 * STEP 2 WIN MATCH — head-to-head last 3 years (20)
 * ------------------------------------------------------------------ */
test('h2hPoints maps win-rate tiers', () => {
  assert.equal(h2hPoints({ meetings: 4, homeWins: 3, awayWins: 1, draws: 0 }, 'Home', 'Home', 'Away'), 20); // 75%
  assert.equal(h2hPoints({ meetings: 4, homeWins: 2, awayWins: 2, draws: 0 }, 'Home', 'Home', 'Away'), 5); // 50% even
  assert.equal(h2hPoints({ meetings: 4, homeWins: 1, awayWins: 3, draws: 0 }, 'Home', 'Home', 'Away'), 0); // trailing
  assert.equal(h2hPoints({ meetings: 2, homeWins: 2, awayWins: 0, draws: 0 }, 'Home', 'Home', 'Away'), null); // <3 meetings
});

/* ------------------------------------------------------------------ *
 * STEP 2 WIN MATCH — standings & season record (15)
 * ------------------------------------------------------------------ */
test('recordPoints maps win-rate tiers and the opponent-higher deduction', () => {
  assert.equal(recordPoints({ winPct: 0.7 }, { winPct: 0.4 }), 15);
  assert.equal(recordPoints({ winPct: 0.58 }, { winPct: 0.4 }), 10);
  assert.equal(recordPoints({ winPct: 0.48 }, { winPct: 0.4 }), 5);
  assert.equal(recordPoints({ winPct: 0.3 }, { winPct: 0.4 }), 0);
  assert.equal(recordPoints({ winPct: 0.7 }, { winPct: 0.8 }), 15 - 5); // opponent higher → -5
  assert.equal(recordPoints(null, { winPct: 0.4 }), null);
});

test('standingsPoints uses the conference-rank tiers from the prompt', () => {
  // top-3 = 15, 4-6 = 10, 7-10 = 5, outside = 0; -5 when opponent ranks higher.
  assert.equal(standingsPoints({ rank: 1 }, { rank: 8 }), 15);
  assert.equal(standingsPoints({ rank: 5 }, { rank: 12 }), 10);
  assert.equal(standingsPoints({ rank: 9 }, { rank: 3 }), 5 - 5); // opponent #3 is higher → -5
  assert.equal(standingsPoints({ rank: 11 }, { rank: 14 }), 0);
  // falls back to winPct when no rank is present
  assert.equal(standingsPoints({ winPct: 0.7 }, { winPct: 0.4 }), 15);
});

test('buildStandingsMap joins team displayName to rank/conf/winPct', () => {
  const doc = {
    conferences: {
      'Eastern Conference': { teams: [
        { name: 'Detroit Pistons', rank: 1, winPct: 0.732, ppg: 117.8, oppPpg: 109.6 },
        { name: 'Atlanta Hawks', rank: 2, winPct: 0.519, ppg: 118.5, oppPpg: 116.0 },
      ] },
      'Western Conference': { teams: [
        { name: 'San Antonio Spurs', rank: 1, winPct: 0.756, ppg: 115.0, oppPpg: 108.1 },
      ] },
    },
  };
  const map = buildStandingsMap(doc);
  assert.equal(map.get('Detroit Pistons').rank, 1);
  assert.equal(map.get('Detroit Pistons').conf, 'Eastern Conference');
  assert.equal(map.get('Atlanta Hawks').rank, 2);
  assert.equal(map.get('San Antonio Spurs').conf, 'Western Conference');
  assert.equal(map.get('Nobody'), undefined);
});

/* ------------------------------------------------------------------ *
 * STEP 2 WIN MATCH — context & home court (10)
 * ------------------------------------------------------------------ */
test('contextPoints gives home side the strong-split bonus, none when neutral', () => {
  const strongHome = { homeSplit: { winPct: 0.65 } };
  const weakHome = { homeSplit: { winPct: 0.4 } };
  assert.equal(contextPoints(strongHome, true, false), 6 + 3);
  assert.equal(contextPoints(weakHome, true, false), 6);
  assert.equal(contextPoints({}, false, false), 2);
  assert.equal(contextPoints(strongHome, true, true), 2); // neutral venue → no edge
});

/* ------------------------------------------------------------------ *
 * STEP 2 SPREAD — fatigue modifier (±5)
 * ------------------------------------------------------------------ */
test('fatiguePoints rewards opponent back-to-back and penalises own', () => {
  assert.equal(fatiguePoints(3, 1), 5); // opponent B2B
  assert.equal(fatiguePoints(1, 3), -5); // own B2B
  assert.equal(fatiguePoints(3, 3), 0);
  assert.equal(fatiguePoints(null, null), 0);
});

/* ------------------------------------------------------------------ *
 * end-to-end: full card, honesty discipline
 * ------------------------------------------------------------------ */

function mkMatch(over = {}) {
  return {
    id: 'g1',
    leagueSlug: 'nba',
    leagueName: 'National Basketball Association',
    dateISO: '2026-10-20',
    startUtc: '2026-10-20T19:00Z',
    phase: 'upcoming',
    neutral: false,
    home: {
      name: 'Home Team',
      record: { wins: 10, losses: 2, played: 12, winPct: 0.8333 },
      homeSplit: { wins: 6, losses: 1, played: 7, winPct: 0.8571 },
      avgPoints: 116.2,
      ...over.home,
    },
    away: {
      name: 'Away Team',
      record: { wins: 3, losses: 9, played: 12, winPct: 0.25 },
      awaySplit: { wins: 1, losses: 5, played: 6, winPct: 0.1667 },
      avgPoints: 104.8,
      ...over.away,
    },
    odds: {
      provider: 'DraftKings',
      moneyline: {
        home: { american: -250, decimal: 1.4, fairProb: 0.65 },
        away: { american: +200, decimal: 3.0, fairProb: 0.35 },
      },
      spread: { homeLine: -7.5, awayLine: 7.5 },
      total: { line: 224.5 },
    },
    links: { summary: 'https://www.espn.com/x' },
    ...over.match,
  };
}

const TAPE = [
  { phase: 'results', winner: 'home', home: { name: 'Home Team' }, away: { name: 'Away Team' }, startUtc: '2026-10-18T19:00Z' },
  { phase: 'results', winner: 'home', home: { name: 'Other' }, away: { name: 'Home Team' }, startUtc: '2026-10-16T19:00Z' },
  { phase: 'results', winner: 'away', home: { name: 'Home Team' }, away: { name: 'Other2' }, startUtc: '2026-10-14T19:00Z' },
  { phase: 'results', winner: 'home', home: { name: 'Other3' }, away: { name: 'Home Team' }, startUtc: '2026-10-12T19:00Z' },
  { phase: 'results', winner: 'home', home: { name: 'Home Team' }, away: { name: 'Other4' }, startUtc: '2026-10-10T19:00Z' },
];

function ctxFor() {
  // Home Team's last five (most-recent-first): W (vs Away), W (at Other), L (vs Other2), W (at Other3), W (vs Other4) → 4 wins, streak 2
  return {
    tape: TAPE,
    h2h: { meetings: 4, homeWins: 3, awayWins: 1, draws: 0 },
    rest: { home: 2, away: 1 }, // away on a back-to-back
    homeForm: ['W', 'W', 'L', 'W', 'W'],
    awayForm: ['L', 'W', 'L', 'L', 'L'],
  };
}

test('scoreNbaMatch scores WIN MATCH from sourced factors and withholds the rest', () => {
  const r = scoreNbaMatch(mkMatch(), ctxFor());
  assert.equal(r.ruleset, NBA_RULESET_VERSION);
  assert.equal(r.lean, 'home');
  const wm = r.markets.match_result;
  assert.equal(wm.label, 'WIN MATCH');
  assert.equal(wm.selection, 'Home Team');
  // odds -250 → 22; form 4/5 (streak 2, no bonus) → 18; h2h 75% → 20;
  // record 0.833 → 15; context home + strong split → 6+3=9.
  // Total = 22 + 18 + 20 + 15 + 9 = 84.
  assert.equal(wm.score, 84);
  assert.equal(wm.band, 'HIGH');
  // the buckets that fired are recorded
  const bucketIds = wm.breakdown.map((b) => b.bucket);
  assert.ok(bucketIds.includes('odds-strength'));
  assert.ok(bucketIds.includes('recent-form'));
  assert.ok(bucketIds.includes('head-to-head'));
  assert.ok(bucketIds.includes('season-record'));
  assert.ok(bucketIds.includes('context-home-court'));

  // GAME TOTAL is structurally SKIP on the free feed — pace/defence/injuries
  // and over/under trends are all absent and never invented.
  assert.equal(r.markets.total.band, 'SKIP');
  assert.equal(r.markets.total.selection, null);

  // The missing register names every withheld input with its reason.
  const missingIds = r.missing.map((m) => m.id);
  assert.ok(missingIds.includes('NBA-ODDS-2'), 'single odds source is flagged');
  assert.ok(missingIds.includes('NBA-ATS'), 'ATS trend is flagged missing');
  assert.ok(missingIds.includes('NBA-PACE'), 'pace rating is flagged missing');
  assert.ok(missingIds.includes('NBA-INJ'), 'injuries are flagged missing');
  for (const m of r.missing) assert.ok(m.reason, `missing ${m.id} carries a reason`);
});

test('scoreNbaMatch resolves to SKIP when the card has no sourced inputs (opening week)', () => {
  // No tape, no records, no odds → the engine must withhold, not guess.
  const match = mkMatch({
    match: { odds: null },
    home: { record: null, homeSplit: null, avgPoints: null },
    away: { record: null, awaySplit: null, avgPoints: null },
  });
  const r = scoreNbaMatch(match, {});
  assert.equal(r.scoreable, false);
  assert.equal(r.markets.match_result.band, 'SKIP');
  assert.equal(r.markets.match_result.selection, null);
  assert.equal(r.markets.handicap.band, 'SKIP');
  assert.equal(r.markets.total.band, 'SKIP');
  assert.ok(r.missing.length >= 5, 'a data-poor card reports its gaps');
});

test('a -300 or heavier favourite must clear the 75-point bar (STEP 3)', () => {
  const match = mkMatch({
    match: { odds: {
      provider: 'DraftKings',
      moneyline: { home: { american: -320, decimal: 1.3125, fairProb: 0.76 }, away: { american: +260, decimal: 3.6, fairProb: 0.24 } },
      spread: { homeLine: -9, awayLine: 9 },
      total: { line: 220 },
    } },
  });
  // Same rich form/record context as before → score should be high enough (89+)
  // that the heavy-favourite gate is cleared and the band is HIGH.
  const r = scoreNbaMatch(match, ctxFor());
  assert.ok(r.markets.match_result.score >= 75, `heavy favourite cleared 75 (score ${r.markets.match_result.score})`);
  assert.equal(r.markets.match_result.band, 'HIGH');
});

test('scoreNbaCard sorts by headline score and reports unscored games', () => {
  const matches = [mkMatch(), mkMatch({ id: 'g2', match: { odds: null }, home: { record: null }, away: { record: null } })];
  const card = scoreNbaCard(matches, (m) => (m.id === 'g1' ? ctxFor() : {}));
  assert.equal(card.results.length, 1);
  assert.equal(card.unscored.length, 1);
  assert.equal(card.results[0].matchId, 'g1');
});

test('scoreNbaMatch uses real conference rank when standings are supplied', () => {
  const standings = new Map([
    ['Home Team', { rank: 5, conf: 'East', winPct: 0.60 }],
    ['Away Team', { rank: 9, conf: 'East', winPct: 0.25 }],
  ]);
  const r = scoreNbaMatch(mkMatch(), { ...ctxFor(), standings });
  const wm = r.markets.match_result;
  // Home Team is conference rank #5 → 10 (4-6 tier); opponent #9 is NOT higher,
  // so no -5. This replaces the winPct proxy (0.83 → 15) with the real tier.
  const bucket = wm.breakdown.find((b) => b.bucket === 'season-record');
  assert.equal(bucket.points, 10);
  assert.match(bucket.detail, /rank #5/);
  // With standings present, no standings-missing flag is raised.
  assert.ok(!r.missing.some((m) => m.id === 'NBA-STANDINGS'));
});

test('scoreNbaMatch flags standings as missing when none are supplied', () => {
  const r = scoreNbaMatch(mkMatch(), ctxFor());
  assert.ok(r.missing.some((m) => m.id === 'NBA-STANDINGS'));
});
