// Recorded set → reps → velocity, offline (build step 1, the validation harness).
//
// Rep counting and the rep-1 standard use body pose for every exercise,
// exactly as the live camera page (curl-lab.html) does: the same rep engine,
// calibration, hold-still wait and settings. Velocity is then measured at
// the exercise's velocity source (sources.js) as D / T (timing.js).
//
// Free weights are measured at the weight: the plate / bar end (barbell) or
// the dumbbell head, tracked in the video (vision/plate.js, build step 2),
// scaled by the plate itself and corrected for the camera angle. If the
// weight is lost for over 0.5 s in a rep, that rep's velocity is "unclear" —
// never filled in from the body. The body-pose baseline from step 1 (bar on
// the shoulders, hands, the dumbbell's arc around the elbow) stays available,
// clearly labelled, so the two can be compared on the same set.
//
// The barbell's default is the plate in 3D ('plate3d'): the same measurement
// the live camera page makes — the plate's outline every frame
// (vision/plate3d.js createRimTracker), its 3D centre (reconstruct3D) and
// transducer-style numbers per lift (bar3d.js barMetrics). Counted pose rows
// keep the original standard's D / T. Separate lab measurements list every
// plate lift and its own distance / time, alongside the pose verdict.

import {
  createRepCounter, createReturnCounter, createHeightTracker, createStillGate,
  HEIGHT_DEFAULTS, jointAngle, oneEuro, pickPerson,
} from '../../standard/services/repEngine.js';
import { metresPerUnit } from '../../standard/services/velocity.js';
import { velocitySourceFor } from './sources.js';
import { savitzkyGolay } from './smooth.js';
import { weightSamples } from './weight.js';
import { PLATE_DIAMETER_M, MAX_OFF_AXIS_DEG } from './vision/geometry.js';
import { setVelocities, intraSetFatigue } from './timing.js';
import { repMetrics, confidence } from './metrics.js';
import { reconstruct3D, heightsFromTrack } from './vision/plate3d.js';
import { barMetrics, G } from './bar3d.js';
import { videoIntrinsics, setQuality, DEFAULT_HFOV_DEG } from './live/plateSession.js';
import { standardizeLifts } from './live/repVelocity.js';

// Same values as curl-lab.html, so the harness judges reps the way the app does.
const MIN_VIS = 0.55, CALIB_SECS = 0.8;
const STILL_BANDS = { curl: [8], squat: [4], bench: [6] };

// weight: what the weight tracker follows. path: 'height' (barbell: vertical
// bar velocity) or 'path' (dumbbell: distance along its arc). prior: the
// landmarks the weight sits next to, to find it in the first frame.
export const LIFTS = {
  squat: { label: 'Back squat', exercise: 'Back Squat', equipment: 'Barbell', point: 'bar on your shoulders', defaultMass: 'bar+body', weight: 'plate', weight3d: true, path: 'height', prior: [11, 12] },
  bench: { label: 'Bench press', exercise: 'Bench Press', equipment: 'Barbell', point: 'your hands', defaultMass: 'bar', weight: 'plate', weight3d: true, path: 'height', prior: [15, 16] },
  curl: { label: 'Dumbbell curl', exercise: 'Dumbbell Curl', equipment: 'Dumbbell', point: 'the dumbbell’s arc around your elbow', defaultMass: 'bar', weight: 'dumbbell', path: 'path', prior: [15, 16] },
};

/** The trackers a lift can be measured with: the weight first (in 3D for a barbell, then the older 2D), the pose baseline last. */
export function trackerChoices(lift) {
  return [...(LIFTS[lift].weight3d ? [trackerFor(lift, 'plate3d')] : []), trackerFor(lift, LIFTS[lift].weight), trackerFor(lift, 'pose-baseline')];
}

/** How velocity is measured for a lift (default: at the weight, in 3D where it can be). */
export function trackerFor(lift, id = LIFTS[lift].weight3d ? 'plate3d' : LIFTS[lift].weight) {
  const source = velocitySourceFor({ name: LIFTS[lift].exercise, equipment: LIFTS[lift].equipment });
  if (id === 'plate3d') return { source, id, label: 'The plate in 3D (estimated camera geometry)' };
  if (id === 'plate') return { source, id, label: 'The plate, 2D (older: side-on only)' };
  if (id === 'dumbbell') return { source, id, label: 'The dumbbell head' };
  return source === 'weight'
    ? { source, id: 'pose-baseline', label: `Body-pose baseline (${LIFTS[lift].point}), not the weight itself` }
    : { source, id: 'pose-hand', label: 'Hand (wrist) from body pose' };
}

/**
 * Pose frames → rep counter and the measured point's position over time.
 *   frames: [{ t, poses: [landmarks(33) …] }] in time order (seconds)
 * Returns { reps, standard, samples: [{ t, y }] (native units, up = lifting),
 *   mpu: metres per unit (NaN without a height), armedAt, quality }.
 */
export function runPose(frames, { lift, vw, vh, heightCm = null }) {
  const euro = oneEuro(), gate = createStillGate({ secs: 1, bands: STILL_BANDS[lift] });
  const counter = lift === 'curl' ? createRepCounter() : createReturnCounter(HEIGHT_DEFAULTS);
  const tracker = lift === 'curl' ? null : createHeightTracker(lift, { minVis: MIN_VIS });
  // Offline, the curl's working arm is simply the one the camera sees best over the whole video.
  let side = 'left';
  if (lift === 'curl') {
    const vis = { left: 0, right: 0 };
    for (const f of frames) for (const p of f.poses.slice(0, 1)) { vis.left += (p[11].visibility + p[13].visibility + p[15].visibility) || 0; vis.right += (p[12].visibility + p[14].visibility + p[16].visibility) || 0; }
    side = vis.left >= vis.right ? 'left' : 'right';
  }
  const ARM = side === 'left' ? [11, 13, 15] : [12, 14, 16];
  let center = null, phase = 'finding', steadySince = null, armedAt = null;
  const samples = [];
  for (const f of frames) {
    const t = f.t;
    const idx = pickPerson(f.poses, center);
    if (idx < 0) {
      if (phase === 'count') counter.push(t, NaN, false);
      gate.reset(); samples.push({ t, y: NaN });
      continue;
    }
    const p = f.poses[idx];
    center = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
    let a = NaN, ok = false, y = NaN;
    if (lift === 'curl') {
      const P = (i) => ({ x: p[i].x * vw, y: p[i].y * vh, v: p[i].visibility ?? 0 });
      const [S, E, W] = ARM.map(P);
      ok = Math.min(S.v, E.v, W.v) >= MIN_VIS;
      const raw = ok ? jointAngle(S, E, W) : NaN;
      a = ok ? euro.filter(raw, t) : NaN;
      if (phase === 'finding') {
        if (ok) { steadySince = steadySince ?? t; if (t - steadySince >= CALIB_SECS) phase = 'settle'; } else steadySince = null;
      }
      y = ok && phase !== 'finding' ? ((180 - raw) * Math.PI) / 180 : NaN; // radians of curl; × lever arm = metres
    } else {
      if (phase === 'finding') {
        const c = tracker.calibrate(p, vw, vh);
        if (c.ok) { steadySince = steadySince ?? t; if (t - steadySince >= CALIB_SECS && tracker.lock()) phase = 'settle'; }
        else { steadySince = null; tracker.reset(); }
        samples.push({ t, y: NaN });
        continue;
      }
      const m = tracker.measure(p, vw, vh);
      ok = m.ok; a = m.ok ? euro.filter(m.value, t) : NaN;
      y = Number.isFinite(m.bar) ? m.bar : NaN;
    }
    samples.push({ t, y });
    if (phase === 'settle') { if (gate.push(t, [a])) { phase = 'count'; armedAt = t; } continue; }
    if (phase === 'count') counter.push(t, a, ok);
  }
  const heightM = heightCm > 0 ? heightCm / 100 : 0;
  const mpu = metresPerUnit(lift, { heightM, scale: tracker?.scale, standShoulderPx: tracker?.standShoulderPx, armPx: tracker?.armPx });
  const counting = samples.filter((s) => armedAt !== null && s.t >= armedAt);
  const quality = counting.length ? counting.filter((s) => Number.isFinite(s.y)).length / counting.length : 0;
  return { reps: counter.reps, standard: counter.standard, samples, mpu, armedAt, quality };
}

/**
 * Where each rep's lifting phase lies. Curl: from the stretch to the top.
 * Squat / bench (judged on the way back up): from the bottom until just
 * before the next rep's bottom.
 */
export function repWindows(reps, lift, tMax) {
  return reps.map((r, i) => {
    if (lift === 'curl') return Number.isFinite(r.startT) ? { t0: r.startT - 0.25, t1: r.topT + 0.25 } : null;
    const next = reps[i + 1];
    return { t0: r.topT - 0.25, t1: next ? next.topT - 0.3 : tMax };
  });
}

/**
 * Full analysis of one recorded set.
 *   frames, vw, vh: pose frames (see runPose); fps: capture frame rate
 *   heightCm: optional internal anthropometric estimate, never a measured physical calibration
 *   massKg: system mass for power / force when the measured point has a physical scale
 * Returns everything the harness shows: reps with D/T velocity and metrics,
 * D, units, frame-rate tiers and the current live panel's reading for comparison.
 */
export function analyseSet({ frames, vw, vh, lift, fps, heightCm = null, massKg = null, tracker, plateTrack = null, diameterM = null, gravity, plate3d = null }) {
  const t = trackerFor(lift, tracker);
  const pose = runPose(frames, { lift, vw, vh, heightCm });
  if (t.id === 'plate3d') return plate3dSet({ t, pose, lift, fps, massKg, diameterM, plate3d });
  const tMax = frames.length ? frames[frames.length - 1].t : 0;
  const windows = repWindows(pose.reps, lift, tMax);
  // The measured point: the weight from the video, or the body-pose baseline.
  let samples = pose.samples, mpu = NaN, view = null, refused = '', quality = pose.quality;
  if (t.id === 'plate' || t.id === 'dumbbell') {
    const ws = weightSamples(plateTrack || [], { diameterM, gravity, mode: LIFTS[lift].path });
    view = ws.view; samples = ws.samples; mpu = view && view.scaled ? 1 : NaN;
    if (!view) refused = 'The weight was never found in the video';
    else if (!view.ok) refused = `Camera ${Math.round(view.offAxisDeg)}° off side-on: more than the ${MAX_OFF_AXIS_DEG}° limit`;
    const counting = samples.filter((x) => pose.armedAt !== null && x.t >= pose.armedAt);
    quality = counting.length ? counting.filter((x) => Number.isFinite(x.y)).length / counting.length : 0;
  }
  const fit = savitzkyGolay(samples);
  const dt = setVelocities(samples, fit, pose.reps, windows, { mpu });
  if (refused) dt.rows.forEach((r) => { if (r.result === 'counted') Object.assign(r, { velocity: 'unclear', why: refused, mcv: NaN, mcvOwn: NaN, rel: NaN, loss: NaN }); });
  // A height-based body model is not a measured scale. Pose comparisons may retain timing ratios,
  // but cannot publish m/s, centimetres, watts or force from anthropometric proportions.
  const poseFit = t.id === 'pose-baseline' ? fit : savitzkyGolay(pose.samples);
  const base = t.id === 'pose-baseline' ? dt : setVelocities(pose.samples, poseFit, pose.reps, windows);
  const poseOnly = t.id === 'pose-baseline' || t.id === 'pose-hand';
  const estimate = poseOnly ? 'Uncalibrated body pose: height alone does not establish a measured physical scale' : '';
  const rows = dt.rows.map((row, i) => {
    const m = repMetrics(fit, row, { D: dt.D, mpu, massKg });
    return {
      ...pose.reps[i], ...row, ...m, isStandard: !!pose.reps[i].isStandard,
      ...(!dt.scaled ? { mcv: NaN, mcvOwn: NaN, distance: NaN, pv: NaN, mpv: NaN } : {}),
      romCm: dt.scaled && Number.isFinite(row.distance) ? row.distance * 100 : NaN,
      poseRel: base.rows[i]?.velocity === 'ok' ? base.rows[i].rel : NaN,
      poseMcv: NaN, liveMv: NaN, ...(estimate ? { estimate } : {}),
      badges: Object.fromEntries(['mv', 'loss', 'rom', 'avgPower', 'mpv', 'pv', 'peakPower', 'peakForce'].map((k) => [k, poseOnly ? 'estimate' : confidence(k, { fps, quality })])),
    };
  });
  return {
    lift, tracker: t, fps, scaled: dt.scaled, mpu, D: dt.D, Dm: dt.Dm, view, refused, diameterM: t.id === 'pose-baseline' ? null : diameterM,
    standard: pose.standard, armedAt: pose.armedAt, quality,
    calibration: { kind: poseOnly ? 'uncalibrated-pose' : dt.scaled ? 'measured-diameter' : 'relative-weight', estimate: true },
    rows, fatigue: intraSetFatigue(rows.map((r) => ({ ...r, mcv: r.rel }))), samples, fit,
  };
}

/**
 * The 3D plate measurement of a recorded set — the live page's own numbers.
 *   plate3d: { vw, vh, hfovDeg, frames: [{ t, ok, e: { cx, cy, a, b, phi } (full-frame px) }] } from the
 *     rim tracker. A video carries no gravity, so the camera's up comes from the plate (upFromPlate: exact
 *     for the tilt the plate can see; the turn about the bar itself is taken as level).
 *   diameterM: the plate's diameter (its radius sets the scale)
 * rows: one per pose rep, counted reps only get D / T from the original standard.
 * measurementRows: one per detected plate lift, own distance / time for lab comparisons, independently of
 * the pose verdict. This series is never used to count reps or establish the workout's standard.
 * Unknown physical diameter preserves time and relative speed while suppressing all SI measurements.
 */
export function plate3dSet({ t, pose, lift, fps, massKg = null, diameterM = null, plate3d }) {
  const scaled = Number.isFinite(diameterM) && diameterM > 0;
  const badges = Object.fromEntries(['mv', 'loss', 'rom', 'avgPower', 'mpv', 'pv', 'peakPower', 'peakForce'].map((k) => [k, 'estimate']));
  const unavailableRows = standardizeLifts(pose.reps, []).rows.map(({ rep, lift: L, ...row }) => ({
    ...rep, ...row, n: rep.n, result: rep.result, isStandard: !!rep.isStandard, poseRep: rep.n,
    romCm: NaN, avgPower: NaN, peakPower: NaN, peakForce: NaN, poseMcv: NaN, liveMv: NaN, badges: { ...badges },
  }));
  const base = { lift, tracker: t, fps, scaled, mpu: scaled ? 1 : NaN, D: NaN, Dm: NaN, view: null, refused: '', diameterM: scaled ? diameterM : null, standard: pose.standard, armedAt: pose.armedAt, quality: 0, rows: unavailableRows, measurementRows: [], fatigue: NaN, samples: [], fit: [] };
  const frames = plate3d && plate3d.frames ? plate3d.frames : [];
  if (!frames.some((f) => f.ok)) return { ...base, refused: 'The plate was never found in the video' };
  let K;
  try { K = videoIntrinsics(plate3d.vw, plate3d.vh, plate3d.hfovDeg ?? DEFAULT_HFOV_DEG); }
  catch { return { ...base, refused: 'Invalid video dimensions or camera field of view' }; }
  if (frames.some((f, i) => !Number.isFinite(f.t) || (i > 0 && f.t <= frames[i - 1].t))) return { ...base, refused: 'Frame timestamps must increase' };
  // An arbitrary common radius preserves timings and speed ratios when the physical diameter is unknown.
  // It never authorises SI output. The scale remains an estimate even with a measured diameter because the
  // video intrinsics and the camera's up are inferred, rather than calibrated against a reference instrument.
  const rec = reconstruct3D(frames, K, { up: null, R: (scaled ? diameterM : PLATE_DIAMETER_M) / 2 });
  const heights = heightsFromTrack(rec.frames, rec.up);
  const m = barMetrics(heights);
  const quality = setQuality(frames, rec);
  const standardized = standardizeLifts(pose.reps, m.reps);
  const estimate = 'Assumed camera field of view and inferred vertical; real-video accuracy has not been validated';
  const rows = standardized.rows.map(({ rep, lift: L, ...row }) => {
    const ok = row.velocity === 'ok';
    return {
      ...rep, ...row, n: rep.n, result: rep.result, isStandard: !!rep.isStandard, poseRep: rep.n,
      ...(quality.ok ? {} : { velocity: rep.result === 'counted' ? 'unclear' : 'none', why: 'The plate was not followed cleanly', mcv: NaN, mcvOwn: NaN, rel: NaN, loss: NaN, pv: NaN, mpv: NaN }),
      ...(!scaled ? { mcv: NaN, mcvOwn: NaN, pv: NaN, mpv: NaN, distance: NaN } : {}),
      romCm: ok && quality.ok && scaled ? row.distance * 100 : NaN,
      avgPower: ok && quality.ok && scaled && Number.isFinite(massKg) && massKg > 0 ? massKg * G * standardized.D / row.T : NaN,
      peakPower: NaN, peakForce: NaN, poseMcv: NaN, liveMv: NaN,
      estimate: [estimate, L?.estimate, L?.peakWhy].filter(Boolean).join('; '), badges: { ...badges },
    };
  });
  // Measurements are a separate lab-only series. They may include setup movements, short reps and lifts
  // without a pose verdict; they must never become counted workout velocities or establish the standard.
  const first = m.reps[0]?.ok ? m.reps[0] : null;
  const measurementRows = m.reps.map((L, i) => {
    const matched = standardized.rows.find((r) => r.lift === L);
    const rel = L.ok && first ? L.mcv / first.mcv : NaN;
    return {
      n: i + 1, result: matched?.rep.result || 'not counted', poseRep: matched?.rep.n ?? null,
      velocity: L.ok ? 'ok' : 'unclear', why: L.ok ? '' : L.why,
      T: L.ok ? L.T : NaN, tStart: L.tStart, tEnd: L.tEnd,
      mcv: L.ok && scaled ? L.mcv : NaN, mcvOwn: L.ok && scaled ? L.mcv : NaN,
      distance: L.ok && scaled ? L.distance : NaN, romCm: L.ok && scaled ? L.distance * 100 : NaN,
      pv: L.ok && scaled ? L.pv : NaN, mpv: L.ok && scaled ? L.mpv : NaN,
      avgPower: L.ok && scaled && Number.isFinite(massKg) && massKg > 0 ? massKg * G * L.distance / L.T : NaN,
      rel, loss: 1 - rel, peakPower: NaN, peakForce: NaN, poseMcv: NaN, liveMv: NaN,
      estimate: [estimate, L.estimate, L.peakWhy].filter(Boolean).join('; '), badges: { ...badges },
    };
  });
  const view = {
    threeD: true, scaled, ok: quality.ok, clear: quality.clear, rimFit: quality.rimFit, offAxisDeg: quality.offAxisDeg, tiltDeg: quality.tiltDeg, spreadDeg: quality.spreadDeg,
    focalScale: quality.focalScale, lost: quality.lost, upFrom: rec.upFrom,
  };
  return {
    ...base, rows, measurementRows, view, quality: 1 - quality.lost, D: quality.ok ? standardized.D : NaN, Dm: quality.ok && scaled ? standardized.D : NaN,
    calibration: { kind: scaled ? 'measured-diameter-estimated-camera' : 'relative-plate', diameterM: scaled ? diameterM : null, estimate: true },
    fatigue: intraSetFatigue(rows.map((r) => ({ ...r, mcv: r.rel }))),
    samples: heights, fit: m.fit, rec, setQuality: quality,
  };
}

/** Frame rate from frame timestamps (median interval). */
export function estimateFps(times) {
  const d = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (!d.length) return NaN;
  d.sort((a, b) => a - b);
  return 1 / d[d.length >> 1];
}
