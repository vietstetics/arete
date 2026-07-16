import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalHealthRepository } from '../repositories/healthRepository.js';

// localStorage shim
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const rec = (over = {}) => ({
  type: 'steps', startTime: '2026-07-15T00:00:00.000Z',
  value: 5000, unit: 'count',
  sourceProvider: 'apple_health', sourceRecordId: 'daily-steps-2026-07-15',
  importedAt: '2026-07-15T10:00:00.000Z', ...over,
});

beforeEach(() => store.clear());

test('putRecords dedupes on sourceProvider + sourceRecordId', () => {
  const repo = createLocalHealthRepository('t1_');
  const r1 = repo.putRecords([rec(), rec()]);                       // same key twice
  assert.equal(r1.added, 1);
  assert.equal(r1.duplicates, 1);
  const r2 = repo.putRecords([rec()]);                              // re-import (incremental overlap)
  assert.equal(r2.added, 0);
  assert.equal(r2.duplicates, 1);
  // same record id from ANOTHER provider is NOT a duplicate
  const r3 = repo.putRecords([rec({ sourceProvider: 'health_connect' })]);
  assert.equal(r3.added, 1);
  assert.equal(repo.getRecords('steps').length, 2);
});

test('corrupted local storage falls back to empty without crashing', () => {
  store.set('t2_jarvis_health_records', '{not json![');
  store.set('t2_jarvis_health_connections', '42');
  const repo = createLocalHealthRepository('t2_');
  assert.deepEqual(repo.getRecords(), []);
  assert.equal(repo.getConnection('apple_health'), null);
  const r = repo.putRecords([rec()]);
  assert.equal(r.added, 1);                                          // recovered
});

test('connection state, cursor and preferences round-trip', () => {
  const repo = createLocalHealthRepository('t3_');
  repo.setConnection({ provider: 'health_connect', state: 'connected', permissionState: 'granted', historyDays: 30 });
  assert.equal(repo.getConnection('health_connect').historyDays, 30);
  repo.setCursor('health_connect', '2026-07-15T10:00:00.000Z');
  assert.equal(repo.getCursor('health_connect'), '2026-07-15T10:00:00.000Z');
  assert.equal(repo.getPreferences().workouts, 'arete');             // default: Arete wins
  repo.setPreference('steps', 'apple_health');
  assert.equal(repo.getPreferences().steps, 'apple_health');
});

test('markDuplicate flags a record for audit without deleting it', () => {
  const repo = createLocalHealthRepository('t4_');
  repo.putRecords([rec({ type: 'workout', sourceRecordId: 'wk1' })]);
  repo.markDuplicate('apple_health:wk1', 'arete:w-123');
  const all = repo.getRecords('workout');
  assert.equal(all.length, 1);                                       // kept
  assert.equal(all[0].duplicateOf, 'arete:w-123');                   // flagged
});
