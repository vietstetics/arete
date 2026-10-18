import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armExtension, createRepCounter, createStillGate, oneEuro, REACH_DEFAULTS } from '../services/repEngine.js';

// A rower in 3D (metres, MediaPipe-style world coordinates: origin at the
// hips, y down, z towards the camera). Upper arm 0.32 m, forearm 0.28 m.
// `ext` = shoulder→wrist distance as a share of the whole arm (0.95 hanging
// long, ~0.35 pulled in). The hands reach forward and a little down.
const UA = 0.32, FA = 0.28, ARM = UA + FA;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
function rower(ext, { jitter = 0, r = () => 0.5 } = {}) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const dir = norm([0.05, 0.25, -0.95]), d = ext * ARM;
  for (const [s, e, wr, side] of [[11, 13, 15, -1], [12, 14, 16, 1]]) {
    const S = [side * 0.18, -0.45, 0], W = S.map((c, i) => c + dir[i] * d);
    const a = (UA * UA - FA * FA + d * d) / (2 * d), h = Math.sqrt(Math.max(0, UA * UA - a * a));
    let perp = [side, -0.3, 0]; const k = perp.reduce((s2, c, i) => s2 + c * dir[i], 0); perp = norm(perp.map((c, i) => c - k * dir[i]));
    const E = S.map((c, i) => c + dir[i] * a + perp[i] * h);
    const j = () => (r() - 0.5) * 2 * jitter;
    w[s] = { x: S[0] + j(), y: S[1] + j(), z: S[2] + j() }; w[e] = { x: E[0] + j(), y: E[1] + j(), z: E[2] + j() }; w[wr] = { x: W[0] + j(), y: W[1] + j(), z: W[2] + j() };
  }
  w[23] = { x: -0.1, y: 0, z: 0 }; w[24] = { x: 0.1, y: 0, z: 0 };
  return w;
}
// What the camera sees: the 3D pose turned by `yawDeg` and flattened.
function picture(world, yawDeg, vis = 0.9) {
  const th = (yawDeg * Math.PI) / 180;
  return world.map((P) => ({ x: 0.5 + 0.5 * (P.x * Math.cos(th) + P.z * Math.sin(th)), y: 0.55 + 0.5 * P.y, visibility: vis }));
}

test('3D arm extension: 1 for a straight arm, the true share when bent', () => {
  for (const ext of [0.95, 0.7, 0.35]) {
    const w = rower(ext), res = armExtension(picture(w, 0), w);
    assert.equal(res.threeD, true); assert.equal(res.sides, 2);
    assert.ok(Math.abs(res.ratio - ext) < 1e-9, `${ext} → ${res.ratio}`);
  }
});

test('the same pull reads the same from the side, the front-side angle in the photos, or head-on', () => {
  for (const yaw of [0, 30, 55, 80, 90]) {
    const a = armExtension(picture(rower(0.95), yaw), rower(0.95)).ratio, b = armExtension(picture(rower(0.35), yaw), rower(0.35)).ratio;
    assert.ok(Math.abs(a - 0.95) < 1e-9 && Math.abs(b - 0.35) < 1e-9, `yaw ${yaw}: ${a} ${b}`);
  }
});

test('the old 2D hand-height measure barely moves at the photos’ angle; 3D extension moves the full range', () => {
  const p1 = picture(rower(0.95), 55), p2 = picture(rower(0.35), 55);
  const handRise = Math.abs(p1[15].y - p2[15].y), armLen2D = Math.hypot(p1[11].x - p1[15].x, p1[11].y - p1[15].y);
  assert.ok(handRise / armLen2D < 0.4, `2D: the hand rises ${(100 * handRise / armLen2D).toFixed(0)}% of an arm — under the 40% a rep needs`);
  assert.ok(armExtension(p1, rower(0.95)).ratio - armExtension(p2, rower(0.35)).ratio > 0.55);
});

test('an arm the camera can’t see counts less, then not at all; no 3D falls back to the picture', () => {
  const w = rower(0.6), p = picture(w, 55);
  p[12].visibility = p[16].visibility = 0.2;
  assert.equal(armExtension(p, w).sides, 1);
  p[11].visibility = 0.1;
  assert.equal(armExtension(p, w).ok, false);
  const flat = armExtension(picture(rower(0.6), 0), null, { vw: 1, vh: 1 });
  assert.equal(flat.threeD, false); assert.ok(flat.ok && flat.ratio > 0 && flat.ratio <= 1);
});

// A whole set filmed from the photos' angle, 30 fps, with ±1.5 cm of 3D
// jitter: setting up (not counted), then 7 rows — rep 1 is the standard,
// rep 4 only pulls in halfway, rep 6 starts without full extension. Partial
// reps must be judged short, never silently dropped.
function filmedSet(reps) {
  let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const frames = []; let t = 0, e = 0.95;
  const add = (n, f) => { for (let i = 1; i <= n; i++) { frames.push({ t, ext: f(i / n) }); t += 1 / 30; } };
  const hold = (secs) => add(Math.round(secs * 30), () => e);
  const move = (to, secs) => { const e0 = e; add(Math.round(secs * 30), (u) => (e = e0 + (to - e0) * (1 - Math.cos(Math.PI * u)) / 2)); };
  move(0.6, 0.5); move(0.95, 0.5); hold(2.2);
  for (const [top, back] of reps) { move(top, 0.9); hold(0.15); move(back, 1.1); hold(0.2); }
  hold(1);
  const euro = oneEuro(), gate = createStillGate({ secs: 1, bands: [6] }), rc = createRepCounter(REACH_DEFAULTS);
  let armed = false;
  for (const f of frames) {
    const w = rower(f.ext, { jitter: 0.015, r }), x = armExtension(picture(w, 55), w);
    const v = euro.filter(x.ratio * 100, f.t);
    if (!armed) { armed = f.t > 0.9 && gate.push(f.t, [v]); continue; }
    rc.push(f.t, v, x.ok);
  }
  return rc;
}

test('partial rows count as reps and are judged short — never silently dropped', () => {
  const rc = filmedSet([[0.35, 0.95], [0.35, 0.95], [0.66, 0.95], [0.35, 0.74], [0.35, 0.95]]);
  // Rep 4 pulls in fully but only lets out to 74%; each rep's starting reach
  // is checked as it begins, so it's rep 5 that is judged short for it.
  assert.deepEqual(rc.reps.map((x) => x.result), ['counted', 'counted', 'short', 'counted', 'short']);
  assert.equal(rc.reps[2].shortFinish, true, 'rep 3 pulled in only ~30% of the way');
  assert.equal(rc.reps[4].shortStart, true, 'rep 5 began without full extension');
});

test('a set from the front-side angle: every rep registers, short ones are caught', () => {
  let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const frames = []; let t = 0, e = 0.95;
  const add = (n, f) => { for (let i = 1; i <= n; i++) { frames.push({ t, ext: f(i / n) }); t += 1 / 30; } };
  const hold = (secs) => add(Math.round(secs * 30), () => e);
  const move = (to, secs) => { const e0 = e; add(Math.round(secs * 30), (u) => (e = e0 + (to - e0) * (1 - Math.cos(Math.PI * u)) / 2)); };
  move(0.6, 0.5); move(0.95, 0.5); hold(2.2);                              // grabbing the handles, then still
  for (const [top, back] of [[0.35, 0.95], [0.36, 0.95], [0.35, 0.95], [0.55, 0.95], [0.35, 0.78], [0.35, 0.95], [0.36, 0.95]]) { move(top, 0.9); hold(0.15); move(back, 1.1); hold(0.2); }
  hold(1);
  const euro = oneEuro(), gate = createStillGate({ secs: 1, bands: [6] }), rc = createRepCounter();
  let armed = false;
  for (const f of frames) {
    const w = rower(f.ext, { jitter: 0.015, r }), x = armExtension(picture(w, 55), w);
    const v = euro.filter(x.ratio * 100, f.t);
    if (!armed) { armed = f.t > 0.9 && gate.push(f.t, [v]); continue; }
    rc.push(f.t, v, x.ok);
  }
  assert.deepEqual(rc.reps.map((x) => x.result), ['counted', 'counted', 'counted', 'short', 'counted', 'short', 'counted']);
  assert.equal(rc.reps[3].shortFinish, true, 'rep 4: didn’t pull in');
  assert.equal(rc.reps[5].shortStart, true, 'rep 6: started without reaching full extension');
});
