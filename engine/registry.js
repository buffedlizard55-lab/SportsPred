/**
 * SportsPred — Sport / League registry (pure data + helpers, no I/O).
 *
 * WHAT THIS FILE IS
 * -----------------
 * A catalogue that ties three things together for every sport:
 *
 *   1. the OLBG betting-tips sport index (the "slate" the brief asks for),
 *   2. the ESPN public, key-less JSON feed that supplies fixtures / results /
 *      standings / prices for that sport (where one exists),
 *   3. an honest statement of what is NOT available.
 *
 * HONESTY RULES (enforced by tests)
 * ---------------------------------
 *  - `olbgId` values are transcribed from https://www.olbg.com/sitemap-betting-tips.xml
 *    (read 2026-09-02). Nothing here is guessed.
 *  - A sport with no key-less statistics feed gets `espn: null`. It is still
 *    listed, still linked to OLBG for manual review, and it NEVER receives a
 *    generated prediction. `predictable` is false for those sports.
 *  - League slugs in `candidateLeagues` are *candidates*. They are proven at
 *    build time by scripts/build_league_registry.mjs, which calls each
 *    scoreboard endpoint and records the HTTP status. The site prefers
 *    data/leagues.json (machine-verified) and only falls back to this file,
 *    flagged as unverified, if that artifact is missing.
 */

/** Source of the OLBG sport ids below. */
export const OLBG_SITEMAP_URL = 'https://www.olbg.com/sitemap-betting-tips.xml';
export const OLBG_SITEMAP_READ_UTC = '2026-09-02';

export const REGISTRY_VERSION = '2.0.0';

const olbgUrl = (slug, id) => `https://www.olbg.com/betting-tips/${slug}/${id}`;

/**
 * ESPN "site" API scoreboard path builder.
 * Verified shape: https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
 */
export const ESPN_SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
export const ESPN_CORE_BASE = 'https://sports.core.api.espn.com/v2/sports';

export function scoreboardUrl(espnSport, leagueSlug, dates) {
  const q = dates ? `?dates=${dates}` : '';
  return `${ESPN_SITE_BASE}/${espnSport}/${leagueSlug}/scoreboard${q}`;
}

export function standingsUrl(espnSport, leagueSlug, season) {
  const q = season ? `?season=${season}` : '';
  return `https://site.api.espn.com/apis/v2/sports/${espnSport}/${leagueSlug}/standings${q}`;
}

/**
 * The 20 sports OLBG publishes a betting-tips index for, plus the two that only
 * have tipster pages. Transcribed from the sitemap on 2026-09-02.
 */
export const SPORTS = [
  {
    key: 'football',
    name: 'Football',
    short: 'Football',
    icon: '⚽',
    olbgSlug: 'Football',
    olbgId: 1,
    espnSport: 'soccer',
    threeWay: true,
    predictable: true,
    unit: 'goals',
    officialLinks: [
      { label: 'ESPN Soccer Scoreboard', url: 'https://www.espn.com/soccer/scoreboard' },
      { label: 'OLBG Football Tips', url: olbgUrl('Football', 1) },
    ],
    candidateLeagues: [
      { slug: 'eng.1', name: 'English Premier League' },
      { slug: 'eng.2', name: 'EFL Championship' },
      { slug: 'eng.3', name: 'EFL League One' },
      { slug: 'eng.4', name: 'EFL League Two' },
      { slug: 'eng.5', name: 'National League' },
      { slug: 'eng.fa', name: 'Emirates FA Cup' },
      { slug: 'eng.league_cup', name: 'Carabao Cup' },
      { slug: 'esp.1', name: 'Spanish LALIGA' },
      { slug: 'esp.2', name: 'Spanish LALIGA 2' },
      { slug: 'ger.1', name: 'German Bundesliga' },
      { slug: 'ger.2', name: 'German 2. Bundesliga' },
      { slug: 'ita.1', name: 'Italian Serie A' },
      { slug: 'ita.2', name: 'Italian Serie B' },
      { slug: 'fra.1', name: 'French Ligue 1' },
      { slug: 'fra.2', name: 'French Ligue 2' },
      { slug: 'ned.1', name: 'Dutch Eredivisie' },
      { slug: 'por.1', name: 'Portuguese Liga' },
      { slug: 'sco.1', name: 'Scottish Premiership' },
      { slug: 'sco.2', name: 'Scottish Championship' },
      { slug: 'tur.1', name: 'Turkish Super Lig' },
      { slug: 'bel.1', name: 'Belgian Pro League' },
      { slug: 'gre.1', name: 'Greek Super League' },
      { slug: 'aut.1', name: 'Austrian Bundesliga' },
      { slug: 'sui.1', name: 'Swiss Super League' },
      { slug: 'den.1', name: 'Danish Superliga' },
      { slug: 'nor.1', name: 'Norwegian Eliteserien' },
      { slug: 'swe.1', name: 'Swedish Allsvenskan' },
      { slug: 'usa.1', name: 'Major League Soccer' },
      { slug: 'usa.nwsl', name: 'NWSL' },
      { slug: 'mex.1', name: 'Mexican Liga BBVA MX' },
      { slug: 'bra.1', name: 'Brazilian Serie A' },
      { slug: 'arg.1', name: 'Argentine Liga Profesional' },
      { slug: 'jpn.1', name: 'Japanese J.League' },
      { slug: 'chn.1', name: 'Chinese Super League' },
      { slug: 'aus.1', name: 'Australian A-League Men' },
      { slug: 'ksa.1', name: 'Saudi Pro League' },
      { slug: 'uefa.champions', name: 'UEFA Champions League' },
      { slug: 'uefa.europa', name: 'UEFA Europa League' },
      { slug: 'uefa.europa.conf', name: 'UEFA Conference League' },
      { slug: 'uefa.nations', name: 'UEFA Nations League' },
      { slug: 'conmebol.libertadores', name: 'CONMEBOL Libertadores' },
      { slug: 'conmebol.sudamericana', name: 'CONMEBOL Sudamericana' },
      { slug: 'concacaf.champions_cup', name: 'CONCACAF Champions Cup' },
      { slug: 'fifa.world', name: 'FIFA World Cup' },
      { slug: 'fifa.worldq.uefa', name: 'FIFA World Cup Qualifying - UEFA' },
      { slug: 'fifa.friendly', name: 'International Friendly' },
      { slug: 'club.friendly', name: 'Club Friendly' },
    ],
  },
  {
    key: 'american-football',
    name: 'American Football',
    short: 'NFL / NCAA',
    icon: '🏈',
    olbgSlug: 'American_Football',
    olbgId: 11,
    espnSport: 'football',
    threeWay: false,
    predictable: true,
    unit: 'points',
    officialLinks: [
      { label: 'ESPN NFL Scoreboard', url: 'https://www.espn.com/nfl/scoreboard' },
      { label: 'OLBG American Football Tips', url: olbgUrl('American_Football', 11) },
    ],
    candidateLeagues: [
      { slug: 'nfl', name: 'National Football League' },
      { slug: 'college-football', name: 'NCAA Football' },
      { slug: 'ufl', name: 'United Football League' },
    ],
    notes: [
      'OLBG carries CFL (Canadian Football League) rows. ESPN publishes no key-less CFL scoreboard, so CFL events appear as OLBG market rows only and are never predicted.',
    ],
  },
  {
    key: 'basketball',
    name: 'Basketball',
    short: 'NBA / WNBA / NCAA',
    promptVersion: 'NBA v5.0 review',
    rulesetVersion: 'universal-v1.0',
    icon: '🏀',
    olbgSlug: 'Basketball',
    olbgId: 4,
    espnSport: 'basketball',
    threeWay: false,
    predictable: true,
    unit: 'points',
    officialLinks: [
      { label: 'ESPN NBA Scoreboard', url: 'https://www.espn.com/nba/scoreboard' },
      { label: 'NBA Official Stats', url: 'https://www.nba.com/stats' },
      { label: 'NBA Official Injury Report', url: 'https://official.nba.com/nba-injury-report-2025-26-season/' },
      { label: 'OLBG Basketball Tips', url: olbgUrl('Basketball', 4) },
    ],
    candidateLeagues: [
      { slug: 'nba', name: 'NBA' },
      { slug: 'wnba', name: 'WNBA' },
      { slug: 'mens-college-basketball', name: "NCAA Men's Basketball" },
      { slug: 'womens-college-basketball', name: "NCAA Women's Basketball" },
      { slug: 'nba-development', name: 'NBA G League' },
    ],
    notes: [
      'Basketball is currently served by the universal sourced engine. The NBA v5 review is documented in docs/NBA_PROMPT_REVIEW.md. Unsupported inputs such as two-source closing odds, date-specific player availability, ATS history, pace, and head-to-head are never inferred; affected markets are withheld rather than fabricated.',
    ],
  },
  {
    key: 'baseball',
    name: 'Baseball',
    short: 'MLB',
    icon: '⚾',
    olbgSlug: 'Baseball',
    olbgId: 12,
    espnSport: 'baseball',
    threeWay: false,
    predictable: true,
    unit: 'runs',
    specialistEngine: 'baseball',
    page: 'baseball.html',
    subPages: [
      { key: 'mlb', label: 'MLB', href: 'baseball.html', name: 'Major League Baseball' },
      { key: 'npb', label: 'NPB', href: 'npb.html', name: 'Nippon Professional Baseball' },
    ],
    officialLinks: [
      { label: 'MLB StatsAPI Schedule', url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1' },
      { label: 'MLB Standings', url: 'https://www.mlb.com/standings' },
      { label: 'ESPN MLB Scoreboard', url: 'https://www.espn.com/mlb/scoreboard' },
      { label: 'OLBG Baseball Tips', url: olbgUrl('Baseball', 12) },
    ],
    candidateLeagues: [
      { slug: 'mlb', name: 'Major League Baseball' },
      // NPB is deliberately NOT a candidate league: candidateLeagues are ESPN
      // slugs verified live by scripts/build_league_registry.mjs, and ESPN has
      // no NPB league (baseball/npb → HTTP 400). NPB is served by npb.html from
      // npb.jp official pages instead — see subPages below.
      { slug: 'college-baseball', name: 'NCAA Baseball' },
    ],
    notes: [
      'Baseball runs on its own specialist page, scored by the BASEBALL PREDICTION MASTER PROMPT v1.0: three tips per match (WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL) with a confidence score on each. Fixtures, results, standings, team batting/pitching stats and probable starters come from the official MLB StatsAPI; the ESPN scoreboard supplies venue/weather context; the OLBG slate is display-and-join context and never supplies a price.',
      'No key-less moneyline / run line / total feed exists for MLB (ESPN publishes no baseball odds block; OLBG publishes tipster consensus, not prices), so the odds factor is recorded as missing rather than guessed and the price-dependent Step 3 gates resolve to SKIP where the prompt requires a price. Bullpen ERA rank, bullpen usage, and wind direction/speed are likewise recorded as missing.',
      'Nippon Professional Baseball has its own sub-page (npb.html) scored by the NPB BASEBALL PREDICTION MASTER PROMPT v1.0, which adds an independent draw likelihood assessment (regular-season games end level after twelve innings), form-based starter bands, same-league versus interleague head-to-head and rain-season weather handling. Every input comes from npb.jp official pages.',
    ],
  },
  {
    key: 'ice-hockey',
    name: 'Ice Hockey',
    short: 'NHL',
    icon: '🏒',
    olbgSlug: 'Ice_Hockey',
    olbgId: 13,
    espnSport: 'hockey',
    threeWay: false,
    predictable: true,
    unit: 'goals',
    specialistEngine: 'ice-hockey',
    page: 'ice-hockey.html',
    officialLinks: [
      { label: 'NHL Official Scoreboard', url: 'https://www.nhl.com/scores' },
      { label: 'NHL Standings', url: 'https://www.nhl.com/standings' },
      { label: 'NHL Official API', url: 'https://api-web.nhle.com/v1/scoreboard/now' },
      { label: 'ESPN NHL Scoreboard', url: 'https://www.espn.com/nhl/scoreboard' },
      { label: 'ESPN NHL Injuries', url: 'https://www.espn.com/nhl/injuries' },
      { label: 'OLBG Ice Hockey Tips', url: olbgUrl('Ice_Hockey', 13) },
    ],
    candidateLeagues: [
      { slug: 'nhl', name: 'National Hockey League' },
      { slug: 'mens-college-hockey', name: "NCAA Men's Ice Hockey" },
    ],
    notes: [
      'Ice Hockey runs on its own specialist page, scored by the ICE HOCKEY PREDICTION MASTER PROMPT v1.0: three tips per match (OUTRIGHT WINNER, PUCK LINE, GAME TOTAL) with a subagent risk layer in front of them. Fixtures, standings and goaltending come from the official NHL API; prices come from the ESPN scoreboard odds block (one book, attributed); the OLBG slate is display-and-join context and never supplies a price.',
      'Three prompt inputs have no free source and are recorded as missing rather than estimated: a confirmed starting goaltender, special teams percentages, and shots for/against per game. With a goaltender unconfirmed the risk layer vetoes the play, so a data-poor card publishes SKIP with its reason instead of a guess.',
    ],
  },
  {
    key: 'rugby-league',
    name: 'Rugby League',
    short: 'NRL / Super League',
    icon: '🏉',
    olbgSlug: 'Rugby_League',
    olbgId: 10,
    espnSport: null,
    threeWay: false,
    predictable: true,
    unit: 'points',
    specialistEngine: 'rugby-league',
    page: 'rugby-league.html',
    officialLinks: [
      { label: 'NRL Official Ladder', url: 'https://www.nrl.com/ladder/' },
      { label: 'Super League Standings', url: 'https://www.superleague.co.uk/standings' },
      { label: 'ESPN Rugby League', url: 'https://www.espn.com/rugby-league/' },
      { label: 'OLBG Rugby League Tips', url: olbgUrl('Rugby_League', 10) },
    ],
    candidateLeagues: [],
    notes: ['Rugby League runs on the committed, source-tagged OLBG market slate plus the official NRL and Super League tables, scored by the RUGBY LEAGUE PREDICTION MASTER PROMPT v1.0. No free key-less price feed is used; odds are derived from the official ladders and are cross-referenced where available. Predictions are written as three tips per match (WIN MATCH, HANDICAP, GAME TOTAL) with the league-specific weightings and thresholds documented in docs/RUGBY_LEAGUE_PROMPT_REVIEW.md.'],
  },
  {
    key: 'rugby-union',
    name: 'Rugby Union',
    short: 'Union',
    icon: '🏉',
    olbgSlug: 'Rugby_Union',
    olbgId: 9,
    espnSport: 'rugby',
    threeWay: false,
    predictable: true,
    unit: 'points',
    officialLinks: [
      { label: 'ESPN Rugby', url: 'https://www.espn.co.uk/rugby/' },
      { label: 'OLBG Rugby Union Tips', url: olbgUrl('Rugby_Union', 9) },
    ],
    candidateLeagues: [],
    discover: { core: 'rugby' },
  },
  {
    key: 'tennis',
    name: 'Tennis',
    short: 'ATP / WTA',
    icon: '🎾',
    olbgSlug: 'Tennis',
    olbgId: 3,
    espnSport: 'tennis',
    threeWay: false,
    predictable: true,
    unit: 'sets',
    specialistEngine: 'tennis',
    officialLinks: [
      { label: 'ESPN Tennis Scoreboard', url: 'https://www.espn.com/tennis/scoreboard' },
      { label: 'OLBG Tennis Tips', url: olbgUrl('Tennis', 3) },
    ],
    candidateLeagues: [
      { slug: 'atp', name: 'ATP Tour' },
      { slug: 'wta', name: 'WTA Tour' },
    ],
  },
  {
    key: 'cricket',
    name: 'Cricket',
    short: 'Cricket',
    icon: '🏏',
    olbgSlug: 'Cricket',
    olbgId: 7,
    espnSport: 'cricket',
    threeWay: false,
    predictable: true,
    unit: 'runs',
    specialistEngine: 'cricket',
    officialLinks: [
      { label: 'ESPNcricinfo Live Scores', url: 'https://www.espncricinfo.com/live-cricket-score' },
      { label: 'OLBG Cricket Tips', url: olbgUrl('Cricket', 7) },
    ],
    candidateLeagues: [],
    scorepanel: 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel',
  },
  {
    key: 'motor-racing',
    name: 'Motor Racing',
    short: 'F1',
    icon: '🏎️',
    olbgSlug: 'Motor_Racing',
    olbgId: 14,
    espnSport: 'racing',
    threeWay: false,
    predictable: true,
    unit: 'positions',
    specialistEngine: 'f1',
    officialLinks: [
      { label: 'ESPN F1 Results', url: 'https://www.espn.com/f1/results' },
      { label: 'OLBG Motor Racing Tips', url: olbgUrl('Motor_Racing', 14) },
    ],
    candidateLeagues: [{ slug: 'f1', name: 'Formula 1' }],
  },
  {
    key: 'handball',
    name: 'Handball',
    short: 'Handball',
    icon: '🤾',
    olbgSlug: 'Handball',
    olbgId: 20,
    espnSport: null,
    threeWay: true,
    predictable: true,
    unit: 'goals',
    specialistEngine: 'handball',
    officialLinks: [
      { label: 'OLBG Handball Tips', url: olbgUrl('Handball', 20) },
      { label: 'DAIKIN Handball-Bundesliga', url: 'https://www.daikin-hbl.de/de/hbl/tabelle' },
      { label: 'Tophaandbold (Denmark)', url: 'https://tophaandbold.dk/herreligaen' },
    ],
    candidateLeagues: [],
    notes: ['ESPN publishes no handball feed. Handball runs on the committed, source-tagged competition dataset and the specialist handball engine.'],
  },
  {
    key: 'volleyball',
    name: 'Volleyball',
    short: 'Volleyball',
    icon: '🏐',
    olbgSlug: 'Volleyball',
    olbgId: 21,
    espnSport: 'volleyball',
    threeWay: false,
    predictable: true,
    unit: 'sets',
    specialistEngine: 'volleyball',
    page: 'volleyball.html',
    officialLinks: [
      { label: 'ESPN Women\'s College Volleyball Scoreboard', url: 'https://www.espn.com/college-sports/volleyball/scoreboard' },
      { label: 'OLBG Volleyball Tips', url: olbgUrl('Volleyball', 21) },
      { label: 'CEV EuroVolley', url: 'https://www.cev.eu/' },
      { label: 'FIVB', url: 'https://www.fivb.com/' },
    ],
    candidateLeagues: [
      { slug: 'womens-college-volleyball', name: "NCAA Women's Volleyball" },
      { slug: 'mens-college-volleyball', name: "NCAA Men's Volleyball" },
    ],
    discover: { core: 'volleyball' },
    notes: [
      'ESPN volleyball coverage is college-only. FIVB/CEV internationals that OLBG prices (EuroVolley Women 2026 quarter-finals on 3 September) are scored only from the committed CEV tape — never from NCAA form.',
      'The specialist engine writes WIN MATCH and SET SCORE only. OLBG Total Points and Points Handicap are listed for review and never scored.',
      'No free multi-book moneyline exists (IR-VB-02), so live confidence cannot read HIGH.',
    ],
  },
  {
    key: 'mma',
    name: 'Boxing & MMA',
    short: 'Boxing / MMA',
    icon: '🥊',
    olbgSlug: 'Boxing',
    olbgId: 16,
    espnSport: 'mma',
    threeWay: false,
    predictable: false,
    unit: null,
    officialLinks: [
      { label: 'OLBG Boxing Tips', url: olbgUrl('Boxing', 16) },
      { label: 'ESPN MMA Schedule', url: 'https://www.espn.com/mma/schedule' },
      { label: 'BoxRec', url: 'https://boxrec.com/' },
    ],
    candidateLeagues: [{ slug: 'ufc', name: 'UFC' }],
    notes: ['ESPN exposes UFC fight cards but no key-less structured fighter-form feed. Bouts are listed for review; no prediction is generated.'],
  },
  {
    key: 'golf',
    name: 'Golf',
    short: 'Golf',
    icon: '⛳',
    olbgSlug: 'Golf',
    olbgId: 5,
    espnSport: 'golf',
    threeWay: false,
    predictable: true,
    unit: 'strokes',
    specialistEngine: 'golf',
    page: 'golf.html',
    officialLinks: [
      { label: 'ESPN Golf Leaderboard', url: 'https://www.espn.com/golf/leaderboard' },
      { label: 'ESPN Golf Schedule', url: 'https://www.espn.com/golf/schedule' },
      { label: 'Official World Golf Ranking', url: 'https://www.owgr.com/current-world-ranking' },
      { label: 'PGA TOUR Stats (strokes gained)', url: 'https://www.pgatour.com/stats' },
      { label: 'OLBG Golf Tips', url: olbgUrl('Golf', 5) },
    ],
    candidateLeagues: [
      { slug: 'pga', name: 'PGA Tour' },
      { slug: 'eur', name: 'DP World Tour' },
      { slug: 'lpga', name: 'LPGA Tour' },
      { slug: 'champions-tour', name: 'PGA Tour Champions' },
    ],
    notes: ['Golf markets are outrights across a full field, so the two-competitor universal engine does not apply. The specialist golf engine (GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0) scores the PGA TOUR and DP World Tour fields for outright, top six, first round leader and the three regional markets; the LPGA and PGA TOUR Champions are shown for leaderboards and calendars only.'],
  },
  {
    key: 'gaelic-football',
    name: 'Gaelic Football',
    short: 'GAA',
    icon: '🇮🇪',
    olbgSlug: 'Gaelic_Football',
    olbgId: 25,
    espnSport: null,
    threeWay: true,
    predictable: false,
    unit: 'points',
    officialLinks: [
      { label: 'OLBG Gaelic Football Tips', url: olbgUrl('Gaelic_Football', 25) },
      { label: 'GAA Official Fixtures', url: 'https://www.gaa.ie/fixtures-results' },
    ],
    candidateLeagues: [],
    notes: ['No key-less structured GAA feed. Market rows only.'],
  },
  {
    key: 'darts',
    name: 'Darts',
    short: 'Darts',
    icon: '🎯',
    olbgSlug: 'Darts',
    olbgId: 15,
    espnSport: null,
    threeWay: false,
    predictable: true,
    unit: 'legs',
    specialistEngine: 'darts',
    page: 'darts.html',
    officialLinks: [
      { label: 'OLBG Darts Tips', url: olbgUrl('Darts', 15) },
      { label: 'PDC Order of Merit', url: 'https://www.pdc.tv/players' },
      { label: 'PDC official site', url: 'https://www.pdc.tv/' },
      { label: 'dartsrankings.com Order of Merit', url: 'https://www.dartsrankings.com/' },
    ],
    candidateLeagues: [
      { slug: 'hungarian-darts-trophy', name: 'Hungarian Darts Trophy' },
      { slug: 'czech-darts-open', name: 'Czech Darts Open' },
      { slug: 'world-series-finals', name: 'World Series of Darts Finals' },
    ],
    notes: ['Darts runs on the OLBG market/slate feed plus a committed, source-tagged European Tour results tape (Wikipedia match reports, never reconstructed scores) and the public PDC Order of Merit snapshot from dartsrankings.com. There is no free key-less price feed, so the odds component is scored as missing and Step 3 returns SKIP for live cards (confidence capped); see docs/DARTS_IRREGULARITIES.md. Predictions are written by the DARTS PREDICTION MASTER PROMPT v1.0 writer. Czech Open pairings are never invented (IR-DARTS-06).'],
  },
  {
    key: 'snooker',
    name: 'Snooker',
    short: 'Snooker',
    icon: '🎱',
    olbgSlug: 'Snooker',
    olbgId: 8,
    espnSport: null,
    threeWay: false,
    predictable: true,
    unit: 'frames',
    specialistEngine: 'snooker',
    page: 'snooker.html',
    officialLinks: [
      { label: 'OLBG Snooker Tips', url: olbgUrl('Snooker', 8) },
      { label: 'World Snooker Tour', url: 'https://www.wst.tv/' },
      { label: 'WST Rankings', url: 'https://www.wst.tv/rankings' },
      { label: 'snooker.org Results', url: 'https://www.snooker.org/res/index.asp' },
    ],
    candidateLeagues: [
      { slug: 'british-open', name: 'Unibet British Open' },
      { slug: 'china-open', name: 'China Open' },
      { slug: 'wuhan-open', name: 'Wuhan Open' },
      { slug: 'shanghai-masters', name: 'Shanghai Masters' },
    ],
    notes: ['Snooker runs on the OLBG market/slate feed plus the public snooker.org results pages and the official WST ranking table. There is no free key-less price feed, so the odds component is scored as missing and Step 3 returns SKIP for live cards (confidence capped); see docs/SNOOKER_IRREGULARITIES.md. Predictions are written by the SNOOKER PREDICTION MASTER PROMPT v3.0 writer.'],
  },
  {
    key: 'horse-racing',
    name: 'Horse Racing',
    short: 'Racing',
    icon: '🐎',
    olbgSlug: 'Horse_Racing',
    olbgId: 2,
    espnSport: null,
    threeWay: false,
    predictable: false,
    unit: null,
    officialLinks: [
      { label: 'OLBG Horse Racing Tips', url: olbgUrl('Horse_Racing', 2) },
      { label: 'BHA Racing Admin', url: 'https://www.britishhorseracing.com/racing/fixtures/' },
    ],
    candidateLeagues: [],
    notes: ['Field-size, going and form data are not available key-less. Racecards are listed from OLBG for manual review only.'],
  },
  {
    key: 'greyhounds',
    name: 'Greyhounds',
    short: 'Greyhounds',
    icon: '🐕',
    olbgSlug: 'Greyhounds',
    olbgId: 28,
    espnSport: null,
    threeWay: false,
    predictable: true,
    unit: 'positions',
    specialistEngine: 'greyhounds',
    page: 'greyhounds.html',
    officialLinks: [
      { label: 'GBGB Results & Database', url: 'https://www.gbgb.org.uk/racing/results/' },
      { label: 'GBGB Results API', url: 'https://api.gbgb.org.uk/api/results?page=1&itemsPerPage=1&race_type=race' },
      { label: 'Sporting Life Greyhound Racecards', url: 'https://www.sportinglife.com/greyhounds/racecards' },
      { label: 'OLBG Greyhound Tips', url: olbgUrl('Greyhounds', 28) },
    ],
    candidateLeagues: [],
    notes: ['Greyhounds run on the official GBGB results API (meetings, draws, results and per-dog histories) plus the Sporting Life racecard index, scored by the GREYHOUND RACING PREDICTION MASTER PROMPT v1.0. Live win odds have no free key-less feed, so the odds component is scored as missing and live confidence is capped at MEDIUM; see docs/GREYHOUND_IRREGULARITIES.md.'],
  },
  {
    key: 'cycling',
    name: 'Cycling',
    short: 'Cycling',
    icon: '🚴',
    olbgSlug: 'Cycling',
    olbgId: 17,
    espnSport: null,
    threeWay: false,
    predictable: false,
    unit: null,
    officialLinks: [
      { label: 'OLBG Cycling Tips', url: olbgUrl('Cycling', 17) },
      { label: 'UCI Calendar', url: 'https://www.uci.org/calendar/road/1Kcyi0AGqI9dpRTKULgTn' },
    ],
    candidateLeagues: [],
    notes: ['Market rows only.'],
  },
];

/** OLBG sports that exist only as tipster pages (no betting-tips index in the sitemap). */
export const OLBG_TIPSTER_ONLY = [
  { name: 'eSports', olbgId: 23, url: 'https://www.olbg.com/best-tipsters/eSports/23' },
  { name: 'Aussie Rules', olbgId: 22, url: 'https://www.olbg.com/best-tipsters/Aussie_Rules/22' },
];

export function getSport(key) {
  return SPORTS.find((s) => s.key === key) || null;
}

export function predictableSports() {
  return SPORTS.filter((s) => s.predictable);
}

export function olbgIndexUrl(sport) {
  if (!sport) return null;
  return olbgUrl(sport.olbgSlug, sport.olbgId);
}

/** Every OLBG sport index URL, for the markets directory page. */
export function allOlbgIndexes() {
  return SPORTS.map((s) => ({
    key: s.key,
    name: s.name,
    icon: s.icon,
    olbgId: s.olbgId,
    url: olbgIndexUrl(s),
    predictable: s.predictable,
  }));
}
