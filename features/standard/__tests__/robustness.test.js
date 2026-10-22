import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepCounter, createReturnCounter, HEIGHT_DEFAULTS } from '../services/repEngine.js';

test('an incomplete first return cannot become a ROM standard', () => {
  const c = createReturnCounter(HEIGHT_DEFAULTS);
  [100, 80, 50, 65, 80, 65].forEach((v, i) => c.push(i * 0.1, v));
  assert.equal(c.standard, null);
  assert.equal(c.reps[0].result, 'short');
  assert.equal(c.reps[0].isStandard, false);
  [50, 65, 80, 100].forEach((v, i) => c.push(0.6 + i * 0.1, v));
  assert.equal(c.reps[1].isStandard, true);
});

test('both counters ignore malformed, duplicate and backward timestamps', () => {
  for (const c of [createRepCounter(), createReturnCounter(HEIGHT_DEFAULTS)]) {
    c.push(0, 170); c.push(0.1, 160);
    for (const t of [0, 0.1, -1, NaN, Infinity]) {
      c.push(t, 40); c.push(t, 170);
    }
    assert.equal(c.reps.length, 0);
    assert.equal(c.standard, null);
  }
});

test('reacquisition at rest cannot invent a rep from an unseen excursion', () => {
  for (const c of [createRepCounter(), createReturnCounter(HEIGHT_DEFAULTS)]) {
    c.push(0, 170); c.push(0.1, 170);
    c.push(2, 45); c.push(2.1, 60); c.push(2.2, 170);
    assert.equal(c.reps.length, 0);
  }
});
