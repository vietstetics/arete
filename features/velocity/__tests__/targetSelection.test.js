import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoPoint, screenPoint, boxFromPoints } from '../services/live/targetSelection.js';

const nearPoint = (a, b) => {
  for (const k of Object.keys(b)) assert.ok(Math.abs(a[k] - b[k]) < 1e-8, `${k}: ${a[k]} vs ${b[k]}`);
};

test('cover undoes a horizontally cropped landscape frame inside a portrait viewport', () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 }, options = { vw: 1920, vh: 1080, fit: 'cover' };
  nearPoint(videoPoint({ clientX: 160, clientY: 320 }, rect, options), { x: 960, y: 540 });
  nearPoint(videoPoint({ clientX: 10, clientY: 20 }, rect, options), { x: 690, y: 0 });
  nearPoint(videoPoint({ clientX: 310, clientY: 620 }, rect, options), { x: 1230, y: 1080 });
});

test('cover undoes a vertically cropped portrait frame in a landscape viewport', () => {
  const rect = { left: 50, top: 100, width: 600, height: 300 }, options = { vw: 1080, vh: 1920 };
  nearPoint(videoPoint({ clientX: 50, clientY: 100 }, rect, options), { x: 0, y: 690 });
  nearPoint(videoPoint({ clientX: 650, clientY: 400 }, rect, options), { x: 1080, y: 1230 });
});

test('mirrored screen selections map into unmirrored source video coordinates', () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 }, options = { vw: 1920, vh: 1080, mirror: true };
  nearPoint(videoPoint({ clientX: 10, clientY: 20 }, rect, options), { x: 1230, y: 0 });
  nearPoint(videoPoint({ clientX: 310, clientY: 620 }, rect, options), { x: 690, y: 1080 });
});

test('captured drags outside the viewport clamp to the visible part of the frame', () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 }, options = { vw: 1920, vh: 1080 };
  nearPoint(videoPoint({ clientX: -1000, clientY: -1000 }, rect, options), { x: 690, y: 0 });
  nearPoint(videoPoint({ clientX: 1000, clientY: 2000 }, rect, options), { x: 1230, y: 1080 });
});

test('CSS pixel transform round-trips visible points across aspect ratios, mirroring and fractional layout offsets', () => {
  for (const [vw, vh] of [[1920, 1080], [1080, 1920], [640, 480], [512, 512]]) {
    for (const mirror of [false, true]) {
      const rect = { left: 7.25, top: 35.5, width: 333.3, height: 624.7 }, options = { vw, vh, mirror };
      for (const [x, y] of [[0, 0], [0.17, 0.63], [0.5, 0.5], [1, 1]]) {
        const screen = { clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height };
        nearPoint(screenPoint(videoPoint(screen, rect, options), rect, options), screen);
      }
    }
  }
});

test('contain mapping handles letterbox bars without generating off-frame pixels', () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 }, options = { vw: 1920, vh: 1080, fit: 'contain' };
  nearPoint(videoPoint({ clientX: 160, clientY: 320 }, rect, options), { x: 960, y: 540 });
  nearPoint(videoPoint({ clientX: 160, clientY: 20 }, rect, options), { x: 960, y: 0 });
  nearPoint(videoPoint({ clientX: 160, clientY: 620 }, rect, options), { x: 960, y: 1080 });
});

test('ROI accepts reverse drags, clamps before sizing and rounds outwards in full-frame coordinates', () => {
  const a = { x: 110.2, y: 95.6 }, b = { x: 50.9, y: 30.1 }, options = { vw: 1920, vh: 1080 };
  assert.deepEqual(boxFromPoints(a, b, options), { x: 50, y: 30, w: 61, h: 66 });
  assert.deepEqual(boxFromPoints(b, a, options), boxFromPoints(a, b, options));
  assert.deepEqual(boxFromPoints({ x: -10, y: -20 }, { x: 2000, y: 1100 }, options), { x: 0, y: 0, w: 1920, h: 1080 });
});

test('clicks and native-pixel sides below minimum are rejected after clamping', () => {
  const options = { vw: 640, vh: 480, minSize: 8 };
  for (const [a, b] of [
    [{ x: 20, y: 20 }, { x: 20, y: 20 }],
    [{ x: 20, y: 20 }, { x: 27.9, y: 40 }],
    [{ x: -20, y: 20 }, { x: 7, y: 40 }],
    [{ x: 630, y: 475 }, { x: 700, y: 600 }],
  ]) assert.equal(boxFromPoints(a, b, options), null);
  assert.deepEqual(boxFromPoints({ x: 20, y: 20 }, { x: 28, y: 28 }, options), { x: 20, y: 20, w: 8, h: 8 });
});

test('screen drag produces a source ROI rather than a cropped/display-resolution box', () => {
  const rect = { left: 100, top: 50, width: 300, height: 600 }, options = { vw: 1920, vh: 1080, mirror: true };
  const a = videoPoint({ clientX: 150, clientY: 150 }, rect, options);
  const b = videoPoint({ clientX: 250, clientY: 250 }, rect, options);
  assert.deepEqual(boxFromPoints(a, b, options), { x: 960, y: 180, w: 180, h: 180 });
});

test('invalid pointers, source dimensions, display rectangles and minimum sizes fail closed', () => {
  const rect = { left: 0, top: 0, width: 300, height: 600 }, options = { vw: 1920, vh: 1080 };
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(videoPoint({ clientX: invalid, clientY: 20 }, rect, options), null);
    assert.equal(screenPoint({ x: 20, y: invalid }, rect, options), null);
    assert.equal(boxFromPoints({ x: 20, y: invalid }, { x: 30, y: 30 }, options), null);
  }
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
    assert.equal(videoPoint({ clientX: 10, clientY: 20 }, rect, { ...options, vw: invalid }), null);
    assert.equal(boxFromPoints({ x: 0, y: 0 }, { x: 50, y: 50 }, { ...options, vh: invalid }), null);
  }
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.equal(videoPoint({ clientX: 10, clientY: 20 }, { ...rect, width: invalid }, options), null);
    assert.equal(boxFromPoints({ x: 0, y: 0 }, { x: 50, y: 50 }, { ...options, minSize: invalid }), null);
  }
  assert.equal(videoPoint({ clientX: 10, clientY: 20 }, rect, { ...options, fit: 'fill' }), null);
  assert.equal(videoPoint(null, rect, options), null); assert.equal(videoPoint({ clientX: 0, clientY: 0 }, null, options), null);
});
