// Browser adaptation of Marticles' Barbell-Path-Tracker Template_Matching mode:
// https://github.com/Marticles/barbell-path-tracker/blob/501daea5c0666b3564fadbbebb51e6f6ac0b2428/tracker.py
// Upstream uses cv2.TM_CCOEFF_NORMED with a fixed manually selected grayscale template.
// This implementation preserves that zero-mean normalized cross-correlation algorithm, not Dlib.
// Changes for live phone use: area-downsampled descriptors, bounded coarse-to-fine local search,
// contrast/ambiguity gates, timestamp guards and explicit loss. It neither estimates scale/rotation
// nor converts pixels into physical displacement. An immutable anchor prevents template drift.
//
// MIT License
// Copyright (c) 2018 Marticles
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions: The above copyright notice and this permission notice
// shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
// NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const finite = (x) => Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const imageValid = (img) => img && Number.isInteger(img.w) && Number.isInteger(img.h)
  && img.w >= 8 && img.h >= 8 && img.data?.length === img.w * img.h;

// Integral image permits area averages for every descriptor cell without rescanning its pixels.
// Nonfinite pixels reject this frame rather than entering a correlation as zeros or invented samples.
function integral(img) {
  const stride = img.w + 1, sums = new Float64Array(stride * (img.h + 1));
  for (let y = 0; y < img.h; y++) {
    let row = 0;
    for (let x = 0; x < img.w; x++) {
      const v = img.data[y * img.w + x];
      if (!finite(v)) return null;
      row += v;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  return { sums, stride };
}

function grid(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  const cols = Math.min(width, Math.max(4, Math.round(width * scale)));
  const rows = Math.min(height, Math.max(4, Math.round(height * scale)));
  const cells = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const x0 = Math.floor(x * width / cols), x1 = Math.floor((x + 1) * width / cols);
    const y0 = Math.floor(y * height / rows), y1 = Math.floor((y + 1) * height / rows);
    cells.push({ x0, x1, y0, y1, area: (x1 - x0) * (y1 - y0) });
  }
  return cells;
}

function cellMean(I, x, y, cell) {
  const { sums: s, stride: W } = I, x0 = x + cell.x0, x1 = x + cell.x1, y0 = y + cell.y0, y1 = y + cell.y1;
  return (s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0]) / cell.area;
}

function anchorAt(I, x, y, cells) {
  const values = cells.map((cell) => cellMean(I, x, y, cell));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const centered = Float64Array.from(values, (v) => v - mean);
  const energy = centered.reduce((a, b) => a + b * b, 0);
  return { cells, centered, energy, contrast: Math.sqrt(energy / values.length) };
}

// TM_CCOEFF_NORMED = sum((T-mean(T))*(I-mean(I))) / sqrt(sum(T'^2)*sum(I'^2)).
// sum(T') is zero, so the covariance does not need a second pass over the candidate.
function scoreAt(I, x, y, anchor, minContrast) {
  let sum = 0, squares = 0, covariance = 0;
  for (let j = 0; j < anchor.cells.length; j++) {
    const value = cellMean(I, x, y, anchor.cells[j]);
    sum += value; squares += value * value; covariance += value * anchor.centered[j];
  }
  const energy = Math.max(0, squares - sum * sum / anchor.cells.length);
  if (!(energy > 1e-8) || energy < minContrast * minContrast * anchor.cells.length) return -Infinity;
  return clamp(covariance / Math.sqrt(anchor.energy * energy), -1, 1);
}

/**
 * Manually selected target tracker. Coordinates and margin are image pixels; timestamps are seconds.
 * Fixed size/appearance is assumed. Short loss can recover only inside a bounded local search; after
 * maxGap since the last observed match, a fresh selection is required. Failed frames have no position.
 */
export function createTemplateTracker({ minScore = 0.72, margin = 40, maxGap = 0.5, maxTemplateSide = 24,
  minContrast = 5, minSeparation = 0.06, ambiguityRadius = 0.5, coarseStep = 4, maxCandidates = 6 } = {}) {
  if (!finite(minScore) || minScore <= 0 || minScore > 1 || !finite(margin) || margin < 1 || margin > 160
    || !finite(maxGap) || maxGap <= 0 || maxGap > 2 || !Number.isInteger(maxTemplateSide) || maxTemplateSide < 8 || maxTemplateSide > 32
    || !finite(minContrast) || minContrast <= 0 || !finite(minSeparation) || minSeparation < 0 || minSeparation > 1
    || !finite(ambiguityRadius) || ambiguityRadius <= 0 || !Number.isInteger(coarseStep) || coarseStep < 1 || coarseStep > 8
    || !Number.isInteger(maxCandidates) || maxCandidates < 2 || maxCandidates > 12) throw new RangeError('Invalid template tracking options');
  let state = 'empty', box = null, coarse = null, fine = null, width = 0, height = 0, lastTime = null, lastGood = null;
  let dxdt = 0, dydt = 0;
  const failure = (t, reason, score = NaN, extra = {}) => ({ ok: false, t, box: null, cx: NaN, cy: NaN, score, reason, ...extra });
  const success = (t, score, extra = {}) => ({ ok: true, t, box: { ...box }, cx: box.x + box.w / 2, cy: box.y + box.h / 2, score, reason: '', ...extra });

  return {
    get state() { return state; },
    get box() { return box ? { ...box } : null; },
    reset() { state = 'empty'; box = null; coarse = null; fine = null; width = height = 0; lastTime = lastGood = null; dxdt = dydt = 0; },
    init(img, selection, t) {
      if (!finite(t)) return failure(t, 'Frame timestamp must be finite');
      if (!imageValid(img)) return failure(t, 'Invalid grayscale image');
      if (!selection || !['x', 'y', 'w', 'h'].every((k) => finite(selection[k])) || selection.w < 8 || selection.h < 8) return failure(t, 'Select a textured target at least 8 pixels across');
      const next = { x: Math.round(selection.x), y: Math.round(selection.y), w: Math.round(selection.w), h: Math.round(selection.h) };
      if (next.x < 0 || next.y < 0 || next.x + next.w > img.w || next.y + next.h > img.h) return failure(t, 'Target selection must stay inside the image');
      const I = integral(img);
      if (!I) return failure(t, 'Image contains invalid pixels');
      const nextFine = anchorAt(I, next.x, next.y, grid(next.w, next.h, maxTemplateSide));
      const nextCoarse = anchorAt(I, next.x, next.y, grid(next.w, next.h, Math.min(8, maxTemplateSide)));
      if (!(nextFine.contrast >= minContrast) || !(nextCoarse.energy > 1e-8)) return failure(t, 'Target has too little contrast; select a distinctive edge or textured patch');
      box = next; fine = nextFine; coarse = nextCoarse; width = img.w; height = img.h;
      lastTime = lastGood = t; dxdt = dydt = 0; state = 'tracking';
      return success(t, 1);
    },
    track(img, t) {
      if (!finite(t) || lastTime !== null && t <= lastTime) return failure(t, 'Frame timestamps must increase');
      if (state === 'empty') return failure(t, 'Select the target first');
      if (state === 'expired') return failure(t, 'Target lost; select it again');
      if (!imageValid(img)) return failure(t, 'Invalid grayscale image');
      if (img.w !== width || img.h !== height) { state = 'expired'; return failure(t, 'Image dimensions changed; select the target again'); }
      lastTime = t;
      const dt = t - lastGood;
      if (dt > maxGap + 1e-9) { state = 'expired'; return failure(t, 'Target missing for too long; select it again'); }
      const I = integral(img);
      if (!I) { state = 'lost'; return failure(t, 'Image contains invalid pixels'); }
      // Prediction steers only the local search, never the reported position. Bound it to half the margin.
      const px = box.x + clamp(dxdt * Math.min(dt, 0.15), -margin / 2, margin / 2);
      const py = box.y + clamp(dydt * Math.min(dt, 0.15), -margin / 2, margin / 2);
      const x0 = Math.max(0, Math.floor(px - margin)), x1 = Math.min(width - box.w, Math.ceil(px + margin));
      const y0 = Math.max(0, Math.floor(py - margin)), y1 = Math.min(height - box.h, Math.ceil(py + margin));
      const ranked = [], coarseSeen = new Set();
      const considerCoarse = (x, y) => {
        x = clamp(Math.round(x), x0, x1); y = clamp(Math.round(y), y0, y1);
        const key = y * width + x;
        if (coarseSeen.has(key)) return;
        coarseSeen.add(key);
        const score = scoreAt(I, x, y, coarse, 1e-6);
        if (finite(score)) ranked.push({ x, y, score });
      };
      for (let y = y0; y <= y1; y += coarseStep) for (let x = x0; x <= x1; x += coarseStep) considerCoarse(x, y);
      considerCoarse(x1, y1); considerCoarse(box.x, box.y); considerCoarse(px, py);
      ranked.sort((a, b) => b.score - a.score);
      const seeds = [];
      for (const candidate of ranked) {
        if (seeds.every((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) >= Math.max(2, coarseStep * 1.5))) seeds.push(candidate);
        if (seeds.length >= maxCandidates) break;
      }
      const fineScores = [], seen = new Set();
      for (const seed of seeds) {
        for (let y = Math.max(y0, seed.y - coarseStep); y <= Math.min(y1, seed.y + coarseStep); y++) {
          for (let x = Math.max(x0, seed.x - coarseStep); x <= Math.min(x1, seed.x + coarseStep); x++) {
            const key = y * width + x;
            if (seen.has(key)) continue;
            seen.add(key);
            const score = scoreAt(I, x, y, fine, minContrast);
            if (finite(score)) fineScores.push({ x, y, score });
          }
        }
      }
      fineScores.sort((a, b) => b.score - a.score);
      const best = fineScores[0];
      if (!best || best.score < minScore) { state = 'lost'; return failure(t, 'Target appearance did not match', best?.score ?? NaN); }
      const separationPx = Math.max(4, Math.min(box.w, box.h) * ambiguityRadius);
      const rival = fineScores.find((p) => Math.hypot(p.x - best.x, p.y - best.y) >= separationPx);
      const separation = rival ? best.score - rival.score : 1;
      if (separation < minSeparation) { state = 'lost'; return failure(t, 'Ambiguous target match; select a more distinctive patch', best.score, { separation }); }
      dxdt = (best.x - box.x) / Math.max(dt, 1e-6); dydt = (best.y - box.y) / Math.max(dt, 1e-6);
      box = { ...box, x: best.x, y: best.y }; lastGood = t; state = 'tracking';
      return success(t, best.score, { separation });
    },
  };
}
