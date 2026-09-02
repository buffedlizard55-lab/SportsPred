/**
 * SportsPred — Greyhound runner profiles from the official results tape.
 *
 * Pure: the caller supplies (a) a normalised race from the meeting endpoint
 * (engine/greyhound_gbgb.js) and (b) per-dog run histories parsed from
 * /results/dog/{dogId}. Nothing here fetches or estimates.
 *
 * The profile is exactly what Step 1 of the master prompt asks the scorer to
 * hold for each runner: last-five results (position, distance, track, grade),
 * trap record, distance record, track record, grade movement, best and last
 * times.
 */

/**
 * Build a runner profile for scoring.
 * @param {object} runner  normalised runner from parseMeetingRace
 * @param {Array}  history runs from parseDogHistory, newest first
 * @param {object} race    normalised race
 */
export function buildRunnerProfile(runner, history, race) {
  const runs = (history || []).filter((r) => Number.isFinite(r.position));
  // Exclude today's race if the history pull already contains it.
  const pastRuns = runs.filter((r) => !(r.raceId && race?.raceId && String(r.raceId) === String(race.raceId)));
  const trap = runner.trap ?? null;

  const atTrap = pastRuns.filter((r) => Number(r.trap) === Number(trap));
  const atTrack = pastRuns.filter((r) => String(r.track || '').toLowerCase() === String(race?.track || '').toLowerCase());
  const atDistance = pastRuns.filter((r) => Number.isFinite(r.distance) && Math.abs(Number(r.distance) - Number(race?.distance)) <= 20);

  const wins = (xs) => xs.filter((r) => r.position === 1).length;
  const places = (xs) => xs.filter((r) => r.position >= 1 && r.position <= 3).length;

  const times = pastRuns.map((r) => r.runTime).filter(Number.isFinite);
  const bestTime = times.length ? Math.min(...times) : null;
  const lastTime = pastRuns[0]?.runTime ?? null;

  // Track-and-distance best (the "Best:" figure on a racecard is C&D best).
  const cdTimes = atDistance
    .filter((r) => String(r.track || '').toLowerCase() === String(race?.track || '').toLowerCase())
    .map((r) => r.runTime)
    .filter(Number.isFinite);
  const cdBest = cdTimes.length ? Math.min(...cdTimes) : null;

  return {
    dogId: runner.dogId,
    name: runner.name,
    trap,
    trainer: runner.trainer,
    sp: runner.sp ?? null,           // present only on settled races
    runs: pastRuns,
    last5: pastRuns.slice(0, 5).map((r) => ({
      position: r.position, date: r.date, track: r.track, grade: r.grade,
      distance: r.distance, trap: r.trap, runTime: r.runTime, sp: r.sp,
    })),
    stats: {
      careerRuns: pastRuns.length,
      careerWins: wins(pastRuns),
      last5Wins: wins(pastRuns.slice(0, 5)),
      last5Places: places(pastRuns.slice(0, 5)),
      trapRuns: atTrap.length, trapWins: wins(atTrap), trapPlaces: places(atTrap),
      trackRuns: atTrack.length, trackWins: wins(atTrack), trackPlaces: places(atTrack),
      distanceRuns: atDistance.length, distanceWins: wins(atDistance), distancePlaces: places(atDistance),
      bestTime, lastTime, cdBest,
      daysSinceRun: daysBetween(pastRuns[0]?.date, race?.date),
    },
  };
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}

/** Attach profiles to every runner of a race, given a dogId -> history map. */
export function enrichRace(race, historyByDog) {
  const runners = (race.runners || []).map((r) => ({
    ...buildRunnerProfile(r, historyByDog?.get(String(r.dogId)) || [], race),
  }));
  return { ...race, runners };
}

/** The five-character form string, "-" for missing runs. */
export function formString(profile) {
  return profile.last5.map((r) => r.position ?? '-').join('').padEnd(5, '-').slice(0, 5);
}
