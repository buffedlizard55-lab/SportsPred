/**
 * SportsPred — GBGB official results API parsers (pure, no I/O).
 *
 * The Greyhound Board of Great Britain (gbgb.org.uk) powers its results site
 * with a key-less JSON API. Two endpoints matter here:
 *
 *   https://api.gbgb.org.uk/api/results?page={n}&itemsPerPage={k}&date=YYYY-MM-DD&race_type=race
 *       -> { items: [winnerRows...], meta: { count, page, pageCount } }
 *          one row per finished race (the winner only); used to enumerate a day.
 *   https://api.gbgb.org.uk/api/results/meeting/{meetingId}
 *       -> [ { meetingDate, meetingId, trackName, races: [
 *              { raceId, raceTime, raceNumber, raceType, raceClass, raceDistance,
 *                raceTitle, racePrizes, traps: [
 *                  { trapNumber, dogId, dogName, trainerName, dogBorn, dogColour,
 *                    dogSex, dogSire, dogDam, SP, resultPosition, resultRunTime,
 *                    resultComment, resultSectionalTime, resultBtnDistance, ... } ] } ] } ]
 *
 * The meeting endpoint is authoritative: it returns the full declared draw for
 * races not yet run (traps with no resultPosition/SP) and the settled result
 * with starting prices, run times, sectionals and in-running comments for
 * finished races. Trials (raceType "Trial" or class starting with T) are
 * excluded — they are schooling runs, not betting races.
 *
 * A per-dog history endpoint (used by the collector, not the browser):
 *   https://api.gbgb.org.uk/api/results/dog/{dogId}?page=1&itemsPerPage=50
 *
 * Nothing in this file invents a value: a missing field stays null and the
 * card builder reports it.
 */

export const GBGB_API_BASE = 'https://api.gbgb.org.uk/api';
export const GBGB_SITE_RESULTS = 'https://www.gbgb.org.uk/racing/results/';
export const SPORTING_LIFE_RACECARDS = 'https://www.sportinglife.com/greyhounds/racecards';

/** dd/mm/yyyy -> yyyy-mm-dd (the API emits dd/mm/yyyy). */
export function normDateISO(d) {
  const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "19:44:00" -> "19:44" (UK local wall-clock time, as printed). */
export function normTime(t) {
  const m = String(t || '').match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : (t || null);
}

/** Trials are school runs and are never bet races. */
export function isBetRace(race) {
  const cls = String(race?.raceClass || '').trim().toUpperCase();
  const type = String(race?.raceType || '').trim().toLowerCase();
  if (type.includes('trial')) return false;
  if (cls.startsWith('T')) return false;
  return true;
}

/** A settled race has a winner with a finishing position. */
export function raceStatus(race) {
  const traps = Array.isArray(race?.traps) ? race.traps : [];
  const finished = traps.some((t) => Number(t?.resultPosition) === 1);
  return finished ? 'result' : 'scheduled';
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse one race object from the meeting endpoint into a normalised race. */
export function parseMeetingRace(race, meeting = {}) {
  const traps = Array.isArray(race.traps) ? race.traps : [];
  const runners = traps
    .filter((t) => t && t.dogId && t.dogName)
    .map((t) => ({
      dogId: t.dogId,
      name: String(t.dogName).trim(),
      trap: num(t.trapNumber),
      trainer: t.trainerName || null,
      born: t.dogBorn || null,
      colour: t.dogColour || null,
      sex: t.dogSex || null,
      sire: t.dogSire || null,
      dam: t.dogDam || null,
      sp: t.SP || null,
      position: t.resultPosition != null && t.resultPosition !== '' ? num(t.resultPosition) : null,
      runTime: num(t.resultRunTime),
      sectional: t.resultSectionalTime || null,
      btnDistance: t.resultBtnDistance || null,
      comment: t.resultComment || null,
      weight: num(t.resultDogWeight),
    }))
    .sort((a, b) => (a.trap ?? 99) - (b.trap ?? 99));
  const winner = runners.find((r) => r.position === 1) || null;
  return {
    raceId: race.raceId,
    meetingId: meeting.meetingId,
    track: meeting.trackName,
    date: normDateISO(meeting.meetingDate || race.raceDate),
    time: normTime(race.raceTime),
    raceNumber: race.raceNumber != null ? String(race.raceNumber) : null,
    grade: String(race.raceClass || '').trim().toUpperCase() || null,
    distance: num(race.raceDistance),
    raceTitle: race.raceTitle || null,
    prizes: race.racePrizes || null,
    raceType: String(race.raceType || 'Flat'),
    forecast: race.raceForecast || null,
    tricast: race.raceTricast || null,
    status: raceStatus(race),
    sourceUrl: `${GBGB_API_BASE}/results/meeting/${meeting.meetingId}`,
    runners,
    winnerName: winner ? winner.name : null,
    winnerTrap: winner ? winner.trap : null,
    winnerDogId: winner ? winner.dogId : null,
    winnerSP: winner ? winner.sp : null,
    // "non-runners" only means a vacant trap on a declared six-trap card;
    // an undeclared/unknown card (no traps) must not report six vacancies.
    nonRunners: traps.length ? 6 - runners.length : 0,
  };
}

/** Parse a /results/meeting/{id} payload into normalised races (bet races only). */
export function parseMeetingPayload(payload) {
  const meetings = Array.isArray(payload) ? payload : [payload];
  const races = [];
  for (const meeting of meetings) {
    if (!meeting || !Array.isArray(meeting.races)) continue;
    for (const race of meeting.races) {
      if (!isBetRace(race)) continue;
      races.push(parseMeetingRace(race, meeting));
    }
  }
  return races;
}

/**
 * Parse a /results/dog/{id} history payload into compact run records, newest
 * first, excluding trials and runs with no recorded finishing position.
 */
export function parseDogHistory(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((r) => {
      const cls = String(r?.raceClass || '').trim().toUpperCase();
      const type = String(r?.raceType || '').trim().toLowerCase();
      if (type.includes('trial') || cls.startsWith('T')) return false;
      return r?.resultPosition != null && r.resultPosition !== '';
    })
    .map((r) => ({
      date: normDateISO(r.raceDate),
      track: r.trackName || null,
      grade: cls(r.raceClass),
      distance: num(r.raceDistance),
      trap: num(r.trapNumber),
      position: num(r.resultPosition),
      sp: r.SP || null,
      runTime: num(r.resultRunTime),
      winTime: num(r.raceWinTime),
      going: r.raceGoing != null && r.raceGoing !== '' ? num(r.raceGoing) : null,
      comment: r.resultComment || null,
      btnDistance: r.resultBtnDistance || null,
      raceId: r.raceId ?? null,
      meetingId: r.meetingId ?? null,
    }));
  function cls(c) { return String(c || '').trim().toUpperCase() || null; }
}
