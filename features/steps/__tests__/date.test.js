import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateString, addDays, rangeDates, startOfMonthKey } from '../util/date.js';

// Step buckets use the LOCAL calendar day. Reading local fields (not UTC)
// is what keeps "today" correct across timezone changes and DST.
test('localDateString uses local calendar fields', () => {
  const d = new Date(2026, 0, 15, 23, 30, 0); // local Jan 15, 23:30
  assert.equal(localDateString(d), '2026-01-15');
  const e = new Date(2026, 0, 16, 0, 5, 0); // 5 min later -> next local day
  assert.equal(localDateString(e), '2026-01-16');
});

test('addDays handles month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('rangeDates is inclusive and ascending', () => {
  assert.deepEqual(rangeDates('2026-03-01', '2026-03-03'), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.deepEqual(rangeDates('2026-03-05', '2026-03-05'), ['2026-03-05']);
});

test('startOfMonthKey', () => {
  assert.equal(startOfMonthKey(new Date(2026, 5, 20)), '2026-06-01');
});
