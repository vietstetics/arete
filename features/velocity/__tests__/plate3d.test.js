import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intrinsicsFromFov, placeCamera, toCamera, dirToCamera, dot, sub, rotation, matVec, unit } from '../services/vision/camera.js';
import { circleEllipse } from '../services/vision/circle3d.js';
import { reconstruct3D, heightsFromTrack, plateTiltDeg, MAX_TILT_DEG } from '../services/vision/plate3d.js';
import { barMetrics, findLifts, peakVelocity, MAX_GAP } from '../services/bar3d.js';
import { liftTrajectory } from '../demo/scene3d.js';
import { rng } from '../demo/synth.js';

const R = 0.225;

// A filmed set without pixels: the plate's exact outline in every frame, for a random phone placement.
function outlines({ seed, fovTrue = 66, fps = 30, place, reps = [{ T: 0.8, D: 0.5 }, { T: 1.2, D: 0.48, dip: 0.4 }] }) {
  const r = rng(seed);
  const traj = liftTrajectory({ reps, origin: [0, 1.4, 0], path: 0.04, drift: 0.02 });
  const K = intrinsicsFromFov(1280, 720, fovTrue);
  const pl = place || { distance: 1.6 + 2 * r(), yawDeg: -55 + 110 * r(), heightOffset: -0.8 + 1.6 * r(), aim: true, rollDeg: -8 + 16 * r() };
  const pose = placeCamera({ ...pl, target: [0, 1.4 - 0.25, 0] });
  const n = dirToCamera(pose, [1, 0, 0]), up = dirToCamera(pose, [0, 1, 0]);
  const track = [];
  for (let t = 0; t < traj.duration; t += 1 / fps) {
    const c = toCamera(pose, traj.pos(t)), e = circleEllipse(K, c, n, R);
    track.push(e ? { t, ok: true, e } : { t, ok: false });
  }
  return { traj, K, pose, n, up, track, place: pl };
}

test('exact outlines → exact bar height from any placement (right focal length)', () => {
  for (let s = 1; s <= 25; s++) {
    const o = outlines({ seed: s });
    // Each frame's own depth: the geometry alone is exact (steadyDepth is tested below).
    const rec = reconstruct3D(o.track, o.K, { up: o.up, fitFocal: false, steady: false });
    assert.ok(Math.abs(dot(rec.normal, o.n)) > 0.999, `seed ${s}: picked the mirror twin (facing ${dot(rec.normal, o.n).toFixed(3)})`);
    const h = heightsFromTrack(rec.frames, o.up), h0 = o.traj.height(o.track[0].t);
    let worst = 0;
    o.track.forEach((f, i) => { if (Number.isFinite(h[i].y)) worst = Math.max(worst, Math.abs(h[i].y - (o.traj.height(f.t) - h0))); });
    assert.ok(worst < 1e-6, `seed ${s}: height error ${(worst * 1000).toFixed(4)} mm`);
  }
});

test('depth from the plate’s plane: a fraction of a mm on exact outlines (the bar drifts 2 cm along its length), and a noisy size no longer shakes the height', () => {
  for (let s = 1; s <= 10; s++) {
    const o = outlines({ seed: s, place: { distance: 3.2, yawDeg: -30 + 6 * s, heightOffset: 0.9, aim: true } }); // looking down on the bar
    const h0 = o.traj.height(o.track[0].t);
    // Height error about its mean: heights are relative to the first frame, whose own error is a constant offset
    // (harmless: speeds and distances are differences).
    const worstOf = (rec) => {
      const h = heightsFromTrack(rec.frames, o.up), e = [];
      o.track.forEach((f, i) => { if (Number.isFinite(h[i].y)) e.push(h[i].y - (o.traj.height(f.t) - h0)); });
      const m = e.reduce((x, y) => x + y, 0) / e.length;
      return { worst: Math.max(...e.map((x) => Math.abs(x - m))), rms: Math.sqrt(e.reduce((x, y) => x + (y - m) ** 2, 0) / e.length) };
    };
    const exact = worstOf(reconstruct3D(o.track, o.K, { up: o.up, fitFocal: false }));
    assert.ok(exact.worst < 0.001, `seed ${s}: exact outlines ${(exact.worst * 1000).toFixed(2)} mm`);
    // The outline's size jitters by ±0.15 px (a real rim fit's typical noise): each frame's own depth swings by
    // centimetres, which the camera's downward look turns into millimetres of height; the plane holds it.
    const r = rng(100 + s), noisy = o.track.map((f) => (f.ok ? { ...f, e: { ...f.e, a: f.e.a + 0.15 * (r() * 2 - 1) * 1.7, b: f.e.b + 0.15 * (r() * 2 - 1) * 1.7 } } : f));
    const own = worstOf(reconstruct3D(noisy, o.K, { up: o.up, fitFocal: false, steady: false })), plane = worstOf(reconstruct3D(noisy, o.K, { up: o.up, fitFocal: false }));
    // Measured: 1.65–1.8 mm → 0.44–0.72 mm.
    assert.ok(plane.rms < own.rms / 2 && plane.rms < 0.0008, `seed ${s}: height noise ${(own.rms * 1000).toFixed(2)} → ${(plane.rms * 1000).toFixed(2)} mm sd`);
  }
});

test('the mirror twin is rejected even when both twins face sideways (camera level with the bar)', () => {
  for (const yawDeg of [-40, -20, 20, 40]) {
    const o = outlines({ seed: 3, place: { distance: 2.2, yawDeg, heightOffset: 0, aim: true } });
    const rec = reconstruct3D(o.track, o.K, { up: o.up, fitFocal: false });
    assert.ok(Math.abs(dot(rec.normal, o.n)) > 0.999, `yaw ${yawDeg}: facing ${dot(rec.normal, o.n).toFixed(3)}`);
  }
});

test('wrong focal length: bar travel stays within 1% for a near-level phone, and gravity noise of 1° is harmless', () => {
  for (let s = 1; s <= 15; s++) {
    const o = outlines({ seed: 40 + s, fovTrue: 63, place: { distance: 2.5, yawDeg: -45 + 6 * s, heightOffset: 0.2, aim: true, rollDeg: 4 } });
    const Kwrong = intrinsicsFromFov(1280, 720, 68);
    const upNoisy = unit(matVec(rotation([1, 0.3, 0.2], (1 * Math.PI) / 180), o.up));
    const rec = reconstruct3D(o.track, Kwrong, { up: upNoisy });
    const m = barMetrics(heightsFromTrack(rec.frames, upNoisy));
    for (const tr of o.traj.reps) {
      const x = m.reps.find((q) => q.ok && q.tTop > tr.tStart && q.tBottom < tr.tEnd);
      assert.ok(x, `seed ${s}: rep missing`);
      assert.ok(Math.abs(x.distance / tr.D - 1) < 0.01, `seed ${s}: distance ${(100 * (x.distance / tr.D - 1)).toFixed(2)}%`);
    }
  }
});

test('a real plate reads as facing sideways; a blob that is not a vertical circle does not', () => {
  const o = outlines({ seed: 5 });
  const K = intrinsicsFromFov(1280, 720, 68);
  const e = o.track.find((f) => f.ok).e;
  assert.ok(plateTiltDeg(e, K, o.up) < MAX_TILT_DEG);
  // The same outline turned 35° in the picture is no longer a vertical circle.
  assert.ok(plateTiltDeg({ ...e, phi: e.phi + 0.6, b: e.b * 0.8 }, K, o.up) > MAX_TILT_DEG);
});

test('rep metrics from a height trace: own distance and time, peak, propulsive mean', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.4, D: 0.42 }, { T: 0.9, D: 0.5 }, { T: 1.8, D: 0.48, dip: 0.5 }], origin: [0, 1, 0] });
  for (const fps of [30, 60]) {
    const samples = [];
    for (let t = 0.004; t < traj.duration; t += 1 / fps) samples.push({ t, y: traj.height(t) });
    const m = barMetrics(samples);
    assert.equal(m.reps.filter((x) => x.ok).length, 3);
    m.reps.forEach((x, i) => {
      const tr = traj.reps[i];
      assert.ok(Math.abs(x.distance / tr.D - 1) < 0.01, `fps ${fps} rep ${i + 1}: distance`);
      // The lift is timed from leaving the bottom to stopping at the top (the slow ends added back, tailK):
      // measured −2.9% (a 0.4 s rep at 30 fps: 12 frames) and within ±1.3% otherwise, on exact data.
      assert.ok(Math.abs(x.mcv / tr.mcv - 1) < 0.035, `fps ${fps} rep ${i + 1}: MCV ${(100 * (x.mcv / tr.mcv - 1)).toFixed(2)}%`);
      assert.ok(Math.abs(x.pv / tr.pv - 1) < 0.02, `fps ${fps} rep ${i + 1}: PV ${(100 * (x.pv / tr.pv - 1)).toFixed(2)}%`);
      assert.ok(Math.abs(x.mpv / tr.mpv - 1) < 0.05, `fps ${fps} rep ${i + 1}: MPV ${(100 * (x.mpv / tr.mpv - 1)).toFixed(2)}% (truth ${tr.mpv.toFixed(3)})`);
    });
  }
  // The fast rep decelerates faster than gravity at the top, so its propulsive mean is above its mean.
  assert.ok(traj.reps[0].mpv > traj.reps[0].mcv * 1.02);
});

test('a lift the camera lost part of gets no numbers', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.8, D: 0.5 }, { T: 0.9, D: 0.5 }], origin: [0, 1, 0] });
  const r2 = traj.reps[1];
  const samples = [];
  for (let t = 0; t < traj.duration; t += 1 / 30) {
    const lostMid = t > r2.tStart + 0.2 && t < r2.tStart + 0.2 + MAX_GAP + 0.05; // mid-lift gap
    samples.push({ t, y: lostMid ? NaN : traj.height(t) });
  }
  const m = barMetrics(samples);
  const rep2 = m.reps.find((x) => x.tTop > r2.tStart);
  assert.ok(rep2 && !rep2.ok && /lost|not seen/.test(rep2.why), JSON.stringify(rep2));
  assert.ok(m.reps[0].ok);
  // The plate leaving the picture at the top: the lift seems to end where the data stops — refused.
  const cut = [];
  for (let t = 0; t < traj.duration; t += 1 / 30) cut.push({ t, y: traj.height(t) > -0.08 && t > traj.reps[0].tStart ? NaN : traj.height(t) });
  for (const x of barMetrics(cut).reps) assert.ok(!x.ok, `scored a part-seen lift: ${JSON.stringify(x)}`);
});

// Measured over seeds 8–15: the fastest rep (0.7 s) reads −1.7 to −8% at this frame rate (fewer samples → more
// smoothing), the others within ±3%. Every rep is found, and every one is marked an estimate (under 24 frames a
// second through the lift).
test('a busy phone that skips frames (12–20 processed a second, irregularly) still gets every rep, marked as estimates, within 8%', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.7, D: 0.5 }, { T: 1.0, D: 0.48 }, { T: 1.6, D: 0.47, dip: 0.4 }], origin: [0, 1, 0] });
  for (let seed = 8; seed <= 15; seed++) {
    const r = rng(seed), samples = [];
    for (let t = 0; t < traj.duration; t += (1 / 30) * (1 + Math.floor(r() * 2.5))) samples.push({ t, y: traj.height(t) + 0.0007 * (r() - 0.5) });
    const m = barMetrics(samples);
    assert.equal(m.reps.filter((x) => x.ok).length, 3, `seed ${seed}: ${JSON.stringify(m.reps.map((x) => x.why || 'ok'))}`);
    m.reps.forEach((x, i) => {
      assert.ok(x.estimate, `seed ${seed} rep ${i + 1}: not marked as an estimate`);
      assert.ok(Math.abs(x.mcv / traj.reps[i].mcv - 1) < 0.08, `seed ${seed} rep ${i + 1}: MCV ${(100 * (x.mcv / traj.reps[i].mcv - 1)).toFixed(2)}%`);
    });
  }
});

test('bottoms and tops: lifts under the minimum rise are ignored, pauses are not lifts', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.9, D: 0.5 }], pauseBottom: 1.0, origin: [0, 1, 0] });
  const samples = [];
  for (let t = 0; t < traj.duration; t += 1 / 30) samples.push({ t, y: traj.height(t) + (t > 0.2 && t < 0.4 ? 0.05 : 0) });
  const lifts = findLifts(samples.map((s) => ({ ...s, v: 0 })), { minRom: 0.12 });
  assert.equal(lifts.length, 1);
  const pk = peakVelocity(samples.map((s, i) => ({ t: s.t, v: Math.sin((i / samples.length) * Math.PI) })), 0, 100);
  assert.ok(Math.abs(pk.pv - 1) < 0.01);
});

// Review findings (2026-10-21): a lift is timed by how far the bar still has to go, not by a later burst of speed.
test('rests and bad frames never stretch a lift; a full stop short of the top stays one lift; MPV = MCV without braking', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.8, D: 0.5 }, { T: 1.0, D: 0.5 }], pauseTop: 1.2, pauseBottom: 0.8, origin: [0, 1, 0] });
  const [r1, r2] = traj.reps;
  const film = (fps, y) => { const s = []; for (let t = 0.004; t < traj.duration; t += 1 / fps) s.push({ t, y: y(t) }); return s; };
  const lift = (m, tr) => m.reps.find((x) => x.ok && x.tTop > tr.tStart && x.tBottom < tr.tEnd);
  for (const fps of [30, 60]) {
    // One frame 6 cm off, 0.3 s after rep 1 locks out (a bad outline).
    let hit = false;
    const glitch = film(fps, (t) => traj.height(t) + (!hit && t > r1.tEnd + 0.3 && (hit = true) ? 0.06 : 0));
    const g = lift(barMetrics(glitch), r1);
    assert.ok(g && Math.abs(g.mcv / r1.mcv - 1) < 0.03, `${fps} fps glitch: MCV ${g && (100 * (g.mcv / r1.mcv - 1)).toFixed(1)}%`);
    // A rest at lockout, then a 1.5 cm settle over 0.1 s: the lift ends at the lockout, and says it's an estimate.
    const settle = film(fps, (t) => traj.height(t) + (t > r1.tEnd + 0.4 && t < r2.tStart - 1 ? 0.015 * Math.min(1, (t - r1.tEnd - 0.4) / 0.1) : 0));
    const st = lift(barMetrics(settle), r1);
    assert.ok(st && Math.abs(st.mcv / r1.mcv - 1) < 0.05 && st.estimate, `${fps} fps settle: ${st && `MCV ${(100 * (st.mcv / r1.mcv - 1)).toFixed(1)}%, estimate '${st.estimate}'`}`);
    // Never braking harder than gravity (a 1 s rep): MPV is MCV.
    const plain = lift(barMetrics(film(fps, (t) => traj.height(t))), r2);
    assert.ok(Math.abs(plain.mpv - plain.mcv) < 1e-9, `${fps} fps: MPV ${plain.mpv} vs MCV ${plain.mcv}`);
  }
  // A grinder: drives to 90% of the lift in 1.4 s, stops dead for 0.6 s, finishes the last 5 cm in 1 s — one lift of 3 s.
  const D = 0.5, ease = (u) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2, t0 = 2;
  const y = (t) => (t < t0 ? -D : t < t0 + 1.4 ? -D + 0.9 * D * ease((t - t0) / 1.4) : t < t0 + 2 ? -0.1 * D : -0.1 * D + 0.1 * D * ease((t - t0 - 2) / 1));
  for (const fps of [30, 60]) {
    const s = []; for (let t = 0; t < t0 + 4.5; t += 1 / fps) s.push({ t, y: y(t) });
    const m = barMetrics(s), L = m.reps.find((x) => x.ok);
    assert.ok(L && Math.abs(L.mcv / (D / 3) - 1) < 0.05, `${fps} fps grinder: ${L ? `MCV ${L.mcv.toFixed(3)} vs ${(D / 3).toFixed(3)}, T ${L.T.toFixed(2)}` : JSON.stringify(m.reps)}`);
  }
});
