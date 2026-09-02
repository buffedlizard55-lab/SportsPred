/**
 * SportsPred — Ice Hockey data layer: joins sourced documents into the shape
 * the scoring engine consumes.
 *
 * THE ONE RULE: this file never fills a gap. If a document does not carry a
 * value the field stays null, the engine records it in `missing[]`, and the
 * confidence caps in Step 3 apply. There is no default anywhere in here.
 *
 * Documents (all built by the collectors in scripts/, all provenance-tagged):
 *   data/ice_hockey_fixtures.json   upcoming + settled fixtures (NHL API / ESPN)
 *   data/ice_hockey_standings.json  official NHL standings table snapshot
 *   data/ice_hockey_tape.json       results tape used for form, b2b, H2H
 *   data/ice_hockey_injuries.json   ESPN injury register snapshot
 *   data/ice_hockey_slate.json      OLBG ice hockey market rows (display + join)
 *   data/ice_hockey_goalies.json    club-stats derived goaltender save percentages
 */

import { scoreIceHockeyCardMixed } from './ice_hockey_engine.js';
import { writeIceHockeyCard } from './ice_hockey_writer.js';
import { scheduleFactors, headToHeadFromTape, puckLineCovers } from './ice_hockey_espn.js';

export function normalizeTeamName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '');
}

export function normalizeAbbrev(a) {
  return a ? String(a).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

/** Leagues the prompt treats as lower-scoring than the NHL. */
export const EUROPEAN_LEAGUE_HINTS = [
  'liiga', 'sm liiga', 'finland', 'shl', 'swedish', 'sweden', 'nla', 'national league',
  'switzerland', 'del', 'germany', 'khl', 'russia', 'extraliga', 'czech', 'slovak',
  'metal ligaen', 'denmark', 'ligue magnus', 'france', 'elite league', 'eihl', 'uk',
  'ice hockey league', 'austria',
];

export function isEuropeanLeague(leagueName) {
  const s = String(leagueName || '').toLowerCase();
  if (!s) return false;
  if (s.includes('nhl') || s.includes('national hockey league')) return false;
  return EUROPEAN_LEAGUE_HINTS.some((hint) => s.includes(hint));
}

function findProfile(standingsTeams, abbrev, name) {
  const key = normalizeAbbrev(abbrev);
  if (key && standingsTeams[key]) return standingsTeams[key];
  if (!name) return null;
  const want = normalizeTeamName(name);
  for (const [k, v] of Object.entries(standingsTeams)) {
    if (normalizeTeamName(v.name) === want) return v;
    if (k && normalizeTeamName(k) === want) return v;
  }
  return null;
}

function findGoalie(goalieDoc, abbrev) {
  const key = normalizeAbbrev(abbrev);
  const row = goalieDoc?.teams?.[key] ?? goalieDoc?.teams?.[abbrev] ?? null;
  if (!row) return null;
  return {
    name: row.name ?? null,
    savePctg: row.savePctg ?? null,
    isBackup: row.isBackup === true,
    confirmed: row.confirmed === true,
    last5SavePctg: row.last5SavePctg ?? null,
    source: row.source ?? 'club-stats',
  };
}

function findInjury(injuryDoc, abbrev) {
  const key = normalizeAbbrev(abbrev);
  const row = injuryDoc?.byTeam?.[key] ?? injuryDoc?.byTeam?.[abbrev] ?? null;
  if (!row) return null;
  return {
    keyForwardLineMissing: row.keyForwardLineMissing === true,
    forwardOutCount: row.forwardOutCount ?? null,
    count: row.count ?? null,
    source: 'espn-injuries',
  };
}

/** Match an OLBG slate row against a fixture by team names. */
export function matchSlateEvent(fixture, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const h = normalizeTeamName(fixture.home?.name || fixture.home || '');
  const a = normalizeTeamName(fixture.away?.name || fixture.away || '');
  if (!h || !a) return null;
  for (const ev of slateDoc.events) {
    const eh = normalizeTeamName(ev.home || '');
    const ea = normalizeTeamName(ev.away || '');
    if (!eh || !ea) continue;
    if ((eh === h && ea === a) || (eh === a && ea === h)) return ev;
    if ((h.includes(eh) || eh.includes(h)) && (a.includes(ea) || ea.includes(a))) return ev;
  }
  return null;
}

/**
 * Build one engine-ready match from a fixture plus the sourced documents.
 * Returns the enriched match; missing inputs stay null.
 */
export function enrichIceHockeyFixture(fixture, docs = {}) {
  const standingsTeams = docs.standings?.teams || {};
  const tape = docs.tape?.games || docs.tape || [];
  const startUtc = fixture.startUtc || (fixture.dateISO ? `${fixture.dateISO}T00:00:00Z` : null);

  const buildSide = (raw, sideKey) => {
    const abbrev = normalizeAbbrev(raw?.abbrev);
    const profile = findProfile(standingsTeams, abbrev, raw?.name);
    const sched = abbrev ? scheduleFactors(tape, abbrev, startUtc, { totalLine: fixture.total?.line ?? null }) : null;
    const goalie = findGoalie(docs.goalies, abbrev);
    const injuries = findInjury(docs.injuries, abbrev);
    const oddsNode = sideKey === 'home' ? fixture.odds?.home : fixture.odds?.away;
    const ats = abbrev ? puckLineCovers(tape, abbrev, startUtc) : null;
    const ranks = profile?.ranks ?? null;

    return {
      name: raw?.name ?? null,
      abbrev,
      id: raw?.id ?? null,
      logo: raw?.logo ?? null,
      record: raw?.record ?? profile?.record ?? null,
      recordSummary: raw?.recordSummary ?? null,
      points: profile?.points ?? null,
      winPctg: profile?.winPctg ?? null,
      goalsForPerGame: profile?.goalsForPerGame ?? null,
      goalsAgainstPerGame: profile?.goalsAgainstPerGame ?? null,
      shotsForPerGame: profile?.shotsForPerGame ?? null,
      shotsAgainstPerGame: profile?.shotsAgainstPerGame ?? null,
      shotsForRank: profile?.shotsForRank ?? null,
      shotsAgainstRank: profile?.shotsAgainstRank ?? null,
      leagueSize: ranks?.leagueSize ?? null,
      powerPlayPctg: profile?.powerPlayPctg ?? null,
      penaltyKillPctg: profile?.penaltyKillPctg ?? null,
      powerPlayOpportunitiesPerGame: profile?.powerPlayOpportunitiesPerGame ?? null,
      blockedShotsPerGame: profile?.blockedShotsPerGame ?? null,
      homeWinPctg: sideKey === 'home' ? profile?.home?.winPctg ?? null : null,
      form: sched?.form ?? null,
      avgWinMarginLast5Wins: sched?.avgWinMarginLast5Wins ?? null,
      recentTotals: sched?.recentTotals ?? null,
      backToBack: sched?.backToBack ?? null,
      puckLineCovers: ats,
      goaltender: goalie,
      injuries,
      odds: oddsNode ? {
        american: oddsNode.american ?? null,
        decimal: oddsNode.decimal ?? null,
        provider: oddsNode.provider ?? fixture.odds?.provider ?? null,
      } : null,
      provenance: {
        standings: profile ? 'nhl-standings' : null,
        schedule: sched ? 'nhl-tape' : null,
        goaltender: goalie?.source ?? null,
        injuries: injuries?.source ?? null,
      },
    };
  };

  const home = buildSide(fixture.home, 'home');
  const away = buildSide(fixture.away, 'away');
  const leagueName = fixture.leagueName || fixture.league || null;

  return {
    ...fixture,
    league: fixture.league ?? null,
    leagueName,
    european: fixture.european ?? isEuropeanLeague(leagueName),
    dateISO: fixture.dateISO ?? (fixture.startUtc ? String(fixture.startUtc).slice(0, 10) : null),
    startUtc,
    h2h: home.abbrev && away.abbrev ? headToHeadFromTape(tape, home.abbrev, away.abbrev, startUtc) : null,
    olbg: matchSlateEvent(fixture, docs.slate),
    oddsSourceCount: fixture.oddsSourceCount ?? null,
    oddsProvider: fixture.odds?.provider ?? null,
    home,
    away,
  };
}

/** Build, score and write a full card from the committed documents. */
export function buildIceHockeyCard(docs, { dateISO = null, fixtures = null } = {}) {
  const list = fixtures || docs.fixtures?.fixtures || docs.fixtures?.games || [];
  const selected = dateISO ? list.filter((f) => (f.dateISO || String(f.startUtc || '').slice(0, 10)) === dateISO) : list;
  const enriched = selected.map((f) => enrichIceHockeyFixture(f, docs));
  return scoreAndWriteIceHockey(enriched, { dateISO });
}

/**
 * Score and write an already-enriched list. Each match carries its own
 * `european` flag, so the league-specific total thresholds are applied per game
 * rather than to the whole card.
 */
export function scoreAndWriteIceHockey(enriched, { dateISO = null } = {}) {
  const scored = scoreIceHockeyCardMixed(enriched);
  const written = writeIceHockeyCard(scored.results, { dateISO });
  return { date: dateISO, sport: 'Ice Hockey', matches: enriched, scored, written };
}

/** Score + write a live browser-collected card (ESPN payloads fetched client side). */
export function buildIceHockeyCardFromLive({ fixtures, standings, injuries, goalies, tape, slate }, { dateISO = null } = {}) {
  const enriched = (fixtures || []).map((f) => enrichIceHockeyFixture(f, { standings, injuries, goalies, tape, slate }));
  return scoreAndWriteIceHockey(enriched, { dateISO });
}
