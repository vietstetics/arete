import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlateSession } from '../services/live/plateSession.js';
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

/** Run a filmed set through the live session exactly as the camera page does. */
function liveSet({ place, w = 640, h = 360, fps = 30, reps, upKnown = true }) {
  const traj = liftTrajectory({ reps, origin: [0, 1.45, 0], path: 0.03, lead: 1.2, tail: 0.5, pauseTop: 0.5 });
  const scene = makeScene({ w, h, hfovDeg: 64, place, traj, exposure: 1 / 120, noise: 3 });
  const s = createPlateSession({ vw: w, vh: h }); // assumes the default 63° field of view
  if (upKnown) s.setUp(scene.up);
  const times = frameTimes({ duration: traj.duration, fps });
  for (const { t } of times) {
    const img = scene.render(t);
    if (s.state === 'searching') {
      // The pose says roughly where the bar is (here: within a tenth of the plate size of the truth).
      const c = scene.centreCam(t), p = project(scene.K, c), a = (scene.K.fx * 0.225) / c[2];
      s.detect(img, 1, { prior: { x: p.x + 0.1 * a, y: p.y - 0.1 * a } });
      continue;
    }
    const plan = s.roiPlan();
    s.track(grab(img, plan.sx, plan.sy, plan.sw, plan.sh, plan.ow, plan.oh), t);
  }
  return { traj, res: s.finish() };
}

test('live session, side-on and angled, high and low: transducer-style numbers within LPT agreement of the truth', () => {
  const reps = [{ T: 0.75, D: 0.5 }, { T: 1.3, D: 0.48, dip: 0.4 }];
  for (const place of [{ distance: 2.5 }, { distance: 2.2, yawDeg: 38, heightOffset: 0.5, aim: true, rollDeg: 5 }, { distance: 2.0, yawDeg: -28, heightOffset: -0.6, aim: true, rollDeg: -4 }]) {
    const { traj, res } = liveSet({ place, reps });
    console.log(JSON.stringify(place), JSON.stringify(res.quality), res.metrics.reps.map((x) => x.ok ? `mcv ${x.mcv.toFixed(3)} pv ${x.pv.toFixed(3)} d ${x.distance.toFixed(3)}` : x.why).join(' | '), '| truth', traj.reps.map((r) => `mcv ${r.mcv.toFixed(3)} pv ${r.pv.toFixed(3)} D ${r.D}`).join(' | '));
    assert.ok(res.ok && res.quality.ok, `quality ${JSON.stringify(res.quality)}`);
    for (const tr of traj.reps) {
      const m = res.metrics.reps.find((x) => x.ok && x.tTop > tr.tStart && x.tBottom < tr.tEnd);
      assert.ok(m, `${JSON.stringify(place)}: rep missing`);
      const e = (a, b) => Math.abs(a - b);
      // LPT vs motion capture: ±0.03 m/s (GymAware LoA); distance within 2%.
      assert.ok(e(m.mcv, tr.mcv) < 0.03, `${JSON.stringify(place)}: MCV ${m.mcv.toFixed(3)} vs ${tr.mcv.toFixed(3)}`);
      assert.ok(e(m.pv, tr.pv) < 0.06, `${JSON.stringify(place)}: PV ${m.pv.toFixed(3)} vs ${tr.pv.toFixed(3)}`);
      assert.ok(e(m.distance, tr.D) / tr.D < 0.02, `${JSON.stringify(place)}: distance ${m.distance.toFixed(3)} vs ${tr.D}`);
    }
  }
});
