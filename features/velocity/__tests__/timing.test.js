import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concentricTiming, setVelocities, longestGap, intraSetFatigue } from '../services/timing.js';

// Two analytical half-cosine lifts: 0.5 native units in 1 s, with rest
// visible on either side. Derivatives are exact, isolating timing from SG.
function trace() {
  const samples = [], fit = [];
  for (let t = 0, i = 0; t < 4; i++, t += (1 + 0.3 * Math.sin(i * 1.7)) / 60) {
    const u = t % 2 - 0.4;
    const y = u < 0 ? 0 : u > 1 ? 0.5 : 0.25 * (1 - Math.cos(Math.PI * u));
    const v = u > 0 && u < 1 ? 0.25 * Math.PI * Math.sin(Math.PI * u) : 0;
    samples.push({ t, y }); fit.push({ t, y, v, full: true });
  }
  return {
    samples, fit,
    reps: [{ n: 1, result: 'counted', isStandard: true }, { n: 2, result: 'counted' }],
    windows: [{ t0: 0.2, t1: 1.6 }, { t0: 2.2, t1: 3.6 }],
  };
}

const velocities = ({ samples, fit, reps, windows }) => setVelocities(samples, fit, reps, windows);

test('uneven frame timestamps recover analytical duration, displacement and peak speed', () => {
  const { fit, windows } = trace();
  const timing = concentricTiming(fit, windows[0].t0, windows[0].t1);
  assert.ok(Math.abs(timing.T - (1 - 2 * Math.asin(0.05) / Math.PI)) < 0.001);
  assert.ok(Math.abs(timing.distance - 0.5 * Math.sqrt(1 - 0.05 ** 2)) < 0.001);
  assert.ok(Math.abs(timing.pv - Math.PI / 4) < 0.001);
  assert.equal(timing.startSeen, true); assert.equal(timing.endSeen, true);
});

test('an unobserved reference start/end never establishes D or silently selects rep 2', () => {
  for (const edge of ['start', 'end']) {
    const data = trace();
    if (edge === 'start') data.windows[0].t0 = 0.6;
    else data.windows[0].t1 = 1.2;
    const result = velocities(data);
    assert.ok(Number.isNaN(result.D));
    assert.deepEqual(result.rows.map((r) => r.velocity), ['unclear', 'unclear']);
    assert.match(result.rows[0].why, /not seen/);
    assert.match(result.rows[1].why, /Rep 1/);
  }
});

test('a rejected standard rep cannot supply D, even if its motion is measurable', () => {
  for (const result of ['short', 'unclear']) {
    const data = trace(); data.reps[0].result = result;
    const output = velocities(data);
    assert.ok(Number.isNaN(output.D));
    assert.equal(output.rows[0].velocity, 'none');
    assert.equal(output.rows[1].velocity, 'unclear');
    assert.ok(output.rows.every((r) => Number.isNaN(r.mcv)));
  }
});

test('a gap through the second lift cannot turn its remaining fragment into a complete rep', () => {
  const data = trace();
  for (let i = 0; i < data.fit.length; i++) if (data.fit[i].t > 2.75 && data.fit[i].t < 2.85) {
    data.fit[i] = { ...data.fit[i], y: NaN, v: NaN, full: false };
    data.samples[i] = { ...data.samples[i], y: NaN };
  }
  assert.ok(longestGap(data.samples, 2.2, 3.6) < 0.5);
  const result = velocities(data);
  assert.equal(result.rows[0].velocity, 'ok');
  assert.equal(result.rows[1].velocity, 'unclear');
  assert.ok(Number.isNaN(result.rows[1].mcv));
});

test('one missing interior frame can be bridged when both lift boundaries were observed', () => {
  const data = trace(), i = data.fit.findIndex((f) => f.t > 2.75);
  data.samples[i] = { ...data.samples[i], y: NaN };
  data.fit[i] = { ...data.fit[i], y: NaN, v: NaN, full: false };
  const result = velocities(data);
  assert.deepEqual(result.rows.map((r) => r.velocity), ['ok', 'ok']);
  assert.ok(Math.abs(result.rows[1].rel - 1) < 0.002);
});

test('invalid or nonmonotonic timestamps and invalid windows fail closed', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
    const data = trace(); data.fit[10] = { ...data.fit[10], t: bad }; data.samples[10] = { ...data.samples[10], t: bad };
    assert.equal(concentricTiming(data.fit, 0.2, 1.6), null);
    assert.equal(longestGap(data.samples, 0.2, 1.6), Infinity);
    assert.ok(velocities(data).rows.every((r) => r.velocity === 'unclear'));
  }
  const { fit, samples } = trace();
  for (const [t0, t1] of [[NaN, 1], [0, Infinity], [1, 1], [2, 1]]) {
    assert.equal(concentricTiming(fit, t0, t1), null);
    assert.equal(longestGap(samples, t0, t1), Infinity);
  }
  for (const threshold of [0, 1, NaN, Infinity, -1]) assert.equal(concentricTiming(fit, 0.2, 1.6, { threshold }), null);
});

test('nonfinite positions and nonpositive displacement do not produce velocity', () => {
  const data = trace();
  const broken = data.fit.map((p) => ({ ...p, y: NaN }));
  assert.equal(concentricTiming(broken, 0.2, 1.6), null);
  assert.equal(concentricTiming(data.fit.map((p) => ({ ...p, y: -p.y })), 0.2, 1.6), null);
});

test('fatigue uses only finite positive measured velocities', () => {
  const rows = [0.6, 0.3, NaN, Infinity, 0, -1].map((mcv) => ({ velocity: 'ok', mcv }));
  assert.equal(intraSetFatigue(rows), 0.5);
  assert.ok(Number.isNaN(intraSetFatigue(rows.slice(2))));
});

test('a numeric overflow cannot be published as an infinite scaled speed', () => {
  const { samples, fit, reps, windows } = trace();
  // An unrealistically tiny time base with a finite but enormous calibration.
  const fastSamples = samples.map((p) => ({ ...p, t: p.t / 100 }));
  const fastFit = fit.map((p) => ({ ...p, t: p.t / 100, v: p.v * 100 }));
  const fastWindows = windows.map((w) => ({ t0: w.t0 / 100, t1: w.t1 / 100 }));
  const result = setVelocities(fastSamples, fastFit, reps, fastWindows, { mpu: Number.MAX_VALUE });
  assert.ok(result.rows.every((r) => r.velocity === 'unclear' && Number.isNaN(r.mcv)));
});
