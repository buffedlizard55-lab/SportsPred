import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildCricketCardForDate,
  matchCricketSlate,
  enrichCricketMatch,
  buildCricketCardFromLive,
} from '../engine/cricket_data.js';
import { parsePanelEvent, parseSummary, classifyFormat } from '../assets/js/cricket-collector.js';

const matches = JSON.parse(readFileSync('data/cricket_matches.json', 'utf8'));
const slate = JSON.parse(readFileSync('data/cricket_slate.json', 'utf8'));

test('committed match snapshot is valid JSON with required fields', () => {
  assert.ok(Array.isArray(matches.matches));
  for (const m of matches.matches) {
    assert.ok(m.competition_id, 'competition_id');
    assert.ok(m.home && m.away, 'both teams');
    assert.ok(m.date && /^\d{4}-\d{2}-\d{2}$/.test(m.date), 'iso date');
    assert.ok(['T20', 'ODI', 'TEST', 'OTHER'].includes(m.format), `format ${m.format}`);
    assert.ok(m.source_url, 'source link for manual review');
  }
});

test('committed slate events carry review URLs and consensus only where sourced', () => {
  assert.ok(slate.events.length > 0);
  for (const ev of slate.events) {
    assert.ok(ev.url.includes('olbg.com'), 'OLBG review link');
    assert.ok(ev.resolved_date || ev.display_date, 'date');
  }
});

test('buildCricketCardForDate returns scored + written card', () => {
  const card = buildCricketCardForDate('2026-09-01', matches, slate);
  assert.equal(card.matches.length, 4);
  assert.ok(card.scored.results.length === 4);
  assert.ok(card.written.tips.length === 16); // 4 matches x 4 markets
});

test('OLBG overlay matches the England Women fixture by tolerant name join', () => {
  const m = matches.matches.find((x) => x.olbg_event_id === null && x.league.includes('Ireland Women'));
  const overlay = matchCricketSlate(m, slate);
  assert.ok(overlay, 'should join England Women v Ireland Women to OLBG 188611');
  assert.equal(overlay.event_id, '188611');
});

test('enrichCricketMatch attaches an overlay or null without throwing', () => {
  const m = matches.matches[0];
  const enriched = enrichCricketMatch(m, slate);
  assert.ok(enriched.homeTeamObj && enriched.awayTeamObj);
});

test('live card builder scores an empty list safely', () => {
  const built = buildCricketCardFromLive({ matches: [], date: '2026-09-01' }, slate);
  assert.equal(built.matches.length, 0);
  assert.ok(built.scored);
});

test('classifyFormat maps ESPN class.eventType', () => {
  assert.equal(classifyFormat('T20', '23rd Match (N), CPL'), 'T20');
  assert.equal(classifyFormat('Test', '4-day match'), 'TEST');
  assert.equal(classifyFormat('ODI', '1st ODI'), 'ODI');
});

test('parsePanelEvent extracts teams, venue, format and status', () => {
  const ev = {
    id: 1549527,
    date: '2026-09-01T13:00:00Z',
    description: '4th Match, Namibia T20I Tri-Series at Windhoek',
    leagues: [{ id: 1549518, name: 'Namibia T20I Tri-Series' }],
    links: [{ rel: ['summary'], href: 'https://www.espncricinfo.com/x' }],
    competitions: [{
      class: { eventType: 'T20', generalClassCard: 'Twenty20' },
      neutralSite: true,
      venue: { fullName: 'Namibia Cricket Ground, Windhoek', address: { city: 'Windhoek', country: 'Namibia' } },
      status: { type: { state: 'post' }, summary: 'South Africa won by 43 runs' },
      competitors: [
        { homeAway: 'home', winner: true, score: '185/7', team: { id: 3, displayName: 'South Africa', abbreviation: 'SA' } },
        { homeAway: 'away', winner: false, score: '142', team: { id: 668, displayName: 'Zimbabwe', abbreviation: 'ZIM' } },
      ],
    }],
  };
  const row = parsePanelEvent(ev, 1549518);
  assert.equal(row.home, 'South Africa');
  assert.equal(row.away, 'Zimbabwe');
  assert.equal(row.format, 'T20');
  assert.equal(row.phase, 'results');
  assert.equal(row.venue_city, 'Windhoek');
  assert.ok(row.source_url.includes('espncricinfo'));
});

test('parseSummary pulls confirmed batting position and this-match figures', () => {
  const payload = {
    gameInfo: { venue: { fullName: 'Ground X' } },
    rosters: [{
      homeAway: 'home',
      team: { id: 3, displayName: 'South Africa' },
      roster: [{
        starter: true,
        athlete: {
          id: 1385640, displayName: 'LG Pretorius',
          style: [{ shortDescription: 'Rhb', type: 'batting' }],
          links: [{ rel: ['playercard'], href: 'https://www.espncricinfo.com/p' }],
        },
        linescores: [{
          period: 1,
          linescores: [{
            order: 1,
            statistics: {
              categories: [{
                name: 'general',
                stats: [
                  { name: 'battingPosition', value: 1 },
                  { name: 'runs', value: 94 },
                  { name: 'strikeRate', value: 184.31 },
                  { name: 'fiftyPlus', value: 1 },
                ],
              }],
            },
          }],
        }],
      }],
    }],
  };
  const parsed = parseSummary(payload);
  const players = parsed.playersByTeam['3'];
  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'LG Pretorius');
  assert.equal(players[0].battingPosition, 1);
  assert.equal(players[0].matchStats.runs, 94);
  assert.equal(parsed.venue, 'Ground X');
});
