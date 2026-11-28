// Isometrics against something that doesn't move: what the camera can honestly read.
//
// Force can't be seen: nothing moves. What the pose shows is the push's time, the joint angle (isometric
// strength depends on it), whether the position stayed fixed, and shake: tremor grows with force and drops
// as effort fades. Shake is only ever compared with the same person's own earlier pushes (same exercise,
// similar angle), never with anyone else, and is always labelled an estimate.
//
// Frames are { t (seconds), pose: [{ x, y, visibility }] } with x and y in pixels (MediaPipe's normalised
// points times the video's width and height, so angles aren't squashed). Every window is in seconds,
// never frames, so a 30 and a 60 fps phone read the same.

import { jointAngle } from '../../standard/services/repEngine.js';

// MediaPipe Pose indices, the person's own sides.
const J = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

/** The three body setups: the angle measured, the points whose shake is read, and the limb that scales it. */
export const SETUPS = {
  arms: { label: 'Elbow', angle: ['shoulder', 'elbow', 'wrist'], shake: ['wrist', 'elbow'], show: 'Show your shoulder, elbow and hand from the side' },
  legs: { label: 'Knee', angle: ['hip', 'knee', 'ankle'], shake: ['knee', 'hip'], show: 'Show your hip, knee and ankle from the side' },
  hinge: { label: 'Hip', angle: ['shoulder', 'hip', 'knee'], shake: ['hip', 'shoulder'], show: 'Show your shoulder, hip and knee from the side' },
};

export const LIMITS = {
  minVisibility: 0.5,
  minFps: 24,           // below this the shake (about 4–12 Hz) can't be read
  maWindowSec: 0.25,    // moving average removed from each point: keeps shake above about 4 Hz, drops slow drift
  envWindowSec: 1,      // shake envelope: root-mean-square over this long
  rampSec: 0.5,         // the push's first half second (force rising) is left out of its shake
  movedDeg: 8,          // the angle changed more than this: it moved, so it wasn't an isometric
  lostShare: 0.2,       // more than this share of the push without the body in view
  baselineMinSec: 1.5,
  noisyBaseline: 0.01,  // relaxed shake above 1% of the limb's length: not holding still (a starting value, tuned on clips)
  matchDeg: 10,         // earlier pushes count as "the same" within this many degrees
  minHistory: 3,
};

const norm = (s) => typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';

/**
 * The setup for an isometric exercise ('arms' | 'legs' | 'hinge'), or null when the name isn't an
 * isometric. Only clear isometric names count, so a normal set never opens the isometric camera.
 */
export function isoModeFor(exercise = {}) {
  const name = norm(typeof exercise === 'string' ? exercise : exercise.name);
  if (!name) return null;
  const iso = /\b(?:isometric|isometrics|iso|overcoming)\b/.test(name) || /\bpin (?:press|squat|pull|deadlift)s?\b/.test(name)
    || /\btowel (?:curl|row|pull|deadlift)s?\b/.test(name) || /\bmid[ -]?thigh pulls?\b/.test(name);
  if (!iso) return null;
  if (/\b(?:squat|squats|leg|legs|knee|lunge|split|wall sit|calf|quad|quads)\b/.test(name)) return 'legs';
  if (/\b(?:deadlift|deadlifts|rdl|mid[ -]?thigh|hinge|hip|thrust|glute|bridge|back extension|good morning)\b/.test(name)) return 'hinge';
  return 'arms';
}

const finite = Number.isFinite;
const visible = (p) => !!p && finite(p.x) && finite(p.y) && (p.visibility ?? 1) >= LIMITS.minVisibility;
function median(values) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function percentile(values, q) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
const r = (v, d = 2) => finite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

/** The side ('left' | 'right') whose points are most visible over these frames. */
export function pickSide(frames, mode) {
  const s = SETUPS[mode];
  const names = [...new Set([...s.angle, ...s.shake])];
  const score = (side) => frames.reduce((sum, f) => sum + names.reduce((a, n) => a + (f.pose?.[J[side][n]]?.visibility ?? 0), 0), 0);
  return score('right') > score('left') ? 'right' : 'left';
}

/**
 * Per frame: the joint angle, the limb's length and the shake points, in pixels. Frames without every
 * point in view are kept as gaps (ok: false) so the push's lost share can be counted.
 */
export function readFrames(frames, mode, side) {
  const s = SETUPS[mode], j = J[side];
  return frames.map((f) => {
    const p = (n) => f.pose?.[j[n]];
    const [a, b, c] = s.angle.map(p);
    const pts = s.shake.map(p);
    if (![a, b, c, ...pts].every(visible)) return { t: f.t, ok: false };
    const limb = Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(c.x - b.x, c.y - b.y);
    if (!(limb > 0)) return { t: f.t, ok: false };
    return { t: f.t, ok: true, angle: jointAngle(a, b, c), limb, pts: pts.map((q) => ({ x: q.x, y: q.y })) };
  });
}

/**
 * The shake envelope: each point minus its moving average over maWindowSec (centred), then the
 * root-mean-square of what's left over envWindowSec around each frame. In limb lengths: divided by the
 * limb's median length over these frames, not each frame's own (that jitters too, and would add noise
 * in proportion to how far the point is from the corner of the picture).
 * Returns [{ t, e }] for frames with enough neighbours.
 */
export function shakeEnvelope(read) {
  const ok = read.filter((f) => f.ok);
  const scale = median(ok.map((f) => f.limb));
  if (!(scale > 0)) return [];
  const half = LIMITS.maWindowSec / 2, envHalf = LIMITS.envWindowSec / 2;
  const resid = [];
  for (let i = 0, lo = 0, hi = 0; i < ok.length; i++) {
    const t = ok[i].t;
    while (ok[lo].t < t - half) lo++;
    while (hi + 1 < ok.length && ok[hi + 1].t <= t + half) hi++;
    const n = hi - lo + 1;
    if (n < 3) continue;
    let sq = 0;
    ok[i].pts.forEach((q, k) => {
      let mx = 0, my = 0;
      for (let m = lo; m <= hi; m++) { mx += ok[m].pts[k].x; my += ok[m].pts[k].y; }
      mx /= n; my /= n;
      sq += (q.x - mx) ** 2 + (q.y - my) ** 2;
    });
    resid.push({ t, sq: sq / ok[i].pts.length });
  }
  const out = [];
  for (let i = 0, lo = 0, hi = 0; i < resid.length; i++) {
    const t = resid[i].t;
    while (resid[lo].t < t - envHalf) lo++;
    while (hi + 1 < resid.length && resid[hi + 1].t <= t + envHalf) hi++;
    const n = hi - lo + 1;
    if (n < 3) continue;
    let s = 0;
    for (let m = lo; m <= hi; m++) s += resid[m].sq;
    out.push({ t, e: Math.sqrt(s / n) / scale });
  }
  return out;
}

function fpsOf(read) {
  const ok = read.filter((f) => f.ok);
  if (ok.length < 2) return null;
  const span = ok.at(-1).t - ok[0].t;
  return span > 0 ? (ok.length - 1) / span : null;
}

/** The relaxed hold before a push: its shake and whether it was still enough to compare against. */
export function analyseBaseline(frames, mode, side) {
  const read = readFrames(frames, mode, side);
  const ok = read.filter((f) => f.ok);
  const span = ok.length > 1 ? ok.at(-1).t - ok[0].t : 0;
  const env = shakeEnvelope(read);
  const e = median(env.map((x) => x.e));
  const angles = ok.map((f) => f.angle);
  const drift = angles.length ? percentile(angles, 0.95) - percentile(angles, 0.05) : null;
  const fps = fpsOf(read);
  const flags = [];
  if (span < LIMITS.baselineMinSec || !finite(e)) flags.push('shortBaseline');
  else if (e > LIMITS.noisyBaseline || drift > LIMITS.movedDeg) flags.push('noisyBaseline');
  return { e, angleDeg: median(angles), driftDeg: drift, fps, flags, ok: !flags.length };
}

/**
 * One push. baseline: analyseBaseline's result for the relaxed hold just before. phoneMoved: from the
 * phone's motion sensor (camera shake would read as tremor). Returns what's shown and saved; shakeRatio
 * is null whenever any flag says it can't be trusted.
 */
export function analysePush(frames, { mode, side, baseline, targetSec = null, phoneMoved = false } = {}) {
  const read = readFrames(frames, mode, side);
  const ok = read.filter((f) => f.ok);
  const t0 = frames.length ? frames[0].t : 0, t1 = frames.length ? frames.at(-1).t : 0;
  const durationSec = Math.max(0, t1 - t0);
  const fps = fpsOf(read);
  const angles = ok.map((f) => f.angle);
  const drift = angles.length >= 2 ? percentile(angles, 0.95) - percentile(angles, 0.05) : null;
  const lost = frames.length ? 1 - ok.length / frames.length : 1;
  const flags = [];
  if (!finite(fps) || fps < LIMITS.minFps) flags.push('lowFps');
  if (lost > LIMITS.lostShare) flags.push('poseLost');
  if (phoneMoved) flags.push('phoneMoved');
  if (finite(drift) && drift > LIMITS.movedDeg) flags.push('moved');
  if (!baseline || !baseline.ok) flags.push(baseline?.flags?.[0] || 'noBaseline');

  const env = shakeEnvelope(read).filter((x) => x.t >= t0 + LIMITS.rampSec);
  const pushE = median(env.map((x) => x.e));
  const trusted = !flags.length && finite(pushE) && finite(baseline?.e) && baseline.e > 0;
  let fadePct = null;
  if (trusted && env.length >= 6 && durationSec >= 3) {
    const third = (t1 - (t0 + LIMITS.rampSec)) / 3;
    const first = median(env.filter((x) => x.t < t0 + LIMITS.rampSec + third).map((x) => x.e));
    const last = median(env.filter((x) => x.t >= t1 - third).map((x) => x.e));
    if (finite(first) && first > 0 && finite(last)) fadePct = 100 * (1 - last / first);
  }
  return {
    durationSec: r(durationSec, 1), targetSec: finite(targetSec) ? targetSec : null,
    angleDeg: r(median(angles), 0), angleDriftDeg: r(drift, 1),
    shakeRatio: trusted ? r(pushE / baseline.e) : null, fadePct: r(fadePct, 0),
    fps: r(fps, 0), lostPct: r(lost * 100, 0), flags,
  };
}

/** Live readout while pushing: the shake over the last envWindowSec, as a multiple of the baseline. */
export function liveShake(frames, { mode, side, baseline }) {
  if (!baseline?.ok || !frames.length) return null;
  const tEnd = frames.at(-1).t;
  const recent = frames.filter((f) => f.t >= tEnd - LIMITS.envWindowSec - LIMITS.maWindowSec);
  const env = shakeEnvelope(readFrames(recent, mode, side));
  const last = env.at(-1);
  return last && baseline.e > 0 ? last.e / baseline.e : null;
}

/** The current joint angle (degrees) from the latest frame, or null. */
export function liveAngle(frame, { mode, side }) {
  const f = readFrames([frame], mode, side)[0];
  return f.ok ? f.angle : null;
}

/**
 * This push against the person's own earlier pushes: same exercise, within matchDeg of the angle, at
 * least minHistory trusted pushes. { ratio, n } or null. history: saved isometric records.
 */
export function compareToUsual(push, history = [], { exercise, excludeId } = {}) {
  if (!push || !finite(push.shakeRatio) || !finite(push.angleDeg)) return null;
  const key = norm(exercise);
  const earlier = [];
  for (const rec of history) {
    if (!rec || rec.id === excludeId || norm(rec.exercise) !== key || !Array.isArray(rec.pushes)) continue;
    for (const p of rec.pushes) if (finite(p?.shakeRatio) && finite(p.angleDeg) && Math.abs(p.angleDeg - push.angleDeg) <= LIMITS.matchDeg) earlier.push(p.shakeRatio);
  }
  if (earlier.length < LIMITS.minHistory) return null;
  const usual = median(earlier);
  return usual > 0 ? { ratio: r(push.shakeRatio / usual), n: earlier.length } : null;
}

/** Plain words for a push's flags, for the result card. */
export const FLAG_TEXT = {
  lowFps: 'The camera ran too slowly to read shake',
  poseLost: 'The camera lost you for part of the push',
  phoneMoved: 'The phone moved, so shake couldn’t be read. Prop it up',
  moved: 'Your position changed, so this wasn’t a fixed push',
  noisyBaseline: 'You weren’t still before the push, so there was nothing to compare against',
  shortBaseline: 'The relaxed hold before the push was too short',
  noBaseline: 'No relaxed hold before the push',
};
