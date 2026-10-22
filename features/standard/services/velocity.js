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
 * end are interpolated between frames: at 30 fps, rounding to whole frames
 * alone would be ~8% off on a quick rep.
 * Synthetic regression tests cover known displacement and timing, position
 * jitter and uneven frame intervals; they do not establish camera accuracy.
 * Returns { mv, pv, range, dur } in native units per second, or null.
 */
export function concentricVelocity(samples, t0, t1, { threshold = 0.1 } = {}) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0) || !(threshold > 0 && threshold < 1)) return null;
  if (!Array.isArray(samples) || !samples.every((s, i) => s && Number.isFinite(s.t) && (i === 0 || s.t > samples[i - 1].t))) return null;
  const pts = samples.filter((s) => s.t >= t0 && s.t <= t1 && Number.isFinite(s.y));
  const n = pts.length;
  if (n < 5) return null;
  // A local linear fit at the actual timestamp. An equal-weight moving
  // average shifts positions in time when frame spacings differ and can
  // create false peak speeds even in a perfectly smooth trace.
  const ys = pts.map((point, i) => {
    let count = 0, sx = 0, sxx = 0, sy = 0, sxy = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
      const x = pts[j].t - point.t;
      count++; sx += x; sxx += x * x; sy += pts[j].y; sxy += x * pts[j].y;
    }
    return (sy * sxx - sx * sxy) / (count * sxx - sx * sx);
  });
  const t = pts.map((p) => p.t);
  let iMin = 0;
  for (let i = 1; i < n; i++) if (ys[i] < ys[iMin]) iMin = i;
  let iMax = iMin;
  for (let i = iMin + 1; i < n; i++) if (ys[i] > ys[iMax]) iMax = i;
  if (iMax - iMin < 3) return null;
  // Endpoints have no centred derivative: assigning zero would invent a
  // resting bottom/top when the recording actually started/stopped moving.
  const v = ys.map((_, i) => (i === 0 || i === n - 1 ? NaN : (ys[i + 1] - ys[i - 1]) / (t[i + 1] - t[i - 1])));
  let ip = iMin;
  for (let i = iMin; i <= iMax; i++) if (Number.isFinite(v[i]) && (!Number.isFinite(v[ip]) || v[i] > v[ip])) ip = i;
  const pv = v[ip];
  if (!(pv > 0)) return null;
  const thr = threshold * pv;
  let s = ip; while (s > iMin && v[s - 1] >= thr) s--;
  let e = ip; while (e < iMax && v[e + 1] >= thr) e++;
  if (!(s > 0 && e < n - 1 && Number.isFinite(v[s - 1]) && v[s - 1] < thr && Number.isFinite(v[e + 1]) && v[e + 1] < thr)) return null;
  // Filtering missing positions must not silently bridge a long occlusion.
  for (let i = s; i <= e + 1; i++) if (t[i] - t[i - 1] > 0.5 + 1e-6) return null;
  const cross = (below, above) => {
    const f = (thr - v[below]) / (v[above] - v[below]);
    return { t: t[below] + f * (t[above] - t[below]), y: ys[below] + f * (ys[above] - ys[below]) };
  };
  const A = s > iMin ? cross(s - 1, s) : { t: t[s], y: ys[s] };
  const B = e < iMax ? cross(e + 1, e) : { t: t[e], y: ys[e] };
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
