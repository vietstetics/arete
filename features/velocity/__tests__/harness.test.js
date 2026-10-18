import { test } from 'node:test';
import assert from 'node:assert/strict';
import { velocitySourceFor, handPointFor } from '../services/sources.js';
import { savitzkyGolay, at } from '../services/smooth.js';
import { concentricTiming, setVelocities, longestGap, intraSetFatigue } from '../services/timing.js';
import { confidence, repMetrics, G } from '../services/metrics.js';
import { parseReference, agreement, compareSet, passes, accuracyTable, toCsv } from '../services/compare.js';
import { analyseSet, estimateFps, trackerFor } from '../services/pipeline.js';
import { BODY } from '../../standard/services/velocity.js';

const near = (a, b, pct) => Math.abs(a - b) / Math.abs(b) <= pct;

// ── Measurement rule ─────────────────────────────────────────────────────
test('velocity source: machines and cables at the hand, free weights at the weight', () => {
  for (const n of ['Chest Press', 'Tricep Pushdown', 'Lat Pulldown', 'Cable Row', 'Pec Deck', 'Cable Curl', 'Leg Extension', 'Leg Curl']) assert.equal(velocitySourceFor({ name: n }), 'hand', n);
  for (const n of ['Bench Press', 'Squat', 'Deadlift', 'RDL', 'Overhead Press', 'Barbell Row', 'Dumbbell Curl', 'Dumbbell Press']) assert.equal(velocitySourceFor({ name: n }), 'weight', n);
  assert.equal(velocitySourceFor({ name: 'my custom row', equipment: 'Cable' }), 'hand');
  assert.equal(velocitySourceFor({ name: 'my custom press', equipment: 'Machine' }), 'hand');
  assert.equal(velocitySourceFor({ name: 'Zercher thing', equipment: 'Barbell' }), 'weight');
  assert.equal(velocitySourceFor({ name: 'Goblet thing', equipment: 'Dumbbell' }), 'weight');
  assert.equal(velocitySourceFor({ name: 'Push-up', equipment: 'Bodyweight' }), null, 'unknown must be set, never guessed');
  assert.equal(velocitySourceFor({ name: 'Bench Press', velocitySource: 'hand' }), 'hand', 'an explicit field wins');
  assert.equal(handPointFor('Leg Extension'), 'ankle');
  assert.equal(handPointFor('Leg Curl'), 'ankle');
  assert.equal(handPointFor('Lat Pulldown'), 'wrist');
});

test('free weights are measured at the weight; the pose baseline is labelled, never passed off as the weight', () => {
  for (const lift of ['squat', 'bench', 'curl']) {
    assert.equal(trackerFor(lift).source, 'weight');
    assert.equal(trackerFor(lift).id, lift === 'curl' ? 'dumbbell' : 'plate');
    const t = trackerFor(lift, 'pose-baseline');
    assert.equal(t.id, 'pose-baseline');
    assert.match(t.label, /baseline/i);
  }
});

// ── Savitzky–Golay ───────────────────────────────────────────────────────
test('Savitzky–Golay reproduces a cubic exactly, with its velocity and acceleration, on uneven frame times', () => {
  const ts = []; let t = 0;
  for (let i = 0; i < 120; i++) { ts.push(t); t += (1 / 60) * (1 + 0.2 * Math.sin(i * 1.7)); } // jittery frame spacing
  const y = (x) => 0.3 + 0.8 * x - 0.5 * x * x + 0.2 * x ** 3;
  const fit = savitzkyGolay(ts.map((x) => ({ t: x, y: y(x) })));
  for (let i = 10; i < 110; i++) {
    const x = ts[i];
    assert.ok(Math.abs(fit[i].y - y(x)) < 1e-9);
    assert.ok(Math.abs(fit[i].v - (0.8 - x + 0.6 * x * x)) < 1e-7);
    assert.ok(Math.abs(fit[i].a - (-1 + 1.2 * x)) < 1e-5);
    assert.equal(fit[i].full, true);
  }
  assert.equal(fit[0].full, false, 'edge frames are flagged: one-sided fits are not trusted for peaks');
});

test('Savitzky–Golay skips missing frames instead of inventing them', () => {
  const s = Array.from({ length: 60 }, (_, i) => ({ t: i / 60, y: i >= 20 && i < 25 ? NaN : i / 60 }));
  const fit = savitzkyGolay(s);
  assert.ok(Number.isNaN(fit[22].y));
  assert.ok(Math.abs(fit[30].v - 1) < 1e-6);
  assert.ok(Math.abs(at(fit, 0.5) - 0.5) < 1e-6);
});

// ── Timing (T) ───────────────────────────────────────────────────────────
// One lift: still, then the point rises `range` over `secs` (smooth speed curve), then still.
function lift({ range = 0.5, secs = 1, fps = 60, phase = 0, pauseBefore = 0.4, pauseAfter = 0.4, noise = 0, seed = 7 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = []; let t = 0;
  const push = (y) => { out.push({ t, y: y + noise * rnd() }); t += 1 / fps; };
  for (let i = 0; i < pauseBefore * fps; i++) push(0);
  const t0 = t - phase / fps;
  while (t < t0 + secs) push(range * (1 - Math.cos((Math.PI * (t - t0)) / secs)) / 2);
  for (let i = 0; i < pauseAfter * fps; i++) push(range);
  return { samples: out, start: t0, end: t0 + secs };
}

test('sub-frame timing: at 60 fps T is within 2% of the continuous-time value wherever the frames fall', () => {
  for (const secs of [0.5, 0.8, 1.2, 2]) {
    const ref = lift({ secs, fps: 2000 });
    const Tc = concentricTiming(savitzkyGolay(ref.samples), 0, 99).T;
    for (const phase of [0, 0.2, 0.45, 0.7, 0.95]) {
      const x = lift({ secs, fps: 60, phase });
      const T = concentricTiming(savitzkyGolay(x.samples), 0, 99).T;
      assert.ok(near(T, Tc, 0.02), `${secs}s, phase ${phase}: ${T.toFixed(4)} vs ${Tc.toFixed(4)}`);
    }
  }
});

// A smooth start and stop is the hardest case for timing (the speed creeps up
// from zero): the 5% threshold trims a little of each end. Over 120 jittered
// runs T read 2.9% short on average, worst 6.9% at ±2 mm.
test('timing of a smooth lift stays within 7% of its true duration with ±2 mm of camera jitter', () => {
  const errs = [];
  for (const secs of [0.6, 1, 1.6]) for (const phase of [0, 0.37, 0.71]) {
    const x = lift({ secs, fps: 60, phase, noise: 0.002, seed: 7 + secs * 10 + phase * 100 });
    const T = concentricTiming(savitzkyGolay(x.samples), 0, 99).T;
    errs.push((T - secs) / secs);
    assert.ok(near(T, secs, 0.07), `${secs}s → ${T.toFixed(3)}`);
  }
  assert.ok(Math.abs(errs.reduce((a, b) => a + b) / errs.length) < 0.04);
});

test('a pause at the bottom or top is not part of T', () => {
  const a = concentricTiming(savitzkyGolay(lift({ pauseBefore: 0.3, pauseAfter: 0.3 }).samples), 0, 99).T;
  const b = concentricTiming(savitzkyGolay(lift({ pauseBefore: 2, pauseAfter: 1.5 }).samples), 0, 99).T;
  assert.ok(near(a, b, 0.01));
});

// ── D / T over a set ─────────────────────────────────────────────────────
// A set of lifts in one trace; returns samples, rep stubs (as the rep counter gives them) and windows.
function setTrace(specs, { fps = 60, range = 0.5 } = {}) {
  const samples = [], reps = [], windows = []; let t = 0, y = 0;
  const push = (v) => { samples.push({ t, y: v }); t += 1 / fps; };
  const hold = (secs) => { for (let i = 0; i < secs * fps; i++) push(y); };
  const move = (to, secs) => { const y0 = y, n = Math.round(secs * fps); for (let i = 1; i <= n; i++) { y = y0 + (to - y0) * (1 - Math.cos((Math.PI * i) / n)) / 2; push(y); } };
  hold(0.5);
  specs.forEach((sp, i) => {
    const t0 = t; move(sp.range ?? range, sp.up); hold(0.3);
    reps.push({ n: i + 1, result: sp.result ?? 'counted', isStandard: i === 0 });
    windows.push({ t0: t0 - 0.2, t1: t + 0.05 });
    move(0, 1); hold(0.3);
  });
  return { samples, reps, windows };
}

test('D comes from rep 1; every counted rep gets D / T; velocity loss = T1 / Tn', () => {
  const { samples, reps, windows } = setTrace([{ up: 0.8 }, { up: 0.9 }, { up: 1.0 }, { up: 1.2 }]);
  const r = setVelocities(samples, savitzkyGolay(samples), reps, windows, { mpu: 1 });
  assert.ok(near(r.Dm, 0.5, 0.01), `D = ${r.Dm}`);
  const T = r.rows.map((x) => x.T);
  r.rows.forEach((x, i) => {
    assert.equal(x.velocity, 'ok');
    assert.ok(Math.abs(x.mcv - r.Dm / T[i]) < 1e-12, 'MCV = D / T');
    assert.ok(Math.abs(x.rel - T[0] / T[i]) < 1e-12, 'relative speed = T1 / Tn');
    assert.ok(Math.abs(x.loss - (1 - T[0] / T[i])) < 1e-12);
  });
  assert.ok(near(r.rows[3].rel, 0.8 / 1.2, 0.02), 'ratios need no scale');
  assert.ok(near(intraSetFatigue(r.rows), 1 - 0.8 / 1.2, 0.03));
});

test('only counted reps get a velocity; short and unclear reps get none, with the reason', () => {
  const { samples, reps, windows } = setTrace([{ up: 0.8 }, { up: 0.9, result: 'short', range: 0.3 }, { up: 0.9, result: 'unclear' }, { up: 1 }]);
  const r = setVelocities(samples, savitzkyGolay(samples), reps, windows, { mpu: 1 });
  assert.deepEqual(r.rows.map((x) => x.velocity), ['ok', 'none', 'none', 'ok']);
  assert.match(r.rows[1].why, /short/i);
  assert.match(r.rows[2].why, /unclear/i);
  assert.ok(Number.isNaN(r.rows[1].mcv));
});

test('losing the measured point for over 0.5 s makes that rep’s velocity unclear — no silent fallback', () => {
  const { samples, reps, windows } = setTrace([{ up: 0.8 }, { up: 0.9 }]);
  const w = windows[1];
  for (const s of samples) if (s.t > w.t0 + 0.3 && s.t < w.t0 + 0.9) s.y = NaN;
  assert.ok(longestGap(samples, w.t0, w.t1) > 0.5);
  const r = setVelocities(samples, savitzkyGolay(samples), reps, windows, { mpu: 1 });
  assert.equal(r.rows[1].velocity, 'unclear');
  assert.match(r.rows[1].why, /0\.5 s/);
});

test('without a real-world scale there is no m/s — only relative speed', () => {
  const { samples, reps, windows } = setTrace([{ up: 0.8 }, { up: 1 }]);
  const r = setVelocities(samples, savitzkyGolay(samples), reps, windows, { mpu: NaN });
  assert.equal(r.scaled, false);
  assert.ok(Number.isNaN(r.Dm));
  assert.ok(near(r.rows[1].rel, 0.8, 0.02));
});

// ── Metric set and tiers ─────────────────────────────────────────────────
test('confidence tiers follow the plan: derivatives need ≥120 fps, peak force is always an estimate', () => {
  assert.equal(confidence('mv', { fps: 30 }), 'reliable');
  assert.equal(confidence('loss', { fps: 30 }), 'reliable');
  assert.equal(confidence('pv', { fps: 60 }), 'estimate');
  assert.equal(confidence('pv', { fps: 120 }), 'reliable');
  assert.equal(confidence('mpv', { fps: 119 }), 'estimate');
  assert.equal(confidence('peakPower', { fps: 120 }), 'estimate');
  assert.equal(confidence('peakPower', { fps: 240 }), 'fair');
  assert.equal(confidence('peakForce', { fps: 1000 }), 'estimate');
  assert.equal(confidence('mv', { fps: 240, quality: 0.8 }), 'estimate', 'poor tracking demotes everything');
});

test('power, peak velocity and propulsive velocity from the fitted polynomial', () => {
  const { samples, reps, windows } = setTrace([{ up: 1 }]);
  const fit = savitzkyGolay(samples);
  const r = setVelocities(samples, fit, reps, windows, { mpu: 1 });
  const m = repMetrics(fit, r.rows[0], { D: r.D, mpu: 1, massKg: 100 });
  assert.ok(Math.abs(m.avgPower - (100 * G * r.D) / r.rows[0].T) < 1e-9, 'average power = m·g·D / T');
  assert.ok(near(m.pv, (Math.PI * 0.5) / 2, 0.03), `peak v ${m.pv}`); // smooth curve peaks at π·R / (2·T)
  assert.ok(m.mpv >= r.rows[0].mcv * 0.99, 'propulsive velocity ≥ mean velocity');
  assert.ok(m.peakForce > 100 * G && m.peakPower > m.avgPower);
  const none = repMetrics(fit, r.rows[0], { D: r.D, mpu: NaN, massKg: 100 });
  assert.ok(Number.isNaN(none.avgPower) && Number.isNaN(none.mpv), 'no scale → no SI metrics');
});

// ── Reference input and comparison ───────────────────────────────────────
test('reference numbers: one per line, several per line, rep numbers, CSV headers, decimal commas', () => {
  assert.deepEqual(parseReference('0.62\n0.60\n\n0.55').map((r) => r.mv), [0.62, 0.6, 0.55]);
  const multi = parseReference('0.62, 0.95, 48\n0.60, 0.92, 47');
  assert.equal(multi[1].pv, 0.92); assert.equal(multi[0].romCm, 48);
  assert.deepEqual(parseReference('1  0.62\n2  0.58\n3  0.51').map((r) => r.mv), [0.62, 0.58, 0.51]);
  const csv = parseReference('Rep,Mean Propulsive Velocity,Mean Velocity (m/s),Peak Velocity,ROM (m),Peak Power\n1,0.70,0.62,0.98,0.48,900\n2,0.66,0.59,0.93,0.47,880');
  assert.equal(csv[0].mv, 0.62, 'mean velocity, not the propulsive column');
  assert.equal(csv[0].pv, 0.98); assert.equal(csv[0].romCm, 48, 'ROM in metres converted to cm'); assert.equal(csv[0].power, 900);
  assert.deepEqual(parseReference('0,62;0,95\n0,58;0,90').map((r) => r.mv), [0.62, 0.58]);
});

test('agreement: bias, limits of agreement, mean absolute % error', () => {
  const a = agreement([{ ours: 0.63, ref: 0.6 }, { ours: 0.57, ref: 0.6 }, { ours: 0.62, ref: 0.6 }, { ours: 0.6, ref: 0.6 }]);
  assert.equal(a.n, 4);
  assert.ok(Math.abs(a.bias - 0.005) < 1e-12);
  assert.ok(Math.abs(a.mape - (5 + 5 + 3.3333333 + 0) / 4) < 1e-6);
  assert.ok(Math.abs(a.loa[1] - a.bias - 1.96 * a.sd) < 1e-12);
  assert.equal(passes(a), true);
  assert.equal(passes(agreement([{ ours: 0.7, ref: 0.6 }])), false);
});

test('comparison keeps the rep order honest: our short reps hold their place', () => {
  const ours = [
    { n: 1, result: 'counted', velocity: 'ok', mcv: 0.61, mcvOwn: 0.61, loss: 0 },
    { n: 2, result: 'short', velocity: 'none', mcv: NaN, loss: NaN },
    { n: 3, result: 'counted', velocity: 'ok', mcv: 0.52, mcvOwn: 0.53, loss: 0.15 },
  ];
  const c = compareSet(ours, parseReference('0.60\n0.58\n0.51'));
  assert.equal(c.detected, 3); assert.equal(c.refReps, 3); assert.equal(c.mv.n, 2);
  assert.equal(c.reps[1].mv, null, 'the short rep is not compared');
  assert.ok(Math.abs(c.reps[2].mv.ref - 0.51) < 1e-12);
  assert.ok(Math.abs(c.lossPts.mae - Math.abs(15 - 15)) < 1, 'velocity loss compared in percentage points');
});

test('accuracy table per lift and per camera angle, and CSV export', () => {
  const s = (lift, angle, pairs) => ({ at: Date.UTC(2026, 9, 17), lift, angle, reference: 'Qwik VBT', tracker: 'pose-baseline', distance: 3, fps: 60, pairs, detected: pairs.length, refReps: pairs.length,
    reps: pairs.map((p, i) => ({ i: i + 1, result: 'counted', oursMv: p.ours, refMv: p.ref, oursLoss: 0, refLoss: 0 })) });
  const sessions = [s('Back squat', '0°', [{ ours: 0.61, ref: 0.6 }, { ours: 0.55, ref: 0.56 }]), s('Back squat', '±15°', [{ ours: 0.7, ref: 0.6 }]), s('Bench press', '0°', [{ ours: 0.4, ref: 0.41 }])];
  const t = accuracyTable(sessions);
  const squat = t.find((r) => r.lift === 'Back squat' && r.angle === null);
  assert.equal(squat.sessions, 2); assert.equal(squat.n, 3); assert.equal(squat.pass, false);
  assert.equal(t.find((r) => r.lift === 'Back squat' && r.angle === '0°').pass, true);
  assert.equal(t.find((r) => r.lift === 'Back squat' && r.angle === '±15°').pass, false);
  const plate = accuracyTable([...sessions, { ...s('Back squat', '0°', [{ ours: 0.6, ref: 0.6 }]), tracker: 'plate' }]);
  assert.equal(plate.filter((r) => r.lift === 'Back squat' && r.angle === null).length, 2, 'plate and pose baseline are separate rows');
  assert.equal(plate.find((r) => r.tracker === 'plate' && r.angle === null).n, 1);
  const csv = toCsv(sessions).split('\n');
  assert.match(csv[0], /^date,lift,reference,tracker,angle/);
  assert.equal(csv.length, 5);
  assert.match(csv[1], /Back squat,Qwik VBT,pose-baseline,0°,3,60\.0,1,counted,0\.610,0\.600,0\.010,1\.7/);
});

test('frame rate from timestamps', () => {
  assert.ok(Math.abs(estimateFps(Array.from({ length: 100 }, (_, i) => i / 59.94)) - 59.94) < 0.01);
});

// ── End to end: a synthetic back squat, pose frames → velocity ──────────
// Lifter 1.80 m tall, 500 px per metre, portrait 1000×2000. The bar (on the
// shoulders) drops 0.50 m each rep and comes up in a known time. First the
// lifter walks out and shuffles their feet: that must not become rep 1.
// Bounds come from running this set with 10 different jitter patterns at ±1 px:
// bar speed averaged +3.1% (worst 5.9%), relative speed −0.1% (worst 3.4%).
test('end to end: a filmed squat set gives the true bar speed within 6% and true velocity loss within 3.5%', () => {
  const H = 1.8, k = 500, vw = 1000, vh = 2000, ankle = 1900, fps = 60, d = 0.5;
  let s = 3; const jit = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * 0.0005; // ±1 px (±2 mm)
  const pose = (drop, sway = 0) => {
    const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const y = (h) => (ankle - h * k) / vh + jit(), at = (x, h) => ({ x: x + sway + jit() / 4, y: y(h), visibility: 0.95 });
    const hip = 0.49 * H - drop * 0.9, sh = BODY.shoulderAboveAnkle * H - drop, bend = drop / d;
    Object.assign(p, { 11: at(0.46, sh), 12: at(0.54, sh), 23: at(0.47, hip), 24: at(0.53, hip),
      25: at(0.45 - 0.08 * bend, hip / 2), 26: at(0.55 + 0.08 * bend, hip / 2), 27: at(0.46, 0), 28: at(0.54, 0) });
    return p;
  };
  const frames = []; let t = 0, drop = 0;
  const add = (n, f) => { for (let i = 1; i <= n; i++) { frames.push({ t, poses: [f(i / n)] }); t += 1 / fps; } };
  const hold = (secs, sway = () => 0) => add(Math.round(secs * fps), (u) => pose(drop, sway(u)));
  const move = (to, secs) => { const d0 = drop; add(Math.round(secs * fps), (u) => pose((drop = d0 + (to - d0) * (1 - Math.cos(Math.PI * u)) / 2))); };
  hold(1.2, (u) => 0.04 * Math.sin(u * 9));       // walking out: moving, not still
  move(0.12, 0.4); move(0, 0.4);                  // a little setup dip
  hold(2.2);                                     // standing still: calibrate, then counting starts
  const ups = [0.8, 0.85, 0.95, 1.1, 1.3];
  for (const up of ups) { move(d, 1.2); hold(0.3); move(0, up); hold(0.6); }
  hold(1);
  const res = analyseSet({ frames, vw, vh, lift: 'squat', fps, heightCm: H * 100, massKg: 180, tracker: 'pose-baseline' });
  const counted = res.rows.filter((r) => r.velocity === 'ok');
  assert.equal(res.rows.length, 5, 'exactly the five real reps (the setup dip did not count)');
  assert.equal(counted.length, 5);
  assert.equal(res.scaled, true);
  assert.ok(near(res.Dm, d, 0.04), `D = ${res.Dm.toFixed(3)} m vs ${d}`);
  counted.forEach((r, i) => {
    assert.ok(near(r.mcv, d / ups[i], 0.06), `rep ${i + 1}: ${r.mcv.toFixed(3)} vs ${(d / ups[i]).toFixed(3)} m/s`);
    assert.ok(near(r.rel, ups[0] / ups[i], 0.035), `rep ${i + 1} relative speed ${r.rel.toFixed(3)} vs ${(ups[0] / ups[i]).toFixed(3)}`);
  });
  assert.equal(res.rows[0].badges.mv, 'reliable');
  assert.equal(res.rows[0].badges.pv, 'estimate', '60 fps: peak velocity is an estimate');
  assert.match(res.tracker.label, /baseline/i);
});
