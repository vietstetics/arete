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

async function fetchText(url, opts = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'follow', ...opts });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r.text();
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
  const host = new URL(url).hostname;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const pasted = typeof body.text === 'string' ? body.text.trim() : '';
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

    if (message.stop_reason === 'refusal') { res.status(422).json({ error: 'Could not analyse that text.' }); return; }

    const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let data; try { data = JSON.parse(text); } catch { res.status(502).json({ error: 'The extraction came back unreadable — try again.' }); return; }
    data.captionUsed = material.slice(0, 500);
    res.status(200).json(data);
  } catch (e) {
    const status = (e && e.status) || 500;
    res.status(status).json({ error: (e && e.message) || 'Extraction request failed.' });
  }
}
