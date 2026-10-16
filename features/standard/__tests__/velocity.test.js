import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concentricVelocity, estimateRir, setVerdict, compareToLast, metresPerUnit, lossBand, quantile, BODY } from '../services/velocity.js';
import { createHeightTracker } from '../services/repEngine.js';

// One rep at 30 fps: pause at the bottom, lift `range` over `secs` with a
// smooth (cosine) speed curve, pause at the top. Returns samples and the
// true mean velocity of the moving part.
function lift({ range = 0.5, secs = 1, pause = 0.5, fps = 30, noise = 0, seed = 5, y0 = 0 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = []; let t = 0;
  const push = (y) => { out.push({ t, y: y + noise * rnd() }); t += 1 / fps; };
  for (let i = 0; i < pause * fps; i++) push(y0);
  const n = Math.round(secs * fps);
  for (let i = 1; i <= n; i++) push(y0 + range * (1 - Math.cos((Math.PI * i) / n)) / 2);
  for (let i = 0; i < pause * fps; i++) push(y0 + range);
  return { samples: out, truth: range / secs, end: t };
}
const near = (a, b, pct) => Math.abs(a - b) / b <= pct;

test('mean velocity of a clean rep is within 8% of the truth; pauses do not count', () => {
  for (const [range, secs] of [[0.5, 1], [0.45, 0.6], [0.3, 1.8], [0.35, 0.9]]) {
    const { samples, truth, end } = lift({ range, secs });
    const r = concentricVelocity(samples, 0, end);
    assert.ok(near(r.mv, truth, 0.08), `${range} m in ${secs} s: got ${r.mv.toFixed(3)} vs ${truth.toFixed(3)}`);
    assert.ok(Math.abs(r.range - range) < 1e-9);
  }
});

test('camera jitter of ±5 mm keeps the mean velocity within 12%', () => {
  const { samples, truth, end } = lift({ range: 0.5, secs: 1, noise: 0.005 });
  const r = concentricVelocity(samples, 0, end);
  assert.ok(near(r.mv, truth, 0.12), `got ${r.mv.toFixed(3)} vs ${truth}`);
});

test('a long pause at the bottom does not slow the reading', () => {
  const a = concentricVelocity(lift({ pause: 0.3 }).samples, 0, 10).mv;
  const b = concentricVelocity(lift({ pause: 2 }).samples, 0, 10).mv;
  assert.ok(near(a, b, 0.03));
});

test('reps left: fresh set says add weight, a grinding set says hold', () => {
  const add = setVerdict([0.62, 0.61, 0.58, 0.55, 0.5].map((mv) => ({ mv, result: 'counted' })), { lift: 'squat', metres: true });
  assert.equal(add.kind, 'add'); assert.ok(add.rir > 3 && add.rir < 4);
  const keep = setVerdict([0.6, 0.57, 0.52, 0.46, 0.4].map((mv) => ({ mv, result: 'counted' })), { lift: 'squat', metres: true });
  assert.equal(keep.kind, 'keep');
  const hold = setVerdict([0.6, 0.55, 0.48, 0.4, 0.33].map((mv) => ({ mv, result: 'counted' })), { lift: 'squat', metres: true });
  assert.equal(hold.kind, 'hold'); assert.ok(hold.rir < 1);
  assert.ok(Math.abs(hold.loss - 0.45) < 0.01);
});

test('bench uses its own failure speed (0.17 m/s)', () => {
  const mvs = [0.5, 0.49, 0.46, 0.42, 0.38];
  assert.equal(setVerdict(mvs.map((mv) => ({ mv, result: 'counted' })), { lift: 'bench', metres: true }).kind, 'add');
  // (0.38 − 0.17) / max(0.04 trend, 0.05 near-failure drop) = 4.2 reps left
  assert.ok(Math.abs(estimateRir(mvs, { lift: 'bench', metres: true }) - 4.2) < 0.01);
  // The same speeds on a squat (failure at 0.30) leave far fewer reps.
  assert.equal(setVerdict(mvs.map((mv) => ({ mv, result: 'counted' })), { lift: 'squat', metres: true }).kind, 'keep');
});

test('a short rep at the end means hold, whatever the speed; unclear reps are ignored', () => {
  const reps = [0.62, 0.61, 0.6, 0.6].map((mv) => ({ mv, result: 'counted' }));
  reps.push({ mv: 0.59, result: 'short' });
  assert.equal(setVerdict(reps, { lift: 'squat', metres: true }).kind, 'hold');
  assert.equal(setVerdict([{ mv: 0.6, result: 'counted' }, { mv: NaN, result: 'unclear' }], { lift: 'squat', metres: true }).kind, 'none');
});

test('without m/s (curl, or no height) reps left come from slowing down relative to your best', () => {
  const fresh = setVerdict([3, 3, 2.9, 2.85].map((mv) => ({ mv, result: 'counted' })), { lift: 'curl', metres: false });
  assert.equal(fresh.kind, 'add');
  const done = setVerdict([3, 2.8, 2.3, 1.8, 1.55].map((mv) => ({ mv, result: 'counted' })), { lift: 'curl', metres: false });
  assert.equal(done.kind, 'hold');
});

test('compare with the last set at the same weight', () => {
  const history = [
    { at: 1, kg: 100, metres: true, best: 0.55 },
    { at: 3, kg: 100, metres: true, best: 0.58 },
    { at: 4, kg: 110, metres: true, best: 0.45 },
  ];
  const c = compareToLast(history, { kg: 100, best: 0.63, metres: true });
  assert.equal(c.prev.at, 3); assert.ok(Math.abs(c.delta - 0.05) < 1e-9);
  assert.equal(compareToLast(history, { kg: 90, best: 0.6, metres: true }), null);
  assert.equal(compareToLast(history, { kg: 100, best: 0.6, metres: false }), null);
});

test('helpers: units, loss bands, quantile', () => {
  assert.ok(Math.abs(metresPerUnit('curl', { heightM: 1.8 }) - BODY.curlRadius * 1.8) < 1e-12);
  assert.ok(Number.isNaN(metresPerUnit('squat', { heightM: 1.8, scale: 200 })));
  assert.ok(Number.isNaN(metresPerUnit('bench', { heightM: 0, scale: 200, armPx: 300 })));
  assert.equal(lossBand(0.1), 'fresh'); assert.equal(lossBand(0.25), 'work'); assert.equal(lossBand(0.5), 'grind');
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
});

// End to end through the height tracker: a lifter 1.80 m tall squats with the
// bar dropping 0.50 m and rising in 0.80 s. 500 px per metre, portrait video.
test('squat: bar speed in m/s from the pose matches the real speed within 8%', () => {
  const H = 1.8, k = 500, vw = 1000, vh = 2000, ankle = 1900;
  const hipH = 0.49 * H, shH = BODY.shoulderAboveAnkle * H;
  const pose = (drop) => {
    const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const y = (h) => (ankle - h * k) / vh, at = (x, h) => ({ x, y: y(h), visibility: 0.95 });
    const hip = hipH - drop * 0.9, bend = drop / 0.5;
    Object.assign(p, { 11: at(0.46, shH - drop), 12: at(0.54, shH - drop), 23: at(0.47, hip), 24: at(0.53, hip),
      25: at(0.45 - 0.08 * bend, hip / 2), 26: at(0.55 + 0.08 * bend, hip / 2), 27: at(0.46, 0), 28: at(0.54, 0) });
    return p;
  };
  const tr = createHeightTracker('squat');
  for (let i = 0; i < 10; i++) tr.calibrate(pose(0), vw, vh);
  assert.equal(tr.lock(), true);
  const samples = []; let t = 0;
  const frame = (drop) => { samples.push({ t, y: tr.measure(pose(drop), vw, vh).bar }); t += 1 / 30; };
  for (let i = 0; i < 15; i++) frame(0);
  for (let i = 1; i <= 36; i++) frame(0.5 * (1 - Math.cos((Math.PI * i) / 36)) / 2);    // down in 1.2 s
  for (let i = 0; i < 9; i++) frame(0.5);                                               // pause
  for (let i = 1; i <= 24; i++) frame(0.5 * (1 + Math.cos((Math.PI * i) / 24)) / 2);    // up in 0.8 s
  for (let i = 0; i < 15; i++) frame(0);
  const r = concentricVelocity(samples, 1.6, t);
  const mpu = metresPerUnit('squat', { heightM: H, scale: tr.scale, standShoulderPx: tr.standShoulderPx });
  assert.ok(near(r.mv * mpu, 0.5 / 0.8, 0.08), `got ${(r.mv * mpu).toFixed(3)} m/s vs 0.625`);
  assert.ok(Math.abs(r.range * mpu - 0.5) < 0.01, 'bar travel in metres');
});
