/**
 * SportsPred — Rugby League Data & Card Builder.
 *
 * Joins committed team profiles, form tapes, and OLBG slate overlays
 * into a complete scored card for predictions. Pure data plumbing — no guessing;
 * gaps stay null so the engine records them.
 */

import { scoreRugbyLeagueMatch, scoreRugbyLeagueCard } from "./rugby_league_engine.js";
import { writeRugbyLeagueCard, buildRugbyLeagueFormattedCardText } from "./rugby_league_writer.js";

export function normalizeTeamName(name) {
  if (!name) return "";
  return name.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "");
}

function core(name) {
  return normalizeTeamName(name)
    .replace(/\b(rugby|football|club|fc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match an OLBG slate event against a fixture by team names. */
export function matchRugbyLeagueSlate(match, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const h = core(match.home);
  const a = core(match.away);
  for (const ev of slateDoc.events) {
    const eh = core(ev.home || "");
    const ea = core(ev.away || "");
    if (!eh || !ea) continue;
    const samePair =
      (h === eh && a === ea) || (h === ea && a === eh) ||
      (h.includes(eh) && a.includes(ea)) || (eh.includes(h) && ea.includes(a)) ||
      (h.includes(eh) && ea.includes(a)) || (eh.includes(h) && a.includes(ea));
    if (samePair) return ev;
    // Loose token match
    const tokens = (s) => s.split(" ").filter((t) => t.length >= 4);
    const tokH = new Set(tokens(h));
    const tokMatch = [...tokens(eh)].some((t) => tokH.has(t)) || [...tokens(ea)].some((t) => tokH.has(t));
    if (tokMatch && (a.includes(ea) || ea.includes(a) || a === ea)) return ev;
  }
  return null;
}

/** Enrich a raw fixture with team objects and OLBG overlay. */
export function enrichRugbyLeagueMatch(rawMatch, teamsDoc, slateDoc) {
  const teams = teamsDoc?.teams || {};
  // Try direct, then normalized lookup
  const findTeam = (name) => {
    if (teams[name]) return teams[name];
    const norm = normalizeTeamName(name);
    for (const k of Object.keys(teams)) {
      if (normalizeTeamName(k) === norm) return teams[k];
    }
    // Fallback partial
    for (const k of Object.keys(teams)) {
      if (k.toLowerCase().includes(name.toLowerCase().split(" ")[0]) && normalizeTeamName(k).includes(norm.split(" ")[0])) {
        // Check if tokens overlap
        const tkn = name.toLowerCase().split(" ")[0];
        if (k.toLowerCase().includes(tkn)) return teams[k];
      }
    }
    return { name, isHome: false, _missing: true };
  };

  const homeObj = { ...(findTeam(rawMatch.home) || { name: rawMatch.home }), isHome: true, name: rawMatch.home };
  const awayObj = { ...(findTeam(rawMatch.away) || { name: rawMatch.away }), isHome: false, name: rawMatch.away };

  // Preserve original isHome flags if already set
  homeObj.isHome = true;
  awayObj.isHome = false;

  const slateOverlay = matchRugbyLeagueSlate(rawMatch, slateDoc);

  // Overlay handicap/total lines from slate if present — slate is authoritative and more recent than committed matches
  let handicapLine = rawMatch.handicapLine ?? rawMatch.handicapSpread ?? null;
  let totalLine = rawMatch.totalLine ?? rawMatch.gameTotal ?? null;
  let handicapSelections = rawMatch.handicapSelections || null;
  let totalSelections = rawMatch.totalSelections || null;

  if (slateOverlay) {
    // Handicap: if slate carries lines, prefer them (live movement)
    if (slateOverlay.handicap_lines || slateOverlay.handicap_selections) {
      handicapSelections = slateOverlay.handicap_selections || slateOverlay.handicap_lines;
      // If slate has a structured line for either team, use it as the market line; engine will resolve fav's line from selections when handicapLine is null
      // Prefer slate's line over stale committed value when they differ
      const slateLines = slateOverlay.handicap_lines;
      if (Array.isArray(slateLines) && slateLines.length) {
        const first = slateLines[0];
        const slateLine = typeof first === "object" ? first.line : null;
        if (slateLine != null) {
          // Keep raw if it matches slate within 0.01, otherwise prefer slate (movement)
          if (handicapLine == null || Math.abs(handicapLine - slateLine) > 0.01) handicapLine = null; // let engine parse from selections
        }
      } else if (Array.isArray(handicapSelections) && handicapSelections.length && typeof handicapSelections[0] === "string") {
        // String selections like "Brisbane Broncos +10.50" — let engine parse
        handicapLine = null;
      }
    }
    if (slateOverlay.total_lines || slateOverlay.total_selections) {
      totalSelections = slateOverlay.total_selections || slateOverlay.total_lines;
      if (Array.isArray(slateOverlay.total_lines) && slateOverlay.total_lines.length) {
        const first = slateOverlay.total_lines[0];
        const slateTotal = typeof first === "object" ? first.line : parseFloat(String(first).split(" ")[1]) || null;
        if (slateTotal != null) totalLine = slateTotal;
      }
    }
  }

  const enriched = {
    ...rawMatch,
    homeTeamObj: homeObj,
    awayTeamObj: awayObj,
    olbg: slateOverlay,
    handicapLine,
    handicapSelections,
    totalLine,
    totalSelections,
  };

  return enriched;
}

/** Build and score a full card for one ISO date from committed data. */
export function buildRugbyLeagueCardForDate(dateISO, matchesDoc, teamsDoc, slateDoc) {
  const all = matchesDoc?.matches || [];
  const dateMatches = all.filter((m) => m.date === dateISO || m.dateISO === dateISO);
  const enriched = dateMatches.map((m) => enrichRugbyLeagueMatch(m, teamsDoc, slateDoc));
  const scored = scoreRugbyLeagueCard(enriched);
  const written = writeRugbyLeagueCard(scored.results);
  return {
    date: dateISO,
    sport: "Rugby League",
    league: "Rugby League",
    matches: enriched,
    scored,
    written,
    formattedText: buildRugbyLeagueFormattedCardText(written, dateISO),
  };
}

/** Score and write a live-collected card (from browser collector). */
export function buildRugbyLeagueCardFromLive(card, teamsDoc, slateDoc) {
  const enriched = (card?.matches || []).map((m) => enrichRugbyLeagueMatch(m, teamsDoc, slateDoc));
  const scored = scoreRugbyLeagueCard(enriched);
  const written = writeRugbyLeagueCard(scored.results);
  return { date: card?.date, sport: "Rugby League", matches: enriched, scored, written, quality: card?.quality };
}

/** Convenience: enrich all matches in a doc */
export function enrichRugbyLeagueMatches(matchesDoc, teamsDoc, slateDoc) {
  const all = matchesDoc?.matches || [];
  return all.map((m) => enrichRugbyLeagueMatch(m, teamsDoc, slateDoc));
}
