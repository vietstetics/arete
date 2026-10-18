import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitEllipse, robustEllipse, radiusAt } from '../services/vision/ellipse.js';
import { viewFromEllipses, gravityFromRoll, MAX_OFF_AXIS_DEG } from '../services/vision/geometry.js';
import { refineEllipse, detectPlates, lkTranslate, createPlateTracker } from '../services/vision/plate.js';
import { background, frame, rng } from '../demo/synth.js';

const deg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };

function ellipsePoints({ cx, cy, a, b, phi }, { n = 72, cover = 1, noise = 0, seed = 5 } = {}) {
  const r = rng(seed), pts = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k * cover) / n, x = a * Math.cos(t), y = b * Math.sin(t);
    pts.push({ x: cx + x * Math.cos(phi) - y * Math.sin(phi) + noise * (r() - 0.5) * 2, y: cy + x * Math.sin(phi) + y * Math.cos(phi) + noise * (r() - 0.5) * 2 });
  }
  return pts;
}

// ── Ellipse maths ────────────────────────────────────────────────────────
test('ellipse fit recovers centre, axes and angle, also from part of the rim and with stray points', () => {
  for (const e of [{ cx: 200, cy: 150, a: 60, b: 60, phi: 0 }, { cx: 90, cy: 300, a: 60, b: 52, phi: Math.PI / 2 }, { cx: 200, cy: 150, a: 80, b: 50, phi: 0.6 }]) {
    for (const cover of [1, 0.7]) {
      const pts = ellipsePoints(e, { cover, noise: 0.5 });
      const r = rng(17);
      for (let k = 0; k < 6; k++) pts.push({ x: e.cx + (r() - 0.5) * 40, y: e.cy + (r() - 0.5) * 40 });
      const f = robustEllipse(pts);
      assert.ok(Math.hypot(f.cx - e.cx, f.cy - e.cy) < 0.8, `centre ${f.cx},${f.cy}`);
      assert.ok(Math.abs(f.a - e.a) / e.a < 0.01 && Math.abs(f.b - e.b) / e.b < 0.01, `axes ${f.a} ${f.b}`);
      if (e.a / e.b > 1.1) assert.ok(deg(angDiff(f.phi, e.phi)) < 2, `angle ${deg(f.phi)}`);
    }
  }
  assert.equal(fitEllipse(ellipsePoints({ cx: 0, cy: 0, a: 5, b: 5, phi: 0 }).slice(0, 5)), null, 'needs 6 points');
});

test('radius along a direction', () => {
  const e = { cx: 0, cy: 0, a: 10, b: 5, phi: 0 };
  assert.ok(Math.abs(radiusAt(e, 0) - 10) < 1e-9 && Math.abs(radiusAt(e, Math.PI / 2) - 5) < 1e-9);
});

// ── Scale and angle correction ───────────────────────────────────────────
// A 45 cm plate, a = 60 px. Movement in the plate's plane (up U, along A, in
// metres) as the camera would see it after turning by yaw or tilting by pitch.
const R = 0.225, A_PX = 60, k = A_PX / R;
test('scale comes from the plate: 45 cm ↔ its long axis', () => {
  const v = viewFromEllipses([{ a: 60, b: 60, phi: 0 }]);
  assert.ok(Math.abs(v.mPerPx - 0.45 / 120) < 1e-12);
  assert.equal(v.offAxisDeg, 0);
});

test('viewing angle from the ellipse; over 25° off side-on is refused', () => {
  for (const th of [0, 10, 15, 24, 26, 35]) {
    const v = viewFromEllipses([{ a: 60, b: 60 * Math.cos((th * Math.PI) / 180), phi: Math.PI / 2 }]);
    assert.ok(Math.abs(v.offAxisDeg - th) < 1e-6);
    assert.equal(v.ok, th <= MAX_OFF_AXIS_DEG);
  }
});

test('angle correction: turned or tilted cameras still measure true height and travel', () => {
  for (const th of [0, 15, 24]) {
    const c = Math.cos((th * Math.PI) / 180);
    // Turned sideways (yaw): the plate's horizontal axis shrinks.
    const yaw = viewFromEllipses([{ a: A_PX, b: A_PX * c, phi: Math.PI / 2 }]);
    const p = yaw.toPlane(0.12 * k * c, -0.5 * k);
    assert.ok(Math.abs(p.up - 0.5) < 1e-9 && Math.abs(Math.abs(p.along) - 0.12) < 1e-9, `yaw ${th}: ${p.up} ${p.along}`);
    // Tilted up / down (pitch): the vertical axis shrinks.
    const pitch = viewFromEllipses([{ a: A_PX, b: A_PX * c, phi: 0 }]);
    const q = pitch.toPlane(0.12 * k, -0.5 * k * c);
    assert.ok(Math.abs(q.up - 0.5) < 1e-9, `pitch ${th}: ${q.up}`);
  }
  // Phone rolled 10°: gravity tells which way is up.
  const roll = 10, g = gravityFromRoll(roll), v = viewFromEllipses([{ a: A_PX, b: A_PX, phi: 0 }], { gravity: g });
  const up = v.toPlane(-0.5 * k * g.x, -0.5 * k * g.y).up;
  assert.ok(Math.abs(up - 0.5) < 1e-9);
});

test('without a diameter there is no metric scale', () => {
  const v = viewFromEllipses([{ a: 60, b: 60, phi: 0 }], { diameterM: 0 });
  assert.equal(v.scaled, false);
  assert.ok(Math.abs(v.toPlane(0, -60).up - 1) < 1e-9, 'distances in plate radii');
});

// ── Finding and following the plate in frames ────────────────────────────
const W = 288, H = 512, BG = background(W, H, 3);
const plateAt = (cy, yawDeg = 15, cx = 144) => ({ cx, cy, a: 48, b: 48 * Math.cos((yawDeg * Math.PI) / 180), phi: Math.PI / 2 });

test('rim fit finds the plate edge from a rough guess', () => {
  const p = plateAt(300), img = frame(BG, W, H, p, { r: rng(2) });
  const e = refineEllipse(img, { cx: p.cx + 6, cy: p.cy - 5, r: p.a * 1.15 }, { range: [0.7, 1.3] });
  const e2 = refineEllipse(img, e);
  assert.equal(e2.ok, true);
  assert.ok(Math.hypot(e2.cx - p.cx, e2.cy - p.cy) < 0.5, `centre off by ${Math.hypot(e2.cx - p.cx, e2.cy - p.cy)}`);
  assert.ok(Math.abs(e2.a - p.a) / p.a < 0.03 && Math.abs(e2.b - p.b) / p.b < 0.03, `axes ${e2.a} ${e2.b}`);
});

test('detection: the plate by the lifter wins over a plate leaning on the wall', () => {
  const p = plateAt(300), img = frame(BG, W, H, p, { r: rng(4) });
  const c = detectPlates(img, { rMin: 20, rMax: 90, prior: { x: 150, y: 290 } });
  assert.ok(c.length >= 1);
  assert.ok(Math.hypot(c[0].cx - p.cx, c[0].cy - p.cy) < 1.5, `found ${c[0].cx},${c[0].cy}`);
  assert.ok(Math.abs(c[0].a - p.a) / p.a < 0.05);
});

test('optical flow recovers a known shift of the plate', () => {
  const p = plateAt(300), a = frame(BG, W, H, p, { r: rng(5), noise: 3 }), b = frame(BG, W, H, { ...p, cx: p.cx + 7.3, cy: p.cy - 11.6 }, { r: rng(6), noise: 3 });
  const f = lkTranslate(a, b, p, { dx: 0, dy: 0 });
  assert.equal(f.ok, true);
  assert.ok(Math.abs(f.dx - 7.3) < 0.3 && Math.abs(f.dy + 11.6) < 0.3, `flow ${f.dx},${f.dy}`);
});

test('tracker follows a moving plate to a fraction of a pixel and reports lost frames instead of guessing', () => {
  const tr = createPlateTracker(), r = rng(8), start = plateAt(340);
  tr.init(frame(BG, W, H, start, { r }), refineEllipse(frame(BG, W, H, start, { r }), { cx: 144, cy: 340, r: 50 }), 0);
  const errs = []; let lostWhileHidden = 0, okAfter = 0;
  for (let i = 1; i <= 150; i++) {
    const t = i / 60, u = Math.min(1, Math.max(0, (t - 0.3) / 1)), cy = 340 - 140 * (1 - Math.cos(Math.PI * u)) / 2;
    const hidden = i >= 100 && i < 112; // something walks in front of it for 0.2 s
    const res = tr.track(frame(BG, W, H, hidden ? null : plateAt(cy), { r, gain: 1 + 0.08 * Math.sin(i / 15) }), t);
    if (hidden) { if (!res.ok) lostWhileHidden++; continue; }
    if (i >= 112) { if (res.ok) okAfter++; }
    if (res.ok) errs.push(Math.hypot(res.cx - 144, res.cy - cy));
  }
  assert.equal(lostWhileHidden, 12, 'every hidden frame is reported lost');
  assert.ok(okAfter >= 36, `picked the plate up again (${okAfter}/39)`);
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  assert.ok(mean < 0.3 && Math.max(...errs) < 1, `error mean ${mean.toFixed(3)} max ${Math.max(...errs).toFixed(3)} px`);
});

// Real gyms have edges that touch the rim (a rack crossbar, a shelf). Here the
// plate starts sitting on a dark shelf line: the centre stays within 2.5 px,
// and the plate's size — which sets the scale — still comes out within 2%.
test('a high-contrast edge touching the rim costs little, and the scale stays right', () => {
  const tr = createPlateTracker(), r = rng(8), start = plateAt(380);
  const f0 = frame(BG, W, H, start, { r });
  tr.init(f0, refineEllipse(f0, { cx: 144, cy: 380, r: 50 }), 0);
  const errs = [], shapes = [];
  for (let i = 1; i <= 150; i++) {
    const t = i / 60, u = Math.min(1, Math.max(0, (t - 0.3) / 1)), cy = 380 - 140 * (1 - Math.cos(Math.PI * u)) / 2;
    const res = tr.track(frame(BG, W, H, plateAt(cy), { r }), t);
    assert.equal(res.ok, true);
    errs.push(Math.hypot(res.cx - 144, res.cy - cy));
    if (res.shape) shapes.push(res.shape.a);
  }
  assert.ok(Math.max(...errs) < 2.5, `worst ${Math.max(...errs).toFixed(2)} px`);
  const a = shapes.sort((x, y) => x - y)[shapes.length >> 1];
  assert.ok(Math.abs(a - 48) / 48 < 0.02, `plate size ${a.toFixed(2)} px vs 48`);
});
