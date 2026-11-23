// Cloud-sync safety tests for js/auth.js against a fake Supabase. Run: node --test scripts/test-sync-security.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');

function world({ user = { id: 'A' }, cloud = {}, selectError = false, upsertError = false, store = new Map() } = {}) {
  const localStorage = {
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  };
  const uploads = [];
  const state = { user, selectError, upsertError, signedOut: false, deleted: false };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.signedOut ? null : state.user } }),
      getSession: async () => ({ data: { session: state.signedOut ? null : { access_token: 'tok' } } }),
      signOut: async () => { state.signedOut = true; },
    },
    from: () => ({
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => (state.selectError ? { error: { message: 'offline' } } : { data: cloud[id] ? { data: cloud[id] } : null, error: null }) }) }),
      upsert: async (row) => { if (state.upsertError) return { error: { message: 'offline' } }; uploads.push(row); cloud[row.user_id] = row.data; return { error: null }; },
    }),
    rpc: async (name) => { if (name === 'delete_my_account') { state.deleted = true; return { error: null }; } return { error: { message: 'x' } }; },
  };
  const window = { supabase: { createClient: () => client } };
  const ctx = vm.createContext({ window, localStorage, document: {}, location: { origin: 'https://x' }, TextEncoder, crypto: {}, setTimeout, clearTimeout, console });
  vm.runInContext(SRC, ctx);
  const Auth = window.Auth;
  Auth.CFG.url = 'https://abcdefghijklmnop.supabase.co'; Auth.CFG.anonKey = 'anon';
  Auth.__ls = localStorage;
  return { Auth, store, uploads, cloud, state };
}

test('offline at sign-in: nothing is uploaded, so the cloud copy is never overwritten by an empty phone', async () => {
  const w = world({ cloud: { A: { jarvis_workouts: '[1,2,3]' } }, selectError: true });
  w.store.set('jarvis_workouts', '[]');
  assert.equal(await w.Auth.pull(), false);
  assert.equal(await w.Auth.push(), false);
  assert.equal(w.uploads.length, 0);
  assert.equal(w.cloud.A.jarvis_workouts, '[1,2,3]');
});

test('a different account signing in on the same phone never receives or uploads the previous account’s data', async () => {
  const w = world({ user: { id: 'B' }, cloud: { B: { jarvis_workouts: '["B"]' } } });
  w.store.set('arete_owner', 'A');
  w.store.set('jarvis_nutrition_log', '{"A":"private"}');
  w.store.set('jarvis_oura_token', '{"access_token":"A-oura"}');
  w.store.set('arete_anthropic_key', 'sk-ant-A');
  await w.Auth.pull();
  assert.equal(w.store.get('jarvis_nutrition_log'), undefined);
  assert.equal(w.store.get('jarvis_oura_token'), undefined);
  assert.equal(w.store.get('arete_anthropic_key'), undefined);
  assert.equal(w.store.get('jarvis_workouts'), '["B"]');
  await w.Auth.push();
  assert.ok(!JSON.stringify(w.cloud.B).includes('private'));
});

test('tokens, personal API keys and sign-in state are never uploaded', async () => {
  const w = world();
  for (const [k, v] of [['jarvis_workouts', '[]'], ['arete_weighins', '[]'], ['jarvis_strava_token', 's'], ['jarvis_whoop_token', 'w'], ['jarvis_fitbit_token', 'f'], ['arete_anthropic_key', 'sk-ant-x'], ['arete_session', '{}'], ['arete_accounts', '{}']]) w.store.set(k, v);
  await w.Auth.pull(); await w.Auth.push();
  assert.deepEqual(Object.keys(w.cloud.A).sort(), ['arete_weighins', 'jarvis_workouts']);
});

test('a tampered cloud row cannot plant sign-in state or secrets on the phone', async () => {
  const w = world({ cloud: { A: { jarvis_workouts: '[]', arete_session: '{"email":"x"}', arete_accounts: '{}', jarvis_oura_token: 'planted', evil_key: '1' } } });
  await w.Auth.pull();
  assert.equal(w.store.get('arete_session'), undefined);
  assert.equal(w.store.get('arete_accounts'), undefined);
  assert.equal(w.store.get('jarvis_oura_token'), undefined);
  assert.equal(w.store.get('evil_key'), undefined);
  assert.equal(w.store.get('jarvis_workouts'), '[]');
});

test('sign-out uploads first, then clears the phone of data and secrets', async () => {
  const w = world();
  w.store.set('jarvis_workouts', '[9]'); w.store.set('jarvis_oura_token', 't'); w.store.set('arete_anthropic_key', 'k');
  await w.Auth.pull();
  await w.Auth.signOutAny();
  assert.equal(w.cloud.A.jarvis_workouts, '[9]');
  assert.equal([...w.store.keys()].filter((k) => /^(jarvis|arete)_/.test(k)).length, 0);
});

test('delete account removes the account and clears the phone', async () => {
  const w = world();
  w.store.set('jarvis_workouts', '[9]'); w.store.set('arete_owner', 'A');
  await w.Auth.deleteAccount();
  assert.equal(w.state.deleted, true);
  assert.equal([...w.store.keys()].filter((k) => /^(jarvis|arete)_/.test(k)).length, 0);
});

// Saving: a page opening must never download an older cloud copy over changes not yet uploaded.
test('a change typed just before opening another page survives, and is uploaded from there', async () => {
  const cloud = { A: { jarvis_workouts: '[1]' } };
  const page1 = world({ cloud });
  await page1.Auth.pull(); page1.Auth.watch();
  // typed, then straight to another page before the 2.5 s upload
  const ls = page1.store;
  ls.set('jarvis_workouts', '[1,2]'); ls.set('arete_sync_pending', String(Date.now()));
  const page2 = world({ cloud, store: ls });
  assert.equal(await page2.Auth.pull(), true);
  assert.equal(ls.get('jarvis_workouts'), '[1,2]', 'the newer phone copy is kept');
  assert.equal(await page2.Auth.push(), true);
  assert.equal(cloud.A.jarvis_workouts, '[1,2]', 'and it reaches the cloud');
  assert.equal(ls.has('arete_sync_pending'), false, 'nothing left unsent');
});

test('every data write is marked unsent until an upload succeeds; a failed upload keeps it', async () => {
  const cloud = { A: { jarvis_workouts: '[]' } };
  const w = world({ cloud, upsertError: true });
  await w.Auth.pull(); w.Auth.watch();
  w.Auth.__ls.setItem('jarvis_workouts', '[7]');
  assert.ok(w.store.get('arete_sync_pending'), 'marked as unsent');
  assert.equal(await w.Auth.push(), false);
  assert.ok(w.store.get('arete_sync_pending'), 'still marked after a failed upload');
  const next = world({ cloud, store: w.store });
  await next.Auth.pull();
  assert.equal(w.store.get('jarvis_workouts'), '[7]', 'the cloud copy never replaces it');
  assert.equal(await next.Auth.push(), true);
  assert.equal(cloud.A.jarvis_workouts, '[7]');
});

test('once everything is uploaded, opening a page takes the cloud copy (changes from another device arrive)', async () => {
  const cloud = { A: { jarvis_workouts: '[1]' } };
  const w = world({ cloud });
  w.store.set('arete_owner', 'A');
  cloud.A.jarvis_workouts = '[1,9]';
  await w.Auth.pull();
  assert.equal(w.store.get('jarvis_workouts'), '[1,9]');
});

test('the unsent marker is never uploaded and is cleared with the phone data', async () => {
  const w = world();
  w.store.set('jarvis_workouts', '[1]'); w.store.set('arete_sync_pending', '123');
  await w.Auth.pull(); await w.Auth.push();
  assert.ok(!('arete_sync_pending' in w.cloud.A));
  w.store.set('arete_sync_pending', '456');
  await w.Auth.deleteAccount();
  assert.equal(w.store.has('arete_sync_pending'), false);
});
