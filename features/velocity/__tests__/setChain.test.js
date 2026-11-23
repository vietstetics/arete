import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSetEndDetector, fatigueAcrossSets } from '../services/setChain.js';
import { prepareWorkoutTracking, attachChainedSet, peekChainTarget, setChainTargetWeight, ACTIVE_WORKOUT_KEY } from '../services/workout.js';

test('a set ends 10 s after the last rep, not before', () => {
  const d = createSetEndDetector();
  assert.equal(d.push(0, { rep: true }), null);
  assert.equal(d.push(3, { rep: true }), null);
  assert.equal(d.push(12.9, {}), null);
  assert.equal(d.push(13, {}), 'end');
  assert.equal(d.push(14, {}), null, 'fires once');
});

test('a set ends 4 s after stepping out of view', () => {
  const d = createSetEndDetector();
  d.push(0, { rep: true });
  assert.equal(d.push(1, { visible: false }), null);
  assert.equal(d.push(4.9, { visible: false }), null);
  assert.equal(d.push(5, { visible: false }), 'end');
});

test('coming back into view resets the out-of-view clock', () => {
  const d = createSetEndDetector();
  d.push(0, { rep: true });
  d.push(1, { visible: false }); d.push(3, { visible: true }); d.push(4, { visible: false });
  assert.equal(d.push(7.9, { visible: false }), null);
});

test('nothing ends a set before its first rep, however long you rest', () => {
  const d = createSetEndDetector();
  for (let t = 0; t <= 300; t += 5) assert.equal(d.push(t, { visible: t % 10 === 0 }), null);
  d.reset(); d.push(400, { rep: true });
  assert.equal(d.push(410, {}), 'end');
});

const vel = (mcvs, { units = 'm/s', loadKg = 80, lossPct = 20 } = {}) => ({ units, loadKg, lossPct, counted: mcvs.length,
  reps: mcvs.map((mcv, i) => ({ n: i + 1, result: 'counted', velocity: 'ok', mcv })) });

test('fatigue across sets: first-rep speed drop at the same weight', () => {
  const r = fatigueAcrossSets([{ id: 'a', weight: 80, velocity: vel([0.60, 0.55]) }, { id: 'b', weight: 80, velocity: vel([0.57]) }, { id: 'c', weight: 80, velocity: vel([0.51, 0.45]) }]);
  assert.equal(r.sets.length, 3);
  assert.equal(r.drop.from, 1); assert.equal(r.drop.to, 3);
  assert.ok(Math.abs(r.drop.pct - 15) < 1e-9);
});

test('fatigue across sets: no drop when the weight changed or speeds are relative', () => {
  const mixed = fatigueAcrossSets([{ weight: 80, velocity: vel([0.6]) }, { weight: 90, velocity: vel([0.5], { loadKg: 90 }) }]);
  assert.equal(mixed.drop, null); assert.match(mixed.reason, /weight changed/);
  const rel = fatigueAcrossSets([{ weight: 80, velocity: vel([1], { units: 'relative' }) }, { weight: 80, velocity: vel([1], { units: 'relative' }) }]);
  assert.equal(rel.drop, null); assert.match(rel.reason, /m\/s/);
  assert.equal(rel.sets[0].lossPct, 20, 'each set’s own loss is still shown');
});

function store(workout) {
  const m = new Map([[ACTIVE_WORKOUT_KEY, JSON.stringify(workout)]]);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), read: () => JSON.parse(m.get(ACTIVE_WORKOUT_KEY)) };
}
const draft = () => ({ id: 'w1', exercises: [{ id: 'e1', name: 'Back Squat', sets: [
  { id: 's1', type: 'working', weight: 80, reps: '', completed: true },
  { id: 's2', type: 'working', weight: 80, reps: '', completed: false },
  { id: 's3', type: 'working', weight: 85, reps: '', completed: false }] }] });
const take = (id, n = 5) => ({ id, counted: n, units: 'm/s', reps: Array.from({ length: n }, (_, i) => ({ n: i + 1, result: 'counted', velocity: 'ok', mcv: 0.6 - i * 0.02 })) });

function launch() {
  const w = draft();
  const url = prepareWorkoutTracking(w, 'e1', 's2', { chain: true, captureId: 'cap1' });
  const ctx = { workoutId: 'w1', exerciseId: 'e1', setId: 's2', chainId: new URLSearchParams(url.split('?')[1]).get('chain') };
  return { st: store(w), ctx };
}

test('chained sets fill the open sets in order, tick them, then add new sets', () => {
  const { st, ctx } = launch();
  assert.equal(ctx.chainId, 'cap1');
  assert.deepEqual(peekChainTarget(st, ctx), { ok: true, n: 2, weight: 80, added: false });
  const a = attachChainedSet(st, ctx, take('r1'), { endedAt: 1000, restSec: 95 });
  assert.equal(a.ok, true); assert.equal(a.set.id, 's2');
  const b = attachChainedSet(st, ctx, take('r2', 4), { endedAt: 2000 });
  assert.equal(b.set.id, 's3');
  assert.deepEqual(peekChainTarget(st, ctx), { ok: true, n: 4, weight: 85, added: true });
  setChainTargetWeight(st, ctx, 90);
  const c = attachChainedSet(st, ctx, take('r3', 3), { endedAt: 3000 });
  const sets = st.read().exercises[0].sets;
  assert.equal(sets.length, 4); assert.equal(c.set.id, sets[3].id);
  assert.equal(sets[3].weight, 90);
  for (const s of sets.slice(1)) { assert.equal(s.completed, true); assert.equal(s.chainTicked, true); }
  assert.equal(sets[1].reps, 5); assert.equal(sets[1].restSec, 95); assert.equal(sets[1].completedAt, 1000);
  assert.equal(sets[0].velocity, undefined, 'the set before the launch is untouched');
});

test('saving the same take again updates its set instead of adding one', () => {
  const { st, ctx } = launch();
  attachChainedSet(st, ctx, take('r1'));
  const again = attachChainedSet(st, ctx, { ...take('r1'), typedRir: 2 }, { updateTypedRir: true });
  assert.equal(again.duplicate, true); assert.equal(again.set.id, 's2');
  const sets = st.read().exercises[0].sets;
  assert.equal(sets[1].rir, 2); assert.equal(sets[2].velocity, undefined);
});

test('an older camera session can’t write after a newer one was opened', () => {
  const { st, ctx } = launch();
  const w = st.read(); prepareWorkoutTracking(w, 'e1', 's2', { chain: true, captureId: 'cap2' }); st.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(w));
  const r = attachChainedSet(st, ctx, take('r1'));
  assert.equal(r.ok, false); assert.match(r.reason, /newer camera session/);
  assert.equal(st.read().exercises[0].sets[1].velocity, undefined);
});
