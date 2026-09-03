/**
 * SportsPred — NPB official-site parsers (pure, no I/O).
 *
 * Every function here turns HTML from npb.jp (the Nippon Professional
 * Baseball Organization's own site) into plain records. Nothing is inferred
 * that the page does not print. Each parser's docblock quotes the URL it was
 * built against and the date the field layout was observed, so a reviewer can
 * open the page and check the mapping line by line.
 *
 * Verified live 2026-09-03 (see docs/NPB_SOURCES.md):
 *   https://npb.jp/bis/eng/2026/games/                    daily scores (venue, game no., score)
 *   https://npb.jp/bis/eng/2026/games/gmYYYYMMDD.html     one day's scores/schedule
 *   https://npb.jp/bis/eng/2026/games/sYYYYMMDD0NNNN.html box score (innings, pitching lines)
 *   https://npb.jp/bis/eng/2026/calendar/index_MM.html    month calendar: results + upcoming
 *   https://npb.jp/bis/eng/2026/stats/std_c.html / std_p  standings with W-L-T and per-opponent
 *   https://npb.jp/bis/eng/2026/stats/idp1_X.html         per-team pitching table
 *   https://npb.jp/bis/eng/2026/stats/idb1_X.html         per-team batting table
 *   https://npb.jp/games/2026/schedule_MM_detail.html     Japanese schedule with announced
 *                                                         starters (予告先発) + venue + weather icon
 *
 * Draws are first-class: a calendar cell "F 1 - 1 H" is a tie and is kept as
 * { draw: true }. A cell "S * - * C" is a postponed/cancelled game and is kept
 * as { postponed: true } — it is never counted as a result.
 */

export const NPB_BASE = 'https://npb.jp';

/**
 * Team code table. Codes are the letters NPB itself uses in calendar cells,
 * standings column headers ("vs T", "vs DB"), flag image names
 * (flag2026_f_1l.gif) and per-team stat URLs (idp1_t.html).
 * Observed on https://npb.jp/bis/eng/2026/calendar/index_09.html (header
 * "H , F , B , E , L , M | T , DB , G , D , C , S").
 */
export const NPB_TEAMS = {
  T: { code: 'T', name: 'Hanshin Tigers', short: 'Hanshin', ja: '阪神', jaFull: '阪神タイガース', league: 'central' },
  G: { code: 'G', name: 'Yomiuri Giants', short: 'Yomiuri', ja: '巨人', jaFull: '読売ジャイアンツ', league: 'central' },
  DB: { code: 'DB', name: 'Yokohama DeNA BayStars', short: 'DeNA', ja: 'DeNA', jaFull: '横浜DeNAベイスターズ', league: 'central' },
  S: { code: 'S', name: 'Tokyo Yakult Swallows', short: 'Yakult', ja: 'ヤクルト', jaFull: '東京ヤクルトスワローズ', league: 'central' },
  C: { code: 'C', name: 'Hiroshima Toyo Carp', short: 'Hiroshima', ja: '広島', jaFull: '広島東洋カープ', league: 'central' },
  D: { code: 'D', name: 'Chunichi Dragons', short: 'Chunichi', ja: '中日', jaFull: '中日ドラゴンズ', league: 'central' },
  H: { code: 'H', name: 'Fukuoka SoftBank Hawks', short: 'SoftBank', ja: 'ソフトバンク', jaFull: '福岡ソフトバンクホークス', league: 'pacific' },
  L: { code: 'L', name: 'Saitama Seibu Lions', short: 'Seibu', ja: '西武', jaFull: '埼玉西武ライオンズ', league: 'pacific' },
  F: { code: 'F', name: 'Hokkaido Nippon-Ham Fighters', short: 'Nippon-Ham', ja: '日本ハム', jaFull: '北海道日本ハムファイターズ', league: 'pacific' },
  B: { code: 'B', name: 'ORIX Buffaloes', short: 'ORIX', ja: 'オリックス', jaFull: 'オリックス・バファローズ', league: 'pacific' },
  M: { code: 'M', name: 'Chiba Lotte Marines', short: 'Lotte', ja: 'ロッテ', jaFull: '千葉ロッテマリーンズ', league: 'pacific' },
  E: { code: 'E', name: 'Tohoku Rakuten Golden Eagles', short: 'Rakuten', ja: '楽天', jaFull: '東北楽天ゴールデンイーグルス', league: 'pacific' },
};

export const CENTRAL = Object.values(NPB_TEAMS).filter((t) => t.league === 'central').map((t) => t.code);
export const PACIFIC = Object.values(NPB_TEAMS).filter((t) => t.league === 'pacific').map((t) => t.code);

/**
 * Home venues and roof status. Roof status is the one fact here that does not
 * come from npb.jp's English stats pages; it is taken from the venues' own
 * published descriptions and cross-checked against two secondary sources
 * (docs/NPB_SOURCES.md, "Venues"). Only the twelve primary home parks are
 * listed; a regional park (e.g. "Morioka", "Akita", "Kyocera Dome" used by
 * Yomiuri on 9/1–9/2) resolves through VENUE_ROOF below or stays null.
 */
export const VENUE_ROOF = {
  // Central
  'Tokyo Dome': 'dome',
  'Vantelin Dome': 'dome',
  'Kyocera Dome': 'dome',
  'Yokohama': 'open',
  'Koshien': 'open',
  'Mazda Stadium': 'open',
  'Jingu': 'open',
  // Pacific
  'Mizuho PayPay': 'retractable',
  'PayPay Dome': 'retractable',
  'Belluna Dome': 'dome',
  'ES CON FIELD': 'retractable',
  'ZOZO Marine': 'open',
  'Rakuten Mobile': 'open',
  'Hotto Motto Kobe': 'open',
  // Regional parks seen on the 2026 calendar
  'Morioka': 'open',
  'Akita': 'open',
};

/** Japanese venue label (schedule_MM_detail.html) -> English label used by bis/eng. */
const normJa = (s) => String(s || '').replace(/[\s\u3000]+/g, '');
export function venueFromJa(label) {
  const key = normJa(label);
  for (const [ja, en] of Object.entries(VENUE_JA)) if (normJa(ja) === key) return en;
  return null;
}

export const VENUE_JA = {
  '東京ドーム': 'Tokyo Dome',
  'バンテリンドーム': 'Vantelin Dome',
  '京セラD大阪': 'Kyocera Dome',
  '横　浜': 'Yokohama',
  '横浜': 'Yokohama',
  '甲子園': 'Koshien',
  'マツダスタジアム': 'Mazda Stadium',
  '神　宮': 'Jingu',
  '神宮': 'Jingu',
  'みずほPayPay': 'Mizuho PayPay',
  'ベルーナドーム': 'Belluna Dome',
  'エスコンＦ': 'ES CON FIELD',
  'ZOZOマリン': 'ZOZO Marine',
  '楽天モバイル': 'Rakuten Mobile',
  'ほっと神戸': 'Hotto Motto Kobe',
  '盛　岡': 'Morioka',
  '秋　田': 'Akita',
};

export function roofFor(venue) {
  if (!venue) return null;
  const v = String(venue).trim();
  if (VENUE_ROOF[v]) return VENUE_ROOF[v];
  const hit = Object.keys(VENUE_ROOF).find((k) => v.toLowerCase().includes(k.toLowerCase()));
  return hit ? VENUE_ROOF[hit] : null;
}

export function teamByCode(code) {
  return NPB_TEAMS[String(code || '').toUpperCase()] || null;
}

export function teamByName(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
  for (const t of Object.values(NPB_TEAMS)) {
    if (t.name.toLowerCase() === n || t.short.toLowerCase() === n || t.ja === name) return t;
  }
  for (const t of Object.values(NPB_TEAMS)) {
    if (n.includes(t.short.toLowerCase())) return t;
    if (name.includes(t.jaFull) || name.includes(t.ja)) return t;
  }
  // OLBG-style labels: "Hanshin Tigers", "Yomiuri Giants", "Softbank Hawks", "Nippon Ham Fighters"
  const loose = n.replace(/[^a-z]/g, '');
  for (const t of Object.values(NPB_TEAMS)) {
    const nick = t.name.split(' ').pop().toLowerCase();
    if (loose.includes(nick)) return t;
  }
  return null;
}

export function leagueOf(codeA, codeB) {
  const a = teamByCode(codeA)?.league;
  const b = teamByCode(codeB)?.league;
  if (!a || !b) return null;
  return a === b ? a : 'interleague';
}

/** Designated hitter status per the rule set of the season in question. */
export function dhStatus(season, homeLeague, matchLeague) {
  // Central League: no DH through 2026; adopts DH from 2027 (decided 2025-08-04,
  // see docs/NPB_SOURCES.md). Pacific League: DH since 1975. Interleague and
  // Japan Series historically follow the home team's league rule.
  const y = Number(season);
  if (!Number.isFinite(y)) return { dh: null, basis: 'season unknown' };
  if (y >= 2027) return { dh: true, basis: 'universal DH from the 2027 season (Central League decision of 2025-08-04)' };
  if (matchLeague === 'pacific') return { dh: true, basis: 'Pacific League game — DH since 1975' };
  if (matchLeague === 'central') return { dh: false, basis: 'Central League game — no DH through the 2026 season' };
  if (matchLeague === 'interleague') {
    if (homeLeague === 'pacific') return { dh: true, basis: 'interleague at a Pacific League park — home-league rule applies' };
    if (homeLeague === 'central') return { dh: false, basis: 'interleague at a Central League park — home-league rule applies' };
  }
  return { dh: null, basis: 'league not resolved' };
}

/* ------------------------------------------------------------------ *
 * HTML helpers (no DOM available in the collector, so these are regex-based
 * over the server-rendered pages, and deliberately conservative).
 * ------------------------------------------------------------------ */

function stripTags(s) {
  // Table cells become "| a | b |" rows so the same parsers accept both the
  // server-rendered <table> markup and the pipe-delimited text renderings
  // used in the committed fixtures (tests/fixtures/npb_*).
  return String(s || '')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<tr[^>]*>\s*<t[dh][^>]*>/gi, '\u0001| ')
    .replace(/<\/t[dh]>\s*<\/tr>/gi, ' |\u0001')
    .replace(/<\/tr>/gi, '\u0001')
    .replace(/<br\s*\/?>/gi, '\u0001')
    .replace(/<\/(p|div|h\d|li|table)>/gi, '\u0001')
    .replace(/\r?\n/g, '\u0001')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/\s*\u0001\s*/g, '\n')
    .trim();
}

function toInt(s) {
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function toNum(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * Month calendar: https://npb.jp/bis/eng/2026/calendar/index_09.html
 *
 * Observed 2026-09-03. Each day cell holds either result anchors like
 *   <a href=".../games/s2026090201768.html">F 1 - 1 H</a>
 * or unplayed rows like "S - T 18:00". "F 1 - 1 H" means the first-listed
 * code (F) is the HOME team: the box score s2026090201768 is "Nippon-Ham vs
 * SoftBank" at ES CON FIELD, and the schedule page lists 日本ハム as the
 * left-hand (home) side. Postponed games print "S * - * C".
 * ------------------------------------------------------------------ */

const CAL_RESULT = /<a[^>]+href="([^"]*\/games\/(s(\d{4})(\d{2})(\d{2})(\d{5}))\.html)"[^>]*>\s*([A-Z]{1,2})\s+(\d+|\*)\s*-\s*(\d+|\*)\s+([A-Z]{1,2})\s*<\/a>/g;
const CAL_UPCOMING = /(?:^|[>\n])\s*([A-Z]{1,2})\s+-\s+([A-Z]{1,2})\s+(\d{1,2}:\d{2})/g;
const CAL_DAY = /<a[^>]+href="[^"]*\/games\/gm(\d{4})(\d{2})(\d{2})\.html"[^>]*>\s*(\d{1,2})\s*<\/a>/g;

/**
 * Parse one month calendar into { results: [], upcoming: [] }.
 * Results carry the box-score URL (the review link for every number).
 */
/**
 * Accept either the server HTML or a markdown rendering of the same page
 * (`[G 4 - 3 DB](https://.../s2026090101405.html)`), which is how captured
 * fixtures are stored. Markdown anchors are rewritten to <a> tags first.
 */
export function normaliseMarkdownAnchors(text) {
  return String(text || '')
    .replace(/\\([*|])/g, '$1')
    .replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function parseCalendarMonth(input, { season = null } = {}) {
  const results = [];
  const upcoming = [];
  const warnings = [];
  if (!input) return { results, upcoming, warnings: ['empty html'] };
  const html = normaliseMarkdownAnchors(input);

  // Split by day anchors so each unplayed row can be dated.
  const dayIdx = [];
  let m;
  CAL_DAY.lastIndex = 0;
  while ((m = CAL_DAY.exec(html))) {
    dayIdx.push({ pos: m.index, dateISO: `${m[1]}-${m[2]}-${m[3]}` });
  }
  const dateAt = (pos) => {
    let d = null;
    for (const x of dayIdx) { if (x.pos <= pos) d = x.dateISO; else break; }
    return d;
  };

  CAL_RESULT.lastIndex = 0;
  while ((m = CAL_RESULT.exec(html))) {
    const [, href, gameKey, y, mo, d, , homeCode, hs, as, awayCode] = m;
    const dateISO = `${y}-${mo}-${d}`;
    const url = href.startsWith('http') ? href : `${NPB_BASE}${href}`;
    if (!teamByCode(homeCode) || !teamByCode(awayCode)) { warnings.push(`unknown code in ${dateISO} ${homeCode}/${awayCode}`); continue; }
    if (hs === '*' || as === '*') {
      results.push({ id: gameKey, dateISO, season: season || Number(y), home: homeCode, away: awayCode, homeScore: null, awayScore: null, postponed: true, draw: false, url, source: 'npb-calendar' });
      continue;
    }
    const h = toInt(hs); const a = toInt(as);
    results.push({
      id: gameKey, dateISO, season: season || Number(y), home: homeCode, away: awayCode,
      homeScore: h, awayScore: a, draw: h === a, postponed: false,
      winner: h > a ? homeCode : a > h ? awayCode : null,
      league: leagueOf(homeCode, awayCode), url, source: 'npb-calendar',
    });
  }

  // Upcoming rows: scan text between day anchors.
  const text = html.replace(/<a[^>]*>[^<]*<\/a>/g, (s) => s); // keep anchors for dating
  CAL_UPCOMING.lastIndex = 0;
  while ((m = CAL_UPCOMING.exec(text))) {
    const [, homeCode, awayCode, hhmm] = m;
    if (!teamByCode(homeCode) || !teamByCode(awayCode)) continue;
    const dateISO = dateAt(m.index);
    if (!dateISO) { warnings.push(`undated upcoming row ${homeCode}-${awayCode} ${hhmm}`); continue; }
    upcoming.push({
      id: `npb-${dateISO.replace(/-/g, '')}-${homeCode}-${awayCode}`,
      dateISO, season: season || Number(dateISO.slice(0, 4)),
      home: homeCode, away: awayCode, startLocal: hhmm,
      startUtc: jstToUtc(dateISO, hhmm),
      league: leagueOf(homeCode, awayCode), source: 'npb-calendar',
    });
  }
  return { results, upcoming, warnings };
}

/** NPB prints local (JST, UTC+9) start times. */
export function jstToUtc(dateISO, hhmm) {
  if (!dateISO || !hhmm) return null;
  const [h, mi] = hhmm.split(':').map(Number);
  const d = new Date(`${dateISO}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
}

/* ------------------------------------------------------------------ *
 * Daily page: https://npb.jp/bis/eng/2026/games/gm20260902.html
 * Observed: each game anchor's text runs "Yomiuri 1 Game 21 Kyocera Dome 2 DeNA"
 * i.e. HOME short name, home score, game number, venue, away score, away
 * short name. For unplayed days ("Schedules") the text is
 * "Yakult Jingu 18:00 Hanshin".
 * ------------------------------------------------------------------ */
export function parseDayPage(html, dateISO) {
  const games = [];
  const warnings = [];
  if (!html) return { games, warnings: ['empty html'] };
  const anchorRe = /<a[^>]+href="([^"]*\/games\/(s\d{13})\.html)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = anchorRe.exec(html))) {
    const text = stripTags(m[3]).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const r = text.match(/^(.+?)\s+(\d+)\s+Game\s+(\d+)\s+(.+?)\s+(\d+)\s+(.+?)$/);
    if (!r) { warnings.push(`unparsed result anchor: ${text}`); continue; }
    const home = teamByName(r[1]); const away = teamByName(r[6]);
    if (!home || !away) { warnings.push(`unknown team in: ${text}`); continue; }
    games.push({
      id: m[2], dateISO, home: home.code, away: away.code,
      homeScore: toInt(r[2]), awayScore: toInt(r[5]), gameNo: toInt(r[3]), venue: r[4].trim(),
      draw: toInt(r[2]) === toInt(r[5]), league: leagueOf(home.code, away.code),
      url: m[1].startsWith('http') ? m[1] : `${NPB_BASE}${m[1]}`, source: 'npb-day',
    });
  }
  // Unplayed: "Yakult Jingu 18:00 Hanshin" blocks without anchors.
  const plain = stripTags(html);
  const upRe = /([A-Za-z\-]+)\s+([A-Za-z ]+?(?:Dome|Stadium|Field|FIELD|Jingu|Koshien|Yokohama|Marine|Mobile|Kobe|Morioka|Akita|PayPay|Belluna)[A-Za-z ]*?)\s+(\d{1,2}:\d{2})\s+([A-Za-z\-]+)/g;
  const upcoming = [];
  while ((m = upRe.exec(plain))) {
    const home = teamByName(m[1]); const away = teamByName(m[4]);
    if (!home || !away) continue;
    upcoming.push({ dateISO, home: home.code, away: away.code, venue: m[2].trim(), startLocal: m[3], startUtc: jstToUtc(dateISO, m[3]) });
  }
  return { games, upcoming, warnings };
}

/* ------------------------------------------------------------------ *
 * Box score: https://npb.jp/bis/eng/2026/games/s2026090201768.html
 * Observed 2026-09-03:
 *   header "| ES CON FIELD | T - 3:46 ( 18:00 - 21:46 ) Att. - 30,176 |"
 *   line score rows "| SoftBank | 0 | 0 | ... | - | 1 | 2 | 0 |" and
 *   "( 12 innings )" when extra innings were played;
 *   pitching tables "| Uwasawa | 8 | | 33 | 7 | 3 | 0 | 10 | 1 |"
 *   = IP, BF, H, BB, HB, SO, ER, with "(H)" / "(S)" decorations for
 *   holds/saves and the FIRST row of each table being the starter.
 * ------------------------------------------------------------------ */
export function parseBoxScore(html, { id = null } = {}) {
  const out = { id, venue: null, innings: 9, attendance: null, duration: null, startLocal: null, home: null, away: null, homeScore: null, awayScore: null, draw: null, homePitchers: [], awayPitchers: [], warnings: [] };
  if (!html) { out.warnings.push('empty html'); return out; }
  const text = stripTags(html);

  const inn = text.match(/\(\s*(\d+)\s+innings\s*\)/i);
  if (inn) out.innings = toInt(inn[1]);
  const att = text.match(/Att\.\s*-\s*([\d,]+)/);
  if (att) out.attendance = toInt(att[1]);
  const dur = text.match(/T\s*-\s*(\d+:\d{2})\s*\(\s*(\d{1,2}:\d{2})\s*-\s*\d{1,2}:\d{2}\s*\)/);
  if (dur) { out.duration = dur[1]; out.startLocal = dur[2]; }
  const venue = text.match(/(?:^|\n|\|)\s*([A-Za-z][A-Za-z .]+?)\s*\|?\s*T\s*-\s*\d+:\d{2}/);
  if (venue) out.venue = venue[1].trim();

  // Line score: the first team row is the VISITING side, the second the HOME
  // side (standard box-score order, matches the "Game NN ( <home team>: W - L )"
  // header). R is the third-from-last numeric cell (R | H | E).
  const NAMES = 'Hanshin Tigers|Yomiuri Giants|YOKOHAMA DeNA BAYSTARS|Yokohama DeNA BayStars|Tokyo Yakult Swallows|Hiroshima Toyo Carp|Chunichi Dragons|Fukuoka SoftBank Hawks|Saitama Seibu Lions|Hokkaido Nippon-Ham Fighters|ORIX Buffaloes|Chiba Lotte Marines|Tohoku Rakuten Golden Eagles';
  const lineRows = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
    if (cells.length < 12) continue;
    const t = new RegExp(`^(${NAMES})$`).exec(cells[0]);
    if (!t) continue;
    const nums = cells.slice(1);
    const r = nums[nums.length - 3];
    if (!/^\d+$/.test(r)) continue;
    lineRows.push({ code: teamByName(t[1]).code, runs: toInt(r), hits: toInt(nums[nums.length - 2]), errors: toInt(nums[nums.length - 1]) });
    if (lineRows.length === 2) break;
  }
  if (lineRows.length === 2) {
    out.away = lineRows[0].code; out.home = lineRows[1].code;
    out.awayScore = lineRows[0].runs; out.homeScore = lineRows[1].runs;
    out.awayHits = lineRows[0].hits; out.homeHits = lineRows[1].hits;
    out.draw = out.homeScore === out.awayScore;
  } else {
    out.warnings.push('line score not parsed');
  }

  // Pitching lines: rows of "Name[, (H)] | IP | | BF | H | BB | HB | SO | ER".
  const lineRe = /\|\s*([A-Z][A-Za-z.'\- ]+?)(?:,\s*\((H|S|W|L)\))?\s*\|\s*(\d+(?:\.\d)?)\s*\|\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;
  const rows = [];
  let m;
  const raw = html.replace(/<br\s*\/?>/gi, ' ');
  const tableText = stripTags(raw).replace(/\s+/g, ' ');
  // In the stripped text tables collapse to "| Uwasawa | 8 | | 33 | 7 | 3 | 0 | 10 | 1 |" sequences.
  while ((m = lineRe.exec(tableText))) {
    rows.push({ name: m[1].trim(), decoration: m[2] || null, ip: toNum(m[3]), bf: toInt(m[4]), h: toInt(m[5]), bb: toInt(m[6]), hb: toInt(m[7]), so: toInt(m[8]), er: toInt(m[9]) });
  }
  // The page lists the AWAY team's pitchers first (they pitch to the home
  // batters shown under the away heading), then the home team's. Split on the
  // second "IP | BF" header occurrence.
  const headerCount = (tableText.match(/IP\s*\|\s*\|?\s*BF/g) || []).length;
  if (headerCount >= 2 && rows.length >= 2) {
    const firstHeader = tableText.indexOf('IP');
    const secondHeader = tableText.indexOf('IP', firstHeader + 2);
    const split = rows.findIndex((r) => tableText.indexOf(`| ${r.name}`) > secondHeader);
    out.awayPitchers = split > 0 ? rows.slice(0, split) : rows;
    out.homePitchers = split > 0 ? rows.slice(split) : [];
  } else {
    out.awayPitchers = rows;
  }
  if (!rows.length) out.warnings.push('no pitching lines parsed');
  return out;
}

/* ------------------------------------------------------------------ *
 * Standings: https://npb.jp/bis/eng/2026/stats/std_c.html
 * Observed 2026-09-03: "| Hanshin Tigers | 119 | 68 | 50 | 1 | .576 | -- |
 * 30-25 (1) | 38-25 | *** | 16-7 | 10-8 | ... | 6-12 |". Ties (T) are a
 * printed column; per-opponent cells carry a "(n)" tie count.
 * ------------------------------------------------------------------ */
export function parseStandings(input, league) {
  const teams = [];
  const warnings = [];
  if (!input) return { teams, warnings: ['empty html'] };
  // "30-25<br>(1)" = record plus tie count inside one cell: keep it on one line.
  const text = stripTags(normaliseMarkdownAnchors(input).replace(/<br\s*\/?>/gi, ' '));
  const dated = text.match(/((?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
  const order = league === 'central' ? ['T', 'G', 'DB', 'S', 'C', 'D'] : ['H', 'L', 'F', 'B', 'M', 'E'];
  const headerRe = /vs\s+([A-Z]{1,2})/g;
  const header = [];
  let m;
  const headStart = text.indexOf('Standings');
  const headEnd = text.indexOf('Interleague');
  const headSlice = text.slice(headStart, headEnd > headStart ? headEnd : undefined);
  while ((m = headerRe.exec(headSlice))) header.push(m[1]);
  const oppOrder = header.length === 6 ? header : order;

  const rowRe = /\|\s*(Hanshin Tigers|Yomiuri Giants|YOKOHAMA DeNA BAYSTARS|Yokohama DeNA BayStars|Tokyo Yakult Swallows|Hiroshima Toyo Carp|Chunichi Dragons|Fukuoka SoftBank Hawks|Saitama Seibu Lions|Hokkaido Nippon-Ham Fighters|ORIX Buffaloes|Chiba Lotte Marines|Tohoku Rakuten Golden Eagles)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\.\d{3}|1\.000)\s*\|\s*([\d.]+|--|-)\s*\|([^\n]*)/g;
  let rank = 0;
  const seen = new Set();
  while ((m = rowRe.exec(headSlice))) {
    const t = teamByName(m[1]);
    if (!t || seen.has(t.code)) continue;
    seen.add(t.code);
    rank += 1;
    const rest = m[8].split('|').map((s) => s.trim()).filter((s) => s.length);
    const splitRec = (s) => {
      const r = String(s).match(/(\d+)-(\d+)(?:\s*\((\d+)\))?/);
      return r ? { w: toInt(r[1]), l: toInt(r[2]), t: r[3] ? toInt(r[3]) : 0 } : null;
    };
    const home = splitRec(rest[0]);
    const road = splitRec(rest[1]);
    const vs = {};
    for (let i = 0; i < oppOrder.length; i += 1) {
      const cell = rest[2 + i];
      if (!cell || cell.includes('*')) continue;
      const r = splitRec(cell);
      if (r) vs[oppOrder[i]] = r;
    }
    const inter = splitRec(rest[2 + oppOrder.length]);
    teams.push({
      code: t.code, name: t.name, league, rank,
      games: toInt(m[2]), wins: toInt(m[3]), losses: toInt(m[4]), ties: toInt(m[5]), pct: toNum(m[6]),
      gamesBehind: m[7] === '--' || m[7] === '-' ? 0 : toNum(m[7]),
      home, road, vs, interleague: inter,
      drawRate: toInt(m[2]) ? Math.round((toInt(m[5]) / toInt(m[2])) * 10000) / 10000 : null,
      source: `${NPB_BASE}/bis/eng/2026/stats/std_${league === 'central' ? 'c' : 'p'}.html`,
    });
  }
  if (teams.length !== 6) warnings.push(`expected 6 teams, parsed ${teams.length}`);
  return { teams, asOf: dated ? dated[1] : null, warnings };
}

/* ------------------------------------------------------------------ *
 * Per-team pitching: https://npb.jp/bis/eng/2026/stats/idp1_t.html
 * Observed columns: Pitcher | G | W | L | SV | HLD | HP | CG | SHO | NWG |
 * PCT | BF | IP | H | HR | BB | IBB | HB | SO | WP | BK | R | ER | ERA.
 * A leading "*" marks a left-hander.
 * ------------------------------------------------------------------ */
export function parseTeamPitching(html, teamCode) {
  const pitchers = [];
  if (!html) return { pitchers, warnings: ['empty html'] };
  const text = stripTags(html);
  const rowRe = /\|\s*(\\?\*)?\s*([A-Z][A-Za-z.'\-]+,\s*[A-Z][A-Za-z.'\- ]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+|-+)\s*\|/g;
  let m;
  while ((m = rowRe.exec(text))) {
    const name = m[2].trim();
    const [last, first] = name.split(',').map((s) => s.trim());
    pitchers.push({
      team: teamCode, name, last, first, throws: m[1] ? 'L' : 'R',
      g: toInt(m[3]), w: toInt(m[4]), l: toInt(m[5]), sv: toInt(m[6]), hld: toInt(m[7]),
      cg: toInt(m[9]), sho: toInt(m[10]), bf: toInt(m[13]), ip: toNum(m[14]), h: toInt(m[15]), hr: toInt(m[16]),
      bb: toInt(m[17]), so: toInt(m[20]), r: toInt(m[23]), er: toInt(m[24]), era: toNum(m[25]),
    });
  }
  return { pitchers, warnings: pitchers.length ? [] : ['no pitcher rows parsed'] };
}

/* ------------------------------------------------------------------ *
 * Per-team batting: https://npb.jp/bis/eng/2026/stats/idb1_s.html
 * Observed columns: Player | G | PA | AB | R | H | 2B | 3B | HR | TB | RBI |
 * SB | CS | SH | SF | BB | IBB | HP | SO | GDP | AVG | SLG | OBP.
 * Team totals are derived by summing the printed player rows (AB, H, TB,
 * BB, HP, SF) — the page itself prints no team line.
 * ------------------------------------------------------------------ */
export function parseTeamBatting(html, teamCode) {
  const players = [];
  if (!html) return { players, team: null, warnings: ['empty html'] };
  const text = stripTags(html);
  const rowRe = /\|\s*(\\?[*+])?\s*([A-Z][A-Za-z.'\-]+,\s*[A-Z][A-Za-z.'\- ]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\.\d{3}|1\.000)\s*\|\s*(\.\d{3}|\d\.\d{3})\s*\|\s*(\.\d{3}|1\.000)\s*\|/g;
  let m;
  const tot = { pa: 0, ab: 0, r: 0, h: 0, tb: 0, bb: 0, hp: 0, sf: 0, hr: 0 };
  while ((m = rowRe.exec(text))) {
    const p = {
      team: teamCode, name: m[2].trim(), bats: m[1] ? (m[1].includes('+') ? 'S' : 'L') : 'R',
      g: toInt(m[3]), pa: toInt(m[4]), ab: toInt(m[5]), r: toInt(m[6]), h: toInt(m[7]), hr: toInt(m[10]), tb: toInt(m[11]),
      bb: toInt(m[17]), hp: toInt(m[19]), sf: toInt(m[16]), so: toInt(m[20]), avg: toNum(m[22]), slg: toNum(m[23]), obp: toNum(m[24]),
    };
    players.push(p);
    for (const k of Object.keys(tot)) tot[k] += p[k] || 0;
  }
  const team = tot.ab ? {
    team: teamCode, ...tot,
    avg: Math.round((tot.h / tot.ab) * 1000) / 1000,
    slg: Math.round((tot.tb / tot.ab) * 1000) / 1000,
    obp: (tot.ab + tot.bb + tot.hp + tot.sf) ? Math.round(((tot.h + tot.bb + tot.hp) / (tot.ab + tot.bb + tot.hp + tot.sf)) * 1000) / 1000 : null,
    basis: 'summed from the printed player rows (the page prints no team line)',
  } : null;
  return { players, team, warnings: players.length ? [] : ['no batter rows parsed'] };
}

/* ------------------------------------------------------------------ *
 * Japanese schedule with announced starters:
 * https://npb.jp/games/2026/schedule_09_detail.html
 * Observed 2026-09-03: rows are
 *   "| 9/3（木） | ヤクルト - 阪神 | 神　宮 18:00 [weather img] | | 先発：増居 先発：伊藤将 |"
 * for upcoming games (予告先発 = announced starting pitchers, home first)
 * and "勝：髙橋 敗：吉村" (winning/losing pitcher) or "分：福島 分：杉山"
 * (draw, both credited 分) for finished games. Weather appears only as an
 * icon whose filename encodes the forecast (15 = rain, 20 = rain then
 * cloudy, 10 = cloudy with rain, 08 = cloudy, 02 = sunny/cloudy, 17 = rain
 * with breaks).
 * ------------------------------------------------------------------ */
export const WEATHER_ICON = {
  '01': 'sunny', '02': 'sunny then cloudy', '03': 'sunny then rain', '08': 'cloudy',
  '10': 'cloudy with rain', '12': 'cloudy then sunny', '15': 'rain', '17': 'rain with breaks',
  '20': 'rain then cloudy', '21': 'rain then sunny',
};

/** Convert a markdown table (captured rendering) into minimal <tr><td> markup. */
export function markdownTableToHtml(md) {
  const out = [];
  for (const line of String(md || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|\s*-{3,}/.test(t)) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim()
      .replace(/\\</g, '<')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>'));
    out.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
  }
  return out.join('\n');
}

export function parseScheduleDetail(input, { season = null } = {}) {
  const rows = [];
  const warnings = [];
  if (!input) return { rows, warnings: ['empty html'] };
  const html = /<tr[\s>]/i.test(input) ? input : markdownTableToHtml(input);
  const raw = html.replace(/<br\s*\/?>/gi, ' ');
  // Work row by row on <tr>...</tr>.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = null;
  const yr = season || new Date().getUTCFullYear();
  while ((m = trRe.exec(raw))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    if (!cells.length) continue;
    const texts = cells.map((c) => stripTags(c).replace(/\s+/g, ' ').trim());
    // Column layout: 月日 | 対戦カード | 球場・開始時間 | 備考 | 予告先発・責任投手.
    // The date cell is printed once per day; later rows for the same day
    // carry an empty first cell (or omit it when rowspan is used).
    let ci = texts.length >= 5 ? 1 : 0;
    const dm = texts[0].match(/^(\d{1,2})\/(\d{1,2})/);
    if (dm) { currentDate = `${yr}-${String(dm[1]).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`; ci = 1; }
    if (!currentDate) continue;
    const card = texts[ci] || '';
    if (!card) continue;
    if (card.includes('予備日')) { warnings.push(`reserve day (予備日) ${currentDate}: ${card}`); continue; }
    const tm = card.match(/^(\S+?)\s*(?:(\d+)\s*-\s*(\d+)|-)\s*(\S+)$/);
    if (!tm) { warnings.push(`unparsed card ${currentDate}: ${card}`); continue; }
    const home = teamByName(tm[1]); const away = teamByName(tm[4]);
    if (!home || !away) { warnings.push(`unknown JA team: ${card}`); continue; }
    const venueCell = texts[ci + 1] || '';
    const vm = venueCell.match(/^(.+?)\s+(\d{1,2}:\d{2})/);
    const venueJa = vm ? vm[1].trim() : venueCell.trim();
    const weatherIcon = (cells[ci + 1] || '').match(/weather\/(\d{2})\.gif/);
    const pitchCell = texts[ci + 3] || '';
    const starters = [...pitchCell.matchAll(/先発：(\S+)/g)].map((x) => x[1]);
    const win = pitchCell.match(/勝：(\S+)/); const loss = pitchCell.match(/敗：(\S+)/);
    const draws = [...pitchCell.matchAll(/分：(\S+)/g)].map((x) => x[1]);
    const scoreUrl = (cells[ci] || '').match(/href="((?:https?:\/\/npb\.jp)?\/scores\/\d{4}\/\d{4}\/[a-z]+-[a-z]+-\d+\/)"/);
    rows.push({
      dateISO: currentDate, home: home.code, away: away.code,
      homeScore: tm[2] != null ? toInt(tm[2]) : null, awayScore: tm[3] != null ? toInt(tm[3]) : null,
      played: tm[2] != null,
      venueJa, venue: venueFromJa(venueJa), roof: roofFor(venueFromJa(venueJa) || ''),
      startLocal: vm ? vm[2] : null, startUtc: vm ? jstToUtc(currentDate, vm[2]) : null,
      weatherIcon: weatherIcon ? weatherIcon[1] : null,
      weather: weatherIcon ? (WEATHER_ICON[weatherIcon[1]] || `icon ${weatherIcon[1]}`) : null,
      announcedStarters: starters.length === 2 ? { home: starters[0], away: starters[1] } : null,
      decision: win || loss ? { winningPitcher: win?.[1] || null, losingPitcher: loss?.[1] || null } : draws.length ? { draw: draws } : null,
      scoreUrl: scoreUrl ? (scoreUrl[1].startsWith('http') ? scoreUrl[1] : `${NPB_BASE}${scoreUrl[1]}`) : null,
      league: leagueOf(home.code, away.code),
      source: 'npb-schedule-detail-ja',
    });
  }
  return { rows, warnings };
}

/* ------------------------------------------------------------------ *
 * Japanese live box score: https://npb.jp/scores/2026/0903/s-t-21/box.html
 * Published the same evening (the English BIS box lags a day). Observed
 * 2026-09-03: header "2026年9月3日（木）神　宮", "<home full name> vs <away
 * full name>   21回戦", "【試合終了】", "◇開始 18:00 ◇終了 21:14 ◇試合時間
 * 3時間14分 ◇入場者 27,930人"; then per team (AWAY first, HOME second) a
 * batting table ending in "チーム計 | AB | R | H | RBI | SB" and a pitching
 * table "| ○/●/H/S | 投手 | 投球数 | 打者 | 投球回(whole | frac) | 安打 |
 * 本塁打 | 四球 | 死球 | 三振 | 暴投 | ボーク | 失点 | 自責点 |". The first
 * pitcher row of each table is the starter.
 * ------------------------------------------------------------------ */
function toLines(input) {
  if (/<(tr|td|table|div)[\s>]/i.test(input)) return stripTags(input).split('\n');
  return String(input).split('\n').map((l) => l
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([*|<>])/g, '$1')
    .trim());
}

const ipFrom = (whole, frac) => {
  const w = toInt(whole) ?? 0;
  const f = frac === '.1' ? 1 / 3 : frac === '.2' ? 2 / 3 : 0;
  return Math.round((w + f) * 1000) / 1000;
};

export function parseJaBoxScore(input, { url = null } = {}) {
  const out = { url, dateISO: null, venueJa: null, venue: null, roof: null, status: null, gameNo: null, startLocal: null, endLocal: null, duration: null, attendance: null,
    home: null, away: null, homeScore: null, awayScore: null, homeHits: null, awayHits: null, draw: null, innings: null, homePitchers: [], awayPitchers: [], warnings: [] };
  if (!input) { out.warnings.push('empty html'); return out; }
  const lines = toLines(input);
  const text = lines.join('\n');
  const d = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日（[^）]*）\s*([^\n|]+?)\s*(?:\n|\||$)/);
  if (d) { out.dateISO = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`; out.venueJa = d[4].trim(); out.venue = venueFromJa(out.venueJa); out.roof = roofFor(out.venue || ''); }
  const vs = text.match(/([^\s】]+)\s+vs\s+([^\s]+)\s+(\d+)回戦/);
  if (vs) { out.home = teamByName(vs[1])?.code ?? null; out.away = teamByName(vs[2])?.code ?? null; out.gameNo = toInt(vs[3]); }
  const st = text.match(/【([^】]+)】\s*\n/);
  if (st) out.status = st[1];
  const meta = text.match(/開始\s*(\d{1,2}:\d{2})[^\n]*?終了\s*(\d{1,2}:\d{2})[^\n]*?試合時間\s*(\d+)時間(\d+)分[^\n]*?入場者\s*([\d,]+)/);
  if (meta) { out.startLocal = meta[1]; out.endLocal = meta[2]; out.duration = `${meta[3]}:${meta[4].padStart(2, '0')}`; out.attendance = toInt(meta[5]); }

  // Walk sections: a team heading, then batting totals, then pitching rows.
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const head = line.replace(/^#+\s*/, '').trim();
    const t = head && !head.includes('|') && !head.includes(' vs ') ? teamByName(head) : null;
    if (t && head.length <= 20) { cur = { code: t.code, ab: null, r: null, h: null, pitchers: [], innings: 0 }; sections.push(cur); continue; }
    if (!cur || !line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    if (cells.length >= 8 && cells[0] === '' && cells[1] === '' && cells[2] === 'チーム計') { cur.ab = toInt(cells[3]); cur.r = toInt(cells[4]); cur.h = toInt(cells[5]); continue; }
    if (cells[1] === '守備' && cells[2] === '選手') { cur.innings = Math.max(cur.innings, cells.length - 8); continue; }
    if (cells[1] === '投手' || cells[1] === 'チーム計' || cells.length < 14) continue;
    const name = cells[1];
    if (!name || /^-+$/.test(cells[2])) continue;
    const tail = cells.slice(-9);
    if (!tail.every((c) => /^\d+$/.test(c))) continue;
    const mid = cells.slice(4, cells.length - 9);
    const ipWhole = mid.find((c) => /^\d+$/.test(c)) ?? null;
    const ipFrac = mid.find((c) => /^\.[12]$/.test(c)) ?? null;
    cur.pitchers.push({
      name, decoration: cells[0] || null, role: cur.pitchers.length === 0 ? 'starter' : 'relief',
      pitches: toInt(cells[2]), bf: toInt(cells[3]), ip: ipFrom(ipWhole, ipFrac),
      h: toInt(tail[0]), hr: toInt(tail[1]), bb: toInt(tail[2]), hb: toInt(tail[3]), so: toInt(tail[4]), wp: toInt(tail[5]), bk: toInt(tail[6]), r: toInt(tail[7]), er: toInt(tail[8]),
    });
  }
  const homeSec = sections.find((x) => x.code === out.home);
  const awaySec = sections.find((x) => x.code === out.away);
  if (homeSec && awaySec) {
    out.homeScore = homeSec.r; out.awayScore = awaySec.r; out.homeHits = homeSec.h; out.awayHits = awaySec.h;
    out.homePitchers = homeSec.pitchers; out.awayPitchers = awaySec.pitchers;
    out.innings = Math.max(homeSec.innings, awaySec.innings) || null;
    out.draw = out.homeScore != null && out.homeScore === out.awayScore;
  } else {
    out.warnings.push(`team sections not resolved (${sections.map((x) => x.code).join(',')})`);
  }
  if (!out.homePitchers.length && !out.awayPitchers.length) out.warnings.push('no pitching lines parsed');
  return out;
}
