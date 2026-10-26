import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hsv, sampleColour, findMarker, createMarkerTracker } from '../services/vision/marker.js';
import { markerSet, trackerFor } from '../services/pipeline.js';
import { liftTrajectory } from '../demo/scene3d.js';

// A side-on picture: grey gym with a dark rack, a red plate logo, and a green marker disc (antialiased
// 4 × 4 per pixel) at (mx, my), radius mr. Noise ±6 per channel.
function picture(w, h, { mx, my, mr, decoy = null, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [120 + ((x >> 5) % 3) * 15, 120 + ((y >> 5) % 2) * 10, 118];
    if (x > 40 && x < 70) c = [40, 40, 45]; // rack upright
    if ((x - 250) ** 2 + (y - 60) ** 2 < 15 ** 2) c = [200, 30, 30]; // red logo
    let cov = 0;
    for (const [cx, cy, r] of [[mx, my, mr], ...(decoy ? [decoy] : [])]) {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if ((x + (a + 0.5) / 4 - cx) ** 2 + (y + (b + 0.5) / 4 - cy) ** 2 < r * r) cov += 1 / 16;
    }
    cov = Math.min(1, cov);
    const g = [40, 190, 70];
    const k = 4 * (y * w + x);
    for (let ch = 0; ch < 3; ch++) data[k + ch] = c[ch] * (1 - cov) + g[ch] * cov + 12 * (rnd() - 0.5);
    data[k + 3] = 255;
  }
  return { w, h, data };
}

function crop(img, win) {
  const ox = Math.max(0, Math.floor(win.x0)), oy = Math.max(0, Math.floor(win.y0)), w = Math.min(img.w, Math.ceil(win.x1)) - ox, h = Math.min(img.h, Math.ceil(win.y1)) - oy;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(4 * ((oy + y) * img.w + ox), 4 * ((oy + y) * img.w + ox + w)), 4 * y * w);
  return { w, h, data, ox, oy };
}

test('colour: hue, saturation and value; a tap on grey gives no colour', () => {
  assert.deepEqual(hsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(Math.round(hsv(40, 190, 70).h), 132);
  const img = picture(320, 240, { mx: 160, my: 120, mr: 9 });
  const col = sampleColour(img, 160, 120);
  assert.ok(col && Math.abs(col.h - 132) < 6, JSON.stringify(col));
  assert.equal(sampleColour(img, 10, 10), null);
});

test('the marker is found to a fraction of a pixel, and a same-coloured blob elsewhere is not it', () => {
  for (const [mx, my] of [[160.3, 120.7], [100.5, 80.25], [210.8, 150.1]]) {
    const img = picture(320, 240, { mx, my, mr: 8.2, decoy: [290, 210, 6] });
    const col = sampleColour(img, mx, my);
    const m = findMarker(img, col, { near: { x: mx + 3, y: my - 2 }, win: { x0: mx - 40, y0: my - 40, x1: mx + 40, y1: my + 40 } });
    assert.ok(m.ok);
    assert.ok(Math.hypot(m.cx - mx, m.cy - my) < 0.15, `(${m.cx.toFixed(2)}, ${m.cy.toFixed(2)}) vs (${mx}, ${my})`);
    assert.ok(Math.abs(m.r - 8.2) < 0.3, `r ${m.r.toFixed(2)}`);
  }
});

test('a squat filmed side-on with a 5 cm marker: tracked every frame, mean velocity within 0.03 m/s of the truth', () => {
  const traj = liftTrajectory({ reps: [{ T: 0.7, D: 0.5 }, { T: 1.0, D: 0.5 }, { T: 1.5, D: 0.48 }], ecc: 1.2, lead: 1, tail: 0.6, path: 0.03 });
  // 3 m away, 985 px focal length: 328 px per metre; the marker is 8.2 px in radius.
  const kpx = 985 / 3, w = 320, h = 260, fps = 30;
  const at = (t) => { const p = traj.pos(t); return { x: 140 + p[2] * kpx, y: 40 - (p[1] - 1.4) * kpx }; };
  const p0 = at(0), first = picture(w, h, { mx: p0.x, my: p0.y, mr: 8.2 });
  const col = sampleColour(first, p0.x, p0.y), tr = createMarkerTracker(col);
  assert.ok(tr.init(first, p0.x + 2, p0.y + 1, 0).ok);
  const markerTrack = [];
  let worst = 0, k = 0;
  for (let t = 1 / fps; t < traj.duration; t += 1 / fps) {
    // Every other frame as the lab grabs it: only a crop around where the marker should be.
    const p = at(t), full = picture(w, h, { mx: p.x, my: p.y, mr: 8.2, seed: ++k });
    const m = tr.track(k % 2 ? full : (win) => crop(full, win), t);
    if (m.ok) worst = Math.max(worst, Math.hypot(m.cx - p.x, m.cy - p.y));
    markerTrack.push({ t, ok: !!m.ok, cx: m.cx, cy: m.cy, r: m.r });
  }
  assert.ok(markerTrack.every((f) => f.ok), 'lost the marker');
  assert.ok(worst < 0.3, `worst centre error ${worst.toFixed(2)} px`);
  const res = markerSet({ t: trackerFor('squat', 'marker'), pose: { reps: [], standard: null, armedAt: null }, lift: 'squat', fps, diameterM: 0.05, markerTrack });
  assert.equal(res.refused, '');
  const ok = res.rows.filter((x) => x.velocity === 'ok');
  assert.equal(ok.length, 3);
  ok.forEach((x, i) => assert.ok(Math.abs(x.mcv - traj.reps[i].mcv) < 0.03, `rep ${i + 1}: ${x.mcv.toFixed(3)} vs ${traj.reps[i].mcv.toFixed(3)} m/s`));
  assert.equal(res.calibration.kind, 'marker-diameter');
  assert.ok(res.rows.every((x) => Object.values(x.badges).every((b) => b === 'estimate')), 'a marker filmed in 2D is never marked transducer-grade');
});

test('no marker diameter, or no marker: refused with the reason', () => {
  const pose = { reps: [{ n: 1, topT: 1, result: 'counted', isStandard: true }], standard: null, armedAt: 0 };
  const t = trackerFor('squat', 'marker');
  assert.match(markerSet({ t, pose, lift: 'squat', fps: 30, diameterM: null, markerTrack: [{ t: 0, ok: true, cx: 1, cy: 1, r: 8 }] }).refused, /diameter/);
  const none = markerSet({ t, pose, lift: 'squat', fps: 30, diameterM: 0.05, markerTrack: [] });
  assert.match(none.refused, /never found/);
  assert.deepEqual(none.rows.map((x) => x.velocity), ['unclear']);
});
