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
      tokenProxy:  '',
      scope: 'read:recovery read:sleep read:cycles offline',
      authUrl:  'https://api.prod.whoop.com/oauth/oauth2/auth',
      apiBase:  'https://api.prod.whoop.com/developer/v1',
    },
  };

  const TOK_KEY = 'jarvis_whoop_token';
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

  // Call on page load to finish a WHOOP OAuth redirect (no-op otherwise).
  async function handleRedirect() {
    const c = CFG.whoop;
    if (!c.clientId || !c.tokenProxy) return null;
    const p = new URLSearchParams(location.search);
    const code = p.get('code'), state = p.get('state');
    if (!code || !state || state !== sessionStorage.getItem('whoop_state')) return null;
    sessionStorage.removeItem('whoop_state');
    history.replaceState({}, '', location.pathname);           // clean the URL
    try {
      const r = await fetch(c.tokenProxy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, redirect_uri: c.redirectUri }) });
      const tok = await r.json();
      if (tok && tok.access_token) { saveTok(tok); return { ok: true }; }
    } catch {}
    return { ok: false };
  }

  async function connect(kind) {
    if (kind === 'apple') return connectApple();
    if (kind === 'whoop') return connectWhoop();
    return { ok: false, reason: 'Unknown device.' };
  }

  return { connect, available, handleRedirect, isNativeIOS };
})();
