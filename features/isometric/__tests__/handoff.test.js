import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareIsoTracking, parseIsoContext, attachIsoSet, saveIsoRecord, listIsoRecords, isoSummary, ACTIVE_WORKOUT_KEY, ISO_KEY } from '../services/handoff.js';

function store(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const workout = () => ({ id: 'w1', exercises: [
  { id: 'e1', name: 'Isometric Pin Press', sets: [{ id: 's1', weight: 60, reps: '' }, { id: 's2', weight: '', reps: '' }] },
  { id: 'e2', name: 'Bench Press', sets: [{ id: 's3', weight: 80, reps: '' }] },
] });
const record = (id = 'r1', extra = {}) => ({ id, at: 1000, mode: 'arms', exercise: 'Isometric Pin Press', rpe: 9,
  pushes: [{ durationSec: 6, angleDeg: 92, shakeRatio: 2.1 }, { durationSec: 6, angleDeg: 90, shakeRatio: 1.9 }], vsUsual: { ratio: 1.3, n: 4 }, ...extra });

function launch(w, setId = 's1') {
  const url = prepareIsoTracking(w, 'e1', setId, { captureId: 'cap-' + setId });
  const s = store({ [ACTIVE_WORKOUT_KEY]: JSON.stringify(w) });
  return { url, s, ctx: parseIsoContext(url.split('?')[1]) };
}

test('prepareIsoTracking opens the isometric page for isometric exercises only', () => {
  const w = workout();
  const url = prepareIsoTracking(w, 'e1', 's1', { captureId: 'cap1' });
  assert.match(url, /^isometric\.html\?/);
  const p = new URLSearchParams(url.split('?')[1]);
  assert.equal(p.get('mode'), 'arms'); assert.equal(p.get('capture'), 'cap1'); assert.equal(p.get('exerciseName'), 'Isometric Pin Press');
  assert.equal(w.exercises[0].sets[0].isoCaptureId, 'cap1');
  assert.throws(() => prepareIsoTracking(w, 'e2', 's3'), /no isometric camera setup/);
  assert.equal(parseIsoContext('workout=w1&exercise=e1'), null);
});

test('attachIsoSet writes the pushes, the rating and the push count, and keeps the typed load', () => {
  const { s, ctx } = launch(workout());
  const res = attachIsoSet(s, ctx, record());
  assert.ok(res.ok, res.reason);
  const set = JSON.parse(s.getItem(ACTIVE_WORKOUT_KEY)).exercises[0].sets[0];
  assert.equal(set.reps, 2);
  assert.equal(set.weight, 60);
  assert.equal(set.rpe, 9);
  assert.equal(set.reportedEffort.rpe, 9);
  assert.equal(set.isometric.label, 'estimate');
  assert.equal(set.isometric.captureId, 'cap-s1');
  assert.equal(set.isoCaptureId, undefined);
});

test('an old camera tab can’t overwrite a newer take; a retake keeps the earlier one', () => {
  const w = workout();
  const { s, ctx } = launch(w);
  assert.ok(attachIsoSet(s, ctx, record('r1')).ok);
  assert.ok(attachIsoSet(s, ctx, record('r1')).duplicate, 'the same take again is fine');
  // A newer launch on the same set.
  const w2 = JSON.parse(s.getItem(ACTIVE_WORKOUT_KEY));
  prepareIsoTracking(w2, 'e1', 's1', { captureId: 'cap-new' });
  s.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(w2));
  const stale = attachIsoSet(s, ctx, record('r-old'));
  assert.equal(stale.ok, false); assert.match(stale.reason, /newer/);
  assert.ok(attachIsoSet(s, { ...ctx, captureId: 'cap-new' }, record('r2')).ok);
  const set = JSON.parse(s.getItem(ACTIVE_WORKOUT_KEY)).exercises[0].sets[0];
  assert.equal(set.isometric.id, 'r2');
  assert.deepEqual(set.isometricHistory.map((x) => x.id), ['r1']);
});

test('attachIsoSet refuses when there is nothing to save or the workout closed', () => {
  const { s, ctx } = launch(workout());
  assert.equal(attachIsoSet(s, ctx, record('r1', { pushes: [] })).ok, false);
  assert.equal(attachIsoSet(s, null, record()).ok, false);
  const done = JSON.parse(s.getItem(ACTIVE_WORKOUT_KEY)); done.completedAt = 5;
  s.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(done));
  assert.match(attachIsoSet(s, ctx, record()).reason, /no longer open/);
});

test('records are kept by id and capped', () => {
  const s = store();
  saveIsoRecord(s, record('a')); saveIsoRecord(s, record('b')); saveIsoRecord(s, record('a', { rpe: 7 }));
  assert.deepEqual(listIsoRecords(s).map((r) => r.id), ['b', 'a']);
  assert.equal(listIsoRecords(s)[1].rpe, 7);
  for (let i = 0; i < 320; i++) saveIsoRecord(s, record('x' + i));
  assert.equal(listIsoRecords(s).length, 300);
  s.setItem(ISO_KEY, 'not json');
  assert.deepEqual(listIsoRecords(s), []);
});

test('isoSummary reads as one line', () => {
  assert.equal(isoSummary(record()), '2 pushes · 6 s · elbow 91° · 1.3× your usual shake (estimate)');
  assert.equal(isoSummary(record('r', { vsUsual: null, pushes: [{ durationSec: 10, angleDeg: 120, shakeRatio: null }], mode: 'legs' })), '1 push · 10 s · knee 120°');
  assert.equal(isoSummary(null), '');
});
