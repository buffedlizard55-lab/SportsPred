/**
 * SportsPred — Handball Data & Card Builder.
 *
 * Joins match fixtures with team profiles, standings, form tapes, H2H,
 * and OLBG market listings into a complete scored card for predictions.
 */

import { scoreHandballMatch, scoreHandballCard, pickHandballFavourite } from './handball_engine.js';
import { writeHandballCard, buildHandballFormattedCardText } from './handball_writer.js';

export function normalizeTeamName(name) {
  if (!name) return '';
  return name.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
}

/**
 * Match an event from the OLBG slate snapshot against a fixture.
 */
export function matchHandballSlate(match, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const matchHome = normalizeTeamName(match.home);
  const matchAway = normalizeTeamName(match.away);

  for (const ev of slateDoc.events) {
    const evHome = normalizeTeamName(ev.home);
    const evAway = normalizeTeamName(ev.away);

    if ((matchHome === evHome && matchAway === evAway) ||
        (matchHome === evAway && matchAway === evHome) ||
        (matchHome.includes(evHome) && matchAway.includes(evAway)) ||
        (evHome.includes(matchHome) && evAway.includes(matchAway))) {
      return ev;
    }
  }
  return null;
}

/**
 * Enriches a raw match with full team records and OLBG market overlay.
 */
export function enrichHandballMatch(rawMatch, teamsDoc, slateDoc) {
  const teams = teamsDoc?.teams || {};
  const homeObj = teams[rawMatch.home] || { name: rawMatch.home, isHome: true };
  const awayObj = teams[rawMatch.away] || { name: rawMatch.away, isHome: false };

  homeObj.isHome = true;
  awayObj.isHome = false;

  const slateOverlay = matchHandballSlate(rawMatch, slateDoc);

  const enriched = {
    ...rawMatch,
    homeTeamObj: homeObj,
    awayTeamObj: awayObj,
    olbg: slateOverlay,
  };

  return enriched;
}

/**
 * Builds and scores a full card for a given date.
 */
export function buildHandballCardForDate(dateISO, matchesDoc, teamsDoc, slateDoc) {
  const allMatches = matchesDoc?.matches || [];
  const dateMatches = allMatches.filter((m) => m.date === dateISO);

  const enrichedMatches = dateMatches.map((m) => enrichHandballMatch(m, teamsDoc, slateDoc));
  const scored = scoreHandballCard(enrichedMatches);
  const written = writeHandballCard(scored.results);

  return {
    date: dateISO,
    sport: 'Handball',
    matches: enrichedMatches,
    scored,
    written,
    formattedText: buildHandballFormattedCardText(scored.results, dateISO),
  };
}
