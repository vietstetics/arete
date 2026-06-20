// StepTrackingService implementations. The phone sensor is the source of truth.
//   - Native: bridges to the Capacitor StepCounter plugin (CMPedometer on iOS,
//     Health Connect / TYPE_STEP_COUNTER on Android).
//   - Manual: web fallback — there is no pedometer in a browser, so
//     isAvailable() is false and the UI routes the user to manual entry.

import { localDateString } from '../util/date.js';
import { getStepCounterPlugin, nativePlatform } from '../native/stepCounterPlugin.js';

export function createNativeStepService(plugin) {
  let live = null;
  return {
    isNative: true,
    source: nativePlatform(), // 'iphone' | 'android-phone'
    async isAvailable() {
      try { return !!(await plugin.isAvailable()).available; } catch { return false; }
    },
    async requestPermission() {
      try { return !!(await plugin.requestPermission()).granted; } catch { return false; }
    },
    async getTodaySteps() {
      try { return (await plugin.getTodaySteps()).steps | 0; } catch { return 0; }
    },
    async getStepsForDate(date) {
      try { return (await plugin.getStepsForDate({ date })).steps | 0; } catch { return 0; }
    },
    async getStepsForRange(startDate, endDate) {
      try { return (await plugin.getStepsForRange({ startDate, endDate })).totals || []; } catch { return []; }
    },
    async startLiveUpdates(callback) {
      live = await plugin.addListener('stepUpdate', (d) => callback((d && d.steps) | 0));
      await plugin.startLiveUpdates();
    },
    async stopLiveUpdates() {
      try { await plugin.stopLiveUpdates(); } catch {}
      if (live && live.remove) live.remove();
      live = null;
    },
  };
}

export function createManualStepService(repo) {
  return {
    isNative: false,
    source: 'manual',
    async isAvailable() { return false; },
    async requestPermission() { return false; },
    async getTodaySteps() {
      const r = repo.getByDate(localDateString());
      return r ? r.steps : 0;
    },
    async getStepsForDate(date) {
      const r = repo.getByDate(date);
      return r ? r.steps : 0;
    },
    async getStepsForRange(startDate, endDate) {
      return repo.getRange(startDate, endDate).map((r) => ({ date: r.date, steps: r.steps, source: 'manual' }));
    },
    async startLiveUpdates() {},
    async stopLiveUpdates() {},
  };
}

/** Picks the native service when running inside Capacitor, else manual. */
export function getStepService(repo) {
  const plugin = getStepCounterPlugin();
  return plugin ? createNativeStepService(plugin) : createManualStepService(repo);
}
