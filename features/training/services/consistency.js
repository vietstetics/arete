// Training consistency — pure functions over completed workouts and the
// versioned plan store. The heatmap, the Train screen and the dashboard all
// read through here, with the scheduler in schedule.js as the single source
// of truth for what was expected.
//
// Rules:
// • Only finished sessions count (completedAt set). Opening a workout or
//   ticking a set never counts.
// • Sample workouts the app seeds for first-time users (ids 'mock-…') are
//   not the user's training and are ignored.
// • A scheduled slot is done when a finished session was started for that
//   slot (scheduledFor), or when an unplanned session was logged in Arete on
//   that date. Extra sessions never inflate the count, and one session can
//   only satisfy one slot.
// • Rest days are never expected, so they can't be missed.

import { addDays, diffDays, localKey, scheduledOn, sessionsBetween, weekStart } from './schedule.js';

export function isRealWorkout(w) {
  return !!(w && w.completedAt && !String(w.id || '').startsWith('mock-'));
}

/** Local calendar date a workout was finished on. */
export function workoutDate(w) {
  return w.date || localKey(w.completedAt);
}

function workingSetsDone(w) {
  return (w.exercises || []).reduce((n, e) => n + (e.sets || []).filter((s) => s.type !== 'warmup' && s.completed).length, 0);
}

/**
 * Finished sessions grouped by local date:
 * { 'YYYY-MM-DD': { count, sets, workouts: [{ id, name, sets }] } }.
 * Several sessions on one date stay one calendar day with count > 1.
 */
export function dayMap(workouts) {
  const out = {};
  const seen = new Set();
  for (const w of workouts || []) {
    if (!isRealWorkout(w) || seen.has(w.id)) continue;
    seen.add(w.id);
    const k = workoutDate(w);
    const d = out[k] || (out[k] = { count: 0, sets: 0, workouts: [] });
    const sets = workingSetsDone(w);
    d.count++;
    d.sets += sets;
    d.workouts.push({ id: w.id, name: w.name || 'Workout', sets, imported: !!w.imported, scheduledFor: w.scheduledFor || null });
  }
  return out;
}

/** Index of finished sessions for slot matching. */
function slotIndex(workouts) {
  const byScheduled = new Map(); // scheduledFor → session name
  const byDate = new Set();
  for (const w of workouts || []) {
    if (!isRealWorkout(w)) continue;
    if (w.scheduledFor) { if (!byScheduled.has(w.scheduledFor)) byScheduled.set(w.scheduledFor, w.name || 'Workout'); }
    else if (!w.imported) byDate.add(workoutDate(w));
  }
  return { has: (date) => byScheduled.has(date) || byDate.has(date), planned: byScheduled };
}

/**
 * Expected vs completed scheduled sessions for the Sunday–Saturday week
 * containing `anyDayInWeek`. `expected` covers the whole week (so the rate
 * updates the moment a session is finished); `due` counts only days up to
 * and including today.
 */
export function weekSummary(store, workouts, anyDayInWeek, today, idx = slotIndex(workouts)) {
  const start = weekStart(anyDayInWeek);
  const end = addDays(start, 6);
  const slots = sessionsBetween(store, start, end).map((s) => ({ date: s.date, routine: s.routine.name, done: idx.has(s.date) }));
  // A session finished for a slot that a later plan edit removed was still
  // scheduled and completed at the time — it keeps counting.
  const dates = new Set(slots.map((s) => s.date));
  for (const [date, name] of idx.planned) {
    if (date >= start && date <= end && !dates.has(date)) slots.push({ date, routine: name, done: true });
  }
  slots.sort((a, b) => (a.date < b.date ? -1 : 1));
  let done = 0, due = 0;
  for (const s of slots) {
    if (s.date <= today) due++;
    if (s.done) done++;
  }
  return {
    start, end,
    expected: slots.length,
    done,
    due,
    pct: slots.length ? done / slots.length : null,
    finished: end < today,
    slots,
  };
}

/** The last `n` weeks (oldest first), ending with the current week. */
export function recentWeeks(store, workouts, today, n = 8) {
  const idx = slotIndex(workouts);
  const thisWeek = weekStart(today);
  return Array.from({ length: n }, (_, i) => weekSummary(store, workouts, addDays(thisWeek, -7 * (n - 1 - i)), today, idx));
}

/**
 * Completion over the last `weeks` finished weeks that had something
 * scheduled. A brand-new plan with no finished week yet falls back to the
 * current week's sessions due so far.
 */
export function adherence(store, workouts, today, weeks = 4) {
  const idx = slotIndex(workouts);
  let done = 0, expected = 0, counted = 0;
  for (let i = 1; i <= 52 && counted < weeks; i++) {
    const w = weekSummary(store, workouts, addDays(weekStart(today), -7 * i), today, idx);
    if (!w.expected) continue;
    done += w.done; expected += w.expected; counted++;
  }
  if (!counted) {
    const cur = weekSummary(store, workouts, today, today, idx);
    const doneSoFar = cur.slots.filter((s) => s.date <= today && s.done).length;
    return { done: doneSoFar, expected: cur.due, pct: cur.due ? doneSoFar / cur.due : null, weeks: 0 };
  }
  return { done, expected, pct: done / expected, weeks: counted };
}

/**
 * Consecutive scheduled sessions completed, counting back from today.
 * Today's session doesn't break the streak until the day is over.
 */
export function sessionStreak(store, workouts, today, lookback = 400) {
  const idx = slotIndex(workouts);
  let streak = 0;
  for (let i = 0; i < lookback; i++) {
    const date = addDays(today, -i);
    const s = scheduledOn(store, date);
    if (!s) continue;
    if (idx.has(date)) streak++;
    else if (date === today) continue;
    else break;
  }
  return streak;
}

/**
 * Heatmap shade (1–4) for a workout day from its week's completion rate.
 * null (nothing scheduled that week, e.g. no plan) gets a steady medium.
 */
export function shadeLevel(pct) {
  if (pct == null) return 3;
  return pct >= 1 ? 4 : pct >= 0.75 ? 3 : pct >= 0.5 ? 2 : 1;
}

/**
 * Every finished-workout date shaded by how much of that week's plan was
 * done: { 'YYYY-MM-DD': { level, done, expected } }. Each week is judged
 * against the plan version in force then, and the current week against its
 * whole schedule, so it darkens as sessions are finished.
 */
export function dayShades(store, workouts, today) {
  const idx = slotIndex(workouts);
  const weeks = new Map();
  const out = {};
  for (const k of Object.keys(dayMap(workouts))) {
    const ws = weekStart(k);
    let w = weeks.get(ws);
    if (!w) { w = weekSummary(store, workouts, ws, today, idx); weeks.set(ws, w); }
    out[k] = { level: shadeLevel(w.pct), done: w.done, expected: w.expected };
  }
  return out;
}

/** Days since the most recent finished session, or null if none. */
export function daysSinceLast(workouts, today) {
  let last = null;
  for (const w of workouts || []) {
    if (!isRealWorkout(w)) continue;
    const k = workoutDate(w);
    if (!last || k > last) last = k;
  }
  return last ? diffDays(last, today) : null;
}

/** Is the slot on `date` completed? */
export function slotDone(workouts, date) {
  return slotIndex(workouts).has(date);
}
