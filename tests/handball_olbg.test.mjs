import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchHandballSlate, enrichHandballMatch, buildHandballCardForDate } from '../engine/handball_data.js';

describe('Handball OLBG & Data Pipeline', () => {
  const slateDoc = {
    events: [
      {
        event_id: '11396',
        home: 'Aalborg Handbold',
        away: 'Fredericia HK',
        consensus: { market: 'Money Line', selection: 'Aalborg Handbold' },
        markets_on_event_page: ['Money Line', 'Match Handicap', 'Points Total'],
        handicap_lines: ['Aalborg Handbold -6.50', 'Fredericia HK +6.50'],
        total_lines: ['Over 61.50', 'Under 61.50'],
      },
    ],
  };

  const teamsDoc = {
    teams: {
      'Aalborg Handbold': {
        name: 'Aalborg Handbold',
        standings: { rank: 1 },
        form: { last5: ['W', 'W', 'W', 'W', 'W'], winsLast5: 5 },
        odds: { american: -400, decimal: 1.25 },
        stats: { goalsPerGame: 33.0, goalsConcededPerGame: 26.0 },
      },
      'Fredericia HK': {
        name: 'Fredericia HK',
        standings: { rank: 4 },
        form: { last5: ['L', 'W', 'W', 'L', 'L'], winsLast5: 2 },
        odds: { american: 350, decimal: 4.50 },
        stats: { goalsPerGame: 29.0, goalsConcededPerGame: 30.0 },
      },
    },
  };

  const match = {
    competition_id: 'hb-1',
    date: '2026-09-02',
    home: 'Aalborg Handbold',
    away: 'Fredericia HK',
    handicapSpread: 6.5,
    gameTotal: 61.5,
  };

  it('matches OLBG slate correctly by team names', () => {
    const matched = matchHandballSlate(match, slateDoc);
    assert.ok(matched);
    assert.equal(matched.event_id, '11396');
  });

  it('enriches match with team objects and overlay', () => {
    const enriched = enrichHandballMatch(match, teamsDoc, slateDoc);
    assert.equal(enriched.homeTeamObj.name, 'Aalborg Handbold');
    assert.equal(enriched.awayTeamObj.name, 'Fredericia HK');
    assert.equal(enriched.olbg.event_id, '11396');
  });

  it('buildHandballCardForDate builds complete card with scored results and written tips', () => {
    const matchesDoc = { matches: [match] };
    const card = buildHandballCardForDate('2026-09-02', matchesDoc, teamsDoc, slateDoc);
    assert.equal(card.date, '2026-09-02');
    assert.equal(card.scored.results.length, 1);
    assert.equal(card.written.tips.length, 3);
    assert.ok(card.formattedText.includes('Handball Predictions — 2026-09-02'));
  });
});
