import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workoutsOverlap, dedupeWorkouts, countable } from '../services/healthDeduplication.js';

const T0 = Date.parse('2026-07-15T17:00:00.000Z');
const imp = (over = {}) => ({
  id: 'apple_health:wk1', type: 'workout',
  startTime: '2026-07-15T17:00:00.000Z', endTime: '2026-07-15T17:50:00.000Z',
  value: 50, sourceProvider: 'apple_health', sourceRecordId: 'wk1',
  meta: { activityType: 'Strength Training' }, ...over,
});
const arete = (over = {}) => ({ id: 'w-1', name: 'Push Day', startedAt: T0 + 2 * 60000, completedAt: T0 + 48 * 60000, ...over });

test('same-time same-duration workout duplicates the Arete log — Arete wins', () => {
  assert.equal(workoutsOverlap(imp(), arete()), true);
  const flagged = [];
  dedupeWorkouts([imp()], [arete()], (id, dup) => flagged.push([id, dup]));
  assert.deepEqual(flagged, [['apple_health:wk1', 'arete:w-1']]);
});

test('workout an hour later is NOT a duplicate', () => {
  assert.equal(workoutsOverlap(imp({ startTime: '2026-07-15T19:00:00.000Z', endTime: '2026-07-15T19:50:00.000Z' }), arete()), false);
});

test('clearly different activity type is NOT a duplicate (cardio after lifting)', () => {
  assert.equal(workoutsOverlap(imp({ meta: { activityType: 'Running' } }), arete({ name: 'Push Day' })), false);
});

test('watch auto-detection containing the Arete session IS a duplicate', () => {
  const long = imp({ startTime: '2026-07-15T16:55:00.000Z', endTime: '2026-07-15T18:10:00.000Z', value: 75 });
  assert.equal(workoutsOverlap(long, arete()), true);
});

test('flagged duplicates are excluded from totals but kept for audit', () => {
  const rows = [imp({ duplicateOf: 'arete:w-1' }), imp({ id: 'apple_health:wk2', sourceRecordId: 'wk2', startTime: '2026-07-16T08:00:00.000Z' })];
  assert.equal(countable(rows).length, 1);
  assert.equal(rows.length, 2);
});
