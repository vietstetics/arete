/* ============================================================================
 *  Vercel serverless function — WHOOP OAuth token exchange + refresh.
 *
 *  Keeps the WHOOP client secret server-side (it must never ship in the
 *  browser bundle). The frontend (js/wearables.js) POSTs here with either an
 *  authorization `code` (first connect) or a `refresh_token`, and gets back
 *  WHOOP's token JSON.
 *
 *  Set these in your Vercel project → Settings → Environment Variables:
 *     WHOOP_CLIENT_ID
 *     WHOOP_CLIENT_SECRET
 *  And set CFG.whoop.clientId in js/wearables.js to the same client id.
 * ==========================================================================*/
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET are not set on the server.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { code, refresh_token, redirect_uri } = body;

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (refresh_token) {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refresh_token);
    params.set('scope', 'offline');
  } else if (code) {
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    if (redirect_uri) params.set('redirect_uri', redirect_uri);
  } else {
    res.status(400).json({ error: 'Provide either `code` or `refresh_token`.' });
    return;
  }

  try {
    const r = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 400).json(data);
  } catch (e) {
    res.status(502).json({ error: 'WHOOP token exchange failed.' });
  }
}
