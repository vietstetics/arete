// How accurately each lift's tracker counts reps on real footage. Replays the cached landmarks
// (scripts/extract-poses.mjs) through the same tracker and rep counter the camera page uses, and
// compares the reps found with the rep times read off each clip by eye (test-videos/.poses/truth.json).
//
//   node scripts/evaluate-trackers.mjs            every clip with a truth entry
//   node scripts/evaluate-trackers.mjs curl       clips whose path contains "curl"
//   node scripts/evaluate-trackers.mjs -v curl    also print every rep found
//
// The clips are one person's lifts: they test that a tracker follows the movement through real gym
// conditions, never what anyone's numbers should be.
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LIFTS, createLiftTracker } from '../features/standard/services/liftTrackers.js';
import { createRepCounter } from '../features/standard/services/repEngine.js';
import { concentricVelocity } from '../features/standard/services/velocity.js';
import { toPose, toWorld } from '../features/standard/services/liftFeatures.js';

const dir = resolve('test-videos/.poses');
const args = process.argv.slice(2);
const verbose = args.includes('-v'); const filters = args.filter((a) => a !== '-v');
const truth = JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8'));
const TOL = 1.2; // s: a rep found within this of a real rep's top is that rep

/** Reps found in one cached clip by one lift's tracker (sides: [null] or ['L', 'R'] for alternating). */
export function runClip(data, lift, { start = 0, end = Infinity, sides = [null], opts = {} } = {}) {
  const def = LIFTS[lift];
  const found = [];
  for (const side of sides) {
    const tr = createLiftTracker(lift, { ...opts, side });
    const counterOpts = { minRange: def.minRange, hysteresis: def.hysteresis, tolFloor: def.hysteresis / 2, tolPct: 0.2, early: true, ...(opts.counter || {}) }; // as the camera page
    let rc = createRepCounter(counterOpts);
    const trace = [];
    for (const fr of data.frames) {
      if (fr.t < start || fr.t > end) continue;
      const poses = fr.poses.map((p) => toPose(p.lm)), worlds = fr.poses.map((p) => toWorld(p.w));
      const hands = fr.hands.map((h) => h.lm.map((q) => ({ x: q[0], y: q[1] })));
      const r = tr.push(fr.t, poses, worlds, data.vw, data.vh, hands);
      trace.push({ t: fr.t, y: r.path });
      // As the camera page does: the lifter turned out to be someone else, so the count starts again.
      if (r.switched) { rc = createRepCounter(counterOpts); for (let i = found.length - 1; i >= 0; i--) if (found[i].side === (side || found[i].side) && found[i].mine) found.splice(i, 1); }
      // The measure a set uses (elbow angle or hand distance) has its own thresholds.
      if (tr.counter && (tr.counter.minRange !== counterOpts.minRange)) { counterOpts.minRange = tr.counter.minRange; counterOpts.hysteresis = tr.counter.hysteresis; counterOpts.tolFloor = tr.counter.hysteresis / 2; rc = createRepCounter(counterOpts); }
      const ev = rc.push(fr.t, r.value, r.ok);
      // As on the camera page: a rep can be given at the Finish line ('rep'), then its top is final
      // ('settled'), when its speed is measured over the whole lift.
      const speed = (rep) => concentricVelocity(trace, rep.startT - 0.15, rep.topT + 0.15)?.mv;
      if (ev && ev.type === 'settled') { const f = found.find((x) => x.rep === ev.rep); if (f) Object.assign(f, { mv: speed(ev.rep), t: ev.rep.topT, top: ev.rep.top }); }
      else if (ev && ev.rep) found.push({ rep: ev.rep, shownAt: fr.t, mv: speed(ev.rep), unit: tr.unit, mine: true, t: ev.rep.topT, side: side || r.side, result: ev.rep.result, bottom: ev.rep.bottom, top: ev.rep.top, fmt: tr.fmt });
      if (found.filter((x) => x.mine && x.side === (side || x.side) && x.result === 'counted').length >= 2) tr.lock(); // as the camera page: two full reps fix the measure
    }
  }
  return found.sort((a, b) => a.t - b.t);
}

function score(found, reps) {
  // Closest pairs first, so one rep found between two real ones goes to the nearer.
  const pairs = [];
  reps.forEach(([t], i) => found.forEach((f, j) => { const d = Math.abs(f.t - t); if (d <= TOL) pairs.push([d, i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ti = new Set(), fj = new Set();
  const notCounted = [];
  for (const [, i, j] of pairs) if (!ti.has(i) && !fj.has(j)) { ti.add(i); fj.add(j); if (found[j].result !== 'counted') notCounted.push(reps[i][0]); }
  return { hit: ti.size, notCounted, missed: reps.filter((_, i) => !ti.has(i)).map(([t]) => t), extra: found.filter((_, j) => !fj.has(j)).map((f) => f.t) };
}

let tot = { truth: 0, hit: 0, extra: 0 };
for (const [key, tr] of Object.entries(truth)) {
  if (key === '_' || (filters.length && !filters.some((f) => key.toLowerCase().includes(f.toLowerCase())))) continue;
  const file = join(dir, key + '.json');
  if (!(await stat(file).catch(() => null))) { console.log(`${key}: no landmarks yet`); continue; }
  const data = JSON.parse(await readFile(file, 'utf8'));
  const found = runClip(data, tr.lift, { start: tr.start, end: tr.end, sides: tr.alternating ? ['L', 'R'] : [null], opts: tr.alternating ? { otherRest: 25 } : {} });
  const fmt = (xs) => xs.map((x) => x.toFixed(1)).join(' ');
  if (tr.approx) {
    console.log(`${key.padEnd(34)} ${tr.lift.padEnd(10)} about ${tr.approx} reps (estimate) · found ${found.length}`);
  } else {
    const hidden = tr.reps.filter((r) => r[2] === 'hidden'), partial = tr.reps.filter((r) => r[2] === 'partial'), visible = tr.reps.filter((r) => !r[2]);
    const s = score(found, visible);
    // A hidden rep found anyway isn't an extra.
    s.extra = s.extra.filter((t) => ![...hidden, ...partial].some(([h]) => Math.abs(h - t) <= TOL));
    tot.truth += visible.length; tot.hidden = (tot.hidden || 0) + hidden.length; tot.hit += s.hit; tot.extra += s.extra.length; tot.nc = (tot.nc || 0) + s.notCounted.length;
    // Extras the lifter would see counted (a short or unclear extra adds nothing to the count).
    tot.extraCounted = (tot.extraCounted || 0) + found.filter((f) => s.extra.includes(f.t) && f.result === 'counted').length;
    // Part-reps (marked in the truth) must never count as full reps.
    for (const [pt] of partial) { const f = found.find((x) => Math.abs(x.t - pt) <= TOL); tot.partials = (tot.partials || 0) + 1; if (f && f.result === 'counted') { tot.partialCounted = (tot.partialCounted || 0) + 1; console.log(`  ! ${key}: part-rep at ${pt}s counted as full`); } }
    console.log(`${key.padEnd(34)} ${tr.lift.padEnd(10)} ${s.hit}/${visible.length} found, ${s.extra.length} extra${hidden.length ? ` (+${hidden.length} out of sight)` : ''}${s.notCounted.length ? ` · found but judged short/unclear ${fmt(s.notCounted)}` : ''}${s.missed.length ? ` · missed ${fmt(s.missed)}` : ''}${s.extra.length ? ` · extra ${fmt(s.extra)}` : ''}`);
  }
  if (verbose) for (const f of found) console.log(`    ${f.t.toFixed(2)}s (shown ${f.shownAt.toFixed(2)}s) ${f.side ?? ''} ${f.result} ${f.fmt(f.bottom)} → ${f.fmt(f.top)}${Number.isFinite(f.mv) ? ` · ${f.mv.toFixed(2)} limb lengths/s` : ''}`);
}
if (tot.truth) {
  console.log(`\nAll: ${tot.hit}/${tot.truth} reps found (${Math.round((100 * tot.hit) / tot.truth)}%), ${tot.extra} extra.`);
  // Full reps (not marked partial) the lifter would see counted: found, and judged 'counted'.
  console.log(`Counted as full reps: ${tot.hit - tot.nc}/${tot.truth} (${Math.round((100 * (tot.hit - tot.nc)) / tot.truth)}%), ${tot.extraCounted} extra counted.`);
  if (tot.partials) console.log(`Part-reps counted as full: ${tot.partialCounted || 0} of ${tot.partials}.`);
}
