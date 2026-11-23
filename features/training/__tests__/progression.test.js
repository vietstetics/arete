import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepRange, equipmentOf, loadStep, suggestNext } from '../services/progression.js';

const sess = (weight, reps, rir = []) => ({ sets: reps.map((r, i) => ({ weight, reps: r, rir: rir[i] ?? '' })) });

test('rep ranges: en dash, hyphen, "to", single numbers; not time or text', () => {
  assert.deepEqual(parseRepRange('6–10'), { min: 6, max: 10 });
  assert.deepEqual(parseRepRange('8-12'), { min: 8, max: 12 });
  assert.deepEqual(parseRepRange('8 to 12'), { min: 8, max: 12 });
  assert.deepEqual(parseRepRange('5'), { min: 5, max: 5 });
  assert.equal(parseRepRange('60s'), null);
  assert.equal(parseRepRange(''), null);
  assert.equal(parseRepRange('12-8'), null);
});

test('equipment and weight steps (kg and lb; a machine’s own step wins)', () => {
  assert.equal(equipmentOf({ name: 'Bench Press' }), 'barbell');
  assert.equal(equipmentOf({ name: 'Dumbbell Curl' }), 'dumbbell');
  assert.equal(equipmentOf({ name: 'Leg Press' }), 'machine');
  assert.equal(equipmentOf({ name: 'Chest Press', machine: { id: 'x' } }), 'machine');
  assert.equal(equipmentOf({ name: 'Cable Row', machine: { id: 'x' } }), 'cable');
  assert.equal(loadStep({ equipment: 'barbell' }), 2.5);
  assert.equal(loadStep({ equipment: 'barbell', unit: 'lb' }), 5);
  assert.equal(loadStep({ equipment: 'machine', custom: 7 }), 7);
});

test('top of the range on every set at the planned effort: add one step, back to the bottom', () => {
  const r = suggestNext([sess(80, [10, 10, 10], [2, 2, 2])], { range: '6-10', targetRir: 2, equipment: 'barbell' });
  assert.equal(r.kind, 'add');
  assert.equal(r.weight, 82.5);
  assert.deepEqual(r.reps, [6, 6, 6]);
});

test('not yet at the top: same weight, one more rep on each set below it', () => {
  const r = suggestNext([sess(80, [9, 8, 7])], { range: '6-10', equipment: 'barbell' });
  assert.equal(r.kind, 'reps');
  assert.equal(r.weight, 80);
  assert.deepEqual(r.reps, [10, 9, 8]);
  const top = suggestNext([sess(80, [10, 10, 9])], { range: '6-10' });
  assert.deepEqual(top.reps, [10, 10, 10]);
});

test('top reached but harder than planned (less RIR than the target): hold', () => {
  const r = suggestNext([sess(80, [10, 10, 10], [1, 0, 0])], { range: '6-10', targetRir: 2 });
  assert.equal(r.kind, 'hold');
  assert.equal(r.weight, 80);
});

test('below the bottom twice at the same weight: about 5% lighter; once is not enough', () => {
  const twice = suggestNext([sess(100, [6, 5, 4]), sess(100, [6, 5, 5])], { range: '6-10', equipment: 'barbell' });
  assert.equal(twice.kind, 'lighter');
  assert.equal(twice.weight, 95);
  const once = suggestNext([sess(100, [6, 5, 4]), sess(97.5, [7, 6, 6])], { range: '6-10' });
  assert.equal(once.kind, 'reps');
});

test('today’s bar speed well below usual turns an increase into a hold', () => {
  const r = suggestNext([sess(80, [10, 10, 10])], { range: '6-10', readiness: 'low' });
  assert.equal(r.kind, 'hold');
  assert.equal(r.weight, 80);
});

test('the heaviest weight is the working weight (a lighter back-off set does not count)', () => {
  const r = suggestNext([{ sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 80, reps: 12 }] }], { range: '6-8', equipment: 'barbell' });
  assert.equal(r.kind, 'add');
  assert.equal(r.weight, 102.5);
});

test('nothing to say without a range or a previous session', () => {
  assert.equal(suggestNext([], { range: '6-10' }), null);
  assert.equal(suggestNext([sess(80, [10])], { range: '60s' }), null);
  assert.equal(suggestNext([{ sets: [{ weight: 80, reps: '' }] }], { range: '6-10' }), null);
});
