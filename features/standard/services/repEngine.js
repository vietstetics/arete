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
  tolFloor: 6,         // tolerance never smaller than this (camera noise)
  tolPct: 0.08,        // tolerance as a share of the locked range
  unclearShare: 0.3,   // > this share of low-confidence frames → unclear
  maxGap: 0.5,         // seconds without a confident frame → unclear
};

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
    const bottom = peak, top = trough;
    const unclear = repFrames > 0 && (repLow / repFrames > o.unclearShare || gap > o.maxGap);
    dir = 'extend'; peak = angle; peakT = t;
    if (bottom - top < o.minRange) return null; // a twitch, not a rep

    if (!standard) {
      if (unclear) {
        const rep = { n: reps.length + 1, bottom, top, topT: troughT, result: 'unclear', shortStart: false, shortFinish: false, isStandard: false };
        reps.push(rep);
        return { type: 'rep', rep };
      }
      standard = { start: bottom, finish: top };
      const rep = { n: reps.length + 1, bottom, top, topT: troughT, result: 'counted', shortStart: false, shortFinish: false, isStandard: true };
      reps.push(rep);
      return { type: 'standard', standard: { ...standard, tol: tol() }, rep };
    }
    const rep = { n: reps.length + 1, bottom, top, topT: troughT, ...judge(bottom, top, unclear), isStandard: false };
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
