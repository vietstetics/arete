import test from 'node:test';
import assert from 'node:assert/strict';
import { isoModeFor, analyseBaseline, analysePush, compareToUsual, pickSide, liveShake, liveAngle } from '../services/isometric.js';

// Seeded noise, so every run sees the same "camera".
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function gauss(rand) { return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()); }

// A side-on arm (right side visible): shoulder above the elbow, forearm forward → elbow 90°.
// noise: pose-model jitter (px) on every point; tremor: px at hz on the wrist and elbow; drift: degrees
// the forearm turns over the clip; lost: share of frames with the arm out of view.
function clip({ secs = 4, fps = 60, noise = 0.8, tremor = 0, hz = 8, drift = 0, lost = 0, seed = 1, tremorEnd = null, t0 = 0 } = {}) {
  const rand = rng(seed), frames = [];
  for (let i = 0; i < Math.round(secs * fps); i++) {
    const t = t0 + i / fps, u = i / Math.max(1, secs * fps - 1);
    const amp = tremorEnd === null ? tremor : tremor + (tremorEnd - tremor) * u;
    const shake = amp * Math.sin(2 * Math.PI * hz * t);
    const a = (90 + drift * u) * Math.PI / 180;
    const sh = { x: 300, y: 300 }, el = { x: 300, y: 450 };
    const wr = { x: el.x + 150 * Math.sin(a), y: el.y - 150 * Math.cos(a) + 150 * Math.cos(Math.PI / 2) };
    const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
    const vis = rand() < lost ? 0.1 : 0.95;
    const jit = (p, s = 0) => ({ x: p.x + noise * gauss(rand), y: p.y + noise * gauss(rand) + s, visibility: vis });
    pose[12] = jit(sh); pose[14] = jit(el, shake * 0.6); pose[16] = jit(wr, shake);
    frames.push({ t, pose });
  }
  return frames;
}
const opts = (baseline, extra = {}) => ({ mode: 'arms', side: 'right', baseline, targetSec: 6, ...extra });

test('isoModeFor recognises isometric names only', () => {
  assert.equal(isoModeFor({ name: 'Isometric Pin Press' }), 'arms');
  assert.equal(isoModeFor({ name: 'Isometric Pin Squat' }), 'legs');
  assert.equal(isoModeFor({ name: 'Isometric Mid-Thigh Pull' }), 'hinge');
  assert.equal(isoModeFor({ name: 'Towel Curl' }), 'arms');
  assert.equal(isoModeFor({ name: 'Overcoming Split Squat' }), 'legs');
  assert.equal(isoModeFor('Pin Deadlift'), 'hinge');
  assert.equal(isoModeFor({ name: 'Bench Press' }), null);
  assert.equal(isoModeFor({ name: 'Barbell Curl' }), null);
  assert.equal(isoModeFor({ name: 'Squat' }), null);
  assert.equal(isoModeFor({}), null);
});

test('the elbow angle and side are read from the pose', () => {
  const f = clip({ noise: 0 });
  assert.equal(pickSide(f, 'arms'), 'right');
  assert.ok(Math.abs(liveAngle(f[0], { mode: 'arms', side: 'right' }) - 90) < 0.5);
});

test('camera jitter alone reads about 1× the relaxed hold', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 2 }), 'arms', 'right');
  assert.ok(base.ok, JSON.stringify(base.flags));
  const p = analysePush(clip({ secs: 6, seed: 3 }), opts(base));
  assert.deepEqual(p.flags, []);
  assert.ok(p.shakeRatio > 0.8 && p.shakeRatio < 1.25, String(p.shakeRatio));
  assert.ok(Math.abs(p.angleDeg - 90) <= 1);
  assert.equal(p.durationSec, 6);
});

test('tremor raises the shake, and more tremor raises it more', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 4 }), 'arms', 'right');
  const small = analysePush(clip({ tremor: 2, seed: 5 }), opts(base)).shakeRatio;
  const big = analysePush(clip({ tremor: 4, seed: 6 }), opts(base)).shakeRatio;
  assert.ok(small > 1.3, String(small));
  assert.ok(big > small * 1.4, `${small} → ${big}`);
});

test('the same tremor reads the same at 30 and 60 fps (windows are in seconds)', () => {
  const at = (fps) => {
    const base = analyseBaseline(clip({ secs: 2, fps, seed: 7 }), 'arms', 'right');
    return analysePush(clip({ fps, tremor: 3, seed: 8 }), opts(base)).shakeRatio;
  };
  const a = at(30), b = at(60);
  assert.ok(Math.abs(a - b) / b < 0.2, `30 fps ${a}, 60 fps ${b}`);
});

test('a changing angle is flagged as moved and gets no shake score', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 9 }), 'arms', 'right');
  const p = analysePush(clip({ drift: 15, seed: 10 }), opts(base));
  assert.ok(p.flags.includes('moved'));
  assert.equal(p.shakeRatio, null);
});

test('a moving phone, a slow camera or a lost body give no shake score', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 11 }), 'arms', 'right');
  const phone = analysePush(clip({ tremor: 3, seed: 12 }), opts(base, { phoneMoved: true }));
  assert.ok(phone.flags.includes('phoneMoved')); assert.equal(phone.shakeRatio, null);
  const slow = analysePush(clip({ fps: 20, tremor: 3, seed: 13 }), opts(base));
  assert.ok(slow.flags.includes('lowFps')); assert.equal(slow.shakeRatio, null);
  const lost = analysePush(clip({ lost: 0.35, tremor: 3, seed: 14 }), opts(base));
  assert.ok(lost.flags.includes('poseLost')); assert.equal(lost.shakeRatio, null);
  assert.ok(Number.isFinite(lost.durationSec) && Number.isFinite(slow.angleDeg), 'time and angle are still kept');
});

test('a relaxed hold that wasn’t still, or was too short, can’t be compared against', () => {
  const shaky = analyseBaseline(clip({ secs: 2, tremor: 12, seed: 15 }), 'arms', 'right');
  assert.ok(shaky.flags.includes('noisyBaseline'));
  const short = analyseBaseline(clip({ secs: 0.8, seed: 16 }), 'arms', 'right');
  assert.ok(short.flags.includes('shortBaseline'));
  const p = analysePush(clip({ tremor: 3, seed: 17 }), opts(short));
  assert.equal(p.shakeRatio, null);
  assert.ok(p.flags.includes('shortBaseline'));
});

test('shake that dies away in the push shows as fade', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 18 }), 'arms', 'right');
  const p = analysePush(clip({ secs: 8, tremor: 5, tremorEnd: 1, seed: 19 }), opts(base));
  assert.ok(p.fadePct > 30, String(p.fadePct));
  const steady = analysePush(clip({ secs: 8, tremor: 3, seed: 20 }), opts(base));
  assert.ok(Math.abs(steady.fadePct) < 20, String(steady.fadePct));
});

test('the live readout follows the shake', () => {
  const base = analyseBaseline(clip({ secs: 2, seed: 21 }), 'arms', 'right');
  const live = liveShake(clip({ secs: 3, tremor: 4, seed: 22 }), { mode: 'arms', side: 'right', baseline: base });
  assert.ok(live > 1.5, String(live));
  assert.equal(liveShake(clip({ secs: 3 }), { mode: 'arms', side: 'right', baseline: null }), null);
});

test('compareToUsual needs 3 earlier pushes at a similar angle of the same exercise', () => {
  const push = { shakeRatio: 2.6, angleDeg: 90 };
  const rec = (id, pushes, exercise = 'Isometric Pin Press') => ({ id, exercise, pushes });
  assert.equal(compareToUsual(push, [rec('a', [{ shakeRatio: 2, angleDeg: 92 }, { shakeRatio: 2, angleDeg: 88 }])], { exercise: 'Isometric Pin Press' }), null);
  const history = [
    rec('a', [{ shakeRatio: 2, angleDeg: 92 }, { shakeRatio: 2, angleDeg: 88 }]),
    rec('b', [{ shakeRatio: 2, angleDeg: 95 }, { shakeRatio: 9, angleDeg: 130 }]),   // 130°: a different angle, left out
    rec('c', [{ shakeRatio: 9, angleDeg: 90 }], 'Isometric Pin Squat'),              // another exercise, left out
    rec('d', [{ shakeRatio: null, angleDeg: 90 }]),                                   // untrusted, left out
  ];
  assert.deepEqual(compareToUsual(push, history, { exercise: 'isometric pin press' }), { ratio: 1.3, n: 3 });
  assert.equal(compareToUsual(push, history, { exercise: 'Isometric Pin Press', excludeId: 'a' }), null);
  assert.equal(compareToUsual({ shakeRatio: null, angleDeg: 90 }, history, { exercise: 'Isometric Pin Press' }), null);
});
