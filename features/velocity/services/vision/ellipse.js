// Ellipses: a weight plate (or dumbbell head) is a circle that the camera
// sees as an ellipse when it isn't exactly side-on.
// Ellipse = { cx, cy, a, b, phi }: centre, semi-major a ≥ semi-minor b (px),
// phi = direction of the major axis (radians, 0 = image x axis, y down).

/** Real roots of a·x³ + b·x² + c·x + d = 0. */
function cubicRoots(a, b, c, d) {
  const B = b / a, C = c / a, D = d / a;
  const q = (3 * C - B * B) / 9, r = (9 * B * C - 27 * D - 2 * B * B * B) / 54, disc = q * q * q + r * r;
  if (disc > 0) {
    const s = Math.cbrt(r + Math.sqrt(disc)), t = Math.cbrt(r - Math.sqrt(disc));
    return [-B / 3 + s + t];
  }
  const th = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(-q * q * q || 1e-300)))), m = 2 * Math.sqrt(-q);
  return [m * Math.cos(th / 3) - B / 3, m * Math.cos((th + 2 * Math.PI) / 3) - B / 3, m * Math.cos((th + 4 * Math.PI) / 3) - B / 3];
}

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const mul3 = (x, y) => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += x[r * 3 + k] * y[k * 3 + c]; return o; };
const tr3 = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Conic A x² + B xy + C y² + D x + E y + F = 0 → ellipse, or null. */
export function conicToEllipse([A, B, C, D, E, F]) {
  const den = B * B - 4 * A * C;
  if (!(den < 0)) return null;
  const cx = (2 * C * D - B * E) / den, cy = (2 * A * E - B * D) / den;
  const Fc = F + (D * cx + E * cy) / 2; // conic value at the centre
  const m = (A + C) / 2, dd = Math.sqrt(((A - C) / 2) ** 2 + (B / 2) ** 2);
  const l1 = m - dd, l2 = m + dd; // eigenvalues of [[A, B/2], [B/2, C]]
  const a2 = -Fc / l1, b2 = -Fc / l2;
  if (!(a2 > 0 && b2 > 0)) {
    // Same ellipse with the conic's sign flipped.
    if (-Fc / l1 < 0 && -Fc / l2 < 0) return conicToEllipse([-A, -B, -C, -D, -E, -F]);
    return null;
  }
  let vx, vy; // eigenvector of l1 (the major axis)
  if (Math.abs(B) > 1e-12) { vx = l1 - C; vy = B / 2; } else if (A <= C) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
  let phi = Math.atan2(vy, vx);
  if (phi < 0) phi += Math.PI;
  if (phi >= Math.PI) phi -= Math.PI;
  let a = Math.sqrt(a2), b = Math.sqrt(b2);
  if (b > a) { [a, b] = [b, a]; phi = (phi + Math.PI / 2) % Math.PI; }
  return { cx, cy, a, b, phi };
}

/**
 * Direct least-squares ellipse fit (Fitzgibbon et al. 1999, in the
 * numerically stable form of Halíř & Flusser 1998). points: [{ x, y }], ≥ 6.
 */
export function fitEllipse(points) {
  const n = points.length;
  if (n < 6) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let s = 0;
  for (const p of points) s += (p.x - mx) ** 2 + (p.y - my) ** 2;
  s = Math.sqrt(s / n / 2) || 1;
  const S1 = new Array(9).fill(0), S2 = new Array(9).fill(0), S3 = new Array(9).fill(0);
  for (const p of points) {
    const x = (p.x - mx) / s, y = (p.y - my) / s, d1 = [x * x, x * y, y * y], d2 = [x, y, 1];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { S1[r * 3 + c] += d1[r] * d1[c]; S2[r * 3 + c] += d1[r] * d2[c]; S3[r * 3 + c] += d2[r] * d2[c]; }
  }
  const S3i = inv3(S3);
  if (!S3i) return null;
  const T = mul3(S3i, tr3(S2)).map((v) => -v);
  const S2T = mul3(S2, T), M0 = S1.map((v, i) => v + S2T[i]);
  // Premultiply by the inverse constraint matrix.
  const M = [M0[6] / 2, M0[7] / 2, M0[8] / 2, -M0[3], -M0[4], -M0[5], M0[0] / 2, M0[1] / 2, M0[2] / 2];
  const trM = M[0] + M[4] + M[8];
  const minors = M[0] * M[4] - M[1] * M[3] + M[0] * M[8] - M[2] * M[6] + M[4] * M[8] - M[5] * M[7];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  let best = null;
  for (const lam of cubicRoots(1, -trM, minors, -det)) {
    const r0 = [M[0] - lam, M[1], M[2]], r1 = [M[3], M[4] - lam, M[5]], r2 = [M[6], M[7], M[8] - lam];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cands = [cross(r0, r1), cross(r0, r2), cross(r1, r2)];
    const v = cands.reduce((m, c) => (Math.hypot(...c) > Math.hypot(...m) ? c : m));
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) { best = v; break; }
  }
  if (!best) return null;
  const a2 = [0, 1, 2].map((r) => T[r * 3] * best[0] + T[r * 3 + 1] * best[1] + T[r * 3 + 2] * best[2]);
  const e = conicToEllipse([...best, ...a2]);
  if (!e) return null;
  return { cx: e.cx * s + mx, cy: e.cy * s + my, a: e.a * s, b: e.b * s, phi: e.phi };
}

/** Distance from the centre to the ellipse along direction alpha. */
export function radiusAt(e, alpha) {
  const c = Math.cos(alpha - e.phi), s = Math.sin(alpha - e.phi);
  return 1 / Math.sqrt((c * c) / (e.a * e.a) + (s * s) / (e.b * e.b));
}

/** Approximate distance (px) of a point from the ellipse, measured along the ray from its centre. */
export function ellipseDistance(e, p) {
  const dx = p.x - e.cx, dy = p.y - e.cy, c = Math.cos(e.phi), s = Math.sin(e.phi);
  const u = dx * c + dy * s, w = -dx * s + dy * c, rho = Math.sqrt((u * u) / (e.a * e.a) + (w * w) / (e.b * e.b));
  return rho ? Math.hypot(dx, dy) * (1 - 1 / rho) : -Math.min(e.a, e.b);
}

/** Fit, drop points far from the fit, refit: robust to a few wrong edge points (a hand, a collar, the rack). */
export function robustEllipse(points, { rounds = 2 } = {}) {
  let pts = points, e = fitEllipse(pts);
  for (let k = 0; k < rounds && e; k++) {
    const res = pts.map((p) => Math.abs(ellipseDistance(e, p)));
    const med = res.slice().sort((x, y) => x - y)[res.length >> 1];
    const keep = pts.filter((_, i) => res[i] <= Math.max(1, 2.5 * med));
    if (keep.length < 6 || keep.length === pts.length) break;
    pts = keep; e = fitEllipse(pts) || e;
  }
  return e;
}
