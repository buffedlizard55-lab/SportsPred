/**
 * SportsPred — Cricket Data & Card Builder.
 *
 * Joins committed match fixtures with the OLBG market overlay and optionally a
 * live collected card, then scores and writes the four-market predictions.
 * Pure data plumbing — no guessing; gaps stay null so the engine records them.
 */

import { scoreCricketMatch, scoreCricketCard } from './cricket_engine.js';
import { writeCricketCard, buildCricketFormattedCardText } from './cricket_writer.js';

export function normalizeTeamName(name) {
  if (!name) return '';
  return name.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '');
}

/** Strip common suffix tokens OLBG/ESPN add to team names. */
function core(name) {
  return normalizeTeamName(name)
    .replace(/\b(women|w|wmn|women's)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match an OLBG slate event against a fixture by team names. */
export function matchCricketSlate(match, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const h = core(match.home);
  const a = core(match.away);
  for (const ev of slateDoc.events) {
    const eh = core(ev.home);
    const ea = core(ev.away);
    if (!eh || !ea) continue;
    const samePair =
      (h === eh && a === ea) || (h === ea && a === eh) ||
      (h.includes(eh) && a.includes(ea)) || (eh.includes(h) && ea.includes(a)) ||
      (h.includes(eh) && ea.includes(a)) || (eh.includes(h) && a.includes(ea));
    if (samePair) return ev;
    // Loose one-sided token match (county abbreviations e.g. Northants).
    const tokens = (s) => s.split(' ').filter((t) => t.length >= 4);
    const tokH = new Set(tokens(h));
    const tokMatch = [...tokens(eh)].some((t) => tokH.has(t)) || [...tokens(ea)].some((t) => tokH.has(t));
    if (tokMatch && (a.includes(ea) || ea.includes(a) || a === ea)) return ev;
  }
  return null;
}

/** Enrich a raw fixture with the OLBG overlay (consensus display only). */
export function enrichCricketMatch(rawMatch, slateDoc) {
  const slateOverlay = matchCricketSlate(rawMatch, slateDoc);
  return {
    ...rawMatch,
    homeTeamObj: { ...(rawMatch.homeTeamObj || { name: rawMatch.home }), isHome: true },
    awayTeamObj: { ...(rawMatch.awayTeamObj || { name: rawMatch.away }), isHome: false },
    olbg: slateOverlay,
  };
}

/** Build and score a full card for one ISO date from committed data. */
export function buildCricketCardForDate(dateISO, matchesDoc, slateDoc) {
  const all = matchesDoc?.matches || [];
  const dateMatches = all.filter((m) => m.date === dateISO);
  const enriched = dateMatches.map((m) => enrichCricketMatch(m, slateDoc));
  const scored = scoreCricketCard(enriched);
  const written = writeCricketCard(scored.results);
  return {
    date: dateISO,
    sport: 'Cricket',
    matches: enriched,
    scored,
    written,
    formattedText: buildCricketFormattedCardText(scored.results, dateISO),
  };
}

/** Score and write a live-collected card (from the browser collector). */
export function buildCricketCardFromLive(card, slateDoc) {
  const enriched = (card?.matches || []).map((m) => enrichCricketMatch(m, slateDoc));
  const scored = scoreCricketCard(enriched);
  const written = writeCricketCard(scored.results);
  return { date: card?.date, sport: 'Cricket', matches: enriched, scored, written, quality: card?.quality };
}
