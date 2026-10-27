// create-order: makes (or reuses) a Razorpay order for a finished job's payment.
// Called by the household's browser with their login token. Razorpay secrets stay here.
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are built in).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { job_id } = await req.json().catch(() => ({}));
    if (typeof job_id !== 'string') return json({ error: 'job_id is required' }, 400);

    const { data: job } = await db.from('jobs').select('id, household_id, status').eq('id', job_id).maybeSingle();
    if (!job || job.household_id !== user.id) return json({ error: 'Job not found' }, 404);
    if (job.status !== 'done') return json({ error: 'Job is not done yet' }, 400);

    const { data: pm } = await db.from('payments').select('id, amount, status, razorpay_order_id').eq('job_id', job_id).maybeSingle();
    if (!pm) return json({ error: 'No payment for this job' }, 400);
    if (pm.status === 'paid') return json({ error: 'Already paid' }, 409);

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')!;
    const amount = pm.amount * 100; // paise
    let orderId: string | null = pm.razorpay_order_id;

    if (!orderId) {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${keyId}:${Deno.env.get('RAZORPAY_KEY_SECRET')}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount, currency: 'INR', receipt: pm.id, notes: { job_id } }),
      });
      const order = await res.json();
      if (!res.ok) {
        console.error('Razorpay order failed', res.status, order);
        return json({ error: 'Could not start payment' }, 502);
      }
      // Only store it if no other request stored one first; otherwise use theirs.
      const { data: saved } = await db.from('payments').update({ razorpay_order_id: order.id })
        .eq('id', pm.id).is('razorpay_order_id', null).select('razorpay_order_id');
      if (saved && saved.length) {
        orderId = order.id;
      } else {
        const { data: again } = await db.from('payments').select('razorpay_order_id').eq('id', pm.id).single();
        orderId = again!.razorpay_order_id;
      }
    }

    return json({ order_id: orderId, key_id: keyId, amount, currency: 'INR' });
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
});
