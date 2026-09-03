#!/usr/bin/env node
/**
 * SportsPred — T20 Blast forward collector.
 *
 * Purpose
 * -------
 * The committed 2026 tape in data/t20_blast_matches.json was read from
 * ESPNcricinfo's group points tables, which itemise only each county's ten
 * in-group fixtures. That is why the tape holds 88 of 90 in-group matches, 1 of
 * 18 cross-pool fixtures, and 2 absent Derbyshire home fixtures. This script
 * exists to close those gaps and to keep the tape current for the next season,
 * by walking the ESPN league calendar instead — which labels cross-pool
 * fixtures explicitly and carries an event id for every one.
 *
 * Everything here is free and key-less. No endpoint requires authentication.
 *
 * Design note: why the core is pure
 * ---------------------------------
 * The network walk cannot run in CI or in a sandbox without egress, and a
 * collector that can only be tested against a live API is a collector nobody
 * can verify. So the parts that decide *what to fetch* and *how to normalise
 * what came back* are exported pure functions with no I/O, and they are covered
 * by tests/t20_blast_collect.test.mjs. Only `fetchJson` touches the network.
 *
 * Usage
 * -----
 *   node scripts/collect_t20_blast.mjs --dry-run          # plan only, no network
 *   node scripts/collect_t20_blast.mjs --plan --season 2027
 *   node scripts/collect_t20_blast.mjs --from-payload f.json   # normalise a saved payload
 *   node scripts/collect_t20_blast.mjs                    # walk the calendar (needs egress)
 *
 * `--from-payload` is the offline path: save the scoreboard JSON for a date with
 * any tool that has network access, then normalise and merge it here. Nothing is
 * ever invented — a fixture with no result in the payload stays result-less and
 * is reported as unresolved rather than guessed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPETITION = join(ROOT, 'data', 't20_blast_competition.json');
const MATCHES = join(ROOT, 'data', 't20_blast_matches.json');
const PROVENANCE = join(ROOT, 'data', 't20_blast_provenance.json');

/* ------------------------------------------------------------------ *
 * Endpoints. Verified working on 2026-09-03.
 * ------------------------------------------------------------------ */

export const ESPN = {
  /** Structured standings for the league. `season` is the four-digit year. */
  standings: (leagueId = '8053', season = 2026) =>
    `https://site.web.api.espn.com/apis/v2/sports/cricket/${leagueId}/standings?season=${season}`,
  /**
   * Per-date scoreboard for one series. Returns events with ids, teams, venue,
   * status and — once a match is complete — the result and score. This is the
   * endpoint that labels cross-pool fixtures, which the points tables do not.
   */
  scoreboard: (seriesId = '1512690', dateISO = '') =>
    `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard?dates=${dateISO.replace(/-/g, '')}`,
  /** Whole-league scoreboard, used to discover which dates carry fixtures. */
  leagueScoreboard: (leagueId = '8053', dateISO = '') =>
    `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${leagueId}/scoreboard?dates=${dateISO.replace(/-/g, '')}`,
  /** Human-reviewable scorecard for one event. */
  scorecard: (eventId) => `https://www.espncricinfo.com/matches/engine/match/${eventId}.html`,
};

/**
 * Build the list of dates to walk for a season.
 *
 * The Blast runs from late May to mid July. Rather than hard-code a window and
 * risk missing a rescheduled fixture, the plan covers a generous window and the
 * walk records which dates returned nothing. Empty dates cost one request each
 * and prove the absence of fixtures, which is better than assuming a window.
 */
export function planCollection({ season = 2027, seriesId = null, leagueId = '8053', startISO = null, endISO = null } = {}) {
  const start = startISO || `${season}-05-15`;
  const end = endISO || `${season}-07-31`;
  if (start > end) throw new Error(`planCollection: start ${start} is after end ${end}`);
  const dates = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    season,
    leagueId,
    seriesId,
    seriesNote: seriesId
      ? 'series id supplied; the scoreboard is queried per series'
      : 'series id not yet known for this season — resolve it from the league scoreboard, then re-plan. The 2026 series id was 1512690.',
    dates,
    dateCount: dates.length,
    requests: {
      perDate: seriesId ? 1 : 1,
      total: dates.length,
      standings: 1,
    },
    endpoints: {
      standings: ESPN.standings(leagueId, season),
      // Printed with the placeholder intact. ESPN wants the date as YYYYMMDD
      // with no separators, which is easy to get wrong by hand.
      scoreboardTemplate: seriesId
        ? `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard?dates=YYYYMMDD`
        : `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${leagueId}/scoreboard?dates=YYYYMMDD`,
    },
  };
}

/**
 * Normalise one ESPN scoreboard event into a tape row.
 *
 * Returns `{ row, problems }`. A row is only marked `captured: true` when the
 * payload actually states a result; otherwise `result_text` stays null and the
 * fixture is listed as unresolved. No field is inferred from another.
 */
export function normaliseEspnEvent(event, { season = 2027, defaultStage = 'group' } = {}) {
  const problems = [];
  if (!event || typeof event !== 'object') return { row: null, problems: ['event payload is not an object'] };

  const id = event.id != null ? String(event.id) : null;
  if (!id) problems.push('event has no id');

  const comps = event.competitions?.[0] || {};
  const competitors = comps.competitors || [];
  // ESPN marks home/away explicitly; never infer it from array order.
  const home = competitors.find((c) => c.homeAway === 'home') || null;
  const away = competitors.find((c) => c.homeAway === 'away') || null;
  if (!home || !away) problems.push(`event ${id}: home/away not both labelled in the payload`);

  const nameOf = (c) => c?.team?.displayName || c?.team?.name || null;
  const idOf = (c) => (c?.team?.id != null ? String(c.team.id) : null);
  const slugOf = (n) => (n ? String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-') : null);

  const dateISO = (event.date || comps.date || '').slice(0, 10) || null;
  if (!dateISO) problems.push(`event ${id}: no date in the payload`);
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) problems.push(`event ${id}: unparseable date "${event.date}"`);

  // Result. Only taken from what the payload states.
  const completed = event.status?.type?.completed === true;
  let resultText = null;
  let winnerSlug = null;
  let winnerName = null;
  if (completed) {
    // ESPN puts the summary string in notes or in the status detail depending on
    // the payload version; both are read, neither is constructed.
    const notes = Array.isArray(comps.notes) ? comps.notes.map((n) => n?.headline).filter(Boolean) : [];
    resultText = notes[0] || event.status?.type?.detail || comps.status?.type?.detail || null;
    const winnerSide = competitors.find((c) => c.winner === true) || null;
    if (winnerSide) {
      winnerName = nameOf(winnerSide);
      winnerSlug = slugOf(winnerName);
    } else if (resultText) {
      problems.push(`event ${id}: a result string is present but no competitor is flagged as the winner`);
    }
    if (!resultText) problems.push(`event ${id}: marked completed but no result text was stated`);
  }

  const venueName = comps.venue?.fullName || null;
  const neutral = comps.venue?.neutral === true || comps.neutralVenue === true || false;
  const grouping = comps.grouping?.name || comps.group?.name || event.season?.slug || null;
  // Order matters: "1st Quarter Final" and "2nd Semi Final" both contain the
  // word "final", so testing for the final first mislabels every knockout
  // round as the final. Narrowest label wins.
  const g = grouping || '';
  const stage = /quarter/i.test(g) ? 'quarter-final'
    : /semi/i.test(g) ? 'semi-final'
    : /\bfinal\b/i.test(g) ? 'final'
    : /cross/i.test(g) ? 'cross'
    : defaultStage;

  const homeName = nameOf(home);
  const awayName = nameOf(away);
  const row = {
    event_id: id,
    date: dateISO,
    stage,
    group: grouping || (stage === 'group' ? null : stage),
    home: homeName,
    away: awayName,
    home_slug: slugOf(homeName),
    away_slug: slugOf(awayName),
    home_team_id: idOf(home),
    away_team_id: idOf(away),
    format: 'T20',
    venue: venueName,
    neutral,
    result_text: resultText,
    winner: winnerName,
    winner_slug: winnerSlug,
    completed,
    source_url: id ? ESPN.scorecard(id) : null,
    review_urls: [id ? ESPN.scorecard(id) : null].filter(Boolean),
    source_note: 'Normalised from the ESPN scoreboard payload by scripts/collect_t20_blast.mjs. Every field is taken from the payload; nothing is inferred from array order or from another field.',
    captured: completed && !!resultText && !!winnerSlug,
    provenance: { collector: 'collect_t20_blast', season, collected_at_utc: new Date().toISOString() },
  };

  if (!homeName || !awayName) problems.push(`event ${id}: a team name is missing`);
  return { row, problems };
}

/** Normalise a whole scoreboard payload. */
export function normalisePayload(payload, opts = {}) {
  const events = payload?.events || payload?.leagues?.[0]?.events || [];
  const rows = [];
  const problems = [];
  for (const ev of Array.isArray(events) ? events : []) {
    const { row, problems: p } = normaliseEspnEvent(ev, opts);
    problems.push(...p);
    if (row) rows.push(row);
  }
  return {
    rows,
    problems,
    unresolved: rows.filter((r) => !r.captured).map((r) => `${r.date} ${r.home} v ${r.away} (event ${r.event_id})`),
  };
}

/**
 * Merge collected rows into the committed tape.
 *
 * Rules, in order of priority:
 *   1. a collected row never overwrites a verified result with an empty one;
 *   2. an existing row is only replaced when the collected row carries a result
 *      and the existing one does not, or when the result text differs — and a
 *      differing result is reported as a conflict, never silently resolved;
 *   3. event id is the join key, falling back to date + both team names.
 */
export function mergeTape(existingRows, collectedRows) {
  const byId = new Map();
  const byFixture = new Map();
  for (const r of existingRows || []) {
    if (r.event_id) byId.set(String(r.event_id), r);
    byFixture.set(`${r.date}|${r.home}|${r.away}`, r);
  }
  const merged = [...(existingRows || [])];
  const added = [];
  const updated = [];
  const conflicts = [];

  for (const c of collectedRows || []) {
    const key = c.event_id ? String(c.event_id) : null;
    const fixtureKey = `${c.date}|${c.home}|${c.away}`;
    const idx = merged.findIndex((r) => (key && String(r.event_id) === key) || r.date === c.date && r.home === c.home && r.away === c.away);
    if (idx === -1) {
      merged.push(c);
      added.push(fixtureKey);
      if (key) byId.set(key, c);
      byFixture.set(fixtureKey, c);
      continue;
    }
    const old = merged[idx];
    if (old.result_text && c.result_text && old.result_text !== c.result_text) {
      conflicts.push({
        fixture: fixtureKey,
        event_id: old.event_id || c.event_id,
        committed: old.result_text,
        collected: c.result_text,
        action: 'left as committed; a human must decide which source is right',
        review_urls: [...new Set([...(old.review_urls || []), ...(c.review_urls || [])])],
      });
      continue;
    }
    if (!old.result_text && c.result_text) {
      merged[idx] = { ...old, ...c, source_note: `${old.source_note || ''} Result filled from the ESPN scoreboard by scripts/collect_t20_blast.mjs.`.trim() };
      updated.push(fixtureKey);
    } else if (!old.event_id && c.event_id) {
      merged[idx] = { ...old, event_id: c.event_id, review_urls: [...new Set([...(old.review_urls || []), ...(c.review_urls || [])])] };
      updated.push(`${fixtureKey} (event id only)`);
    }
  }

  merged.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.home).localeCompare(String(b.home)));
  return { merged, added, updated, conflicts };
}

/* ------------------------------------------------------------------ *
 * The only function that touches the network.
 * ------------------------------------------------------------------ */

export async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function walkCalendar(plan, { onProgress = null, maxEmptyStreak = 14 } = {}) {
  const rows = [];
  const problems = [];
  const emptyDates = [];
  let emptyStreak = 0;

  for (const [i, date] of plan.dates.entries()) {
    const url = plan.seriesId ? ESPN.scoreboard(plan.seriesId, date) : ESPN.leagueScoreboard(plan.leagueId, date);
    let payload;
    try {
      payload = await fetchJson(url);
    } catch (e) {
      problems.push(`${date}: fetch failed — ${e.message}`);
      emptyStreak += 1;
      if (emptyStreak >= maxEmptyStreak) { problems.push(`stopping after ${maxEmptyStreak} consecutive empty or failed dates`); break; }
      continue;
    }
    const norm = normalisePayload(payload, { season: plan.season });
    problems.push(...norm.problems.map((p) => `${date}: ${p}`));
    if (!norm.rows.length) {
      emptyDates.push(date);
      emptyStreak += 1;
      if (emptyStreak >= maxEmptyStreak) break;
    } else {
      emptyStreak = 0;
      rows.push(...norm.rows);
    }
    if (onProgress) onProgress({ date, index: i, total: plan.dates.length, rowsSoFar: rows.length });
  }
  return { rows, problems, emptyDates, datesWalked: plan.dates.length };
}

/* ------------------------------------------------------------------ */

function readIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const has = (flag) => argv.includes(flag);

  const comp = readIfExists(COMPETITION);
  const tape = readIfExists(MATCHES);
  const prov = readIfExists(PROVENANCE);
  const season = Number(get('--season') || (Number(new Date().getFullYear()) + 1));
  const seriesId = get('--series') || (season === 2026 ? '1512690' : null);
  const leagueId = get('--league') || '8053';

  const plan = planCollection({
    season,
    seriesId,
    leagueId,
    startISO: get('--from'),
    endISO: get('--to'),
  });

  if (has('--dry-run') || has('--plan')) {
    console.log(`T20 BLAST COLLECTION PLAN — season ${plan.season}`);
    console.log(`league ${plan.leagueId}${plan.seriesId ? ` · series ${plan.seriesId}` : ''}`);
    console.log(plan.seriesNote);
    console.log(`\ndates to walk: ${plan.dateCount} (${plan.dates[0]} → ${plan.dates[plan.dateCount - 1]})`);
    console.log(`requests: ${plan.requests.total} scoreboard + ${plan.requests.standings} standings`);
    console.log(`standings endpoint: ${plan.endpoints.standings}`);
    console.log(`scoreboard template: ${plan.endpoints.scoreboardTemplate}`);
    if (tape) {
      const unresolved = prov?.cross_pool_known_ids;
      console.log(`\ncommitted tape: ${tape.matches.length} rows (${tape.counts?.in_group_captured ?? '?'}/${tape.counts?.in_group_total ?? 90} in-group, ${tape.counts?.cross_pool_captured ?? '?'}/${tape.counts?.cross_pool_total ?? 18} cross-pool)`);
      if (unresolved) {
        console.log(`cross-pool event ids already verified but without results: ${unresolved.count} of ${unresolved.of_total}`);
        for (const f of unresolved.fixtures) console.log(`  · ${f.event_id}  ${f.slug}  [${f.orientation}]`);
      }
      if (tape.gaps?.length) {
        console.log('\ndeclared gaps this walk should close:');
        for (const g of tape.gaps) console.log(`  · ${g.stage} ${g.home ?? '?'} v ${g.away ?? '?'} — ${g.reason}`);
      }
    }
    console.log('\nno network requests were made (--dry-run).');
    return;
  }

  const payloadPath = get('--from-payload');
  let collected;
  if (payloadPath) {
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
    collected = normalisePayload(payload, { season });
    console.log(`normalised ${collected.rows.length} row(s) from ${payloadPath}`);
  } else {
    console.log(`walking ${plan.dateCount} dates for season ${plan.season}…`);
    const walk = await walkCalendar(plan, {
      onProgress: ({ date, index, total, rowsSoFar }) => {
        if (index % 7 === 0) console.log(`  ${date} (${index + 1}/${total}) rows so far ${rowsSoFar}`);
      },
    });
    collected = walk;
    console.log(`walked ${walk.datesWalked} dates · ${walk.rows.length} rows · ${walk.emptyDates.length} empty dates`);
  }

  if (collected.unresolved?.length) {
    console.log(`\nunresolved fixtures (no stated result — recorded, never guessed): ${collected.unresolved.length}`);
    for (const u of collected.unresolved.slice(0, 20)) console.log(`  · ${u}`);
  }
  if (collected.problems?.length) {
    console.log(`\nproblems flagged for review: ${collected.problems.length}`);
    for (const p of collected.problems.slice(0, 20)) console.log(`  ! ${p}`);
  }

  if (!tape) {
    console.error('no committed tape found at data/t20_blast_matches.json — run scripts/build_t20_blast.mjs first.');
    process.exit(1);
  }
  const { merged, added, updated, conflicts } = mergeTape(tape.matches, collected.rows);
  console.log(`\nmerge: +${added.length} new, ${updated.length} updated, ${conflicts.length} conflict(s)`);
  for (const c of conflicts) console.log(`  ! ${c.fixture}: committed "${c.committed}" vs collected "${c.collected}" — ${c.action}`);

  if (has('--write')) {
    if (conflicts.length) {
      console.error('\nrefusing to write while result conflicts are unresolved. Review them first.');
      process.exit(1);
    }
    const out = {
      ...tape,
      matches: merged,
      counts: { ...tape.counts, captured: merged.length },
      generated_at_utc: new Date().toISOString(),
      collector: { script: 'scripts/collect_t20_blast.mjs', season, added: added.length, updated: updated.length },
    };
    writeFileSync(MATCHES, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    console.log(`wrote data/t20_blast_matches.json (${merged.length} rows)`);
    console.log('now re-run: node scripts/build_t20_blast.mjs --check && node scripts/backtest_t20_blast.mjs');
  } else {
    console.log('\nnot written (pass --write to update the tape). Re-run the builder checks and the backtest after writing.');
  }
}

if (process.argv[1] && process.argv[1].endsWith('collect_t20_blast.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
