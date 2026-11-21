// One tracker per lift, defined by the movement itself: which joint action does the work and which
// way it goes during the lift. Built on liftFeatures.js, so every signal is measured in the lifter's
// own frame (any camera angle where the joints can be seen) and in their own segment lengths.
//
// Nothing here is a norm: no speeds, depths or tempos anyone should hit. Rep 1 sets each person's
// standard (repEngine.js), and the thresholds below only say how big a movement has to be before it
// can be a rep at all, in degrees or body proportions, so camera jitter never counts.
//
// Each lift's value falls during the lifting (concentric) part, which is what createRepCounter
// expects (it was built on the curl's elbow angle). `fmt` turns it back into what people read.

import { liftFeatures } from './liftFeatures.js';
import { oneEuro } from './repEngine.js';

const sided = (k) => (f, s) => f[k + s];
const inv = (k) => (f, s) => 180 - f[k + s];
const deg = (v) => `${Math.round(v)}°`;
const fromInv = (v) => `${Math.round(180 - v)}°`;

/**
 * value(f, side) → number (falls as you lift); arms/legs: which landmarks must be seen;
 * both: true = both sides move together (averaged when both are seen, which halves the noise);
 * minRange / hysteresis: smallest movement that can be a rep, and how far past a turn it must go
 * (in the value's units); muscles: what does the work (the muscle action shown to people);
 * end: the point whose speed is measured (wrist, ankle, heel, shoulder).
 * Speed: the moving point's travel follows from the value itself (already smoothed, and checked on
 * real footage): per × change in value = travel in a body unit, and unit = that body unit as a share of
 * height (× the lifter's height = metres). An angle × the lever it turns (forearm for an elbow lift,
 * shin for a knee lift, upper arm for a dip) is the arc the point travels; reach × arm length, hand
 * height × upper arm, hand gap × half the shoulder width and body rise × torso are distances. Segment
 * shares are adult averages (the same the rest of the app uses): an estimate until checked against a
 * velocity device. travel(f), when given, is measured directly instead (a dip: how far the shoulders
 * rise above the hands along the torso, in upper arms), smoothed the same way.
 */
export const LIFTS = {
  curl: { name: 'Curl', action: 'Elbow flexion', muscles: 'Biceps, brachialis', limb: 'arm', value: sided('elbow'), both: false, minRange: 40, hysteresis: 20, fmt: deg, per: Math.PI / 180, unit: 0.2, end: 'wrist', start: 'stretch', finish: 'top' },
  triceps: { name: 'Triceps extension', action: 'Elbow extension', muscles: 'Triceps', limb: 'arm', value: inv('elbow'), both: false, minRange: 35, hysteresis: 15, fmt: fromInv, per: Math.PI / 180, unit: 0.2, handPath: { minRange: 150, hysteresis: 60 }, end: 'wrist', start: 'bent', finish: 'lockout' },
  press: { name: 'Chest press', action: 'Shoulder flexion + elbow extension', muscles: 'Chest, front delts, triceps', limb: 'arm', value: (f, s) => 100 - 100 * f['reach' + s], depth: 'toward', both: true, minRange: 12, hysteresis: 6, fmt: (v) => `${Math.round(100 - v)}%`, per: 1 / 100, unit: 0.332, end: 'wrist', start: 'hands back', finish: 'lockout' },
  shoulderPress: { name: 'Shoulder press', action: 'Shoulder abduction / flexion overhead', muscles: 'Delts, triceps', limb: 'arm', value: (f, s) => -100 * f['handUp' + s], both: true, minRange: 60, hysteresis: 25, fmt: (v) => `${Math.round(-v)}%`, per: 1 / 100, unit: 0.186, end: 'wrist', start: 'bottom', finish: 'lockout' },
  pulldown: { name: 'Pull-down', action: 'Shoulder adduction / extension', muscles: 'Lats, biceps, rear delts', limb: 'arm', value: (f, s) => 100 * f['handUp' + s], both: true, minRange: 60, hysteresis: 25, fmt: (v) => `${Math.round(v)}%`, per: 1 / 100, unit: 0.186, end: 'wrist', start: 'arms up', finish: 'chest' },
  row: { name: 'Row', action: 'Shoulder extension + elbow flexion', muscles: 'Lats, mid back, biceps', limb: 'arm', value: (f, s) => 100 * f['reach' + s], depth: 'away', both: true, minRange: 15, hysteresis: 8, fmt: (v) => `${Math.round(v)}%`, per: 1 / 100, unit: 0.332, end: 'wrist', start: 'arms long', finish: 'chest' },
  dip: { name: 'Dip', action: 'Elbow extension + shoulder flexion', muscles: 'Chest, triceps, front delts', limb: 'arm', value: inv('elbow'), both: true, minRange: 40, hysteresis: 20, fmt: fromInv, travel: (f) => { const v = [f.handUpL, f.handUpR].filter(Number.isFinite); return v.length ? -v.reduce((a, b) => a + b, 0) / v.length : NaN; }, per: 1, unit: 0.186, end: 'shoulder', start: 'bottom', finish: 'lockout' },
  fly: { name: 'Fly', action: 'Horizontal adduction', muscles: 'Chest, front delts', limb: 'arm', value: (f) => 100 * f.handGap, both: 'pair', minRange: 60, hysteresis: 25, fmt: (v) => `${Math.round(v)}%`, per: 1 / 100, unit: 0.13, end: 'wrist', start: 'open', finish: 'together' },
  legExtension: { name: 'Leg extension', action: 'Knee extension', muscles: 'Quads', limb: 'leg', value: inv('knee'), both: true, minRange: 20, hysteresis: 10, fmt: fromInv, per: Math.PI / 180, unit: 0.246, end: 'ankle', start: 'bent', finish: 'straight' },
  legCurl: { name: 'Leg curl', action: 'Knee flexion', muscles: 'Hamstrings', limb: 'leg', value: sided('knee'), both: true, minRange: 20, hysteresis: 10, fmt: deg, per: Math.PI / 180, unit: 0.246, end: 'ankle', start: 'straight', finish: 'bent' },
  calfRaise: { name: 'Calf raise', action: 'Ankle plantarflexion', muscles: 'Calves', limb: 'leg', value: (f) => -100 * f.rise2d, both: 'pair', minRange: 8, hysteresis: 3, fmt: (v) => `${Math.round(-v)}`, per: 1 / 100, unit: 0.288, end: 'heel', start: 'heels down', finish: 'on your toes' },
};

/**
 * Follows one lift through a clip or the live camera: picks the lifter, measures the lift's value
 * each frame (smoothed), and which side to read.
 *   const lt = createLiftTracker('triceps'); lt.push(t, poses, worlds, vw, vh) → { ok, value, side, f }
 * Sides: lifts that use both sides average them when both are seen clearly; one-sided lifts read
 * the side that moves most (a one-arm curl), decided over the first few seconds of movement.
 * The result's `switched` is true on the frame it finds the lifter was someone other than the person it
 * had been following (then restart the count).
 */
export function createLiftTracker(key, { minVis = 0.5, minCutoff = 1.2, beta = 0.04, side: fixedSide = null, medianN = 5, otherRest = 0 } = {}) {
  const def = LIFTS[key];
  if (!def) throw new Error(`Unknown lift: ${key}`);
  // A running median of the last few readings first (a one-frame spike from a hidden or blurred joint
  // never gets through), then the One Euro filter (smooth at rest, quick when moving).
  const smooth = oneEuro({ minCutoff, beta });
  let win = [];
  const euro = { filter(v, t) { win.push(v); if (win.length > medianN) win.shift(); const s = win.slice().sort((a, b) => a - b); return smooth.filter(s[(s.length - 1) >> 1], t); } };
  const hist = { L: [], R: [] };
  let prev = null, side = fixedSide, mode = null;
  const people = [];
  let locked = null, lead = null, frameNo = 0, switched = false;
  const hp = { sh: null, last: null, refs: [], seenArm: [], vals: [], fixed: false, path: [], axis: null };
  const travelEuro = oneEuro({ minCutoff, beta });
  const whoReset = () => {};
  const facings = [], palmHist = { L: [], R: [] }, palmRef = { L: null, R: null };
  const visOf = (f, s) => (def.limb === 'leg' ? f.legVis[s] : f.vis[s]);
  const spread = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length > 5 ? v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)] : 0; };
  return {
    def,
    get side() { return side; },
    /** 'palm' (filmed from in front: measured by the hands' size) or 'joints', once known. */
    get mode() { return mode; },
    /** How to show a value: in palm mode it's how much bigger (toward) or smaller (away) the hands look than usual. */
    get fmt() { return mode === 'palm' ? (v) => `${Math.round(def.depth === 'toward' ? -v : v)}%` : mode === 'hand' ? (v) => `${(-v / 100).toFixed(1)} hands` : def.fmt; },
    /**
     * Speed unit: how long one unit of `path` is, as a share of the lifter's height (× height = metres),
     * or NaN when the path has no length (palm mode measures how much bigger the hands look, not metres).
     */
    get unit() { return mode === 'palm' || mode === 'hand' ? NaN : def.unit; },
    /** Smallest movement that is a rep, and how far past a turn it must go, in this set's measure. */
    get counter() { return mode === 'hand' ? def.handPath : { minRange: def.minRange, hysteresis: def.hysteresis }; },
    push(t, poses, worlds, vw, vh, hands = null) {
      switched = false;
      if (def.handPath) { const h = handPush(t, poses, worlds, vw, vh, hands); if (h) return h; }
      const r = read(t, poses, worlds, vw, vh, hands);
      // The moving point's path: how far it has travelled, counted up while lifting (the value falling)
      // and down while lowering, in the lift's own body unit, so speed is the same from any angle.
      // Travel so far, counted up while lifting (the value falls as you lift).
      const tv = r.ok && def.travel ? def.travel(r.f) : NaN;
      const path = !r.ok ? NaN : mode === 'palm' ? -r.value / 100 : def.travel ? (Number.isFinite(tv) ? travelEuro.filter(tv, t) : NaN) : -r.value * def.per;
      // switched: it had been following someone else (the lifter only showed who they are by lifting):
      // anything counted until now was that other person, so the count should start again.
      return { ...r, path, switched };
    },
  };
  // Who is lifting: everyone in the picture is followed (by where they are), with this lift's value
  // measured for each. The lifter is the one whose value moves through a rep-sized range, clearly more
  // than anyone else's (someone standing behind the machine, or waiting their turn, barely moves
  // those joints). Until someone does, it's the biggest body; once found, it stays them for the set.
  function quick(f) {
    if (def.both === 'pair') return def.value(f);
    const vs = ['L', 'R'].map((s) => (visOf(f, s) >= 0.3 ? def.value(f, s) : NaN)).filter(Number.isFinite);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN;
  }
  function spreadOf(vals) { const v = vals.map((x) => x.v).filter(Number.isFinite).sort((a, b) => a - b); return v.length > 10 ? v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)] : 0; }
  function chooseLifter(t, list, vw, vh, hands) {
    const seen = [];
    for (const q of list) {
      const f = liftFeatures(q.lm, q.w, { vw, vh, hands });
      if (!f) continue;
      const c = [(q.lm[11].x + q.lm[12].x + q.lm[23].x + q.lm[24].x) / 4 * vw, (q.lm[11].y + q.lm[12].y + q.lm[23].y + q.lm[24].y) / 4 * vh];
      const size = pickSize(q, vw, vh);
      let who = null, bd = Infinity;
      for (const pp of people) {
        if (seen.includes(pp)) continue;
        // The lifter gets more room (a dip or a jump in the model moves the whole body).
        const d = Math.hypot(c[0] - pp.c[0], c[1] - pp.c[1]), reach = pp.size * ((pp === locked ? 1.2 : 0.6) + 2 * (t - pp.t));
        // Someone walking between the lifter and the phone can stand right where the lifter is, but is
        // much bigger in the picture: never the same person.
        if (Math.abs(Math.log(size / pp.size)) > Math.log(1.35)) continue;
        if (d < reach && d < bd) { bd = d; who = pp; }
      }
      if (!who) { who = { c, size, t, first: t, firstFrame: frameNo, seenFrames: 0, vals: [] }; people.push(who); }
      who.seenFrames++;
      who.c = c; who.t = t; who.size += (size - who.size) * 0.1; who.q = q; who.f = f;
      who.vals.push({ t, v: quick(f) }); while (who.vals.length && t - who.vals[0].t > 5) who.vals.shift();
      seen.push(who);
    }
    frameNo++;
    // The lifter gone for over 2 s (the phone moved, they stepped away): choose again.
    if (locked && t - locked.t > 2) locked = null;
    for (let i = people.length - 1; i >= 0; i--) if (t - people[i].t > 3 && people[i] !== locked) people.splice(i, 1);
    if (!locked && people.length) {
      // Only someone who has been in view for 1.5 s, nearly the whole time, can be the lifter: a person
      // walking past changes shape a lot, but is only in view for a moment.
      const steady = (pp) => t - pp.first >= 1.5 && pp.seenFrames >= 0.7 * (frameNo - pp.firstFrame);
      const ranked = people.map((pp) => ({ pp, s: steady(pp) ? spreadOf(pp.vals) : 0 })).sort((a, b) => b.s - a.s);
      if (ranked[0].s >= 0.8 * def.minRange && (!ranked[1] || ranked[0].s > 2 * ranked[1].s)) {
        locked = ranked[0].pp;
        // Was following someone else (somewhere else in the picture): start clean. Finding the same body
        // again in the same place isn't someone else.
        if (lead && lead !== locked && Math.hypot(lead.c[0] - locked.c[0], lead.c[1] - locked.c[1]) > lead.size) { smooth.reset(); win = []; whoReset(); switched = true; }
      }
    }
    // Until the lifter has shown who they are: the biggest of those who have been in view for a while
    // (someone who just walked in is never followed), else the biggest.
    const settled = seen.filter((pp) => t - pp.first >= 1.5);
    const pool = settled.length ? settled : seen;
    const target = locked || (pool.length ? pool.reduce((a, b) => (b.size > a.size ? b : a)) : null);
    lead = target;
    return target && seen.includes(target) ? { lm: target.q.lm, w: target.q.w, f: target.f } : null;
  }
  // Filmed close (what most people do): the elbow is often out of the picture or behind the arm, so
  // its angle can't be read. The hand still can: its distance from the shoulder, in the lifter's own
  // palm sizes (so the phone's distance doesn't matter), grows as the elbow straightens, whether it's a
  // pushdown, an overhead extension or a kickback. The shoulder only has to be roughly right: it's
  // smoothed hard and held while the body is out of view (the phone is propped, so it doesn't move).
  // Which measure a set uses is decided from how well the elbows are seen, over the last second:
  // mostly hidden → the hand, clearly seen → the elbow. A change restarts the count (`switched`).
  function handPush(t, poses, worlds, vw, vh, hands) {
    const list = (poses || []).map((lm, i) => ({ lm, w: (worlds || [])[i] || null }));
    const body = list.length ? list.reduce((a, b) => (pickSize(b, vw, vh) > pickSize(a, vw, vh) ? b : a)) : null;
    if (body) {
      const s = [(body.lm[11].x + body.lm[12].x) / 2 * vw, (body.lm[11].y + body.lm[12].y) / 2 * vh];
      if (!hp.fixed) hp.sh = hp.sh ? [hp.sh[0] + 0.15 * (s[0] - hp.sh[0]), hp.sh[1] + 0.15 * (s[1] - hp.sh[1])] : s; // held once the set is under way
    }
    const v = (i) => (body ? body.lm[i].visibility ?? 0 : 0);
    hp.seenArm.push(Math.max(Math.min(v(11), v(13), v(15)), Math.min(v(12), v(14), v(16))) >= 0.6);
    if (hp.seenArm.length > 90) hp.seenArm.shift();
    const shareOf = (n) => { const w = hp.seenArm.slice(-n); return w.filter(Boolean).length / w.length; };
    const was = mode;
    // Into hand mode quickly (the elbow hidden for most of a second), back only once the elbow has been
    // clearly seen for 3 s: with the phone close, the arm shows for a moment at the top of every rep.
    // Once the set has moved through a rep in one measure, it keeps that measure (switching mid-set would
    // throw away the reps counted so far).
    if (hp.seenArm.length >= 15 && !hp.fixed) {
      if (mode == null) mode = shareOf(30) >= 0.65 ? 'joints' : 'hand';
      else if (mode === 'joints' && shareOf(30) < 0.5) mode = 'hand';
      else if (mode === 'hand' && hp.seenArm.length >= 90 && shareOf(90) >= 0.9) mode = 'joints';
    }
    if (was && mode !== was) { smooth.reset(); win = []; switched = true; hp.vals = []; }
    if (mode !== 'hand') return null;
    // The hand: the one nearest where the hand was (the working hand), else the nearest the shoulder.
    let best = null, bd = Infinity;
    for (const h of hands || []) {
      if (!h || h.length < 18) continue;
      const P = (i) => [h[i].x * vw, h[i].y * vh];
      const c = [0, 5, 9, 13, 17].map(P).reduce((a, q) => [a[0] + q[0] / 5, a[1] + q[1] / 5], [0, 0]);
      const size = [5, 9, 13, 17].reduce((a, i) => a + Math.hypot(P(i)[0] - P(0)[0], P(i)[1] - P(0)[1]), 0) / 4;
      const anchor = hp.last || hp.sh; if (!anchor) continue;
      const d = Math.hypot(c[0] - anchor[0], c[1] - anchor[1]);
      if (d < bd) { bd = d; best = { c, size }; }
    }
    if (!best || !hp.sh) return { ok: false, value: NaN, f: null, path: NaN, switched, side: 'hand' };
    hp.last = best.c;
    if (hp.refs.length < 30) hp.refs.push(best.size);
    const palm = hp.refs.slice().sort((a, b) => a - b)[hp.refs.length >> 1];
    // Measured along the line the hand travels (the main direction of its last few seconds of movement),
    // pointing away from the shoulder, so a hand rising past the shoulder at the top isn't "extending".
    // The hand's own position (the phone is propped, so the picture holds still); the shoulder, which
    // the model places badly when the body is half out of the picture, only says which end of the line
    // is "extended" (the end further from it).
    const rel = best.c;
    hp.path.push(rel); if (hp.path.length > 180) hp.path.shift();
    let axis = null;
    if (hp.path.length >= 20) {
      const n = hp.path.length, mx = hp.path.reduce((a, q) => a + q[0], 0) / n, my = hp.path.reduce((a, q) => a + q[1], 0) / n;
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of hp.path) { sxx += (q[0] - mx) ** 2; syy += (q[1] - my) ** 2; sxy += (q[0] - mx) * (q[1] - my); }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      axis = [Math.cos(th), Math.sin(th)];
      if (axis[0] * (mx - hp.sh[0]) + axis[1] * (my - hp.sh[1]) < 0) axis = [-axis[0], -axis[1]];
      if (sxx + syy < (0.5 * palm) ** 2 * n) axis = null; // not moving yet: no line to measure along
    }
    if (hp.axis && !hp.fixed && axis) hp.axis = axis; else if (!hp.axis && axis) hp.axis = axis;
    const along = hp.axis ? (rel[0] - hp.sh[0]) * hp.axis[0] + (rel[1] - hp.sh[1]) * hp.axis[1] : Math.hypot(rel[0] - hp.sh[0], rel[1] - hp.sh[1]);
    const val = (-100 * along) / palm;
    const value = euro.filter(val, t);
    hp.vals.push({ t, v: value }); if (hp.vals.length > 300) hp.vals.shift();
    if (spreadOf(hp.vals) >= def.handPath.minRange) hp.fixed = true;
    return { ok: true, value, f: null, path: -value / 100, switched, side: 'hand' };
  }
  function read(t, poses, worlds, vw, vh, hands) {
    {
      const list = (poses || []).map((lm, i) => ({ lm, w: (worlds || [])[i] || null }));
      const p = chooseLifter(t, list, vw, vh, hands);
      const f = p ? p.f : null;
      if (!f) return { ok: false, value: NaN, f: null };
      // Someone between the lifter and the phone (bigger in the picture than the lifter, so nearer the
      // lens) overlapping them: the model guesses the hidden joints with full confidence, so these frames
      // don't count. People behind the lifter look smaller and never block anything.
      const box = (lm) => { const xs = [], ys = []; for (const q of lm) if ((q.visibility ?? 1) >= 0.3) { xs.push(q.x * vw); ys.push(q.y * vh); } return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null; };
      const mine = box(p.lm);
      for (const q of list) {
        if (q.lm === p.lm || !mine) continue;
        const qs = Math.hypot(((q.lm[11].x + q.lm[12].x) - (q.lm[23].x + q.lm[24].x)) / 2 * vw, ((q.lm[11].y + q.lm[12].y) - (q.lm[23].y + q.lm[24].y)) / 2 * vh);
        if (!(qs > f.torso2d * 1.1)) continue;
        const b = box(q.lm); if (!b) continue;
        const ix = Math.max(0, Math.min(b[2], mine[2]) - Math.max(b[0], mine[0])), iy = Math.max(0, Math.min(b[3], mine[3]) - Math.max(b[1], mine[1]));
        if (ix * iy > 0.05 * (mine[2] - mine[0]) * (mine[3] - mine[1])) return { ok: false, value: NaN, f: null, blocked: true };
        // Or covers one of the joints this lift is measured on (their body reaches the hand first).
        const padX = 0.25 * (b[2] - b[0]), padY = 0.05 * (b[3] - b[1]);
        for (const j of def.limb === 'leg' ? [25, 26, 27, 28] : [13, 14, 15, 16]) {
          const x = p.lm[j].x * vw, y = p.lm[j].y * vh;
          if (x > b[0] - padX && x < b[2] + padX && y > b[1] - padY && y < b[3] + padY) return { ok: false, value: NaN, f: null, blocked: true };
        }
      }
      prev = p;
      if (def.both === 'pair') {
        const vs = def.limb === 'leg' ? f.legVis : f.vis, ok = Math.min(vs.L, vs.R) >= minVis * 0.6;
        const v = def.value(f);
        return { ok: ok && Number.isFinite(v), value: ok && Number.isFinite(v) ? euro.filter(v, t) : NaN, side: 'both', f };
      }
      // Pushes and pulls filmed from in front: the hands travel straight at the lens, which neither the
      // picture nor the model's depth guess shows well, but the hands' size in the picture does. Each
      // hand is measured against its own usual size (log, so it's a % change at any phone distance).
      if (def.depth) {
        // Each hand's reference: the median of its first second of readings (from the very first frame),
        // then fixed, so every rep is measured on the same scale as rep 1.
        const lg = {};
        for (const s of ['L', 'R']) {
          if (!Number.isFinite(f['palm' + s])) continue;
          lg[s] = 100 * Math.log(f['palm' + s]);
          if (palmRef[s] == null) { palmHist[s].push(lg[s]); if (palmHist[s].length >= 30) palmRef[s] = palmHist[s].slice().sort((a, b) => a - b)[15]; }
        }
        if (mode == null) {
          if (Number.isFinite(f.facing)) facings.push(f.facing);
          if (facings.length < 20) return { ok: false, value: NaN, f }; // which way the phone looks: decided first
          mode = facings.slice().sort((a, b) => a - b)[10] >= 0.6 ? 'palm' : 'joints';
        }
        if (mode === 'palm') {
          const parts = ['L', 'R'].filter((s) => lg[s] != null && palmRef[s] != null).map((s) => (def.depth === 'toward' ? -1 : 1) * (lg[s] - palmRef[s]));
          const ok = parts.length > 0, v = ok ? parts.reduce((a, b) => a + b, 0) / parts.length : NaN;
          return { ok, value: ok ? euro.filter(v, t) : NaN, side: 'palm', f };
        }
      }
      const val = { L: def.value(f, 'L'), R: def.value(f, 'R') };
      const seen = { L: visOf(f, 'L') >= minVis && Number.isFinite(val.L), R: visOf(f, 'R') >= minVis && Number.isFinite(val.R) };
      for (const s of ['L', 'R']) { hist[s].push(seen[s] ? val[s] : NaN); if (hist[s].length > 240) hist[s].shift(); }
      let v = NaN, used = null;
      if (fixedSide && otherRest) {
        // Alternating lifts (one arm at a time): the far arm is often hidden, and the model's guess for a
        // hidden arm is usually a copy of the near one. Read it, however faintly seen, only while the
        // other arm rests at its own start (a copy can't do that: it moves when the near arm moves).
        const o = fixedSide === 'L' ? 'R' : 'L', ov = val[o];
        const oHist = hist[o].filter(Number.isFinite), oStart = oHist.length > 15 ? oHist.slice().sort((a, b) => b - a)[Math.floor(oHist.length * 0.1)] : NaN;
        const resting = seen[o] && Number.isFinite(oStart) && ov >= oStart - otherRest;
        const ok = Number.isFinite(val[fixedSide]) && (seen[fixedSide] || (resting && visOf(f, fixedSide) >= 0.05));
        return { ok, value: ok ? euro.filter(val[fixedSide], t) : NaN, side: fixedSide, f };
      }
      if (fixedSide) { const ok = seen[fixedSide]; return { ok, value: ok ? euro.filter(val[fixedSide], t) : NaN, side: fixedSide, f }; }
      if (def.both && seen.L && seen.R && Math.abs(val.L - val.R) < 2 * def.minRange) { v = (val.L * visOf(f, 'L') + val.R * visOf(f, 'R')) / (visOf(f, 'L') + visOf(f, 'R')); used = 'both'; }
      else {
        // The side that moves most so far (one-arm lifts), else the side seen best.
        if (!side || !def.both) {
          const rl = spread(hist.L), rr = spread(hist.R);
          if (Math.max(rl, rr) >= def.minRange) side = rl >= rr ? 'L' : 'R';
        }
        const s = side && seen[side] ? side : seen.L && (!seen.R || visOf(f, 'L') >= visOf(f, 'R')) ? 'L' : seen.R ? 'R' : null;
        if (s && (!side || s === side || def.both)) { v = val[s]; used = s; }
      }
      const ok = Number.isFinite(v);
      const out = ok ? euro.filter(v, t) : NaN;
      if (def.handPath && ok) { hp.vals.push({ t, v: out }); if (hp.vals.length > 300) hp.vals.shift(); if (spreadOf(hp.vals) >= def.minRange) hp.fixed = true; }
      return { ok, value: out, side: used, f };
    }
  }
}

/** Torso length + shoulder width in the picture (any posture). */
function pickSize(q, vw, vh) {
  const l = q.lm;
  return Math.hypot(((l[11].x + l[12].x) - (l[23].x + l[24].x)) / 2 * vw, ((l[11].y + l[12].y) - (l[23].y + l[24].y)) / 2 * vh) + Math.hypot((l[11].x - l[12].x) * vw, (l[11].y - l[12].y) * vh);
}

