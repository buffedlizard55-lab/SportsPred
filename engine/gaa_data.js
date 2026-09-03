/**
 * SportsPred — GAA profiles, H2H, pedigree lookups.
 * Pure. Leak-free: only matches strictly before the target.
 */

import { gaaTotal } from './gaa_engine.js';

export function sortKey(m) {
  const day = m.date || m.event_end || '0000-00-00';
  const idx = Number.isFinite(m.round_index) ? m.round_index : 0;
  return `${day}~${String(idx).padStart(3, '0')}~${m.id || ''}`;
}

export function completedMatches(tape) {
  return (tape?.matches || [])
    .filter((m) => m && (m.winner || (Number.isFinite(m.total_a) && Number.isFinite(m.total_b))))
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
}

export function matchesBefore(tape, target) {
  const key = sortKey(target);
  return completedMatches(tape)
    .filter((m) => m.id !== target.id && sortKey(m) < key)
    .reverse();
}

export function roundTierFor(round) {
  const r = String(round || '').toLowerCase();
  if (/(^|\s|-)final|league final/.test(r) && !/quarter|semi/.test(r)) return 'final';
  if (/(semi|sf)/.test(r)) return 'semi';
  if (/(quarter|qf)/.test(r)) return 'qf';
  if (/(knockout|championship)/.test(r)) return 'knockout';
  if (/(relegation|promotion)/.test(r)) return 'mid';
  if (/(round|group|league)/.test(r)) return 'early';
  return 'early';
}

function sideOf(m, name) {
  const a = m.team_a?.name || m.player_a?.name;
  const b = m.team_b?.name || m.player_b?.name;
  if (a === name) return 'a';
  if (b === name) return 'b';
  return null;
}

function totalFor(m, side) {
  if (side === 'a') {
    if (Number.isFinite(m.total_a)) return m.total_a;
    return gaaTotal(m.goals_a, m.points_a);
  }
  if (Number.isFinite(m.total_b)) return m.total_b;
  return gaaTotal(m.goals_b, m.points_b);
}

export function buildTeamProfile(matches, { teamName, eventName = null } = {}) {
  const own = (matches || []).filter((m) => sideOf(m, teamName));
  const last5 = own.slice(0, 5).map((m) => {
    const side = sideOf(m, teamName);
    const tf = totalFor(m, side);
    const ta = totalFor(m, side === 'a' ? 'b' : 'a');
    const opp = side === 'a'
      ? (m.team_b?.name || m.player_b?.name)
      : (m.team_a?.name || m.player_a?.name);
    return {
      id: m.id,
      date: m.date,
      event: m.event,
      round: m.round,
      opponent: opp ?? null,
      totalFor: tf,
      totalAgainst: ta,
      margin: Number.isFinite(tf) && Number.isFinite(ta) ? tf - ta : null,
      winner: m.winner,
      code: m.code || 'football',
    };
  });
  const inCompetition = own
    .filter((m) => !eventName || String(m.event || '').toLowerCase() === String(eventName).toLowerCase())
    .map((m) => ({ winner: m.winner }));
  return {
    name: teamName,
    last5,
    wins: last5.filter((m) => m.winner === teamName).length,
    losses: last5.filter((m) => m.winner && m.winner !== teamName).length,
    draws: last5.filter((m) => !m.winner || m.winner === 'Draw').length,
    matchCount: last5.length,
    inCompetition,
    inTournament: inCompetition,
  };
}

export function h2hBetween(matches, nameA, nameB, { asOfISO = null } = {}) {
  const cutoff = asOfISO ? asOfUTCDate(asOfISO, -3 * 365) : null;
  const meetings = matches.filter((m) => {
    const a = m.team_a?.name || m.player_a?.name;
    const b = m.team_b?.name || m.player_b?.name;
    return (a === nameA && b === nameB) || (a === nameB && b === nameA);
  });
  const tally = {
    a: nameA, b: nameB, aWins: 0, bWins: 0, draws: 0, total: meetings.length,
    last3Years: { aWins: 0, bWins: 0, total: 0 },
  };
  for (const m of meetings) {
    const winner = m.winner;
    if (!winner || winner === 'Draw') {
      if (winner === 'Draw') tally.draws += 1;
      continue;
    }
    const wonA = winner === nameA;
    if (wonA) tally.aWins += 1; else tally.bWins += 1;
    const when = m.date || m.event_end || null;
    if (cutoff && when && when >= cutoff) {
      tally.last3Years.total += 1;
      if (wonA) tally.last3Years.aWins += 1; else tally.last3Years.bWins += 1;
    }
  }
  return tally;
}

function asOfUTCDate(iso, deltaDays) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rankFor(rankingsDoc, name, { code = null } = {}) {
  const n = normName(name);
  if (!n) return null;
  const entries = rankingsDoc?.entries || [];
  const entry = entries.find((e) => {
    if (code && e.code && e.code !== code) return false;
    const eName = normName(e.name);
    return eName === n || eName.includes(n) || n.includes(eName);
  });
  return entry ? Number(entry.rank) : null;
}

export function splitMatchup(matchup) {
  const m = String(matchup || '').match(/^(.+?)\s+v(?:s)?\.?\s+(.+)$/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

export function resolveOlbgDate(label, asOfISO) {
  if (!label) return null;
  const asOf = asOfISO || '2026-09-03';
  const year = Number(asOf.slice(0, 4));
  const lower = label.toLowerCase();
  if (lower === 'today') return asOf;
  if (lower === 'tomorrow') {
    const d = new Date(`${asOf}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const m = label.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*(?:\s+(\d{4}))?/i);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const mo = months[m[2].slice(0, 4).toLowerCase()] || months[m[2].slice(0, 3).toLowerCase()];
  const y = m[3] ? Number(m[3]) : year;
  if (!mo) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

export function fixturesFromSlate(slateDoc, { code = 'football' } = {}) {
  const asOf = slateDoc?.source?.fetched_at_utc?.slice(0, 10) || slateDoc?.as_of_utc?.slice(0, 10) || null;
  const fixtures = [];
  for (const e of slateDoc?.events || []) {
    if (e.type === 'outright') continue;
    let teamA = e.teamA || e.playerA;
    let teamB = e.teamB || e.playerB;
    if ((!teamA || !teamB) && e.matchup) {
      const split = splitMatchup(e.matchup);
      if (split) {
        teamA = teamA || { name: split.a };
        teamB = teamB || { name: split.b };
      }
    }
    if (!teamA?.name || !teamB?.name) continue;
    const dateISO = e.dateISO || e.resolved_date || resolveOlbgDate(e.display_date_label, asOf);
    fixtures.push({
      id: e.event_id ? `olbg-${e.event_id}` : (e.id || `gaa-${asOf}`),
      dateISO,
      event: e.tournament || e.event || (code === 'hurling' ? 'County hurling championship' : 'County football championship'),
      round: e.round || 'Championship round',
      roundTier: e.roundTier || 'knockout',
      venue: e.venue || null,
      status: e.status || 'scheduled',
      code: e.code || code,
      teamA,
      teamB,
      playerA: teamA,
      playerB: teamB,
      sourceUrls: [e.url, slateDoc?.source?.url].filter(Boolean),
      olbg: e.olbg || e.consensus || null,
    });
  }
  return fixtures;
}

export function fixtureFromTapeRow(row) {
  const a = { name: row.team_a?.name || row.player_a?.name, rank: row.team_a?.rank };
  const b = { name: row.team_b?.name || row.player_b?.name, rank: row.team_b?.rank };
  return {
    id: row.id,
    dateISO: row.date || row.event_end || null,
    date: row.date || row.event_end || null,
    event: row.event || null,
    round: row.round || null,
    roundTier: row.round_tier || roundTierFor(row.round),
    venue: row.venue || null,
    status: 'result',
    code: row.code || 'football',
    teamA: a,
    teamB: b,
    playerA: a,
    playerB: b,
    homeSide: row.home_side || null,
    sourceUrls: row.source_urls || [],
    round_index: row.round_index,
    event_end: row.event_end,
  };
}

export function prepareFixture(fx, docs = {}) {
  const tape = docs.tape || { matches: [] };
  const asOfISO = docs.asOfISO || fx.dateISO || fx.date || null;
  const prior = matchesBefore(tape, { ...fx, date: fx.dateISO || fx.date || null, id: fx.id });
  const roundTier = roundTierFor(fx.round) || fx.roundTier;
  const code = fx.code || 'football';
  const match = {
    ...fx,
    date: fx.dateISO || fx.date || null,
    roundTier,
    code,
    teamA: { ...fx.teamA, rank: fx.teamA?.rank ?? rankFor(docs.rankings, fx.teamA?.name, { code }) },
    teamB: { ...fx.teamB, rank: fx.teamB?.rank ?? rankFor(docs.rankings, fx.teamB?.name, { code }) },
  };
  match.playerA = match.teamA;
  match.playerB = match.teamB;
  return {
    match,
    profiles: {
      a: buildTeamProfile(prior, { teamName: match.teamA.name, eventName: match.event }),
      b: buildTeamProfile(prior, { teamName: match.teamB.name, eventName: match.event }),
    },
    h2h: h2hBetween(prior, match.teamA.name, match.teamB.name, { asOfISO }),
    roundTier,
  };
}
