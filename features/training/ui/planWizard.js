// Plan setup: Split → Days → Workouts → Review, as a full-screen sheet on the
// Train page. State survives going back and forth, and an unfinished new
// plan is kept as a draft on this device until it's started.

import {
  SPLITS, splitById, previewWeek, addDays, weekStart, localKey, weekday,
  DAY_SHORT, DAY_LONG, repText, frequencyLabel, sessionOn,
} from '../services/schedule.js';
import { starterFor } from '../data/starters.js';
import { commitPlan, endPlan } from '../repositories/planStore.js';
import { catalogue } from '../../exercises/index.js';
import { targetsPickerHtml, sessionPanelHtml, planPanelHtml } from '../../exercises/ui/overlapPanel.js';
import { machineDb, recordId } from '../../machines/index.js';
import { chosenHtml } from '../../machines/ui/machineUI.js';

const DRAFT_KEY = 'arete_plan_wizard';
const STEPS = ['Split', 'Days', 'Workouts', 'Review'];
const WEEK = [0, 1, 2, 3, 4, 5, 6];

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(s || '');
const fmtDate = (k, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(k + 'T12:00:00').toLocaleDateString(undefined, o);
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

const ICON = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
};

let st = null;     // wizard state
let root = null;   // overlay element
let opts = {};

// ── State ───────────────────────────────────────────────────────────────
function newRoutine(name) { return { id: 'r-' + uid(), name, exercises: [] }; }
function newExercise(name, src = {}) {
  return { id: 'x-' + uid(), name, sets: src.sets ?? 2, repMin: src.repMin ?? 8, repMax: src.repMax ?? 12, rir: src.rir ?? 1 };
}
function blank() {
  return { step: 0, maxStep: 0, splitId: null, name: '', routines: [], bank: [], custom: null, customName: '', days: [], rotation: 'continue', assignments: {}, startDate: localKey(), planId: null, editing: false, open: null, confirmEnd: false, error: '' };
}
function fromPlan(p) {
  return { ...blank(), step: 3, maxStep: 3, splitId: p.splitId, name: p.name, routines: clone(p.routines), bank: clone(p.routines), days: (p.days || []).slice(), rotation: p.rotation || 'continue', assignments: { ...(p.assignments || {}) }, startDate: p.startDate, planId: p.planId, editing: true, customName: p.splitId === 'custom' ? p.name : '' };
}
function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); } catch { /* storage full or blocked */ } }
function readDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

const split = () => splitById(st.splitId);
const routine = (id) => st.routines.find((r) => r.id === id);
const fbFamily = (s) => !!s && (s.id === 'fb' || s.id === 'fbeod');

// Remember every routine built this session, so switching splits and back
// (or Upper/Lower → Upper/Lower/Full Body) keeps the exercises entered.
function syncBank() {
  for (const r of st.routines) {
    const i = st.bank.findIndex((b) => b.id === r.id);
    if (i >= 0) st.bank[i] = r; else st.bank.push(r);
  }
}
function bankGet(name) {
  let r = st.bank.find((b) => b.name === name);
  if (!r) { r = newRoutine(name); st.bank.push(r); }
  return r;
}

function setSplit(id) {
  if (st.splitId === id) return;
  const prev = split(), next = splitById(id);
  syncBank();
  if (prev && prev.id === 'custom') { st.custom = st.routines; st.customName = st.name; }
  if (next.id === 'custom') st.routines = st.custom && st.custom.length ? st.custom : [newRoutine('Workout A')];
  else if (!(fbFamily(prev) && fbFamily(next))) st.routines = next.types.map(bankGet);
  st.splitId = id;
  st.name = next.id === 'custom' ? st.customName : next.name;
  st.days = next.id === 'custom' ? assignedDays() : next.days.slice();
  st.maxStep = 0;
  st.open = null;
}

function assignedDays() {
  return Object.keys(st.assignments).map(Number).filter((d) => st.routines.some((r) => r.id === st.assignments[d])).sort((a, b) => a - b);
}
function usedRoutines() {
  if (split() && split().mode === 'custom') {
    const ids = new Set(assignedDays().map((d) => st.assignments[d]));
    return st.routines.filter((r) => ids.has(r.id));
  }
  return st.routines;
}

function stepIssue(i) {
  const s = split();
  if (!s) return 'Choose a split to continue.';
  if (i === 0 && s.id === 'custom' && (!st.routines.length || st.routines.some((r) => !r.name.trim()))) return 'Give each workout a name.';
  if (i === 1) {
    if (!isDate(st.startDate)) return 'Pick a start date.';
    if (s.mode === 'custom' && !assignedDays().length) return 'Pick at least one training day.';
    if (s.mode === 'weekly' && !st.days.length) return 'Pick at least one training day.';
  }
  if (i === 2) {
    const empty = usedRoutines().find((r) => !r.exercises.length);
    if (empty) return `Add at least one exercise to ${empty.name || 'each workout'}.`;
  }
  return '';
}
const firstIssue = () => { for (let i = 0; i < 3; i++) { const m = stepIssue(i); if (m) return { step: i, msg: m }; } return null; };

/** The plan as it would be saved (also used for previews before it's valid). */
function buildPlan() {
  const s = split();
  const custom = s.mode === 'custom';
  const keep = custom ? st.routines.filter((r) => r.exercises.length || usedRoutines().includes(r)) : st.routines;
  const assignments = {};
  if (custom) for (const d of assignedDays()) assignments[d] = st.assignments[d];
  return {
    planId: st.planId,
    splitId: s.id,
    name: (st.name || '').trim() || (custom ? 'My split' : s.name),
    mode: s.mode,
    rotation: st.rotation,
    days: s.mode === 'weekly' ? st.days.slice().sort((a, b) => a - b) : custom ? assignedDays() : [],
    assignments,
    startDate: st.startDate,
    routines: keep.map((r) => ({
      id: r.id,
      name: r.name.trim() || 'Workout',
      ...(r.targets && r.targets.length ? { targets: r.targets.slice() } : {}),
      exercises: r.exercises.map((x) => {
        const lo = int(x.repMin, 1, 100, 8), hi = int(x.repMax, 1, 100, lo);
        const rir = x.rir === '' || x.rir == null ? null : Math.min(10, Math.max(0, Number(x.rir)));
        return { id: x.id, name: x.name, ...(x.catalogId ? { catalogId: x.catalogId } : {}), ...(x.machine ? { machine: x.machine } : {}), sets: int(x.sets, 1, 20, 2), repMin: Math.min(lo, hi), repMax: Math.max(lo, hi), rir: Number.isFinite(rir) ? rir : null };
      }),
    })),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────
function render(keepScroll = true) {
  if (!root) return;
  const body = root.querySelector('.tw-body');
  const top = keepScroll && body ? body.scrollTop : 0;
  const s = split();
  const last = st.step === 3;
  root.innerHTML = `
    <header class="tw-top">
      <button class="tw-iconbtn" data-act="close" aria-label="Close">${ICON.x}</button>
      <div class="tw-title" id="tw-title">${st.editing ? 'Edit plan' : 'New training plan'}</div>
      <span class="tw-count">${st.step + 1} of 4</span>
    </header>
    <nav class="tw-prog" aria-label="Steps">
      ${STEPS.map((label, i) => `<button class="tw-seg${i < st.step ? ' done' : ''}${i === st.step ? ' cur' : ''}" data-act="goto" data-step="${i}" ${i > st.maxStep ? 'disabled' : ''} aria-current="${i === st.step ? 'step' : 'false'}"><i></i><span>${label}</span></button>`).join('')}
    </nav>
    <main class="tw-body"><div class="tw-inner">${[step0, step1, step2, step3][st.step]()}</div></main>
    <footer class="tw-foot">
      ${st.error ? `<p class="tw-err" role="alert">${esc(st.error)}</p>` : ''}
      <div class="tw-foot-row">
        ${st.step > 0 ? `<button class="tw-btn ghost" data-act="back">${ICON.back}Back</button>` : '<span></span>'}
        <button class="tw-btn primary" data-act="${last ? 'save' : 'next'}" ${!s && st.step === 0 ? 'disabled' : ''}>${last ? (st.editing ? 'Save Plan' : 'Start Training Plan') : 'Continue'}</button>
      </div>
    </footer>`;
  const nb = root.querySelector('.tw-body');
  if (nb) nb.scrollTop = top;
}

function step0() {
  return `<h2 class="tw-h">Choose your split</h2>
    <div class="tw-cards">${SPLITS.map((s) => {
      const on = s.id === st.splitId;
      return `<button class="tw-card${on ? ' on' : ''}" data-act="split" data-id="${s.id}" aria-pressed="${on}">
          <span class="tw-card-t">${esc(s.name)}</span><span class="tw-card-s">${esc(s.blurb)}</span>
          <span class="tw-tick" aria-hidden="true">${ICON.check}</span></button>
        ${on && s.id === 'custom' ? customPanel() : ''}`;
    }).join('')}</div>`;
}

function customPanel() {
  return `<div class="tw-panel">
    <label class="tw-lbl" for="tw-name">Split name</label>
    <input class="tw-in" id="tw-name" data-field="name" value="${esc(st.name)}" placeholder="My split" autocomplete="off">
    <div class="tw-lbl">Workouts</div>
    ${st.routines.map((r) => `<div class="tw-line">
        <input class="tw-in" data-field="rname" data-id="${r.id}" value="${esc(r.name)}" placeholder="Workout name" aria-label="Workout name" autocomplete="off">
        ${st.routines.length > 1 ? `<button class="tw-iconbtn" data-act="rdel" data-id="${r.id}" aria-label="Remove ${esc(r.name)}">${ICON.x}</button>` : ''}
      </div>`).join('')}
    <button class="tw-add" data-act="radd">＋ Add workout</button>
  </div>`;
}

function dayChips() {
  const s = split();
  const on = s.mode === 'custom' ? assignedDays() : st.days;
  return `<div class="tw-days" role="group" aria-label="Training days">${WEEK.map((d) =>
    `<button class="tw-day${on.includes(d) ? ' on' : ''}" data-act="day" data-d="${d}" aria-pressed="${on.includes(d)}" aria-label="${DAY_LONG[d]}">${DAY_SHORT[d].slice(0, 1)}<small>${DAY_SHORT[d]}</small></button>`).join('')}</div>`;
}

function weekRows(plan, startKey) {
  return `<div class="tw-week">${previewWeek(plan, startKey).map((d) => {
    const before = d.date < plan.startDate;
    return `<div class="tw-wrow${d.routine ? ' train' : ''}${before ? ' before' : ''}">
        <span class="tw-wd">${DAY_SHORT[d.weekday]}</span><span class="tw-wdate">${fmtDate(d.date, { month: 'short', day: 'numeric' })}</span>
        <span class="tw-wn">${d.routine ? esc(d.routine.name) : before ? 'Before start' : 'Rest'}</span></div>`;
  }).join('')}</div>`;
}

function weekStrip(plan, startKey) {
  return `<div class="tw-strip">${previewWeek(plan, startKey).map((d) =>
    `<div class="tw-sc${d.routine ? ' train' : ''}"><span>${DAY_SHORT[d.weekday].slice(0, 1)}</span><b>${d.routine ? esc(abbr(d.routine.name)) : ''}</b></div>`).join('')}</div>`;
}
function abbr(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length === 1) return words[0].length <= 5 ? words[0] : words[0].slice(0, 4);
  return words.map((w) => (w.length === 1 ? w : w[0].toUpperCase())).join('');
}

function calendar(plan, weeks = 5) {
  const start = weekStart(plan.startDate);
  const today = localKey();
  const multi = plan.routines.length > 1;
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const s = sessionOn(plan, date);
    const dnum = Number(date.slice(8));
    const label = `${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${s ? s.routine.name : 'rest'}`;
    cells += `<div class="tw-cal-c${s ? ' train' : ''}${date === today ? ' today' : ''}${date < plan.startDate ? ' before' : ''}" title="${esc(label)}" aria-label="${esc(label)}">
      ${dnum === 1 || i === 0 ? `<em>${fmtDate(date, { month: 'short' })}</em>` : ''}<span>${dnum}</span>${s && multi ? `<b>${esc(abbr(s.routine.name))}</b>` : ''}</div>`;
  }
  return `<div class="tw-cal"><div class="tw-cal-h">${DAY_SHORT.map((d) => `<span>${d.slice(0, 1)}</span>`).join('')}</div><div class="tw-cal-g">${cells}</div></div>`;
}

function step1() {
  const s = split();
  const plan = buildPlan();
  const startField = (label) => `<label class="tw-lbl" for="tw-start">${label}</label>
    <input class="tw-in tw-date" type="date" id="tw-start" data-field="startDate" value="${esc(st.startDate)}">`;

  if (s.mode === 'eod') {
    return `<h2 class="tw-h">Pick your first training day</h2>
      <p class="tw-p">You'll train every second day from then on. The weekdays shift each week by themselves.</p>
      ${startField('First training day')}
      <div class="tw-lbl">Your next five weeks</div>
      ${calendar(plan)}`;
  }

  if (s.mode === 'custom') {
    const days = assignedDays();
    return `<h2 class="tw-h">Choose your training days</h2>
      ${dayChips()}
      ${days.length ? `<div class="tw-assign">${days.map((d) => `<label class="tw-arow"><span>${DAY_LONG[d]}</span>
          <select class="tw-in" data-field="assign" data-d="${d}">${st.routines.map((r) => `<option value="${r.id}"${st.assignments[d] === r.id ? ' selected' : ''}>${esc(r.name || 'Workout')}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
      ${startField('Plan starts')}
      ${days.length ? `<div class="tw-lbl">First week</div>${weekRows(plan, weekStart(st.startDate))}` : ''}`;
  }

  const rec = s.days;
  const isRec = rec.length === st.days.length && rec.every((d) => st.days.includes(d));
  const first = st.routines[0] ? st.routines[0].name : '';
  return `<h2 class="tw-h">Choose your training days</h2>
    ${dayChips()}
    <div class="tw-rec">${isRec ? `<span class="tw-badge">Recommended for ${esc(s.name)}</span>` : `<button class="tw-link" data-act="recommend">Use recommended: ${rec.map((d) => DAY_SHORT[d]).join(', ')}</button>`}</div>
    ${st.routines.length > 1 ? `<div class="tw-lbl">Each new week</div>
      <div class="tw-toggle" role="group" aria-label="Each new week">
        <button class="${st.rotation === 'continue' ? 'on' : ''}" data-act="rot" data-v="continue" aria-pressed="${st.rotation === 'continue'}">Continue the rotation</button>
        <button class="${st.rotation === 'reset' ? 'on' : ''}" data-act="rot" data-v="reset" aria-pressed="${st.rotation === 'reset'}">Restart at ${esc(first)}</button>
      </div>` : ''}
    ${startField('Plan starts')}
    ${st.days.length ? `<div class="tw-lbl">First week</div>${weekRows(plan, weekStart(st.startDate))}
      <div class="tw-lbl">Week after</div>${weekStrip(plan, addDays(weekStart(st.startDate), 7))}` : ''}`;
}

function step2() {
  const s = split();
  const used = new Set(usedRoutines().map((r) => r.id));
  if (!st.open || !routine(st.open)) st.open = (st.routines.find((r) => !r.exercises.length) || st.routines[0] || {}).id || null;
  return `<h2 class="tw-h">Build your workouts</h2>
    ${st.routines.map((r) => {
      const open = r.id === st.open;
      const starter = starterFor(r.name);
      const meta = !used.has(r.id) ? 'Not on any day' : r.exercises.length ? `${r.exercises.length} exercise${r.exercises.length === 1 ? '' : 's'}` : 'Needs exercises';
      return `<section class="tw-rt${open ? ' open' : ''}${used.has(r.id) && !r.exercises.length ? ' need' : ''}">
        <button class="tw-rt-h" data-act="ropen" data-id="${r.id}" aria-expanded="${open}">
          <span class="tw-rt-n" data-name-of="${r.id}">${esc(r.name || 'Workout')}</span><span class="tw-rt-m">${meta}</span>${ICON.chev}</button>
        ${open ? `<div class="tw-rt-b">
          <label class="tw-lbl" for="rn-${r.id}">Workout name</label>
          <input class="tw-in" id="rn-${r.id}" data-field="rname" data-id="${r.id}" value="${esc(r.name)}" autocomplete="off">
          ${r.exercises.map((x, i) => exRow(r, x, i)).join('')}
          <div class="tw-rt-acts">
            <button class="tw-btn2" data-act="xadd" data-id="${r.id}">＋ Add exercise</button>
            ${starter && !r.exercises.length ? `<button class="tw-btn2" data-act="starter" data-id="${r.id}">Use starter template</button>` : ''}
          </div>
          ${targetsPickerHtml(r, catalogue.entries)}
          ${sessionPanelHtml(r, catalogue)}
          ${s.variants && st.routines.length > 1 ? `<button class="tw-link danger" data-act="vdel" data-id="${r.id}">Remove ${esc(r.name || 'this workout')}</button>` : ''}
        </div>` : ''}
      </section>`;
    }).join('')}
    ${s.variants ? `<button class="tw-add" data-act="variant">＋ Add another ${s.id === 'custom' ? 'workout' : 'Full Body workout'}</button>
      ${s.id !== 'custom' && st.routines.length > 1 ? '<p class="tw-p small">Sessions rotate through these in order.</p>' : ''}` : ''}`;
}

function exRow(r, x, i) {
  const k = `data-rid="${r.id}" data-xid="${x.id}"`;
  const n = r.exercises.length;
  return `<div class="tw-x">
    <div class="tw-x-top">
      <span class="tw-x-n"><b>${i + 1}</b>${esc(x.name)}</span>
      <span class="tw-x-acts">
        <button class="tw-iconbtn sm" data-act="xup" ${k} ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(x.name)} up">${ICON.up}</button>
        <button class="tw-iconbtn sm" data-act="xdown" ${k} ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${esc(x.name)} down">${ICON.down}</button>
        <button class="tw-iconbtn sm" data-act="xdup" ${k} aria-label="Duplicate ${esc(x.name)}">${ICON.dup}</button>
        <button class="tw-iconbtn sm" data-act="xdel" ${k} aria-label="Remove ${esc(x.name)}">${ICON.trash}</button>
      </span>
    </div>
    <div class="tw-x-f">
      <label><span>Sets</span><input class="tw-num" type="number" inputmode="numeric" min="1" max="20" data-field="xsets" ${k} value="${esc(x.sets)}"></label>
      <label><span>Reps</span><span class="tw-range"><input class="tw-num" type="number" inputmode="numeric" min="1" max="100" data-field="xmin" ${k} value="${esc(x.repMin)}" aria-label="Minimum reps"><i>–</i><input class="tw-num" type="number" inputmode="numeric" min="1" max="100" data-field="xmax" ${k} value="${esc(x.repMax)}" aria-label="Maximum reps"></span></label>
      <label><span>RIR</span><input class="tw-num" type="number" inputmode="decimal" min="0" max="10" step="0.5" data-field="xrir" ${k} value="${esc(x.rir ?? '')}" placeholder="–"></label>
    </div>
    ${machineRowHtml(x, k)}
  </div>`;
}

// The machine for a planner row: its details when chosen, else a button.
function machineRowHtml(x, k) {
  if (x.machine) {
    return `<div class="tw-mc">${chosenHtml(x.machine, { attrs: `data-act="xmachine" ${k}`, compact: true })}
      <button class="tw-link" data-act="xmachine-clear" ${k}>Remove machine</button></div>`;
  }
  const n = machineDb.exactCount(x.name);
  return `<button class="tw-mc-add" data-act="xmachine" ${k}>＋ Choose machine${n ? `<span>${n} in the database for this exercise</span>` : ''}</button>`;
}
function setMachine(x, sel) {
  if (sel) { x.machine = sel.snapshot; x.catalogId = recordId(sel.id, sel.mode); }
  else { delete x.machine; delete x.catalogId; }
}

function step3() {
  const s = split();
  const plan = buildPlan();
  const issue = firstIssue();
  const sched = s.mode === 'eod'
    ? `<div class="tw-list">${eodList(plan)}</div>`
    : `${weekRows(plan, weekStart(plan.startDate))}<div class="tw-lbl">Week after</div>${weekStrip(plan, addDays(weekStart(plan.startDate), 7))}`;
  return `<h2 class="tw-h">Review your plan</h2>
    <dl class="tw-sum">
      <div><dt>Split</dt><dd>${esc(plan.name)}</dd></div>
      <div><dt>Frequency</dt><dd>${esc(frequencyLabel(plan))}</dd></div>
      <div><dt>Starts</dt><dd>${isDate(plan.startDate) ? esc(fmtDate(plan.startDate, { weekday: 'long', month: 'long', day: 'numeric' })) : '–'}</dd></div>
      ${s.mode === 'weekly' && plan.routines.length > 1 ? `<div><dt>New weeks</dt><dd>${plan.rotation === 'reset' ? `Restart at ${esc(plan.routines[0].name)}` : 'Continue the rotation'}</dd></div>` : ''}
    </dl>
    <div class="tw-lbl tw-lbl-row">Schedule <button class="tw-link" data-act="goto" data-step="1">Edit</button></div>
    ${isDate(plan.startDate) ? sched : ''}
    <div class="tw-lbl tw-lbl-row">Workouts <button class="tw-link" data-act="goto" data-step="2">Edit</button></div>
    ${plan.routines.map((r) => `<div class="tw-rv">
      <div class="tw-rv-h">${esc(r.name)}</div>
      ${r.exercises.length ? `<ul>${r.exercises.map((x) => `<li><span>${esc(x.name)}${x.machine ? `<small class="tw-rv-mc">${esc([x.machine.brand, x.machine.name, x.machine.model].filter(Boolean).join(' · '))}</small>` : ''}</span><span>${x.sets} × ${esc(repText(x))}${x.rir != null ? ` · ${x.rir} RIR` : ''}</span></li>`).join('')}</ul>` : '<p class="tw-p small">No exercises yet</p>'}
    </div>`).join('')}
    <div class="tw-lbl">Overlap &amp; coverage</div>
    ${planPanelHtml(plan, catalogue, sessionsPerWeek(plan))}
    ${issue ? `<p class="tw-warn">${esc(issue.msg)} <button class="tw-link" data-act="goto" data-step="${issue.step}">Fix</button></p>` : ''}
    ${st.editing ? `<button class="tw-link danger end" data-act="end">${st.confirmEnd ? 'Tap again to end this plan' : 'End this plan'}</button>` : ''}`;
}

/** Sessions per routine in a typical week (the first full week after the start). */
function sessionsPerWeek(plan) {
  const out = {};
  if (!isDate(plan.startDate)) return out;
  for (const d of previewWeek(plan, addDays(weekStart(plan.startDate), 7))) if (d.routine) out[d.routine.id] = (out[d.routine.id] || 0) + 1;
  return out;
}

function eodList(plan) {
  const out = [];
  for (let i = 0; out.length < 8 && i < 40; i++) {
    const d = addDays(plan.startDate, i);
    const s = sessionOn(plan, d);
    if (s) out.push(`<div class="tw-li"><span>${esc(fmtDate(d))}</span><b>${esc(s.routine.name)}</b></div>`);
  }
  return out.join('');
}

// ── Events ──────────────────────────────────────────────────────────────
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !root.contains(el)) return;
  const act = el.dataset.act, id = el.dataset.id;
  const r = id ? routine(id) : null;
  const x = el.dataset.xid ? routine(el.dataset.rid)?.exercises : null;
  const xi = x ? x.findIndex((v) => v.id === el.dataset.xid) : -1;
  st.error = '';
  if (act !== 'end') st.confirmEnd = false;

  switch (act) {
    case 'close': close(); return;
    case 'back': st.step = Math.max(0, st.step - 1); render(false); break;
    case 'next': {
      const msg = stepIssue(st.step);
      if (msg) { st.error = msg; render(); return; }
      st.step++; st.maxStep = Math.max(st.maxStep, st.step); render(false); break;
    }
    case 'goto': st.step = Number(el.dataset.step); render(false); break;
    case 'split': setSplit(id); render(); break;
    case 'radd': st.routines.push(newRoutine(`Workout ${String.fromCharCode(65 + st.routines.length)}`)); render(); focusLast('[data-field="rname"]'); break;
    case 'rdel': removeRoutine(id); render(); break;
    case 'day': toggleDay(Number(el.dataset.d)); render(); break;
    case 'recommend': st.days = split().days.slice(); render(); break;
    case 'rot': st.rotation = el.dataset.v; render(); break;
    case 'ropen': st.open = st.open === id ? '' : id; render(); break;
    case 'xadd':
      if (opts.pickExercise) opts.pickExercise((name, sel) => { if (!name || !r) return; const nx = newExercise(name); setMachine(nx, sel); r.exercises.push(nx); saveDraft(); render(); });
      return;
    case 'starter': if (r && !r.exercises.length) { r.exercises = starterFor(r.name).map((s) => newExercise(s.name, s)); } render(); break;
    case 'xmachine': {
      const rid = el.dataset.rid, xid = el.dataset.xid;
      const cur = x && xi >= 0 ? x[xi] : null;
      if (!cur || !opts.pickMachine) return;
      opts.pickMachine(cur.name, cur.machine ? { id: cur.machine.id, mode: cur.machine.mode } : null, (sel) => {
        const target = routine(rid)?.exercises.find((q) => q.id === xid); if (!target) return;
        setMachine(target, sel); saveDraft(); render();
      });
      return;
    }
    case 'xmachine-clear': if (xi >= 0) setMachine(x[xi], null); render(); break;
    case 'xup': if (xi > 0) [x[xi - 1], x[xi]] = [x[xi], x[xi - 1]]; render(); break;
    case 'xdown': if (xi >= 0 && xi < x.length - 1) [x[xi + 1], x[xi]] = [x[xi], x[xi + 1]]; render(); break;
    case 'xdup': if (xi >= 0) x.splice(xi + 1, 0, { ...x[xi], id: 'x-' + uid() }); render(); break;
    case 'xdel': if (xi >= 0) x.splice(xi, 1); render(); break;
    case 'variant': {
      addVariant(); render();
      const opened = root.querySelector('.tw-rt.open');
      if (opened) opened.scrollIntoView({ block: 'start', behavior: 'smooth' });
      break;
    }
    case 'vdel': removeRoutine(id); render(); break;
    case 'save': save(); return;
    case 'end':
      if (!st.confirmEnd) { st.confirmEnd = true; render(); return; }
      endPlan(localKey()); clearDraft(); close(true); if (opts.onDone) opts.onDone({ ended: true }); return;
    default: return;
  }
  saveDraft();
}

function onInput(e) {
  const el = e.target;
  const f = el.dataset && el.dataset.field;
  if (!f) return;
  const v = el.value;
  if (f === 'name') st.name = v;
  else if (f === 'rname') {
    const r = routine(el.dataset.id); if (!r) return;
    r.name = v;
    const label = root.querySelector(`[data-name-of="${r.id}"]`); if (label) label.textContent = v || 'Workout';
  } else if (f === 'startDate') { if (e.type !== 'change' || !isDate(v)) return; st.startDate = v; saveDraft(); render(); return; }
  else if (f === 'assign') { if (e.type !== 'change') return; st.assignments[el.dataset.d] = v; saveDraft(); render(); return; }
  else if (f === 'rtarget') {
    if (e.type !== 'change') return;
    const r = routine(el.dataset.id); if (!r) return;
    const set = new Set(r.targets || []);
    if (el.checked) set.add(v); else set.delete(v);
    r.targets = catalogue.entries.map((x) => x.id).filter((id) => set.has(id));
    saveDraft(); render(); return;
  } else {
    const r = routine(el.dataset.rid); const x = r && r.exercises.find((q) => q.id === el.dataset.xid); if (!x) return;
    const key = { xsets: 'sets', xmin: 'repMin', xmax: 'repMax', xrir: 'rir' }[f];
    if (key) x[key] = v === '' ? '' : Number(v);
  }
  saveDraft();
}

function toggleDay(d) {
  const s = split();
  if (s.mode === 'custom') {
    if (st.assignments[d] && routine(st.assignments[d])) delete st.assignments[d];
    else st.assignments[d] = st.routines[assignedDays().length % st.routines.length].id;
    return;
  }
  st.days = st.days.includes(d) ? st.days.filter((x) => x !== d) : st.days.concat(d).sort((a, b) => a - b);
}

function addVariant() {
  const s = split();
  if (s.id === 'custom') { st.routines.push(newRoutine(`Workout ${String.fromCharCode(65 + st.routines.length)}`)); return; }
  // Full Body → Full Body A, B, C …
  if (st.routines.length === 1 && st.routines[0].name === 'Full Body') st.routines[0].name = 'Full Body A';
  const r = newRoutine(`Full Body ${String.fromCharCode(65 + st.routines.length)}`);
  st.routines.push(r);
  st.open = r.id;
}

function removeRoutine(id) {
  if (st.routines.length <= 1) return;
  st.routines = st.routines.filter((r) => r.id !== id);
  for (const d of Object.keys(st.assignments)) if (st.assignments[d] === id) delete st.assignments[d];
  if (st.open === id) st.open = null;
}

function focusLast(sel) {
  const all = root.querySelectorAll(sel);
  const el = all[all.length - 1];
  if (el) { el.focus(); el.select && el.select(); }
}

function save() {
  const issue = firstIssue();
  if (issue) { st.step = issue.step; st.error = issue.msg; render(false); return; }
  const plan = buildPlan();
  const store = commitPlan(plan, localKey());
  clearDraft();
  close(true);
  if (opts.onDone) opts.onDone({ store, plan, edited: st && st.editing });
}

function onKey(e) { if (e.key === 'Escape' && root && !document.querySelector('.modal-bk.open')) close(); }

// ── Public API ──────────────────────────────────────────────────────────
/**
 * Open the setup flow. `plan` (optional) edits an existing plan.
 * opts: { pickExercise(cb(name, machine)), pickMachine(exercise, current, cb(machine|null)),
 *         onDone({store, plan, ended}), onClose() }
 */
export function openPlanWizard(plan, options = {}) {
  opts = options;
  const draft = readDraft();
  if (plan) st = draft && draft.editing && draft.planId === plan.planId ? { ...blank(), ...draft } : fromPlan(plan);
  else st = draft && !draft.editing ? { ...blank(), ...draft } : blank();
  st.error = ''; st.confirmEnd = false;
  if (!root) {
    root = document.createElement('div');
    root.className = 'tw';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'tw-title');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
  }
  document.documentElement.classList.add('tw-lock');
  render(false);
  const t = root.querySelector('.tw-title'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); }
}

/** Whether a new-plan draft is waiting to be finished. */
export function hasPlanDraft() { const d = readDraft(); return !!(d && !d.editing && d.splitId); }

export function discardPlanDraft() { clearDraft(); }

function close(done) {
  if (!root) return;
  root.remove();
  root = null;
  document.removeEventListener('keydown', onKey);
  document.documentElement.classList.remove('tw-lock');
  if (!done && opts.onClose) opts.onClose();
}
