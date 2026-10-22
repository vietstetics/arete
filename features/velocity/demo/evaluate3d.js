// Score the camera against the truth: film a simulated set (scene3d.js),
// find the plate the way the app does, follow it in 3D, and compare every
// rep's mean, peak and propulsive velocity with the bar's exact motion.

import { liftTrajectory, makeScene, frameTimes } from './scene3d.js';
import { findPlate } from '../services/live/plateSession.js';
import { createRimTracker, reconstruct3D, heightsFromTrack } from '../services/vision/plate3d.js';
import { barMetrics } from '../services/bar3d.js';
import { intrinsicsFromFov, rotation, matVec, cross, unit, dot, sub, project } from '../services/vision/camera.js';
import { planeBasis } from '../services/vision/circle3d.js';
import { rng } from './synth.js';

/** The camera's "up" as the phone's sensors would report it: true up tilted by errDeg in a random direction. */
function noisyUp(up, errDeg, seed) {
  if (!errDeg) return up;
  const r = rng(seed), a = cross(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]), b = cross(up, a);
  const ang = 2 * Math.PI * r(), axis = unit([0, 1, 2].map((i) => Math.cos(ang) * a[i] + Math.sin(ang) * b[i]));
  return unit(matVec(rotation(axis, (errDeg * Math.PI) / 180), up));
}

/** Is the whole plate rim inside the picture (with a margin) at time t? */
function plateInView(scene, t, margin = 4) {
  const c = scene.centreCam(t), n = scene.barAxisCam, [u, v] = planeBasis(n);
  for (let k = 0; k < 24; k++) {
    const al = (2 * Math.PI * k) / 24, X = [0, 1, 2].map((i) => c[i] + 0.225 * (Math.cos(al) * u[i] + Math.sin(al) * v[i]));
    if (X[2] <= 0) return false;
    const p = project(scene.K, X);
    if (p.x < margin || p.y < margin || p.x > scene.w - 1 - margin || p.y > scene.h - 1 - margin) return false;
  }
  return true;
}

/**
 * Film and measure one set.
 *   lift: liftTrajectory() options
 *   scene: makeScene options except traj (place, w, h, hfovDeg, lens, exposure, readout, noise, bodyShade, occluders…)
 *   timing: frameTimes options (fps, jitter, drop, tsJitter)
 *   app: what the app knows — assumedHfovDeg (the field of view it assumes), upErrDeg (sensor error; null = no sensors:
 *        up taken from the plate), radiusM (plate radius it assumes); fitFocal, steady: reconstruct3D options
 * Returns { truth, measured, matched: [{ truth, meas, inView, err }], lostShare, frames, view, track, heights, diag }.
 *   err in %: mcv (vs the exact mean over the whole lift, lowest → highest point), pv, mpv, dist
 */
export function filmAndMeasure({ lift, scene: sceneOpts = {}, timing = {}, app = {}, seed = 1, onFrame, keepFrames = false, sizeGuess } = {}) {
  const traj = liftTrajectory(lift);
  const scene = makeScene({ ...sceneOpts, traj, seed });
  const times = frameTimes({ duration: traj.duration, seed: seed + 11, ...timing });
  const K = intrinsicsFromFov(scene.w, scene.h, app.assumedHfovDeg ?? scene.hfovDeg);
  const up = app.upErrDeg == null ? null : noisyUp(scene.up, app.upErrDeg, seed + 3);
  const tracker = createRimTracker({ K, up });
  const track = [], diag = [];
  let started = false;
  for (let i = 0; i < times.length; i++) {
    const { t, ts } = times[i], img = scene.render(t);
    const inView = plateInView(scene, t);
    if (!started) {
      if (!inView) continue;
      // The app finds the plate near where the pose says the bar is, as big as the body says a plate should be —
      // both rough: here the bar's spot is off by a third of the plate's radius, and the size range is the live
      // page's (0.35–2.2 × a guess that's itself 20% off).
      const c = scene.centreCam(t), p = project(scene.K, c), aPx = (scene.K.fx * 0.225) / c[2], guess = aPx * (sizeGuess ?? 1.2);
      const det = findPlate(img, { rMin: Math.max(6, Math.round(0.35 * guess)), rMax: Math.round(2.2 * guess), prior: { x: p.x + 0.33 * aPx, y: p.y - 0.33 * aPx } });
      if (!det) continue;
      const res = tracker.init(img, det, ts);
      if (!res.ok) continue;
      started = true; track.push({ ...res, t: ts, fit: res.inliers / 72 });
      diag.push({ t, ts, inView, ok: true, cTrue: scene.centreCam(t) });
      continue;
    }
    const res = tracker.track(img, ts);
    track.push(res.ok ? { ...res, fit: res.inliers / 72 } : res);
    diag.push({ t, ts, inView, ok: res.ok, cTrue: scene.centreCam(t), rms: res.rms, reason: res.reason });
    if (onFrame) onFrame(i, times.length, res);
  }
  const rec = reconstruct3D(track, K, { up, R: app.radiusM ?? 0.225, fitFocal: app.fitFocal ?? true, steady: app.steady ?? true });
  const upUsed = rec.up || up || [0, -1, 0];
  rec.frames.forEach((f, k) => { if (diag[k]) diag[k].c = f.ok ? f.c : null; });
  const heights = heightsFromTrack(rec.frames, upUsed);
  const measured = barMetrics(heights);
  const truth = traj.reps;
  const matched = truth.map((tr) => {
    const m = measured.reps.find((x) => x.tTop > tr.tStart && x.tBottom < tr.tEnd) || null;
    const inView = diag.filter((d) => d.t >= tr.tStart - 0.15 && d.t <= tr.tEnd + 0.15).every((d) => d.inView) && diag.some((d) => d.t >= tr.tStart);
    const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? ((a - b) / b) * 100 : NaN);
    const ok = m && m.ok;
    return { truth: tr, meas: m, inView, err: ok ? { mcv: pct(m.mcv, tr.mcv), pv: pct(m.pv, tr.pv), mpv: pct(m.mpv, tr.mpv), dist: pct(m.distance, tr.D), T: pct(m.T, tr.T) } : null };
  });
  const lost = track.filter((f) => !f.ok).length;
  return {
    truth, measured: measured.reps, matched, lostShare: track.length ? lost / track.length : 1, frames: times.length, tracked: track.length,
    view: { up: scene.up, normal: rec.normal, focalScale: rec.focalScale, trueFocalScale: scene.K.fx / K.fx, tiltDeg: rec.tiltDeg, spreadDeg: rec.spreadDeg, barAxisCam: scene.barAxisCam, upUsed },
    track, heights, diag, fit: measured.fit, K, upGiven: up,
  };
}
