import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock } from '../services/live/frameClock.js';

test('frame timing follows media time at variable rates despite processing jitter', () => {
  const clock = createFrameClock();
  assert.equal(clock.time(1, 5000), 5000);
  assert.equal(clock.time(1.02, 5100), 5020);
  assert.equal(clock.time(1.07, 5400), 5070);
  assert.equal(clock.time(1.07, 5500), null);
  assert.equal(clock.time(1.06, 5600), null);
  assert.equal(clock.time(NaN, 5700), null);
  clock.reset();
  assert.equal(clock.time(0, 9000, { file: true }), 0);
  assert.equal(clock.time(0.04, 9200, { file: true }), 40);
});

test('live capture timestamps align to sensor clock when supplied', () => {
  const clock = createFrameClock();
  assert.equal(clock.time(0.5, 2000, { captureTime: 1900 }), 1900);
  assert.equal(clock.time(0.52, 2100, { captureTime: 1920 }), 1920);
});
