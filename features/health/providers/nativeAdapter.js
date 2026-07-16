// Shared implementation for the two on-device platforms (Apple Health via
// HealthKit, Android Health Connect). Both are backed by the same custom
// Capacitor HealthPlugin; only the platform gate and copy differ.

import { getHealthPlugin, platform } from '../native/healthPlugin.js';
import { healthRepository } from '../repositories/healthRepository.js';

export const READ_TYPES = [
  'steps', 'sleep', 'workout', 'active_calories', 'distance',
  'heart_rate', 'resting_heart_rate', 'hrv', 'weight', 'body_fat',
];

export function createNativeAdapter(providerId, requiredPlatform, info, deps) {
  const repo = (deps && deps.repo) || healthRepository;
  const plugin = () => (deps && deps.plugin) || getHealthPlugin();
  const plat = () => (deps && deps.platform) || platform();

  function baseStatus() {
    return repo.getConnection(providerId) || {
      provider: providerId, state: 'disconnected', permissionState: 'not_requested',
    };
  }

  return {
    provider: providerId,
    info,

    async isAvailable() {
      if (plat() !== requiredPlatform) return false;
      const p = plugin();
      if (!p) return false;
      try { return !!(await p.isAvailable()).available; } catch { return false; }
    },

    async connect() {
      const p = plugin();
      if (!p || plat() !== requiredPlatform) throw new Error(info.name + ' is only available in the ' + (requiredPlatform === 'ios' ? 'iPhone' : 'Android') + ' app.');
      const avail = await p.isAvailable();
      if (!avail.available) throw new Error(avail.reason || info.name + ' isn’t available on this device.');
      const res = await p.requestPermissions({ types: READ_TYPES });
      // HealthKit never discloses read denials — 'requested' is the honest state.
      const permissionState = providerId === 'apple_health'
        ? 'requested'
        : res.granted ? 'granted' : (res.perType && Object.values(res.perType).some((v) => v === 'granted') ? 'partial' : 'denied');
      if (providerId !== 'apple_health' && permissionState === 'denied') {
        repo.setConnection({ ...baseStatus(), state: 'disconnected', permissionState });
        throw new Error('Permission was declined. You can grant it later from Health Connect settings.');
      }
      repo.setConnection({ ...baseStatus(), state: 'connected', permissionState });
    },

    async disconnect() {
      // Read permission revocation happens in the OS (Health app / Health
      // Connect settings) — we stop reading and drop our connection state.
      const c = baseStatus();
      repo.setConnection({ ...c, state: 'disconnected' });
    },

    async getConnectionStatus() { return baseStatus(); },

    async getCapabilities() { return READ_TYPES.slice(); },

    async sync(since) {
      const p = plugin();
      if (!p) return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: 'Native platform not available', syncedAt: new Date().toISOString() };
      const endISO = new Date().toISOString();
      const startISO = since || new Date(Date.now() - 7 * 864e5).toISOString();
      let imported = 0, duplicates = 0;
      const errors = [];
      for (const type of READ_TYPES) {
        try {
          const { records } = await p.query({ type, startISO, endISO });
          const out = (records || []).map((rec) => ({
            id: providerId + ':' + rec.sourceRecordId,
            type,
            startTime: rec.startTime,
            endTime: rec.endTime,
            value: rec.value,
            unit: rec.unit,
            sourceProvider: providerId,
            sourceRecordId: rec.sourceRecordId,
            sourceDevice: rec.sourceDevice,
            importedAt: new Date().toISOString(),
            meta: rec.meta,
          }));
          const r = repo.putRecords(out);
          imported += r.added; duplicates += r.duplicates;
        } catch (e) {
          // partial permission: some types fail while others succeed — keep going
          errors.push(type);
        }
      }
      const ok = errors.length < READ_TYPES.length; // total failure only when nothing readable
      return {
        provider: providerId, ok, imported, duplicates,
        error: ok ? (errors.length ? 'Some data types unavailable: ' + errors.join(', ') : undefined) : 'Couldn’t read any data — check permissions.',
        syncedAt: endISO,
      };
    },
  };
}
