/* ============================================================================
 *  Vercel serverless function — Strava OAuth token exchange + refresh.
 *  Same pattern as api/whoop/token.js: keeps the client secret server-side.
 *
 *  Set in Vercel → Settings → Environment Variables:
 *     STRAVA_CLIENT_ID
 *     STRAVA_CLIENT_SECRET
 *  And set CFG.strava.clientId in js/wearables.js to the same client id.
 * ==========================================================================*/
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET are not set on the server.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (body.refresh_token) {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', body.refresh_token);
  } else if (body.code) {
    params.set('grant_type', 'authorization_code');
    params.set('code', body.code);
  } else {
    res.status(400).json({ error: 'Provide either `code` or `refresh_token`.' });
    return;
  }

  try {
    const r = await fetch(STRAVA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = await r.json();
    res.status(r.ok ? 200 : 400).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Strava token exchange failed.' });
  }
}
