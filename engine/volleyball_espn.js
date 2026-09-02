/**
 * SportsPred — ESPN volleyball scoreboard parser (pure, no I/O).
 *
 * Extends the universal scoreboard shape with volleyball-specific fields:
 * linescores (points per set) and home/road record splits.
 *
 * A set is won when a team reaches 25 (15 in set 5) with a two-point margin,
 * but we never reconstruct that ourselves: we take ESPN's per-period
 * `winner` flag when present, otherwise the higher points value. Match
 * winner is ESPN's competitor.winner / the side that first reaches three
 * set wins. Nothing is inferred when linescores are absent.
 */

import { parseOdds, parseRecord, parseForm } from './espn_universal.js';

const STATE_MAP = { pre: 'upcoming', in: 'live', post: 'results' };

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function recordOfType(records, type) {
  const row = (records || []).find((r) => r?.type === type) || null;
  return row ? parseRecord(row.summary) : null;
}

function setResultsFromLinescores(homeC, awayC) {
  const hLines = Array.isArray(homeC?.linescores) ? homeC.linescores : [];
  const aLines = Array.isArray(awayC?.linescores) ? awayC.linescores : [];
  const n = Math.max(hLines.length, aLines.length);
  if (!n) return { sets: [], homeSets: null, awaySets: null, setScore: null };

  const sets = [];
  let homeSets = 0;
  let awaySets = 0;
  for (let i = 0; i < n; i += 1) {
    const hp = num(hLines[i]?.value ?? hLines[i]?.displayValue);
    const ap = num(aLines[i]?.value ?? aLines[i]?.displayValue);
    let winner = null;
    if (hLines[i]?.winner === true) winner = 'home';
    else if (aLines[i]?.winner === true) winner = 'away';
    else if (hp != null && ap != null && hp !== ap) winner = hp > ap ? 'home' : 'away';
    if (winner === 'home') homeSets += 1;
    else if (winner === 'away') awaySets += 1;
    sets.push({ period: i + 1, home: hp, away: ap, winner });
  }
  const decided = homeSets >= 3 || awaySets >= 3;
  const setScore = decided
    ? (homeSets > awaySets ? `${homeSets}-${awaySets}` : `${awaySets}-${homeSets}`)
    : null;
  return { sets, homeSets, awaySets, setScore, decided };
}

function competitorToTeam(c) {
  if (!c) return null;
  const total = recordOfType(c.records, 'total') || parseRecord((c.records || [])[0]?.summary);
  const home = recordOfType(c.records, 'home');
  const road = recordOfType(c.records, 'road');
  const rankRaw = Number(c.curatedRank?.current);
  const rank = Number.isFinite(rankRaw) && rankRaw > 0 && rankRaw < 90 ? rankRaw : null;
  return {
    id: c.team?.id ?? c.id ?? null,
    name: c.team?.displayName ?? c.team?.name ?? null,
    shortName: c.team?.shortDisplayName ?? c.team?.abbreviation ?? null,
    abbreviation: c.team?.abbreviation ?? null,
    logo: c.team?.logo ?? (c.team?.logos?.[0]?.href ?? null),
    score: c.score === undefined || c.score === null || c.score === '' ? null : Number(c.score),
    winner: typeof c.winner === 'boolean' ? c.winner : null,
    recordSummary: (c.records || []).find((r) => r?.type === 'total')?.summary ?? (c.records || [])[0]?.summary ?? null,
    record: total,
    homeRecord: home ? { ...home, winRate: home.winPct } : null,
    awayRecord: road ? { ...road, winRate: road.winPct, lossRate: road.played ? road.losses / road.played : null } : null,
    form: parseForm(c.form),
    rank,
    homeAway: c.homeAway ?? null,
    espnTeamUrl: (c.team?.links || []).find((l) => (l.rel || []).includes('clubhouse'))?.href
      || (c.team?.id ? `https://www.espn.com/college-sports/volleyball/team/_/id/${c.team.id}` : null),
  };
}

/**
 * Parse a volleyball scoreboard payload.
 * @param {object} payload raw ESPN JSON
 * @param {object} ctx { sportKey, leagueSlug, leagueName }
 */
export function parseVolleyballScoreboard(payload, ctx = {}) {
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
    const setInfo = setResultsFromLinescores(homeC, awayC);

    let winner = null;
    if (STATE_MAP[state] === 'results') {
      if (home.winner === true) winner = 'home';
      else if (away.winner === true) winner = 'away';
      else if (setInfo.decided) winner = setInfo.homeSets > setInfo.awaySets ? 'home' : 'away';
      else if (home.score != null && away.score != null && home.score !== away.score) {
        winner = home.score > away.score ? 'home' : 'away';
      }
    }

    const winnerSetScore = winner && setInfo.homeSets != null && setInfo.awaySets != null
      ? (winner === 'home' ? `${setInfo.homeSets}-${setInfo.awaySets}` : `${setInfo.awaySets}-${setInfo.homeSets}`)
      : null;

    matches.push({
      id: String(ev.id),
      event_id: String(ev.id),
      sportKey: ctx.sportKey ?? 'volleyball',
      leagueSlug: league.slug,
      leagueName: league.name,
      leagueLogo: league.logo,
      league: league.name,
      name: ev.name ?? null,
      shortName: ev.shortName ?? null,
      startUtc: ev.date ?? null,
      start_utc: ev.date ?? null,
      dateISO: typeof ev.date === 'string' ? ev.date.slice(0, 10) : null,
      date: typeof ev.date === 'string' ? ev.date.slice(0, 10) : null,
      phase: STATE_MAP[state] ?? 'upcoming',
      statusDetail: comp.status?.type?.shortDetail ?? comp.status?.type?.description ?? null,
      statusClock: comp.status?.displayClock ?? null,
      period: comp.status?.period ?? null,
      venue: comp.venue?.fullName ?? null,
      venueCity: comp.venue?.address?.city ?? null,
      indoor: comp.venue?.indoor === true,
      neutral: comp.neutralSite === true,
      home: home.name,
      away: away.name,
      homeTeamObj: { ...home, isHome: true, name: home.name },
      awayTeamObj: { ...away, isHome: false, name: away.name },
      odds: parseOdds(comp),
      winner,
      sets: setInfo.sets,
      homeSets: setInfo.homeSets,
      awaySets: setInfo.awaySets,
      setScore: winnerSetScore,
      note: (comp.notes || [])[0]?.headline ?? null,
      source_url: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href
        || `https://www.espn.com/college-sports/volleyball/scoreboard/_/date/${(ev.date || '').slice(0, 10).replace(/-/g, '')}`,
      links: {
        summary: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href ?? null,
        stats: (ev.links || []).find((l) => (l.rel || []).includes('stats'))?.href ?? null,
      },
    });
  }

  matches.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
  return { league, matches, warnings };
}

/** Convert an ESPN American moneyline on a team into the engine odds object. */
export function oddsForTeam(matchOdds, side) {
  const node = matchOdds?.moneyline?.[side];
  if (!node) return null;
  return { decimal: node.decimal, american: node.american };
}
