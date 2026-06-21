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

// Web pedometer: when there's no native plugin (e.g. the site as a PWA), count
// steps from the phone's motion sensor. Asks for "Motion & Fitness" access via
// DeviceMotionEvent.requestPermission() (iOS) and detects steps with simple
// peak-detection on acceleration magnitude. Only counts while the page is open
// and ACCUMULATES onto today's stored total (the sensor isn't authoritative
// like the native one). ponytail: thresholds are a reasonable approximation,
// not a calibrated medical-grade pedometer.
export function createMotionStepService(repo) {
  let handler = null, base = 0, session = 0;
  let smoothed = 9.8, prevDyn = 0, lastStep = 0;
  const THRESH = 1.1;   // m/s² above the gravity baseline to count as a stride
  const MIN_MS = 280;   // debounce → max ~3.5 steps/sec

  return {
    isNative: false,
    source: 'phone-motion',
    async isAvailable() {
      return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    },
    async requestPermission() {
      const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
      if (DME && typeof DME.requestPermission === 'function') {
        try { return (await DME.requestPermission()) === 'granted'; } catch { return false; }
      }
      return true; // Android/desktop: motion is available without an explicit prompt
    },
    async getTodaySteps() {
      const r = repo.getByDate(localDateString());
      return r ? r.steps : 0;
    },
    async getStepsForDate(date) {
      const r = repo.getByDate(date);
      return r ? r.steps : 0;
    },
    async getStepsForRange(startDate, endDate) {
      return repo.getRange(startDate, endDate).map((r) => ({ date: r.date, steps: r.steps, source: r.source || 'phone-motion' }));
    },
    async startLiveUpdates(callback) {
      const cur = repo.getByDate(localDateString());
      base = cur ? cur.steps : 0;
      session = 0;
      handler = (ev) => {
        const a = ev.accelerationIncludingGravity || ev.acceleration;
        if (!a) return;
        const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
        smoothed = smoothed * 0.9 + mag * 0.1;          // low-pass baseline (gravity)
        const dyn = mag - smoothed;
        const now = Date.now();
        if (dyn > THRESH && prevDyn <= THRESH && now - lastStep > MIN_MS) {
          lastStep = now;
          session += 1;
          callback(base + session);
        }
        prevDyn = dyn;
      };
      window.addEventListener('devicemotion', handler);
    },
    async stopLiveUpdates() {
      if (handler) window.removeEventListener('devicemotion', handler);
      handler = null;
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

/**
 * Native plugin when inside Capacitor; else the web motion pedometer when the
 * browser exposes DeviceMotion; else manual entry.
 */
export function getStepService(repo) {
  const plugin = getStepCounterPlugin();
  if (plugin) return createNativeStepService(plugin);
  if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) return createMotionStepService(repo);
  return createManualStepService(repo);
}
