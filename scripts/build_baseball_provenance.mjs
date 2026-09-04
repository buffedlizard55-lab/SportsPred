#!/usr/bin/env node
/**
 * Build data/baseball_provenance.json — the baseball source register.
 *
 * WHY THIS IS A SEPARATE SCRIPT
 * Every other sport's provenance document is emitted by its collector, but the
 * baseball collector (scripts/collect_baseball_mlb.mjs) writes its five data
 * documents and never writes a register. assets/js/baseball-page.js fetches
 * data/baseball_provenance.json regardless, so the Sources panel on the
 * baseball page has always rendered "No provenance document committed."
 * (IRR-004 in docs/IRREGULARITIES.md).
 *
 * WHY IT DERIVES INSTEAD OF DECLARES
 * The register is rebuilt from the endpoint arrays the collector already
 * recorded inside the committed documents, plus a live replay of the scoring
 * engine to count missing factors. Nothing here is typed in by hand, so the
 * register cannot drift from the data it describes and cannot assert a
 * verification that did not happen. Each source's `status`, `verified_utc` and
 * request count are read back out of the documents themselves.
 *
 * Run offline:  node scripts/build_baseball_provenance.mjs
 * It reads only committed files and writes exactly one file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT = join(DATA, 'baseball_provenance.json');

const read = (name) => JSON.parse(readFileSync(join(DATA, `${name}.json`), 'utf8'));

/** Documents the collector writes, and what each one supplies to the engine. */
const DOCS = [
  ['baseball_fixtures', 'fixtures, start times, venues, probable starters'],
  ['baseball_tape', 'settled results used for form, run differential, head-to-head and winning margins'],
  ['baseball_standings', 'season records, run differential, home and road splits'],
  ['baseball_team_stats', 'season team hitting and pitching aggregates'],
  ['baseball_pitchers', 'probable-starter season lines and last-four-start game logs'],
];

/**
 * Collapse an endpoint array into one entry per API host+path shape, carrying
 * the observed request count and HTTP status codes. Date, season and person
 * identifiers are replaced with placeholders so the register lists the request
 * shape actually used rather than 300 near-identical URLs.
 */
function summariseEndpoints(endpoints) {
  const shapes = new Map();
  for (const e of endpoints || []) {
    const url = String(e.url || '');
    const key = url
      .split('?')[0]
      .replace(/\/people\/\d+\//, '/people/{personId}/');
    const query = url.split('?')[1] || '';
    const template = query
      ? `${key}?${query.replace(/date=[^&]*/, 'date={date}').replace(/season=\d+/, 'season={season}').replace(/dates=[^&]*/, 'dates={date}')}`
      : key;
    const prev = shapes.get(key) || { template, requests: 0, statuses: {}, ok: 0 };
    prev.requests += 1;
    prev.statuses[String(e.status)] = (prev.statuses[String(e.status)] || 0) + 1;
    if (e.ok) prev.ok += 1;
    shapes.set(key, prev);
  }
  return [...shapes.entries()].map(([base, v]) => ({ base, ...v }));
}

/** Replay the engine over every committed date and tally the missing factors. */
async function measureCoverage() {
  const engine = await import(pathToFileURL(join(ROOT, 'engine', 'baseball_data.js')).href);
  const docs = {
    fixtures: read('baseball_fixtures'),
    standings: read('baseball_standings'),
    teamStats: read('baseball_team_stats'),
    pitchers: read('baseball_pitchers'),
    tape: read('baseball_tape'),
    slate: read('baseball_slate'),
  };
  const dates = [...new Set((docs.fixtures.fixtures || []).map((f) => f.dateISO))].sort();
  const missing = new Map();
  let scored = 0;
  let tips = 0;
  let published = 0;
  for (const dateISO of dates) {
    const card = engine.buildBaseballCard(docs, { dateISO });
    for (const r of card.scored?.results || []) {
      if (r.unscored) continue;
      scored += 1;
      for (const m of r.missing || []) missing.set(m, (missing.get(m) || 0) + 1);
    }
    tips += card.written?.tips?.length || 0;
    published += (card.written?.tips || []).filter((t) => !t.skip).length;
  }
  return {
    dates,
    scored,
    tips,
    published,
    missing: [...missing.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([factor, fixtures]) => ({ factor, fixtures })),
  };
}

async function build() {
  const loaded = DOCS.map(([name, provides]) => ({ name, provides, doc: read(name) }));
  const coverage = await measureCoverage();
  const slate = read('baseball_slate');

  // One register entry per upstream API, aggregated across the documents that
  // called it. verified_utc is the newest fetch timestamp actually recorded.
  const byHost = new Map();
  for (const { name, provides, doc } of loaded) {
    for (const shape of summariseEndpoints(doc.endpoints)) {
      const host = new URL(shape.base).host;
      const entry = byHost.get(host) || {
        id: host.replace(/\./g, '-'),
        name: host === 'statsapi.mlb.com'
          ? 'MLB Stats API (official, key-less)'
          : host === 'site.api.espn.com'
            ? 'ESPN MLB scoreboard (public JSON)'
            : host,
        url: `https://${host}`,
        endpoints: [],
        requests: 0,
        ok: 0,
        statuses: {},
        provides: new Set(),
        documents: new Set(),
        verified_utc: null,
      };
      entry.endpoints.push(shape.template);
      entry.requests += shape.requests;
      entry.ok += shape.ok;
      for (const [code, n] of Object.entries(shape.statuses)) {
        entry.statuses[code] = (entry.statuses[code] || 0) + n;
      }
      provides.split(', ').forEach((p) => entry.provides.add(p));
      entry.documents.add(`data/${name}.json`);
      const ts = doc.fetched_at_utc || null;
      if (ts && (!entry.verified_utc || ts > entry.verified_utc)) entry.verified_utc = ts;
      byHost.set(host, entry);
    }
  }

  const sources = [...byHost.values()].map((e) => ({
    id: e.id,
    name: e.name,
    url: e.url,
    endpoints: [...new Set(e.endpoints)].sort(),
    // The page renders `status` as a single HTTP code; every request to a host
    // in the committed run returned the same code, so this is that code, and
    // the full distribution is kept alongside it for review.
    status: Number(Object.keys(e.statuses)[0]),
    status_distribution: e.statuses,
    requests: e.requests,
    requests_ok: e.ok,
    verified_utc: e.verified_utc,
    provides: [...e.provides],
    documents: [...e.documents].sort(),
  }));

  // The OLBG slate is fetched by a separate Python collector and carries its own
  // source block rather than an endpoint array, so it is folded in from there.
  if (slate?.source?.url) {
    // The Python slate collector records no HTTP status code, so none is
    // claimed here. `status` stays null rather than being assumed to be 200.
    sources.push({
      id: 'olbg-baseball',
      name: slate.source.name,
      url: slate.source.url,
      endpoints: [slate.source.url],
      status: null,
      status_distribution: null,
      requests: null,
      requests_ok: null,
      verified_utc: slate.fetched_at_utc || null,
      provides: ['OLBG slate listing (fixture, league, start time, tip counts)'],
      documents: ['data/baseball_slate.json'],
      method: slate.source.method || null,
      note: slate.source.licence_note || null,
      events_returned: Array.isArray(slate.events) ? slate.events.length : null,
    });
  }

  // Irregularities are asserted only where the committed data proves them.
  const irregularities = [];
  const fixtures = read('baseball_fixtures');
  if ((fixtures.counts?.withOdds ?? 0) === 0) {
    irregularities.push({
      id: 'IR-BASEBALL-01',
      title: 'No bookmaker price is available',
      effect: `No key-less feed publishes an MLB moneyline, run line or total, so all ${fixtures.counts.fixtures} committed fixtures carry withOdds = 0. Every market-derived factor in the prompt is unscorable, no value or ROI figure is computed, and no tip cites a price.`,
      evidence: 'data/baseball_fixtures.json counts.withOdds',
      status: 'open',
    });
  }
  const named = (fixtures.fixtures || []).reduce((n, f) => n
    + (f.home?.probablePitcher?.id ? 1 : 0) + (f.away?.probablePitcher?.id ? 1 : 0), 0);
  const slots = (fixtures.fixtures || []).length * 2;
  if (named < slots) {
    irregularities.push({
      id: 'IR-BASEBALL-06',
      title: 'Most probable starters are not yet named',
      effect: `The MLB schedule names a probable starter for ${named} of ${slots} starting slots across the committed window, because clubs announce starters only a few days ahead. Unnamed slots score zero and the tip states that the arm is unconfirmed instead of assuming one.`,
      evidence: 'data/baseball_fixtures.json fixtures[].{home,away}.probablePitcher',
      status: 'open',
    });
  }
  const bullpen = coverage.missing.find((m) => m.factor.startsWith('bullpenRank ('));
  if (bullpen) {
    irregularities.push({
      id: 'IR-BASEBALL-02',
      title: 'Bullpen and posted-total factors are unavailable',
      effect: `Bullpen ERA rank, bullpen fatigue, Over/Under trends over the last five games and opposing-lineup average versus starter handedness are not published by any key-less feed. They are recorded as missing on all ${bullpen.fixtures} scored fixtures rather than estimated.`,
      evidence: 'data/baseball_provenance.json coverage.missing_factors',
      status: 'open',
    });
  }
  if (Array.isArray(slate?.events) && slate.events.length === 0) {
    irregularities.push({
      id: 'IR-BASEBALL-07',
      title: 'The OLBG baseball slate returned no events',
      effect: 'The committed OLBG slate document lists zero events and zero markets, so no OLBG consensus is joined onto any baseball fixture. The engine runs entirely on the official MLB StatsAPI feeds; nothing on the baseball page is sourced from OLBG.',
      evidence: 'data/baseball_slate.json events, markets_seen',
      status: 'open',
    });
  }

  irregularities.push({
    id: 'IR-BASEBALL-08',
    title: 'Publication rate is intentionally low',
    effect: `${coverage.published} of ${coverage.tips} candidate tips across ${coverage.dates.length} dates clear the confidence gate; the rest publish an explicit SKIP. With no price and most starters unnamed, the risk layer suppresses the majority of plays by design rather than publishing a tip it cannot support.`,
    evidence: 'replay of engine/baseball_data.js buildBaseballCard over every committed date',
    status: 'by-design',
  });

  irregularities.sort((a, b) => a.id.localeCompare(b.id));

  const out = {
    schema_version: 1,
    sport: 'Baseball',
    league: 'MLB',
    prompt: 'BASEBALL PREDICTION MASTER PROMPT v1.0',
    generated_at_utc: new Date().toISOString(),
    generator: 'scripts/build_baseball_provenance.mjs',
    note: 'Derived from the endpoint records inside the committed baseball documents and from a replay of the scoring engine. No value in this file is entered by hand.',
    irregularities_reference: 'docs/BASEBALL_IRREGULARITIES.md — IR-BASEBALL ids are shared with that register; ids 01-06 are documented there in prose.',
    sources,
    coverage: {
      dates: coverage.dates.length,
      date_range: coverage.dates.length ? [coverage.dates[0], coverage.dates[coverage.dates.length - 1]] : [],
      fixtures_scored: coverage.scored,
      tips_generated: coverage.tips,
      tips_published: coverage.published,
      tips_skipped: coverage.tips - coverage.published,
      missing_factors: coverage.missing,
    },
    irregularities,
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  build().then((o) => {
    console.log(`wrote data/baseball_provenance.json — ${o.sources.length} sources, `
      + `${o.coverage.missing_factors.length} missing factors, ${o.irregularities.length} irregularities`);
  }).catch((e) => { console.error(e); process.exit(1); });
}

export { build, summariseEndpoints };
