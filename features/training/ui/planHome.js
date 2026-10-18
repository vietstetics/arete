// The plan card at the top of the Train screen: the next scheduled workout
// with its exercises and a Start button, this week at a glance, and what's
// coming up. Without a plan it offers to create one.

import { currentPlan, scheduledOn, nextSessions, weekStart, addDays, localKey, DAY_SHORT, repText, frequencyLabel } from '../services/schedule.js';
import { weekSummary, slotDone } from '../services/consistency.js';
import { loadStore, loadWorkouts } from '../repositories/planStore.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (k, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(k + 'T12:00:00').toLocaleDateString(undefined, o);
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';

/**
 * ctx: { onStart(session), onCreate(), onEdit(plan), hasDraft, secondary }
 * session = { date, plan, routine }
 * `secondary` — another workout is already in progress, so Start isn't the
 * screen's main action and is drawn as a secondary button.
 */
export function renderPlanHome(host, ctx) {
  const today = localKey();
  const store = loadStore();
  const workouts = loadWorkouts();
  const plan = currentPlan(store, today);

  if (!plan) {
    host.innerHTML = `<section class="card tp tp-empty">
      <div class="tp-eye">Training plan</div>
      <h3 class="tp-h">Plan your week once. Arete schedules every session.</h3>
      <button class="btn btn-p tp-cta" data-act="create">${ctx.hasDraft ? 'Continue setting up your plan' : 'Create training plan'}</button>
    </section>`;
    bind(host, ctx, null, {});
    return;
  }

  const todays = scheduledOn(store, today);
  // Done covers today's slot, or a session logged today on a day the plan rests.
  const todayDone = slotDone(workouts, today);
  const upcoming = nextSessions(store, addDays(today, 1), 4);
  const focus = todays && !todayDone ? todays : upcoming[0] || null;
  const isToday = focus && focus.date === today;
  const week = weekSummary(store, workouts, today, today);
  const sessions = { focus };
  upcoming.forEach((s, i) => { sessions['u' + i] = s; });

  let eye, title, sub;
  if (isToday) { eye = 'Today'; title = focus.routine.name; sub = fmt(today, { weekday: 'long', month: 'long', day: 'numeric' }); }
  else if (todayDone) { eye = 'Today · done'; title = todays ? `${todays.routine.name} complete` : 'Workout logged'; sub = focus ? `Up next: ${focus.routine.name}, ${fmt(focus.date)}` : ''; }
  else if (plan.startDate > today) { eye = `Starts ${fmt(plan.startDate)}`; title = focus ? focus.routine.name : plan.name; sub = focus ? fmt(focus.date, { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }
  else { eye = 'Rest day'; title = focus ? `Next: ${focus.routine.name}` : 'Rest day'; sub = focus ? fmt(focus.date, { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }

  const exs = focus ? focus.routine.exercises : [];
  const strip = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart(today), i);
    const s = scheduledOn(store, date);
    const done = slotDone(workouts, date);
    const state = done ? 'done' : !s ? 'rest' : date < today ? 'missed' : 'planned';
    const label = `${fmt(date, { weekday: 'long' })}: ${s ? s.routine.name : done ? 'workout' : 'rest'}${done ? ', done' : state === 'missed' ? ', missed' : ''}`;
    return `<div class="tp-d ${state}${date === today ? ' today' : ''}" title="${esc(label)}" aria-label="${esc(label)}">
      <span class="tp-dl">${DAY_SHORT[i].slice(0, 1)}</span><span class="tp-dm">${done ? CHECK : ''}</span></div>`;
  }).join('');

  const later = upcoming.filter((s) => !focus || s.date !== focus.date).slice(0, 3);

  host.innerHTML = `<section class="card tp${todayDone ? ' is-done' : ''}">
    <div class="tp-top">
      <div class="tp-eye">${esc(plan.name)} · ${esc(frequencyLabel(plan))}</div>
      <button class="tp-edit" data-act="edit">Edit plan</button>
    </div>
    <div class="tp-head">
      ${todayDone ? `<span class="tp-badge">${CHECK}</span>` : ''}
      <div><div class="tp-when">${esc(eye)}</div><h3 class="tp-h">${esc(title)}</h3>${sub ? `<div class="tp-sub">${esc(sub)}</div>` : ''}</div>
    </div>
    ${exs.length ? `<ul class="tp-ex">${exs.map((x) => `<li><span>${esc(x.name)}</span><span>${x.sets} × ${esc(repText(x))}${x.rir != null ? ` · ${x.rir} RIR` : ''}</span></li>`).join('')}</ul>` : ''}
    ${focus ? `<button class="btn ${isToday && !ctx.secondary ? 'btn-p' : 'btn-s'} tp-cta" data-act="start" data-s="focus">${isToday ? PLAY + ' Start Workout' : 'Start early'}</button>` : ''}
    <div class="tp-week">
      <div class="tp-strip">${strip}</div>
      <div class="tp-wk"><b>${week.done} of ${week.expected}</b> this week${week.expected ? ` · ${Math.round((week.done / week.expected) * 100)}%` : ''}</div>
    </div>
    ${later.length ? `<div class="tp-up">${later.map((s) => {
      const i = upcoming.indexOf(s);
      return `<button class="tp-ur" data-act="start" data-s="u${i}" aria-label="Start ${esc(s.routine.name)} early"><span>${esc(fmt(s.date))}</span><b>${esc(s.routine.name)}</b><em>Start</em></button>`;
    }).join('')}</div>` : ''}
  </section>`;
  bind(host, ctx, plan, sessions);
}

/**
 * The Plan tab: the whole plan at a glance — this week day by day, the
 * workouts it rotates through, and Edit. Without a plan, the one action is
 * to create it. ctx: { onCreate(), onEdit(plan), onStart(session), hasDraft }
 */
export function renderPlanOverview(host, ctx) {
  const today = localKey();
  const store = loadStore();
  const workouts = loadWorkouts();
  const plan = currentPlan(store, today);
  if (!plan) {
    host.innerHTML = `<section class="card po po-empty">
      <div class="po-eye">Your training plan</div>
      <h3 class="po-h">Plan your week once</h3>
      <p class="po-p">Choose a split, pick your training days and build each workout. Arete then puts the right session on the Today tab every day and tracks your week.</p>
      <button class="btn btn-p po-cta" data-act="create">${ctx.hasDraft ? 'Continue setting up your plan' : 'Create training plan'}</button>
    </section>`;
    bind(host, ctx, null, {});
    return;
  }
  const week = weekSummary(store, workouts, today, today);
  const sessions = {};
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart(today), i);
    const s = scheduledOn(store, date);
    const done = slotDone(workouts, date);
    const state = done ? 'done' : !s ? 'rest' : date < today ? 'missed' : date === today ? 'today' : 'planned';
    if (s && !done && date >= today) sessions['d' + i] = s;
    const status = done ? 'Done' : state === 'missed' ? 'Missed' : state === 'today' ? 'Today' : '';
    return `<div class="po-day ${state}${date === today ? ' is-today' : ''}">
      <span class="po-dn">${esc(DAY_SHORT[i])}<small>${esc(fmt(date, { day: 'numeric' }))}</small></span>
      <span class="po-dw">${s ? esc(s.routine.name) : done ? 'Workout' : 'Rest'}</span>
      ${status ? `<span class="po-ds">${done ? CHECK : ''}${status}</span>` : sessions['d' + i] ? `<button class="po-go" data-act="start" data-s="d${i}">Start</button>` : '<span></span>'}
    </div>`;
  }).join('');
  const routines = plan.routines.map((r) => `<details class="po-rt">
      <summary><b>${esc(r.name)}</b><span>${r.exercises.length} exercise${r.exercises.length === 1 ? '' : 's'}</span></summary>
      <ul>${r.exercises.map((x) => `<li><span>${esc(x.name)}${x.machine ? `<small>${esc([x.machine.brand, x.machine.name].join(' · '))}</small>` : ''}</span><span>${x.sets} × ${esc(repText(x))}${x.rir != null ? ` · ${x.rir} RIR` : ''}</span></li>`).join('')}</ul>
    </details>`).join('');
  host.innerHTML = `<section class="card po">
    <div class="po-top">
      <div><div class="po-eye">Your training plan</div><h3 class="po-h">${esc(plan.name)}</h3>
        <div class="po-sub">${esc(frequencyLabel(plan))} · <b>${week.done} of ${week.expected}</b> done this week</div></div>
      <button class="btn btn-s btn-sm" data-act="edit">Edit plan</button>
    </div>
    <div class="po-lbl">This week</div>
    <div class="po-week">${days}</div>
    <div class="po-lbl">Workouts in this plan</div>
    <div class="po-rts">${routines}</div>
  </section>`;
  bind(host, ctx, plan, sessions);
}

function bind(host, ctx, plan, sessions) {
  host.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'create') ctx.onCreate();
    else if (el.dataset.act === 'edit') ctx.onEdit(plan);
    else if (el.dataset.act === 'start') {
      const s = sessions[el.dataset.s];
      if (s) ctx.onStart({ date: s.date, plan: s.plan, routine: s.routine });
    }
  };
}
