// Body measurements for one frame that mean the same thing from any camera angle, used to follow
// each lift (liftTrackers.js). All of them come from the pose model's 3D joints (world landmarks,
// metres) measured in the lifter's own frame, so a chest press filmed from the front reads the same
// as one filmed side-on, and nothing depends on how tall, strong or fast anyone is: lengths are in
// the lifter's own segment lengths, angles in degrees.
//
// Landmarks: 0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees,
// 27/28 ankles, 29/30 heels, 31/32 toes. L = the lifter's left, R = right.

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : null; };
const mid = (a, b) => mul(add(a, b), 0.5);
const dist = (a, b) => len(sub(a, b));
const angleAt = (a, b, c) => { const u = unit(sub(a, b)), v = unit(sub(c, b)); return u && v ? Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * DEG : NaN; };

const SIDES = {
  L: { S: 11, E: 13, W: 15, H: 23, K: 25, A: 27, heel: 29, toe: 31 },
  R: { S: 12, E: 14, W: 16, H: 24, K: 26, A: 28, heel: 30, toe: 32 },
};

/** The lifter among the poses found in a frame: the biggest torso, preferring the one near last frame's. */
export function pickLifter(poses, prev = null, { vw = 1, vh = 1 } = {}) {
  if (!poses || !poses.length) return null;
  // Size = torso length + shoulder width in the picture, whatever the posture (someone reclined in a
  // machine is as big as someone standing behind them at the same distance).
  const size = (p) => Math.hypot(((p.lm[11].x + p.lm[12].x) - (p.lm[23].x + p.lm[24].x)) / 2 * vw, ((p.lm[11].y + p.lm[12].y) - (p.lm[23].y + p.lm[24].y)) / 2 * vh) + Math.hypot((p.lm[11].x - p.lm[12].x) * vw, (p.lm[11].y - p.lm[12].y) * vh);
  const centre = (p) => [((p.lm[11].x + p.lm[12].x + p.lm[23].x + p.lm[24].x) / 4) * vw, ((p.lm[11].y + p.lm[12].y + p.lm[23].y + p.lm[24].y) / 4) * vh];
  let best = null, bestScore = -Infinity;
  for (const p of poses) {
    let score = size(p);
    if (prev) { const [a, b] = centre(p), [c, d] = centre(prev); score -= 0.5 * Math.hypot(a - c, b - d); }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * Measurements for one frame. pose: 33 landmarks {x, y, z, visibility} (picture, 0–1);
 * world: 33 {x, y, z} in metres, or null (then only the 2D measures are filled).
 * Returns null when the torso isn't seen; any single measure is NaN when its joints aren't.
 *   elbowL/R   elbow angle (180 = straight)
 *   kneeL/R    knee angle;  hipL/R  shoulder–hip–knee angle
 *   ankleL/R   knee–ankle–toe angle (grows as the heel rises: calf raise)
 *   elevL/R    upper arm raised from the side of the body (0 down, 90 level, 180 overhead)
 *   reachL/R   shoulder→wrist ÷ arm length (1 = arm straight out from the shoulder)
 *   handUpL/R  wrist above the shoulder along the torso, in upper-arm lengths
 *   handFwdL/R wrist in front of the shoulder (chest direction), in upper-arm lengths
 *   handGap    distance between the wrists ÷ shoulder width
 *   elbowGap   distance between the elbows ÷ shoulder width
 *   kneeGap    distance between the knees ÷ hip width
 *   footUpL/R  heel above the toes along the shin direction, in foot lengths
 *   tilt       torso from upright (0 standing, 90 lying)
 *   y2d        mid-shoulder height in the picture, in torso lengths (grows upwards) — whole-body moves
 *   hipY2d     mid-hip height in the picture, in torso lengths (grows upwards)
 *   wristY2dL/R wrist height in the picture, in torso lengths (grows upwards)
 *   rise2d     shoulders and hips above the toes in the picture, in torso lengths: the whole body
 *              going up on the toes (calf raise), whatever the phone's distance or tilt
 *   palmL/R    the hand's size in the picture ÷ shoulder width (needs `hands` from the hand model).
 *              It grows as the hand comes towards the lens, so a press or row filmed from the front
 *              (where the picture can't see the hand travel) still shows every rep.
 *   facing     how squarely the chest faces the phone or away from it (1 = straight on, 0 = side-on)
 *   vis        { L, R } how clearly each arm is seen (min of shoulder, elbow, wrist visibility)
 *   legVis     { L, R } the same for each leg (hip, knee, ankle)
 */
export function liftFeatures(pose, world = null, { vw = 1, vh = 1, minVis = 0.3, hands = null } = {}) {
  if (!pose || pose.length < 33) return null;
  const v = (i) => pose[i]?.visibility ?? 1;
  const three = !!(world && world.length >= 33);
  const P = three ? (i) => [world[i].x, world[i].y, world[i].z] : (i) => [pose[i].x * vw, pose[i].y * vh, 0];
  const Q = (i) => [pose[i].x * vw, pose[i].y * vh, 0]; // the picture, pixels
  if (Math.min(v(11), v(12)) < minVis) return null;
  const sh = mid(P(11), P(12)), hp = mid(P(23), P(24));
  const U = unit(sub(sh, hp));
  const Lraw = sub(P(11), P(12));
  const Lx = U && unit(sub(Lraw, mul(U, dot(Lraw, U))));
  if (!U || !Lx) return null;
  const F = cross(Lx, U);
  const shoulderW = dist(P(11), P(12)), hipW = dist(P(23), P(24));
  const torso2d = dist(mid(Q(11), Q(12)), mid(Q(23), Q(24))) || NaN;
  // Moving points relative to the joint they turn about, in that limb's length (for speed):
  // wrist from the shoulder in arm lengths, ankle from the knee in shin lengths, and the shoulder
  // from the wrists in arm lengths (dips: the body moves, the hands don't).
  const out = { three, vis: {}, legVis: {}, pts: { wrist: {}, ankle: {}, shoulder: {} } };
  for (const s of ['L', 'R']) {
    const j = SIDES[s];
    const S = P(j.S), E = P(j.E), W = P(j.W), H = P(j.H), K = P(j.K), A = P(j.A);
    const upper = dist(S, E), fore = dist(E, W);
    out.vis[s] = Math.min(v(j.S), v(j.E), v(j.W));
    if (upper + fore > 0) { out.pts.wrist[s] = mul(sub(W, S), 1 / (upper + fore)); out.pts.shoulder[s] = mul(sub(S, W), 1 / (upper + fore)); }
    const shinLen = dist(K, A);
    if (shinLen > 0) out.pts.ankle[s] = mul(sub(A, K), 1 / shinLen);
    out.legVis[s] = Math.min(v(j.H), v(j.K), v(j.A));
    out['elbow' + s] = angleAt(S, E, W);
    out['knee' + s] = angleAt(H, K, A);
    out['hip' + s] = angleAt(S, H, K);
    out['ankle' + s] = angleAt(K, A, P(j.toe));
    const arm = sub(E, S), n = len(arm);
    out['elev' + s] = n > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, -dot(arm, U) / n))) * DEG : NaN;
    out['reach' + s] = upper + fore > 0 ? Math.min(1.05, dist(S, W) / (upper + fore)) : NaN;
    out['handUp' + s] = upper > 0 ? dot(sub(W, S), U) / upper : NaN;
    out['handFwd' + s] = upper > 0 ? dot(sub(W, S), F) / upper : NaN;
    const shin = unit(sub(K, A)), foot = dist(P(j.heel), P(j.toe));
    out['footUp' + s] = shin && foot > 0 ? dot(sub(P(j.heel), P(j.toe)), shin) / foot : NaN;
    out['wristY2d' + s] = ((mid(Q(11), Q(12))[1] - Q(j.W)[1]) / torso2d);
  }
  // Hands from the hand model: each belongs to the nearer wrist, and only if it is on that wrist (a
  // hand in the background — someone else's — is never this lifter's).
  const sw2d = dist(Q(11), Q(12));
  out.palmL = NaN; out.palmR = NaN;
  for (const h of hands || []) {
    if (!h || h.length < 18 || !(sw2d > 0)) continue;
    const H = (i) => [h[i].x * vw, h[i].y * vh, 0];
    const c = mul([0, 5, 9, 13, 17].map(H).reduce(add, [0, 0, 0]), 1 / 5);
    const size = [5, 9, 13, 17].reduce((a, i) => a + dist(H(0), H(i)), 0) / 4;
    const dL = dist(c, Q(15)), dR = dist(c, Q(16)), s = dL <= dR ? 'L' : 'R';
    if (Math.min(dL, dR) > 0.6 * sw2d) continue;
    out['palm' + s] = size / sw2d;
  }
  out.handGap = shoulderW > 0 ? dist(P(15), P(16)) / shoulderW : NaN;
  out.elbowGap = shoulderW > 0 ? dist(P(13), P(14)) / shoulderW : NaN;
  out.kneeGap = hipW > 0 ? dist(P(25), P(26)) / hipW : NaN;
  out.facing = three ? Math.abs(F[2]) : NaN;
  out.tilt = Math.acos(Math.max(-1, Math.min(1, -U[1]))) * DEG;
  out.y2d = -mid(Q(11), Q(12))[1] / torso2d;
  out.hipY2d = -mid(Q(23), Q(24))[1] / torso2d;
  const toeY = (Q(31)[1] + Q(32)[1]) / 2;
  out.rise2d = Math.min(v(31), v(32)) >= minVis ? (toeY - (Q(11)[1] + Q(12)[1] + Q(23)[1] + Q(24)[1]) / 4) / torso2d : NaN;
  out.torso2d = torso2d;
  return out;
}

/** Cached landmark arrays ([x, y, z, visibility] / [x, y, z]) → the objects the models give. */
export const toPose = (lm) => lm.map((q) => ({ x: q[0], y: q[1], z: q[2], visibility: q[3] }));
export const toWorld = (w) => (w && w.length ? w.map((q) => ({ x: q[0], y: q[1], z: q[2] })) : null);
