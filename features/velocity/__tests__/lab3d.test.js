import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlateSession, findPlate, DEFAULT_HFOV_DEG } from '../services/live/plateSession.js';
import { plate3dSet, trackerFor } from '../services/pipeline.js';
import { liftTrajectory, makeScene, frameTimes } from '../demo/scene3d.js';
import { project } from '../services/vision/camera.js';
import { sample } from '../services/vision/image.js';

/** What frameGrabber does in the browser: a rectangle of the frame, scaled (area-averaged) to ow × oh. */
function grab(img, sx, sy, sw, sh, ow, oh) {
  const out = new Float32Array(ow * oh), kx = sw / ow, ky = sh / oh, nx = Math.max(1, Math.round(kx)), ny = Math.max(1, Math.round(ky));
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let s = 0, n = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = sample(img, sx + (x + (i + 0.5) / nx) * kx - 0.5, sy + (y + (j + 0.5) / ny) * ky - 0.5);
      if (Number.isFinite(v)) { s += v; n++; }
    }
    out[y * ow + x] = n ? s / n : 0;
  }
  return { w: ow, h: oh, data: out };
}

/**
 * A recorded set through the lab's 3D path (velocity-lab.html): the plate found in the first frame (the
 * find step), locked onto over the whole picture, followed every frame, then analysed by plate3dSet. A video
 * has no gravity: "up" comes from the plate. No pose (the rows are the plate's own lifts).
 */
function labSet({ place, reps, w = 640, h = 360, fps = 30 }) {
  const traj = liftTrajectory({ reps, origin: [0, 1.45, 0], path: 0.03, lead: 1.0, tail: 0.5, pauseTop: 0.5 });
  const scene = makeScene({ w, h, hfovDeg: 66, place, traj, exposure: 1 / 120, noise: 3 });
  const s = createPlateSession({ vw: w, vh: h });
  const times = frameTimes({ duration: traj.duration, fps });
  for (const { t } of times) {
    const img = scene.render(t);
    if (s.state === 'searching') {
      // The find step: Arete's outline near where the pose puts the bar (here off by a third of the plate's radius).
      const c = scene.centreCam(t), p = project(scene.K, c), a = (scene.K.fx * 0.225) / c[2];
      const e = findPlate(img, { rMin: Math.round(0.025 * w), rMax: Math.round(0.2 * w), prior: { x: p.x + 0.33 * a, y: p.y - 0.33 * a } });
      assert.ok(e, `${JSON.stringify(place)}: no plate proposed`);
      s.lockOn(e, { wholeFrame: true });
    }
    const pl = s.roiPlan();
    s.track(grab(img, pl.sx, pl.sy, pl.sw, pl.sh, pl.ow, pl.oh), t);
  }
  const pose = { reps: [], standard: null, armedAt: null };
  const res = plate3dSet({ t: trackerFor('squat', 'plate3d'), pose, lift: 'squat', fps, diameterM: 0.45, plate3d: { vw: w, vh: h, hfovDeg: DEFAULT_HFOV_DEG, frames: s.trackFrames } });
  return { traj, res };
}

test('the lab’s 3D path, no gravity: synthetic own-distance measurements stay within fixture tolerances', () => {
  const reps = [{ T: 0.75, D: 0.5 }, { T: 1.3, D: 0.48, dip: 0.4 }];
  for (const place of [{ distance: 2.5 }, { distance: 2.3, yawDeg: 38, heightOffset: 0.5, aim: true, rollDeg: 3 }, { distance: 2.1, yawDeg: -28, heightOffset: -0.6, aim: true, rollDeg: -3 }]) {
    const { traj, res } = labSet({ place, reps });
    const ok = res.measurementRows.filter((x) => x.velocity === 'ok');
    assert.deepEqual(res.rows, [], 'Uncounted measurements cannot become workout velocities');
    console.log(JSON.stringify(place), JSON.stringify(res.view), res.measurementRows.map((x) => (x.velocity === 'ok' ? `mcv ${x.mcv.toFixed(3)} d ${x.distance.toFixed(3)}${x.estimate ? ' (est)' : ''}` : x.why)).join(' | '), '| truth', traj.reps.map((r) => `mcv ${r.mcv.toFixed(3)} D ${r.D}`).join(' | '));
    assert.equal(res.refused, '', res.refused);
    assert.equal(res.view.upFrom, 'plate');
    assert.ok(res.view.ok, `${JSON.stringify(place)}: quality ${JSON.stringify(res.setQuality)}`);
    assert.equal(ok.length, traj.reps.length, `${JSON.stringify(place)}: ${res.measurementRows.map((x) => x.why || 'ok').join(', ')}`);
    traj.reps.forEach((tr, i) => {
      const x = ok[i];
      // Simulator tolerances, not evidence of agreement on real lifting videos.
      assert.ok(Math.abs(x.mcv - tr.mcv) < 0.03, `${JSON.stringify(place)} lift ${i + 1}: MCV ${x.mcv.toFixed(3)} vs ${tr.mcv.toFixed(3)}`);
      assert.ok(Math.abs(x.distance / tr.D - 1) < 0.02, `${JSON.stringify(place)} lift ${i + 1}: distance ${x.distance.toFixed(3)} vs ${tr.D}`);
      assert.equal(x.result, 'not counted'); // no pose here
      assert.equal(x.badges.mv, 'estimate');
    });
    // Velocity loss against the first lift, as a transducer reports it.
    assert.ok(Math.abs(ok[1].loss - (1 - traj.reps[1].mcv / traj.reps[0].mcv)) < 0.04);
  }
});
