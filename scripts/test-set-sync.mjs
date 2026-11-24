// Set history → account database (js/setSync.js) against a fake Supabase. Run: node --test scripts/test-set-sync.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../js/setSync.js', import.meta.url), 'utf8');

function world({ pulled = true, fail = null } = {}) {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const db = { exercise_sets: new Map(), velocity_sets: new Map() };
  const calls = [];
  const state = { fail };
  const pk = (t, r) => r.user_id + '|' + (t === 'exercise_sets' ? r.set_id : r.record_id);
  const client = {
    from(t) {
      return {
        upsert: async (rows) => {
          calls.push({ t, op: 'upsert', n: rows.length });
          if (state.fail) return { error: state.fail };
          rows.forEach((r) => db[t].set(pk(t, r), { ...db[t].get(pk(t, r)), ...JSON.parse(JSON.stringify(r)) }));
          return { error: null };
        },
        delete() {
          const f = [];
          const q = {
            eq: (c, v) => { f.push((r) => r[c] === v); return q; },
            not: (c, _op, list) => { const ids = list.slice(1, -1).split(',').map((s) => s.replace(/"/g, '')); f.push((r) => !ids.includes(r[c])); return q; },
            then: (res, rej) => {
              calls.push({ t, op: 'delete' });
              if (state.fail) return Promise.resolve({ error: state.fail }).then(res, rej);
              for (const [k, r] of db[t]) if (f.every((fn) => fn(r))) db[t].delete(k);
              return Promise.resolve({ error: null }).then(res, rej);
            },
          };
          return q;
        },
      };
    },
  };
  const Auth = { isConfigured: () => true, isPulled: () => pulled, getClient: async () => client, getUser: async () => ({ id: 'U' }) };
  const window = { Auth, addEventListener() {} };
  const ctx = vm.createContext({ window, localStorage, document: { addEventListener() {}, visibilityState: 'visible' }, setTimeout: () => 0, clearTimeout() {}, console, JSON, Math, Date, String, Number, Array, Object, isFinite, Promise });
  vm.runInContext(SRC, ctx);
  return { S: window.SetSync, store, db, calls, state };
}

const DAY = Date.UTC(2026, 10, 20, 9);
const set = (id, weight, reps, extra = {}) => ({ id, type: 'working', weight, reps, rir: 2, completed: true, completedAt: DAY, ...extra });
const vel = (id, mcvs, extra = {}) => ({ id, at: DAY, units: 'm/s', loadKg: 100, counted: mcvs.length, lossPct: 12.5, quality: { accepted: true },
  observations: { points: Array.from({ length: 240 }, (_, i) => [i, i]) }, reps: mcvs.map((mcv, i) => ({ n: i + 1, result: 'counted', velocity: 'ok', mcv, peak: mcv * 1.6 })), ...extra });
const workout = (id, exercises, extra = {}) => ({ id, name: 'Day', date: '2026-11-20', planId: 'p1', routineId: 'r1', startedAt: DAY - 36e5, completedAt: DAY, exercises, ...extra });

test('rows: one per completed set, both sides for unilateral, warm-ups marked, bad numbers dropped', () => {
  const { S } = world();
  const r = S.rowsForWorkout(workout('w1', [
    { name: 'Back Squat', sets: [set('a', 100, 5), set('b', '', '', { completed: false }), set('w', 60, 5, { type: 'warmup' }), set('x', -5, 99999)] },
    { name: 'Bulgarian Split Squat', unilateral: true, sets: [set('u', 20, 9, { weightR: 20, repsR: 10, weightL: 20, repsL: 9 })] },
  ]));
  assert.equal(r.sets.length, 4);
  const [a, w, x, u] = r.sets;
  assert.equal(a.exercise_key, 'back squat'); assert.equal(a.weight_kg, 100); assert.equal(a.reps, 5); assert.equal(a.performed_on, '2026-11-20'); assert.equal(a.plan_id, 'p1');
  assert.equal(w.set_type, 'warmup');
  assert.equal(x.weight_kg, null); assert.equal(x.reps, null, 'out-of-range values are left empty, never sent');
  assert.deepEqual([u.weight_r, u.reps_r, u.weight_l, u.reps_l], [20, 10, 20, 9]);
});

test('velocity rows keep speeds and drop the bulky bar trace', () => {
  const { S } = world();
  const r = S.rowsForWorkout(workout('w1', [{ name: 'Back Squat', sets: [set('a', 100, 3, { velocity: vel('v1', [0.5, 0.62, 0.55, 0.4]) })] }]));
  assert.equal(r.velocity.length, 1);
  const v = r.velocity[0];
  assert.equal(v.set_id, 'a'); assert.equal(v.workout_id, 'w1'); assert.equal(v.load_kg, 100);
  assert.equal(v.first_mcv, 0.62); assert.equal(v.best_mcv, 0.62); assert.equal(v.units, 'm/s');
  assert.equal(v.reps.length, 4); assert.equal(v.observations, undefined);
  assert.ok(JSON.stringify(v).length < 1200, 'compact: ' + JSON.stringify(v).length + ' bytes');
});

test('sync uploads new sets once; nothing is re-sent until something changes', async () => {
  const w = world();
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Bench Press', sets: [set('a', 80, 8), set('b', 80, 7)] }]), workout('mock-1', [{ name: 'Bench Press', sets: [set('m', 1, 1)] }])]));
  assert.equal(await w.S.sync(), 'ok');
  assert.equal(w.db.exercise_sets.size, 2, 'sample data is never uploaded');
  const n = w.calls.length;
  assert.equal(await w.S.sync(), 'ok');
  assert.equal(w.calls.length, n, 'no requests when nothing changed');
});

test('an edited workout updates its rows and drops sets it no longer has', async () => {
  const w = world();
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Bench Press', sets: [set('a', 80, 8), set('b', 80, 7)] }])]));
  await w.S.sync();
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Bench Press', sets: [set('a', 82.5, 8)] }])]));
  await w.S.sync();
  assert.equal(w.db.exercise_sets.size, 1);
  assert.equal([...w.db.exercise_sets.values()][0].weight_kg, 82.5);
});

test('rows are removed only for a deleted workout, never for one that is just missing from the phone', async () => {
  const w = world();
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Row', sets: [set('a', 60, 10)] }]), workout('w2', [{ name: 'Row', sets: [set('b', 60, 10)] }])]));
  await w.S.sync();
  w.store.set('jarvis_workouts', '[]');
  await w.S.sync();
  assert.equal(w.db.exercise_sets.size, 2, 'missing locally: kept');
  w.store.set('arete_sets_deleted', JSON.stringify(['w1']));
  await w.S.sync();
  assert.equal(w.db.exercise_sets.size, 1);
  assert.equal(w.store.get('arete_sets_deleted'), '[]');
});

test('camera sets outside a workout are saved; ones already in a workout are not sent twice', async () => {
  const w = world();
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Back Squat', sets: [set('a', 100, 3, { velocity: vel('v1', [0.5]) })] }])]));
  w.store.set('arete_velocity_sets', JSON.stringify([vel('v1', [0.5], { exercise: 'Back Squat' }), vel('v2', [0.7], { exercise: 'Back Squat', loadKg: 80 })]));
  await w.S.sync();
  assert.equal(w.db.velocity_sets.size, 2);
  assert.equal(w.db.velocity_sets.get('U|v1').set_id, 'a', 'the workout link is kept');
  assert.equal(w.db.velocity_sets.get('U|v2').load_kg, 80);
});

test('a failed upload sends everything again next time; a missing table says the database needs its update', async () => {
  const w = world({ fail: { message: 'network' } });
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Bench Press', sets: [set('a', 80, 8)] }])]));
  assert.equal(await w.S.sync(), 'retry');
  assert.equal(w.store.get('arete_sets_sent') ?? null, null);
  w.state.fail = { code: 'PGRST205', message: 'Could not find the table' };
  assert.equal(await w.S.sync(), 'needs-schema');
  w.state.fail = null;
  assert.equal(await w.S.sync(), 'ok');
  assert.equal(w.db.exercise_sets.size, 1);
});

test('nothing is sent before this phone has read the account (a half-loaded phone never uploads)', async () => {
  const w = world({ pulled: false });
  w.store.set('jarvis_workouts', JSON.stringify([workout('w1', [{ name: 'Bench Press', sets: [set('a', 80, 8)] }])]));
  assert.equal(await w.S.sync(), 'waiting');
  assert.equal(w.calls.length, 0);
});
