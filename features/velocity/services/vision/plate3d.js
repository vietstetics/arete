// The plate in 3D, frame by frame — the measurement behind "velocity like a
// transducer on the bar, wherever the phone is".
//
// Two steps, kept apart on purpose:
//
//  1. Follow the plate's outer edge in the picture (createRimTracker).
//     Optical flow says roughly where the plate went; on each of 72 rays the
//     image edge nearest the predicted outline is found to a fraction of a
//     pixel, and a free ellipse is fitted through those points, dropping the
//     ones that disagree (a hand, a knee, a rack upright). The outline
//     followed is the outer FACE of the plate: when the phone is off to the
//     side, the plates' thickness shows as a band beside the face, and the
//     face's own edge is the one nearest the prediction there too.
//
//  2. Turn each ellipse into the plate's 3D centre (reconstruct3D). A circle
//     of known size seen through a camera of known focal length is fixed in
//     3D by its ellipse, up to a mirror-image twin (circle3d.js). Which twin
//     is real is decided over the whole set: the real plate faces sideways
//     (gravity) and keeps facing the same way as it moves round the picture,
//     while the twin's facing drifts. The same test also corrects the
//     camera's focal length, which a phone browser doesn't report.
//
// Why not fit the 3D plate to the edges directly with its facing held? Tried:
// a facing 2° off turns the per-frame height noise from 0.5 mm into 5 mm with
// 15 mm spikes, because the fit moves the plate to make up the shape. The
// free ellipse + exact pose stays at ~0.7 mm with no facing assumed at all.
//
// A frame where the rim can't be found cleanly is "lost" — never guessed.

import { lkTranslate, detectPlates } from './plate.js';
import { dirDeriv, sample } from './image.js';
import { radiusAt, robustEllipse, ellipseDistance } from './ellipse.js';
import { circlePoses, coneFromConic, ellipseToConic } from './circle3d.js';
import { dot, unit, sub, scale, norm, inv3, matVec } from './camera.js';

export const PLATE_RADIUS_M = 0.225;

/** How far a look-up point inside an edge sits, px (the plate's rim colour is read there). */
const insideAt = (rp) => Math.max(1.2, Math.min(2.5, 0.03 * rp));
/** An edge whose inside differs from the plate rim's colour by more than this (grey levels) isn't the rim. */
export const RIM_COLOUR_TOL = 55;
/** …and while the plate is found (still, sharp): the face's rim is one colour all round, within this. */
export const RIM_COLOUR_STRICT = 15;

/**
 * On one ray, the image edge (either polarity) best matching the plate's
 * rim near radius rp (within ±win px), to a fraction of a pixel.
 * ref: the rim's colour just inside its edge in this direction (learned when
 * the plate was found), or NaN. The rim is the edge with the rim's colour on
 * its inside: a background line, the stack's side band, the plate's inner lip
 * or the bar's sleeve all show something else there. Returns { r, g, inner } or null.
 */
function nearestEdge(img, ox, oy, ux, uy, rp, win, minGrad, ref = NaN, tol = RIM_COLOUR_TOL) {
  const step = 0.5, r0 = Math.max(1, rp - win), n = Math.max(5, Math.ceil((2 * win) / step) + 1), g = new Float32Array(n);
  let gmax = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(dirDeriv(img, ox + ux * (r0 + i * step), oy + uy * (r0 + i * step), ux, uy));
    g[i] = Number.isFinite(v) ? v : 0;
    if (g[i] > gmax) gmax = g[i];
  }
  const thr = Math.max(minGrad, 0.15 * gmax), din = insideAt(rp);
  let best = null;
  for (let i = 1; i < n - 1; i++) {
    if (g[i] < thr || g[i] < g[i - 1] || g[i] < g[i + 1]) continue;
    const den = g[i - 1] - 2 * g[i] + g[i + 1], off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g[i - 1] - g[i + 1])) / den)) : 0;
    const r = r0 + (i + off) * step;
    const inner = (sample(img, ox + ux * (r - din), oy + uy * (r - din)) + sample(img, ox + ux * (r - din - 1), oy + uy * (r - din - 1))) / 2;
    let cost = Math.abs(r - rp) / win;
    if (Number.isFinite(ref) && Number.isFinite(inner)) {
      const d = Math.abs(inner - ref);
      if (d > tol) continue;
      cost += d / 40;
    }
    if (!best || cost < best.cost) best = { r, g: g[i], inner, cost };
  }
  return best;
}

/**
 * Edge points round a predicted outline (an ellipse): on each ray from its
 * centre, the rim edge nearest it. ref: per-ray rim colour (see nearestEdge) or null;
 * tol: colour tolerance (grey levels), or a function of the ray direction (ux, uy).
 * Points carry { k: ray index, inner: colour just inside }.
 */
export function rimPoints(img, e, { rays = 72, win, minGrad = 4, ref = null, tol = RIM_COLOUR_TOL } = {}) {
  const pts = [];
  for (let k = 0; k < rays; k++) {
    const al = (2 * Math.PI * k) / rays, ux = Math.cos(al), uy = Math.sin(al), rp = radiusAt(e, al);
    const hit = nearestEdge(img, e.cx, e.cy, ux, uy, rp, win ?? Math.max(3, 0.12 * rp), minGrad, ref ? ref[k] : NaN, typeof tol === 'function' ? tol(ux, uy) : tol);
    if (hit) pts.push({ x: e.cx + ux * hit.r, y: e.cy + uy * hit.r, g: hit.g, inner: hit.inner, k });
  }
  return pts;
}

/**
 * The main colours among a set of grey values: up to two histogram peaks
 * (6-level bins, lightly smoothed) holding at least 15% of the values each.
 */
export function colourModes(vals) {
  const v = vals.filter(Number.isFinite);
  if (v.length < 6) return v.length ? [v.sort((a, b) => a - b)[v.length >> 1]] : [];
  const B = 6, bins = new Array(Math.ceil(256 / B) + 2).fill(0);
  for (const x of v) bins[Math.max(0, Math.min(bins.length - 1, Math.floor(x / B) + 1))]++;
  const sm = bins.map((c, i) => (bins[i - 1] || 0) * 0.5 + c + (bins[i + 1] || 0) * 0.5);
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] >= 0.15 * v.length) peaks.push(i);
  peaks.sort((a, b) => sm[b] - sm[a]);
  return peaks.slice(0, 2).map((i) => {
    const inBin = v.filter((x) => Math.abs(x - ((i - 1) * B + B / 2)) <= 1.5 * B).sort((a, b) => a - b);
    return inBin.length ? inBin[inBin.length >> 1] : (i - 1) * B + B / 2;
  });
}

/**
 * The rim's colour just inside its edge, per ray, from a fitted rim's
 * inlier points: rays without a point borrow from their neighbours, and
 * each value is the median of its 5-ray neighbourhood (a speck of glare
 * doesn't set the reference). Blends into `prev` by `blend` if given.
 */
export function rimColour(f, rays, prev = null, blend = 1) {
  const raw = new Array(rays).fill(NaN);
  const tol = Math.max(1, 0.02 * f.a);
  for (const p of f.pts || []) if (Math.abs(ellipseDistance(f, p)) <= tol && Number.isFinite(p.inner)) raw[p.k] = p.inner;
  if (!raw.some(Number.isFinite)) return prev;
  const out = new Array(rays);
  for (let k = 0; k < rays; k++) {
    const near = [];
    for (let d = 1; near.length < 5 && d <= rays / 2; d++) {
      if (d === 1 && Number.isFinite(raw[k])) near.push(raw[k]);
      for (const j of [(k + d) % rays, (k - d + rays) % rays]) if (Number.isFinite(raw[j]) && near.length < 5) near.push(raw[j]);
    }
    near.sort((x, y) => x - y);
    const m = near[near.length >> 1];
    out[k] = prev && Number.isFinite(prev[k]) ? prev[k] + blend * (m - prev[k]) : m;
  }
  return out;
}

/**
 * Fit an ellipse to the edges round a predicted outline, re-centring the
 * search on the fit a few times (narrowing it). Returns the ellipse with
 * { ok, rms (px), inliers (rays agreeing to within ~1 px), pts }.
 */
export function fitRim(img, e0, { rays = 72, wide = true, iters = 3, minGrad = 4, ref = null, tol = RIM_COLOUR_TOL, wideWin = 0.12 } = {}) {
  let e = e0, out = null;
  for (let it = 0; it < iters; it++) {
    const win = it === 0 && wide ? Math.max(3, wideWin * e.a) : Math.max(1.5, 0.04 * e.a);
    const pts = rimPoints(img, e, { rays, win, minGrad, ref, tol });
    if (pts.length < 0.4 * rays) return { ok: false };
    const f = robustEllipse(pts);
    if (!f || !(f.a > 0) || !(f.b > 0)) return { ok: false };
    const d = pts.map((p) => Math.abs(ellipseDistance(f, p)));
    const inTol = Math.max(1, 0.02 * f.a), inl = d.filter((x) => x <= inTol);
    const rms = Math.sqrt(inl.reduce((s, x) => s + x * x, 0) / Math.max(1, inl.length));
    out = { ...f, ok: true, rms, inliers: inl.length, pts };
    if (Math.hypot(f.cx - e.cx, f.cy - e.cy) < 0.05 && Math.abs(f.a - e.a) < 0.05) break;
    e = f;
  }
  return out || { ok: false };
}

/**
 * The plate's outer face edge near a rough detection. A plate seen at an
 * angle shows several clean, concentric ellipses: rings inside the face (a
 * lettering band, a raised lip, the edge of the rim zone, the hub), the
 * face's rim itself, and the silhouette of the face together with the side
 * band of the plate's thickness. Their geometry tells them apart: the rings
 * are smaller with the face's shape (concentric circles on one face), and
 * the silhouette has the face's long axis (the band runs along the short
 * one, where the plate's axis points in the picture) but is rounder. So the
 * search starts fits from many sizes and shapes round the detection — the
 * detection itself is often poor: a circle on an ellipse, or the hub — then
 * again from the centres of the clean fits it found, and of the clean fits
 * round the plate's centre keeps the outermost size, and of those the
 * narrowest. A rim hidden in places (a black plate against dark clothing)
 * still counts if at least half of it is seen and it fits cleanly — less
 * than half and an ellipse fit isn't trustworthy (Szpak et al.).
 * With the camera (K) and gravity (up) known, an outline must also be one a
 * plate on a level bar could make (MAX_TILT_DEG); without gravity, only a far
 * worse one is ruled out (MAX_TILT_NO_UP_DEG).
 */
export function findRim(img, det, { rays = 72, K = null, up = null, maxTilt } = {}) {
  // Without gravity the picture's up stands in, loosely: a phone pitched 20° makes a real plate "tilt" that much.
  const upT = up || [0, -1, 0], limit = maxTilt ?? (up ? MAX_TILT_DEG : MAX_TILT_NO_UP_DEG);
  // A plate's vertical diameter is never foreshortened: its outline's long axis lies along the picture's up there.
  const phiUp = ((Math.atan2(upT[1], upT[0]) % Math.PI) + Math.PI) % Math.PI;
  const fits = [];
  const tryFit = (e0) => {
    const f = fitRim(img, e0, { rays, iters: 4 });
    if (!f.ok || f.inliers < 0.5 * rays || !(f.rms < 1.5)) return;
    if (K && tiltReliable(f)) { f.tilt = plateTiltDeg(f, K, upT); if (f.tilt > limit) return; }
    if (fits.some((g) => Math.abs(g.a / f.a - 1) < 0.01 && Math.abs(g.b / f.b - 1) < 0.01 && Math.hypot(g.cx - f.cx, g.cy - f.cy) < 0.01 * f.a)) return;
    fits.push(f);
  };
  const shapes = [{ ba: det.b / det.a, phi: det.phi }, ...RIM_ASPECTS.map((ba) => ({ ba, phi: phiUp }))];
  for (const k of RIM_SIZES) for (const sh of shapes) tryFit({ cx: det.cx, cy: det.cy, a: det.a * k, b: det.a * k * sh.ba, phi: sh.phi });
  if (!fits.length) return { ok: false };
  const quality = (f) => (f.inliers / rays) / Math.max(0.3, f.rms);
  // Again from the centres of the cleanest fits (a ring found off a poor detection has the plate's centre and
  // shape), sizes stepping out past the face.
  const seeds = fits.slice().sort((x, y) => quality(y) - quality(x))
    .filter((f, i, all) => all.findIndex((g) => Math.hypot(g.cx - f.cx, g.cy - f.cy) < 0.1 * f.a) === i).slice(0, 3);
  for (const sd of seeds) for (const k of [1, 1.1, 1.2, 1.32, 1.45]) tryFit({ cx: sd.cx, cy: sd.cy, a: sd.a * k, b: sd.b * k, phi: sd.phi });
  const select = () => {
    const bestQ = Math.max(...fits.map(quality)), bestInl = Math.max(...fits.map((f) => f.inliers));
    const clean = fits.filter((f) => quality(f) >= 0.4 * bestQ && f.inliers >= Math.max(0.5 * rays, 0.75 * bestInl));
    const ref = clean.reduce((x, y) => (quality(y) > quality(x) ? y : x));
    const same = clean.filter((f) => Math.hypot(f.cx - ref.cx, f.cy - ref.cy) < 0.2 * Math.max(f.a, ref.a));
    // The outer size: the face and its silhouette with the band (whose long axis the band's corners stretch a
    // few %), never a ring inside (the nearest real ones sit at 0.93 of the radius or less).
    const aMax = Math.max(...same.map((f) => f.a)), outer = same.filter((f) => f.a >= aMax / 1.06);
    // Of the outer outlines, only those fitted about as cleanly as the cleanest there: an ellipse can also be
    // fitted through the rim along its long axis and a ring inside along its short one — narrower, but it
    // leaves more of the edge points out.
    const inlOuter = Math.max(...outer.map((f) => f.inliers)), clean85 = outer.filter((f) => f.inliers >= 0.85 * inlOuter);
    // Those whose short-axis ends look most like the rim (rimSides), then by shape.
    for (const f of clean85) if (f.sides === undefined) f.sides = rimSides(img, f, { rays });
    const bestSides = Math.max(...clean85.map((f) => f.sides)), cands = clean85.filter((f) => f.sides === bestSides);
    // A clean ring inside the face (the hub's edge, a lip, a lettering band) is a circle on the same face, so it
    // has the face's shape exactly (to well under 1% at these sizes) and its centre: the face is the outer
    // outline most like it — not the rounder face-with-band, nor a narrower rim-and-ring mix.
    const inner = same.filter((f) => f.a < aMax / 1.06 && quality(f) >= 0.6 * bestQ);
    const ring = inner.length ? inner.reduce((x, y) => (quality(y) > quality(x) ? y : x)) : null;
    const unlike = (f) => Math.abs(f.b / f.a - ring.b / ring.a) + Math.hypot(f.cx - ring.cx, f.cy - ring.cy) / f.a;
    // Without one, the narrowest clean outer outline: face + band is rounder than the face; between equally
    // narrow ones the outer (never a ring inside).
    const narrowest = (x, y) => (y.b / y.a < x.b / x.a - 0.01 || (Math.abs(y.b / y.a - x.b / x.a) <= 0.01 && y.a > x.a) ? y : x);
    const pick = ring ? cands.reduce((x, y) => (unlike(y) < unlike(x) ? y : x)) : cands.reduce(narrowest);
    return { clean, same, outer, pick };
  };
  let { clean, same, outer, pick } = select();
  // The outermost outline may be the face with its side band (where the band is wide, the face's own edge
  // isn't reached from a detection centred on both): the face has the same long axis, a shorter short one,
  // and sits towards one end of it. Fits started there settle on it if it's there.
  for (const f of outer.slice().sort((x, y) => quality(y) - quality(x)).slice(0, 2)) {
    const nx = -Math.sin(f.phi), ny = Math.cos(f.phi); // the short axis
    for (const kb of [0.9, 0.8, 0.7]) for (const sg of [-1, 1]) {
      const d = sg * (1 - kb) * f.b;
      tryFit({ cx: f.cx + d * nx, cy: f.cy + d * ny, a: f.a, b: f.b * kb, phi: f.phi });
    }
  }
  ({ clean, same, outer, pick } = select());
  // The face's rim is one colour all the way round. Refit using only edges with that colour inside them:
  // where the stack's side band shows, its outer edge has the band's colour inside, and the face's own
  // edge — a few pixels in — is taken instead. The rim colour is found as the main clusters of the colours
  // inside this outline's edges (the band can be a large share of them, so not a median); each is tried,
  // and the result that's most like one vertical circle — the plate face is exactly one, the face plus
  // its side band isn't — is kept.
  const inners = (pick.pts || []).filter((q) => Number.isFinite(q.inner) && Math.abs(ellipseDistance(pick, q)) <= Math.max(1, 0.02 * pick.a)).map((q) => q.inner);
  // Circle-likeness is only compared with gravity known (without it, a pitched phone's real plate "tilts").
  const tiltOf = (f) => (K && up && tiltReliable(f) ? plateTiltDeg(f, K, up) : NaN);
  let out = pick, outTilt = tiltOf(pick);
  const refits = [];
  for (const g of colourModes(inners)) {
    const flat = new Array(rays).fill(g);
    const f2 = fitRim(img, pick, { rays, wide: true, wideWin: 0.16, iters: 4, ref: flat, tol: RIM_COLOUR_STRICT });
    refits.push({ g, f2 });
    if (!f2.ok || f2.inliers < 0.5 * rays) continue;
    if (K && tiltReliable(f2) && plateTiltDeg(f2, K, upT) > limit) continue;
    const tilt = tiltOf(f2);
    // Prefer the more circle-like outline when both are clearly seen at an angle (then "circle-like" means
    // something). Otherwise the narrower one: the side band always lies along the outline's short axis (both
    // are where the plate's axis points in the picture), so face + band is rounder than the face alone, while
    // a lip or ring inside the face is exactly as narrow as it. Between equally narrow ones, the outer.
    // (The band changes the outline's width, not its tilt, so with gravity known the tilt only decides when it
    // differs clearly.) A narrower refit must be about as clean: not a rim-and-inner-ring mix.
    const narrower = f2.b / f2.a < out.b / out.a - 0.005 && f2.inliers >= 0.85 * out.inliers, asNarrow = Math.abs(f2.b / f2.a - out.b / out.a) <= 0.005;
    const tiltDiff = Number.isFinite(tilt) && Number.isFinite(outTilt) ? tilt - outTilt : 0;
    const better = tiltDiff < -1 || (tiltDiff <= 1 && (narrower || (asNarrow && f2.a > out.a * 1.01)));
    if (better) { out = f2; outTilt = tilt; }
  }
  if (typeof globalThis.__rimDebug === 'function') globalThis.__rimDebug({ fits, clean, same, pick, out, refits, modes: colourModes(inners), outTilt, pickTilt: tiltOf(pick) });
  return { ...out, ref: rimColour(out, rays) };
}

/**
 * The outermost outline round the same centre as a circle found on a plate
 * (its hub, a lettering ring), out to radius rMax (px). The circle search
 * itself often can't size a plate seen at an angle — its rim is an ellipse,
 * and a ring of circular rays catches only bits of it, while the round hub
 * scores cleanly — and a dark plate's rim against dark clothing is the fainter
 * edge. Fits are started from the circle scaled up step by step (×1.12), and
 * the biggest seen round at least half its edge and sharing its centre is
 * returned, or null. Which of the rings out there is the face's rim (not the
 * band beside it, nor a lip inside) is findRim's job; this only gets near it.
 */
export function outermostRing(img, e, rMax, { rays = 72 } = {}) {
  let out = null;
  for (let k = 1.15; e.a * k <= rMax; k *= 1.12) {
    const f = fitRim(img, { cx: e.cx, cy: e.cy, a: e.a * k, b: e.b * k, phi: e.phi }, { rays, iters: 4 });
    if (!f.ok || f.inliers < 0.5 * rays || f.a < 1.1 * e.a || Math.hypot(f.cx - e.cx, f.cy - e.cy) > 0.15 * f.a) continue;
    if (!out || f.a > out.a) out = f;
  }
  return out;
}

/**
 * How many of an outline's two short-axis ends look like the face's rim:
 * the colour just inside matches the rim's own colour at the long-axis ends
 * (where the side band never shows), and the colour just outside doesn't.
 * The face with its side band fails on the band's end (the band's colour is
 * inside); a fit that runs along a ring inside the face there fails too (the
 * rim's colour is outside). Where band and rim look alike this can't tell,
 * and the shape decides (findRim).
 */
export function rimSides(img, e, { rays = 72, tol = 12 } = {}) {
  const at = (k, d) => { const al = (2 * Math.PI * k) / rays, r = radiusAt(e, al) + d; return sample(img, e.cx + Math.cos(al) * r, e.cy + Math.sin(al) * r); };
  const med = (v) => { const x = v.filter(Number.isFinite).sort((p, q) => p - q); return x.length ? x[x.length >> 1] : NaN; };
  const ends = [], sides = [[], []];
  for (let k = 0; k < rays; k++) {
    const al = (2 * Math.PI * k) / rays, c = Math.cos(al - e.phi), sn = Math.sin(al - e.phi);
    const inner = (at(k, -1.5) + at(k, -2.5)) / 2, outer = (at(k, 1.5) + at(k, 2.5)) / 2;
    if (Math.abs(c) > 0.87) ends.push(inner);
    else if (Math.abs(sn) > 0.8) sides[sn > 0 ? 0 : 1].push({ inner, outer });
  }
  const c0 = med(ends);
  if (!Number.isFinite(c0)) return 0;
  return sides.filter((sd) => { const ci = med(sd.map((q) => q.inner)), co = med(sd.map((q) => q.outer)); return Math.abs(ci - c0) <= tol && !(Math.abs(co - c0) <= tol); }).length;
}

/** Rim search starting sizes (× the detection's radius) and shapes (short / long axis), see findRim. */
const RIM_SIZES = [0.75, 0.85, 0.95, 1.05, 1.15, 1.3, 1.45, 1.6, 1.75];
const RIM_ASPECTS = [0.9, 0.75, 0.6, 0.45];

/**
 * How far (degrees) the plate's facing would be from horizontal for this
 * outline — the better of the two 3D readings. A real plate on a level bar
 * reads under ~3.5° even with the field of view 12% off and gravity 1° off.
 */
export const MAX_TILT_DEG = 8;
/**
 * …and without the phone's gravity, against the picture's up: a phone pitched
 * or rolled 20° makes a real plate look tilted that much, so only a far worse
 * outline (a blob, half a plate) is ruled out.
 */
export const MAX_TILT_NO_UP_DEG = 30;
/**
 * Whether an outline's facing can be judged: seen nearly head-on (short axis
 * over 96% of the long one) a plate's outline is almost a circle, and which way
 * it "tilts" is lost in the edge noise — a real plate can then read 7° off,
 * and a ring inside it 1°. Such outlines are never judged by their tilt.
 */
export const tiltReliable = (e) => e.b / e.a < 0.96;
export function plateTiltDeg(e, K, up, R = PLATE_RADIUS_M) {
  const ps = posesOf(e, K, R);
  if (!ps.length) return 90;
  const u = unit(up);
  return Math.min(...ps.map((p) => (Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(p.n, u))))) * 180) / Math.PI));
}

/**
 * The fastest a barbell moves in the lifts measured (m/s; squat, bench and
 * deadlift bars peak well under 2.5). A plate re-found further from where the
 * tracked one was last seen than this speed allows is another plate (a stored
 * one on the rack, say), never the bar's.
 */
export const MAX_BAR_SPEED = 3;

/**
 * Follows the plate's outer edge through a set, in the picture.
 *   const tr = createRimTracker({ K, up }); tr.init(img, ellipse, t); tr.track(img, t) → result
 * K, up (optional): the camera and gravity, to reject outlines no plate could make.
 * R: the plate's radius (m) — only to turn MAX_BAR_SPEED into pixels.
 * Result: { ok, t, e: { cx, cy, a, b, phi } (px), rms, inliers, reason? }.
 */
export function createRimTracker({ rays = 72, maxRms = 1.5, jumpTol = 0.3, sizeTol = 0.06, K = null, up = null, R = PLATE_RADIUS_M } = {}) {
  const upv = () => up || [0, -1, 0], tiltLimit = () => (up ? MAX_TILT_DEG + 4 : MAX_TILT_NO_UP_DEG);
  let prev = null, e = null, lastT = 0, v2 = { x: 0, y: 0 }, ref = null;
  /** How far (px) the plate can have moved in dt seconds: the usual frame-to-frame slack plus the bar's top speed. */
  const reach = (dt) => jumpTol * e.a + MAX_BAR_SPEED * dt * (e.a / R);
  function reacquire(img, pred, maxMove) {
    const cands = detectPlates(img, { rMin: Math.max(6, Math.round(0.85 * e.a)), rMax: Math.max(8, Math.round(1.15 * e.a)), prior: { x: pred.cx, y: pred.cy }, max: 3 });
    let best = null;
    for (const c of cands) {
      const g = fitRim(img, { cx: c.cx, cy: c.cy, a: e.a, b: e.b, phi: e.phi }, { rays, wide: true, iters: 4, ref, tol: RIM_COLOUR_STRICT });
      if (!g.ok || g.inliers < 0.5 * rays || Math.abs(g.a - e.a) > sizeTol * e.a) continue;
      if (Math.hypot(g.cx - e.cx, g.cy - e.cy) > maxMove) continue; // too far for the bar to have got to
      const q = (g.inliers / Math.max(0.3, g.rms)) / (1 + Math.hypot(g.cx - pred.cx, g.cy - pred.cy) / e.a);
      if (!best || q > best.q) best = { ...g, q };
    }
    return best;
  }
  return {
    get ellipse() { return e ? { ...e } : null; },
    /** Gravity arrived (or was refined) after the tracker started. */
    setUp(u) { up = u || null; },
    init(img, det, t) {
      const f = findRim(img, det, { rays, K, up });
      if (!f.ok) return { ok: false, t, reason: 'plate edge not found' };
      ref = f.ref || null;
      e = { cx: f.cx, cy: f.cy, a: f.a, b: f.b, phi: f.phi }; prev = img; lastT = t; v2 = { x: 0, y: 0 };
      return { ok: true, t, e: { ...e }, rms: f.rms, inliers: f.inliers };
    },
    track(img, t) {
      if (!e) return { ok: false, t };
      // Time since the plate was last seen (frames since may have been skipped or lost): the optical flow
      // runs from that frame, and looks further (a deeper pyramid) when the plate may have moved a lot.
      const dt = Math.max(1e-3, t - lastT), guess = { dx: v2.x * dt, dy: v2.y * dt };
      const far = Math.hypot(guess.dx, guess.dy) > 0.15 * e.a || dt > 0.05;
      const flow = lkTranslate(prev, img, e, guess, { stride: 2, iters: 6, levels: far ? 3 : 2 });
      const shift = flow.ok ? { x: flow.dx, y: flow.dy } : guess;
      const pred = { ...e, cx: e.cx + shift.x, cy: e.cy + shift.y };
      // The rim's colour must match strictly (so the stack's side band or a background edge can't take
      // over) — except along the direction the plate is moving this frame, where motion blur smears the
      // edge and mixes the colours: there the tolerance opens with the movement (fully by ~2 px).
      const mv = Math.hypot(shift.x, shift.y), mx = mv > 0 ? shift.x / mv : 0, my = mv > 0 ? shift.y / mv : 0;
      const tol = (ux, uy) => RIM_COLOUR_STRICT + (RIM_COLOUR_TOL - RIM_COLOUR_STRICT) * Math.min(1, (mv * Math.abs(ux * mx + uy * my)) / 2);
      const problem = (f, near) => {
        if (!f || !f.ok) return 'rim not found';
        if (f.rms > maxRms || f.inliers < 0.5 * rays) return 'rim fit poor';
        if ((near && Math.hypot(f.cx - pred.cx, f.cy - pred.cy) > jumpTol * e.a) || Math.abs(f.a - e.a) > sizeTol * e.a) return 'jump';
        if (K && tiltReliable(f) && plateTiltDeg(f, K, upv()) > tiltLimit()) return 'outline not plate-shaped';
        return '';
      };
      let f = fitRim(img, pred, { rays, wide: !flow.ok, ref, tol });
      let why = problem(f, true);
      // Lost it (a fast move after skipped frames, say): look for a plate of the same size in the crop,
      // nearest where it should be, and keep it only if its rim matches the plate's colour strictly.
      if (why) { const g = reacquire(img, pred, reach(dt)); if (g && !problem(g, false)) { f = g; why = ''; } }
      if (why) return { ok: false, t, reason: why, rms: f && f.rms };
      v2 = { x: 0.5 * v2.x + (0.5 * (f.cx - e.cx)) / dt, y: 0.5 * v2.y + (0.5 * (f.cy - e.cy)) / dt };
      e = { cx: f.cx, cy: f.cy, a: f.a, b: f.b, phi: f.phi };
      prev = img; lastT = t;
      ref = rimColour({ ...f, pts: (f.pts || []).filter((q) => ref && Number.isFinite(ref[q.k]) && Math.abs(q.inner - ref[q.k]) <= RIM_COLOUR_STRICT) }, rays, ref, 0.1) || ref; // follow slow lighting changes, from strictly matching edges only
      return { ok: true, t, e: { ...e }, rms: f.rms, inliers: f.inliers };
    },
  };
}

/** Both 3D readings of an ellipse: [{ c, n }] (camera frame, metres). */
const posesOf = (e, K, R) => circlePoses(coneFromConic(ellipseToConic(e), K), R);

/**
 * Split each frame's two readings into two consistent families (each frame's
 * reading closest in facing to the family's previous one) and score them:
 * the real plate faces sideways (normal ⟂ up) and keeps the same facing;
 * the mirror twin drifts. Lower score = more plausible.
 */
function families(frames, K, R, up) {
  const A = [], B = [];
  let nA = null, nB = null;
  for (const f of frames) {
    const ps = posesOf(f.e, K, R);
    if (!ps.length) continue;
    let [p, q] = ps.length > 1 ? ps : [ps[0], ps[0]];
    if (!nA) { if (Math.abs(dot(q.n, up)) < Math.abs(dot(p.n, up))) [p, q] = [q, p]; }
    else if (Math.abs(dot(q.n, nA)) + Math.abs(dot(p.n, nB)) > Math.abs(dot(p.n, nA)) + Math.abs(dot(q.n, nB))) [p, q] = [q, p];
    A.push(p); B.push(q); nA = p.n; nB = q.n;
  }
  const score = (fam) => {
    const ns = fam.map((p) => p.n);
    if (!ns.length) return { score: Infinity };
    const mean = unit(ns.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]));
    const spread = ns.reduce((s, v) => s + Math.acos(Math.min(1, Math.abs(dot(v, mean)))), 0) / ns.length;
    const tilt = ns.reduce((s, v) => s + Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(v, up))))), 0) / ns.length;
    return { score: tilt + spread, tilt, spread, mean };
  };
  return [score(A), score(B)];
}

/**
 * The camera's "up" without motion sensors: the picture's up, turned just
 * enough to be square to the plate's facing (the bar is level, so the true up
 * is square to it). That fixes the tilt the plate can see — all of the
 * phone's pitch when it films side-on, its roll when it films along the bar
 * — and leaves only the turn about the bar itself assumed level.
 */
export function upFromPlate(normal, pictureUp = [0, -1, 0]) {
  const n = unit(normal), v = sub(pictureUp, scale(n, dot(pictureUp, n)));
  return norm(v) > 0.3 ? unit(v) : unit(pictureUp);
}

/**
 * Depth from the plane the plate moves in. A plate's distance comes from its
 * outline's size, known to ~0.5% a frame (±15 mm at 3.5 m), while its
 * direction from the camera is known ten times better. When the camera looks
 * up or down at the bar, depth noise leaks into the height (× the sine of
 * that angle: ±4 mm a frame at 17°, enough to start a fast rep 0.1 s early).
 * But the plate moves in the plane across the bar — square to its level
 * facing — whose offset only changes as the bar slides along its own length:
 * slowly, by centimetres. So each frame's centre is put where its ray meets
 * that plane, the plane's offset taken from the frames within ±half seconds
 * (a robust local line). The ray itself is aimed through the image of the
 * plate's centre found from the set's steady facing — the pole of the
 * plate plane's vanishing line with respect to the outline (projective
 * geometry: a circle's centre is the pole of its plane's line at infinity)
 * — so each frame's own, noisier reading of its facing doesn't move it.
 *   frames: reconstruct3D frames (changed in place; e: the outline, if known); normal: the plate's facing;
 *   up: unit up; K: the intrinsics the frames were read with (for the pole; without it, each frame's own ray)
 */
export function steadyDepth(frames, normal, up, { half = 0.2, minCos = 0.35, K = null, how = 'line' } = {}) {
  const u = unit(up), nh0 = sub(normal, scale(u, dot(normal, u)));
  if (norm(nh0) < 0.5) return 0;
  const n = unit(nh0);
  // The plate plane's vanishing line, l = K⁻ᵀ n.
  const l = K ? [n[0] / K.fx, n[1] / K.fy, n[2] - (K.cx * n[0]) / K.fx - (K.cy * n[1]) / K.fy] : null;
  const rayOf = (f) => {
    if (l && f.e) {
      const Ci = inv3(ellipseToConic(f.e)), x = Ci && matVec(Ci, l);
      if (x && Math.abs(x[2]) > 1e-12) {
        const px = x[0] / x[2], py = x[1] / x[2];
        if (Math.hypot(px - f.e.cx, py - f.e.cy) < f.e.a) return unit([(px - K.cx) / K.fx, (py - K.cy) / K.fy, 1]);
      }
    }
    return unit(f.c);
  };
  const ok = frames.map((f, i) => (f.ok && f.c ? i : -1)).filter((i) => i >= 0);
  const k = new Map(ok.map((i) => [i, dot(frames[i].c, n)]));
  let changed = 0;
  const out = [];
  for (let j = 0; j < ok.length; j++) {
    const i = ok[j], t0 = frames[i].t, r = rayOf(frames[i]), cr = dot(r, n);
    if (Math.abs(cr) < minCos) continue;
    // Neighbours within ±half s: a median/MAD cut of glitches, then a least-squares line in time.
    let a = j, b = j;
    while (a > 0 && t0 - frames[ok[a - 1]].t <= half) a--;
    while (b < ok.length - 1 && frames[ok[b + 1]].t - t0 <= half) b++;
    if (b - a < 4) continue;
    const ks = ok.slice(a, b + 1).map((q) => ({ t: frames[q].t - t0, k: k.get(q) }));
    const med = ks.map((x) => x.k).sort((x, y) => x - y)[ks.length >> 1];
    const mad = ks.map((x) => Math.abs(x.k - med)).sort((x, y) => x - y)[ks.length >> 1] || 1e-6;
    const use = ks.filter((x) => Math.abs(x.k - med) <= 4 * 1.4826 * mad);
    if (use.length < 4) continue;
    let kHere;
    if (how === 'median') kHere = med;
    else {
      const mt = use.reduce((s, x) => s + x.t, 0) / use.length, mk = use.reduce((s, x) => s + x.k, 0) / use.length;
      const stt = use.reduce((s, x) => s + (x.t - mt) ** 2, 0), stk = use.reduce((s, x) => s + (x.t - mt) * (x.k - mk), 0);
      kHere = stt > 0 ? mk + (stk / stt) * (0 - mt) : mk;
    }
    out.push([i, scale(r, kHere / cr)]);
  }
  for (const [i, c] of out) { frames[i] = { ...frames[i], c, cRaw: frames[i].c }; changed++; }
  return changed;
}

/**
 * The plate's 3D centre in every tracked frame.
 *   track: [{ t, ok, e }] from createRimTracker
 *   K: assumed intrinsics; up: the camera's up (unit, camera frame) from the motion sensors, or null
 *     (then taken from the plate: upFromPlate)
 *   fitFocal: also correct the focal length (searched over ±20%, preferring the assumed value)
 *   steady: depth from the plate's plane (steadyDepth) — false keeps each frame's own depth
 * Returns { frames: [{ t, ok, c, n }], normal, up (the up the heights should use), upFrom ('sensors' |
 *   'plate'), focalScale, tiltDeg, spreadDeg }.
 */
export function reconstruct3D(track, K, { up = null, R = PLATE_RADIUS_M, fitFocal = true, focalPrior = 0.1, steady = true, steadyHalf = 0.2, steadyHow = 'line' } = {}) {
  const u = up ? unit(up) : [0, -1, 0];
  const ok = track.filter((f) => f.ok && f.e);
  if (!ok.length) return { frames: track.map((f) => ({ t: f.t, ok: false })), normal: null, up: u, upFrom: up ? 'sensors' : 'level', focalScale: 1 };
  // The search only needs the facing, not every frame.
  const step = Math.max(1, Math.floor(ok.length / 60)), sample = ok.filter((_, i) => i % step === 0);
  const tryK = (k) => {
    const KK = { ...K, fx: K.fx * k, fy: K.fy * k };
    const fam = families(sample, KK, R, u).sort((a, b) => a.score - b.score)[0];
    // A gentle prior: the focal length is probably near the assumed one.
    return { k, KK, fam, total: fam.score + 0.002 * (Math.log(k) / focalPrior) ** 2 };
  };
  let best = tryK(1);
  if (fitFocal) {
    for (let k = 0.8; k <= 1.2001; k += 0.02) { const r = tryK(k); if (r.total < best.total) best = r; }
    const k0 = best.k;
    for (let k = k0 - 0.02; k <= k0 + 0.02001; k += 0.004) { const r = tryK(k); if (r.total < best.total) best = r; }
  }
  const nRef = best.fam.mean;
  if (!nRef) return { frames: track.map((f) => ({ t: f.t, ok: false })), normal: null, up: u, upFrom: up ? 'sensors' : 'level', focalScale: 1 };
  const frames = track.map((f) => {
    if (!f.ok || !f.e) return { t: f.t, ok: false };
    const ps = posesOf(f.e, best.KK, R);
    if (!ps.length) return { t: f.t, ok: false };
    const p = ps.reduce((a, b) => (Math.abs(dot(b.n, nRef)) > Math.abs(dot(a.n, nRef)) ? b : a));
    return { t: f.t, ok: true, c: p.c, n: p.n, e: f.e };
  });
  // Gravity from the sensors, checked against the plate: the true up is square to the plate's facing, and
  // within 60° of the picture's up for any phone filming a lift upright. Sensors that say the opposite have
  // the sign the wrong way round (a platform convention, or a reading taken upside down): turned over.
  let uUse = up ? u : upFromPlate(nRef, u), upFrom = up ? 'sensors' : 'plate';
  if (up && dot(u, upFromPlate(nRef)) < -0.5) { uUse = scale(u, -1); upFrom = 'sensors (sign corrected)'; }
  if (steady) steadyDepth(frames, nRef, uUse, { half: steadyHalf, K: best.KK, how: steadyHow });
  dropSpikes(frames, uUse);
  return { frames, normal: nRef, up: uUse, upFrom, focalScale: best.k, tiltDeg: (best.fam.tilt * 180) / Math.PI, spreadDeg: (best.fam.spread * 180) / Math.PI };
}

/**
 * A bar can't jump. A frame whose height (up · centre) is far from a smooth
 * curve through its neighbours (a quadratic fitted to ±4 frames, so the turn
 * at the bottom of a rep isn't mistaken for a jump) — further than 2 cm and
 * 5× the neighbours' own scatter — is a glitch (a bad outline: a frame where
 * something else looked like the rim) and is marked lost rather than smoothed
 * into the speed. Depth is left out: it's the noisy direction and barely
 * moves the height.
 */
export function dropSpikes(frames, up, { half = 4, k = 5, floor = 0.02 } = {}) {
  const u = unit(up), ok = frames.map((f, i) => (f.ok ? i : -1)).filter((i) => i >= 0);
  const h = (i) => dot(frames[i].c, u);
  const bad = [];
  for (let j = 0; j < ok.length; j++) {
    const nb = ok.slice(Math.max(0, j - half), Math.min(ok.length, j + half + 1)).filter((i) => i !== ok[j]);
    if (nb.length < 5) continue;
    const t0 = frames[ok[j]].t;
    // Least-squares quadratic through the neighbours: h ≈ a + b τ + c τ², τ = t − t0.
    let S = [0, 0, 0, 0, 0], Y = [0, 0, 0];
    for (const i of nb) { const tau = frames[i].t - t0, y = h(i); let p = 1; for (let q = 0; q < 5; q++) { S[q] += p; if (q < 3) Y[q] += p * y; p *= tau; } }
    const M = [[S[0], S[1], S[2], Y[0]], [S[1], S[2], S[3], Y[1]], [S[2], S[3], S[4], Y[2]]];
    let solved = true;
    for (let c = 0; c < 3 && solved; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-15) { solved = false; break; }
      for (let r = 0; r < 3; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let q = c; q < 4; q++) M[r][q] -= f * M[c][q]; }
    }
    if (!solved) continue;
    const co = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    const at = (tau) => co[0] + co[1] * tau + co[2] * tau * tau;
    const scatter = Math.sqrt(nb.reduce((s2, i) => s2 + (h(i) - at(frames[i].t - t0)) ** 2, 0) / nb.length);
    if (Math.abs(h(ok[j]) - co[0]) > Math.max(floor, k * scatter)) bad.push(ok[j]);
  }
  for (const i of bad) frames[i] = { t: frames[i].t, ok: false, spike: true };
  return bad.length;
}

/**
 * The bar's height over time from 3D frames: up · c, in metres (up = against
 * gravity). Lost frames are NaN. Also the horizontal movement (bar path), m.
 */
export function heightsFromTrack(frames, up) {
  const u = unit(up), ref = frames.find((f) => f.ok && f.c);
  if (!ref) return [];
  return frames.map((f) => {
    if (!f.ok || !f.c) return { t: f.t, y: NaN, h: NaN };
    const d = sub(f.c, ref.c), y = dot(d, u), hz = sub(d, scale(u, y));
    return { t: f.t, y, h: norm(hz) };
  });
}
