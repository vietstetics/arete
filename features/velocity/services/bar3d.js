// From the plate's 3D track to transducer-style numbers per rep.
//
// The bar's height is up · (centre − start), in metres, with "up" from the
// phone's sensors (or the camera taken as level). Smoothed with the same
// Savitzky–Golay filter as everything else (±83 ms: a 7–9 Hz bandwidth, the
// 6–10 Hz used for barbell kinematics in the research). Each lift is found
// from the bar's own movement (a rise of at least minRom from a bottom to a
// top); it starts and ends where the speed passes 5% of the rep's peak with
// the bar at its bottom or top (see LIFT_THRESHOLD for why, rather than the
// 0.02 m/s motion-capture rule; liftEdges for sticking points).
//
//   MCV (mean concentric velocity) = this rep's distance risen / its time
//   PV  (peak velocity)            = highest vertical speed in the lift
//   MPV (mean propulsive velocity) = mean speed until the bar decelerates
//       faster than gravity (Sanchez-Medina; propulsive end nearest the peak, as Chronojump)

import { savitzkyGolay, at, SG } from './smooth.js';
import { heightsFromTrack } from './vision/plate3d.js';

export const G = 9.81;
/**
 * The plate may be LOST (frames looked at, plate not found) for at most this
 * long inside a lift (s): a couple of frames are bridged by the smoothing;
 * anything longer and the rep gets no numbers ("unclear") — a part-seen lift
 * is never scored as if it were whole.
 */
export const MAX_GAP = 0.1;
/**
 * …while frames the phone didn't get round to (a busy phone skips some — no
 * sample at all, not a lost plate) may leave up to this long between samples:
 * the motion between is smooth, and the smoothing spans it.
 */
export const MAX_SAMPLE_GAP = 0.25;
/**
 * …but right where the lift starts or ends (where it's timed), at most this
 * long between frames — and over EDGE_GAP_ESTIMATE the rep is an estimate.
 * Measured on physically shaped lifts with frames missing at a lift's edge:
 * at 30 fps one skipped frame (67 ms between frames) reads −1.5% on average
 * (worst −8%), two (100 ms) −5% (worst −20%); at 60 fps two skipped (50 ms)
 * are harmless (±0.3%); a 100–200 ms hole reads 5–11% low.
 */
export const MAX_EDGE_GAP = 0.07;
export const EDGE_GAP_ESTIMATE = 0.05;
/**
 * Those limits are for a hole in an otherwise steady stream of frames. A phone
 * too busy to look at every frame leaves gaps like that all through the set
 * (its reps are estimates anyway, MIN_LIFT_RATE): there the edge may be up to
 * this many of its typical frame spacings apart.
 */
const EDGE_GAP_FRAMES = 2.2;
/** Frame times are sums of frame periods: a gap of exactly 0.1 s can come out a hair over. */
const EPS = 1e-6;
/** How long (s) a bar takes to come to rest after its last push — or to get going before its first (liftEdges). */
const SLOWING = 0.3;

/** Inside [t0, t1]: the longest run where the plate was lost (NaN samples, measured from the last
 *  sample that saw it to the next), and the longest time between any two samples. */
function gaps(samples, t0, t1) {
  let lost = 0, sampleGap = 0, lastSeen = null, lastAny = null, sawLoss = false;
  for (const s of samples) {
    if (s.t < t0) { if (Number.isFinite(s.y)) lastSeen = s.t; lastAny = s.t; continue; }
    if (s.t > t1) break;
    sampleGap = Math.max(sampleGap, s.t - (lastAny ?? t0)); // from t0 when nothing came before: a trace that starts late
    lastAny = s.t;
    if (Number.isFinite(s.y)) { if (sawLoss && lastSeen !== null) lost = Math.max(lost, s.t - lastSeen); lastSeen = s.t; sawLoss = false; }
    else { sawLoss = true; if (lastSeen === null) lastSeen = t0; }
  }
  if (sawLoss) lost = Math.max(lost, t1 - (lastSeen ?? t0));
  if (lastAny === null || lastAny < t1) sampleGap = Math.max(sampleGap, t1 - (lastAny ?? t0));
  return { lost, sampleGap };
}

/**
 * The smoothing window (± seconds): the usual ±83 ms (a 7–9 Hz bandwidth),
 * widened if frames are sparse so each window still holds enough samples for
 * the cubic (a phone that can only process ~15 frames a second still gets
 * speeds, smoothed a little more).
 */
/**
 * A bar can't jump for one frame and come back: a sample further than
 * max(1.5 cm, 5× the neighbours' scatter) from a quadratic through the 4
 * samples either side of it (a bad outline, say) is dropped as lost — one
 * missing frame is bridged, one wrong one would warp the lift's timing.
 */
export function despike(samples, { half = 4, k = 5, floor = 0.015 } = {}) {
  const ok = samples.map((s, i) => (Number.isFinite(s.y) ? i : -1)).filter((i) => i >= 0);
  const out = samples.slice();
  for (let j = 0; j < ok.length; j++) {
    const nb = ok.slice(Math.max(0, j - half), Math.min(ok.length, j + half + 1)).filter((i) => i !== ok[j]);
    if (nb.length < 6) continue;
    const t0 = samples[ok[j]].t;
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
    for (const i of nb) { const u = samples[i].t - t0, u2 = u * u, y = samples[i].y; S0++; S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2; Y0 += y; Y1 += y * u; Y2 += y * u2; }
    const M = [[S0, S1, S2, Y0], [S1, S2, S3, Y1], [S2, S3, S4, Y2]];
    let solved = true;
    for (let c = 0; c < 3 && solved; c++) {
      let p = c; for (let q = c + 1; q < 3; q++) if (Math.abs(M[q][c]) > Math.abs(M[p][c])) p = q;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-15) { solved = false; break; }
      for (let q = 0; q < 3; q++) { if (q === c) continue; const f = M[q][c] / M[c][c]; for (let w = c; w < 4; w++) M[q][w] -= f * M[c][w]; }
    }
    if (!solved) continue;
    const co = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    const fitAt = (u) => co[0] + co[1] * u + co[2] * u * u;
    const scatter = Math.sqrt(nb.reduce((acc, i) => acc + (samples[i].y - fitAt(samples[i].t - t0)) ** 2, 0) / nb.length);
    if (Math.abs(samples[ok[j]].y - co[0]) > Math.max(floor, k * scatter)) out[ok[j]] = { ...samples[ok[j]], y: NaN, spike: true };
  }
  return out;
}

/** The typical time between measured samples (s), or 1/30 with too few. */
function medianSpacing(samples) {
  const d = [];
  let last = null;
  for (const s of samples) { if (!Number.isFinite(s.y)) continue; if (last !== null && s.t > last) d.push(s.t - last); last = s.t; }
  if (!d.length) return 1 / 30;
  d.sort((x, y) => x - y);
  return d[d.length >> 1];
}

export function smoothingHalf(samples) {
  const d = [];
  let last = null;
  for (const s of samples) { if (!Number.isFinite(s.y)) continue; if (last !== null && s.t > last) d.push(s.t - last); last = s.t; }
  if (!d.length) return 0.083;
  d.sort((x, y) => x - y);
  return Math.max(0.083, 2.4 * d[d.length >> 1]);
}

/** Bottoms → tops in a smoothed height trace: [{ tBottom, tTop, yBottom, yTop, rise }] for rises ≥ minRom (m). */
export function findLifts(fit, { minRom = 0.12 } = {}) {
  const pts = fit.filter((f) => Number.isFinite(f.y));
  const out = [];
  let lo = null, hi = null;
  const push = () => out.push({ tBottom: lo.t, tTop: hi.t, yBottom: lo.y, yTop: hi.y, rise: hi.y - lo.y });
  for (const f of pts) {
    if (!lo || f.y < lo.y) { lo = f; hi = null; continue; }
    if (!hi || f.y > hi.y) hi = f;
    // A top is confirmed once the bar has come back down by a third of the rise (or the trace ends).
    if (hi && hi.y - lo.y >= minRom && hi.y - f.y >= Math.max(0.03, (hi.y - lo.y) / 3)) { push(); lo = f; hi = null; }
  }
  // The last lift isn't confirmed by a descent (the bar is racked a little lower, or the trace ends): its top is
  // the highest point of everything after it, which can be seconds later — match reps to lifts by their timed
  // start and end (liftEdges), not by this.
  if (lo && hi && hi.y - lo.y >= minRom) push();
  return out;
}

/**
 * The height's frame-to-frame noise (m) around [t0, t1]: the spread of the
 * samples about the smoothed curve, corrected for the share of each sample's
 * own noise the local cubic follows (its centre weight: about half at
 * 30 fps, a fifth at 60).
 */
export function heightNoise(samples, fit, t0, t1) {
  const r = [], dts = [];
  let last = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < t0 || s.t > t1 || !Number.isFinite(s.y) || !Number.isFinite(fit[i].y)) continue;
    r.push(Math.abs(s.y - fit[i].y));
    if (last !== null) dts.push(s.t - last);
    last = s.t;
  }
  if (r.length < 8 || !dts.length) return NaN;
  r.sort((a, b) => a - b); dts.sort((a, b) => a - b);
  const m = Math.max(2, Math.round(smoothingHalf(samples) / dts[dts.length >> 1]));
  const c0 = (3 * (3 * m * m + 3 * m - 1)) / ((2 * m + 3) * (2 * m + 1) * (2 * m - 1));
  return (1.4826 * r[r.length >> 1]) / Math.sqrt(1 - c0);
}

/**
 * Where one lift starts and ends, in the smoothed trace. Walking out from its
 * fastest moment, the lift goes on while the speed is at least `threshold` of
 * the peak — and also while the bar is clearly between the lift's bottom and
 * top (further than tol from either) with a real push still to come: a
 * grinder that all but stalls at its sticking point is one lift from the
 * bottom to the top, as a transducer counts it, not a short lift after the
 * stall. Back at its bottom or top
 * level, the first frame under the threshold ends it (interpolated between
 * frames), so noise at rest can't stretch it. Frames may be missing between
 * samples for up to maxSampleGap inside the lift, but where it starts and
 * ends at most maxEdgeGap (that's where it's timed); otherwise that end
 * wasn't seen. Returns { tStart, tEnd, pv0, startSeen, endSeen } or null.
 */
function liftEdges(fit, L, { threshold, tol, maxSampleGap, maxEdgeGap }) {
  const t0 = L.tBottom - 0.15, t1 = L.tTop + 0.15, idx = [];
  for (let i = 0; i < fit.length; i++) if (fit[i].t >= t0 && fit[i].t <= t1 && Number.isFinite(fit[i].v)) idx.push(i);
  if (idx.length < 5) return null;
  let jp = -1;
  for (let j = 0; j < idx.length; j++) {
    const f = fit[idx[j]];
    if (f.full && f.t >= L.tBottom && f.t <= L.tTop && (jp < 0 || f.v > fit[idx[jp]].v)) jp = j;
  }
  if (jp < 0 || !(fit[idx[jp]].v > 0)) return null;
  const pv0 = fit[idx[jp]].v, thr = threshold * pv0;
  // A slow stretch is a sticking point, crossed, only while the bar is still clearly short of the lift's end
  // level — by `clear`: several times the noise, at least 2.5 cm and 6% of the rise — which the trace then goes
  // on to reach. Displacement, not later speed, decides: a settle of a centimetre or two after lockout, or one
  // bad frame, can't stretch the lift across a rest; a grinder that nearly stops near the top and finishes
  // slowly is still one lift. Just after a push the bar is still slowing (a few tenths of a second): there one
  // noisy frame under the threshold, with the speed back above it a frame or two on, doesn't end the lift.
  const clear = Math.max(3 * tol, 0.025, 0.06 * L.rise);
  const vAt = (j) => (j >= 0 && j < idx.length ? fit[idx[j]].v : -Infinity);
  const walk = (dir, remaining) => {
    let j = jp, lastPush = fit[idx[jp]].t;
    for (;;) {
      const n = j + dir;
      if (n < 0 || n >= idx.length) return { t: fit[idx[j]].t, seen: false };
      const a = fit[idx[j]], b = fit[idx[n]], gap = Math.abs(b.t - a.t), left = remaining(b.y);
      const sticking = left > clear;
      const blip = left > tol && Math.abs(b.t - lastPush) <= SLOWING && (vAt(n + dir) >= thr || vAt(n + 2 * dir) >= thr);
      if (b.v >= thr || sticking || blip) {
        if (gap > maxSampleGap + EPS) return { t: a.t, seen: false };
        if (b.v >= 0.2 * pv0) lastPush = b.t;
        j = n; continue;
      }
      // b: under the threshold, at (or within a centimetre or two of) the end level. The crossing between b and a.
      // Seen if the frames there are close together and the trace goes on past b (not a recording that starts or
      // stops right at the lift).
      const t = a.v > thr ? b.t + ((thr - b.v) / (a.v - b.v)) * (a.t - b.t) : a.t;
      const beyond = fit.some((f, i) => (dir < 0 ? i < idx[n] : i > idx[n]) && Number.isFinite(f.y) && Math.abs(f.t - b.t) <= maxEdgeGap + EPS);
      return { t, seen: gap <= maxEdgeGap + EPS && beyond, left };
    }
  };
  const s = walk(-1, (y) => y - L.yBottom), e = walk(1, (y) => L.yTop - y);
  if (!(e.t > s.t)) return null;
  // Did the bar still move on more than half a centimetre (or the noise) past where the lift was timed to start or end (a settle
  // after lockout, a slow last bit after a stall near the top, a creep off the floor)? Then where the lift
  // starts or ends is a matter of definition: the numbers are estimates.
  const loose = Math.max(tol, 0.005), unsure = (s.left ?? 0) > loose ? 'start' : (e.left ?? 0) > loose ? 'end' : '';
  return { tStart: s.t, tEnd: e.t, pv0, startSeen: s.seen, endSeen: e.seen, unsure };
}

/**
 * Lift start/end, found where the speed rises through and falls back through
 * this share of the rep's peak, walking out from the peak and interpolated
 * between frames (liftEdges). A low absolute threshold (0.02 m/s, as
 * motion-capture references use) drowns in camera-rate noise — pauses get
 * counted, MCV ~20% low at 1.5 mm of noise.
 */
export const LIFT_THRESHOLD = 0.05;
/**
 * …but a transducer times the lift from the moment the bar leaves the bottom
 * to the moment it stops at the top (Chronojump extrapolates the departure;
 * GymAware: "from the concentric start until the bar reaches its maximum
 * height"), so the slow ends under 5% of the peak count too. They're short
 * and set by physics — force can't jump, so the bar's acceleration builds
 * from nothing after a pause (30–80 ms of force development) or carries on
 * from the bounce touch-and-go, and runs down at the top — and they're added
 * back: each end is extended by k × (speed / acceleration) at the 5%
 * crossing (the time a constant acceleration would take to reach that speed;
 * 2× that for one that grows from nothing). The smoothing (±83 ms) has
 * already spread a short lift's crossings outwards, so k grows with the
 * lift's length: k = 0.8 × its seconds, within 0.2–1.2 — and shrinks with
 * the square of the window when sparse frames widen it (at 20–24 fps: bias
 * −1.9% without that, −0.6% with it). Measured on
 * physically shaped lifts — touch-and-go, paused, from the floor; 30 and
 * 60 fps; 0.3–1.5 mm of noise (scene3d.concentricProfile) — MCV bias by rep
 * length (fast < 0.55 s / middling / slow > 1.05 s): without the ends +1.6 /
 * +3.2 / +3.6%; a fixed k of 0.6, −1.9 / +0.4 / +1.6%; this rule −0.4 /
 * +0.4 / 0.0% (mean error 1.5%). On onsets it wasn't tuned on: an instant
 * start −1.4%, a 40–80 ms force build-up +0.8%, an implausibly slow sin² one
 * +10% (the 5% rule alone: +15%).
 */
export const tailK = (seconds, half = SG.half) => Math.max(0.2, Math.min(1.2, 0.8 * seconds)) * (SG.half / Math.max(SG.half, half)) ** 2;
/** The longest end extension (s): a crossing with almost no acceleration measured adds no more than this. */
const MAX_TAIL = 0.08;
/**
 * A bar can't teleport. In squat, bench and deadlift it peaks well under
 * 2.5 m/s; a measured peak over this, or a single frame-to-frame step the
 * bar couldn't make at this speed (plus 2 cm of slack for noise), means the
 * tracking jumped (onto another plate, say) — the rep gets no numbers.
 */
export const MAX_PLAUSIBLE_SPEED = 3.5;

/** The biggest frame-to-frame height step in [t0, t1] beyond what MAX_PLAUSIBLE_SPEED allows (m; ≤ 0 = none). */
function worstStep(samples, t0, t1) {
  let worst = -Infinity, last = null;
  for (const s of samples) {
    if (s.t < t0 || s.t > t1 || !Number.isFinite(s.y)) continue;
    if (last) worst = Math.max(worst, Math.abs(s.y - last.y) - (MAX_PLAUSIBLE_SPEED * (s.t - last.t) + 0.02));
    last = s;
  }
  return worst;
}


/**
 * Peak velocity with less noise bias than "the largest smoothed sample": a
 * parabola through the smoothed speed within ±80 ms of the fastest frame
 * (wide enough to average over several frames at 30 fps).
 */
export function peakVelocity(fit, t0, t1, { half = 0.08 } = {}) {
  const pts = fit.filter((f) => f.t >= t0 && f.t <= t1 && Number.isFinite(f.v));
  if (!pts.length) return { pv: NaN, tPeak: NaN };
  const top = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const near = pts.filter((f) => Math.abs(f.t - top.t) <= half + 1e-9);
  if (near.length < 3) return { pv: top.v, tPeak: top.t };
  // Least-squares v = a + b u + c u², u = t − t_top.
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  for (const f of near) { const u = f.t - top.t, u2 = u * u; S0++; S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2; Y0 += f.v; Y1 += f.v * u; Y2 += f.v * u2; }
  const M = [[S0, S1, S2, Y0], [S1, S2, S3, Y1], [S2, S3, S4, Y2]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-18) return { pv: top.v, tPeak: top.t };
    for (let r = 0; r < 3; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let q = c; q < 4; q++) M[r][q] -= f * M[c][q]; }
  }
  const a = M[0][3] / M[0][0], b = M[1][3] / M[1][1], c = M[2][3] / M[2][2];
  if (!(c < 0)) return { pv: top.v, tPeak: top.t };
  const uPk = -b / (2 * c);
  if (Math.abs(uPk) > half) return { pv: top.v, tPeak: top.t };
  return { pv: a - (b * b) / (4 * c), tPeak: top.t + uPk };
}

/**
 * A rep's numbers are marked as estimates (still given) when the camera saw
 * too little of it to be transducer-grade: fewer than this many frames in
 * the lift, or fewer than MIN_LIFT_RATE a second through it (a phone too
 * busy to look at every frame: fast reps then read 3–7% slow — the cubic
 * can't follow a lift it samples this sparsely)…
 */
export const MIN_LIFT_FRAMES = 10;
export const MIN_LIFT_RATE = 24;
/** …or when the height's noise makes the speed's 5%-of-peak crossing unreliable (threshold under this many × speed noise). */
export const MIN_THRESHOLD_SNR = 2;

/**
 * Transducer-style metrics for every lift in a height trace.
 *   samples: [{ t, y }] bar height (m, up), NaN for lost frames
 * Returns { fit, reps: [{ ok, tStart, tEnd, T, distance, mcv, pv, mpv, estimate, noise, frames, why? }] }:
 *   tStart, tEnd, T — the whole lift, from leaving the bottom to stopping at the top (tailK)
 *   mcv — this rep's own distance over its own time
 *   pv  — peak vertical speed (NaN if frames are missing round the peak)
 *   mpv — mean speed from the start until the bar decelerates faster than gravity
 *         (the moment nearest the peak at which acceleration passes −g; the whole lift if it never does)
 *   estimate — a reason the numbers are only estimates ('' if none): too few frames, too noisy
 * A rep that isn't ok has why: no numbers (never a guess).
 */
export function barMetrics(samplesIn, { minRom = 0.12, half, maxGap = MAX_GAP, maxEdgeGap = MAX_EDGE_GAP, threshold = LIFT_THRESHOLD, tail = tailK } = {}) {
  const samples = despike(samplesIn);
  const h = half || smoothingHalf(samples);
  const edgeLimit = Math.max(maxEdgeGap, EDGE_GAP_FRAMES * medianSpacing(samples));
  const fit = savitzkyGolay(samples, { half: h, minPts: 5, maxHalf: 0.25 });
  const lifts = findLifts(fit, { minRom });
  const reps = [];
  for (const L of lifts) {
    const no = (why) => reps.push({ tBottom: L.tBottom, tTop: L.tTop, ok: false, why });
    // At its bottom and top the bar counts as at rest within 5× the height noise (at least 4 mm, at most a
    // quarter of the lift): further from both, a slow stretch is a sticking point, not the lift's end.
    const noise = heightNoise(samples, fit, L.tBottom - 0.5, L.tTop + 0.5);
    const tol = Math.min(0.25 * L.rise, Math.max(0.004, 5 * (Number.isFinite(noise) ? noise : 0.002)));
    const ed = liftEdges(fit, L, { threshold, tol, maxSampleGap: MAX_SAMPLE_GAP, maxEdgeGap: edgeLimit });
    if (!ed) { no('No clear lift'); continue; }
    if (!ed.startSeen || !ed.endSeen) { no(`Plate not seen where the lift ${ed.startSeen ? 'ended' : 'started'}`); continue; }
    // The plate must be seen through the whole lift and a little either side: a lift that runs into a gap
    // (the plate leaving the picture at the top, say) ends where the data stops, not where the bar stopped.
    const g = gaps(samples, ed.tStart - 0.15, ed.tEnd + 0.15);
    if (g.lost > maxGap + EPS) { no(`Plate lost for ${g.lost.toFixed(2)} s during the lift`); continue; }
    if (g.sampleGap > MAX_SAMPLE_GAP + EPS) { no(`No frames for ${g.sampleGap.toFixed(2)} s during the lift`); continue; }
    // Where the lift starts and ends, frames must be close together: that's where it's timed, and a
    // skipped stretch there (a phone hiccup) stretches or shortens the lift by the gap.
    const atStart = gaps(samples, ed.tStart - 0.15, ed.tStart + 0.15).sampleGap, atEnd = gaps(samples, ed.tEnd - 0.15, ed.tEnd + 0.15).sampleGap;
    if (atStart > edgeLimit + EPS || atEnd > edgeLimit + EPS) { no(`Frames missing where the lift ${atStart > edgeLimit + EPS ? 'started' : 'ended'}`); continue; }
    const yStart = at(fit, ed.tStart), yEnd = at(fit, ed.tEnd);
    // The slow ends under the threshold (tailK): dS before the start, dE after the end, and the little
    // distance covered in them (between a straight ramp's v·Δ/2 and a growing one's v·Δ/3). tail: the rule,
    // or a fixed k (0 = none).
    const v5 = threshold * ed.pv0, aS = at(fit, ed.tStart, 'a'), aE = at(fit, ed.tEnd, 'a');
    const k = typeof tail === 'function' ? tail(ed.tEnd - ed.tStart, h) : tail;
    const dS = k > 0 && aS > 0 ? Math.min(MAX_TAIL, (k * v5) / aS) : 0, dE = k > 0 && aE < 0 ? Math.min(MAX_TAIL, (k * v5) / -aE) : 0;
    const T = ed.tEnd - ed.tStart + dS + dE, distance = yEnd - yStart + (v5 * (dS + dE)) / 2.5;
    // The lift must run from its bottom to its top (whatever was cut off isn't in the numbers).
    if (!(distance >= 0.85 * L.rise)) { no('Lift not followed from bottom to top'); continue; }
    if (worstStep(samples, ed.tStart - 0.15, ed.tEnd + 0.15) > 0) { no('The plate tracking jumped during the lift'); continue; }
    let { pv, tPeak } = peakVelocity(fit, ed.tStart, ed.tEnd);
    if (pv > MAX_PLAUSIBLE_SPEED || distance / T > MAX_PLAUSIBLE_SPEED) { no('Implausible bar speed — the plate tracking jumped'); continue; }
    // Peak and propulsive speed need frames round the peak: a phone hiccup there flattens it.
    const nearPeak = Number.isFinite(tPeak) ? gaps(samples, tPeak - 0.1, tPeak + 0.1).sampleGap : Infinity;
    const peakSeen = nearPeak <= MAX_EDGE_GAP + EPS;
    // Propulsive end: where acceleration crosses −g, the crossing nearest the peak (after it).
    const inRep = fit.filter((f) => f.t >= ed.tStart && f.t <= ed.tEnd && Number.isFinite(f.a));
    let tProp = NaN;
    for (let i = 1; i < inRep.length; i++) {
      const a0 = inRep[i - 1].a, a1 = inRep[i].a;
      if (inRep[i].t > tPeak && a0 >= -G && a1 < -G) { tProp = inRep[i - 1].t + ((-G - a0) / (a1 - a0)) * (inRep[i].t - inRep[i - 1].t); break; }
    }
    // Never braking harder than gravity: the propulsive phase is the whole lift, so MPV is MCV.
    let mpv = !Number.isFinite(tProp) ? distance / T : tProp > ed.tStart ? (at(fit, tProp) - yStart + (v5 * dS) / 2.5) / (tProp - ed.tStart + dS) : NaN;
    if (!Number.isFinite(tProp)) tProp = ed.tEnd + dE;
    if (!peakSeen) { pv = NaN; mpv = NaN; }
    // How well this rep was seen: frames in the lift, and the speed noise against the threshold.
    const frames = samples.filter((s) => s.t >= ed.tStart && s.t <= ed.tEnd && Number.isFinite(s.y)).length;
    const vNoise = Number.isFinite(noise) ? speedNoise(noise, samples, ed.tStart, ed.tEnd, h) : NaN;
    const estimate = ed.unsure ? `the bar moved on a little past where the lift ${ed.unsure === 'start' ? 'started' : 'ended'}`
      : Math.max(atStart, atEnd) > EDGE_GAP_ESTIMATE + EPS ? `a frame skipped where the lift ${atStart > atEnd ? 'started' : 'ended'}`
      : frames < MIN_LIFT_FRAMES ? `only ${frames} frames in the lift`
      : frames / Math.max(1e-3, ed.tEnd - ed.tStart) < MIN_LIFT_RATE ? `only ${Math.round(frames / (ed.tEnd - ed.tStart))} frames a second through the lift`
      : Number.isFinite(vNoise) && threshold * ed.pv0 < MIN_THRESHOLD_SNR * vNoise ? 'noisy tracking' : '';
    reps.push({ ok: true, tBottom: L.tBottom, tTop: L.tTop, tStart: ed.tStart - dS, tEnd: ed.tEnd + dE, T, distance, mcv: distance / T, pv, tPeak, mpv, tProp,
      estimate, noise, frames, ...(peakSeen ? {} : { peakWhy: 'Frames missing round the peak' }) });
  }
  return { fit, reps };
}

/**
 * Speed noise (m/s) of the smoothed trace for a height noise (m): the local
 * cubic's slope at the centre, from the samples' own spacing in [t0, t1]
 * (the usual ±83 ms holds ~5 frames at 30 fps: weights (1, −8, 0, 8, −1)/12Δt).
 */
function speedNoise(noise, samples, t0, t1, half) {
  const ts = samples.filter((s) => s.t >= t0 - half && s.t <= t1 + half && Number.isFinite(s.y)).map((s) => s.t);
  if (ts.length < 5) return NaN;
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b), dt = d[d.length >> 1];
  const m = Math.max(2, Math.round(Math.max(half, 2.4 * dt) / dt));
  // The cubic's slope at the centre of 2m+1 evenly spaced points: its k and k³ terms decouple from the even
  // ones, so the slope's weights are (S6·k − S4·k³) / (S2·S6 − S4²), with Sp = Σ kᵖ.
  const ks = Array.from({ length: 2 * m + 1 }, (_, i) => i - m);
  const S2 = ks.reduce((s, k) => s + k * k, 0), S4 = ks.reduce((s, k) => s + k ** 4, 0), S6 = ks.reduce((s, k) => s + k ** 6, 0);
  const det = S2 * S6 - S4 * S4;
  const w = ks.map((k) => (S6 * k - S4 * k ** 3) / det);
  return (noise * Math.sqrt(w.reduce((s, x) => s + x * x, 0))) / dt;
}

/** The same metrics straight from a 3D plate track. */
export function trackMetrics(frames, up, opts) {
  return barMetrics(heightsFromTrack(frames, up), opts);
}
