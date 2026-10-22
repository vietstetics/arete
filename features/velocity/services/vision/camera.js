// The camera as a measuring instrument: a pinhole model (OpenCV axes —
// x right, y down, z forward out of the lens), small 3×3 matrix helpers,
// and the phone's sense of gravity turned into the camera's "up".
//
// Plain JavaScript, no dependencies, so it runs on every phone and in tests.

const D2R = Math.PI / 180;

// ── 3-vectors and 3×3 matrices (row-major arrays of 9) ─────────────────────
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = norm(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const matVec = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export function matMul(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300)) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi rotations:
 * slow in theory, exact to rounding in practice for 3×3).
 * Returns { values: [λ0, λ1, λ2], vectors: [v0, v1, v2] } (unit vectors), unsorted.
 */
export function eigSym3(m) {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    const scale_ = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]);
    if (off <= 1e-15 * (scale_ || 1)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { // A ← Jᵀ A J
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) { // V ← V J
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]]) };
}

/** Rotation matrix about a unit axis by angle (radians), row-major. */
export function rotation(axis, ang) {
  const [x, y, z] = unit(axis), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

// ── Intrinsics ─────────────────────────────────────────────────────────────

/**
 * Pinhole intrinsics for a w×h image from its horizontal field of view.
 * Square pixels, principal point at the image centre (phones are within a
 * few pixels of that).
 */
export function intrinsicsFromFov(w, h, hfovDeg) {
  const f = (w / 2) / Math.tan((hfovDeg * D2R) / 2);
  return { fx: f, fy: f, cx: (w - 1) / 2, cy: (h - 1) / 2, w, h };
}

/** The same camera at another resolution (a downscaled copy of the frame, say). */
export function scaleIntrinsics(K, w, h) {
  const sx = w / K.w, sy = h / K.h;
  return { fx: K.fx * sx, fy: K.fy * sy, cx: (K.cx + 0.5) * sx - 0.5, cy: (K.cy + 0.5) * sy - 0.5, w, h };
}

/** K as a row-major 3×3 matrix. */
export const Kmat = (K) => [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1];

/** Camera-frame point (metres) → pixel. */
export const project = (K, X) => ({ x: K.cx + (K.fx * X[0]) / X[2], y: K.cy + (K.fy * X[1]) / X[2] });

/** Pixel → unit-depth ray [x, y, 1] in the camera frame. */
export const ray = (K, u, v) => [(u - K.cx) / K.fx, (v - K.cy) / K.fy, 1];

// ── Lens distortion (Brown–Conrady radial, k1 k2) ──────────────────────────
// Phone main cameras correct most of their distortion in the image
// processor; this exists so the error from what's left can be simulated
// and, where a calibration is known, removed.

/** Ideal pixel → distorted pixel. */
export function distort(K, { k1 = 0, k2 = 0 } = {}, p) {
  const x = (p.x - K.cx) / K.fx, y = (p.y - K.cy) / K.fy, r2 = x * x + y * y, s = 1 + k1 * r2 + k2 * r2 * r2;
  return { x: K.cx + K.fx * x * s, y: K.cy + K.fy * y * s };
}

/** Distorted pixel → ideal pixel (fixed-point iteration; exact to ~1e-6 px for phone-sized distortion). */
export function undistort(K, { k1 = 0, k2 = 0 } = {}, p) {
  if (!k1 && !k2) return { x: p.x, y: p.y };
  const xd = (p.x - K.cx) / K.fx, yd = (p.y - K.cy) / K.fy;
  let x = xd, y = yd;
  for (let i = 0; i < 20; i++) { const r2 = x * x + y * y, s = 1 + k1 * r2 + k2 * r2 * r2; x = xd / s; y = yd / s; }
  return { x: K.cx + K.fx * x, y: K.cy + K.fy * y };
}

// ── Camera placement (for simulation and for reasoning about a setup) ─────
// World frame: Y up (gravity is −Y), the bar along X, so a plate faces ±X.

/**
 * Where a phone is and how it's turned, relative to the bar end it films.
 *   target: world point the setup is built around (the plate's mean centre)
 *   distance: horizontal distance from the target (m)
 *   yawDeg: how far round the bar the phone is, 0 = exactly side-on (looking along −X at the plate face)
 *   heightOffset: phone height minus target height (m); + = phone above the bar
 *   pitchDeg: tilt of the phone, + = lens tilted up; aimDeg adds the tilt
 *     that would point the lens straight at the target from that height
 *   rollDeg: rotation of the phone about the lens axis, + = clockwise as seen from behind the phone
 *     (the picture then turns anticlockwise)
 *   panDeg: extra sideways turn of the lens away from the target
 * Returns { R (world → camera, row-major), C (world position) }.
 */
export function placeCamera({ target = [0, 0, 0], distance = 2.5, yawDeg = 0, heightOffset = 0, pitchDeg = 0, aim = false, rollDeg = 0, panDeg = 0 } = {}) {
  const yaw = yawDeg * D2R, dirOut = [Math.cos(yaw), 0, Math.sin(yaw)]; // from the target out to the phone, horizontally
  const C = [target[0] + distance * dirOut[0], target[1] + heightOffset, target[2] + distance * dirOut[2]];
  let f = scale(dirOut, -1); // look back at the target, level
  f = matVec(rotation([0, 1, 0], panDeg * D2R), f);
  const right0 = unit(cross(f, [0, 1, 0])); // level camera's right (y-down camera: x = y × z)
  const tilt = (pitchDeg + (aim ? (Math.atan2(-heightOffset, distance) / D2R) : 0)) * D2R;
  f = matVec(rotation(right0, tilt), f); // about the right axis: positive tilt lifts the lens
  let down = unit(cross(f, right0));
  // Roll about the lens axis.
  const Rr = rotation(f, rollDeg * D2R);
  const x = matVec(Rr, right0), y = matVec(Rr, down);
  down = y;
  return { R: [...x, ...down, ...f], C };
}

/** World point → camera frame. */
export const toCamera = (pose, Xw) => matVec(pose.R, sub(Xw, pose.C));
/** World direction → camera frame. */
export const dirToCamera = (pose, d) => matVec(pose.R, d);

// ── Gravity from the phone's motion sensors ───────────────────────────────

/**
 * The camera's "up" (unit vector, camera frame) from the phone's
 * accelerometer reading at rest.
 *   accel: DeviceMotionEvent.accelerationIncludingGravity {x, y, z} in the
 *     W3C device frame (x right, y up the screen, z out of the screen, for
 *     the device's natural orientation). At rest it reads +9.81 along "up"
 *     (it measures the push that holds the phone up). signFlip: true for
 *     platforms that report the opposite sign.
 *   screenAngle: screen.orientation.angle (0, 90, 180, 270): the video
 *     frames are upright for the current screen orientation, so the device
 *     frame is turned to match.
 *   facing: 'environment' (rear camera) or 'user' (front camera; the video
 *     is mirrored on screen but the frames themselves are not).
 *   autoSign: platforms have disagreed on the sign of this reading. Nobody
 *     films a lift with the phone upside down relative to its screen, so if
 *     the reading says "up" points down the screen, it's the other
 *     convention and is flipped. (Only for a phone held roughly upright:
 *     |up the screen| > 0.5 g.)
 */
export function upFromAccel(accel, { screenAngle = 0, facing = 'environment', signFlip = false, autoSign = false } = {}) {
  let { x, y, z } = accel;
  if (signFlip) { x = -x; y = -y; z = -z; }
  // Screen coordinates: rotate the device x–y axes by the screen angle.
  const a = (screenAngle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let sx = x * c - y * s, sy = x * s + y * c;
  // autoSign: a phone filming upright has the screen's up pointing up, so a reading that says otherwise by
  // more than half of g has the opposite sign convention. Tilted further (the lens more than ~60° down, or
  // turned sideways with the rotation locked) the reading can't tell, and signFlip (the platform) decides.
  if (autoSign && sy < -0.5 * Math.hypot(x, y, z)) { sx = -sx; sy = -sy; z = -z; }
  // Screen frame (x right, y up, z towards the viewer) → camera frame (x right, y down, z forward).
  // Rear camera: forward = into the screen (−z). Front camera: forward = out of the screen (+z), and its
  // image x runs the other way when unmirrored.
  const v = facing === 'user' ? [-sx, -sy, z] : [sx, -sy, -z];
  return unit(v);
}

/** Tilt of a camera from its up vector, degrees: pitch (+ = lens tilted up) and roll (as in placeCamera). */
export function tiltFromUp(up) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, up[2]))) / D2R; // lens tilted up ⇒ "up" leans into the view (+z)
  const roll = Math.atan2(-up[0], -up[1]) / D2R;
  return { pitchDeg: pitch, rollDeg: roll };
}
