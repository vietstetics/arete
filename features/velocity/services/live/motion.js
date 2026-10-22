// The phone's motion sensors, for true vertical and to notice the phone
// moving. Browser only.
//
// Gravity: the accelerometer reading averaged while the lifter holds still
// before the set, turned into the camera's "up" (camera.js upFromAccel, with
// the iPhone/Android sign difference detected from the phone being upright).
// It's frozen for the set — per-frame readings are too coarse (Chrome rounds
// to 0.1 m/s², about 0.6° of tilt).
//
// iPhone: motion data needs permission, asked for inside the tap that starts
// the camera (requestMotionPermission, before anything is awaited).

import { upFromAccel } from '../vision/camera.js';

/**
 * WebKit — every iPhone and iPad browser — reports accelerationIncludingGravity
 * with the opposite sign to the spec and to Android (a phone lying face up:
 * z = −9.8 instead of +9.8; still so on iPadOS 26). Only WebKit has
 * DeviceMotionEvent.requestPermission, which tells it apart where the user
 * agent can't (iPads). The reading itself still has the last word when the
 * phone is upright enough to tell (upFromAccel's autoSign), in case WebKit
 * ever changes.
 */
export function webkitSign() {
  const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
  return !!DME && typeof DME.requestPermission === 'function';
}

/** Ask for motion access (iOS 13+ needs it from a tap). Resolves true if readings can flow. */
export function requestMotionPermission() {
  const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
  if (!DME) return Promise.resolve(false);
  if (typeof DME.requestPermission === 'function') return DME.requestPermission().then((s) => s === 'granted').catch(() => false);
  return Promise.resolve(true);
}

/** The screen's rotation from its natural orientation (0, 90, 180, 270). */
export function screenAngle() {
  const a = typeof screen !== 'undefined' && screen.orientation && Number.isFinite(screen.orientation.angle) ? screen.orientation.angle
    : typeof window !== 'undefined' && Number.isFinite(window.orientation) ? window.orientation : 0;
  return ((a % 360) + 360) % 360;
}

/**
 * Keeps the last few seconds of motion readings.
 *   watch.start(); … watch.up({ facing, since }) → camera up (unit) or null; watch.moved(t0, t1) → { moved, maxRate }
 * Times are performance.now() milliseconds.
 */
export function createMotionWatch({ keepMs = 8000, logMs = 180000 } = {}) {
  const buf = [];
  // Rotation rates since mark() (the start of counting), for the whole set — a set runs longer than the
  // seconds of readings kept for gravity, and a bump in rep 1 must still show at the end.
  let log = null;
  const onMotion = (ev) => {
    const g = ev.accelerationIncludingGravity, r = ev.rotationRate;
    if (!g || !Number.isFinite(g.x)) return;
    const now = performance.now(), rate = r && Number.isFinite(r.alpha) ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : NaN;
    buf.push({ t: now, x: g.x, y: g.y, z: g.z, rate });
    while (buf.length && now - buf[0].t > keepMs) buf.shift();
    if (log) { log.push({ t: now, rate }); while (log.length && now - log[0].t > logMs) log.shift(); }
  };
  return {
    start() { if (typeof window !== 'undefined') window.addEventListener('devicemotion', onMotion); },
    stop() { if (typeof window !== 'undefined') window.removeEventListener('devicemotion', onMotion); },
    get count() { return buf.length; },
    /** Start keeping rotation rates for moved() (call when counting starts; again for the next set). */
    mark() { log = []; },
    /** Camera up from the readings since `since` (ms); null without enough readings. */
    up({ facing = 'environment', since = performance.now() - 1000 } = {}) {
      const s = buf.filter((b) => b.t >= since);
      if (s.length < 10) return null;
      const m = s.reduce((a, b) => ({ x: a.x + b.x / s.length, y: a.y + b.y / s.length, z: a.z + b.z / s.length }), { x: 0, y: 0, z: 0 });
      if (!(Math.hypot(m.x, m.y, m.z) > 7)) return null; // not a phone at rest
      return upFromAccel(m, { screenAngle: screenAngle(), facing, signFlip: webkitSign(), autoSign: true });
    },
    /**
     * Did the phone rotate during [t0, t1] (ms)? maxRate in °/s; moved if over limit (default 2 °/s). From the
     * readings since mark() if it was called, else the last keepMs. known: false if there were none in [t0, t1].
     */
    moved(t0, t1, { limit = 2 } = {}) {
      const s = (log || buf).filter((b) => b.t >= t0 && b.t <= t1 && Number.isFinite(b.rate));
      if (!s.length) return { moved: false, maxRate: NaN, known: false };
      const maxRate = Math.max(...s.map((b) => b.rate));
      return { moved: maxRate > limit, maxRate, known: true };
    },
  };
}
