// A simulated lifter for each lift in liftTrackers.js: a side-on skeleton in 3D (world landmarks,
// metres, hips at the origin, y down) and its picture (0–1), posed so the lift's measurement takes a
// given value. Used by the camera page's demo (?demo=1) and the tests, so every lift runs through the
// real pipeline. The geometry is made up (plain segment lengths), never anyone's lifts.

const U = 0.3, FA = 0.27, SH = 0.2, HIPW = 0.13, THIGH = 0.45, SHIN = 0.43, TORSO = 0.52, FOOT = 0.2;
const DEG = Math.PI / 180;

// Lifter faces +x (side-on to a camera looking along z), up is −y, their left is +z.
function base() {
  const P = [];
  P[11] = [0, -TORSO, SH]; P[12] = [0, -TORSO, -SH];
  P[23] = [0, 0, HIPW]; P[24] = [0, 0, -HIPW];
  for (const [h, k, a, heel, toe] of [[23, 25, 27, 29, 31], [24, 26, 28, 30, 32]]) {
    const z = P[h][2];
    P[k] = [0, THIGH, z]; P[a] = [0, THIGH + SHIN, z]; P[heel] = [-0.05, THIGH + SHIN + 0.04, z]; P[toe] = [FOOT - 0.05, THIGH + SHIN + 0.05, z];
  }
  P[0] = [0.08, -TORSO - 0.2, 0];
  for (let i = 1; i <= 10; i++) P[i] = [0.06, -TORSO - 0.22, (i % 2 ? 1 : -1) * 0.04];
  // Arms hanging.
  for (const [s, e, w] of [[11, 13, 15], [12, 14, 16]]) { const z = P[s][2]; P[e] = [0, -TORSO + U, z]; P[w] = [0, -TORSO + U + FA, z]; }
  return P;
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// A direction in the sagittal plane, `deg` degrees forward from straight down (90 = forward, 180 = up).
const sag = (deg) => [Math.sin(deg * DEG), Math.cos(deg * DEG), 0];
function arms(P, f) { for (const [s, e, w] of [[11, 13, 15], [12, 14, 16]]) { const r = f(P[s], P[s][2] > 0 ? 1 : -1); P[e] = r[0]; P[w] = r[1]; } }
function hands(P) { for (const [w, a, b, c] of [[15, 17, 19, 21], [16, 18, 20, 22]]) { P[a] = add(P[w], [0.03, 0.05, 0]); P[b] = add(P[w], [0.05, 0.04, 0]); P[c] = add(P[w], [0.04, 0.01, 0]); } }

/** Elbow angle (deg) from the arm's reach (shoulder→wrist ÷ arm length). */
const elbowFromReach = (r) => { const d = r * (U + FA); return Math.acos(Math.max(-1, Math.min(1, (U * U + FA * FA - d * d) / (2 * U * FA)))) / DEG; };

const POSE = {
  // Value = elbow; upper arm hanging, forearm swinging forward and up.
  curl: (P, v) => arms(P, (S) => { const E = add(S, sc(sag(0), U)); return [E, add(E, sc(sag(180 - v), FA))]; }),
  // Value = 180 − elbow; overhead extension (upper arm up, forearm folding behind the head).
  triceps: (P, v) => arms(P, (S) => { const E = add(S, sc(sag(170), U)); return [E, add(E, sc(sag(170 + v), FA))]; }),
  dip: (P, v) => arms(P, (S) => { const E = add(S, sc(sag(-(v * 0.6)), U)); return [E, add(E, sc(sag(-(v * 0.6) + (v)), FA))]; }),
  // Value = 100 − 100 × reach; upper arm forward, the arm folding as the hands come back.
  press: (P, v) => arms(P, (S) => { const e = elbowFromReach(1 - v / 100), a = 90 - (180 - e) / 2; const E = add(S, sc(sag(a), U)); return [E, add(E, sc(sag(a + (180 - e)), FA))]; }),
  row: (P, v) => arms(P, (S) => { const e = elbowFromReach(v / 100), a = 80 - (180 - e) * 0.6; const E = add(S, sc(sag(a), U)); return [E, add(E, sc(sag(a + (180 - e)), FA))]; }),
  // Value = −100 × hand height above the shoulder (upper arms); upper arm raised out to the side, forearm upright.
  shoulderPress: (P, v) => POSE.pulldown(P, -v),
  pulldown: (P, v) => arms(P, (S, side) => {
    const h = v / 100, c = Math.max(-1, Math.min(1, (FA - h * U) / U)), a = Math.acos(c);
    const E = [S[0], S[1] + U * Math.cos(a), S[2] + side * U * Math.sin(a)];
    return [E, add(E, [0, -FA, 0])];
  }),
  // Value = 100 × distance between the wrists ÷ shoulder width; straight arms at shoulder height sweeping across.
  fly: (P, v) => arms(P, (S, side) => {
    const L = U + FA, s = Math.max(0, Math.min(1, ((v / 100) * 2 * SH - 2 * SH) / (2 * L))), th = Math.asin(s);
    const dir = [Math.cos(th), 0, side * Math.sin(th)];
    return [add(S, sc(dir, U)), add(S, sc(dir, L))];
  }),
  // Seated: thigh forward. Value = 180 − knee (extension) or knee (curl).
  legExtension: (P, v) => seated(P, 180 - v),
  legCurl: (P, v) => seated(P, v),
  calfRaise: () => {},
};
function seated(P, knee) {
  for (const [h, k, a, heel, toe] of [[23, 25, 27, 29, 31], [24, 26, 28, 30, 32]]) {
    const K = add(P[h], [THIGH, 0, 0]); P[k] = K;
    const d = sag(knee - 90); // shin from the knee: knee 90 → straight down, 180 → straight forward
    P[a] = add(K, sc(d, SHIN)); P[heel] = add(P[a], [-0.04, 0.03, 0]); P[toe] = add(P[a], [0.12, 0.05, 0]);
  }
}

/**
 * One frame of the simulated lifter for `lift` at measurement `value`.
 * front: true = facing the phone instead of side-on.
 * Returns { pose (33 × {x, y, z, visibility}), world (33 × {x, y, z}) } in a vw × vh picture.
 */
export function demoLiftPose(lift, value, { vw = 1280, vh = 720, front = false } = {}) {
  let P = base();
  if (POSE[lift]) POSE[lift](P, value);
  hands(P);
  for (let i = 0; i < 33; i++) if (!P[i]) P[i] = [0, 0, 0];
  // front: turned to face the phone (chest towards the lens, which looks along +z).
  if (front) P = P.map(([x, y, z]) => [-z, y, -x]);
  const k = 0.42; // metres → share of picture height
  let lift2d = 0;
  if (lift === 'calfRaise') {
    // Up on the toes: everything but the toes rises; the value is −100 × (rise ÷ torso) above standing.
    const stand = (THIGH + SHIN + 0.05 + TORSO / 2) / TORSO;
    lift2d = (-value / 100 - stand) * TORSO;
  }
  const pose = P.map((q, i) => {
    const up = lift2d && i !== 31 && i !== 32 ? lift2d * (i === 29 || i === 30 ? 0.9 : 1) : 0;
    return { x: 0.5 + (q[0] * k * vh) / vw, y: 0.28 + (q[1] - up) * k, z: q[2], visibility: 0.98 };
  });
  return { pose, world: P.map((q) => ({ x: q[0], y: q[1], z: q[2] })) };
}

/**
 * Rep plan for a demo set in the lift's own value: rep 1 sets the standard, rep 4 misses the finish,
 * rep 6 doesn't go back to the start (5 counted, 2 short) — the same shape as the other lifts' demos.
 */
export function demoPlan(start, finish) {
  const R = start - finish;
  return [[start, finish], [start - 0.01 * R, finish + 0.01 * R], [start, finish + 0.02 * R], [start, finish + 0.32 * R], [start - 0.02 * R, finish + 0.01 * R], [start - 0.3 * R, finish], [start, finish + 0.03 * R]];
}

// Start and finish of each lift's demo set, in its own value (made-up, mid-range movement).
export const DEMO_RANGE = {
  curl: [165, 50], triceps: [100, 12], dip: [95, 12], press: [42, 4], row: [96, 45], shoulderPress: [-15, -175],
  pulldown: [175, -5], fly: [360, 160], legExtension: [90, 8], legCurl: [168, 75], calfRaise: [-250, -265],
};
