/**
 * FIVB Volleyball Nations League Women data helpers.
 *
 * The old volleyball page mixed NCAA and EuroVolley rows. This module accepts
 * only the FIVB/Volleyball World VNL Women data contract. It is intentionally
 * strict: name comparison is normalized equality, not substring matching, and
 * a result from any other competition cannot be used for VNL form or H2H.
 */

import { scoreVolleyballCard } from './volleyball_engine.js';
import { writeVolleyballCard, buildVolleyballFormattedCardText } from './volleyball_writer.js';

const TEAM_ALIASES = new Map([
  ['turkey', 'turkiye'],
  ['türkiye', 'turkiye'],
  ['united states', 'usa'],
  ['united states of america', 'usa'],
]);

export function normalizeTeamName(name) {
  const plain = String(name || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(women|women's|w)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return TEAM_ALIASES.get(plain) || plain;
}

export function sameTeam(a, b) {
  const left = normalizeTeamName(a);
  const right = normalizeTeamName(b);
  return Boolean(left && right && left === right);
}

function beforeMatch(row, startUtc) {
  if (!startUtc) return false;
  const finished = row?.endUtc || row?.startUtc || (row?.date ? `${row.date}T23:59:59Z` : null);
  return Boolean(finished && String(finished) < String(startUtc));
}

function isVnlWomen(row) {
  const code = row?.family || row?.competition?.family || row?.competition?.code;
  return code === 'vnl-women';
}

function winningScoreFor(row, team) {
  const score = row?.setScore || null;
  if (!/^[0-3]-[0-3]$/.test(String(score))) return null;
  return sameTeam(row.winner, team) ? score : `${score[2]}-${score[0]}`;
}

/** Build recent VNL-only form from verified result rows. Results are expected
 * to carry `winner`, `setScore`, and a source URL supplied by the collector. */
export function formFromVolleyballTape(tape, teamName, beforeUtc, { window = 5 } = {}) {
  const rows = (tape || [])
    .filter((row) => isVnlWomen(row) && row.phase === 'results' && row.winner && beforeMatch(row, beforeUtc)
      && (sameTeam(row.home, teamName) || sameTeam(row.away, teamName)))
    .sort((a, b) => String(b.endUtc || b.startUtc || b.date).localeCompare(String(a.endUtc || a.startUtc || a.date)))
    .slice(0, window);
  return {
    last5: rows.map((row) => sameTeam(row.winner, teamName) ? 'W' : 'L'),
    last5SetScores: rows.map((row) => winningScoreFor(row, teamName)),
    sample: rows.length,
    source_urls: [...new Set(rows.map((row) => row.source_url).filter(Boolean))],
  };
}

/** Return recent international VNL meetings without inventing a missing H2H. */
export function h2hFromVolleyballTape(tape, homeName, awayName, beforeUtc) {
  const rows = (tape || [])
    .filter((row) => isVnlWomen(row) && row.phase === 'results' && row.winner && beforeMatch(row, beforeUtc)
      && ((sameTeam(row.home, homeName) && sameTeam(row.away, awayName))
        || (sameTeam(row.home, awayName) && sameTeam(row.away, homeName))))
    .sort((a, b) => String(b.endUtc || b.startUtc || b.date).localeCompare(String(a.endUtc || a.startUtc || a.date)))
    .slice(0, 3);
  return {
    recentMeetings: rows.map((row) => ({
      date: row.date,
      home: row.home,
      away: row.away,
      winner: row.winner,
      setScore: row.setScore || null,
      source_url: row.source_url || null,
    })),
    knownNoMeaningfulHistory: rows.length === 0,
  };
}

function latestTeamRow(teams, name) {
  if (Array.isArray(teams)) return teams.find((row) => sameTeam(row.name || row.team, name)) || null;
  if (!teams || typeof teams !== 'object') return null;
  return Object.entries(teams).find(([key, row]) => sameTeam(key, name) || sameTeam(row?.name || row?.team, name))?.[1] || null;
}

/** Prepare the narrow, audit-friendly input consumed by the scoring engine.
 * No NCAA, CEV club, or EuroVolley field can enter this object. */
export function enrichVolleyballMatch(raw, tape = [], vnlDoc = {}) {
  if (!isVnlWomen(raw)) return { ...raw, family: raw?.family || 'out-of-scope' };
  const home = typeof raw.home === 'object' ? raw.home.name : raw.home;
  const away = typeof raw.away === 'object' ? raw.away.name : raw.away;
  const startUtc = raw.startUtc || null;
  const homeFacts = latestTeamRow(vnlDoc.teams, home) || raw.homeTeam || {};
  const awayFacts = latestTeamRow(vnlDoc.teams, away) || raw.awayTeam || {};
  const homeForm = formFromVolleyballTape(tape, home, startUtc);
  const awayForm = formFromVolleyballTape(tape, away, startUtc);

  return {
    ...raw,
    family: 'vnl-women',
    home,
    away,
    homeTeam: {
      ...homeFacts,
      name: home,
      form: { ...(homeFacts.form || {}), vnlLast5: homeForm.last5, vnlLast5SetScores: homeForm.last5SetScores },
    },
    awayTeam: {
      ...awayFacts,
      name: away,
      form: { ...(awayFacts.form || {}), vnlLast5: awayForm.last5, vnlLast5SetScores: awayForm.last5SetScores },
    },
    h2h: raw.h2h || h2hFromVolleyballTape(tape, home, away, startUtc),
    source_urls: [...new Set([raw.source_url, ...(homeForm.source_urls || []), ...(awayForm.source_urls || [])].filter(Boolean))],
  };
}

/** Match an OLBG card only by normalized exact pair. It is used for display,
 * never passed to the VNL scorer as odds or consensus evidence. */
export function matchVolleyballSlate(match, slateDoc) {
  const home = normalizeTeamName(match?.home);
  const away = normalizeTeamName(match?.away);
  if (!home || !away || !Array.isArray(slateDoc?.events)) return null;
  return slateDoc.events.find((event) => (
    (normalizeTeamName(event.home) === home && normalizeTeamName(event.away) === away)
    || (normalizeTeamName(event.home) === away && normalizeTeamName(event.away) === home)
  )) || null;
}

export function buildVolleyballCardForDate(dateISO, matches, tape, vnlDoc = {}) {
  const day = (matches || []).filter((match) => match.family === 'vnl-women' && (match.dateISO || match.date) === dateISO);
  const enriched = day.map((match) => enrichVolleyballMatch(match, tape, vnlDoc));
  const scored = scoreVolleyballCard(enriched);
  const written = writeVolleyballCard(scored.results);
  return {
    date: dateISO,
    sport: 'Volleyball',
    competition: 'FIVB Volleyball Nations League — Women',
    matches: enriched,
    scored,
    written,
    formattedText: buildVolleyballFormattedCardText(scored.results, dateISO),
  };
}
