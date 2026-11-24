import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plansFromStore, exerciseSummary, trackedWeights, speedAtWeight, OUTSIDE } from '../services/analytics.js';

const D = (d) => Date.UTC(2026, 9, d, 9);
const rec = (id, at, mcv, extra = {}) => ({ id, at, units: 'm/s', loadKg: 100, reps: [{ n: 1, result: 'counted', velocity: 'ok', mcv }], ...extra });
const wk = (id, d, exercises, extra = {}) => ({ id, completedAt: D(d), exercises, ...extra });
const sq = (sets) => ({ name: 'Back Squat', sets });
const s = (weight, reps, extra = {}) => ({ type: 'working', weight, reps, completed: true, ...extra });

const store = { versions: [
  { planId: 'A', name: 'Old plan', effectiveFrom: '2026-09-01', createdAt: 1, routines: [{ exercises: [{ name: 'Bench Press' }] }] },
  { planId: 'B', name: 'Strength', effectiveFrom: '2026-10-01', createdAt: 2, routines: [{ exercises: [{ name: 'Back Squat' }, { name: 'Bench Press' }] }] },
  { planId: 'B', name: 'Strength block', effectiveFrom: '2026-10-15', createdAt: 3, routines: [{ exercises: [{ name: 'Back Squat' }, { name: 'Deadlift' }] }] },
] };

test('plans: current first with its latest name and every exercise it had; outside-plan workouts listed too', () => {
  const workouts = [wk('w1', 2, [sq([s(100, 5)])], { planId: 'B' }), wk('w2', 3, [{ name: 'Curl', sets: [s(15, 10)] }]), wk('mock-1', 4, [{ name: 'Mock', sets: [s(1, 1)] }])];
  const p = plansFromStore(store, workouts, '2026-10-20');
  assert.deepEqual(p.map((x) => x.id), ['B', 'A', OUTSIDE]);
  assert.equal(p[0].name, 'Strength block'); assert.equal(p[0].current, true); assert.equal(p[0].sessions, 1);
  assert.deepEqual(p[0].exercises, ['Back Squat', 'Deadlift', 'Bench Press']);
  assert.deepEqual(p[2].exercises, ['Curl'], 'sample data is never shown');
});

test('exercise summary: sessions and the last top set across all workouts', () => {
  const w = [wk('w1', 2, [sq([s(100, 5), s(105, 3)])]), wk('w2', 9, [sq([s(110, 2), s('', '')])])];
  assert.deepEqual(exerciseSummary('back squat', w), { name: 'back squat', sessions: 2, last: { weight: 110, reps: 2, at: D(9) } });
});

test('tracked weights group loads within 2.5% and count each set once (in-workout and standalone copies)', () => {
  const w = [wk('w1', 2, [sq([s(100, 3, { velocity: rec('a', D(2), 0.5) }), s(80, 5, { velocity: rec('b', D(2), 0.7, { loadKg: 80 }) })])])];
  const standalone = [rec('a', D(2), 0.5, { exercise: 'Back Squat' }), rec('c', D(5), 0.55, { exercise: 'Back Squat', loadKg: 101 })];
  assert.deepEqual(trackedWeights('Back Squat', w, standalone), [{ loadKg: 101, sets: 2, sessions: 2 }, { loadKg: 80, sets: 1, sessions: 1 }]);
});

test('speed at a weight: first set of each session, change from first to latest; faster = easier', () => {
  const w = [wk('w1', 2, [sq([s(100, 3, { velocity: rec('a', D(2), 0.48) }), s(100, 3, { velocity: rec('a2', D(2) + 6e5, 0.40) })])]),
    wk('w2', 9, [sq([s(100, 3, { velocity: rec('b', D(9), 0.52) })])]), wk('w3', 16, [sq([s(100, 3, { velocity: rec('c', D(16), 0.56) })])])];
  const r = speedAtWeight('Back Squat', 100, w, []);
  assert.deepEqual(r.points.map((p) => p.speed), [0.48, 0.52, 0.56]);
  assert.ok(Math.abs(r.change.pct - 16.67) < 0.01);
  assert.equal(r.reason, null);
});

test('speed at a weight: relative-only sets are never compared, and say why', () => {
  const w = [wk('w1', 2, [sq([s(100, 3, { velocity: rec('a', D(2), 0.5, { units: 'relative' }) })])])];
  const r = speedAtWeight('Back Squat', 100, w, []);
  assert.equal(r.points.length, 0); assert.equal(r.relative.length, 1); assert.equal(r.change, null);
  assert.match(r.reason, /height/);
  assert.match(speedAtWeight('Back Squat', 60, w, []).reason, /No camera-tracked sets/);
});
