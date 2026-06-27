/* ============================================================================
 *  Vercel serverless function — AI calorie estimate from a food photo.
 *
 *  Takes a base64 image, asks Claude (vision) to identify the food and estimate
 *  per-item + total calories/macros for the portion shown, and returns strict
 *  JSON. The ANTHROPIC_API_KEY stays server-side (never shipped to the browser).
 *
 *  Setup: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.
 *  Model: claude-opus-4-8 (vision). Output is constrained to the schema below.
 * ==========================================================================*/
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'serving', 'confidence', 'items', 'kcal', 'protein', 'carbs', 'fat', 'note'],
  properties: {
    name:       { type: 'string', description: 'Short name of the overall dish/meal in the photo' },
    serving:    { type: 'string', description: 'The portion this estimate is for, e.g. "1 plate", "approx 350 g"' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    items: {
      type: 'array',
      description: 'Each distinct food/component visible',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kcal', 'protein', 'carbs', 'fat'],
        properties: {
          name:    { type: 'string' },
          kcal:    { type: 'number' },
          protein: { type: 'number' },
          carbs:   { type: 'number' },
          fat:     { type: 'number' },
        },
      },
    },
    kcal:    { type: 'number', description: 'Total calories for the whole photo' },
    protein: { type: 'number' },
    carbs:   { type: 'number' },
    fat:     { type: 'number' },
    note:    { type: 'string', description: 'One short caveat or assumption, e.g. "assumed olive-oil dressing"' },
  },
};

const SYSTEM =
  'You are a meticulous nutrition estimator. Look at the food photo and estimate, for the portion actually shown, the dish name, each distinct component, and per-item plus total Calories and macronutrients (grams of protein, carbs, fat). Use realistic restaurant/home portions and standard nutrition data. If the image is unclear, ambiguous, or not food, set confidence to "low" and keep numbers conservative. Round Calories to the nearest 5 and macros to the nearest whole gram. Totals should equal the sum of the items.';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let image = body.image;
  let mediaType = body.media_type;
  if (!image || typeof image !== 'string') { res.status(400).json({ error: 'Provide a base64 image in `image`.' }); return; }

  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(image);
  if (m) { mediaType = mediaType || m[1]; image = m[2]; }
  mediaType = (mediaType || 'image/jpeg').toLowerCase();
  image = image.replace(/\s/g, '');

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: 'Estimate the Calories and macros of the food in this photo. Return only the structured fields.' },
        ],
      }],
    });

    if (message.stop_reason === 'refusal') { res.status(422).json({ error: 'Could not analyse that image.' }); return; }

    const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let data; try { data = JSON.parse(text); } catch { res.status(502).json({ error: 'The estimate came back unreadable — try another photo.' }); return; }
    res.status(200).json(data);
  } catch (e) {
    const status = (e && e.status) || 500;
    res.status(status).json({ error: (e && e.message) || 'Vision request failed.' });
  }
}
