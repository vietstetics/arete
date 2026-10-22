// A camera simulator with ground truth: a barbell plate moving through a
// real 3D scene, filmed by a phone placed anywhere — any distance, height,
// angle round the bar, tilt or roll — and rendered by casting a ray through
// every pixel, so perspective is exact. Also simulates what real phone video
// does to a measurement: motion blur (exposure time), rolling shutter (rows
// read out one after another), lens distortion, sensor noise, uneven frame
// timing and dropped frames.
//
// It exists to answer one question honestly: how far is the velocity Arete
// reads from the camera from the bar's true vertical velocity — the number a
// linear position transducer clipped to the bar would give.
//
// World frame: Y up, the bar along X; the filmed plate's outer face looks
// along +X.

import { placeCamera, intrinsicsFromFov, transpose, matVec, ray, undistort, dot, sub, add, scale, cross, unit } from '../services/vision/camera.js';
import { background, rng } from './synth.js';

const G = 9.81;

// ── The lift ──────────────────────────────────────────────────────────────

/** Concentric velocity shape on u ∈ [0, 1]: a fast rise, an optional sticking-point dip, a slowing finish. */
function shape(u, { dip = 0, dipAt = 0.38, skew = 0.9 } = {}) {
  if (u <= 0 || u >= 1) return 0;
  const base = Math.pow(Math.sin(Math.PI * Math.pow(u, skew)), 1.0);
  return base * (1 - dip * Math.exp(-(((u - dipAt) / 0.09) ** 2)));
}

/**
 * One concentric's vertical velocity (m/s) on a grid of m + 1 points dt
 * apart, rising exactly D. Its ends are physical: force — and so the bar's
 * acceleration — can't jump.
 *   onMs > 0: the start from rest (after a pause, or from the floor) builds
 *     its acceleration up from nothing over onMs (the rate of force
 *     development: 30–80 ms);
 *   a0 > 0 (onMs 0): touch-and-go — the bar leaves the bottom with the
 *     acceleration it bounced with (the eccentric's last);
 *   offMs > 0: it eases to a stop at the top over offMs; 0: it stops on
 *     locked joints (a straight-line stop).
 * The body in between is shape(): a fast rise, an optional sticking-point
 * dip, a slowing finish.
 */
export function concentricProfile(m, dt, { D, dip = 0, dipAt, onMs = 0, offMs = 0, a0 = 0 }) {
  const v = new Float64Array(m + 1);
  for (let j = 0; j <= m; j++) v[j] = shape(j / m, { dip, dipAt });
  const scaleTo = () => { let s = 0; for (let j = 1; j <= m; j++) s += 0.5 * (v[j - 1] + v[j]) * dt; const k = D / s; for (let j = 0; j <= m; j++) v[j] *= k; };
  scaleTo();
  // Cubic Hermite over grid points [j0, j1]: value and slope (m/s, m/s²) at both ends; the far slope is capped
  // so the blend rises without overshooting.
  const blend = (j0, j1, v0, s0, v1, s1) => {
    const h = (j1 - j0) * dt;
    for (let j = j0; j <= j1; j++) {
      const s = (j - j0) / (j1 - j0), s2 = s * s, s3 = s2 * s;
      v[j] = (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * s0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * s1;
    }
  };
  const slope = (j) => (v[Math.min(m, j + 1)] - v[Math.max(0, j - 1)]) / (2 * dt);
  const peak = Math.max(...v);
  // Start: from rest over onMs, or touch-and-go from a0 until the body is reached (at most a third of the lift).
  const onS = onMs > 0 ? onMs / 1000 : a0 > 0 ? Math.min(0.12, Math.max(0.02, (0.3 * peak) / a0)) : 0;
  const jOn = Math.min(Math.round(m / 3), Math.round(onS / dt));
  if (jOn >= 2) { const v1 = v[jOn]; blend(0, jOn, 0, onMs > 0 ? 0 : a0, v1, Math.min(slope(jOn), (2.5 * v1) / (jOn * dt))); }
  const jOff = Math.min(Math.round(m / 3), Math.round(offMs / 1000 / dt));
  if (jOff >= 2) { const j0 = m - jOff, v0 = v[j0]; blend(j0, m, v0, Math.max(slope(j0), (-2.5 * v0) / (jOff * dt)), 0, 0); }
  for (let j = 0; j <= m; j++) v[j] = Math.max(0, v[j]);
  scaleTo();
  return v;
}

/**
 * A set of reps as the bar's world position over time, with the exact
 * vertical velocity. Heights in metres above the start (top) position.
 *   reps: [{ T: concentric seconds, D: metres, dip, onMs, offMs }] — onMs / offMs: how the lift starts from rest
 *     and stops at the top (concentricProfile; defaults 50 ms from rest, a straight-line stop)
 *   physical: false gives the old profile (an instant start), for comparison only
 *   ecc: eccentric seconds, pauseBottom / pauseTop / lead / tail: seconds
 *   path: horizontal bar movement along Z during a rep (m, + = towards the lifter's front), e.g. 0.03 squat, 0.10 bench
 *   drift: movement along the bar (X, towards / away from a side-on camera) during a rep (m)
 *   startsAtBottom: deadlift-style (concentric first, from the floor). The floor doesn't move, so every
 *     rep then has the first rep's distance (others' D are ignored).
 *   origin: [x, y, z] of the plate face centre at the top
 * Returns { pos(t) → [x, y, z], vel(t) → vertical m/s, reps: truth per rep, duration }.
 */
export function liftTrajectory({ reps: repsIn, ecc = 1.4, pauseBottom = 0.15, pauseTop = 0.6, lead = 2.2, tail = 0.8, path = 0.03, drift = 0.0, startsAtBottom = false, origin = [0, 1.4, 0], jitterMm = 0, physical = true } = {}) {
  const reps = startsAtBottom ? repsIn.map((x) => ({ ...x, D: repsIn[0].D })) : repsIn;
  // Build the vertical profile on a fine grid (1 kHz), then interpolate.
  const dt = 0.001, segs = [];
  let t = 0;
  segs.push({ kind: 'hold', t0: t, t1: t + lead, y: startsAtBottom ? -reps[0].D : 0 }); t += lead;
  for (const r of reps) {
    if (!startsAtBottom) { segs.push({ kind: 'ecc', t0: t, t1: t + ecc, D: r.D }); t += ecc; }
    segs.push({ kind: 'hold', t0: t, t1: t + pauseBottom, y: -r.D }); t += pauseBottom;
    segs.push({ kind: 'con', t0: t, t1: t + r.T, D: r.D, rep: r }); t += r.T;
    segs.push({ kind: 'hold', t0: t, t1: t + pauseTop, y: 0 }); t += pauseTop;
    if (startsAtBottom) { segs.push({ kind: 'ecc', t0: t, t1: t + ecc, D: r.D }); t += ecc; segs.push({ kind: 'hold', t0: t, t1: t + pauseTop, y: -r.D }); t += pauseTop; }
  }
  segs.push({ kind: 'hold', t0: t, t1: t + tail, y: startsAtBottom ? -reps[reps.length - 1].D : 0 }); t += tail;
  const n = Math.ceil(t / dt) + 1, Y = new Float64Array(n), V = new Float64Array(n), Zp = new Float64Array(n), Xp = new Float64Array(n);
  const truth = [];
  for (const sg of segs) {
    const i0 = Math.round(sg.t0 / dt), i1 = Math.round(sg.t1 / dt);
    if (sg.kind === 'hold') { for (let i = i0; i <= i1 && i < n; i++) { Y[i] = sg.y; V[i] = 0; } continue; }
    if (sg.kind === 'ecc') {
      for (let i = i0; i <= i1 && i < n; i++) { const u = (i - i0) / (i1 - i0); Y[i] = -sg.D * (1 - Math.cos(Math.PI * u)) / 2; V[i] = (-sg.D * Math.PI * Math.sin(Math.PI * u)) / (2 * (sg.t1 - sg.t0)); }
      continue;
    }
    // Integrate the shape on the grid and scale so the bar rises exactly D: position and velocity agree to rounding.
    // From rest (a pause, or the floor) the start builds up over onMs; touch-and-go it carries on from the
    // eccentric's last acceleration (D·π² / 2·ecc² for its half-sine).
    const p = { dip: sg.rep.dip || 0 }, m = i1 - i0, cum = new Float64Array(m + 1);
    const fromRest = startsAtBottom || pauseBottom > 0.04;
    const sh = physical ? concentricProfile(m, dt, { D: sg.D, dip: p.dip, onMs: fromRest ? sg.rep.onMs ?? 50 : 0, offMs: sg.rep.offMs ?? 0, a0: fromRest ? 0 : (sg.D * Math.PI ** 2) / (2 * ecc * ecc) })
      : Float64Array.from({ length: m + 1 }, (_, j) => shape(j / m, p));
    for (let j = 1; j <= m; j++) cum[j] = cum[j - 1] + 0.5 * (sh[j - 1] + sh[j]) * dt;
    for (let j = 0; j <= m && i0 + j < n; j++) { Y[i0 + j] = -sg.D + (sg.D * cum[j]) / cum[m]; V[i0 + j] = (sg.D * sh[j]) / cum[m]; }
    truth.push({ n: truth.length + 1, tStart: sg.t0, tEnd: sg.t1, T: sg.t1 - sg.t0, D: sg.D });
  }
  // Horizontal bar path follows depth (a J-curve-ish drift), plus drift along the bar.
  let maxD = Math.max(...reps.map((r) => r.D));
  for (let i = 0; i < n; i++) { const depth = -Y[i] / maxD; Zp[i] = path * Math.sin(Math.PI * 0.5 * depth) * (depth >= 0 ? 1 : 0); Xp[i] = drift * depth; }
  const interp = (A, tt) => { const x = Math.max(0, Math.min(n - 1, tt / dt)), i = Math.min(n - 2, Math.floor(x)), f = x - i; return A[i] * (1 - f) + A[i + 1] * f; };
  // Truth per rep with the reference definitions, from the exact profile.
  for (const tr of truth) {
    const i0 = Math.round(tr.tStart / dt), i1 = Math.round(tr.tEnd / dt);
    let pv = 0, tPeak = tr.tStart;
    for (let i = i0; i <= i1; i++) if (V[i] > pv) { pv = V[i]; tPeak = i * dt; }
    // Propulsive phase: until the bar decelerates faster than gravity.
    let tProp = tr.tEnd;
    for (let i = i0 + 1; i <= i1; i++) { const a = (V[i] - V[i - 1]) / dt; if (i * dt > tPeak && a < -G) { tProp = i * dt; break; } }
    const yA = Y[i0], yP = interp(Y, tProp);
    Object.assign(tr, { mcv: tr.D / tr.T, pv, tPeak, mpv: (yP - yA) / (tProp - tr.tStart), tProp });
  }
  const jit = rng(99);
  return {
    duration: t,
    reps: truth,
    pos: (tt) => [origin[0] + interp(Xp, tt), origin[1] + interp(Y, tt), origin[2] + interp(Zp, tt)],
    height: (tt) => interp(Y, tt),
    vel: (tt) => interp(V, tt),
    profile: { dt, Y, V },
  };
}

// ── The plate and bar ─────────────────────────────────────────────────────

const PLATE = { R: 0.225, thick: 0.055, sleeveR: 0.025, sleeveL: 0.33, shaftR: 0.0145, shaftL: 0.45 };

/** Grey level of the plate's outer face at (rho = r/R, theta). Rubber, a raised rim, lettering, a steel hub; fine texture so it can be followed. */
function faceShade(rho, th) {
  if (rho > 0.93) return 64;
  let v = 38 + 6 * Math.sin(31 * th) * Math.sin(40 * rho);
  if (rho > 0.55 && rho < 0.7 && Math.sin(th * 9) > 0.55) v = 168;
  if (rho > 0.78 && rho < 0.8) v = 90;
  if (rho < 0.2) v = 200 - 40 * rho; else if (rho < 0.24) v = 22;
  return v;
}

/**
 * Nearest thing a ray hits: its grey level, or NaN for nothing (background).
 * Ray: origin (ox, oy, oz), unit direction (dx, dy, dz). Plate outer-face
 * centre (px, py, pz); bar axis a (unit, out of the plate towards the sleeve
 * end); e1, e2: the plate's own in-plane directions (for its texture); L: light.
 * Plain scalar arithmetic — this runs a few hundred thousand times a frame.
 */
function hitPlate(ox, oy, oz, dx, dy, dz, px, py, pz, a, e1, e2, L, body) {
  const { R, thick, sleeveR, sleeveL } = PLATE;
  let bt = Infinity, bs = NaN;
  const da = dx * a[0] + dy * a[1] + dz * a[2];
  const wx0 = ox - px, wy0 = oy - py, wz0 = oz - pz, w0a = wx0 * a[0] + wy0 * a[1] + wz0 * a[2];
  if (Math.abs(da) > 1e-9) {
    // Outer face: the disc at the face centre.
    const t = -w0a / da;
    if (t > 1e-6) {
      const hx = wx0 + t * dx, hy = wy0 + t * dy, hz = wz0 + t * dz, rr = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (rr <= R && rr > sleeveR) {
        const th = Math.atan2(hx * e2[0] + hy * e2[1] + hz * e2[2], hx * e1[0] + hy * e1[1] + hz * e1[2]);
        bt = t; bs = faceShade(rr / R, th) * (0.8 + 0.2 * Math.max(0, a[0] * L[0] + a[1] * L[1] + a[2] * L[2]));
      }
    }
    // Sleeve end cap.
    const te = (sleeveL - w0a) / da;
    if (te > 1e-6 && te < bt) {
      const hx = wx0 + te * dx - sleeveL * a[0], hy = wy0 + te * dy - sleeveL * a[1], hz = wz0 + te * dz - sleeveL * a[2];
      if (hx * hx + hy * hy + hz * hz <= sleeveR * sleeveR) { bt = te; bs = 150; }
    }
  }
  // Cylinders round the axis: the plate's side (radius R, s ∈ [−thick, 0]) and the sleeve (sleeveR, s ∈ [0, sleeveL]).
  const qx = dx - a[0] * da, qy = dy - a[1] * da, qz = dz - a[2] * da;
  const wx = wx0 - a[0] * w0a, wy = wy0 - a[1] * w0a, wz = wz0 - a[2] * w0a;
  const A = qx * qx + qy * qy + qz * qz, B = 2 * (qx * wx + qy * wy + qz * wz), W = wx * wx + wy * wy + wz * wz;
  if (A > 1e-12) {
    for (let c = 0; c < 3; c++) {
      const rad = c === 1 ? sleeveR : c === 2 ? PLATE.shaftR : R, s0 = c === 1 ? 0 : c === 2 ? -PLATE.shaftL : -thick, s1 = c === 1 ? sleeveL : c === 2 ? -thick : 0;
      const disc = B * B - 4 * A * (W - rad * rad);
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        if (!(t > 1e-6) || t >= bt) continue;
        const sAx = w0a + t * da;
        if (sAx < s0 || sAx > s1) continue;
        bt = t;
        if (c === 0) bs = 30;
        else if (c === 2) bs = 170;
        else {
          const nx = (wx + t * qx) / rad, ny = (wy + t * qy) / rad, nz = (wz + t * qz) / rad;
          bs = 120 + 100 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        }
        break;
      }
    }
  }
  // The lifter's side: a textured panel half a metre in from the plate, moving with the bar.
  if (body && Math.abs(da) > 1e-9) {
    const t = (-body.inset - w0a) / da;
    if (t > 1e-6 && t < bt) {
      const hx = wx0 + t * dx, hy = wy0 + t * dy, hz = wz0 + t * dz;
      const up = hx * body.up[0] + hy * body.up[1] + hz * body.up[2], fw = hx * body.fw[0] + hy * body.fw[1] + hz * body.fw[2];
      if (up > body.y0 && up < body.y1 && fw > body.z0 && fw < body.z1) { bt = t; bs = body.shade + 14 * Math.sin(23 * up + 9 * fw) * Math.sin(17 * fw); }
    }
  }
  return bs;
}

// ── The camera and its frames ─────────────────────────────────────────────

/**
 * A filmed scene.
 *   w, h: frame size; hfovDeg: the camera's true field of view
 *   place: placeCamera() options (distance, yawDeg, heightOffset, pitchDeg, aim, rollDeg, panDeg); target defaults to the plate's mid-rep position
 *   lens: { k1, k2 } true distortion
 *   traj: liftTrajectory()
 *   exposure: shutter time (s) — motion blur; readout: rolling-shutter time top→bottom (s)
 *   noise: sensor noise (grey levels, sd); seed
 *   occluders: [{ x0, y0, x1, y1, v }] static things in front of the plate (rack uprights), in pixels
 *   barAxis: bar direction (default +X); barTiltDeg: bar not quite level
 */
export function makeScene({ w = 640, h = 360, hfovDeg = 66, place = {}, lens = { k1: 0, k2: 0 }, traj, exposure = 1 / 120, readout = 0.016, noise = 3, seed = 1, occluders = [], barTiltDeg = 0, samples = 2, bodyShade = 95 } = {}) {
  const midY = traj.reps.length ? -0.5 * Math.max(...traj.reps.map((r) => r.D)) : 0;
  const o = traj.pos(0);
  const target = place.target || [o[0], o[1] + midY, o[2]];
  const pose = placeCamera({ ...place, target });
  const K = intrinsicsFromFov(w, h, hfovDeg);
  const bg = background(w, h, seed + 2);
  const tilt = (barTiltDeg * Math.PI) / 180, a = unit([Math.cos(tilt), Math.sin(tilt), 0]);
  const e1 = unit(cross(a, [0, 0, 1])), e2 = cross(a, e1); // plate texture orientation (fixed: plates don't spin in this model)
  const light = unit([0.4, 0.8, 0.4]);
  // The lifter's side (null = no lifter): a panel in the plane `inset` m in from the plate face, spanning
  // `y0..y1` up and `z0..z1` forwards relative to the plate centre.
  const body = bodyShade == null ? null : { inset: 0.5, up: [0, 1, 0], fw: [0, 0, 1], y0: -0.75, y1: 0.3, z0: -0.18, z1: 0.22, shade: bodyShade };
  // Undistortion map: for each pixel centre, the ideal (pinhole) ray in world coordinates.
  const Rt = transpose(pose.R), rays = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = undistort(K, lens, { x, y }), rc = ray(K, p.x, p.y), d = unit(matVec(Rt, rc)), i = 3 * (y * w + x);
    rays[i] = d[0]; rays[i + 1] = d[1]; rays[i + 2] = d[2];
  }
  // Sub-pixel rays (S×S per pixel, for anti-aliasing), precomputed once.
  const S = samples, subRays = new Float32Array(w * h * S * S * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xi = Math.min(w - 2, x), yi = Math.min(h - 2, y), i = 3 * (yi * w + xi), ix = 3 * (yi * w + xi + 1), iy = 3 * ((yi + 1) * w + xi);
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const ox = S === 1 ? 0 : (sx + 0.5) / S - 0.5, oy = S === 1 ? 0 : (sy + 0.5) / S - 0.5, j = 3 * ((y * w + x) * S * S + sy * S + sx);
      let vx = rays[3 * (y * w + x)] + ox * (rays[ix] - rays[i]) + oy * (rays[iy] - rays[i]);
      let vy = rays[3 * (y * w + x) + 1] + ox * (rays[ix + 1] - rays[i + 1]) + oy * (rays[iy + 1] - rays[i + 1]);
      let vz = rays[3 * (y * w + x) + 2] + ox * (rays[ix + 2] - rays[i + 2]) + oy * (rays[iy + 2] - rays[i + 2]);
      const l = Math.hypot(vx, vy, vz); subRays[j] = vx / l; subRays[j + 1] = vy / l; subRays[j + 2] = vz / l;
    }
  }
  return {
    w, h, K, pose, lens, traj, exposure, readout, noise, hfovDeg,
    up: matVec(pose.R, [0, 1, 0]),
    barAxisCam: matVec(pose.R, a),
    /** Where the plate face centre is (camera frame, m) at time t. */
    centreCam: (t) => matVec(pose.R, sub(traj.pos(t), pose.C)),
    /**
     * The frame whose first row is exposed (centre of exposure) at time t.
     * Returns a grey image { w, h, data }.
     */
    render(t, { r = rng(seed * 7919 + Math.round(t * 1e4)) } = {}) {
      const data = new Float32Array(bg);
      // Only rows/columns the plate can cover during this frame.
      const box = { x0: w, y0: h, x1: -1, y1: -1 };
      const tSpan = [t - exposure / 2, t + readout + exposure / 2];
      for (const tt of [tSpan[0], (tSpan[0] + tSpan[1]) / 2, tSpan[1]]) {
        const P = traj.pos(tt);
        const offs = [[0, 0.25, 0.25], [0, -0.25, -0.25], [0, 0.25, -0.25], [0, -0.25, 0.25], [0.35, 0, 0], [-0.07, 0, 0], [0.35, 0.03, 0.03]];
        if (body) for (const yy of [body.y0, body.y1]) for (const zz of [body.z0, body.z1]) offs.push([-body.inset, yy, zz]);
        for (const off of offs) {
          const Xc = matVec(pose.R, sub(add(P, off), pose.C));
          if (Xc[2] <= 0.05) continue;
          const px = K.cx + (K.fx * Xc[0]) / Xc[2], py = K.cy + (K.fy * Xc[1]) / Xc[2];
          box.x0 = Math.min(box.x0, px); box.x1 = Math.max(box.x1, px); box.y0 = Math.min(box.y0, py); box.y1 = Math.max(box.y1, py);
        }
      }
      const pad = 0.04 * Math.max(box.x1 - box.x0, box.y1 - box.y0) + 6;
      const X0 = Math.max(0, Math.floor(box.x0 - pad)), X1 = Math.min(w - 1, Math.ceil(box.x1 + pad));
      const Y0 = Math.max(0, Math.floor(box.y0 - pad)), Y1 = Math.min(h - 1, Math.ceil(box.y1 + pad));
      const C0 = pose.C[0], C1 = pose.C[1], C2 = pose.C[2], SS = S * S, subT = Math.min(8, Math.max(1, Math.ceil(exposure * 1000 / 2))); // a time sample every ~2 ms of exposure (at most 8)
      for (let y = Y0; y <= Y1; y++) {
        const tRow = t + (y / h) * readout;
        const states = [];
        for (let k = 0; k < subT; k++) { const tt = tRow - exposure / 2 + ((k + 0.5) / subT) * exposure; states.push(traj.pos(tt)); }
        for (let x = X0; x <= X1; x++) {
          let acc = 0, cnt = 0;
          const i = y * w + x, bgv = bg[i];
          for (let q = 0; q < SS; q++) {
            const j = 3 * (i * SS + q), d0 = subRays[j], d1 = subRays[j + 1], d2 = subRays[j + 2];
            for (const P of states) { const v = hitPlate(C0, C1, C2, d0, d1, d2, P[0], P[1], P[2], a, e1, e2, light, body); acc += Number.isNaN(v) ? bgv : v; cnt++; }
          }
          data[i] = acc / cnt;
        }
      }
      for (const oc of occluders) for (let y = Math.max(0, oc.y0 | 0); y < Math.min(h, oc.y1); y++) for (let x = Math.max(0, oc.x0 | 0); x < Math.min(w, oc.x1); x++) data[y * w + x] = oc.v;
      if (noise > 0) {
        for (let k = 0; k < data.length; k++) {
          const u1 = Math.max(1e-9, r()), u2 = r();
          data[k] = Math.max(0, Math.min(255, data[k] + noise * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)));
        }
      }
      return { w, h, data };
    },
  };
}

/**
 * Frame times as a phone delivers them: nominal fps, timing jitter (s, sd),
 * the odd dropped frame. Returns [{ t: true capture time, ts: the timestamp the app sees }].
 *   tsJitter: extra error in the reported timestamp (s, sd) — e.g. stamping
 *   with performance.now() when the frame is processed instead of capture time.
 */
export function frameTimes({ duration, fps = 30, jitter = 0.0005, drop = 0, tsJitter = 0, seed = 5 } = {}) {
  const r = rng(seed), out = [];
  const g = () => { const u1 = Math.max(1e-9, r()), u2 = r(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
  for (let i = 0, t = 0; t < duration; i++, t = i / fps) {
    if (drop && r() < drop) continue;
    const tt = t + jitter * g();
    out.push({ t: tt, ts: tt + tsJitter * g() });
  }
  return out;
}
