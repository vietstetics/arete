/* ============================================================================
 *  Vercel serverless function — Oura API pass-through.
 *
 *  Oura's API v2 doesn't send CORS headers, so the browser can't call it
 *  directly. Each user supplies their own Oura Personal Access Token (minted
 *  at cloud.ouraring.com/personal-access-tokens); it arrives per-request in
 *  the X-Oura-Token header and is forwarded — never logged, never stored.
 *  Only /v2/usercollection/* paths are allowed through.
 * ==========================================================================*/
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Use GET' }); return; }

  const token = String(req.headers['x-oura-token'] || '').trim();
  if (!token) { res.status(401).json({ error: 'Missing X-Oura-Token header.' }); return; }

  const path = String((req.query && req.query.path) || '');
  if (!/^\/v2\/usercollection\/[a-z_]+$/.test(path)) { res.status(400).json({ error: 'Bad path.' }); return; }

  const qs = new URLSearchParams();
  for (const k of ['start_date', 'end_date', 'start_datetime', 'end_datetime', 'next_token']) {
    if (req.query[k]) qs.set(k, String(req.query[k]));
  }

  try {
    const r = await fetch('https://api.ouraring.com' + path + (qs.toString() ? '?' + qs : ''), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Couldn’t reach Oura.' });
  }
}
