// Which lift is in each of your test videos? Runs the pose model on every clip in test-videos/
// (or the folders / files you name), recognises the lift in the body's own frame
// (features/standard/services/bodyPlanes.js) and checks it against the folder it's in.
//
//   node scripts/recognise-videos.mjs                 every folder
//   node scripts/recognise-videos.mjs raise curl      just these folders
//   node scripts/recognise-videos.mjs --fps 30 curl   more frames per second (more accurate speed, slower)
//   node scripts/recognise-videos.mjs "test-videos/raise/front_lying_heavy.mp4"
//
// Writes test-videos/recognition-report.md (test-videos is private: never uploaded).
// Needs Chrome or Edge (CHROME_PATH to override) and an internet connection for the pose model.
import { createServer } from 'node:http';
import { access, readFile, readdir, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep, join, basename, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const root = resolve('.'), videosDir = resolve('test-videos');
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm']);
// Frames looked at per second of video (--fps 30 for the most accurate speeds; slower to run).
const fpsArg = process.argv.indexOf('--fps');
const FPS = fpsArg > 0 ? Math.max(5, Math.min(60, +process.argv[fpsArg + 1] || 15)) : 15;
if (fpsArg > 0) process.argv.splice(fpsArg, 2);

// What each folder should be recognised as (folder names from test-videos/). [] = not covered yet.
const EXPECT = {
  'squat': ['squat'], 'leg press': ['squat'], 'deadlifts': ['hinge'], 'hip extension': ['hinge'],
  'leg extension and leg curl': ['knee-isolation'], 'bench': ['horizontal-push-pull'], 'row': ['horizontal-push-pull'],
  'shoulder press': ['vertical-push-pull'], 'dip': ['vertical-push-pull'], 'pull up': ['vertical-push-pull'],
  'fly': ['fly'], 'pullover': ['pullover'], 'curl': ['curl'], 'triceps': ['triceps-extension'],
  'raise': ['front-raise', 'lateral-raise', 'scaption-raise', 'raise'],
  'calf raise': [], 'hip adduction and abduction': [], 'shrug': [], 'core': [], 'wrist neck and rotation': [],
};

async function findClips(args) {
  const out = [];
  const walk = async (p) => {
    const s = await stat(p).catch(() => null); if (!s) { console.warn('Not found:', p); return; }
    if (s.isFile()) { if (VIDEO.has(extname(p).toLowerCase())) out.push(p); return; }
    for (const f of (await readdir(p)).sort()) await walk(join(p, f));
  };
  if (!args.length) await walk(videosDir);
  for (const a of args) await walk(a.includes('/') || a.includes('\\') ? resolve(a) : join(videosDir, a));
  return out;
}

const clips = await findClips(process.argv.slice(2));
if (!clips.length) { console.log('No videos found in test-videos/. Put clips in its folders, then run this again.'); process.exit(0); }

const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
let executablePath;
for (const p of candidates) { try { await access(p); executablePath = p; break; } catch {} }
if (!executablePath) throw new Error('Set CHROME_PATH to a local Chrome or Edge.');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>recognise</title><input type="file" id="f">'); return; }
  try {
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'arete-recognise-'));
const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, protocolTimeout: 1800000 });
const rows = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('page error:', e.message));
  await page.goto(origin + '/__blank');
  console.log('Loading the pose model…');
  await page.evaluate(async () => {
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const { PoseLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    window.lm = await PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 2 });
    // The hand model: a second opinion on where each hand is when the body model's wrist is unsure.
    window.hl = await (await import(`${MP}/vision_bundle.mjs`)).HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2 });
    window.bp = await import('/features/standard/services/bodyPlanes.js');
    window.ht = await import('/features/velocity/services/handTrack.js');
    window.ts = 0;
  });
  for (const clip of clips) {
    const rel = relative(videosDir, clip), folder = (dirname(rel) === '.' ? '' : dirname(rel).split(sep)[0]).toLowerCase();
    process.stdout.write(`${rel} … `);
    await (await page.$('#f')).uploadFile(clip);
    const r = await page.evaluate(async (fps) => {
      const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(document.getElementById('f').files[0]);
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('this browser can’t decode the video')); });
      const frames = [], vw = v.videoWidth, vh = v.videoHeight, hands = { L: [], R: [] }, mpps = [];
      for (let t = 0.05; t < v.duration; t += 1 / fps) {
        await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; });
        window.ts += Math.round(1000 / fps);
        const res = window.lm.detectForVideo(v, window.ts);
        const ps = res.landmarks || [];
        // Palms the hand model sees (centre of wrist and knuckles), in pixels.
        const hr = window.hl.detectForVideo(v, window.ts);
        const palms = (hr.landmarks || []).map((h) => { const k = [0, 5, 9, 13, 17]; return { x: k.reduce((s, i) => s + h[i].x, 0) / 5 * vw, y: k.reduce((s, i) => s + h[i].y, 0) / 5 * vh, conf: 0.8, src: 'hand' }; });
        if (!ps.length) { frames.push(null); hands.L.push({ t, cands: palms }); hands.R.push({ t, cands: palms }); continue; }
        // The lifter: the biggest torso in the picture.
        const size = (p) => Math.abs(p[11].y - p[23].y) * vh + Math.abs(p[11].x - p[12].x) * vw;
        let k = 0; ps.forEach((p, i) => { if (size(p) > size(ps[k])) k = i; });
        const P = ps[k], Wd = (res.worldLandmarks || [])[k] || null;
        frames.push(window.bp.bodyAngles(P, Wd, { vw, vh }));
        const m = window.ht.metresPerPxFromBody(P, Wd, vw, vh); if (Number.isFinite(m)) mpps.push(m);
        // Each side: its wrist from the body model, plus any palm nearer that wrist than the other one.
        const wr = { L: P[15], R: P[16] };
        for (const sd of ['L', 'R']) {
          const me = wr[sd], other = wr[sd === 'L' ? 'R' : 'L'];
          const cands = [{ x: me.x * vw, y: me.y * vh, conf: me.visibility ?? 0.5, src: 'pose' }];
          for (const h of palms) { const dm = Math.hypot(h.x - me.x * vw, h.y - me.y * vh), dO = Math.hypot(h.x - other.x * vw, h.y - other.y * vh); if (dm <= dO) cands.push(h); }
          hands[sd].push({ t, cands });
        }
      }
      URL.revokeObjectURL(v.src);
      const result = window.bp.classifyMovement(frames, { smooth: Math.max(1, Math.round(fps / 6)) }); // ≈ ±1/6 s
      // Hand speed: the hand that travels further; lifts that lower first measure the way back up.
      const mpp = mpps.length ? mpps.sort((a, b) => a - b)[Math.floor(mpps.length / 2)] : NaN;
      let hand = null;
      if (Number.isFinite(mpp)) {
        const runs = ['L', 'R'].map((sd) => { const tr = window.ht.fuseHand(hands[sd]); const path = window.ht.handVelocity(tr, mpp);
          const r = window.ht.handReps(path, { concentricFirst: !['squat'].includes(result.family) });
          const n = tr.length || 1, c = (st) => tr.filter((p) => p.state === st).length / n;
          const xs = path.filter((p) => Number.isFinite(p.x)), span = xs.length ? Math.hypot(Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x)), Math.max(...xs.map((p) => p.y)) - Math.min(...xs.map((p) => p.y))) : 0;
          return { side: sd === 'L' ? 'left' : 'right', reps: r.reps, measured: c('measured'), bridged: c('bridged'), lost: c('lost'), span }; });
        hand = runs[0].span >= runs[1].span ? runs[0] : runs[1];
      }
      return { secs: +v.duration.toFixed(1), seen: frames.filter(Boolean).length, total: frames.length, result, hand, mpp };
    }, FPS).catch((err) => ({ error: err.message }));
    const want = EXPECT[folder];
    const verdict = r.error ? 'error' : !want ? 'no folder rule' : !want.length ? 'not covered yet' : want.includes(r.result.family) ? 'match' : 'MISMATCH';
    rows.push({ rel, folder, r, verdict });
    const hs = r.hand ? r.hand.reps.map((x) => (x.ok ? x.mcv.toFixed(2) : '?')).join(' ') : '';
    console.log(r.error ? `error: ${r.error}` : `${r.result.label} · ${r.result.posture} · ${r.result.reps} reps · ${verdict}${r.hand ? ` · hand m/s: ${hs || 'no reps'} (seen ${Math.round(r.hand.measured * 100)}%, estimated ${Math.round(r.hand.bridged * 100)}%, lost ${Math.round(r.hand.lost * 100)}%)` : ''}`);
  }
} finally {
  await browser.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const count = (v) => rows.filter((x) => x.verdict === v).length;
const md = [
  `# Lift recognition report`,
  ``,
  `${new Date().toLocaleString()} · ${rows.length} clips · **${count('match')} match**, **${count('MISMATCH')} mismatch**, ${count('not covered yet')} not covered yet, ${count('error')} errors.`,
  ``,
  `Recognised in the body's own frame, so the same lift reads the same standing, inclined or lying. "Plane" is the direction the limb moves relative to the body. Ranges are degrees of movement (elev = arm raise, plane = arm direction, elbow, hip, knee). Rep counts are a rough cycle count, not the app's rep standard.`,
  ``,
  `Hand speed: mean concentric velocity (m/s) of each rep from the hand that travels furthest, measured in the picture's plane (film side-on to the movement), scaled by your torso. "?" = that rep's hand was hidden too long to measure. Hand seen / estimated / lost = share of frames. Camera estimates until checked against a velocity device.`,
  ``,
  `| Clip | Recognised | Posture | Plane | Reps | Seen | Ranges (elev/plane/elbow/hip/knee) | Hand m/s per rep (peak) | Hand seen / est. / lost | Verdict |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map(({ rel, r, verdict }) => r.error
    ? `| ${esc(rel)} | error: ${esc(r.error)} | | | | | | | | error |`
    : `| ${esc(rel)} | ${esc(r.result.label)} | ${esc(r.result.posture)} | ${esc(r.result.plane)} | ${r.result.reps} | ${Math.round((100 * r.seen) / Math.max(1, r.total))}% of ${r.secs}s${r.result.three ? '' : ' (2D)'} | ${['elev', 'plane', 'elbow', 'hip', 'knee'].map((k) => r.result.ranges?.[k] ?? '–').join(' / ')} | ${r.hand ? (r.hand.reps.map((x) => (x.ok ? `${x.mcv.toFixed(2)} (${x.peak.toFixed(2)})` : '?')).join(', ') || 'no reps') : '–'} | ${r.hand ? [r.hand.measured, r.hand.bridged, r.hand.lost].map((x) => Math.round(x * 100) + '%').join(' / ') : '–'} | ${verdict} |`),
  ``,
];
await writeFile(join(videosDir, 'recognition-report.md'), md.join('\n'));
console.log(`\n${count('match')} match, ${count('MISMATCH')} mismatch, ${count('not covered yet')} not covered yet. Report: test-videos/recognition-report.md`);
