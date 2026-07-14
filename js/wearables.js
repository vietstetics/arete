/* ============================================================================
 *  Wearables — pull a daily readiness number from Apple Watch (Apple Health)
 *  or WHOOP, with an honest "not available → fall back to the questions" path.
 *
 *  Returns a normalized result from connect(kind):
 *     { ok:true,  source, score (0-100), detail }      → use this score
 *     { ok:false, reason }                             → show reason, use questions
 *     { ok:false, pending:true }                       → a redirect is in flight
 *
 *  WHAT LIGHTS UP WHERE
 *   • Apple Watch  → only inside the native iOS app (Apple Health/HealthKit is
 *                    not available in a browser). Needs a HealthKit Capacitor
 *                    plugin + entitlement (see native/README.md).
 *   • WHOOP        → needs a WHOOP developer app (client id) and a tiny token
 *                    endpoint to keep the client secret server-side. Set CFG
 *                    below to enable; until then it reports "not set up".
 *  On the plain website both report unavailable and the app uses the questions.
 * ==========================================================================*/
window.Wearables = (() => {
  // ── Configure to enable WHOOP (leave clientId empty to keep it off) ──────
  const CFG = {
    whoop: {
      clientId:    '',                       // your WHOOP app client id
      redirectUri: location.origin + '/',    // must match the WHOOP app config
      // Serverless endpoint that exchanges ?code → tokens (keeps the secret
      // server-side) and refreshes them. POST {code} or {refresh_token}.
      // Pre-wired to the included Vercel function (api/whoop/token.js); it
      // only does anything once clientId is set and the env vars are deployed.
      tokenProxy:  '/api/whoop/token',
      scope: 'read:recovery read:sleep read:cycles offline',
      authUrl:  'https://api.prod.whoop.com/oauth/oauth2/auth',
      apiBase:  'https://api.prod.whoop.com/developer/v1',
    },
    // Oura works for ANY user today: they paste their own Personal Access
    // Token (cloud.ouraring.com/personal-access-tokens). Oura's API has no
    // CORS, so requests route through the included proxy (api/oura.js);
    // the token travels per-request and is never stored server-side.
    oura: { proxy: '/api/oura' },
    // Fitbit uses OAuth2 PKCE — a public client with NO secret, so the whole
    // flow runs in the browser. Register a free app at dev.fitbit.com
    // (type: Client, redirect = <site>/connections.html), paste the id here.
    fitbit: {
      clientId:    '',
      redirectUri: location.origin + '/connections.html',
      scope: 'sleep activity heartrate',
      authUrl:  'https://www.fitbit.com/oauth2/authorize',
      tokenUrl: 'https://api.fitbit.com/oauth2/token',
      apiBase:  'https://api.fitbit.com',
    },
    // Strava needs a secret for the token exchange → same proxy pattern as
    // WHOOP (api/strava/token.js + env vars). Free app at strava.com/settings/api.
    strava: {
      clientId:    '',
      redirectUri: location.origin + '/connections.html',
      tokenProxy:  '/api/strava/token',
      scope: 'read,activity:read',
      authUrl: 'https://www.strava.com/oauth/authorize',
      apiBase: 'https://www.strava.com/api/v3',
    },
  };

  const TOK_KEY = 'jarvis_whoop_token';
  const OURA_KEY = 'jarvis_oura_token', FITBIT_KEY = 'jarvis_fitbit_token', STRAVA_KEY = 'jarvis_strava_token';
  const loadJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
  const isNativeIOS = () => {
    const c = cap();
    return !!(c && c.isNativePlatform && c.isNativePlatform() && c.getPlatform && c.getPlatform() === 'ios');
  };
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

  function available(kind) {
    if (kind === 'apple') return isNativeIOS();
    if (kind === 'whoop') return !!CFG.whoop.clientId;
    return false;
  }

  // ── Apple Watch via HealthKit (native only) ──────────────────────────────
  async function connectApple() {
    if (!isNativeIOS())
      return { ok: false, reason: 'Apple Watch needs the JARVIS iOS app — Apple Health isn’t available in a browser.' };
    let HK;
    try { HK = cap().registerPlugin('CapacitorHealthkit'); } catch { HK = null; }
    if (!HK) return { ok: false, reason: 'Apple Health plugin isn’t installed in this build.' };
    try {
      await HK.requestAuthorization({
        all: [], write: [],
        read: ['sleepAnalysis', 'heartRateVariability', 'restingHeartRate', 'steps'],
      });
      const end = new Date();
      const start = new Date(end.getTime() - 36 * 3600e3).toISOString();
      const q = (name) => HK.queryHKitSampleType({ sampleName: name, startDate: start, endDate: end.toISOString(), limit: 0 })
        .then(r => (r && r.resultData) || r && r.countReturn && r.resultData || []).catch(() => []);
      const [sleep, hrv, rhr] = await Promise.all([q('sleepAnalysis'), q('heartRateVariability'), q('restingHeartRate')]);
      const score = scoreFromHealth(sleep, hrv, rhr);
      if (score == null) return { ok: false, reason: 'No recent Apple Watch sleep / recovery data found.' };
      return { ok: true, source: 'apple', score, detail: 'Synced from Apple Health (Apple Watch)' };
    } catch (e) {
      return { ok: false, reason: 'Couldn’t read Apple Health — check that permissions were granted.' };
    }
  }

  // Rough but defensible readiness from sleep hours + HRV + resting HR.
  function scoreFromHealth(sleep, hrv, rhr) {
    const hours = sleepHours(sleep);
    const hrvAvg = avgVal(hrv);
    const rhrAvg = avgVal(rhr);
    if (hours == null && hrvAvg == null && rhrAvg == null) return null;
    let parts = [], w = 0;
    if (hours != null) { parts.push(bell(hours, 8, 2) * 100 * 0.5); w += 0.5; }        // 8h ideal
    if (hrvAvg != null) { parts.push(Math.min(100, hrvAvg / 80 * 100) * 0.3); w += 0.3; } // ~80ms = strong
    if (rhrAvg != null) { parts.push(Math.min(100, Math.max(0, (75 - rhrAvg) / 25 * 100)) * 0.2); w += 0.2; }
    return clamp(parts.reduce((a, b) => a + b, 0) / (w || 1));
  }
  const bell = (x, c, s) => Math.exp(-Math.pow(x - c, 2) / (2 * s * s));
  function sleepHours(samples) {
    if (!Array.isArray(samples) || !samples.length) return null;
    // Sum "asleep" durations; fall back to start→end span.
    let ms = 0;
    samples.forEach(s => {
      const a = new Date(s.startDate || s.start || 0).getTime();
      const b = new Date(s.endDate || s.end || 0).getTime();
      const val = String(s.value ?? s.sleepState ?? '').toLowerCase();
      if (b > a && (!val || val.includes('asleep') || val.includes('core') || val.includes('deep') || val.includes('rem'))) ms += b - a;
    });
    return ms > 0 ? Math.min(14, ms / 3600e3) : null;
  }
  function avgVal(samples) {
    if (!Array.isArray(samples) || !samples.length) return null;
    const nums = samples.map(s => Number(s.value ?? s.quantity ?? s.numericValue)).filter(n => isFinite(n));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  // ── WHOOP via OAuth + recovery API ───────────────────────────────────────
  function loadTok() { try { return JSON.parse(localStorage.getItem(TOK_KEY)); } catch { return null; } }
  function saveTok(t) { try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch {} }

  async function connectWhoop() {
    const c = CFG.whoop;
    if (!c.clientId) return { ok: false, reason: 'WHOOP isn’t set up yet — add your WHOOP client id (see native/README.md).' };
    let tok = loadTok();
    if (!tok) {
      if (!c.tokenProxy) return { ok: false, reason: 'WHOOP token endpoint isn’t configured (needed to keep the secret server-side).' };
      const state = Math.random().toString(36).slice(2);
      sessionStorage.setItem('whoop_state', state);
      const u = new URL(c.authUrl);
      u.searchParams.set('client_id', c.clientId);
      u.searchParams.set('redirect_uri', c.redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', c.scope);
      u.searchParams.set('state', state);
      location.href = u.toString();
      return { ok: false, pending: true, reason: 'Redirecting to WHOOP…' };
    }
    try {
      const recov = await whoopRecovery(tok.access_token);
      if (recov == null) return { ok: false, reason: 'No recent WHOOP recovery found.' };
      return { ok: true, source: 'whoop', score: clamp(recov), detail: `Synced from WHOOP — ${clamp(recov)}% recovery` };
    } catch (e) {
      return { ok: false, reason: 'Couldn’t reach WHOOP — try reconnecting.' };
    }
  }

  async function whoopRecovery(accessToken) {
    const r = await fetch(CFG.whoop.apiBase + '/recovery?limit=1', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) throw new Error('whoop ' + r.status);
    const j = await r.json();
    const rec = j.records && j.records[0];
    const s = rec && rec.score && rec.score.recovery_score;
    return s == null ? null : Number(s);
  }

  // ── Oura via personal access token (works for any user, no app registration)
  async function ouraGet(path, params) {
    const tok = (localStorage.getItem(OURA_KEY) || '').trim();
    if (!tok) throw new Error('no oura token');
    const qs = new URLSearchParams(Object.assign({ path }, params || {}));
    const r = await fetch(CFG.oura.proxy + '?' + qs, { headers: { 'X-Oura-Token': tok } });
    if (!r.ok) throw new Error('oura ' + r.status);
    return r.json();
  }
  async function connectOura(token) {
    if (token) {
      localStorage.setItem(OURA_KEY, token.trim());
      try { await ouraGet('/v2/usercollection/personal_info'); }
      catch (e) {
        localStorage.removeItem(OURA_KEY);
        return { ok: false, reason: 'That token didn’t work — copy it again from cloud.ouraring.com and retry.' };
      }
      return { ok: true, source: 'oura', detail: 'Connected to Oura' };
    }
    if ((localStorage.getItem(OURA_KEY) || '').trim()) return { ok: true, source: 'oura' };
    return { ok: false, needsToken: true, reason: 'Paste your Oura personal access token to connect.' };
  }
  async function statsOura() {
    if (!(localStorage.getItem(OURA_KEY) || '').trim()) return null;
    const today = localDateStr(), yest = localDateStr(new Date(Date.now() - 86400e3));
    const out = {};
    try { // readiness score → same slot as WHOOP recovery
      const j = await ouraGet('/v2/usercollection/daily_readiness', { start_date: yest, end_date: today });
      const rec = j.data && j.data[j.data.length - 1];
      if (rec && rec.score != null) out.recovery = Math.round(rec.score);
    } catch {}
    try { // sleep sessions carry duration + HRV + lowest HR
      const j = await ouraGet('/v2/usercollection/sleep', { start_date: yest, end_date: today });
      const s = (j.data || []).filter(x => (x.total_sleep_duration || 0) > 3 * 3600).pop() || (j.data || []).pop();
      if (s) {
        if (s.total_sleep_duration) out.sleepH = Math.round(s.total_sleep_duration / 360) / 10;
        if (s.average_hrv != null) out.hrv = Math.round(s.average_hrv);
        if (s.lowest_heart_rate != null) out.rhr = Math.round(s.lowest_heart_rate);
      }
    } catch {}
    try {
      const j = await ouraGet('/v2/usercollection/daily_activity', { start_date: today, end_date: today });
      const a = j.data && j.data[j.data.length - 1];
      if (a && a.steps != null) out.steps = Math.round(a.steps);
    } catch {}
    return Object.keys(out).length ? out : null;
  }

  // ── Fitbit via OAuth2 PKCE (public client — no secret, all in the browser) ─
  const b64url = (bytes) => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function connectFitbit() {
    const c = CFG.fitbit;
    if (!c.clientId) return { ok: false, reason: 'Fitbit sign-in isn’t switched on for this app yet.' };
    if (loadJson(FITBIT_KEY)) return { ok: true, source: 'fitbit' };
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = 'fb_' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('fb_verifier', verifier);
    sessionStorage.setItem('fb_state', state);
    const u = new URL(c.authUrl);
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('scope', c.scope);
    u.searchParams.set('state', state);
    u.searchParams.set('redirect_uri', c.redirectUri);
    location.href = u.toString();
    return { ok: false, pending: true, reason: 'Redirecting to Fitbit…' };
  }
  async function fitbitToken() {
    const c = CFG.fitbit;
    let tok = loadJson(FITBIT_KEY);
    if (!tok) return null;
    if (Date.now() > (tok._at || 0) + ((tok.expires_in || 28800) - 90) * 1000 && tok.refresh_token) {
      try {
        const body = new URLSearchParams({ client_id: c.clientId, grant_type: 'refresh_token', refresh_token: tok.refresh_token });
        const r = await fetch(c.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const j = await r.json();
        if (j && j.access_token) { j._at = Date.now(); saveJson(FITBIT_KEY, j); tok = j; }
      } catch {}
    }
    return tok;
  }
  async function fitbitGet(path) {
    const tok = await fitbitToken();
    if (!tok) throw new Error('no fitbit token');
    const r = await fetch(CFG.fitbit.apiBase + path, { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (!r.ok) throw new Error('fitbit ' + r.status);
    return r.json();
  }
  async function statsFitbit() {
    if (!loadJson(FITBIT_KEY)) return null;
    const out = {};
    try { const j = await fitbitGet('/1.2/user/-/sleep/date/today.json');
      const m = j.summary && j.summary.totalMinutesAsleep; if (m) out.sleepH = Math.round(m / 6) / 10; } catch {}
    try { const j = await fitbitGet('/1/user/-/activities/date/today.json');
      const s = j.summary && j.summary.steps; if (s != null) out.steps = Math.round(s);
      const r = j.summary && j.summary.restingHeartRate; if (r != null) out.rhr = Math.round(r); } catch {}
    try { const j = await fitbitGet('/1/user/-/hrv/date/today.json');
      const v = j.hrv && j.hrv[0] && j.hrv[0].value && j.hrv[0].value.dailyRmssd; if (v != null) out.hrv = Math.round(v); } catch {}
    return Object.keys(out).length ? out : null;
  }

  // ── Strava via OAuth (token exchange through api/strava/token.js) ─────────
  async function connectStrava() {
    const c = CFG.strava;
    if (!c.clientId) return { ok: false, reason: 'Strava sign-in isn’t switched on for this app yet.' };
    if (loadJson(STRAVA_KEY)) return { ok: true, source: 'strava' };
    const state = 'st_' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('st_state', state);
    const u = new URL(c.authUrl);
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('redirect_uri', c.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('approval_prompt', 'auto');
    u.searchParams.set('scope', c.scope);
    u.searchParams.set('state', state);
    location.href = u.toString();
    return { ok: false, pending: true, reason: 'Redirecting to Strava…' };
  }
  async function statsStrava() {
    const tok = loadJson(STRAVA_KEY);
    if (!tok) return null;
    try {
      const r = await fetch(CFG.strava.apiBase + '/athlete/activities?per_page=1', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      if (!r.ok) return null;
      const a = (await r.json())[0];
      return a ? { last: a.name + ' · ' + new Date(a.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } : null;
    } catch { return null; }
  }

  // ── Bluetooth heart-rate monitors (Polar / Garmin / Wahoo straps…) ────────
  // Standard BLE heart_rate service — works right now in Chrome/Edge/Android,
  // no account or API key. Streams live bpm into the hub.
  let bleDevice = null;
  async function connectBle() {
    if (!navigator.bluetooth) return { ok: false, reason: 'Bluetooth isn’t available in this browser — use Chrome on desktop or Android.' };
    try {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService('heart_rate');
      const ch = await svc.getCharacteristic('heart_rate_measurement');
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const dv = e.target.value;
        const bpm = (dv.getUint8(0) & 1) ? dv.getUint16(1, true) : dv.getUint8(1);
        cacheStats('ble', { hr: bpm });
        try { window.dispatchEvent(new CustomEvent('arete-hr', { detail: { bpm } })); } catch {}
      });
      dev.addEventListener('gattserverdisconnected', () => {
        bleDevice = null;
        try { window.dispatchEvent(new CustomEvent('arete-hr', { detail: { bpm: null } })); } catch {}
      });
      bleDevice = dev;
      return { ok: true, source: 'ble', detail: 'Connected — live heart rate streaming' };
    } catch (e) {
      if (e && e.name === 'NotFoundError') return { ok: false, reason: 'No device selected.' };
      return { ok: false, reason: 'Couldn’t connect — make sure the strap is worn and broadcasting.' };
    }
  }

  // Call on page load to finish an OAuth redirect (WHOOP / Fitbit / Strava).
  // Returns { ok, provider } when a connection just completed.
  async function handleRedirect() {
    const p = new URLSearchParams(location.search);
    const code = p.get('code'), state = p.get('state') || '';
    if (!code || !state) return null;

    if (state.indexOf('fb_') === 0 && state === sessionStorage.getItem('fb_state')) {
      sessionStorage.removeItem('fb_state');
      history.replaceState({}, '', location.pathname);
      try {
        const body = new URLSearchParams({
          client_id: CFG.fitbit.clientId, grant_type: 'authorization_code',
          code, code_verifier: sessionStorage.getItem('fb_verifier') || '', redirect_uri: CFG.fitbit.redirectUri,
        });
        const r = await fetch(CFG.fitbit.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const tok = await r.json();
        if (tok && tok.access_token) { tok._at = Date.now(); saveJson(FITBIT_KEY, tok); return { ok: true, provider: 'fitbit' }; }
      } catch {}
      return { ok: false, provider: 'fitbit' };
    }

    if (state.indexOf('st_') === 0 && state === sessionStorage.getItem('st_state')) {
      sessionStorage.removeItem('st_state');
      history.replaceState({}, '', location.pathname);
      try {
        const r = await fetch(CFG.strava.tokenProxy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        const tok = await r.json();
        if (tok && tok.access_token) { saveJson(STRAVA_KEY, tok); return { ok: true, provider: 'strava' }; }
      } catch {}
      return { ok: false, provider: 'strava' };
    }

    if (CFG.whoop.clientId && CFG.whoop.tokenProxy && state === sessionStorage.getItem('whoop_state')) {
      sessionStorage.removeItem('whoop_state');
      history.replaceState({}, '', location.pathname);
      try {
        const r = await fetch(CFG.whoop.tokenProxy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, redirect_uri: CFG.whoop.redirectUri }) });
        const tok = await r.json();
        if (tok && tok.access_token) { saveTok(tok); return { ok: true, provider: 'whoop' }; }
      } catch {}
      return { ok: false, provider: 'whoop' };
    }
    return null;
  }

  const isNativeAndroid = () => {
    const c = cap();
    return !!(c && c.isNativePlatform && c.isNativePlatform() && c.getPlatform && c.getPlatform() === 'android');
  };
  const sumVal = (samples) => {
    if (!Array.isArray(samples) || !samples.length) return null;
    const nums = samples.map(s => Number(s.value ?? s.quantity ?? s.numericValue)).filter(n => isFinite(n));
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };

  // ── Connectable trackers (how each connects + what it provides) ──────────
  const PROVIDERS = [
    { id: 'apple',  name: 'Apple Watch',   group: 'Wearables',   method: 'Apple Health (iOS app)', color: '#1D1D1F',
      blurb: 'Sleep, HRV, resting heart rate, steps & workouts from Apple Health.',
      provides: ['Sleep', 'HRV', 'Resting HR', 'Steps'] },
    { id: 'whoop',  name: 'WHOOP',         group: 'Wearables',   method: 'WHOOP API (OAuth)', color: '#0B0B0B',
      blurb: 'Recovery, strain, sleep performance, HRV & resting heart rate.',
      provides: ['Recovery', 'Sleep', 'HRV', 'Resting HR'] },
    { id: 'oura',   name: 'Oura Ring',     group: 'Wearables',   method: 'Personal token — works now', color: '#46469B',
      blurb: 'Readiness, sleep, HRV, resting heart rate & steps — connect in one minute with your own Oura token.',
      provides: ['Readiness', 'Sleep', 'HRV', 'Resting HR', 'Steps'] },
    { id: 'ble',    name: 'Heart Rate Monitor', group: 'Wearables', method: 'Bluetooth — works now', color: '#E11D48',
      blurb: 'Any Bluetooth chest strap or armband — Polar, Garmin, Wahoo, CooSpo — streams live heart rate. No account needed.',
      provides: ['Live heart rate'] },
    { id: 'fitbit', name: 'Fitbit',        group: 'Wearables',   method: 'Fitbit API (OAuth)', color: '#00B0B9',
      blurb: 'Sleep, steps, resting heart rate & HRV.',
      provides: ['Sleep', 'Steps', 'Resting HR', 'HRV'] },
    { id: 'garmin', name: 'Garmin',        group: 'Wearables',   method: 'Via Apple Health / Health Connect', color: '#007CC3',
      blurb: 'Garmin’s API is partner-only — sync your Garmin through Apple Health (iOS) or Health Connect (Android) and it flows in from there.',
      provides: ['Sleep', 'HRV', 'Steps'] },
    { id: 'healthconnect', name: 'Health Connect', group: 'Phone health', method: 'Android app', color: '#3DDC84',
      blurb: 'Android’s health hub — steps, sleep & heart rate from any synced app.',
      provides: ['Steps', 'Sleep', 'Heart rate'] },
    { id: 'strava', name: 'Strava',        group: 'Activity apps', method: 'Strava API (OAuth)', color: '#FC4C02',
      blurb: 'Runs, rides & workouts to enrich your training load.',
      provides: ['Workouts', 'Activities'] },
  ];
  // Plain-language "what tapping Connect does" for each tracker.
  const HOW = {
    apple:        'Grant Apple Health access in the iOS app',
    whoop:        'Sign in with your WHOOP account',
    oura:         'Paste your Oura token — takes a minute',
    ble:          'Pair over Bluetooth — no account needed',
    fitbit:       'Sign in with your Fitbit account',
    garmin:       'Syncs via Apple Health / Health Connect',
    healthconnect:'Allow Health Connect in the Android app',
    strava:       'Sign in with your Strava account',
  };
  PROVIDERS.forEach(function (p) { p.how = HOW[p.id] || p.method; });

  // Clear, user-facing state for each tracker.
  //   connected → already linked   ·  ready → can connect right now
  //   app       → needs the phone app  ·  soon → integration coming
  function providerState(id) {
    if (getConnections()[id]) return 'connected';
    if (availableProvider(id)) return 'ready';
    if (id === 'apple' || id === 'healthconnect') return 'app';
    if (id === 'garmin') return 'via';   // partner-only API — flows in through the phone health hubs
    return 'soon';
  }

  // Which connected source is most trustworthy for each metric (first wins).
  const PRIORITY = {
    recovery: ['whoop', 'oura'],
    sleepH:   ['oura', 'whoop', 'apple', 'fitbit', 'healthconnect'],
    hrv:      ['whoop', 'oura', 'apple', 'fitbit'],
    rhr:      ['whoop', 'oura', 'apple', 'fitbit'],
    steps:    ['apple', 'healthconnect', 'oura', 'fitbit', 'garmin'],
  };

  // ── Per-source stat readers (real for apple/whoop) ───────────────────────
  async function statsApple() {
    if (!isNativeIOS()) return null;
    let HK; try { HK = cap().registerPlugin('CapacitorHealthkit'); } catch { return null; }
    if (!HK) return null;
    try {
      const end = new Date(), start = new Date(end.getTime() - 36 * 3600e3).toISOString();
      const q = (name) => HK.queryHKitSampleType({ sampleName: name, startDate: start, endDate: end.toISOString(), limit: 0 })
        .then(r => (r && r.resultData) || []).catch(() => []);
      const [sleep, hrv, rhr, steps] = await Promise.all([q('sleepAnalysis'), q('heartRateVariability'), q('restingHeartRate'), q('stepCount')]);
      const out = {};
      const sh = sleepHours(sleep); if (sh != null) out.sleepH = Math.round(sh * 10) / 10;
      const h = avgVal(hrv); if (h != null) out.hrv = Math.round(h);
      const r = avgVal(rhr); if (r != null) out.rhr = Math.round(r);
      const st = sumVal(steps); if (st != null) out.steps = Math.round(st);
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }
  async function statsWhoop() {
    const tok = loadTok(); if (!tok) return null;
    try {
      const r = await fetch(CFG.whoop.apiBase + '/recovery?limit=1', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      if (!r.ok) return null;
      const j = await r.json(); const s = j.records && j.records[0] && j.records[0].score;
      if (!s) return null;
      const out = {};
      if (s.recovery_score != null)     out.recovery = Math.round(s.recovery_score);
      if (s.resting_heart_rate != null) out.rhr = Math.round(s.resting_heart_rate);
      if (s.hrv_rmssd_milli != null)    out.hrv = Math.round(s.hrv_rmssd_milli);
      try {
        const sr = await fetch(CFG.whoop.apiBase + '/activity/sleep?limit=1', { headers: { Authorization: 'Bearer ' + tok.access_token } });
        if (sr.ok) {
          const ss = (await sr.json()).records?.[0]?.score?.stage_summary;
          const ms = ss && (ss.total_in_bed_time_milli - (ss.total_awake_time_milli || 0));
          if (ms) out.sleepH = Math.round(ms / 3600e3 * 10) / 10;
        }
      } catch {}
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }
  async function latestStats(id) {
    let s = null;
    if (id === 'apple') s = await statsApple();
    else if (id === 'whoop') s = await statsWhoop();
    else if (id === 'oura') s = await statsOura();
    else if (id === 'fitbit') s = await statsFitbit();
    else if (id === 'strava') s = await statsStrava();
    else if (id === 'ble') s = (getStatsCache().ble || null);
    if (s) { cacheStats(id, s); applyBestToData(); }
    return s;
  }

  // ── Feed connected-device readings into the app's real data ──────────────
  // Uses the most accurate source per metric (PRIORITY) and writes into the
  // same stores the dashboard / Energy Intelligence / steps already read, so a
  // wearable contributes to the day score, the forecast and step totals.
  const pad2 = (n) => String(n).padStart(2, '0');
  function localDateStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function scoreCategory(s) {
    if (s >= 90) return 'Peak Readiness';
    if (s >= 75) return 'Strong Morning';
    if (s >= 60) return 'Balanced';
    if (s >= 40) return 'Low Readiness';
    return 'Recovery Priority';
  }
  // Recovery (WHOOP) maps straight through; otherwise derive from sleep+HRV+RHR.
  function scoreFromStats(s) {
    if (s.recovery != null) return clamp(s.recovery);
    let parts = [], w = 0;
    if (s.sleepH != null) { parts.push(bell(s.sleepH, 8, 2) * 100 * 0.5); w += 0.5; }
    if (s.hrv != null)    { parts.push(Math.min(100, s.hrv / 80 * 100) * 0.3); w += 0.3; }
    if (s.rhr != null)    { parts.push(Math.min(100, Math.max(0, (75 - s.rhr) / 25 * 100)) * 0.2); w += 0.2; }
    return w ? clamp(parts.reduce((a, b) => a + b, 0) / w) : null;
  }
  function upsertSleep(date, hours, src) {
    let log; try { log = JSON.parse(localStorage.getItem('jarvis_sleep_log')) || []; } catch { log = []; }
    const existing = log.find(r => r.date === date);
    const lastWake = existing && existing.wake ? existing.wake : (log.length ? log[log.length - 1].wake : '07:00');
    const [wh, wm] = String(lastWake || '07:00').split(':').map(Number);
    const wakeMin = (wh || 7) * 60 + (wm || 0);
    const onsetMin = ((wakeMin - Math.round(hours * 60)) % 1440 + 1440) % 1440;
    const onset = pad2(Math.floor(onsetMin / 60)) + ':' + pad2(onsetMin % 60);
    const rec = { date, onset, wake: lastWake || '07:00', quality: existing ? existing.quality : 7, source: src || 'wearable' };
    const out = log.filter(r => r.date !== date); out.push(rec);
    out.sort((a, b) => a.date < b.date ? -1 : 1);
    try { localStorage.setItem('jarvis_sleep_log', JSON.stringify(out.slice(-60))); } catch {}
  }
  function upsertSteps(date, steps, src) {
    let map; try { map = JSON.parse(localStorage.getItem('jarvis_steps')) || {}; } catch { map = {}; }
    map[date] = { date, steps: Math.max(0, Math.round(steps)), goal: (map[date] && map[date].goal) || 10000, source: src || 'wearable', lastSyncedAt: new Date().toISOString() };
    try { localStorage.setItem('jarvis_steps', JSON.stringify(map)); } catch {}
  }
  function applyDayScore(date, score, src, sleepH) {
    if (score == null) return;
    let ci = null; try { ci = JSON.parse(localStorage.getItem('jarvis_checkin')); } catch {}
    const rec = (ci && ci.date === date) ? ci : { id: Date.now().toString(), date, answers: {} };
    rec.morningScore = Math.round(score);
    rec.scoreCategory = scoreCategory(rec.morningScore);
    rec.source = src;
    rec.completedAt = new Date().toISOString();
    if (sleepH != null) rec.sleepDurationHours = Math.round(sleepH * 10) / 10;
    try { localStorage.setItem('jarvis_checkin', JSON.stringify(rec)); } catch {}
  }
  function applyBestToData() {
    const best = bestReadings();
    if (!Object.keys(best).length) return;
    const date = localDateStr();
    const stats = {}; for (const k in best) stats[k] = best[k].value;
    const src = (best.recovery && best.recovery.source) || (best.sleepH && best.sleepH.source) || 'wearable';
    if (stats.sleepH != null) upsertSleep(date, stats.sleepH, src);
    if (stats.steps != null) upsertSteps(date, stats.steps, (best.steps && best.steps.source) || src);
    applyDayScore(date, scoreFromStats(stats), src, stats.sleepH);
  }

  // ── Connection state + cached readings (so the hub renders offline too) ──
  const CONN_KEY = 'jarvis_connections', STATS_KEY = 'jarvis_conn_stats';
  function getConnections() { try { return JSON.parse(localStorage.getItem(CONN_KEY)) || {}; } catch { return {}; } }
  function setConnected(id, on) {
    const c = getConnections();
    if (on) c[id] = Date.now(); else { delete c[id]; const s = getStatsCache(); delete s[id]; try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch {} }
    try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch {}
    applyBestToData();   // recompute the day's contribution from remaining sources
  }
  function getStatsCache() { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { return {}; } }
  function cacheStats(id, s) { const c = getStatsCache(); c[id] = { ...s, _at: Date.now() }; try { localStorage.setItem(STATS_KEY, JSON.stringify(c)); } catch {} }

  // Best value per metric across connected sources → most accurate reading.
  function bestReadings() {
    const cache = getStatsCache(), out = {};
    for (const metric in PRIORITY) {
      for (const src of PRIORITY[metric]) {
        const v = cache[src] && cache[src][metric];
        if (v != null && isFinite(v)) { out[metric] = { value: v, source: src }; break; }
      }
    }
    return out;
  }

  async function connectHealthConnect() {
    if (!isNativeAndroid()) return { ok: false, reason: 'Health Connect needs the JARVIS Android app.' };
    return { ok: false, reason: 'Health Connect isn’t wired into this build yet — see native/README.md.' };
  }
  function providerNeeds(kind) {
    if (kind === 'garmin') return 'Garmin doesn’t offer individual API access — sync your Garmin to Apple Health (iOS) or Health Connect (Android) and connect that here instead.';
    const p = PROVIDERS.find(x => x.id === kind);
    return p ? `${p.name} sign-in isn’t switched on for this app yet.` : 'Unknown device.';
  }

  async function connect(kind, arg) {
    let res;
    if (kind === 'apple') res = await connectApple();
    else if (kind === 'whoop') res = await connectWhoop();
    else if (kind === 'oura') res = await connectOura(arg);
    else if (kind === 'fitbit') res = await connectFitbit();
    else if (kind === 'strava') res = await connectStrava();
    else if (kind === 'ble') res = await connectBle();
    else if (kind === 'healthconnect') res = await connectHealthConnect();
    else res = { ok: false, reason: providerNeeds(kind) };
    if (res && res.ok) { setConnected(kind, true); latestStats(kind); }
    return res;
  }

  function availableProvider(id) {
    if (id === 'apple') return isNativeIOS();
    if (id === 'whoop') return !!CFG.whoop.clientId;
    if (id === 'oura') return true;                          // any user's own token
    if (id === 'ble') return !!navigator.bluetooth;          // Chrome / Edge / Android
    if (id === 'fitbit') return !!CFG.fitbit.clientId;
    if (id === 'strava') return !!CFG.strava.clientId;
    if (id === 'healthconnect') return isNativeAndroid();
    return false;
  }

  return {
    connect, available, availableProvider, providerState, handleRedirect, isNativeIOS, isNativeAndroid,
    PROVIDERS, latestStats, bestReadings, getConnections, setConnected, getStatsCache, applyBestToData,
  };
})();
