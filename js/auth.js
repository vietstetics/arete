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
    url:     '',   // e.g. https://abcdxyz.supabase.co
    anonKey: '',   // anon / public key (safe to expose)
  };

  let client = null, loadingPromise = null, watching = false;
  const isConfigured = () => !!(CFG.url && CFG.anonKey);

  function loadSDK() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (loadingPromise) return loadingPromise;
    loadingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
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
  async function signUpEmail(email, password) { const c = await getClient(); return c.auth.signUp({ email, password }); }
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

  // ── Secure per-user cloud sync of the app's data (all jarvis_* keys) ──────
  const PREFIX = 'jarvis_';
  function snapshot() {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) o[k] = localStorage.getItem(k); }
    return o;
  }
  async function pull() {
    const c = await getClient(); const u = await getUser(); if (!u) return;
    const { data, error } = await c.from('user_data').select('data').eq('user_id', u.id).maybeSingle();
    if (error || !data || !data.data) return;
    for (const k in data.data) { try { localStorage.setItem(k, data.data[k]); } catch {} }
  }
  let pushTimer = null, pushing = false;
  async function push() {
    if (pushing) return; pushing = true;
    try { const c = await getClient(); const u = await getUser(); if (u) await c.from('user_data').upsert({ user_id: u.id, data: snapshot(), updated_at: new Date().toISOString() }); }
    catch {} finally { pushing = false; }
  }
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 2500); }
  // Mirror any jarvis_* write up to the cloud (debounced) once signed in.
  function watch() {
    if (watching) return; watching = true;
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) { orig(k, v); if (typeof k === 'string' && k.indexOf(PREFIX) === 0) schedulePush(); };
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
    const acc = _accounts();
    if (acc[email]) throw new Error('An account with that email already exists on this device — sign in instead.');
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    acc[email] = { salt, hash: await _hash(pw, salt), createdAt: Date.now() };
    localStorage.setItem(ACC_KEY, JSON.stringify(acc));
    localStorage.setItem(SES_KEY, JSON.stringify({ email, at: Date.now() }));
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
  function localSignOut() { localStorage.removeItem(SES_KEY); }
  async function sessionAny() { return isConfigured() ? getSession() : localSession(); }
  async function signOutAny() { if (isConfigured()) await signOut(); localSignOut(); }

  return {
    CFG, isConfigured, getClient, getUser, getSession,
    signUpEmail, signInEmail, resetPassword, sendPhoneCode, verifyPhoneCode, signOut, signInOAuth,
    localSignUp, localSignIn, localSession, localSignOut, sessionAny, signOutAny,
    pull, push, watch,
  };
})();
