/**
 * SportsPred — Cricket ESPN payload parsers (pure, no I/O).
 *
 * These transform ESPN's public key-less cricket endpoints into plain rows.
 * They are imported by the browser collector (assets/js/cricket-collector.js)
 * AND by the Node test suite, so the parsing logic cannot drift between the
 * site and what is tested. No browser globals (localStorage/fetch) here.
 */

/** Map ESPN's class.eventType / description to our format tag. */
export function classifyFormat(eventType, description) {
  const t = (eventType || '').toUpperCase();
  const d = (description || '').toLowerCase();
  if (t === 'T20' || d.includes('twenty20') || d.includes('t20')) return 'T20';
  if (t === 'ODI' || d.includes('odi') || d.includes('one-day') || d.includes('list a')) return 'ODI';
  if (t === 'TEST' || d.includes('test') || d.includes('first-class') || d.includes('4-day') || d.includes('4 day')) return 'TEST';
  return 'OTHER';
}

/** Map an ESPN bowling-style short code to 'spin' / 'pace' / null. */
export function bowlingSpinPace(short) {
  if (!short) return null;
  const s = short.toLowerCase();
  // Spin: legbreak (lb), offbreak (ob), slow left-arm (sla), orthodox/wrist spin.
  if (s.includes('lb') || s.includes('ob') || s.includes('sla') || s.includes('slow') || s.includes('spin') || s.includes('orth')) return 'spin';
  // Pace: fast/medium (f/fm) or seam.
  if (s.includes('fm') || s.includes('f') || s.includes('m') || s.includes('seam') || s.includes('fast')) return 'pace';
  return null;
}

function phaseFromState(state, dateISO, todayISO) {
  if (state === 'in') return 'live';
  if (state === 'post') return 'results';
  return dateISO < todayISO ? 'results' : 'upcoming';
}

function competitorTeam(c) {
  if (!c?.team) return null;
  return {
    id: c.team.id,
    name: c.team.displayName || c.team.name,
    abbreviation: c.team.abbreviation,
    logo: c.team.logos?.[0]?.href || c.team.logo || null,
    score: c.score || '',
    winner: c.winner === true,
    homeAway: c.homeAway,
  };
}

/**
 * Parse one scorepanel event into a normalised match row.
 * @param todayISO ISO date used only to classify pre matches without an end state.
 */
export function parsePanelEvent(ev, leagueId, todayISO = new Date().toISOString().slice(0, 10)) {
  const comp = ev?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1];

  const dateISO = (ev.date || comp.date || '').slice(0, 10);
  const state = comp?.status?.type?.state || ev?.status?.type?.state || 'pre';

  const leagueName = ev?.leagues?.[0]?.name || comp?.leagues?.[0]?.name || '';
  const cls = comp?.class || ev?.class || {};

  return {
    competition_id: `cr-${ev.id}`,
    espn_event_id: String(ev.id),
    espn_league_id: String(leagueId ?? ev?.leagues?.[0]?.id ?? ''),
    sport: 'Cricket',
    league: leagueName,
    series: leagueName,
    phase: phaseFromState(state, dateISO, todayISO),
    date: dateISO,
    start_utc: ev.date || comp.date || null,
    description: ev.description || comp.description || '',
    round: comp.description || '',
    format: classifyFormat(cls.eventType, ev.description || comp.description),
    eventType: cls.eventType || cls.generalClassCard || '',
    venue: comp?.venue?.fullName || ev?.venue?.fullName || null,
    venue_city: comp?.venue?.address?.city || null,
    venue_country: comp?.venue?.address?.country || null,
    neutral: comp.neutralSite === true,
    home: competitorTeam(home)?.name || home?.team?.name || 'Home',
    away: competitorTeam(away)?.name || away?.team?.name || 'Away',
    homeTeamObj: competitorTeam(home),
    awayTeamObj: competitorTeam(away),
    status_text: comp?.status?.summary || '',
    source_url: ev?.links?.find((l) => (l.rel || []).includes('summary'))?.href
      || `https://www.espncricinfo.com/series/${leagueId}/match/${ev.id}`,
    cricinfo_url: ev?.links?.find((l) => (l.rel || []).includes('summary'))?.href || null,
  };
}

/**
 * Parse a match summary into confirmed rosters with batting position, role,
 * and (for finished/live matches) runs, strike rate, wickets, economy.
 * Returns { playersByTeam, venue } or null.
 */
export function parseSummary(payload) {
  if (!payload?.rosters) return null;
  const playersByTeam = {};
  for (const roster of payload.rosters) {
    const teamId = roster?.team?.id != null ? String(roster.team.id) : roster.homeAway;
    const list = [];
    for (const entry of roster.roster || []) {
      const a = entry.athlete || {};
      let battingPosition = null, runs = null, strikeRate = null, ballsFaced = null;
      let fours = null, sixes = null, fiftyPlus = null, wickets = null, economy = null, ballsBowled = null;
      for (const ls of entry.linescores || []) {
        for (const sub of ls.linescores || []) {
          const stats = sub?.statistics?.categories || [];
          for (const cat of stats) {
            for (const s of cat.stats || []) {
              const v = Number(s.value);
              if (!isFinite(v)) continue;
              if (s.name === 'battingPosition') battingPosition = v;
              if (s.name === 'runs') runs = Math.max(runs || 0, v);
              if (s.name === 'strikeRate') strikeRate = v;
              if (s.name === 'ballsFaced') ballsFaced = Math.max(ballsFaced || 0, v);
              if (s.name === 'fours') fours = Math.max(fours || 0, v);
              if (s.name === 'sixes') sixes = Math.max(sixes || 0, v);
              if (s.name === 'fiftyPlus') fiftyPlus = Math.max(fiftyPlus || 0, v);
              if (s.name === 'dismissals' || s.name === 'wickets') wickets = Math.max(wickets || 0, v);
              if (s.name === 'economyRate' && v > 0) economy = v;
              if (s.name === 'balls') ballsBowled = Math.max(ballsBowled || 0, v);
            }
          }
        }
      }
      const styles = a.style || [];
      const battingStyleCode = styles.find((x) => x.type === 'batting')?.shortDescription || null;
      const bowlingStyle = styles.find((x) => x.type === 'bowling')?.shortDescription || null;
      const role = entry?.position?.name || a?.position?.name || '';
      list.push({
        id: String(a.id || a.guid || Math.random().toString(36).slice(2)),
        name: a.displayName || a.battingName || a.fullName || 'Unknown',
        battingName: a.battingName || null,
        battingPosition,
        battingStyle: battingStyleCode ? (battingStyleCode.includes('Lhb') ? 'left' : 'right') : null,
        bowlingStyle,
        role: role.toLowerCase().includes('all') ? 'allrounder'
          : role.toLowerCase().includes('bowl') || (bowlingStyle && !battingPosition) ? 'bowler'
          : role.toLowerCase().includes('bat') || battingPosition ? 'batsman' : 'unknown',
        starter: entry.starter !== false,
        matchStats: { runs, strikeRate, ballsFaced, fours, sixes, fiftyPlus, wickets, economy, ballsBowled },
        cricinfo_url: a?.links?.find((l) => (l.rel || []).includes('playercard'))?.href || null,
      });
    }
    playersByTeam[teamId] = list;
  }
  const venue = payload?.gameInfo?.venue?.fullName || null;
  return { playersByTeam, venue };
}
