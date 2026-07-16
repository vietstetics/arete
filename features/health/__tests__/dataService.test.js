import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis; // for the Wearables hook (absent → no-op)

const { createLocalHealthRepository } = await import('../repositories/healthRepository.js');
const svc = await import('../services/healthDataService.js');
const prefs = await import('../services/healthSourcePreferences.js');

const pad = (n) => String(n).padStart(2, '0');
const localISO = (y, mo, d, h) => new Date(y, mo - 1, d, h).toISOString();
const today = new Date();
const todayLocal = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

function freshRepo(prefix) {
  const repo = createLocalHealthRepository(prefix);
  repo.setConnection({ provider: 'apple_health', state: 'connected', permissionState: 'requested' });
  return repo;
}

beforeEach(() => store.clear());

test('midnight boundary: a 23:30 local record lands on ITS local date', () => {
  const repo = freshRepo('a_');
  // 23:30 local yesterday — in many timezones a different UTC date
  const y = new Date(today); y.setDate(y.getDate() - 1);
  const iso = localISO(y.getFullYear(), y.getMonth() + 1, y.getDate(), 23.5);
  repo.putRecords([{ type: 'steps', startTime: iso, value: 9000, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 's-ymd' }]);
  svc.applySteps(repo);
  const map = JSON.parse(store.get('jarvis_steps'));
  const key = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  assert.ok(map[key], 'assigned to local date ' + key);
  assert.equal(map[key].steps, 9000);
  assert.equal(map[key].source, 'apple_health');
});

test('manual steps entered today are never overwritten silently', () => {
  const repo = freshRepo('b_');
  store.set('jarvis_steps', JSON.stringify({ [todayLocal]: { date: todayLocal, steps: 1234, goal: 10000, source: 'manual' } }));
  repo.putRecords([{ type: 'steps', startTime: new Date().toISOString(), value: 8000, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 'st-today' }]);
  svc.applySteps(repo);
  assert.equal(JSON.parse(store.get('jarvis_steps'))[todayLocal].steps, 1234); // manual kept
});

test('one source per metric — a non-preferred provider never contributes', () => {
  const repo = freshRepo('c_');
  repo.setConnection({ provider: 'health_connect', state: 'connected', permissionState: 'granted' });
  repo.setPreference('steps', 'apple_health');
  repo.putRecords([
    { type: 'steps', startTime: new Date(Date.now() - 86400000).toISOString(), value: 5000, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 'a1' },
    { type: 'steps', startTime: new Date(Date.now() - 86400000).toISOString(), value: 7777, unit: 'count', sourceProvider: 'health_connect', sourceRecordId: 'h1' },
  ]);
  svc.applySteps(repo);
  const rows = Object.values(JSON.parse(store.get('jarvis_steps')));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].steps, 5000);           // apple only — never 12777
});

test('sleep is queued as a suggestion, applied only on explicit accept', () => {
  const repo = freshRepo('d_');
  const end = new Date(); end.setHours(7, 0, 0, 0);
  const start = new Date(end.getTime() - 452 * 60000);
  repo.putRecords([{ type: 'sleep', startTime: start.toISOString(), endTime: end.toISOString(), value: 452, unit: 'min', sourceProvider: 'apple_health', sourceRecordId: 'slp1' }]);
  const s = svc.queueSleepSuggestion(repo);
  assert.equal(s.minutes, 452);
  assert.equal(store.has('jarvis_sleep_log'), false);          // nothing written yet
  assert.ok(svc.pendingSleepSuggestion());
  svc.resolveSleepSuggestion(false);                            // "Keep my answer"
  assert.equal(store.has('jarvis_sleep_log'), false);           // still nothing
  assert.equal(svc.pendingSleepSuggestion(), null);             // and not re-asked
  assert.equal(svc.queueSleepSuggestion(repo), null);           // resolved today → no re-queue
});

test('accepting the sleep suggestion writes the sleep log with source', () => {
  const repo = freshRepo('e_');
  const end = new Date(); end.setHours(7, 0, 0, 0);
  repo.putRecords([{ type: 'sleep', startTime: new Date(end.getTime() - 420 * 60000).toISOString(), endTime: end.toISOString(), value: 420, unit: 'min', sourceProvider: 'apple_health', sourceRecordId: 'slp2' }]);
  svc.queueSleepSuggestion(repo);
  svc.resolveSleepSuggestion(true);
  const log = JSON.parse(store.get('jarvis_sleep_log'));
  assert.equal(log[0].date, todayLocal);
  assert.equal(log[0].source, 'apple_health');
});

test('imported workout duplicating an Arete log is excluded; unique ones import', () => {
  const repo = freshRepo('f_');
  repo.setPreference('workouts', 'apple_health');               // user opts in to imports
  const t0 = Date.parse('2026-07-15T17:00:00.000Z');
  store.set('jarvis_workouts', JSON.stringify([{ id: 'w-1', name: 'Push Day', startedAt: t0, completedAt: t0 + 50 * 60000, exercises: [] }]));
  repo.putRecords([
    { type: 'workout', startTime: '2026-07-15T17:01:00.000Z', endTime: '2026-07-15T17:49:00.000Z', value: 48, unit: 'min', sourceProvider: 'apple_health', sourceRecordId: 'wkA', meta: { activityType: 'Strength Training' } },
    { type: 'workout', startTime: '2026-07-16T08:00:00.000Z', endTime: '2026-07-16T08:40:00.000Z', value: 40, unit: 'min', sourceProvider: 'apple_health', sourceRecordId: 'wkB', meta: { activityType: 'Running' } },
  ]);
  const added = svc.applyWorkouts(repo);
  assert.equal(added, 1);                                       // only the run
  const wks = JSON.parse(store.get('jarvis_workouts'));
  assert.equal(wks.length, 2);
  assert.ok(wks.some((w) => w.imported && w.name.includes('Running')));
});

test('source preference change re-routes without summing', () => {
  const repo = freshRepo('g_');
  repo.setConnection({ provider: 'health_connect', state: 'connected', permissionState: 'granted' });
  const iso = new Date(Date.now() - 86400000).toISOString();
  repo.putRecords([
    { type: 'steps', startTime: iso, value: 5000, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 'a1' },
    { type: 'steps', startTime: iso, value: 7000, unit: 'count', sourceProvider: 'health_connect', sourceRecordId: 'h1' },
  ]);
  repo.setPreference('steps', 'apple_health');
  svc.applySteps(repo);
  let rows = Object.values(JSON.parse(store.get('jarvis_steps')));
  assert.equal(rows[0].steps, 5000);
  repo.setPreference('steps', 'health_connect');
  svc.applySteps(repo);
  rows = Object.values(JSON.parse(store.get('jarvis_steps')));
  assert.equal(rows[0].steps, 7000);                            // switched, not 12000
});

test("preferring a disconnected provider yields nothing (resolveSource null)", () => {
  const repo = freshRepo('h_');
  repo.setPreference('steps', 'fitbit');                        // not connected
  assert.equal(prefs.resolveSource('steps', svc.connectedProviderIds(repo), repo), null);
});
