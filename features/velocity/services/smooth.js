// Savitzky–Golay smoothing on real frame timestamps.
// docs/velocity-tracking-plan.md: "Savitzky–Golay on position; derivatives
// from the fitted polynomial, not frame differences. Same filter for every
// metric so numbers are consistent."
//
// At every frame a cubic is fitted by least squares to the frames within
// ±half seconds, using their actual timestamps (phone video frames are not
// perfectly evenly spaced). Position, velocity and acceleration all come
// from that polynomial. The window is fixed in time, not in frames: on
// simulated lifts a ±83 ms window kept timing and peak velocity accurate
// from 30 to 240 fps, while a fixed frame count amplified camera jitter at
// high frame rates (peak velocity up to ~70% off at 240 fps).

export const SG = { half: 0.083, order: 3 };

/** Solve a small linear system in place (Gaussian elimination, partial pivoting). */
function solve(A) {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let q = c; q <= n; q++) A[r][q] -= f * A[c][q];
    }
  }
  return A.map((row, r) => row[n] / row[r]);
}

/**
 * samples: [{ t, y }] in time order (y may be NaN for missing frames).
 * Returns [{ t, y, v, a, full }] — smoothed position, velocity and
 * acceleration (per second), and `full` = the window reached both sides
 * (edge frames have one-sided fits and must not be trusted for peaks).
 */
export function savitzkyGolay(samples, { half = SG.half, order = SG.order } = {}) {
  const n = samples.length, k = order + 1, out = new Array(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    const ti = samples[i].t;
    if (!Number.isFinite(samples[i].y)) { out[i] = { t: ti, y: NaN, v: NaN, a: NaN, full: false }; continue; }
    while (samples[lo].t < ti - half - 1e-9) lo++;
    while (hi + 1 < n && samples[hi + 1].t <= ti + half + 1e-9) hi++;
    const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
    let m = 0, before = false, after = false;
    for (let j = lo; j <= hi; j++) {
      const y = samples[j].y;
      if (!Number.isFinite(y)) continue;
      const u = (samples[j].t - ti) / half;
      if (u < -0.6) before = true;
      if (u > 0.6) after = true;
      const pw = [1];
      for (let q = 1; q < k; q++) pw.push(pw[q - 1] * u);
      for (let r = 0; r < k; r++) { for (let c = 0; c < k; c++) A[r][c] += pw[r] * pw[c]; A[r][k] += pw[r] * y; }
      m++;
    }
    const c = m > k ? solve(A) : null;
    out[i] = c
      ? { t: ti, y: c[0], v: c[1] / half, a: (2 * c[2]) / (half * half), full: before && after }
      : { t: ti, y: NaN, v: NaN, a: NaN, full: false };
  }
  return out;
}

/** Linear interpolation of field `f` of a fit at time t (NaN outside or across gaps). */
export function at(fit, t, f = 'y') {
  let lo = 0, hi = fit.length - 1;
  if (!fit.length || t < fit[0].t || t > fit[hi].t) return NaN;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fit[mid].t <= t) lo = mid; else hi = mid; }
  const a = fit[lo], b = fit[hi];
  if (b.t === a.t) return a[f];
  return a[f] + ((b[f] - a[f]) * (t - a.t)) / (b.t - a.t);
}
