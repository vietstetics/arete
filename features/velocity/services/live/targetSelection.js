// Pointer selection in displayed video, expressed in the original frame's
// pixels. CSS mirroring/cropping must never change the tracker's coordinates.
// The drag-to-select workflow is also used by vendor/barbell-path-tracker;
// these browser coordinate transforms are an independent implementation.
const finite = Number.isFinite;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const validSize = (n) => Number.isInteger(n) && n > 0;

function transform(rect, { vw, vh, mirror = false, fit = 'cover' } = {}) {
  if (!rect || !validSize(vw) || !validSize(vh) || !['cover', 'contain'].includes(fit)) return null;
  const left = rect.left ?? rect.x, top = rect.top ?? rect.y, width = rect.width, height = rect.height;
  if (![left, top, width, height].every(finite) || !(width > 0 && height > 0)) return null;
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / vw, height / vh);
  const ox = (width - vw * scale) / 2, oy = (height - vh * scale) / 2;
  return finite(scale) && scale > 0 && finite(ox) && finite(oy) ? { left, top, width, height, scale, ox, oy, vw, vh, mirror: !!mirror } : null;
}

/**
 * Screen/client pointer to original video pixels, with centered object-fit.
 * Captured pointer drags outside the element are clipped to its visible edge.
 * For contain, points in letterbox bars are clipped to the image edge too.
 * Returns continuous {x,y} in [0,vw] × [0,vh], or null for invalid geometry.
 * rect is a CSS-pixel getBoundingClientRect(), never the DPR-sized canvas.
 */
export function videoPoint(point, rect, options) {
  const tr = transform(rect, options);
  if (!tr || !point || !finite(point.clientX) || !finite(point.clientY)) return null;
  let x = clamp(point.clientX - tr.left, 0, tr.width);
  const y = clamp(point.clientY - tr.top, 0, tr.height);
  if (tr.mirror) x = tr.width - x;
  return { x: clamp((x - tr.ox) / tr.scale, 0, tr.vw), y: clamp((y - tr.oy) / tr.scale, 0, tr.vh) };
}

/** Inverse for drawing overlays. Offscreen/cropped video coordinates stay offscreen. */
export function screenPoint(point, rect, options) {
  const tr = transform(rect, options);
  if (!tr || !point || !finite(point.x) || !finite(point.y)) return null;
  const x = point.x * tr.scale + tr.ox, y = point.y * tr.scale + tr.oy;
  const clientX = tr.left + (tr.mirror ? tr.width - x : x), clientY = tr.top + y;
  return finite(clientX) && finite(clientY) ? { clientX, clientY } : null;
}

/**
 * Two original-frame points to an integer {x,y,w,h} source crop.
 * Reverse drags work identically. Clamp before checking minimum native-pixel
 * side length, then round outward so the selected area is contained.
 * A click, undersized box or invalid input returns null, not an invented ROI.
 */
export function boxFromPoints(a, b, { vw, vh, minSize = 8 } = {}) {
  if (!a || !b || !validSize(vw) || !validSize(vh) || !positiveMinimum(minSize)
      || ![a.x, a.y, b.x, b.y].every(finite)) return null;
  const left = clamp(Math.min(a.x, b.x), 0, vw), right = clamp(Math.max(a.x, b.x), 0, vw);
  const top = clamp(Math.min(a.y, b.y), 0, vh), bottom = clamp(Math.max(a.y, b.y), 0, vh);
  if (right - left < minSize || bottom - top < minSize) return null;
  const x = Math.floor(left), y = Math.floor(top), w = Math.ceil(right) - x, h = Math.ceil(bottom) - y;
  return { x, y, w, h };
}
const positiveMinimum = (n) => finite(n) && n > 0;
