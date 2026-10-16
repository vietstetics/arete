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
