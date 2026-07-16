import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;
globalThis.document = { addEventListener: () => {}, visibilityState: 'visible' };

const { createLocalHealthRepository } = await import('../repositories/healthRepository.js');
const { createSyncService } = await import('../services/healthSyncService.js');
const { createNativeAdapter } = await import('../providers/nativeAdapter.js');

beforeEach(() => store.clear());

function fakeAdapter(provider, impl = {}) {
  return {
    provider,
    info: { name: provider },
    isAvailable: async () => true,
    connect: async () => {},
    disconnect: async () => {},
    getConnectionStatus: async () => ({ provider, state: 'connected', permissionState: 'granted' }),
    getCapabilities: async () => ['steps'],
    sync: impl.sync || (async () => ({ provider, ok: true, imported: 3, duplicates: 0, syncedAt: new Date().toISOString() })),
  };
}

test('successful sync advances the cursor and records lastSyncAt', async () => {
  const repo = createLocalHealthRepository('s1_');
  repo.setConnection({ provider: 'apple_health', state: 'connected', permissionState: 'requested', historyDays: 7 });
  const s = createSyncService([fakeAdapter('apple_health')], repo);
  const r = await s.syncProvider('apple_health');
  assert.equal(r.ok, true);
  assert.ok(repo.getCursor('apple_health'));
  assert.ok(repo.getConnection('apple_health').lastSyncAt);
});

test('interrupted sync keeps existing data and cursor, surfaces the error', async () => {
  const repo = createLocalHealthRepository('s2_');
  repo.setConnection({ provider: 'apple_health', state: 'connected', permissionState: 'requested' });
  repo.putRecords([{ type: 'steps', startTime: '2026-07-14T00:00:00Z', value: 4000, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 'keepme' }]);
  repo.setCursor('apple_health', '2026-07-14T12:00:00.000Z');
  const s = createSyncService([fakeAdapter('apple_health', { sync: async () => { throw new Error('network dropped'); } })], repo);
  const r = await s.syncProvider('apple_health');
  assert.equal(r.ok, false);
  assert.match(r.error, /network dropped/);
  assert.equal(repo.getRecords('steps').length, 1);                       // data intact
  assert.equal(repo.getCursor('apple_health'), '2026-07-14T12:00:00.000Z'); // cursor untouched → retry same span
  assert.match(repo.getConnection('apple_health').lastError, /network dropped/);
});

test('sync on a disconnected provider is a clean no-op error', async () => {
  const repo = createLocalHealthRepository('s3_');
  const s = createSyncService([fakeAdapter('apple_health')], repo);
  const r = await s.syncProvider('apple_health');
  assert.equal(r.ok, false);
  assert.match(r.error, /Not connected/);
});

test('incremental: second sync passes a since cursor with 1-day overlap', async () => {
  const repo = createLocalHealthRepository('s4_');
  repo.setConnection({ provider: 'apple_health', state: 'connected', permissionState: 'requested', historyDays: 30 });
  const sinces = [];
  const s = createSyncService([fakeAdapter('apple_health', { sync: async (since) => { sinces.push(since); return { provider: 'apple_health', ok: true, imported: 0, duplicates: 0, syncedAt: '2026-07-16T10:00:00.000Z' }; } })], repo);
  await s.syncProvider('apple_health');                       // first: history range (30d)
  await s.syncProvider('apple_health');                       // second: cursor − 1d overlap
  const firstSpanDays = (Date.now() - Date.parse(sinces[0])) / 864e5;
  assert.ok(firstSpanDays > 29 && firstSpanDays < 31);
  assert.equal(sinces[1], new Date(Date.parse('2026-07-16T10:00:00.000Z') - 864e5).toISOString());
});

// ── native adapter behaviours with a mocked plugin ─────────────────────────
function mockPlugin(impl = {}) {
  return {
    isAvailable: impl.isAvailable || (async () => ({ available: true })),
    requestPermissions: impl.requestPermissions || (async () => ({ granted: true })),
    getPermissionStatus: async () => ({ state: 'granted' }),
    query: impl.query || (async ({ type }) => ({ records: type === 'steps' ? [{ sourceRecordId: 'daily-steps-2026-07-15', startTime: '2026-07-15T00:00:00Z', value: 6000, unit: 'count' }] : [] })),
    openSettings: async () => {},
  };
}

test('HealthKit unavailable → isAvailable false, connect throws clearly', async () => {
  const repo = createLocalHealthRepository('n1_');
  const a = createNativeAdapter('apple_health', 'ios', { name: 'Apple Health' }, {
    repo, platform: 'ios', plugin: mockPlugin({ isAvailable: async () => ({ available: false, reason: 'No Health data on this device.' }) }),
  });
  assert.equal(await a.isAvailable(), false);
  await assert.rejects(() => a.connect(), /No Health data/);
});

test('web platform → native adapters report unavailable (no faking)', async () => {
  const repo = createLocalHealthRepository('n2_');
  const a = createNativeAdapter('health_connect', 'android', { name: 'Health Connect' }, { repo, platform: 'web', plugin: null });
  assert.equal(await a.isAvailable(), false);
  await assert.rejects(() => a.connect(), /Android app/);
});

test('Health Connect permission denied → disconnected + denied state', async () => {
  const repo = createLocalHealthRepository('n3_');
  const a = createNativeAdapter('health_connect', 'android', { name: 'Health Connect' }, {
    repo, platform: 'android', plugin: mockPlugin({ requestPermissions: async () => ({ granted: false, perType: { steps: 'denied' } }) }),
  });
  await assert.rejects(() => a.connect(), /declined/);
  assert.equal(repo.getConnection('health_connect').permissionState, 'denied');
});

test('partial permission → connected with partial state; sync still works per type', async () => {
  const repo = createLocalHealthRepository('n4_');
  const a = createNativeAdapter('health_connect', 'android', { name: 'Health Connect' }, {
    repo, platform: 'android',
    plugin: mockPlugin({
      requestPermissions: async () => ({ granted: false, perType: { steps: 'granted', sleep: 'denied' } }),
      query: async ({ type }) => {
        if (type === 'steps') return { records: [{ sourceRecordId: 'd1', startTime: '2026-07-15T00:00:00Z', value: 100, unit: 'count' }] };
        throw new Error('SecurityException');
      },
    }),
  });
  await a.connect();
  assert.equal(repo.getConnection('health_connect').permissionState, 'partial');
  const r = await a.sync('2026-07-14T00:00:00Z');
  assert.equal(r.ok, true);                       // partial success is success
  assert.equal(r.imported, 1);
  assert.match(r.error, /unavailable/);           // but the gaps are reported
});

test('permission revoked later → every query fails → sync reports, keeps data', async () => {
  const repo = createLocalHealthRepository('n5_');
  const a = createNativeAdapter('apple_health', 'ios', { name: 'Apple Health' }, {
    repo, platform: 'ios',
    plugin: mockPlugin({ query: async () => { throw new Error('denied'); } }),
  });
  repo.setConnection({ provider: 'apple_health', state: 'connected', permissionState: 'requested' });
  repo.putRecords([{ type: 'steps', startTime: '2026-07-14T00:00:00Z', value: 1, unit: 'count', sourceProvider: 'apple_health', sourceRecordId: 'old' }]);
  const r = await a.sync('2026-07-14T00:00:00Z');
  assert.equal(r.ok, false);
  assert.equal(repo.getRecords().length, 1);      // nothing deleted
});

test('no records available → clean empty sync', async () => {
  const repo = createLocalHealthRepository('n6_');
  const a = createNativeAdapter('apple_health', 'ios', { name: 'Apple Health' }, {
    repo, platform: 'ios', plugin: mockPlugin({ query: async () => ({ records: [] }) }),
  });
  const r = await a.sync('2026-07-14T00:00:00Z');
  assert.equal(r.ok, true);
  assert.equal(r.imported, 0);
});
