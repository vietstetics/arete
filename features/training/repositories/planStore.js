// Persistence for training plans. Uses the app's existing convention:
// localStorage keys prefixed `jarvis_`, which js/auth.js mirrors to the
// signed-in user's cloud row when accounts are configured.

import { currentPlan } from '../services/schedule.js';

const PLAN_KEY = 'jarvis_training_plan';
const WORKOUTS_KEY = 'jarvis_workouts';

function storage() { return globalThis.localStorage; }
function read(key, fallback) {
  try { const v = JSON.parse(storage().getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
}

export function loadStore() {
  const s = read(PLAN_KEY, null);
  return s && Array.isArray(s.versions) ? s : { versions: [] };
}

export function saveStore(store) {
  storage().setItem(PLAN_KEY, JSON.stringify(store));
}

/** All logged workouts (completed and planned), as stored by js/fitness.js. */
export function loadWorkouts() {
  return read(WORKOUTS_KEY, []);
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Store a plan as the version in force from `today`. Editing a plan twice on
 * the same day replaces that day's version instead of piling up versions.
 * Returns the updated store (also persisted).
 */
export function commitPlan(plan, today, store = loadStore()) {
  const version = { ...plan, id: 'pv-' + uid(), planId: plan.planId || 'plan-' + uid(), effectiveFrom: today, createdAt: Date.now() };
  delete version.endsOn;
  const next = { versions: store.versions.filter((v) => !(v.effectiveFrom === today && v.planId === version.planId)).concat(version) };
  saveStore(next);
  return next;
}

/** End the plan in force: nothing is scheduled from `today` on. */
export function endPlan(today, store = loadStore()) {
  const cur = currentPlan(store, today);
  const next = { versions: store.versions.map((v) => (cur && v.id === cur.id ? { ...v, endsOn: today } : v)) };
  saveStore(next);
  return next;
}
