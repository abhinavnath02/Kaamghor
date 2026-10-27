// Tests the two Edge Functions in Node with a fake Deno runtime, a fake Supabase client and a fake Razorpay API.
// Usage: node edge.test.mjs
import { register } from 'node:module';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

// Point the function's "npm:@supabase/supabase-js@..." import at our fake client below.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('npm:@supabase/supabase-js')) return { url: 'kaamghor:fake-supabase', shortCircuit: true };
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url === 'kaamghor:fake-supabase') return { format: 'module', shortCircuit: true,
      source: 'export const createClient = (...a) => globalThis.__fakeClient(...a);' };
    return next(url, ctx);
  }`));

// ---------- fake database: a tiny query builder over arrays ----------
const db = { jobs: [], payments: [], users: { 'tok-house': { id: 'house' }, 'tok-other': { id: 'other' } } };
function table(name) {
  let filters = [], patch = null, wantRows = false;
  const rows = () => db[name].filter((r) => filters.every((f) => f(r)));
  const b = {
    select() { wantRows = true; return b; },
    update(p) { patch = p; return b; },
    eq(k, v) { filters.push((r) => r[k] === v); return b; },
    is(k, v) { filters.push((r) => r[k] === v); return b; },
    async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
    async single() { return { data: rows()[0], error: null }; },
    then(res, rej) {
      const hit = rows();
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: wantRows ? hit : null, error: null }).then(res, rej);
    },
  };
  return b;
}
globalThis.__fakeClient = () => ({
  auth: { getUser: async (tok) => ({ data: { user: db.users[tok] ?? null } }) },
  from: table,
});

// ---------- fake Deno and Razorpay ----------
const env = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 's3', RAZORPAY_WEBHOOK_SECRET: 'whsec' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let ordersMade = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://api.razorpay.com/v1/orders') {
    assert.equal(init.headers.Authorization, 'Basic ' + btoa('rzp_test_1:s3'));
    const body = JSON.parse(init.body);
    ordersMade++;
    return new Response(JSON.stringify({ id: 'order_' + ordersMade, amount: body.amount }), { status: 200 });
  }
  return realFetch(url, init);
};

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

// ---------- create-order ----------
await import('../supabase/functions/create-order/index.ts');
const createOrder = handler;
const call = (tok, body) => createOrder(new Request('http://x/create-order', {
  method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

db.jobs.push({ id: 'j1', household_id: 'house', status: 'done' }, { id: 'j2', household_id: 'house', status: 'assigned' });
db.payments.push({ id: 'p1', job_id: 'j1', amount: 400, status: 'pending', razorpay_order_id: null });

await test('create-order: rejects missing login, other household, unfinished job', async () => {
  assert.equal((await call('bad', { job_id: 'j1' })).status, 401);
  assert.equal((await call('tok-other', { job_id: 'j1' })).status, 404);
  assert.equal((await call('tok-house', { job_id: 'j2' })).status, 400);
  assert.equal((await call('tok-house', {})).status, 400);
});

await test('create-order: makes an order in paise once, then reuses it', async () => {
  const r1 = await (await call('tok-house', { job_id: 'j1' })).json();
  assert.deepEqual(r1, { order_id: 'order_1', key_id: 'rzp_test_1', amount: 40000, currency: 'INR' });
  assert.equal(db.payments[0].razorpay_order_id, 'order_1');
  const r2 = await (await call('tok-house', { job_id: 'j1' })).json();
  assert.equal(r2.order_id, 'order_1');
  assert.equal(ordersMade, 1);
});

// ---------- razorpay-webhook ----------
await import('../supabase/functions/razorpay-webhook/index.ts');
const webhook = handler;
const send = (event, secret = 'whsec') => {
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return webhook(new Request('http://x/razorpay-webhook', { method: 'POST', headers: { 'X-Razorpay-Signature': sig }, body }));
};
const captured = (over = {}) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 40000, currency: 'INR', status: 'captured', method: 'upi', ...over } } },
});

await test('webhook: wrong signature is refused and nothing changes', async () => {
  assert.equal((await send(captured(), 'not-the-secret')).status, 401);
  assert.equal(db.payments[0].status, 'pending');
});

await test('webhook: wrong amount or currency does not mark paid', async () => {
  await send(captured({ amount: 100 }));
  await send(captured({ currency: 'USD' }));
  await send(captured({ status: 'failed' }));
  assert.equal(db.payments[0].status, 'pending');
});

await test('webhook: valid capture marks paid with method and payout pending; repeat is harmless', async () => {
  assert.equal((await send(captured())).status, 200);
  const p = db.payments[0];
  assert.equal(p.status, 'paid'); assert.equal(p.method, 'upi'); assert.equal(p.payout_status, 'pending');
  assert.equal(p.razorpay_payment_id, 'pay_1'); assert.ok(p.paid_at);
  const paidAt = p.paid_at;
  assert.equal((await send({ ...captured(), event: 'order.paid' })).status, 200);
  assert.equal(db.payments[0].paid_at, paidAt);
});

await test('webhook: unknown methods are stored as other', async () => {
  db.payments.push({ id: 'p2', job_id: 'j3', amount: 250, status: 'pending', razorpay_order_id: 'order_9' });
  await send(captured({ id: 'pay_9', order_id: 'order_9', amount: 25000, method: 'emi' }));
  assert.equal(db.payments[1].method, 'other');
});

console.log(`\n${passed} tests passed`);
