import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepSyncService } from '../services/stepSyncService.js';
import { createStepRepository } from '../repositories/stepRepository.js';
import { todayKey } from '../util/date.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeService({ today = 0, range = [], source = 'android-phone' } = {}) {
  return {
    source,
    async getTodaySteps() { return today; },
    async getStepsForRange() { return range; },
    async startLiveUpdates(cb) { this._cb = cb; },
    async stopLiveUpdates() {},
    emit(n) { if (this._cb) this._cb(n); },
  };
}

test('syncToday stores one record for today, tagged with platform source', async () => {
  const repo = createStepRepository(memStorage());
  const sync = createStepSyncService(fakeService({ today: 4200 }), repo);
  await sync.syncToday();
  const r = repo.getByDate(todayKey());
  assert.equal(r.steps, 4200);
  assert.equal(r.source, 'android-phone');
});

test('syncHistory dedups by date across repeated syncs (app refresh)', async () => {
  const repo = createStepRepository(memStorage());
  const range = [
    { date: '2026-06-19', steps: 9000, source: 'android-phone' },
    { date: '2026-06-19', steps: 9000, source: 'android-phone' }, // duplicate record from phone
  ];
  const sync = createStepSyncService(fakeService({ range }), repo);
  await sync.syncHistory(7);
  await sync.syncHistory(7); // refresh again
  assert.equal(repo.getRange('2026-06-19', '2026-06-19').length, 1);
  assert.equal(repo.getByDate('2026-06-19').steps, 9000);
});

test('manual entry is clearly labelled manual', () => {
  const repo = createStepRepository(memStorage());
  const sync = createStepSyncService(fakeService(), repo);
  sync.saveManual('2026-06-18', 5000);
  assert.equal(repo.getByDate('2026-06-18').source, 'manual');
  assert.equal(repo.getByDate('2026-06-18').steps, 5000);
});

test('live updates keep today current without creating duplicates', async () => {
  const repo = createStepRepository(memStorage());
  const svc = fakeService({ source: 'iphone' });
  const sync = createStepSyncService(svc, repo);
  let last = 0;
  await sync.startLive((n) => { last = n; });
  svc.emit(100);
  svc.emit(250);
  assert.equal(last, 250);
  assert.equal(repo.getByDate(todayKey()).steps, 250);
  assert.equal(repo.getRange(todayKey(), todayKey()).length, 1);
});
