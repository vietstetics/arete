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
 * (squat, bench). The value is a height: high at lockout, low at depth.
 * A rep is judged when you are back up, not at the bottom: it counts the
 * moment you return to the locked-out height, or it is judged short if you
 * turn back down before getting there.
 *   const rc = createReturnCounter(HEIGHT_DEFAULTS); rc.push(t, height, confident)
 * Same events, API and rep shape as createRepCounter, with Start = lockout
 * and Finish = depth: rep.bottom is the lockout reached at the end of the
 * rep, rep.top the depth; shortStart = missed lockout, shortFinish = missed
 * depth.
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

  const H = () => (standard ? Math.max(o.hysteresis * 0.75, o.hysteresisPct * (standard.start - standard.finish)) : o.hysteresis);
  const tol = () => (standard ? Math.max(o.tolFloor, o.tolPct * (standard.start - standard.finish)) : o.tolFloor);

  function beginDescent(from, v, t) {
    phase = 'down'; startTop = from; trough = v; troughT = t; repFrames = 1; repLow = 0; gap = 0; finishing = null;
  }

  // The rep is over: `lockout` is how high it came back. `turnedDown` means
  // it never reached the lockout and the next rep's descent has begun.
  function complete(lockout, t, v, turnedDown) {
    const unclear = repFrames > 0 && (repLow / repFrames > o.unclearShare || gap > o.maxGap);
    const base = { n: reps.length + 1, bottom: lockout, top: trough, topT: troughT };
    let event;
    if (!standard) {
      if (unclear) {
        const rep = { ...base, result: 'unclear', shortStart: false, shortFinish: false, isStandard: false };
        reps.push(rep); event = { type: 'rep', rep };
      } else {
        standard = { start: startTop, finish: trough };
        const rep = { ...base, result: 'counted', shortStart: false, shortFinish: false, isStandard: true };
        reps.push(rep); event = { type: 'standard', standard: { ...standard, tol: tol() }, rep };
      }
    } else {
      const shortStart = lockout < standard.start - tol();
      const shortFinish = trough > standard.finish + tol();
      const result = unclear ? 'unclear' : shortStart || shortFinish ? 'short' : 'counted';
      const rep = { ...base, result, shortStart: unclear ? false : shortStart, shortFinish: unclear ? false : shortFinish, isStandard: false };
      reps.push(rep); event = { type: 'rep', rep };
    }
    if (turnedDown) beginDescent(lockout, v, t);
    else { phase = 'top'; peak = v; finishing = event.rep; }
    return event;
  }

  function push(t, value, confident = true) {
    const good = confident && Number.isFinite(value);
    if (!started) { lastConfT = t; started = true; }
    const inRep = phase !== 'top';
    if (inRep) { repFrames++; if (!good) repLow++; }
    if (!good) { if (inRep) gap = Math.max(gap, t - (lastConfT ?? t)); return null; }
    if (inRep) gap = Math.max(gap, t - lastConfT);
    lastConfT = t;

    if (peak === null) { peak = value; return null; }

    if (phase === 'top') {
      if (value > peak) { peak = value; if (finishing && peak > finishing.bottom) finishing.bottom = peak; }
      else if (value < peak - H()) beginDescent(peak, value, t);
      return null;
    }

    if (phase === 'down') {
      if (value < trough) { trough = value; troughT = t; return null; }
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
