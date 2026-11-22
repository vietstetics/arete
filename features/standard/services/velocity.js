// Bar velocity per rep, and what it says about adding weight.
// Pure logic: no camera, no DOM.
//
// Positions arrive in "native" units with up = the lifting direction:
// body units for squat and bench (a distance divided by a body length that
// was locked before rep 1), radians of elbow flexion for the curl.
// metresPerUnit() turns them into metres using the lifter's height.

/**
 * Segment lengths as fractions of standing height (Winter, Biomechanics and
 * Motor Control of Human Movement, after Drillis & Contini). Real bodies
 * vary by a few percent, so absolute m/s carries that error; rep-to-rep and
 * set-to-set comparisons for the same person don't.
 */
export const BODY = {
  shoulderAboveAnkle: 0.818 - 0.039, // shoulder height − ankle height: the bar on your back, standing
  arm: 0.186 + 0.146,                // upper arm + forearm: shoulder → wrist
  curlRadius: 0.146 + 0.108 / 2,     // forearm + half the hand: elbow → dumbbell
  leg: 0.245 + 0.246,                // thigh + shank: hip → knee → ankle (the deadlift's body unit)
};

/**
 * Mean velocity at a true 1RM / failure, in m/s (the "minimum velocity
 * threshold"): about 0.30 for the back squat and 0.17 for the bench press in
 * the velocity-based training literature (Sánchez-Medina & González-Badillo).
 * There is no settled value for curls.
 */
export const MVT = { squat: 0.30, bench: 0.17 };

/**
 * Working assumption, not a published constant: close to failure, mean
 * velocity drops by about this much per rep (m/s). Used as the minimum
 * slowdown when estimating reps left, so a set that hasn't slowed yet isn't
 * read as having endless reps in it.
 */
export const NEAR_FAILURE_DROP = { squat: 0.06, bench: 0.05 };

/** Relative fallback (curls, or no height): failure ≈ half your best speed. */
const REL_FAILURE = 0.5, REL_DROP = 0.08;

/** Anthropometric estimate of metres per native unit; NaN without a finite calibration. */
export function metresPerUnit(lift, { heightM, scale, standShoulderPx, armPx } = {}) {
  if (!Number.isFinite(heightM) || !(heightM > 0)) return NaN;
  if (lift === 'curl') return BODY.curlRadius * heightM;
  if (!Number.isFinite(scale) || !(scale > 0)) return NaN;
  if (lift === 'deadlift') return BODY.leg * heightM; // the hands' height is already in leg lengths
  const length = lift === 'squat' ? standShoulderPx : lift === 'bench' ? armPx : NaN;
  const fraction = lift === 'squat' ? BODY.shoulderAboveAnkle : BODY.arm;
  const mpu = Number.isFinite(length) && length > 0 ? (scale * fraction * heightM) / length : NaN;
  return Number.isFinite(mpu) && mpu > 0 ? mpu : NaN;
}

/**
 * Mean and peak velocity of the lifting part of one rep.
 * samples: [{ t (s), y }] in time order, y up = lifting. The window [t0, t1]
 * should hold the rep's bottom and its top. The lift is the stretch of
 * movement around the fastest moment where the speed stays above
 * `threshold` × peak, so pauses at the bottom or top never count. Start and
 * end are interpolated, so the result doesn't depend on where frames fell.
 *
 * Everything is defined in time, never in frames, so the same rep filmed at
 * 15, 24, 30 or 60 fps gives the same speed: the trace is put on an even
 * `grid` (s) and smoothed over a fixed `smooth` (s, Gaussian σ) before speeds
 * are taken, and a dip in speed shorter than `bridge` (s) inside the lift is
 * part of it (a noisy frame, or a sticking point, doesn't end the rep early:
 * ending early times only the fastest part and reads far too fast).
 * scripts/velocity-consistency.mjs replays real clips at other frame rates,
 * distances and noise levels to check this; synthetic tests cover known
 * displacement and timing. Neither establishes absolute camera accuracy.
 * Returns { mv, pv, range, dur } in native units per second, or null.
 */
export function concentricVelocity(samples, t0, t1, { threshold = 0.1, smooth = 0.05, bridge = 0.2, grid = 0.01 } = {}) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0) || !(threshold > 0 && threshold < 1)) return null;
  if (!Array.isArray(samples) || !samples.every((s, i) => s && Number.isFinite(s.t) && (i === 0 || s.t > samples[i - 1].t))) return null;
  const pts = samples.filter((s) => s.t >= t0 && s.t <= t1 && Number.isFinite(s.y));
  const n = pts.length;
  if (n < 5) return null;
  // Even time grid (linear between samples), then a Gaussian of fixed width in seconds.
  const g0 = pts[0].t, m = Math.floor((pts[n - 1].t - g0) / grid) + 1;
  if (m < 5) return null;
  const t = new Float64Array(m), raw = new Float64Array(m);
  for (let i = 0, k = 0; i < m; i++) {
    const ti = g0 + i * grid; t[i] = ti;
    while (k < n - 2 && pts[k + 1].t < ti) k++;
    const a = pts[k], b = pts[Math.min(k + 1, n - 1)];
    raw[i] = b.t > a.t ? a.y + ((ti - a.t) / (b.t - a.t)) * (b.y - a.y) : a.y;
  }
  const ys = new Float64Array(m);
  const half = Math.ceil((3 * smooth) / grid);
  const wts = Array.from({ length: 2 * half + 1 }, (_, j) => Math.exp(-0.5 * (((j - half) * grid) / smooth) ** 2));
  for (let i = 0; i < m; i++) {
    let sw = 0, sy = 0;
    for (let j = -half; j <= half; j++) { const q = i + j; if (q < 0 || q >= m) continue; sw += wts[j + half]; sy += wts[j + half] * raw[q]; }
    ys[i] = sy / sw;
  }
  let iMin = 0;
  for (let i = 1; i < m; i++) if (ys[i] < ys[iMin]) iMin = i;
  let iMax = iMin;
  for (let i = iMin + 1; i < m; i++) if (ys[i] > ys[iMax]) iMax = i;
  if ((t[iMax] - t[iMin]) < 0.1) return null;
  // Endpoints have no centred derivative: assigning zero would invent a
  // resting bottom/top when the recording actually started/stopped moving.
  const v = Array.from(ys, (_, i) => (i === 0 || i === m - 1 ? NaN : (ys[i + 1] - ys[i - 1]) / (t[i + 1] - t[i - 1])));
  // The heart of the lift, found by position (robust): from where it last leaves the bottom 5% of its
  // range to where it first reaches the top 5%, through the moment it passes halfway. Everything in
  // between belongs to the lift whatever the speed does there (a sticking point, a noisy frame).
  const range0 = ys[iMax] - ys[iMin];
  if (!(range0 > 0)) return null;
  const lvl = (k) => ys[iMin] + k * range0;
  let c = iMin; while (c < iMax && ys[c] < lvl(0.5)) c++;
  let a = c; while (a > iMin && ys[a] > lvl(0.05)) a--;
  let b = c; while (b < iMax && ys[b] < lvl(0.95)) b++;
  if (!(t[b] > t[a])) return null;
  // Then out to where the movement really starts and stops: the speed falling below `threshold` × the
  // heart's mean speed (a mean, not the single fastest moment, which one noisy frame can move), with
  // any dip shorter than `bridge` crossed if the speed comes back.
  const core = (0.9 * range0) / (t[b] - t[a]);
  const thr = threshold * core, gap = Math.round(bridge / grid);
  let s = a;
  while (s > iMin) {
    if (v[s - 1] >= thr) { s--; continue; }
    let j = s - 1; while (j > iMin && j >= s - gap && !(v[j] >= thr)) j--;
    if (j >= s - gap && j > iMin && v[j] >= thr) s = j; else break;
  }
  let e = b;
  while (e < iMax) {
    if (v[e + 1] >= thr) { e++; continue; }
    let j = e + 1; while (j < iMax && j <= e + gap && !(v[j] >= thr)) j++;
    if (j <= e + gap && j < iMax && v[j] >= thr) e = j; else break;
  }
  let pv = -Infinity;
  for (let i = s; i <= e; i++) if (Number.isFinite(v[i]) && v[i] > pv) pv = v[i];
  if (!(pv > 0)) return null;
  if (!(s > 0 && e < m - 1 && Number.isFinite(v[s - 1]) && v[s - 1] < thr && Number.isFinite(v[e + 1]) && v[e + 1] < thr)) return null;
  const cross = (below, above) => {
    const f = (thr - v[below]) / (v[above] - v[below]);
    return { t: t[below] + f * (t[above] - t[below]), y: ys[below] + f * (ys[above] - ys[below]) };
  };
  const A = s > iMin ? cross(s - 1, s) : { t: t[s], y: ys[s] };
  const B = e < iMax ? cross(e + 1, e) : { t: t[e], y: ys[e] };
  // Filtering missing positions must not silently bridge a long occlusion.
  for (let i = 1; i < n; i++) if (pts[i].t > A.t && pts[i - 1].t < B.t && pts[i].t - pts[i - 1].t > 0.5 + 1e-6) return null;
  const dur = B.t - A.t, mv = (B.y - A.y) / dur, range = ys[iMax] - ys[iMin];
  if (!(dur > 0) || !Number.isFinite(mv) || !(mv > 0) || !Number.isFinite(pv) || !Number.isFinite(range)) return null;
  return { mv, pv, range, dur };
}

/** Least-squares slope of ys against 0, 1, 2… */
function slope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return num / den;
}

/**
 * Estimated reps left in the tank after the last rep: how far the last rep's
 * speed is above failure speed, divided by how fast you are slowing down
 * (the steeper of your last three reps' trend and the near-failure drop).
 * mvs: mean velocities in rep order. metres: are they in m/s?
 */
export function estimateRir(mvs, { lift, metres }) {
  if (mvs.length < 2 || !mvs.every((v) => Number.isFinite(v) && v > 0)) return null;
  const best = Math.max(...mvs.slice(0, 3)), last = mvs[mvs.length - 1];
  const trend = -slope(mvs.slice(-3));
  const abs = metres && MVT[lift];
  const floor = abs ? MVT[lift] : REL_FAILURE * best;
  const drop = Math.max(trend, abs ? NEAR_FAILURE_DROP[lift] : REL_DROP * best);
  return Math.max(0, (last - floor) / drop);
}

/**
 * The call for the next set, from this set's reps ({ mv, result } in order).
 *   add  — about 3 or more reps left: the weight is too light for this rep count
 *   keep — 1–2 reps left: keep the weight, aim for one more rep next time
 *   hold — at or near failure, or the range broke down at the end
 *   none — not enough clear reps to say
 */
export function setVerdict(reps, { lift, metres }) {
  const timed = reps.filter((r) => r.result === 'counted' && Number.isFinite(r.mv) && r.mv > 0);
  if (timed.length < 2) return { kind: 'none' };
  const mvs = timed.map((r) => r.mv);
  const best = Math.max(...mvs.slice(0, 3)), last = mvs[mvs.length - 1];
  const loss = best > 0 ? (best - last) / best : 0;
  const rir = estimateRir(mvs, { lift, metres });
  const brokeDown = reps.slice(-2).some((r) => r.result === 'short');
  const kind = brokeDown ? 'hold' : rir >= 3 ? 'add' : rir >= 1 ? 'keep' : 'hold';
  return { kind, rir, best, last, loss, brokeDown };
}

/** Velocity loss band for colouring: under 20% fresh, 20–40% working, 40%+ near failure. */
export const lossBand = (loss) => (loss < 0.2 ? 'fresh' : loss < 0.4 ? 'work' : 'grind');

/**
 * The most recent earlier set at the same weight (and units), and how this
 * set's best rep compares: positive delta = faster = stronger at that load.
 */
export function compareToLast(history, { kg, best, metres }) {
  if (!(kg > 0) || !Number.isFinite(best)) return null;
  const prev = history.filter((h) => h.kg === kg && h.metres === metres && Number.isFinite(h.best)).sort((a, b) => b.at - a.at)[0];
  if (!prev) return null;
  return { prev, delta: best - prev.best, rel: prev.best > 0 ? (best - prev.best) / prev.best : 0 };
}

/** p-th quantile (0–1) of a list of numbers. */
export function quantile(xs, p) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[i];
}
