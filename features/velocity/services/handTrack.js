// Hand speed for any lift, from the hands' own movement: no machine, cam or resistance profile is
// assumed, so a cable, a plate-loaded machine, a dumbbell or a barbell are all measured the same way.
//
// 1. fuseHand: one hand's position over time from whatever saw it each frame (the pose model's wrist,
//    the hand model's palm). A constant-velocity Kalman filter predicts where the hand is; readings
//    far from the prediction (the model jumping to the other hand, a bar, a shadow) are ignored, and
//    short gaps (hand behind the head, a plate, the frame's edge) are bridged by the prediction for up
//    to maxBridge seconds and marked 'bridged'. Longer gaps are 'lost' — never filled in.
// 2. handVelocity: Savitzky–Golay on the fused path (smooth.js, as for the bar) → speed in m/s, using
//    metres per pixel from the lifter's own body.
// 3. handReps: reps along the hands' main line of travel, whatever its direction (vertical press,
//    horizontal row, a raise lying down): mean and peak speed of each concentric, its range and time.
//    A rep with too much of its concentric bridged or lost is 'unclear' and gets no speed.
//
// Speed is measured in the picture's plane: film side-on to the movement for the true speed. Movement
// towards / away from the lens is not seen (handReps reports when the path looks foreshortened).
import { savitzkyGolay } from './smooth.js';

/**
 * frames: [{ t, cands: [{ x, y, conf }] }] — every reading of this hand in a frame (pixels, conf 0–1).
 * Returns [{ t, x, y, state: 'measured' | 'bridged' | 'lost', src }].
 */
export function fuseHand(frames, { maxBridge = 0.4, minConf = 0.35, accel = 6000, noise = 6, gate = 5, maxJump = 0.25 } = {}) {
  // State per axis: position p, velocity v, covariance [[a, b], [b, c]].
  let st = null, lastMeas = -Infinity, lastT = null, rejected = [], lockAt = 0;
  const out = [];
  const reset = (t, m) => { lockAt = out.length; st = { x: [m.x, 0, noise * noise, 0, 1e6], y: [m.y, 0, noise * noise, 0, 1e6] }; lastMeas = t; };
  const predict = (ax, dt) => {
    const [p, v, a, b, c] = ax, q = accel * accel;
    // F = [[1, dt], [0, 1]], Q from white acceleration noise
    return [p + v * dt, v, a + 2 * dt * b + dt * dt * c + (q * dt ** 4) / 4, b + dt * c + (q * dt ** 3) / 2, c + q * dt * dt];
  };
  const update = (ax, z, r) => {
    const [p, v, a, b, c] = ax, s = a + r, k0 = a / s, k1 = b / s, y = z - p;
    return [p + k0 * y, v + k1 * y, (1 - k0) * a, (1 - k0) * b, c - k1 * b];
  };
  for (const f of frames) {
    const t = f.t, cands = (f.cands || []).filter((m) => m && Number.isFinite(m.x) && Number.isFinite(m.y) && (m.conf ?? 1) >= minConf);
    if (!st) {
      const m = cands.sort((p, q) => (q.conf ?? 1) - (p.conf ?? 1))[0];
      if (m) { reset(t, m); out.push({ t, x: m.x, y: m.y, state: 'measured', src: m.src || null }); }
      else out.push({ t, x: NaN, y: NaN, state: 'lost', src: null });
      lastT = t; continue;
    }
    const dt = Math.max(1e-3, t - lastT); lastT = t;
    st.x = predict(st.x, dt); st.y = predict(st.y, dt);
    // The reading closest to the prediction, if it's plausibly the same hand.
    const sd = Math.sqrt(Math.max(st.x[2], st.y[2]) + noise * noise);
    const span = Math.max(gate * sd, 25);
    let best = null, bestD = Infinity;
    for (const m of cands) { const d = Math.hypot(m.x - st.x[0], m.y - st.y[0]); if (d < bestD) { bestD = d; best = m; } }
    // A hand reappearing after a gap may have moved a long way: accept it near where it was last seen.
    const gap = t - lastMeas;
    // Readings that keep agreeing with each other somewhere else (3 frames in a row) are the hand:
    // the filter had locked onto something wrong (or the hand really moved that fast) — re-lock.
    if (best && bestD > span) {
      rejected.push(best);
      if (rejected.length > 3) rejected.shift();
      const agree = rejected.length === 3 && rejected.every((m) => Math.hypot(m.x - best.x, m.y - best.y) < span);
      // What it followed since the wrong lock wasn't this hand: drop it rather than draw a jump.
      if (agree) { for (let k = lockAt; k < out.length; k++) out[k] = { t: out[k].t, x: NaN, y: NaN, state: 'lost', src: null }; reset(t, best); rejected = []; out.push({ t, x: best.x, y: best.y, state: 'measured', src: best.src || null }); continue; }
    } else if (best) rejected = [];
    if (best && (bestD <= span || (gap > maxBridge && bestD <= maxJump * 4000))) {
      if (gap > maxBridge) reset(t, best);
      else { const r = (noise / Math.max(0.2, best.conf ?? 1)) ** 2; st.x = update(st.x, best.x, r); st.y = update(st.y, best.y, r); }
      lastMeas = t;
      // The reading itself (the filter only decides which reading is the hand; smoothing comes later).
      out.push({ t, x: best.x, y: best.y, state: 'measured', src: best.src || null });
    } else if (gap <= maxBridge) {
      out.push({ t, x: st.x[0], y: st.y[0], state: 'bridged', src: null });
    } else {
      out.push({ t, x: NaN, y: NaN, state: 'lost', src: null });
    }
  }
  return out;
}

/** Smoothed path with velocity (px/s → m/s with metresPerPx). Lost frames stay NaN. */
export function handVelocity(track, metresPerPx = 1, { maxHalf = 0.25 } = {}) {
  // A recorded clip has both sides of a short gap: join them in a straight line (the filter's guess
  // only extends the motion forwards). Gaps that ran out (lost) stay empty.
  track = track.map((p) => ({ ...p }));
  for (let i = 0; i < track.length; i++) {
    if (track[i].state !== 'bridged') continue;
    let j = i; while (j < track.length && track[j].state === 'bridged') j++;
    const a = track[i - 1], b = track[j];
    if (a && b && a.state === 'measured' && b.state === 'measured') {
      for (let k = i; k < j; k++) { const f = (track[k].t - a.t) / (b.t - a.t); track[k].x = a.x + (b.x - a.x) * f; track[k].y = a.y + (b.y - a.y) * f; }
    }
    i = j;
  }
  const sx = savitzkyGolay(track.map((p) => ({ t: p.t, y: p.x })), { minPts: 5, maxHalf });
  const sy = savitzkyGolay(track.map((p) => ({ t: p.t, y: p.y })), { minPts: 5, maxHalf });
  return track.map((p, i) => ({
    t: p.t, state: p.state,
    x: sx[i].y * metresPerPx, y: sy[i].y * metresPerPx,
    vx: sx[i].v * metresPerPx, vy: sy[i].v * metresPerPx,
    speed: Math.hypot(sx[i].v, sy[i].v) * metresPerPx,
  }));
}

/**
 * Reps from a handVelocity path. concentricFirst: the lift starts with the lifting phase (a raise, a
 * curl, a machine press from the start position, a deadlift); false for lifts that lower first
 * (squat, bench from lockout, RDL). Returns { axis, reps: [{ n, t0, t1, mcv, peak, rom, secs, ok, why }], foreshortened }.
 */
export function handReps(path, { concentricFirst = true, minRom = 0.08, maxUnsure = 0.25 } = {}) {
  const pts = path.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 10) return { axis: null, reps: [] };
  // Main line of travel (principal axis of the hand positions).
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = [Math.cos(th), Math.sin(th)];
  const s = path.map((p) => (Number.isFinite(p.x) ? (p.x - mx) * ax[0] + (p.y - my) * ax[1] : NaN));
  const fin = s.filter(Number.isFinite).sort((a, b) => a - b);
  const lo = fin[Math.floor(fin.length * 0.05)], hi = fin[Math.floor(fin.length * 0.95)];
  if (!(hi - lo >= minRom)) return { axis: ax, reps: [] };
  // Start end: where the hand sits for the first frames.
  const first = s.filter(Number.isFinite).slice(0, 8).sort((a, b) => a - b)[4] ?? lo;
  const startHigh = first > (lo + hi) / 2;
  const away = (v) => (startHigh ? v < lo + 0.3 * (hi - lo) : v > lo + 0.7 * (hi - lo));
  const home = (v) => (startHigh ? v > lo + 0.7 * (hi - lo) : v < lo + 0.3 * (hi - lo));
  // Each cycle: rest at home → the far end → back home. Track the most-home and most-far points of each
  // stretch, so a rep spans the whole movement, not just the middle of it.
  const isMoreHome = (v, ref) => (startHigh ? v > ref : v < ref), isMoreFar = (v, ref) => (startHigh ? v < ref : v > ref);
  const homes = [], fars = [];
  let state = 'home', hx = -1, fx = -1;
  for (let i = 0; i < s.length; i++) {
    const v = s[i]; if (!Number.isFinite(v)) continue;
    if (state === 'home') {
      if (hx < 0 || isMoreHome(v, s[hx])) hx = i;
      if (away(v)) { homes.push(hx); state = 'away'; fx = i; }
    } else {
      if (isMoreFar(v, s[fx])) fx = i;
      if (home(v)) { fars.push(fx); state = 'home'; hx = i; }
    }
  }
  if (state === 'home' && hx >= 0) homes.push(hx); // where the last rep came home to
  const reps = [];
  for (let k = 0; k < fars.length; k++) {
    const far = fars[k], a = homes[k], b = homes[k + 1] ?? s.length - 1;
    if (!(Math.abs(s[far] - s[a]) >= minRom * 0.5)) continue; // a twitch, not a rep
    // The phase is the unbroken stretch, around its fastest moment, where the hand moves the phase's way
    // (out from home for the first half, back home for the second) faster than 5% of that peak.
    const [w0, w1] = concentricFirst ? [a, far] : [far, b];
    const outward = startHigh ? -1 : 1, way = concentricFirst ? outward : -outward;
    const along = (i) => { const p = path[i]; return Number.isFinite(p.vx) ? way * (p.vx * ax[0] + p.vy * ax[1]) : NaN; };
    let ip = w0; for (let i = w0; i <= w1; i++) if (along(i) > (along(ip) || -Infinity)) ip = i;
    const pk = along(ip);
    let i0 = ip, i1 = ip;
    while (i0 > a && along(i0 - 1) > 0.05 * pk) i0--;
    while (i1 < b && along(i1 + 1) > 0.05 * pk) i1++;
    // Where the speed passes the 5% line, between frames (not snapped to a whole frame).
    const thr = 0.05 * pk;
    const cross = (i, j) => { const u = along(i), w = along(j); const f = Number.isFinite(u) && Number.isFinite(w) && u !== w ? Math.max(0, Math.min(1, (thr - u) / (w - u))) : 0;
      return { t: path[i].t + (path[j].t - path[i].t) * f, x: path[i].x + (path[j].x - path[i].x) * f, y: path[i].y + (path[j].y - path[i].y) * f }; };
    const e0 = i0 > a ? cross(i0 - 1, i0) : path[i0], e1 = i1 < b ? cross(i1 + 1, i1) : path[i1];
    const seg = path.slice(i0, i1 + 1);
    const unsure = seg.filter((p) => p.state !== 'measured').length / Math.max(1, seg.length);
    const lost = seg.some((p) => p.state === 'lost' || !Number.isFinite(p.speed));
    const secs = e1.t - e0.t;
    const rom = Math.abs(s[far] - s[concentricFirst ? a : b]);
    // Path length / time = mean speed along the path.
    const way2 = [e0, ...seg, e1];
    let dist = 0; for (let i = 1; i < way2.length; i++) dist += Math.hypot(way2[i].x - way2[i - 1].x, way2[i].y - way2[i - 1].y);
    const ok = !lost && unsure <= maxUnsure && secs > 0.1 && rom >= minRom * 0.5;
    reps.push({ n: reps.length + 1, t0: +e0.t.toFixed(3), t1: +e1.t.toFixed(3), secs: +secs.toFixed(2), rom: +rom.toFixed(3),
      mcv: ok ? +(dist / secs).toFixed(3) : null, peak: ok ? +Math.max(...seg.map((p) => p.speed)).toFixed(3) : null,
      ok, why: ok ? null : lost ? 'hand lost during the lift' : `${Math.round(unsure * 100)}% of the lift estimated` });
  }
  // A line of travel much shorter than expected for the lift hints the hands move towards the lens.
  return { axis: ax, reps };
}

/** Metres per pixel from the lifter's torso (MediaPipe world landmarks are in metres). */
export function metresPerPxFromBody(pose, world, vw, vh) {
  if (!pose || !world) return NaN;
  const mid = (P, a, b, k) => (P[a][k] + P[b][k]) / 2;
  const px = Math.hypot((mid(pose, 11, 12, 'x') - mid(pose, 23, 24, 'x')) * vw, (mid(pose, 11, 12, 'y') - mid(pose, 23, 24, 'y')) * vh);
  const m = Math.hypot(mid(world, 11, 12, 'x') - mid(world, 23, 24, 'x'), mid(world, 11, 12, 'y') - mid(world, 23, 24, 'y'), mid(world, 11, 12, 'z') - mid(world, 23, 24, 'z'));
  return px > 20 ? m / px : NaN;
}
