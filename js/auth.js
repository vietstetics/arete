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
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    signUpEmail, signInEmail, resetPassword, sendPhoneCode, verifyPhoneCode, signOut,
    localSignUp, localSignIn, localSession, localSignOut, sessionAny, signOutAny,
    pull, push, watch,
  };
})();
