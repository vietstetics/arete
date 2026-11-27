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
  const state = { user, selectError, upsertError, signedOut: false, deleted: false, n: 0, beforeWrite: null };
  if (!cloud.__v) Object.defineProperty(cloud, '__v', { value: {}, enumerable: false });
  const versions = cloud.__v;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.signedOut ? null : state.user } }),
      getSession: async () => ({ data: { session: state.signedOut ? null : { access_token: 'tok' } } }),
      signOut: async () => { state.signedOut = true; },
    },
    // user_data with an updated_at version, like Postgres: a conditional update only lands if the
    // version still matches.
    from: () => ({
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => {
        if (state.selectError) return { error: { message: 'offline' } };
        const d = cloud[id]; if (!d) return { data: null, error: null };
        return { data: { data: JSON.parse(JSON.stringify(d)), updated_at: versions[id] || 'v0' }, error: null };
      } }) }),
      update: (row) => ({ eq: (_c, id) => ({ eq: (_c2, ver) => ({ select: async () => {
        if (state.upsertError) return { error: { message: 'offline' } };
        if (state.beforeWrite) { const f = state.beforeWrite; state.beforeWrite = null; await f(); }
        if (!cloud[id] || (versions[id] || 'v0') !== ver) return { data: [], error: null };
        uploads.push({ user_id: id, ...row }); cloud[id] = row.data; versions[id] = 'v' + (++state.n); return { data: [{ user_id: id }], error: null };
      } }) }) }),
      insert: async (row) => {
        if (state.upsertError) return { error: { message: 'offline' } };
        if (cloud[row.user_id]) return { error: { code: '23505', message: 'duplicate' } };
        uploads.push(row); cloud[row.user_id] = row.data; versions[row.user_id] = 'v' + (++state.n); return { error: null };
      },
      upsert: async (row) => { if (state.upsertError) return { error: { message: 'offline' } }; uploads.push(row); cloud[row.user_id] = row.data; versions[row.user_id] = 'v' + (++state.n); return { error: null }; },
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
  assert.deepEqual(Object.keys(w.cloud.A).filter((k) => k !== '__t').sort(), ['arete_weighins', 'jarvis_workouts']);
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

// ── Two devices on one account (audit #12): neither may erase the other's changes. ──
async function device(cloud) { const d = world({ cloud }); d.store.set('arete_owner', 'A'); await d.Auth.pull(); d.Auth.watch(); return d; }
const ws = (id, date) => ({ id, date, sets: [] });

test('two devices changing different things: both changes survive', async () => {
  const cloud = { A: { jarvis_nutrition_log: '{}', jarvis_nutrition_goals: '{"kcal":2400}' } };
  const phone = await device(cloud), laptop = await device(cloud);
  phone.Auth.__ls.setItem('jarvis_nutrition_log', '{"2026-11-27":[{"id":"f1","name":"Oats"}]}');
  laptop.Auth.__ls.setItem('jarvis_nutrition_goals', '{"kcal":2200}');
  assert.equal(await phone.Auth.push(), true);
  assert.equal(await laptop.Auth.push(), true);
  assert.equal(cloud.A.jarvis_nutrition_log, '{"2026-11-27":[{"id":"f1","name":"Oats"}]}', 'the phone’s food log is kept');
  assert.equal(cloud.A.jarvis_nutrition_goals, '{"kcal":2200}');
  assert.equal(laptop.store.get('jarvis_nutrition_log'), cloud.A.jarvis_nutrition_log, 'and it reaches the laptop');
  await phone.Auth.pull();
  assert.equal(phone.store.get('jarvis_nutrition_goals'), '{"kcal":2200}', 'the laptop’s goal reaches the phone');
});

test('two devices each adding a workout: both workouts are kept, in date order', async () => {
  const cloud = { A: { jarvis_workouts: JSON.stringify([ws('w1', '2026-11-20')]) } };
  const phone = await device(cloud), laptop = await device(cloud);
  phone.Auth.__ls.setItem('jarvis_workouts', JSON.stringify([ws('w1', '2026-11-20'), ws('w3', '2026-11-27')]));
  laptop.Auth.__ls.setItem('jarvis_workouts', JSON.stringify([ws('w1', '2026-11-20'), ws('w2', '2026-11-25')]));
  await phone.Auth.push(); await laptop.Auth.push();
  assert.deepEqual(JSON.parse(cloud.A.jarvis_workouts).map((w) => w.id), ['w1', 'w2', 'w3']);
  await phone.Auth.pull();
  assert.equal(phone.store.get('jarvis_workouts'), cloud.A.jarvis_workouts);
});

test('another device saving between this one’s read and write: it reads again, nothing is lost', async () => {
  const cloud = { A: { jarvis_tasks: '[]', jarvis_water: '0' } };
  const phone = await device(cloud), laptop = await device(cloud);
  phone.Auth.__ls.setItem('jarvis_water', '3');
  laptop.Auth.__ls.setItem('jarvis_tasks', '[{"id":"t1","name":"Stretch"}]');
  phone.state.beforeWrite = () => laptop.Auth.push();      // the laptop saves while the phone's upload is in flight
  assert.equal(await phone.Auth.push(), true);
  assert.equal(cloud.A.jarvis_water, '3');
  assert.equal(cloud.A.jarvis_tasks, '[{"id":"t1","name":"Stretch"}]');
});

test('a key removed on one device is removed on the other', async () => {
  const cloud = { A: { jarvis_active_workout: '{"id":"a"}', jarvis_workouts: '[]' } };
  const phone = await device(cloud), laptop = await device(cloud);
  phone.Auth.__ls.removeItem('jarvis_active_workout');
  await phone.Auth.push();
  assert.equal('jarvis_active_workout' in cloud.A, false);
  await laptop.Auth.pull();
  assert.equal(laptop.store.has('jarvis_active_workout'), false);
});

test('the same setting changed on both devices: the later change wins', async () => {
  const cloud = { A: { jarvis_rest_secs: '90' } };
  const phone = await device(cloud), laptop = await device(cloud);
  laptop.Auth.__ls.setItem('jarvis_rest_secs', '120');
  await new Promise((r) => setTimeout(r, 5));
  phone.Auth.__ls.setItem('jarvis_rest_secs', '150');
  await laptop.Auth.push(); await phone.Auth.push();
  assert.equal(cloud.A.jarvis_rest_secs, '150');
});

test('opening a page with nothing new writes nothing to the cloud', async () => {
  const cloud = { A: { jarvis_workouts: '[]' } };
  const phone = await device(cloud);
  const before = phone.uploads.length;
  await phone.Auth.pull(); await phone.Auth.pull();
  assert.equal(phone.uploads.length, before);
});
