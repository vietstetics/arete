// The learned plate detector (trained by scripts/plate-detector/train.py on generate.mjs's pictures).
// Finds every plate in a frame, each as a rough outline; the app then fits the plate's own edge
// (plate3d.js fitRim), so the network only needs to be roughly right and not miss.
//
// Runs with ONNX Runtime Web (MIT), loaded the first time it's needed. Input: the grey frame,
// letterboxed to 256 x 256 (top-left, the rest mid-grey), (v / 255 - 0.5) / 0.25. Output [1, 7, 64, 64]:
// heat (0-1), centre offset (x, y, cells), log half-axes (a, b, cells), cos 2phi, sin 2phi.

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
export const MODEL_URL = 'models/plate-detector.onnx';
export const NET_SIZE = 256, NET_STRIDE = 4;
const CELLS = NET_SIZE / NET_STRIDE;

let session = null, loading = null;

/** Load the runtime and the model once (resolves to false if either can't be had: no model file yet, offline). */
export function loadPlateNet(url = MODEL_URL) {
  if (session) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      if (!globalThis.ort) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script'); s.src = ORT + 'ort.min.js'; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
        });
      }
      globalThis.ort.env.wasm.wasmPaths = ORT;
      session = await globalThis.ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
      return true;
    } catch (err) { console.warn('plate detector unavailable:', err && err.message); loading = null; return false; }
  })();
  return loading;
}
export const plateNetReady = () => !!session;

/** The frame as the network's input: grey { w, h, data }, letterboxed to NET_SIZE (bilinear). */
export function netInput(img) {
  const s = NET_SIZE / Math.max(img.w, img.h), x = new Float32Array(NET_SIZE * NET_SIZE).fill(0);
  for (let y = 0; y < NET_SIZE; y++) for (let k = 0; k < NET_SIZE; k++) {
    const sx = (k + 0.5) / s - 0.5, sy = (y + 0.5) / s - 0.5;
    if (sx > img.w - 1 || sy > img.h - 1) continue; // padding: mid-grey (0 after normalising)
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
    const fx = Math.max(0, sx - x0), fy = Math.max(0, sy - y0), d = img.data;
    const v = (d[y0 * img.w + x0] * (1 - fx) + d[y0 * img.w + x1] * fx) * (1 - fy) + (d[y1 * img.w + x0] * (1 - fx) + d[y1 * img.w + x1] * fx) * fy;
    x[y * NET_SIZE + k] = (v / 255 - 0.5) / 0.25;
  }
  return { x, scale: s };
}

/**
 * Plates in the network's output maps (Float32Array, 7 x CELLS x CELLS): the heatmap's 3 x 3 peaks over
 * thr, each as { cx, cy, a, b, phi, score } in the frame's pixels (scale: the letterbox's).
 */
export function decodeMaps(maps, scale, { thr = 0.3, max = 8 } = {}) {
  const n = CELLS * CELLS, at = (c, i) => maps[c * n + i], out = [];
  for (let y = 0; y < CELLS; y++) for (let x = 0; x < CELLS; x++) {
    const i = y * CELLS + x, v = at(0, i);
    if (!(v > thr)) continue;
    let peak = true;
    for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < CELLS && yy < CELLS && at(0, yy * CELLS + xx) > v) { peak = false; break; }
    }
    if (!peak) continue;
    let a = Math.exp(at(3, i)) * NET_STRIDE, b = Math.exp(at(4, i)) * NET_STRIDE, phi = 0.5 * Math.atan2(at(6, i), at(5, i));
    if (b > a) { [a, b] = [b, a]; phi += Math.PI / 2; }
    out.push({ score: v, cx: ((x + at(1, i)) * NET_STRIDE) / scale, cy: ((y + at(2, i)) * NET_STRIDE) / scale, a: a / scale, b: b / scale, phi });
  }
  return out.sort((p, q) => q.score - p.score).slice(0, max);
}

/** Every plate the network sees in a grey frame { w, h, data }, best first. [] until loadPlateNet() has resolved true. */
export async function netPlates(img, opts) {
  if (!session) return [];
  const { x, scale } = netInput(img);
  const res = await session.run({ image: new globalThis.ort.Tensor('float32', x, [1, 1, NET_SIZE, NET_SIZE]) });
  return decodeMaps(res.maps.data, scale, opts);
}
