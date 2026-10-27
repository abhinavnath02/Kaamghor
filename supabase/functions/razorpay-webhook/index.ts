// razorpay-webhook: the only thing that marks an online payment paid.
// Checks Razorpay's HMAC signature and that the amount matches the job pay.
// Deploy with --no-verify-jwt (Razorpay does not send a Supabase token).
// Secret: RAZORPAY_WEBHOOK_SECRET (the secret you type when adding the webhook in Razorpay).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const METHODS: Record<string, string> = { upi: 'upi', card: 'card', netbanking: 'netbanking', wallet: 'wallet' };

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  const expected = await hmacHex(Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!, body);
  if (!safeEqual(expected, req.headers.get('X-Razorpay-Signature') ?? '')) {
    return new Response('Bad signature', { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
    return new Response('Ignored', { status: 200 });
  }
  const p = event.payload?.payment?.entity;
  if (!p?.order_id || p.status !== 'captured') return new Response('Ignored', { status: 200 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: pm, error } = await db.from('payments').select('id, amount, status, razorpay_payment_id')
    .eq('razorpay_order_id', p.order_id).maybeSingle();
  if (error) {
    console.error(error);
    return new Response('Database error', { status: 500 }); // Razorpay will retry
  }
  if (!pm) {
    console.error('No payment row for order', p.order_id);
    return new Response('Unknown order', { status: 200 });
  }
  if (pm.status === 'paid') {
    if (pm.razorpay_payment_id !== p.id) console.error('Order already paid by another method; refund needed', p.order_id, p.id);
    return new Response('Already paid', { status: 200 });
  }
  if (p.currency !== 'INR' || p.amount !== pm.amount * 100) {
    console.error('Amount mismatch', p.order_id, p.amount, p.currency, 'expected', pm.amount * 100);
    return new Response('Amount mismatch', { status: 200 });
  }

  const { error: upErr } = await db.from('payments').update({
    status: 'paid',
    method: METHODS[p.method] ?? 'other',
    razorpay_payment_id: p.id,
    paid_at: new Date().toISOString(),
    payout_status: 'pending',
  }).eq('id', pm.id).eq('status', 'pending');
  if (upErr) {
    console.error(upErr);
    return new Response('Database error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
});
