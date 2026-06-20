import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepRepository, DEFAULT_GOAL } from '../repositories/stepRepository.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('upsert keeps exactly one record per date (no dupes on refresh)', () => {
  const repo = createStepRepository(memStorage());
  repo.upsert({ date: '2026-06-20', steps: 1000, goal: 10000, source: 'iphone', lastSyncedAt: 'a' });
  repo.upsert({ date: '2026-06-20', steps: 2500, goal: 10000, source: 'iphone', lastSyncedAt: 'b' }); // app refresh
  assert.equal(repo.all().length, 1);
  assert.equal(repo.getByDate('2026-06-20').steps, 2500);
});

test('getRange filters inclusively and sorts ascending', () => {
  const repo = createStepRepository(memStorage());
  for (const d of ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21']) {
    repo.upsert({ date: d, steps: 5000, goal: 10000, source: 'iphone', lastSyncedAt: '' });
  }
  const r = repo.getRange('2026-06-19', '2026-06-20');
  assert.deepEqual(r.map((x) => x.date), ['2026-06-19', '2026-06-20']);
});

test('goal defaults and persists', () => {
  const repo = createStepRepository(memStorage());
  assert.equal(repo.getGoal(), DEFAULT_GOAL);
  repo.setGoal(8000);
  assert.equal(repo.getGoal(), 8000);
});

test('upsert clamps negatives and rounds', () => {
  const repo = createStepRepository(memStorage());
  repo.upsert({ date: '2026-06-20', steps: -5, goal: 10000, source: 'manual', lastSyncedAt: '' });
  assert.equal(repo.getByDate('2026-06-20').steps, 0);
});
