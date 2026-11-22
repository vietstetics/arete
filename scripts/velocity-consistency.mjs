// Is the camera speed the same thing whoever films it, however they film it? Replays each analysed clip
// (test-videos/.poses) through the same tracker, rep counter and speed the camera page uses, then again
// with the filming changed in ways that must not change the answer: phone nearer or further, shifted,
// mirrored (the other side), 15/24/60 fps instead of 30, shakier landmarks (worse camera or light),
// dropped frames. Each rep's speed must come out the same as in the original (and the same reps found).
//
//   node scripts/velocity-consistency.mjs              every analysed clip with a known lift
//   node scripts/velocity-consistency.mjs triceps      clips whose path contains "triceps"
//   node scripts/velocity-consistency.mjs -v           every rep's speed under every change
//
// Two people with the same real speed: lengths are measured in each person's own body (joint angles and
// limb lengths from the 3D pose, distances in their own segment lengths), turned into metres with their
// height. Size and distance from the phone drop out; what's left is filming, and that is what's varied here.
// The clips are one person's lifts: they test the method, never what anyone's speed should be.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { LIFTS, createLiftTracker } from '../features/standard/services/liftTrackers.js';
import { createRepCounter } from '../features/standard/services/repEngine.js';
import { concentricVelocity } from '../features/standard/services/velocity.js';
import { toPose, toWorld } from '../features/standard/services/liftFeatures.js';

const dir = resolve('test-videos/.poses');
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const filters = args.filter((a) => !a.startsWith('-'));
const HEIGHT = 1.75; // m: only to print m/s; every comparison here is a ratio, so it cancels out

/** Which tracker a clip is: from its folder and name (as uploaded from the phone). */
export function liftOf(rel) {
  const p = rel.toLowerCase().split(sep).join('/');
  const rules = [
    [/leg curl/, 'legCurl'], [/leg extension/, 'legExtension'], [/^triceps\/|tricep|overhead extension/, 'triceps'],
    [/^curl\//, 'curl'], [/^dip\//, 'dip'], [/^fly\//, 'fly'], [/^chest press\//, 'press'], [/^shoulder press\//, 'shoulderPress'],
    [/^row\//, 'row'], [/pulldown|pull down/, 'pulldown'], [/^calf raise\//, 'calfRaise'], [/lateral raise/, 'lateralRaise'],
    [/abduction/, 'hipAbduction'], [/adduction/, 'hipAdduction'],
  ];
  // The clip's own name first (a folder can hold two lifts: "leg extension and leg curl"), then its folder.
  const name = p.split('/').pop(), folder = p.split('/')[0] + '/';
  for (const s of [name, folder]) for (const [re, lift] of rules) if (re.test(s) && LIFTS[lift]) return lift;
  return null;
}

// ---- Replay (as the camera page: tracker → rep counter with early counting → speed over the rep) ----
export function replay(frames, vw, vh, lift, { start = 0, end = Infinity } = {}) {
  const def = LIFTS[lift];
  const tr = createLiftTracker(lift);
  const opts = { minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2, tolPct: 0.2, early: true };
  let rc = createRepCounter(opts);
  const trace = [], reps = [];
  let seen = 0, total = 0;
  for (const fr of frames) {
    if (fr.t < start || fr.t > end) continue;
    total++;
    const poses = fr.poses.map((p) => toPose(p.lm)), worlds = fr.poses.map((p) => toWorld(p.w));
    const hands = fr.hands.map((h) => h.lm.map((q) => ({ x: q[0], y: q[1] })));
    const r = tr.push(fr.t, poses, worlds, vw, vh, hands);
    if (r.ok) seen++;
    trace.push({ t: fr.t, y: r.path });
    if (r.switched) { rc = createRepCounter(opts); reps.length = 0; }
    if (tr.counter && tr.counter.minRange !== opts.minRange) { Object.assign(opts, { minRange: tr.counter.minRange, hysteresis: tr.counter.hysteresis, tolFloor: tr.counter.hysteresis / 2 }); rc = createRepCounter(opts); }
    const ev = rc.push(fr.t, r.value, r.ok);
    if (ev && ev.type === 'settled') { const x = reps.find((q) => q.rep === ev.rep); if (x) x.t = ev.rep.topT; }
    else if (ev && ev.rep) reps.push({ rep: ev.rep, t: ev.rep.topT, result: ev.rep.result, unit: tr.unit });
    if (reps.filter((q) => q.result === 'counted').length >= 2) tr.lock(); // as the camera page
  }
  for (const x of reps) {
    const v = concentricVelocity(trace, x.rep.startT - 0.15, x.rep.topT + 0.15);
    x.mv = v ? v.mv * x.unit * HEIGHT : NaN; // m/s at HEIGHT (NaN where the measure has no length: hand mode)
    x.rel = v ? v.mv : NaN; // in the lift's own unit per second
    x.dur = v ? v.dur : NaN; x.range = v ? v.range : NaN;
  }
  return { reps, seen: total ? seen / total : 0 };
}

// ---- Ways of filming the same lift ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const SWAP = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];
const mapFrame = (fr, fl, fw, fh) => ({ t: fr.t, poses: fr.poses.map((p) => ({ lm: p.lm.map(fl), w: (p.w || []).map(fw) })), hands: fr.hands.map((h) => ({ ...h, lm: h.lm.map(fh) })) });
const lerp = (a, b, k) => a.map((x, i) => (typeof x === 'number' && typeof b[i] === 'number' ? x + (b[i] - x) * k : x));
function at(frames, t) {
  // A frame at time t, between the two recorded around it (same people and hands in both, else the nearer).
  let i = frames.findIndex((f) => f.t >= t); if (i < 0) i = frames.length - 1; if (i === 0) return { ...frames[0], t };
  const a = frames[i - 1], b = frames[i], k = (t - a.t) / (b.t - a.t || 1);
  if (a.poses.length !== b.poses.length || a.hands.length !== b.hands.length) return { ...(k < 0.5 ? a : b), t };
  return { t, poses: a.poses.map((p, j) => ({ lm: p.lm.map((q, m) => lerp(q, b.poses[j].lm[m], k)), w: (p.w || []).map((q, m) => lerp(q, b.poses[j].w[m], k)) })), hands: a.hands.map((h, j) => ({ ...h, lm: h.lm.map((q, m) => lerp(q, b.hands[j].lm[m], k)) })) };
}
function resample(frames, fps) {
  const out = [], t0 = frames[0].t, t1 = frames[frames.length - 1].t;
  for (let t = t0; t <= t1 + 1e-9; t += 1 / fps) out.push(at(frames, t));
  return out;
}
export const CHANGES = {
  'phone 1.6× nearer': (F) => F.map((f) => mapFrame(f, (q) => [0.5 + (q[0] - 0.5) * 1.6, 0.5 + (q[1] - 0.5) * 1.6, q[2], q[3]], (w) => w, (q) => [0.5 + (q[0] - 0.5) * 1.6, 0.5 + (q[1] - 0.5) * 1.6, q[2]])),
  'phone 2× further': (F) => F.map((f) => mapFrame(f, (q) => [0.5 + (q[0] - 0.5) * 0.5, 0.5 + (q[1] - 0.5) * 0.5, q[2], q[3]], (w) => w, (q) => [0.5 + (q[0] - 0.5) * 0.5, 0.5 + (q[1] - 0.5) * 0.5, q[2]])),
  'lifter off-centre': (F) => F.map((f) => mapFrame(f, (q) => [q[0] + 0.12, q[1] - 0.08, q[2], q[3]], (w) => w, (q) => [q[0] + 0.12, q[1] - 0.08, q[2]])),
  'filmed mirrored': (F) => F.map((f) => ({ t: f.t, poses: f.poses.map((p) => ({ lm: SWAP.map((j) => { const q = p.lm[j]; return [1 - q[0], q[1], q[2], q[3]]; }), w: p.w && p.w.length ? SWAP.map((j) => { const q = p.w[j]; return [-q[0], q[1], q[2]]; }) : [] })), hands: f.hands.map((h) => ({ ...h, side: h.side === 'Left' ? 'Right' : h.side === 'Right' ? 'Left' : h.side, lm: h.lm.map((q) => [1 - q[0], q[1], q[2]]) })) })),
  '60 fps': (F) => resample(F, 60),
  '24 fps': (F) => resample(F, 24),
  '15 fps': (F) => resample(F, 15),
  'shakier landmarks': (F) => { const r = rng(7); return F.map((f) => mapFrame(f, (q) => [q[0] + 0.004 * gauss(r), q[1] + 0.004 * gauss(r), q[2], q[3]], (w) => [w[0] + 0.008 * gauss(r), w[1] + 0.008 * gauss(r), w[2] + 0.015 * gauss(r)], (q) => [q[0] + 0.002 * gauss(r), q[1] + 0.002 * gauss(r), q[2]])); },
  '10% frames dropped': (F) => { const r = rng(11); return F.filter((_, i) => i === 0 || r() > 0.1); },
};

// Reps of the original matched to reps of a change by time (each the nearest within 0.5 s).
export function compare(base, other) {
  const used = new Set(), pairs = [];
  for (const b of base) {
    let best = null, bd = 0.5;
    other.forEach((o, j) => { if (!used.has(j) && Math.abs(o.t - b.t) < bd) { bd = Math.abs(o.t - b.t); best = j; } });
    if (best != null) { used.add(best); pairs.push([b, other[best]]); }
  }
  // Speed is compared on the same rep: found at the same place (its start within 0.3 s too). A rep the
  // counter merged with the one before (or split) is a counting difference, reported as such.
  const same = ([b, o]) => Math.abs(b.rep.startT - o.rep.startT) < 0.3;
  const counted = pairs.filter(([b, o]) => same([b, o]) && b.result === 'counted' && Number.isFinite(b.rel) && Number.isFinite(o.rel));
  const dev = counted.map(([b, o]) => 100 * (o.rel / b.rel - 1));
  const merged = pairs.filter((p) => !same(p)).length;
  const big = counted.filter(([b, o]) => Math.abs(o.rel / b.rel - 1) > 0.15).map(([b, o]) => `${b.t.toFixed(1)}s ${b.rel.toFixed(2)}→${o.rel.toFixed(2)} (${b.dur.toFixed(2)}s→${o.dur.toFixed(2)}s, range ${b.range.toFixed(2)}→${o.range.toFixed(2)})`);
  return { big, matched: pairs.length, missing: base.length - pairs.length + merged, extra: other.length - pairs.length + merged, dev, judged: pairs.filter((p) => same(p) && p[0].result !== p[1].result).length };
}

async function clips() {
  const out = [];
  const walk = async (p) => { for (const e of await readdir(p, { withFileTypes: true })) { if (e.name === 'sheets') continue; const q = join(p, e.name); if (e.isDirectory()) await walk(q); else if (e.name.endsWith('.json') && e.name !== 'truth.json') out.push(q); } };
  await walk(dir);
  return out.sort();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const truth = JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8').catch(() => '{}'));
  const summary = {}, byLift = {}, lostBy = {}, repsBy = {};
  for (const file of await clips()) {
    const rel = relative(dir, file).replace(/\.json$/, '');
    if (filters.length && !filters.some((f) => rel.toLowerCase().includes(f.toLowerCase()))) continue;
    const key = rel.split(sep).join('/');
    const lift = truth[key]?.lift || liftOf(rel);
    if (!lift) { console.log(`${rel}: no tracker for this lift yet`); continue; }
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data.frames?.length) continue;
    const win = { start: truth[key]?.start ?? 0, end: truth[key]?.end ?? Infinity };
    const base = replay(data.frames, data.vw, data.vh, lift, win);
    const counted = base.reps.filter((x) => x.result === 'counted');
    const mvs = counted.map((x) => x.mv).filter(Number.isFinite);
    const cv = mvs.length > 2 ? 100 * Math.sqrt(mvs.reduce((a, v) => a + (v - mvs.reduce((p, q) => p + q, 0) / mvs.length) ** 2, 0) / (mvs.length - 1)) / (mvs.reduce((p, q) => p + q, 0) / mvs.length) : NaN;
    console.log(`\n${rel}  [${lift}]  ${base.reps.length} reps (${counted.length} counted), lift seen ${Math.round(100 * base.seen)}% of frames` +
      (mvs.length ? ` · ${mvs.map((v) => v.toFixed(2)).join(' ')} m/s at ${HEIGHT} m` : counted.length ? ' · speed in hand lengths (no m/s in hand mode)' : '') +
      (Number.isFinite(cv) ? ` · rep-to-rep spread ${cv.toFixed(0)}%` : ''));
    for (const [name, fn] of Object.entries(CHANGES)) {
      const o = replay(fn(data.frames), data.vw, data.vh, lift, win);
      const c = compare(base.reps, o.reps);
      const abs = c.dev.map(Math.abs).sort((a, b) => a - b);
      const med = abs.length ? abs[abs.length >> 1] : NaN, worst = abs.length ? abs[abs.length - 1] : NaN;
      (summary[name] ||= { dev: [], missing: 0, extra: 0, judged: 0, reps: 0 });
      ((byLift[lift] ||= {})[name] ||= []).push(...c.dev);
      (lostBy[lift] ||= {})[name] = (lostBy[lift][name] || 0) + c.missing + c.extra;
      if (name === '60 fps') repsBy[lift] = (repsBy[lift] || 0) + base.reps.length;
      summary[name].dev.push(...c.dev); summary[name].missing += c.missing; summary[name].extra += c.extra; summary[name].judged += c.judged; summary[name].reps += base.reps.length;
      console.log(`  ${name.padEnd(20)} reps ${String(o.reps.length).padStart(2)}${c.missing ? ` (${c.missing} lost)` : ''}${c.extra ? ` (+${c.extra})` : ''}${c.judged ? ` · ${c.judged} judged differently` : ''}` +
        (abs.length ? ` · speed off by median ${med.toFixed(1)}%, worst ${worst.toFixed(1)}%` : '') + (verbose && c.big.length ? '\n      ' + c.big.join('\n      ') : ''));
    }
  }
  console.log('\nBy lift (same rep: median / 90% of reps within, speed change; ± reps counted differently):');
  for (const [lift, m] of Object.entries(byLift)) {
    const cell = (name) => { const abs = (m[name] || []).map(Math.abs).sort((a, b) => a - b); return abs.length ? `${abs[abs.length >> 1].toFixed(1)}/${abs[Math.min(abs.length - 1, Math.floor(0.9 * abs.length))].toFixed(0)}% ±${lostBy[lift][name]}` : `– ±${lostBy[lift][name]}`; };
    console.log(`  ${lift.padEnd(14)} ${String(repsBy[lift]).padStart(3)} reps · ` + ['60 fps', '24 fps', 'shakier landmarks', '10% frames dropped'].map((n) => `${n.split(' ')[0]} ${cell(n)}`).join(' · '));
  }
  console.log('\nAll clips:');
  for (const [name, s] of Object.entries(summary)) {
    const abs = s.dev.map(Math.abs).sort((a, b) => a - b);
    const q = (p) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(p * abs.length))] : NaN);
    console.log(`  ${name.padEnd(20)} ${s.missing} of ${s.reps} reps lost, ${s.extra} extra, ${s.judged} judged differently · speed off: median ${q(0.5).toFixed(1)}%, 90% within ${q(0.9).toFixed(1)}%, worst ${q(1 - 1e-9).toFixed(1)}%`);
  }
}
