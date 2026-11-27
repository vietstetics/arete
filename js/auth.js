/* ============================================================================
 *  Auth + secure cloud sync — Supabase.
 *
 *  WHY SUPABASE: hosted Postgres with Row-Level Security, built-in email +
 *  phone (SMS OTP) auth, server-side password hashing and JWT sessions. The
 *  "anon" key below is PUBLIC by design — it is safe to ship in the client;
 *  data security comes from RLS policies (each user can only touch their own
 *  row), NOT from hiding the key. Never put the service_role key here.
 *
 *  SETUP (see native/README.md → "Accounts & cloud sync"):
 *    1. Create a project at supabase.com.
 *    2. Auth → Providers: enable Email; enable Phone (needs an SMS provider
 *       like Twilio — paid). Email is free.
 *    3. Run the SQL in the README to create the `user_data` table + RLS.
 *    4. Paste your Project URL + anon key into CFG below.
 *  Until CFG is filled, the app runs locally (no login wall), so nothing
 *  breaks before you're ready.
 * ==========================================================================*/
window.Auth = (() => {
  const CFG = {
    url:     'https://infduomurmdldywucfof.supabase.co',
    anonKey: 'sb_publishable_gRiexQ5sj1PS4elkbnMJcA_Nk9w96CD',   // publishable key (safe to expose)
  };

  let client = null, loadingPromise = null, watching = false;
  const isConfigured = () => !!(CFG.url && CFG.anonKey);

  function loadSDK() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (loadingPromise) return loadingPromise;
    loadingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // Pinned version + integrity hash: a changed or tampered file from the CDN is refused.
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
      s.integrity = 'sha384-0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o';
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('Could not load the Supabase SDK (offline?).'));
      document.head.appendChild(s);
    });
    return loadingPromise;
  }
  async function getClient() {
    if (!isConfigured()) throw new Error('Accounts aren’t set up yet.');
    if (client) return client;
    const sb = await loadSDK();
    client = sb.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    return client;
  }

  async function getUser() {
    if (!isConfigured()) return null;
    try { const c = await getClient(); const { data } = await c.auth.getUser(); return data.user || null; } catch { return null; }
  }
  async function getSession() {
    if (!isConfigured()) return null;
    try { const c = await getClient(); const { data } = await c.auth.getSession(); return data.session || null; } catch { return null; }
  }

  // ── Email (create account first, then password sign-in) ──────────────────
  async function signUpEmail(email, password) { const c = await getClient(); return c.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + '/login.html' } }); }
  async function resendConfirmation(email) { const c = await getClient(); return c.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + '/login.html' } }); }
  async function updatePassword(password) { const c = await getClient(); return c.auth.updateUser({ password }); }
  // Which sign-in methods the project has switched on, read from Supabase itself, so the page never
  // offers a button that can only fail. null when it can't be read.
  let providersCache = null;
  function providers() {
    if (!isConfigured()) return Promise.resolve(null);
    if (!providersCache) providersCache = fetch(CFG.url + '/auth/v1/settings', { headers: { apikey: CFG.anonKey } })
      .then((r) => (r.ok ? r.json() : null)).then((s) => (s && s.external ? s.external : null)).catch(() => null);
    return providersCache;
  }
  async function signInEmail(email, password) { const c = await getClient(); return c.auth.signInWithPassword({ email, password }); }
  async function resetPassword(email) { const c = await getClient(); return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login.html' }); }

  // ── Phone (SMS one-time code; the code both creates the account & logs in) ─
  async function sendPhoneCode(phone) { const c = await getClient(); return c.auth.signInWithOtp({ phone }); }
  async function verifyPhoneCode(phone, token) { const c = await getClient(); return c.auth.verifyOtp({ phone, token, type: 'sms' }); }

  async function signOut() { try { const c = await getClient(); await c.auth.signOut(); } catch {} }

  // ── Social sign-in (Google / Apple / Facebook via Supabase OAuth) ─────────
  // Full-page redirect to the provider; Supabase handles the token exchange
  // and lands back on login.html, where detectSessionInUrl picks the session
  // up and the boot check forwards into the app. Each provider must be
  // enabled in Supabase → Authentication → Providers.
  async function signInOAuth(provider) {
    const c = await getClient();
    return c.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + '/login.html' } });
  }

  // ── Secure per-user cloud sync of the app's data ─────────────────────────
  // What syncs: the app's jarvis_* and arete_* data. Never synced: sign-in state, and secrets that
  // belong to this phone only (the user's own Anthropic key, Oura/Strava/WHOOP/Fitbit tokens), plus
  // large scratch data. A user's row is only readable/writable by that user (Row-Level Security,
  // supabase/schema.sql).
  const NOT_DATA = new Set(['arete_session', 'arete_accounts', 'arete_owner', 'arete_anthropic_key', 'arete_splash', 'arete_sync_pending',
    'arete_sets_sent', 'arete_sets_deleted', 'arete_sets_status',   // per-device bookkeeping for js/setSync.js
    'arete_onboarding', 'arete_sync_base', 'arete_sync_mtime']);   // + per-device merge bookkeeping (below)                                            // this phone still owes the first-run questions
  // First-run questions (onboarding.html) are owed only by a brand-new account: one with no cloud row
  // yet, or a device account created just now. Answers live in jarvis_profile, which syncs, so a
  // second phone never asks again.
  const ONBOARD_KEY = 'arete_onboarding', PROFILE_KEY = 'jarvis_profile';
  const needsOnboarding = () => { try { return localStorage.getItem(ONBOARD_KEY) === '1' && !localStorage.getItem(PROFILE_KEY); } catch { return false; } };
  const clearOnboarding = () => { try { localStorage.removeItem(ONBOARD_KEY); } catch {} };
  const SECRETISH = /(token|secret|password|api_?key|_key$)/i;
  const isDataKey = (k) => typeof k === 'string'
    && (k.indexOf('jarvis_') === 0 || k.indexOf('arete_') === 0)
    && !NOT_DATA.has(k) && !SECRETISH.test(k) && k.indexOf('arete_mapsandbox_') !== 0;
  function dataKeys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isDataKey(k)) out.push(k); } return out; }
  function snapshot() { const o = {}; dataKeys().forEach(k => { o[k] = localStorage.getItem(k); }); return o; }
  // Clears this phone of the account's data AND its phone-only secrets (tokens, personal API key).
  function wipeLocalData() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isDataKey(k) || k === 'arete_anthropic_key' || /^arete_(sync|sets)_/.test(k || '') || ((k || '').match(/^(jarvis|arete)_/) && SECRETISH.test(k))) keys.push(k);
    }
    keys.forEach(k => { try { origRemove(k); } catch {} });
  }
  const OWNER_KEY = 'arete_owner';
  // Set on every local data write, cleared only once that write is in the cloud.
  const PENDING_KEY = 'arete_sync_pending';
  const pendingSince = () => { const v = +(localStorage.getItem(PENDING_KEY) || 0); return v > 0 ? v : 0; };
  const clearPendingIf = (sent) => { if (pendingSince() === sent) { try { origRemove(PENDING_KEY); } catch {} } };

  // ── Merging two devices ──────────────────────────────────────────────────
  // The cloud row is one JSON object of keys. Each device remembers a fingerprint of every key as it
  // was at its last sync (BASE_KEY), so for each key it can tell who changed it since: only this phone
  // (send it), only the cloud (take it), or both (merge: lists of items with ids are joined item by
  // item, objects field by field, anything else goes to the newer change). The upload only lands if
  // nobody saved in between (compare-and-swap on updated_at); otherwise it reads again and re-merges.
  const BASE_KEY = 'arete_sync_base', MTIME_KEY = 'arete_sync_mtime', TIMES = '__t';
  const fp = (v) => { if (v == null) return null; let h = 0x811c9dc5; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); } return v.length + ':' + (h >>> 0).toString(36); };
  const readMap = (k) => { try { const o = JSON.parse(localStorage.getItem(k)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
  const writeMap = (k, o) => { try { origSet(k, JSON.stringify(o)); } catch {} };
  function noteWrite(k) { const m = readMap(MTIME_KEY); m[k] = Date.now(); writeMap(MTIME_KEY, m); }
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const TIME_FIELDS = ['date', 'startedAt', 'start', 'createdAt', 'at', 'ts', 'time'];
  function mergeJSON(a, b, aNewer, depth) {          // a: this phone, b: the cloud
    const older = aNewer ? b : a, newer = aNewer ? a : b;
    if (Array.isArray(a) && Array.isArray(b)) {
      const id = (x) => (x && typeof x === 'object' && x.id != null ? String(x.id) : null);
      if (!a.concat(b).every((x) => id(x) != null)) return newer;
      const rest = new Map(older.map((x) => [id(x), x]));
      const out = newer.map((x) => {
        const o = rest.get(id(x)); rest.delete(id(x));
        return o && isObj(o) && isObj(x) && depth < 3 ? (aNewer ? mergeJSON(x, o, true, depth + 1) : mergeJSON(o, x, false, depth + 1)) : x;
      });
      for (const x of rest.values()) out.push(x);     // items only the older side has: added there
      const f = TIME_FIELDS.find((k) => out.every((x) => x[k] != null && !isNaN(new Date(x[k]))));
      return f ? out.map((x, i) => [x, i]).sort((p, q) => (new Date(p[0][f]) - new Date(q[0][f])) || p[1] - q[1]).map((p) => p[0]) : out;
    }
    if (isObj(a) && isObj(b) && depth < 3) {
      const out = Object.assign({}, older, newer);
      for (const k in a) {
        if (k in b && a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object' && JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = mergeJSON(a[k], b[k], aNewer, depth + 1);
      }
      return out;
    }
    return newer;
  }
  function mergeKey(L, R, lt, rt) {
    if (L === R) return L;
    if (L == null) return R;                          // deleted on one side, changed on the other: keep the change
    if (R == null) return L;
    let a, b; try { a = JSON.parse(L); b = JSON.parse(R); } catch { return lt >= rt ? L : R; }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return lt >= rt ? L : R;
    return JSON.stringify(mergeJSON(a, b, lt >= rt, 0));
  }
  function announce(keys) {
    if (!keys || !keys.length || typeof window === 'undefined' || !window.dispatchEvent || typeof CustomEvent !== 'function') return;
    try { window.dispatchEvent(new CustomEvent('arete:remote-change', { detail: keys })); } catch {}
  }
  /** Read the cloud row, merge it with this phone key by key, and write the result to both. */
  async function exchange(c, u) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await c.from('user_data').select('data, updated_at').eq('user_id', u.id).maybeSingle();
      if (error) return { ok: false };
      const remote = (row && row.data) || {}, rTimes = isObj(remote[TIMES]) ? remote[TIMES] : {};
      const base = readMap(BASE_KEY), mt = readMap(MTIME_KEY), now = Date.now();
      const keys = new Set(dataKeys().concat(Object.keys(remote).filter(isDataKey), Object.keys(base).filter(isDataKey)));
      const out = {}, times = {}, local = {};
      let send = !row;
      for (const k of keys) {
        const L = localStorage.getItem(k), R = typeof remote[k] === 'string' ? remote[k] : null, B = base[k] == null ? null : base[k];
        local[k] = L;
        const lc = fp(L) !== B, rc = fp(R) !== B;
        let v, t;
        if (!lc) { v = R; t = rTimes[k] || 0; }
        else if (!rc) { v = L; t = mt[k] || now; }
        else { const lt = mt[k] || now, rt = rTimes[k] || 0; v = mergeKey(L, R, lt, rt); t = Math.max(lt, rt); }
        if (v !== R) send = true;
        if (v != null) { out[k] = v; if (t) times[k] = t; }
      }
      out[TIMES] = times;
      if (send) {
        const stamp = new Date().toISOString();
        if (row && attempt < 2) {
          const r = await c.from('user_data').update({ data: out, updated_at: stamp }).eq('user_id', u.id).eq('updated_at', row.updated_at).select('user_id');
          if (r.error) return { ok: false };
          if (!r.data || !r.data.length) continue;   // another device saved first: read again and re-merge
        } else if (row) {                            // still racing after two tries: write the merge anyway
          const r = await c.from('user_data').upsert({ user_id: u.id, data: out, updated_at: stamp });
          if (r.error) return { ok: false };
        } else {
          const r = await c.from('user_data').insert({ user_id: u.id, data: out, updated_at: stamp });
          if (r.error) { if (r.error.code === '23505' && attempt < 2) continue; return { ok: false }; }
        }
      }
      // Bring this phone up to date, except keys typed into while the network was busy (sent next time).
      const changed = [], newBase = {};
      for (const k of keys) {
        const v = k in out ? out[k] : null;
        if (v != null) newBase[k] = fp(v);
        if (v !== local[k] && localStorage.getItem(k) === local[k]) {
          try { if (v == null) origRemove(k); else origSet(k, v); changed.push(k); } catch { delete newBase[k]; }
        }
      }
      writeMap(BASE_KEY, newBase);
      return { ok: true, changed };
    }
    return { ok: false };
  }

  // Nothing is uploaded until this device has read the user's cloud copy once: otherwise an empty
  // or half-loaded phone (offline at sign-in) would overwrite the account's data.
  let pulledFor = null;
  // Clears every trace of the previous account from this phone (data, secrets, sync bookkeeping).
  function resetDevice() {
    wipeLocalData();
    try { origRemove(OWNER_KEY); origRemove(ONBOARD_KEY); } catch {}
    pulledFor = null;
  }
  async function pull() {
    const c = await getClient(); const u = await getUser(); if (!u) return false;
    const owner = localStorage.getItem(OWNER_KEY);
    // Another account used this device last: clear its data so it never lands in this account.
    if (owner && owner !== u.id) resetDevice();
    if (owner === u.id) {                                   // synced with this account before: merge both ways
      const sent = pendingSince();
      const r = await exchange(c, u);
      if (!r.ok) { if (sent) schedulePush(30000); return false; }
      pulledFor = u.id;
      clearPendingIf(sent);
      announce(r.changed);
      return true;
    }
    // First sync of this account on this phone: the account's copy replaces whatever is here.
    const { data, error } = await c.from('user_data').select('data').eq('user_id', u.id).maybeSingle();
    if (error) return false;                                // try again later; uploads stay paused
    const remote = (data && data.data) || {}, base = {};
    for (const k in remote) {
      if (isDataKey(k) && typeof remote[k] === 'string') { try { origSet(k, remote[k]); base[k] = fp(remote[k]); } catch {} }
    }
    writeMap(BASE_KEY, base);
    localStorage.setItem(OWNER_KEY, u.id);
    pulledFor = u.id;
    if (!data) {                                            // new account: upload this device's data
      if (!localStorage.getItem(PROFILE_KEY)) { try { origSet(ONBOARD_KEY, '1'); } catch {} }
      schedulePush();
    } else if (dataKeys().some((k) => !(k in base))) schedulePush();   // phone-only keys go up too
    return true;
  }
  let pushTimer = null, pushing = false, again = false;
  async function push() {
    if (pushing) { again = true; return false; }
    pushing = true; again = false;
    let ok = false;
    try {
      const c = await getClient(); const u = await getUser();
      if (!u) return false;
      if (pulledFor !== u.id && !(await pull())) return false;
      const sent = pendingSince();
      const r = await exchange(c, u);
      ok = r.ok;
      // Only clear the marker if nothing was typed while this upload was on its way.
      if (ok) { clearPendingIf(sent); announce(r.changed); }
      return ok;
    } catch { return false; } finally {
      pushing = false;
      if (again) schedulePush(0);
      else if (!ok && pendingSince()) schedulePush(30000);   // offline or a failed upload: try again
    }
  }
  function schedulePush(ms = 2500) { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), ms); }
  function markPending() { try { origSet(PENDING_KEY, String(Date.now())); } catch {} }
  // Mirror data writes up to the cloud (debounced) once signed in; leaving or backgrounding the app
  // sends them at once, and coming back online retries.
  const origSet = localStorage.setItem.bind(localStorage), origRemove = localStorage.removeItem.bind(localStorage);
  function watch() {
    if (watching) return; watching = true;
    localStorage.setItem = function (k, v) {
      try { origSet(k, v); } catch (e) {
        // The phone's storage for the app is full: the change was NOT saved. Say so on screen.
        if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) && typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent === 'function') {
          try { window.dispatchEvent(new CustomEvent('arete:storage-full', { detail: k })); } catch {}
        }
        throw e;
      }
      if (isDataKey(k)) { noteWrite(k); markPending(); schedulePush(); }
      if ((k === 'jarvis_workouts' || k === 'arete_velocity_sets') && typeof window !== 'undefined' && window.SetSync) window.SetSync.schedule();
    };
    localStorage.removeItem = function (k) { origRemove(k); if (isDataKey(k)) { noteWrite(k); markPending(); schedulePush(); } };
    const flush = () => { if (pendingSince()) { clearTimeout(pushTimer); push(); } };
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    if (typeof window !== 'undefined' && window.addEventListener) { window.addEventListener('pagehide', flush); window.addEventListener('online', flush); }
  }
  /** Headers for the app's own API (/api/*): the signed-in user's access token, checked server-side. */
  async function authHeaders() {
    if (!isConfigured()) return {};
    const s = await getSession();
    return s && s.access_token ? { Authorization: 'Bearer ' + s.access_token } : {};
  }

  // ── Device accounts (used until Supabase is configured) ──────────────────
  // The account wall is mandatory either way. Without cloud config, accounts
  // live on this device: the password is salted + SHA-256 hashed (never stored
  // raw) and the session flag unlocks the app. Pasting Supabase creds into CFG
  // upgrades the same UI to real cloud accounts with sync — no code changes.
  const ACC_KEY = 'arete_accounts', SES_KEY = 'arete_session';
  function _accounts() { try { return JSON.parse(localStorage.getItem(ACC_KEY)) || {}; } catch { return {}; } }
  async function _hash(pw, salt) {
    const bytes = new TextEncoder().encode(salt + ':' + pw);
    // Phones only offer crypto.subtle on https; the dev server on the home Wi-Fi is plain http.
    const buf = window.crypto && crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) : _sha256(bytes);
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Plain SHA-256 (FIPS 180-4), the same digest as crypto.subtle, for pages without it.
  function _sha256(msg) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const len = msg.length, total = Math.ceil((len + 9) / 64) * 64, m = new Uint8Array(total);
    m.set(msg); m[len] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer); H.forEach((x, i) => odv.setUint32(i * 4, x)); return out;
  }
  async function localSignUp(email, pw) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
    if ((pw || '').length < 8) throw new Error('Password must be at least 8 characters.');
    if (!pw.trim()) throw new Error('A password can’t be only spaces.');
    const acc = _accounts();
    if (acc[email]) throw new Error('An account with that email already exists on this device — sign in instead.');
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    acc[email] = { salt, hash: await _hash(pw, salt), createdAt: Date.now() };
    localStorage.setItem(ACC_KEY, JSON.stringify(acc));
    localStorage.setItem(SES_KEY, JSON.stringify({ email, at: Date.now() }));
    if (!localStorage.getItem(PROFILE_KEY)) localStorage.setItem(ONBOARD_KEY, '1');
    return { email };
  }
  async function localSignIn(email, pw) {
    email = String(email || '').trim().toLowerCase();
    const a = _accounts()[email];
    if (!a) throw new Error('No account with that email on this device — create one first.');
    if (await _hash(pw, a.salt) !== a.hash) throw new Error('Wrong password.');
    localStorage.setItem(SES_KEY, JSON.stringify({ email, at: Date.now() }));
    return { email };
  }
  function localSession() { try { return JSON.parse(localStorage.getItem(SES_KEY)); } catch { return null; } }
  function localSignOut() { localStorage.removeItem(SES_KEY); clearOnboarding(); }
  async function sessionAny() { return isConfigured() ? getSession() : localSession(); }
  // Cloud accounts: upload the latest first, then clear this phone so the next person who signs in
  // on it never sees this account's data. If the upload fails the data stays (and is cleared later if
  // a different account signs in here).
  async function signOutAny() {
    if (isConfigured()) {
      clearTimeout(pushTimer);
      const saved = await push();
      await signOut();
      if (saved) resetDevice();
    }
    localSignOut();
  }
  // Permanently delete the account and its data (cloud row, usage counters, sign-in) and clear this
  // phone. Device accounts: remove the account and every piece of app data stored on the phone.
  async function deleteAccount() {
    if (isConfigured()) {
      const c = await getClient();
      const { error } = await c.rpc('delete_my_account');
      if (error) throw new Error('Couldn’t delete the account. Check your connection and try again.');
      clearTimeout(pushTimer);
      try { await c.auth.signOut(); } catch {}
    } else {
      const s = localSession(), acc = _accounts();
      if (s && s.email) { delete acc[s.email]; origSet(ACC_KEY, JSON.stringify(acc)); }
    }
    resetDevice();
    localSignOut();
  }

  return {
    CFG, isConfigured, getClient, getUser, getSession,
    signUpEmail, signInEmail, resetPassword, resendConfirmation, updatePassword, providers, sendPhoneCode, verifyPhoneCode, signOut, signInOAuth,
    localSignUp, localSignIn, localSession, localSignOut, sessionAny, signOutAny,
    pull, push, watch, authHeaders, deleteAccount, isPulled: () => !!pulledFor, resetDevice, OWNER_KEY,
    needsOnboarding, clearOnboarding,
  };
})();
