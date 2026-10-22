import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eigSym3, matVec, dot, norm, sub, unit, intrinsicsFromFov, scaleIntrinsics, project, placeCamera, toCamera, dirToCamera,
  upFromAccel, tiltFromUp, distort, undistort, cross,
} from '../services/vision/camera.js';
import {
  ellipseToConic, conicMatToEllipse, coneFromConic, circlePoses, circleConic, circleEllipse, pickByGravity,
  conicDistance, fitCircleCentre, guessCentre, planeBasis,
} from '../services/vision/circle3d.js';
import { rng } from '../demo/synth.js';

const R = 0.225, PLATE = [0, 1.0, 0], BAR = [1, 0, 0], UP = [0, 1, 0];
const K = intrinsicsFromFov(1280, 720, 65);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const vclose = (a, b, tol, msg) => assert.ok(norm(sub(a, b)) <= tol, `${msg}: |${a.map((x) => x.toFixed(5))} − ${b.map((x) => x.toFixed(5))}| > ${tol}`);

test('symmetric 3×3 eigen-decomposition reconstructs the matrix', () => {
  const r = rng(5);
  for (let k = 0; k < 50; k++) {
    const a = r() - 0.5, b = r() - 0.5, c = r() - 0.5, d = r() - 0.5, e = r() - 0.5, f = r() - 0.5;
    const M = [a, d, e, d, b, f, e, f, c];
    const { values, vectors } = eigSym3(M);
    for (let i = 0; i < 3; i++) vclose(matVec(M, vectors[i]), vectors[i].map((x) => x * values[i]), 1e-12, 'Mv = λv');
    close(dot(vectors[0], vectors[1]), 0, 1e-12, 'orthogonal');
  }
});

test('camera placement: side-on level phone sees the plate dead centre, up is −y; tilt and roll read back', () => {
  const pose = placeCamera({ target: PLATE, distance: 2.5 });
  const p = project(K, toCamera(pose, PLATE));
  close(p.x, K.cx, 1e-9, 'x'); close(p.y, K.cy, 1e-9, 'y');
  vclose(dirToCamera(pose, UP), [0, -1, 0], 1e-12, 'up');
  vclose(dirToCamera(pose, BAR), [0, 0, -1], 1e-12, 'plate faces the lens');
  // Rotation is proper (det +1).
  const [x, y, z] = [pose.R.slice(0, 3), pose.R.slice(3, 6), pose.R.slice(6, 9)];
  vclose(cross(x, y), z, 1e-12, 'right-handed');
  for (const [pitch, roll] of [[10, 0], [-15, 5], [20, -8], [0, 12]]) {
    const pz = placeCamera({ target: PLATE, distance: 2.5, pitchDeg: pitch, rollDeg: roll });
    const t = tiltFromUp(dirToCamera(pz, UP));
    close(t.pitchDeg, pitch, 1e-9, 'pitch'); close(t.rollDeg, roll, 1e-9, 'roll');
  }
  // Lens tilted up: the bar end appears lower in the picture.
  assert.ok(project(K, toCamera(placeCamera({ target: PLATE, distance: 2.5, pitchDeg: 10 }), PLATE)).y > K.cy);
  // Aimed from above: the target is back in the centre.
  const aimed = placeCamera({ target: PLATE, distance: 2.5, heightOffset: 0.6, aim: true });
  close(project(K, toCamera(aimed, PLATE)).y, K.cy, 1e-9, 'aimed');
});

test('gravity from the phone sensors: portrait, landscape, tilted, front camera', () => {
  const g = 9.81;
  vclose(upFromAccel({ x: 0, y: g, z: 0 }), [0, -1, 0], 1e-12, 'upright portrait');
  vclose(upFromAccel({ x: g, y: 0, z: 0 }, { screenAngle: 90 }), [0, -1, 0], 1e-12, 'landscape (turned anticlockwise)');
  vclose(upFromAccel({ x: -g, y: 0, z: 0 }, { screenAngle: 270 }), [0, -1, 0], 1e-12, 'landscape (turned clockwise)');
  vclose(upFromAccel({ x: 0, y: -g, z: 0 }, { screenAngle: 180 }), [0, -1, 0], 1e-12, 'upside down');
  // Back of the phone tilted to face upwards by 12°: lens points up, screen leans back towards the floor.
  const th = (12 * Math.PI) / 180, up = upFromAccel({ x: 0, y: g * Math.cos(th), z: -g * Math.sin(th) });
  close(tiltFromUp(up).pitchDeg, 12, 1e-9, 'lens up 12°');
  // Front camera: the lens looks out of the screen, so the same tilt reads the other way.
  close(tiltFromUp(upFromAccel({ x: 0, y: g * Math.cos(th), z: -g * Math.sin(th) }, { facing: 'user' })).pitchDeg, -12, 1e-9, 'front camera');
  // A platform that reports the opposite sign.
  vclose(upFromAccel({ x: 0, y: -g, z: 0 }, { signFlip: true }), [0, -1, 0], 1e-12, 'sign flip');
  // Opposite-sign platform detected automatically for an upright phone, tilt preserved.
  close(tiltFromUp(upFromAccel({ x: 0, y: -g * Math.cos(th), z: g * Math.sin(th) }, { autoSign: true })).pitchDeg, 12, 1e-9, 'auto sign');
  vclose(upFromAccel({ x: 0, y: g, z: 0 }, { autoSign: true }), [0, -1, 0], 1e-12, 'auto sign leaves the standard convention alone');
});

test('lens distortion round trip', () => {
  const dist = { k1: -0.08, k2: 0.02 };
  for (const p of [{ x: 10, y: 10 }, { x: 640, y: 360 }, { x: 1200, y: 700 }]) {
    const q = undistort(K, dist, distort(K, dist, p));
    close(q.x, p.x, 1e-6, 'x'); close(q.y, p.y, 1e-6, 'y');
  }
});

test('ellipse ↔ conic round trip', () => {
  for (const e of [{ cx: 300, cy: 200, a: 80, b: 50, phi: 0.3 }, { cx: 900, cy: 500, a: 120, b: 119, phi: 2.9 }]) {
    const back = conicMatToEllipse(ellipseToConic(e));
    for (const k of ['cx', 'cy', 'a', 'b']) close(back[k], e[k], 1e-6, k);
    close(Math.cos(2 * back.phi), Math.cos(2 * e.phi), 1e-6, 'phi');
  }
});

// Many phone placements: distance, angle round the bar, height, tilt, roll, and the plate anywhere in the picture.
const placements = [];
{
  const r = rng(11);
  for (let i = 0; i < 300; i++) {
    placements.push({
      distance: 1.2 + 3 * r(), yawDeg: -55 + 110 * r(), heightOffset: -0.9 + 1.8 * r(),
      pitchDeg: -20 + 40 * r(), rollDeg: -12 + 24 * r(), panDeg: -18 + 36 * r(), aim: r() < 0.5,
      plate: [0.1 * (r() - 0.5), 0.4 + 1.2 * r(), 0.3 * (r() - 0.5)],
    });
  }
}

test('circle pose from the ellipse recovers the plate centre and facing exactly, for any placement', () => {
  let n = 0;
  for (const pl of placements) {
    const pose = placeCamera({ ...pl, target: [0, 1, 0] });
    const c = toCamera(pose, pl.plate), nn = dirToCamera(pose, BAR);
    if (c[2] < 0.5) continue;
    const e = circleEllipse(K, c, nn, R);
    if (!e) continue;
    // Through the ellipse parameters, as a tracker would measure them.
    const sols = circlePoses(coneFromConic(ellipseToConic(e), K), R);
    assert.ok(sols.length >= 1);
    const best = sols.reduce((b, s) => (norm(sub(s.c, c)) < norm(sub(b.c, c)) ? s : b));
    vclose(best.c, c, 1e-6 * norm(c), 'centre');
    const facing = Math.abs(dot(best.n, nn));
    close(facing, 1, 1e-8, 'normal');
    // Gravity picks the right one whenever the two answers differ by more than rounding.
    const up = dirToCamera(pose, UP);
    const picked = pickByGravity(sols, up);
    vclose(picked.c, c, 1e-6 * norm(c), 'picked by gravity');
    n++;
  }
  assert.ok(n > 250, `${n} placements checked`);
});

test('the ellipse centre is not the plate centre: the perspective shift is real and is corrected', () => {
  const pose = placeCamera({ target: PLATE, distance: 1.5, yawDeg: 40, heightOffset: 0.8, pitchDeg: -10, panDeg: 15 });
  const c = toCamera(pose, PLATE), nn = dirToCamera(pose, BAR), e = circleEllipse(K, c, nn, R), p = project(K, c);
  const shift = Math.hypot(e.cx - p.x, e.cy - p.y);
  assert.ok(shift > 0.5, `shift ${shift.toFixed(2)} px`);
  const sol = pickByGravity(circlePoses(coneFromConic(ellipseToConic(e), K), R), dirToCamera(pose, UP));
  const q = project(K, sol.c);
  close(q.x, p.x, 1e-6, 'x'); close(q.y, p.y, 1e-6, 'y');
});

test('Sampson distance is the distance in pixels near the rim', () => {
  const e = { cx: 400, cy: 300, a: 100, b: 60, phi: 0.4 }, C = ellipseToConic(e);
  const ux = Math.cos(e.phi), uy = Math.sin(e.phi);
  close(conicDistance(C, e.cx + 102 * ux, e.cy + 102 * uy), 2, 0.05, 'outside on the major axis');
  close(conicDistance(C, e.cx - 97 * ux, e.cy - 97 * uy), -3, 0.1, 'inside on the major axis');
});

test('3D centre fit from noisy rim edges with outliers: height to ~1 mm, depth to a few mm', () => {
  const r = rng(3);
  let worst = 0, worstUp = 0;
  for (const pl of placements.slice(0, 60)) {
    const pose = placeCamera({ ...pl, target: [0, 1, 0] });
    const c = toCamera(pose, pl.plate), nn = dirToCamera(pose, BAR);
    if (c[2] < 0.5) continue;
    const [u, v] = planeBasis(nn), pts = [];
    for (let k = 0; k < 72; k++) {
      const al = (2 * Math.PI * k) / 72, X = [0, 1, 2].map((i) => c[i] + R * (Math.cos(al) * u[i] + Math.sin(al) * v[i]));
      const p = project(K, X);
      if (k % 9 === 4) pts.push({ x: p.x + 25 * (r() - 0.5), y: p.y + 25 * (r() - 0.5) }); // a hand over the rim
      else pts.push({ x: p.x + 0.6 * (r() - 0.5), y: p.y + 0.6 * (r() - 0.5) });          // ±0.3 px edge noise
    }
    const e = circleEllipse(K, c, nn, R);
    const c0 = guessCentre(K, { ...e, cx: e.cx + 4, cy: e.cy - 3 }, R);
    const fit = fitCircleCentre(K, nn, R, pts, c0);
    assert.ok(fit.ok, 'fit');
    worst = Math.max(worst, norm(sub(fit.c, c)));
    worstUp = Math.max(worstUp, Math.abs(dot(sub(fit.c, c), dirToCamera(pose, UP))));
  }
  // Depth is the weak direction (it comes from the plate's size), and it barely moves the height reading.
  assert.ok(worstUp < 0.0015, `worst height error ${(worstUp * 1000).toFixed(2)} mm`);
  assert.ok(worst < 0.006, `worst centre error ${(worst * 1000).toFixed(2)} mm`);
});

test('a downscaled copy of the frame keeps the same geometry', () => {
  const k2 = scaleIntrinsics(K, 640, 360), X = [0.2, -0.1, 2.4], p = project(K, X), q = project(k2, X);
  close((q.x + 0.5) * 2 - 0.5, p.x, 1e-9, 'x'); close((q.y + 0.5) * 2 - 0.5, p.y, 1e-9, 'y');
});
