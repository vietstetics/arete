// Velocity = D / T — docs/velocity-tracking-plan.md (decided by the user).
//   D: set by rep 1 — how far the measured point (hand or weight) travels
//      from leaving the start of the lift to reaching its end on rep 1.
//   T: per rep — time from leaving the start line to reaching the finish
//      line during the lifting (concentric) phase, interpolated between frames.
//   Mean concentric velocity of rep n = D / T_n. Only counted reps get one.
//   Velocity loss = T_1 / T_n (D cancels: no scale needed).
//
// Leaving and reaching a line happen at turning points, where the measured
// point is momentarily still, so they are timed from its speed: the moment
// the smoothed speed rises through 5% of that rep's peak (leaving) and falls
// back through it (reaching), interpolated between frames. Pauses at the
// bottom or top are never counted, and the result doesn't depend on where
// the frames happen to fall.

import { at } from './smooth.js';

export const LEAVE_THRESHOLD = 0.05;
/** The weight (or hand) missing for longer than this inside a rep → that rep's velocity is "unclear". */
export const MAX_LOST = 0.5;

// Never sort or deduplicate here: those operations can join two different
// moments of a lift and manufacture a plausible velocity from a bad clock.
const validWindow = (t0, t1) => Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0;
const ordered = (points) => Array.isArray(points) && points.every((p, i) => p && Number.isFinite(p.t) && (i === 0 || p.t > points[i - 1].t));

/**
 * The lifting phase of one rep inside [t0, t1], from a Savitzky–Golay fit of
 * the measured point (up = lifting). Returns { tStart, tEnd, T, distance, pv,
 * startSeen, endSeen } in fit units, or null if there's no clear lift in the window.
 */
export function concentricTiming(fit, t0, t1, { threshold = LEAVE_THRESHOLD } = {}) {
  if (!validWindow(t0, t1) || !ordered(fit) || !(threshold > 0 && threshold < 1)) return null;
  const idx = [];
  for (let i = 0; i < fit.length; i++) if (fit[i].t >= t0 && fit[i].t <= t1) idx.push(i);
  if (idx.length < 5) return null;
  let ip = -1;
  for (const i of idx) if (fit[i].full && Number.isFinite(fit[i].y) && Number.isFinite(fit[i].v) && (ip < 0 || fit[i].v > fit[ip].v)) ip = i;
  if (ip < 0 || !(fit[ip].v > 0)) return null;
  const pv = fit[ip].v, thr = threshold * pv, first = idx[0], last = idx[idx.length - 1];
  const measured = (i) => Number.isFinite(fit[i].y) && Number.isFinite(fit[i].v);
  const ok = (i) => measured(i) && fit[i].v >= thr;
  // Walk out from the fastest moment. One noisy frame dipping under the
  // threshold doesn't end the lift; two in a row do.
  let s = ip; while (s > first && (ok(s - 1) || (s - 2 >= first && ok(s - 2)))) s--;
  let e = ip; while (e < last && (ok(e + 1) || (e + 2 <= last && ok(e + 2)))) e++;
  while (s < ip && !ok(s)) s++;
  while (e > ip && !ok(e)) e--;
  // Sub-frame crossing between a frame below the threshold and one above it.
  const cross = (below, above) => {
    const a = fit[below], b = fit[above];
    if (!measured(below)) return { t: b.t, y: b.y };
    const k = (thr - a.v) / (b.v - a.v);
    return { t: a.t + k * (b.t - a.t), y: a.y + k * (b.y - a.y) };
  };
  const A = s > first ? cross(s - 1, s) : { t: fit[s].t, y: fit[s].y };
  const B = e < last ? cross(e + 1, e) : { t: fit[e].t, y: fit[e].y };
  if (!(B.t > A.t) || !Number.isFinite(B.t - A.t) || !Number.isFinite(B.y - A.y) || !(B.y > A.y)) return null;
  // Were the start and the end actually seen? (a frame just outside the lift, measured, below the threshold)
  // A lift whose edge is a gap in the data ended where the data stopped, not where the bar did.
  const startSeen = s > first && measured(s - 1) && fit[s - 1].v < thr;
  const endSeen = e < last && measured(e + 1) && fit[e + 1].v < thr;
  return { tStart: A.t, tEnd: B.t, T: B.t - A.t, distance: B.y - A.y, pv, startSeen, endSeen };
}

/** Longest stretch without a measured position inside [t0, t1]. */
export function longestGap(samples, t0, t1) {
  if (!validWindow(t0, t1) || !ordered(samples)) return Infinity;
  let gap = 0, lastSeen = t0;
  for (const s of samples) {
    if (s.t < t0) continue;
    if (s.t > t1) break;
    if (Number.isFinite(s.y)) { gap = Math.max(gap, s.t - lastSeen); lastSeen = s.t; }
  }
  return Math.max(gap, t1 - lastSeen);
}

/**
 * D / T for every rep of a set.
 *   samples: [{ t, y }] measured point (native units, up = lifting)
 *   fit:     savitzkyGolay(samples)
 *   reps:    from the rep counter ({ n, result, isStandard, ... })
 *   windows: per rep { t0, t1 } where its lifting phase lies
 *   mpu:     metres per native unit (NaN = no real-world scale → relative speed only)
 * Returns { D, Dm, rows: [{ n, result, velocity: 'ok' | 'none' | 'unclear', why, T, tStart, tEnd,
 *   distance, mcv, mcvOwn, rel, loss }] } — mcv in m/s when scaled, else native units/s.
 */
export function setVelocities(samples, fit, reps, windows, { mpu = NaN } = {}) {
  const scaled = Number.isFinite(mpu) && mpu > 0;
  const timed = reps.map((r, i) => {
    const w = windows[i];
    if (!w || r.result !== 'counted') return null;
    if (longestGap(samples, w.t0, w.t1) > MAX_LOST + 1e-6) return { lost: true };
    return concentricTiming(fit, w.t0, w.t1);
  });
  const ref = reps.findIndex((r) => r.isStandard);
  const t1 = ref >= 0 ? timed[ref] : null;
  const complete = (tm) => tm && !tm.lost && tm.startSeen && tm.endSeen;
  const D = complete(t1) ? t1.distance : NaN;
  const rows = reps.map((r, i) => {
    const tm = timed[i];
    const base = { n: r.n, result: r.result, velocity: 'none', why: '', T: NaN, tStart: NaN, tEnd: NaN, distance: NaN, mcv: NaN, mcvOwn: NaN, rel: NaN, loss: NaN };
    if (r.result !== 'counted') return { ...base, why: r.result === 'short' ? 'Short rep: no velocity' : 'Unclear rep: no velocity' };
    if (!tm) return { ...base, velocity: 'unclear', why: 'No clear lift found' };
    if (tm.lost) return { ...base, velocity: 'unclear', why: `Lost the measured point for over ${MAX_LOST} s` };
    if (!complete(tm)) return { ...base, velocity: 'unclear', why: `Measured point not seen where the lift ${tm.startSeen ? 'ended' : 'started'}` };
    if (!Number.isFinite(D)) return { ...base, velocity: 'unclear', why: 'Rep 1 has no clear lift, so D is unknown', T: tm.T, tStart: tm.tStart, tEnd: tm.tEnd };
    const k = scaled ? mpu : 1;
    const rel = t1.T / tm.T, distance = tm.distance * k, mcv = (D * k) / tm.T, mcvOwn = distance / tm.T;
    if (![rel, distance, mcv, mcvOwn].every((v) => Number.isFinite(v) && v > 0)) return { ...base, velocity: 'unclear', why: 'Invalid velocity scale or timing' };
    return { ...base, velocity: 'ok', T: tm.T, tStart: tm.tStart, tEnd: tm.tEnd, distance, mcv, mcvOwn, rel, loss: 1 - rel };
  });
  return { D, Dm: scaled && Number.isFinite(D * mpu) ? D * mpu : NaN, scaled, rows };
}

/** (fastest − slowest) / fastest mean velocity among a set's reps with a velocity. */
export function intraSetFatigue(rows) {
  const v = rows.filter((r) => r.velocity === 'ok' && Number.isFinite(r.mcv) && r.mcv > 0).map((r) => r.mcv);
  if (v.length < 2) return NaN;
  const hi = Math.max(...v), lo = Math.min(...v);
  return (hi - lo) / hi;
}

export { at };
