#!/usr/bin/env node
// How accurate is Arete's camera velocity, wherever the phone is put?
// Films hundreds of simulated sets (features/velocity/demo/scene3d.js) —
// random phone placements, lifts, frame rates and camera faults — measures
// each with the app's own 3D plate tracking, and compares every rep with the
// bar's exact motion. Runs on all CPU cores.
//
//   node scripts/velocity-accuracy.mjs [--n 120] [--res 640x360] [--seed 1] [--out report.json] [--only key=value]
//                                      [--sets 3,28] [--fitFocal 0|1] [--steady 0|1] [--noUp] [--keep]
// --keep saves every set's measured height trace with the truth (re-score timing variants offline).
//
// Prints a summary table; --out writes every rep's numbers as JSON.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []));

import { scenario } from '../features/velocity/demo/scenarios.js';

// ── Worker ────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { filmAndMeasure } = await import('../features/velocity/demo/evaluate3d.js');
  for (const sc of workerData.scenarios) {
    const t0 = Date.now();
    let out;
    try {
      const res = filmAndMeasure({ lift: sc.lift_, scene: sc.scene, timing: sc.timing, app: { ...sc.app, ...workerData.app }, seed: sc.seed });
      out = { i: sc.i, ok: true, secs: (Date.now() - t0) / 1000, lostShare: res.lostShare, tracked: res.tracked, frames: res.frames,
        focalScale: res.view.focalScale, trueFocalScale: res.view.trueFocalScale, tiltDeg: res.view.tiltDeg, spreadDeg: res.view.spreadDeg,
        normalErrDeg: res.view.normal ? (Math.acos(Math.min(1, Math.abs(res.view.normal.reduce((s, v, k) => s + v * res.view.barAxisCam[k], 0)))) * 180) / Math.PI : null,
        reps: res.matched.map((m) => ({ inView: m.inView, truth: { mcv: m.truth.mcv, pv: m.truth.pv, mpv: m.truth.mpv, D: m.truth.D, T: m.truth.T },
          meas: m.meas ? (m.meas.ok ? { mcv: m.meas.mcv, pv: m.meas.pv, mpv: m.meas.mpv, distance: m.meas.distance, T: m.meas.T } : { why: m.meas.why }) : null, err: m.err })),
        // --keep: the measured height trace and the truth, to re-score lift timing variants without re-filming.
        ...(workerData.keep ? { heights: res.heights.map((h) => [+h.t.toFixed(5), Number.isFinite(h.y) ? +h.y.toFixed(6) : null]),
          track: res.track.map((f) => (f.ok && f.e ? [f.t, f.e.cx, f.e.cy, f.e.a, f.e.b, f.e.phi, +(f.fit ?? NaN).toFixed(3)] : [f.t])), K: res.K, up: res.upGiven, trueUp: res.view.up,
          trueH: res.diag.map((d) => [d.t, d.ts, d.cTrue ? +(d.cTrue[0] * res.view.up[0] + d.cTrue[1] * res.view.up[1] + d.cTrue[2] * res.view.up[2]).toFixed(6) : null]),
          truth: res.truth.map((tr) => ({ tStart: tr.tStart, tEnd: tr.tEnd, T: tr.T, D: tr.D, mcv: tr.mcv, pv: tr.pv, mpv: tr.mpv })), inView: res.matched.map((m) => m.inView) } : {}) };
    } catch (e) { out = { i: sc.i, ok: false, error: String(e && e.stack || e) }; }
    parentPort.postMessage(out);
  }
} else {
  const n = +(args.n || 120), seed = +(args.seed || 1), res = String(args.res || '640x360').split('x').map(Number);
  let list = Array.from({ length: n }, (_, i) => scenario(i, seed, res));
  if (args.only) { const [k, v] = String(args.only).split('='); list = list.filter((s) => String(s[k]) === v); }
  if (args.sets) { const want = new Set(String(args.sets).split(',').map(Number)); list = list.filter((s) => want.has(s.i)); }
  // What the app does, for A/B runs: --fitFocal 0|1, --steady 0|1, --noUp (no motion sensors)
  const appOverride = {};
  if (args.fitFocal !== undefined) appOverride.fitFocal = args.fitFocal !== '0';
  if (args.steady !== undefined) appOverride.steady = args.steady !== '0';
  if (args.noUp) appOverride.upErrDeg = null;
  const W = Math.max(1, Math.min(+(args.workers || cpus().length - 2), list.length));
  const chunks = Array.from({ length: W }, (_, w) => list.filter((_, i) => i % W === w));
  const results = [];
  const t0 = Date.now();
  await Promise.all(chunks.map((sc) => new Promise((resolve) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { scenarios: sc, app: appOverride, keep: !!args.keep } });
    wk.on('message', (m) => { results.push(m); process.stderr.write(`\r${results.length}/${list.length} sets filmed (${((Date.now() - t0) / 1000).toFixed(0)} s)   `); });
    wk.on('error', (e) => { console.error(e); resolve(); });
    wk.on('exit', resolve);
  })));
  process.stderr.write('\n');
  results.sort((a, b) => a.i - b.i);
  const byI = new Map(list.map((s) => [s.i, s]));
  const rows = [];
  for (const r of results) {
    if (!r.ok) { console.error('set', r.i, 'failed:', r.error); continue; }
    const sc = byI.get(r.i);
    for (const rep of r.reps) rows.push({ set: r.i, lift: sc.lift, yaw: sc.scene.place.yawDeg, camH: sc.scene.place.heightOffset, dist: sc.scene.place.distance, fps: sc.timing.fps, k1: sc.scene.lens.k1, fov: sc.scene.hfovDeg, roll: sc.scene.place.rollDeg, exposure: sc.scene.exposure, lost: r.lostShare, ...rep });
  }
  const scored = rows.filter((x) => x.err);
  const q = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const stats = (xs) => { const v = xs.filter(Number.isFinite); const abs = v.map(Math.abs); return { n: v.length, bias: v.reduce((a, b) => a + b, 0) / (v.length || 1), mae: abs.reduce((a, b) => a + b, 0) / (abs.length || 1), rmse: Math.sqrt(v.reduce((a, b) => a + b * b, 0) / (v.length || 1)), p95: q(abs, 0.95), max: abs.length ? Math.max(...abs) : NaN }; };
  const line = (label, xs, unit = '%', d = 2) => { const s = stats(xs); return `${label.padEnd(30)} n=${String(s.n).padStart(4)}  bias ${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(d)}${unit}  mean|err| ${s.mae.toFixed(d)}${unit}  rmse ${s.rmse.toFixed(d)}${unit}  95% ${s.p95.toFixed(d)}${unit}  worst ${s.max.toFixed(d)}${unit}`; };
  const abs = (k) => scored.map((x) => x.meas[k] - x.truth[k]);
  const out = [];
  const inView = rows.filter((x) => x.inView), outView = rows.filter((x) => !x.inView);
  out.push(`Sets: ${results.length} (${list.length} planned) · reps: ${rows.length}`);
  out.push(`  plate fully in view: ${inView.length} reps → scored ${inView.filter((x) => x.err).length}, unclear ${inView.filter((x) => x.meas && !x.err).length}, not found ${inView.filter((x) => !x.meas).length}`);
  out.push(`  plate partly out of view: ${outView.length} reps → scored ${outView.filter((x) => x.err).length} (should be ~0), unclear ${outView.filter((x) => x.meas && !x.err).length}, not found ${outView.filter((x) => !x.meas).length}`);
  out.push('\nScored reps, % of the true value:');
  out.push(line('MCV (mean concentric)', scored.map((x) => x.err.mcv)));
  out.push(line('PV (peak)', scored.map((x) => x.err.pv)));
  out.push(line('MPV (mean propulsive)', scored.map((x) => x.err.mpv)));
  out.push(line('Distance (ROM)', scored.map((x) => x.err.dist)));
  out.push(line('Lift time', scored.map((x) => x.err.T)));
  out.push('\nScored reps, m/s (research targets: MCV |bias| ≤ 0.02–0.03, RMSE ≤ 0.035–0.04, MAE < 0.05; PV RMSE ≤ 0.06–0.08):');
  out.push(line('MCV', abs('mcv'), ' m/s', 3));
  out.push(line('PV', abs('pv'), ' m/s', 3));
  out.push(line('MPV', abs('mpv'), ' m/s', 3));
  const groups = [
    ['lift', (x) => x.lift], ['fps', (x) => x.fps],
    ['|yaw|', (x) => (Math.abs(x.yaw) < 20 ? '0-20°' : Math.abs(x.yaw) < 40 ? '20-40°' : '40-60°')],
    ['camera vs bar height', (x) => (x.camH < -0.5 ? 'below >0.5 m' : x.camH > 0.5 ? 'above >0.5 m' : 'within 0.5 m')],
    ['distance', (x) => (x.dist < 2.2 ? '<2.2 m' : x.dist < 3 ? '2.2-3 m' : '>3 m')],
    ['rep speed', (x) => (x.truth.mcv < 0.35 ? '<0.35 m/s' : x.truth.mcv < 0.7 ? '0.35-0.7' : '>0.7 m/s')],
  ];
  for (const [name, f] of groups) {
    out.push(`\nBy ${name} — MCV % | PV %:`);
    const keys = [...new Set(scored.map(f))].sort();
    for (const k of keys) { const g = scored.filter((x) => f(x) === k); out.push(`  ${line(String(k), g.map((x) => x.err.mcv))}`); out.push(`  ${line('   peak', g.map((x) => x.err.pv))}`); }
  }
  const worst = scored.slice().sort((a, b) => Math.abs(b.err.mcv) - Math.abs(a.err.mcv)).slice(0, 10);
  out.push('\nWorst reps (MCV):');
  for (const w of worst) out.push(`  set ${w.set} ${w.lift} yaw ${w.yaw.toFixed(0)}° camH ${w.camH.toFixed(2)} dist ${w.dist.toFixed(1)} fps ${w.fps} body? lost ${(w.lost * 100).toFixed(0)}%: truth ${w.truth.mcv.toFixed(3)} → ${w.meas.mcv.toFixed(3)} (${w.err.mcv.toFixed(1)}%), dist ${w.err.dist.toFixed(1)}%, T ${w.err.T.toFixed(1)}%, PV ${w.err.pv.toFixed(1)}%`);
  const why = {};
  for (const x of rows.filter((x) => x.meas && !x.err)) { const k = `${x.inView ? 'in view' : 'out of view'}: ${x.meas.why}`; why[k] = (why[k] || 0) + 1; }
  out.push('\nUnclear reasons:'); for (const [k, v] of Object.entries(why)) out.push(`  ${v} × ${k}`);
  const sets = results.filter((r) => r.ok);
  out.push(`\nSets: facing error median ${q(sets.map((r) => r.normalErrDeg), 0.5).toFixed(1)}° (95%: ${q(sets.map((r) => r.normalErrDeg), 0.95).toFixed(1)}°) · facing spread median ${q(sets.map((r) => r.spreadDeg), 0.5).toFixed(1)}° · focal ratio error median ${q(sets.map((r) => Math.abs(r.focalScale / r.trueFocalScale - 1) * 100), 0.5).toFixed(1)}% (95%: ${q(sets.map((r) => Math.abs(r.focalScale / r.trueFocalScale - 1) * 100), 0.95).toFixed(1)}%)`);
  out.push(`Sets with >10% frames lost: ${sets.filter((r) => r.lostShare > 0.1).length}`);
  out.push(`Wall time ${((Date.now() - t0) / 1000).toFixed(0)} s on ${W} workers`);
  console.log(out.join('\n'));
  if (args.out) writeFileSync(String(args.out), JSON.stringify({ scenarios: list, results, rows }, null, 1));
}
