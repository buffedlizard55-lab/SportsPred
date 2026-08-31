/**
 * SportsPred — historical feature builder + backtest grader.
 *
 * Turns the Sackmann-format match CSVs (the canonical free tennis dataset, now
 * mirrored — see docs/SOURCES.md) into engine match objects using only
 * information that was knowable BEFORE each match. Nothing here is a forecast:
 * every feature is computed from matches that strictly precede the match being
 * scored, so a backtest run on this builder is a genuine walk-forward test.
 *
 * RULES OF THIS FILE
 *  - Pure functions. No I/O, no network, no clock, no randomness.
 *  - A feature that cannot be computed is left null; the engine then records it
 *    as missing. It is never estimated.
 *  - Ordering: a prior match is one with (tourney_date, match_num) strictly
 *    before the scored match. tourney_date is the tournament start date, so two
 *    matches inside the same event keep their draw order via match_num. This is
 *    a documented approximation (see docs/IRREGULARITIES.md IR-15).
 */

export const SACKMANN = {
  mirrorRepo: 'Kadantte/tennis_atp',
  // Files used for the ATP walk-forward backtest.
  matchFiles: ['atp_matches_2024.csv', 'atp_matches_2025.csv', 'atp_matches_2026.csv'],
  // tourney_level values we can map confidently to the engine's stage factor.
  // Davis Cup ('D'), Olympics ('O') and Tour Finals ('F') have non-standard
  // draws and are excluded rather than mis-scored.
  includedLevels: new Set(['G', 'M', 'A']),
};

const LEVEL_MAP = { G: 'GS', M: 'M1000', A: 'A' };

const SURFACE_MAP = { Hard: 'hard', Clay: 'clay', Grass: 'grass', Carpet: 'carpet' };

/* ------------------------------------------------------------------ *
 * CSV parsing (minimal, stdlib-only, quote-aware)
 * ------------------------------------------------------------------ */

/**
 * Parse Sackmann CSV text into an array of row objects. Quote-aware so a field
 * containing a comma (rare in this dataset, but present in some tourney names)
 * does not shift columns.
 */
export function parseCSV(text) {
  const rows = [];
  const lines = String(text ?? '').split(/\r?\n/);
  if (!lines.length) return rows;
  const header = splitLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const vals = splitLine(line);
    const row = {};
    header.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function splitLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ *
 * Score parsing
 * ------------------------------------------------------------------ */

/**
 * Split a Sackmann score string into per-set game tallies for the winner and
 * loser. Handles "6-4 6-3", "6-4 6-7(5) 6-3", "7-6(4) 6-2", retirements
 * ("6-4 3-0 RET") and walkovers ("W/O").
 * @returns {{winner:number[], loser:number[], retired:boolean, walkover:boolean}}
 */
export function parseSets(score) {
  const sets = { winner: [], loser: [], retired: false, walkover: false };
  const text = String(score ?? '').trim();
  if (!text || /^W\/O$/i.test(text)) {
    sets.walkover = true;
    return sets;
  }
  for (const token of text.split(/\s+/)) {
    if (/RET/i.test(token)) { sets.retired = true; continue; }
    if (/W\/O/i.test(token)) { sets.walkover = true; continue; }
    const m = token.match(/^(\d+)-(\d+)/);
    if (!m) continue;
    const w = parseInt(m[1], 10);
    const l = parseInt(m[2], 10);
    // A tiebreak in this set does not change the game winner.
    sets.winner.push(w);
    sets.loser.push(l);
  }
  return sets;
}

/** Did the winner win the first set of a parsed score? null if not determinable. */
export function winnerTookFirstSet(parsed) {
  if (parsed.walkover || parsed.winner.length === 0) return null;
  return parsed.winner[0] > parsed.loser[0];
}

/** Did the winner win in straight sets? null if not determinable. */
export function winnerStraightSets(parsed, bestOf) {
  if (parsed.walkover || parsed.winner.length === 0) return null;
  const needed = bestOf === 5 ? 3 : 2;
  if (parsed.winner.length < needed) return null;
  return parsed.loser.slice(0, needed).every((g, i) => g < parsed.winner[i]);
}

/* ------------------------------------------------------------------ *
 * Rolling feature builder
 * ------------------------------------------------------------------ */

function key(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Build the engine match objects for a chronological list of Sackmann rows.
 *
 * @param {Array<object>} rows  CSV rows with tourney_date, match_num, surface,
 *   tourney_level, best_of, score, winner_name, loser_name, winner_rank,
 *   loser_rank, winner_seed, loser_seed, w_1stIn, w_svpt, w_ace, l_1stIn, l_svpt, l_ace
 * @returns {{matches:Array, excluded:Array}} matches in the same order, with
 *   per-match features attached under `features`.
 */
export function buildFeatures(rows) {
  const ordered = rows
    .map((r) => ({ ...r }))
    .sort((a, b) =>
      (a.tourney_date || '') < (b.tourney_date || '') ? -1
        : (a.tourney_date || '') > (b.tourney_date || '') ? 1
          : (parseInt(a.match_num, 10) || 0) - (parseInt(b.match_num, 10) || 0));

  // Per-player history, chronological, as parsed records.
  const history = new Map(); // key -> array of {date, matchNum, won, surface, parsed, bestOf, firstSetWon, straight}

  const excluded = [];
  const matches = [];

  for (const row of ordered) {
    const level = row.tourney_level;
    const surfaceRaw = SURFACE_MAP[String(row.surface ?? '').trim()] || null;
    const winnerRank = parseInt(row.winner_rank, 10);
    const loserRank = parseInt(row.loser_rank, 10);
    const bestOf = parseInt(row.best_of, 10) === 5 ? 5 : 3;
    const parsed = parseSets(row.score);

    const ok =
      SACKMANN.includedLevels.has(level) &&
      surfaceRaw != null &&
      Number.isFinite(winnerRank) &&
      Number.isFinite(loserRank) &&
      row.winner_name &&
      row.loser_name;

    if (!ok) {
      excluded.push({ reason: 'excluded-level/rank/surface', row });
      continue;
    }

    const favRank = winnerRank < loserRank ? winnerRank : loserRank;
    const favName = winnerRank < loserRank ? row.winner_name : row.loser_name;
    const oppName = winnerRank < loserRank ? row.loser_name : row.winner_name;
    const favIsWinner = favName === row.winner_name;
    const oppRank = winnerRank < loserRank ? loserRank : winnerRank;

    const featuresFor = (name) => {
      const h = history.get(key(name)) || [];
      const last5 = h.slice(-5).reverse().map((x) => (x.won ? 'W' : 'L'));
      const oneYearAgo = (date) => date >= yearBefore(row.tourney_date);
      const surfaceMatches = h.filter((x) => x.surface === surfaceRaw && oneYearAgo(x.date));
      const surfWins = surfaceMatches.filter((x) => x.won).length;
      const surfLosses = surfaceMatches.filter((x) => !x.won).length;
      const surfaceLast10 = h.filter((x) => x.surface === surfaceRaw).slice(-10);
      const fsWins = surfaceLast10.filter((x) => x.firstSetWon === true).length;
      const straightLast3 = h.slice(-3).reverse().map((x) => x.straight === true);
      const servePct = (firstIn, svpt) =>
        firstIn != null && svpt != null && parseInt(svpt, 10) > 0
          ? Math.round((parseInt(firstIn, 10) / parseInt(svpt, 10)) * 1000) / 1000 : null;
      const lastMatchSSLoss = h.length && !h[h.length - 1].won && h[h.length - 1].straight === true
        ? true : null;
      return {
        last5: last5.length === 5 ? last5 : null,
        surface: {
          wins: surfWins,
          losses: surfLosses,
          firstSetWinRateLast10: surfaceLast10.length >= 3
            ? (fsWins / surfaceLast10.length) : null,
        },
        straightSetsLast3: straightLast3.length === 3 ? straightLast3 : null,
        lastMatchStraightSetLoss: lastMatchSSLoss,
        serve: name === favName
          ? { firstServePct: servePct(row.w_1stIn, row.w_svpt), acesPerMatch: row.w_ace != null ? parseFloat(row.w_ace) : null }
          : { firstServePct: servePct(row.l_1stIn, row.l_svpt), acesPerMatch: row.l_ace != null ? parseFloat(row.l_ace) : null },
      };
    };

    const fav = featuresFor(favName);
    const opp = featuresFor(oppName);

    // Assemble an engine match object. Fields the builder cannot source are
    // null, exactly as the engine expects.
    const match = {
      event_id: `h:${row.tourney_id}:${row.match_num}`,
      surface: surfaceRaw,
      tournament: { level: LEVEL_MAP[level], round: row.round || null },
      players: [
        {
          name: favName,
          rank: favRank,
          odds: null, firstSetOdds: null, handicapOdds: null,
          form: {
            last5: fav.last5,
            tournamentWinStreak: null,
            straightSetsLast3: fav.straightSetsLast3,
            firstSetWinRateLast10: fav.surface.firstSetWinRateLast10,
            lastMatchStraightSetLoss: fav.lastMatchStraightSetLoss,
            beatHigherRankedThisEvent: null,
            documentedSlowStarter: null,
          },
          surface: { wins: fav.surface.wins, losses: fav.surface.losses, titles: null, poorRecordOnSurface: null, dominantMarginGames: null },
          serve: fav.serve,
          rest: null,
        },
        {
          name: oppName,
          rank: oppRank,
          odds: null, firstSetOdds: null, handicapOdds: null,
          form: {
            last5: opp.last5,
            tournamentWinStreak: null,
            straightSetsLast3: opp.straightSetsLast3,
            firstSetWinRateLast10: opp.surface.firstSetWinRateLast10,
            lastMatchStraightSetLoss: opp.lastMatchStraightSetLoss,
            beatHigherRankedThisEvent: null,
            documentedSlowStarter: null,
          },
          surface: { wins: opp.surface.wins, losses: opp.surface.losses, titles: null, poorRecordOnSurface: null, dominantMarginGames: null },
          serve: opp.serve,
          rest: null,
        },
      ],
      opponentRank: oppRank,
      // Actual outcome, for grading only — never seen by the engine.
      outcome: {
        winner: row.winner_name,
        favouriteWasWinner: favIsWinner,
        firstSetWinner: parsed.winner.length ? (parsed.winner[0] > parsed.loser[0] ? row.winner_name : row.loser_name) : null,
        date: row.tourney_date,
      },
    };

    matches.push({ match, row });

    // Record this match into both players' history for future matches.
    const winnerRec = {
      date: row.tourney_date,
      matchNum: parseInt(row.match_num, 10) || 0,
      won: true,
      surface: surfaceRaw,
      parsed,
      bestOf,
      firstSetWon: winnerTookFirstSet(parsed),
      straight: winnerStraightSets(parsed, bestOf),
    };
    const loserRec = { ...winnerRec, won: false, firstSetWon: parsed.winner.length ? parsed.winner[0] < parsed.loser[0] : null, straight: false };
    const wKey = key(row.winner_name);
    const lKey = key(row.loser_name);
    if (!history.has(wKey)) history.set(wKey, []);
    if (!history.has(lKey)) history.set(lKey, []);
    history.get(wKey).push(winnerRec);
    history.get(lKey).push(loserRec);
  }

  return { matches, excluded, order: ordered.length };
}

function yearBefore(dateStr) {
  const y = parseInt(String(dateStr).slice(0, 4), 10);
  const md = String(dateStr).slice(4);
  return `${y - 1}${md}`;
}

/* ------------------------------------------------------------------ *
 * Grading
 * ------------------------------------------------------------------ */

/**
 * Grade an engine result against the recorded outcome.
 * @returns {{market:string, band:string, correct:boolean|null, predicted:string, actual:string}}
 */
export function gradeResult(match, result) {
  const out = [];
  const fav = result.favourite;
  const actual = match.outcome.winner;
  for (const market of ['win_match', 'first_set']) {
    const m = result.markets[market];
    if (!m || m.band === 'SKIP' || fav == null) continue;
    let correct = null;
    let actualName = null;
    if (market === 'win_match') {
      actualName = actual;
      correct = key(fav) === key(actual);
    } else if (market === 'first_set') {
      actualName = match.outcome.firstSetWinner;
      if (actualName != null) correct = key(fav) === key(actualName);
    }
    out.push({ market, band: m.band, correct, predicted: fav, actual: actualName, score: m.score, rawScore: m.rawScore });
  }
  return out;
}

/** Aggregate graded picks into metrics: hit rate, Brier, log loss, by band. */
export function aggregate(graded) {
  const settled = graded.filter((g) => g.correct != null);
  const byBand = {};
  for (const band of ['HIGH', 'MEDIUM', 'LOW']) {
    const rows = settled.filter((g) => g.band === band);
    if (rows.length) {
      byBand[band] = { n: rows.length, hitRate: rows.filter((r) => r.correct).length / rows.length };
    }
  }
  // Brier/log loss use the raw score as the implied probability. This is more
  // informative than the band (which the engine's anti-hallucination guard
  // caps at LOW whenever more than two factors are missing — always the case
  // in this odds-free dataset).
  const brier = settled.length
    ? settled.reduce((a, r) => a + (r.rawScore / 100 - (r.correct ? 1 : 0)) ** 2, 0) / settled.length
    : null;
  const logLoss = settled.length
    ? settled.reduce((a, r) => {
        const p = Math.min(Math.max(r.rawScore / 100, 1e-6), 1 - 1e-6);
        return a - Math.log(r.correct ? p : 1 - p);
      }, 0) / settled.length
    : null;
  const byBucket = [];
  for (const [lo, hi] of [[0, 29], [30, 49], [50, 69], [70, 100]]) {
    const rows = settled.filter((g) => g.rawScore >= lo && g.rawScore <= hi);
    if (rows.length) {
      byBucket.push({
        bucket: `${lo}–${hi}`,
        n: rows.length,
        hitRate: rows.filter((r) => r.correct).length / rows.length,
      });
    }
  }

  return {
    total: graded.length,
    settled: settled.length,
    void: graded.length - settled.length,
    hitRate: settled.length ? settled.filter((r) => r.correct).length / settled.length : null,
    brier,
    logLoss,
    byBand,
    byBucket,
  };
}
