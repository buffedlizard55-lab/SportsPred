/**
 * SportsPred — FIVB Volleyball Nations League Women scoring engine.
 *
 * This module implements the stated VNL-Women master prompt's two published
 * markets: MATCH WINNER and SET SCORE. It deliberately has no network or time
 * dependency. The collector supplies facts and URLs; this file only evaluates
 * them. Missing facts are never replaced with assumptions.
 *
 * Data contract (per match)
 * -------------------------
 * `family` must be `vnl-women`; other competitions are returned as out of
 * scope. `homeTeam` / `awayTeam` may contain form, roster, standings, stats
 * and stakes records. `odds.books` must contain prices for at least two named
 * books before it can identify a market favourite. All source URLs remain on
 * the data rows and are rendered by the page, never invented here.
 */

export const RULESET_VERSION = 'v1.0-vnl-women';
export const PROMPT_VERSION = 'v1.0';
export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' });

const POSITIVE = new Set(['W', 'WIN']);
const NEGATIVE = new Set(['L', 'LOSS']);

function component(id, label, points, max, detail, { missing = false, evidence = null } = {}) {
  return { id, label, points, max, detail, missing, evidence };
}

function uniquePush(list, item) {
  if (!list.includes(item)) list.push(item);
}

function asAmerican(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.american === 'number' && Number.isFinite(value.american) && value.american !== 0) return value.american;
  if (typeof value.decimal === 'number' && Number.isFinite(value.decimal) && value.decimal > 1) {
    return value.decimal >= 2 ? Math.round((value.decimal - 1) * 100) : Math.round(-100 / (value.decimal - 1));
  }
  return null;
}

export function decimalToAmerican(decimal) {
  return asAmerican({ decimal });
}

export function americanToImpliedProb(american) {
  if (typeof american !== 'number' || !Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

export function normaliseOdds(raw) {
  // Bare positive numbers are decimal odds; bare negative numbers are American.
  // Object values remain explicit through their `decimal` / `american` key.
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw === 0) return null;
    if (raw > 1) return { american: decimalToAmerican(raw), decimal: Number(raw.toFixed(3)) };
    return raw < 0 ? { american: raw, decimal: Number((100 / -raw + 1).toFixed(3)) } : null;
  }
  const american = asAmerican(raw);
  if (american == null) return null;
  const decimal = american > 0 ? (american / 100) + 1 : (100 / -american) + 1;
  return { american, decimal: Number(decimal.toFixed(3)) };
}

function teamName(team, fallback = '') {
  return String(team?.name || team || fallback).trim();
}

function teamFor(match, side) {
  const named = side === 'home' ? match.homeTeam : match.awayTeam;
  const legacy = side === 'home' ? match.homeTeamObj : match.awayTeamObj;
  const raw = side === 'home' ? match.home : match.away;
  return { ...(typeof raw === 'object' ? raw : {}), ...(legacy || {}), ...(named || {}), name: teamName(named, teamName(legacy, teamName(raw))) };
}

function valuesFromForm(team) {
  const form = team?.form || {};
  const rows = form.vnlLast5 || form.last5 || [];
  return Array.isArray(rows) ? rows.map((r) => String(typeof r === 'object' ? r.result : r).toUpperCase()).filter((r) => POSITIVE.has(r) || NEGATIVE.has(r)) : [];
}

function setScoresFromForm(team) {
  const form = team?.form || {};
  const rows = form.vnlLast5SetScores || form.last5SetScores || [];
  return Array.isArray(rows) ? rows.map((row) => typeof row === 'object' ? row.setScore : row).filter((s) => /^(3-[012]|[012]-3)$/.test(String(s))) : [];
}

function resultFromMeeting(meeting, favourite) {
  if (meeting?.result === 'W' || meeting?.result === 'L') return meeting.result;
  return teamName(meeting?.winner) === teamName(favourite) ? 'W' : 'L';
}

function invertScore(score) {
  const m = String(score || '').match(/^(\d)-(\d)$/);
  return m ? `${m[2]}-${m[1]}` : null;
}

function orientedMeetings(match, favourite) {
  const source = match?.h2h?.recentMeetings || match?.h2h?.meetings || [];
  if (!Array.isArray(source)) return [];
  return source.slice(0, 3).map((meeting) => {
    const won = resultFromMeeting(meeting, favourite) === 'W';
    const sourceScore = meeting.setScore || meeting.score || null;
    return {
      result: won ? 'W' : 'L',
      setScore: won ? sourceScore : invertScore(sourceScore),
    };
  });
}

/** Read two-or-more named bookmaker lines and return their consensus favourite.
 * The method does not use OLBG tipster votes as prices. */
export function consensusFavourite(match) {
  const books = match?.odds?.books;
  if (!Array.isArray(books)) return { ok: false, reason: 'two-book moneyline is not sourced' };
  const usable = books.map((book) => {
    const home = normaliseOdds(book?.home);
    const away = normaliseOdds(book?.away);
    return { name: String(book?.book || book?.name || '').trim(), home, away, source_url: book?.source_url || null };
  }).filter((book) => book.name && book.home && book.away);
  const names = new Set(usable.map((b) => b.name.toLowerCase()));
  if (names.size < 2) return { ok: false, reason: 'fewer than two named bookmaker moneylines are sourced' };

  const vote = { home: 0, away: 0 };
  for (const book of usable) {
    const homeP = americanToImpliedProb(book.home.american);
    const awayP = americanToImpliedProb(book.away.american);
    if (homeP === awayP) continue;
    vote[homeP > awayP ? 'home' : 'away'] += 1;
  }
  if (!vote.home || !vote.away && vote.home < 2 || !vote.away || !vote.home && vote.away < 2) {
    // An explicit expression is clearer than silently breaking an exact split:
    // consensus requires both books to identify the same side.
    const side = vote.home >= 2 ? 'home' : vote.away >= 2 ? 'away' : null;
    if (!side) return { ok: false, reason: 'bookmakers do not agree on a favourite' };
    const selected = usable.map((b) => b[side].american);
    return { ok: true, side, american: Math.round(selected.reduce((a, b) => a + b, 0) / selected.length), books: usable };
  }
  return { ok: false, reason: 'bookmakers do not agree on a favourite' };
}

function scoreForm(favourite, missing) {
  const results = valuesFromForm(favourite);
  if (results.length < 3) {
    uniquePush(missing, 'recent VNL form (at least three completed VNL results)');
    return component('recent_form', 'Recent Form', 0, 25, 'Insufficient verified VNL results.', { missing: true });
  }
  const wins = results.filter((r) => r === 'W').length;
  const rate = wins / results.length;
  const points = rate >= 0.8 ? 25 : rate >= 0.4 ? 15 : 5;
  const detail = points === 25 ? 'Strong recent VNL form.' : points === 15 ? 'Mixed recent VNL form.' : 'Clear recent VNL downturn.';
  return component('recent_form', 'Recent Form', points, 25, detail, { evidence: points ? 'recent VNL form' : null });
}

function scoreH2H(match, favourite, missing) {
  const h2h = match?.h2h;
  const meetings = orientedMeetings(match, favourite);
  if (!h2h || (!meetings.length && h2h.knownNoMeaningfulHistory !== true)) {
    uniquePush(missing, 'head-to-head record (recent international meetings)');
    return component('head_to_head', 'Head-to-Head', 0, 20, 'No verified head-to-head record supplied.', { missing: true });
  }
  if (!meetings.length || h2h.knownNoMeaningfulHistory === true) {
    return component('head_to_head', 'Head-to-Head', 10, 20, 'No meaningful recent meeting: neutral default specified by the prompt.');
  }
  const wins = meetings.filter((m) => m.result === 'W').length;
  const points = meetings.length >= 3 && wins >= 2 ? 20 : wins * 2 >= meetings.length ? 10 : 0;
  const detail = points === 20 ? 'Recent meetings support the selected side.'
    : points === 10 ? 'Recent meetings are evenly balanced.' : 'Recent meetings favour the opponent.';
  return component('head_to_head', 'Head-to-Head', points, 20, detail, { evidence: points === 20 ? 'head-to-head record' : null });
}

function scoreRoster(favourite, missing) {
  const status = favourite?.roster?.status;
  if (!status) {
    uniquePush(missing, 'match-specific confirmed roster status');
    return component('squad_roster', 'Squad and Roster Strength', 0, 20, 'No verified match-specific roster status.', { missing: true });
  }
  const points = status === 'confirmed_full' ? 20 : status === 'rotation_replacement' ? 12 : 0;
  const detail = status === 'confirmed_full' ? 'Confirmed full-strength roster.'
    : status === 'rotation_replacement' ? 'A rotation or rest change has a documented like-for-like replacement.'
      : status === 'key_absence' ? 'A documented key-player absence.' : 'Roster status is not in the approved data vocabulary.';
  return component('squad_roster', 'Squad and Roster Strength', points, 20, detail, { missing: !['confirmed_full', 'rotation_replacement', 'key_absence'].includes(status), evidence: points ? 'confirmed squad availability' : null });
}

function scoreOdds(favouriteLine, favourite, opponent, h2h, form, missing) {
  if (!favouriteLine) {
    uniquePush(missing, 'moneyline from at least two named bookmakers');
    return component('odds_value', 'Odds and Value', 0, 15, 'No two-book moneyline consensus.', { missing: true });
  }
  const american = favouriteLine.american;
  let points = american <= -300 ? 15 : american <= -200 ? 11 : american <= -150 ? 7 : american <= -100 ? 4 : 0;
  const opponentForm = valuesFromForm(opponent);
  const opponentMeetings = orientedMeetings(h2h?.match || {}, opponent);
  // Value is reviewed on the named underdog's own verified case; it does not
  // change a favourite selection unless a separate pricing model supplies it.
  const underdogLive = american > 0 && opponentForm.length >= 3
    && opponentForm.filter((x) => x === 'W').length / opponentForm.length >= 0.6
    && opponentMeetings.filter((x) => x.result === 'W').length >= 2;
  if (underdogLive) points = 8;
  const detail = underdogLive ? 'Underdog has a sourced live form and head-to-head case.' : 'Consensus price band is used internally only.';
  return component('odds_value', 'Odds and Value', points, 15, detail, { evidence: points ? 'cross-checked market price' : null });
}

function scoreStakes(favourite, match, missing) {
  const status = favourite?.stakes?.status || favourite?.standings?.qualificationStatus;
  const host = favourite?.stakes?.hostingWeek === true || match?.context?.hostTeam === favourite?.name;
  if (!status) {
    uniquePush(missing, 'qualification, relegation and hosting-week context');
    return component('stakes_motivation', 'Stakes and Motivation', 0, 20, 'No verified qualification or relegation context.', { missing: true });
  }
  const urgency = ['finals_fight', 'relegation_fight'].includes(status) ? 20
    : ['comfortably_qualified', 'eliminated'].includes(status) ? 5 : 0;
  // The supplied prompt says this block totals 20 but also says to add five
  // host points. We preserve the 100-point market by applying the explicit
  // 20-point cap; the audit trail shows whether host context was present.
  const points = Math.min(20, urgency + (host ? 5 : 0));
  const detail = host ? `${urgency === 20 ? 'High urgency with confirmed hosting-week context.' : 'Hosting-week context; qualification urgency is limited.'}`
    : urgency === 20 ? 'Team is in a verified Finals or relegation fight.'
      : urgency === 5 ? 'Team is safely qualified or unable to qualify, so rotation risk is noted.' : 'No material qualification status verified.';
  return component('stakes_motivation', 'Stakes and Motivation', points, 20, detail, { evidence: points ? 'standings stakes' : null });
}

function qualityGap(favourite, opponent, missing) {
  const supplied = String(favourite?.qualityGap || '').toLowerCase();
  if (['wide', 'moderate', 'close'].includes(supplied)) return supplied;
  const fs = favourite?.stats;
  const os = opponent?.stats;
  if (!fs || !os || !Number.isFinite(fs.killsPerSet) || !Number.isFinite(os.killsPerSet)
    || !Number.isFinite(fs.blocksPerSet) || !Number.isFinite(os.blocksPerSet)
    || !Number.isFinite(fs.aceToErrorRatio) || !Number.isFinite(os.aceToErrorRatio)) {
    uniquePush(missing, 'recent team kills, blocks and ace-to-error rates');
    return null;
  }
  const killGap = fs.killsPerSet - os.killsPerSet;
  const blockGap = fs.blocksPerSet - os.blocksPerSet;
  const aceGap = fs.aceToErrorRatio - os.aceToErrorRatio;
  if (killGap >= 1 && blockGap >= 0.5 && aceGap >= 0.1) return 'wide';
  if (killGap >= 0.4 || blockGap >= 0.25 || aceGap >= 0.05) return 'moderate';
  return 'close';
}

function applySetPoints(table, outcome, id, label, points, max, detail, evidence = null) {
  table[outcome].components.push(component(id, label, points, max, detail, { evidence }));
  table[outcome].score += points;
}

function setOutcomeTable() {
  return Object.fromEntries(['3-0', '3-1', '3-2'].map((outcome) => [outcome, { outcome, score: 0, components: [] }]));
}

function scoreSetMarket(match, favourite, opponent, missing) {
  const table = setOutcomeTable();
  const gap = qualityGap(favourite, opponent, missing);
  if (!gap) {
    for (const o of Object.keys(table)) applySetPoints(table, o, 'quality_gap', 'Quality Gap', 0, 35, 'No complete verified team-rate comparison.');
  } else {
    const selected = gap === 'wide' ? '3-0' : gap === 'moderate' ? '3-1' : '3-2';
    for (const o of Object.keys(table)) applySetPoints(table, o, 'quality_gap', 'Quality Gap', o === selected ? (gap === 'close' ? 30 : gap === 'wide' ? 35 : 25) : 0, 35,
      gap === 'wide' ? 'Wide sourced quality gap.' : gap === 'moderate' ? 'Moderate sourced quality gap.' : 'Sourced indicators show a close matchup.', o === selected ? 'quality gap' : null);
  }

  const setScores = setScoresFromForm(favourite).filter((s) => String(s).startsWith('3-'));
  if (setScores.length < 3) {
    uniquePush(missing, 'recent VNL set-score pattern');
    for (const o of Object.keys(table)) applySetPoints(table, o, 'recent_set_pattern', 'Recent Set-Score Pattern', 0, 30, 'Insufficient verified recent set scores.');
  } else {
    const counts = Object.fromEntries(['3-0', '3-1', '3-2'].map((o) => [o, setScores.filter((s) => s === o).length]));
    const chosen = ['3-0', '3-1', '3-2'].sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
    for (const o of Object.keys(table)) applySetPoints(table, o, 'recent_set_pattern', 'Recent Set-Score Pattern', o === chosen ? 30 : 0, 30,
      o === chosen ? 'Recent comparable VNL wins most often finished this way.' : 'Pattern does not support this outcome.', o === chosen ? 'recent set pattern' : null);
  }

  const selfStakes = favourite?.stakes?.status || favourite?.standings?.qualificationStatus;
  const oppStakes = opponent?.stakes?.status || opponent?.standings?.qualificationStatus;
  const highStakes = ['finals_fight', 'relegation_fight'].includes(selfStakes) || ['finals_fight', 'relegation_fight'].includes(oppStakes);
  if (!selfStakes && !oppStakes) {
    uniquePush(missing, 'VNL standings incentive for set-margin assessment');
    for (const o of Object.keys(table)) applySetPoints(table, o, 'standings_incentive', 'Standings Incentive', 0, 20, 'No verified qualification or relegation context.');
  } else {
    for (const o of Object.keys(table)) applySetPoints(table, o, 'standings_incentive', 'Standings Incentive', highStakes && o === '3-2' ? 20 : 0, 20,
      highStakes && o === '3-2' ? 'Verified standings pressure can make a five-set finish more plausible.' : 'No additional margin support from verified standings context.', highStakes && o === '3-2' ? 'standings incentive' : null);
  }

  const meetings = orientedMeetings(match, favourite).filter((m) => /^(3-[012]|[012]-3)$/.test(String(m.setScore)));
  if (meetings.length < 2) {
    uniquePush(missing, 'head-to-head set-score pattern');
    for (const o of Object.keys(table)) applySetPoints(table, o, 'h2h_set_pattern', 'Head-to-Head Set Pattern', 0, 15, 'Insufficient verified head-to-head set scores.');
  } else {
    const groups = Object.fromEntries(['3-0', '3-1', '3-2'].map((o) => [o, meetings.filter((m) => m.setScore === o).length]));
    const chosen = ['3-0', '3-1', '3-2'].sort((a, b) => groups[b] - groups[a] || a.localeCompare(b))[0];
    for (const o of Object.keys(table)) applySetPoints(table, o, 'h2h_set_pattern', 'Head-to-Head Set Pattern', o === chosen ? 15 : 0, 15,
      o === chosen ? 'Recent verified meetings show this margin pattern.' : 'Meeting history does not support this outcome.', o === chosen ? 'head-to-head set pattern' : null);
  }

  const ordered = Object.values(table).sort((a, b) => b.score - a.score || a.outcome.localeCompare(b.outcome));
  const leading = ordered[0];
  const runnerUp = ordered[1];
  const tooClose = leading.score - runnerUp.score < 10;
  const band = leading.score >= 70 ? CONFIDENCE.HIGH : leading.score >= 55 && !tooClose ? CONFIDENCE.MEDIUM : CONFIDENCE.SKIP;
  return {
    outcome: leading.outcome,
    selection: band === CONFIDENCE.SKIP ? null : `${favourite.name} ${leading.outcome}`,
    score: leading.score,
    band,
    components: leading.components,
    outcomes: ordered.map((o) => ({ outcome: o.outcome, score: o.score })),
    flags: tooClose ? ['SET_SCORE_TOO_CLOSE'] : [],
  };
}

function countAligned(components) {
  return components.filter((c) => c.points > 0).length;
}

/** Score one VNL Women fixture. Out-of-scope competition rows never receive a
 * football/college/EuroVolley-style substitute score. */
export function scoreVolleyballMatch(match = {}) {
  const missing = [];
  const flags = [];
  const family = match.family || match.competition?.family || match.competition?.code;
  if (family !== 'vnl-women') {
    return {
      ruleset: RULESET_VERSION,
      event_id: match.event_id || match.id || null,
      favourite: null,
      opponent: null,
      missing: ['competition scope: this engine is limited to FIVB VNL Women'],
      flags: ['OUT_OF_SCOPE_COMPETITION'],
      markets: {
        win_match: { selection: null, score: 0, band: CONFIDENCE.SKIP, components: [], reason: 'Fixture is not FIVB VNL Women.' },
        set_score: { selection: null, outcome: null, score: 0, band: CONFIDENCE.SKIP, components: [], outcomes: [], reason: 'Fixture is not FIVB VNL Women.' },
      },
    };
  }

  const consensus = consensusFavourite(match);
  if (!consensus.ok) {
    uniquePush(missing, 'moneyline consensus from at least two named bookmakers');
    flags.push('NO_TWO_BOOK_FAVOURITE');
    return {
      ruleset: RULESET_VERSION,
      event_id: match.event_id || match.id || null,
      favourite: null,
      opponent: null,
      missing,
      flags,
      markets: {
        win_match: { selection: null, score: 0, band: CONFIDENCE.SKIP, components: [component('odds_value', 'Odds and Value', 0, 15, consensus.reason, { missing: true })], reason: consensus.reason },
        set_score: { selection: null, outcome: null, score: 0, band: CONFIDENCE.SKIP, components: [], outcomes: [], reason: consensus.reason },
      },
    };
  }

  const favourite = teamFor(match, consensus.side);
  const opponent = teamFor(match, consensus.side === 'home' ? 'away' : 'home');
  const form = scoreForm(favourite, missing);
  const h2h = scoreH2H(match, favourite.name, missing);
  const roster = scoreRoster(favourite, missing);
  const odds = scoreOdds(consensus, favourite, opponent, { match }, form, missing);
  const stakes = scoreStakes(favourite, match, missing);
  const components = [form, h2h, roster, odds, stakes];
  const score = components.reduce((sum, item) => sum + item.points, 0);
  const aligned = countAligned(components);
  const winBand = score >= 70 ? CONFIDENCE.HIGH : score >= 50 && aligned >= 2 ? CONFIDENCE.MEDIUM : CONFIDENCE.SKIP;
  if (score >= 50 && aligned < 2) flags.push('WIN_MATCH_NEEDS_TWO_ALIGNED_FACTORS');

  const set = scoreSetMarket(match, favourite, opponent, missing);
  flags.push(...set.flags);
  const opposingLine = consensus.books.map((b) => b[consensus.side === 'home' ? 'away' : 'home'].american);
  const valueCandidate = opposingLine.some((line) => line > 0)
    && valuesFromForm(opponent).length >= 3
    && valuesFromForm(opponent).filter((r) => r === 'W').length / valuesFromForm(opponent).length >= 0.6
    && orientedMeetings(match, opponent.name).filter((m) => m.result === 'W').length >= 2;

  return {
    ruleset: RULESET_VERSION,
    event_id: match.event_id || match.id || null,
    favourite: favourite.name,
    opponent: opponent.name,
    favouriteSide: consensus.side,
    missing,
    flags: [...new Set(flags)],
    evidence: {
      win_match: components.filter((c) => c.evidence).map((c) => c.evidence),
      set_score: set.components.filter((c) => c.evidence).map((c) => c.evidence),
    },
    valueCandidate: valueCandidate ? { team: opponent.name, reason: 'Underdog has a verified live form and meeting-history case.' } : null,
    markets: {
      win_match: { selection: winBand === CONFIDENCE.SKIP ? null : favourite.name, score, band: winBand, components },
      set_score: set,
    },
  };
}

export function scoreVolleyballCard(matches = []) {
  return { ruleset: RULESET_VERSION, results: matches.map((match) => ({ match, result: scoreVolleyballMatch(match) })) };
}
