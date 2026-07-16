// Sync orchestration. Incremental: each provider keeps an ISO cursor; a sync
// pulls [cursor − 1 day overlap → now] rather than re-importing history.
// First sync uses the user-chosen history range (today / 7 / 30 / 90 days).
// Errors are surfaced on the connection status and NEVER delete stored data.
// Triggers: Sync now, app open, return to foreground, just-connected.

import { healthRepository } from '../repositories/healthRepository.js';
import { applyAll } from './healthDataService.js';

const OVERLAP_MS = 24 * 3600 * 1000; // re-read 1 day so late-arriving edits land

export function createSyncService(adapters, repo) {
  const r = repo || healthRepository;
  const byId = {};
  for (const a of adapters) byId[a.provider] = a;

  async function syncProvider(providerId) {
    const adapter = byId[providerId];
    const conn = r.getConnection(providerId);
    if (!adapter || !conn || conn.state !== 'connected') {
      return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: 'Not connected', syncedAt: new Date().toISOString() };
    }
    let since = r.getCursor(providerId);
    if (since) since = new Date(Date.parse(since) - OVERLAP_MS).toISOString();
    else {
      const days = conn.historyDays || 7;
      since = new Date(Date.now() - (days === 1 ? 1 : days) * 24 * 3600 * 1000).toISOString();
    }
    try {
      const res = await adapter.sync(since);
      if (res.ok) {
        r.setCursor(providerId, res.syncedAt);
        r.setConnection({ ...conn, lastSyncAt: res.syncedAt, lastError: undefined });
      } else {
        r.setConnection({ ...conn, lastError: res.error || 'Sync failed' });
      }
      return res;
    } catch (e) {
      // interrupted sync: cursor untouched → next sync retries the same span;
      // already-stored records stay intact.
      const msg = (e && e.message) || 'Sync failed';
      r.setConnection({ ...conn, lastError: msg });
      return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: msg, syncedAt: new Date().toISOString() };
    }
  }

  async function syncAll() {
    const results = [];
    for (const id in byId) {
      const conn = r.getConnection(id);
      if (conn && conn.state === 'connected') results.push(await syncProvider(id));
    }
    const applied = applyAll(r);
    return { results, applied };
  }

  return { syncProvider, syncAll };
}

/** App-open + foreground auto-sync (silent). Call once per page that wants it. */
export function installAutoSync(syncService, { minIntervalMs = 5 * 60 * 1000 } = {}) {
  let last = 0;
  const run = () => {
    if (Date.now() - last < minIntervalMs) return;
    last = Date.now();
    syncService.syncAll().catch(() => {});
  };
  run(); // app open
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run(); // return to foreground
  });
}
