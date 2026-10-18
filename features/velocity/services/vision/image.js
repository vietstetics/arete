// Grayscale images for the weight tracker: { w, h, data: Float32Array } with
// luminance 0–255. Plain JavaScript, no OpenCV, so it runs on every phone.

export function gray(w, h, data = new Float32Array(w * h)) { return { w, h, data }; }

/** RGBA pixels (canvas getImageData) → grayscale luminance. */
export function fromRGBA(rgba, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data: d };
}

/** Bilinear sample at sub-pixel (x, y); NaN outside the image. */
export function sample(img, x, y) {
  if (!(x >= 0 && y >= 0 && x <= img.w - 1 && y <= img.h - 1)) return NaN;
  const x0 = Math.min(img.w - 2, Math.floor(x)), y0 = Math.min(img.h - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0, i = y0 * img.w + x0, d = img.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + img.w] * (1 - fx) + d[i + img.w + 1] * fx) * fy;
}

/** Brightness change along a unit direction (ux, uy) at (x, y), over a 3 px baseline. */
export function dirDeriv(img, x, y, ux, uy) {
  const a = sample(img, x + 1.5 * ux, y + 1.5 * uy), b = sample(img, x - 1.5 * ux, y - 1.5 * uy);
  return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 3 : NaN;
}

/** Sobel gradients: { gx, gy, mag } as Float32Arrays (borders 0). */
export function sobel(img) {
  const { w, h, data: d } = img, gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = d[i - w - 1], t = d[i - w], tr = d[i - w + 1], l = d[i - 1], r = d[i + 1], bl = d[i + w - 1], b = d[i + w], br = d[i + w + 1];
      const X = (tr + 2 * r + br - tl - 2 * l - bl) / 8, Y = (bl + 2 * b + br - tl - 2 * t - tr) / 8;
      gx[i] = X; gy[i] = Y; mag[i] = Math.hypot(X, Y);
    }
  }
  return { gx, gy, mag };
}

/** Half-resolution copy (2×2 average), for coarse-to-fine optical flow. */
export function half(img) {
  const w = img.w >> 1, h = img.h >> 1, out = new Float32Array(w * h), d = img.data, W = img.w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * W + 2 * x;
    out[y * w + x] = (d[i] + d[i + 1] + d[i + W] + d[i + W + 1]) / 4;
  }
  return { w, h, data: out };
}
