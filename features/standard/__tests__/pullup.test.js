import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReturnCounter, createPullupTracker, createStillGate, PULLUP_DEFAULTS } from '../services/repEngine.js';

// ── Counter: nose height below the bar over time ────────────────────────
// Each rep: pull from the current hang to `top`, lower to `hang` (default
// 110). `sway` swings the hips sideways during the rep (torso lengths).
function pullTrace(reps, { start = 110, fps = 30 } = {}) {
  const out = []; let t = 0, v = start;
  const frame = (x = 0) => { out.push({ t, v, sway: [x, 1] }); t += 1 / fps; };
  const hold = (secs) => { for (let i = 0; i < secs * fps; i++) frame(); };
  const move = (to, secs, sway = 0) => {
    const v0 = v, n = Math.round(secs * fps);
    for (let i = 1; i <= n; i++) { v = v0 + (to - v0) * (1 - Math.cos((Math.PI * i) / n)) / 2; frame((sway / 2) * Math.sin((2 * Math.PI * i) / n)); }
  };
  hold(1);
  for (const r of reps) { move(r.top, 1, r.sway ?? 0); hold(0.2); move(r.hang ?? start, 1.2, r.sway ?? 0); hold(0.5); }
  return out;
}
const run = (trace) => {
  const rc = createReturnCounter(PULLUP_DEFAULTS), events = [];
  for (const f of trace) { const e = rc.push(f.t, f.v, true, f.sway); if (e) events.push(e); }
  return { rc, events };
};
const results = (rc) => rc.reps.map((r) => r.result);

test('rep 1 sets the standard from a full range', () => {
  const { rc, events } = run(pullTrace([{ top: -20 }, { top: -20 }, { top: -21 }]));
  assert.equal(events.find((e) => e.type !== 'finish').type, 'standard');
  assert.ok(Math.abs(rc.standard.start - 110) < 0.5 && Math.abs(rc.standard.finish + 20) < 0.5);
  assert.deepEqual(results(rc), ['counted', 'counted', 'counted']);
});

test('rep 1 sets the standard from a partial range too — no fixed rules', () => {
  const { rc } = run(pullTrace([{ top: 60 }, { top: 61 }, { top: -20 }, { top: 75 }]));
  assert.ok(Math.abs(rc.standard.finish - 60) < 0.5, 'Finish is wherever rep 1 got to');
  // Going higher than the standard is fine; falling short of it is not.
  assert.deepEqual(results(rc), ['counted', 'counted', 'counted', 'short']);
});

test('clean matching reps all count, and each gets one tick at the Finish line', () => {
  const { rc, events } = run(pullTrace(Array(5).fill({ top: -20 })));
  assert.deepEqual(results(rc), Array(5).fill('counted'));
  assert.equal(events.filter((e) => e.type === 'finish').length, 4); // reps 2–5: rep 1 has no line yet
});

test('top short: not reaching rep 1’s Finish is short — "Didn’t reach your top"', () => {
  // Tolerance = max(3, 3% of 130) = 3.9 units.
  const { rc } = run(pullTrace([{ top: -20 }, { top: -17 }, { top: -15 }]));
  assert.deepEqual(results(rc), ['counted', 'counted', 'short']);
  assert.equal(rc.reps[2].shortFinish, true);
  assert.equal(rc.reps[2].shortStart, false);
});

test('hang short: not lowering back to rep 1’s Start is short — "Didn’t reach your hang"', () => {
  const { rc } = run(pullTrace([{ top: -20 }, { top: -20, hang: 95 }, { top: -20 }]));
  assert.deepEqual(results(rc), ['counted', 'short', 'counted']);
  assert.equal(rc.reps[1].shortStart, true);
  assert.equal(rc.reps[1].shortFinish, false);
});

test('extra swing: more than rep 1’s sway + 10% of the torso is short — "Kipping"', () => {
  const { rc } = run(pullTrace([{ top: -20, sway: 0.04 }, { top: -20, sway: 0.1 }, { top: -20, sway: 0.2 }]));
  assert.ok(Math.abs(rc.standard.sway - 0.04) < 0.005);
  assert.deepEqual(results(rc), ['counted', 'counted', 'short']); // 0.10 ≤ 0.04 + 0.10; 0.20 is over
  assert.equal(rc.reps[2].shortSwing, true);
  assert.equal(rc.reps[2].shortFinish, false);
});

test('speed is never judged', () => {
  const trace = pullTrace([{ top: -20 }]);
  // A grinding rep 2: 4 s up.
  const slow = pullTrace([{ top: -20 }, { top: -20 }]).slice(trace.length);
  const stretched = slow.map((f, i) => ({ ...f, t: trace[trace.length - 1].t + (i + 1) * (4 / 30) }));
  const { rc } = run([...trace, ...stretched]);
  assert.deepEqual(results(rc), ['counted', 'counted']);
});

// ── Getting set up is never rep 1 ───────────────────────────────────────
test('setup moves (jumping up, a re-grip pull) never count: counting starts once you hang still', () => {
  const fps = 30, frames = []; let t = 0;
  const add = (v) => { frames.push({ t, v }); t += 1 / fps; };
  for (let i = 0; i < 20; i++) add(60 + i * 2.5);                                  // jump: dropping into the hang
  for (let i = 0; i <= 30; i++) add(110 - 35 * Math.sin((Math.PI * i) / 30));      // settling pull, 35 units
  for (let i = 0; i < 40; i++) add(110 + Math.sin(i) * 1.5);                       // hang still for 1.3 s
  const real = pullTrace([{ top: -20 }, { top: -20 }]).map((f) => ({ t: t + f.t, v: f.v }));
  const gate = createStillGate({ secs: 1, bands: [5] });
  const rc = createReturnCounter(PULLUP_DEFAULTS);
  let armed = false, armedAt = null;
  for (const f of [...frames, ...real]) {
    if (!armed) { armed = gate.push(f.t, [f.v]); if (armed) armedAt = f.t; continue; }
    rc.push(f.t, f.v, true);
  }
  assert.ok(armedAt > 2.3, `armed at ${armedAt}s, after the still hang`);
  assert.equal(rc.reps.length, 2);
  assert.ok(Math.abs(rc.standard.finish + 20) < 0.5, 'the settling pull did not become the standard');
});

test('still gate: movement never arms it, a dropout restarts the wait', () => {
  const g = createStillGate({ secs: 1, bands: [4, 0.05] });
  let armed = false;
  for (let i = 0; i < 90; i++) armed = g.push(i / 30, [100 + 10 * Math.sin(i / 5), 0]) || armed;
  assert.equal(armed, false);
  for (let i = 0; i < 25; i++) assert.equal(g.push(3 + i / 30, [100, 0]), false);
  g.push(3.9, [NaN, 0]);
  assert.equal(g.push(4, [100, 0]), false);
  let at = null;
  for (let i = 1; i <= 40; i++) if (g.push(4 + i / 30, [100, 0.01]) && at === null) at = 4 + i / 30;
  assert.ok(at >= 5 - 1e-9 && at < 5.1);
});

// ── Tracker: the bar line is fixed, the body moves ──────────────────────
// Portrait 720×1280. Bar at y = 190 px, hands 200 px apart. Upper arm 128 px,
// forearm 115 px. `v` = nose height below the bar in upper-arm % (the signal).
const VW = 720, VH = 1280, UA = 128, FA = 115;
function hangPose({ v = 110, barY = 190, hipX = 0, torsoScale = 1, wristDrop = 0 }) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
  const at = (x, y) => ({ x: x / VW, y: y / VH, visibility: 0.95 });
  const nose = barY + (v * UA) / 100, shY = nose + 90, hipY = shY + 300 * torsoScale;
  const W = [{ x: 260, y: barY + wristDrop }, { x: 460, y: barY + wristDrop }], S = [{ x: 317, y: shY }, { x: 403, y: shY }];
  // Elbow from the shoulder and wrist (two-link arm), bending outwards.
  const elbow = (s, w, out) => {
    const D = Math.hypot(w.x - s.x, w.y - s.y), ux = (w.x - s.x) / D, uy = (w.y - s.y) / D, d = Math.min(D, UA + FA - 1e-6);
    const a = (UA * UA - FA * FA + d * d) / (2 * d), h = Math.sqrt(Math.max(0, UA * UA - a * a));
    return { x: s.x + a * ux - out * h * uy, y: s.y + a * uy + out * h * ux };
  };
  const E = [elbow(S[0], W[0], 1), elbow(S[1], W[1], -1)];
  Object.assign(p, { 0: at(360, nose), 11: at(S[0].x, S[0].y), 12: at(S[1].x, S[1].y), 13: at(E[0].x, E[0].y), 14: at(E[1].x, E[1].y),
    15: at(W[0].x, W[0].y), 16: at(W[1].x, W[1].y), 23: at(330 + hipX, hipY), 24: at(390 + hipX, hipY) });
  return p;
}

test('tracker: locks the bar at the hands, not while they are still moving', () => {
  const tr = createPullupTracker();
  let t = 0, r;
  // Jumping up: hands rise from mid-frame to the bar.
  for (let i = 0; i <= 15; i++) { r = tr.track(hangPose({ v: 110, barY: 640 - i * 30 }), VW, VH, t); t += 1 / 30; }
  assert.equal(tr.locked, false);
  // Hanging, hands still: locks after ~0.5 s.
  let lockedAt = null;
  for (let i = 0; i < 30; i++) { r = tr.track(hangPose({ v: 110 }), VW, VH, t); if (r.justLocked) lockedAt = t; t += 1 / 30; }
  assert.ok(lockedAt !== null && lockedAt - 0.5 >= 0.49, `locked at ${lockedAt}`);
  assert.ok(Math.abs(tr.bar.y - 190) < 1e-6);
  assert.ok(Math.abs(tr.bar.upperArm - UA) < 1e-6);
});

test('tracker: the whole body moves, the bar line and Start / Finish lines never do', () => {
  const tr = createPullupTracker();
  let t = 0;
  for (let i = 0; i < 25; i++) { tr.track(hangPose({ v: 110 }), VW, VH, t); t += 1 / 30; }
  assert.equal(tr.locked, true);
  const bar0 = tr.bar, start0 = tr.lineY(110), finish0 = tr.lineY(-20);
  let last;
  for (let i = 0; i <= 120; i++) {
    const v = 45 + 65 * Math.cos((2 * Math.PI * i) / 60); // 110 → −20 → 110, twice
    last = tr.track(hangPose({ v, hipX: 25 * Math.sin(i / 7), torsoScale: 1 - 0.1 * Math.abs(Math.sin(i / 9)) }), VW, VH, t); t += 1 / 30;
    assert.deepEqual(tr.bar, bar0);
    assert.equal(tr.lineY(110), start0);
    assert.equal(tr.lineY(-20), finish0);
  }
  assert.equal(last.ok, true);
  for (let i = 0; i < 10; i++) { last = tr.track(hangPose({ v: -20 }), VW, VH, t); t += 1 / 30; }
  assert.ok(Math.abs(last.value + 20) < 0.5, `height ${last.value}`);
  assert.ok(Math.abs(finish0 - (190 - 0.2 * UA)) < 1e-6, 'Finish line sits 20% of an upper arm above the bar');
  assert.ok(Array.isArray(last.sway) && Math.abs(last.sway[1] - 1) < 0.2);
});

test('tracker: hands moving more than 10% of the arm re-lock the bar; small slips do not', () => {
  const tr = createPullupTracker();
  let t = 0, r;
  for (let i = 0; i < 25; i++) { tr.track(hangPose({ v: 110 }), VW, VH, t); t += 1 / 30; }
  const arm = tr.bar.arm;
  for (let i = 0; i < 30; i++) { r = tr.track(hangPose({ v: 110, wristDrop: 0.06 * arm }), VW, VH, t); t += 1 / 30; }
  assert.equal(tr.locked, true, 'a 6% slip keeps the bar');
  let unlocked = false;
  for (let i = 0; i < 30 && !unlocked; i++) { r = tr.track(hangPose({ v: 110, wristDrop: 0.2 * arm }), VW, VH, t); unlocked = !!r.justUnlocked; t += 1 / 30; }
  assert.ok(unlocked);
  for (let i = 0; i < 25; i++) { tr.track(hangPose({ v: 110, wristDrop: 0.2 * arm }), VW, VH, t); t += 1 / 30; }
  assert.equal(tr.locked, true);
  assert.ok(Math.abs(tr.bar.y - (190 + 0.2 * arm)) < 1e-6);
});

test('tracker: hands below the shoulders are not a bar', () => {
  const tr = createPullupTracker();
  const p = hangPose({ v: 110 });
  p[15].y = p[16].y = 0.6; // arms down by the sides
  let r;
  for (let i = 0; i < 40; i++) r = tr.track(p, VW, VH, i / 30);
  assert.equal(tr.locked, false);
  assert.equal(r.why, 'reach');
});
