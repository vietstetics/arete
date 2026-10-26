import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPosture, createLiftDetector, lowPass, countBarReps, moveFits } from '../services/sbd.js';
import { liftTrajectory } from '../demo/scene3d.js';

// ── Poses: picture coordinates in pixels (y down), turned into 0–1 landmarks ──
const VW = 1280, VH = 720;
function pose(joints) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  for (const [i, [x, y]] of Object.entries(joints)) p[i] = { x: x / VW, y: y / VH, visibility: 0.95 };
  return p;
}
// Side view, facing right, feet at y 650. Arms 140 + 130 px, torso 170, thigh and shin 125.
const squatSide = () => pose({ 11: [640, 250], 12: [636, 252], 13: [610, 320], 14: [606, 322], 15: [650, 240], 16: [646, 242],
  23: [630, 420], 24: [626, 422], 25: [640, 540], 26: [636, 542], 27: [635, 650], 28: [631, 652] });
// From behind: hands wide on the bar at shoulder height, elbows down.
const squatBack = () => pose({ 11: [590, 250], 12: [690, 250], 13: [560, 330], 14: [720, 330], 15: [530, 245], 16: [750, 245],
  23: [605, 420], 24: [675, 420], 25: [600, 540], 26: [680, 540], 27: [600, 650], 28: [680, 650] });
// Bench from past the feet (torso foreshortened), arms locked out above the chest.
const benchFeet = () => pose({ 11: [560, 400], 12: [720, 400], 13: [540, 300], 14: [740, 300], 15: [545, 175], 16: [735, 175],
  23: [590, 500], 24: [690, 500], 25: [560, 560], 26: [720, 560], 27: [540, 640], 28: [740, 640] });
// Bench from the side: torso horizontal, arms up.
const benchSide = () => pose({ 11: [500, 420], 12: [505, 418], 13: [505, 290], 14: [510, 288], 15: [500, 160], 16: [505, 158],
  23: [680, 425], 24: [685, 423], 25: [790, 400], 26: [795, 398], 27: [800, 520], 28: [805, 518] });
// Deadlift set-up from the side: hips back, shoulders over the bar, arms straight down to the shins.
const deadSetup = () => pose({ 11: [712, 383], 12: [708, 385], 13: [712, 484], 14: [708, 486], 15: [712, 585], 16: [708, 587],
  23: [571, 482], 24: [567, 484], 25: [682, 533], 26: [678, 535], 27: [640, 648], 28: [636, 650] });
// Standing tall, arms hanging (walking up to the bar, or a deadlift's lockout): not a set-up.
const standing = () => pose({ 11: [640, 230], 12: [636, 232], 13: [642, 330], 14: [638, 332], 15: [644, 430], 16: [640, 432],
  23: [640, 404], 24: [636, 406], 25: [640, 526], 26: [636, 528], 27: [640, 648], 28: [636, 650] });

test('the set-up names the lift: hands on the back (squat), arms up (bench), hands at the shins (deadlift)', () => {
  const c = (p) => classifyPosture(p, { vw: VW, vh: VH }).lift;
  assert.equal(c(squatSide()), 'squat');
  assert.equal(c(squatBack()), 'squat');
  assert.equal(c(benchFeet()), 'bench');
  assert.equal(c(benchSide()), 'bench');
  assert.equal(c(deadSetup()), 'deadlift');
  assert.equal(c(standing()), null, 'arms hanging while standing is not a set-up');
});

test('filmed from low down: the plates hide the hands, or the upper body looks short — still recognised', () => {
  const c = (p) => classifyPosture(p, { vw: VW, vh: VH }).lift;
  const hideArms = (p) => { for (const i of [13, 14, 15, 16]) p[i].visibility = 0.2; return p; };
  assert.equal(c(hideArms(squatSide())), 'squat', 'standing tall, hands out of sight: the bar is on the back');
  assert.equal(c(hideArms(deadSetup())), 'deadlift', 'hips bent, trunk leaning over the bar');
  assert.equal(c(hideArms(benchSide())), 'bench', 'lying, hips level with the shoulders');
  // A lens near the floor: everything above the hips foreshortened.
  const low = squatSide();
  for (const i of [11, 12, 13, 14, 15, 16]) low[i] = { ...low[i], y: 420 / VH - (420 / VH - low[i].y) * 0.65 };
  assert.equal(c(low), 'squat');
  const lowDead = deadSetup();
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24]) lowDead[i] = { ...lowDead[i], y: 648 / VH - (648 / VH - lowDead[i].y) * 0.8 };
  assert.equal(c(lowDead), 'deadlift');
  const none = squatSide(); for (const i of [11, 12, 13, 14, 15, 16]) none[i].visibility = 0.2;
  assert.equal(c(none), null, 'neither arms nor shoulders: no guess');
});

test('the lift is settled once the set-up holds for 0.4 s; walking up to the bar settles nothing', () => {
  const det = createLiftDetector();
  let got = null, at = NaN;
  for (let i = 0; i < 30; i++) { const r = det.push(i / 30, standing(), VW, VH); assert.equal(r, null); }
  for (let i = 30; i < 60 && !got; i++) { got = det.push(i / 30, deadSetup(), VW, VH); at = i / 30; }
  assert.equal(got, 'deadlift');
  assert.ok(at - 1 >= 0.3 && at - 1 <= 0.5, `settled ${(at - 1).toFixed(2)} s into the set-up`);
  // A flickering frame doesn't stop it; a mixed picture never settles.
  const mixed = createLiftDetector();
  for (let i = 0; i < 60; i++) assert.equal(mixed.push(i / 30, i % 2 ? squatSide() : benchFeet(), VW, VH), null);
  const flicker = createLiftDetector();
  let r = null;
  for (let i = 0; i < 40 && !r; i++) r = flicker.push(i / 30, i % 10 === 5 ? standing() : benchFeet(), VW, VH);
  assert.equal(r, 'bench');
});

test('low-pass: a constant passes unchanged, slow movement keeps its size, fast wobble is removed', () => {
  const fs = 30, n = 300;
  const flat = lowPass(new Array(n).fill(0.7), { fs, cutoffHz: 1.5 });
  assert.ok(flat.every((y) => Math.abs(y - 0.7) < 1e-9));
  const slow = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 0.5 * i) / fs));
  const fast = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 6 * i) / fs));
  const amp = (ys) => Math.max(...ys.slice(60, 240).map(Math.abs));
  assert.ok(amp(lowPass(slow, { fs, cutoffHz: 1.5 })) > 0.98);
  assert.ok(amp(lowPass(fast, { fs, cutoffHz: 1.5 })) < 0.01);
  // Zero phase: the slow wave's peaks stay where they were.
  const f = lowPass(slow, { fs, cutoffHz: 1.5 }), peak = (ys) => ys.slice(60, 120).indexOf(Math.max(...ys.slice(60, 120)));
  assert.ok(Math.abs(peak(f) - peak(slow)) <= 1);
});

// The bar's height as a camera would give it: frame times with jitter, a few mm of noise, some frames lost.
function filmed(traj, { fps = 30, noiseM = 0.002, seed = 7, lose = 0 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const out = [];
  for (let t = 0.013; t < traj.duration; t += 1 / fps) {
    const ts = t + 0.002 * (rnd() - 0.5);
    out.push({ t: ts, y: rnd() < lose ? NaN : traj.height(ts) + noiseM * gauss() });
  }
  return out;
}

test('bar-path reps: squat, bench (touch-and-go) and deadlift (from the floor) are each counted once per rep', () => {
  const sets = [
    { lift: 'squat', traj: liftTrajectory({ reps: [0.7, 0.8, 0.95, 1.1, 1.4].map((T) => ({ T, D: 0.5 })), ecc: 1.3, pauseBottom: 0.1 }) },
    { lift: 'bench', traj: liftTrajectory({ reps: [0.45, 0.5, 0.55, 0.7, 0.9, 1.2].map((T) => ({ T, D: 0.36 })), ecc: 0.6, pauseBottom: 0, pauseTop: 0.15 }) },
    { lift: 'deadlift', traj: liftTrajectory({ reps: [0.8, 0.9, 1.0, 1.3].map((T) => ({ T, D: 0.55 })), ecc: 0.9, pauseBottom: 0.4, startsAtBottom: true }) },
  ];
  for (const { lift, traj } of sets) for (const fps of [30, 60]) for (const lose of [0, 0.1]) {
    const r = countBarReps(filmed(traj, { fps, lose }), { lift });
    assert.equal(r.reps.length, traj.reps.length, `${lift} ${fps} fps, ${lose * 100}% lost: ${r.reps.length} vs ${traj.reps.length}`);
    assert.equal(moveFits(lift, r.firstMove), true, `${lift}: first move ${r.firstMove}`);
    r.reps.forEach((x, i) => {
      const tr = traj.reps[i];
      // Each counted rep is the true one: its rise lies over the true lift, its size close to the true distance.
      assert.ok(x.tBottom < tr.tStart + 0.2 && x.tTop > tr.tEnd - 0.2, `${lift} rep ${i + 1}: ${x.tBottom.toFixed(2)}–${x.tTop.toFixed(2)} vs ${tr.tStart.toFixed(2)}–${tr.tEnd.toFixed(2)}`);
      assert.ok(Math.abs(x.rom - tr.D) < 0.06, `${lift} rep ${i + 1}: ${x.rom.toFixed(3)} m vs ${tr.D}`);
    });
  }
});

test('an unrack, a walkout, a hitch on the way up and a re-rack never count; a grinder is one rep', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.8, D: 0.5 }, { T: 2.2, D: 0.48, dip: 0.6 }], ecc: 1.4, lead: 3, tail: 3 });
  const bumps = (t) => (t < 1 ? 0.04 * Math.sin(Math.PI * t) : 0) + (t > traj.duration - 2 ? -0.05 * Math.min(1, (t - traj.duration + 2) * 2) : 0);
  const hitch = (t) => (Math.abs(t - (traj.reps[1].tStart + 1.1)) < 0.15 ? -0.015 * Math.cos((Math.PI * (t - traj.reps[1].tStart - 1.1)) / 0.3) : 0);
  const samples = filmed({ duration: traj.duration, height: (t) => traj.height(t) + bumps(t) + hitch(t) }, { fps: 30 });
  const r = countBarReps(samples, { lift: 'squat' });
  assert.equal(r.reps.length, 2, JSON.stringify(r.reps.map((x) => x.rom.toFixed(3))));
});

test('a partial rep still moved the bar (it counts here; the pose judges it short); half-seen and gapped reps are marked', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.8, D: 0.5 }, { T: 0.5, D: 0.2 }, { T: 0.8, D: 0.5 }], ecc: 1.2 });
  assert.equal(countBarReps(filmed(traj), { lift: 'squat' }).reps.length, 3);
  // Two seconds not seen in the middle of rep 2's rise: still counted, marked as bridged.
  const s = filmed(traj).map((q) => (q.t > traj.reps[1].tStart && q.t < traj.reps[1].tStart + 0.4 ? { ...q, y: NaN } : q));
  const r = countBarReps(s, { lift: 'squat', maxGap: 0.2 });
  assert.equal(r.reps.length, 3);
  assert.equal(r.reps[1].gap, true);
  // A deadlift filmed from lockout on: the first lowering is not a rep (its lift wasn't seen).
  const dl = liftTrajectory({ reps: [{ T: 0.9, D: 0.55 }, { T: 1.0, D: 0.55 }], startsAtBottom: true, ecc: 1, lead: 0.5 });
  const late = filmed(dl).filter((q) => q.t > dl.reps[0].tEnd + 0.1);
  assert.equal(countBarReps(late, { lift: 'deadlift' }).reps.length, 1);
  assert.equal(countBarReps([], { lift: 'squat' }).reps.length, 0);
  assert.equal(countBarReps([{ t: 0, y: 0 }, { t: 0, y: 1 }, { t: 1, y: 0 }, { t: 2, y: 1 }]).reps.length, 0, 'out-of-order time is refused');
});
