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
// transducer-style numbers per lift (bar3d.js barMetrics). Its rows are the
// plate's own lifts, as a velocity transducer lists them, each with the
// pose's verdict on its rep (counted, short, unclear) beside it.

import {
  createRepCounter, createReturnCounter, createHeightTracker, createStillGate,
  HEIGHT_DEFAULTS, jointAngle, oneEuro, pickPerson,
} from '../../standard/services/repEngine.js';
import { metresPerUnit, concentricVelocity } from '../../standard/services/velocity.js';
import { velocitySourceFor } from './sources.js';
import { savitzkyGolay } from './smooth.js';
import { weightSamples } from './weight.js';
import { PLATE_DIAMETER_M, MAX_OFF_AXIS_DEG } from './vision/geometry.js';
import { setVelocities, intraSetFatigue } from './timing.js';
import { repMetrics, confidence } from './metrics.js';
import { reconstruct3D, heightsFromTrack } from './vision/plate3d.js';
import { barMetrics, barStill, G } from './bar3d.js';
import { videoIntrinsics, setQuality, DEFAULT_HFOV_DEG } from './live/plateSession.js';
import { createLiftDetector, CONCENTRIC_FIRST } from './sbd.js';

// Same values as curl-lab.html, so the harness judges reps the way the app does.
const MIN_VIS = 0.55, CALIB_SECS = 0.8, CALIB_HEIGHT_SECS = 0.3;
const STILL_BANDS = { curl: [8], squat: [4], bench: [6], deadlift: [5] };

// weight: what the weight tracker follows. path: 'height' (barbell: vertical
// bar velocity) or 'path' (dumbbell: distance along its arc). prior: the
// landmarks the weight sits next to, to find it in the first frame.
export const LIFTS = {
  squat: { label: 'Back squat', exercise: 'Back Squat', equipment: 'Barbell', point: 'bar on your shoulders', defaultMass: 'bar+body', weight: 'plate', weight3d: true, path: 'height', prior: [11, 12] },
  bench: { label: 'Bench press', exercise: 'Bench Press', equipment: 'Barbell', point: 'your hands', defaultMass: 'bar', weight: 'plate', weight3d: true, path: 'height', prior: [15, 16] },
  deadlift: { label: 'Deadlift', exercise: 'Deadlift', equipment: 'Barbell', point: 'your hands', defaultMass: 'bar', weight: 'plate', weight3d: true, path: 'height', prior: [15, 16] },
  curl: { label: 'Dumbbell curl', exercise: 'Dumbbell Curl', equipment: 'Dumbbell', point: 'the dumbbell’s arc around your elbow', defaultMass: 'bar', weight: 'dumbbell', path: 'path', prior: [15, 16] },
};

/** The trackers a lift can be measured with: the weight first (in 3D for a barbell, then the older 2D), the pose baseline last. */
export function trackerChoices(lift) {
  return [...(LIFTS[lift].weight3d ? [trackerFor(lift, 'plate3d'), trackerFor(lift, 'marker')] : []), trackerFor(lift, LIFTS[lift].weight), trackerFor(lift, 'pose-baseline')];
}

/** How velocity is measured for a lift (default: at the weight, in 3D where it can be). */
export function trackerFor(lift, id = LIFTS[lift].weight3d ? 'plate3d' : LIFTS[lift].weight) {
  const source = velocitySourceFor({ name: LIFTS[lift].exercise, equipment: LIFTS[lift].equipment });
  if (id === 'plate3d') return { source, id, label: 'The plate in 3D (any camera angle) — as the app measures' };
  if (id === 'plate') return { source, id, label: 'The plate, 2D (older: side-on only)' };
  if (id === 'marker') return { source, id, label: 'A coloured marker on the bar’s end (side-on), as barbellcv tracks it' };
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
  const counter = lift === 'curl' ? createRepCounter() : createReturnCounter({ ...HEIGHT_DEFAULTS, invert: !!CONCENTRIC_FIRST[lift] });
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
        // Squat, bench, deadlift: locked in 0.3 s and counted straight away (lifters often start the moment
        // they're set; the counter's minimum range keeps an unrack or walkout from counting).
        if (c.ok) { steadySince = steadySince ?? t; if (t - steadySince >= CALIB_HEIGHT_SECS && tracker.lock()) { phase = 'count'; armedAt = t; } }
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
 * before the next rep's bottom. Deadlift (its moment is the lockout): from
 * just after the previous lockout to just past this one.
 */
export function repWindows(reps, lift, tMax) {
  return reps.map((r, i) => {
    if (lift === 'curl') return Number.isFinite(r.startT) ? { t0: r.startT - 0.25, t1: r.topT + 0.25 } : null;
    if (CONCENTRIC_FIRST[lift]) { const prev = reps[i - 1]; return { t0: prev ? prev.topT + 0.3 : 0, t1: r.topT + 0.25 }; }
    const next = reps[i + 1];
    return { t0: r.topT - 0.25, t1: next ? next.topT - 0.3 : tMax };
  });
}

/**
 * Which of squat, bench and deadlift a recorded set is, from the lifter's set-up (sbd.js): the first
 * time the posture holds one answer for 0.6 s. null if it never does.
 */
export function recogniseLift(frames, { vw, vh }) {
  const det = createLiftDetector();
  let center = null;
  for (const f of frames) {
    const i = pickPerson(f.poses, center);
    if (i < 0) { det.push(f.t, null, vw, vh); continue; }
    const p = f.poses[i];
    center = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
    const lift = det.push(f.t, p, vw, vh);
    if (lift) return { lift, at: f.t };
  }
  return { lift: null, at: NaN };
}

/**
 * Full analysis of one recorded set.
 *   frames, vw, vh: pose frames (see runPose); fps: capture frame rate
 *   heightCm: for m/s; massKg: system mass for power / force
 * Returns everything the harness shows: reps with D/T velocity and metrics,
 * D, units, frame-rate tiers and the current live panel's reading for comparison.
 */
export function analyseSet({ frames, vw, vh, lift, fps, heightCm = null, massKg = null, tracker, plateTrack = null, diameterM = PLATE_DIAMETER_M, gravity, plate3d = null, markerTrack = null }) {
  const t = trackerFor(lift, tracker);
  const pose = runPose(frames, { lift, vw, vh, heightCm });
  if (t.id === 'plate3d') return plate3dSet({ t, pose, lift, fps, massKg, diameterM, plate3d });
  if (t.id === 'marker') return markerSet({ t, pose, lift, fps, massKg, diameterM, markerTrack });
  const tMax = frames.length ? frames[frames.length - 1].t : 0;
  const windows = repWindows(pose.reps, lift, tMax);
  // The measured point: the weight from the video, or the body-pose baseline.
  let samples = pose.samples, mpu = pose.mpu, view = null, refused = '', quality = pose.quality;
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
  // For comparison on the same set: the body-pose baseline and today's live panel method.
  const poseFit = t.id === 'pose-baseline' ? fit : savitzkyGolay(pose.samples);
  const base = t.id === 'pose-baseline' ? dt : setVelocities(pose.samples, poseFit, pose.reps, windows, { mpu: pose.mpu });
  const poseScaled = Number.isFinite(pose.mpu);
  const rows = dt.rows.map((row, i) => {
    const m = repMetrics(fit, row, { D: dt.D, mpu, massKg });
    const w = windows[i];
    const live = row.result === 'counted' && w ? concentricVelocity(pose.samples, w.t0, w.t1) : null;
    return {
      ...row, ...m, isStandard: !!(pose.reps[i] && pose.reps[i].isStandard),
      romCm: dt.scaled && Number.isFinite(row.distance) ? row.distance * 100 : NaN,
      poseMcv: base.rows[i] && base.rows[i].velocity === 'ok' && poseScaled ? base.rows[i].mcv : NaN,
      liveMv: live && poseScaled ? live.mv * pose.mpu : NaN,
      badges: Object.fromEntries(['mv', 'loss', 'rom', 'avgPower', 'mpv', 'pv', 'peakPower', 'peakForce'].map((k) => [k, confidence(k, { fps, quality })])),
    };
  });
  return {
    lift, tracker: t, fps, scaled: dt.scaled, mpu, D: dt.D, Dm: dt.Dm, view, refused, diameterM: t.id === 'pose-baseline' ? null : diameterM,
    standard: pose.standard, armedAt: pose.armedAt, quality,
    calibration: { kind: t.id === 'pose-baseline' || t.id === 'pose-hand' ? 'height-proportions' : 'plate-diameter', estimate: true },
    nativeUnits: dt.scaled ? 'metres' : 'native', massContext: massKg > 0 ? { systemMassKg: massKg } : null,
    rows, fatigue: intraSetFatigue(rows), samples, fit,
  };
}

/**
 * The 3D plate measurement of a recorded set — the live page's own numbers.
 *   plate3d: { vw, vh, hfovDeg, frames: [{ t, ok, e: { cx, cy, a, b, phi } (full-frame px) }] } from the
 *     rim tracker. A video carries no gravity, so the camera's up comes from the plate (upFromPlate: exact
 *     for the tilt the plate can see; the turn about the bar itself is taken as level).
 *   diameterM: the plate's diameter (its radius sets the scale)
 * Rows are the plate's lifts in order, each with the pose's verdict on the rep it belongs to (result:
 * counted / short / unclear, or 'not counted' when the pose saw no rep there) and transducer-style numbers:
 * mcv (this lift's own distance over its own time), pv, mpv, distance, T; rel / loss against the first lift.
 * A lift without numbers has velocity 'unclear' and why; one the camera saw too little of has estimate.
 */
export function plate3dSet({ t, pose, lift, fps, massKg = null, diameterM = PLATE_DIAMETER_M, plate3d }) {
  const base = { lift, tracker: t, fps, scaled: true, mpu: 1, D: NaN, Dm: NaN, view: null, refused: '', diameterM, standard: pose.standard, armedAt: pose.armedAt, quality: 0, rows: [], fatigue: NaN, samples: [], fit: [] };
  const refuse = (why) => ({ ...base, refused: why, rows: pose.reps.map((pr) => unclearRow(pr, why)) });
  const frames = plate3d && plate3d.frames ? plate3d.frames : [];
  if (!frames.some((f) => f.ok)) return refuse('The plate was never found in the video');
  if (!(diameterM > 0)) return refuse('Enter the plate’s diameter: it sets the scale');
  let K;
  try { K = videoIntrinsics(plate3d.vw, plate3d.vh, plate3d.hfovDeg || DEFAULT_HFOV_DEG); } catch { return refuse('Invalid video size or field of view'); }
  if (frames.some((f, i) => !Number.isFinite(f.t) || (i > 0 && f.t <= frames[i - 1].t))) return refuse('Frame timestamps must increase');
  const rec = reconstruct3D(frames, K, { up: null, R: diameterM / 2 });
  const heights = heightsFromTrack(rec.frames, rec.up);
  const m = barMetrics(heights);
  const quality = setQuality(frames, rec);
  const { rows, first, okLifts } = liftRows(m, pose, lift, { massKg, reliable: quality.ok && quality.clear, unseen: 'Plate not seen rising through this rep', samples: heights });
  const v = okLifts.map((L) => L.mcv);
  const view = {
    threeD: true, scaled: true, ok: quality.ok, clear: quality.clear, rimFit: quality.rimFit, offAxisDeg: quality.offAxisDeg, tiltDeg: quality.tiltDeg, spreadDeg: quality.spreadDeg,
    focalScale: quality.focalScale, lost: quality.lost, upFrom: rec.upFrom,
  };
  return {
    ...base, rows, view, quality: 1 - quality.lost, D: first ? first.distance : NaN, Dm: first ? first.distance : NaN,
    calibration: { kind: 'plate-diameter', diameterM, estimate: true }, nativeUnits: 'metres', massContext: massKg > 0 ? { systemMassKg: massKg } : null,
    fatigue: v.length >= 2 ? (Math.max(...v) - Math.min(...v)) / Math.max(...v) : NaN,
    samples: heights, fit: m.fit, rec, setQuality: quality,
  };
}

// A pose rep the weight gives no numbers for keeps its place and verdict, with why.
function unclearRow(pr, why) {
  return {
    n: pr.n, result: pr.result, poseRep: pr.n, isStandard: !!pr.isStandard, velocity: 'unclear', why, T: NaN, tStart: NaN, tEnd: NaN, distance: NaN,
    mcv: NaN, mcvOwn: NaN, rel: NaN, loss: NaN, pv: NaN, mpv: NaN, romCm: NaN, avgPower: NaN, peakPower: NaN, peakForce: NaN, estimate: '', poseMcv: NaN, liveMv: NaN,
    badges: Object.fromEntries(['mv', 'loss', 'rom', 'avgPower', 'mpv', 'pv', 'peakPower', 'peakForce'].map((k) => [k, 'estimate'])), at: pr.topT,
  };
}

/**
 * Transducer-style rows from the bar's measured lifts (barMetrics m): each lift in order with the pose's
 * verdict on its rep, then the pose reps no lift was seen for (unclear, why `unseen`), all in time order.
 * reliable: whether the tracking as a whole was good enough for 'reliable' badges.
 */
function liftRows(m, pose, lift, { massKg = null, reliable = false, unseen, samples = [] }) {
  // Each lift's rep: the pose rep whose deepest point falls after the previous lift's top and up to this one's
  // (its deepest point can be anywhere in a pause at the bottom, so it isn't matched to the lift's start).
  // A deadlift's rep is marked at its lockout instead: the pose rep whose lockout falls after this lift
  // leaves the floor and before the next one does.
  const concentricFirst = !!CONCENTRIC_FIRST[lift];
  const poseOf = (L, prevTop, i) => {
    const next = m.reps[i + 1];
    const cands = pose.reps.filter((r) => Number.isFinite(r.topT) && (concentricFirst ? r.topT > L.tBottom && (!next || r.topT <= next.tBottom) : r.topT > prevTop && r.topT <= L.tTop));
    return cands.length ? cands[concentricFirst ? 0 : cands.length - 1] : null;
  };
  const okLifts = m.reps.filter((L) => L.ok), first = okLifts.length ? okLifts[0] : null;
  const rows = m.reps.map((L, i) => {
    const pr = poseOf(L, i ? m.reps[i - 1].tTop : -Infinity, i);
    const row = {
      n: i + 1, result: pr ? pr.result : 'not counted', poseRep: pr ? pr.n : null, isStandard: !!(pr && pr.isStandard), velocity: L.ok ? 'ok' : 'unclear', why: L.ok ? '' : L.why,
      T: NaN, tStart: NaN, tEnd: NaN, distance: NaN, mcv: NaN, mcvOwn: NaN, rel: NaN, loss: NaN, pv: NaN, mpv: NaN, romCm: NaN,
      avgPower: NaN, peakPower: NaN, peakForce: NaN, estimate: '', poseMcv: NaN, liveMv: NaN,
    };
    if (L.ok) {
      Object.assign(row, { T: L.T, tStart: L.tStart, tEnd: L.tEnd, distance: L.distance, mcv: L.mcv, mcvOwn: L.mcv, pv: L.pv, mpv: L.mpv, romCm: L.distance * 100, estimate: L.estimate || '' });
      row.rel = L.mcv / first.mcv; row.loss = 1 - row.rel;
      if (massKg > 0) row.avgPower = (massKg * G * L.distance) / L.T; // work–energy: the bar starts and ends at rest
      const notes = [L.estimate && `estimate: ${L.estimate}`, L.peakWhy].filter(Boolean);
      row.why = notes.join('; ');
    }
    const grade = !L.ok || L.estimate || !reliable ? 'estimate' : 'reliable';
    row.badges = Object.fromEntries(['mv', 'loss', 'rom', 'avgPower', 'mpv', 'pv', 'peakPower', 'peakForce'].map((k) => [k, grade]));
    return row;
  });
  // Reps the pose counted but the plate never showed rising keep their place (unclear), so the rows stay in step
  // with a reference's rep list; then everything in time order.
  const claimed = new Set(rows.map((x) => x.poseRep).filter((n) => n !== null));
  for (const pr of pose.reps) {
    if (claimed.has(pr.n)) continue;
    // The body came back up but the bar never moved (dropped or dumped first): not a rep at all.
    const next = pose.reps.find((x) => x.topT > pr.topT);
    if (barStill(samples, ...(CONCENTRIC_FIRST[lift] ? [pr.topT - 1.5, pr.topT + 0.3] : [pr.topT, next ? next.topT - 0.3 : pr.topT + 2]))) continue;
    rows.push(unclearRow(pr, unseen));
  }
  const timeOf = (x) => x.at ?? x.tStart ?? NaN;
  rows.forEach((x, i) => { if (x.at === undefined) x.at = Number.isFinite(x.tStart) ? x.tStart : m.reps[i] ? m.reps[i].tBottom : NaN; });
  rows.sort((a, b) => timeOf(a) - timeOf(b));
  rows.forEach((x, i) => { x.n = i + 1; });
  return { rows, first, okLifts };
}

/**
 * A coloured marker on the bar's end (vision/marker.js), filmed side-on: barbellcv's way of following the
 * bar, measured the way Arete measures the plate. The blob's centre is the bar; its size against the
 * marker's real diameter sets the scale (the whole set's median: the marker is small, so one frame's size
 * is too rough). Measured in the picture's plane, so only for a camera close to side-on.
 *   markerTrack: [{ t, ok, cx, cy, r }] in full-frame pixels
 */
export function markerSet({ t, pose, lift, fps, massKg = null, diameterM = null, markerTrack }) {
  const base = { lift, tracker: t, fps, scaled: true, mpu: 1, D: NaN, Dm: NaN, view: null, refused: '', diameterM, standard: pose.standard, armedAt: pose.armedAt, quality: 0, rows: [], fatigue: NaN, samples: [], fit: [] };
  const refuse = (why) => ({ ...base, refused: why, rows: pose.reps.map((pr) => unclearRow(pr, why)) });
  const track = markerTrack || [];
  if (!track.some((f) => f.ok)) return refuse('The marker was never found in the video');
  if (!(diameterM > 0)) return refuse('Enter the marker’s diameter: it sets the scale');
  const ws = weightSamples(track.map((f) => ({ t: f.t, ok: f.ok, cx: f.cx, cy: f.cy, shape: f.ok ? { a: f.r, b: f.r, phi: 0 } : null })), { diameterM, mode: 'height' });
  if (!ws.view) return refuse('The marker was never found in the video');
  const m = barMetrics(ws.samples);
  const { rows, first, okLifts } = liftRows(m, pose, lift, { massKg, reliable: false, unseen: 'Marker not seen rising through this rep', samples: ws.samples });
  const v = okLifts.map((L) => L.mcv);
  return {
    ...base, rows, view: { ...ws.view, marker: true }, quality: track.filter((f) => f.ok).length / track.length, D: first ? first.distance : NaN, Dm: first ? first.distance : NaN,
    calibration: { kind: 'marker-diameter', diameterM, estimate: true }, nativeUnits: 'metres', massContext: massKg > 0 ? { systemMassKg: massKg } : null,
    fatigue: v.length >= 2 ? (Math.max(...v) - Math.min(...v)) / Math.max(...v) : NaN,
    samples: ws.samples, fit: m.fit,
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
