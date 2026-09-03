/**
 * League-registry verification probes.
 *
 * `scripts/build_league_registry.mjs` proves every candidate league by calling
 * its ESPN scoreboard endpoint, and `tests/dom_smoke.test.mjs` then fails the
 * build if a league the verifier proved dead is still listed in
 * `engine/registry.js`. That chain is only sound if the URL it probes is the URL
 * that actually serves the league.
 *
 * Cricket broke it on 2026-09-03: the Vitality Blast is addressed by numeric
 * series id, and ESPN's own slug for the league is `8053`, so probing
 * `cricket/t20-blast/scoreboard` returned a 404 and recorded a live, verified
 * league as dead. The series-id form was confirmed answering HTTP 200 with
 * `leagues[0].id = "8053"`, name "Twenty20 Cup (England)", abbreviation
 * "Vitality Blast" on 2026-09-03:
 *   https://site.web.api.espn.com/apis/site/v2/sports/cricket/1512690/scoreboard?dates=20260903
 *
 * Importing the script here must not start a network run, which is itself part
 * of what is under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreboardUrl } from '../scripts/build_league_registry.mjs';
import { SPORTS, ESPN_SITE_BASE } from '../engine/registry.js';

const STAMP = '20260903';

test('a text-slug league is probed by its slug', () => {
  const url = scoreboardUrl({ slug: 'eng.1', name: 'English Premier League' }, 'soccer', STAMP);
  assert.equal(url, `${ESPN_SITE_BASE}/soccer/eng.1/scoreboard?dates=${STAMP}`);
});

test('cricket is probed by the series id ESPN actually serves it under', () => {
  const blast = { slug: 't20-blast', name: 'T20 Blast (Vitality Blast, men)', espnSeriesId: '1512690', espnLeagueId: '8053' };
  assert.equal(
    scoreboardUrl(blast, 'cricket', STAMP),
    `${ESPN_SITE_BASE}/cricket/1512690/scoreboard?dates=${STAMP}`,
    'the slug is the site identity; the series id is what ESPN answers on',
  );
});

test('a league id is used when no series id is declared', () => {
  const url = scoreboardUrl({ slug: 'x', espnLeagueId: '8053' }, 'cricket', STAMP);
  assert.equal(url, `${ESPN_SITE_BASE}/cricket/8053/scoreboard?dates=${STAMP}`);
});

test('the date stamp is passed through unchanged', () => {
  // ESPN.scoreboard()-style helpers that rewrite dashes have mangled this before.
  const url = scoreboardUrl({ slug: 'eng.1' }, 'soccer', '20260718');
  assert.match(url, /dates=20260718$/);
  assert.ok(!url.includes('-'), 'no stray dashes reach the dates parameter');
});

test('no cricket candidate in the live registry is probed by a text slug', () => {
  // The regression this file exists for, asserted against the real registry so
  // the next numeric-id sport cannot reintroduce it silently.
  const cricket = SPORTS.find((s) => s.key === 'cricket');
  assert.ok(cricket, 'cricket is in the registry');
  for (const c of cricket.candidateLeagues || []) {
    const segment = scoreboardUrl(c, 'cricket', STAMP).split('/cricket/')[1].split('/')[0];
    assert.notEqual(segment, c.slug, `${c.slug} must not be probed by its text slug`);
    assert.match(segment, /^\d+$/, `cricket segment "${segment}" is a numeric ESPN id`);
  }
});

test('every candidate league in the registry resolves to one probe URL', () => {
  const seen = new Set();
  for (const sport of SPORTS) {
    if (!sport.espnSport) continue;
    for (const c of sport.candidateLeagues || []) {
      const url = scoreboardUrl(c, sport.espnSport, STAMP);
      assert.ok(url.startsWith(`${ESPN_SITE_BASE}/`), `${sport.key}:${c.slug} probes the ESPN site API`);
      assert.ok(url.includes('/scoreboard?dates='), `${sport.key}:${c.slug} probes a scoreboard`);
      assert.ok(!seen.has(url), `${sport.key}:${c.slug} does not duplicate another probe URL`);
      seen.add(url);
    }
  }
  assert.ok(seen.size >= 70, `probed every candidate league, got ${seen.size}`);
});
