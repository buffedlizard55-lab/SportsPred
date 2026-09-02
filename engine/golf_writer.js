/**
 * SportsPred — Golf Prediction Writer and Output Validator.
 *
 * Implements Step 4 and the style rules of "GOLF TOURNAMENT PREDICTION MASTER
 * PROMPT v1.0":
 *   Block 1  OUTRIGHT WINNER (top pick, plus the VALUE PICK) and up to five
 *            further TOP 6 FINISH tips
 *   Block 2  FIRST ROUND LEADER (top pick plus up to four more)
 *   Block 3  TOP EUROPEAN
 *   Block 4  TOP AMERICAN
 *   Block 5  TOP BRITISH & IRISH
 *   then the summary table, the value-pick summary, the weather note and the
 *   responsible-gambling reminder.
 *
 * Every tip: forty words or more, the player's name bolded inside the first
 * fifteen words, a unique opening, confidence declared, no numerals, no odds,
 * no tournament, course, tour or source names, none of the banned phrases.
 * Below-threshold markets are written as "NO SELECTION" plus one sentence.
 *
 * Internal data (scores, factor breakdowns, strokes-gained figures, rankings,
 * odds, sentiment) never reaches the written output; only qualitative clauses
 * derived from the scored components do.
 */

import { CONFIDENCE, MARKETS, MARKET_ORDER, RULES } from './golf_engine.js';

export const MIN_WORDS = 40;
export const NAME_WITHIN_WORDS = 15;

export const BANNED_PHRASES = [
  'hard to look past',
  'the class of the field',
  'in fine form',
  'a natural fit',
  'on current form',
  'one to watch',
  'looks the part',
  'could go well here',
];

export const FORBIDDEN_TOKENS = [
  'http', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'olbg', 'espn', 'owgr', 'pga tour', 'dp world', 'european tour', 'liv golf',
  'bet365', 'bookmaker', 'odds', 'price', 'stake', 'each-way', 'each way', 'units',
  'strokes gained', 'sg:', 'datagolf', 'shotlink', 'injur',
];

/** Distinct openers — each begins with a different word and structure. */
export const GOLF_OPENERS = [
  'Approach play decides most weeks on tour, and **{name}** arrives with',
  'Momentum matters in this game, which is why **{name}** stands out with',
  'Course knowledge separates contenders from the pack, so **{name}** merits attention with',
  'Consistency is the currency of the placing markets, and **{name}** offers',
  'Few players arrive with a sharper recent record than **{name}**, who brings',
  'Quietly, **{name}** has assembled',
  'Value hunters should start with **{name}**, who combines',
  'Ranking alone never wins a tournament, but **{name}** pairs it with',
  'Early starters hold the cards when conditions turn, and **{name}** brings',
  'Low opening rounds are a habit for **{name}**, whose profile shows',
  'Putting streaks decide first-round leader markets, which puts **{name}** in focus with',
  'Fast starts have become a signature of **{name}**, supported by',
  'Among the European contingent, **{name}** leads the way with',
  'Leading the American charge is **{name}**, backed by',
  'British and Irish hopes rest most securely with **{name}**, who offers',
  'Reliability under the cut line is where **{name}** excels, showing',
  'Steady rather than spectacular, **{name}** keeps producing',
  'Sharp iron play has carried **{name}** to',
  'Patience is rewarded on layouts like this, and **{name}** brings',
  'Overlooked by many, **{name}** presents',
  'Recent finishes tell a clear story for **{name}**, combining',
  'Tee-to-green control anchors the case for **{name}**, alongside',
  'Regional markets reward the steadiest hand, and **{name}** shows',
  'Nobody in this field has matched the recent upward curve of **{name}**, whose',
  'Seasoned judgement favours **{name}**, who arrives with',
  'Weekend scoring is only half the job; **{name}** also brings',
  'Rhythm counts for a great deal, and **{name}** arrives carrying',
  'Underrated within this group, **{name}** offers',
];

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

export function validateGolfTip(text, { expectSkip = false, forbiddenNames = [] } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  if (expectSkip) {
    if (!/^NO SELECTION\b/.test(t)) violations.push('SKIP tip must begin with NO SELECTION');
    const body = t.replace(/^NO SELECTION\s*[—-]?\s*/, '').replace(/\s*Confidence:\s*(LOW|MEDIUM|HIGH)\.?\s*$/i, '').trim();
    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length !== 1) violations.push('SKIP tip must be exactly one explanatory sentence');
    if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) violations.push('confidence not declared');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded player name found');
  } else {
    const before = t.slice(0, t.indexOf('**')).split(/\s+/).filter(Boolean).length;
    if (before >= NAME_WITHIN_WORDS) violations.push(`bolded name after ${NAME_WITHIN_WORDS} words (at word ${before + 1})`);
  }

  const digits = t.replace(/\*\*[^*]+\*\*/g, '').match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals: ${digits.join('')}`);
  if (/[()[\]{}]/.test(t)) violations.push('contains bracketed references');
  if (/[%$£€]/.test(t)) violations.push('contains a figure symbol');

  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  for (const token of FORBIDDEN_TOKENS) if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);
  for (const name of forbiddenNames || []) {
    const n = String(name || '').trim().toLowerCase();
    if (n.length < 4) continue;
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) violations.push(`names a tournament, course or tour: "${name}"`);
  }
  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) violations.push('confidence not declared');
  return { ok: violations.length === 0, violations };
}

/** Whole-card validation: every tip passes, openings are unique, caps hold. */
export function validateGolfCard(written) {
  const issues = [];
  const firstWords = new Set();
  const firstThree = new Set();
  const forbiddenNames = written?.forbiddenNames || [];
  for (const t of written?.tips || []) {
    const v = validateGolfTip(t.text, { expectSkip: t.skip, forbiddenNames });
    if (!v.ok) issues.push({ market: t.market, player: t.name, violations: v.violations });
    if (t.skip) continue;
    const ws = t.text.trim().split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
    const w1 = ws[0];
    const w3 = ws.slice(0, 3).join(' ');
    if (firstWords.has(w1)) issues.push({ market: t.market, player: t.name, violations: [`duplicate opening word: "${w1}"`] });
    if (firstThree.has(w3)) issues.push({ market: t.market, player: t.name, violations: [`duplicate opening phrase: "${w3}"`] });
    firstWords.add(w1); firstThree.add(w3);
  }
  const count = (key) => (written?.tips || []).filter((t) => t.marketKey === key && !t.skip).length;
  if (count('top6') > RULES.top6.max) issues.push({ violations: [`more than ${RULES.top6.max} top-six selections`] });
  if (count('frl') > RULES.frl.max) issues.push({ violations: [`more than ${RULES.frl.max} first-round-leader selections`] });
  if (count('outright') > 2) issues.push({ violations: ['more than two outright selections (top pick plus value pick)'] });
  for (const key of ['top_european', 'top_american', 'top_british_irish']) {
    if (count(key) > 2) issues.push({ violations: [`more than two ${MARKETS[key]} selections`] });
  }
  return { ok: issues.length === 0, issues };
}

/* ------------------------------------------------------------------ *
 * qualitative clauses (no figures ever leave this function)
 * ------------------------------------------------------------------ */

function has(c, id) {
  return (c.components || []).some((x) => x.id === id && Number(x.points) > 0);
}
function pts(c, id) {
  return (c.components || []).find((x) => x.id === id)?.points ?? 0;
}

function frlClauses(c) {
  const out = [];
  const r1 = pts(c, 'frl_r1');
  if (r1 >= 35) out.push('some of the best opening-round scoring in this field');
  else if (r1 >= 24) out.push('strong opening-round scoring relative to this field');
  else if (r1 >= 14) out.push('above-average opening-round scoring in this field');
  const tee = pts(c, 'frl_tee');
  if (tee >= 25) out.push('an early tee time ahead of worsening conditions');
  else if (tee >= 12) out.push('an early tee time in the calmer part of the day');
  else if (tee >= 8) out.push('a later start with improving conditions');
  const putt = pts(c, 'frl_putt');
  if (putt >= 20) out.push('one of the hottest putters in the field');
  else if (putt >= 13) out.push('a putter in good order');
  else if (putt >= 6) out.push('a putter holding its own');
  const fast = pts(c, 'frl_fast');
  if (fast >= 20) out.push('a habit of opening with a low round');
  else if (fast >= 15) out.push('a layout that yielded low opening scores last time');
  if (!out.length) out.push('an opening-round record that clears the threshold for this market');
  return out;
}

export function factClauses(c, marketKey) {
  if (marketKey === 'frl') return frlClauses(c);
  const out = [];
  const form = pts(c, 'form');
  if (form >= 25) out.push('a victory inside the last six weeks');
  else if (form >= 19) out.push('a top-three finish inside the last six weeks');
  else if (form >= 14) out.push('multiple top-ten finishes across the last five starts');
  else if (form >= 8) out.push('a top-ten finish among the last five starts');
  else if ((c.profile?.starts ?? 0) > 0) out.push('steady if unspectacular recent results');

  const hist = pts(c, 'course_hist');
  if (hist >= 20) out.push('a top-five finish here in a recent edition');
  else if (hist >= 13) out.push('a top-ten finish here in a recent edition');
  else if (hist >= 6) out.push('a record of making the cut at this venue');

  const fit = pts(c, 'course_fit');
  if (fit >= 20) out.push('a strong record on courses of this length');
  else if (fit >= 12) out.push('a fair record on courses of this length');

  const sg = pts(c, 'sg_app');
  if (sg >= 25) out.push('elite approach play this season');
  else if (sg >= 17) out.push('strong approach play this season');
  else if (sg >= 10) out.push('respectable approach play this season');
  if (has(c, 'sg_t2g') || has(c, 't6_t2g')) out.push('positive tee-to-green play');
  if (has(c, 'sg_putt_pos')) out.push('a putter trending the right way');

  const owgr = pts(c, 'owgr');
  if (owgr >= 10) out.push('a place among the world elite');
  else if (owgr >= 7) out.push('a top-twenty world ranking');
  else if (owgr >= 4) out.push('a top-fifty world ranking');
  if (has(c, 'owgr_elev')) out.push('a win at an elevated event inside the last year');
  if (has(c, 'form_b2b')) out.push('back-to-back top-ten finishes');

  if (marketKey === 'top6') {
    if (pts(c, 't6_rate') >= 15) out.push('a high rate of top-ten finishes over the past year');
    else if (pts(c, 't6_rate') >= 8) out.push('a solid rate of top-ten finishes over the past year');
    if (has(c, 't6_event')) out.push('repeated top-fifteen finishes at this event');
    if (has(c, 't6_b2b')) out.push('consecutive cuts made');
  }
  if (marketKey === 'top_european') {
    if (has(c, 'eu_top3')) out.unshift('a ranking among the top three Europeans in this field');
    if (has(c, 'eu_dpwt')) out.push('a recent win or top-three on the European circuit');
  }
  if (marketKey === 'top_american') {
    if (has(c, 'us_top3')) out.unshift('a ranking among the top three Americans in this field');
    if (has(c, 'us_pga')) out.push('a win on the American circuit inside three months');
    if (has(c, 'us_power')) out.push('the power to exploit a long layout');
    if (has(c, 'us_majors')) out.push('multiple major titles in the last two years');
  }
  if (marketKey === 'top_british_irish') {
    if (has(c, 'bi_top2')) out.unshift('the strongest ranking among the British and Irish players here');
    if (has(c, 'bi_dpwt')) out.push('a recent win on the European circuit');
    if (has(c, 'bi_cuts')) out.push('three consecutive cuts made at this event');
  }
  if (!out.length) out.push('a partial but sourced record that still reads better than the rest of this field');
  return [...new Set(out)];
}

export function cautionClauses(c) {
  const out = [];
  if (pts(c, 'course_fit_pen') < 0) out.push('the layout asks questions of a shorter hitter');
  if (pts(c, 't6_mc') < 0) out.push('a missed cut here last time is the obvious caveat');
  if (pts(c, 't6_owgr') < 0) out.push('the world ranking sits outside the leading group');
  if (pts(c, 'eu_mc') < 0 || pts(c, 'bi_mc') < 0) out.push('two straight missed cuts temper the enthusiasm');
  if (pts(c, 'bi_rust') < 0) out.push('a spell without competitive rounds is a concern');
  if (pts(c, 'us_app_neg') < 0) out.push('approach play has been below par this season');
  if (c.coreMissing) out.push('part of the usual evidence is not published for this event, so the grade is held back');
  return out;
}

function confidenceSentence(band) {
  if (band === CONFIDENCE.HIGH) return 'Confidence: HIGH.';
  if (band === CONFIDENCE.MEDIUM) return 'Confidence: MEDIUM.';
  return 'Confidence: LOW.';
}

const REGION_WORD = { top_european: 'European', top_american: 'American', top_british_irish: 'British and Irish' };

function joinList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const LOW_ANGLES = {
  outright: (n) => `The evidence is thinner than usual, so ${n} is offered as a value-style outright rather than a confident headline, with enough sourced support to be worth a small interest.`,
  top6: (n) => `The case for ${n} inside the top six is partial rather than complete, which is why the grade stays modest.`,
  frl: (n) => `For the opening round ${n} has enough sourced support to be listed, but the gaps in the evidence keep the grade modest.`,
  regional: (n, r) => `Within the ${r} group the sourced evidence is thin, but ${n} still reads best on what is published, so the market goes that way at a modest grade.`,
};

const ANGLES = {
  outright: [
    (n) => `That combination makes ${n} the strongest outright claim in this field, with the pieces that usually decide a seventy-two-hole test all pointing the same way.`,
    (n) => `Taken together those strengths give ${n} a genuine chance of lifting the trophy, and the profile fits what this week demands.`,
  ],
  top6: [
    (n) => `A top-six finish rewards repeatable quality across four rounds, and that is exactly the pattern ${n} keeps producing.`,
    (n) => `For a place inside the leading six, ${n} offers the reliability the market prizes rather than a boom-or-bust profile.`,
    (n) => `The placing market suits ${n} because the record is built on cuts made and weekends played, not isolated flashes.`,
    (n) => `Backing ${n} for a high finish leans on evidence that has repeated across different fields and conditions.`,
    (n) => `Everything in the sourced record says ${n} belongs in the leading group when the final putt drops.`,
    (n) => `Taken as a whole, the case for ${n} finishing inside the top six rests on durability rather than headline moments.`,
  ],
  frl: [
    (n) => `First-round leader markets belong to players who score early and hole putts, and ${n} ticks those boxes for the opening day.`,
    (n) => `After eighteen holes the name at the top is usually a fast starter with a warm putter, which describes ${n} neatly.`,
    (n) => `The opening day suits ${n} because the profile is built for scoring before the course firms and the wind rises.`,
    (n) => `For one round only, ${n} has the ingredients that turn a good start into the outright lead.`,
    (n) => `The early leader board so often features ${n}, and the sourced rounds support that pattern again this week.`,
  ],
  regional: [
    (n, r) => `Measured against the rest of the ${r} contingent, ${n} offers the most complete case, which is why this market goes that way.`,
    (n, r) => `Set against the other ${r} players in the field, ${n} holds the clearest edge on the sourced record, so this market goes that way.`,
  ],
};

function composeTip({ marketKey, label, cand, band, openerIdx, angleIdx, valuePick = false, coSelection = false }) {
  const name = cand.name;
  const facts = factClauses(cand, marketKey);
  const cautions = cautionClauses(cand);
  const opener = GOLF_OPENERS[openerIdx % GOLF_OPENERS.length].replace('{name}', name);
  const factText = joinList(facts.slice(0, 3));
  const group = marketKey.startsWith('top_') ? 'regional' : marketKey;
  const angleFn = band === CONFIDENCE.LOW ? LOW_ANGLES[group] : ANGLES[group][angleIdx % ANGLES[group].length];
  const angle = angleFn(name, REGION_WORD[marketKey]);
  const caution = cautions.length ? ` Against that, ${cautions[0]}.` : '';
  const co = coSelection ? ' The scores at the head of this regional market are close enough that a second selection is justified alongside the first.' : '';
  const value = valuePick ? ' Ranked outside the leading group in this field yet close to it on the evidence that matters, this is the value play of the week.' : '';
  let text = `${opener} ${factText}. ${angle}${caution}${value}${co} ${confidenceSentence(band)}`.replace(/\s+/g, ' ').trim();
  if (text.split(/\s+/).length < MIN_WORDS) {
    text = text.replace(/\s*Confidence:.*$/, '') + ' The evidence comes from completed rounds rather than reputation, and it holds up across the factors this market rewards. ' + confidenceSentence(band);
  }
  return { text, ok: true, violations: [], band, market: label, marketKey, name, athleteId: cand.athleteId, skip: false, valuePick, coSelection, score: cand.score };
}

function skipTip(label, marketKey, reason) {
  return {
    text: `NO SELECTION — ${reason} Confidence: LOW.`,
    ok: true, violations: [], band: CONFIDENCE.SKIP, market: label, marketKey, name: null, athleteId: null, skip: true, valuePick: false, coSelection: false, score: null,
  };
}

function skipReason(market) {
  if (!market) return 'This market could not be assessed from the sourced data, so no selection is made.';
  if (market.eligible === 0) return 'No eligible player appears in the published field for this market, so no selection is made.';
  if (!market.candidates?.length) return 'No player in the field produced enough sourced evidence to clear the threshold for this market, so no selection is made.';
  return 'No player reaches the scoring threshold for this market on the sourced evidence available, so no selection is made.';
}

/* ------------------------------------------------------------------ *
 * card
 * ------------------------------------------------------------------ */

/**
 * Write the full card.
 * @param {object} scored  scoreGolfEvent() output
 * @param {object} event   {id, name, tour, startDate, course:{name}}
 * @param {object} [weather] golf weather entry for the event (or null)
 */
export function writeGolfCard(scored, event, weather = null) {
  const tips = [];
  const blocks = [];
  let openerIdx = 0;
  const angleCount = {};
  const next = (marketKey, label, cand, band, extra = {}) => {
    const k = marketKey.startsWith('top_') ? 'regional' : marketKey;
    angleCount[k] = (angleCount[k] || 0);
    const tip = composeTip({ marketKey, label, cand, band, openerIdx, angleIdx: angleCount[k], ...extra });
    openerIdx += 1; angleCount[k] += 1;
    tips.push(tip);
    return tip;
  };
  const markets = scored?.markets || {};

  /* Block 1: outright + top six */
  const b1 = { key: 'block1', title: 'OUTRIGHT WINNER AND TOP SIX', tips: [] };
  const outright = markets.outright;
  const outTop = outright?.selections?.[0] || null;
  if (outTop) {
    b1.tips.push(next('outright', MARKETS.outright, outTop, outTop.band, { valuePick: Boolean(outTop.valuePick) }));
    const val = outright.selections.find((s) => s.athleteId !== outTop.athleteId) || null;
    if (val) b1.tips.push(next('outright', MARKETS.outright, val, val.valueFallback ? CONFIDENCE.LOW : val.band, { valuePick: Boolean(val.valuePick || val.valueFallback) }));
  } else {
    const t = skipTip(MARKETS.outright, 'outright', skipReason(outright)); tips.push(t); b1.tips.push(t);
  }
  const top6 = markets.top6;
  const t6 = (top6?.selections || []).filter((s) => s.athleteId !== outTop?.athleteId).slice(0, 5);
  if (t6.length) for (const c of t6) b1.tips.push(next('top6', MARKETS.top6, c, c.band));
  else { const t = skipTip(MARKETS.top6, 'top6', skipReason(top6)); tips.push(t); b1.tips.push(t); }
  blocks.push(b1);

  /* Block 2: first round leader */
  const b2 = { key: 'block2', title: 'FIRST ROUND LEADER', tips: [] };
  const frl = markets.frl;
  const frlSel = (frl?.selections || []).slice(0, RULES.frl.max);
  if (frlSel.length) for (const c of frlSel) b2.tips.push(next('frl', MARKETS.frl, c, c.band));
  else { const t = skipTip(MARKETS.frl, 'frl', skipReason(frl)); tips.push(t); b2.tips.push(t); }
  blocks.push(b2);

  /* Blocks 3-5: regional */
  for (const key of ['top_european', 'top_american', 'top_british_irish']) {
    const m = markets[key];
    const b = { key, title: MARKETS[key], tips: [] };
    const sel = (m?.selections || []).slice(0, 2);
    if (sel.length) {
      for (const c of sel) b.tips.push(next(key, MARKETS[key], c, c.band, { coSelection: Boolean(c.coSelection) }));
    } else { const t = skipTip(MARKETS[key], key, skipReason(m)); tips.push(t); b.tips.push(t); }
    blocks.push(b);
  }

  const summary = [];
  for (const key of MARKET_ORDER) {
    const rows = tips.filter((t) => t.marketKey === key);
    for (const t of rows) summary.push({ market: MARKETS[key], selection: t.skip ? 'NO SELECTION' : t.name, band: t.band, valuePick: t.valuePick });
  }
  const valuePicks = tips.filter((t) => t.valuePick && !t.skip).map((t) => ({ name: t.name, market: t.market }));
  const weatherNote = buildWeatherNote(weather);
  const forbiddenNames = [event?.name, event?.shortName, event?.tournamentName, event?.course?.name, event?.course?.city, event?.tourName, 'PGA TOUR', 'DP World Tour', 'LPGA', 'Champions Tour', 'Ryder Cup'].filter(Boolean);
  const written = { tips, blocks, summary, valuePicks, weatherNote, event: { id: event?.id ?? null, startDate: event?.startDate ?? null }, forbiddenNames, flags: scored?.flags || [] };
  written.cardText = buildGolfCardText(written);
  return written;
}

const MPH_PER_KMH = 0.621371;

/** Weather note in words only. */
export function buildWeatherNote(weather) {
  if (!weather || weather.available === false || !weather.days?.length) {
    return 'Weather note: no forecast was available for this venue at the time of writing, so weather-dependent markets carry extra uncertainty.';
  }
  const windMph = Math.max(...weather.days.map((d) => Number(d.windMaxKmh) || 0)) * MPH_PER_KMH;
  const rain = Math.max(...weather.days.map((d) => Number(d.precipProbPct) || 0));
  const parts = [];
  if (windMph > 20) parts.push('strong wind is forecast for at least one round, which favours low-flight, course-management profiles');
  else if (windMph > 12) parts.push('a moderate breeze is forecast');
  if (rain >= 50) parts.push('rain is likely during the tournament');
  else if (rain >= 30) parts.push('showers are possible');
  if (!parts.length) return 'Weather note: no material weather disruption is forecast across the four rounds.';
  return `Weather note: ${joinList(parts)}; all selections should be treated as weather-dependent.`;
}

/** Summary table + value summary + weather note + RG line (card-level text). */
export function buildGolfCardText(written) {
  const rows = (written?.summary || []).map((r) => `| ${r.market} | ${r.selection}${r.valuePick ? ' — VALUE PICK' : ''} | ${r.band} |`).join('\n');
  const value = written?.valuePicks?.length
    ? `Value picks: ${written.valuePicks.map((v) => `${v.name} (${v.market})`).join('; ')}.`
    : 'Value picks: no selection met the value test this week.';
  const body = (written?.blocks || []).map((b) => [`${b.title}`, ...b.tips.map((t) => `${t.valuePick ? 'VALUE PICK — ' : ''}${t.text}`)].join('\n\n')).join('\n\n');
  return [
    `Golf Prediction Card${written?.event?.startDate ? ` — ${String(written.event.startDate).slice(0, 10)}` : ''}`,
    '',
    body,
    '',
    '| Market | Selection | Confidence |',
    '|---|---|---|',
    rows,
    '',
    value,
    '',
    written?.weatherNote || '',
    '',
    'Responsible gambling. Nothing here is betting advice. Predictions are generated mechanically from sourced data and are fallible. 18+.',
  ].join('\n');
}
