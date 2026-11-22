import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFTS, createLiftTracker } from '../services/liftTrackers.js';
import { createRepCounter } from '../services/repEngine.js';
import { demoLiftPose, demoPlan, DEMO_RANGE } from '../services/liftDemo.js';
import { liftFeatures } from '../services/liftFeatures.js';
import { concentricVelocity } from '../services/velocity.js';

const FPS = 30;
// Deterministic noise (the same every run).
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

/** A set: hold, then each [start, finish] rep with a smooth there-and-back, as a list of values. */
function setValues(plan) {
  const out = [], hold = (v, s) => { for (let i = 0; i < s * FPS; i++) out.push(v); };
  const move = (a, b, s) => { const n = Math.round(s * FPS); for (let i = 1; i <= n; i++) out.push(a + ((b - a) * (1 - Math.cos((Math.PI * i) / n))) / 2); };
  hold(plan[0][0], 1);
  plan.forEach(([s, f], i) => { hold(s, 0.25); move(s, f, 1); hold(f, 0.2); move(f, plan[i + 1] ? plan[i + 1][0] : plan[0][0], 1.2); });
  hold(plan[0][0], 1);
  return out;
}

function run(lift, values, { noise = 0, spikes = 0, seed = 1, edit = null, opts = {} } = {}) {
  const def = LIFTS[lift], tr = createLiftTracker(lift, opts);
  const rc = createRepCounter({ minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2 });
  const r = rng(seed), trace = [];
  values.forEach((v, i) => {
    const t = i / FPS;
    const { pose, world } = demoLiftPose(lift, v);
    if (noise || spikes) {
      for (const q of pose) { q.x += (r() - 0.5) * noise; q.y += (r() - 0.5) * noise; }
      for (const q of world) { q.x += (r() - 0.5) * noise; q.y += (r() - 0.5) * noise; q.z += (r() - 0.5) * noise; }
      if (spikes && r() < spikes) { const j = [13, 14, 15, 16, 25, 26, 27, 28][Math.floor(r() * 8)]; world[j].x += 0.3; world[j].y -= 0.25; pose[j].x += 0.1; }
    }
    if (edit) edit(pose, world, t, v);
    const m = tr.push(t, [pose], [world], 1280, 720);
    trace.push({ t, y: m.path });
    rc.push(t, m.value, m.ok);
  });
  return { ...rc.summary(), reps: rc.reps, trace, tr };
}

for (const lift of Object.keys(LIFTS)) {
  test(`${lift}: every rep found; rep 4 (missed finish) and rep 6 (missed start) are short`, () => {
    const s = run(lift, setValues(demoPlan(...DEMO_RANGE[lift])));
    assert.deepEqual([s.counted, s.short, s.unclear], [5, 2, 0], JSON.stringify(s.reps.map((x) => [x.result, Math.round(x.bottom), Math.round(x.top)])));
  });
  test(`${lift}: still exact with pose jitter and joints that jump for a frame`, () => {
    const s = run(lift, setValues(demoPlan(...DEMO_RANGE[lift])), { noise: 0.004, spikes: 0.03, seed: 7 });
    assert.equal(s.counted + s.short, 7, JSON.stringify(s.reps.map((x) => [x.result, Math.round(x.bottom), Math.round(x.top)])));
    assert.equal(s.counted, 5);
  });
}

test('the moving point’s path gives each rep a speed in body units (no norm: only what the camera saw)', () => {
  const s = run('triceps', setValues(demoPlan(...DEMO_RANGE.triceps)));
  const v = s.reps.map((r) => concentricVelocity(s.trace, r.startT - 0.15, r.topT + 0.15)).map((x) => x && x.mv);
  assert.ok(v.every((x) => x > 0), JSON.stringify(v));
  // Reps 1–3 move the same range in the same time: the same speed.
  assert.ok(Math.abs(v[0] - v[2]) / v[0] < 0.08, JSON.stringify(v));
});

test('alternating curls: a hidden far arm that only copies the near arm is never counted', () => {
  // Left (near) curls; right (far) is barely seen and mirrors the left exactly.
  const vals = setValues([[165, 50], [165, 50], [165, 50]]);
  const edit = (pose) => { for (const i of [14, 16]) pose[i].visibility = 0.15; };
  const near = run('curl', vals, { edit, opts: { side: 'L', otherRest: 25 } });
  const far = run('curl', vals, { edit, opts: { side: 'R', otherRest: 25 } });
  assert.equal(near.counted, 3);
  assert.equal(far.counted + far.short + far.unclear, 0);
});

test('alternating curls: a faint far arm curling while the near arm hangs straight is counted', () => {
  const vals = setValues([[165, 50], [165, 50], [165, 50]]);
  const edit = (pose, world, t, v) => {
    // Near (left) arm hangs straight; the far (right) arm does the curl, barely seen.
    const straight = demoLiftPose('curl', 170);
    for (const i of [13, 15]) { pose[i] = { ...straight.pose[i] }; world[i] = { ...straight.world[i] }; }
    for (const i of [14, 16]) pose[i].visibility = 0.15;
  };
  const far = run('curl', vals, { edit, opts: { side: 'R', otherRest: 25 } });
  assert.equal(far.counted, 3);
});

test('pushes filmed from in front are read from how big the hands look', () => {
  // Facing the phone (world z = the chest's direction); the 3D reach barely changes, the hands grow.
  const vals = setValues(demoPlan(42, 4));
  // The model's flat guess: from the front it can't see the arms come forward at all.
  const edit = (pose, world) => { for (const i of [13, 14, 15, 16]) world[i].z = world[i < 15 ? i - 2 : i - 4].z; };
  const handsAt = (v) => { const size = 0.03 * Math.exp((42 - v) / 100); return ['L', 'R'].map((s, k) => Array.from({ length: 21 }, (_, j) => ({ x: (k ? 0.45 : 0.55) + (j % 5) * size / 4, y: 0.3 + Math.floor(j / 5) * size / 4 }))); };
  const tr = createLiftTracker('press'), def = LIFTS.press;
  const rc = createRepCounter({ minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2 });
  vals.forEach((v, i) => {
    const { pose, world } = demoLiftPose('press', v, { front: true }); edit(pose, world);
    // The hand model's palms, placed on each wrist in the picture.
    const hs = handsAt(v).map((h, k) => { const w = pose[k ? 16 : 15]; return h.map((q) => ({ x: q.x - h[0].x + w.x, y: q.y - h[0].y + w.y })); });
    const m = tr.push(i / FPS, [pose], [world], 1280, 720, hs);
    rc.push(i / FPS, m.value, m.ok);
  });
  assert.equal(tr.mode, 'palm');
  assert.deepEqual([rc.summary().counted, rc.summary().short], [5, 2]);
});

test('a hand that isn’t on the lifter’s wrist (someone behind) is ignored', () => {
  const { pose, world } = demoLiftPose('press', 20);
  const far = Array.from({ length: 21 }, () => ({ x: 0.95, y: 0.9 }));
  assert.ok(Number.isNaN(liftFeatures(pose, world, { vw: 1280, vh: 720, hands: [far] }).palmL));
});

// Another person in the picture: a copy of a pose, moved and scaled in the picture.
function person(lift, v, { dx = 0, scale = 1 } = {}) {
  const { pose, world } = demoLiftPose(lift, v);
  return { pose: pose.map((q) => ({ ...q, x: 0.5 + (q.x - 0.5) * scale + dx, y: 0.5 + (q.y - 0.5) * scale })), world };
}
function runPeople(lift, values, others) {
  const def = LIFTS[lift], tr = createLiftTracker(lift);
  let rc = createRepCounter({ minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2 });
  values.forEach((v, i) => {
    const t = i / FPS, me = demoLiftPose(lift, v), extra = others(t).map((o) => person(o.lift || lift, o.v, o));
    const ps = [...extra.map((e) => e.pose), me.pose], ws = [...extra.map((e) => e.world), me.world];
    const m = tr.push(t, ps, ws, 1280, 720);
    if (m.switched) rc = createRepCounter({ minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2 });
    rc.push(t, m.value, m.ok);
  });
  return rc.summary();
}

test('a bigger person standing still behind the machine is never mistaken for the lifter', () => {
  // They stand bent-armed (on their phone) to one side, bigger in the picture than the lifter.
  const s = runPeople('triceps', setValues(demoPlan(...DEMO_RANGE.triceps)), () => [{ v: 90, dx: 0.3, scale: 1.15 }]);
  assert.ok(s.counted >= 4, JSON.stringify(s)); // rep 1 may go by while the lifter is first being found
  assert.equal(s.unclear, 0);
});

test('someone walking right across in front of the lifter adds no reps', () => {
  const vals = setValues(demoPlan(...DEMO_RANGE.fly));
  // A much bigger (nearer) person crosses the picture from left to right between 6 and 8 s.
  const s = runPeople('fly', vals, (t) => (t > 6 && t < 8 ? [{ lift: 'curl', v: 170, dx: -0.6 + 0.6 * (t - 6), scale: 1.8 }] : []));
  assert.equal(s.counted + s.short + s.unclear, 7, JSON.stringify(s));
});

test('triceps filmed close: elbow out of the picture, counted from the hand alone', () => {
  const vals = setValues(demoPlan(...DEMO_RANGE.triceps));
  const def = LIFTS.triceps, tr = createLiftTracker('triceps');
  let rc = null, minR = null;
  vals.forEach((v, i) => {
    const t = i / FPS, { pose, world } = demoLiftPose('triceps', v);
    for (const j of [13, 14, 15, 16]) pose[j].visibility = 0.1; // the model can't find the elbows or wrists
    // The hand model still sees the hand: 21 points around the wrist, a palm 0.04 of the picture wide.
    const w = pose[15], hand = Array.from({ length: 21 }, (_, j) => ({ x: w.x + (j % 5) * 0.01, y: w.y + Math.floor(j / 5) * 0.01 }));
    const m = tr.push(t, [pose], [world], 1280, 720, [hand]);
    if (tr.counter.minRange !== minR) { minR = tr.counter.minRange; rc = createRepCounter({ ...tr.counter, tolFloor: tr.counter.hysteresis / 2 }); }
    rc.push(t, m.value, m.ok);
  });
  assert.equal(tr.mode, 'hand');
  // Every rep is found. Near lockout the hand's straight-line travel changes less than the elbow angle,
  // so a rep stopping a little short of lockout can pass in hand mode; one that doesn't go back to the
  // start, or doesn't come close to lockout, is still caught.
  const sm = rc.summary();
  assert.equal(sm.counted + sm.short, 7, JSON.stringify(rc.reps.map((r) => [r.result, Math.round(r.bottom), Math.round(r.top)])));
  assert.ok(rc.reps.some((r) => r.result === 'short'), JSON.stringify(rc.reps.map((r) => [r.result, Math.round(r.bottom), Math.round(r.top)])));
});

test('triceps: an elbow that stops giving readings hands over to the hand, even after a rep-sized move', () => {
  // A rep-sized elbow movement while getting set (fixes the measure), then the set itself with the
  // elbow and wrist out of the picture: it must still move to the hand and count from there.
  const vals = setValues(demoPlan(...DEMO_RANGE.triceps));
  const tr = createLiftTracker('triceps');
  let rc = null, minR = null, t = 0;
  const step = (v, hidden) => {
    const { pose, world } = demoLiftPose('triceps', v);
    if (hidden) for (const j of [13, 14, 15, 16]) pose[j].visibility = 0.65; // scored as seen, yet unreadable:
    if (hidden) for (const j of [13, 15]) { pose[j].x = NaN; world[j].x = NaN; }   // no usable elbow angle
    const w = demoLiftPose('triceps', v).pose[15], hand = Array.from({ length: 21 }, (_, j) => ({ x: w.x + (j % 5) * 0.01, y: w.y + Math.floor(j / 5) * 0.01 }));
    const m = tr.push(t, [pose], [world], 1280, 720, [hand]); t += 1 / FPS;
    if (tr.counter.minRange !== minR) { minR = tr.counter.minRange; rc = createRepCounter({ ...tr.counter, tolFloor: tr.counter.hysteresis / 2 }); }
    rc.push(t, m.value, m.ok);
  };
  for (let i = 0; i < 90; i++) step(150 - 70 * Math.sin((Math.PI * i) / 90), false); // the setup move, elbow seen
  for (const v of vals) step(v, true);
  assert.equal(tr.mode, 'hand');
  const sm = rc.summary();
  assert.ok(sm.counted >= 4, JSON.stringify(sm));
});

test('triceps: once two full reps are counted, the measure stays (walking off at the end cannot wipe the set)', () => {
  // A set read from the elbow, then the lifter walks off: the elbow stops giving readings. Locked after
  // two full reps (as the camera page does), the tracker keeps the elbow instead of restarting on the hand.
  const vals = setValues(demoPlan(...DEMO_RANGE.triceps));
  const tr = createLiftTracker('triceps');
  const rc = createRepCounter({ ...tr.counter, tolFloor: tr.counter.hysteresis / 2 });
  let t = 0, switched = false;
  const step = (v, hidden) => {
    const { pose, world } = demoLiftPose('triceps', v);
    if (hidden) for (const j of [13, 15]) { pose[j].x = NaN; world[j].x = NaN; pose[j].visibility = 0.2; }
    const w = demoLiftPose('triceps', v).pose[15], hand = Array.from({ length: 21 }, (_, j) => ({ x: w.x + (j % 5) * 0.01, y: w.y + Math.floor(j / 5) * 0.01 }));
    const m = tr.push(t, [pose], [world], 1280, 720, [hand]); t += 1 / FPS;
    switched ||= m.switched;
    const ev = rc.push(t, m.value, m.ok);
    if (ev && ev.rep && rc.reps.filter((r) => r.result === 'counted').length >= 2) tr.lock();
  };
  for (const v of vals) step(v, false);
  assert.equal(tr.mode, 'joints');
  const before = rc.summary().counted;
  assert.ok(before >= 2, JSON.stringify(rc.summary()));
  for (let i = 0; i < 120; i++) step(vals[vals.length - 1], true); // walks off: 4 s of unreadable elbow
  assert.equal(tr.mode, 'joints');
  assert.equal(switched, false);
  assert.equal(rc.summary().counted, before);
});
