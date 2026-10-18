// Synthetic gym frames for tests and the velocity-lab demo: a cluttered
// background (racks, a wall plate, a dumbbell rack) and a weight plate with
// a rim, hub and lettering, drawn as an anti-aliased ellipse, plus camera
// noise. Not a real video — it lets the tracker be checked against motion
// whose speed is known exactly.

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Static background: lit wall gradient, rack uprights, shelves and a distractor circle. */
export function background(w, h, seed = 3) {
  const r = rng(seed), d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 150 + 40 * (y / h) - 25 * (x / w);
  const rect = (x0, y0, x1, y1, v) => { for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x++) d[y * w + x] = v; };
  rect(w * 0.08, 0, w * 0.13, h, 70);            // rack upright
  rect(w * 0.87, 0, w * 0.92, h, 70);            // rack upright
  rect(0, h * 0.82, w, h * 0.84, 95);            // shelf edge
  for (let k = 0; k < 14; k++) { const x = r() * w, y = r() * h, s = 6 + r() * 30; rect(x, y, x + s, y + s * (0.3 + r()), 60 + r() * 140); }
  // A smaller plate leaning against the wall: a decoy for the detector.
  drawPlate(d, w, h, { cx: w * 0.8, cy: h * 0.9, a: h * 0.045, b: h * 0.045, phi: 0, body: 45, rim: 70, hub: 190 });
  return d;
}

/** Draw a plate (anti-aliased) into data: a circle seen as an ellipse. */
export function drawPlate(d, w, h, { cx, cy, a, b, phi, body = 35, rim = 62, hub = 205, letters = true }) {
  const c = Math.cos(phi), s = Math.sin(phi), R = a + 2;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const dx = x - cx, dy = y - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
      const rho = Math.sqrt((u * u) / (a * a) + (v * v) / (b * b));
      const cover = Math.max(0, Math.min(1, (1 - rho) * Math.min(a, b) + 0.5));
      if (!cover) continue;
      let val = body;
      if (rho > 0.9) val = rim;                          // raised outer rim
      else if (rho < 0.12) val = hub;                     // steel hub
      else if (rho < 0.16) val = 20;                      // hub ring
      else if (letters && rho > 0.55 && rho < 0.7) {     // lettering band
        const ang = Math.atan2(v / b, u / a);
        if (Math.sin(ang * 9) > 0.55) val = 165;
      }
      const i = y * w + x;
      d[i] = d[i] * (1 - cover) + val * cover;
    }
  }
}

/** One frame: background + plate + camera noise (± noise grey levels) and a brightness drift. */
export function frame(bg, w, h, plate, { noise = 6, gain = 1, r = rng(7) } = {}) {
  const d = new Float32Array(bg);
  if (plate) drawPlate(d, w, h, plate);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, d[i] * gain + (r() - 0.5) * 2 * noise));
  return { w, h, data: d };
}
