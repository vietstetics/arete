// Drop test: checks the camera's clock and Arete's speed maths against gravity, with no speed device.
//
// A ball dropped from rest falls a measured height h in exactly √(2h/g). The ball is followed by its
// colour (vision/marker.js) in a phone video; a parabola through its fall gives the moment it was let go
// and its acceleration in pixels; the moment it reached the floor is where that parabola meets the lowest
// point the ball was seen. The fall time then needs no scale at all (√(pixels fallen ÷ pixel
// acceleration)), so it tests the video's frame timestamps — the phone's clock, dropped frames, rolling
// shutter — independently of where the camera stands. With the ball's diameter, the distance it fell in
// metres is measured from the ball's size too: the way the coloured-marker tracker scales a bar.
//
// Speeds compared are the mean speed over the drop (h ÷ fall time) and the speed at the floor, against
// physics. Air resistance is ignored: under 0.5% on the fall time for a tennis ball from 1.5 m, far less
// for a dense ball (lacrosse, golf). Local gravity varies by under 0.3% across the Earth.

export const G = 9.81;
/** Speed error that counts as a pass (transducer-grade is about ±0.03 m/s; at drop speeds that's ~1–2%). */
export const PASS_PCT = 2;
export const CLOSE_PCT = 5;

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** Least-squares y = a + b·x + c·x². Returns { a, b, c, rms } or null. */
export function fitParabola(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], x2 = x * x;
    s0++; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2; t0 += y; t1 += x * y; t2 += x2 * y;
  }
  // Solve [[s0 s1 s2][s1 s2 s3][s2 s3 s4]]·[a b c] = [t0 t1 t2] by Cramer's rule.
  const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const M = [s0, s1, s2, s1, s2, s3, s2, s3, s4], D = det(M);
  if (!Number.isFinite(D) || Math.abs(D) < 1e-12) return null;
  const a = det([t0, s1, s2, t1, s2, s3, t2, s3, s4]) / D;
  const b = det([s0, t0, s2, s1, t1, s3, s2, t2, s4]) / D;
  const c = det([s0, s1, t0, s1, s2, t1, s2, s3, t2]) / D;
  let e = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (a + b * xs[i] + c * xs[i] * xs[i]); e += r * r; }
  return { a, b, c, rms: Math.sqrt(e / n) };
}

/**
 * Analyse one drop.
 *   samples: [{ t, ok, cx, cy, r }] — the ball's centre and radius in full-frame pixels (y down), time in s
 *   heightM: the drop height, floor to the bottom of the ball while held (metres)
 *   ballDiameterM: optional, for the size-based distance check
 * Returns { ok, refused?, ...measurements, verdict, warnings }.
 */
export function analyseDrop(samples, { heightM, ballDiameterM = null, g = G } = {}) {
  const refuse = (why) => ({ ok: false, refused: why });
  if (!(heightM > 0.2 && heightM < 5)) return refuse('Enter the drop height (between 20 cm and 5 m)');
  const pts = (samples || []).filter((s) => s && s.ok && Number.isFinite(s.t) && Number.isFinite(s.cx) && Number.isFinite(s.cy))
    .sort((p, q) => p.t - q.t);
  if (pts.length < 8) return refuse('The ball was hardly seen. Tap the ball on a frame where it’s held still, and keep it in the picture');
  const rMed = median(pts.map((p) => p.r).filter((r) => r > 0)) || 5;

  // The floor: the lowest point of the first descent, before the ball rises again (a bounce or a catch).
  const rest = median(pts.slice(0, 4).map((p) => p.cy));
  let iC = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].cy > pts[iC].cy) iC = i;
    else if (pts[iC].cy - rest > 4 * rMed && pts[iC].cy - pts[i].cy > Math.max(3 * rMed, 8)) break;
  }
  // A ball lying still on the floor jitters by a pixel or two: the floor is reached at the first frame that low.
  const floorY = pts[iC].cy, tol = Math.max(2, 0.3 * rMed);
  while (iC > 0 && pts[iC - 1].cy >= floorY - tol) iC--;
  const drop = pts[iC].cy - rest;
  if (!(drop > 4 * rMed)) return refuse('The ball didn’t fall far in the picture. Film the whole drop, from your hand to the floor');

  // The fall: from the first frame it's clearly moving to the frame before it reached the floor.
  let iS = 0;
  while (iS < iC && pts[iS].cy - rest < 0.03 * drop) iS++;
  iS = Math.max(0, iS - 1);
  const seg = pts.slice(iS, iC);
  if (seg.length < 6) return refuse('Too few frames in the fall. Film at 60 fps and drop from at least 1 m');

  // Measure along the direction the ball fell (a phone that isn't quite level only turns that direction).
  const p0 = pts[iS], pC = pts[iC];
  let ux = pC.cx - p0.cx, uy = pC.cy - p0.cy;
  const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
  const along = (p) => (p.cx - p0.cx) * ux + (p.cy - p0.cy) * uy;
  const tm = seg.reduce((s, p) => s + p.t, 0) / seg.length;
  const fit = fitParabola(seg.map((p) => p.t - tm), seg.map(along));
  if (!fit || !(fit.c > 0)) return refuse('The ball’s path doesn’t look like a fall. Let go without throwing, and film side-on');

  const tau0 = -fit.b / (2 * fit.c), s0 = fit.a - (fit.b * fit.b) / (4 * fit.c);
  const t0 = tm + tau0;                                  // the moment it was let go

  // Where it reached the floor. Between two frames near the floor the ball moves several centimetres, so the
  // lowest frame seen is not good enough. Best: the bounce — the way up is the same parabola mirrored, so
  // fit it with the same curvature and take where the two curves meet. Next: the ball resting on the
  // floor afterwards (its centre is where it was at contact). Last resort: the lowest frame seen.
  let sFloor = NaN, floorFrom = 'lowest';
  const up = [];
  for (let i = iC + 1; i < pts.length; i++) { if (up.length && along(pts[i]) > along(pts[i - 1]) + 0.5) break; up.push(pts[i]); }
  if (up.length >= 3) {
    // s = a' + b'·τ + c·τ² with c fixed: least squares on s − c·τ².
    const xs = up.map((p) => p.t - tm), ys = up.map((p, k) => along(p) - fit.c * xs[k] * xs[k]);
    const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
    const bu = sxx > 0 ? sxy / sxx : NaN, au = my - bu * mx;
    const tauC = (fit.b - bu) !== 0 ? -(fit.a - au) / (fit.b - bu) : NaN;
    const lo = pts[iC - 1].t - tm, hi = up[0].t - tm;
    if (Number.isFinite(tauC) && tauC >= lo - 0.02 && tauC <= hi + 0.02 && bu + 2 * fit.c * tauC < 0) {
      sFloor = fit.a + fit.b * tauC + fit.c * tauC * tauC; floorFrom = 'bounce';
    }
  }
  if (!Number.isFinite(sFloor)) {
    const tail = pts.slice(-6).map(along);
    if (pts.length - iC > 6 && Math.max(...tail) - Math.min(...tail) < Math.max(rMed / 2, 2) && median(tail) >= along(pC) - rMed) {
      sFloor = median(tail); floorFrom = 'resting';
    } else sFloor = along(pC);
  }
  const fallPx = sFloor - s0;
  if (!(fallPx > 0)) return refuse('Couldn’t find where the ball reached the floor');
  const tFall = Math.sqrt(fallPx / fit.c);               // reaching the floor on the fitted curve
  const tC = t0 + tFall;

  // Physics.
  const tPhys = Math.sqrt((2 * heightM) / g);
  const meanPhys = heightM / tPhys, impactPhys = Math.sqrt(2 * g * heightM);
  const meanMeas = heightM / tFall, impactMeas = (2 * heightM) / tFall;
  const speedErrPct = (meanMeas / meanPhys - 1) * 100;   // the same for the mean and the impact speed
  const gMeas = (2 * heightM) / (tFall * tFall);

  // Distance from the ball's own size (frames in the first third of the fall: least motion blur).
  let size = null;
  if (ballDiameterM > 0) {
    const early = pts.filter((p) => p.t >= t0 && p.t <= t0 + tFall / 3 && p.r > 0).map((p) => p.r);
    const rEarly = early.length >= 2 ? median(early) : rMed;
    const pxPerM = (2 * rEarly) / ballDiameterM;
    const distM = fallPx / pxPerM;
    size = { distanceM: distM, errPct: (distM / heightM - 1) * 100, meanSpeed: distM / tFall, gMeas: (2 * fit.c) / pxPerM };
  }

  const times = pts.map((p) => p.t), gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const fps = gaps.length ? 1 / median(gaps.filter((d) => d > 0)) : NaN;
  const framesInFall = seg.length + 1;
  const noisePct = (fit.rms / fallPx) * 100;

  const warnings = [];
  const ratio = gMeas / g;
  if (ratio < 0.6) warnings.push('The video seems to play slower than real time. Was it filmed in Slo-mo? Use normal Video, or check the drop height');
  else if (ratio > 1.6) warnings.push('The ball fell faster than gravity allows. Check the drop height, or that the video wasn’t sped up');
  if (fps < 50) warnings.push(`Filmed at about ${Math.round(fps)} fps. 60 fps times the drop more precisely`);
  if (framesInFall < 12) warnings.push('Only ' + framesInFall + ' frames in the fall. Drop from higher, or film at 60 fps');
  if (noisePct > 2) warnings.push('The ball’s track was jumpy. Use a plain background in a different colour from the ball');
  if (floorFrom === 'lowest') warnings.push('The bounce wasn’t seen, so the moment it hit the floor is rough. Keep the floor and the first bounce in the picture');
  const lost = samples.filter((s) => s && s.t >= p0.t && s.t <= pC.t && !s.ok).length;
  if (lost > 2) warnings.push(`The ball was lost in ${lost} frames of the fall`);

  const a = Math.abs(speedErrPct);
  const verdict = a <= PASS_PCT ? 'pass' : a <= CLOSE_PCT ? 'close' : 'fail';
  return {
    ok: true, verdict, warnings,
    heightM, ballDiameterM, g,
    tRelease: t0, tFloor: tC, tFall, tPhys, timeErrMs: (tFall - tPhys) * 1000,
    meanMeas, meanPhys, impactMeas, impactPhys, speedErrPct, gMeas,
    size, fps, framesInFall, noisePct, floorFrom,
    fit: { tm, a: fit.a, b: fit.b, c: fit.c, s0, sFloor, ux, uy, x0: p0.cx, y0: p0.cy },
    track: pts.map((p) => ({ t: p.t, s: along(p) })), segment: [iS, iC],
  };
}
