/**
 * SportsPred — ESPN payload parsers (pure, no I/O).
 *
 * WHAT THIS IS
 * ------------
 * ESPN operates public, key-less JSON endpoints that power espn.com. They are
 * the project's live source for the scoreboard, rankings and match history.
 * This module turns those payloads into the project's internal shapes. It is
 * imported by BOTH the browser collector and the Node test suite, so what the
 * site parses is exactly what is tested.
 *
 * RULES OF THIS FILE
 *  - Pure functions. No fetch, no clock, no randomness, no DOM.
 *  - Never invent a field. If ESPN does not publish it, the output is null and
 *    the caller records it as missing. In particular:
 *      * ESPN publishes NO betting odds for tennis (the odds $ref exists but
 *        returns an empty collection), so no price is ever produced here.
 *      * ESPN publishes NO court surface, so `surface` is always null from
 *        ESPN alone and must be resolved from data/surfaces.json.
 *  - Doubles and TBD placeholders are excluded: the prompt scores singles
 *    match-ups between two named players.
 *
 * VERIFIED ENDPOINT BEHAVIOUR (checked 2026-08-31)
 *  - GET site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/scoreboard?dates=YYYYMMDD
 *      -> { events: [ { name, groupings: [ { grouping, competitions: [...] } ] } ] }
 *      A tournament is one "event"; individual matches are "competitions".
 *  - GET site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/rankings
 *      -> { rankings: [ { ranks: [ { current, previous, points, athlete } ] } ] }
 *  - IRREGULARITY: the atp scoreboard also returns Women's Singles groupings
 *    (observed at the Nordea Open). The league slug is therefore NOT a
 *    reliable tour label; `tourOf` reads the grouping text instead.
 */

/** ESPN status states we treat as each phase. */
const STATE_PHASE = { pre: 'upcoming', in: 'live', post: 'results' };

/** Placeholder competitor ids ESPN uses for undecided draw slots. */
function isPlaceholder(c) {
  const n = (c?.athlete?.displayName || c?.name || '').trim().toUpperCase();
  return !n || n === 'TBD' || String(c?.id ?? '').startsWith('-');
}

/**
 * Tour label for a competition, from the grouping/type text rather than the
 * requested league slug. Returns 'ATP' | 'WTA' | null.
 */
export function tourOf(groupingSlug, competitionTypeText) {
  const s = `${groupingSlug ?? ''} ${competitionTypeText ?? ''}`.toLowerCase();
  if (s.includes('women')) return 'WTA';
  if (s.includes('men')) return 'ATP';
  return null;
}

/** True when this grouping/type is a singles draw (not doubles/mixed). */
export function isSingles(groupingSlug, competitionTypeText) {
  const s = `${groupingSlug ?? ''} ${competitionTypeText ?? ''}`.toLowerCase();
  if (!s.trim()) return false;
  return s.includes('singles') && !s.includes('doubles');
}

/**
 * Parse a set-score line into games won by each side.
 * ESPN gives linescores as [{value, tiebreak, winner}, ...] per competitor.
 * Returns null when the data is absent rather than assuming 0.
 */
export function setScores(aLines, bLines) {
  if (!Array.isArray(aLines) || !Array.isArray(bLines)) return null;
  const n = Math.min(aLines.length, bLines.length);
  if (!n) return null;
  const sets = [];
  for (let i = 0; i < n; i++) {
    const a = aLines[i]?.value;
    const b = bLines[i]?.value;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    sets.push({ a, b, aTiebreak: aLines[i]?.tiebreak ?? null, bTiebreak: bLines[i]?.tiebreak ?? null });
  }
  return sets.length ? sets : null;
}

/** Games margin (winner games - loser games) across completed sets. */
export function gamesMargin(sets, aWon) {
  if (!Array.isArray(sets) || !sets.length) return null;
  let a = 0; let b = 0;
  for (const s of sets) { a += s.a; b += s.b; }
  return aWon ? a - b : b - a;
}

/** Did the winner take it in straight sets? null when unknown. */
export function isStraightSets(sets, aWon) {
  if (!Array.isArray(sets) || !sets.length) return null;
  let aSets = 0; let bSets = 0;
  for (const s of sets) { if (s.a > s.b) aSets++; else if (s.b > s.a) bSets++; }
  if (aSets + bSets === 0) return null;
  return aWon ? bSets === 0 : aSets === 0;
}

/**
 * Normalise one ESPN competition into a match row.
 * @returns {object|null} null when the row is not a scoreable singles match.
 */
export function parseCompetition(comp, ctx) {
  if (!comp) return null;
  const { tournamentId, tournamentName, groupingSlug, leagueSlug } = ctx ?? {};
  const typeText = comp?.type?.text ?? null;
  if (!isSingles(groupingSlug, typeText)) return null;

  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  if (competitors.length !== 2) return null;
  if (competitors.some(isPlaceholder)) return null;

  // ESPN uses order 1 / order 2; sort for stability rather than trusting input.
  const [p1, p2] = [...competitors].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));

  const state = comp?.status?.type?.state ?? null;
  const phase = STATE_PHASE[state] ?? 'unknown';
  const completed = Boolean(comp?.status?.type?.completed);

  const sets = setScores(p1.linescores, p2.linescores);
  const p1Won = p1.winner === true;
  const p2Won = p2.winner === true;
  const winner = p1Won ? p1 : (p2Won ? p2 : null);

  const mk = (c) => ({
    espn_id: c?.id != null ? String(c.id) : null,
    name: c?.athlete?.displayName ?? c?.name ?? null,
    country: c?.athlete?.flag?.alt ?? null,
    seed: c?.tournamentSeed ?? null,
    winner: c?.winner === true ? true : (c?.winner === false ? false : null),
  });

  return {
    // Identity
    competition_id: comp.id != null ? String(comp.id) : null,
    tournament_id: tournamentId != null ? String(tournamentId) : null,
    tournament: tournamentName ?? null,
    league: leagueSlug ?? null,
    tour: tourOf(groupingSlug, typeText),
    round: comp?.round?.displayName ?? comp?.round?.description ?? null,
    // Scheduling
    start_utc: comp?.date ?? comp?.startDate ?? null,
    date: (comp?.date ?? comp?.startDate ?? '').slice(0, 10) || null,
    phase,
    completed,
    status_detail: comp?.status?.type?.description ?? null,
    best_of: comp?.format?.regulation?.periods ?? null,
    // Venue. ESPN gives a city string and an indoor flag but NOT a surface.
    venue: comp?.venue?.fullName ?? null,
    indoor: typeof comp?.venue?.indoor === 'boolean' ? comp.venue.indoor : null,
    surface: null, // never from ESPN — resolved via data/surfaces.json
    // Players and result
    players: [mk(p1), mk(p2)],
    winner_id: winner?.id != null ? String(winner.id) : null,
    winner_name: winner?.athlete?.displayName ?? winner?.name ?? null,
    sets,
    straight_sets: completed && winner ? isStraightSets(sets, p1Won) : null,
    games_margin: completed && winner ? gamesMargin(sets, p1Won) : null,
    first_set_winner_id: (() => {
      if (!sets || !sets.length) return null;
      const s = sets[0];
      if (s.a === s.b) return null;
      return s.a > s.b ? (p1.id != null ? String(p1.id) : null)
        : (p2.id != null ? String(p2.id) : null);
    })(),
    // Provenance
    source: 'espn',
    source_url: comp?.id
      ? `https://www.espn.com/tennis/scoreboard/_/eventId/${tournamentId ?? ''}`
      : null,
  };
}

/**
 * Parse a full scoreboard payload into match rows.
 * @param {object} payload  JSON from .../tennis/{league}/scoreboard
 * @param {string} leagueSlug  'atp' | 'wta' (recorded, not trusted for tour)
 */
export function parseScoreboard(payload, leagueSlug) {
  const out = [];
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const ev of events) {
    const tournamentName = ev?.name ?? null;
    const tournamentId = ev?.id ?? null;
    const groupings = Array.isArray(ev?.groupings) ? ev.groupings : [];
    for (const g of groupings) {
      const groupingSlug = g?.grouping?.slug ?? g?.grouping?.displayName ?? null;
      const comps = Array.isArray(g?.competitions) ? g.competitions : [];
      for (const c of comps) {
        const row = parseCompetition(c, {
          tournamentId, tournamentName, groupingSlug, leagueSlug,
        });
        if (row) out.push(row);
      }
    }
  }
  return out;
}

/**
 * Parse a rankings payload into { byId, byName, asOf }.
 * `trend` is ESPN's own movement string; rank direction is derived from
 * current vs previous, which the prompt asks for as "ranking trajectory".
 */
export function parseRankings(payload) {
  const byId = {};
  const byName = {};
  const groups = Array.isArray(payload?.rankings) ? payload.rankings : [];
  for (const g of groups) {
    const ranks = Array.isArray(g?.ranks) ? g.ranks : [];
    for (const r of ranks) {
      const a = r?.athlete;
      if (!a) continue;
      const current = typeof r.current === 'number' ? r.current : null;
      const previous = typeof r.previous === 'number' ? r.previous : null;
      let trajectory = null;
      if (current != null && previous != null && previous > 0) {
        if (current < previous) trajectory = 'rising';
        else if (current > previous) trajectory = 'falling';
        else trajectory = 'stable';
      }
      const rec = {
        espn_id: a.id != null ? String(a.id) : null,
        name: a.displayName ?? null,
        rank: current,
        previous,
        points: typeof r.points === 'number' ? r.points : null,
        trajectory,
      };
      if (rec.espn_id) byId[rec.espn_id] = rec;
      if (rec.name) byName[normaliseName(rec.name)] = rec;
    }
  }
  return { byId, byName, count: Object.keys(byId).length };
}

/** Case/accent-insensitive player key so ESPN and other sources can join. */
export function normaliseName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Build the per-player statistics the engine needs, from a tape of that
 * player's completed matches (most recent first) plus a surface resolver.
 *
 * Every output field is either computed from real rows or left null. There is
 * no default and no smoothing: a player with three recorded matches gets a
 * three-match denominator and the caller can see it in `sampleSizes`.
 *
 * @param {string} playerId          ESPN athlete id
 * @param {object[]} tape            completed match rows (parseCompetition shape)
 * @param {string|null} surface      surface of the upcoming match
 * @param {string} asOfISO           'YYYY-MM-DD'; only earlier matches are used
 */
export function buildPlayerStats(playerId, tape, surface, asOfISO) {
  const pid = String(playerId);
  const rows = (Array.isArray(tape) ? tape : [])
    .filter((m) => m?.completed && m?.date && m.date < asOfISO)
    .filter((m) => (m.players || []).some((p) => p.espn_id === pid))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (!rows.length) {
    return { form: null, surface: null, serve: null, rest: null, sampleSizes: { total: 0 } };
  }

  const won = (m) => m.winner_id === pid;
  const dayDiff = (iso) => Math.round(
    (Date.parse(`${asOfISO}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000,
  );

  // --- Recent form -------------------------------------------------------
  const last5 = rows.slice(0, 5).map((m) => (won(m) ? 'W' : 'L'));

  // Current-tournament streak: consecutive wins in the most recent event.
  let streak = 0;
  const latestTid = rows[0]?.tournament_id ?? null;
  for (const m of rows) {
    if (m.tournament_id !== latestTid) break;
    if (!won(m)) break;
    streak++;
  }

  // --- Surface split -----------------------------------------------------
  let surfaceStats = null;
  if (surface) {
    const yearAgo = new Date(Date.parse(`${asOfISO}T00:00:00Z`) - 365 * 86400000)
      .toISOString().slice(0, 10);
    const onSurface = rows.filter((m) => m.surface === surface && m.date >= yearAgo);
    if (onSurface.length) {
      const wins = onSurface.filter(won).length;
      const winRows = onSurface.filter(won);
      const bigWins = winRows.filter((m) => (m.games_margin ?? 0) >= 6).length;
      surfaceStats = {
        surface,
        wins,
        losses: onSurface.length - wins,
        matches: onSurface.length,
        bigWins,
        // Shape the engine reads for the handicap "surface dominance" factor:
        // how many of the recent wins were by 6+ games. Only reported when
        // there is at least one win to measure, never as an assumed zero.
        dominantMarginGames: winRows.length
          ? { bigWins, of: winRows.length }
          : null,
        // First-set rate restricted to this surface, when the sample supports it.
        firstSetWinRateLast10: (() => {
          const pool = onSurface.filter((m) => m.first_set_winner_id != null).slice(0, 10);
          if (pool.length < 5) return null;
          return pool.filter((m) => m.first_set_winner_id === pid).length / pool.length;
        })(),
        // "Documented poor record on this surface", read as a losing record
        // over a meaningful sample. Requires >=4 matches so a 0-1 record does
        // not masquerade as a documented weakness.
        poorRecordOnSurface: onSurface.length >= 4
          ? wins / onSurface.length < 0.4
          : null,
      };
    }
  }

  // --- First set / straight sets ----------------------------------------
  const withFirstSet = rows.filter((m) => m.first_set_winner_id != null);
  const surfaceFirstSet = surface
    ? withFirstSet.filter((m) => m.surface === surface).slice(0, 10)
    : [];
  const fsPool = surfaceFirstSet.length >= 5 ? surfaceFirstSet : withFirstSet.slice(0, 10);
  const firstSetWinRateLast10 = fsPool.length
    ? fsPool.filter((m) => m.first_set_winner_id === pid).length / fsPool.length
    : null;

  // The engine reads `form.straightSetsLast3` as an ARRAY OF BOOLEANS over the
  // last three matches (most recent first), not a count. Only produced when
  // there are genuinely three recent matches to report.
  const last3 = rows.slice(0, 3);
  const straightSetsLast3 = last3.length === 3
    ? last3.map((m) => won(m) && m.straight_sets === true)
    : null;

  // --- Rest / scheduling -------------------------------------------------
  const lastMatch = rows[0];
  const daysSince = lastMatch?.date ? dayDiff(lastMatch.date) : null;
  const lastSets = Array.isArray(lastMatch?.sets) ? lastMatch.sets.length : null;
  const rest = {
    daysSinceLastMatch: daysSince,
    lastMatchSets: lastSets,
    // "Played a 3-set match within 24 hours": derivable from the recorded date
    // and set count. Dates are day-granular, so "within 24 hours" is read as
    // the previous calendar day or the same day.
    played3SetsLast24h: (daysSince != null && lastSets != null)
      ? (daysSince <= 1 && lastSets >= 3)
      : null,
    // No free structured source reports physical concerns, so this stays
    // unsourced forever rather than being inferred from retirements. IR-13.
    physicalConcernCited: null,
  };

  return {
    form: {
      last5: last5.length === 5 ? last5 : null,
      last5Partial: last5.length < 5 ? last5 : null,
      tournamentWinStreak: streak,
      firstSetWinRateLast10,
      straightSetsLast3,
      // The engine reads this on the OPPONENT: did they lose their last match
      // in straight sets? False when they won it; null only when unknown.
      lastMatchStraightSetLoss: lastMatch
        ? (!won(lastMatch) && lastMatch.straight_sets === true)
        : null,
      // Whether the player has beaten a higher-ranked opponent in the current
      // event cannot be established without each opponent's rank at the time;
      // ESPN's scoreboard does not carry it. Left unsourced. IR-17.
      beatHigherRankedThisEvent: null,
      // "Documented history of slow starts" has no free structured source.
      documentedSlowStarter: null,
    },
    surface: surfaceStats,
    // ESPN's tennis scoreboard ships `statistics: []` on competitors, so serve
    // percentages and ace counts are NOT available. Left null deliberately.
    serve: null,
    rest,
    sampleSizes: {
      total: rows.length,
      onSurface: surfaceStats?.matches ?? 0,
      firstSetPool: fsPool.length,
    },
  };
}

/**
 * Head-to-head between two players from a shared tape.
 * Returns null when the pair has no recorded meeting.
 */
export function buildH2H(idA, idB, tape, surface) {
  const a = String(idA); const b = String(idB);
  const rows = (Array.isArray(tape) ? tape : []).filter((m) => {
    if (!m?.completed) return false;
    const ids = (m.players || []).map((p) => p.espn_id);
    return ids.includes(a) && ids.includes(b);
  });
  if (!rows.length) return null;
  const aWins = rows.filter((m) => m.winner_id === a).length;
  const onSurf = surface ? rows.filter((m) => m.surface === surface) : [];
  return {
    matches: rows.length,
    aWins,
    bWins: rows.length - aWins,
    surface: surface ?? null,
    surfaceMatches: onSurf.length,
    surfaceAWins: onSurf.filter((m) => m.winner_id === a).length,
    lastMeeting: rows[0]?.date ?? null,
  };
}
