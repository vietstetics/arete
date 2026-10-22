// Headless UI checks with synthetic poses. No camera/model or external network.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const mode of ['curl', 'squat', 'bench', 'row', 'press', 'tbar', 'pullup']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(base) ? r.continue() : r.abort());
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('arete_session', JSON.stringify({ email: 'velocity-test@example.test' }));
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms > 30 && ms < 35 ? 0 : ms, ...args);
    });
    await page.goto(`${base}/curl-lab.html?demo=1&debug=1&ex=${mode}`);
    assert.ok(page.url().includes('curl-lab.html'), page.url());
    await page.click('#start-btn');
    await page.waitForFunction(() => !document.getElementById('done').hidden, { timeout: 25000 });
    const result = await page.evaluate(() => ({ counted: +document.getElementById('d-count').textContent,
      short: document.getElementById('d-short').textContent, reps: window.__plateDebug().poseReps,
      summary: document.getElementById('verdict').textContent }));
    assert.equal(errors.length, 0, `${mode}: ${errors.join('; ')}`);
    assert.equal(result.counted, mode === 'pullup' ? 4 : 5, `${mode}: ${JSON.stringify(result)}`);
    assert.ok(result.reps.filter((r) => r.result !== 'counted').every((r) => !r.vel), `${mode}: invalid rep has speed`);
    if (mode !== 'pullup') {
      assert.ok(!/m\/s/.test(result.summary), `${mode}: body demo claims absolute speed`);
      await page.click('#coach-btn');
      assert.equal(await page.$eval('#cv-wrap', (el) => el.hidden), false);
    }
    console.log(`${mode}: ${result.counted} counted, ${result.short}; no UI errors`);
    await page.close();
  }
  const lab = await browser.newPage();
  const errors = [];
  lab.on('pageerror', (e) => errors.push(e.message));
  await lab.setViewport({ width: 390, height: 844 });
  await lab.setRequestInterception(true);
  lab.on('request', (r) => r.url().startsWith(base) ? r.continue() : r.abort());
  await lab.evaluateOnNewDocument(() => localStorage.setItem('arete_session', JSON.stringify({ email: 'velocity-test@example.test' })));
  await lab.goto(`${base}/velocity-lab.html?demo=1`);
  await lab.click('#demo-btn');
  await lab.waitForFunction(() => !!window.__vlab.result, { timeout: 60000 });
  const result = await lab.evaluate(() => ({ rows: window.__vlab.result.rows, scaled: window.__vlab.result.scaled }));
  assert.equal(result.rows.filter((r) => r.result === 'counted').length, 5);
  assert.equal(result.scaled, true, 'synthetic demo uses explicitly known 45cm plate');
  await lab.select('#tracker', 'plate3d');
  await lab.select('#report-mode', 'measurement');
  await lab.select('#report-mode', 'standard');
  assert.equal(errors.length, 0, errors.join('; '));
  console.log('Offline lab: 5 synthetic reps; report-mode switching; no UI errors');
  await lab.close();
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
