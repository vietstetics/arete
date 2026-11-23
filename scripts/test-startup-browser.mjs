import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
let intercept = () => false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (intercept(path, response)) return;
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch (_) {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);

let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless:true, args:['--no-sandbox', '--disable-gpu'] });

  async function openHome(seed = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width:390, height:844 });
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith(base) ? req.continue() : req.abort());
    await page.evaluateOnNewDocument(initial => {
      localStorage.setItem('arete_session', '{"email":"startup-test@example.test"}');
      for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
    }, seed);
    await page.goto(base + '/index.html', { waitUntil:'domcontentloaded' });
    return { page, context };
  }

  async function startupResult(page) {
    await page.waitForFunction(() => window.__areteStartup && !document.documentElement.classList.contains('splash-on'),
      { timeout:8500 });
    return page.evaluate(() => window.__areteStartup);
  }

  let workoutAttempts = 0;
  intercept = (path, response) => {
    if (path !== '/workouts.html' || ++workoutAttempts > 1) return false;
    response.writeHead(503).end();
    return true;
  };
  {
    const { page, context } = await openHome({ jarvis_workouts:'[broken' });
    let result = await startupResult(page);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.unavailableRoutes, []);
    assert.deepEqual(result.unavailableAssets, []);
    assert.deepEqual(result.pending, []);
    assert.equal(result.timedOut, false);
    assert.equal(result.storage, true);
    assert.deepEqual(result.recovered, ['jarvis_workouts']);
    assert.equal(workoutAttempts, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('arete_recovered_jarvis_workouts')), '[broken');
    assert.ok(await page.$('.startup-notice button'));
    await page.reload({ waitUntil:'domcontentloaded' });
    result = await startupResult(page);
    assert.equal(result.timedOut, false);
    assert.equal(workoutAttempts, 3, 'a refresh checks routes again');
    await context.close();
  }
  console.log('Startup, saved-data backup, route retry, and refresh passed.');

  intercept = (path, response) => {
    if (path === '/nutrition.html' || path === '/features/training/index.js' || path === '/css/train.css'){
      response.writeHead(404).end();
      return true;
    }
    return false;
  };
  {
    const { page, context } = await openHome();
    const result = await startupResult(page);
    assert.ok(result.missing.includes('Training plans'));
    assert.deepEqual(result.unavailableRoutes, ['nutrition.html']);
    assert.ok(result.unavailableAssets.includes('css/train.css'));
    assert.match(await page.$eval('.startup-notice', node => node.textContent), /didn’t finish/);
    await context.close();
  }
  console.log('Missing modules and missing routes produced a recoverable notice.');

  intercept = path => path === '/nutrition.html';
  {
    const { page, context } = await openHome();
    const result = await startupResult(page);
    assert.equal(result.timedOut, true);
    assert.ok(result.pending.includes('nutrition.html'));
    await context.close();
  }
  console.log('A stalled route released the splash by the startup deadline.');

  intercept = (path, response) => {
    if (path !== '/js/splash.js') return false;
    response.writeHead(404).end();
    return true;
  };
  {
    const { page, context } = await openHome();
    await page.waitForFunction(() => !document.documentElement.classList.contains('splash-on'), { timeout:8500 });
    assert.equal(await page.evaluate(() => window.__areteStartup), undefined);
    await context.close();
  }
  console.log('The inline fallback released the splash when its script was missing.');

  intercept = () => false;
  {
    const { page, context } = await openHome();
    assert.deepEqual((await startupResult(page)).missing, []);
    // Loopback is a secure context, but the app's production registration requires HTTPS.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil:'domcontentloaded' });
    const result = await startupResult(page);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.unavailableRoutes, []);
    assert.deepEqual(result.unavailableAssets, []);
    assert.equal(result.timedOut, false);
    await page.goto(base + '/nutrition.html', { waitUntil:'domcontentloaded' });
    assert.match(page.url(), /nutrition.html$/);
    assert.ok(await page.$('#tab-nutrients'));
    await context.close();
  }
  console.log('Offline startup and opening Nutrition from the cache passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
