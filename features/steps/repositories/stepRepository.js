// localStorage-backed StepRepository. One record per local date — upsert keyed
// by date guarantees no duplicate rows when the app refreshes or re-syncs.
// Storage is injectable so the same code is unit-testable and swappable for a
// real database later (the phone sensor stays the source of truth either way).

const KEY = 'jarvis_steps';
const GOAL_KEY = 'jarvis_steps_goal';
export const DEFAULT_GOAL = 10000;

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  // Last-resort in-memory shim (e.g. SSR / tests without injection)
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

export function createStepRepository(storage) {
  const store = resolveStorage(storage);

  function readAll() {
    try {
      return JSON.parse(store.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }
  function writeAll(map) {
    store.setItem(KEY, JSON.stringify(map));
  }

  return {
    getByDate(date) {
      return readAll()[date] || null;
    },

    /** Insert or replace the single record for record.date. */
    upsert(record) {
      if (!record || !record.date) return;
      const map = readAll();
      map[record.date] = {
        date: record.date,
        steps: Math.max(0, Math.round(record.steps || 0)),
        goal: record.goal || DEFAULT_GOAL,
        source: record.source || 'manual',
        lastSyncedAt: record.lastSyncedAt || new Date().toISOString(),
      };
      writeAll(map);
    },

    getRange(startDate, endDate) {
      return Object.values(readAll())
        .filter((r) => r.date >= startDate && r.date <= endDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },

    all() {
      return Object.values(readAll()).sort((a, b) => (a.date < b.date ? -1 : 1));
    },

    getGoal() {
      const g = parseInt(store.getItem(GOAL_KEY), 10);
      return Number.isFinite(g) && g > 0 ? g : DEFAULT_GOAL;
    },
    setGoal(goal) {
      const g = Math.max(1, Math.round(goal || DEFAULT_GOAL));
      store.setItem(GOAL_KEY, String(g));
    },
  };
}
