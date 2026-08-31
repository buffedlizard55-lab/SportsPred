/**
 * SportsPred — join layer between collected data and the scoring engine.
 *
 * Kept out of the DOM controller so the join is covered by the same test suite
 * as the engine. Nothing here invents a value: if a statistic is absent from
 * the players store the field stays null and the engine records it as missing.
 */

/** Lowercased lookup key for a player name. */
export function playerKey(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * @param {object} ev        one event row from data/slate.json
 * @param {object} store     parsed data/players.json
 * @returns {object}         engine match object
 */
export function toMatch(ev, store) {
  const players = store?.players ?? {};
  const h2h = store?.h2h ?? {};

  const mk = (name) => {
    const s = players[playerKey(name)] ?? {};
    return {
      name,
      rank: s.rank ?? null,
      odds: s.odds ?? null,
      firstSetOdds: s.firstSetOdds ?? null,
      handicapOdds: s.handicapOdds ?? null,
      form: s.form ?? null,
      surface: s.surface ?? null,
      serve: s.serve ?? null,
      rest: s.rest ?? null,
    };
  };

  const a = mk(ev.home);
  const b = mk(ev.away);

  // The handicap factor compares the favourite against the opponent's rank.
  let opponentRank = null;
  if (a.rank != null && b.rank != null) opponentRank = a.rank <= b.rank ? b.rank : a.rank;
  else if (b.rank != null) opponentRank = b.rank;
  else if (a.rank != null) opponentRank = a.rank;

  return {
    event_id: ev.event_id,
    players: [a, b],
    surface: ev.surface ?? null,
    tournament: (ev.tournament || ev.round) ? { level: ev.tournament, round: ev.round } : null,
    h2h: h2h[ev.event_id] ?? null,
    opponentRank,
    url: ev.url ?? null,
    consensus: ev.consensus ?? null,
    display: `${ev.display_date} ${ev.display_time}`,
    resolved_date: ev.resolved_date ?? null,
    home: ev.home,
    away: ev.away,
  };
}

/** Map a whole slate to engine inputs. */
export function slateToMatches(slate, store) {
  return (slate?.events ?? []).map((ev) => toMatch(ev, store));
}

/**
 * Phase of an event relative to a reference date (ISO yyyy-mm-dd).
 * The snapshot carries no live scores and no settled results, so this only
 * distinguishes upcoming from past-due. It never claims a live score.
 */
export function phaseOf(ev, todayISO) {
  if (!ev?.resolved_date) return 'unknown';
  return ev.resolved_date < todayISO ? 'results' : 'upcoming';
}
