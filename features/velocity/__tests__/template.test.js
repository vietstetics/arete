import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateTracker } from '../services/vision/template.js';

const initial = { x: 64, y: 56, w: 32, h: 28 };
const patch = (x, y) => 95 + 38 * Math.sin(x * 0.37 + y * 0.17) + 31 * Math.cos(y * 0.53 - x * 0.11)
  + (x > 6 && x < 12 && y > 4 && y < 19 ? 70 : 0) + (x > 21 && y > 16 ? -55 : 0);
function frame(dx = 0, dy = 0, { w = 192, h = 160, hidden = false, gain = 1, bias = 0, duplicate = null, seed = 7 } = {}) {
  let random = seed;
  const data = Float32Array.from({ length: w * h }, () => { random = random * 16807 % 2147483647; return 38 + random / 2147483647 * 20; });
  const paint = (x0, y0) => {
    for (let y = 0; y < initial.h; y++) for (let x = 0; x < initial.w; x++) {
      const xx = x0 + x, yy = y0 + y;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) data[yy * w + xx] = gain * patch(x, y) + bias;
    }
  };
  if (!hidden) paint(initial.x + dx, initial.y + dy);
  if (duplicate) paint(duplicate.x, duplicate.y);
  return { w, h, data };
}
const close = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

test('manual template follows measured translations at uneven timestamps without drifting its anchor', () => {
  const tracker = createTemplateTracker();
  assert.equal(tracker.init(frame(), initial, 0).ok, true);
  for (const [dx, dy, t] of [[5, -3, 0.025], [10, -10, 0.073], [18, -18, 0.11], [26, -25, 0.16], [35, -34, 0.22]]) {
    const r = tracker.track(frame(dx, dy), t);
    assert.equal(r.ok, true, r.reason);
    close(r.cx, initial.x + dx + initial.w / 2);
    close(r.cy, initial.y + dy + initial.h / 2);
    assert.ok(r.score > 0.98);
    assert.equal(r.t, t);
  }
  const copy = tracker.box; copy.x = -1000;
  assert.ok(tracker.box.x > 0, 'external box mutation cannot move the tracker');
});

test('zero-mean normalized correlation tolerates additive and multiplicative lighting changes', () => {
  const tracker = createTemplateTracker();
  tracker.init(frame(), initial, 1);
  const r = tracker.track(frame(7, 9, { gain: 0.65, bias: 42 }), 1.04);
  assert.equal(r.ok, true, r.reason);
  close(r.box.x, initial.x + 7);
  close(r.box.y, initial.y + 9);
  assert.ok(r.score > 0.999, r.score);
});

test('temporary occlusion returns no position, then reacquires only inside the local window', () => {
  const tracker = createTemplateTracker({ margin: 28, maxGap: 0.5 });
  tracker.init(frame(), initial, 0);
  assert.equal(tracker.track(frame(4, -3), 0.04).ok, true);
  const lost = tracker.track(frame(0, 0, { hidden: true }), 0.12);
  assert.equal(lost.ok, false);
  assert.equal(lost.box, null);
  assert.ok(Number.isNaN(lost.cx) && Number.isNaN(lost.cy));
  assert.equal(tracker.state, 'lost');
  const found = tracker.track(frame(12, -10), 0.2);
  assert.equal(found.ok, true, found.reason);
  close(found.box.x, initial.x + 12);
  close(found.box.y, initial.y - 10);
});

test('a long observation gap expires even if a similar target later appears', () => {
  const tracker = createTemplateTracker({ maxGap: 0.3 });
  tracker.init(frame(), initial, 0);
  const expired = tracker.track(frame(2, -2), 0.31);
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /too long/);
  assert.equal(tracker.state, 'expired');
  assert.equal(tracker.track(frame(), 0.32).ok, false);
  assert.equal(tracker.init(frame(), initial, 0.4).ok, true, 'fresh selection recovers the tracker');
});

test('a distant lookalike cannot steal the target after it leaves the bounded search region', () => {
  const tracker = createTemplateTracker({ margin: 18 });
  tracker.init(frame(), initial, 0);
  const r = tracker.track(frame(80, 0), 0.04);
  assert.equal(r.ok, false);
  assert.equal(r.box, null);
  assert.match(r.reason, /did not match/);
});

test('equally good independent local targets are ambiguous instead of an arbitrary successful match', () => {
  const tracker = createTemplateTracker({ margin: 50 });
  tracker.init(frame(), initial, 0);
  const r = tracker.track(frame(0, 0, { duplicate: { x: 104, y: 56 } }), 0.04);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Ambiguous/);
  assert.equal(r.box, null);
  assert.ok(r.separation < 0.06);
});

test('constant or indistinct selections fail initialization and occluded flat images cannot be scored', () => {
  const img = { w: 160, h: 120, data: new Float32Array(160 * 120).fill(100) };
  const tracker = createTemplateTracker();
  assert.equal(tracker.init(img, initial, 0).ok, false);
  assert.equal(tracker.state, 'empty');
  assert.equal(tracker.init(frame(), initial, 0).ok, true);
  const r = tracker.track({ w: 192, h: 160, data: new Float32Array(192 * 160).fill(100) }, 0.04);
  assert.equal(r.ok, false);
  assert.equal(r.box, null);
});

test('duplicate/reversed/nonfinite timestamps cannot alter a valid track', () => {
  const tracker = createTemplateTracker();
  tracker.init(frame(), initial, 1);
  for (const t of [1, 0.99, NaN, Infinity]) {
    assert.equal(tracker.track(frame(20, 20), t).ok, false);
    assert.deepEqual(tracker.box, initial);
  }
  assert.equal(tracker.track(frame(3, 4), 1.04).ok, true);
});

test('invalid image pixels, dimensions, boxes and options fail closed without replacing the anchor', () => {
  for (const options of [{ minScore: 0 }, { margin: -1 }, { margin: Infinity }, { maxGap: 0 }, { maxTemplateSide: 100 }]) assert.throws(() => createTemplateTracker(options), RangeError);
  const tracker = createTemplateTracker();
  assert.equal(tracker.init(null, initial, 0).ok, false);
  assert.equal(tracker.init(frame(), { ...initial, x: -1 }, 0).ok, false);
  assert.equal(tracker.init(frame(), { ...initial, w: 2 }, 0).ok, false);
  tracker.init(frame(), initial, 0);
  const invalid = frame(); invalid.data[0] = NaN;
  assert.equal(tracker.track(invalid, 0.04).ok, false);
  assert.deepEqual(tracker.box, initial);
  const changed = frame(0, 0, { w: 200 });
  assert.equal(tracker.track(changed, 0.08).ok, false);
  assert.equal(tracker.state, 'expired');
  tracker.reset();
  assert.equal(tracker.state, 'empty');
  assert.equal(tracker.box, null);
});

test('repeated texture changes cannot silently rewrite the immutable initial target', () => {
  const tracker = createTemplateTracker({ minScore: 0.9 });
  tracker.init(frame(), initial, 0);
  const changed = frame(2, 0);
  for (let y = initial.y; y < initial.y + initial.h; y++) for (let x = initial.x + 2; x < initial.x + initial.w + 2; x++) {
    changed.data[y * changed.w + x] = 250 - changed.data[y * changed.w + x];
  }
  assert.equal(tracker.track(changed, 0.04).ok, false);
  const restored = tracker.track(frame(4, 0), 0.08);
  assert.equal(restored.ok, true, restored.reason);
  close(restored.box.x, initial.x + 4);
});

test('area-downsampled descriptors track a 640-pixel frame without retaining prior image buffers', () => {
  const tracker = createTemplateTracker();
  const a = frame(0, 0, { w: 640, h: 360 });
  assert.equal(tracker.init(a, initial, 0).ok, true);
  a.data.fill(0); // the original image must not be the template's mutable storage
  const r = tracker.track(frame(13, 17, { w: 640, h: 360 }), 0.04);
  assert.equal(r.ok, true, r.reason);
  close(r.box.x, initial.x + 13);
  close(r.box.y, initial.y + 17);
});
