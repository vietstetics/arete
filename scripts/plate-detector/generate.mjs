// Training pictures for the plate detector: gym-like frames with every plate's outline known exactly.
//   node scripts/plate-detector/generate.mjs --n 2000 --seed 1 --out data/shard-1   → .bin (n × S × S grey bytes) + .json labels
//   node scripts/plate-detector/generate.mjs --n 24 --preview preview.png          → a contact sheet with the labels drawn
//
// The main plate comes from the 3D simulator (scene3d.js: the real geometry of a plate on a bar, a lifter's
// side, motion blur, rolling shutter) from anywhere a phone might be — including on the floor a metre away,
// steeply off side-on — rendered twice, on black and on white, so its pixels and soft edges are cut out
// exactly. Then everything a real clip varies is randomised: the plate's shade and contrast (black, coloured
// and bright bumpers), the gym behind (racks, floor, windows, other plates — labelled too), screen-recording
// overlays (text, icons), blur, noise and compression blocks. Labels: [{ cx, cy, a, b, phi }] in pixels.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { liftTrajectory, makeScene } from '../../features/velocity/demo/scene3d.js';
import { circleEllipse } from '../../features/velocity/services/vision/circle3d.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('n', 100), SEED = +arg('seed', 1), S = +arg('size', 256), OUT = arg('out', null), PREVIEW = arg('preview', null);
const R = 0.225;

function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 48271) % 2147483647 + 2147483647) % 2147483647) / 2147483647); }
const rand = rng(SEED * 7919 + 13);
const U = (a, b) => a + (b - a) * rand();
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());

// ── Backgrounds: a gym, roughly ──────────────────────────────────────────
function fillEllipse(img, e, shade, { rim = null, hub = null } = {}) {
  const c = Math.cos(e.phi), s = Math.sin(e.phi), x0 = Math.max(0, Math.floor(e.cx - e.a - 1)), x1 = Math.min(S - 1, Math.ceil(e.cx + e.a + 1));
  const y0 = Math.max(0, Math.floor(e.cy - e.a - 1)), y1 = Math.min(S - 1, Math.ceil(e.cy + e.a + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - e.cx, dy = y + 0.5 - e.cy, u = (dx * c + dy * s) / e.a, w = (-dx * s + dy * c) / e.b, rho = Math.sqrt(u * u + w * w);
    if (rho > 1) continue;
    let v = shade;
    if (rim !== null && rho > 0.9) v = rim;
    if (hub !== null && rho < 0.2) v = hub;
    img[y * S + x] = v;
  }
}
function background(labels) {
  const img = new Float32Array(S * S), base = U(20, 200), gx = U(-0.4, 0.4), gy = U(-0.6, 0.6);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img[y * S + x] = base + gx * (x - S / 2) + gy * (y - S / 2);
  // Floor: a darker or lighter band at the bottom, speckled (rubber flooring).
  if (rand() < 0.8) {
    const fy = U(0.45, 0.85) * S, fv = U(15, 140);
    for (let y = Math.floor(fy); y < S; y++) for (let x = 0; x < S; x++) img[y * S + x] = fv + (rand() < 0.06 ? U(20, 80) : 0);
  }
  // Racks, benches, windows, people: rectangles and bars.
  for (let k = 0, n = Math.floor(U(3, 14)); k < n; k++) {
    const w = U(3, S * 0.4), h = U(3, S * 0.8), x = U(-w / 2, S), y = U(-h / 2, S), v = U(0, 255);
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(S, y + h); yy++) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(S, x + w); xx++) img[yy * S + xx] = v;
  }
  // Ceiling lights: bright dots.
  for (let k = 0, n = Math.floor(U(0, 8)); k < n; k++) fillEllipse(img, { cx: U(0, S), cy: U(0, S * 0.4), a: U(2, 6), b: U(2, 6), phi: 0 }, 250);
  // Other plates: on racks, on other bars, stacked. Labelled (they're plates too); the app picks the one on the lifter's bar.
  for (let k = 0, n = rand() < 0.5 ? Math.floor(U(1, 6)) : 0; k < n; k++) {
    const a = U(5, S * 0.18), e = { cx: U(0, S), cy: U(0, S), a, b: a * U(0.25, 1), phi: U(-0.4, 0.4) + Math.PI / 2 * (rand() < 0.7 ? 1 : 0) };
    const shade = U(10, 230);
    fillEllipse(img, e, shade, { rim: rand() < 0.6 ? shade + U(-40, 40) : null, hub: rand() < 0.7 ? U(150, 240) : null });
    if (e.cx > 0 && e.cx < S && e.cy > 0 && e.cy < S && e.a >= 5) labels.push({ cx: e.cx, cy: e.cy, a: Math.max(e.a, e.b), b: Math.min(e.a, e.b), phi: e.a >= e.b ? e.phi : e.phi + Math.PI / 2 });
  }
  return img;
}

// ── Screen-recording overlays: text, icons, a progress bar ───────────────
function overlays(img) {
  if (rand() < 0.5) { const y = Math.floor(U(2, 8)); for (let x = Math.floor(S * 0.04); x < S * 0.96; x++) if (Math.floor(x / (S / 8)) % 1 === 0) img[y * S + x] = 230; }
  for (let k = 0, n = rand() < 0.6 ? Math.floor(U(1, 5)) : 0; k < n; k++) {
    const x0 = U(0, S * 0.8), y0 = U(0, S), h = U(4, 12), len = U(10, S * 0.5), v = rand() < 0.8 ? 245 : 15;
    for (let x = x0; x < x0 + len; x += U(2, 5)) for (let yy = 0; yy < h; yy++) if (rand() < 0.55) { const xi = Math.floor(x), yi = Math.floor(y0 + yy); if (xi >= 0 && xi < S && yi >= 0 && yi < S) img[yi * S + xi] = v; }
  }
  if (rand() < 0.4) fillEllipse(img, { cx: U(8, 30), cy: U(8, 30), a: U(5, 10), b: U(5, 10), phi: 0 }, U(100, 240)); // profile picture
}

// ── The camera's own artefacts ───────────────────────────────────────────
function boxBlur(img, r) {
  if (r < 1) return img;
  const out = new Float32Array(img.length), tmp = new Float32Array(img.length);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < S) { s += img[y * S + xx]; n++; } } tmp[y * S + x] = s / n; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < S) { s += tmp[yy * S + x]; n++; } } out[y * S + x] = s / n; }
  return out;
}
/** Compression: 8 × 8 blocks pulled towards their mean, levels quantised. */
function blocky(img, k, q) {
  for (let by = 0; by < S; by += 8) for (let bx = 0; bx < S; bx += 8) {
    let m = 0; for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) m += img[y * S + x];
    m /= 64;
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const i = y * S + x; img[i] = Math.round((m + (img[i] - m) * (1 - k)) / q) * q; }
  }
}

// ── One training picture ─────────────────────────────────────────────────
function sample() {
  const labels = [];
  const bgImg = background(labels);
  let main = null;
  if (rand() < 0.9) {
    const D = U(0.3, 0.6), traj = liftTrajectory({ reps: [{ T: U(0.5, 1.5), D }], startsAtBottom: rand() < 0.4, lead: 0.3, tail: 0.3, ecc: 0.8, path: U(0, 0.08) });
    const t = U(0, traj.duration);
    // Where the phone is: often close and low (on the floor), steep angles included.
    const low = rand() < 0.45, distance = low ? U(0.7, 2) : Math.exp(U(Math.log(1.2), Math.log(5.5)));
    const place = { distance, yawDeg: U(-78, 78), heightOffset: low ? U(-1.3, -0.4) : U(-0.8, 1.0), aim: rand() < 0.8, pitchDeg: U(-12, 12), rollDeg: U(-10, 10), panDeg: U(-22, 22) };
    const common = { w: S, h: S, hfovDeg: U(50, 82), place, traj, exposure: 1 / U(60, 500), readout: U(0, 0.03), noise: 0, samples: 2, bodyShade: rand() < 0.7 ? U(20, 200) : null };
    const black = makeScene({ ...common, backgroundImage: new Float32Array(S * S) }).render(t);
    const scene = makeScene({ ...common, backgroundImage: new Float32Array(S * S).fill(255) });
    const white = scene.render(t);
    const e = circleEllipse(scene.K, scene.centreCam(t), scene.barAxisCam, R);
    // The plate's own look: dark, coloured or bright bumpers (in grey), more or less contrast.
    const gain = U(0.35, 1.7), bias = U(-30, 110);
    const img = bgImg;
    for (let i = 0; i < S * S; i++) {
      const alpha = Math.max(0, Math.min(1, 1 - (white.data[i] - black.data[i]) / 255));
      if (alpha <= 0.002) continue;
      const fg = black.data[i] / alpha;
      img[i] = alpha * Math.max(0, Math.min(255, gain * fg + bias)) + (1 - alpha) * img[i];
    }
    if (e && e.a >= 4 && e.cx > -0.3 * e.a && e.cx < S + 0.3 * e.a && e.cy > -0.3 * e.a && e.cy < S + 0.3 * e.a) main = { cx: e.cx, cy: e.cy, a: e.a, b: e.b, phi: e.phi };
  }
  if (main) labels.push(main);
  overlays(bgImg);
  let img = boxBlur(bgImg, rand() < 0.5 ? Math.floor(U(1, 3)) : 0);
  const gamma = U(0.7, 1.4), contrast = U(0.6, 1.3), shift = U(-30, 30), noise = U(0.5, 9);
  for (let i = 0; i < img.length; i++) img[i] = Math.max(0, Math.min(255, 255 * Math.pow(Math.max(0, img[i]) / 255, gamma) * contrast + shift + noise * gauss()));
  if (rand() < 0.6) blocky(img, U(0.1, 0.6), Math.floor(U(1, 8)));
  const bytes = new Uint8Array(S * S);
  for (let i = 0; i < img.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(img[i])));
  return { bytes, labels: labels.map((l) => ({ cx: +l.cx.toFixed(2), cy: +l.cy.toFixed(2), a: +l.a.toFixed(2), b: +l.b.toFixed(2), phi: +l.phi.toFixed(4) })), main: !!main };
}

// ── PNG (grey) for the preview ───────────────────────────────────────────
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, grey) {
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; grey.subarray(y * w, (y + 1) * w).forEach((v, x) => { raw[y * (w + 1) + 1 + x] = v; }); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const samples = [];
for (let i = 0; i < N; i++) samples.push(sample());
if (PREVIEW) {
  const cols = 6, rows = Math.ceil(N / cols), W = cols * S, H = rows * S, grid = new Uint8Array(W * H);
  samples.forEach((sm, k) => {
    const ox = (k % cols) * S, oy = Math.floor(k / cols) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) grid[(oy + y) * W + ox + x] = sm.bytes[y * S + x];
    for (const [j, l] of sm.labels.entries()) for (let q = 0; q < 360; q++) { // the label outlines (white; the main plate's last, dashed)
      if (j === sm.labels.length - 1 && sm.main && q % 6 < 3) continue;
      const th = (q * Math.PI) / 180, u = l.a * Math.cos(th), w = l.b * Math.sin(th);
      const x = Math.round(l.cx + u * Math.cos(l.phi) - w * Math.sin(l.phi)), y = Math.round(l.cy + u * Math.sin(l.phi) + w * Math.cos(l.phi));
      if (x >= 0 && x < S && y >= 0 && y < S) grid[(oy + y) * W + ox + x] = 255;
    }
  });
  writeFileSync(PREVIEW, png(W, H, grid));
  console.log(`preview: ${N} pictures, ${samples.filter((s) => s.main).length} with the main plate in view → ${PREVIEW}`);
}
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  const all = new Uint8Array(N * S * S);
  samples.forEach((sm, k) => all.set(sm.bytes, k * S * S));
  writeFileSync(OUT + '.bin', all);
  writeFileSync(OUT + '.json', JSON.stringify({ size: S, n: N, labels: samples.map((s) => s.labels) }));
  console.log(`${OUT}: ${N} pictures, ${samples.reduce((n, s) => n + s.labels.length, 0)} plates`);
}
