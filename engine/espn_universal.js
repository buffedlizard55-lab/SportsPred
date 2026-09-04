/**
 * SportsPred — universal ESPN scoreboard parser (pure, no I/O).
 *
 * INPUT  : the JSON body of
 *          https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
 * OUTPUT : normalised match objects the universal engine can score.
 *
 * VERIFIED FIELD MAP (read live 2026-09-02 from eng.1 scoreboard, event 401879286)
 *   event.id                                     -> id
 *   event.date                                   -> startUtc  (e.g. "2026-09-05T11:30Z")
 *   competitions[0].status.type.state            -> 'pre' | 'in' | 'post'
 *   competitions[0].venue.fullName               -> venue
 *   competitions[0].neutralSite                  -> neutral
 *   competitors[].homeAway / team / score        -> home / away
 *   competitors[].form            "WWDLW"        -> form (soccer only; absent elsewhere)
 *   competitors[].records[].summary "1-1-0"      -> record
 *   competitors[].curatedRank.current            -> rank (college sports)
 *   competitions[0].odds[0].moneyline.home.close.odds  -> American price
 *   competitions[0].odds[0].pointSpread.home.close.line -> handicap line
 *   competitions[0].odds[0].total.over.close.line       -> total line
 *   competitions[0].odds[0].provider.name               -> price attribution
 *
 * HONESTY RULES
 *   - Any field ESPN does not send stays `null`. Nothing is defaulted, inferred
 *     or back-filled. Downstream, a null becomes an entry in `missing[]`.
 *   - Prices are attributed to the provider ESPN names. If no odds block is
 *     present, `odds` is null and every price rule is skipped, not guessed.
 */

/** American moneyline -> decimal price. Returns null for unusable input. */
export function americanToDecimal(american) {
  if (american === null || american === undefined || american === '') return null;
  const v = Number(String(american).replace(/[+\s]/g, (m) => (m === '+' ? '' : '')));
  if (!Number.isFinite(v) || v === 0) return null;
  return v > 0 ? v / 100 + 1 : 100 / -v + 1;
}

/** Decimal price -> raw implied probability (with the book's margin still in it). */
export function decimalToImplied(decimal) {
  if (!decimal || decimal <= 1) return null;
  return 1 / decimal;
}

/**
 * Remove the bookmaker margin proportionally across a set of raw implied
 * probabilities. Returns null if any input is missing.
 */
export function devig(rawProbs) {
  const vals = rawProbs.filter((p) => typeof p === 'number' && p > 0);
  if (vals.length !== rawProbs.length || !vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  return rawProbs.map((p) => p / sum);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[+\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickOddsValue(node) {
  // ESPN gives {open:{odds}, close:{odds}}; close is the freshest price.
  if (!node) return null;
  const raw = node.close?.odds ?? node.open?.odds ?? node.odds ?? null;
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickLineValue(node) {
  if (!node) return null;
  const raw = node.close?.line ?? node.open?.line ?? node.line ?? null;
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/[a-zA-Z+\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Parse the ESPN odds block for one competition. Returns null when absent. */
export function parseOdds(competition) {
  const block = Array.isArray(competition?.odds) ? competition.odds[0] : null;
  if (!block) return null;

  const homeAm = pickOddsValue(block.moneyline?.home) ?? num(block.homeTeamOdds?.moneyLine);
  const awayAm = pickOddsValue(block.moneyline?.away) ?? num(block.awayTeamOdds?.moneyLine);
  const drawAm = pickOddsValue(block.moneyline?.draw) ?? num(block.drawOdds?.moneyLine);

  const homeDec = americanToDecimal(homeAm);
  const awayDec = americanToDecimal(awayAm);
  const drawDec = americanToDecimal(drawAm);

  const raw = [decimalToImplied(homeDec), decimalToImplied(awayDec)];
  if (drawDec) raw.push(decimalToImplied(drawDec));
  const fair = devig(raw);

  const spreadHomeLine = pickLineValue(block.pointSpread?.home);
  const spreadAwayLine = pickLineValue(block.pointSpread?.away);
  const totalLine = pickLineValue(block.total?.over) ?? num(block.overUnder);

  const hasAny = homeDec || awayDec || spreadHomeLine !== null || totalLine !== null;
  if (!hasAny) return null;

  return {
    provider: block.provider?.name ?? null,
    details: block.details ?? null,
    moneyline: {
      home: homeDec ? { american: homeAm, decimal: round(homeDec, 4), fairProb: fair ? round(fair[0], 6) : null } : null,
      away: awayDec ? { american: awayAm, decimal: round(awayDec, 4), fairProb: fair ? round(fair[1], 6) : null } : null,
      draw: drawDec ? { american: drawAm, decimal: round(drawDec, 4), fairProb: fair && fair.length > 2 ? round(fair[2], 6) : null } : null,
    },
    spread: spreadHomeLine === null && spreadAwayLine === null ? null : {
      homeLine: spreadHomeLine,
      awayLine: spreadAwayLine,
      homePrice: americanToDecimal(pickOddsValue(block.pointSpread?.home)),
      awayPrice: americanToDecimal(pickOddsValue(block.pointSpread?.away)),
    },
    total: totalLine === null ? null : {
      line: totalLine,
      overPrice: americanToDecimal(pickOddsValue(block.total?.over)),
      underPrice: americanToDecimal(pickOddsValue(block.total?.under)),
    },
  };
}

function round(n, dp) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** "12-4-1" / "12-4" -> {wins, losses, draws, played, winPct}. null when unparseable. */
export function parseRecord(summary) {
  if (typeof summary !== 'string' || !summary.trim()) return null;
  const parts = summary.trim().split('-').map((p) => Number(p));
  // A record needs at least wins and losses; anything else is not a record.
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const [wins, losses, draws = 0] = parts;
  const played = wins + losses + draws;
  if (!Number.isFinite(played) || played <= 0) return null;
  return {
    wins, losses, draws, played,
    winPct: round((wins + draws * 0.5) / played, 6),
  };
}

/** "WWDLW" -> ['W','W','D','L','W'] most-recent-first per ESPN. null when absent. */
export function parseForm(form) {
  if (typeof form !== 'string' || !form.trim()) return null;
  const list = form.trim().toUpperCase().split('').filter((c) => 'WDL'.includes(c));
  return list.length ? list : null;
}

/** Form points as a 0..1 rate. W=1, D=0.5, L=0. null when no form. */
export function formRate(formList) {
  if (!Array.isArray(formList) || !formList.length) return null;
  const pts = formList.reduce((a, c) => a + (c === 'W' ? 1 : c === 'D' ? 0.5 : 0), 0);
  return round(pts / formList.length, 6);
}

function competitorToTeam(c) {
  if (!c) return null;
  const record = (c.records || []).find((r) => r?.type === 'total') || (c.records || [])[0] || null;
  const homeRecord = (c.records || []).find((r) => r?.type === 'home') || null;
  const awayRecord = (c.records || []).find((r) => r?.type === 'road' || r?.type === 'away') || null;
  // Average points per game, where ESPN publishes it (NBA/WNBA competitors
  // carry a statistics array with an `avgPoints` entry). Used only for the
  // game-total scoring component; never invented when absent.
  const avgPointsStat = (c.statistics || []).find((s) => s?.name === 'avgPoints');
  const avgPoints = avgPointsStat?.displayValue != null ? Number(String(avgPointsStat.displayValue).replace(/[^0-9.]/g, '')) : null;
  return {
    id: c.team?.id ?? c.id ?? null,
    name: c.team?.displayName ?? c.team?.name ?? null,
    shortName: c.team?.shortDisplayName ?? c.team?.abbreviation ?? null,
    abbreviation: c.team?.abbreviation ?? null,
    logo: c.team?.logo ?? (c.team?.logos?.[0]?.href ?? null),
    color: c.team?.color ? `#${c.team.color}` : null,
    score: c.score === undefined || c.score === null || c.score === '' ? null : Number(c.score),
    winner: typeof c.winner === 'boolean' ? c.winner : null,
    recordSummary: record?.summary ?? null,
    record: parseRecord(record?.summary),
    homeSplit: homeRecord ? parseRecord(homeRecord.summary) : null,
    awaySplit: awayRecord ? parseRecord(awayRecord.summary) : null,
    avgPoints: Number.isFinite(avgPoints) ? avgPoints : null,
    form: parseForm(c.form),
    rank: Number.isFinite(Number(c.curatedRank?.current)) && Number(c.curatedRank.current) < 100
      ? Number(c.curatedRank.current) : null,
    homeAway: c.homeAway ?? null,
    espnTeamUrl: (c.team?.links || []).find((l) => (l.rel || []).includes('clubhouse'))?.href ?? null,
  };
}

const STATE_MAP = { pre: 'upcoming', in: 'live', post: 'results' };

/**
 * Parse a whole scoreboard payload.
 * @param {object} payload  raw ESPN JSON
 * @param {object} ctx      { sportKey, leagueSlug, leagueName }
 * @returns {{league: object, matches: object[], warnings: string[]}}
 */
export function parseScoreboard(payload, ctx = {}) {
  const warnings = [];
  const leagueNode = Array.isArray(payload?.leagues) ? payload.leagues[0] : null;
  const league = {
    id: leagueNode?.id ?? null,
    slug: ctx.leagueSlug ?? leagueNode?.slug ?? null,
    name: leagueNode?.name ?? ctx.leagueName ?? null,
    abbreviation: leagueNode?.abbreviation ?? null,
    logo: leagueNode?.logos?.[0]?.href ?? null,
    seasonYear: leagueNode?.season?.year ?? null,
    calendar: Array.isArray(leagueNode?.calendar)
      ? leagueNode.calendar.filter((d) => typeof d === 'string').map((d) => d.slice(0, 10))
      : [],
  };

  const matches = [];
  for (const ev of payload?.events || []) {
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    if (!comp) { warnings.push(`event ${ev?.id}: no competition block`); continue; }
    const competitors = comp.competitors || [];
    const homeC = competitors.find((c) => c.homeAway === 'home') || competitors[0];
    const awayC = competitors.find((c) => c.homeAway === 'away') || competitors[1];
    if (!homeC || !awayC) { warnings.push(`event ${ev?.id}: fewer than two competitors`); continue; }

    const state = comp.status?.type?.state ?? ev.status?.type?.state ?? null;
    const home = competitorToTeam(homeC);
    const away = competitorToTeam(awayC);

    let winner = null;
    if (STATE_MAP[state] === 'results') {
      if (home.winner === true) winner = 'home';
      else if (away.winner === true) winner = 'away';
      else if (home.score !== null && away.score !== null) {
        winner = home.score > away.score ? 'home' : home.score < away.score ? 'away' : 'draw';
      }
    }

    matches.push({
      id: String(ev.id),
      sportKey: ctx.sportKey ?? null,
      leagueSlug: league.slug,
      leagueName: league.name,
      leagueLogo: league.logo,
      name: ev.name ?? null,
      shortName: ev.shortName ?? null,
      startUtc: ev.date ?? null,
      dateISO: typeof ev.date === 'string' ? ev.date.slice(0, 10) : null,
      phase: STATE_MAP[state] ?? 'upcoming',
      statusDetail: comp.status?.type?.shortDetail ?? comp.status?.type?.description ?? null,
      statusClock: comp.status?.displayClock ?? null,
      period: comp.status?.period ?? null,
      venue: comp.venue?.fullName ?? null,
      venueCity: comp.venue?.address?.city ?? null,
      neutral: comp.neutralSite === true,
      home,
      away,
      odds: parseOdds(comp),
      winner,
      note: (comp.notes || [])[0]?.headline ?? null,
      links: {
        summary: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href ?? null,
        stats: (ev.links || []).find((l) => (l.rel || []).includes('stats'))?.href ?? null,
      },
    });
  }

  matches.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
  return { league, matches, warnings };
}

/**
 * Build a leak-free league context from COMPLETED matches only.
 * Everything here is measured, never assumed: home-win rate, draw rate and the
 * mean combined score come from the finished games supplied.
 */
export function buildLeagueContext(completedMatches, { threeWay = false } = {}) {
  const done = (completedMatches || []).filter(
    (m) => m.phase === 'results' && m.home?.score !== null && m.away?.score !== null
  );
  if (done.length < 10) {
    return { sample: done.length, homeWinRate: null, drawRate: null, awayWinRate: null, meanTotal: null, sufficient: false };
  }
  let homeWins = 0, draws = 0, totalPoints = 0;
  for (const m of done) {
    if (m.home.score > m.away.score) homeWins += 1;
    else if (m.home.score === m.away.score) draws += 1;
    totalPoints += m.home.score + m.away.score;
  }
  const n = done.length;
  return {
    sample: n,
    homeWinRate: round(homeWins / n, 6),
    drawRate: threeWay ? round(draws / n, 6) : round(draws / n, 6),
    awayWinRate: round((n - homeWins - draws) / n, 6),
    meanTotal: round(totalPoints / n, 4),
    sufficient: true,
  };
}

/**
 * Head-to-head from a supplied match tape, restricted to games that finished
 * strictly BEFORE `beforeUtc` (so a backtest cannot see the future).
 */
export function headToHead(tape, homeName, awayName, beforeUtc) {
  const rows = (tape || []).filter((m) => {
    if (m.phase !== 'results' || !m.winner) return false;
    if (beforeUtc && String(m.startUtc) >= String(beforeUtc)) return false;
    const names = [m.home?.name, m.away?.name];
    return names.includes(homeName) && names.includes(awayName);
  });
  if (!rows.length) return null;
  let homeWins = 0, awayWins = 0, drawn = 0;
  for (const m of rows) {
    const winnerName = m.winner === 'draw' ? null : m.winner === 'home' ? m.home.name : m.away.name;
    if (!winnerName) drawn += 1;
    else if (winnerName === homeName) homeWins += 1;
    else awayWins += 1;
  }
  return { meetings: rows.length, homeWins, awayWins, draws: drawn };
}

/**
 * Recent form for a team computed from a match tape, using only games that
 * finished before `beforeUtc`. Returns null when the tape has nothing.
 */
export function formFromTape(tape, teamName, beforeUtc, window = 5) {
  const rows = (tape || [])
    .filter((m) => m.phase === 'results' && m.winner
      && (!beforeUtc || String(m.startUtc) < String(beforeUtc))
      && (m.home?.name === teamName || m.away?.name === teamName))
    .sort((a, b) => String(b.startUtc).localeCompare(String(a.startUtc)))
    .slice(0, window);
  if (!rows.length) return null;
  const list = rows.map((m) => {
    if (m.winner === 'draw') return 'D';
    const winnerName = m.winner === 'home' ? m.home.name : m.away.name;
    return winnerName === teamName ? 'W' : 'L';
  });
  return list;
}

/** Days of rest before `startUtc`, from the tape. null when unknown. */
export function restDays(tape, teamName, startUtc) {
  if (!startUtc) return null;
  const prior = (tape || [])
    .filter((m) => m.phase === 'results'
      && String(m.startUtc) < String(startUtc)
      && (m.home?.name === teamName || m.away?.name === teamName))
    .sort((a, b) => String(b.startUtc).localeCompare(String(a.startUtc)))[0];
  if (!prior) return null;
  const ms = Date.parse(startUtc) - Date.parse(prior.startUtc);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}
