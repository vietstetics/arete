// Recognising a lift from how the body moves, whatever way up the body is.
//
// Every angle here is measured in the lifter's own frame, built from the torso and shoulders:
//   U  up the torso (mid-hip → mid-shoulder)
//   L  to the lifter's left (right shoulder → left shoulder, made square to U)
//   F  the way the chest faces (L × U)
// So a front raise is "the arm rising in front of the chest" (U–F plane) standing, seated, on an
// incline or lying on a bench pulling a cable, and a lateral raise is "the arm rising out to the
// side" (U–L plane). Gravity only decides the posture label (standing / inclined / lying).
//
// Uses MediaPipe's 3D world landmarks (metres, y down, right-handed) when given: then the front /
// side plane can be told from any camera angle. With only the 2D picture the raise is measured but
// its plane can't be (a camera can't see depth), and the result says so.
//
// Landmarks: 0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles.

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : null; };
const mid = (a, b) => mul(add(a, b), 0.5);
const angleAt = (a, b, c) => { const u = unit(sub(a, b)), v = unit(sub(c, b)); return u && v ? Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * DEG : NaN; };

/**
 * Body-relative joint angles for one frame (degrees), or null if the torso can't be seen.
 * pose: 33 landmarks {x,y,z,visibility}. world: optional 33 world landmarks (preferred).
 * Per side (L = lifter's left, R = right):
 *   elev   arm raised from the side of the body: 0 down, 90 level with the shoulder, 180 overhead
 *   plane  which way that raise points: 0 straight in front, 90 out to the side, >90 behind
 *   elbow  180 = straight;  hip  shoulder–hip–knee;  knee  hip–knee–ankle
 * posture: tilt of the torso from upright (0 standing, 90 lying) and which way the chest faces.
 */
export function bodyAngles(pose, world = null, { minVis = 0.5, vw = 1, vh = 1 } = {}) {
  if (!pose || pose.length < 29) return null;
  const vis = (i) => (pose[i]?.visibility ?? 1) >= minVis;
  const three = !!(world && world.length >= 29);
  const P = three ? (i) => [world[i].x, world[i].y, world[i].z] : (i) => [pose[i].x * vw, pose[i].y * vh, 0];
  if (![11, 12, 23, 24].every(vis)) return null;
  const sh = mid(P(11), P(12)), hp = mid(P(23), P(24));
  const U = unit(sub(sh, hp));
  const Lraw = sub(P(11), P(12));
  const L = U && unit(sub(Lraw, mul(U, dot(Lraw, U))));
  if (!U || !L) return null;
  const F = cross(L, U);
  const side = (s) => {
    const [S, E, W, H, K, A] = s === 'L' ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28];
    const out = { elev: NaN, plane: NaN, elbow: NaN, hip: NaN, knee: NaN };
    if (vis(S) && vis(E)) {
      const arm = sub(P(E), P(S)), n = len(arm);
      if (n > 1e-9) {
        const u = dot(arm, U) / n, f = dot(arm, F) / n, l = (dot(arm, L) / n) * (s === 'L' ? 1 : -1); // l: outward
        out.elev = Math.acos(Math.max(-1, Math.min(1, -u))) * DEG;
        if (three) out.plane = Math.atan2(l, f) * DEG; // 0 front, 90 side
      }
      if (vis(W)) out.elbow = angleAt(P(S), P(E), P(W));
    }
    if (vis(S) && vis(H) && vis(K)) out.hip = angleAt(P(S), P(H), P(K));
    if (vis(H) && vis(K) && vis(A)) out.knee = angleAt(P(H), P(K), P(A));
    return out;
  };
  // Gravity: the camera is upright, so "down" is the picture's down (y grows downwards in both spaces).
  const G = [0, 1, 0];
  const tilt = Math.acos(Math.max(-1, Math.min(1, -dot(U, G)))) * DEG;
  const chest = dot(F, G); // < 0: chest faces up (on your back)
  return { L: side('L'), R: side('R'), three, posture: { tilt, chestUp: three ? chest < 0 : null } };
}

/** "Standing / upright", "Inclined", "Lying on your back" … from the torso's tilt. */
export function postureLabel({ tilt, chestUp }) {
  if (!Number.isFinite(tilt)) return 'Unknown';
  if (tilt < 30) return 'Upright (standing or seated)';
  if (tilt < 62) return 'Inclined';
  if (tilt > 150) return 'Upside down';
  return chestUp == null ? 'Lying' : chestUp ? 'Lying on your back' : 'Lying face down';
}

const pct = (xs, q) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const range = (xs) => pct(xs, 0.92) - pct(xs, 0.08);
const median = (xs) => pct(xs, 0.5);

/** Running median over ±k samples (NaN-aware): pose jitter out, real movement kept. */
export function medianSmooth(values, k = 2) {
  return values.map((_, i) => { const w = values.slice(Math.max(0, i - k), i + k + 1).filter(Number.isFinite); return w.length ? median(w) : NaN; });
}

/** Reps of a back-and-forth signal: each trip into the top 30% of its range and back out counts once. */
export function countCycles(values) {
  const lo = pct(values, 0.05), hi = pct(values, 0.95);
  if (!(hi - lo > 1e-6)) return 0;
  const a = lo + 0.3 * (hi - lo), b = lo + 0.7 * (hi - lo);
  // Which end is the start: where the signal spends most of its first frames.
  const first = values.filter(Number.isFinite).slice(0, 8);
  const startHigh = median(first) > (lo + hi) / 2;
  let state = 'start', n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const away = startHigh ? v < a : v > b, back = startHigh ? v > b : v < a;
    if (state === 'start' && away) state = 'away';
    else if (state === 'away' && back) { n++; state = 'start'; }
  }
  return n;
}

// Every angle smoothed over time (±smooth frames), so one jittery frame doesn't move a range or count a rep.
function smoothFrames(good, k) {
  if (!k || good.length < 3) return good;
  const out = good.map((f) => ({ ...f, L: { ...f.L }, R: { ...f.R } }));
  for (const s of ['L', 'R']) for (const key of ['elev', 'plane', 'elbow', 'hip', 'knee']) {
    const sm = medianSmooth(good.map((f) => f[s][key]), k);
    out.forEach((f, i) => { f[s][key] = sm[i]; });
  }
  return out;
}

/**
 * Which lift a clip shows, from its frames' bodyAngles (nulls allowed). Returns
 *   { family, label, plane, posture, side, reps, signal, confidence, why, ranges }
 * family: 'front-raise' | 'lateral-raise' | 'scaption-raise' | 'raise' (plane unknown) | 'fly' |
 *         'pullover' | 'curl' | 'triceps-extension' | 'vertical-push-pull' | 'horizontal-push-pull' |
 *         'squat' | 'hinge' | 'knee-isolation' | 'unclear'
 * The thresholds are first guesses, to be tuned on real clips.
 */
export function classifyMovement(frames, { smooth = 2 } = {}) {
  const good = smoothFrames(frames.filter(Boolean), smooth);
  if (good.length < 10 || good.length < 0.4 * frames.length) return { family: 'unclear', label: 'Unclear', why: 'Body not seen clearly enough', confidence: 0, reps: 0 };
  const three = good.some((f) => f.three);
  const col = (s, k) => good.map((f) => f[s][k]);
  const pick = (k) => { const l = range(col('L', k)), r = range(col('R', k)); return (Number.isFinite(l) ? l : -1) >= (Number.isFinite(r) ? r : -1) ? 'L' : 'R'; };
  const r = {};
  for (const k of ['elev', 'elbow', 'hip', 'knee', 'plane']) { const s = pick(k); r[k] = { side: s, range: range(col(s, k)), lo: pct(col(s, k), 0.08), hi: pct(col(s, k), 0.92) }; }
  // Posture is how you're set up before the lift moves you (a squat leans forward mid-rep, but you
  // stand to start it): the first quarter of the clip.
  const setup = good.slice(0, Math.max(5, Math.ceil(good.length / 4)));
  const tilt = median(setup.map((f) => f.posture.tilt));
  const chestUps = setup.map((f) => f.posture.chestUp).filter((v) => v != null);
  const posture = postureLabel({ tilt, chestUp: chestUps.length ? chestUps.filter(Boolean).length > chestUps.length / 2 : null });
  const conf = Math.min(1, good.length / frames.length);
  const R = (k) => (Number.isFinite(r[k].range) ? r[k].range : 0);
  const done = (family, label, signal, plane, why) => {
    const s = r[signal].side, vals = good.map((f) => f[s][signal]);
    return { family, label, plane, posture, side: s === 'L' ? 'left' : 'right', reps: countCycles(vals), signal, confidence: +conf.toFixed(2), why, three,
      ranges: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v.range)])) };
  };

  // Lower body first: big knee / hip motion.
  if (R('knee') >= 35 && R('hip') >= 30) return done('squat', 'Squat pattern (knees and hips)', 'knee', 'Sagittal', 'Knees and hips bend together');
  if (R('hip') >= 35 && R('knee') < 25) return done('hinge', 'Hip hinge (deadlift, RDL, hip thrust)', 'hip', 'Sagittal', 'Hips move, knees stay');
  if (R('knee') >= 35 && R('hip') < 20 && R('elev') < 25) return done('knee-isolation', 'Knee isolation (leg extension / curl)', 'knee', 'Sagittal', 'Only the knees move');

  // Arms.
  const elev = R('elev'), elbow = R('elbow');
  if (elev >= 35 && elbow < 35) {
    const s = r.elev.side, raised = good.filter((f) => f[s].elev > r.elev.lo + 0.5 * elev);
    const plane = median(raised.map((f) => f[s].plane));
    if (r.elev.lo > 70 && plane < 45) return done('pullover', 'Pullover (arms from overhead)', 'elev', 'Sagittal', 'Straight arms move from overhead to the front');
    if (!three || !Number.isFinite(plane)) return done('raise', 'Straight-arm raise (front or side needs the 3D view)', 'elev', 'Unknown', 'Arm rises with a straight elbow');
    if (plane < 35) return done('front-raise', 'Front raise', 'elev', 'Sagittal (forward)', 'Straight arm rises in front of the chest');
    if (plane > 60) return done('lateral-raise', 'Lateral raise', 'elev', 'Frontal (to the side)', 'Straight arm rises out to the side');
    return done('scaption-raise', 'Raise between front and side (scaption)', 'elev', 'Scapular (≈45°)', 'Arm rises between forward and sideways');
  }
  if (three && R('plane') >= 40 && elev < 30 && r.elev.lo > 45 && elbow < 35) return done('fly', 'Fly / reverse fly (arms sweep sideways)', 'plane', 'Transverse (horizontal)', 'Arms stay raised and sweep across');
  if (elbow >= 45 && elev < 25) {
    const s = r.elbow.side, armUp = median(good.map((f) => f[s].elev));
    // Arm held out in front (bench, chest press, row): the elbow does most of the visible work.
    if (armUp >= 50 && armUp <= 110) return done('horizontal-push-pull', 'Horizontal press or row (bench, chest press, row)', 'elbow', 'Horizontal to the body', 'Elbow moves with the arm held out in front');
    if (armUp > 110) return done('triceps-extension', 'Triceps extension (overhead)', 'elbow', 'Sagittal', 'Only the elbow moves, upper arm overhead');
    if (r.elbow.lo < 60) return done('curl', 'Curl', 'elbow', 'Sagittal', 'Only the elbow moves and bends fully');
    return done('triceps-extension', 'Triceps extension (pushdown)', 'elbow', 'Sagittal', 'Only the elbow moves, from bent to straight');
  }
  if (elbow >= 40 && elev >= 25) {
    if (r.elev.hi > 125) return done('vertical-push-pull', 'Vertical press or pull (overhead press, pulldown)', 'elbow', 'Vertical to the body', 'Elbow and shoulder move, arms go overhead');
    return done('horizontal-push-pull', 'Horizontal press or row (bench, chest press, row)', 'elbow', 'Horizontal to the body', 'Elbow and shoulder move, arms stay in front');
  }
  return { family: 'unclear', label: 'Unclear', plane: 'Unknown', posture, reps: 0, confidence: +conf.toFixed(2), three, why: 'Not enough movement to tell', ranges: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v.range || 0)])) };
}
