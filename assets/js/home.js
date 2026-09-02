/**
 * SportsPred — home hub.
 * Shows the whole slate at a glance: one tile per OLBG sport, plus a live
 * "today across sports" panel that streams in the top featured competitions.
 */

import { SPORTS, getSport } from '../../engine/registry.js';
import { parseScoreboard } from '../../engine/espn_universal.js';
import { scoreUniversalMatch, espnSportFor } from '../../engine/universal_engine.js';
import { writeUniversalTip } from '../../engine/universal_writer.js';
import { loadLeagueDay, loadStatic, pool, TTL } from './data-client.js';
import {
  $, esc, todayISO, fmtTime, renderShell, renderFooter, confBar, formPips,
} from './ui.js';

/** Featured competitions per sport for the home panel — kept deliberately small
 *  so the home page stays fast. Full coverage lives on each sport page. */
const FEATURED = {
  football: ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions'],
  'american-football': ['nfl', 'college-football'],
  basketball: ['nba', 'wnba'],
  baseball: ['mlb'],
  'ice-hockey': ['nhl'],
  'rugby-league': [],
  'rugby-union': [],
};

const date = todayISO();
const contexts = {};

async function boot() {
  renderShell({ activeSport: null, activePage: 'index.html' });
  renderTiles();
  renderFooter();

  const ctxDoc = await loadStatic('data/league_context.json');
  Object.assign(contexts, ctxDoc.data?.leagues || {});

  const regDoc = await loadStatic('data/leagues.json', TTL.REGISTRY);
  const reg = regDoc.data;
  if (reg?.generated_at_utc) {
    $('#reg-note').innerHTML = `League registry machine-verified <code>${esc(reg.generated_at_utc)}</code> · ${esc(String(reg.summary?.ok ?? '?'))} competitions returned HTTP 200 at build time · <a href="sources.html#registry">verification report</a>`;
  } else {
    $('#reg-note').innerHTML = 'League registry not yet built in CI — sport pages fall back to the candidate list and mark it unverified.';
  }

  await loadToday();
}

function renderTiles() {
  $('#tiles').innerHTML = SPORTS.map((s) => `
    <a class="tile" href="sport.html?sport=${esc(s.key)}">
      <div class="t-ico">${s.icon}</div>
      <div class="t-name">${esc(s.name)}</div>
      <div class="t-meta">OLBG index ${esc(String(s.olbgId))}${s.candidateLeagues?.length ? ` · ${s.candidateLeagues.length} competitions` : ''}</div>
      ${s.predictable
    ? '<div class="t-flag" style="color:var(--win)">predictions generated</div>'
    : '<div class="t-flag">markets listed for review only</div>'}
    </a>`).join('');
}

async function loadToday() {
  const jobs = [];
  for (const [sportKey, leagues] of Object.entries(FEATURED)) {
    for (const slug of leagues) jobs.push({ sportKey, slug });
  }
  const box = $('#today');
  const all = [];
  let done = 0;

  await pool(jobs, 6, async (job) => {
    const sport = getSport(job.sportKey);
    const res = await loadLeagueDay(espnSportFor(job.sportKey), job.slug, date);
    done += 1;
    $('#today-status').textContent = `${done}/${jobs.length} competitions checked`;
    if (!res.data) return;
    const parsed = parseScoreboard(res.data, { sportKey: job.sportKey, leagueSlug: job.slug });
    for (const m of parsed.matches) {
      const lc = contexts[`${job.sportKey}:${job.slug}`] || { sufficient: false };
      const scored = scoreUniversalMatch(m, { threeWay: sport.threeWay, leagueContext: lc });
      const tip = writeUniversalTip(scored);
      all.push({ m, scored, tip, sport });
    }
    all.sort((a, b) => (b.scored.headline?.score || 0) - (a.scored.headline?.score || 0));
    box.innerHTML = render(all);
  });

  if (!all.length) {
    box.innerHTML = '<div class="empty">No featured fixtures today. Pick a sport above for its full calendar.</div>';
  }
  $('#today-status').textContent = `${all.length} fixtures · ${all.filter((x) => x.tip.ok).length} predictions published`;
}

function render(rows) {
  return rows.slice(0, 24).map(({ m, scored, sport }) => {
    const head = scored.headline;
    return `
    <div class="match">
      <div class="match-main">
        <div class="match-when">
          <div class="t">${m.phase === 'results' ? `${m.home.score ?? ''}-${m.away.score ?? ''}` : esc(fmtTime(m.startUtc))}</div>
          <div class="s ${m.phase === 'live' ? 'live' : ''}">${m.phase === 'live' ? 'LIVE' : m.phase === 'results' ? 'FINAL' : sport.icon}</div>
        </div>
        <div class="teams">
          <div class="trow"><span class="nm">${esc(m.home.name)}</span>${formPips(m.home.form)}${m.home.score !== null ? `<span class="sc">${m.home.score}</span>` : ''}</div>
          <div class="trow"><span class="nm">${esc(m.away.name)}</span>${formPips(m.away.form)}${m.away.score !== null ? `<span class="sc">${m.away.score}</span>` : ''}</div>
          <div class="meta-line">${esc(m.leagueName || '')}</div>
        </div>
        <div class="match-right">
          ${head
    ? `<span class="pred-pill ${esc(head.band)}"><span class="badge ${esc(head.band)}">${esc(head.band)}</span><span class="sel">${esc(head.selection)}</span>${confBar(head.score, head.band)}</span>`
    : '<span class="pred-pill SKIP"><span class="badge SKIP">SKIP</span></span>'}
          <a class="btn sm" href="sport.html?sport=${esc(sport.key)}&date=${esc(m.dateISO)}">Open</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

boot().catch((e) => {
  console.error(e);
  const el = $('#today');
  if (el) el.innerHTML = `<div class="note bad">Home panel failed to start: ${esc(e.message)}</div>`;
});
