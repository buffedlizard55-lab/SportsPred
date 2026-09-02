/**
 * SportsPred — Rugby League Card Builder (committed documents -> scored & written card).
 *
 * Mirrors golf_card.js / snooker_card.js pattern: takes pre-built docs
 * (matches, teams, slate) and returns a full card with scores, tips, summary.
 */

import { scoreRugbyLeagueCard } from "./rugby_league_engine.js";
import { writeRugbyLeagueCard, buildRugbyLeagueFormattedCardText } from "./rugby_league_writer.js";
import { enrichRugbyLeagueMatch } from "./rugby_league_data.js";

export function buildRugbyLeagueCard(matches, teamsDoc, slateDoc, dateISO = null) {
  const enriched = matches.map((m) => enrichRugbyLeagueMatch(m, teamsDoc, slateDoc));
  const scored = scoreRugbyLeagueCard(enriched);
  const written = writeRugbyLeagueCard(scored.results);
  const filtered = dateISO ? enriched.filter((m) => m.date === dateISO || m.dateISO === dateISO) : enriched;
  // If dateISO provided, we still score all but written is filtered? Keep consistent with other card builders.
  const dateWritten = dateISO ? writeRugbyLeagueCard(scored.results.filter((r) => {
    const m = r.match;
    return m.date === dateISO || m.dateISO === dateISO;
  })) : written;

  const cardDate = dateISO || (matches[0]?.date || matches[0]?.dateISO || new Date().toISOString().slice(0, 10));

  return {
    date: cardDate,
    sport: "Rugby League",
    matches: enriched,
    filteredMatches: filtered,
    scored,
    written: dateISO ? dateWritten : written,
    formattedText: buildRugbyLeagueFormattedCardText(dateISO ? dateWritten : written, cardDate),
  };
}

export function scoreAndWriteRugbyLeagueMatches(matches, teamsDoc, slateDoc) {
  const enriched = matches.map((m) => enrichRugbyLeagueMatch(m, teamsDoc, slateDoc));
  const scored = scoreRugbyLeagueCard(enriched);
  const written = writeRugbyLeagueCard(scored.results);
  return { enriched, scored, written };
}
