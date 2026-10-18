// The full VBT metric set with honest accuracy tiers —
// docs/velocity-tracking-plan.md, "Full VBT metric set".
// From the measured point's smoothed position x(t), the load m and D:
//   v = dx/dt, a = d²x/dt², F = m(g + a), P = F·v
// Derivatives come from the Savitzky–Golay polynomial (smooth.js), never
// from frame differences. Each derivative amplifies noise, so what can be
// trusted depends on the frame rate; anything below its tier is marked
// "estimate" and never shown as exact.

import { at } from './smooth.js';

export const G = 9.81;

/**
 * Accuracy tier per metric. `reliableFps`: frame rate from which the
 * metric can be shown as reliable (Infinity = never). `fairFps`: frame rate
 * from which it's at least "fair". `needs`: what else it requires.
 */
export const METRICS = {
  mv:        { label: 'Mean velocity',              reliableFps: 0,        needs: [] },
  loss:      { label: 'Velocity loss',              reliableFps: 0,        needs: [] },
  rom:       { label: 'Range of motion',            reliableFps: 0,        needs: ['scale'] },
  avgPower:  { label: 'Average power',              reliableFps: 0,        needs: ['scale', 'load'] },
  mpv:       { label: 'Mean propulsive velocity',   reliableFps: 120,      needs: ['scale'] },
  pv:        { label: 'Peak velocity',              reliableFps: 120,      needs: [] },
  peakPower: { label: 'Peak power',                 reliableFps: Infinity, fairFps: 240, needs: ['scale', 'load'] },
  peakForce: { label: 'Peak force',                 reliableFps: Infinity, needs: ['scale', 'load'] },
};

/** Tracking below this share of good frames makes every metric an estimate. */
export const MIN_QUALITY = 0.9;

/**
 * Confidence badge for a metric: 'reliable' | 'fair' | 'estimate'.
 * fps = capture frame rate; quality = share of frames with the measured point.
 */
export function confidence(metric, { fps, quality = 1 }) {
  const m = METRICS[metric];
  if (!m || quality < MIN_QUALITY) return 'estimate';
  if (fps >= m.reliableFps) return 'reliable';
  if (m.fairFps && fps >= m.fairFps) return 'fair';
  return 'estimate';
}

/**
 * Derivative-based metrics of one rep with a velocity.
 *   fit: Savitzky–Golay fit of the measured point (native units)
 *   row: a setVelocities() row (tStart, tEnd, T)
 *   D: rep-1 distance (native), mpu: metres per unit (NaN = unscaled), massKg: system mass
 * Returns { mpv, pv, avgPower, peakPower, peakForce } — SI units when scaled.
 * Metrics that need a scale or a load are NaN without them.
 */
export function repMetrics(fit, row, { D, mpu = NaN, massKg = NaN } = {}) {
  const out = { mpv: NaN, pv: NaN, avgPower: NaN, peakPower: NaN, peakForce: NaN };
  if (row.velocity !== 'ok') return out;
  const scaled = Number.isFinite(mpu) && mpu > 0, k = scaled ? mpu : 1, m = massKg > 0 ? massKg : NaN;
  const inRep = fit.filter((f) => f.t >= row.tStart && f.t <= row.tEnd && Number.isFinite(f.v));
  if (!inRep.length) return out;
  out.pv = Math.max(...inRep.map((f) => f.v)) * k;
  if (!scaled) return out;
  // Mean propulsive velocity: from the start of the lift until the bar
  // decelerates faster than gravity (a < −g), or the end of the lift.
  let tProp = row.tEnd;
  for (let i = 1; i < inRep.length; i++) {
    const a0 = inRep[i - 1].a * k, a1 = inRep[i].a * k;
    if (a0 >= -G && a1 < -G) { tProp = inRep[i - 1].t + ((-G - a0) / (a1 - a0)) * (inRep[i].t - inRep[i - 1].t); break; }
  }
  if (tProp > row.tStart) out.mpv = ((at(fit, tProp) - at(fit, row.tStart)) * k) / (tProp - row.tStart);
  if (Number.isFinite(m)) {
    out.avgPower = (m * G * D * k) / row.T; // work–energy: the bar starts and ends at rest
    out.peakPower = Math.max(...inRep.map((f) => m * (G + f.a * k) * f.v * k));
    out.peakForce = m * (G + Math.max(...inRep.map((f) => f.a * k)));
  }
  return out;
}
