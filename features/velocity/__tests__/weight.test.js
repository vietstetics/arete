import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseSet } from '../services/pipeline.js';
import { weightSamples } from '../services/weight.js';
import { buildSetRecord, saveSetRecord, listSetRecords, SETS_KEY } from '../services/record.js';
import { detectPlates, createPlateTracker } from '../services/vision/plate.js';
import { background, frame, rng } from '../demo/synth.js';
import { BODY } from '../../standard/services/velocity.js';

const near = (a, b, pct) => Math.abs(a - b) / Math.abs(b) <= pct;

// A filmed squat set, end to end: pose frames for rep counting (as the pose
// model would give them) and rendered video frames of the plate for velocity.
// The bar drops 0.50 m each rep and comes up in a known time; the plate is
// 45 cm across and 96 px wide in a 288×512 frame, filmed `yawDeg` off side-on.
const W = 288, H = 512, BG = background(W, H, 3), A_PX = 48, PX_PER_M = (2 * A_PX) / 0.45, D = 0.5;

function filmSet({ ups = [0.8, 0.95, 1.1], yawDeg = 15, hide = null, fps = 60 } = {}) {
  const Hm = 1.8, k = 500, vw = 1000, vh = 2000, ankle = 1900;
  let s = 3; const jit = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * 0.0005;
  const pose = (drop, sway = 0) => {
    const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const y = (h) => (ankle - h * k) / vh + jit(), at = (x, h) => ({ x: x + sway + jit() / 4, y: y(h), visibility: 0.95 });
    const hip = 0.49 * Hm - drop * 0.9, sh = BODY.shoulderAboveAnkle * Hm - drop, bend = drop / D;
    Object.assign(p, { 11: at(0.46, sh), 12: at(0.54, sh), 23: at(0.47, hip), 24: at(0.53, hip), 25: at(0.45 - 0.08 * bend, hip / 2), 26: at(0.55 + 0.08 * bend, hip / 2), 27: at(0.46, 0), 28: at(0.54, 0) });
    return p;
  };
  const frames = [], drops = []; let t = 0, drop = 0;
  const add = (n, f) => { for (let i = 1; i <= n; i++) { frames.push({ t, poses: [f(i / n)] }); drops.push(drop); t += 1 / fps; } };
  const hold = (secs, sway = () => 0) => add(Math.round(secs * fps), (u) => pose(drop, sway(u)));
  const move = (to, secs) => { const d0 = drop; add(Math.round(secs * fps), (u) => pose((drop = d0 + (to - d0) * (1 - Math.cos(Math.PI * u)) / 2))); };
  hold(1, (u) => 0.04 * Math.sin(u * 9)); hold(2);
  const upStarts = [];
  for (const up of ups) { move(D, 1.2); hold(0.3); upStarts.push(t); move(0, up); hold(0.6); }
  hold(0.8);
  // The plate, frame by frame: found in the first frame, then tracked.
  const b = A_PX * Math.cos((yawDeg * Math.PI) / 180), r = rng(21), tr = createPlateTracker(), track = [];
  frames.forEach((f, i) => {
    const hidden = hide && f.t >= hide[0] && f.t < hide[1];
    const img = frame(BG, W, H, hidden ? null : { cx: 150, cy: 200 + drops[i] * PX_PER_M, a: A_PX, b, phi: Math.PI / 2 }, { r });
    if (i === 0) {
      const c = detectPlates(img, { rMin: 20, rMax: 90, prior: { x: 150, y: 200 } })[0];
      tr.init(img, c, f.t);
      track.push({ t: f.t, ok: true, cx: c.cx, cy: c.cy, shape: null });
    } else {
      const res = tr.track(img, f.t);
      track.push({ t: f.t, ok: res.ok, cx: res.cx, cy: res.cy, shape: res.shape || null });
    }
  });
  return { frames, track, ups, upStarts, vw, vh, fps };
}

const run = (set, opts = {}) => analyseSet({ frames: set.frames, vw: set.vw, vh: set.vh, lift: 'squat', fps: set.fps, heightCm: 180, massKg: 180, tracker: 'plate', plateTrack: set.track, diameterM: 0.45, ...opts });

const SET15 = filmSet();

test('the plate gives the true bar speed within 5% and true velocity loss within 3% (camera 15° off side-on)', () => {
  const res = run(SET15);
  assert.equal(res.tracker.id, 'plate');
  assert.equal(res.refused, '');
  assert.ok(Math.abs(res.view.offAxisDeg - 15) < 3, `angle ${res.view.offAxisDeg.toFixed(1)}°`);
  assert.ok(near(res.Dm, D, 0.03), `D ${res.Dm.toFixed(3)} m`);
  const v = res.rows.filter((r) => r.velocity === 'ok');
  assert.equal(v.length, 3);
  v.forEach((r, i) => {
    assert.ok(near(r.mcv, D / SET15.ups[i], 0.05), `rep ${i + 1}: ${r.mcv.toFixed(3)} vs ${(D / SET15.ups[i]).toFixed(3)} m/s`);
    assert.ok(near(r.rel, SET15.ups[0] / SET15.ups[i], 0.03), `rep ${i + 1} relative ${r.rel.toFixed(3)}`);
  });
  assert.ok(res.quality > 0.98);
});

test('more than 25° off side-on is refused: no velocity, with the reason', () => {
  const res = run(filmSet({ ups: [0.8, 0.9], yawDeg: 31 }));
  assert.ok(res.view.offAxisDeg > 25);
  assert.match(res.refused, /25°/);
  for (const r of res.rows) {
    assert.equal(r.result, 'counted', 'reps are still counted from the pose');
    assert.equal(r.velocity, 'unclear');
    assert.match(r.why, /off side-on/);
  }
});

test('the plate hidden for over 0.5 s mid-rep makes that rep unclear — never filled in from the body', () => {
  const t0 = SET15.upStarts[1] + 0.1; // same timeline as SET15
  const hidden = filmSet({ hide: [t0, t0 + 0.7] });
  const res = run(hidden);
  assert.deepEqual(res.rows.map((r) => r.velocity), ['ok', 'unclear', 'ok']);
  assert.match(res.rows[1].why, /0\.5 s/);
  assert.ok(Number.isFinite(res.rows[1].poseRel), 'the pose still had it — and it was not used');
  assert.ok(Number.isNaN(res.rows[1].poseMcv), 'uncalibrated pose does not publish physical speed');
});

test('without a diameter there is no m/s, only relative speed', () => {
  const res = run(SET15, { diameterM: 0 });
  assert.equal(res.scaled, false);
  assert.ok(Number.isNaN(res.Dm));
  assert.ok(near(res.rows[2].rel, SET15.ups[0] / SET15.ups[2], 0.03));
});

test('dumbbell head: distance along its arc, not just its height', () => {
  // The head swings 125° on a 35 cm arc around the elbow; its rim is a 20 cm circle seen side-on (40 px wide).
  const R = 0.35, r = 0.1, k = 20 / r, track = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 60, u = Math.min(1, Math.max(0, (t - 0.3) / 1.2)), th = (-80 + 125 * (1 - Math.cos(Math.PI * u)) / 2) * Math.PI / 180;
    track.push({ t, ok: true, cx: 200 + R * Math.cos(th) * k, cy: 300 - R * Math.sin(th) * k, shape: { a: 20, b: 20, phi: 0 } });
  }
  const { samples, view } = weightSamples(track, { diameterM: 2 * r, mode: 'path' });
  assert.equal(view.scaled, true);
  const arc = R * (125 * Math.PI) / 180, rise = R * (Math.sin((45 * Math.PI) / 180) - Math.sin((-80 * Math.PI) / 180));
  const got = samples[samples.length - 1].y - samples[0].y;
  assert.ok(near(got, arc, 0.03), `path ${got.toFixed(3)} m vs arc ${arc.toFixed(3)} (height alone: ${rise.toFixed(3)})`);
});

test('velocity per rep is stored per set', () => {
  const res = run(SET15);
  const rec = buildSetRecord(res, { lift: 'squat', exercise: 'Back Squat', loadKg: 100, typedRir: 2, at: 1 });
  assert.equal(rec.v, 1); assert.equal(rec.tracker, 'plate'); assert.equal(rec.source, 'weight'); assert.equal(rec.units, 'm/s');
  assert.equal(rec.loadKg, 100); assert.equal(rec.typedRir, 2); assert.equal(rec.counted, 3);
  assert.ok(near(rec.D, D, 0.03));
  assert.ok(rec.standard && Number.isFinite(rec.standard.start) && Number.isFinite(rec.standard.finish));
  assert.equal(rec.reps.length, 3);
  for (const r of rec.reps) { assert.ok(r.T > 0 && r.mcv > 0); assert.equal(r.result, 'counted'); }
  assert.ok(near(rec.lossPct, (1 - SET15.ups[0] / SET15.ups[2]) * 100, 0.15));
  assert.ok(Math.abs(rec.view.offAxisDeg - 15) < 3 && rec.view.mmPerPx > 0);
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveSetRecord(storage, rec); saveSetRecord(storage, { ...rec, at: 2 });
  assert.equal(listSetRecords(storage).length, 2);
  assert.ok(store.has(SETS_KEY));
});
