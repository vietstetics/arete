// Dev server: serves the app on your Wi-Fi so the phone can send gym clips straight into test-videos/
// on this computer, where the heavy pose analysis runs (scripts/extract-poses.mjs) instead of on the phone.
//
//   npm run dev                 then open the printed link on the phone (same Wi-Fi)
//   PORT=8790 npm run dev       another port
//
// The app shows a Dev button (top right) only when it is loaded from this server. The printed link carries
// a pairing key; without it nothing can be listed, uploaded or analysed. Videos never leave this computer:
// test-videos/ is gitignored and is not served to the browser.
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir, stat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join, extname, basename, sep, relative } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve('.'), videosDir = resolve('test-videos'), posesDir = join(videosDir, '.poses');
const PORT = +process.env.PORT || 8787;
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const MAX_UPLOAD = 4 * 1024 ** 3; // 4 GB: a long 4K clip
const GUIDE = 'WHAT TO RECORD.txt';

// One key per computer, kept with the videos, so the phone stays paired across restarts.
await mkdir(videosDir, { recursive: true });
const keyFile = join(videosDir, '.devkey');
let KEY = (await readFile(keyFile, 'utf8').catch(() => '')).trim();
if (!/^[a-f0-9]{24}$/.test(KEY)) { KEY = randomBytes(12).toString('hex'); await writeFile(keyFile, KEY); }
const keyOk = (k) => typeof k === 'string' && k.length === KEY.length && timingSafeEqual(Buffer.from(k), Buffer.from(KEY));

// ---- Static app files (never the videos, sources of the server functions, or anything private) ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream', '.wasm': 'application/wasm' };
const BLOCKED_FILES = new Set(['package.json', 'package-lock.json', 'vercel.json', 'tsconfig.json', 'tsconfig.health.json']);
const BLOCKED_DIRS =new Set(['test-videos', 'node_modules', 'api', 'scripts', 'docs', 'backups', 'native', 'ios', 'android', 'www']);

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const parts = rel.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '') || BLOCKED_DIRS.has(parts[0]) || BLOCKED_FILES.has(rel) || !TYPES[extname(rel).toLowerCase()]) return send(res, 404, 'Not found');
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) return send(res, 404, 'Not found');
  const s = await stat(file).catch(() => null);
  if (!s || !s.isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()], 'Content-Length': s.size, 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

// ---- Folders and clips ----
const safeName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 120 && !n.startsWith('.') && !/[\\/:*?"<>|\x00-\x1f]/.test(n) && n.trim() === n;
async function folderPath(name) {
  if (!safeName(name)) return null;
  const p = join(videosDir, name);
  return (await stat(p).catch(() => null))?.isDirectory() ? p : null;
}
const posesFor = (folder, clip) => join(posesDir, folder, basename(clip, extname(clip)) + '.json');
const sheetFor = (folder, clip) => join(posesDir, 'sheets', `${folder} - ${basename(clip, extname(clip))}.jpg`);
const noteFor = (dir, clip) => join(dir, basename(clip, extname(clip)) + '.note.txt');

async function listFiles() {
  const folders = [];
  for (const d of (await readdir(videosDir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(videosDir, d.name);
    const names = await readdir(dir);
    const clips = [];
    for (const n of names.filter((n) => VIDEO.has(extname(n).toLowerCase())).sort()) {
      const s = await stat(join(dir, n));
      clips.push({
        name: n, size: s.size, added: s.mtimeMs,
        analysed: !!(await stat(posesFor(d.name, n)).catch(() => null)),
        sheet: !!(await stat(sheetFor(d.name, n)).catch(() => null)),
        note: (await readFile(noteFor(dir, n), 'utf8').catch(() => '')).trim(),
      });
    }
    const guide = names.includes(GUIDE) ? (await readFile(join(dir, GUIDE), 'utf8')).trim() : '';
    folders.push({ name: d.name, guide, clips });
  }
  return folders;
}

// ---- Pose analysis on this computer, one clip at a time ----
const jobs = []; // { id, folder, clip, state: queued|running|done|failed, log: [], started, ended }
let running = false;
function queueAnalysis(folder, clip) {
  const live = jobs.find((j) => j.folder === folder && j.clip === clip && (j.state === 'queued' || j.state === 'running'));
  if (live) return live;
  const job = { id: randomBytes(4).toString('hex'), folder, clip, state: 'queued', log: [] };
  jobs.push(job); if (jobs.length > 50) jobs.splice(0, jobs.length - 50);
  runNext();
  return job;
}
function runNext() {
  if (running) return;
  const job = jobs.find((j) => j.state === 'queued'); if (!job) return;
  running = true; job.state = 'running'; job.started = Date.now();
  const p = spawn(process.execPath, ['scripts/extract-poses.mjs', '--force', join(videosDir, job.folder, job.clip)], { cwd: root });
  const take = (b) => { for (const line of String(b).split(/\r?\n/)) if (line.trim()) { job.log.push(line.trim()); console.log(`  [${job.clip}] ${line.trim()}`); } if (job.log.length > 40) job.log.splice(0, job.log.length - 40); };
  p.stdout.on('data', take); p.stderr.on('data', take);
  p.on('close', (code) => {
    job.ended = Date.now();
    job.state = code === 0 && !job.log.some((l) => l.startsWith('error:')) ? 'done' : 'failed';
    running = false; runNext();
  });
}
const publicJob = (j) => ({ id: j.id, folder: j.folder, clip: j.clip, state: j.state, last: j.log[j.log.length - 1] || '', started: j.started, ended: j.ended });

// ---- HTTP ----
function send(res, code, body, type = 'text/plain; charset=utf-8') {
  const buf = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? type : 'application/json', 'Cache-Control': 'no-store' });
  res.end(buf);
}
async function readJson(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 100_000) throw new Error('too big'); }
  return JSON.parse(s || '{}');
}

async function api(req, res, url) {
  const route = url.pathname.slice('/__dev/'.length);
  const authed = keyOk(req.headers['x-dev-key'] || url.searchParams.get('key'));
  if (route === 'ping') return send(res, 200, { dev: true, paired: authed });
  if (!authed) return send(res, 401, { error: 'Not paired: open the link this computer printed.' });

  if (route === 'files' && req.method === 'GET') return send(res, 200, { folders: await listFiles(), jobs: jobs.map(publicJob) });

  if (route === 'folder' && req.method === 'POST') {
    const { name } = await readJson(req);
    if (!safeName(name) || name.length > 60) return send(res, 400, { error: 'Use letters, numbers and spaces (up to 60).' });
    await mkdir(join(videosDir, name), { recursive: true });
    return send(res, 200, { ok: true });
  }

  if (route === 'upload' && req.method === 'POST') {
    const dir = await folderPath(url.searchParams.get('folder'));
    let name = basename(url.searchParams.get('name') || '');
    if (!dir) return send(res, 400, { error: 'Pick a folder.' });
    if (!safeName(name) || !VIDEO.has(extname(name).toLowerCase())) return send(res, 400, { error: 'Only .mp4, .mov, .m4v or .webm videos.' });
    if (+req.headers['content-length'] > MAX_UPLOAD) return send(res, 413, { error: 'Over 4 GB.' });
    // Never overwrite: a clip with the same name gets " (2)", " (3)", …
    const stem = basename(name, extname(name)), ext = extname(name);
    for (let i = 2; await stat(join(dir, name)).catch(() => null); i++) name = `${stem} (${i})${ext}`;
    const part = join(dir, `.${name}.part`);
    let bytes = 0, tooBig = false;
    await new Promise((done, fail) => {
      const out = createWriteStream(part);
      req.on('data', (c) => { bytes += c.length; if (bytes > MAX_UPLOAD && !tooBig) { tooBig = true; req.unpipe(out); out.destroy(); req.resume(); fail(new Error('Over 4 GB.')); } });
      req.on('aborted', () => { out.destroy(); fail(new Error('Upload stopped.')); });
      out.on('error', fail); out.on('finish', done);
      req.pipe(out);
    }).catch(async (e) => { await rm(part, { force: true }); throw e; });
    await rename(part, join(dir, name));
    const note = (url.searchParams.get('note') || '').slice(0, 2000).trim();
    if (note) await writeFile(noteFor(dir, name), note + '\n');
    const folder = basename(dir);
    console.log(`Added ${folder}/${name} (${(bytes / 1024 ** 2).toFixed(1)} MB)`);
    const job = url.searchParams.get('analyse') === '1' ? queueAnalysis(folder, name) : null;
    return send(res, 200, { ok: true, name, job: job && publicJob(job) });
  }

  if (route === 'note' && req.method === 'POST') {
    const { folder, clip, text } = await readJson(req);
    const dir = await folderPath(folder);
    if (!dir || !safeName(clip) || !(await stat(join(dir, clip)).catch(() => null))) return send(res, 404, { error: 'No such clip.' });
    const t = String(text || '').slice(0, 2000).trim();
    if (t) await writeFile(noteFor(dir, clip), t + '\n'); else await rm(noteFor(dir, clip), { force: true });
    return send(res, 200, { ok: true });
  }

  if (route === 'analyse' && req.method === 'POST') {
    const { folder, clip } = await readJson(req);
    const dir = await folderPath(folder);
    if (!dir || !safeName(clip) || !(await stat(join(dir, clip)).catch(() => null))) return send(res, 404, { error: 'No such clip.' });
    return send(res, 200, { job: publicJob(queueAnalysis(folder, clip)) });
  }

  if (route === 'sheet' && req.method === 'GET') {
    const folder = url.searchParams.get('folder'), clip = url.searchParams.get('clip');
    if (!(await folderPath(folder)) || !safeName(clip)) return send(res, 404, 'Not found');
    const f = sheetFor(folder, clip);
    const s = await stat(f).catch(() => null);
    if (!s) return send(res, 404, 'Not analysed yet');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': s.size, 'Cache-Control': 'no-store' });
    return createReadStream(f).pipe(res);
  }

  return send(res, 404, { error: 'Unknown' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/__dev/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message || 'Failed' }); else res.destroy();
  }
});
server.requestTimeout = 0; // big uploads over Wi-Fi take minutes
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\nArete dev server — videos go to ${relative(root, videosDir) || videosDir}/\n`);
  console.log(`On your phone (same Wi-Fi), open:`);
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/?devkey=${KEY}`);
  console.log(`\nOn this computer: http://localhost:${PORT}/?devkey=${KEY}`);
  console.log(`Keep the key private: anyone with it on your Wi-Fi can add videos. Ctrl+C to stop.\n`);
});
