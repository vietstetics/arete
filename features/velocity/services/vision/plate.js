// Finding and following the plate (or dumbbell head) — build step 2 of
// docs/velocity-tracking-plan.md: "circle/plate detection + optical-flow
// tracking". Plain JavaScript on grayscale frames, no OpenCV.
//
//  detectPlates  — circle search (gradient Hough) near where the pose says
//                  the bar is, each candidate refined to an ellipse
//  refineEllipse — fits the plate's rim: rays from the centre, the strongest
//                  edge on each, a robust ellipse through those points
//  lkTranslate   — optical flow (pyramidal Lucas–Kanade) of the plate
//                  between frames, to predict where it went
//  createPlateTracker — flow to predict, rim fit to measure, consistency
//                  checks; when the rim can't be found the frame is "lost"
//                  (never guessed)

import { sample, dirDeriv, sobel, half } from './image.js';
import { robustEllipse, radiusAt, ellipseDistance } from './ellipse.js';

const RAYS = 72;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/**
 * Fit the plate rim near a guess ({ cx, cy, r } or an ellipse). On each of 72
 * rays the strongest edge of the plate's polarity (rim darker or lighter
 * than what's behind it) within `range` × the guessed radius is located to a
 * fraction of a pixel; a robust ellipse is fitted through those points.
 * Returns the ellipse with { ok, inlier (share of rays on the rim), polarity }.
 */
export function refineEllipse(img, guess, { range = [0.75, 1.25], polarity = 0, step = 0.5, minInlier = 0.5 } = {}) {
  const { cx, cy } = guess, prof = [];
  let r0sum = 0;
  for (let k = 0; k < RAYS; k++) {
    const al = (2 * Math.PI * k) / RAYS, ux = Math.cos(al), uy = Math.sin(al);
    const r0 = guess.a ? radiusAt(guess, al) : guess.r;
    r0sum += r0;
    const r1 = range[0] * r0, n = Math.max(3, Math.ceil(((range[1] - range[0]) * r0) / step) + 1), v = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = r1 + i * step, g = dirDeriv(img, cx + ux * r, cy + uy * r, ux, uy); v[i] = Number.isFinite(g) ? g : 0; }
    prof.push({ ux, uy, r1, v });
  }
  if (!polarity) {
    let s = 0;
    for (const p of prof) { let m = 0; for (const x of p.v) if (Math.abs(x) > Math.abs(m)) m = x; s += m; }
    polarity = s >= 0 ? 1 : -1;
  }
  const pts = [], str = [];
  for (const p of prof) {
    let bi = -1, bv = 0;
    for (let i = 1; i < p.v.length - 1; i++) { const x = polarity * p.v[i]; if (x > bv) { bv = x; bi = i; } }
    if (bi < 0) continue;
    const l = polarity * p.v[bi - 1], c = bv, r = polarity * p.v[bi + 1], den = l - 2 * c + r;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
    const rad = p.r1 + (bi + off) * step;
    pts.push({ x: cx + p.ux * rad, y: cy + p.uy * rad }); str.push(bv);
  }
  if (pts.length < 12) return { ok: false, polarity };
  const med = median(str), strong = pts.filter((_, i) => str[i] >= 0.3 * med);
  const e = robustEllipse(strong);
  if (!e) return { ok: false, polarity };
  const tol = Math.max(1.2, 0.02 * e.a), inl = pts.filter((p) => Math.abs(ellipseDistance(e, p)) <= tol).length;
  const meanR = r0sum / RAYS;
  const ok = inl / RAYS >= minInlier && e.b / e.a >= 0.5 && e.a <= 1.6 * meanR && e.a >= 0.6 * meanR;
  return { ...e, ok, inlier: inl / RAYS, polarity, strength: med };
}

/**
 * Find plate-like circles in a frame. rMin / rMax: plausible radius range
 * (px). prior: { x, y } where the bar end should be (from the pose), which
 * ranks nearer candidates higher. Returns candidates (best first) as
 * ellipses with { score, inlier }.
 */
export function detectPlates(img, { rMin, rMax, prior = null, max = 4 } = {}) {
  const { w, h } = img, { gx, gy, mag } = sobel(img);
  // Strong edges: the top ~8% of gradient magnitudes.
  const sampleMags = [];
  for (let i = 0; i < mag.length; i += 7) sampleMags.push(mag[i]);
  sampleMags.sort((a, b) => a - b);
  const thr = Math.max(4, sampleMags[Math.floor(sampleMags.length * 0.92)]);
  const W = (w >> 1) + 1, H = (h >> 1) + 1, acc = new Float32Array(W * H);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = mag[i];
    if (m < thr) continue;
    const ux = gx[i] / m, uy = gy[i] / m;
    for (let r = rMin; r <= rMax; r += 2) for (const sg of [-1, 1]) {
      const X = Math.round((x + sg * ux * r) / 2), Y = Math.round((y + sg * uy * r) / 2);
      if (X >= 0 && Y >= 0 && X < W && Y < H) acc[Y * W + X] += 1;
    }
  }
  // Local maxima of the vote map.
  const peaks = [];
  for (let Y = 2; Y < H - 2; Y++) for (let X = 2; X < W - 2; X++) {
    const v = acc[Y * W + X];
    if (v < 4) continue;
    let top = true;
    for (let j = -2; j <= 2 && top; j++) for (let k = -2; k <= 2; k++) if ((j || k) && acc[(Y + j) * W + X + k] > v) { top = false; break; }
    if (top) peaks.push({ x: 2 * X, y: 2 * Y, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const out = [];
  for (const pk of peaks.slice(0, 12)) {
    // Radius: the outermost strong circular edge around this centre (the rim, not the hub).
    const S = [];
    for (let r = rMin; r <= rMax; r++) {
      let s = 0;
      for (let k = 0; k < RAYS; k += 2) { const al = (2 * Math.PI * k) / RAYS, g = dirDeriv(img, pk.x + Math.cos(al) * r, pk.y + Math.sin(al) * r, Math.cos(al), Math.sin(al)); if (Number.isFinite(g)) s += g; }
      S.push(Math.abs(s));
    }
    const best = Math.max(...S);
    let ri = S.lastIndexOf(best);
    for (let i = S.length - 1; i > ri; i--) if (S[i] >= 0.75 * best) { ri = i; break; }
    const e = refineEllipse(img, { cx: pk.x, cy: pk.y, r: rMin + ri }, { range: [0.8, 1.2] });
    if (!e.ok) continue;
    if (out.some((o) => Math.hypot(o.cx - e.cx, o.cy - e.cy) < 0.5 * o.a)) continue;
    const near = prior ? Math.exp(-((e.cx - prior.x) ** 2 + (e.cy - prior.y) ** 2) / (2 * (1.5 * rMax) ** 2)) : 1;
    out.push({ ...e, score: e.inlier * Math.sqrt(e.strength) * near * (0.5 + e.a / rMax) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/**
 * Optical flow of the plate between two frames: pyramidal Lucas–Kanade,
 * translation only, using pixels inside the plate (the background stays
 * still and would pull the answer towards zero). guess: expected shift.
 * stride: use every stride-th pixel at full resolution (faster).
 * Returns { dx, dy, ok }.
 */
export function lkTranslate(prev, cur, e, guess = { dx: 0, dy: 0 }, { levels = 2, iters = 10, stride = 1 } = {}) {
  // Image pyramids, cached on the image and extended if a call wants more levels than were built before.
  const pyr = (img) => { const p = img.pyr || (img.pyr = [img]); while (p.length < levels) p.push(half(p[p.length - 1])); return p; };
  const P = pyr(prev), C = pyr(cur);
  let dx = guess.dx / 2 ** (levels - 1), dy = guess.dy / 2 ** (levels - 1), ok = true;
  for (let l = levels - 1; l >= 0; l--) {
    const k = 2 ** l, A = P[l], B = C[l], cx = e.cx / k, cy = e.cy / k, ra = (e.a * 1.05) / k, rb = (e.b * 1.05) / k;
    const c = Math.cos(e.phi), s = Math.sin(e.phi), half_ = Math.ceil(ra), pts = [];
    // stride > 1: every stride-th pixel at the finest level (the result is only a starting guess for the rim fit).
    const st = l === 0 ? stride : 1;
    for (let j = -half_; j <= half_; j += st) for (let i = -half_; i <= half_; i += st) {
      const u = i * c + j * s, v = -i * s + j * c;
      if ((u * u) / (ra * ra) + (v * v) / (rb * rb) > 1) continue;
      const x = cx + i, y = cy + j, Ix = (sample(A, x + 1, y) - sample(A, x - 1, y)) / 2, Iy = (sample(A, x, y + 1) - sample(A, x, y - 1)) / 2, I0 = sample(A, x, y);
      if (Number.isFinite(Ix) && Number.isFinite(Iy) && Number.isFinite(I0)) pts.push([x, y, Ix, Iy, I0]);
    }
    let g11 = 0, g12 = 0, g22 = 0;
    for (const p of pts) { g11 += p[2] * p[2]; g12 += p[2] * p[3]; g22 += p[3] * p[3]; }
    const det = g11 * g22 - g12 * g12, tr = g11 + g22, minEig = tr / 2 - Math.sqrt((tr * tr) / 4 - det);
    if (!(pts.length > 20 && minEig > 1e-3 * pts.length)) { ok = false; break; }
    for (let it = 0; it < iters; it++) {
      let b1 = 0, b2 = 0;
      for (const p of pts) { const It = sample(B, p[0] + dx, p[1] + dy) - p[4]; if (Number.isFinite(It)) { b1 += It * p[2]; b2 += It * p[3]; } }
      const ddx = -(g22 * b1 - g12 * b2) / det, ddy = -(-g12 * b1 + g11 * b2) / det;
      dx += ddx; dy += ddy;
      if (Math.hypot(ddx, ddy) < 0.01) break;
    }
    if (l > 0) { dx *= 2; dy *= 2; }
  }
  return { dx, dy, ok };
}

/** Strongest edge of the given polarity on one ray, to a fraction of a pixel. */
export function rayEdge(img, cx, cy, ux, uy, r1, r2, polarity, step = 0.5) {
  const n = Math.max(3, Math.ceil((r2 - r1) / step) + 1), v = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = dirDeriv(img, cx + ux * (r1 + i * step), cy + uy * (r1 + i * step), ux, uy); v[i] = Number.isFinite(g) ? polarity * g : 0; }
  let bi = -1, bv = 0;
  for (let i = 1; i < n - 1; i++) if (v[i] > bv) { bv = v[i]; bi = i; }
  if (bi < 0) return null;
  const den = v[bi - 1] - 2 * v[bi] + v[bi + 1], off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (v[bi - 1] - v[bi + 1])) / den)) : 0;
  return { r: r1 + (bi + off) * step, strength: bv };
}

/**
 * Where is a plate of known shape now? Every ray looks for the rim near
 * where it should be; the centre shift that best explains those edges is
 * solved by least squares, and rays that disagree (a shelf, a hand, a rack
 * upright touching the rim) are dropped as outliers rather than bending the
 * shape. Returns { ok, cx, cy, inlier }.
 */
export function fitCenter(img, shape, center, { range = [0.85, 1.15], polarity = 1, minInlier = 0.5 } = {}) {
  const c = Math.cos(shape.phi), s = Math.sin(shape.phi), rows = [];
  for (let k = 0; k < RAYS; k++) {
    const al = (2 * Math.PI * k) / RAYS, ux = Math.cos(al), uy = Math.sin(al), re = radiusAt(shape, al);
    const hit = rayEdge(img, center.x, center.y, ux, uy, range[0] * re, range[1] * re, polarity);
    if (!hit) continue;
    // Outward normal of the ellipse where this ray meets it; g = how the hit
    // radius changes per pixel of centre shift.
    const px = re * ux, py = re * uy, u = px * c + py * s, w = -px * s + py * c;
    const nu = u / (shape.a * shape.a), nw = w / (shape.b * shape.b);
    let nx = nu * c - nw * s, ny = nu * s + nw * c;
    const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const nd = nx * ux + ny * uy;
    if (nd < 0.2) continue;
    rows.push({ d: hit.r - re, gx: nx / nd, gy: ny / nd, str: hit.strength });
  }
  if (rows.length < 12) return { ok: false };
  const med = median(rows.map((r) => r.str));
  let use = rows.filter((r) => r.str >= 0.3 * med), dx = 0, dy = 0;
  for (let it = 0; it < 3; it++) {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const r of use) { a11 += r.gx * r.gx; a12 += r.gx * r.gy; a22 += r.gy * r.gy; b1 += r.gx * r.d; b2 += r.gy * r.d; }
    const det = a11 * a22 - a12 * a12;
    if (!(det > 1e-9)) return { ok: false };
    dx = (a22 * b1 - a12 * b2) / det; dy = (-a12 * b1 + a11 * b2) / det;
    const res = use.map((r) => Math.abs(r.d - r.gx * dx - r.gy * dy)), m = median(res);
    const keep = use.filter((_, i) => res[i] <= Math.max(1, 2.5 * m));
    if (keep.length === use.length || keep.length < 12) break;
    use = keep;
  }
  const tol = Math.max(1.2, 0.02 * shape.a);
  const inl = rows.filter((r) => Math.abs(r.d - r.gx * dx - r.gy * dy) <= tol).length / RAYS;
  return { ok: inl >= minInlier, cx: center.x + dx, cy: center.y + dy, inlier: inl };
}

/**
 * Follows one plate through a set.
 *   const tr = createPlateTracker(); tr.init(img, ellipse, t); tr.track(img, t) → result
 * Each frame: optical flow predicts where the plate went, then the rim fixes
 * its centre (shape held, see fitCenter). The shape itself — which gives
 * the scale and the viewing angle — is only taken from frames where the
 * whole rim fits cleanly, and kept as a running median.
 * Result: { ok, cx, cy, a, b, phi, shape (clean full fit or null), inlier }.
 * ok = false: the rim isn't where it should be (hidden, out of frame, or
 * something else looked like it). That frame is lost, never guessed.
 */
export function createPlateTracker({ jumpTol = 0.35 } = {}) {
  let prev = null, e = null, v = { x: 0, y: 0 }, lastT = 0, shapes = [], polarity = 1;
  const shape = () => {
    if (!shapes.length) return e;
    const a = median(shapes.map((x) => x.a)), ratio = median(shapes.map((x) => x.b / x.a));
    let sx = 0, sy = 0;
    for (const x of shapes) { sx += Math.cos(2 * x.phi); sy += Math.sin(2 * x.phi); }
    return { a, b: a * ratio, phi: sx || sy ? Math.atan2(sy, sx) / 2 : e.phi };
  };
  return {
    init(img, ellipse, t) {
      e = { cx: ellipse.cx, cy: ellipse.cy, a: ellipse.a, b: ellipse.b, phi: ellipse.phi };
      polarity = ellipse.polarity || 1; prev = img; lastT = t; v = { x: 0, y: 0 }; shapes = [];
      return { ok: true, ...e, shape: null };
    },
    track(img, t) {
      if (!e) return { ok: false };
      const dt = Math.max(1e-3, t - lastT), guess = { dx: v.x * dt, dy: v.y * dt };
      const flow = lkTranslate(prev, img, e, guess);
      const pred = flow.ok ? { x: e.cx + flow.dx, y: e.cy + flow.dy } : { x: e.cx + guess.dx, y: e.cy + guess.dy };
      const sh = { ...shape(), cx: pred.x, cy: pred.y };
      let c = fitCenter(img, sh, pred, { polarity });
      if (c.ok) c = fitCenter(img, { ...sh, cx: c.cx, cy: c.cy }, { x: c.cx, y: c.cy }, { range: [0.9, 1.1], polarity });
      if (!c.ok || Math.hypot(c.cx - pred.x, c.cy - pred.y) > jumpTol * sh.a) return { ok: false, cx: pred.x, cy: pred.y, flow: flow.ok };
      // The full rim, for the shape: kept only when it fits cleanly.
      const full = refineEllipse(img, { ...sh, cx: c.cx, cy: c.cy }, { range: [0.9, 1.1], polarity });
      const clean = full.ok && full.inlier >= 0.8 && Math.abs(full.a - sh.a) / sh.a < 0.06 && Math.hypot(full.cx - c.cx, full.cy - c.cy) < 1;
      if (clean) { shapes.push({ a: full.a, b: full.b, phi: full.phi }); if (shapes.length > 61) shapes.shift(); }
      v = { x: 0.5 * v.x + (0.5 * (c.cx - e.cx)) / dt, y: 0.5 * v.y + (0.5 * (c.cy - e.cy)) / dt };
      const cur = shape();
      e = { cx: c.cx, cy: c.cy, a: cur.a, b: cur.b, phi: cur.phi };
      prev = img; lastT = t;
      return { ok: true, ...e, shape: clean ? { a: full.a, b: full.b, phi: full.phi } : null, inlier: c.inlier, flow: flow.ok };
    },
    get ellipse() { return e ? { ...e } : null; },
  };
}
