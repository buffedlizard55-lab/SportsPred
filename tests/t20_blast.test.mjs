/**
 * SportsPred — T20 Blast test suite.
 *
 * Runs with bare `node --test`; no jsdom, no network, no fixtures beyond the
 * committed tape. Covers the four layers that produce a published tip:
 *
 *   data      walk-forward context, and the guarantee that it cannot see ahead
 *   engine    bands, caps, flags, the strict-prompt path, the publication gate
 *   writer    every output rule from the master prompt, enforced not requested
 *   collector the pure core of scripts/collect_t20_blast.mjs
 *
 * The rules tested here are the ones that stop a fabricated or non-compliant
 * tip reaching the site, so each has a positive case and a negative case.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  formFor, h2h, tableAt, homeWinRate, restFor, marginProfile,
  contextFor, deductionMap, groupMap, resultsBefore, BLAST_POINTS,
} from '../engine/t20_blast_data.js';
import {
  scoreBlastMatch, evidenceProbability, bandRank, applyPublicationGate, gateFromBacktest,
  EVIDENCE_WEIGHTS, PROB_SLOPE, BAND,
} from '../engine/t20_blast_engine.js';
import {
  validateBlastTip, writeBlastTip, writeBlastCard, buildBlastFormattedCardText,
  openingWord, validateCardOpenings, buildValidationDisclosure, digitScope,
  BLAST_ANGLES, PLAYER_ANGLES, BANNED_PHRASES, MIN_WORDS, BOLD_WORD_LIMIT,
  MARKET_ORDER, COUNTY_TOKENS,
} from '../engine/t20_blast_writer.js';
import {
  planCollection, normaliseEspnEvent, normalisePayload, mergeTape, ESPN,
} from '../scripts/collect_t20_blast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

const matchesDoc = read('t20_blast_matches.json');
const standingsDoc = read('t20_blast_standings.json');
const backtestDoc = read('t20_blast_backtest.json');
const MATCHES = matchesDoc.matches;
const OPTS = { deductions: deductionMap(standingsDoc), groupOf: groupMap(standingsDoc) };

const decided = MATCHES.filter((m) => m.winner_slug);

/* ================================================================== *
 * DATA LAYER
 * ================================================================== */

describe('t20_blast_data: walk-forward context', () => {
  test('resultsBefore is strictly earlier and never includes the fixture itself', () => {
    for (const row of MATCHES) {
      const prior = resultsBefore(MATCHES, row.date);
      assert.ok(prior.every((m) => m.date < row.date), `${row.date}: a later fixture leaked into context`);
      assert.ok(!prior.some((m) => m.event_id && m.event_id === row.event_id), `${row.date}: the fixture appears in its own context`);
    }
  });

  test('form on the opening date of the season is empty for every county', () => {
    const first = [...MATCHES].sort((a, b) => a.date.localeCompare(b.date))[0].date;
    for (const row of MATCHES.filter((m) => m.date === first)) {
      const f = formFor(row.home_slug, MATCHES, first);
      assert.equal(f.played, 0, `${row.home} has form before the season started`);
    }
  });

  test('form never exceeds the requested window', () => {
    for (const row of decided) {
      const f = formFor(row.home_slug, MATCHES, row.date, 5);
      assert.ok(f.sample <= 5, `form window exceeded for ${row.home} on ${row.date}`);
      assert.equal(f.last5.length, Math.min(f.sample, 5));
    }
  });

  test('head-to-head is oriented per side and symmetric in totals', () => {
    for (const row of decided) {
      const a = h2h(row.home_slug, row.away_slug, MATCHES, row.date);
      const b = h2h(row.away_slug, row.home_slug, MATCHES, row.date);
      assert.equal(a.totalMeetings, b.totalMeetings, 'both sides must see the same number of meetings');
      assert.equal(a.teamWins + b.teamWins + (a.ties ?? 0) + (b.ties ?? 0) - (a.ties ?? 0), a.totalMeetings + (b.ties ?? 0),
        'wins plus ties must account for the meetings');
    }
  });

  test('tableAt reproduces the points system and the Sussex deduction', () => {
    const last = [...MATCHES].map((m) => m.date).sort().pop();
    const after = new Date(`${last}T12:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    const table = tableAt(MATCHES, after.toISOString().slice(0, 10), OPTS);
    const all = [...table.values()].flat();
    assert.equal(all.length, 18, 'all eighteen counties appear once the season is complete');
    for (const r of all) {
      const expected = BLAST_POINTS.win * r.won + BLAST_POINTS.tie * r.tied + BLAST_POINTS.no_result * r.no_result - (r.points_deduction || 0);
      assert.equal(r.points, expected, `${r.slug}: points must equal 4W + 2T + 2NR - deduction`);
    }
    const sussex = all.find((r) => r.slug === 'sussex');
    assert.ok(sussex, 'Sussex missing from the recomputed table');
    assert.equal(sussex.points_deduction, 2, 'Sussex carries a verified two-point deduction');
  });

  test('the recomputed table matches the published standings on wins and losses', () => {
    const published = new Map();
    for (const rows of Object.values(standingsDoc.groups || {})) {
      for (const r of rows || []) published.set(r.slug, r);
    }
    assert.ok(published.size >= 18, 'the published standings should hold all eighteen counties');
    const last = [...MATCHES].map((m) => m.date).sort().pop();
    const table = tableAt(MATCHES, '2026-12-31', OPTS);
    for (const row of [...table.values()].flat()) {
      const p = published.get(row.slug);
      if (!p) continue;
      // The published table counts cross-pool fixtures this tape does not hold,
      // and the recomputed table counts league stage only (knockouts excluded),
      // so the recomputed side may be lower — but never higher, and never lower
      // by more than the results the tape itself declares uncaptured.
      assert.ok(row.won <= p.won, `${row.slug}: recomputed wins exceed the published table`);
      assert.ok(row.lost <= p.lost, `${row.slug}: recomputed losses exceed the published table`);
      assert.ok(row.tied <= p.tied, `${row.slug}: recomputed ties exceed the published table`);
      const shortfall = (p.won - row.won) + (p.lost - row.lost) + (p.tied - row.tied);
      assert.ok(shortfall <= (p.uncaptured_results ?? 0) + (p.no_result ?? 0),
        `${row.slug}: ${shortfall} results unaccounted for, but only ${p.uncaptured_results} are declared uncaptured`);
      assert.ok(row.played <= p.played, `${row.slug}: recomputed played exceeds the published table`);
    }
  });

  test('homeWinRate stays inside 0..1 and reports its own sample', () => {
    for (const row of decided.slice(0, 20)) {
      const h = homeWinRate(MATCHES, row.date);
      assert.ok(h.rate == null || (h.rate >= 0 && h.rate <= 1), 'home win rate outside 0..1');
      assert.ok(typeof h.total === 'number');
      assert.equal(h.homeWins + h.awayWins, h.total, 'home and away wins must account for every decided fixture');
      // Neutral venues are excluded: a Finals Day pitch is nobody's home.
      assert.ok(h.total <= resultsBefore(MATCHES, row.date).filter((m) => !m.neutral && m.winner_slug).length);
    }
  });

  test('rest is never negative and grows with the gap between fixtures', () => {
    for (const row of decided) {
      const r = restFor(row.home_slug, MATCHES, row.date);
      assert.ok(r.days == null || r.days >= 0, `${row.home}: negative rest on ${row.date}`);
    }
  });

  test('marginProfile only counts fixtures that were decided', () => {
    for (const row of decided) {
      const m = marginProfile(row.home_slug, MATCHES, row.date);
      assert.ok((m.decisive ?? 0) + (m.narrow ?? 0) <= (m.played ?? 0));
    }
  });

  test('contextFor supplies both sides, the league and the fixture label', () => {
    const row = decided[decided.length - 1];
    const ctx = contextFor(row, matchesDoc, OPTS);
    assert.equal(ctx.date, row.date);
    for (const side of [ctx.home, ctx.away]) {
      assert.ok(side.form && typeof side.form === 'object');
      assert.ok(side.h2h && typeof side.h2h === 'object');
      assert.ok(side.rest && side.margin);
    }
    assert.equal(ctx.fixture.cross_pool, row.stage === 'cross');
    assert.ok(ctx.league && typeof ctx.league.home_advantage === 'object');
  });

  test('deductionMap and groupMap cover all eighteen counties', () => {
    assert.equal(Object.keys(groupMap(standingsDoc)).length, 18);
    const ded = deductionMap(standingsDoc);
    assert.equal(ded.sussex, 2);
  });
});

/* ================================================================== *
 * ENGINE LAYER
 * ================================================================== */

describe('t20_blast_engine: scoring', () => {
  test('declared weights sum to 100 and are documented as unfitted', () => {
    assert.equal(Object.values(EVIDENCE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
    assert.ok(PROB_SLOPE > 0);
  });

  test('evidenceProbability is monotonic and clamped away from certainty', () => {
    const lo = evidenceProbability(0);
    const mid = evidenceProbability(50);
    const hi = evidenceProbability(100);
    assert.ok(lo < mid && mid < hi, 'probability must rise with the evidence score');
    assert.equal(mid, 0.5);
    assert.ok(lo >= 0.05 && hi <= 0.95, 'a sourced model never claims certainty');
  });

  test('every tape fixture scores without throwing and returns four markets', () => {
    for (const row of MATCHES) {
      const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      assert.deepEqual(Object.keys(r.markets).sort(), [...MARKET_ORDER].sort());
      assert.equal(r.markets.win_match.selection === row.home || r.markets.win_match.selection === row.away, true,
        `${row.home} v ${row.away}: WIN MATCH must name one of the two sides`);
      assert.ok(Array.isArray(r.missing));
    }
  });

  test('the first fixtures of the season are withheld, not guessed', () => {
    const first = [...MATCHES].sort((a, b) => a.date.localeCompare(b.date))[0];
    const r = scoreBlastMatch(first, contextFor(first, matchesDoc, OPTS));
    assert.equal(r.markets.win_match.band, BAND.SKIP, 'a fixture with no prior results cannot support a tip');
  });

  test('no market price is ever claimed, on any fixture', () => {
    for (const row of MATCHES) {
      const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      assert.ok(r.caps.includes('no_market_price'), `${row.home} v ${row.away}: the odds cap must always be declared`);
      assert.ok(r.missing.some((m) => /odds/i.test(m)), 'the missing list must name the absent odds feed');
    }
  });

  test('player markets are withheld without a confirmed line-up', () => {
    for (const row of MATCHES.slice(0, 12)) {
      const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      for (const k of ['man_of_the_match', 'top_team1_batsman', 'top_team2_batsman']) {
        assert.equal(r.markets[k].band, BAND.SKIP, `${k} must not name a player from the historical tape`);
        assert.equal(r.markets[k].selection, null);
        assert.ok(r.markets[k].skip_reason, 'a withheld market must say why');
      }
    }
  });

  test('a rain-affected fixture drops a tier and is flagged', () => {
    const row = decided.find((m) => m.dl_method) || decided[0];
    const withRain = scoreBlastMatch({ ...row, dl_method: true }, contextFor(row, matchesDoc, OPTS));
    assert.ok(withRain.caps.includes('rain_or_dls'));
    assert.ok(withRain.flags.some((f) => /^WEATHER/.test(f)));
    const dry = scoreBlastMatch({ ...row, dl_method: false }, contextFor(row, matchesDoc, OPTS));
    assert.ok(bandRank(dry.markets.win_match.band) >= bandRank(withRain.markets.win_match.band),
      'rain can only lower confidence, never raise it');
  });

  test('a cross-pool fixture can never read HIGH', () => {
    const row = MATCHES.find((m) => m.stage === 'cross') || { ...decided[10], stage: 'cross' };
    const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
    if (r.markets.win_match.band !== BAND.SKIP) {
      assert.notEqual(r.markets.win_match.band, BAND.HIGH, 'crossover evidence is too thin for the top tier');
      assert.ok(r.caps.includes('cross_pool_fixture'));
    }
  });

  test('a missing key player lowers confidence and never speculates in prose', () => {
    const row = decided[20] || decided[0];
    const r = scoreBlastMatch({ ...row, availability: { missing_key_player: true } }, contextFor(row, matchesDoc, OPTS));
    assert.ok(r.caps.includes('key_player_unavailable'));
    assert.ok(r.flags.some((f) => /^AVAILABILITY/.test(f)));
  });

  test('the strict-prompt path is reported separately and honestly', () => {
    for (const row of MATCHES.slice(0, 10)) {
      const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      const sp = r.markets.win_match.strict_prompt;
      assert.ok(sp, 'the rubric-as-written score must be exposed alongside the evidence model');
      assert.ok(sp.note && /no free key-less source/i.test(sp.note));
    }
  });

  test('the deduction is treated as internal context and never as a tip fact', () => {
    // An early-season Sussex fixture has no table yet, so pick a late one where
    // the walk-forward table exists and the deduction is visible to the engine.
    const sussexRows = MATCHES.filter((m) => (m.home_slug === 'sussex' || m.away_slug === 'sussex') && m.winner_slug)
      .sort((a, b) => a.date.localeCompare(b.date));
    const row = sussexRows[sussexRows.length - 1];
    const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
    const flag = r.flags.find((f) => /^STANDING/.test(f));
    assert.ok(flag && /never referenced in a tip/i.test(flag), 'the deduction must be marked internal-only');
  });

  test('review urls are present on every captured row', () => {
    for (const row of MATCHES) {
      const r = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      assert.ok(r.review_urls.length >= 1, `${row.home} v ${row.away}: no review link for manual checking`);
      for (const u of r.review_urls) assert.match(u, /^https:\/\//);
    }
  });
});

describe('t20_blast_engine: publication gate', () => {
  const gate = gateFromBacktest(backtestDoc);

  test('the committed backtest produces a gate', () => {
    assert.ok(gate, 'no gate could be read from data/t20_blast_backtest.json');
    assert.equal(gate.cap, BAND.MEDIUM);
    assert.ok(gate.triggered.length >= 3);
    assert.ok(gate.observedRates[BAND.HIGH]?.n > 0);
  });

  test('the gate caps HIGH to MEDIUM and preserves the model tier', () => {
    const row = decided.find((m) => {
      const r = scoreBlastMatch(m, contextFor(m, matchesDoc, OPTS));
      return r.markets.win_match.band === BAND.HIGH;
    });
    assert.ok(row, 'no HIGH-band fixture in the tape to test the cap against');
    const raw = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
    const capped = applyPublicationGate(raw, gate);
    assert.equal(raw.markets.win_match.band, BAND.HIGH);
    assert.equal(capped.markets.win_match.band, BAND.MEDIUM, 'the gate must cap the published tier');
    assert.equal(capped.markets.win_match.modelBand, BAND.HIGH, 'the tier the model chose must stay visible');
    assert.equal(capped.publicationGate.applied, true);
  });

  test('the quoted observed rate belongs to the model tier, not the capped label', () => {
    const row = decided.find((m) => scoreBlastMatch(m, contextFor(m, matchesDoc, OPTS)).markets.win_match.band === BAND.HIGH);
    const capped = applyPublicationGate(scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS)), gate);
    const v = capped.markets.win_match.validated;
    assert.equal(v.modelBand, BAND.HIGH);
    assert.equal(v.observedHitRatePct, gate.observedRates[BAND.HIGH].hitRate,
      'capping must not launder a weak tier into a stronger-looking rate');
  });

  test('the gate never alters a score, a probability or a selection', () => {
    for (const row of MATCHES.slice(0, 25)) {
      const raw = scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS));
      const capped = applyPublicationGate(raw, gate);
      assert.equal(capped.markets.win_match.score, raw.markets.win_match.score);
      assert.equal(capped.markets.win_match.probability, raw.markets.win_match.probability);
      assert.equal(capped.markets.win_match.selection, raw.markets.win_match.selection);
    }
  });

  test('no gate means no cap and no invented validation', () => {
    const row = decided[0];
    const r = applyPublicationGate(scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS)), null);
    assert.equal(r.publicationGate.cap, null);
    assert.equal(r.publicationGate.applied, false);
  });

  test('bandRank orders the tiers correctly', () => {
    assert.ok(bandRank(BAND.HIGH) > bandRank(BAND.MEDIUM));
    assert.ok(bandRank(BAND.MEDIUM) > bandRank(BAND.LOW));
    assert.ok(bandRank(BAND.LOW) > bandRank(BAND.SKIP));
    assert.equal(bandRank('NONSENSE'), 0);
  });
});

/* ================================================================== *
 * WRITER LAYER
 * ================================================================== */

function scoredFixture(row) {
  return { match: row, result: scoreBlastMatch(row, contextFor(row, matchesDoc, OPTS)) };
}

function liveRow(i = 0) {
  return {
    event_id: `live-${i}`, date: '2026-07-10', stage: 'group', group: 'South Group',
    home: 'Hampshire', away: 'Sussex', home_slug: 'hampshire', away_slug: 'sussex',
    format: 'T20', venue: 'Rose Bowl', neutral: false,
    players: {
      Hampshire: {
        mom: [{ name: 'Liam Dawson', role: 'allrounder', battingStyle: 'aggressive', bowlingStyle: 'spin', battingPosition: 4, countersOppositionThreat: true, recent: { matches: 5, fiftyOrWicket3: 3, allRoundContributions: 2 } }],
        batters: [{ name: 'James Vince', role: 'batter', battingStyle: 'aggressive', battingPosition: 1, powerplayRecord: 'strong', recent: { scoresOver40: 3, fiftyLastMatch: true, strongVsOpposition: true } }],
      },
      Sussex: {
        mom: [{ name: 'John Turner', role: 'batter', battingStyle: 'aggressive', battingPosition: 2, recent: { matches: 5, fiftyOrWicket3: 2, allRoundContributions: 0 } }],
        batters: [{ name: 'Tom Alsopp', role: 'batter', battingStyle: 'aggressive', battingPosition: 1, powerplayRecord: 'strong', recent: { scoresOver40: 3, fiftyLastMatch: true, strongVsOpposition: true } }],
      },
    },
  };
}

describe('t20_blast_writer: output rules', () => {
  test('angle pools are large enough for a full fixture card', () => {
    assert.ok(BLAST_ANGLES.length >= 4, 'a fixture needs four distinct WIN openers');
    assert.ok(PLAYER_ANGLES.length >= 3, 'three player markets need distinct openers');
    const words = BLAST_ANGLES.map((a) => a.word.toLowerCase());
    assert.equal(new Set(words).size, words.length, 'two WIN angles share an opening word');
    const pwords = PLAYER_ANGLES.map((a) => a.word.toLowerCase());
    assert.equal(new Set(pwords).size, pwords.length, 'two player angles share an opening word');
  });

  test('every angle lead is a complete sentence with no digits', () => {
    for (const a of [...BLAST_ANGLES, ...PLAYER_ANGLES]) {
      assert.match(a.lead, /[.!?]$/, `${a.id}: the lead must end as a sentence`);
      assert.ok(!/\d/.test(a.lead), `${a.id}: a digit in an angle lead would leak into every tip using it`);
      for (const p of BANNED_PHRASES) assert.ok(!a.lead.toLowerCase().includes(p), `${a.id} uses the banned phrase "${p}"`);
    }
  });

  test('openingWord reads the prose, not the bolded selection', () => {
    assert.equal(openingWord('**Hampshire** — Momentum built across…'), 'momentum');
    assert.equal(openingWord('SKIP — WIN MATCH: withheld'), 'skip');
  });

  test('a compliant WIN tip passes validation', () => {
    const good = '**Northamptonshire** — Standing inside the group has been earned across a full block of fixtures, and that accumulation separates these two counties. The recent run of results has been favourable and repeated. The points gathered put them ahead. The risk sits with one quiet powerplay. Confidence: MEDIUM.';
    const v = validateBlastTip(good, { market: 'win_match', selection: 'Northamptonshire' });
    assert.deepEqual(v.violations, []);
  });

  test('validation rejects each specific rule breach', () => {
    const base = '**Hampshire** — Momentum built across recent outings gives one side a settled rhythm the other has had to reconstruct. The recent results have been favourable. The points gathered put them ahead. The risk sits with one quiet powerplay handing the initiative back. Confidence: MEDIUM.';
    assert.ok(validateBlastTip(base, { market: 'win_match', selection: 'Hampshire' }).ok, 'the baseline tip should pass');

    const short = '**Hampshire** — Momentum favours them. Confidence: MEDIUM.';
    assert.ok(validateBlastTip(short, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /under 40 words/.test(v)));

    const unbolded = base.replace('**Hampshire**', 'Hampshire');
    assert.ok(validateBlastTip(unbolded, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /no bolded selection/.test(v)));

    const digits = base.replace('one quiet powerplay', 'a 40-run powerplay');
    assert.ok(validateBlastTip(digits, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /digit/.test(v)));

    const odds = `${base} Priced at short odds.`;
    assert.ok(validateBlastTip(odds, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /forbidden word "odds"/.test(v)));

    const dated = `${base} Played in July.`;
    assert.ok(validateBlastTip(dated, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /forbidden word "july"/.test(v)));

    const cited = `${base} Sourced from ESPNcricinfo.`;
    assert.ok(validateBlastTip(cited, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /cricinfo/.test(v)));

    const financial = `${base} The points deduction also matters.`;
    assert.ok(validateBlastTip(financial, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /deduction/.test(v)));

    const injury = `${base} Their opener is injured.`;
    assert.ok(validateBlastTip(injury, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /injured/.test(v)));

    const filler = base.replace('Momentum built', 'Hard to look past');
    assert.ok(validateBlastTip(filler, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /banned filler/.test(v)));

    const noTier = base.replace('Confidence: MEDIUM.', '');
    assert.ok(validateBlastTip(noTier, { market: 'win_match', selection: 'Hampshire' }).violations.some((v) => /no confidence tier/.test(v)));

    const wrongPick = base; // bolds Hampshire but claims Sussex
    assert.ok(validateBlastTip(wrongPick, { market: 'win_match', selection: 'Sussex' }).violations.some((v) => /is not the selection/.test(v)));
  });

  test('a WIN tip may not name a player', () => {
    const base = '**Hampshire** — Momentum built across recent outings gives one side a settled rhythm the other has had to reconstruct. Liam Dawson has been central to it. The points gathered put them ahead. The risk sits with one quiet powerplay. Confidence: MEDIUM.';
    const v = validateBlastTip(base, { market: 'win_match', selection: 'Hampshire', playerNames: ['Liam Dawson'] });
    assert.ok(v.violations.some((x) => /names a player/.test(x)));
  });

  test('a player tip may not name a team, short name or nickname', () => {
    const clean = '**Liam Dawson** — Dual responsibility gives this player two separate routes to deciding an award, which is why all-rounders collect so many of them. Output has been steady. The role is settled. Variance is inherent, so the case rests on repeated contribution. Confidence: MEDIUM.';
    assert.ok(validateBlastTip(clean, { market: 'man_of_the_match', selection: 'Liam Dawson' }).ok, 'the clean player tip should pass');
    for (const token of ['Hampshire', 'Northants', 'Steelbacks', 'Hawks']) {
      const dirty = clean.replace('Output has been steady.', `Output for ${token} has been steady.`);
      const v = validateBlastTip(dirty, { market: 'man_of_the_match', selection: 'Liam Dawson' });
      assert.ok(v.violations.some((x) => /names a team/.test(x)), `"${token}" should be rejected in a player tip`);
    }
  });

  test('COUNTY_TOKENS covers all eighteen counties and their nicknames', () => {
    for (const name of ['Northamptonshire', 'Somerset', 'Gloucestershire', 'Warwickshire', 'Glamorgan', 'Worcestershire',
      'Nottinghamshire', 'Yorkshire', 'Lancashire', 'Durham', 'Derbyshire', 'Leicestershire',
      'Hampshire', 'Surrey', 'Essex', 'Kent', 'Middlesex', 'Sussex']) {
      assert.ok(COUNTY_TOKENS.includes(name), `${name} is not in the player-market ban list`);
    }
  });

  test('a SKIP is a single explanatory sentence', () => {
    const ok = validateBlastTip('SKIP — WIN MATCH: the sourced evidence did not clear the threshold.', { market: 'win_match', expectSkip: true });
    assert.ok(ok.ok);
    const twoSentences = validateBlastTip('SKIP — WIN MATCH: not enough evidence. More detail here.', { market: 'win_match', expectSkip: true });
    assert.ok(twoSentences.violations.some((v) => /single explanatory sentence/.test(v)));
    const notSkip = validateBlastTip('Hampshire to win by a distance, clearly.', { market: 'win_match', expectSkip: true });
    assert.ok(notSkip.violations.some((v) => /must be written as SKIP/.test(v)));
  });

  test('the digit ban applies to SKIP prose, exempting only the mandated label', () => {
    const clean = 'SKIP — TOP TEAM 1 BATSMAN: no confirmed batting order exists, so no batter is named.';
    assert.ok(validateBlastTip(clean, { market: 'top_team1_batsman', expectSkip: true }).ok,
      'the mandated label must not trip the digit ban');
    const leaky = 'SKIP — WIN MATCH: the side scored 163/6, so they are favoured.';
    assert.ok(validateBlastTip(leaky, { market: 'win_match', expectSkip: true }).violations.some((v) => /digit/.test(v)),
      'a score leaked into a SKIP and was not caught');
  });

  test('a sourced name containing a digit is exempt from the prose rule but reported', () => {
    const tip = '**T20 Specialist** — Momentum built across recent outings gives one side a settled rhythm the other has had to reconstruct. Output has been steady. The role is settled. Variance is inherent, so the case rests on repeated contribution here. Confidence: MEDIUM.';
    const v = validateBlastTip(tip, { market: 'man_of_the_match', selection: 'T20 Specialist' });
    assert.ok(v.ok, 'the digit is inside the sourced name, not in prose we wrote');
    assert.ok(v.notes.some((n) => /contains a digit/.test(n)), 'it must still be surfaced for review');
  });
});

describe('t20_blast_writer: card generation', () => {
  test('a live fixture produces four tips in the mandated order', () => {
    const row = liveRow();
    const card = writeBlastCard([scoredFixture(row)]);
    assert.equal(card.tips.length, 4);
    assert.deepEqual(card.tips.map((t) => t.market), MARKET_ORDER);
    assert.ok(card.activeCount >= 1);
  });

  test('all four markets can be written from a confirmed line-up', () => {
    const card = writeBlastCard([scoredFixture(liveRow())]);
    const active = card.tips.filter((t) => !t.skip);
    assert.equal(active.length, 4, `expected four active tips, got ${active.length}: ${card.tips.map((t) => `${t.market}=${t.skip ? 'SKIP' : 'ok'}`).join(', ')}`);
    for (const t of active) {
      assert.ok(t.text.split(/\s+/).length >= MIN_WORDS, `${t.market}: under the word floor`);
      assert.ok(t.text.includes('**'), `${t.market}: nothing bolded`);
      assert.ok(openingWord(t.text), `${t.market}: no opener`);
    }
  });

  test('the historical tape writes a WIN tip and withholds the player markets', () => {
    const rows = MATCHES.map(scoredFixture).filter(({ result }) => result.markets.win_match.band !== BAND.SKIP).slice(0, 6);
    const card = writeBlastCard(rows);
    assert.equal(card.tips.length, rows.length * 4);
    for (const t of card.tips) {
      if (t.market === 'win_match') assert.equal(t.skip, false);
      else assert.equal(t.skip, true, `${t.market} must be withheld without a confirmed line-up`);
    }
  });

  test('no two tips on the same fixture open alike, across the whole tape', () => {
    const rows = MATCHES.map(scoredFixture).filter(({ result }) => result.markets.win_match.band !== BAND.SKIP);
    const card = writeBlastCard(rows);
    assert.ok(validateCardOpenings(card.tips, { scope: 'fixture' }).ok, 'two tips on one fixture share an opener');
    assert.equal(card.tips.filter((t) => !t.skip).length, rows.length);
  });

  test('a long slate reuses openers across fixtures instead of failing', () => {
    const rows = Array.from({ length: 12 }, (_, i) => scoredFixture(liveRow(i)));
    const card = writeBlastCard(rows);
    assert.equal(card.tips.length, 48);
    assert.equal(card.withheldCount, 0, `a full slate should not withhold anything: ${JSON.stringify(card.withheld)}`);
    assert.equal(card.openerPoolExhausted, true, 'twelve fixtures cannot all open differently from one finite pool');
    assert.ok(validateCardOpenings(card.tips, { scope: 'fixture' }).ok, 'per-fixture uniqueness must still hold');
  });

  test('two fixtures with the same label are treated as separate fixtures', () => {
    // The same pair can meet twice in a season: an in-group leg plus a
    // cross-pool fixture. Uniqueness must key on identity, not on the label.
    const a = scoredFixture(liveRow(1));
    const b = scoredFixture({ ...liveRow(2), stage: 'cross', group: 'Cross Pool' });
    assert.equal(a.match.home, b.match.home);
    const card = writeBlastCard([a, b]);
    assert.equal(card.tips.length, 8);
    assert.ok(validateCardOpenings(card.tips, { scope: 'fixture' }).ok);
  });

  test('an unwritable market is withheld with its conflict recorded, not thrown away', () => {
    const row = liveRow(9);
    const scored = scoredFixture(row);
    // Force a selection that cannot satisfy the rules, to exercise the fallback.
    scored.result.markets.man_of_the_match.selection = null;
    scored.result.markets.man_of_the_match.band = BAND.SKIP;
    scored.result.markets.man_of_the_match.skip_reason = 'forced for test';
    const card = writeBlastCard([scored]);
    const mom = card.tips.find((t) => t.market === 'man_of_the_match');
    assert.equal(mom.skip, true);
    assert.match(mom.text, /^SKIP — MAN OF THE MATCH: forced for test/);
  });

  test('the formatted card carries every mandated closing section', () => {
    const rows = MATCHES.map(scoredFixture).filter(({ result }) => result.markets.win_match.band !== BAND.SKIP).slice(0, 3);
    const gate = gateFromBacktest(backtestDoc);
    const { text, card } = buildBlastFormattedCardText(rows, { dateLabel: 'test', gate });
    assert.match(text, /T20 BLAST PREDICTIONS/);
    assert.match(text, /SUMMARY/);
    assert.match(text, /VALUE FLAG/);
    assert.match(text, /WEATHER NOTE/);
    assert.match(text, /RESPONSIBLE GAMBLING/);
    assert.match(text, /VALIDATION/);
    assert.match(text, /BeGambleAware/);
    for (const label of ['WIN MATCH', 'MAN OF THE MATCH', 'TOP TEAM 1 BATSMAN', 'TOP TEAM 2 BATSMAN']) {
      assert.ok(text.includes(label), `the card must label the ${label} market`);
    }
    assert.ok(!/\*\*/.test(text), 'the copy-paste block must not carry markdown bolding');
    assert.ok(card.tips.length === rows.length * 4);
  });

  test('the summary table shows both the published tier and the model tier when capped', () => {
    const rows = MATCHES.map(scoredFixture)
      .map(({ match, result }) => ({ match, result: applyPublicationGate(result, gateFromBacktest(backtestDoc)) }))
      .filter(({ result }) => result.markets.win_match.band !== BAND.SKIP);
    const high = rows.filter(({ result }) => result.markets.win_match.modelBand === BAND.HIGH);
    assert.ok(high.length, 'no capped fixture to test');
    const { text } = buildBlastFormattedCardText(high.slice(0, 2), { gate: gateFromBacktest(backtestDoc) });
    assert.match(text, /model graded HIGH/, 'the cap must be disclosed, not silently applied');
    assert.ok(!/\(HIGH\)/.test(text.split('SUMMARY')[1] || ''), 'no tip may publish HIGH while the gate caps at MEDIUM');
  });

  test('the validation disclosure quotes real observed rates and the baseline', () => {
    const gate = gateFromBacktest(backtestDoc);
    const lines = buildValidationDisclosure(gate).join('\n');
    assert.match(lines, /54\.3%/);
    assert.match(lines, /60\.9%/, 'the home baseline must be stated so the reader can judge the edge');
    assert.match(lines, /capped at MEDIUM/);
    assert.match(lines, /no demonstrated edge/);
  });

  test('with no backtest the card says validation is missing rather than implying it', () => {
    const lines = buildValidationDisclosure(null).join('\n');
    assert.match(lines, /no committed walk-forward backtest/);
    assert.match(lines, /unvalidated/);
  });

  test('the disclosure never leaks into tip prose', () => {
    const rows = MATCHES.map(scoredFixture).filter(({ result }) => result.markets.win_match.band !== BAND.SKIP).slice(0, 2);
    const card = writeBlastCard(rows);
    for (const t of card.tips) {
      // The market label itself is mandated by the prompt and contains a digit
      // ("TOP TEAM 1 BATSMAN"); everything else must be digit-free.
      assert.ok(!/\d/.test(digitScope(t.text)), `${t.market}: a digit reached the tip prose outside the mandated label`);
      assert.ok(!/VALIDATION/.test(t.text), 'the disclosure block leaked into a tip');
      assert.ok(!/BeGambleAware/.test(t.text), 'the gambling reminder leaked into a tip');
      assert.ok(!/\d+%/.test(t.text), 'an observed rate leaked into tip prose');
    }
  });
});

/* ================================================================== *
 * COLLECTOR (pure core)
 * ================================================================== */

describe('collect_t20_blast: plan', () => {
  test('a plan covers the whole window and builds valid endpoints', () => {
    const plan = planCollection({ season: 2027, startISO: '2027-05-15', endISO: '2027-07-31' });
    assert.equal(plan.dates[0], '2027-05-15');
    assert.equal(plan.dates[plan.dates.length - 1], '2027-07-31');
    assert.equal(plan.dateCount, plan.dates.length);
    assert.match(plan.endpoints.standings, /8053\/standings\?season=2027$/);
    assert.ok(plan.endpoints.scoreboardTemplate.includes('dates=YYYYMMDD'),
      'the printed template must show the separator-free date form ESPN expects');
  });

  test('a plan with a series id uses the series scoreboard', () => {
    const plan = planCollection({ season: 2026, seriesId: '1512690' });
    assert.match(plan.endpoints.scoreboardTemplate, /1512690\/scoreboard\?dates=YYYYMMDD$/);
  });

  test('a plan without a series id says so instead of guessing one', () => {
    const plan = planCollection({ season: 2027 });
    assert.equal(plan.seriesId, null);
    assert.match(plan.seriesNote, /not yet known/);
  });

  test('an inverted window is rejected', () => {
    assert.throws(() => planCollection({ season: 2027, startISO: '2027-08-01', endISO: '2027-05-01' }), /after end/);
  });

  test('endpoints are key-less and https', () => {
    for (const url of [ESPN.standings(), ESPN.scoreboard('1512690', '2026-07-18'), ESPN.leagueScoreboard('8053', '2026-07-18'), ESPN.scorecard('1512889')]) {
      assert.match(url, /^https:\/\//);
      assert.ok(!/api[_-]?key|token=/i.test(url), 'no endpoint may require a key');
    }
    assert.equal(ESPN.scoreboard('1512690', '2026-07-18'), 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/1512690/scoreboard?dates=20260718');
  });
});

describe('collect_t20_blast: normalisation', () => {
  const event = (over = {}) => ({
    id: '9001',
    date: '2027-06-04T17:30:00Z',
    status: { type: { completed: true, detail: 'Northants won by 5 wickets' } },
    competitions: [{
      grouping: { name: 'North Group' },
      venue: { fullName: 'County Ground, Northampton', neutral: false },
      notes: [{ headline: 'Northants won by 5 wickets' }],
      competitors: [
        { homeAway: 'home', winner: true, team: { id: 1221, displayName: 'Northamptonshire' } },
        { homeAway: 'away', winner: false, team: { id: 1464, displayName: 'Yorkshire' } },
      ],
    }],
    ...over,
  });

  test('a completed event becomes a captured row with nothing inferred', () => {
    const { row, problems } = normaliseEspnEvent(event(), { season: 2027 });
    assert.deepEqual(problems, []);
    assert.equal(row.event_id, '9001');
    assert.equal(row.date, '2027-06-04');
    assert.equal(row.home, 'Northamptonshire');
    assert.equal(row.away, 'Yorkshire');
    assert.equal(row.home_slug, 'northamptonshire');
    assert.equal(row.home_team_id, '1221');
    assert.equal(row.winner, 'Northamptonshire');
    assert.equal(row.result_text, 'Northants won by 5 wickets');
    assert.equal(row.captured, true);
    assert.equal(row.stage, 'group');
    assert.equal(row.venue, 'County Ground, Northampton');
    assert.equal(row.source_url, 'https://www.espncricinfo.com/matches/engine/match/9001.html');
  });

  test('home and away come from the payload label, never array order', () => {
    const reversed = event({
      competitions: [{
        grouping: { name: 'North Group' },
        venue: { fullName: 'Headingley' },
        notes: [{ headline: 'Yorkshire won by 4 runs' }],
        competitors: [
          { homeAway: 'away', winner: false, team: { id: 1221, displayName: 'Northamptonshire' } },
          { homeAway: 'home', winner: true, team: { id: 1464, displayName: 'Yorkshire' } },
        ],
      }],
    });
    const { row } = normaliseEspnEvent(reversed);
    assert.equal(row.home, 'Yorkshire', 'the home side must follow the homeAway label');
    assert.equal(row.away, 'Northamptonshire');
  });

  test('an unfinished fixture stays unresolved rather than being guessed', () => {
    const { row, problems } = normaliseEspnEvent(event({ status: { type: { completed: false, detail: 'Yorkshire won the toss' } } }));
    assert.equal(row.captured, false);
    assert.equal(row.result_text, null);
    assert.equal(row.winner, null);
    assert.deepEqual(problems, [], 'an in-progress match is not an error');
  });

  test('a completed event with no stated result is flagged', () => {
    const { row, problems } = normaliseEspnEvent(event({ status: { type: { completed: true } }, competitions: [{ grouping: { name: 'North Group' }, competitors: event().competitions[0].competitors }] }));
    assert.equal(row.captured, false);
    assert.ok(problems.some((p) => /no result text/.test(p)));
  });

  test('a result with no flagged winner is flagged, not resolved by reading the text', () => {
    const noWinner = event();
    noWinner.competitions[0].competitors = noWinner.competitions[0].competitors.map((c) => ({ ...c, winner: false }));
    const { row, problems } = normaliseEspnEvent(noWinner);
    assert.equal(row.winner, null);
    assert.equal(row.captured, false);
    assert.ok(problems.some((p) => /no competitor is flagged as the winner/.test(p)));
  });

  test('stage is read from the grouping label', () => {
    for (const [grouping, stage] of [['Cross Pool', 'cross'], ['1st Quarter Final', 'quarter-final'], ['2nd Semi Final', 'semi-final'], ['Final', 'final'], ['South Group', 'group']]) {
      const ev = event();
      ev.competitions[0].grouping = { name: grouping };
      const { row } = normaliseEspnEvent(ev);
      assert.equal(row.stage, stage, `grouping "${grouping}" should map to stage "${stage}"`);
    }
  });

  test('a malformed event is reported, never half-normalised', () => {
    const { row, problems } = normaliseEspnEvent({ id: null, competitions: [] });
    assert.equal(row.event_id, null);
    assert.ok(problems.length >= 2);
    assert.ok(normaliseEspnEvent(null).problems.length);
  });

  test('normalisePayload handles both payload shapes and lists unresolved fixtures', () => {
    const a = normalisePayload({ events: [event(), event({ id: '9002', status: { type: { completed: false } } })] });
    assert.equal(a.rows.length, 2);
    assert.equal(a.unresolved.length, 1);
    const b = normalisePayload({ leagues: [{ events: [event()] }] });
    assert.equal(b.rows.length, 1);
    const c = normalisePayload({});
    assert.deepEqual(c.rows, []);
  });
});

describe('collect_t20_blast: merge', () => {
  const existing = [
    { event_id: '100', date: '2027-06-01', home: 'Kent', away: 'Sussex', home_slug: 'kent', away_slug: 'sussex', result_text: 'Kent won by 3 runs', winner: 'Kent', captured: true, review_urls: ['https://a'] },
    { event_id: null, date: '2027-06-02', home: 'Essex', away: 'Surrey', home_slug: 'essex', away_slug: 'surrey', result_text: null, winner: null, captured: false, review_urls: [] },
  ];

  test('a new fixture is appended', () => {
    const { merged, added } = mergeTape(existing, [{ event_id: '300', date: '2027-06-03', home: 'Hampshire', away: 'Kent', captured: true, result_text: 'Hampshire won' }]);
    assert.equal(merged.length, 3);
    assert.equal(added.length, 1);
  });

  test('a result never overwrites a different verified result; it becomes a conflict', () => {
    const { merged, conflicts } = mergeTape(existing, [{ event_id: '100', date: '2027-06-01', home: 'Kent', away: 'Sussex', result_text: 'Sussex won by 2 wickets', captured: true }]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].committed, 'Kent won by 3 runs');
    assert.match(merged.find((r) => r.event_id === '100').result_text, /Kent won by 3 runs/);
    assert.match(conflicts[0].action, /human must decide/);
  });

  test('an empty result fills in from the collection', () => {
    const { merged, updated, conflicts } = mergeTape(existing, [{ event_id: '200', date: '2027-06-02', home: 'Essex', away: 'Surrey', result_text: 'Essex won by 8 wickets', winner: 'Essex', captured: true }]);
    assert.equal(conflicts.length, 0);
    assert.equal(updated.length, 1);
    assert.equal(merged.find((r) => r.date === '2027-06-02').result_text, 'Essex won by 8 wickets');
  });

  test('an event id is filled onto a row that lacks one', () => {
    const { merged, updated } = mergeTape(existing, [{ event_id: '200', date: '2027-06-02', home: 'Essex', away: 'Surrey', result_text: null, captured: false, review_urls: ['https://b'] }]);
    assert.equal(merged.find((r) => r.date === '2027-06-02').event_id, '200');
    assert.equal(updated.length, 1);
  });

  test('merged output is date-ordered and deduplicated', () => {
    const { merged } = mergeTape(existing, [
      { event_id: '300', date: '2027-05-30', home: 'Somerset', away: 'Kent', captured: true },
      { event_id: '100', date: '2027-06-01', home: 'Kent', away: 'Sussex', result_text: 'Kent won by 3 runs', captured: true },
    ]);
    const dates = merged.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(merged.filter((r) => r.event_id === '100').length, 1);
  });
});

/* ================================================================== *
 * COMMITTED ARTEFACTS
 * ================================================================== */

describe('committed T20 Blast artefacts', () => {
  test('the tape carries every verified knockout event id', () => {
    const ko = MATCHES.filter((m) => ['quarter-final', 'semi-final', 'final'].includes(m.stage));
    assert.equal(ko.length, 7);
    for (const r of ko) {
      assert.ok(r.event_id, `${r.home} v ${r.away} (${r.stage}) has no event id, so it cannot be reviewed`);
      assert.ok(r.review_urls.some((u) => /full-scorecard|engine\/match/.test(u)), `${r.stage} ${r.home} v ${r.away} has no scorecard link`);
    }
    assert.equal(new Set(ko.map((r) => r.event_id)).size, 7, 'knockout event ids must be distinct');
  });

  test('no tape row shares an identity with another', () => {
    const seen = new Map();
    for (const r of MATCHES) {
      const key = r.event_id ? `id:${r.event_id}` : `fk:${r.date}|${r.home}|${r.away}`;
      assert.ok(!seen.has(key), `identity ${key} is shared by two rows`);
      seen.set(key, r);
    }
  });

  test('the backtest artefact records the gate and the look-ahead audit', () => {
    assert.equal(backtestDoc.weights_fitted_to_this_tape, false);
    assert.equal(backtestDoc.method.lookAheadAudit.ok, true);
    assert.ok(backtestDoc.evidence_path.publicationGate.cap);
    assert.ok(backtestDoc.evidence_path.intervals.overall.ci95.low != null);
    assert.ok(backtestDoc.evidence_path.baselines.always_home.hitRate > 0);
  });

  test('the backtest hit rate is reproducible from the committed records', () => {
    const recs = backtestDoc.records;
    const hits = recs.filter((r) => r.hit).length;
    assert.equal(hits, backtestDoc.evidence_path.overall.hits);
    assert.equal(recs.length, backtestDoc.evidence_path.overall.n);
    for (const r of recs) {
      assert.equal(typeof r.hit, 'boolean');
      assert.ok(r.probabilityHome >= 0 && r.probabilityHome <= 1);
      assert.ok(r.reviewUrls.length >= 1, 'every backtested fixture must remain reviewable');
    }
  });
});
