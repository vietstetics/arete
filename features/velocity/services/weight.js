// The weight's movement in metres, from a tracked plate (or dumbbell head).
// Barbell lifts: the plate centre's height (vertical bar velocity, as VBT
// devices report it). Dumbbell curls: distance along the head's curved path,
// signed by whether it's rising — the head swings on an arc around the
// elbow, so its height alone would undercount the distance travelled.

import { viewFromEllipses, PLATE_DIAMETER_M } from './vision/geometry.js';
import { savitzkyGolay } from './smooth.js';

/**
 * track: [{ t, ok, cx, cy, shape }] per frame (image px); shape = the
 * plate's ellipse on frames where its whole rim fitted cleanly (else null).
 * Scale and viewing angle come only from those clean shapes (medians).
 * Returns { view, samples: [{ t, y }] } — y up = lifting, in metres when the
 * diameter is known, otherwise in plate radii. Lost frames are NaN.
 */
export function weightSamples(track, { diameterM = PLATE_DIAMETER_M, gravity, mode = 'height' } = {}) {
  const good = track.filter((f) => f.ok);
  const shapes = good.filter((f) => f.shape).map((f) => f.shape);
  const view = viewFromEllipses(shapes.length ? shapes : good, { diameterM, gravity });
  if (!view) return { view: null, samples: track.map((f) => ({ t: f.t, y: NaN })) };
  const o = good[0];
  const plane = track.map((f) => (f.ok ? { t: f.t, ...view.toPlane(f.cx - o.cx, f.cy - o.cy) } : { t: f.t, up: NaN, along: NaN }));
  if (mode === 'height') return { view, samples: plane.map((p) => ({ t: p.t, y: p.up })) };
  // Path length along the smoothed curve, + while the head rises, − while it falls.
  const U = savitzkyGolay(plane.map((p) => ({ t: p.t, y: p.up }))), A = savitzkyGolay(plane.map((p) => ({ t: p.t, y: p.along })));
  const samples = []; let s = 0, last = null;
  for (let i = 0; i < plane.length; i++) {
    if (!Number.isFinite(U[i].y) || !Number.isFinite(A[i].y)) { samples.push({ t: plane[i].t, y: NaN }); last = null; continue; }
    if (last) { const du = U[i].y - last.u, da = A[i].y - last.a; s += Math.sign(du) * Math.hypot(du, da); }
    last = { u: U[i].y, a: A[i].y };
    samples.push({ t: plane[i].t, y: s });
  }
  return { view, samples };
}
