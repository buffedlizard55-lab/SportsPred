import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreVolleyballMatch, consensusFavourite, decimalToAmerican, americanToImpliedProb, normaliseOdds, CONFIDENCE, RULESET_VERSION,
} from '../engine/volleyball_engine.js';
import { enrichVolleyballMatch, formFromVolleyballTape, sameTeam } from '../engine/volleyball_data.js';

function completeMatch() {
  return {
    id: 'vnl-test-1', family: 'vnl-women', phase: 'upcoming', dateISO: '2026-06-20', startUtc: '2026-06-20T12:00:00Z', home: 'Türkiye', away: 'Serbia',
    odds: { books: [
      { book: 'Book A', home: { american: -320 }, away: { american: 240 }, source_url: 'https://example.com/a' },
      { book: 'Book B', home: { american: -300 }, away: { american: 230 }, source_url: 'https://example.com/b' },
    ] },
    homeTeam: {
      name: 'Türkiye',
      form: { vnlLast5: ['W', 'W', 'W', 'W', 'L'], vnlLast5SetScores: ['3-0', '3-0', '3-0', '3-1', '1-3'] },
      roster: { status: 'confirmed_full' },
      stakes: { status: 'finals_fight', hostingWeek: true },
      stats: { killsPerSet: 14.1, blocksPerSet: 2.8, aceToErrorRatio: 1.08 },
    },
    awayTeam: {
      name: 'Serbia',
      form: { vnlLast5: ['L', 'W', 'L', 'L', 'W'], vnlLast5SetScores: ['1-3', '3-1', '0-3', '2-3', '3-0'] },
      roster: { status: 'key_absence' },
      stakes: { status: 'comfortably_qualified' },
      stats: { killsPerSet: 12.8, blocksPerSet: 2.0, aceToErrorRatio: 0.88 },
    },
    h2h: { recentMeetings: [
      { winner: 'Türkiye', setScore: '3-0' }, { winner: 'Türkiye', setScore: '3-0' }, { winner: 'Serbia', setScore: '1-3' },
    ] },
  };
}

describe('FIVB VNL Women scoring engine', () => {
  it('keeps the exact MATCH WINNER 25/20/20/15/20 allocation and caps host stakes at 20', () => {
    const result = scoreVolleyballMatch(completeMatch());
    assert.equal(result.ruleset, RULESET_VERSION);
    assert.equal(result.favourite, 'Türkiye');
    assert.equal(result.markets.win_match.score, 100);
    assert.equal(result.markets.win_match.band, CONFIDENCE.HIGH);
    assert.deepEqual(result.markets.win_match.components.map((part) => [part.id, part.max]), [
      ['recent_form', 25], ['head_to_head', 20], ['squad_roster', 20], ['odds_value', 15], ['stakes_motivation', 20],
    ]);
    assert.equal(result.markets.win_match.components.at(-1).points, 20);
  });

  it('scores only one set outcome and requires a meaningful lead for publication', () => {
    const result = scoreVolleyballMatch(completeMatch());
    assert.equal(result.markets.set_score.outcome, '3-0');
    assert.equal(result.markets.set_score.selection, 'Türkiye 3-0');
    assert.equal(result.markets.set_score.band, CONFIDENCE.HIGH);
    assert.equal(result.markets.set_score.components.reduce((sum, part) => sum + part.points, 0), result.markets.set_score.score);
  });

  it('does not turn a one-book line or an OLBG-like vote into a favourite', () => {
    const match = completeMatch();
    match.odds.books = [match.odds.books[0]];
    const result = scoreVolleyballMatch(match);
    assert.equal(result.markets.win_match.band, CONFIDENCE.SKIP);
    assert.equal(result.markets.win_match.selection, null);
    assert.ok(result.flags.includes('NO_TWO_BOOK_FAVOURITE'));
    assert.ok(result.missing.some((item) => /two named bookmakers/i.test(item)));
  });

  it('rejects every non-VNL competition before any score can be produced', () => {
    const match = completeMatch();
    match.family = 'eurovolley-w';
    const result = scoreVolleyballMatch(match);
    assert.equal(result.markets.win_match.band, CONFIDENCE.SKIP);
    assert.ok(result.flags.includes('OUT_OF_SCOPE_COMPETITION'));
  });

  it('never treats a substring as a team match and filters form to VNL Women rows', () => {
    assert.equal(sameTeam('USA', 'US'), false);
    const tape = [
      { family: 'ncaa', phase: 'results', winner: 'Türkiye', home: 'Türkiye', away: 'Serbia', date: '2026-06-01', startUtc: '2026-06-01T10:00:00Z', setScore: '3-0' },
      { family: 'vnl-women', phase: 'results', winner: 'Türkiye', home: 'Türkiye', away: 'Serbia', date: '2026-06-02', startUtc: '2026-06-02T10:00:00Z', setScore: '3-1', source_url: 'https://official.example/match' },
    ];
    const form = formFromVolleyballTape(tape, 'Türkiye', '2026-06-03T10:00:00Z');
    assert.deepEqual(form.last5, ['W']);
    const raw = { ...completeMatch(), homeTeam: { name: 'Türkiye' }, awayTeam: { name: 'Serbia' } };
    const enriched = enrichVolleyballMatch(raw, tape, {});
    assert.deepEqual(enriched.homeTeam.form.vnlLast5, ['W']);
  });
});

describe('odds helpers', () => {
  it('normalizes only valid prices and requires named-book agreement', () => {
    assert.equal(decimalToAmerican(1.5), -200);
    assert.equal(decimalToAmerican(null), null);
    assert.ok(Math.abs(americanToImpliedProb(-300) - 0.75) < 0.01);
    assert.deepEqual(normaliseOdds(1.4), { american: -250, decimal: 1.4 });
    const match = completeMatch();
    assert.equal(consensusFavourite(match).side, 'home');
    match.odds.books[1].home.american = 180;
    match.odds.books[1].away.american = -220;
    assert.equal(consensusFavourite(match).ok, false);
  });
});
