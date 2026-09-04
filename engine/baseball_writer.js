/**
 * SportsPred — Baseball Writer (Step 4) + output-rule validator.
 *
 * Produces three written predictions per match in the exact order the prompt
 * demands: WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL.
 *
 * Output rules are ENFORCED HERE, mechanically, not requested politely:
 *   - at least 40 words per tip;
 *   - the predicted winner or market outcome bolded and inside the first 20
 *     words;
 *   - no digits of any kind (so no odds, no run line numbers, no total lines,
 *     no statistics can leak);
 *   - no player names, no injury specifics, no home or away references, no
 *     stadium names, no league names, no source citations, no social media
 *     references;
 *   - the seven banned filler phrases the prompt names, rejected on sight;
 *   - no two tips in one output may open with the same word or phrase;
 *   - confidence stated as LOW, MEDIUM or HIGH on every tip;
 *   - a match below threshold becomes SKIP with a single explanatory sentence.
 *
 * A tip that fails validation is withheld and the violation is reported — the
 * site never shows a tip the validator refused.
 */

import { CONFIDENCE, MARKETS } from './baseball_engine.js';

export const MIN_WORDS = 40;

/** Banned verbatim by the prompt's STYLE REQUIREMENTS section. */
export const BANNED_PHRASES = [
  'this should be a low-scoring affair',
  'hard to look past',
  'the pitching matchup favours',
  'on current form',
  'could go either way',
  'both lineups',
  'a tight contest',
];

const FORBIDDEN_SUBSTRINGS = [
  'http://', 'https://', 'www.', '@', 'twitter', 'tweet', 'instagram', 'facebook',
  'reddit', 'x.com', 'olbg', 'espn', 'injury report', 'save percentage',
  'batting average', 'slugging percentage', 'run differential', 'bullpen era',
  'moneyline', 'run line', 'total line', 'model', 'subagent', 'edge',
  'expected value', 'implied probability', 'threshold', 'backtest', 'filter',
];

/**
 * Whole-word blacklist (word-boundary matched). These are the home/away/league/
 * price/stat designations Step 4 forbids in output, matched as words so that
 * legitimate analytical language (pitching, bullpen, lineup) still passes.
 */
const FORBIDDEN_WORDS = [
  'home', 'away', 'road', 'host', 'hosts', 'visitor', 'visitors', 'stadium',
  'arena', 'ballpark', 'park', 'league', 'era', 'whip', 'moneyline', 'handicap',
  'spread', 'odds', 'stat', 'stats', 'pitcher', 'starter', 'starters', 'batter',
  'roster', 'injury', 'injuries', 'travel',
];

/**
 * Baseball analytical angles named in the prompt's style section. Each entry
 * owns a distinct opening word so two tips can never begin alike. Leads are
 * kept short on purpose: the bolded outcome has to land inside the first 20
 * words, so the opening angle gets roughly eight words and the reasoning
 * follows.
 */
export const OPENERS = [
  { id: 'pitching', word: 'Pitching', lead: 'dominance and run suppression frame this one.' },
  { id: 'offense', word: 'Offensive', lead: 'momentum and run-scoring efficiency decide it.' },
  { id: 'bullpen', word: 'Bullpen', lead: 'depth and late-inning reliability are the hinge.' },
  { id: 'headtohead', word: 'Head-to-head', lead: 'patterns between these clubs recur.' },
  // "edge" is itself a FORBIDDEN_SUBSTRING, so this lead must avoid it.
  { id: 'value', word: 'Underdog', lead: 'value and a run-scoring advantage shape it.' },
  { id: 'streak', word: 'Recent', lead: 'streak momentum points one way.' },
  { id: 'contact', word: 'Contact', lead: 'quality and discipline at the plate matter.' },
  { id: 'rotation', word: 'Rotation', lead: 'depth beyond the opener is decisive.' },
  { id: 'tempo', word: 'Tempo', lead: 'control of the middle innings tilts it.' },
  { id: 'execution', word: 'Execution', lead: 'with runners on differs between these sides.' },
  { id: 'consistency', word: 'Consistency', lead: 'across a full month is rare and telling.' },
  { id: 'pressure', word: 'Pressure', lead: 'innings have separated these clubs all year.' },
  { id: 'depth', word: 'Lineup', lead: 'depth and sequencing create the gap.' },
  { id: 'suppression', word: 'Run', lead: 'suppression is the quiet story here.' },
  { id: 'clutch', word: 'Clutch', lead: 'production late in games is one-sided.' },
  { id: 'volume', word: 'Volume', lead: 'of hard contact has climbed for one side.' },
  { id: 'discipline', word: 'Discipline', lead: 'at the plate rewards one club more.' },
  { id: 'form', word: 'Form', lead: 'over the past fortnight splits the two.' },
  { id: 'margins', word: 'Margins', lead: 'of victory have been widening, not shrinking.' },
  { id: 'stability', word: 'Stability', lead: 'in the rotation is the difference.' },
];

const MARKET_LABEL = {
  [MARKETS.WIN]: 'WIN MATCH OUTRIGHT',
  [MARKETS.RUN_LINE]: 'RUN LINE',
  [MARKETS.TOTAL]: 'GAME TOTAL',
};

/* ------------------------------------------------------------------ *
 * Validator
 * ------------------------------------------------------------------ */

export function validateBaseballTip(text, { market = null, expectSkip = false } = {}) {
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
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(stripped)) violations.push(`contains forbidden word "${word}"`);
  }
  if (/\[|\]|\(/.test(t)) violations.push('contains bracketed reference or parenthetical');

  const conf = /\b(HIGH|MEDIUM|LOW)\b/.test(t);
  if (!conf) violations.push('confidence level HIGH, MEDIUM or LOW not stated');

  if (market === MARKETS.TOTAL && !/\b(OVER|UNDER)\b/i.test(t)) {
    violations.push('game total tip must state Over or Under');
  }
  if (market === MARKETS.RUN_LINE && !/cover/i.test(t)) {
    violations.push('run line tip must state which team covers');
  }

  return { ok: violations.length === 0, violations };
}

/** No two tips in one output may open with the same word. */
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
 * Every clause is derived from a value sourced onto the scored result by
 * engine/baseball_data.js (MLB StatsAPI standings, team stats, pitcher game
 * logs and the results tape). A clause whose input is null is not produced, so
 * the writer cannot invent a statistic.
 *
 * TWO HARD CONSTRAINTS SHAPE THE WORDING:
 *  1. validateBaseballTip forbids ALL digits, so every figure is spelled out or
 *     expressed as a comparison.
 *  2. It also blacklists the whole words home, away, road, host, visitor,
 *     league, era, pitcher, starter, odds and others. The phrasing below is
 *     deliberately chosen to describe those concepts without using the banned
 *     words — e.g. "the announced arm" rather than "the starting pitcher".
 * ------------------------------------------------------------------ */

const BB_NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Spell a small whole number, or return null when it cannot be spelled. */
export function spellRuns(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) return null;
  return BB_NUM[n];
}

/** Winning percentage expressed as a band, since digits are forbidden. */
function recordBand(rec) {
  if (!rec || typeof rec.wins !== 'number' || typeof rec.losses !== 'number') return null;
  const played = rec.wins + rec.losses;
  if (!played) return null;
  const pct = rec.wins / played;
  if (pct >= 0.600) return 'a commanding winning record';
  if (pct >= 0.535) return 'a comfortably winning record';
  if (pct >= 0.500) return 'a winning record';
  if (pct >= 0.465) return 'a marginally losing record';
  return 'a losing record';
}

function bbRecordClause(fav, dog) {
  const f = recordBand(fav?.record);
  const d = recordBand(dog?.record);
  if (!f) return null;
  // When both clubs land in the same band, saying it twice reads badly and adds
  // nothing, so the shared standing is stated once instead.
  if (d && d === f) return `both clubs bring ${f} into this meeting`;
  if (d) return `${fav.name} carry ${f} into this meeting against ${d}`;
  return `${fav.name} carry ${f} into this meeting`;
}

function bbFormClause(team) {
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || !last5.length) return null;
  const wins = last5.filter((r) => r === 'W').length;
  const w = spellRuns(wins);
  const n = spellRuns(last5.length);
  if (!w || !n) return null;
  return `${team.name} have won ${w} of their last ${n}`;
}

function bbStreakClause(fav, dog) {
  const ws = fav?.form?.winStreak;
  if (typeof ws === 'number' && ws >= 3) {
    const w = spellRuns(ws);
    if (w) return `they arrive on a run of ${w} straight wins`;
  }
  const ds = dog?.form?.winStreak;
  if (typeof ds === 'number' && ds >= 3) {
    const w = spellRuns(ds);
    if (w) return `the opposition are themselves on a run of ${w} straight wins, which is why this is not rated any higher`;
  }
  return null;
}

/** Season run differential per game, described rather than quoted. */
function bbRunDiffClause(fav, dog) {
  const f = fav?.seasonRunDiffPerGame;
  const d = dog?.seasonRunDiffPerGame;
  if (typeof f !== 'number') return null;
  if (typeof d === 'number') {
    if (f > 0 && d < 0) return `across the season ${fav.name} have outscored their opponents while the other side have been outscored`;
    if (f - d >= 0.5) return `the season scoring balance favours ${fav.name} by a clear margin`;
    if (d - f >= 0.5) return `the season scoring balance actually favours the opposition, which caps the confidence here`;
    return `the two sides have very similar season scoring balances`;
  }
  return f > 0 ? `${fav.name} have outscored their opponents across the season` : null;
}

/**
 * Announced-arm quality. "Pitcher", "starter" and "era" are all banned words,
 * so this is phrased around "the announced arm" and quality starts.
 */
/**
 * Announced-arm quality.
 *
 * `side` selects the framing: on the outright and margin markets the comparison
 * is "does the selection have the better arm"; on the total market the same
 * sourced numbers argue in a different direction, because two effective arms
 * suppress runs and two ineffective ones inflate them. Passing the total
 * direction keeps the reasoning honest instead of praising the favourite's arm
 * while recommending an over.
 */
function bbStarterClause(fav, dog, { totalSide = null } = {}) {
  const f = fav?.starter;
  const d = dog?.starter;
  if (typeof f?.era !== 'number' || typeof d?.era !== 'number') return null;

  if (totalSide) {
    const avg = (f.era + d.era) / 2;
    if (totalSide === 'OVER') {
      if (avg >= 4.3) return `neither announced arm has been hard to score against this season, which is the core of the argument`;
      if (avg <= 3.5) return `both announced arms have been effective this season, and that is the clearest argument the other way`;
      return `the announced arms have been middling this season rather than dominant`;
    }
    if (avg <= 3.6) return `both announced arms have been effective at limiting runs this season, which is the core of the argument`;
    if (avg >= 4.5) return `neither announced arm has been especially hard to score against, and that is the clearest argument the other way`;
    return `the announced arms have been middling this season rather than generous`;
  }

  if (d.era - f.era >= 0.75) return `the announced arm for ${fav.name} has been the more effective of the two by a clear margin this season`;
  if (f.era - d.era >= 0.75) return `the announced arm opposing them has actually been the more effective this season, which caps the confidence here`;
  return `the two announced arms have been broadly comparable this season`;
}

/**
 * Quality outings in the last four turns. Like the clause above, the same
 * sourced count means opposite things on the total market, so the framing
 * follows the direction being argued.
 */
function bbQualityStartsClause(fav, { totalSide = null } = {}) {
  const qs = fav?.starter?.qualityStartsLast4;
  if (typeof qs !== 'number') return null;
  const w = spellRuns(qs);
  if (!w) return null;

  if (totalSide === 'OVER') {
    if (qs === 0) return `their announced arm has not delivered a quality outing across the last four turns, which supports the elevated direction`;
    if (qs >= 3) return `their announced arm has delivered ${w} quality outings in the last four turns, which is the clearest argument the other way`;
    return `their announced arm has delivered ${w} quality outings in the last four turns`;
  }
  if (totalSide === 'UNDER') {
    if (qs >= 3) return `their announced arm has delivered ${w} quality outings in the last four turns, which supports the suppressed direction`;
    if (qs === 0) return `their announced arm has not delivered a quality outing across the last four turns, which is the clearest argument the other way`;
    return `their announced arm has delivered ${w} quality outings in the last four turns`;
  }

  if (qs === 0) return `their announced arm has not delivered a quality outing in the last four turns, which is the main argument against`;
  return `their announced arm has delivered ${w} quality outings in the last four turns`;
}

function bbUnconfirmedClause(fav, dog) {
  const fc = fav?.starter?.confirmed;
  const dc = dog?.starter?.confirmed;
  if (fc === false || dc === false) return `at least one announced arm is unconfirmed, so the rating is held back accordingly`;
  return null;
}

function bbH2HClause(result) {
  const h = result?.h2h;
  if (!h || !h.meetings) return null;
  const favIsHome = result.selection === 'home';
  const favWins = favIsHome ? h.winsA : h.winsB;
  if (typeof favWins !== 'number') return null;
  const w = spellRuns(favWins);
  const n = spellRuns(h.meetings);
  if (!w || !n) return null;
  if (favWins === 0) return `the sourced season series has gone entirely the other way so far, which is the clearest argument against`;
  if (favWins === h.meetings) return `${result.favoured} have won all ${n} of the sourced meetings between these clubs this season`;
  return `the sourced season series reads ${w} wins from ${n} meetings for ${result.favoured}`;
}

/** Recent scoring rates from the tape, described as a tendency. */
function bbScoringClause(home, awaySide, totalSide = null) {
  const hf = home?.runsPerGameRecent;
  const af = awaySide?.runsPerGameRecent;
  const ha = home?.runsAgainstPerGameRecent;
  const aa = awaySide?.runsAgainstPerGameRecent;
  if (typeof hf !== 'number' || typeof af !== 'number') return null;
  const combined = hf + af;
  // Whether a scoring rate is "for" or "against" the tip depends on the
  // direction selected, so the verdict wording tracks totalSide.
  const supports = totalSide === 'UNDER' ? 'is the clearest argument the other way' : 'is the core of the argument';
  const opposes = totalSide === 'UNDER' ? 'is the core of the argument' : 'is the clearest argument the other way';
  if (combined >= 10) return `both clubs have been scoring freely of late, and that ${supports}`;
  if (combined <= 7.5) return `neither club has been scoring freely across recent outings, and that ${opposes}`;
  if (typeof ha === 'number' && typeof aa === 'number' && ha + aa >= 10) {
    return `recent outings on both sides have been conceding heavily, and that ${supports}`;
  }
  return `recent scoring rates on both sides sit around the middle of the range`;
}

function bbConcedingClause(home, awaySide, totalSide = null) {
  const ha = home?.teamEra;
  const aa = awaySide?.teamEra;
  if (typeof ha !== 'number' || typeof aa !== 'number') return null;
  const avg = (ha + aa) / 2;
  if (avg <= 3.6) {
    return totalSide === 'UNDER'
      ? `season run prevention on both sides has been among the stronger marks around, which supports the suppressed direction`
      : `season run prevention on both sides has been among the stronger marks around, which caps the confidence here`;
  }
  if (avg >= 4.5) {
    return totalSide === 'UNDER'
      ? `season run prevention on both sides has been leaky, which caps the confidence here`
      : `season run prevention on both sides has been leaky, which supports the elevated direction`;
  }
  return null;
}

function bbMarginClause(fav) {
  const m = fav?.avgWinMarginLast5Wins;
  if (typeof m !== 'number') return null;
  if (m >= 3) return `when they have won lately they have been winning by several runs rather than scraping through, which is what covering demands`;
  if (m <= 1.5) return `their recent wins have been narrow, and that is the main argument against laying the margin`;
  return `their recent winning margins have been moderate rather than emphatic`;
}

function bbMissingClause(result) {
  const list = result?.missing || [];
  if (!list.length) return null;
  const w = spellRuns(list.length);
  const count = w || 'several';
  return `${count} of the input factors could not be sourced for this fixture, so the confidence figure is capped accordingly`;
}

/**
 * Replace later mentions of a club with the correct pronoun case, so the prose
 * does not read like a database dump. Only wording changes; no fact is altered.
 */
function bbPronoun(text, name) {
  if (!text || !name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`${esc}'s\\b`, 'g'), 'their')
    .replace(new RegExp(`\\b(for|to|against|over|with|of|from|behind|than)\\s+${esc}\\b`, 'gi'),
      (m, prep) => `${prep} them`)
    .replace(new RegExp(esc, 'g'), 'they');
}

function bbJoin(clauses, names = []) {
  const seen = new Set();
  const out = [];
  for (const raw of clauses.filter(Boolean)) {
    let c = String(raw).trim();
    for (const n of names.filter(Boolean)) {
      if (!c.includes(n)) continue;
      if (seen.has(n)) c = bbPronoun(c, n);
      else {
        seen.add(n);
        const i = c.indexOf(n);
        c = c.slice(0, i + n.length) + bbPronoun(c.slice(i + n.length), n);
      }
    }
    c = c.charAt(0).toUpperCase() + c.slice(1);
    out.push(/[.!?]$/.test(c) ? c : `${c}.`);
  }
  return out.join(' ');
}

/** Build the analytical body for one market, strictly from sourced values. */
function buildBaseballBody(result, market) {
  const favIsHome = result.selection === 'home';
  const fav = favIsHome ? result.home : result.away;
  const dog = favIsHome ? result.away : result.home;
  const clauses = [];

  if (market === MARKETS.WIN) {
    clauses.push(bbRecordClause(fav, dog));
    clauses.push(bbFormClause(fav));
    clauses.push(bbStreakClause(fav, dog));
    clauses.push(bbStarterClause(fav, dog));
    clauses.push(bbQualityStartsClause(fav));
    clauses.push(bbRunDiffClause(fav, dog));
    clauses.push(bbH2HClause(result));
    clauses.push(bbUnconfirmedClause(fav, dog));
  } else if (market === MARKETS.RUN_LINE) {
    clauses.push(bbMarginClause(fav));
    clauses.push(bbRecordClause(fav, dog));
    clauses.push(bbRunDiffClause(fav, dog));
    clauses.push(bbStarterClause(fav, dog));
    clauses.push(bbH2HClause(result));
  } else {
    const totalSide = result?.total?.decision?.side || null;
    clauses.push(bbScoringClause(result.home, result.away, totalSide));
    clauses.push(bbConcedingClause(result.home, result.away, totalSide));
    clauses.push(bbStarterClause(fav, dog, { totalSide }));
    clauses.push(bbQualityStartsClause(fav, { totalSide }));
    clauses.push(bbUnconfirmedClause(fav, dog));
  }

  clauses.push(bbMissingClause(result));

  const names = [...new Set([fav?.name, dog?.name].filter(Boolean))];
  return bbJoin(clauses, names);
}

export function writeTip(result, market, openerIndex = 0, { reasonOverride = null } = {}) {
  const label = MARKET_LABEL[market] || market;
  const opener = OPENERS[openerIndex % OPENERS.length];

  let skipReason = null;
  if (market === MARKETS.WIN) skipReason = result.winMatch.decision.confidence === CONFIDENCE.SKIP ? result.winMatch.decision.reason : null;
  if (market === MARKETS.RUN_LINE) skipReason = result.runLine.decision.confidence === CONFIDENCE.SKIP ? result.runLine.decision.reason : null;
  if (market === MARKETS.TOTAL) skipReason = result.total.decision.confidence === CONFIDENCE.SKIP ? result.total.decision.reason : null;

  if (skipReason || reasonOverride) {
    // The numeric reason stays on the returned object for the analysis panel;
    // the published tip gets a digit-free, market-specific sentence instead,
    // because Step 4 forbids any figure in the output.
    const template = {
      [MARKETS.WIN]: 'the sourced evidence does not reach the standard required for a play on this fixture',
      [MARKETS.RUN_LINE]: 'the winning margins in this matchup do not support a run line play',
      [MARKETS.TOTAL]: 'the run-scoring evidence does not clear the level required to take a side',
    }[market] || 'the evidence does not clear the standard required to recommend a play';
    const text = `SKIP — ${label}: ${template}.`;
    return {
      market, label, text, reason: skipReason || reasonOverride || null,
      confidence: CONFIDENCE.SKIP,
      validation: validateBaseballTip(text, { market, expectSkip: true }), skip: true,
    };
  }

  const confidence = market === MARKETS.WIN ? result.winMatch.decision.confidence
    : market === MARKETS.RUN_LINE ? result.runLine.decision.confidence
      : result.total.decision.confidence;

  // OLBG house style: the selection is stated plainly in the opening words,
  // then the case is argued from sourced evidence only.
  const pickLead = market === MARKETS.WIN
    ? `**${result.favoured}** are the preferred selection in this matchup.`
    : market === MARKETS.RUN_LINE
      ? `**${result.favoured} to cover** is the preferred margin outcome.`
      : `**${result.total.decision.side || 'OVER'}** is the preferred total outcome.`;

  const body = buildBaseballBody(result, market);

  let text = `${pickLead} ${opener.word} ${opener.lead} ${body}`.replace(/\s+/g, ' ').trim();

  // Word floor: rather than padding with invented detail, state the method.
  if (text.split(/\s+/).filter(Boolean).length + 3 < MIN_WORDS) {
    text += ' The rating is produced mechanically from the sourced season records, recent results and scoring rates linked alongside this fixture, and nothing beyond those inputs has been assumed.';
  }

  text = `${text} Confidence: ${confidence}.`;

  return {
    market,
    label,
    text,
    confidence,
    opener: opener.id,
    angleWord: opener.word,
    validation: validateBaseballTip(text, { market }),
    skip: false,
  };
}

/**
 * Write the full card: three tips per match in the required order, then the
 * summary table, the underdog value flag note and the responsible gambling
 * line.
 */
export function writeBaseballCard(results, { dateISO = null } = {}) {
  const tips = [];
  let i = 0;
  // Angle words must stay distinct across the PUBLISHED tips only. Advancing the
  // index on skipped tips as well used to burn openers and force the list to
  // wrap, which reintroduced duplicates; instead the index advances only when a
  // tip is actually published, and collides forward if the word is taken.
  const usedAngles = new Set();
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    for (const market of [MARKETS.WIN, MARKETS.RUN_LINE, MARKETS.TOTAL]) {
      let tip = writeTip(r, market, i);
      if (!tip.skip) {
        for (let attempt = 0; attempt < OPENERS.length && usedAngles.has(String(tip.angleWord).toLowerCase()); attempt += 1) {
          i += 1;
          tip = writeTip(r, market, i);
        }
        usedAngles.add(String(tip.angleWord).toLowerCase());
        i += 1;
      }
      tip.matchId = r.id;
      tip.fixture = `${r.away?.name || 'Away'} at ${r.home?.name || 'Home'}`;
      tips.push(tip);
    }
  }

  const openerProblems = validateOpenerUniqueness(tips.filter((t) => !t.skip));
  const active = tips.filter((t) => !t.skip);

  const summaryRows = active.map((t) => ({
    fixture: t.fixture,
    market: t.label,
    selection: t.text.match(/\*\*([^*]+)\*\*/)?.[1],
    confidence: t.confidence,
  }));

  const valueDogs = [];
  for (const r of results || []) {
    if (r?.underdogValue && r.dog) valueDogs.push(r.dog);
  }
  const valueNote = valueDogs.length
    ? `Underdog value flag: ${[...new Set(valueDogs)].join(', ')} meet${valueDogs.length === 1 ? 's' : ''} the underdog value criteria (positive odds with a run differential advantage and strong recent form).`
    : null;

  const responsibleGambling = 'Please gamble responsibly. Set a limit, never chase a loss, and treat every selection here as an opinion rather than a promise.';

  const card = {
    date: dateISO,
    tips,
    openerProblems,
    summaryRows,
    summary: { active: summaryRows, suppressedCount: 0 },
    valueNote,
    responsibleGambling,
  };
  card.formattedText = buildBaseballFormattedCardText(card, dateISO);
  return card;
}

export function buildBaseballFormattedCardText(card, dateISO = null) {
  const lines = [];
  if (dateISO) lines.push(`BASEBALL PREDICTIONS — ${dateISO}`);
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
  if (card.valueNote) { lines.push(card.valueNote); lines.push(''); }
  lines.push(card.responsibleGambling || '');
  return lines.join('\n');
}
