// Local-only smoke test against the optional upstream sample video.
// Its pixels are never bundled with the application and are not a velocity reference.
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = process.cwd(), videoPath = 'vendor/barbell-path-tracker/Video/LuXiaojun.mp4';
const frameOnly = process.argv.includes('--frame-only');
const outputDir = resolve(root, 'backups');
await stat(resolve(root, videoPath));
await mkdir(outputDir, { recursive: true });
// Chosen once by visual inspection of the first decoded source image: the
// complete near red plate. Not selected or changed by a tracking-success search.
const sourceBox = { x: 675, y: 180, w: 240, h: 240 };
const decodeFallback = String.raw`
import cv2,json,math,pathlib,sys
source,out=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2])
out.mkdir(parents=True,exist_ok=True)
cap=cv2.VideoCapture(str(source))
if not cap.isOpened(): raise RuntimeError('OpenCV could not open the local sample video')
manifest={'decoder':'OpenCV local fallback','width':int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),'height':int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),'nominalFps':cap.get(cv2.CAP_PROP_FPS),'frames':[]}
index=0;next_sample=0;last=-1
while True:
    ok,frame=cap.read()
    if not ok: break
    t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
    if not math.isfinite(t): raise RuntimeError('Decoder returned no finite frame timestamp')
    if index==0: cv2.imwrite(str(out.parent/'template-real-video-first-frame.png'),frame)
    if t>=next_sample-1e-8 and t>last:
        scale=min(1,480/max(frame.shape[1],frame.shape[0]))
        small=cv2.resize(frame,(round(frame.shape[1]*scale),round(frame.shape[0]*scale)),interpolation=cv2.INTER_AREA)
        gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
        name=f'frame-{len(manifest["frames"]):04d}.bin'
        (out/name).write_bytes(gray.tobytes())
        manifest['frames'].append({'t':t,'file':name,'sourceIndex':index})
        manifest['w'],manifest['h']=gray.shape[1],gray.shape[0]
        last=t;next_sample+=1/24
    index+=1
cap.release()
manifest['decodedFrames']=index;manifest['duration']=last
(out/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
print(json.dumps({k:v for k,v in manifest.items() if k!='frames'}))
`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__target_video_test') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Local template video smoke</title><style>body{margin:0;background:#111}canvas{display:block;max-width:100%;height:auto}video{display:none}</style><video id="source" muted preload="auto" playsinline></video><canvas id="frame"></canvas>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp4': 'video/mp4' })[extname(path)] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) { res.writeHead(416).end(); return; }
      const start = +match[1], end = match[2] ? Math.min(+match[2], data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) { res.writeHead(416).end(); return; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
      res.end(data.subarray(start, end + 1)); return;
    }
    res.setHeader('Content-Length', data.length); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  // Puppeteer creates and removes its own isolated temporary browser profile.
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const base = `http://127.0.0.1:${server.address().port}`, page = await browser.newPage(), errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (request) => request.url().startsWith(base) ? request.continue() : request.abort());
  await page.goto(`${base}/__target_video_test`);
  let decodeFailure = null;
  let metadata;
  try { metadata = await page.evaluate(async (url) => {
    const video = document.getElementById('source');
    await new Promise((done, reject) => {
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', () => reject(new Error(`Video decode failed: ${video.error?.message || video.error?.code}`)), { once: true });
      video.src = url;
    });
    const cv = document.getElementById('frame'); cv.width = video.videoWidth; cv.height = video.videoHeight;
    cv.getContext('2d').drawImage(video, 0, 0);
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, time: video.currentTime };
  }, `${base}/${videoPath}`); }
  catch (error) { decodeFailure = error.message; }
  // The upstream MP4 uses a codec this Chromium build cannot decode. Optional
  // local OpenCV decodes actual frame pixels/timestamps without transcoding or
  // distributing the media into the application. Browser code still tracks them.
  const python = process.env.BARBELLCV_PYTHON || resolve(root, 'backups/barbellcv-venv/Scripts/python.exe');
  const decoded = spawnSync(python, ['-c', decodeFallback, resolve(root, videoPath), resolve(outputDir, 'template-real-video-frames')], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (decoded.error || decoded.status !== 0) throw new Error(`Local frame decoding unavailable: ${decoded.error?.message || decoded.stderr}. Install the optional Python environment from docs/barbellcv-local.md.`);
  const manifest = JSON.parse(await readFile(resolve(outputDir, 'template-real-video-frames/manifest.json'), 'utf8'));
  metadata = { ...metadata, width: manifest.width, height: manifest.height, duration: manifest.duration, decoder: manifest.decoder,
    decodedFrames: manifest.decodedFrames, sampledFrames: manifest.frames.length, browserDecodeFailure: decodeFailure };
  assert.ok(metadata.width > 0 && metadata.height > 0 && metadata.duration > 0);
  console.log(JSON.stringify({ media: videoPath, ...metadata, firstFrame: 'backups/template-real-video-first-frame.png' }));
  if (!frameOnly) {
    const result = await page.evaluate(async ({ base, manifest, sourceBox }) => {
      const { createTargetSession } = await import('/features/velocity/services/live/targetSession.js');
      const { boxFromPoints } = await import('/features/velocity/services/live/targetSelection.js');
      const sx = manifest.w / manifest.width, sy = manifest.h / manifest.height;
      const box = boxFromPoints({ x: sourceBox.x * sx, y: sourceBox.y * sy },
        { x: (sourceBox.x + sourceBox.w) * sx, y: (sourceBox.y + sourceBox.h) * sy }, { vw: manifest.w, vh: manifest.h });
      const session = createTargetSession(), durations = [], activeDurations = [], results = [];
      let initialized = false, lastPixels;
      for (const frame of manifest.frames) {
        const response = await fetch(`${base}/backups/template-real-video-frames/${frame.file}`);
        if (!response.ok) throw new Error(`Frame unavailable: ${frame.file}`);
        const data = new Uint8Array(await response.arrayBuffer()); lastPixels = data;
        const image = { w: manifest.w, h: manifest.h, data: Float32Array.from(data) };
        const wasExpired = session.state === 'expired', before = performance.now();
        const result = initialized ? session.track(image, frame.t) : session.init(image, box, frame.t);
        const elapsed = performance.now() - before; durations.push(elapsed);
        if (!wasExpired) activeDurations.push(elapsed);
        if (!initialized && !result.ok) throw new Error(`The manually chosen plate ROI could not initialize: ${result.reason}`);
        initialized = true; results.push({ t: frame.t, ok: result.ok, score: result.score, reason: result.reason, cx: result.cx, cy: result.cy });
      }
      const final = session.finish(), ok = results.filter((r) => r.ok), sorted = [...durations].sort((a, b) => a - b);
      const activeSorted = [...activeDurations].sort((a, b) => a - b);
      const intervals = manifest.frames.slice(1).map((f, i) => f.t - manifest.frames[i].t).sort((a, b) => a - b);
      const canvas = document.getElementById('frame'); canvas.width = manifest.w; canvas.height = manifest.h;
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(manifest.w, manifest.h);
      for (let i = 0; i < lastPixels.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = lastPixels[i]; pixels.data[i * 4 + 3] = 255; }
      ctx.putImageData(pixels, 0, 0); ctx.strokeStyle = '#58db3d'; ctx.lineWidth = 2; ctx.beginPath();
      let pen = false;
      for (const r of results) { if (!r.ok) { pen = false; continue; } if (pen) ctx.lineTo(r.cx, r.cy); else ctx.moveTo(r.cx, r.cy); pen = true; }
      ctx.stroke();
      const failures = Object.fromEntries([...new Set(results.filter((r) => !r.ok).map((r) => r.reason))].map((reason) => [reason, results.filter((r) => r.reason === reason).length]));
      return { sourceBox, analysisBox: box, frame: { width: manifest.w, height: manifest.h }, attempted: results.length,
        observed: ok.length, trackingAvailability: ok.length / results.length, initialized, finalState: session.state,
        trackingOutcome: final.quality.trackingAccepted ? 'accepted template tracking (position accuracy unverified)' : 'unreliable tracking; no complete-set accuracy demonstrated',
        medianSampleFps: 1 / intervals[intervals.length >> 1], trackerRuntimeMs: { median: sorted[sorted.length >> 1], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], total: durations.reduce((a, b) => a + b, 0) },
        activeTrackerRuntimeMs: { calls: activeSorted.length, median: activeSorted[activeSorted.length >> 1], p95: activeSorted[Math.min(activeSorted.length - 1, Math.floor(activeSorted.length * 0.95))], total: activeDurations.reduce((a, b) => a + b, 0) },
        firstLossTime: results.find((r) => !r.ok)?.t ?? null, lastObservedTime: ok.at(-1)?.t ?? null,
        failures, quality: final.quality, detectedIntervals: final.metrics.reps.map((r) => ({ ok: r.ok, tStart: r.tStart, tEnd: r.tEnd, why: r.why })),
        limitations: ['Availability means accepted template matches, not independently verified target identity or position accuracy.',
          'No reference velocity/displacement, camera calibration, pose count or anatomical ROM labels are provided.',
          'Desktop headless runtime excludes decoding/network; it is not a phone performance benchmark.',
          'ROI was manually selected once from the first source frame; thresholds and ROI were not tuned to the tracking result.',
          'Original source media remains in the ignored local vendor clone; decoded frames and report remain in ignored backups.'] };
    }, { base, manifest, sourceBox });
    assert.equal(result.initialized, true); assert.ok(result.attempted > 21);
    await (await page.$('#frame')).screenshot({ path: resolve(outputDir, 'template-real-video-tracking.png') });
    await writeFile(resolve(outputDir, 'template-real-video-report.json'), JSON.stringify({ media: videoPath, ...metadata, ...result }, null, 2));
    console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
