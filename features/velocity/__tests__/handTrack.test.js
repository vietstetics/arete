// Hand speed from the hands' own movement (features/velocity/services/handTrack.js), on synthetic
// hand paths with a known true speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseHand, handVelocity, handReps } from '../services/handTrack.js';

const FPS = 30, MPP = 0.002; // 2 mm per pixel
// Cosine speed profile cut where speed passes 5% of its peak: mean speed is this × (distance / whole time).
const TRUE_K = (() => { const t0 = Math.asin(0.05) / Math.PI; return (Math.cos(Math.PI * t0)) / (1 - 2 * t0); })();

/**
 * n reps: rest, then concentric of `rom` metres in `up` seconds (cosine profile), a pause, the
 * eccentric in `down` seconds. dir: unit direction in the picture. Returns frames and the true MCV.
 */
function lift({ n = 5, rom = 0.5, up = 1, down = 1.4, dir = [0, -1], start = [400, 600], noise = 0, hide = null, spikes = false } = {}) {
  const frames = [], truth = [];
  let t = 0;
  const push = (u) => {
    const x = start[0] + (dir[0] * u * rom) / MPP + (noise ? Math.sin(t * 91.7) * noise : 0);
    const y = start[1] + (dir[1] * u * rom) / MPP + (noise ? Math.cos(t * 77.3) * noise : 0);
    let cands = [{ x, y, conf: 0.9 }];
    if (hide && hide.some(([a, b]) => t >= a && t < b)) cands = [];
    if (spikes && Math.round(t * FPS) % 23 === 0) cands = [{ x: x + 260, y: y - 180, conf: 0.8 }]; // the other hand / a bar
    frames.push({ t, cands }); t += 1 / FPS;
  };
  for (let i = 0; i < 20; i++) push(0);
  for (let r = 0; r < n; r++) {
    const n1 = Math.round(up * FPS); for (let i = 1; i <= n1; i++) push((1 - Math.cos((Math.PI * i) / n1)) / 2);
    for (let i = 0; i < 6; i++) push(1);
    const n2 = Math.round(down * FPS); for (let i = 1; i <= n2; i++) push((1 + Math.cos((Math.PI * i) / n2)) / 2);
    for (let i = 0; i < 12; i++) push(0);
    truth.push(TRUE_K * rom / up); // the same 5%-of-peak start/end rule a transducer uses
  }
  return { frames, truth };
}
const run = (frames, opts) => handReps(handVelocity(fuseHand(frames), MPP), opts);
const near = (a, b, tol) => Math.abs(a - b) / b <= tol;

test('mean concentric speed matches the truth, vertical or horizontal (any plane of the picture)', () => {
  for (const dir of [[0, -1], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2]]) {
    const { frames, truth } = lift({ dir });
    const { reps } = run(frames);
    assert.equal(reps.length, 5, String(dir));
    reps.forEach((r, i) => { assert.ok(r.ok); assert.ok(near(r.mcv, truth[i], 0.05), `${dir}: ${r.mcv} vs ${truth[i]}`); assert.ok(near(r.rom, 0.5, 0.05)); });
    // cosine profile: peak = π/2 × mean
    assert.ok(near(reps[0].peak, (Math.PI / 2) * truth[0], 0.08), `peak ${reps[0].peak}`);
  }
});

test('camera noise and the model jumping to the wrong hand are ignored', () => {
  const { frames, truth } = lift({ noise: 3, spikes: true });
  const { reps } = run(frames);
  assert.equal(reps.length, 5);
  reps.forEach((r, i) => assert.ok(r.ok && near(r.mcv, truth[i], 0.07), `rep ${i + 1}: ${r.mcv} vs ${truth[i]}`));
});

test('a hand hidden briefly is bridged; hidden for long, the rep is unclear (never made up)', () => {
  // 0.2 s hidden mid-concentric of rep 2 (rep 2 concentric ≈ 3.3–4.3 s), 1.2 s hidden in rep 4
  const { frames, truth } = lift({ hide: [[3.7, 3.9], [7.6, 8.8]] });
  const fused = fuseHand(frames);
  assert.ok(fused.some((p) => p.state === 'bridged'));
  assert.ok(fused.some((p) => p.state === 'lost'));
  const { reps } = handReps(handVelocity(fused, MPP));
  const r2 = reps.find((r) => r.t0 < 3.7 && r.t1 > 3.9);
  assert.ok(r2 && r2.ok && near(r2.mcv, truth[1], 0.08), `bridged rep ${r2 && r2.mcv}`);
  const r4 = reps.find((r) => r.t0 <= 8.8 && r.t1 >= 7.6);
  if (r4) { assert.equal(r4.ok, false); assert.equal(r4.mcv, null); }
});

test('lifts that lower first measure the second half', () => {
  const { frames } = lift({ up: 1.4, down: 0.8 }); // here "down" is the faster half
  const first = run(frames, { concentricFirst: true }).reps[0];
  const second = run(frames, { concentricFirst: false }).reps[0];
  assert.ok(near(first.mcv, TRUE_K * 0.5 / 1.4, 0.05), `first half ${first.mcv}`);
  assert.ok(near(second.mcv, TRUE_K * 0.5 / 0.8, 0.05), `second half ${second.mcv}`);
});

test('no movement, no reps', () => {
  const frames = Array.from({ length: 90 }, (_, i) => ({ t: i / FPS, cands: [{ x: 300 + Math.sin(i) * 2, y: 300, conf: 0.9 }] }));
  assert.equal(run(frames).reps.length, 0);
});
