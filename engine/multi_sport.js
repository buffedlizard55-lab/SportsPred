/**
 * SportsPred — Multi-Sport Coordinator & Registry.
 *
 * Supports Handball (HANDBALL PREDICTION MASTER PROMPT v1.0) and Tennis
 * with clean sport separation, unified scoreboard interface, calendar navigation,
 * and prediction generation.
 */

export const SUPPORTED_SPORTS = [
  {
    id: 'cricket',
    name: 'Cricket',
    promptVersion: 'v1.0',
    rulesetVersion: 'v1.0',
    icon: '🏏',
    description: 'T20, ODI and Test prediction engine — Win Match, Man of the Match & Top Team Batsman',
    markets: ['WIN MATCH', 'MAN OF THE MATCH', 'TOP TEAM 1 BATSMAN', 'TOP TEAM 2 BATSMAN'],
    dataFile: 'data/cricket_matches.json',
    slateFile: 'data/cricket_slate.json',
    provenanceFile: 'data/cricket_provenance.json',
    predictionsFile: 'data/cricket_predictions.json',
    sourceUrl: 'https://www.olbg.com/betting-tips/Cricket/16',
    liveSourceUrl: 'https://www.espncricinfo.com/live-cricket-score',
    leagues: [
      'All Competitions',
      'International T20 / T20I',
      'ODI / One-Day',
      'Test & First-Class',
      'Caribbean Premier League',
      'European T20 Premier League',
      'The Hundred',
      'T20 Blast',
      'County Championship',
      'Women Internationals',
    ],
  },
  {
    id: 'handball',
    name: 'Handball',
    promptVersion: 'v1.0',
    rulesetVersion: 'v1.0',
    icon: '🤾',
    description: 'European leagues, HBL, Handboldligaen, LNH, and REMA 1000-ligaen prediction engine',
    markets: ['WIN MATCH', 'POINT SPREAD', 'GAME TOTAL'],
    dataFile: 'data/handball_matches.json',
    slateFile: 'data/handball_slate.json',
    teamsFile: 'data/handball_teams.json',
    provenanceFile: 'data/handball_provenance.json',
    predictionsFile: 'data/handball_predictions.json',
    leagues: [
      'All Leagues',
      'German Handball-Bundesliga',
      'Danish Handboldligaen',
      'French LNH Starligue',
      'Norwegian REMA 1000-ligaen Men',
      'Norwegian REMA 1000-ligaen Women',
      'Danish Kvindeligaen',
      'EHF Champions League',
    ],
  },
  {
    id: 'tennis',
    name: 'Tennis',
    promptVersion: 'v1.0',
    rulesetVersion: 'v1.1',
    icon: '🎾',
    description: 'ATP/WTA singles tour scoreboard and three-market prediction engine',
    markets: ['Win Match', 'First Set Winner', 'Games Handicap'],
    dataFile: 'data/slate.json',
    slateFile: 'data/slate.json',
    surfacesFile: 'data/surfaces.json',
    provenanceFile: 'data/provenance.json',
    predictionsFile: 'data/predictions.json',
    leagues: ['All Tours', 'ATP', 'WTA', 'Grand Slam', 'Challenger', 'ITF'],
  },
];

export function getSportConfig(sportId) {
  return SUPPORTED_SPORTS.find((s) => s.id === sportId) || SUPPORTED_SPORTS[0];
}
