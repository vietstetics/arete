// A weight plate is a circle of known size. Seen through a camera of known
// focal length, the ellipse it makes in the picture fixes where that
// circle is in 3D — its centre in metres and which way it faces — no
// matter how the phone is turned, tilted, how far away or how high it is.
//
//   ellipse → cone. Every rim point lies on the cone from the lens through
//   the ellipse:  Xᵀ Q X = 0,  Q = Kᵀ C K  (C: the ellipse as a conic in
//   pixels, K: the camera's intrinsics).
//
//   cone → circle. In the cone's eigenframe (Q = V diag(λ1, λ2, λ3) Vᵀ,
//   λ1 ≥ λ2 > 0 > λ3) the planes that cut it in a circle have normals
//     n = ( ±√((λ1−λ2)/(λ1−λ3)), 0, √((λ2−λ3)/(λ1−λ3)) )
//   and for a circle of radius r the plane is at distance
//     d = r λ2 / √(−λ1 λ3)
//   from the lens, with the circle's centre at
//     c = d ( ±λ3/λ2 · √((λ1−λ2)/(λ1−λ3)), 0, λ1/λ2 · √((λ2−λ3)/(λ1−λ3)) )
//   (same sign choice as n). Derivation: on the cone,
//   λ2|X|² = (√(λ2−λ3) z)² − (√(λ1−λ2) x)², a product of two plane
//   equations, so on either plane |X|² is linear in X: a sphere through the
//   lens, cut by the plane in a circle. Two answers (±) remain; gravity
//   picks between them (a plate on a bar faces sideways, so its normal is
//   horizontal), and in the side-on view they agree anyway.
//
//   circle → picture. The plate plane maps to the picture by the
//   homography H = K [u v c] (u, v span the plate), so the circle
//   x² + y² = r² appears as the conic C = H⁻ᵀ diag(1, 1, −r²) H⁻¹.
//
// The ellipse's centre is NOT where the plate's centre appears (perspective
// shifts it towards the edge of the picture); the true centre is
// K c / c_z, from the solution above.

import { Kmat, transpose, matMul, matVec, inv3, eigSym3, dot, cross, unit, norm, scale, add, sub, project } from './camera.js';
import { conicToEllipse } from './ellipse.js';

/** Ellipse { cx, cy, a, b, phi } (px) → symmetric conic matrix (row-major 3×3), scaled to unit norm. */
export function ellipseToConic({ cx, cy, a, b, phi }) {
  const s = Math.sin(phi), c = Math.cos(phi), a2 = a * a, b2 = b * b;
  const A = a2 * s * s + b2 * c * c, B = 2 * (b2 - a2) * s * c, C = a2 * c * c + b2 * s * s;
  const D = -2 * A * cx - B * cy, E = -B * cx - 2 * C * cy, F = A * cx * cx + B * cx * cy + C * cy * cy - a2 * b2;
  const m = [A, B / 2, D / 2, B / 2, C, E / 2, D / 2, E / 2, F];
  const l = Math.hypot(...m);
  return m.map((v) => v / l);
}

/** Conic matrix → ellipse { cx, cy, a, b, phi }, or null if it isn't a real ellipse. */
export function conicMatToEllipse(m) {
  return conicToEllipse([m[0], 2 * m[1], m[4], 2 * m[2], 2 * m[5], m[8]]);
}

/** The cone (camera frame) through an image conic: Q = Kᵀ C K, normalised. */
export function coneFromConic(C, K) {
  const k = Kmat(K), Q = matMul(transpose(k), matMul(C, k));
  const l = Math.hypot(...Q);
  return Q.map((v) => v / l);
}

/**
 * Both 3D circles of radius r that the cone Q can come from, in the camera
 * frame (metres): [{ c: centre, n: unit normal facing the camera }], or [] if
 * Q isn't an elliptic cone. The two coincide when the plate is seen head-on.
 */
export function circlePoses(Q, r) {
  const { values, vectors } = eigSym3(Q);
  // Two eigenvalues of one sign, one of the other; make the pair positive.
  const pos = values.filter((v) => v > 0).length;
  let lam = values.slice(), vec = vectors;
  if (pos === 1) lam = lam.map((v) => -v);
  else if (pos !== 2) return [];
  const order = [0, 1, 2].sort((i, j) => lam[j] - lam[i]); // λ1 ≥ λ2 > 0 > λ3
  const [l1, l2, l3] = order.map((i) => lam[i]);
  const [e1, e2, e3] = order.map((i) => vec[i]);
  if (!(l2 > 0 && l3 < 0)) return [];
  const al = Math.sqrt(Math.max(0, (l1 - l2) / (l1 - l3))), be = Math.sqrt(Math.max(0, (l2 - l3) / (l1 - l3)));
  const d = (r * l2) / Math.sqrt(-l1 * l3);
  const toCam = (p) => add(add(scale(e1, p[0]), scale(e2, p[1])), scale(e3, p[2]));
  const out = [];
  for (const sg of al > 1e-9 ? [1, -1] : [1]) {
    let n = toCam([sg * al, 0, be]), c = toCam([sg * d * (l3 / l2) * al, 0, d * (l1 / l2) * be]);
    if (c[2] < 0) c = scale(c, -1);        // the plate is in front of the lens
    if (dot(n, c) > 0) n = scale(n, -1);   // its normal faces the lens
    out.push({ c, n: unit(n) });
  }
  return out;
}

/** Two unit vectors spanning the plane with normal n. */
export function planeBasis(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(n, a)), v = cross(n, u);
  return [u, v];
}

/** The picture of a circle (centre c, normal n, radius r, camera frame) as a conic matrix (unit norm). */
export function circleConic(K, c, n, r) {
  const [u, v] = planeBasis(n), k = Kmat(K);
  const H = matMul(k, [u[0], v[0], c[0], u[1], v[1], c[1], u[2], v[2], c[2]]);
  const Hi = inv3(H);
  if (!Hi) return null;
  const C = matMul(transpose(Hi), matMul([1, 0, 0, 0, 1, 0, 0, 0, -r * r], Hi));
  const l = Math.hypot(...C);
  return C.map((x) => x / l);
}

/** The picture of a circle as an ellipse { cx, cy, a, b, phi } (px), or null. */
export const circleEllipse = (K, c, n, r) => { const C = circleConic(K, c, n, r); return C ? conicMatToEllipse(C) : null; };

/** Where the circle's centre appears in the picture (not the ellipse's centre). */
export const centreImage = (K, c) => project(K, c);

/**
 * Pick the pose whose plate faces sideways: its normal as close to
 * horizontal (perpendicular to up) as possible. up: unit vector, camera frame.
 */
export function pickByGravity(poses, up) {
  if (!poses.length) return null;
  return poses.reduce((best, p) => (Math.abs(dot(p.n, up)) < Math.abs(dot(best.n, up)) ? p : best));
}

/**
 * Signed distance (px) of a picture point from a conic, to first order
 * (Sampson): x̃ᵀ C x̃ / |∇|, positive outside.
 */
export function conicDistance(C, x, y) {
  const v = [x, y, 1], Cv = matVec(C, v), q = dot(v, Cv), g = 2 * Math.hypot(Cv[0], Cv[1]); // ∇q = 2 (Cv)ₓᵧ
  return g > 0 ? q / g : NaN;
}

/**
 * The plate's 3D centre for this frame, with its facing direction n and
 * size r known: the centre c that makes the projected rim pass through the
 * rim edges found in the picture (Gauss–Newton on 3 unknowns, with points
 * that disagree — a hand, a knee, a rack upright — dropped as outliers).
 *   pts: [{ x, y }] rim edge points (px, undistorted)
 *   c0: starting guess (camera frame, m)
 * Returns { ok, c, rms (px), inliers (count), used }.
 */
export function fitCircleCentre(K, n, r, pts, c0, { iters = 8, minPts = 12 } = {}) {
  if (pts.length < minPts) return { ok: false };
  let c = c0.slice(), use = pts, rms = Infinity;
  const resid = (cc, ps) => { const C = circleConic(K, cc, n, r); return C ? ps.map((p) => conicDistance(C, p.x, p.y)) : null; };
  for (let round = 0; round < 3; round++) {
    for (let it = 0; it < iters; it++) {
      const r0 = resid(c, use);
      if (!r0) return { ok: false };
      // Jacobian by central differences, step relative to depth.
      const h = Math.max(1e-6, 1e-5 * norm(c)), J = [];
      for (let k = 0; k < 3; k++) {
        const cp = c.slice(), cm = c.slice(); cp[k] += h; cm[k] -= h;
        const rp = resid(cp, use), rm = resid(cm, use);
        if (!rp || !rm) return { ok: false };
        J.push(rp.map((v, i) => (v - rm[i]) / (2 * h)));
      }
      // Normal equations (3×3).
      const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], g = [0, 0, 0];
      for (let i = 0; i < use.length; i++) {
        for (let a = 0; a < 3; a++) { g[a] += J[a][i] * r0[i]; for (let b = 0; b < 3; b++) A[a * 3 + b] += J[a][i] * J[b][i]; }
      }
      // A touch of damping keeps steps sane when the rim is only partly seen.
      for (let a = 0; a < 3; a++) A[a * 4] *= 1 + 1e-6;
      const Ai = inv3(A);
      if (!Ai) return { ok: false };
      const step = matVec(Ai, g).map((v) => -v);
      c = add(c, step);
      if (c[2] <= 0) return { ok: false };
      if (norm(step) < 1e-7 * norm(c)) break;
    }
    const r1 = resid(c, pts);
    if (!r1) return { ok: false };
    const abs = r1.map(Math.abs), med = abs.slice().sort((a, b) => a - b)[abs.length >> 1];
    const tol = Math.max(1, 3 * 1.4826 * med);
    const keep = pts.filter((_, i) => abs[i] <= tol);
    rms = Math.sqrt(r1.filter((_, i) => abs[i] <= tol).reduce((s, v) => s + v * v, 0) / Math.max(1, keep.length));
    if (keep.length === use.length || keep.length < minPts) { use = keep.length >= minPts ? keep : use; break; }
    use = keep;
  }
  return { ok: use.length >= minPts, c, rms, inliers: use.length, used: use };
}

/** A starting guess for the 3D centre from where the plate appears and how big: depth ≈ f r / a. */
export function guessCentre(K, ellipse, r) {
  const z = (K.fx * r) / ellipse.a;
  return [((ellipse.cx - K.cx) / K.fx) * z, ((ellipse.cy - K.cy) / K.fy) * z, z];
}

export { sub, norm };
