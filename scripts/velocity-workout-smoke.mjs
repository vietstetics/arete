// End-to-end logger handoff smoke test in an isolated headless browser.
// Does not use a real camera or the user's browser/profile/storage.
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
if (!executablePath) throw new Error('Set CHROME_PATH to a local Chrome or Edge binary to run this smoke test.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
const profile = await mkdtemp(join(tmpdir(), 'arete-workout-smoke-'));
let browser;
try {
  console.log('Launching isolated headless browser...');
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile });
  console.log('Browser ready; loading workout logger...');
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  // Remote fonts, model downloads and services are unnecessary for logger tests.
  await page.setRequestInterception(true);
  page.on('request', (request) => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => localStorage.setItem('arete_session', JSON.stringify({ email: 'smoke@example.invalid', at: Date.now() })));
  const errors = [];
  page.on('pageerror', (error) => { if (page.url().includes('workouts.html')) { errors.push(error.message); console.log('Workout browser error:', error.message); } });
  await page.goto(`${origin}/workouts.html`, { waitUntil: 'networkidle0' });
  console.log('Logger loaded; preparing active workout...');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jarvis_workouts', '[]');
    localStorage.setItem('jarvis_active_workout', JSON.stringify({ id: 'smoke-w', name: 'Camera smoke', startedAt: Date.now(), notes: 'keep notes', exercises: [
      { id: 'smoke-e', name: 'Bench Press', sets: [{ id: 'smoke-s', type: 'working', weight: 80, reps: '', rir: 2, completed: false }] },
      { id: 'unsupported-e', name: 'Deadlift', sets: [{ id: 'unsupported-s', type: 'working', weight: '', reps: '', completed: false }] },
    ] }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  console.log('Checking camera launch...');
  await page.waitForSelector('.velocity-row button');
  assert.equal(await page.$$eval('.velocity-row button', (buttons) => buttons.length), 1, 'only supported exercise receives a camera launch');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('.velocity-row button')]);
  const launched = new URL(page.url());
  console.log('Camera launch ready; simulating record handoff...');
  assert.equal(launched.pathname, '/curl-lab.html');
  assert.equal(launched.searchParams.get('workout'), 'smoke-w');
  assert.equal(launched.searchParams.get('exercise'), 'smoke-e');
  assert.equal(launched.searchParams.get('set'), 'smoke-s');
  assert.equal(launched.searchParams.get('loadKg'), '80');
  assert.equal(launched.searchParams.get('typedRir'), '2');
  assert.ok(launched.searchParams.get('capture'));
  // Simulate only the already-tested camera record boundary, not camera inference.
  const attached = await page.evaluate(async () => {
    const { buildLiveSetRecord } = await import('./features/velocity/services/record.js');
    const { parseWorkoutContext, attachTrackedSet } = await import('./features/velocity/services/workout.js');
    const record = buildLiveSetRecord({ id: 'smoke-take', lift: 'bench', source: 'plate', scaled: true, loadKg: 80, reps: [
      { n: 1, isStandard: true, result: 'counted', vel: { mv: 0.5, pv: 0.8, dist: 0.5, T: 1 } },
      { n: 2, result: 'short', why: 'short finish' },
      { n: 3, result: 'counted', vel: { mv: 0.4, pv: 0.6, dist: 0.48, T: 1.25 } },
    ], standard: { start: 200, finish: 120 } });
    return attachTrackedSet(localStorage, parseWorkoutContext(location.search), record).ok;
  });
  assert.equal(attached, true);
  // Back navigation exercises pageshow/BFCache recovery of the updated draft.
  await page.goBack({ waitUntil: 'networkidle0' });
  console.log('Returned to logger; checking results and exports...');
  await page.waitForSelector('.velocity-summary');
  assert.match(await page.$eval('.velocity-summary', (el) => el.textContent), /2 counted.*1 short.*23% loss/s);
  assert.equal(await page.$eval('input[aria-label="Reps"]', (el) => el.value), '2');
  await page.$eval('#rir-smoke-s', (el) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis_active_workout')).exercises[0].sets[0].velocity.typedRir), 3);
  await page.evaluate(() => {
    setEquipmentVariation('smoke-e','barbell · flat bench');
    setEffort('smoke-e','smoke-s','rpe','9');
    setCalibrationField('smoke-e','smoke-s','endpoint','technical');
    setCalibrationField('smoke-e','smoke-s','failure',true);
    setCalibrationField('smoke-e','smoke-s','tested1RM',true);
    setField('unsupported-e','unsupported-s','weight','150');
    setField('unsupported-e','unsupported-s','reps','1');
    setCalibrationField('unsupported-e','unsupported-s','tested1RM',true);
  });
  const reported = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis_active_workout')).exercises[0].sets[0]);
  assert.equal(reported.reportedEffort.rir,3,'actual RIR report is retained when actual RPE differs');
  assert.equal(reported.reportedEffort.rpe,9);
  assert.equal(reported.failureEndpoint.type,'technical');
  assert.equal(reported.tested1RM,null,'multiple completed reps cannot be a tested single');
  assert.equal(reported.velocity.userId,'smoke@example.invalid');
  assert.equal(reported.velocity.equipmentKey,'barbell · flat bench');
  assert.equal(reported.predictions.rir.status,'unavailable','synthetic unvalidated camera record produces no unsupported model prediction');
  assert.ok(await page.$('.coach-metrics'),'complete shared coach metrics rendered in logger');
  await page.evaluate(() => finishWorkout());
  const exported = await page.evaluate(() => buildClientExport());
  const completed = exported.workouts.find((w) => w.name === 'Camera smoke');
  assert.equal(completed.exercises[0].sets[0].velocity.id, 'smoke-take');
  assert.equal(completed.exercises[0].sets[0].rir, 3);
  assert.equal(completed.exercises[0].sets[0].reportedEffort.rpe,9);
  assert.equal(completed.exercises[0].sets[0].failureEndpoint.type,'technical');
  assert.equal(completed.exercises[1].sets[0].tested1RM.loadKg,150);
  assert.equal(completed.exercises[0].sets[0].predictions.rir.status,'unavailable');
  assert.equal(await page.evaluate(() => localStorage.getItem('jarvis_active_workout')), null);
  await page.evaluate(() => openSession('smoke-w'));
  assert.ok(await page.$('#sess-body .velocity-summary'), 'history retains the tracked chart');
  await page.evaluate(() => { closeSession(); showProg('Bench Press'); });
  assert.ok(await page.$('#pgm-body .velocity-summary'), 'progress view retains the tracked chart');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(mobileOverflow, false, 'tracker result does not overflow mobile viewport');
  assert.deepEqual(errors, [], 'workout page has no uncaught browser errors');
  console.log('PASS: workout camera launch, ID handoff, back-cache recovery, rep chart, effort edits, completion, coach export, history and mobile layout.');
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true });
}
