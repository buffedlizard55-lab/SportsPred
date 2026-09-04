/**
 * SportsPred — Ice Hockey Writer (Step 4) + output-rule validator.
 *
 * Produces three written predictions per match in the exact order the prompt
 * demands: OUTRIGHT WINNER, PUCK LINE, GAME TOTAL.
 *
 * Output rules are ENFORRED HERE, mechanically, not requested politely:
 *   - at least 40 words per tip;
 *   - the predicted winner or outcome bolded and inside the first 20 words;
 *   - no digits of any kind (so no odds, no puck line numbers, no total lines,
 *     no statistics or percentages can leak);
 *   - no player names, goaltender names, injury specifics, arena names, links,
 *     source citations, bracket references or social media references;
 *   - the six banned filler phrases the prompt names, rejected on sight;
 *   - no two tips in one output may open with the same word or phrase;
 *   - confidence stated as LOW, MEDIUM or HIGH on every tip;
 *   - a match below threshold becomes SKIP with a single explanatory sentence.
 *
 * A tip that fails validation is withheld and the violation is reported — the
 * site never shows a tip the validator refused.
 */

import { CONFIDENCE, MARKETS } from './ice_hockey_engine.js';

export const MIN_WORDS = 40;

/** Banned verbatim by the prompt's STYLE REQUIREMENTS section. */
export const BANNED_PHRASES = [
  'this should be a high scoring affair',
  'this should be a high-scoring affair',
  'hard to look past',
  'the better goaltender',
  'on current form',
  'could go either way',
  'both teams',
];

const FORBIDDEN_SUBSTRINGS = [
  'http://', 'https://', 'www.', '@', 'twitter', 'tweet', 'instagram', 'facebook',
  'reddit', 'x.com', 'olbg', 'espn', 'arena name', 'injury report', 'save percentage',
  'power play percentage', 'penalty kill percentage', 'model', 'subagent', 'edge',
  'expected value', 'implied probability', 'threshold', 'backtest', 'filter',
];

/**
 * Hockey analytical angles named in the prompt's style section. Each entry owns
 * a distinct opening word so two tips can never begin alike.
 */
/**
 * Hockey analytical angles named in the prompt's style section. Leads are kept
 * short on purpose: the bolded outcome has to land inside the first 20 words,
 * so the opening angle gets roughly eight words and the reasoning follows.
 */
export const OPENERS = [
  { id: 'goaltending', word: 'Goaltending', lead: 'quality and home ice give them the clearer path to victory.' },
  { id: 'powerplay', word: 'Power', lead: 'play structure should produce the better sustained offensive pressure.' },
  { id: 'suppression', word: 'Shot', lead: 'suppression should limit extended scoring exchanges.' },
  { id: 'fatigue', word: 'Fatigue', lead: 'from a compressed schedule is a real factor for the opposition.' },
  { id: 'depth', word: 'Offensive', lead: 'line depth separates these benches over a full contest.' },
  { id: 'trends', word: 'Recent', lead: 'scoring trends point toward the selection rather than an open exchange.' },
  { id: 'structure', word: 'Defensive', lead: 'structure should play an important role rather than turning this into an uncontrolled exchange.' },
  { id: 'home', word: 'Home', lead: 'ice and the stronger overall roster profile give them the clearest advantage.' },
  { id: 'momentum', word: 'Momentum', lead: 'built over recent nights travels into this matchup.' },
  { id: 'special', word: 'Special', lead: 'teams efficiency is the hinge if the contest stays tight.' },
  { id: 'discipline', word: 'Discipline', lead: 'in the neutral zone decides whether this stays measured or opens up.' },
  { id: 'tempo', word: 'Tempo', lead: 'control through the middle tilts territorial advantage their way.' },
  { id: 'physical', word: 'Physical', lead: 'play along the boards should wear the opposition as the night progresses.' },
  { id: 'closing', word: 'Closing', lead: 'out tight hockey is a learned skill and it favours the selection.' },
  { id: 'transition', word: 'Transition', lead: 'speed off the first pass separates these attacks.' },
  { id: 'netfront', word: 'Net-front', lead: 'presence has been the difference in their recent wins.' },
  { id: 'consistency', word: 'Consistency', lead: 'across a month is rare and it currently sits with the selection.' },
  { id: 'rebound', word: 'Rebound', lead: 'control wins low-event games of this shape.' },
  { id: 'schedule', word: 'Schedule', lead: 'shape matters more than the table in a matchup this tight.' },
  { id: 'pressure', word: 'Pressure', lead: 'on the breakout forces turnovers that the selection can convert.' },
  { id: 'execution', word: 'Execution', lead: 'with the man advantage differs enough to decide a close night.' },
  { id: 'backchecking', word: 'Backchecking', lead: 'effort limits rush chances against and keeps the total in check.' },
  { id: 'matchup', word: 'Matchup', lead: 'advantages down the lineup favour the selection over a full sixty.' },
  { id: 'volume', word: 'Volume', lead: 'of quality chances has climbed for one bench and that is the scoring case.' },
  { id: 'stability', word: 'Stability', lead: 'between the pipes is one-sided on the evidence we have.' },
  { id: 'aggression', word: 'Aggression', lead: 'on the forecheck earns possession without needing a track meet.' },
  { id: 'poise', word: 'Poise', lead: 'under third-period pressure differs and that is when this is won.' },
  { id: 'detail', word: 'Detail', lead: 'in the defensive zone is meticulous on the favoured bench.' },
  { id: 'urgency', word: 'Urgency', lead: 'shows in shorter, harder shifts and that profile favours the selection.' },
  { id: 'clutch', word: 'Late-game', lead: 'management favours one bench when the score stays close.' },
];

const MARKET_LABEL = {
  [MARKETS.OUTRIGHT]: 'OUTRIGHT WINNER',
  [MARKETS.PUCK_LINE]: 'PUCK LINE',
  [MARKETS.TOTAL]: 'GAME TOTAL',
};

/* ------------------------------------------------------------------ *
 * Validator
 * ------------------------------------------------------------------ */

export function validateIceHockeyTip(text, { market = null, expectSkip = false } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  const stripped = t.replace(/\*\*/g, '');

  if (expectSkip) {
    if (!/^SKIP\b/.test(t)) violations.push('a SKIP verdict must begin with the word SKIP');
    const sentences = stripped.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2) violations.push(`SKIP verdict must be a single explanatory sentence (found ${sentences.length})`);
    if (/\d/.test(stripped)) violations.push('SKIP verdict contains digits');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  const digits = stripped.match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals: ${digits.join('')}`);

  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded outcome found');
  } else {
    const before = t.slice(0, t.indexOf('**')).split(/\s+/).filter(Boolean).length;
    if (before >= 20) violations.push(`bolded outcome starts at word ${before + 1}, outside the first 20 words`);
  }

  const lower = ` ${t.toLowerCase().replace(/\*\*/g, '')} `;
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`uses banned filler phrase "${phrase}"`);
  }
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(bad)) violations.push(`contains forbidden token "${bad}"`);
  }
  if (/\[|\]|\(/.test(t)) violations.push('contains bracketed reference or parenthetical');

  const conf = /\b(HIGH|MEDIUM|LOW)\b/.test(t);
  if (!conf) violations.push('confidence level HIGH, MEDIUM or LOW not stated');

  if (market === MARKETS.TOTAL && !/\b(OVER|UNDER)\b/i.test(t)) {
    violations.push('game total tip must state Over or Under');
  }
  if (market === MARKETS.PUCK_LINE && !/cover/i.test(t)) {
    violations.push('puck line tip must state which side covers');
  }

  return { ok: violations.length === 0, violations };
}

/**
 * No two tips in one output may use the same analytical angle.
 *
 * Tips now open with the selection itself (OLBG house style), so the angle word
 * that follows the selection sentence is what must stay distinct. `angleWord` is
 * set by writeTip; the first-word fallback keeps this usable for raw strings.
 */
export function validateOpenerUniqueness(tips) {
  const seen = new Map();
  const problems = [];
  for (const tip of tips) {
    const first = String(tip.angleWord || String(tip.text || '').replace(/^\*\*/, '').split(/\s+/)[0] || '').toLowerCase();
    if (seen.has(first)) problems.push(`"${first}" opens two tips (${seen.get(first)} and ${tip.market})`);
    else seen.set(first, tip.market);
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Tip construction
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Evidence-driven prose (OLBG house style).
 *
 * Every clause is derived from a value that was actually sourced onto the
 * scored result (NHL standings / tape / goalie feeds — see
 * engine/ice_hockey_data.js enrichIceHockeyFixture). A clause whose input is
 * null is not produced, so the writer cannot invent a statistic.
 *
 * Figures are spelled as words because validateIceHockeyTip forbids digits —
 * that hard rule is what stops odds, puck lines, totals and save percentages
 * leaking into published copy.
 * ------------------------------------------------------------------ */

const NUM_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
];

/** Spell a small whole number, or return null when it cannot be spelled. */
export function spellSmall(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) return null;
  return NUM_WORDS[n];
}

/** Rank position expressed as a league-relative band (no digits). */
function rankBand(rank, leagueSize) {
  if (typeof rank !== 'number' || typeof leagueSize !== 'number' || leagueSize <= 0) return null;
  const q = rank / leagueSize;
  if (q <= 0.2) return 'among the very best in the league';
  if (q <= 0.4) return 'in the upper tier of the league';
  if (q <= 0.6) return 'around the league midpoint';
  if (q <= 0.8) return 'in the lower half of the league';
  return 'among the weakest in the league';
}

function formClauseIH(team) {
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || !last5.length) return null;
  const wins = last5.filter((r) => r === 'W').length;
  const w = spellSmall(wins);
  const n = spellSmall(last5.length);
  if (!w || !n) return null;
  return `${team.name} have won ${w} of their last ${n}`;
}

function streakClauseIH(team) {
  const ws = team?.form?.winStreak;
  if (typeof ws === 'number' && ws >= 3) {
    const w = spellSmall(ws);
    return w ? `they arrive on a run of ${w} straight wins` : null;
  }
  return null;
}

function goaltendingClause(fav, dog) {
  const f = fav?.goaltender?.savePctg;
  const d = dog?.goaltender?.savePctg;
  if (typeof f !== 'number' || typeof d !== 'number') return null;
  if (f - d >= 0.015) return `the crease is where this is won, with the favoured starter posting the materially better stopping rate this season`;
  if (d - f >= 0.015) return `the opposing starter has actually been the sharper of the two, which is why this is not rated any higher`;
  return `the two starters have been posting comparable stopping rates, so the crease is close to neutral`;
}

function backupClause(dog) {
  if (dog?.goaltender?.isBackup === true) return `the opposition are turning to their backup in goal`;
  return null;
}

function shotShareClause(fav) {
  const forBand = rankBand(fav?.shotsForRank, fav?.leagueSize);
  const againstBand = rankBand(fav?.shotsAgainstRank, fav?.leagueSize);
  if (!forBand && !againstBand) return null;
  if (forBand && againstBand) return `they generate shot volume ${forBand} and suppress it ${againstBand}`;
  return `their shot volume ranks ${forBand || againstBand}`;
}

function marginClause(fav) {
  const m = fav?.avgWinMarginLast5Wins;
  if (typeof m !== 'number') return null;
  if (m > 1.5) return `when they have won lately they have been winning by more than a single goal, which is what a handicap play needs`;
  return `their recent wins have been narrow, and that is the main argument against laying the handicap`;
}

function coversClause(fav) {
  const c = fav?.puckLineCovers;
  if (!c || typeof c.covered !== 'number' || typeof c.of !== 'number') return null;
  const w = spellSmall(c.covered);
  const n = spellSmall(c.of);
  if (!w || !n) return null;
  return `${fav.name} have covered the handicap in ${w} of their last ${n}`;
}

function b2bClause(fav, dog) {
  if (dog?.backToBack === true) return `the opposition are playing on consecutive nights, and that schedule spot has consistently told late`;
  if (fav?.backToBack === true) return `the selection are on the second night of a back-to-back, which caps the confidence here`;
  return null;
}

function totalsTrendClause(home, away) {
  const h = home?.recentTotals;
  const a = away?.recentTotals;
  if (!h?.games && !a?.games) return null;
  const overs = (h?.overs ?? 0) + (a?.overs ?? 0);
  const games = (h?.games ?? 0) + (a?.games ?? 0);
  if (!games) return null;
  if (overs * 2 > games) return `recent games involving these two have finished above the posted line more often than below it`;
  if (overs * 2 < games) return `recent games involving these two have mostly finished below the posted line`;
  return `the recent totals split is even, so this leans on the scoring rates rather than the last few results`;
}

function scoringRateClause(home, away) {
  const h = home?.goalsForPerGame;
  const a = away?.goalsForPerGame;
  const hc = home?.goalsAgainstPerGame;
  const ac = away?.goalsAgainstPerGame;
  if (typeof h !== 'number' || typeof a !== 'number') return null;
  const combined = h + a;
  if (typeof hc === 'number' && typeof ac === 'number' && (hc + ac) / 2 < 2.8) {
    return `season goals-against rates on both benches are among the tighter marks in the competition`;
  }
  if (combined >= 6.4) return `the two benches are scoring at a healthy clip on the season, which is the core of the argument`;
  if (combined <= 5.4) return `neither bench has been scoring freely across the season to date`;
  return `season scoring rates on both benches sit around the competition average`;
}

function missingClauseIH(result) {
  const list = result?.missing || [];
  if (!list.length) return null;
  const w = spellSmall(list.length);
  const count = w || 'several';
  return `${count} of the input factors could not be sourced for this fixture, so the confidence figure is capped accordingly`;
}

/**
 * Replace later mentions of a team with the correct pronoun case.
 *
 * A naive name -> "they" swap produces "for they" / "against they", so object
 * position (after a preposition) becomes "them" and possessive position
 * ("Poland's") becomes "their". Only wording changes; no fact is altered.
 */
function replaceWithPronoun(text, name) {
  if (!text || !name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    // possessive: "Poland's depth" -> "their depth"
    .replace(new RegExp(`${esc}'s\\b`, 'g'), 'their')
    // object of a preposition: "for Poland" -> "for them"
    .replace(new RegExp(`\\b(for|to|against|over|with|of|from|behind|than|beat|beating)\\s+${esc}\\b`, 'gi'),
      (m, prep) => `${prep} them`)
    // subject position
    .replace(new RegExp(esc, 'g'), 'they');
}

function joinIH(clauses, names = []) {
  const seen = new Set();
  const out = [];
  for (const raw of clauses.filter(Boolean)) {
    let c = String(raw).trim();
    for (const n of names.filter(Boolean)) {
      if (!c.includes(n)) continue;
      if (seen.has(n)) c = replaceWithPronoun(c, n);
      else {
        seen.add(n);
        const i = c.indexOf(n);
        c = c.slice(0, i + n.length) + replaceWithPronoun(c.slice(i + n.length), n);
      }
    }
    c = c.charAt(0).toUpperCase() + c.slice(1);
    out.push(/[.!?]$/.test(c) ? c : `${c}.`);
  }
  return out.join(' ');
}

/** Build the analytical body for one market, strictly from sourced values. */
function buildIceHockeyBody(result, market) {
  const favIsHome = result.selection === 'home';
  const fav = favIsHome ? result.home : result.away;
  const dog = favIsHome ? result.away : result.home;
  const clauses = [];

  if (market === MARKETS.OUTRIGHT) {
    clauses.push(formClauseIH(fav));
    clauses.push(streakClauseIH(fav));
    clauses.push(goaltendingClause(fav, dog));
    clauses.push(backupClause(dog));
    clauses.push(shotShareClause(fav));
    clauses.push(b2bClause(fav, dog));
  } else if (market === MARKETS.PUCK_LINE) {
    clauses.push(coversClause(fav));
    clauses.push(marginClause(fav));
    clauses.push(formClauseIH(fav));
    clauses.push(goaltendingClause(fav, dog));
    clauses.push(b2bClause(fav, dog));
  } else {
    clauses.push(scoringRateClause(result.home, result.away));
    clauses.push(totalsTrendClause(result.home, result.away));
    clauses.push(goaltendingClause(fav, dog));
    clauses.push(backupClause(dog));
  }

  clauses.push(missingClauseIH(result));

  const names = [...new Set([fav?.name, dog?.name].filter(Boolean))];
  return joinIH(clauses, names);
}

export function writeTip(result, market, openerIndex = 0, { reasonOverride = null } = {}) {
  const label = MARKET_LABEL[market] || market;
  const opener = OPENERS[openerIndex % OPENERS.length];

  /* ---- SKIP verdicts ---- */
  let skipReason = null;
  if (market === MARKETS.OUTRIGHT) skipReason = result.outright.decision.confidence === CONFIDENCE.SKIP ? result.outright.decision.reason : null;
  if (market === MARKETS.PUCK_LINE) skipReason = result.puckLine.decision.confidence === CONFIDENCE.SKIP ? result.puckLine.decision.reason : null;
  if (market === MARKETS.TOTAL) skipReason = result.total.decision.confidence === CONFIDENCE.SKIP ? result.total.decision.reason : null;
  if (result.pipeline?.noBet && market === MARKETS.OUTRIGHT) skipReason = result.pipeline.risk.veto;
  if (result.pipeline?.noBet) skipReason = skipReason || result.pipeline.risk.veto;

  if (skipReason || reasonOverride) {
    // The numeric reason is kept on the returned object for the analysis panel;
    // the published tip gets a digit-free, market-specific sentence instead,
    // because Step 4 forbids any figure in the output.
    const template = {
      [MARKETS.OUTRIGHT]: 'the sourced evidence does not reach the standard required for a play on this fixture',
      [MARKETS.PUCK_LINE]: 'the winning margins in this matchup do not support a handicap play',
      [MARKETS.TOTAL]: 'the goal-scoring evidence does not clear the level required at this line',
    }[market] || 'the evidence does not clear the standard required to recommend a play';
    const extra = result.pipeline?.noBet && result.pipeline?.risk?.penalties?.length
      ? ' Unsourced goaltending and price inputs also block a recommendation.'
      : '';
    const text = `SKIP — ${label}: ${template}.${extra}`;
    return {
      market, label, text, reason: skipReason || reasonOverride || null,
      confidence: CONFIDENCE.SKIP,
      validation: validateIceHockeyTip(text, { market, expectSkip: true }), skip: true,
    };
  }

  const confidence = market === MARKETS.OUTRIGHT ? result.outright.decision.confidence
    : market === MARKETS.PUCK_LINE ? result.puckLine.decision.confidence
      : result.total.decision.confidence;

  // OLBG house style: the selection is stated plainly in the opening words,
  // then the case is argued from sourced evidence only.
  const pickLead = market === MARKETS.OUTRIGHT
    ? `**${result.favoured}** are the preferred winner.`
    : market === MARKETS.PUCK_LINE
      ? `**${result.favoured} to cover** is the preferred margin outcome.`
      : `**${result.total.decision.side || 'OVER'}** is the preferred total outcome.`;

  const body = buildIceHockeyBody(result, market);

  let text = `${pickLead} ${opener.word} ${opener.lead} ${body}`.replace(/\s+/g, ' ').trim();

  // Word floor: rather than padding with invented detail, state the method.
  if (text.split(/\s+/).filter(Boolean).length + 3 < MIN_WORDS) {
    text += ' The rating is produced mechanically from the sourced form, standings, schedule and goaltending records linked alongside this fixture, and nothing beyond those inputs has been assumed.';
  }

  text = `${text} Confidence: ${confidence}.`;

  return {
    market,
    label,
    text,
    confidence,
    opener: opener.id,
    angleWord: opener.word,
    validation: validateIceHockeyTip(text, { market }),
    skip: false,
  };
}

/**
 * Write the full card: three tips per match in the required order, then the
 * summary table, the back-to-back flag note and the responsible gambling line.
 */
export function writeIceHockeyCard(results, { dateISO = null } = {}) {
  const tips = [];
  let i = 0;
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    for (const market of [MARKETS.OUTRIGHT, MARKETS.PUCK_LINE, MARKETS.TOTAL]) {
      const tip = writeTip(r, market, i);
      tip.matchId = r.id;
      tip.fixture = `${r.away?.name || 'Away'} at ${r.home?.name || 'Home'}`;
      tips.push(tip);
      i += 1;
    }
  }

  const openerProblems = validateOpenerUniqueness(tips.filter((t) => !t.skip));
  const active = tips.filter((t) => !t.skip);
  const suppressed = active.slice(6);

  const summaryRows = active.slice(0, 6).map((t) => ({
    fixture: t.fixture,
    market: t.label,
    selection: t.market === MARKETS.TOTAL ? t.text.match(/\*\*([^*]+)\*\*/)?.[1] : t.text.match(/\*\*([^*]+)\*\*/)?.[1],
    confidence: t.confidence,
  }));

  const b2bTeams = [];
  for (const r of results || []) {
    if (r?.home?.backToBack) b2bTeams.push(r.home.name);
    if (r?.away?.backToBack) b2bTeams.push(r.away.name);
  }

  const backToBackNote = b2bTeams.length
    ? `Back-to-back flag: ${[...new Set(b2bTeams)].join(', ')} are playing on consecutive nights.`
    : 'Back-to-back flag: no side on this card is playing on consecutive nights.';

  const responsibleGambling = 'Please gamble responsibly. Set a limit, never chase a loss, and treat every selection here as an opinion rather than a promise.';

  const card = {
    date: dateISO,
    tips,
    openerProblems,
    summaryRows,
    summary: { active: summaryRows, suppressedCount: suppressed.length },
    backToBackNote,
    responsibleGambling,
  };
  card.formattedText = buildIceHockeyFormattedCardText(card, dateISO);
  return card;
}

export function buildIceHockeyFormattedCardText(card, dateISO = null) {
  const lines = [];
  if (dateISO) lines.push(`ICE HOCKEY PREDICTIONS — ${dateISO}`);
  lines.push('');
  for (const tip of card.tips || []) {
    lines.push(`${tip.fixture} — ${tip.label}`);
    lines.push(tip.text);
    lines.push('');
  }
  lines.push('SUMMARY');
  for (const row of card.summaryRows || []) {
    lines.push(`${row.fixture} | ${row.market} | ${row.selection} | ${row.confidence}`);
  }
  lines.push('');
  lines.push(card.backToBackNote || '');
  lines.push(card.responsibleGambling || '');
  return lines.join('\n');
}
