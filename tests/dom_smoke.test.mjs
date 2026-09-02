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

function makeFetch(counters) {
  return async function stubFetch(url) {
    const u = String(url);
    counters.calls.push(u);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('site.api.espn.com')) {
      // A range request is the history scan; a single date is the day's card.
      if (/dates=\d{8}-\d{8}/.test(u)) return ok(historyPayload());
      return ok(soccerFixture);
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
