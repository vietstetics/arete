import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plate3dSet, trackerFor } from '../services/pipeline.js';
import { createPlateSession, setQuality, videoIntrinsics } from '../services/live/plateSession.js';
import { circleEllipse } from '../services/vision/circle3d.js';
import { liftTrajectory, frameTimes } from '../demo/scene3d.js';

// Exact projected outlines isolate the pipeline's units, standard and rep eligibility from image detection.
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

test('3D workout velocities use the counted original standard; rejected reps remain lab measurements only', () => {
  const f = fixture();
  f.pose.reps[1].result = 'short';
  const r = analyse(f);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.velocity), ['ok', 'none', 'ok']);
  assert.ok(Math.abs(r.Dm - 0.5) < 0.01);
  assert.ok(Number.isNaN(r.rows[1].mcv));
  assert.ok(Number.isNaN(r.rows[1].pv));
  assert.ok(Number.isNaN(r.rows[1].loss));
  assert.ok(Number.isFinite(r.measurementRows[1].mcv));
  assert.equal(r.measurementRows[1].result, 'short');
  assert.equal(r.rows[2].mcv, r.Dm / r.rows[2].T);
  assert.equal(r.rows[2].rel, r.rows[0].T / r.rows[2].T);
  assert.notEqual(r.rows[2].mcv, r.rows[2].mcvOwn, 'Own distance remains a separate lab comparison');
  assert.ok(r.rows.every((x) => Object.values(x.badges).every((v) => v === 'estimate')));
});

test('an unmeasured original standard cannot be silently replaced by a later lift', () => {
  const f = fixture();
  f.frames = f.frames.filter((x) => x.t > f.traj.reps[0].tEnd + 0.3);
  const r = analyse(f);
  assert.ok(Number.isNaN(r.Dm));
  assert.ok(r.rows.every((x) => x.velocity === 'unclear'));
  assert.ok(r.rows.every((x) => Number.isNaN(x.mcv) && Number.isNaN(x.rel)));
  assert.equal(r.measurementRows.filter((x) => x.velocity === 'ok').length, 2);
});

test('unknown plate size preserves timing ratios while suppressing SI values', () => {
  const r = analyse(fixture(), { diameterM: null, massKg: 100 });
  assert.equal(r.scaled, false);
  assert.ok(Number.isNaN(r.Dm));
  assert.ok(r.rows.every((x) => Number.isFinite(x.rel) && Number.isFinite(x.T)));
  for (const row of [...r.rows, ...r.measurementRows]) {
    for (const k of ['mcv', 'mcvOwn', 'distance', 'romCm', 'pv', 'mpv', 'avgPower']) assert.ok(Number.isNaN(row[k]), k);
  }
});

test('3D pipeline refuses invalid geometry and non-increasing video timestamps', () => {
  const f = fixture();
  assert.match(analyse(f, { plate3d: { vw: 0, vh: 360, frames: f.frames } }).refused, /dimensions/);
  f.frames[1].t = f.frames[0].t;
  assert.match(analyse(f).refused, /timestamps/);
});

test('a missing plate preserves pose rep verdicts with unavailable velocities', () => {
  const f = fixture(); f.pose.reps[1].result = 'short';
  const r = analyse(f, { plate3d: null });
  assert.match(r.refused, /never found/);
  assert.deepEqual(r.rows.map((x) => x.result), ['counted', 'short', 'counted']);
  assert.deepEqual(r.rows.map((x) => x.velocity), ['unclear', 'none', 'unclear']);
  assert.ok(r.rows.every((x) => Number.isNaN(x.mcv)));
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
