// Orchestrates pulling totals from the phone (source of truth) and persisting
// one record per local date. Upsert-by-date means refreshing the app or
// re-syncing never creates duplicate rows.

import { todayKey, addDays } from '../util/date.js';

export function createStepSyncService(service, repo) {
  const nowIso = () => new Date().toISOString();
  const source = () => service.source || 'manual';

  return {
    /** Read today's steps from the phone and store today's record. */
    async syncToday() {
      const steps = await service.getTodaySteps();
      repo.upsert({ date: todayKey(), steps, goal: repo.getGoal(), source: source(), lastSyncedAt: nowIso() });
      return steps;
    },

    /** Read recent daily totals from the phone and upsert each (deduped by date). */
    async syncHistory(days = 30) {
      const end = todayKey();
      const start = addDays(end, -(days - 1));
      let totals = [];
      try { totals = await service.getStepsForRange(start, end); } catch { totals = []; }
      const goal = repo.getGoal();
      const iso = nowIso();
      for (const t of totals) {
        if (!t || !t.date) continue;
        repo.upsert({ date: t.date, steps: t.steps, goal, source: t.source || source(), lastSyncedAt: iso });
      }
      return totals.length;
    },

    /** Manual entry path (denied permission / no sensor). Clearly tagged 'manual'. */
    saveManual(date, steps) {
      repo.upsert({
        date: date || todayKey(),
        steps: Math.max(0, steps | 0),
        goal: repo.getGoal(),
        source: 'manual',
        lastSyncedAt: nowIso(),
      });
    },

    /** Live updates while the app is open — keeps today's record current. */
    async startLive(onSteps) {
      await service.startLiveUpdates((steps) => {
        repo.upsert({ date: todayKey(), steps, goal: repo.getGoal(), source: source(), lastSyncedAt: nowIso() });
        if (onSteps) onSteps(steps);
      });
    },
    async stopLive() {
      await service.stopLiveUpdates();
    },
  };
}
