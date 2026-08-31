/**
 * SportsPred — tournament level and round coding (pure).
 *
 * The engine scores "Tournament Stage and Context" using coded levels
 * ('GS', 'M1000', 'W1000', 'Q', 'CH', 'ITF', ...) and coded rounds
 * ('R128'..'QF','SF','F'). ESPN publishes human-readable strings such as
 * "US Open" and "Quarterfinals", so they must be mapped.
 *
 * HONESTY RULES
 *  - The four Grand Slams are identified by name because that set is closed,
 *    fixed and publicly verifiable; it is listed explicitly below.
 *  - Everything else is coded ONLY from evidence in the payload (an explicit
 *    "Qualifying"/"Challenger"/"ITF" label) or from the Sackmann surface map's
 *    recorded `tourney_level` codes, which come from match data.
 *  - When the level cannot be established from evidence it is returned as
 *    null, the engine records the factor as missing, and the score drops.
 *    A tournament is never promoted to Masters level on a hunch.
 */

/** The four majors. A closed, stable set — safe to name explicitly. */
export const GRAND_SLAMS = ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open'];

/** Sackmann `tourney_level` codes -> engine level codes. */
const SACKMANN_LEVEL = {
  G: 'GS',   // Grand Slam
  M: 'M1000', // Masters 1000
  A: 'A',    // ATP Tour (500/250 not distinguished in the source)
  D: 'D',    // Davis Cup
  F: 'F',    // Tour Finals
  C: 'CH',   // Challenger
  S: 'ITF',  // Satellite / ITF
  O: 'O',    // Olympics
  P: 'W1000', // WTA Premier / 1000
  PM: 'W1000',
  I: 'A',    // WTA International
};

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Code the tournament level.
 * @param {string} name        ESPN tournament name
 * @param {string|null} round  ESPN round label (may mark qualifying)
 * @param {object|null} surfaceEntry  matching entry from data/surfaces.json
 * @returns {{level: string|null, basis: string}}
 */
export function codeLevel(name, round, surfaceEntry) {
  const n = norm(name);
  const r = norm(round);

  if (r.includes('qualif')) return { level: 'Q', basis: 'round labelled qualifying' };
  if (n.includes('challenger')) return { level: 'CH', basis: 'name states challenger' };
  if (/\bitf\b|\bw\d{2,3}\b|\bm\d{2,3}\b/.test(n)) return { level: 'ITF', basis: 'name states ITF tier' };

  if (GRAND_SLAMS.includes(n)) return { level: 'GS', basis: 'grand slam (fixed, named set)' };

  // Fall back to the level codes recorded alongside the surface data.
  const levels = surfaceEntry?.levels;
  if (Array.isArray(levels) && levels.length) {
    // Prefer the most significant code present.
    for (const code of ['G', 'F', 'M', 'PM', 'P', 'O', 'D', 'A', 'I', 'C', 'S']) {
      if (levels.includes(code) && SACKMANN_LEVEL[code]) {
        return { level: SACKMANN_LEVEL[code], basis: `recorded tourney_level "${code}" in source match data` };
      }
    }
  }
  return { level: null, basis: 'no evidence of tour level in any source' };
}

/**
 * Code the round label.
 * @returns {{round: string|null, basis: string}}
 */
export function codeRound(round) {
  const r = norm(round);
  if (!r) return { round: null, basis: 'no round published' };
  if (r.includes('qualif')) {
    return { round: 'Q', basis: 'qualifying round' };
  }
  if (r === 'final' || r === 'finals') return { round: 'F', basis: 'explicit' };
  if (r.includes('semi')) return { round: 'SF', basis: 'explicit' };
  if (r.includes('quarter')) return { round: 'QF', basis: 'explicit' };
  const m = r.match(/round (?:of )?(\d+)/) || r.match(/^r(\d+)$/);
  if (m) {
    const v = Number(m[1]);
    // "Round 1/2/3" is a sequence label; "Round of 16/32" is a draw size.
    if (r.includes('round of')) return { round: `R${v}`, basis: 'draw-size round' };
    const seq = { 1: 'R128', 2: 'R64', 3: 'R32', 4: 'R16' };
    if (seq[v]) return { round: seq[v], basis: 'sequence round mapped to draw position' };
    return { round: `R${v}`, basis: 'numeric round' };
  }
  if (r.includes('round of 16')) return { round: 'R16', basis: 'explicit' };
  return { round: null, basis: `unrecognised round label "${round}"` };
}

/**
 * Full stage coding for a match row.
 * @returns {{level, round, basis: {level: string, round: string}}}
 */
export function codeStage(name, round, surfaceEntry) {
  const l = codeLevel(name, round, surfaceEntry);
  const r = codeRound(round);
  return { level: l.level, round: r.round, basis: { level: l.basis, round: r.basis } };
}

/**
 * Head-to-head shaped for the engine, which asks specifically:
 * "did the LOWER-RANKED player win 2+ of the last 3 same-surface meetings?"
 *
 * @param {object|null} h2h   output of buildH2H (a = playerA)
 * @param {number|null} rankA
 * @param {number|null} rankB
 */
export function h2hForEngine(h2h, rankA, rankB) {
  if (!h2h) return null;
  if (rankA == null || rankB == null) {
    // Without both ranks "lower-ranked" is undefined; report the raw record
    // only, leaving the engine's field unsourced rather than guessing.
    return { ...h2h, sameSurfaceLowerRankedWonOfLast3: null };
  }
  if (!h2h.surfaceMatches) return { ...h2h, sameSurfaceLowerRankedWonOfLast3: null };
  const aIsLower = rankA > rankB; // higher number = lower ranked
  const lowerWins = aIsLower ? h2h.surfaceAWins : h2h.surfaceMatches - h2h.surfaceAWins;
  return { ...h2h, sameSurfaceLowerRankedWonOfLast3: Math.min(lowerWins, 3) };
}
