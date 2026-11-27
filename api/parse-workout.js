/* ============================================================================
 *  Vercel serverless function — extract a workout program from a video link.
 *
 *  Takes a TikTok/YouTube/Instagram/any URL (and/or pasted caption text),
 *  fetches the video's public caption/description server-side (no CORS
 *  headaches), and asks Claude to extract the workout split as strict JSON:
 *  program name + days, each day a list of exercises with sets × reps.
 *
 *  It reads the caption/description — it does not watch the video frames.
 *  Most workout videos list the routine in the caption; when they don't,
 *  the client asks the user to paste it.
 *
 *  Setup: ANTHROPIC_API_KEY in Vercel env (already set for analyze-food).
 * ==========================================================================*/
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'programName', 'days', 'note'],
  properties: {
    found: { type: 'boolean', description: 'true only if the text actually describes a workout' },
    programName: { type: 'string', description: 'Short name for the program, e.g. "PPL from @coach"' },
    days: {
      type: 'array',
      description: 'One entry per training day. A single-session video = one day.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'exercises'],
        properties: {
          name: { type: 'string', description: 'e.g. "Push Day", "Day 2 — Pull", "Full Body"' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'sets', 'reps'],
              properties: {
                name: { type: 'string', description: 'Exercise in Title Case gym convention, e.g. "Incline Bench", "Lat Pulldown"' },
                sets: { type: 'number' },
                reps: { type: 'string', description: 'e.g. "8-12", "5", "60s"' },
              },
            },
          },
        },
      },
    },
    note: { type: 'string', description: 'One short caveat, e.g. "reps not stated — defaulted to 8-12"' },
  },
};

const SYSTEM =
  'You extract workout programs from social-media video captions/descriptions. ' +
  'Identify every exercise with its sets and reps. Normalise exercise names to Title Case gym convention ' +
  '(e.g. "incline db press" -> "Incline Dumbbell Press", "rdl" -> "Romanian Deadlift", "lat raises" -> "Lateral Raise"). ' +
  'If sets/reps are missing, default to 3 sets of "8-12" and say so in note. ' +
  'If the text describes a split (Day 1/2, Push/Pull/Legs, Mon/Tue...), group exercises into those days in order; ' +
  'otherwise return a single day named after the session (e.g. "Push Day"). ' +
  'Ignore hashtags, emojis, promo codes and non-workout text. ' +
  'If the text contains no actual workout, set found=false with empty days and explain in note.';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

import { sendError, requireUser } from './_lib/account.js';

// Only the video sites this feature is for. Anything else (an internal address, a cloud metadata IP,
// a random server) is never fetched: the user pastes the caption instead.
const HOSTS = ['tiktok.com', 'youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'fb.watch', 'x.com', 'twitter.com', 'vimeo.com'];
function allowed(u) {
  let x; try { x = new URL(u); } catch { return null; }
  if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return null;
  const h = x.hostname.toLowerCase();
  return HOSTS.some((d) => h === d || h.endsWith('.' + d)) ? x : null;
}
const MAX_PAGE = 2_000_000;

async function fetchText(url, hops = 0) {
  const u = allowed(url);
  if (!u) throw new Error('host not allowed');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(u.href, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'manual', signal: ctl.signal });
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get('location');
      if (!next || hops >= 3) throw new Error('too many redirects');
      return fetchText(new URL(next, u).href, hops + 1);   // re-checked against the allow-list
    }
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_PAGE) throw new Error('page too large');
    const text = await r.text();
    return text.length > MAX_PAGE ? text.slice(0, MAX_PAGE) : text;
  } finally { clearTimeout(t); }
}

function unescapeJson(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
}

function metaTag(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
  return m ? m[1] : '';
}

/** Pull the caption/description for a video URL. Best-effort per platform. */
async function captionFor(url) {
  const parts = [];
  const u = allowed(url);
  if (!u) throw new Error('host not allowed');
  const host = u.hostname;

  if (/tiktok\.com/.test(host)) {
    // TikTok oEmbed returns the caption as `title`.
    const j = JSON.parse(await fetchText('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url)));
    if (j.title) parts.push(j.title);
    if (j.author_name) parts.push('by ' + j.author_name);
  } else if (/youtube\.com|youtu\.be/.test(host)) {
    // Title from oEmbed; full description from the watch page's embedded JSON.
    try {
      const j = JSON.parse(await fetchText('https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json'));
      if (j.title) parts.push(j.title);
    } catch {}
    try {
      const html = await fetchText(url);
      const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m) parts.push(unescapeJson(m[1]).slice(0, 4000));
      else { const d = metaTag(html, 'og:description'); if (d) parts.push(d); }
    } catch {}
  } else {
    // Instagram / anything else: OpenGraph tags off the page.
    const html = await fetchText(url);
    const t = metaTag(html, 'og:title'); if (t) parts.push(t);
    const d = metaTag(html, 'og:description') || metaTag(html, 'description'); if (d) parts.push(d);
    if (!parts.length) { const m = html.match(/<title>([^<]*)<\/title>/i); if (m) parts.push(m[1]); }
  }
  return parts.join('\n').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  // Signed-in users only: otherwise anyone could use this function to fetch pages and run up its bill.
  try { await requireUser(req); } catch (e) { sendError(res, e); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Bring-your-own-key: every visitor supplies their own Anthropic key from
  // Settings, so this shared endpoint never bills the app owner's account.
  // The key is used for this request only — never logged or persisted.
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey || !/^sk-ant-/.test(apiKey)) {
    res.status(401).json({ error: 'missing_key', message: 'Add your Anthropic API key in Settings to use this feature.' });
    return;
  }

  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 2048) : '';
  const pasted = typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : '';
  if (!url && !pasted) { res.status(400).json({ error: 'Provide a video `url` or the caption `text`.' }); return; }

  let caption = '';
  if (url) {
    try { caption = await captionFor(url); }
    catch (e) { caption = ''; }
  }
  const material = [caption, pasted].filter(Boolean).join('\n\n').slice(0, 8000);
  if (material.length < 15) {
    res.status(422).json({ error: 'no_caption', message: 'Couldn’t read that video’s caption — paste the workout text instead.' });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Extract the workout program from this video caption/description:\n\n${material}`,
      }],
    });

    if (message.stop_reason === 'refusal') { res.status(422).json({ error: 'refused', message: 'Couldn’t analyse that text.' }); return; }

    const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let data; try { data = JSON.parse(text); } catch { res.status(502).json({ error: 'unreadable', message: 'The extraction came back unreadable. Try again.' }); return; }
    data.captionUsed = material.slice(0, 500);
    res.status(200).json(data);
  } catch (e) {
    // A bad personal key is the user's to fix; say so without echoing the upstream message.
    if (Number(e && e.status) === 401) { res.status(401).json({ error: 'bad_key', message: 'Anthropic didn’t accept your API key. Check it in Settings.' }); return; }
    sendError(res, e, 'Couldn’t read that workout. Try again.');
  }
}
