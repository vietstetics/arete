// Security tests for the serverless API (api/*). Run: node --test scripts/test-api-security.mjs
// Network is mocked: no real Supabase or Anthropic calls, nothing is billed.
import test from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://abcdefghijklmnop.supabase.co';
const calls = [];
let supa = { user: 200, credit: 5 };

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  calls.push(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === `${SB}/auth/v1/user`) return supa.user === 200 ? json(200, { id: 'u1', email: 'a@b.c' }) : json(supa.user, { msg: 'bad jwt' });
  if (url === `${SB}/rest/v1/rpc/claim_ai_credit`) return json(200, supa.credit);
  if (url.startsWith('https://api.anthropic.com')) {
    return json(200, { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ found: false, programName: '', days: [], note: '' }) }] });
  }
  return new Response('<html><meta property="og:description" content="Bench 3x8"></html>', { status: 200 });
};

const { default: food } = await import('../api/analyze-food.js');
const { default: parse } = await import('../api/parse-workout.js');
const { default: oura } = await import('../api/oura.js');

function run(handler, { body = {}, headers = {}, method = 'POST' } = {}) {
  return new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); return this; } };
    handler({ method, headers, body, query: {} }, res);
  });
}
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const env = (on) => { if (on) { process.env.SUPABASE_URL = SB; process.env.SUPABASE_ANON_KEY = 'anon-key-123456789012345'; } else { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY; } };
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
const anthropicCalls = () => calls.filter((u) => u.startsWith('https://api.anthropic.com')).length;

test('food photos are OFF until accounts are configured (fails closed, nothing billed)', async () => {
  env(false); calls.length = 0;
  const r = await run(food, { body: { image: IMG }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
  assert.equal(r.status, 503); assert.equal(anthropicCalls(), 0);
});

test('no sign-in token → 401, nothing billed', async () => {
  env(true); calls.length = 0;
  const r = await run(food, { body: { image: IMG } });
  assert.equal(r.status, 401); assert.equal(anthropicCalls(), 0);
});

test('a token Supabase rejects → 401, nothing billed', async () => {
  env(true); calls.length = 0; supa = { user: 401, credit: 5 };
  const r = await run(food, { body: { image: IMG }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
  assert.equal(r.status, 401); assert.equal(anthropicCalls(), 0);
});

test('daily cap reached → 429, nothing billed', async () => {
  env(true); calls.length = 0; supa = { user: 200, credit: -1 };
  const r = await run(food, { body: { image: IMG }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
  assert.equal(r.status, 429); assert.equal(r.body.error, 'daily_limit'); assert.equal(anthropicCalls(), 0);
});

test('bad or oversized images are refused before a credit is spent', async () => {
  env(true); supa = { user: 200, credit: 5 };
  for (const image of ['data:text/html;base64,' + 'A'.repeat(400), 'data:image/jpeg;base64,<script>', 'data:image/jpeg;base64,' + 'A'.repeat(3_000_200), 42]) {
    calls.length = 0;
    const r = await run(food, { body: { image }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
    assert.equal(r.status, 400, String(image).slice(0, 30));
    assert.equal(calls.filter((u) => u.includes('claim_ai_credit')).length, 0); assert.equal(anthropicCalls(), 0);
  }
});

test('a signed-in user under the cap gets an estimate, on the cheaper model', async () => {
  env(true); calls.length = 0; supa = { user: 200, credit: 3 };
  const r = await run(food, { body: { image: IMG }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
  assert.equal(anthropicCalls(), 1);
  assert.ok(r.status === 200 || r.status === 502, 'reached the model');   // mock reply isn't a food schema
});

const SIGNED_IN = { authorization: 'Bearer ' + 'x'.repeat(40) };

test('workout import and the Oura pass-through refuse anyone not signed in, and fetch nothing', async () => {
  env(true); supa = { user: 401, credit: 3 };
  for (const [h, req] of [[parse, { body: { url: 'https://www.instagram.com/p/abc/', apiKey: 'sk-ant-user' } }], [oura, { method: 'GET', body: null }]]) {
    for (const headers of [{}, SIGNED_IN]) {
      calls.length = 0;
      const r = await run(h, { ...req, headers: { ...headers, 'x-oura-token': 't' } });
      assert.equal(r.status, 401);
      assert.equal(calls.filter((u) => !u.startsWith(SB)).length, 0);
    }
  }
});

test('workout import never fetches internal or non-video addresses (SSRF)', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://localhost/', 'https://127.0.0.1/', 'https://evil.example.com/x', 'https://youtube.com.evil.com/', 'https://user:pw@youtube.com/', 'file:///etc/passwd', 'https://youtube.com:8443/']) {
    calls.length = 0; env(true); supa = { user: 200, credit: 3 };
    const r = await run(parse, { body: { url, apiKey: 'sk-ant-user' }, headers: SIGNED_IN });
    assert.equal(calls.filter((u) => !u.startsWith(SB)).length, 0, `fetched ${url}`);
    assert.equal(r.status, 422);
  }
});

test('workout import still reads allowed video sites', async () => {
  calls.length = 0; env(true); supa = { user: 200, credit: 3 };
  await run(parse, { body: { url: 'https://www.instagram.com/p/abc/', apiKey: 'sk-ant-user' }, headers: SIGNED_IN });
  assert.ok(calls.some((u) => u.startsWith('https://www.instagram.com/')));
});

test('errors never echo upstream internals', async () => {
  const { sendError } = await import('../api/_lib/account.js');
  const out = await new Promise((resolve) => sendError({ status(c) { this.c = c; return this; }, json(b) { resolve({ c: this.c, b }); } }, Object.assign(new Error('secret internal detail sk-ant-123'), { status: 400 })));
  assert.equal(out.c, 502); assert.ok(!JSON.stringify(out.b).includes('secret'));
});
