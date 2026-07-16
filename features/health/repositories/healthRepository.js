// Local health repository — localStorage prototype behind a narrow interface
// (see HealthRepository in ../types/health.ts) so it can move to a real
// database later. Health data NEVER leaves the device from here: no cloud
// writes, no logging of record contents.
//
// Keys:
//   jarvis_health_records      normalised HealthRecord[]
//   jarvis_health_connections  { [provider]: ConnectionStatus }
//   jarvis_health_cursors      { [provider]: ISO }
//   jarvis_health_prefs        { [metric]: provider | 'arete' | 'auto' }
//
// Every read is corruption-safe: a damaged blob falls back to empty rather
// than crashing the app or deleting other data.

const K_RECORDS = 'jarvis_health_records';
const K_CONNS   = 'jarvis_health_connections';
const K_CURSORS = 'jarvis_health_cursors';
const K_PREFS   = 'jarvis_health_prefs';

const MAX_RECORDS = 8000; // ~90 days of daily aggregates + sessions, generous

function safeRead(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (v == null) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
    if (!Array.isArray(fallback) && typeof v !== 'object') return fallback;
    return v;
  } catch {
    return fallback;
  }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota: keep app alive */ }
}

export function createLocalHealthRepository(storagePrefixTestOnly) {
  // storagePrefixTestOnly lets tests isolate keys; production uses defaults.
  const P = storagePrefixTestOnly || '';
  const KR = P + K_RECORDS, KC = P + K_CONNS, KU = P + K_CURSORS, KP = P + K_PREFS;

  return {
    putRecords(records) {
      const all = safeRead(KR, []);
      const seen = new Set(all.map((r) => r.id));
      let added = 0, duplicates = 0;
      for (const r of records || []) {
        if (!r || !r.sourceProvider || !r.sourceRecordId || !r.type || !r.startTime) continue;
        const id = r.sourceProvider + ':' + r.sourceRecordId;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        all.push({ ...r, id, importedAt: r.importedAt || new Date().toISOString() });
        added++;
      }
      // keep the newest records if we ever exceed the cap
      all.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
      write(KR, all.slice(-MAX_RECORDS));
      return { added, duplicates };
    },

    getRecords(type, sinceISO) {
      let all = safeRead(KR, []);
      if (type) all = all.filter((r) => r.type === type);
      if (sinceISO) all = all.filter((r) => r.startTime >= sinceISO);
      return all;
    },

    markDuplicate(id, duplicateOf) {
      const all = safeRead(KR, []);
      const r = all.find((x) => x.id === id);
      if (r) { r.duplicateOf = duplicateOf; write(KR, all); }
    },

    getConnection(provider) {
      const c = safeRead(KC, {})[provider];
      return c && typeof c === 'object' ? c : null;
    },
    setConnection(status) {
      const all = safeRead(KC, {});
      all[status.provider] = status;
      write(KC, all);
    },

    getCursor(provider) {
      const v = safeRead(KU, {})[provider];
      return typeof v === 'string' ? v : null;
    },
    setCursor(provider, iso) {
      const all = safeRead(KU, {});
      all[provider] = iso;
      write(KU, all);
    },

    getPreferences() {
      const d = { steps: 'auto', sleep: 'auto', workouts: 'arete', recovery: 'auto', weight: 'auto', active_calories: 'auto' };
      return { ...d, ...safeRead(KP, {}) };
    },
    setPreference(metric, source) {
      const all = safeRead(KP, {});
      all[metric] = source;
      write(KP, all);
    },
  };
}

export const healthRepository = createLocalHealthRepository();
