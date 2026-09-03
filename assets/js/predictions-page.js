/**
 * SportsPred — cross-sport prediction generator.
 *
 * Pick a date, pick the sports, press one button: the page collects every
 * fixture in every verified competition for those sports, scores it, writes a
 * tip for each, and hands back one copyable block.
 */

import { SPORTS, getSport } from '../../engine/registry.js';
import { parseScoreboard, buildLeagueContext, headToHead, restDays } from '../../engine/espn_universal.js';
import { scoreUniversalMatch, espnSportFor } from '../../engine/universal_engine.js';
import { writeUniversalTip, buildCopyText } from '../../engine/universal_writer.js';
import { writeNbaGame } from '../../engine/nba_writer.js';
import { loadLeagueDay, loadLeagueRange, loadStatic, pool, addDays, TTL } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, confBar, qs, setQS,
} from './ui.js';

const state = {
  date: qs('date', todayISO()),
  sports: new Set(),
  registry: null,
  contexts: {},
  rows: [],
  running: false,
};

const PREDICTABLE = SPORTS.filter((s) => s.predictable && s.espnSport && !s.page);
const OWN_PAGE = SPORTS.filter((s) => s.predictable && s.page);

async function boot() {
  renderShell({ activeSport: null, activePage: 'predictions.html' });
  renderFooter();

  const saved = (qs('sports') || 'football,american-football,basketball,ice-hockey,baseball').split(',').filter(Boolean);
  for (const k of saved) if (getSport(k)) state.sports.add(k);

  $('#date-input').value = state.date;
  $('#date-label').textContent = fmtDateLong(state.date);

  $('#sport-picks').innerHTML = PREDICTABLE.map((s) => `
    <label class="btn sm" style="cursor:pointer">
      <input type="checkbox" value="${esc(s.key)}" ${state.sports.has(s.key) ? 'checked' : ''}> ${s.icon} ${esc(s.name)}
    </label>`).join('') + OWN_PAGE.map((s) => `
    <a class="btn sm" href="${esc(s.page)}?date=${esc(state.date)}" title="${esc(s.name)} runs on its own specialist page">${s.icon} ${esc(s.name)} →</a>`).join('');

  $$('#sport-picks input').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.sports.add(cb.value); else state.sports.delete(cb.value);
    setQS({ sports: [...state.sports].join(',') });
  }));

  $('#date-input').addEventListener('change', (e) => {
    state.date = e.target.value || todayISO();
    setQS({ date: state.date });
    $('#date-label').textContent = fmtDateLong(state.date);
  });

  $('#run').addEventListener('click', run);
  $('#copy-all').addEventListener('click', copyAll);
  $('#band-filter').addEventListener('change', render);

  const [reg, ctx] = await Promise.all([
    loadStatic('data/leagues.json', TTL.REGISTRY),
    loadStatic('data/league_context.json'),
  ]);
  state.registry = reg.data;
  state.contexts = ctx.data?.leagues || {};

  $('#reg-line').innerHTML = state.registry
    ? `Using the machine-verified league registry built ${esc(state.registry.generated_at_utc || '')} (${esc(String(state.registry.summary?.ok ?? '?'))} competitions).`
    : 'Registry not built yet — falling back to the candidate league list, which may include competitions ESPN does not serve.';

  // Generate on arrival so the page is useful without a click.
  run();
}

function leaguesFor(sport) {
  const fromReg = state.registry?.sports?.[sport.key]?.leagues;
  if (Array.isArray(fromReg) && fromReg.length) {
    return fromReg.filter((l) => l.ok).map((l) => ({ slug: l.slug, name: l.name }));
  }
  return sport.candidateLeagues || [];
}

async function run() {
  if (state.running) return;
  state.running = true;
  state.rows = [];
  const btn = $('#run');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Generating…';

  const jobs = [];
  for (const key of state.sports) {
    const sport = getSport(key);
    if (!sport) continue;
    for (const lg of leaguesFor(sport)) jobs.push({ sport, lg });
  }

  if (!jobs.length) {
    $('#out').innerHTML = '<div class="empty">Pick at least one sport.</div>';
    finish(btn);
    return;
  }

  let done = 0;
  const collected = [];
  const tapesNeeded = new Map();

  await pool(jobs, 8, async ({ sport, lg }) => {
    const res = await loadLeagueDay(espnSportFor(sport.key), lg.slug, state.date);
    done += 1;
    setBar(Math.round((done / jobs.length) * 70), `${done}/${jobs.length} competitions checked`);
    if (!res.data) return;
    const parsed = parseScoreboard(res.data, { sportKey: sport.key, leagueSlug: lg.slug, leagueName: lg.name });
    for (const m of parsed.matches) {
      collected.push({ m, sport });
      const ck = `${sport.key}:${lg.slug}`;
      if (!state.contexts[ck]?.sufficient) tapesNeeded.set(ck, { sport, slug: lg.slug });
    }
  });

  // Only scan history for leagues the committed precompute does not cover.
  const tapes = new Map();
  if (tapesNeeded.size) {
    setBar(75, `Measuring ${tapesNeeded.size} league baselines that are not precomputed…`);
    const from = addDays(state.date, -45);
    const to = addDays(state.date, -1);
    await pool([...tapesNeeded.entries()], 4, async ([ck, { sport, slug }]) => {
      const res = await loadLeagueRange(espnSportFor(sport.key), slug, from, to);
      if (!res.data) return;
      const parsed = parseScoreboard(res.data, { sportKey: sport.key, leagueSlug: slug });
      tapes.set(ck, parsed.matches);
      const c = buildLeagueContext(parsed.matches, { threeWay: sport.threeWay });
      c.source = `live 45-day scan ${from}..${to}`;
      state.contexts[ck] = c;
    });
  }

  setBar(88, 'Scoring and writing…');
  for (const { m, sport } of collected) {
    const ck = `${sport.key}:${m.leagueSlug}`;
    const tape = tapes.get(ck) || null;
    const scored = scoreUniversalMatch(m, {
      threeWay: sport.threeWay,
      leagueContext: state.contexts[ck] || { sufficient: false },
      h2h: tape ? headToHead(tape, m.home?.name, m.away?.name, m.startUtc) : null,
      rest: tape ? { home: restDays(tape, m.home?.name, m.startUtc), away: restDays(tape, m.away?.name, m.startUtc) } : null,
    });
    scored.neutral = m.neutral;
    const tip = writeUniversalTip(scored);
    const nbaTips = sport.key === 'basketball' ? writeNbaGame(scored) : null;
    state.rows.push({ m, sport, scored, tip, nbaTips });
  }
  state.rows.sort((a, b) => (b.scored.headline?.score || 0) - (a.scored.headline?.score || 0));

  setBar(100, '');
  render();
  finish(btn);
}

function finish(btn) {
  state.running = false;
  btn.disabled = false;
  btn.innerHTML = '⚡ Generate predictions';
}

function setBar(v, label) {
  $('#progress i').style.width = `${v}%`;
  $('#progress-label').innerHTML = v >= 100 ? '' : `<span class="spin"></span> ${esc(label)}`;
}

function filtered() {
  const f = $('#band-filter').value;
  return state.rows.filter(({ tip }) => {
    if (f === 'published') return tip.ok;
    if (f === 'high') return tip.ok && tip.band === 'HIGH';
    if (f === 'medium') return tip.ok && (tip.band === 'HIGH' || tip.band === 'MEDIUM');
    return true;
  });
}

function render() {
  const rows = filtered();
  const published = state.rows.filter((r) => r.tip.ok).length;
  const withheld = state.rows.length - published;
  $('#summary').textContent = `${state.rows.length} fixtures · ${published} predictions published · ${withheld} withheld for thin evidence`;

  if (!rows.length) {
    $('#out').innerHTML = `<div class="empty">Nothing to show for ${esc(state.date)} with these filters.</div>`;
    return;
  }

  $('#out').innerHTML = rows.map(({ m, sport, scored, tip, nbaTips }) => `
    <div class="card">
      <div class="card-head">
        <span>${sport.icon}</span>
        <h3>${esc(scored.match)}</h3>
        <span class="sp"></span>
        <span class="meta-line">${esc(m.leagueName || '')} · ${esc(m.dateISO || '')}</span>
        ${tip.ok ? `<span class="badge ${esc(tip.band)}">${esc(tip.band)}</span>${confBar(tip.score, tip.band)}` : '<span class="badge SKIP">WITHHELD</span>'}
      </div>
      <div class="card-body">
        ${sport.key === 'basketball' && nbaTips
    ? `<div class="nba-market-tips">${nbaTips.map((t, i) => `<section class="nba-tip"><div class="tip-meta"><strong>${['WIN MATCH', 'POINT SPREAD', 'GAME TOTAL'][i]}</strong><span class="sp"></span><span class="badge ${esc(t.band)}">${esc(t.band)}</span>${t.ok ? confBar(t.score, t.band) : ''}</div><div>${t.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div></section>`).join('')}</div>
             <div class="toolbar" style="margin-top:10px"><a class="btn sm" href="sport.html?sport=${esc(sport.key)}&date=${esc(m.dateISO)}">Open on the ${esc(sport.name)} board</a></div>`
    : tip.ok
      ? `<div class="tipbox">${tip.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
             <div class="toolbar" style="margin-top:10px"><button class="btn sm" data-copy="${esc(m.id)}">📋 Copy this tip</button><a class="btn sm" href="sport.html?sport=${esc(sport.key)}&date=${esc(m.dateISO)}">Open on the ${esc(sport.name)} board</a></div>`
      : `<p class="meta-line">No tip written — ${esc((tip.violations || []).join('; ') || tip.reason || 'unscored')}.</p>`}
        <ul class="srclist">${(scored.sources || []).slice(0, 4).map((s) => `<li>→ <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul>
      </div>
    </div>`).join('');

  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const row = state.rows.find((r) => r.m.id === b.dataset.copy);
    if (!row?.tip?.ok) return;
    const ok = await copyText(row.tip.text.replace(/\*\*/g, ''));
    toast(ok ? 'Tip copied' : 'Copy blocked — select the text manually');
  }));
}

async function copyAll() {
  const tips = [];
  for (const { m, sport, scored, tip, nbaTips } of filtered()) {
    if (sport.key === 'basketball' && nbaTips) {
      const labels = ['WIN MATCH', 'POINT SPREAD', 'GAME TOTAL'];
      nbaTips.forEach((t, i) => {
        if (t.ok) tips.push({ match: scored.match, league: m.leagueName, marketLabel: labels[i], selection: scored.markets[t.market]?.selection, band: t.band, score: t.score, text: t.text, sources: scored.sources });
      });
    } else if (tip.ok) {
      tips.push({ match: scored.match, league: m.leagueName, marketLabel: scored.headline.label, selection: scored.headline.selection, band: tip.band, score: tip.score, text: tip.text, sources: scored.sources });
    }
  }
  if (!tips.length) { toast('Nothing to copy'); return; }
  const text = buildCopyText({ tips, withheld: [], unscored: [] }, {
    title: 'SportsPred predictions', dateISO: state.date,
  });
  const ok = await copyText(text);
  toast(ok ? `Copied ${tips.length} predictions` : 'Copy blocked here');
}

boot().catch((e) => {
  console.error(e);
  $('#out').innerHTML = `<div class="note bad">Failed to start: ${esc(e.message)}</div>`;
});
