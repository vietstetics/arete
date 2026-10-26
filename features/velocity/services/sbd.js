// Squat, bench or deadlift: which lift, and how many reps, from the camera.
// Pure logic: no camera, no DOM.
//
// Adapted from wrist-sensor rep counting (Dave Ebbelaar, "tracking-barbell-
// exercises": a Butterworth low-pass filter, then one peak per rep) to what a
// camera sees:
//  - The lift, from the set-up: arms pointing up (bench), hands beside the
//    shoulders (squat: the bar on your back), arms hanging with the hands at
//    the knees or lower (deadlift: set up at the bar on the floor).
//  - The reps, from the bar's height: low-pass filtered both ways (no time
//    shift), then every swing of at least a minimum range of motion is half a
//    rep. The repo counts every peak left after a 0.4 Hz filter; a bar height
//    keeps its shape at a higher cut-off, and the minimum swing keeps an
//    unrack, a walkout or a hitch from counting.

/**
 * One frame's verdict on the set-up. pose: 33 landmarks { x, y, visibility } in 0–1 picture
 * coordinates (y down). Returns { lift: 'squat' | 'bench' | 'deadlift' | null, ... }, null when the
 * posture says none of them (walking up to the bar with the arms hanging, say).
 *   r: wrist below shoulder ÷ arm length, per arm (−1 arms straight up, +1 straight down)
 *   near: wrist-to-shoulder distance ÷ arm length (small when the hands hold a bar on the back)
 *   torso: hips below shoulders ÷ arm length (≈1 standing; small lying on a bench, seen from the
 *     feet or the side)
 */
export function classifyPosture(pose, { vw = 1, vh = 1, minVis = 0.5 } = {}) {
  const P = (i) => (pose && pose[i] && (pose[i].visibility ?? 0) >= minVis ? { x: pose[i].x * vw, y: pose[i].y * vh } : null);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const arms = [[11, 13, 15], [12, 14, 16]].map((ids) => ids.map(P)).filter((a) => a.every(Boolean));
  if (!arms.length) return fromLegs(P, d);
  let r = 0, near = 0, len = 0, wy = 0;
  for (const [S, E, W] of arms) {
    const L = d(S, E) + d(E, W);
    if (!(L > 0)) return { lift: null, why: 'arms' };
    r += (W.y - S.y) / L; near += d(S, W) / L; len += L; wy += W.y;
  }
  const k = arms.length;
  r /= k; near /= k; len /= k; wy /= k;
  const mid = (a, b) => { const A = P(a), B = P(b); return A && B ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } : A || B; };
  const sh = mid(11, 12), hip = mid(23, 24), knee = mid(25, 26);
  const torso = sh && hip ? Math.abs(hip.y - sh.y) / len : NaN;
  let lift = null;
  // Thresholds leave room for a phone low down looking up (a powerlifting favourite), which shortens
  // what's high in the picture.
  if (r < -0.45 && torso < 0.7) lift = 'bench';
  else if (Math.abs(r) < 0.5 && near < 0.7 && torso > 0.35) lift = 'squat';
  else if (r > 0.55 && knee && wy >= knee.y - 0.25 * len) lift = 'deadlift';
  return { lift, r, near, torso };
}

/**
 * No arm in view (filmed low, the plates often hide the hands): the legs and trunk decide. Lying, hips
 * level with the shoulders: bench. Standing tall: squat (the hands are on the bar on the back, out of
 * sight). Hips bent well below standing, trunk leaning: deadlift set-up.
 */
function fromLegs(P, d) {
  const legs = [[23, 25, 27], [24, 26, 28]].map((ids) => ids.map(P)).filter((l) => l.every(Boolean));
  const sh = [P(11), P(12)].filter(Boolean);
  if (!legs.length || !sh.length) return { lift: null, why: 'arms' };
  const [H, K, A] = legs[0], S = sh[0], leg = d(H, K) + d(K, A);
  if (!(leg > 0)) return { lift: null, why: 'arms' };
  const hipUp = (A.y - H.y) / leg, trunkUp = (H.y - S.y) / leg, trunkOut = Math.abs(S.x - H.x) / leg;
  let lift = null;
  if (Math.abs(trunkUp) < 0.2 && trunkOut > 0.35) lift = 'bench';
  else if (hipUp > 0.85 && trunkUp > 0.45) lift = 'squat';
  else if (hipUp < 0.75 && trunkUp > 0.1 && trunkOut > 0.25) lift = 'deadlift';
  return { lift, hipUp, trunkUp, why: 'no-arms' };
}

/**
 * Settles on a lift once the set-up has said the same thing for `secs`: at least `share` of the
 * frames in that window (and `minFrames` of them) name it. Frames that name nothing count against.
 *   const det = createLiftDetector(); det.push(t, pose, vw, vh) → 'squat' | 'bench' | 'deadlift' | null
 */
export function createLiftDetector({ secs = 0.4, share = 0.8, minFrames = 8, minVis = 0.5 } = {}) {
  let win = [];
  return {
    push(t, pose, vw, vh) {
      if (!Number.isFinite(t)) return null;
      win.push({ t, lift: pose ? classifyPosture(pose, { vw, vh, minVis }).lift : null });
      while (win.length && t - win[0].t > secs) win.shift();
      if (win.length < minFrames || t - win[0].t < 0.8 * secs) return null;
      const votes = {};
      for (const f of win) if (f.lift) votes[f.lift] = (votes[f.lift] || 0) + 1;
      const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
      return best && votes[best] >= share * win.length ? best : null;
    },
    reset() { win = []; },
  };
}

/** Which lifts start with the lifting part (from the floor), rather than lowering first. */
export const CONCENTRIC_FIRST = { deadlift: true };

/**
 * Butterworth low-pass, run forwards then backwards (zero phase, like scipy's filtfilt), on evenly
 * spaced values. order: even (sections of two poles). The ends are padded by reflection so the
 * filter doesn't start from zero.
 */
export function lowPass(ys, { fs, cutoffHz, order = 4 } = {}) {
  const n = ys.length;
  if (!(n > 2) || !(fs > 0) || !(cutoffHz > 0) || cutoffHz >= fs / 2) return ys.slice();
  const K = Math.tan((Math.PI * cutoffHz) / fs), sections = [];
  for (let s = 1; s <= order / 2; s++) {
    const q = 1 / (2 * Math.sin(((2 * s - 1) * Math.PI) / (2 * order)));
    const norm = 1 / (1 + K / q + K * K), b0 = K * K * norm;
    sections.push({ b0, b1: 2 * b0, b2: b0, a1: 2 * (K * K - 1) * norm, a2: (1 - K / q + K * K) * norm });
  }
  const pad = Math.min(n - 1, Math.round((3 * fs) / cutoffHz));
  const x = [];
  for (let i = pad; i >= 1; i--) x.push(2 * ys[0] - ys[i]);
  x.push(...ys);
  for (let i = n - 2; i >= n - 1 - pad; i--) x.push(2 * ys[n - 1] - ys[i]);
  const run = (v) => {
    let out = v;
    for (const c of sections) {
      const y = new Array(out.length);
      // Started at rest at the first value (the filter passes a constant unchanged).
      let x1 = out[0], x2 = out[0], y1 = out[0], y2 = out[0];
      for (let i = 0; i < out.length; i++) {
        y[i] = c.b0 * out[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = out[i]; y2 = y1; y1 = y[i];
      }
      out = y;
    }
    return out;
  };
  const both = run(run(x).reverse()).reverse();
  return both.slice(pad, pad + n);
}

/**
 * The turning points of a trace that swing by at least `minSwing`: alternating { i, type: 'top' |
 * 'bottom' }. The last one is where the trace was heading when it ended (its swing out is unseen).
 */
export function swings(ys, minSwing) {
  const piv = [];
  let hi = 0, lo = 0, dir = 0;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] > ys[hi]) hi = i;
    if (ys[i] < ys[lo]) lo = i;
    if (dir >= 0 && ys[hi] - ys[i] >= minSwing && hi < i) {
      if (dir === 0 && lo < hi && ys[hi] - ys[lo] >= minSwing) piv.push({ i: lo, type: 'bottom' });
      piv.push({ i: hi, type: 'top' }); dir = -1; lo = i;
    } else if (dir <= 0 && ys[i] - ys[lo] >= minSwing && lo < i) {
      if (dir === 0 && hi < lo && ys[hi] - ys[lo] >= minSwing) piv.push({ i: hi, type: 'top' });
      piv.push({ i: lo, type: 'bottom' }); dir = 1; hi = i;
    }
  }
  if (dir === 1) piv.push({ i: hi, type: 'top', open: true });
  else if (dir === -1) piv.push({ i: lo, type: 'bottom', open: true });
  return piv;
}

/**
 * Reps from the bar's height alone. samples: [{ t (s), y }] in time order, y up (any unit; NaN =
 * not seen). minRom: the smallest swing that is a rep, in y's unit (default 12 cm, for metres).
 * A rep is counted when its lifting part was seen: squat and bench, a bottom the bar rose out of;
 * deadlift, a top the bar was lifted to from below. Gaps longer than `maxGap` are bridged, and the
 * reps across them marked `gap`.
 * Returns { reps: [{ n, tBottom, tTop, yBottom, yTop, rom, gap }], firstMove: 'down' | 'up' | null, fs }.
 */
export function countBarReps(samples, { lift = 'squat', minRom = 0.12, cutoffHz = 1.5, maxGap = 0.5 } = {}) {
  const pts = (samples || []).filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.y));
  for (let i = 1; i < pts.length; i++) if (!(pts[i].t > pts[i - 1].t)) return { reps: [], firstMove: null, fs: NaN };
  if (pts.length < 4) return { reps: [], firstMove: null, fs: NaN };
  // Evenly spaced at the trace's own rate (median frame spacing), between 15 and 60 a second.
  const dts = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
  const fs = Math.min(60, Math.max(15, 1 / dts[dts.length >> 1]));
  const t0 = pts[0].t, m = Math.floor((pts[pts.length - 1].t - t0) * fs) + 1;
  const ts = [], ys = [], gapAt = [];
  for (let k = 0, j = 0; k < m; k++) {
    const t = t0 + k / fs;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    ts.push(t); ys.push(a.y + u * (b.y - a.y)); gapAt.push(b.t - a.t > maxGap);
  }
  const ok = cutoffHz < fs / 2;
  const f = lowPass(ys, { fs, cutoffHz: ok ? cutoffHz : 0.45 * fs });
  const piv = swings(f, minRom);
  const crossesGap = (i0, i1) => { for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) if (gapAt[i]) return true; return false; };
  const reps = [];
  const concentricFirst = !!CONCENTRIC_FIRST[lift];
  piv.forEach((p, k) => {
    if (concentricFirst) {
      // A top lifted to from a bottom just before it.
      const b = piv[k - 1];
      if (p.type !== 'top' || !b) return;
      reps.push({ n: reps.length + 1, tBottom: ts[b.i], tTop: ts[p.i], yBottom: f[b.i], yTop: f[p.i], rom: f[p.i] - f[b.i], gap: crossesGap(b.i, p.i) });
    } else {
      // A bottom the bar rose out of (the top after it; the trace's end if it stopped rising there).
      const top = piv[k + 1];
      if (p.type !== 'bottom' || !top) return;
      reps.push({ n: reps.length + 1, tBottom: ts[p.i], tTop: ts[top.i], yBottom: f[p.i], yTop: f[top.i], rom: f[top.i] - f[p.i], gap: crossesGap(p.i, top.i) });
    }
  });
  const firstMove = piv.length ? (piv[0].type === 'top' ? 'down' : 'up') : null;
  return { reps, firstMove, fs };
}

/** Does the bar's first big move agree with the lift? Squat and bench lower first; a deadlift lifts first. */
export function moveFits(lift, firstMove) {
  if (!firstMove) return null;
  return CONCENTRIC_FIRST[lift] ? firstMove === 'up' : firstMove === 'down';
}
