import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plate3dSet, trackerFor, recogniseLift } from '../services/pipeline.js';
import { createPlateSession, setQuality, videoIntrinsics } from '../services/live/plateSession.js';
import { circleEllipse } from '../services/vision/circle3d.js';
import { liftTrajectory, frameTimes } from '../demo/scene3d.js';

// Exact projected outlines isolate the pipeline's numbers and rep matching from image detection.
function fixture() {
  const traj = liftTrajectory({ reps: [{ T: 0.8, D: 0.5 }, { T: 1, D: 0.4 }, { T: 1.2, D: 0.48 }], path: 0, lead: 1, tail: 0.6 });
  const K = videoIntrinsics(640, 360);
  const frames = frameTimes({ duration: traj.duration, fps: 60 }).map(({ t }) => ({
    t, ok: true, fit: 1, e: circleEllipse(K, [0, -traj.height(t), 3], [0, 0, -1], 0.225),
  }));
  const pose = { standard: { start: 0, finish: 50 }, armedAt: 0.8, reps: traj.reps.map((r, i) => ({ n: i + 1, topT: r.tStart - 0.15, result: 'counted', isStandard: i === 0 })) };
  return { traj, pose, frames };
}

function analyse(f, opts = {}) {
  return plate3dSet({ t: trackerFor('squat', 'plate3d'), pose: f.pose, lift: 'squat', fps: 60, diameterM: 0.45,
    plate3d: { vw: 640, vh: 360, frames: f.frames }, ...opts });
}

test('every lift gets its own distance over its own time, as a transducer reports it; a short rep keeps its speed and verdict', () => {
  const f = fixture();
  f.pose.reps[1].result = 'short';
  const r = analyse(f);
  assert.equal(r.refused, '');
  assert.deepEqual(r.rows.map((x) => x.velocity), ['ok', 'ok', 'ok']);
  assert.deepEqual(r.rows.map((x) => x.result), ['counted', 'short', 'counted']);
  assert.deepEqual(r.rows.map((x) => x.isStandard), [true, false, false]);
  r.rows.forEach((x, i) => {
    const tr = f.traj.reps[i];
    assert.equal(x.mcv, x.distance / x.T);
    assert.ok(Math.abs(x.mcv - tr.mcv) < 0.01, `lift ${i + 1}: ${x.mcv.toFixed(3)} vs ${tr.mcv.toFixed(3)}`);
    assert.ok(Math.abs(x.distance - tr.D) < 0.005, `lift ${i + 1}: ${x.distance.toFixed(3)} m vs ${tr.D}`);
  });
  assert.ok(Math.abs(r.Dm - 0.5) < 0.005);
  assert.equal(r.rows[2].rel, r.rows[2].mcv / r.rows[0].mcv);
});

test('a lift the camera never saw is unclear in its place; no other lift stands in for it', () => {
  const f = fixture();
  f.frames = f.frames.filter((x) => x.t > f.traj.reps[0].tEnd + 0.3);
  const r = analyse(f);
  assert.deepEqual(r.rows.map((x) => x.velocity), ['unclear', 'ok', 'ok']);
  assert.equal(r.rows[0].poseRep, 1);
  assert.ok(Number.isNaN(r.rows[0].mcv) && Number.isNaN(r.rows[0].rel));
  assert.deepEqual(r.rows.map((x) => x.poseRep), [1, 2, 3]);
  assert.ok(Math.abs(r.rows[1].mcv - f.traj.reps[1].mcv) < 0.01);
});

test('no plate diameter: refused, with the pose reps kept in place', () => {
  const r = analyse(fixture(), { diameterM: null, massKg: 100 });
  assert.match(r.refused, /diameter/);
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows.every((x) => x.velocity === 'unclear' && Number.isNaN(x.mcv) && Number.isNaN(x.avgPower)));
});

test('3D pipeline refuses invalid geometry and non-increasing video timestamps', () => {
  const f = fixture();
  assert.match(analyse(f, { plate3d: { vw: 0, vh: 360, frames: f.frames } }).refused, /video size/);
  f.frames[1].t = f.frames[0].t;
  assert.match(analyse(f).refused, /timestamps/);
});

test('a missing plate preserves pose rep verdicts with no speeds', () => {
  const f = fixture(); f.pose.reps[1].result = 'short';
  const r = analyse(f, { plate3d: null });
  assert.match(r.refused, /never found/);
  assert.deepEqual(r.rows.map((x) => x.result), ['counted', 'short', 'counted']);
  assert.ok(r.rows.every((x) => x.velocity === 'unclear' && Number.isNaN(x.mcv)));
});

test('deadlift: each lift from the floor is matched to the pose rep marked at its lockout', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.9, D: 0.55 }, { T: 1.1, D: 0.55 }, { T: 1.4, D: 0.55 }], startsAtBottom: true, path: 0, lead: 1, tail: 0.6, ecc: 1 });
  const K = videoIntrinsics(640, 360);
  const frames = frameTimes({ duration: traj.duration, fps: 60 }).map(({ t }) => ({ t, ok: true, fit: 1, e: circleEllipse(K, [0, -traj.height(t), 3], [0, 0, -1], 0.225) }));
  // The pose marks a deadlift rep at its lockout, a little after the bar stops rising.
  const pose = { standard: null, armedAt: 0.5, reps: traj.reps.map((r, i) => ({ n: i + 1, topT: r.tEnd + 0.25, result: i === 1 ? 'short' : 'counted', isStandard: i === 0 })) };
  const r = plate3dSet({ t: trackerFor('deadlift', 'plate3d'), pose, lift: 'deadlift', fps: 60, diameterM: 0.45, plate3d: { vw: 640, vh: 360, frames } });
  assert.equal(r.refused, '');
  assert.deepEqual(r.rows.map((x) => x.poseRep), [1, 2, 3]);
  assert.deepEqual(r.rows.map((x) => x.result), ['counted', 'short', 'counted']);
  r.rows.forEach((x, i) => assert.ok(Math.abs(x.mcv - traj.reps[i].mcv) < 0.01, `lift ${i + 1}: ${x.mcv.toFixed(3)} vs ${traj.reps[i].mcv.toFixed(3)}`));
});

test('a recorded set names its own lift from the set-up', () => {
  const at = (x, y) => ({ x: x / 1280, y: y / 720, visibility: 0.95 });
  const person = (j) => { const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 })); for (const [i, xy] of Object.entries(j)) p[i] = at(...xy); return p; };
  const walking = person({ 11: [640, 230], 12: [636, 232], 13: [642, 330], 14: [638, 332], 15: [644, 430], 16: [640, 432], 23: [640, 404], 24: [636, 406], 25: [640, 526], 26: [636, 528], 27: [640, 648], 28: [636, 650] });
  const setup = person({ 11: [712, 383], 12: [708, 385], 13: [712, 484], 14: [708, 486], 15: [712, 585], 16: [708, 587], 23: [571, 482], 24: [567, 484], 25: [682, 533], 26: [678, 535], 27: [640, 648], 28: [636, 650] });
  const frames = Array.from({ length: 90 }, (_, i) => ({ t: i / 30, poses: [i < 45 ? walking : setup] }));
  const r = recogniseLift(frames, { vw: 1280, vh: 720 });
  assert.equal(r.lift, 'deadlift');
  assert.ok(r.at > 1.5 && r.at < 2.3);
  assert.equal(recogniseLift(frames.slice(0, 45), { vw: 1280, vh: 720 }).lift, null);
});

test('live plate session rejects invalid calibration and bad frames without corrupting tracking state', () => {
  for (const args of [{ vw: 0, vh: 360 }, { vw: 640, vh: 360, hfovDeg: 180 }, { vw: 640, vh: 360, radiusM: Infinity }, { vw: 640, vh: 360, radiusM: 0 }]) {
    assert.throws(() => createPlateSession(args), RangeError);
  }
  const s = createPlateSession({ vw: 640, vh: 360 });
  assert.equal(s.lockOn({ cx: NaN, cy: 100, a: 20, b: 20, phi: 0 }).ok, false);
  assert.equal(s.state, 'searching');
  assert.equal(s.detect(null, 0).ok, false);
  assert.equal(s.lockOn({ cx: 320, cy: 180, a: 40, b: 35, phi: 0 }).ok, true);
  s.setUp([0, 0, 0]);
  s.setUp([0, NaN, 0]);
  assert.equal(s.track(null, NaN).ok, false);
  assert.equal(s.track(null, 0).ok, false);
  assert.equal(s.state, 'locking');
  assert.equal(s.frames, 0);
});

test('quality cannot approve a set whose detected outlines never reconstructed into 3D', () => {
  const track = [{ t: 0, ok: true, fit: 1 }, { t: 0.02, ok: true, fit: 1 }];
  const q = setQuality(track, { frames: [{ t: 0, ok: false }, { t: 0.02, ok: false }], normal: null });
  assert.equal(q.ok, false);
  assert.equal(q.lost, 1);
  assert.equal(setQuality([], { frames: [] }).slow, true);
});

test('session snapshots cannot mutate the saved track; duplicate or reversed timestamps are ignored', () => {
  const s = createPlateSession({ vw: 160, vh: 120 });
  s.lockOn({ cx: 80, cy: 60, a: 30, b: 30, phi: 0 }, { wholeFrame: true });
  const img = { w: 160, h: 120, data: Float32Array.from({ length: 160 * 120 }, (_, i) => Math.hypot(i % 160 - 80, Math.floor(i / 160) - 60) < 30 ? 20 : 200) };
  const first = s.track(img, 1);
  assert.equal(first.ok, true);
  const copy = s.trackFrames;
  copy[0].e.cx = -1000;
  copy[0].t = 123;
  assert.equal(s.trackFrames[0].t, 1);
  assert.ok(s.trackFrames[0].e.cx > 0);
  assert.equal(s.track(img, 1).ok, false);
  assert.equal(s.track(img, 0.5).ok, false);
  assert.equal(s.frames, 1);
  const finished = s.finish();
  finished.track[0].e.cx = -2000;
  assert.ok(s.trackFrames[0].e.cx > 0);
});
