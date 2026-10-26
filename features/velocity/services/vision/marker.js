// A coloured marker on the bar's end (tape or a round sticker on the sleeve's
// end cap), followed by its colour, the way barbellcv (Tyler Lancon) follows
// the bar: take the marker's colour where it's tapped, keep the pixels of that
// colour, close small holes, follow the blob. Written for Arete (none of
// barbellcv's code); the blob's centre then goes through Arete's own velocity
// measurement (pipeline.js markerSet), not barbellcv's.
//
// Images are { w, h, data, ox, oy }: data RGBA bytes (canvas ImageData); a crop
// of a bigger frame says where it sits in it (ox, oy; default 0). Positions are
// always the whole frame's.

/** Hue (0–360°), saturation and value (0–1) of an RGB colour. */
export function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx / 255 };
}

const HUE_TOL = 15; // degrees either side of the marker's hue
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

/**
 * The marker's colour from a tap: the median hue, saturation and value around (x, y). null for a spot
 * without a clear colour — grey, black or white can't be told apart from a gym.
 */
export function sampleColour(img, x, y, radius = 3) {
  const hs = [], ss = [], vs = [], ox = img.ox || 0, oy = img.oy || 0;
  for (let j = Math.round(y - oy) - radius; j <= Math.round(y - oy) + radius; j++) for (let i = Math.round(x - ox) - radius; i <= Math.round(x - ox) + radius; i++) {
    if (i < 0 || j < 0 || i >= img.w || j >= img.h) continue;
    const k = 4 * (j * img.w + i), c = hsv(img.data[k], img.data[k + 1], img.data[k + 2]);
    hs.push(c.h); ss.push(c.s); vs.push(c.v);
  }
  if (!hs.length) return null;
  // Hue wraps at 360°: take the median around the first sample's hue.
  const h0 = hs[0], h = (median(hs.map((v) => ((v - h0 + 540) % 360) - 180)) + h0 + 360) % 360;
  const col = { h, s: median(ss), v: median(vs) };
  return col.s >= 0.3 && col.v >= 0.15 ? col : null;
}

function matches(data, k, col) {
  const c = hsv(data[k], data[k + 1], data[k + 2]), dh = Math.abs(c.h - col.h);
  return Math.min(dh, 360 - dh) <= HUE_TOL && c.s >= 0.5 * col.s && c.v >= 0.35 * col.v;
}

/**
 * The blob of the marker's colour inside the window { x0, y0, x1, y1 } (default: the whole image): the one
 * nearest `near`, or the largest. Pixels are kept by colour, then closed (a 3 × 3 dilate, then erode) so
 * glare or a screw head doesn't split the marker. Returns { ok, cx, cy, r, area }: centre (pixel centres at
 * +0.5) and the radius of a disc of the same area.
 */
export function findMarker(img, col, { near = null, win = null, minArea = 12 } = {}) {
  const ox = img.ox || 0, oy = img.oy || 0;
  const x0 = Math.max(ox, Math.floor(win ? win.x0 : ox)), y0 = Math.max(oy, Math.floor(win ? win.y0 : oy));
  const x1 = Math.min(ox + img.w, Math.ceil(win ? win.x1 : ox + img.w)), y1 = Math.min(oy + img.h, Math.ceil(win ? win.y1 : oy + img.h));
  const W = x1 - x0, H = y1 - y0;
  if (!(W > 2 && H > 2)) return { ok: false };
  const raw = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) raw[j * W + i] = matches(img.data, 4 * ((y0 - oy + j) * img.w + x0 - ox + i), col) ? 1 : 0;
  // Dilate: on if any pixel of the 3 × 3 is on. Erode: on only if every one is (the window's edge doesn't count).
  const pass = (src, any) => {
    const out = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = any ? 0 : 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        if (any) v |= src[b * W + a]; else v &= src[b * W + a];
      }
      out[j * W + i] = v;
    }
    return out;
  };
  const mask = pass(pass(raw, true), false);
  const seen = new Uint8Array(W * H), stack = [];
  let best = null;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let area = 0, sx = 0, sy = 0;
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const q = stack.pop(), i = q % W, j = (q - i) / W;
      area++; sx += i; sy += j;
      for (const n of [q - 1, q + 1, q - W, q + W]) {
        if (n < 0 || n >= W * H || seen[n] || !mask[n] || (Math.abs((n % W) - i) > 1)) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (area < minArea) continue;
    const blob = { cx: x0 + sx / area + 0.5, cy: y0 + sy / area + 0.5, area, r: Math.sqrt(area / Math.PI) };
    const score = near ? -Math.hypot(blob.cx - near.x, blob.cy - near.y) + 0.5 * blob.r : area;
    if (!best || score > best.score) best = { ...blob, score };
  }
  if (!best) return { ok: false };
  const { score, ...m } = best;
  return { ok: true, ...m };
}

/**
 * Follows the marker frame to frame: looked for in a window around where it should be (its last position
 * moved on at its last speed); a blob of a very different size isn't it. `img` can be the whole frame, or a
 * function giving an image (a crop) that covers a window { x0, y0, x1, y1 }.
 *   const tr = createMarkerTracker(colour); tr.init(img, x, y, t); tr.track(img, t) → { ok, cx, cy, r }
 */
export function createMarkerTracker(col) {
  let last = null, vx = 0, vy = 0;
  const window = (x, y, half) => ({ x0: x - half, y0: y - half, x1: x + half, y1: y + half });
  return {
    init(img, x, y, t) {
      const win = window(x, y, 60), m = findMarker(typeof img === 'function' ? img(win) : img, col, { near: { x, y }, win });
      if (m.ok) { last = { ...m, t }; vx = 0; vy = 0; }
      return m;
    },
    track(img, t) {
      if (!last) return { ok: false };
      const dt = t - last.t, px = last.cx + vx * dt, py = last.cy + vy * dt;
      const win = window(px, py, Math.max(40, 8 * last.r)), m = findMarker(typeof img === 'function' ? img(win) : img, col, { near: { x: px, y: py }, win });
      if (!m.ok || m.area < 0.3 * last.area || m.area > 3 * last.area || Math.hypot(m.cx - px, m.cy - py) > Math.max(30, 6 * last.r)) return { ok: false };
      if (dt > 0) { vx = (m.cx - last.cx) / dt; vy = (m.cy - last.cy) / dt; }
      last = { ...m, t };
      return m;
    },
    get last() { return last; },
  };
}
