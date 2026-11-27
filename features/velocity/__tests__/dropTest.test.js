import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseDrop, fitParabola, G } from '../services/dropTest.js';

// A ball held still, let go from heightM, bouncing (restitution e) or coming to rest, filmed at `fps` with
// frames that don't line up with the release or the floor (phase), pixel noise and a slightly tilted phone.
function filmDrop({ heightM = 1.5, fps = 60, pxPerM = 300, ballD = 0.063, phase = 0.37, noisePx = 0.4, tiltDeg = 3,
  e = 0.6, bounce = true, hold = 0.5, after = 1.2, timeScale = 1, seed = 7, lose = [] } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const tFall = Math.sqrt((2 * heightM) / G), vC = G * tFall;
  const fallen = (t) => {                                  // metres below the release point at time t
    if (t <= hold) return 0;
    const u = t - hold;
    if (u <= tFall) return 0.5 * G * u * u;
    if (!bounce) return heightM;
    const w = u - tFall, up = e * vC * w - 0.5 * G * w * w;  // first bounce, then it lands again
    return up > 0 ? heightM - up : heightM;
  };
  const th = (tiltDeg * Math.PI) / 180, out = [];
  for (let t = phase / fps; t < hold + tFall + after; t += 1 / fps) {
    const d = fallen(t) * pxPerM;
    out.push({ t: t * timeScale, ok: !lose.includes(out.length), cx: 400 + d * Math.sin(th) + noisePx * rnd(), cy: 200 + d * Math.cos(th) + noisePx * rnd(), r: (ballD / 2) * pxPerM + 0.3 * rnd() });
  }
  return { samples: out, tFall, ballD };
}

test('fitParabola recovers an exact parabola', () => {
  const xs = [-2, -1, 0, 1, 2, 3], f = fitParabola(xs, xs.map((x) => 1 + 2 * x + 3 * x * x));
  assert.ok(Math.abs(f.a - 1) < 1e-9 && Math.abs(f.b - 2) < 1e-9 && Math.abs(f.c - 3) < 1e-9 && f.rms < 1e-9);
});

test('a 60 fps drop with a bounce matches gravity within 0.5%', () => {
  for (const phase of [0.05, 0.37, 0.81]) {
    const { samples, tFall, ballD } = filmDrop({ phase });
    const r = analyseDrop(samples, { heightM: 1.5, ballDiameterM: ballD });
    assert.equal(r.ok, true, r.refused);
    assert.equal(r.floorFrom, 'bounce');
    assert.ok(Math.abs(r.speedErrPct) < 0.5, `phase ${phase}: speed error ${r.speedErrPct.toFixed(2)}%`);
    assert.ok(Math.abs(r.tFall - tFall) < 0.004, 'fall time within 4 ms');
    assert.ok(Math.abs(r.gMeas - G) / G < 0.01);
    assert.ok(Math.abs(r.size.errPct) < 3, `size distance ${r.size.errPct.toFixed(2)}%`);
    assert.equal(r.verdict, 'pass');
    assert.deepEqual(r.warnings, []);
  }
});

test('the floor is found from the bounce, not the lowest frame (which can be centimetres off)', () => {
  // Phase chosen so the last frame before the floor is well above it: the lowest-frame time would be ~6% off.
  const { samples } = filmDrop({ phase: 0.9, noisePx: 0 });
  const r = analyseDrop(samples, { heightM: 1.5 });
  assert.equal(r.floorFrom, 'bounce');
  assert.ok(Math.abs(r.speedErrPct) < 0.3, r.speedErrPct);
});

test('a ball that comes to rest on the floor is timed from where it rests', () => {
  const { samples } = filmDrop({ bounce: false });
  const r = analyseDrop(samples, { heightM: 1.5 });
  assert.equal(r.ok, true, r.refused);
  assert.equal(r.floorFrom, 'resting');
  assert.ok(Math.abs(r.speedErrPct) < 0.5, r.speedErrPct);
});

test('30 fps still works, with a note that 60 fps is better', () => {
  const { samples } = filmDrop({ fps: 30 });
  const r = analyseDrop(samples, { heightM: 1.5 });
  assert.equal(r.ok, true, r.refused);
  assert.ok(Math.abs(r.speedErrPct) < 1, r.speedErrPct);
  assert.ok(r.warnings.some((w) => /60 fps/.test(w)));
});

test('a Slo-mo video (plays 4× slow) fails with a reason', () => {
  const { samples } = filmDrop({ timeScale: 4 });
  const r = analyseDrop(samples, { heightM: 1.5 });
  assert.equal(r.verdict, 'fail');
  assert.ok(r.warnings.some((w) => /Slo-mo/.test(w)));
});

test('a wrong drop height shows up as a speed error', () => {
  const { samples } = filmDrop({ heightM: 1.5 });
  const r = analyseDrop(samples, { heightM: 1.4 });  // entered 10 cm short
  assert.notEqual(r.verdict, 'pass');
  assert.ok(r.speedErrPct < -2);
});

test('a few lost frames in the fall are tolerated and reported', () => {
  const { samples } = filmDrop({ lose: [40, 41, 42] });
  const r = analyseDrop(samples, { heightM: 1.5 });
  assert.equal(r.ok, true, r.refused);
  assert.ok(Math.abs(r.speedErrPct) < 0.6, r.speedErrPct);
  assert.ok(r.warnings.some((w) => /lost in 3 frames/.test(w)));
});

test('refuses without a height, without a fall, or with almost no track', () => {
  const { samples } = filmDrop();
  assert.match(analyseDrop(samples, {}).refused, /drop height/);
  assert.match(analyseDrop(samples.slice(0, 5), { heightM: 1.5 }).refused, /hardly seen/);
  const still = samples.map((p) => ({ ...p, cy: 200 }));
  assert.match(analyseDrop(still, { heightM: 1.5 }).refused, /didn’t fall/);
});
