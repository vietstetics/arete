// Machine picker, details sheet and browser for the Training page. DOM only;
// uses the page's modal/list classes plus css/machines.css. Every value shown
// comes from the machine record (verbatim) or its derivation; derived parts
// are labelled as such.

import { machineDb as db, UNLISTED, UNRECORDED } from '../index.js';
import { ATOMS } from '../services/actions.js';
import { STATIONS } from '../data/exercises.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LAST_KEY = 'jarvis_machine_last';
const PAGE = 40;
const ICON = {
  info: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  chev: '<svg class="mc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  check: '<svg class="mc-ic on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  link: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

// ── Small pieces ─────────────────────────────────────────────────────────
export function profileTag(m) {
  return `<span class="mc-pf mc-pf-${esc(m.profile.category.toLowerCase())}" title="${esc(m.profileText)}">${esc(db.profileLabel(m.profile))}</span>`;
}

/** Mode a machine is used in for an exercise (null when it can't be told). */
export function modeFor(m, exercise) {
  const e = exercise && m.exercises.find((x) => x.name === exercise);
  if (e) return e.mode;
  return m.modes.length === 1 ? m.modes[0].key : null;
}

function modesFor(m, mode) {
  if (mode == null) return m.modes;
  const md = m.modes.find((x) => x.key === mode);
  return md ? [md] : [];
}

/** Region names, shortest form that stays unambiguous ("Latissimus dorsi — Upper"). */
const regionName = (entry) => entry.muscle;

/** Targets, unresolved regions and actions outside the muscle list for one use. */
export function muscleSummary(m, mode) {
  const ms = modesFor(m, mode);
  const targets = [], unresolved = new Map(), unlisted = [];
  for (const md of ms) {
    for (const t of md.targets) if (!targets.some((x) => x.entry.id === t.entry.id)) targets.push(t);
    for (const c of md.candidates) {
      const k = `${c.atom}|${c.kind}`;
      if (!unresolved.has(k)) unresolved.set(k, { atom: c.atom, kind: c.kind, regions: [] });
      const u = unresolved.get(k);
      if (!u.regions.some((r) => r.id === c.entry.id)) u.regions.push(c.entry);
    }
    for (const a of md.unmapped) if (!unlisted.includes(a)) unlisted.push(a);
  }
  return { targets, unresolved: [...unresolved.values()], unlisted };
}

function contextOf(entry) {
  const r = db.spec.read.get(entry.id);
  return r && r.context ? r.context : null;
}

function unresolvedText(u) {
  const regions = u.regions.map((e) => `${e.region}${u.kind === 'context' && contextOf(e) ? ` (${contextOf(e)})` : ''}`).join(', ');
  if (u.kind === 'compound-part') return `Part of the recorded knee and hip extension (filed under Quadriceps — Squat pattern), not stated separately: ${regions}`;
  if (u.kind === 'conditional') return `${ATOMS[u.atom]} is recorded only as conditional: ${regions}`;
  const group = [...new Set(u.regions.map((e) => e.group))].join(' / ');
  return `${ATOMS[u.atom]} → ${group}; the region depends on a detail the machine record doesn't state: ${regions}`;
}

function readLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } }
export function rememberMachine(exercise, sel) {
  try {
    const all = readLast();
    if (sel) all[exercise] = { id: sel.id, mode: sel.mode ?? null }; else delete all[exercise];
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}
export function lastMachine(exercise) {
  const v = readLast()[exercise];
  return v && db.get(v.id) ? v : null;
}

/** Compact block for a chosen machine (logger card, plan row): identity,
 *  profile, recorded action and targeted muscles — no lookup needed beyond
 *  the database. `snap` is the snapshot stored on the exercise; `attrs` go on
 *  the button that opens the details (an onclick or data attributes). */
export function chosenHtml(snap, { attrs = '', compact = false } = {}) {
  const m = snap && db.get(snap.id);
  if (!m) {
    return snap ? `<div class="mc-chosen"><div class="mc-ch-top"><b>${esc(snap.brand)}</b> ${esc(snap.name)}${snap.model ? ` · ${esc(snap.model)}` : ''}</div><div class="mc-ch-l">${esc(snap.profile || '')}</div></div>` : '';
  }
  const s = muscleSummary(m, snap.mode);
  const md = snap.mode && m.modes.find((x) => x.key === snap.mode);
  const chips = s.targets.map((t) => `<span class="tg pri" title="via ${esc(ATOMS[t.atom].toLowerCase())}">${esc(regionName(t.entry))}</span>`)
    .concat(s.unresolved.filter((u) => u.kind === 'context').map((u) => `<span class="tg mc-tg-u" title="${esc(unresolvedText(u))}">${esc([...new Set(u.regions.map((e) => e.group))].join(' / '))} · region not recorded</span>`))
    .concat(s.unlisted.map((a) => `<span class="tg mc-tg-x" title="Not in your muscle list">${esc(ATOMS[a])}</span>`));
  const action = md && md.label ? `${md.label} mode: ${md.atoms.map((a) => ATOMS[a].toLowerCase()).join(', ')}` : (m.action || 'No muscle action recorded');
  // Compact: one readable line, regions grouped under their muscle.
  let targets = '';
  if (compact) {
    const groups = new Map();
    for (const t of s.targets) {
      if (!groups.has(t.entry.group)) groups.set(t.entry.group, []);
      if (!groups.get(t.entry.group).includes(t.entry.region)) groups.get(t.entry.group).push(t.entry.region);
    }
    const parts = [...groups].map(([g, rs]) => `${g} (${rs.join(', ')})`);
    for (const u of s.unresolved.filter((x) => x.kind === 'context')) {
      const gs = [...new Set(u.regions.map((e) => e.group))].filter((g) => !groups.has(g));
      if (gs.length) parts.push(`${gs.join(' / ')} (region not recorded)`);
    }
    for (const a of s.unlisted) parts.push(`${ATOMS[a]} (not in your muscle list)`);
    targets = parts.length ? `<div class="mc-ch-ms">${esc(parts.join(' · '))}</div>` : '';
  } else if (chips.length) targets = `<div class="mc-ch-tg">${chips.join('')}</div>`;
  return `<div class="mc-chosen${compact ? ' compact' : ''}">
    <button type="button" class="mc-ch-top" ${attrs} title="Machine details">
      <span><b>${esc(m.brand)}</b> ${esc(m.name)}${m.model ? ` <span class="mc-model">${esc(m.model)}</span>` : ''}</span>${ICON.chev}
    </button>
    <div class="mc-ch-l">${profileTag(m)}<span class="mc-act">${esc(action)}</span></div>
    ${targets}
  </div>`;
}

// ── Modal shell (one, reused) ────────────────────────────────────────────
let bk = null;
let onDismiss = null;
function shell() {
  if (bk) return bk;
  bk = document.createElement('div');
  bk.className = 'modal-bk mc-bk';
  bk.innerHTML = '<div class="modal mc-modal" role="dialog" aria-modal="true" aria-labelledby="mc-title"></div>';
  bk.addEventListener('click', (e) => { if (e.target === bk) dismiss(); });
  // Capture phase, so Escape closes this sheet without also closing a sheet beneath it.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bk.classList.contains('open')) { e.stopPropagation(); dismiss(); }
  }, true);
  document.body.appendChild(bk);
  return bk;
}
// Each open gets a fresh dialog element, so listeners from the last use go with it.
function show(html) {
  const b = shell();
  const box = document.createElement('div');
  box.className = 'modal mc-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'mc-title');
  box.innerHTML = html;
  b.querySelector('.mc-modal').replaceWith(box);
  b.classList.add('open');
  return box;
}
export function closeSheet() {
  if (!bk) return;
  bk.classList.remove('open');
  onDismiss = null;
}
function dismiss() {
  const cb = onDismiss;
  closeSheet();
  if (cb) cb();
}

// ── Lists ────────────────────────────────────────────────────────────────
function rowHtml(m, mode, { selected = false, note = '', act = 'pick' } = {}) {
  const md = mode != null ? m.modes.find((x) => x.key === mode) : null;
  const groups = (md ? md.groups : m.groups).filter((g) => g !== UNLISTED && g !== UNRECORDED).slice(0, 3);
  const exercises = m.station ? [STATIONS[m.station].label] : [...new Set(m.exercises.filter((e) => e.basis !== 'name-only').map((e) => e.name))];
  return `<button type="button" class="mc-row${selected ? ' on' : ''}" data-mc="${act}" data-id="${esc(m.id)}" data-mode="${esc(mode ?? '')}">
    <span class="mc-row-b">
      <span class="mc-row-t">${esc(m.brand)} · ${esc(m.line)}</span>
      <span class="mc-row-n">${esc(m.name)}${md && md.label ? ` <em>${esc(md.label)} mode</em>` : ''}</span>
      <span class="mc-row-m"><span class="mc-model">${m.model ? esc(m.model) : 'No model'}</span>${profileTag(m)}${groups.map((g) => `<span class="mc-g">${esc(g)}</span>`).join('')}</span>
      ${act === 'open' && exercises.length ? `<span class="mc-row-x">${esc(exercises.slice(0, 3).join(' · '))}${exercises.length > 3 ? ` +${exercises.length - 3}` : ''}</span>` : ''}
      ${note ? `<span class="mc-row-x">${esc(note)}</span>` : ''}
    </span>
    ${selected ? ICON.check : ICON.chev}
  </button>`;
}

function sectionHtml(id, title, items, limits, render) {
  if (!items.length) return '';
  const n = limits[id] || PAGE;
  return `<section class="mc-sec"><div class="mc-sec-h">${esc(title)}<span>${items.length}</span></div>
    ${items.slice(0, n).map(render).join('')}
    ${items.length > n ? `<button type="button" class="mc-more" data-mc="more" data-sec="${esc(id)}">Show ${Math.min(PAGE, items.length - n)} more</button>` : ''}</section>`;
}

// ── Picker ───────────────────────────────────────────────────────────────
/**
 * Choose a machine for an exercise.
 *   exercise   exercise name (null = browse everything)
 *   current    { id, mode } already chosen, if any
 *   onPick     called with { id, mode, snapshot } or null (no machine)
 *   dismiss    'skip' — closing counts as "no machine" (adding an exercise)
 *              'cancel' — closing changes nothing (changing a machine)
 */
export function openPicker({ exercise = null, current = null, onPick, dismiss: dismissAs = 'cancel' } = {}) {
  const fx = exercise ? db.forExercise(exercise) : null;
  const has = fx && (fx.exact.length + fx.related.length + fx.stations.length);
  const st = { q: '', brand: '', scope: has ? 'exercise' : 'all', limits: {} };
  const brands = db.options().brands;
  const box = show(`
    <div class="modal-h"><div><div class="modal-t" id="mc-title">Choose a machine</div>${exercise ? `<div class="mc-sub">for ${esc(exercise)}</div>` : ''}</div>
      <button class="icon-btn" data-mc="close" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-b mc-b">
      <input class="srch" data-mc-in="q" placeholder="Search brand, model, name or muscle…" autocomplete="off" aria-label="Search machines">
      <div class="mc-tools">
        ${has ? `<div class="mc-seg" role="group" aria-label="Which machines">
          <button type="button" data-mc="scope" data-v="exercise" aria-pressed="true">For this exercise</button>
          <button type="button" data-mc="scope" data-v="all" aria-pressed="false">All ${db.machines.length}</button></div>` : ''}
        <select class="mc-select" data-mc-in="brand" aria-label="Brand"><option value="">All brands</option>${brands.map((b) => `<option>${esc(b.name)}</option>`).join('')}</select>
      </div>
      <div class="mc-res" aria-live="polite"></div>
    </div>
    <div class="modal-f">
      ${current ? '<button class="btn btn-s btn-sm" data-mc="none">Remove machine</button>' : '<button class="btn btn-s btn-sm" data-mc="none">No specific machine</button>'}
    </div>`);
  onDismiss = dismissAs === 'skip' ? () => onPick && onPick(null) : null;

  const res = box.querySelector('.mc-res');
  function render() {
    const allowed = st.q ? new Set(db.search({ text: st.q }).map((m) => m.id)) : null;
    const ok = (m) => (!st.brand || m.brand === st.brand) && (!allowed || allowed.has(m.id));
    const isCur = (m, mode) => current && current.id === m.id && (current.mode ?? null) === (mode ?? null);
    let html = '';
    if (st.scope === 'exercise' && fx) {
      const last = lastMachine(exercise);
      const lastM = last && db.get(last.id);
      if (lastM && ok(lastM) && !current) html += sectionHtml('last', 'Last used', [{ m: lastM, mode: last.mode }], st.limits, (x) => rowHtml(x.m, x.mode));
      html += sectionHtml('exact', `${exercise} machines`, fx.exact.filter((x) => ok(x.machine)), st.limits, (x) => rowHtml(x.machine, x.mode, { selected: isCur(x.machine, x.mode) }));
      if (fx.family) html += sectionHtml('related', `Similar machines · ${fx.family.label}`, fx.related.filter((x) => ok(x.machine)), st.limits, (x) => rowHtml(x.machine, x.mode, { selected: isCur(x.machine, x.mode), note: `Listed for ${x.via}` }));
      html += sectionHtml('stations', 'Stations that may support it', fx.stations.filter((x) => ok(x.machine)), st.limits, (x) => rowHtml(x.machine, x.mode, { selected: isCur(x.machine, x.mode), note: x.basis === 'station-unconfirmed' ? 'Stations not recorded' : `${STATIONS[x.machine.station].label}` }));
      if (!html) html = `<div class="mc-none">No machines match. Try <button type="button" class="mc-link" data-mc="scope" data-v="all">all machines</button>.</div>`;
    } else {
      const list = db.machines.filter(ok);
      html = sectionHtml('all', st.q || st.brand ? 'Matching machines' : 'All machines', list, st.limits, (m) => {
        const mode = modeFor(m, exercise);
        return rowHtml(m, mode, { selected: isCur(m, mode) });
      }) || '<div class="mc-none">No machines match your search.</div>';
    }
    res.innerHTML = html;
  }
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.mcIn; if (!k) return;
    st[k] = e.target.value; st.limits = {}; render();
  });
  box.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mc]'); if (!el) return;
    const act = el.dataset.mc;
    if (act === 'close') return dismiss();
    if (act === 'none') { closeSheet(); if (onPick) onPick(null); return; }
    if (act === 'scope') {
      st.scope = el.dataset.v; st.limits = {};
      box.querySelectorAll('[data-mc="scope"][aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.scope)));
      render(); return;
    }
    if (act === 'more') { st.limits[el.dataset.sec] = (st.limits[el.dataset.sec] || PAGE) + PAGE; render(); return; }
    if (act === 'pick') {
      const m = db.get(el.dataset.id); if (!m) return;
      const mode = el.dataset.mode === '' ? null : el.dataset.mode;
      if (exercise) rememberMachine(exercise, { id: m.id, mode });
      closeSheet();
      if (onPick) onPick({ id: m.id, mode, snapshot: db.snapshot(m, mode) });
    }
  });
  render();
  const q = box.querySelector('[data-mc-in="q"]');
  if (q && window.matchMedia('(min-width: 768px)').matches) setTimeout(() => q.focus(), 40);
}

// ── Details ──────────────────────────────────────────────────────────────
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

export function detailsHtml(m, mode = null) {
  const s = muscleSummary(m, mode);
  const multi = m.modes.length > 1;
  const exercises = m.station
    ? `${esc(STATIONS[m.station].label)} — offered for exercises done on that equipment${m.station === 'multi' ? ' (its stations aren\'t recorded)' : ''}`
    : m.exercises.length ? m.exercises.map((e) => `${esc(e.name)}${e.mode && multi ? ` <small>(${esc((m.modes.find((x) => x.key === e.mode) || {}).label || '')} mode)</small>` : ''}${e.basis === 'name-only' ? ' <small>(named, not in the recorded action)</small>' : ''}`).join(', ')
      : 'Not matched to an exercise';
  const targetsByMode = (multi && mode == null ? m.modes : modesFor(m, mode)).map((md) => {
    const list = md.targets.map((t) => `<li><b>${esc(regionName(t.entry))}</b><span>via ${esc(ATOMS[t.atom].toLowerCase())}${t.basis === 'either' ? ` (your list: “${esc(t.entry.muscleAction)}”)` : ''}</span></li>`).join('');
    return `${multi && mode == null ? `<div class="mc-mode">${esc(md.label)} mode</div>` : ''}${list ? `<ul class="mc-tl">${list}</ul>` : '<p class="mc-dim">None confirmed from the recorded action.</p>'}`;
  }).join('');
  const url = safeUrl(m.sourceUrl);
  const flags = m.flags.filter((f) => f.code !== 'no-action');
  return `<div class="mc-d">
    <div class="mc-d-hd">
      <div class="mc-d-t">${esc(m.brand)} · ${esc(m.line)}</div>
      <div class="mc-d-n" id="mc-title">${esc(m.name)}</div>
      <div class="mc-d-t">${m.model ? `Model ${esc(m.model)}` : 'No model code recorded'} · row ${m.row} of the database</div>
    </div>
    <dl class="mc-dl">
      <div><dt>Exercise</dt><dd>${exercises}</dd></div>
      <div><dt>Resistance profile</dt><dd>${profileTag(m)} ${m.profile.detail ? esc(m.profile.detail) : ''}
        <div class="mc-src">${esc(m.source.label)}${m.sourceType ? ` — ${esc(m.sourceType)}` : ''}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Source ${ICON.link}</a>` : ''}</div>
        ${m.setup ? `<div class="mc-src">Setup: ${esc(m.setup)}</div>` : ''}</dd></div>
      <div><dt>Muscle action</dt><dd>${m.action ? esc(m.action) : '<span class="mc-dim">Not recorded</span>'}</dd></div>
      <div><dt>Targeted muscles</dt><dd>${m.recorded ? targetsByMode : '<span class="mc-dim">None — no muscle action recorded.</span>'}
        <p class="mc-dim mc-why">Derived from the recorded action using your muscle list's own wording.</p></dd></div>
      ${s.unresolved.length ? `<div><dt>Region not recorded</dt><dd><ul class="mc-ul">${s.unresolved.map((u) => `<li>${esc(unresolvedText(u))}</li>`).join('')}</ul></dd></div>` : ''}
      ${s.unlisted.length ? `<div><dt>Not in your muscle list</dt><dd>${s.unlisted.map((a) => esc(ATOMS[a])).join(', ')}</dd></div>` : ''}
    </dl>
    ${flags.length ? `<div class="mc-flags"><div class="mc-flags-h">Notes for review</div><ul>${flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

/**
 * Details sheet. `actions`: [{ label, kind: 'primary'|'secondary'|'danger', run }].
 * `extra` adds HTML above the buttons (used for the station exercise choice).
 */
export function openDetails(id, mode = null, { actions = [], extra = '' } = {}) {
  const m = db.get(id); if (!m) return;
  const box = show(`
    <div class="modal-h"><div class="modal-t">Machine</div><button class="icon-btn" data-mc="close" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-b mc-b">${detailsHtml(m, mode)}</div>
    ${actions.length ? `<div class="modal-f mc-f">${extra}${actions.map((a, i) => `<button class="btn ${a.kind === 'primary' ? 'btn-p' : 'btn-s'} btn-sm${a.kind === 'danger' ? ' mc-danger' : ''}" data-mc="act" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`);
  onDismiss = null;
  box.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mc]'); if (!el) return;
    if (el.dataset.mc === 'close') return dismiss();
    if (el.dataset.mc === 'act') { const a = actions[+el.dataset.i]; if (a) a.run(box); }
  });
}

// ── Browser (Training → Machines) ────────────────────────────────────────
/** Ways a machine can be added from the browser: one per matched exercise. */
export function addChoices(m) {
  if (m.station) {
    const info = STATIONS[m.station];
    return [...(info.exercises || []), ...(info.related || [])].map((name) => ({ name, mode: null }));
  }
  const own = m.exercises.map((e) => ({ name: e.name, mode: e.mode }));
  return own.length ? own : [{ name: m.name, mode: m.modes.length === 1 ? m.modes[0].key : null }];
}

/**
 * Mount the searchable, filterable list. onAdd({ id, mode, snapshot }, exerciseName).
 */
export function mountBrowser(host, { onAdd } = {}) {
  const o = db.options();
  const st = { text: '', group: '', brand: '', exercise: '', limit: PAGE };
  host.innerHTML = `<div class="card mc-browse">
    <div class="mc-bh">
      <div><div class="mc-bt">Machine database</div><div class="mc-bs">${db.machines.length} machines from ${o.brands.length} brands. Pick one to see its resistance profile, recorded muscle action and the muscles derived from it.</div></div>
    </div>
    <div class="mc-filters">
      <input class="srch" data-f="text" placeholder="Search brand, model, name, exercise or muscle…" autocomplete="off" aria-label="Search machines">
      <div class="mc-fr">
        <label><span>Muscle group</span><select class="mc-select" data-f="group"><option value="">All muscle groups</option>${o.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count})</option>`).join('')}</select></label>
        <label><span>Brand</span><select class="mc-select" data-f="brand"><option value="">All brands</option>${o.brands.map((b) => `<option value="${esc(b.name)}">${esc(b.name)} (${b.count})</option>`).join('')}</select></label>
        <label><span>Exercise</span><select class="mc-select" data-f="exercise"><option value="">All exercises</option>${o.exercises.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${x.count})</option>`).join('')}
          <optgroup label="No recorded action">${o.stations.map((s) => `<option value="station:${esc(s.key)}">${esc(s.name)}s (${s.count})</option>`).join('')}<option value="unmatched">Unmatched (${o.unmatched})</option></optgroup></select></label>
      </div>
      <div class="mc-count"><span data-count></span><button type="button" class="mc-link" data-act="clear" hidden>Clear filters</button></div>
    </div>
    <div class="mc-list"></div>
  </div>`;
  const list = host.querySelector('.mc-list');
  const countEl = host.querySelector('[data-count]');
  const clearBtn = host.querySelector('[data-act="clear"]');
  function render() {
    const rows = db.search(st);
    const filtered = st.text || st.group || st.brand || st.exercise;
    countEl.textContent = filtered ? `${rows.length} of ${db.machines.length} machines` : `${rows.length} machines`;
    clearBtn.hidden = !filtered;
    list.innerHTML = rows.length
      ? rows.slice(0, st.limit).map((m) => rowHtml(m, st.exercise && !st.exercise.includes(':') ? modeFor(m, st.exercise) : null, { act: 'open' })).join('') +
        (rows.length > st.limit ? `<button type="button" class="mc-more" data-act="more">Show ${Math.min(PAGE, rows.length - st.limit)} more of ${rows.length - st.limit}</button>` : '')
      : '<div class="mc-none">No machines match these filters.</div>';
  }
  host.addEventListener('input', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    st[f] = e.target.value; st.limit = PAGE; render();
  });
  host.addEventListener('change', (e) => {
    const f = e.target.dataset.f; if (!f || f === 'text') return;
    st[f] = e.target.value; st.limit = PAGE; render();
  });
  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-mc]'); if (!el || !host.contains(el)) return;
    if (el.dataset.act === 'more') { st.limit += PAGE; render(); return; }
    if (el.dataset.act === 'clear') {
      Object.assign(st, { text: '', group: '', brand: '', exercise: '', limit: PAGE });
      host.querySelectorAll('[data-f]').forEach((i) => { i.value = ''; });
      render(); return;
    }
    if (el.dataset.mc === 'open') openBrowserDetails(el.dataset.id, st.exercise, onAdd);
  });
  render();
}

function openBrowserDetails(id, exerciseFilter, onAdd) {
  const m = db.get(id); if (!m || !onAdd) { openDetails(id); return; }
  const choices = addChoices(m);
  const preferred = choices.find((c) => c.name === exerciseFilter) || choices[0];
  const many = choices.length > 1;
  const extra = many ? `<select class="mc-select mc-addsel" aria-label="Add as exercise">${choices.map((c, i) => `<option value="${i}"${c === preferred ? ' selected' : ''}>${esc(c.name)}${c.mode && m.modes.length > 1 ? ` (${esc((m.modes.find((x) => x.key === c.mode) || {}).label || '')} mode)` : ''}</option>`).join('')}</select>` : '';
  openDetails(id, null, {
    extra,
    actions: [{
      label: many ? 'Add to workout' : `Add ${preferred.name} to workout`,
      kind: 'primary',
      run: (box) => {
        const sel = many ? choices[+box.querySelector('.mc-addsel').value] : preferred;
        closeSheet();
        onAdd({ id: m.id, mode: sel.mode, snapshot: db.snapshot(m, sel.mode) }, sel.name);
      },
    }],
  });
}

// ── Add-exercise sheet: every machine, added in one tap ──────────────────
const choiceLabel = (m, c) => `${c.name}${c.mode && m.modes.length > 1 ? ` · ${(m.modes.find((x) => x.key === c.mode) || {}).label || ''} mode` : ''}`;

/** One machine in the add-exercise list: name, brand, line, model, the
 *  resistance profile and the recorded muscle action, as written in the file. */
export function addRowHtml(m) {
  return `<div class="mc-ar">
    <button type="button" class="mc-ar-b" data-act="pick" data-id="${esc(m.id)}">
      <span class="mc-ar-n">${esc(m.name)}</span>
      <span class="mc-ar-t">${esc(m.brand)} · ${esc(m.line)}${m.model ? ` · <span class="mc-model">${esc(m.model)}</span>` : ''}</span>
      <span class="mc-ar-p">${profileTag(m)}${m.profile.detail ? `<span>${esc(m.profile.detail)}</span>` : ''}</span>
      <span class="mc-ar-a">${m.action ? esc(m.action) : '<em>No muscle action recorded</em>'}</span>
    </button>
    <button type="button" class="icon-btn mc-ar-i" data-act="info" data-id="${esc(m.id)}" aria-label="Details for ${esc(m.name)}" title="Details">${ICON.info}</button>
  </div>`;
}

/** "Add as …" for a machine that serves several exercises (combo modes, stations). */
export function addChoiceHtml(m) {
  const choices = addChoices(m);
  if (choices.length <= 6) {
    return `<div class="mc-ch"><span>Add as</span>${choices.map((c, i) =>
      `<button type="button" class="btn btn-s btn-sm" data-act="add" data-id="${esc(m.id)}" data-i="${i}">${esc(choiceLabel(m, c))}</button>`).join('')}</div>`;
  }
  return `<div class="mc-ch"><span>Add as</span>
    <select class="mc-select" data-choice="${esc(m.id)}" aria-label="Exercise for ${esc(m.name)}">${choices.map((c, i) => `<option value="${i}">${esc(choiceLabel(m, c))}</option>`).join('')}</select>
    <button type="button" class="btn btn-p btn-sm" data-act="add-sel" data-id="${esc(m.id)}">Add</button></div>`;
}

/**
 * Every machine, searchable and filterable by muscle group and brand.
 * Tapping a machine adds it: onAdd({ id, mode, snapshot }, exerciseName).
 * Mounted fresh into `host` each time the sheet opens.
 */
export function mountAddList(host, { onAdd } = {}) {
  const o = db.options();
  const st = { text: '', group: '', brand: '', limit: PAGE, open: null };
  const root = document.createElement('div');
  root.className = 'mc-add';
  root.innerHTML = `<input class="srch" data-f="text" placeholder="Search ${db.machines.length} machines — brand, model, exercise or muscle…" autocomplete="off" aria-label="Search machines">
    <div class="mc-addf">
      <select class="mc-select" data-f="group" aria-label="Muscle group"><option value="">All muscle groups</option>${o.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count})</option>`).join('')}</select>
      <select class="mc-select" data-f="brand" aria-label="Brand"><option value="">All brands</option>${o.brands.map((b) => `<option value="${esc(b.name)}">${esc(b.name)} (${b.count})</option>`).join('')}</select>
    </div>
    <div class="mc-count"><span data-count></span></div>
    <div class="mc-addl"></div>`;
  host.replaceChildren(root);
  const list = root.querySelector('.mc-addl');
  const countEl = root.querySelector('[data-count]');
  const add = (m, c) => {
    rememberMachine(c.name, { id: m.id, mode: c.mode });
    if (onAdd) onAdd({ id: m.id, mode: c.mode, snapshot: db.snapshot(m, c.mode) }, c.name);
  };
  function render() {
    const rows = db.search(st);
    const filtered = st.text || st.group || st.brand;
    countEl.textContent = filtered ? `${rows.length} of ${db.machines.length} machines` : `${rows.length} machines`;
    list.innerHTML = rows.length
      ? rows.slice(0, st.limit).map((m) => addRowHtml(m) + (st.open === m.id ? addChoiceHtml(m) : '')).join('') +
        (rows.length > st.limit ? `<button type="button" class="mc-more" data-act="more">Show ${Math.min(PAGE, rows.length - st.limit)} more of ${rows.length - st.limit}</button>` : '')
      : '<div class="mc-none">No machines match. Try another word, or use the Exercises tab for free weights.</div>';
  }
  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    st[f] = e.target.value; st.limit = PAGE; st.open = null; render();
  });
  root.addEventListener('change', (e) => {
    const f = e.target.dataset.f; if (!f || f === 'text') return;
    st[f] = e.target.value; st.limit = PAGE; st.open = null; render();
  });
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (act === 'more') { st.limit += PAGE; render(); return; }
    const m = db.get(el.dataset.id); if (!m) return;
    const choices = addChoices(m);
    if (act === 'pick') {
      if (choices.length === 1) add(m, choices[0]);
      else { st.open = st.open === m.id ? null : m.id; render(); }
    } else if (act === 'add') add(m, choices[+el.dataset.i]);
    else if (act === 'add-sel') add(m, choices[+root.querySelector(`[data-choice="${CSS.escape(m.id)}"]`).value]);
    else if (act === 'info') openBrowserDetails(m.id, '', (sel, name) => { rememberMachine(name, sel); if (onAdd) onAdd(sel, name); });
  });
  render();
  return root;
}
