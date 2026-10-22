import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standardizeLifts, standardizeMeasurements } from '../services/live/repVelocity.js';
import { createFrameClock } from '../services/live/frameClock.js';

const rep = (n, t, result = 'counted') => ({ n, topT: t, result, isStandard: n === 1 });
const lift = (t, T, distance = 0.5) => ({ ok: true, tBottom: t, tTop: t + T + 0.1, tStart: t, tEnd: t + T, T, distance, pv: 1 });

test('live plate speed locks D to original valid standard, retains own ROM and peak', () => {
  const r = standardizeLifts([rep(1, 1), rep(2, 4)], [lift(1, 1), lift(4, 2, 0.46)]);
  assert.equal(r.D, 0.5);
  assert.equal(r.rows[1].mcv, 0.25);
  assert.equal(r.rows[1].mcvOwn, 0.23);
  assert.equal(r.rows[1].pv, 1);
  assert.equal(r.rows[1].rel, 0.5);
  assert.equal(r.rows[1].loss, 0.5);
});

test('short and unclear reps never get live speed or influence the reference', () => {
  const r = standardizeLifts([rep(1, 1), rep(2, 4, 'short'), rep(3, 7, 'unclear')], [lift(1, 1), lift(4, 0.3), lift(7, 0.2)]);
  assert.deepEqual(r.rows.map((r) => r.velocity), ['ok', 'none', 'none']);
  assert.ok(Number.isNaN(r.rows[1].mcv));
  const bad = standardizeLifts([rep(1, 1, 'unclear'), rep(2, 4)], [lift(1, 1), lift(4, 1)]);
  assert.ok(Number.isNaN(bad.D));
  assert.equal(bad.rows[1].velocity, 'unclear');
});

test('a missing original lift never borrows the next lift or silently recalibrates', () => {
  const r = standardizeLifts([rep(1, 1), rep(2, 3)], [lift(3, 1)]);
  assert.equal(r.rows[0].lift, null);
  assert.ok(r.rows[1].lift);
  assert.ok(Number.isNaN(r.rows[1].mcv));
});

test('one plate lift cannot supply two pose reps; paused lift remains matched', () => {
  const r = standardizeLifts([rep(1, 1), rep(2, 1.1)], [lift(1.1, 1)]);
  assert.equal(r.rows.filter((r) => r.lift).length, 1);
  const paused = standardizeLifts([rep(1, 1)], [{ ...lift(1, 1), tStart: 9, tEnd: 10, tTop: 10.1 }]);
  assert.equal(paused.rows[0].mcv, 0.5);
});

test('invalid durations or displacement never produce Infinity, negative speeds or a baseline', () => {
  for (const T of [0, -1, NaN, Infinity]) {
    const r = standardizeMeasurements([rep(1, 1)], [{ T, distance: 0.5 }]);
    assert.ok(Number.isNaN(r.D));
    assert.equal(r.rows[0].velocity, 'unclear');
  }
});

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
