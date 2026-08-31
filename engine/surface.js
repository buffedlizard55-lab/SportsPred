/**
 * SportsPred — surface resolution (pure).
 *
 * ESPN does not publish a court surface. data/surfaces.json is derived from
 * recorded match rows in the Sackmann mirrors (see scripts/build_surface_map.mjs).
 * This module joins an ESPN tournament name to that map.
 *
 * HONESTY RULE: if the tournament is not in the map, or the map left its
 * surface null because its own source rows disagreed, this returns
 * { surface: null, ... } with a reason. It never falls back to a guess and it
 * never infers a surface from the tournament's name or venue.
 */

/**
 * Normalise a tournament name for joining. Must stay in step with
 * `normaliseTournament` in scripts/build_surface_map.mjs.
 */
export function normaliseTournament(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(atp|wta)\b/g, ' ')
    .replace(/\b(masters|open|championships?|cup|classic|international|tournament)\b/g, ' $1 ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {object} map    parsed data/surfaces.json
 * @param {string} name   ESPN tournament name, e.g. "US Open"
 * @param {string} tour   'ATP' | 'WTA' | null
 * @returns {{surface: string|null, reason: string, key: string|null, matches: number|null, agreement: number|null}}
 */
export function resolveSurface(map, name, tour) {
  const norm = normaliseTournament(name);
  if (!norm) return { surface: null, reason: 'no-tournament-name', key: null, matches: null, agreement: null };
  const tournaments = map?.tournaments ?? {};

  const tryKeys = [];
  if (tour) tryKeys.push(`${tour.toLowerCase()}|${norm}`);
  // Same event is often present under only one tour in the source data; the
  // court surface of a venue does not differ by tour, so the other tour's row
  // is an acceptable fallback and is reported as such.
  tryKeys.push(`atp|${norm}`, `wta|${norm}`);

  for (let i = 0; i < tryKeys.length; i++) {
    const k = tryKeys[i];
    const e = tournaments[k];
    if (!e) continue;
    if (!e.surface) {
      return {
        surface: null,
        reason: 'source-rows-disagree',
        key: k,
        matches: e.matches ?? null,
        agreement: e.agreement ?? null,
      };
    }
    return {
      surface: e.surface,
      reason: i === 0 || !tour ? 'matched' : 'matched-other-tour',
      key: k,
      matches: e.matches ?? null,
      agreement: e.agreement ?? null,
    };
  }
  return { surface: null, reason: 'tournament-not-in-map', key: null, matches: null, agreement: null };
}
