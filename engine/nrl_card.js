/**
 * SportsPred — NRL card builder.
 *
 * Committed documents in, scored and written card out:
 *   data/nrl_matches.json   the season tape (results + fixtures)
 *   data/nrl_teams.json     clubs, home venues, coordinates
 *   data/nrl_slate.json     the OLBG market slate (lines + markets offered)
 *   data/nrl_weather.json   Open-Meteo forecast per venue
 *   data/nrl_origin.json    the State of Origin calendar
 *
 * Nothing is fetched here and nothing is invented: the same functions run in
 * the browser and in CI.
 */

import {
  buildNrlSeason, nrlLadderAt, nrlLadderHistory, nrlSeasonMeanTotal,
  enrichNrlMatch, nrlUpcoming, nrlResultsOnDate, nrlCalendar,
} from './nrl_data.js';
import { scoreNrlCard, scoreNrlMatch, MARKETS } from './nrl_engine.js';
import { writeNrlCard, buildNrlFormattedCardText } from './nrl_writer.js';

/** Assemble the document bundle the engine reads. */
export function buildNrlDocs({ matches, teams, slate, weather, origin }) {
  const season = buildNrlSeason(matches, teams);
  return {
    matches, teams, slate, weather, origin,
    season,
    history: nrlLadderHistory(season),
    seasonMeanTotal: nrlSeasonMeanTotal(season),
  };
}

/** The NRL ladder as things stand (every completed match in the tape). */
export function nrlLadderNow(docs) {
  return nrlLadderAt(docs.season, {});
}

/** Score and write every upcoming fixture. */
export function buildNrlUpcomingCard(docs) {
  const upcoming = nrlUpcoming(docs);
  const scored = scoreNrlCard(upcoming);
  const written = writeNrlCard(scored.results);
  return {
    sport: 'NRL',
    matches: upcoming,
    scored,
    written,
    activeCount: written.activeCount,
    skipCount: written.skipCount,
  };
}

/** Score and write the fixtures on one ISO date. */
export function buildNrlCardForDate(dateISO, docs) {
  const all = nrlUpcoming(docs);
  const day = all.filter((m) => m.date === dateISO);
  const scored = scoreNrlCard(day);
  const written = writeNrlCard(scored.results);
  const results = nrlResultsOnDate(docs, dateISO);
  return {
    date: dateISO,
    sport: 'NRL',
    matches: day,
    results,
    scored,
    written,
    formattedText: buildNrlFormattedCardText(written, dateISO),
  };
}

export {
  enrichNrlMatch, nrlUpcoming, nrlResultsOnDate, nrlCalendar,
  scoreNrlCard, scoreNrlMatch, writeNrlCard, buildNrlFormattedCardText, MARKETS,
};
