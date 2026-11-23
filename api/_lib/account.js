/* ============================================================================
 *  Shared by the API functions (files under api/_lib are not public routes).
 *
 *  requireUser(req)   → the signed-in Supabase user, checked with Supabase itself (never trusted
 *                       from the client), or throws { status, code, message }.
 *  claimCredit(token, kind) → spends one of today's AI credits for that user, or throws 429 when the
 *                       daily cap is reached. The cap lives in the database function
 *                       public.claim_ai_credit (supabase/schema.sql), so a client cannot change it.
 *
 *  Needs SUPABASE_URL and SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables (the same
 *  public values as js/auth.js). Without them every AI endpoint stays OFF (fails closed).
 * ==========================================================================*/

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function cfg() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_ANON_KEY || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || key.length < 20) {
    throw new ApiError(503, 'accounts_off', 'This feature turns on once accounts are set up.');
  }
  return { url, key };
}

function bearer(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(h);
  if (!m) throw new ApiError(401, 'signed_out', 'Sign in to use this feature.');
  return m[1];
}

async function call(url, init, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch { throw new ApiError(503, 'accounts_unreachable', 'Couldn’t check your account. Try again in a moment.'); }
  finally { clearTimeout(t); }
}

export async function requireUser(req) {
  const { url, key } = cfg();
  const token = bearer(req);
  const r = await call(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new ApiError(401, 'signed_out', 'Your session has ended. Sign in again.');
  if (!r.ok) throw new ApiError(503, 'accounts_unreachable', 'Couldn’t check your account. Try again in a moment.');
  const user = await r.json().catch(() => null);
  if (!user || typeof user.id !== 'string') throw new ApiError(401, 'signed_out', 'Sign in to use this feature.');
  return { user, token };
}

export async function claimCredit(token, kind) {
  const { url, key } = cfg();
  const r = await call(`${url}/rest/v1/rpc/claim_ai_credit`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_kind: kind }),
  });
  if (!r.ok) throw new ApiError(503, 'accounts_unreachable', 'Couldn’t check today’s limit. Try again in a moment.');
  const left = Number(await r.json().catch(() => NaN));
  if (!Number.isFinite(left)) throw new ApiError(503, 'accounts_unreachable', 'Couldn’t check today’s limit. Try again in a moment.');
  if (left < 0) throw new ApiError(429, 'daily_limit', 'You’ve used today’s photo estimates. They reset at midnight UTC.');
  return left;
}

/** Send an error without leaking internals (stack traces, upstream messages). */
export function sendError(res, e, fallback = 'Something went wrong. Try again.') {
  if (e instanceof ApiError) { res.status(e.status).json({ error: e.code, message: e.message }); return; }
  const s = Number(e && e.status);
  // Upstream (Anthropic) problems: rate limited or overloaded → "try later"; anything else → generic 502.
  if (s === 429 || s === 529 || s === 503) { res.status(503).json({ error: 'busy', message: 'The AI is busy right now. Try again in a minute.' }); return; }
  res.status(502).json({ error: 'upstream', message: fallback });
}
