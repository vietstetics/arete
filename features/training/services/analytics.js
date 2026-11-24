// Training analytics: plans → exercises → weight progression → bar speed at one weight.
// Pure: reads the plan store, finished workouts and camera records it is given; no DOM, no storage.
import { setSpeed, READINESS } from '../../velocity/services/readiness.js';

export const exerciseKey = (name) => (typeof name === 'string' && name.trim() ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : null);
const real = (workouts) => (workouts || []).filter((w) => w && w.completedAt && w.status !== 'planned' && !String(w.id).startsWith('mock-'));
const num = (v) => (v !== '' && v != null && Number.isFinite(+v) ? +v : null);
const sameLoad = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(READINESS.minLoadKg, READINESS.loadTol * b);
export const OUTSIDE = 'outside';

/**
 * Every plan the user has had, newest first, plus the workouts done outside any plan.
 * [{ id, name, current, from, sessions, exercises: [name] }]
 */
export function plansFromStore(store, workouts, today) {
  const done = real(workouts);
  const byPlan = new Map();
  for (const v of (store && store.versions) || []) {
    const p = byPlan.get(v.planId) || { id: v.planId, versions: [] };
    p.versions.push(v); byPlan.set(v.planId, p);
  }
  let currentId = null, best = null;
  for (const v of (store && store.versions) || []) {
    if (v.effectiveFrom > today) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && (v.createdAt || 0) > (best.createdAt || 0))) best = v;
  }
  if (best && !(best.endsOn && today >= best.endsOn)) currentId = best.planId;
  const out = [...byPlan.values()].map((p) => {
    const vs = p.versions.slice().sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1) || (a.createdAt || 0) - (b.createdAt || 0));
    const latest = vs[vs.length - 1];
    const names = [], seen = new Set();
    for (const v of vs.slice().reverse()) for (const r of v.routines || []) for (const x of r.exercises || []) {
      const k = exerciseKey(x.name); if (k && !seen.has(k)) { seen.add(k); names.push(x.name); }
    }
    return { id: p.id, name: latest.name || 'Plan', current: p.id === currentId, from: vs[0].effectiveFrom,
      sessions: done.filter((w) => w.planId === p.id).length, exercises: names };
  }).sort((a, b) => (b.current - a.current) || (a.from < b.from ? 1 : -1));
  const outside = [], seen = new Set();
  for (const w of done) if (!w.planId) for (const e of w.exercises || []) {
    const k = exerciseKey(e.name); if (k && !seen.has(k) && (e.sets || []).some((s) => s.completed)) { seen.add(k); outside.push(e.name); }
  }
  if (outside.length) out.push({ id: OUTSIDE, name: 'Workouts outside a plan', current: false, from: null, sessions: done.filter((w) => !w.planId).length, exercises: outside });
  return out;
}

/** Per-exercise summary across all of the user's sessions: { name, sessions, last: { weight, reps, at } | null }. */
export function exerciseSummary(name, workouts) {
  const key = exerciseKey(name);
  let sessions = 0, last = null;
  for (const w of real(workouts)) {
    const sets = (w.exercises || []).filter((e) => exerciseKey(e.name) === key).flatMap((e) => (e.sets || []).filter((s) => s.completed && s.type !== 'warmup'));
    if (!sets.length) continue;
    sessions++;
    const top = sets.reduce((a, s) => ((num(s.weight) ?? -1) > (num(a.weight) ?? -1) ? s : a), sets[0]);
    if (!last || w.completedAt > last.at) last = { weight: num(top.weight), reps: num(top.reps), at: w.completedAt };
  }
  return { name, sessions, last };
}

// Every camera-tracked set of an exercise: in-workout takes and standalone records, once each.
function trackedSets(name, workouts, records) {
  const key = exerciseKey(name), out = [], seen = new Set();
  for (const w of real(workouts)) for (const e of w.exercises || []) {
    if (exerciseKey(e.name) !== key) continue;
    for (const s of e.sets || []) {
      const r = s.velocity; if (!r || !r.id || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ record: r, loadKg: num(r.loadKg) ?? num(s.weight), at: Number.isFinite(r.at) ? r.at : s.completedAt || w.completedAt, session: String(w.id), equipmentKey: r.equipmentKey || null });
    }
  }
  for (const r of records || []) {
    if (!r || !r.id || seen.has(r.id) || exerciseKey(r.exercise) !== key) continue;
    seen.add(r.id);
    const day = new Date(r.at); const session = 'day-' + day.getFullYear() + '-' + (day.getMonth() + 1) + '-' + day.getDate();
    out.push({ record: r, loadKg: num(r.loadKg), at: r.at, session, equipmentKey: r.equipmentKey || null });
  }
  return out.filter((x) => Number.isFinite(x.at));
}

/** Weights this exercise was camera-tracked at, heaviest first: [{ loadKg, sets, sessions }]. */
export function trackedWeights(name, workouts, records) {
  const groups = [];
  for (const x of trackedSets(name, workouts, records).filter((t) => Number.isFinite(t.loadKg)).sort((a, b) => b.loadKg - a.loadKg)) {
    const g = groups.find((y) => sameLoad(x.loadKg, y.loadKg));
    if (g) { g.sets++; g.sessions.add(x.session); } else groups.push({ loadKg: x.loadKg, sets: 1, sessions: new Set([x.session]) });
  }
  return groups.map((g) => ({ loadKg: g.loadKg, sets: g.sets, sessions: g.sessions.size }));
}

/**
 * Bar speed at one weight over time: one point per session (its first set at that weight, the freshest),
 * m/s only. { points: [{ at, speed, recordId }], relative: [records], change: { from, to, pct, since } | null, reason }.
 */
export function speedAtWeight(name, loadKg, workouts, records) {
  const at = trackedSets(name, workouts, records).filter((x) => sameLoad(x.loadKg, loadKg)).sort((a, b) => a.at - b.at);
  const firstPerSession = new Map(), relative = [];
  for (const x of at) {
    const v = setSpeed(x.record);
    if (!Number.isFinite(v)) { if (x.record.units !== 'm/s') relative.push(x); continue; }
    if (!firstPerSession.has(x.session)) firstPerSession.set(x.session, { at: x.at, speed: v, recordId: x.record.id, record: x.record });
  }
  const points = [...firstPerSession.values()].sort((a, b) => a.at - b.at);
  let change = null, reason = null;
  if (points.length >= 2) {
    const a = points[0], b = points[points.length - 1];
    change = { from: a.speed, to: b.speed, pct: (b.speed / a.speed - 1) * 100, since: a.at };
  } else {
    reason = points.length
      ? 'One session at this weight so far: track it again and the trend shows here.'
      : relative.length
        ? 'These sets were tracked without your height, so their speeds can’t be compared between sessions. Add your height on the camera screen.'
        : 'No camera-tracked sets at this weight yet.';
  }
  return { points, relative, change, reason };
}
