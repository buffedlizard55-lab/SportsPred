/**
 * DOM smoke tests — the "does the site actually work" pass.
 *
 * These boot the real pages in jsdom with a stubbed network, then assert that
 * the scoreboard renders, that predictions are generated automatically, and
 * that the Generate button produces tips rather than doing nothing.
 *
 * jsdom is a devDependency. If it is not installed the suite skips rather than
 * failing, so `node --test` still works on a clean checkout with no install.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* not installed */ }

const soccerFixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_soccer_eng1.EXCERPT.json'), 'utf8'));

/** A scoreboard payload with completed matches, so a baseline can be measured. */
function historyPayload() {
  const events = [];
  for (let i = 0; i < 24; i += 1) {
    const home = `Home ${i}`;
    const away = `Away ${i}`;
    const hs = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0;
    const as = i % 3 === 0 ? 1 : i % 3 === 1 ? 1 : 2;
    events.push({
      id: `h${i}`,
      date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T15:00Z`,
      name: `${away} at ${home}`,
      competitions: [{
        id: `h${i}`,
        status: { type: { state: 'post', shortDetail: 'FT' } },
        competitors: [
          { homeAway: 'home', score: String(hs), winner: hs > as, team: { id: `h${i}`, displayName: home } },
          { homeAway: 'away', score: String(as), winner: as > hs, team: { id: `a${i}`, displayName: away } },
        ],
      }],
    });
  }
  return { leagues: [{ id: '700', name: 'English Premier League', slug: 'eng.1', calendar: [] }], events };
}

const golfPost = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_golf_leaderboard.EXCERPT.json'), 'utf8'));
const golfPre = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_golf_leaderboard_pre.EXCERPT.json'), 'utf8'));

/** Golf scoreboard stub: calendar + the DP World Tour event covering the week. */
function golfScoreboard(tour) {
  const cal = tour === 'eur'
    ? [{ id: '401734065', label: 'Omega European Masters', startDate: '2025-08-28T07:00Z', endDate: '2025-08-31T07:00Z' }, { id: '401822700', label: 'Omega European Masters', startDate: '2026-09-03T07:00Z', endDate: '2026-09-06T07:00Z' }]
    : [{ id: '401811964', label: 'TOUR Championship', startDate: '2026-08-27T07:00Z', endDate: '2026-08-30T07:00Z' }, { id: '401850914', label: 'Biltmore Championship', startDate: '2026-09-17T07:00Z', endDate: '2026-09-20T07:00Z' }];
  const events = tour === 'eur' ? [{ id: '401822700', name: 'Omega European Masters', date: '2026-09-03T04:00Z', endDate: '2026-09-06T04:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [] }], links: [] }] : [];
  return { leagues: [{ id: tour === 'eur' ? '7002' : '1106', slug: tour, name: tour === 'eur' ? 'DP World Tour' : 'PGA TOUR', season: { year: 2026 }, calendar: cal }], day: { date: '2026-09-04' }, events };
}

/** A results tape in the committed shape, built from the completed-event fixture plus a prior edition of the upcoming event. */
function golfResultsDoc() {
  const preField = golfPre.events[0].competitions[0].competitors.map((c) => c.athlete);
  const players = {};
  for (const a of preField) players[a.id] = { name: a.displayName, country: a.flag.alt, countryCode: a.birthPlace?.countryAbbreviation ?? null };
  for (const c of golfPost.events[0].competitions[0].competitors) players[c.athlete.id] = { name: c.athlete.displayName, country: c.athlete.flag.alt, countryCode: 'USA' };
  const rows2025 = preField.map((a, i) => [a.id, i + 1, 'F', -10 + i, 66 + i, 68, 67, 69]);
  const rows2024 = preField.map((a, i) => [a.id, i === 0 ? 3 : i + 4, 'F', -8 + i, 67, 68, 67, 69]);
  const rowsTC = golfPost.events[0].competitions[0].competitors.map((c) => [c.athlete.id, c.status.position.displayName === '-' ? null : Number(c.status.position.id), c.status.type.shortDetail === 'WD' ? 'WD' : 'F', Number(c.statistics[0].value), ...c.linescores.map((l) => (l.value > 50 ? l.value : null)).concat([null, null, null]).slice(0, 4)]);
  return {
    schema_version: 1, sport: 'Golf', source: { url: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard' }, players,
    events: {
      401734065: { tour: 'eur', name: 'Omega European Masters', tournamentId: '3383', startDate: '2025-08-28', endDate: '2025-08-31', seasonYear: 2025, major: false, purse: 3250000, yards: 6830, par: 70, fieldSize: 4, rows: rows2025, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401734065' },
      401640000: { tour: 'eur', name: 'Omega European Masters', tournamentId: '3383', startDate: '2024-08-29', endDate: '2024-09-01', seasonYear: 2024, major: false, purse: 3250000, yards: 6830, par: 70, fieldSize: 4, rows: rows2024, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401640000' },
      401811964: { tour: 'pga', name: 'TOUR Championship', tournamentId: '46', startDate: '2026-08-27', endDate: '2026-08-30', seasonYear: 2026, major: false, purse: 40000000, yards: 7440, par: 70, fieldSize: 3, rows: rowsTC, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401811964' },
      401800001: { tour: 'eur', name: 'Danish Golf Championship', tournamentId: '9001', startDate: '2026-08-20', endDate: '2026-08-23', seasonYear: 2026, major: false, purse: 2500000, yards: 6950, par: 71, fieldSize: 4, rows: preField.map((a, i) => [a.id, i === 0 ? 1 : i + 6, 'F', -12 + i, 65 + i, 68, 67, 69]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800001' },
      401800002: { tour: 'eur', name: 'British Masters', tournamentId: '9002', startDate: '2026-08-06', endDate: '2026-08-09', seasonYear: 2026, major: false, purse: 3000000, yards: 7100, par: 72, fieldSize: 4, rows: preField.map((a, i) => [a.id, i + 2, 'F', -9 + i, 66 + i, 68, 67, 69]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800002' },
      401800003: { tour: 'eur', name: 'Scottish Championship', tournamentId: '9003', startDate: '2026-07-23', endDate: '2026-07-26', seasonYear: 2026, major: false, purse: 2000000, yards: 6900, par: 70, fieldSize: 4, rows: preField.map((a, i) => [a.id, i === 3 ? null : i + 5, i === 3 ? 'CUT' : 'F', -6 + i, 67 + i, 69, 68, 70]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800003' },
    },
  };
}

function golfRankingsDoc() {
  const preField = golfPre.events[0].competitions[0].competitors.map((c) => c.athlete);
  return { schema_version: 1, fetched_at_utc: '2026-09-01T00:00:00Z', source: { url: 'https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC' },
    rows: preField.map((a, i) => ({ rank: 20 + i * 15, owgrId: `o${a.id}`, name: a.displayName, country: a.flag.alt, region: 'Europe', lastWeekRank: 22 + i * 15, profileUrl: `https://www.owgr.com/playerprofile/x-${a.id}` })) };
}

function makeFetch(counters) {
  return async function stubFetch(url) {
    const u = String(url);
    counters.calls.push(u);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('/sports/golf/leaderboard?league=')) {
      const id = u.match(/event=(\d+)/)?.[1];
      if (id === '401822700') return ok(golfPre);
      if (id === '401811964') return ok(golfPost);
      return ok({ events: [] });
    }
    if (/site\.api\.espn\.com\/apis\/site\/v2\/sports\/golf\/(pga|eur|lpga|champions-tour)\/scoreboard/.test(u)) {
      const tour = u.match(/sports\/golf\/([a-z-]+)\/scoreboard/)[1];
      if (tour === 'lpga' || tour === 'champions-tour') return { ok: false, status: 404, json: async () => ({}) };
      return ok(golfScoreboard(tour));
    }
    if (u.includes('data/golf_results.json')) return ok(golfResultsDoc());
    if (u.includes('data/golf_rankings.json')) return ok(golfRankingsDoc());
    if (u.includes('data/golf_weather.json')) return ok({ events: { 401822700: { available: true, days: [{ date: '2026-09-03', windMaxKmh: 34, precipProbPct: 55 }], r1: { trend: 'deteriorating' }, sourceUrl: 'https://api.open-meteo.com/v1/forecast?latitude=46&longitude=7' } } });
    if (u.includes('data/golf_backtest.json')) {
      return ok({ events: 22, generated_at_utc: '2026-09-01T00:00:00Z', summary: [
        { market: 'outright', hits: 2, graded: 22, hitRate: 0.091 }, { market: 'top6', hits: 8, graded: 20, hitRate: 0.4 }, { market: 'frl', hits: 1, graded: 22, hitRate: 0.045 },
        { market: 'top_european', hits: 3, graded: 22, hitRate: 0.136 }, { market: 'top_american', hits: 6, graded: 22, hitRate: 0.273 }, { market: 'top_british_irish', hits: 5, graded: 22, hitRate: 0.227 },
      ], top6List: { selections: 100, hits: 27, rate: 0.27 } });
    }
    if (u.includes('data/golf_events.json') || u.includes('data/golf_stats.json') || u.includes('data/golf_slate.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.includes('site.api.espn.com')) {
      // A range request is the history scan; a single date is the day's card.
      if (/dates=\d{8}-\d{8}/.test(u)) return ok(historyPayload());
      return ok(soccerFixture);
    }
    // Prefer the REAL committed artifact when CI has built it: that is what
    // catches schema drift between the builder script and the page that
    // renders it. Fall back to a synthetic payload on a clean checkout.
    if (u.includes('data/leagues.json') && existsSync(join(ROOT, 'data/leagues.json'))) {
      return ok(JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8')));
    }
    if (u.includes('data/league_context.json') && existsSync(join(ROOT, 'data/league_context.json'))) {
      return ok(JSON.parse(readFileSync(join(ROOT, 'data/league_context.json'), 'utf8')));
    }
    if (u.includes('data/leagues.json')) {
      return ok({
        schema_version: 1,
        generated_at_utc: '2026-09-02T00:00:00Z',
        summary: { checked: 1, ok: 1, failed: 0 },
        sports: { football: { espnSport: 'soccer', leagues: [{ slug: 'eng.1', name: 'English Premier League', ok: true, status: 200 }] } },
      });
    }
    if (u.includes('data/league_context.json')) {
      return ok({
        generated_at_utc: '2026-09-02T00:00:00Z',
        window: { days: 120, from: '2026-05-05', to: '2026-09-02' },
        method: 'measured',
        summary: { sufficient: 1, thin: 0, failed: 0 },
        leagues: {
          'football:eng.1': {
            sufficient: true, sample: 240, homeWinRate: 0.45, drawRate: 0.24, awayWinRate: 0.31,
            meanTotal: 2.8, leagueName: 'English Premier League', sourceUrl: 'https://site.api.espn.com/x',
          },
        },
      });
    }
    if (u.includes('data/olbg_sports.json') || u.includes('_slate.json') || u.includes('data/slate.json')
        || u.includes('data/irregularities.json') || u.includes('data/universal_backtest.json')) {
      const local = join(ROOT, u.replace(/^.*\/(data\/[^?]+)$/, '$1'));
      if (existsSync(local)) return ok(JSON.parse(readFileSync(local, 'utf8')));
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function bootPage(page, { search = '' } = {}) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const counters = { calls: [] };
  const dom = new JSDOM(html, {
    url: `https://example.test/${page}${search}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Globals the modules expect.
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.history = window.history;
  global.localStorage = window.localStorage;
  global.CSS = window.CSS || { escape: (s) => String(s).replace(/[^\w-]/g, '\\$&') };
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
  global.AbortController = window.AbortController || global.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  global.fetch = makeFetch(counters);

  // Import the page's module entry (cache-busted so each test gets a fresh run).
  const src = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  assert.ok(src, `${page} loads a module script`);
  const mod = pathToFileURL(join(ROOT, src)).href;
  await import(`${mod}?t=${Math.random()}`);

  // Let the async boot settle.
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 15));

  return { dom, window, document: window.document, counters };
}

function cleanup() {
  for (const k of ['window', 'document', 'location', 'history', 'localStorage', 'CSS', 'navigator', 'fetch', 'requestAnimationFrame']) {
    delete global[k];
  }
}

test('sport.html boots, renders the board and auto-generates a prediction', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    // shell
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelectorAll('.sportrail a').length >= 20, 'every sport is in the rail');
    assert.ok(document.querySelector('footer.site'), 'footer rendered');

    // board
    const rows = document.querySelectorAll('.match');
    assert.ok(rows.length >= 1, 'at least one match row rendered');
    assert.match(document.body.textContent, /Newcastle United/);
    assert.match(document.body.textContent, /AFC Bournemouth/);

    // auto-generated prediction, not an empty placeholder
    const pill = document.querySelector('.pred-pill .sel');
    assert.ok(pill, 'a prediction pill exists');
    assert.ok(pill.textContent.trim().length > 0, 'the pill carries a selection');
    assert.ok(!/^\s*$/.test(pill.textContent), 'pill is not blank');

    // the rail lists it
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0);

    // league select was populated from the verified registry
    const opts = document.querySelectorAll('#league-filter option');
    assert.ok(opts.length >= 2, 'league filter populated');
    assert.match(document.querySelector('#registry-note').textContent, /machine-verified/);
  } finally { cleanup(); }
});

test('the Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    const btn = document.querySelector('#generate');
    assert.ok(btn, 'the button exists');

    // Wipe the rendered predictions so we can prove the click repopulates them.
    document.querySelector('#rail-preds').innerHTML = '';
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));

    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0,
      'clicking Generate repopulated the predictions rail');
    assert.equal(btn.disabled, false, 'the button re-enables after generating');
    assert.match(btn.textContent, /Generate predictions/);

    // and a toast reported the count
    const toast = document.querySelector('#toast');
    assert.ok(toast, 'a toast was raised');
    assert.match(toast.textContent, /predictions generated/);
  } finally { cleanup(); }
});

test('opening Analysis reveals the written tip, its signals and its sources', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    const toggle = document.querySelector('[data-toggle]');
    assert.ok(toggle, 'an analysis toggle exists');
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    const detail = document.querySelector('.detail.open');
    assert.ok(detail, 'the detail panel opened');
    const text = detail.textContent;
    assert.match(text, /is the call/, 'the written tip is present');
    assert.match(text, /DraftKings/, 'the price provider is attributed');
    assert.match(text, /Full Time Result/, 'the market table is present');
    assert.ok(detail.querySelectorAll('.srclist a').length >= 2, 'review links are present');
    assert.match(text, /Not available for this fixture|missing/i, 'missing factors are disclosed');

    // every source link is a real https URL
    for (const a of detail.querySelectorAll('.srclist a')) {
      assert.match(a.getAttribute('href'), /^https:\/\//);
      assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    }
  } finally { cleanup(); }
});

test('golf.html boots, renders leaderboards from ESPN and auto-generates a six-market card', { skip: !JSDOM }, async () => {
  const { document, counters } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelector('.sportrail a[data-sport="golf"]'), 'golf is in the rail');
    assert.ok(counters.calls.some((u) => u.includes('/sports/golf/eur/scoreboard')), 'the DP World Tour calendar was fetched live');
    assert.ok(counters.calls.some((u) => u.includes('leaderboard?league=eur&event=401822700')), 'the full field was fetched live');

    const text = document.body.textContent;
    assert.match(text, /Omega European Masters/);
    assert.match(text, /Crans-sur-Sierre Golf Club/);
    assert.match(text, /Calum Hill/, 'the field is rendered');
    assert.ok(document.querySelectorAll('#board table.data tbody tr').length >= 4, 'leaderboard rows rendered');

    // an auto-generated selection with a band, not a placeholder
    const pill = document.querySelector('.pred-pill .sel');
    assert.ok(pill, 'a prediction pill exists');
    assert.ok(pill.textContent.trim().length > 0);
    assert.ok(document.querySelector('.pred-pill .badge'));
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0, 'the rail lists selections');
    assert.match(document.querySelector('#rail-count').textContent, /selections across 1 tournament card/);
    assert.match(document.querySelector('#coverage').textContent, /OWGR rows/);
    assert.match(document.querySelector('#coverage').textContent, /walk-forward backtest \(22 events/, 'the measured backtest summary is surfaced');
    assert.ok(document.querySelector('#coverage a[href="data/golf_backtest.json"]'), 'the backtest ledger is linked');
    assert.ok(document.querySelectorAll('#calgrid .cell .c').length >= 1, 'calendar shows tournament days');
  } finally { cleanup(); }
});

test('the golf Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    const btn = document.querySelector('#generate');
    assert.ok(btn, 'the button exists');
    document.querySelector('#rail-preds').innerHTML = '';
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0, 'clicking Generate repopulated the rail');
    assert.equal(btn.disabled, false);
    assert.match(btn.textContent, /Generate predictions/);
    const toast = document.querySelector('#toast');
    assert.ok(toast, 'a toast was raised');
    assert.match(toast.textContent, /selections generated across 1 tournament card/);
  } finally { cleanup(); }
});

test('golf Analysis reveals the written card, every rule that fired, missing factors and source links', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    const toggle = document.querySelector('[data-toggle]');
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const detail = document.querySelector('.detail.open');
    assert.ok(detail, 'the detail panel opened');
    const text = detail.textContent;
    assert.match(text, /OUTRIGHT WINNER AND TOP SIX/);
    assert.match(text, /FIRST ROUND LEADER/);
    assert.match(text, /TOP BRITISH & IRISH/);
    assert.match(text, /Confidence: (HIGH|MEDIUM|LOW)/);
    assert.match(text, /Responsible gambling|Weather note/);
    assert.match(text, /CARD VALIDATED/, 'the writer validator passed on the live card');
    assert.match(text, /strokes gained/i, 'the missing strokes-gained source is disclosed');
    assert.match(text, /Recent form/, 'component labels are shown');
    assert.ok(detail.querySelectorAll('.srclist a').length >= 2, 'review links are present');
    for (const a of detail.querySelectorAll('.srclist a')) {
      assert.match(a.getAttribute('href'), /^https:\/\//);
      assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    }
    // the tips never leak figures, source names or the tournament name
    for (const p of detail.querySelectorAll('.tipbox p')) {
      const t = p.textContent;
      if (!/Confidence:/.test(t)) continue;
      assert.ok(!/\d/.test(t), `no numerals in tip: ${t.slice(0, 60)}`);
      assert.ok(!/ESPN|OWGR|OLBG|Omega|Crans/.test(t), `no source/tournament names in tip: ${t.slice(0, 60)}`);
    }
  } finally { cleanup(); }
});

test('sport.html?sport=golf hands over to the dedicated golf page', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=golf&date=2026-09-04' });
  try {
    // jsdom does not implement navigation, so the handover link is the observable.
    const a = document.querySelector('#handover');
    assert.ok(a, 'handover link rendered');
    assert.match(a.getAttribute('href'), /golf\.html\?date=2026-09-04/);
  } finally { cleanup(); }
});

test('index.html boots and lists every OLBG sport as a tile', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('index.html');
  try {
    const tiles = document.querySelectorAll('#tiles .tile');
    assert.equal(tiles.length, 20, 'one tile per OLBG betting-tips sport');
    assert.match(document.querySelector('#reg-note').textContent, /machine-verified|not yet built/);
  } finally { cleanup(); }
});

test('markets.html renders the full OLBG directory with live links', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('markets.html');
  try {
    const rows = document.querySelectorAll('#dir table.data tbody tr');
    assert.ok(rows.length >= 20, 'a row per sport');
    const links = [...document.querySelectorAll('#dir a')].map((a) => a.getAttribute('href'));
    assert.ok(links.some((h) => /olbg\.com\/betting-tips\/Cricket\/7$/.test(h)), 'cricket points at the corrected index id 7');
    assert.ok(!links.some((h) => /olbg\.com\/betting-tips\/Cricket\/16/.test(h)), 'the wrong cricket id is gone');
  } finally { cleanup(); }
});

test('predictions.html generates a cross-sport card on arrival', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('predictions.html', { search: '?sports=football&date=2026-09-05' });
  try {
    assert.match(document.querySelector('#summary').textContent, /fixtures/);
    assert.ok(document.querySelectorAll('#out .card').length >= 1, 'at least one prediction card');
    assert.match(document.querySelector('#out').textContent, /is the call/);
  } finally { cleanup(); }
});

test('sources.html renders the verification report and the irregularities register', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sources.html');
  try {
    assert.match(document.querySelector('#registry-report').textContent, /answered HTTP 200/);
    const irr = document.querySelector('#irr').textContent;
    assert.match(irr, /U-01/);
    assert.match(irr, /Cricket/);
    assert.ok(document.querySelectorAll('#sport-sources tbody tr').length >= 20);
  } finally { cleanup(); }
});

test('method.html states the hyperparameters and the missing-backtest case honestly', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('method.html');
  try {
    assert.match(document.querySelector('#weights').textContent, /marketWeight/);
    const bt = document.querySelector('#backtest').textContent;
    assert.ok(/No backtest artifact committed yet|Leak control/.test(bt),
      'either the real backtest or an explicit "not built yet" notice — never a placeholder number');
  } finally { cleanup(); }
});

test('sources.html reports the real machine-verification numbers when CI has built them', { skip: !JSDOM }, async () => {
  if (!existsSync(join(ROOT, 'data/leagues.json'))) return; // not built yet on this checkout
  const real = JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8'));
  const { window } = await bootPage('sources.html');
  const text = window.document.body.textContent;

  // The counts on the page must be the counts in the artifact, not a placeholder.
  assert.match(text, new RegExp(String(real.summary.checked)), 'checked count is rendered');
  assert.match(text, new RegExp(String(real.summary.ok)), 'ok count is rendered');
  assert.ok(!/not built yet/i.test(text.split('Irregularities')[0]),
    'the registry block must show data, not the not-built-yet notice');

  // A slug that failed verification has to be visible, not quietly dropped.
  const failed = Object.values(real.sports).flatMap((b) => (b.leagues || []).filter((l) => !l.ok));
  for (const f of failed) {
    assert.match(text, new RegExp(f.slug.replace('.', '\\.')), `failed slug ${f.slug} is surfaced for review`);
  }
});

test('method.html publishes the real backtest, and never invents an ROI', { skip: !JSDOM }, async () => {
  if (!existsSync(join(ROOT, 'data/universal_backtest.json'))) return;
  const bt = JSON.parse(readFileSync(join(ROOT, 'data/universal_backtest.json'), 'utf8'));
  const { window } = await bootPage('method.html');
  const text = window.document.body.textContent;

  assert.match(text, new RegExp(String(bt.overall.n)), 'the graded sample size is shown');

  // Bands must be monotonic in the artifact itself; the page must not claim
  // otherwise, and must not print a percentage ROI when none was computable.
  const { HIGH, MEDIUM, LOW } = bt.byBand;
  assert.ok(HIGH.hitRate > MEDIUM.hitRate, 'HIGH outperforms MEDIUM');
  assert.ok(MEDIUM.hitRate > LOW.hitRate, 'MEDIUM outperforms LOW');

  if (bt.overall.roi === null) {
    // No ROI is computable, so the column must be absent entirely rather than
    // showing a number, and the page must say why.
    const heads = [...window.document.querySelectorAll('#backtest th')].map((h) => h.textContent.trim());
    assert.ok(!heads.some((h) => /ROI/i.test(h)), `ROI column must be dropped, saw headers: ${heads.join(' | ')}`);
    assert.match(text, /no ROI is computable/i, 'the page explains why there is no ROI');
  }

  // The verdict must reflect the artifact, not a fixed sentence.
  assert.match(text, /The bands separate/i);
});

test('the registry contains no endpoint that the verifier proved dead', { skip: !existsSync(join(ROOT, 'data/leagues.json')) }, async () => {
  const real = JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8'));
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const failed = Object.values(real.sports).flatMap((b) => (b.leagues || []).filter((l) => !l.ok).map((l) => l.slug));
  const stillListed = [];
  for (const sport of SPORTS) {
    for (const c of sport.candidateLeagues || []) {
      if (failed.includes(c.slug)) stillListed.push(`${sport.key}:${c.slug}`);
    }
  }
  assert.deepEqual(stillListed, [],
    `these slugs failed live verification and must be removed from engine/registry.js: ${stillListed.join(', ')}`);
});
