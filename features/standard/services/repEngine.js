// Rep standardisation engine — pure logic, no camera, no DOM.
//
// Feed it the working joint angle over time (elbow angle for a curl:
// ~170° fully stretched, ~45° at the top). The first full rep locks the
// standard: its Start (deepest stretch) and Finish (highest point). Every
// later rep must reach both, within a tolerance, to count. Speed is never
// judged — reps may slow down as the set gets hard.
//
// Results per rep: 'counted' | 'short' (missed Start and/or Finish; counts
// as zero) | 'unclear' (the camera lost the arm; not counted, not blamed).

/** Angle at b (degrees) formed by points a–b–c, in 2-D pixel space. */
export function jointAngle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** One Euro filter: smooths jitter at rest, stays responsive when moving. */
export function oneEuro({ minCutoff = 1.5, beta = 0.05, dCutoff = 1.0 } = {}) {
  let x = null, dx = 0, tPrev = null;
  const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };
  return {
    filter(value, t) {
      if (x === null || tPrev === null || t <= tPrev) { x = value; tPrev = t; dx = 0; return x; }
      const dt = t - tPrev; tPrev = t;
      const dRaw = (value - x) / dt;
      dx = dx + alpha(dCutoff, dt) * (dRaw - dx);
      const cutoff = minCutoff + beta * Math.abs(dx);
      x = x + alpha(cutoff, dt) * (value - x);
      return x;
    },
    reset() { x = null; tPrev = null; dx = 0; },
  };
}

export const DEFAULTS = {
  minRange: 40,        // degrees a movement must cover to be a rep at all
  hysteresis: 20,      // degrees past a turning point before it's confirmed
  hysteresisPct: 0.3,  // once the standard exists: share of its range
  tolFloor: 8,         // tolerance never smaller than this (camera noise)
  tolPct: 0.15,        // tolerance as a share of the locked range (≈19° on a full curl)
  unclearShare: 0.3,   // > this share of low-confidence frames → unclear
  maxGap: 0.5,         // seconds without a confident frame → unclear
};

// Squat and bench measure height in body-length percent (§ height measures
// below), not degrees, so they get their own thresholds.
export const HEIGHT_DEFAULTS = { minRange: 20, hysteresis: 10, tolFloor: 4 };

/**
 * Rep counter for a flexion movement (angle falls during the lift).
 *   const rc = createRepCounter(); rc.push(t, angle, confident) → event|null
 * Events: { type: 'standard', standard } then { type: 'rep', rep } per rep.
 */
export function createRepCounter(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let standard = null;
  let reps = [];
  // Turning-point tracking. dir 'extend' = angle rising (lowering the weight).
  let dir = 'extend', peak = null, peakT = 0, trough = null, troughT = 0;
  let repFrames = 0, repLow = 0, lastConfT = null, gap = 0, started = false;

  const H = () => (standard ? Math.max(o.hysteresis * 0.75, o.hysteresisPct * (standard.start - standard.finish)) : o.hysteresis);
  const tol = () => (standard ? Math.max(o.tolFloor, o.tolPct * (standard.start - standard.finish)) : o.tolFloor);

  function judge(bottom, top, unclear) {
    if (unclear) return { result: 'unclear', shortStart: false, shortFinish: false };
    const shortStart = bottom < standard.start - tol();
    const shortFinish = top > standard.finish + tol();
    return { result: shortStart || shortFinish ? 'short' : 'counted', shortStart, shortFinish };
  }

  function push(t, angle, confident = true) {
    if (!started) { lastConfT = t; started = true; }
    if (dir === 'flex') { repFrames++; if (!confident || !Number.isFinite(angle)) repLow++; }
    if (!confident || !Number.isFinite(angle)) { gap = Math.max(gap, t - (lastConfT ?? t)); return null; }
    if (dir === 'flex') gap = Math.max(gap, t - lastConfT);
    lastConfT = t;

    if (peak === null) { peak = angle; peakT = t; return null; }

    if (dir === 'extend') {
      if (angle > peak) { peak = angle; peakT = t; }
      else if (angle < peak - H()) {
        // Left the stretch: a lift has begun. The rep's Start is `peak`.
        dir = 'flex'; trough = angle; troughT = t; repFrames = 1; repLow = 0; gap = 0;
      }
      return null;
    }

    // dir === 'flex' (lifting)
    if (angle < trough) { trough = angle; troughT = t; return null; }
    if (angle <= trough + H()) return null;

    // Turned back down: the rep's top was `trough`. Judge it now.
    const bottom = peak, top = trough, startT = peakT;
    const unclear = repFrames > 0 && (repLow / repFrames > o.unclearShare || gap > o.maxGap);
    dir = 'extend'; peak = angle; peakT = t;
    if (bottom - top < o.minRange) return null; // a twitch, not a rep

    if (!standard) {
      if (unclear) {
        const rep = { n: reps.length + 1, bottom, top, startT, topT: troughT, result: 'unclear', shortStart: false, shortFinish: false, isStandard: false };
        reps.push(rep);
        return { type: 'rep', rep };
      }
      standard = { start: bottom, finish: top };
      const rep = { n: reps.length + 1, bottom, top, startT, topT: troughT, result: 'counted', shortStart: false, shortFinish: false, isStandard: true };
      reps.push(rep);
      return { type: 'standard', standard: { ...standard, tol: tol() }, rep };
    }
    const rep = { n: reps.length + 1, bottom, top, startT, topT: troughT, ...judge(bottom, top, unclear), isStandard: false };
    reps.push(rep);
    return { type: 'rep', rep };
  }

  return {
    push,
    /** Forget the standard; the next full rep becomes the new one. */
    relock() { standard = null; },
    /** Change a rep's result after the set (user correction). */
    override(n, result) { const r = reps.find((x) => x.n === n); if (r) r.result = result; return r; },
    get standard() { return standard ? { ...standard, tol: tol() } : null; },
    get reps() { return reps.slice(); },
    summary() {
      return {
        counted: reps.filter((r) => r.result === 'counted').length,
        short: reps.filter((r) => r.result === 'short').length,
        unclear: reps.filter((r) => r.result === 'unclear').length,
      };
    },
  };
}

/**
 * Rep counter for lifts that start at the top, go down and come back up
 * (squat, bench), or hang and come back down (pull-ups: the value is the
 * nose's height below the bar, so it also falls during the lift).
 * The value is a height: high at lockout, low at depth.
 * A rep is judged when you are back up, not at the bottom: it counts the
 * moment you return to the locked-out height, or it is judged short if you
 * turn back down before getting there.
 *   const rc = createReturnCounter(HEIGHT_DEFAULTS); rc.push(t, height, confident)
 * Same events, API and rep shape as createRepCounter, with Start = lockout
 * and Finish = depth: rep.bottom is the lockout reached at the end of the
 * rep, rep.top the depth; shortStart = missed lockout, shortFinish = missed
 * depth.
 * Options for pull-ups (off unless set):
 *   swayTol    — push(t, value, confident, sway) with sway a number or an
 *                array (e.g. hip position in torso lengths). Rep 1 records how
 *                far it swayed (largest min–max range of any component); a
 *                later rep swaying more than that + swayTol is short
 *                (rep.shortSwing).
 *   emitFinish — return { type: 'finish' } the moment a rep reaches the
 *                standard's Finish, before the rep is over.
 */
export function createReturnCounter(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let standard = null;
  let reps = [];
  // 'top' = at lockout (tracking how high it gets), 'down' = descending
  // (tracking the deepest point), 'up' = coming back up.
  let phase = 'top', peak = null, startTop = 0, trough = 0, troughT = 0, rise = 0;
  let repFrames = 0, repLow = 0, lastConfT = null, gap = 0, started = false;
  // A rep counts the moment it passes the lockout line; its recorded lockout
  // keeps rising to the real top until the next descent starts.
  let finishing = null;
  let swayLo = null, swayHi = null, ticked = false;

  const H = () => (standard ? Math.max(o.hysteresis * 0.75, o.hysteresisPct * (standard.start - standard.finish)) : o.hysteresis);
  const tol = () => (standard ? Math.max(o.tolFloor, o.tolPct * (standard.start - standard.finish)) : o.tolFloor);

  function beginDescent(from, v, t) {
    phase = 'down'; startTop = from; trough = v; troughT = t; repFrames = 1; repLow = 0; gap = 0; finishing = null;
    swayLo = null; swayHi = null; ticked = false;
  }
  function trackSway(sway) {
    if (sway == null) return;
    const xs = [].concat(sway);
    if (xs.some((x) => !Number.isFinite(x))) return;
    if (!swayLo) { swayLo = xs.slice(); swayHi = xs.slice(); return; }
    xs.forEach((x, i) => { if (x < swayLo[i]) swayLo[i] = x; if (x > swayHi[i]) swayHi[i] = x; });
  }
  const swayRange = () => (swayLo ? Math.max(...swayHi.map((h, i) => h - swayLo[i])) : null);

  // The rep is over: `lockout` is how high it came back. `turnedDown` means
  // it never reached the lockout and the next rep's descent has begun.
  function complete(lockout, t, v, turnedDown) {
    const unclear = repFrames > 0 && (repLow / repFrames > o.unclearShare || gap > o.maxGap);
    const sway = swayRange();
    const base = { n: reps.length + 1, bottom: lockout, top: trough, topT: troughT, sway, shortSwing: false };
    let event;
    if (!standard) {
      if (unclear) {
        const rep = { ...base, result: 'unclear', shortStart: false, shortFinish: false, isStandard: false };
        reps.push(rep); event = { type: 'rep', rep };
      } else {
        standard = { start: startTop, finish: trough, sway };
        const rep = { ...base, result: 'counted', shortStart: false, shortFinish: false, isStandard: true };
        reps.push(rep); event = { type: 'standard', standard: { ...standard, tol: tol() }, rep };
      }
    } else {
      const shortStart = lockout < standard.start - tol();
      const shortFinish = trough > standard.finish + tol();
      const shortSwing = o.swayTol != null && standard.sway != null && sway != null && sway > standard.sway + o.swayTol;
      const result = unclear ? 'unclear' : shortStart || shortFinish || shortSwing ? 'short' : 'counted';
      const rep = { ...base, result, shortStart: unclear ? false : shortStart, shortFinish: unclear ? false : shortFinish, shortSwing: unclear ? false : shortSwing, isStandard: false };
      reps.push(rep); event = { type: 'rep', rep };
    }
    if (turnedDown) beginDescent(lockout, v, t);
    else { phase = 'top'; peak = v; finishing = event.rep; }
    return event;
  }

  function push(t, value, confident = true, sway = null) {
    const good = confident && Number.isFinite(value);
    if (!started) { lastConfT = t; started = true; }
    const inRep = phase !== 'top';
    if (inRep) { repFrames++; if (!good) repLow++; }
    if (!good) { if (inRep) gap = Math.max(gap, t - (lastConfT ?? t)); return null; }
    if (inRep) { gap = Math.max(gap, t - lastConfT); trackSway(sway); }
    lastConfT = t;

    if (peak === null) { peak = value; return null; }

    if (phase === 'top') {
      if (value > peak) { peak = value; if (finishing && peak > finishing.bottom) finishing.bottom = peak; }
      else if (value < peak - H()) beginDescent(peak, value, t);
      return null;
    }

    if (phase === 'down') {
      if (value < trough) {
        trough = value; troughT = t;
        if (o.emitFinish && standard && !ticked && value <= standard.finish + tol()) { ticked = true; return { type: 'finish', t }; }
        return null;
      }
      if (value <= trough + H()) return null;
      if (startTop - trough < o.minRange) { phase = 'top'; peak = value; return null; } // a dip, not a rep
      phase = 'up'; rise = value;
      return null;
    }

    // phase === 'up'
    if (value > rise) rise = value;
    const lockedOut = standard
      ? value >= standard.start - tol()
      : value >= startTop - Math.max(o.tolFloor, o.tolPct * (startTop - trough)); // rep 1: back where it began
    if (lockedOut) return complete(value, t, value, false);
    if (value < rise - H()) return complete(rise, t, value, true);
    return null;
  }

  return {
    push,
    relock() { standard = null; },
    override(n, result) { const r = reps.find((x) => x.n === n); if (r) r.result = result; return r; },
    get standard() { return standard ? { ...standard, tol: tol() } : null; },
    get reps() { return reps.slice(); },
    summary() {
      return {
        counted: reps.filter((r) => r.result === 'counted').length,
        short: reps.filter((r) => r.result === 'short').length,
        unclear: reps.filter((r) => r.result === 'unclear').length,
      };
    },
  };
}

/**
 * Pick the lifter among detected people. Once locked, stay on the person
 * whose shoulders are nearest the previous position (so someone walking
 * past can't steal the track); before that, take the largest person.
 * poses: arrays of landmarks {x,y,visibility} in 0–1 image coordinates.
 */
export function pickPerson(poses, prevCenter, maxJump = 0.25) {
  if (!poses || !poses.length) return -1;
  const center = (p) => ({ x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 });
  if (prevCenter) {
    let best = -1, bestD = Infinity;
    poses.forEach((p, i) => { const c = center(p); const d = Math.hypot(c.x - prevCenter.x, c.y - prevCenter.y); if (d < bestD) { bestD = d; best = i; } });
    return bestD <= maxJump ? best : -1;
  }
  let best = -1, bestSize = -1;
  poses.forEach((p, i) => {
    const size = Math.hypot(p[11].x - p[23].x, p[11].y - p[23].y) + Math.hypot(p[12].x - p[24].x, p[12].y - p[24].y);
    if (size > bestSize) { bestSize = size; best = i; }
  });
  return best;
}

// Shoulder, elbow, wrist landmark indices (MediaPipe Pose), person's own sides.
export const ARMS = { left: [11, 13, 15], right: [12, 14, 16] };

/** Mean visibility of an arm's three joints. */
export function armVisibility(pose, side) {
  return ARMS[side].reduce((s, i) => s + (pose[i].visibility ?? 0), 0) / 3;
}

// ── Height measures for squat and bench ─────────────────────────────────
// Squat: hip height above the feet. Bench: wrist (bar) height above the
// shoulders. Measured straight up the image and divided by a body length
// that is locked while you hold still before rep 1, so the reading is the
// same filmed from the side, front, back or at an angle. Nothing is scaled
// by a limb that foreshortens mid-rep, and the reference (feet, shoulders)
// doesn't move during the lift, so the Start / Finish lines stay put
// instead of riding along with the body.
//
// Squat values are % of standing hip height: ~100 standing, ~50 at parallel.
// Bench values are 100 + bar height above the shoulders in % of the body
// length (shoulder width, or torso length when filmed side-on).

export const HEIGHT_LIFTS = {
  squat: { point: [23, 24], ref: [27, 28], offset: 0 },
  bench: { point: [15, 16], ref: [11, 12], offset: 100 },
};

const LEGS = [[23, 25, 27], [24, 26, 28]];
const STRAIGHT_KNEE = 150; // degrees; legs straighter than this count as standing

/** Mean pixel position of the landmarks in `idx` that are visible, or null. */
export function midpoint(pose, idx, vw, vh, minVis = 0.55) {
  let x = 0, y = 0, n = 0;
  for (const i of idx) {
    const p = pose[i];
    if (p && (p.visibility ?? 0) >= minVis) { x += p.x * vw; y += p.y * vh; n++; }
  }
  return n ? { x: x / n, y: y / n, n } : null;
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Height tracker for 'squat' or 'bench'.
 *   calibrate(pose, vw, vh) → { ok, why }  (call on steady frames before rep 1)
 *   lock() → true once enough frames were collected
 *   measure(pose, vw, vh)  → { ok, value, point }
 *   lineY(value)           → image y (pixels) of a height, for drawing
 * `why` names what's missing: 'feet', 'hips', 'stand', 'shoulders', 'hands'.
 */
export function createHeightTracker(kind, { minVis = 0.55, refFollow = 0.05, minFrames = 5 } = {}) {
  const spec = HEIGHT_LIFTS[kind];
  if (!spec) throw new Error(`Unknown lift: ${kind}`);
  let lens = [], refs = [], vals = [], scale = 0, refY = null, calValue = NaN;
  // For bar velocity: standing shoulder height (squat; the bar sits on the
  // shoulders) and straight-arm lengths seen so far (bench).
  let shoulders = [], standShoulderPx = 0, armLens = [];
  const mid = (pose, idx, vw, vh) => midpoint(pose, idx, vw, vh, minVis);

  function bodyLength(pose, vw, vh) {
    if (kind === 'squat') {
      const hip = mid(pose, spec.point, vw, vh), feet = mid(pose, spec.ref, vw, vh);
      if (!feet) return { why: 'feet' };
      if (!hip) return { why: 'hips' };
      const knees = LEGS.filter((l) => l.every((i) => (pose[i].visibility ?? 0) >= minVis))
        .map(([h, k, a]) => jointAngle({ x: pose[h].x * vw, y: pose[h].y * vh }, { x: pose[k].x * vw, y: pose[k].y * vh }, { x: pose[a].x * vw, y: pose[a].y * vh }));
      if (knees.length && Math.max(...knees) < STRAIGHT_KNEE) return { why: 'stand' };
      const len = feet.y - hip.y;
      const sh = mid(pose, [11, 12], vw, vh);
      return len > 0 ? { len, ref: feet.y, shoulder: sh ? feet.y - sh.y : null } : { why: 'stand' };
    }
    const sh = mid(pose, spec.ref, vw, vh);
    if (!sh) return { why: 'shoulders' };
    if (!mid(pose, spec.point, vw, vh)) return { why: 'hands' };
    const px = (i) => ({ x: pose[i].x * vw, y: pose[i].y * vh });
    const seen = (i) => (pose[i].visibility ?? 0) >= minVis;
    let len = 0;
    if (seen(11) && seen(12)) len = Math.max(len, Math.hypot(px(11).x - px(12).x, px(11).y - px(12).y));
    const hips = mid(pose, [23, 24], vw, vh);
    if (hips) len = Math.max(len, Math.hypot(hips.x - sh.x, hips.y - sh.y));
    return len > 0 ? { len, ref: sh.y } : { why: 'shoulders' };
  }

  const toValue = (y) => spec.offset + ((refY - y) / scale) * 100;

  return {
    calibrate(pose, vw, vh) {
      const b = bodyLength(pose, vw, vh);
      if (!b.len) return { ok: false, why: b.why };
      lens.push(b.len); refs.push(b.ref);
      if (b.shoulder > 0) shoulders.push(b.shoulder);
      const p = mid(pose, spec.point, vw, vh);
      if (p) vals.push({ y: p.y, ref: b.ref, len: b.len });
      return { ok: true };
    },
    lock() {
      if (lens.length < minFrames) return false;
      scale = median(lens); refY = median(refs);
      standShoulderPx = shoulders.length ? median(shoulders) : 0;
      calValue = vals.length ? median(vals.map((v) => spec.offset + ((v.ref - v.y) / v.len) * 100)) : NaN;
      return true;
    },
    measure(pose, vw, vh) {
      if (!scale) return { ok: false, value: NaN, point: null };
      const r = mid(pose, spec.ref, vw, vh);
      if (r) refY += refFollow * (r.y - refY); // follows the feet / shoulders slowly, never the moving body
      const point = mid(pose, spec.point, vw, vh);
      // Bar height in body units: shoulders above the feet (squat), hands
      // above the shoulders (bench).
      let bar = NaN;
      if (kind === 'squat') { const sh = mid(pose, [11, 12], vw, vh); if (sh) bar = (refY - sh.y) / scale; }
      else if (point) {
        bar = (refY - point.y) / scale;
        for (const [a, b] of [[11, 15], [12, 16]]) {
          if ((pose[a].visibility ?? 0) >= minVis && (pose[b].visibility ?? 0) >= minVis) {
            armLens.push(Math.hypot((pose[a].x - pose[b].x) * vw, (pose[a].y - pose[b].y) * vh));
            if (armLens.length > 3000) armLens.shift();
          }
        }
      }
      if (!point) return { ok: false, value: NaN, point: null, bar };
      return { ok: true, value: toValue(point.y), point, bar };
    },
    lineY(value) { return refY - ((value - spec.offset) * scale) / 100; },
    reset() { lens = []; refs = []; vals = []; scale = 0; refY = null; calValue = NaN; shoulders = []; standShoulderPx = 0; armLens = []; },
    get locked() { return scale > 0; },
    /** Pixels per body unit (locked before rep 1). */
    get scale() { return scale; },
    /** Squat: standing shoulder height above the feet, in pixels. */
    get standShoulderPx() { return standShoulderPx; },
    /** Bench: straight-arm length in pixels (90th percentile of what's been seen; arms are straight at every lockout). */
    get armPx() {
      if (armLens.length < 10) return 0;
      const s = armLens.slice().sort((a, b) => a - b);
      return s[Math.round(0.9 * (s.length - 1))];
    },
    /** The height held during calibration (standing / lockout). */
    get calValue() { return calValue; },
  };
}

// ── Getting set up is never rep 1 ───────────────────────────────────────
/**
 * Waits until the lifter holds still: every value stays within its band for
 * `secs` in a row. Until then nothing reaches the rep counter, so jumping to
 * the bar, picking up the dumbbell, unracking or walking out can't become
 * rep 1. A missing (non-finite) value starts the wait again.
 *   const g = createStillGate({ secs: 1, bands: [5] }); g.push(t, [value, ...]) → true once still
 */
export function createStillGate({ secs = 1, bands = [5] } = {}) {
  let win = [];
  return {
    push(t, values) {
      const vs = [].concat(values);
      if (!vs.length || vs.some((v) => !Number.isFinite(v))) { win = []; return false; }
      win.push({ t, vs });
      // Keep the longest recent run in which every value stayed in its band.
      const inBand = () => vs.every((_, i) => {
        const xs = win.map((w) => w.vs[i]).filter((x) => x !== undefined);
        return Math.max(...xs) - Math.min(...xs) <= (bands[i] ?? bands[0]);
      });
      while (win.length > 1 && !inBand()) win.shift();
      return t - win[0].t >= secs;
    },
    reset() { win = []; },
  };
}

// ── Pull-ups: the bar is fixed, the body moves ──────────────────────────
// Camera front-on, both arms visible. The bar is where the hands are: once
// both wrists hold still near the top of the picture for `lockSecs`, a bar
// line is locked at their average height, and the upper-arm and torso
// lengths are measured over that same moment (medians, so heavily smoothed).
// None of it changes until the hands move more than 10% of an arm's length,
// so lines drawn from it stay perfectly still while the body moves.
//   height = (nose y − bar y) / upper-arm length × 100
// About +110 in a dead hang, below 0 once the nose is over the bar: it falls
// as you pull, like the other lifts. Left and right arms are averaged.
// Swing is measured on the hips in torso lengths: sideways drift from under
// the bar, and how much the torso shortens on camera (front-on, a kip swings
// the hips towards and away from the lens, which shows up as exactly that).

export const PULLUP_DEFAULTS = { minRange: 20, hysteresis: 10, tolFloor: 3, tolPct: 0.03, swayTol: 0.1, emitFinish: true };

export function createPullupTracker({ minVis = 0.55, lockSecs = 0.5, steadyPct = 0.06, topShare = 0.55, relockPct = 0.1, wristFollow = 0.15, noseFollow = 0.6 } = {}) {
  let win = [], bar = null, wristY = null, noseY = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  function read(pose, vw, vh) {
    const seen = (i) => (pose[i]?.visibility ?? 0) >= minVis;
    const P = (i) => ({ x: pose[i].x * vw, y: pose[i].y * vh });
    const mid = (a, b) => (seen(a) && seen(b) ? { x: (P(a).x + P(b).x) / 2, y: (P(a).y + P(b).y) / 2 } : seen(a) ? P(a) : seen(b) ? P(b) : null);
    const ua = [[11, 13], [12, 14]].filter(([s, e]) => seen(s) && seen(e)).map(([s, e]) => dist(P(s), P(e)));
    const arm = [[11, 13, 15], [12, 14, 16]].filter((j) => j.every(seen)).map(([s, e, w]) => dist(P(s), P(e)) + dist(P(e), P(w)));
    const sh = mid(11, 12), hip = mid(23, 24);
    return {
      wrists: seen(15) && seen(16) ? mid(15, 16) : null,
      nose: seen(0) ? P(0) : null,
      sh, hip,
      ua: ua.length ? mean(ua) : NaN,
      arm: arm.length ? mean(arm) : NaN,
      torso: [11, 12, 23, 24].every(seen) ? dist(sh, hip) : NaN,
    };
  }

  function measure(f) {
    if (f.nose) noseY = noseY == null ? f.nose.y : noseY + noseFollow * (f.nose.y - noseY);
    const ok = !!f.nose;
    const value = ok ? ((noseY - bar.y) / bar.upperArm) * 100 : NaN;
    const sway = Number.isFinite(bar.torso) && Number.isFinite(f.torso) ? [(f.hip.x - bar.x) / bar.torso, f.torso / bar.torso] : null;
    return { barLocked: true, justLocked: false, ok, value, sway, nose: f.nose ? { x: f.nose.x, y: noseY } : null };
  }

  /**
   * One frame. Returns { barLocked, justLocked, justUnlocked, ok, value, sway, nose, why }.
   * `why` (bar not locked) is 'hands' (can't see both), 'reach' (hands not
   * up at the bar), 'steady' (hands still moving) or 'moved' (they left the bar).
   */
  function track(pose, vw, vh, t) {
    const f = read(pose, vw, vh);
    if (!bar) {
      if (!f.wrists) { win = []; return { barLocked: false, why: 'hands' }; }
      if (f.wrists.y > topShare * vh || (f.sh && f.wrists.y > f.sh.y)) { win = []; return { barLocked: false, why: 'reach' }; }
      win.push({ t, ...f });
      while (win.length && t - win[0].t > lockSecs + 0.2) win.shift();
      const arms = win.map((w) => w.arm).filter(Number.isFinite);
      const limit = steadyPct * (arms.length ? median(arms) : 0.3 * vh);
      const ys = win.map((w) => w.wrists.y), xs = win.map((w) => w.wrists.x);
      if (Math.max(...ys) - Math.min(...ys) > limit || Math.max(...xs) - Math.min(...xs) > limit) { win = [win[win.length - 1]]; return { barLocked: false, why: 'steady' }; }
      const uas = win.map((w) => w.ua).filter(Number.isFinite);
      if (t - win[0].t < lockSecs || !uas.length || !arms.length) return { barLocked: false, why: 'steady' };
      const torsos = win.map((w) => w.torso).filter(Number.isFinite);
      bar = { y: mean(ys), x: mean(xs), upperArm: median(uas), arm: median(arms), torso: torsos.length ? median(torsos) : NaN };
      wristY = bar.y; noseY = null; win = [];
      return { ...measure(f), justLocked: true };
    }
    if (f.wrists) {
      wristY += wristFollow * (f.wrists.y - wristY);
      if (Math.abs(wristY - bar.y) > relockPct * bar.arm) { bar = null; win = []; return { barLocked: false, justUnlocked: true, why: 'moved' }; }
    }
    return measure(f);
  }

  return {
    track,
    /** Image y (pixels) of a height value: fixed while the bar stays locked. */
    lineY(value) { return bar ? bar.y + (value * bar.upperArm) / 100 : NaN; },
    get bar() { return bar ? { ...bar } : null; },
    get locked() { return !!bar; },
    reset() { win = []; bar = null; wristY = null; noseY = null; },
  };
}
