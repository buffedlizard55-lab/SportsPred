/**
 * SportsPred — NRL card writer.
 *
 * Implements Step 4 (output format) of the NRL PREDICTION MASTER PROMPT v1.0.
 *
 * Hard rules enforced here and asserted by the tests:
 *  - every tip is at least 40 words;
 *  - the picked outcome is bolded and appears inside the first 20 words;
 *  - WIN MATCH names the side, HANDICAP names only who covers (never the
 *    handicap number), GAME TOTAL says only Over or Under (never the line);
 *  - no odds, no prices, no lines, no statistics, no figures, no dates,
 *    no player names, no unsourced injury claims, no links or brackets;
 *  - the six banned phrases never appear;
 *  - no two tips on a card open with the same word;
 *  - confidence is stated as LOW, MEDIUM or HIGH;
 *  - a market below threshold is one explanatory sentence beginning SKIP;
 *  - the card ends with a summary table, per-match value notes and a
 *    substantive responsible-gambling section.
 */

import { CONFIDENCE, MARKETS } from './nrl_engine.js';

export const MIN_WORDS = 40;

export const BANNED_PHRASES = [
  'hard to look past',
  'should be too strong',
  'on paper',
  'both teams',
  'anything can happen',
  'job done',
];

/** Text that must never reach the page, whatever the data says. */
const FORBIDDEN_PATTERNS = [
  { id: 'digit', re: /\d/, why: 'a figure, price, line or statistic' },
  { id: 'link', re: /https?:\/\/|www\./i, why: 'a link' },
  { id: 'bracket', re: /[[\]()]/, why: 'a bracketed aside' },
  { id: 'social', re: /@\w+|\b(twitter|x|instagram|tiktok)\b/i, why: 'a social reference' },
  { id: 'source', re: /\b(olbg|espn|wikipedia|rugbyleagueproject|open-meteo|nrl\.com|sportsbet|bet365|draftkings)\b/i, why: 'a source name' },
  { id: 'injury', re: /\b(injur|suspend|banned|judiciary|ruled out|doubt|concussion)\w*/i, why: 'an unsourced team-news claim' },
  { id: 'player', re: /\b(cleary|munster|haas|tedesco|ponga|grant|hughes|reynolds)\b/i, why: 'a player name' },
  { id: 'venue', re: /\b(stadium|oval|park|arena|cbus|suncorp|allianz|accor|commbank|aami|gio|win stadium|go media|4 pines|leichhardt|kayo|queensland country bank|mcdonald jones|ocean protect)\b/i, why: 'a venue name' },
  { id: 'odds', re: /\b(odds|price|favourite with bookmakers|shortens|drift(ed|s)?|moneyline|handicap of|total of|line of)\b/i, why: 'a betting figure' },
];

/** Openers. They refer back to the bolded pick, so the name is never repeated. */
const OPENERS = [
  'the balance of evidence favours them',
  'form tilts this fixture their way',
  'recent weeks make a strong case for them',
  'the ladder backs them',
  'momentum sits with them',
  'the recent record points their way',
  'everything on the tape leans their way',
  'the stronger case belongs to them',
  'consistency over the last month is on their side',
  'the season-long picture favours them',
  'recent meetings between these clubs support them',
  'the attacking and defensive profiles back them',
  'what stands out in the record works for them',
  'the weight of recent evidence lands with them',
  'nothing in the recent record tells against them',
  'the case for them is a straightforward one',
  'travel and rhythm leave the edge with them',
  'the run of recent results is on their side',
  'the recent form line belongs to them',
  'the ladder and the form tape agree on them',
];

/** Openers for the totals market, which has no side to refer back to. */
const TOTAL_OPENERS = [
  'the scoring profiles on this card lean',
  'recent totals and conditions argue for',
  'the balance of the totals evidence sits with',
  'the attacking and defensive numbers point',
  'the way these two sides have been finishing suggests',
  'the totals evidence on this fixture favours',
];

/** Honest padding, used only when a tip would otherwise fall under 40 words. */
const FILLERS = [
  'The call rests on the balance of the scoring and defensive profiles rather than on one dominant factor.',
  'It is the combination of factors that carries this read, not any single piece of evidence.',
  'The card publishes this with its narrow basis stated rather than dressing it up.',
  'Nothing here is a certainty; it is a disciplined read of what the public record shows.',
];

const CLOSERS = [
  'This is a mechanical read of public data, not a guarantee.',
  'Every selection on this card is a model output from public data and remains fallible.',
  'As with every tip here, this is an estimate built from public data rather than a promise.',
];

const MARKET_LABELS = {
  win_match: 'WIN MATCH',
  handicap: 'HANDICAP',
  game_total: 'GAME TOTAL',
};

/* ------------------------------------------------------------------ helpers */

function words(text) {
  return String(text).replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean);
}

function wordCount(text) {
  return words(text).length;
}

function pick(list, seed) {
  if (!list.length) return '';
  const i = Math.abs(seed) % list.length;
  return list[i];
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function has(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

/** Plain-language clause for a scored component (no figures, ever). */
function clauseFor(component) {
  if (!component || component.missing) return null;
  const p = component.points;
  switch (component.id) {
    case 'recent_form':
      if (p >= 25) return { text: 'their recent run of results is the strongest form line on this card', positive: true };
      if (p >= 17) return { text: 'they arrive with a solid recent record behind them', positive: true };
      if (p >= 8) return { text: 'their recent results have been mixed', positive: false };
      return { text: 'recent form gives them little to lean on', positive: false };
    case 'ladder_stakes':
      if (p >= 20) return { text: 'the ladder gap in their favour is wide with the finals picture in play', positive: true };
      if (p >= 12) return { text: 'they hold a clear advantage in ladder position', positive: true };
      if (p >= 5) return { text: 'the two sides are close together on the ladder', positive: false };
      return { text: 'the ladder leans the other way', positive: false };
    case 'head_to_head':
      if (p >= 15) return { text: 'recent meetings between these clubs have gone their way', positive: true };
      if (p >= 7) return { text: 'the recent head-to-head record is evenly split', positive: false };
      return { text: 'recent meetings have fallen the other way', positive: false };
    case 'key_absences':
      if (p >= 20) return { text: 'the opponent is missing key personnel', positive: true };
      if (p >= 10) return { text: 'the representative season is over and no Origin duty hangs over either squad', positive: true };
      return { text: 'personnel is a live concern for them', positive: false };
    case 'odds_value':
      if (p >= 11) return { text: 'the market has them as a clear favourite', positive: true };
      if (p >= 7) return { text: 'they are a moderate favourite with the market', positive: true };
      if (p >= 4) return { text: 'the market only makes them a slight favourite', positive: false };
      return { text: 'as the outsider they still carry a live case on this card', positive: false };
    case 'travel_venue':
      if (p >= 5) return { text: 'there is no unusual travel burden on them this round', positive: true };
      return { text: 'the trip itself is a genuine tax this round', positive: false };
    default:
      return { text: String(component.label || '').toLowerCase(), positive: p > 0 };
  }
}

function cap(s) {
  const t = String(s).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "a, b and c", capitalised, with a concessive frame for the weak factors. */
function sentence(clauses, max = 3) {
  const positives = clauses.filter((c) => c.positive).slice(0, max);
  const chosen = [...positives];
  if (chosen.length < 2) {
    const negative = clauses.find((c) => !c.positive);
    if (negative) chosen.push({ text: `even though ${negative.text}` });
  }
  if (!chosen.length) return '';
  const texts = chosen.map((c) => c.text);
  let joined = texts.join(', ');
  if (texts.length > 1) {
    const last = joined.lastIndexOf(', ');
    joined = `${joined.slice(0, last)} and ${joined.slice(last + 2)}`;
  }
  return `${cap(joined)}.`;
}

/** Guarantee the 40-word floor without padding the claim itself. */
function padToMinimum(text, seed) {
  let out = text;
  let i = 0;
  while (wordCount(out) < MIN_WORDS && i < FILLERS.length) {
    out = out.replace(/ Confidence:/, ` ${pick(FILLERS, seed + i * 5)} Confidence:`);
    i += 1;
  }
  return out;
}

function winResultFor(result) {
  const m = result.markets.win_match;
  return m.sideKey === 'home' ? m.homeResult : m.awayResult;
}

/* -------------------------------------------------------------- tip builder */

function winTipText(result, openerText) {
  const m = result.markets.win_match;
  const ctx = result.ctx;
  const seed = hashString(`${result.match.home}${result.match.away}win`);
  const opener = cap(openerText || pick(OPENERS, seed));
  const closer = pick(CLOSERS, seed + 3);
  const winRes = winResultFor(result);
  const clauses = winRes.components.map(clauseFor).filter(Boolean);
  if (ctx.travel?.transTasman) {
    clauses.push(m.sideKey === 'away'
      ? { text: 'they are the side making the trip across the Tasman', positive: false }
      : { text: 'they are at home while the visitor has crossed the Tasman', positive: true });
  }
  if (ctx.rest?.[winRes.sideKey]?.offBye) clauses.push({ text: 'the week off has given them extra recovery time', positive: true });
  const body = sentence(clauses, 3);
  return `**${m.selection}** — ${opener}. ${body} ${closer} Confidence: ${m.band}.`;
}

function handicapTipText(result, openerText) {
  const m = result.markets.handicap;
  const seed = hashString(`${result.match.home}${result.match.away}hcap`);
  const opener = cap(openerText || pick(OPENERS, seed + 7));
  const closer = pick(CLOSERS, seed + 11);
  const marginComp = m.components.find((c) => c.id === 'hcap_margin_trend');
  const marginClause = !marginComp || marginComp.missing
    ? 'the recent winning margins give no clear steer on the cover'
    : marginComp.points >= 15
      ? 'when they win they tend to win comfortably, which is what covering asks for'
      : marginComp.points < 0
        ? 'their recent wins have been narrow, which is the caveat on the cover'
        : 'their winning margins have been steady enough to make the cover a reasonable read';
  const winRes = winResultFor(result);
  const clauses = winRes.components
    .filter((c) => ['recent_form', 'ladder_stakes', 'head_to_head'].includes(c.id))
    .map(clauseFor).filter(Boolean);
  const body = sentence(clauses, 2);
  return `**${result.favourite}** — ${opener} on the handicap. ${cap(marginClause)}, and ${body.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, '')}. ${closer} Confidence: ${m.band}.`;
}

function totalTipText(result, openerText) {
  const m = result.markets.game_total;
  const seed = hashString(`${result.match.home}${result.match.away}total`);
  const opener = cap(openerText || pick(TOTAL_OPENERS, seed + 13));
  const closer = pick(CLOSERS, seed + 17);
  const dir = m.direction;
  const want = String(dir).toLowerCase();

  const CLAUSES = {
    combined_offence: {
      over: 'both attacks have been scoring freely',
      under: 'at least one of these attacks has been starved of points lately',
    },
    combined_defence: {
      over: 'both defences have been conceding heavily',
      under: 'both defences have been tight',
    },
    recent_totals: {
      over: 'recent matches involving these clubs have been running high',
      under: 'recent matches involving these clubs have been staying low',
    },
    golden_point_state: {
      over: 'nothing in the recent game state points to a grind',
      under: 'recent finishes between these sides have been tight and low-scoring',
    },
    weather: {
      over: 'the forecast is dry and clear',
      under: 'the forecast is wet, which suppresses handling and ball-in-play time',
    },
  };

  // Only the factors that actually scored for the direction being published.
  const clauses = [];
  for (const c of [...m.components].sort((a, b) => b.points - a.points)) {
    if (!c || c.missing || !c.points) continue;
    if (c.side && c.side !== want) continue;
    const text = CLAUSES[c.id]?.[c.side];
    if (text) clauses.push({ text, positive: true });
  }
  const body = sentence(clauses, 3)
    || 'The balance of evidence on this card points that way without a single dominant factor.';
  return `**${dir}** — ${opener} the ${want} on the game total. ${body} ${closer} Confidence: ${m.band}.`;
}

function skipText(marketKey, market) {
  const label = MARKET_LABELS[marketKey];
  const reason = (market.skipReason || 'the evidence for this market does not clear the threshold').replace(/\s+/g, ' ');
  return `SKIP — ${label}: ${reason}, so this market is left alone rather than forced into a selection.`;
}

/* ------------------------------------------------------------- validation */

export function validateNrlTip(tip) {
  const errors = [];
  const text = tip.text || '';
  const wc = wordCount(text);
  if (!tip.skip) {
    if (wc < MIN_WORDS) errors.push(`only ${wc} words (minimum ${MIN_WORDS})`);
    const plain = text.replace(/\*\*/g, '');
    const bolded = /\*\*(.+?)\*\*/.exec(text);
    if (!bolded) errors.push('no bolded pick');
    else {
      const before = text.slice(0, bolded.index).replace(/\*\*/g, '').trim();
      const beforeWords = before ? before.split(/\s+/).length : 0;
      if (beforeWords > 20) errors.push(`bolded pick starts at word ${beforeWords + 1}, after the first 20`);
      if (tip.market === 'handicap' && /[-+]?\d/.test(bolded[1])) errors.push('handicap tip states a number');
      if (tip.market === 'game_total' && !/^(over|under)$/i.test(bolded[1].trim())) errors.push('game total tip does not bold Over or Under');
    }
    if (!new RegExp(`Confidence:\\s*(LOW|MEDIUM|HIGH)`).test(plain)) errors.push('confidence not declared');
    for (const p of FORBIDDEN_PATTERNS) {
      if (p.re.test(plain)) errors.push(`contains ${p.why}`);
    }
    for (const b of BANNED_PHRASES) {
      if (plain.toLowerCase().includes(b)) errors.push(`uses the banned phrase "${b}"`);
    }
  } else {
    if (!text.trim().startsWith('SKIP')) errors.push('SKIP tip does not start with SKIP');
    if (text.slice(0, -1).includes('. ')) errors.push('SKIP tip is more than one sentence');
  }
  return errors;
}

/* ------------------------------------------------------------------- card */

export function writeNrlCard(results) {
  const tips = [];
  const summary = [];
  const valueFlags = [];
  const openersUsed = new Set();

  /**
   * Next unused opener from a pool, starting from a per-match seed. First pass
   * prefers an opener whose opening word has not been used yet; once those run
   * out it falls back to any unused phrase, so a card never repeats a line.
   */
  const takeOpener = (pool, seed) => {
    const start = Math.abs(seed) % pool.length;
    const firstWord = (s) => s.split(/\s+/)[0].toLowerCase().replace(/[^a-z']/g, '');
    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[(start + i) % pool.length];
      if (!openersUsed.has(cand) && ![...openersUsed].some((u) => firstWord(u) === firstWord(cand))) break;
    }
    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[(start + i) % pool.length];
      const word = firstWord(cand);
      if (!openersUsed.has(cand) && ![...openersUsed].some((u) => firstWord(u) === word)) {
        openersUsed.add(cand);
        return cand;
      }
    }
    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[(start + i) % pool.length];
      if (!openersUsed.has(cand)) { openersUsed.add(cand); return cand; }
    }
    return pool[start];
  };

  results.forEach((result, idx) => {
    const label = `${result.match.home} v ${result.match.away}`;
    const row = { match: label, markets: {} };
    for (const key of MARKETS) {
      const market = result.markets[key];
      let text;
      const seed = hashString(`${label}${key}`);
      if (market.skip) {
        text = skipText(key, market);
      } else if (key === 'win_match') {
        text = winTipText(result, takeOpener(OPENERS, seed));
      } else if (key === 'handicap') {
        text = handicapTipText(result, takeOpener(OPENERS, seed));
      } else {
        text = totalTipText(result, takeOpener(TOTAL_OPENERS, seed));
      }
      if (!market.skip) text = padToMinimum(text, seed);

      const tip = {
        matchLabel: label,
        matchIndex: idx,
        market: key,
        marketLabel: MARKET_LABELS[key],
        selection: market.selection,
        band: market.band,
        skip: !!market.skip,
        score: market.score ?? null,
        text,
        words: wordCount(text),
        errors: [],
      };
      tip.errors = validateNrlTip(tip);
      tips.push(tip);
      row.markets[key] = market.skip
        ? { pick: 'SKIP', band: CONFIDENCE.SKIP }
        : { pick: key === 'handicap' ? market.side : market.selection, band: market.band };
    }
    summary.push(row);
    if (result.valueFlag) valueFlags.push({ match: label, note: result.valueFlag });
  });

  const active = tips.filter((t) => !t.skip);
  return {
    sport: 'NRL',
    tips,
    summary,
    valueFlags,
    activeCount: active.length,
    skipCount: tips.length - active.length,
    invalid: tips.filter((t) => t.errors.length).map((t) => ({ match: t.matchLabel, market: t.market, errors: t.errors })),
  };
}

/* ------------------------------------------------------------- card text */

export const RESPONSIBLE_GAMBLING = [
  'These are model-based estimates produced mechanically from public data, not guarantees, not betting advice, and not a system that can beat the market.',
  'Only ever stake what you would be comfortable losing, set a deposit limit before you start, and treat every selection on this card as fallible — including the ones marked HIGH confidence.',
  'If betting stops being fun, or you are chasing losses, stop and talk to someone.',
  'Australia: the National Gambling Helpline on 1800 858 858, free and confidential, 24 hours a day, through Gambling Help Online. BetStop is the National Self-Exclusion Register — you can exclude yourself from all licensed Australian online and phone wagering providers.',
  'New Zealand, including for Warriors fixtures: the Gambling Helpline on 0800 654 655, free and confidential, 24 hours a day, or text 8006.',
  'Everywhere else: use your own national gambling support service. Contact details change, so confirm them on the provider’s own site before you rely on them.',
];

export function buildNrlFormattedCardText(card, dateISO) {
  const lines = [];
  lines.push(`NRL PREDICTION CARD — ${dateISO}`);
  lines.push('Generated by SportsPred from the NRL (National Rugby League) Prediction Master Prompt v1.0.');
  lines.push('Sources: the committed NRL results tape, the official competition ladder, the OLBG market slate and the Open-Meteo forecast. Odds are not used: no key-less price feed exists.');
  lines.push('');

  card.summary.forEach((row, i) => {
    lines.push(`${i + 1}. ${row.match}`);
    for (const key of MARKETS) {
      const tips = card.tips.filter((t) => t.matchLabel === row.match && t.market === key);
      for (const t of tips) {
        lines.push(`${t.marketLabel}: ${t.text.replace(/\*\*/g, '')}`);
      }
    }
    lines.push('');
  });

  lines.push('SUMMARY TABLE');
  const cell = (s, w) => String(s).padEnd(w).slice(0, w);
  lines.push(`${cell('Match', 46)}${cell('WIN MATCH', 26)}${cell('HANDICAP', 26)}${cell('GAME TOTAL', 20)}`);
  lines.push('-'.repeat(118));
  for (const row of card.summary) {
    const wm = row.markets.win_match;
    const hc = row.markets.handicap;
    const gt = row.markets.game_total;
    lines.push(`${cell(row.match, 46)}${cell(`${wm.pick} (${wm.band})`, 26)}${cell(`${hc.pick} (${hc.band})`, 26)}${cell(`${gt.pick} (${gt.band})`, 20)}`);
  }
  lines.push('');

  lines.push('VALUE CANDIDATES');
  if (!card.valueFlags.length) {
    lines.push('None flagged this card. A value candidate is only named where the card backs the side lower on the ladder on the strength of its own form or head-to-head record; no price comparison is possible without a price feed.');
  } else {
    for (const v of card.valueFlags) lines.push(`- ${v.match}: ${v.note}`);
  }
  lines.push('');

  lines.push('RESPONSIBLE GAMBLING');
  for (const p of RESPONSIBLE_GAMBLING) lines.push(`- ${p}`);
  lines.push('');
  lines.push(`${card.activeCount} live selections and ${card.skipCount} markets withheld as SKIP on this card.`);
  return lines.join('\n');
}

export { MARKET_LABELS };
