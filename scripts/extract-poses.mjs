// Runs the pose and hand models once over each test clip and saves every landmark, so trackers can be
// tuned and tested on real footage in seconds (scripts/evaluate-trackers.mjs) instead of re-running
// the models each time. Also saves a contact sheet per clip (frames with the skeleton drawn on) to
// check the camera angle and whether the model is following the lifter.
//
//   node scripts/extract-poses.mjs                  every clip that has no cache yet
//   node scripts/extract-poses.mjs curl fly         just these folders
//   node scripts/extract-poses.mjs --force curl     redo even if cached
//   node scripts/extract-poses.mjs --fps 30         samples per second (default 30)
//
// Output: test-videos/.poses/<folder>/<clip>.json and test-videos/.poses/sheets/<folder> - <clip>.jpg
// test-videos is private and gitignored: these files never leave the computer.
// Needs Chrome or Edge (CHROME_PATH to override) and an internet connection for the models.
import { createServer } from 'node:http';
import { access, readFile, readdir, stat, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep, join, basename, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const root = resolve('.'), videosDir = resolve('test-videos'), outDir = join(videosDir, '.poses');
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const FPS = Math.max(10, Math.min(60, +(flag('--fps') ?? 30) || 30));
const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);

async function findClips(list) {
  const out = [];
  const walk = async (p) => {
    const s = await stat(p).catch(() => null); if (!s) { console.warn('Not found:', p); return; }
    if (s.isFile()) { if (VIDEO.has(extname(p).toLowerCase())) out.push(p); return; }
    if (basename(p).startsWith('.')) return;
    for (const f of (await readdir(p)).sort()) await walk(join(p, f));
  };
  if (!list.length) await walk(videosDir);
  for (const a of list) await walk(a.includes('/') || a.includes('\\') ? resolve(a) : join(videosDir, a));
  return out;
}
export const cachePath = (clip) => { const rel = relative(videosDir, clip); return join(outDir, dirname(rel), basename(rel, extname(rel)) + '.json'); };

const clips = [];
for (const c of await findClips(args)) {
  if (!force && (await stat(cachePath(c)).catch(() => null))) continue;
  clips.push(c);
}
if (!clips.length) { console.log('Every clip already has landmarks (use --force to redo).'); process.exit(0); }

const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
let executablePath;
for (const p of candidates) { try { await access(p); executablePath = p; break; } catch {} }
if (!executablePath) throw new Error('Set CHROME_PATH to a local Chrome or Edge.');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>extract</title><input type="file" id="f">'); return; }
  res.writeHead(404); res.end();
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'arete-extract-'));
const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, protocolTimeout: 0, args: ['--autoplay-policy=no-user-gesture-required', '--disk-cache-size=1048576', '--media-cache-size=1048576'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'log') console.log('  ' + m.text()); });
  await page.goto(origin + '/__blank');
  console.log('Loading the pose and hand models…');
  await page.evaluate(async () => {
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const { PoseLandmarker, HandLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    window.lm = await PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 2 });
    window.hl = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 });
    window.ts = 0;
  });
  for (const clip of clips) {
    const rel = relative(videosDir, clip);
    const t0 = Date.now();
    console.log(`${rel} …`);
    await (await page.$('#f')).uploadFile(clip);
    const r = await page.evaluate(async (fps) => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = URL.createObjectURL(document.getElementById('f').files[0]);
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('this browser can’t decode the video')); });
      const vw = v.videoWidth, vh = v.videoHeight, scale = Math.min(1, 1280 / Math.max(vw, vh));
      const cv = document.createElement('canvas'); cv.width = Math.round(vw * scale); cv.height = Math.round(vh * scale);
      const cx = cv.getContext('2d', { willReadFrequently: false });
      const r4 = (x) => Math.round(x * 1e4) / 1e4;
      const frames = [], sheet = [];
      const sheetAt = Array.from({ length: 12 }, (_, i) => (v.duration * (i + 0.5)) / 12);
      // Every 1/fps s of video: seek, draw the frame, run both models, keep everything.
      const grab = (mt) => {
        {
          cx.drawImage(v, 0, 0, cv.width, cv.height);
          window.ts = Math.max(window.ts + 1, Math.round(mt * 1000) + window.base);
          const p = window.lm.detectForVideo(cv, window.ts), h = window.hl.detectForVideo(cv, window.ts);
          const poses = (p.landmarks || []).map((lmk, i) => ({
            lm: lmk.map((q) => [r4(q.x), r4(q.y), r4(q.z), r4(q.visibility ?? 0)]),
            w: ((p.worldLandmarks || [])[i] || []).map((q) => [r4(q.x), r4(q.y), r4(q.z)]),
          }));
          const hands = (h.landmarks || []).map((lmk, i) => ({
            lm: lmk.map((q) => [r4(q.x), r4(q.y), r4(q.z)]),
            side: h.handedness?.[i]?.[0]?.categoryName || '', score: r4(h.handedness?.[i]?.[0]?.score || 0),
          }));
          frames.push({ t: r4(mt), poses, hands });
          if (sheet.length < sheetAt.length && mt >= sheetAt[sheet.length]) {
            // A small frame with the skeleton for the contact sheet.
            const s = document.createElement('canvas'); s.width = 360; s.height = Math.round((360 * cv.height) / cv.width);
            const c = s.getContext('2d'); c.drawImage(cv, 0, 0, s.width, s.height);
            const E = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];
            poses.forEach((ps, k) => {
              c.lineWidth = 2; c.strokeStyle = k ? '#ff3b30' : '#34c759';
              for (const [a, b] of E) { const A = ps.lm[a], B = ps.lm[b]; if (Math.min(A[3], B[3]) < 0.3) continue; c.beginPath(); c.moveTo(A[0] * s.width, A[1] * s.height); c.lineTo(B[0] * s.width, B[1] * s.height); c.stroke(); }
              c.fillStyle = '#0a84ff'; for (const i of [15, 16]) { const A = ps.lm[i]; c.fillRect(A[0] * s.width - 3, A[1] * s.height - 3, 6, 6); }
            });
            c.fillStyle = '#ffd60a'; hands.forEach((hd) => hd.lm.forEach((q) => c.fillRect(q[0] * s.width - 1, q[1] * s.height - 1, 2, 2)));
            c.fillStyle = '#000a'; c.fillRect(0, 0, 70, 20); c.fillStyle = '#fff'; c.font = '14px sans-serif'; c.fillText(mt.toFixed(1) + ' s', 6, 15);
            sheet.push(s);
          }
        }
      };
      window.base = (window.base || 0) + 10_000_000; // models need rising timestamps across clips
      const t0 = performance.now();
      for (let t = 0.02; t < v.duration - 0.01; t += 1 / fps) {
        await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; });
        grab(v.currentTime);
      }
      URL.revokeObjectURL(v.src);
      // Contact sheet: 4 columns.
      let jpg = null;
      if (sheet.length) {
        const W = sheet[0].width, H = sheet[0].height, cols = 4, rows = Math.ceil(sheet.length / cols);
        const all = document.createElement('canvas'); all.width = W * cols; all.height = H * rows;
        const c = all.getContext('2d'); sheet.forEach((s, i) => c.drawImage(s, (i % cols) * W, Math.floor(i / cols) * H));
        jpg = all.toDataURL('image/jpeg', 0.7);
      }
      const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
      return { vw, vh, duration: v.duration, fps, frames, jpg, wall: (performance.now() - t0) / 1000, maxGap: Math.max(0, ...gaps) };
    }, FPS).catch((err) => ({ error: err.message }));
    if (r.error) { console.log(`  error: ${r.error}`); continue; }
    const out = cachePath(clip); await mkdir(dirname(out), { recursive: true });
    const { jpg, ...data } = r;
    await writeFile(out, JSON.stringify({ clip: rel.split(sep).join('/'), ...data }));
    if (jpg) { const sd = join(outDir, 'sheets'); await mkdir(sd, { recursive: true }); await writeFile(join(sd, rel.split(sep).join(' - ').replace(extname(rel), '.jpg')), Buffer.from(jpg.split(',')[1], 'base64')); }
    const seen = r.frames.filter((f) => f.poses.length).length;
    console.log(`  ${r.frames.length} frames (${(r.frames.length / r.duration).toFixed(1)}/s, biggest gap ${(r.maxGap * 1000).toFixed(0)} ms), body seen in ${Math.round((100 * seen) / Math.max(1, r.frames.length))}% · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
