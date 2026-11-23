// Chain mode end to end in an isolated headless browser: one camera session (demo frames) fills two
// workout sets, rests between them, and the logger shows speed set to set. No real camera or account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const root = resolve('.');
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
let executablePath;
for (const path of candidates) { try { await access(path); executablePath = path; break; } catch {} }
if (!executablePath) throw new Error('Set CHROME_PATH to a local Chrome or Edge binary to run this test.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.task': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'arete-chain-smoke-'));
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (r) => r.url().startsWith(origin) || r.url().startsWith('data:') || r.url().startsWith('blob:') ? r.continue() : r.abort());
  await page.evaluateOnNewDocument(() => { let auth; Object.defineProperty(window, 'Auth', { configurable: true, get: () => auth, set: (v) => { auth = v; if (v?.CFG) { v.CFG.url = ''; v.CFG.anonKey = ''; } } }); });
  await page.evaluateOnNewDocument(() => localStorage.setItem('arete_session', JSON.stringify({ email: 'chain@example.invalid', at: Date.now() })));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/workouts.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('arete_session', JSON.stringify({ email: 'chain@example.invalid', at: Date.now() }));
    localStorage.setItem('jarvis_workouts', '[]');
    localStorage.setItem('arete_lab_height_cm', '178');
    localStorage.setItem('jarvis_rest_secs', '90');
    localStorage.setItem('jarvis_active_workout', JSON.stringify({ id: 'cw', name: 'Chain', startedAt: Date.now(), exercises: [
      { id: 'ce', name: 'Back Squat', sets: [{ id: 'c1', type: 'working', weight: 100, reps: '', completed: false }, { id: 'c2', type: 'working', weight: 100, reps: '', completed: false }] }] }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const url = await page.evaluate(async () => {
    const t = await import('./features/velocity/services/workout.js');
    const w = JSON.parse(localStorage.getItem('jarvis_active_workout'));
    const u = t.prepareWorkoutTracking(w, 'ce', 'c1', { chain: true });
    localStorage.setItem('jarvis_active_workout', JSON.stringify(w));
    return u;
  });
  await page.goto(`${origin}/${url}&demo=1&reps=3&quick=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start-btn:not([disabled])', { timeout: 60000 });
  await page.click('#start-btn');
  await page.waitForFunction(() => !document.getElementById('rest').hidden, { timeout: 60000 });
  const rest = await page.evaluate(() => ({ last: document.getElementById('rest-last').textContent, next: document.getElementById('rest-next').textContent, kg: document.getElementById('rest-kg').value }));
  console.log('rest screen:', rest);
  assert.match(rest.last, /^Set 1 saved: \d+ reps/);
  assert.equal(rest.next, 'Next: set 2'); assert.equal(rest.kg, '100');
  await page.waitForFunction(() => document.getElementById('rest').hidden, { timeout: 60000 });
  console.log('rest screen hid when set 2 started');
  await page.waitForFunction(() => !document.getElementById('done').hidden, { timeout: 90000 });
  const sets = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis_active_workout')).exercises[0].sets);
  console.log('sets:', sets.map((s) => ({ id: s.id, reps: s.reps, completed: s.completed, units: s.velocity?.units, rest: s.restSec, chainTicked: s.chainTicked })));
  assert.equal(sets.length, 2, 'no extra set rows');
  for (const s of sets) { assert.equal(s.completed, true); assert.ok(s.reps > 0); assert.ok(s.velocity); assert.equal(s.chainTicked, true); }
  assert.notEqual(sets[0].velocity.id, sets[1].velocity.id);
  assert.ok(sets[1].restSec > 5, 'rest between sets measured by the camera');
  await page.goto(`${origin}/workouts.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.fat');
  const fat = await page.$eval('.fat', (el) => el.textContent.replace(/\s+/g, ' '));
  console.log('fatigue block:', fat.trim());
  assert.match(fat, /Speed set to set/); assert.match(fat, /Set 1.*Set 2/);
  assert.ok(await page.evaluate(() => +localStorage.getItem('arete_rest_end') > Date.now()), 'rest timer running after return');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
  await page.screenshot({ path: join(tmpdir(), 'arete-chain-logger.png') });
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: one camera session filled 2 sets with rest between, ticked them, and the logger shows speed set to set.');
} finally {
  await browser?.close(); server.close(); await rm(profile, { recursive: true, force: true }).catch(() => {});
}
