/**
 * SportsPred — Baseball data layer: joins sourced documents into the shape the
 * scoring engine consumes.
 *
 * THE ONE RULE: this file never fills a gap. If a document does not carry a
 * value the field stays null, the engine records it in `missing[]`, and the
 * confidence caps in Step 3 apply. There is no default anywhere in here.
 *
 * Documents (all built by the collectors in scripts/, all provenance-tagged):
 *   data/baseball_fixtures.json   upcoming + settled fixtures (MLB StatsAPI + ESPN)
 *   data/baseball_tape.json       results tape used for form, run diff, H2H, margins
 *   data/baseball_standings.json  official MLB standings snapshot
 *   data/baseball_team_stats.json hitting + pitching season team stats
 *   data/baseball_pitchers.json   probable-starter profiles (season + last 4 starts)
 *   data/baseball_slate.json      OLBG baseball market rows (display + join)
 */

import { scoreBaseballCard } from './baseball_engine.js';
import { writeBaseballCard } from './baseball_writer.js';
import {
  scheduleFactors, headToHeadFromTape, normalizeAbbrev,
} from './baseball_espn.js';

const round = (n, dp = 3) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function normalizeTeamName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '');
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round(Math.abs(da - db) / 86400000);
}

/** Match an OLBG slate row against a fixture by team names. */
export function matchSlateEvent(fixture, slateDoc) {
  if (!slateDoc || !Array.isArray(slateDoc.events)) return null;
  const h = normalizeTeamName(fixture.home?.name || '');
  const a = normalizeTeamName(fixture.away?.name || '');
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

function findStandings(standingsTeams, id, abbrev) {
  if (!standingsTeams) return null;
  if (id != null && standingsTeams[id]) return standingsTeams[id];
  const key = normalizeAbbrev(abbrev);
  for (const v of Object.values(standingsTeams)) {
    if (key && normalizeAbbrev(v.name) === key) return v;
  }
  return null;
}

function findTeamStats(teamStatsTeams, id, abbrev) {
  if (!teamStatsTeams) return null;
  if (id != null && teamStatsTeams[id]) return teamStatsTeams[id];
  const key = normalizeAbbrev(abbrev);
  for (const v of Object.values(teamStatsTeams)) {
    if (key && normalizeAbbrev(v.name) === key) return v;
  }
  return null;
}

function findPitcher(pitchersDoc, id, name) {
  const map = pitchersDoc?.pitchers || pitchersDoc || {};
  if (id != null && map[id]) return map[id];
  if (name) {
    for (const v of Object.values(map)) {
      if (v && normalizeTeamName(v.name) === normalizeTeamName(name)) return v;
    }
  }
  return null;
}

/**
 * Build one engine-ready match from a fixture plus the sourced documents.
 * Returns the enriched match; missing inputs stay null.
 */
export function enrichBaseballFixture(fixture, docs = {}) {
  const standingsTeams = docs.standings?.teams || {};
  const teamStatsTeams = docs.teamStats?.teams || {};
  const pitchers = docs.pitchers || {};
  const tape = docs.tape?.games || docs.tape || [];
  const startUtc = fixture.startUtc || (fixture.dateISO ? `${fixture.dateISO}T00:00:00Z` : null);

  const buildSide = (raw, sideKey) => {
    const abbrev = normalizeAbbrev(raw?.abbrev);
    const id = raw?.id ?? null;
    const standings = findStandings(standingsTeams, id, abbrev);
    const teamStats = findTeamStats(teamStatsTeams, id, abbrev);
    const sched = abbrev ? scheduleFactors(tape, abbrev, startUtc) : null;

    // Season run differential per game from the standings snapshot.
    const gp = standings?.gamesPlayed ?? null;
    const seasonRunDiffPerGame = standings?.runDifferential != null && gp
      ? round(standings.runDifferential / gp, 3)
      : null;

    // Starter profile: announced probable pitcher (MLB) + season/game-log stats.
    const pp = raw?.probablePitcher ?? null;
    const pitcher = pp ? findPitcher(pitchers, pp.id, pp.name) : null;
    const espnStarter = sideKey === 'home' ? fixture.espn?.home?.starter : fixture.espn?.away?.starter;
    let starter = null;
    if (pp || pitcher || espnStarter) {
      const era = pitcher?.era ?? espnStarter?.era ?? null;
      const last4 = pitcher?.last4 ?? [];
      const last4Dates = last4.map((s) => s.date);
      const shortRest = last4Dates.length >= 2 ? daysBetween(last4Dates[0], last4Dates[1]) <= 4 : null;
      const pitchesLast2 = last4.length >= 2 && last4[0].pitches != null && last4[0].pitches >= 100
        && last4[1].pitches != null && last4[1].pitches >= 100;
      starter = {
        name: pp?.name ?? pitcher?.name ?? espnStarter?.name ?? null,
        id: pp?.id ?? pitcher?.id ?? null,
        confirmed: pp ? true : false,
        era: era != null ? round(era, 2) : null,
        whip: pitcher?.whip != null ? round(pitcher.whip, 2) : null,
        strikeoutsPer9: pitcher?.strikeoutsPer9 != null ? round(pitcher.strikeoutsPer9, 2) : null,
        wins: pitcher?.wins ?? espnStarter?.wins ?? null,
        losses: pitcher?.losses ?? espnStarter?.losses ?? null,
        qualityStartsLast4: pitcher?.qualityStartsLast4 ?? null,
        qualityStartsLast3: pitcher?.qualityStartsLast3 ?? null,
        avgInningsPerStart: pitcher?.avgInningsPerStart ?? null,
        last4: pitcher?.last4 ?? [],
        shortRest,
        pitchesLast2,
        source: pitcher ? 'mlb-person-gameLog' : espnStarter ? 'espn-scoreboard-probable' : 'mlb-probable-pitcher',
      };
    }

    const record = raw?.record
      ? { wins: raw.record.wins, losses: raw.record.losses, pct: raw.record.pct != null ? round(raw.record.pct, 3) : null }
      : standings ? { wins: standings.wins, losses: standings.losses } : null;
    const recordSummary = record?.wins != null && record?.losses != null ? `${record.wins}-${record.losses}` : null;

    const espnSide = sideKey === 'home' ? fixture.espn?.home : fixture.espn?.away;

    return {
      name: raw?.name ?? null,
      abbrev,
      id,
      logo: raw?.logo ?? null,
      record,
      recordSummary,
      homeRecord: espnSide?.records?.home ?? null,
      roadRecord: espnSide?.records?.road ?? null,
      // last-month measures (from the tape, leak-free)
      runDiffPerGame: sched?.runDiffPerGame ?? null,
      runsPerGameRecent: sched?.runsPerGameRecent ?? null,
      runsAgainstPerGameRecent: sched?.runsAgainstPerGameRecent ?? null,
      // season measures
      seasonRunDiffPerGame,
      seasonRunsPerGame: standings?.runsScored != null && gp ? round(standings.runsScored / gp, 3) : null,
      seasonRunsAgainstPerGame: standings?.runsAllowed != null && gp ? round(standings.runsAllowed / gp, 3) : null,
      avg: teamStats?.hitting?.avg ?? null,
      obp: teamStats?.hitting?.obp ?? null,
      slg: teamStats?.hitting?.slg ?? null,
      teamEra: teamStats?.pitching?.era ?? null,
      teamWhip: teamStats?.pitching?.whip ?? null,
      // bullpen factors: no key-less feed isolates relievers -> null
      bullpenRank: null,
      bullpenLeagueSize: null,
      bullpenFatigue: null,
      vsStarterHandednessAvg: null,
      form: sched?.form ?? null,
      avgWinMarginLast5Wins: sched?.avgWinMarginLast5Wins ?? null,
      recentTotals: null, // requires a posted line, which no key-less feed provides
      starter,
      odds: null,
      provenance: {
        standings: standings ? 'mlb-standings' : null,
        teamStats: teamStats ? 'mlb-team-stats' : null,
        schedule: sched ? 'mlb-schedule-tape' : null,
        starter: starter?.source ?? null,
      },
    };
  };

  const home = buildSide(fixture.home, 'home');
  const away = buildSide(fixture.away, 'away');

  return {
    ...fixture,
    league: fixture.league ?? 'mlb',
    leagueName: fixture.leagueName ?? 'Major League Baseball',
    dateISO: fixture.dateISO ?? (startUtc ? String(startUtc).slice(0, 10) : null),
    startUtc,
    venueIndoor: fixture.venueIndoor ?? fixture.espn?.venueIndoor ?? null,
    weather: fixture.espn?.weather ?? null,
    temperature: fixture.espn?.temperature ?? null,
    wind: null, // no key-less feed publishes wind direction/speed
    h2h: home.abbrev && away.abbrev ? headToHeadFromTape(tape, home.abbrev, away.abbrev, startUtc) : null,
    olbg: matchSlateEvent(fixture, docs.slate),
    oddsSourceCount: fixture.oddsSourceCount ?? 0,
    home,
    away,
  };
}

/** Build, score and write a full card from the committed documents. */
export function buildBaseballCard(docs, { dateISO = null, fixtures = null } = {}) {
  const list = fixtures || docs.fixtures?.fixtures || [];
  const selected = dateISO ? list.filter((f) => (f.dateISO || String(f.startUtc || '').slice(0, 10)) === dateISO) : list;
  const enriched = selected.map((f) => enrichBaseballFixture(f, docs));
  return scoreAndWriteBaseball(enriched, { dateISO });
}

/** Score and write an already-enriched list. */
export function scoreAndWriteBaseball(enriched, { dateISO = null } = {}) {
  const scored = scoreBaseballCard(enriched);
  const written = writeBaseballCard(scored.results, { dateISO });
  return { date: dateISO, sport: 'Baseball', matches: enriched, scored, written };
}
