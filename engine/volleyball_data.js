/**
 * SportsPred — Volleyball data join (pure, no I/O).
 *
 * Two competition families are kept strictly separate:
 *   - `ncaa`            ESPN college volleyball (men's / women's)
 *   - `eurovolley-w`    CEV Women's European Championship (committed tape)
 *
 * Form, H2H and rest for a fixture are built only from tape rows in the SAME
 * family that finished strictly before the fixture's start. NCAA records are
 * never applied to EuroVolley sides and vice versa.
 */

import { scoreVolleyballCard } from './volleyball_engine.js';
import { writeVolleyballCard, buildVolleyballFormattedCardText } from './volleyball_writer.js';
import { oddsForTeam } from './volleyball_espn.js';

export function normalizeTeamName(name) {
  if (!name) return '';
  return name.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\bwomen\b/g, '')
    .replace(/\bw\b/g, '')
    .trim();
}

export function sameTeam(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function setScoreFromWinner(row, teamName) {
  if (!row.setScore) return null;
  if (row.setsIncomplete) return null;
  const won = sameTeam(row.winner, teamName);
  const m = String(row.setScore).match(/^(\d)-(\d)$/);
  if (!m) return null;
  return won ? `${m[1]}-${m[2]}` : `${m[2]}-${m[1]}`;
}

export function formFromVolleyballTape(tape, teamName, beforeUtc, { family, window = 5 } = {}) {
  const rows = (tape || [])
    .filter((m) => m.phase === 'results' && m.winner
      && (!family || m.family === family)
      && (!beforeUtc || String(m.startUtc || m.date) < String(beforeUtc))
      && (sameTeam(m.home, teamName) || sameTeam(m.away, teamName)))
    .sort((a, b) => String(b.startUtc || b.date).localeCompare(String(a.startUtc || a.date)))
    .slice(0, window);
  if (!rows.length) return null;
  const last5 = rows.map((m) => (sameTeam(m.winner, teamName) ? 'W' : 'L'));
  const last5SetScores = rows.map((m) => setScoreFromWinner(m, teamName));
  let winStreak = 0;
  for (const r of last5) { if (r === 'W') winStreak += 1; else break; }
  let lossStreak = 0;
  for (const r of last5) { if (r === 'L') lossStreak += 1; else break; }
  return {
    last5,
    last5SetScores,
    winStreak,
    lossStreak,
    sample: rows.length,
  };
}

export function h2hFromVolleyballTape(tape, homeName, awayName, beforeUtc, { family } = {}) {
  const rows = (tape || [])
    .filter((m) => m.phase === 'results' && m.winner
      && (!family || m.family === family)
      && (!beforeUtc || String(m.startUtc || m.date) < String(beforeUtc))
      && ((sameTeam(m.home, homeName) && sameTeam(m.away, awayName))
        || (sameTeam(m.home, awayName) && sameTeam(m.away, homeName))))
    .sort((a, b) => String(b.startUtc || b.date).localeCompare(String(a.startUtc || a.date)));
  if (!rows.length) return { recentMeetings: [], meetings: 0 };
  return {
    meetings: rows.length,
    recentMeetings: rows.map((m) => ({
      date: m.date,
      home: m.home,
      away: m.away,
      winner: m.winner,
      setScore: m.setsIncomplete ? null : m.setScore,
      venue: m.venue || null,
    })),
  };
}

export function restFromVolleyballTape(tape, teamName, startUtc, { family } = {}) {
  if (!startUtc && !teamName) return { days: null, playedWithin48h: false };
  const prior = (tape || [])
    .filter((m) => m.phase === 'results'
      && (!family || m.family === family)
      && (startUtc ? String(m.startUtc || m.date) < String(startUtc) : true)
      && (sameTeam(m.home, teamName) || sameTeam(m.away, teamName)))
    .sort((a, b) => String(b.startUtc || b.date).localeCompare(String(a.startUtc || a.date)))[0];
  if (!prior || !startUtc) return { days: null, playedWithin48h: false };
  const ms = Date.parse(startUtc) - Date.parse(prior.startUtc || `${prior.date}T12:00:00Z`);
  if (!Number.isFinite(ms)) return { days: null, playedWithin48h: false };
  const days = Math.round(ms / 86400000);
  return { days, playedWithin48h: ms < 48 * 3600 * 1000 };
}

function espnFormToLast5(form) {
  if (Array.isArray(form) && form.length) return form.filter((c) => c === 'W' || c === 'L').slice(0, 5);
  return [];
}

/**
 * Build the engine input for one match.
 * `tape` is the results tape (same family only is enforced inside helpers).
 */
export function enrichVolleyballMatch(raw, tape = []) {
  const family = raw.family || raw.competitionFamily || 'ncaa';
  const homeName = raw.home?.name || raw.home;
  const awayName = raw.away?.name || raw.away;
  const before = raw.startUtc || (raw.date ? `${raw.date}T00:00:00Z` : null);

  const homeForm = formFromVolleyballTape(tape, homeName, before, { family })
    || { last5: espnFormToLast5(raw.homeTeamObj?.form || raw.home?.form), last5SetScores: [], winStreak: 0, lossStreak: 0 };
  const awayForm = formFromVolleyballTape(tape, awayName, before, { family })
    || { last5: espnFormToLast5(raw.awayTeamObj?.form || raw.away?.form), last5SetScores: [], winStreak: 0, lossStreak: 0 };

  const homeRest = restFromVolleyballTape(tape, homeName, before, { family });
  const awayRest = restFromVolleyballTape(tape, awayName, before, { family });
  const h2h = h2hFromVolleyballTape(tape, homeName, awayName, before, { family });

  const homeOdds = raw.homeTeamObj?.odds || oddsForTeam(raw.odds, 'home');
  const awayOdds = raw.awayTeamObj?.odds || oddsForTeam(raw.odds, 'away');

  const homeObj = {
    ...(typeof raw.home === 'object' ? raw.home : {}),
    ...(raw.homeTeamObj || {}),
    name: homeName,
    isHome: true,
    form: homeForm,
    odds: homeOdds,
    rest: homeRest,
    record: raw.homeTeamObj?.record || raw.home?.record || null,
    homeRecord: raw.homeTeamObj?.homeRecord || null,
    awayRecord: raw.homeTeamObj?.awayRecord || null,
    rank: raw.homeTeamObj?.rank ?? raw.home?.rank ?? null,
    standings: raw.homeTeamObj?.standings || (raw.homeTeamObj?.rank != null
      ? { rank: raw.homeTeamObj.rank } : null),
  };
  const awayObj = {
    ...(typeof raw.away === 'object' ? raw.away : {}),
    ...(raw.awayTeamObj || {}),
    name: awayName,
    isHome: false,
    form: awayForm,
    odds: awayOdds,
    rest: awayRest,
    record: raw.awayTeamObj?.record || raw.away?.record || null,
    homeRecord: raw.awayTeamObj?.homeRecord || null,
    awayRecord: raw.awayTeamObj?.awayRecord || null,
    rank: raw.awayTeamObj?.rank ?? raw.away?.rank ?? null,
    standings: raw.awayTeamObj?.standings || (raw.awayTeamObj?.rank != null
      ? { rank: raw.awayTeamObj.rank } : null),
  };

  return {
    ...raw,
    family,
    home: homeName,
    away: awayName,
    homeTeamObj: homeObj,
    awayTeamObj: awayObj,
    h2h,
    olbg: raw.olbg || null,
  };
}

export function matchVolleyballSlate(match, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const matchHome = normalizeTeamName(match.home?.name || match.home);
  const matchAway = normalizeTeamName(match.away?.name || match.away);
  for (const ev of slateDoc.events) {
    const evHome = normalizeTeamName(ev.home);
    const evAway = normalizeTeamName(ev.away);
    if ((matchHome === evHome && matchAway === evAway)
      || (matchHome === evAway && matchAway === evHome)
      || (matchHome.includes(evHome) && matchAway.includes(evAway))
      || (evHome.includes(matchHome) && evAway.includes(matchAway))) {
      return ev;
    }
  }
  return null;
}

export function buildVolleyballCardForDate(dateISO, matches, tape, slateDoc) {
  const day = (matches || []).filter((m) => (m.dateISO || m.date) === dateISO);
  const enriched = day.map((m) => {
    const row = enrichVolleyballMatch(m, tape);
    row.olbg = matchVolleyballSlate(row, slateDoc);
    return row;
  });
  const scored = scoreVolleyballCard(enriched);
  const written = writeVolleyballCard(scored.results);
  return {
    date: dateISO,
    sport: 'Volleyball',
    matches: enriched,
    scored,
    written,
    formattedText: buildVolleyballFormattedCardText(scored.results, dateISO),
  };
}
