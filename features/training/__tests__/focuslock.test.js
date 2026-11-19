// Lock-in mode (js/focuslock.js): when the picked apps are blocked, with a fake native plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const mem = new Map();
  const window = {};
  const ctx = {
    window, console,
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  };
  ctx.localStorage = ctx.localStorage; window.localStorage = ctx.localStorage;
  vm.runInNewContext(readFileSync(new URL('../../../js/focuslock.js', import.meta.url), 'utf8'), ctx);
  return { lib: window.FocusLockLib, mem };
}

function fakePlugin({ supported = true, authorized = true, appsChosen = 4, pick = 4 } = {}) {
  const calls = [];
  return {
    calls,
    async status() { calls.push('status'); return { supported, authorized, appsChosen }; },
    async setup() { calls.push('setup'); authorized = true; appsChosen = pick; return { appsChosen: pick }; },
    async lock() { calls.push('lock'); return { locked: true }; },
    async unlock() { calls.push('unlock'); return { locked: false }; },
  };
}

test('the rule: a workout open, not saved for later, not unlocked early', () => {
  const { lib } = load();
  assert.equal(lib.shouldLock(null), false);
  assert.equal(lib.shouldLock({ id: 'w' }), true);
  assert.equal(lib.shouldLock({ id: 'w', paused: true }), false);
  assert.equal(lib.shouldLock({ id: 'w', unlockedEarly: 123 }), false);
});

test('start locks once (not on every save), finish unlocks, reload with no workout clears a leftover block', async () => {
  const { lib } = load();
  const p = fakePlugin(), fl = lib.create({ plugin: p, ask: async () => true });
  const on = [];
  fl.onChange((v) => on.push(v));
  const w = { id: 'w' };
  await fl.sync(w); await fl.sync(w); await fl.sync(w);
  assert.deepEqual(p.calls.filter((c) => c !== 'status'), ['lock']);
  assert.equal(fl.locked, true);
  await fl.sync(null);
  assert.deepEqual(p.calls.filter((c) => c !== 'status'), ['lock', 'unlock']);
  assert.equal(fl.locked, false);
  assert.deepEqual(on, [true, false]);
  // A fresh page with no workout open: unlocks (a block left by a closed app is cleared).
  const p2 = fakePlugin(), fl2 = lib.create({ plugin: p2 });
  await fl2.sync(null);
  assert.deepEqual(p2.calls, ['unlock']);
});

test('hold-to-unlock (unlockedEarly) and save-for-later unlock; resuming locks again', async () => {
  const { lib } = load();
  const p = fakePlugin(), fl = lib.create({ plugin: p });
  const w = { id: 'w' };
  await fl.sync(w);
  w.paused = true; await fl.sync(w);
  delete w.paused; await fl.sync(w);
  w.unlockedEarly = Date.now(); await fl.sync(w);
  assert.deepEqual(p.calls.filter((c) => c !== 'status'), ['lock', 'unlock', 'lock', 'unlock']);
});

test('first workout: explains, then Apple picker; "Not now" is remembered and the workout still runs', async () => {
  const { lib, mem } = load();
  const p = fakePlugin({ authorized: false, appsChosen: 0 });
  let asked = 0;
  const fl = lib.create({ plugin: p, ask: async () => { asked++; return true; } });
  await fl.sync({ id: 'a' });
  assert.equal(asked, 1);
  assert.deepEqual(p.calls, ['status', 'setup', 'lock']);
  assert.equal(fl.locked, true);

  const { lib: lib2, mem: mem2 } = load();
  const p2 = fakePlugin({ authorized: false, appsChosen: 0 });
  let asked2 = 0;
  const fl2 = lib2.create({ plugin: p2, ask: async () => { asked2++; return false; } });
  await fl2.sync({ id: 'b' });
  assert.equal(fl2.locked, false);
  assert.ok(!p2.calls.includes('lock') && !p2.calls.includes('setup'));
  await fl2.sync(null); await fl2.sync({ id: 'c' });
  assert.equal(asked2, 1, 'asked only once');
  assert.ok(mem2.size === 1 && mem.size === 0);
});

test('picker cancelled with nothing ticked: no block, not asked again', async () => {
  const { lib } = load();
  const p = fakePlugin({ authorized: false, appsChosen: 0, pick: 0 });
  let asked = 0;
  const fl = lib.create({ plugin: p, ask: async () => { asked++; return true; } });
  await fl.sync({ id: 'a' }); await fl.sync(null); await fl.sync({ id: 'b' });
  assert.equal(asked, 1);
  assert.ok(!p.calls.includes('lock'));
});

test('older iPhones (no Screen Time API) and the web: nothing happens', async () => {
  const { lib } = load();
  const p = fakePlugin({ supported: false }), fl = lib.create({ plugin: p, ask: async () => assert.fail('must not ask') });
  await fl.sync({ id: 'a' });
  assert.equal(fl.locked, false);
  const web = lib.create({ plugin: null });
  assert.equal(web.available(), false);
  await web.sync({ id: 'a' });
});

test('a native error never breaks the workout and is retried on the next change', async () => {
  const { lib } = load();
  const p = fakePlugin();
  let fail = true;
  p.lock = async () => { p.calls.push('lock'); if (fail) throw new Error('boom'); return { locked: true }; };
  const fl = lib.create({ plugin: p });
  const warn = console.warn; console.warn = () => {};
  try { await fl.sync({ id: 'a' }); } finally { console.warn = warn; }
  fail = false;
  await fl.sync({ id: 'a' });
  assert.equal(fl.locked, true);
});
