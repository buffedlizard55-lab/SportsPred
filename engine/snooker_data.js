/**
 * SportsPred — Snooker profiles, head-to-head and ranking lookups.
 *
 * Pure: the caller supplies the committed source-linked tape
 * (data/snooker_results.json), the OLBG slate (data/snooker_slate.json) and
 * the official WST ranking snapshot (data/snooker_rankings.json). Nothing here
 * fetches and nothing is estimated.
 *
 * LEAK-FREE RULE (same as every other sport in this repo): a match can only
 * ever be scored from completed matches that finished strictly before it.
 * A match's effective order key is its observed date when known, otherwise its
 * event end date plus its round index (knock-out round order equals
 * chronological order), which is recorded explicitly in the tape rather than
 * guessed.
 */

/** Effective chronology key for a tape row (ascending = earlier). */
export function sortKey(m) {
  const day = m.date || m.event_end || '0000-00-00';
  const idx = Number.isFinite(m.round_index) ? m.round_index : 0;
  return `${day}~${String(idx).padStart(3, '0')}~${m.id || ''}`;
}

/** Completed matches, ascending by chronology. */
export function completedMatches(tape) {
  return (tape?.matches || [])
    .filter((m) => {
      if (!m) return false;
      if (m.winner) return true;
      // A completed match with no declared winner (draw) must have frames
      // on the board; a 0-0 row with no winner is an unplayed fixture.
      return Number.isFinite(m.score_a) && Number.isFinite(m.score_b) && (m.score_a > 0 || m.score_b > 0);
    })
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
}

/** Matches strictly before the target fixture, newest first. */
export function matchesBefore(tape, target) {
  const key = sortKey(target);
  return completedMatches(tape)
    .filter((m) => m.id !== target.id && sortKey(m) < key)
    .reverse();
}

/** Tournament-stage tier for a round label. */
export function roundTierFor(round) {
  const r = String(round || '').toLowerCase();
  if (/(quarter|qf)/.test(r)) return 'qf';
  if (/(^|\s|-)semi|\bsf\b|semi-?final/.test(r)) return 'semi';
  if (/(^|\s|-)final|\bfinals?\b/.test(r)) return 'final';
  if (/(quarter|qf)/.test(r)) return 'qf';
  if (/(last 16|r16|round of 16|16ths)/.test(r)) return 'r16';
  if (/qual/.test(r)) return 'qual';
  if (/(last 32|r32|round of 32|32nds)/.test(r)) return 'r32';
  return 'early';
}

/**
 * Build the profile Step 1 needs for one player.
 * @param {Array} matches  completed tape rows, newest-first (matchesBefore output)
 * @param {object} opts { playerName, eventName }
 */
export function buildPlayerProfile(matches, { playerName, eventName = null } = {}) {
  // A player's profile contains ONLY that player's matches; rows involving
  // other players in the tape are never counted.
  const own = (matches || []).filter((m) => {
    const a = m.player_a?.name;
    const b = m.player_b?.name;
    return a === playerName || b === playerName;
  });
  const last5 = own.slice(0, 5).map((m) => ({
    id: m.id,
    date: m.date,
    event: m.event,
    round: m.round,
    opponent: (m.player_a?.name === playerName ? m.player_b?.name : m.player_a?.name) ?? null,
    scoreFor: m.player_a?.name === playerName ? m.score_a : m.score_b,
    scoreAgainst: m.player_a?.name === playerName ? m.score_b : m.score_a,
    winner: m.winner,
  }));
  const wins = last5.filter((m) => m.winner === playerName).length;
  const losses = last5.filter((m) => m.winner && m.winner !== playerName).length;
  const draws = last5.length - wins - losses;

  const inTournament = own
    .filter((m) => !eventName || String(m.event || '').toLowerCase() === String(eventName).toLowerCase())
    .map((m) => ({ winner: m.winner, opponent: null }));

  return {
    name: playerName,
    last5,
    wins,
    losses,
    draws,
    matchCount: last5.length,
    inTournament,
    inTournamentWins: inTournament.filter((m) => m.winner === playerName).length,
  };
}

/**
 * Head-to-head between two players, all time and last-three-years, using only
 * completed matches before the target fixture.
 */
export function h2hBetween(matches, nameA, nameB, { asOfISO = null } = {}) {
  const cutoff = asOfISO ? asOfUTCDate(asOfISO, -3 * 365) : null;
  const meetings = matches.filter((m) => {
    const a = m.player_a?.name;
    const b = m.player_b?.name;
    return (a === nameA && b === nameB) || (a === nameB && b === nameA);
  });
  const tally = { a: nameA, b: nameB, aWins: 0, bWins: 0, draws: 0, total: meetings.length, last3Years: { aWins: 0, bWins: 0, total: 0 } };
  for (const m of meetings) {
    const winner = m.winner;
    if (!winner) continue;
    // nameA/nameB are the requested players; the tape row may list them in
    // either order, so tally purely on which requested name won.
    const wonA = winner === nameA;
    if (wonA) tally.aWins += 1; else tally.bWins += 1;
    const when = m.date || m.event_end || null;
    if (cutoff && when && when >= cutoff) {
      tally.last3Years.total += 1;
      if (wonA) tally.last3Years.aWins += 1; else tally.last3Years.bWins += 1;
    }
  }
  return tally;
}

function asOfUTCDate(iso, deltaDays) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Look up a player's official world rank in the WST snapshot. */
export function rankFor(rankingsDoc, name) {
  const entry = (rankingsDoc?.entries || []).find((e) => {
    const eName = String(e.name || '').toLowerCase();
    const n = String(name || '').toLowerCase();
    return eName === n || eName.includes(n) || n.includes(eName);
  });
  return entry ? Number(entry.rank) : null;
}

/** True when the player is not on the official ranking list. */
export function isUnranked(rankingsDoc, name) {
  return rankFor(rankingsDoc, name) === null;
}

/**
 * Turn a normalised slate fixture into engine input. `docs` = 
 * { tape, rankings, asOfISO }. Returns { match, profiles, h2h, roundTier }.
 */
export function prepareFixture(fx, docs = {}) {
  const tape = docs.tape || { matches: [] };
  const asOfISO = docs.asOfISO || fx.asOfISO || fx.startUtc?.slice(0, 10) || fx.dateISO || null;
  const prior = matchesBefore(tape, { ...fx, date: fx.dateISO || fx.date || null, id: fx.id });
  const roundTier = roundTierFor(fx.round) || fx.roundTier;
  const match = {
    ...fx,
    date: fx.dateISO || fx.date || null,
    roundTier,
    playerA: { ...fx.playerA, rank: fx.playerA?.rank ?? rankFor(docs.rankings, fx.playerA?.name) },
    playerB: { ...fx.playerB, rank: fx.playerB?.rank ?? rankFor(docs.rankings, fx.playerB?.name) },
  };
  return {
    match,
    profiles: {
      a: buildPlayerProfile(prior, { playerName: match.playerA.name, eventName: match.event }),
      b: buildPlayerProfile(prior, { playerName: match.playerB.name, eventName: match.event }),
    },
    h2h: h2hBetween(prior, match.playerA.name, match.playerB.name, { asOfISO }),
    roundTier,
  };
}

/** Slate events -> normalised fixtures (only events with two players). */
export function fixturesFromSlate(slateDoc) {
  const fixtures = [];
  for (const e of slateDoc?.events || []) {
    if (!e.playerA || !e.playerB) continue;
    fixtures.push({
      id: e.event_id ? `olbg-${e.event_id}` : `snk-${slateDoc?.source?.fetched_at_utc || 'n/a'}`,
      dateISO: e.dateISO || e.resolved_date || null,
      startUtc: e.start_utc || null,
      event: e.tournament || null,
      round: e.round || 'Round 1',
      roundTier: e.roundTier || null,
      bestOf: e.best_of ?? null,
      venue: e.venue || null,
      status: e.status || 'scheduled',
      playerA: e.playerA,
      playerB: e.playerB,
      sourceUrls: [e.url, slateDoc?.source?.url].filter(Boolean),
      olbg: e.olbg || null,
    });
  }
  return fixtures;
}
