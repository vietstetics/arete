import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepCounter, jointAngle, oneEuro, pickPerson, armVisibility } from '../services/repEngine.js';

// Simulated elbow angle at 30 fps. Each rep: hold at `bottom`, lift to `top`
// over `up` seconds, lower back over `down` seconds.
function curlTrace(reps, { fps = 30, noise = 0, seed = 1 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = []; let t = 0;
  const hold = (a, secs) => { for (let i = 0; i < secs * fps; i++) { out.push({ t, a: a + noise * rnd(), ok: true }); t += 1 / fps; } };
  const move = (a0, a1, secs) => { const n = Math.round(secs * fps); for (let i = 1; i <= n; i++) { const k = (1 - Math.cos((Math.PI * i) / n)) / 2; out.push({ t, a: a0 + (a1 - a0) * k + noise * rnd(), ok: true }); t += 1 / fps; } };
  // Each lowering goes straight to the NEXT rep's bottom, like a real set.
  hold(reps[0].bottom, 0.8);
  reps.forEach((r, i) => {
    hold(r.bottom, 0.2);
    move(r.bottom, r.top, r.up ?? 1); hold(r.top, 0.15);
    const next = reps[i + 1] ? reps[i + 1].bottom : r.bottom;
    move(r.top, next, r.down ?? 1.2);
  });
  hold(reps[reps.length - 1].bottom, 1);
  return out;
}
const run = (trace, opts) => { const rc = createRepCounter(opts); const events = []; for (const f of trace) { const e = rc.push(f.t, f.a, f.ok); if (e) events.push(e); } return { rc, events }; };
const results = (rc) => rc.reps.map((r) => r.result);

test('rep 1 locks Start and Finish; matching reps all count', () => {
  const { rc, events } = run(curlTrace(Array(6).fill({ bottom: 170, top: 45 })));
  assert.equal(events[0].type, 'standard');
  assert.ok(Math.abs(rc.standard.start - 170) < 1 && Math.abs(rc.standard.finish - 45) < 1);
  assert.deepEqual(results(rc), Array(6).fill('counted'));
  assert.deepEqual(rc.summary(), { counted: 6, short: 0, unclear: 0 });
});

test('slower reps near failure still count — speed is never judged', () => {
  const reps = [1, 1, 1.4, 2, 2.8, 3.6].map((up) => ({ bottom: 170, top: 46, up }));
  const { rc } = run(curlTrace(reps));
  assert.deepEqual(results(rc), Array(6).fill('counted'));
});

test('missing the Finish (top) makes the rep short and worth zero', () => {
  const reps = [{ bottom: 170, top: 45 }, { bottom: 170, top: 45 }, { bottom: 170, top: 70 }, { bottom: 170, top: 95 }];
  const { rc } = run(curlTrace(reps));
  assert.deepEqual(results(rc), ['counted', 'counted', 'short', 'short']);
  assert.equal(rc.reps[2].shortFinish, true);
  assert.equal(rc.reps[2].shortStart, false);
  assert.equal(rc.summary().counted, 2);
});

test('not returning to the full stretch (Start) makes the next rep short', () => {
  const reps = [{ bottom: 170, top: 45 }, { bottom: 170, top: 45 }, { bottom: 140, top: 45 }, { bottom: 170, top: 45 }];
  const { rc } = run(curlTrace(reps));
  assert.deepEqual(results(rc), ['counted', 'counted', 'short', 'counted']);
  assert.equal(rc.reps[2].shortStart, true);
});

test('small camera wobble inside the tolerance band does not cost reps', () => {
  const reps = [{ bottom: 170, top: 45 }, { bottom: 166, top: 50 }, { bottom: 172, top: 48 }, { bottom: 165, top: 51 }];
  const { rc } = run(curlTrace(reps, { noise: 2 }));
  assert.deepEqual(results(rc), Array(4).fill('counted'));
});

test('jitter at rest never invents reps', () => {
  const { rc } = run(curlTrace([{ bottom: 170, top: 45 }], { noise: 6, seed: 7 }));
  assert.equal(rc.reps.length, 1);
});

test('losing the arm mid-rep marks it unclear, not short', () => {
  const trace = curlTrace(Array(3).fill({ bottom: 170, top: 45 }));
  // Drop ~0.8 s of tracking in the middle of rep 3's lift.
  const t3 = trace.filter((f) => f.a < 120).map((f) => f.t);
  const mid = t3[Math.floor(t3.length * 0.8)];
  for (const f of trace) if (f.t > mid - 0.4 && f.t < mid + 0.4) f.ok = false;
  const { rc } = run(trace);
  assert.equal(rc.reps.length, 3);
  assert.equal(rc.reps[2].result, 'unclear');
  assert.equal(rc.summary().counted, 2);
});

test('re-lock makes the next full rep the new standard', () => {
  const rc = createRepCounter();
  for (const f of curlTrace([{ bottom: 150, top: 70 }, { bottom: 150, top: 70 }])) rc.push(f.t, f.a, f.ok);
  rc.relock();
  const t0 = rc.reps.length;
  let events = [];
  for (const f of curlTrace([{ bottom: 172, top: 44 }, { bottom: 150, top: 70 }])) { const e = rc.push(f.t + 100, f.a, f.ok); if (e) events.push(e); }
  assert.equal(events[0].type, 'standard');
  assert.ok(rc.standard.start > 168);
  assert.equal(rc.reps[t0 + 1].result, 'short'); // the old, shorter range now falls short
});

test('a short rep 1 can be corrected by the user afterwards', () => {
  const { rc } = run(curlTrace([{ bottom: 170, top: 45 }, { bottom: 170, top: 80 }]));
  assert.equal(rc.reps[1].result, 'short');
  rc.override(2, 'counted');
  assert.equal(rc.summary().counted, 2);
});

test('helpers: joint angle, smoothing, person lock, arm visibility', () => {
  assert.equal(Math.round(jointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(jointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 180);
  const f = oneEuro(); let v; for (let i = 0; i < 30; i++) v = f.filter(100 + (i % 2 ? 4 : -4), i / 30);
  assert.ok(Math.abs(v - 100) < 4);
  const person = (cx, size, vis = 0.9) => { const p = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: vis })); p[11] = { x: cx - 0.05, y: 0.3, visibility: vis }; p[12] = { x: cx + 0.05, y: 0.3, visibility: vis }; p[23] = { x: cx - 0.05, y: 0.3 + size, visibility: vis }; p[24] = { x: cx + 0.05, y: 0.3 + size, visibility: vis }; return p; };
  const lifter = person(0.5, 0.4), passer = person(0.8, 0.5);
  assert.equal(pickPerson([lifter, passer], null), 1);                // largest first
  assert.equal(pickPerson([passer, lifter], { x: 0.5, y: 0.3 }), 1);  // then stays on the lifter
  assert.equal(pickPerson([passer], { x: 0.5, y: 0.3 }), -1);         // passer can't steal the track
  assert.ok(armVisibility(lifter, 'left') > 0.8);
});

test('easier standard: a curl that stops ~15° short of the top still counts', () => {
  const { rc } = run(curlTrace([{ bottom: 170, top: 45 }, { bottom: 170, top: 60 }, { bottom: 158, top: 45 }]));
  assert.deepEqual(results(rc), ['counted', 'counted', 'counted']);
});

// ── Squat / bench: down-and-up lifts judged when you come back up ───────
import { createReturnCounter, createHeightTracker, HEIGHT_DEFAULTS, midpoint } from '../services/repEngine.js';

// Height trace at 30 fps: stand at `start`, then per rep go down to `depth`,
// pause, and come back up to `lockout` (default: the starting height).
function squatTrace(reps, { start = 100, fps = 30, noise = 0, seed = 3 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = []; let t = 0, v = start;
  const hold = (secs) => { for (let i = 0; i < secs * fps; i++) { out.push({ t, a: v + noise * rnd(), ok: true }); t += 1 / fps; } };
  const move = (to, secs) => { const v0 = v, n = Math.round(secs * fps); for (let i = 1; i <= n; i++) { v = v0 + (to - v0) * (1 - Math.cos((Math.PI * i) / n)) / 2; out.push({ t, a: v + noise * rnd(), ok: true }); t += 1 / fps; } };
  hold(1);
  for (const r of reps) { move(r.depth, r.down ?? 1.2); hold(0.3); move(r.lockout ?? start, r.up ?? 1); hold(r.rest ?? 0.6); }
  return out;
}
const runReturn = (trace) => { const rc = createReturnCounter(HEIGHT_DEFAULTS); const events = []; for (const f of trace) { const e = rc.push(f.t, f.a, f.ok); if (e) events.push({ ...e, t: f.t, v: f.a }); } return { rc, events }; };

test('squat: rep 1 locks lockout and depth; matching reps all count', () => {
  const { rc, events } = runReturn(squatTrace(Array(5).fill({ depth: 52 })));
  assert.equal(events[0].type, 'standard');
  assert.ok(Math.abs(rc.standard.start - 100) < 1 && Math.abs(rc.standard.finish - 52) < 1);
  assert.deepEqual(results(rc), Array(5).fill('counted'));
  for (const r of rc.reps) assert.ok(r.bottom > 99, `recorded lockout ${r.bottom.toFixed(1)} should be the real top`);
});

test('squat: a rep counts when you stand back up, not at the bottom', () => {
  const { events } = runReturn(squatTrace([{ depth: 52 }, { depth: 52 }]));
  for (const e of events) assert.ok(e.v > 85, `counted at height ${e.v.toFixed(1)}, should be near lockout`);
});

test('squat: a shallow rep is short (missed the depth)', () => {
  const { rc } = runReturn(squatTrace([{ depth: 52 }, { depth: 54 }, { depth: 72 }, { depth: 52 }]));
  assert.deepEqual(results(rc), ['counted', 'counted', 'short', 'counted']);
  assert.equal(rc.reps[2].shortFinish, true);
  assert.equal(rc.reps[2].shortStart, false);
});

test('squat: not standing all the way up makes that rep short; the next one still counts', () => {
  const { rc } = runReturn(squatTrace([{ depth: 52 }, { depth: 52, lockout: 80 }, { depth: 52 }]));
  assert.deepEqual(results(rc), ['counted', 'short', 'counted']);
  assert.equal(rc.reps[1].shortStart, true);
});

test('squat: staying at the bottom when the set ends is not a rep', () => {
  const trace = squatTrace([{ depth: 52 }, { depth: 52 }]);
  const end = trace[trace.length - 1].t;
  for (let i = 1; i <= 30; i++) trace.push({ t: end + i / 30, a: 100 - (48 * i) / 30, ok: true }); // goes down, never comes up
  const { rc } = runReturn(trace);
  assert.equal(rc.reps.length, 2);
});

test('squat: noise and small dips at the top never invent reps', () => {
  const trace = squatTrace([{ depth: 52 }, { depth: 92, down: 0.4, up: 0.4 }, { depth: 52 }], { noise: 2 });
  const { rc } = runReturn(trace);
  assert.equal(rc.reps.length, 2);
  assert.deepEqual(results(rc), ['counted', 'counted']);
});

// Synthetic poses in 0–1 image coordinates. `hipY` moves; feet stay planted.
function legPose({ hipY, ankleY = 0.85, kneeX = 0.5, vis = 0.95 }) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const kneeY = (hipY + ankleY) / 2;
  Object.assign(p, {
    11: { x: 0.46, y: hipY - 0.3, visibility: vis }, 12: { x: 0.54, y: hipY - 0.3, visibility: vis },
    23: { x: 0.46, y: hipY, visibility: vis }, 24: { x: 0.54, y: hipY, visibility: vis },
    25: { x: kneeX - 0.04, y: kneeY, visibility: vis }, 26: { x: kneeX + 0.04, y: kneeY, visibility: vis },
    27: { x: 0.46, y: ankleY, visibility: vis }, 28: { x: 0.54, y: ankleY, visibility: vis },
  });
  return p;
}

test('squat height: same reading whatever the thigh looks like, and the lines stay put', () => {
  const tr = createHeightTracker('squat');
  for (let i = 0; i < 10; i++) assert.equal(tr.calibrate(legPose({ hipY: 0.45 }), 720, 1280).ok, true);
  assert.equal(tr.lock(), true);
  const lineBefore = tr.lineY(52);
  // From behind the thigh foreshortens: here the knee also swings sideways.
  // Only hip height above the feet matters.
  const a = tr.measure(legPose({ hipY: 0.65, kneeX: 0.5 }), 720, 1280);
  const b = tr.measure(legPose({ hipY: 0.65, kneeX: 0.62 }), 720, 1280);
  assert.ok(Math.abs(a.value - 50) < 0.5 && Math.abs(b.value - 50) < 0.5);
  assert.ok(Math.abs(tr.lineY(52) - lineBefore) < 0.01, 'Start / Finish lines must not move with the body');
  assert.ok(Math.abs(tr.measure(legPose({ hipY: 0.45 }), 720, 1280).value - 100) < 0.5);
});

test('squat height: calibration waits for feet in frame and straight legs', () => {
  const tr = createHeightTracker('squat');
  const noFeet = legPose({ hipY: 0.45 }); noFeet[27].visibility = 0; noFeet[28].visibility = 0;
  assert.deepEqual(tr.calibrate(noFeet, 720, 1280), { ok: false, why: 'feet' });
  const bent = legPose({ hipY: 0.6, kneeX: 0.7 });
  assert.deepEqual(tr.calibrate(bent, 720, 1280), { ok: false, why: 'stand' });
  assert.equal(tr.lock(), false);
});

test('bench height: bar height above the shoulders, hands must be visible', () => {
  const pose = (wristY, wristVis = 0.95) => {
    const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    Object.assign(p, {
      11: { x: 0.42, y: 0.6, visibility: 0.95 }, 12: { x: 0.58, y: 0.6, visibility: 0.95 },
      15: { x: 0.36, y: wristY, visibility: wristVis }, 16: { x: 0.64, y: wristY, visibility: wristVis },
    });
    return p;
  };
  const tr = createHeightTracker('bench');
  assert.deepEqual(tr.calibrate(pose(0.3, 0), 1280, 720), { ok: false, why: 'hands' });
  for (let i = 0; i < 10; i++) tr.calibrate(pose(0.3), 1280, 720);
  assert.equal(tr.lock(), true);
  // Shoulder width = 0.16 × 1280 = 204.8 px. Wrists at shoulder level read 100.
  assert.ok(Math.abs(tr.measure(pose(0.6), 1280, 720).value - 100) < 0.5);
  const lock = tr.measure(pose(0.3), 1280, 720).value;
  assert.ok(Math.abs(lock - (100 + (0.3 * 720 / 204.8) * 100)) < 0.5);
  assert.ok(Math.abs(tr.calValue - lock) < 0.5);
  assert.equal(tr.measure(pose(0.3, 0), 1280, 720).ok, false);
});

test('midpoint uses whichever side is visible', () => {
  const p = legPose({ hipY: 0.5 }); p[24].visibility = 0;
  const m = midpoint(p, [23, 24], 100, 100);
  assert.equal(m.n, 1); assert.ok(Math.abs(m.x - 46) < 1e-9);
});
