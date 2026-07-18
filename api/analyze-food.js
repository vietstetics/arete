/* ============================================================================
 *  Vercel serverless function — AI calorie estimate from a food photo.
 *
 *  Takes a base64 image, asks Claude (vision) to identify the food and estimate
 *  per-item + total calories/macros for the portion shown, and returns strict
 *  JSON. The ANTHROPIC_API_KEY stays server-side (never shipped to the browser).
 *
 *  Accuracy design:
 *   - Weight-first method: the model estimates each item's served weight in
 *     grams from visual scale cues, then derives macros from standard per-100 g
 *     composition — much more accurate than guessing macros directly.
 *   - Micronutrients (fiber, sugars, sat fat, sodium, cholesterol, potassium,
 *     calcium, iron) estimated per item from the same reference data.
 *   - Server-side reconciliation: every item must satisfy the Atwater identity
 *     (kcal ≈ 4·protein + 4·carbs + 9·fat). kJ-as-kcal slips are auto-fixed,
 *     larger disagreements resolve in favour of the macros, and totals are
 *     recomputed as the sum of items so nothing drifts.
 *
 *  Setup: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.
 * ==========================================================================*/
import Anthropic from '@anthropic-ai/sdk';

const EXT_PROPS = {
  fiber:       { type: 'number', description: 'Dietary fiber, g' },
  sugar:       { type: 'number', description: 'Total sugars, g' },
  satFat:      { type: 'number', description: 'Saturated fat, g' },
  sodium:      { type: 'number', description: 'Sodium, mg' },
  cholesterol: { type: 'number', description: 'Cholesterol, mg' },
  potassium:   { type: 'number', description: 'Potassium, mg' },
  calcium:     { type: 'number', description: 'Calcium, mg' },
  iron:        { type: 'number', description: 'Iron, mg' },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'serving', 'confidence', 'items', 'kcal', 'protein', 'carbs', 'fat', 'note'],
  properties: {
    name:       { type: 'string', description: 'Short name of the overall dish/meal in the photo' },
    serving:    { type: 'string', description: 'The portion this estimate is for, e.g. "1 plate, approx 420 g"' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    items: {
      type: 'array',
      description: 'Each distinct food/component visible',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
        properties: {
          name:    { type: 'string' },
          grams:   { type: 'number', description: 'Estimated served weight of this item in grams (as prepared)' },
          kcal:    { type: 'number' },
          protein: { type: 'number' },
          carbs:   { type: 'number' },
          fat:     { type: 'number' },
          ext: {
            type: 'object',
            additionalProperties: false,
            description: 'Micronutrients for this item portion',
            properties: EXT_PROPS,
          },
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

const SYSTEM = [
  'You are a meticulous nutrition estimator. Work weight-first, never guess macros directly:',
  '1. Identify each distinct food component in the photo, including cooking fat, sauces and dressings that must be present for the dish to look like this.',
  '2. Estimate each component\'s SERVED weight in grams (as prepared) using visual scale cues: a dinner plate is ~27 cm, a fork is ~19 cm, a tablespoon ~15 ml, a standard bowl ~350–500 ml, a can 330 ml. State the total in `serving`.',
  '3. Derive each item\'s calories and macros from standard USDA-style per-100 g composition for that food AS PREPARED (grilled vs fried vs breaded matters). grams × per-100 g ÷ 100.',
  '4. Verify every item: kcal must be within about 10% of 4×protein + 4×carbs + 9×fat. If they disagree, the macros are wrong — redo them, do not fudge the calories.',
  '5. Estimate each item\'s micronutrients from the same reference data: fiber, total sugars, saturated fat (g); sodium, cholesterol, potassium, calcium, iron (mg). Include salting typical for the visible preparation (restaurant food is salted harder than home food). Omit `ext` only if the item is a complete unknown.',
  'If the image is unclear, ambiguous, or not food, set confidence to "low" and keep numbers conservative. Round calories to the nearest 5, macros to the nearest gram, micronutrients sensibly. Totals must equal the sum of the items.',
].join('\n');

// ── server-side reconciliation ──────────────────────────────────────────────
const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };

function reconcileItem(it) {
  const out = {
    name: String(it.name || 'Food item'),
    grams: num(it.grams) || undefined,
    kcal: num(it.kcal), protein: num(it.protein), carbs: num(it.carbs), fat: num(it.fat),
  };
  const atwater = 4 * out.protein + 4 * out.carbs + 9 * out.fat;
  if (atwater >= 40) {
    // kJ slipped into the kcal field → ratio sits at ~4.184
    if (out.kcal / atwater > 3.7 && out.kcal / atwater < 4.7) out.kcal = out.kcal / 4.184;
    // Beyond label-rounding tolerance → the macros win
    if (Math.abs(out.kcal - atwater) / atwater > 0.25) out.kcal = atwater;
  }
  out.kcal = Math.round(out.kcal);

  if (it.ext && typeof it.ext === 'object') {
    const ext = {};
    for (const k of Object.keys(EXT_PROPS)) {
      if (it.ext[k] == null) continue;
      let v = num(it.ext[k]);
      // physical bounds: sub-nutrients can't exceed their parent macro
      if (k === 'satFat') v = Math.min(v, out.fat);
      if (k === 'sugar' || k === 'fiber') v = Math.min(v, out.carbs);
      ext[k] = Math.round(v * 10) / 10;
    }
    if (Object.keys(ext).length) out.ext = ext;
  }
  return out;
}

function reconcile(data) {
  const items = (Array.isArray(data.items) ? data.items : []).map(reconcileItem);
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const text = { ...t };
  const extT = {};
  items.forEach((it) => {
    t.kcal += it.kcal; t.protein += it.protein; t.carbs += it.carbs; t.fat += it.fat;
    if (it.ext) for (const k in it.ext) extT[k] = Math.round(((extT[k] || 0) + it.ext[k]) * 10) / 10;
  });
  const out = {
    name: String(data.name || 'Estimated meal'),
    serving: String(data.serving || '1 portion'),
    confidence: ['high', 'medium', 'low'].includes(data.confidence) ? data.confidence : 'medium',
    items,
    kcal: Math.round(items.length ? t.kcal : num(data.kcal)),
    protein: Math.round((items.length ? t.protein : num(data.protein)) * 10) / 10,
    carbs: Math.round((items.length ? t.carbs : num(data.carbs)) * 10) / 10,
    fat: Math.round((items.length ? t.fat : num(data.fat)) * 10) / 10,
    note: String(data.note || ''),
  };
  if (Object.keys(extT).length) out.ext = extT;
  return out;
}

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
      max_tokens: 2048,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: 'Estimate the nutrition of the food in this photo using the weight-first method. Return only the structured fields.' },
        ],
      }],
    });

    if (message.stop_reason === 'refusal') { res.status(422).json({ error: 'Could not analyse that image.' }); return; }

    const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let data; try { data = JSON.parse(text); } catch { res.status(502).json({ error: 'The estimate came back unreadable — try another photo.' }); return; }
    res.status(200).json(reconcile(data));
  } catch (e) {
    const status = (e && e.status) || 500;
    res.status(status).json({ error: (e && e.message) || 'Vision request failed.' });
  }
}
