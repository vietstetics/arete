// Lift recognition in the body's own frame (features/standard/services/bodyPlanes.js):
// the same lift is recognised standing, inclined or lying, from synthetic 3D skeletons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyAngles, classifyMovement, countCycles, postureLabel } from '../services/bodyPlanes.js';

const R = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// Body orientations as world (MediaPipe: x right, y down) directions of Up, Left, Forward (chest).
const ORIENT = {
  standing: { U: [0, -1, 0], L: [1, 0, 0], F: [0, 0, -1] },
  lyingBack: { U: [-1, 0, 0], L: [0, 0, 1], F: [0, -1, 0] },   // on a bench, head to the left, chest up
  lyingFront: { U: [-1, 0, 0], L: [0, 0, -1], F: [0, 1, 0] },  // face down
  incline45: { U: [0, -Math.SQRT1_2, Math.SQRT1_2], L: [1, 0, 0], F: [0, -Math.SQRT1_2, -Math.SQRT1_2] },
};

/** One skeleton. Angles in degrees: arm elev/plane (both arms), elbow, hip, knee. */
function skeleton(o, { elev = 5, plane = 0, elbow = 178, hip = 178, knee = 178 } = {}) {
  const at = (u, l, f) => add(add(mul(o.U, u), mul(o.L, l)), mul(o.F, f));
  const pts = Array.from({ length: 33 }, () => [0, 0, 0]);
  for (const [s, sign] of [['L', 1], ['R', -1]]) {
    const [S, E, W, H, K, A] = s === 'L' ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28];
    pts[H] = at(0, 0.1 * sign, 0);
    pts[S] = at(0.5, 0.18 * sign, 0);
    const e = elev * R, p = plane * R;
    const arm = [-Math.cos(e), Math.sin(e) * Math.sin(p) * sign, Math.sin(e) * Math.cos(p)]; // (u, l, f)
    pts[E] = add(pts[S], at(...mul(arm, 0.3)));
    // forearm bends forward/up from the upper arm in the arm's own plane (towards the chest's front)
    const b = (180 - elbow) * R;
    const perp = elev < 60 ? [Math.sin(e), 0, Math.cos(e)] : [Math.sin(e), 0, -Math.cos(e)].map((v, i) => (i === 0 ? Math.cos(e) * 0 + Math.sin(e) : v));
    const fore = add(mul(arm, Math.cos(b)), mul(perp, Math.sin(b)));
    pts[W] = add(pts[E], at(...mul(fore, 0.28)));
    const fh = (180 - hip) * R, fk = (180 - knee) * R;
    pts[K] = add(pts[H], at(-0.45 * Math.cos(fh), 0, 0.45 * Math.sin(fh)));
    pts[A] = add(pts[K], at(-0.45 * Math.cos(fh - fk), 0, 0.45 * Math.sin(fh - fk)));
  }
  pts[0] = at(0.75, 0, 0.08);
  const world = pts.map(([x, y, z]) => ({ x, y, z, visibility: 0.99 }));
  const pose = pts.map(([x, y]) => ({ x: 0.5 + x * 0.4, y: 0.5 + y * 0.4, z: 0, visibility: 0.99 }));
  return { pose, world };
}

/** A clip: n reps of `from` → `to` → `from`, 30 frames each, after a short hold. */
function clip(o, from, to, n = 5, { world = true, noise = 0 } = {}) {
  const frames = [];
  const lerp = (k) => Object.fromEntries(Object.keys(from).map((key) => [key, from[key] + (to[key] - from[key]) * k + (noise ? (Math.sin(frames.length * 7.3 + key.length) * noise) : 0)]));
  for (let i = 0; i < 10; i++) frames.push(lerp(0));
  for (let r = 0; r < n; r++) for (let i = 0; i < 30; i++) frames.push(lerp((1 - Math.cos((2 * Math.PI * i) / 30)) / 2));
  for (let i = 0; i < 10; i++) frames.push(lerp(0));
  return frames.map((a) => { const s = skeleton(o, a); return bodyAngles(s.pose, world ? s.world : null); });
}

test('a front raise standing and a cable front raise lying on your back are the same lift', () => {
  const stand = classifyMovement(clip(ORIENT.standing, { elev: 8, plane: 0 }, { elev: 92, plane: 0 }));
  const lie = classifyMovement(clip(ORIENT.lyingBack, { elev: 8, plane: 0 }, { elev: 92, plane: 0 }));
  assert.equal(stand.family, 'front-raise'); assert.equal(lie.family, 'front-raise');
  assert.equal(stand.reps, 5); assert.equal(lie.reps, 5);
  assert.equal(stand.posture, 'Upright (standing or seated)');
  assert.equal(lie.posture, 'Lying on your back');
  assert.match(stand.plane, /Sagittal/);
});

test('a lateral raise is told from a front raise in any posture (3D)', () => {
  for (const o of ['standing', 'incline45', 'lyingFront']) {
    const r = classifyMovement(clip(ORIENT[o], { elev: 8, plane: 88 }, { elev: 88, plane: 88 }));
    assert.equal(r.family, 'lateral-raise', o);
    assert.equal(r.reps, 5, o);
  }
  assert.equal(classifyMovement(clip(ORIENT.incline45, { elev: 8, plane: 0 }, { elev: 88, plane: 0 })).posture, 'Inclined');
  assert.equal(classifyMovement(clip(ORIENT.lyingFront, { elev: 8, plane: 88 }, { elev: 88, plane: 88 })).posture, 'Lying face down');
});

test('between front and side is a scaption raise; a 2D-only clip says the plane can’t be told', () => {
  assert.equal(classifyMovement(clip(ORIENT.standing, { elev: 8, plane: 45 }, { elev: 90, plane: 45 })).family, 'scaption-raise');
  const flat = classifyMovement(clip(ORIENT.standing, { elev: 8, plane: 0 }, { elev: 92, plane: 0 }, 5, { world: false }));
  assert.equal(flat.family, 'raise');
  assert.equal(flat.plane, 'Unknown');
  assert.equal(flat.reps, 5);
});

test('fly, pullover, curl, triceps, presses, squat, hinge and knee isolation', () => {
  const S = ORIENT.standing, B = ORIENT.lyingBack;
  assert.equal(classifyMovement(clip(S, { elev: 88, plane: 0 }, { elev: 88, plane: 90 })).family, 'fly');
  assert.equal(classifyMovement(clip(B, { elev: 175, plane: 0 }, { elev: 90, plane: 0 })).family, 'pullover');
  const curl = classifyMovement(clip(S, { elbow: 175 }, { elbow: 40 }, 6));
  assert.equal(curl.family, 'curl'); assert.equal(curl.reps, 6);
  assert.equal(classifyMovement(clip(S, { elev: 170, elbow: 60 }, { elev: 170, elbow: 175 })).family, 'triceps-extension');
  assert.equal(classifyMovement(clip(B, { elev: 80, plane: 60, elbow: 80 }, { elev: 88, plane: 30, elbow: 175 })).family, 'horizontal-push-pull');
  assert.equal(classifyMovement(clip(S, { elev: 95, plane: 60, elbow: 70 }, { elev: 170, plane: 20, elbow: 175 })).family, 'vertical-push-pull');
  assert.equal(classifyMovement(clip(S, { hip: 175, knee: 175 }, { hip: 80, knee: 75 })).family, 'squat');
  const legPress = classifyMovement(clip(ORIENT.incline45, { hip: 120, knee: 170 }, { hip: 60, knee: 80 }));
  assert.equal(legPress.family, 'squat'); assert.equal(legPress.posture, 'Inclined');
  assert.equal(classifyMovement(clip(S, { hip: 175, knee: 165 }, { hip: 95, knee: 160 })).family, 'hinge');
  assert.equal(classifyMovement(clip(S, { hip: 90, knee: 90 }, { hip: 90, knee: 175 })).family, 'knee-isolation');
});

test('noise, standing still and a body out of view', () => {
  assert.equal(classifyMovement(clip(ORIENT.standing, { elev: 8, plane: 0 }, { elev: 92, plane: 0 }, 4, { noise: 3 })).reps, 4);
  assert.equal(classifyMovement(clip(ORIENT.standing, { elev: 8 }, { elev: 12 })).family, 'unclear');
  assert.equal(classifyMovement([null, null, null, null, null, null, null, null, null, null, null]).family, 'unclear');
  assert.equal(countCycles([0, 0, 10, 0, 10, 0, 10, 0]), 3);
  assert.equal(postureLabel({ tilt: 10, chestUp: true }), 'Upright (standing or seated)');
});
