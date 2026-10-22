// One set of plate tracking on a phone, live. Pure logic over grey images
// and timestamps (no DOM), so the same code runs in the camera page and in
// tests against the simulator. The page supplies the pixels (frameGrabber.js)
// and the phone's gravity (motion.js).
//
//   const s = createPlateSession({ vw, vh });
//   s.setUp(up)                          — the camera's "up" from the motion sensors (or leave it: then it's
//                                          taken from the plate after the set, reconstruct3D)
//   s.detect(smallFrame, scale, { prior }) while the lifter holds still → finds the plate; then
//   s.roiPlan()                          — what to grab each frame: a crop round the plate's path, scaled so
//                                          the plate is ~100 px across (plenty for sub-pixel edges, and fast)
//   s.track(roiImage, t)                 — every frame: the plate's outline and its live height (m)
//   s.finish()                           — after the set: the full 3D reconstruction (mirror twin and focal
//                                          length settled over the whole set) and transducer-style rep numbers
//
// Live heights use the plate's facing as first seen; finish() redoes every
// frame with the facing and focal length chosen from the whole set, so the
// numbers saved are the careful ones.

import { detectPlates } from '../vision/plate.js';
import { createRimTracker, outermostRing, reconstruct3D, heightsFromTrack, PLATE_RADIUS_M } from '../vision/plate3d.js';
import { circlePoses, coneFromConic, ellipseToConic } from '../vision/circle3d.js';
import { dot, sub, unit } from '../vision/camera.js';
import { barMetrics } from '../bar3d.js';

/** Main phone cameras film 16:9 video at about 63° across the long side (research: Gyroflow profiles, n = 328). */
export const DEFAULT_HFOV_DEG = 63;

/** Pinhole intrinsics for the full video frame, from the field of view across its long side. */
export function videoIntrinsics(vw, vh, hfovDeg = DEFAULT_HFOV_DEG) {
  if (![vw, vh].every((x) => Number.isFinite(x) && x > 0) || !Number.isFinite(hfovDeg) || hfovDeg <= 0 || hfovDeg >= 180) {
    throw new RangeError('Video dimensions must be positive and field of view must be between 0 and 180 degrees');
  }
  const f = Math.max(vw, vh) / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return { fx: f, fy: f, cx: (vw - 1) / 2, cy: (vh - 1) / 2, w: vw, h: vh };
}

/**
 * Find the plate in a picture (grey image img, any scale; results in its own pixels).
 *   prior: { x, y } where the bar should be (from the pose), or null
 *   rMin, rMax: plate radius range (px) to look for
 * The plate sits on the bar's end: level with where the pose puts the bar (within about a plate radius up or
 * down — the shoulders or hands are on the bar) but up to a few radii to the side when filmed at an angle, so
 * candidates are ranked by that, not by distance alone. A plate has circles inside it — the steel hub, the
 * sleeve's end, a lettering ring — whose edges often score better than its rim (an ellipse when seen at an
 * angle), so from the best candidate the search climbs out to the outermost ring round it (outermostRing).
 * Returns the ellipse { cx, cy, a, b, phi } or null.
 */
export function findPlate(img, { prior = null, rMin, rMax }) {
  const cands = detectPlates(img, { rMin, rMax, prior, max: 8 });
  if (!cands.length) return null;
  const rRef = (rMin + rMax) / 2;
  const near = (c) => (prior ? Math.exp(-0.5 * (((c.cx - prior.x) / (4 * rRef)) ** 2 + ((c.cy - prior.y) / (1.2 * rRef)) ** 2)) : 1);
  let c = cands.reduce((x, y) => (y.score * near(y) > x.score * near(x) ? y : x));
  for (const o of cands) if (o.a > c.a * 1.3 && Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.35 * o.a) c = o;
  return outermostRing(img, c, rMax) || c;
}

/**
 * The share of the rim that typically agrees with each frame's outline (edge
 * points within ~1 px of it) below which a set's numbers are estimates: the
 * plate's edge was only partly clear (its side band or a ring blurred into
 * it, something crossed it). In 60 simulated sets, reps of sets at or above
 * it: MCV RMSE 0.014 m/s (95% within 0.028, worst 0.056); below: 0.038.
 */
export const MIN_RIM_FIT = 0.85;

/**
 * How well a set's plate was followed, from its track and 3D reconstruction.
 * ok = false means the outline didn't behave like one plate on a level bar —
 * the numbers shouldn't be trusted. Shared by the live page and the lab.
 *   track: [{ t, ok, e }]; rec: reconstruct3D()
 * Returns { lost (share of frames), tiltDeg, spreadDeg, focalScale, offAxisDeg, fps, rate, rimFit, ok, slow, clear }:
 * ok — one plate on a level bar; slow — too few frames a second; clear — the rim was clear (MIN_RIM_FIT).
 */
export function setQuality(track, rec) {
  const recovered = new Set(rec.frames.filter((f) => f.ok && f.c?.length === 3 && f.c.every(Number.isFinite)).map((f) => f.t));
  const lost = track.length ? track.filter((f) => !f.ok || !recovered.has(f.t)).length / track.length : 1;
  // Off to the side, the real plate keeps facing sideways and the same way; if it doesn't, the outline
  // followed wasn't one plate's (a merged blob, a lip) and the numbers can't be trusted. Seen nearly
  // head-on, its facing is too uncertain to judge (and doesn't matter: the centre is what's measured).
  const first = rec.frames.find((f) => f.ok && f.c?.length === 3 && f.c.every(Number.isFinite));
  const offAxisDeg = first && rec.normal ? (Math.acos(Math.min(1, Math.abs(dot(rec.normal, unit(first.c))))) * 180) / Math.PI : 0;
  // How many frames a second were actually looked at (a busy phone skips some): below 24, fast reps read
  // a few % slow (fewer samples, more smoothing), so the numbers are marked as estimates.
  const dts = track.slice(1).map((f, i) => f.t - track[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const fps = dts.length ? 1 / dts[dts.length >> 1] : NaN, span = track.length ? track[track.length - 1].t - track[0].t : 0, rate = span > 0 ? (track.length - 1) / span : NaN;
  // How much of the rim agreed with each frame's outline (share of edge points within ~1 px), typically.
  const fits = track.filter((f) => f.ok && Number.isFinite(f.fit)).map((f) => f.fit).sort((x, y) => x - y);
  const rimFit = fits.length ? fits[fits.length >> 1] : NaN;
  const quality = { lost, tiltDeg: rec.tiltDeg, spreadDeg: rec.spreadDeg, focalScale: rec.focalScale, offAxisDeg, fps, rate, upFrom: rec.upFrom, rimFit };
  // Without gravity (up taken from the plate) the tilt is against the picture's up — a pitched phone, not the
  // plate — so only the facing's steadiness can be judged.
  const sensors = String(rec.upFrom || '').startsWith('sensors');
  quality.ok = !!first && lost < 0.3 && (offAxisDeg < 20 || ((!sensors || rec.tiltDeg < 5) && rec.spreadDeg < 5));
  quality.slow = !Number.isFinite(rate) || rate < 24;
  quality.clear = rimFit >= MIN_RIM_FIT; // unknown (an old saved track) counts as not clear: estimates, never the other way
  return quality;
}

/**
 * A set's plate tracking.
 *   vw, vh: video frame size; hfovDeg: assumed field of view (long side)
 *   radiusM: plate radius (45 cm plate → 0.225)
 *   targetPlatePx: plate diameter to track at (the crop is scaled down to it, never up)
 *   travelM: how far the bar may move up or down from where it was found (m)
 */
export function createPlateSession({ vw, vh, hfovDeg = DEFAULT_HFOV_DEG, radiusM = PLATE_RADIUS_M, targetPlatePx = 100, travelM = 0.85 } = {}) {
  const K = videoIntrinsics(vw, vh, hfovDeg);
  if (![radiusM, targetPlatePx].every((x) => Number.isFinite(x) && x > 0) || !Number.isFinite(travelM) || travelM < 0) {
    throw new RangeError('Plate radius and target size must be positive; travel must be nonnegative');
  }
  let up = null, roi = null, Kroi = null, tracker = null, pending = null, state = 'searching';
  let nLive = null, c0 = null;
  const track = []; // full-frame ellipses per frame
  const snapshot = () => track.map((f) => ({ ...f, ...(f.e ? { e: { ...f.e } } : {}) }));
  const validEllipse = (e) => e && ['cx', 'cy', 'a', 'b', 'phi'].every((k) => Number.isFinite(e[k])) && e.a > 0 && e.b > 0 && e.b <= e.a && e.cx >= 0 && e.cx < vw && e.cy >= 0 && e.cy < vh;
  const upv = () => up || [0, -1, 0];
  // Crop ↔ full frame: full = x0 + (roi + 0.5) / s − 0.5.
  const toFull = (e) => ({ cx: roi.x0 + (e.cx + 0.5) / roi.s - 0.5, cy: roi.y0 + (e.cy + 0.5) / roi.s - 0.5, a: e.a / roi.s, b: e.b / roi.s, phi: e.phi });
  const toRoi = (e) => ({ cx: (e.cx - roi.x0 + 0.5) * roi.s - 0.5, cy: (e.cy - roi.y0 + 0.5) * roi.s - 0.5, a: e.a * roi.s, b: e.b * roi.s, phi: e.phi });

  function liveHeight(e) {
    const ps = circlePoses(coneFromConic(ellipseToConic(e), K), radiusM);
    if (!ps.length) return NaN;
    const u = upv();
    // First frame: the reading facing sideways; after that, the one that keeps facing the same way.
    const p = nLive ? ps.reduce((a, b) => (Math.abs(dot(b.n, nLive)) > Math.abs(dot(a.n, nLive)) ? b : a))
      : ps.reduce((a, b) => (Math.abs(dot(b.n, u)) < Math.abs(dot(a.n, u)) ? b : a));
    nLive = p.n;
    if (!c0) c0 = p.c;
    return dot(sub(p.c, c0), u);
  }

  return {
    K,
    get state() { return state; },
    get frames() { return track.length; },
    /** The camera's up from the motion sensors (a null reading is ignored: an earlier one stands). */
    setUp(u) { if (!u || u.length !== 3 || !Array.from(u).every(Number.isFinite) || !(Math.hypot(...u) > 0)) return; up = unit(u); if (tracker) tracker.setUp(up); },
    /** Forget the plate and look for it again (it was lost, or wasn't the bar's). */
    reset() { state = 'searching'; roi = null; Kroi = null; tracker = null; pending = null; track.length = 0; nLive = null; c0 = null; },
    /**
     * Look for the plate in a scaled-down copy of the whole frame (img: grey, img.w = vw · scale).
     *   prior: { x, y } in full-frame pixels where the bar should be (from the pose), or null
     *   radiusPx: [min, max] plate radius in full-frame pixels to look for (default: 3–30% of the frame height)
     * Returns { ok, ellipse (full frame) }. On success the next track() call starts following it.
     */
    detect(img, scale, { prior = null, radiusPx = null } = {}) {
      if (!Number.isFinite(scale) || scale <= 0 || !img || !Number.isFinite(img.w) || !Number.isFinite(img.h) || !(img.w > 0) || !(img.h > 0) || img.data?.length !== img.w * img.h) return { ok: false, reason: 'Invalid detection frame or scale' };
      const short = Math.min(vw, vh), [r0, r1] = radiusPx || [0.03 * short, 0.3 * short];
      const rMin = Math.max(6, Math.round(r0 * scale)), rMax = Math.max(10, Math.round(r1 * scale));
      const c = findPlate(img, { rMin, rMax, prior: prior ? { x: prior.x * scale, y: prior.y * scale } : null });
      if (!c) return { ok: false };
      const e = { cx: (c.cx + 0.5) / scale - 0.5, cy: (c.cy + 0.5) / scale - 0.5, a: c.a / scale, b: c.b / scale, phi: c.phi };
      if (!validEllipse(e)) return { ok: false, reason: 'Invalid plate outline' };
      // The crop: the plate's width plus margin, and its height plus the bar's travel up and down.
      const s = Math.min(1, targetPlatePx / (2 * e.a)), pxPerM = e.a / radiusM;
      const x0 = Math.max(0, Math.floor(e.cx - 1.9 * e.a)), x1 = Math.min(vw, Math.ceil(e.cx + 1.9 * e.a));
      const y0 = Math.max(0, Math.floor(e.cy - 1.3 * e.a - travelM * pxPerM)), y1 = Math.min(vh, Math.ceil(e.cy + 1.3 * e.a + travelM * pxPerM));
      roi = { x0, y0, w: x1 - x0, h: y1 - y0, s };
      Kroi = { fx: K.fx * s, fy: K.fy * s, cx: (K.cx - x0 + 0.5) * s - 0.5, cy: (K.cy - y0 + 0.5) * s - 0.5, w: Math.round(roi.w * s), h: Math.round(roi.h * s) };
      pending = e; state = 'locking'; track.length = 0; nLive = null; c0 = null;
      return { ok: true, ellipse: e };
    },
    /**
     * Start from a plate outline someone picked (the lab: Arete's outline or a tap), full-frame pixels — as if
     * detect() had found it. wholeFrame: follow it over the whole picture, not just round its path (offline,
     * where speed matters less than never losing it — a walk-out, a lifter stepping in after the pick).
     */
    lockOn(e, { wholeFrame = false } = {}) {
      if (!validEllipse(e)) return { ok: false, reason: 'Invalid plate outline' };
      const s = Math.min(1, targetPlatePx / (2 * e.a)), pxPerM = e.a / radiusM;
      const x0 = wholeFrame ? 0 : Math.max(0, Math.floor(e.cx - 1.9 * e.a)), x1 = wholeFrame ? vw : Math.min(vw, Math.ceil(e.cx + 1.9 * e.a));
      const y0 = wholeFrame ? 0 : Math.max(0, Math.floor(e.cy - 1.3 * e.a - travelM * pxPerM)), y1 = wholeFrame ? vh : Math.min(vh, Math.ceil(e.cy + 1.3 * e.a + travelM * pxPerM));
      roi = { x0, y0, w: x1 - x0, h: y1 - y0, s };
      Kroi = { fx: K.fx * s, fy: K.fy * s, cx: (K.cx - x0 + 0.5) * s - 0.5, cy: (K.cy - y0 + 0.5) * s - 0.5, w: Math.round(roi.w * s), h: Math.round(roi.h * s) };
      pending = { cx: e.cx, cy: e.cy, a: e.a, b: e.b, phi: e.phi }; state = 'locking'; track.length = 0; nLive = null; c0 = null;
      return { ok: true };
    },
    /** Every frame's outline so far: [{ t, ok, e (full frame) }] — what the lab saves and analyses. */
    get trackFrames() { return snapshot(); },
    /** What to grab each frame: source rectangle (full-frame px) and output size. Null until a plate is found. */
    roiPlan() { return roi ? { sx: roi.x0, sy: roi.y0, sw: roi.w, sh: roi.h, ow: Math.max(1, Math.round(roi.w * roi.s)), oh: Math.max(1, Math.round(roi.h * roi.s)) } : null; },
    /**
     * Follow the plate in this frame's crop (grey image from roiPlan()).
     * Returns { ok, t, e (full-frame ellipse), h (live height, m, relative to the first frame), reason? }.
     */
    track(img, t) {
      if (!Number.isFinite(t) || (track.length && t <= track[track.length - 1].t)) return { ok: false, t, reason: 'Frame timestamps must increase' };
      if (state === 'searching') return { ok: false, t, reason: 'no plate yet' };
      if (!img || img.w !== Kroi.w || img.h !== Kroi.h || img.data?.length !== img.w * img.h) return { ok: false, t, reason: 'Invalid tracking frame' };
      if (state === 'locking') {
        tracker = createRimTracker({ K: Kroi, up, R: radiusM });
        const r = tracker.init(img, toRoi(pending), t);
        if (!r.ok) { state = 'searching'; roi = null; Kroi = null; tracker = null; pending = null; return { ok: false, t, reason: r.reason || 'plate edge not found' }; }
        state = 'tracking';
        const e = toFull(r.e);
        track.push({ t, ok: true, e, fit: r.inliers / 72 });
        return { ok: true, t, e, h: liveHeight(e) };
      }
      const r = tracker.track(img, t);
      if (!r.ok) { track.push({ t, ok: false }); return { ok: false, t, reason: r.reason }; }
      const e = toFull(r.e);
      track.push({ t, ok: true, e, fit: r.inliers / 72 });
      return { ok: true, t, e, h: liveHeight(e) };
    },
    /**
     * After the set: every frame in 3D with the plate's facing and the focal length chosen from the whole
     * set, the bar's height, and transducer-style numbers per lift.
     * quality: { lost (share of frames), tiltDeg, spreadDeg, focalScale, ok } — ok = false means the plate's
     * outline didn't behave like one plate on a level bar (the reps' numbers shouldn't be trusted).
     */
    finish({ fitFocal = true } = {}) {
      if (!track.length) return { ok: false, reason: 'no plate tracked' };
      const rec = reconstruct3D(track, K, { up, R: radiusM, fitFocal });
      const heights = heightsFromTrack(rec.frames, rec.up || upv());
      const metrics = barMetrics(heights);
      return { ok: true, rec, heights, metrics, quality: setQuality(track, rec), track: snapshot() };
    },
  };
}
