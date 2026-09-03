/**
 * SportsPred — Darts profiles, head-to-head and ranking lookups.
 *
 * Pure: the caller supplies the committed source-linked tape
 * (data/darts_results.json), the OLBG slate (data/darts_slate.json) and
 * the PDC Order of Merit snapshot (data/darts_rankings.json). Nothing here
 * fetches and nothing is estimated.
 *
 * LEAK-FREE RULE: a match can only ever be scored from completed matches
 * that finished strictly before it. A match's effective order key is its
 * observed date when known, otherwise its event end date plus its round
 * index (knock-out round order equals chronological order).
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
  if (/(^|\s|-)final|finals?\b/.test(r) && !/quarter|semi/.test(r)) return 'final';
  if (/(^|\s|-)semi|\bsf\b|semi-?final/.test(r)) return 'semi';
  if (/(quarter|qf)/.test(r)) return 'qf';
  if (/(last 16|r16|round of 16|third round|round 3)/.test(r)) return 'r16';
  if (/qual/.test(r)) return 'qual';
  if (/(last 32|r32|round of 32|second round|round 2)/.test(r)) return 'r32';
  if (/(last 64|r64|first round|round 1|last 48)/.test(r)) return 'r64';
  return 'early';
}

function averageFor(m, playerName) {
  if (m.player_a?.name === playerName && Number.isFinite(m.average_a)) return m.average_a;
  if (m.player_b?.name === playerName && Number.isFinite(m.average_b)) return m.average_b;
  return null;
}

/**
 * Build the profile Step 1 needs for one player.
 * @param {Array} matches  completed tape rows, newest-first (matchesBefore output)
 * @param {object} opts { playerName, eventName }
 */
export function buildPlayerProfile(matches, { playerName, eventName = null } = {}) {
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
    average: averageFor(m, playerName),
  }));
  const wins = last5.filter((m) => m.winner === playerName).length;
  const losses = last5.filter((m) => m.winner && m.winner !== playerName).length;
  const draws = last5.length - wins - losses;

  const inTournament = own
    .filter((m) => !eventName || String(m.event || '').toLowerCase() === String(eventName).toLowerCase())
    .map((m) => ({ winner: m.winner, opponent: null }));

  const lastAverage = last5.map((m) => m.average).find((v) => Number.isFinite(v) && v > 0) ?? null;

  return {
    name: playerName,
    last5,
    wins,
    losses,
    draws,
    matchCount: last5.length,
    inTournament,
    inTournamentWins: inTournament.filter((m) => m.winner === playerName).length,
    lastAverage,
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
  const tally = {
    a: nameA, b: nameB, aWins: 0, bWins: 0, draws: 0, total: meetings.length,
    last3Years: { aWins: 0, bWins: 0, total: 0 },
  };
  for (const m of meetings) {
    const winner = m.winner;
    if (!winner) continue;
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

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Look up a player's official PDC Order of Merit rank. */
export function rankFor(rankingsDoc, name) {
  const n = normName(name);
  if (!n) return null;
  const entry = (rankingsDoc?.entries || []).find((e) => {
    const eName = normName(e.name);
    return eName === n || eName.includes(n) || n.includes(eName);
  });
  return entry ? Number(entry.rank) : null;
}

export function isUnranked(rankingsDoc, name) {
  return rankFor(rankingsDoc, name) === null;
}

/**
 * Turn a normalised slate fixture into engine input.
 * `docs` = { tape, rankings, asOfISO }.
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

/** Split "Player A v Player B" / "Player A vs Player B". */
export function splitMatchup(matchup) {
  const m = String(matchup || '').match(/^(.+?)\s+v(?:s)?\.?\s+(.+)$/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

/** Slate events -> normalised fixtures (only two-player match events). */
export function fixturesFromSlate(slateDoc) {
  const fixtures = [];
  for (const e of slateDoc?.events || []) {
    if (e.type === 'outright') continue;
    let playerA = e.playerA;
    let playerB = e.playerB;
    if ((!playerA || !playerB) && e.matchup) {
      const split = splitMatchup(e.matchup);
      if (split) {
        playerA = playerA || { name: split.a };
        playerB = playerB || { name: split.b };
      }
    }
    if (!playerA?.name || !playerB?.name) continue;
    fixtures.push({
      id: e.event_id ? `olbg-${e.event_id}` : (e.id || `darts-${slateDoc?.source?.fetched_at_utc || 'n/a'}`),
      dateISO: e.dateISO || e.resolved_date || null,
      startUtc: e.start_utc || null,
      event: e.tournament || e.event || null,
      round: e.round || 'Round 1',
      roundTier: e.roundTier || null,
      bestOf: e.best_of ?? e.bestOf ?? null,
      venue: e.venue || null,
      status: e.status || 'scheduled',
      playerA,
      playerB,
      sourceUrls: [e.url, slateDoc?.source?.url].filter(Boolean),
      olbg: e.olbg || e.consensus || null,
    });
  }
  return fixtures;
}

/** Tape row -> engine match shape, so historical leans can be written. */
export function fixtureFromTapeRow(row) {
  return {
    id: row.id,
    dateISO: row.date || row.event_end || null,
    date: row.date || row.event_end || null,
    event: row.event || null,
    round: row.round || null,
    roundTier: row.round_tier || roundTierFor(row.round),
    bestOf: row.best_of ?? null,
    venue: row.venue || null,
    status: 'result',
    playerA: { name: row.player_a?.name, country: row.player_a?.country, rank: row.player_a?.rank },
    playerB: { name: row.player_b?.name, country: row.player_b?.country, rank: row.player_b?.rank },
    sourceUrls: row.source_urls || [],
    round_index: row.round_index,
    event_end: row.event_end,
  };
}
