// Scale and viewing-angle correction from the plate itself —
// docs/velocity-tracking-plan.md: "45 cm plate as scale + ellipse for
// viewing angle", "refuse > ±25° off side-on".
//
// A plate is a circle in a vertical plane (the plane the bar moves in, seen
// side-on). Filmed exactly side-on it looks round; turn the camera away by
// θ and it looks like an ellipse whose short axis is cos θ of its long one.
// The long axis is never shortened, so it gives the scale (45 cm ↔ 2a
// pixels). Movement in the plate's plane is shortened the same way the plate
// is, so stretching image movement back by a/b along the short axis undoes
// the angle — whether the camera is turned sideways (yaw) or tilted up or
// down (pitch). "Up" is gravity: the phone's motion sensors when available,
// otherwise straight down the picture.

export const PLATE_DIAMETER_M = 0.45;
export const MAX_OFF_AXIS_DEG = 25;

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/**
 * The camera's view of the plate from its ellipse over many frames (medians:
 * heavily smoothed). diameterM: the tracked circle's real diameter (45 cm
 * plate by default; a dumbbell head must be entered). gravity: unit vector
 * pointing down in image coordinates ({ x: 0, y: 1 } if unknown).
 * Returns { a, b, phi, offAxisDeg, ok, scaled, mPerPx, toPlane(dx, dy) → { up, along } }.
 * Without a diameter, distances come back in plate radii (scaled = false).
 */
export function viewFromEllipses(ellipses, { diameterM = PLATE_DIAMETER_M, gravity = { x: 0, y: 1 } } = {}) {
  const good = ellipses.filter((e) => e && Number.isFinite(e.a) && Number.isFinite(e.b) && e.a > 0);
  if (!good.length) return null;
  const a = median(good.map((e) => e.a)), ratio = Math.min(1, median(good.map((e) => e.b / e.a)));
  // Axis direction: average of the doubled angle, so 179° and 1° agree.
  let sx = 0, sy = 0;
  for (const e of good) { const w = 1 - e.b / e.a; sx += w * Math.cos(2 * e.phi); sy += w * Math.sin(2 * e.phi); }
  const phi = sx || sy ? Math.atan2(sy, sx) / 2 : Math.PI / 2;
  const b = a * ratio, offAxisDeg = (Math.acos(ratio) * 180) / Math.PI;
  const scaled = diameterM > 0, R = scaled ? diameterM / 2 : 1;
  const g = { x: gravity.x / Math.hypot(gravity.x, gravity.y), y: gravity.y / Math.hypot(gravity.x, gravity.y) };
  const c = Math.cos(phi), s = Math.sin(phi);
  return {
    a, b, phi, offAxisDeg, ok: offAxisDeg <= MAX_OFF_AXIS_DEG, scaled, mPerPx: R / a,
    /** Image movement (px) → movement in the plate's plane: up (against gravity) and along (horizontal), in metres. */
    toPlane(dx, dy) {
      const du = dx * c + dy * s, dw = -dx * s + dy * c;   // along the major / minor axis
      const pu = (du * R) / a, pw = (dw * R) / b;            // undo the foreshortening
      const X = pu * c - pw * s, Y = pu * s + pw * c;        // back to image directions, metric
      return { up: -(X * g.x + Y * g.y), along: X * g.y - Y * g.x };
    },
  };
}

/** Gravity in image coordinates from the phone's tilt (roll, degrees; 0 = upright). */
export const gravityFromRoll = (rollDeg = 0) => ({ x: Math.sin((rollDeg * Math.PI) / 180), y: Math.cos((rollDeg * Math.PI) / 180) });
