// Runs the five SQL files on an in-memory Postgres (PGlite) with a minimal stand-in for
// Supabase's auth and storage schemas, then checks the security rules and the full job flow.
// Usage: cd tests && npm install && node sql.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const sqlDir = new URL('../sql/', import.meta.url);

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, phone text, phone_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert on storage.objects to authenticated;
  grant usage on sequence storage.objects_id_seq to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create publication supabase_realtime;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

// Every file in sql/, in name order: 01-05 are the base, 06+ upgrade an existing database.
for (const f of readdirSync(sqlDir).filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(f, sqlDir), 'utf8'));
}

const ids = {
  house: '00000000-0000-0000-0000-00000000000a',
  w1: '00000000-0000-0000-0000-00000000000b',
  w2: '00000000-0000-0000-0000-00000000000c',
  admin: '00000000-0000-0000-0000-00000000000d',
  other: '00000000-0000-0000-0000-00000000000e',
  nophone: '00000000-0000-0000-0000-00000000000f',
};
// Everyone except "nophone" has a mobile verified by SMS code (migration 12).
await db.exec(`insert into auth.users (id, phone, phone_confirmed_at) values
  ('${ids.house}', '919000000001', now()), ('${ids.w1}', '919000000002', now()), ('${ids.w2}', '919000000003', now()),
  ('${ids.admin}', '919000000004', now()), ('${ids.other}', '919000000005', now()), ('${ids.nophone}', '919000000006', null);`);

// Run SQL as a signed-in user (role authenticated + JWT subject), like PostgREST does.
async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${ids[user]}', true);`);
    return (await tx.query(sql, params)).rows;
  });
}
async function fails(user, sql, pattern) {
  await assert.rejects(() => as(user, sql), pattern ?? /./, `expected failure: ${sql}`);
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

// The phone is never sent by the browser: it comes from the verified Auth phone.
const signUp = (user, role, name, area) =>
  as(user, `insert into profiles (id, role, full_name, area) values ('${ids[user]}', '${role}', '${name}', '${area}')`);

// Full two-way handshake for one worker on one of the household's jobs (migration 10).
async function handshake(jobId, worker) {
  const a = `(select id from assignments where job_id = '${jobId}' and worker_id = '${ids[worker]}')`;
  await as(worker, `select mark_arrived('${jobId}')`);
  await as('house', `select confirm_arrival(${a})`);
  await as(worker, `select complete_job('${jobId}')`);
  await as('house', `select confirm_completion(${a})`);
}

await test('sign-up takes the phone from the verified Auth phone; role admin is refused', async () => {
  await signUp('house', 'household', 'Rina', 'town');
  await signUp('w1', 'worker', 'Bikash', 'town');
  await signUp('w2', 'worker', 'Puja', 'hijuguri');
  await signUp('other', 'household', 'Other', 'town');
  const [p] = await as('house', `select phone, phone_verified from profiles where id = '${ids.house}'`);
  assert.deepEqual([p.phone, p.phone_verified], ['919000000001', true]);
  await fails('nophone', `insert into profiles (id, role, full_name, area) values ('${ids.nophone}', 'worker', 'X', 'town')`, /verify your mobile/);
  await fails('admin', `insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'worker', 'X', '919999999999', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, area) values ('${ids.admin}', 'admin', 'X', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, area) values ('${ids.w1}', 'worker', 'X', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, area) values ('${ids.admin}', 'worker', 'X', 'nowhere')`);
  await db.exec(`insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'admin', 'Admin', '919000000004', 'town')`);
});

await test('users can change their name, not their role or phone; a changed phone syncs from Auth', async () => {
  await fails('house', `update profiles set role = 'admin' where id = '${ids.house}'`);
  await fails('other', `update profiles set phone = '919111111111' where id = '${ids.other}'`);
  // after verifying a new number with Supabase Auth, sync_my_phone copies it over
  await db.exec(`update auth.users set phone = '919111111111' where id = '${ids.other}'`);
  await as('other', `select sync_my_phone()`);
  assert.equal((await as('other', `select phone from profiles where id = '${ids.other}'`))[0].phone, '919111111111');
  await fails('nophone', `select sync_my_phone()`, /verify your mobile/);
  await as('house', `update profiles set full_name = 'Rina Das' where id = '${ids.house}'`);
  // Updating someone else's row silently changes nothing.
  assert.equal((await as('house', `update profiles set full_name = 'X' where id = '${ids.other}' returning id`)).length, 0);
});

await test('worker profile: cannot self-verify, rate or bump job count; ID path must be own folder', async () => {
  await as('w1', `insert into worker_profiles (user_id, skills, upi_id) values ('${ids.w1}', '{clean,cook}', 'bikash@okaxis')`);
  await as('w2', `insert into worker_profiles (user_id, skills) values ('${ids.w2}', '{clean}')`);
  await fails('house', `insert into worker_profiles (user_id, skills) values ('${ids.house}', '{clean}')`);
  await fails('w1', `update worker_profiles set verified = true where user_id = '${ids.w1}'`);
  await fails('w1', `update worker_profiles set jobs_done = 50 where user_id = '${ids.w1}'`);
  await fails('w1', `update worker_profiles set rating_avg = 5 where user_id = '${ids.w1}'`);
  await fails('w1', `update worker_profiles set id_doc_path = '${ids.w2}/x.jpg' where user_id = '${ids.w1}'`);
  await fails('w1', `update worker_profiles set skills = '{hack}' where user_id = '${ids.w1}'`);
  await as('w1', `update worker_profiles set id_doc_path = '${ids.w1}/aadhaar.jpg' where user_id = '${ids.w1}'`);
  // Trigger blocks it even if a column grant were ever added by mistake.
  await db.exec(`grant update (verified) on worker_profiles to authenticated`);
  await fails('w1', `update worker_profiles set verified = true where user_id = '${ids.w1}'`, /only be changed by the system/);
  await db.exec(`revoke update (verified) on worker_profiles from authenticated`);
});

await test('worker rows private; public_workers hides phone, UPI and ID doc', async () => {
  assert.equal((await as('house', `select * from worker_profiles`)).length, 0);
  assert.equal((await as('w1', `select * from worker_profiles`)).length, 1);
  assert.equal((await as('admin', `select * from worker_profiles`)).length, 2);
  const rows = await as('house', `select * from public_workers order by full_name`);
  assert.equal(rows.length, 2);
  for (const k of ['phone', 'upi_id', 'id_doc_path']) assert.ok(!(k in rows[0]), k);
  assert.equal((await as('house', `select * from profiles where id = '${ids.w1}'`)).length, 0);
});

await test('storage: worker uploads to own folder only; only admin reads', async () => {
  await as('w1', `insert into storage.objects (bucket_id, name) values ('id-docs', '${ids.w1}/aadhaar.jpg')`);
  await fails('w1', `insert into storage.objects (bucket_id, name) values ('id-docs', '${ids.w2}/x.jpg')`);
  await fails('house', `insert into storage.objects (bucket_id, name) values ('id-docs', '${ids.house}/x.jpg')`);
  assert.equal((await as('w1', `select * from storage.objects`)).length, 0);
  assert.equal((await as('admin', `select * from storage.objects`)).length, 1);
});

let job;
await test('only households post jobs; status and worker cannot be set by browser', async () => {
  [job] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, notes)
    values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400, 'Two rooms') returning id, status`);
  assert.equal(job.status, 'open');
  await fails('w1', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.w1}', 'clean', 'town', current_date + 1, 3, 400)`);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate, status) values ('${ids.house}', 'clean', 'town', current_date + 1, 3, 400, 'done')`);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 3, 50)`);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 31, 400)`);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date - 3, 3, 400)`);
  await fails('house', `update jobs set status = 'done' where id = '${job.id}'`);
});

await test('apply: matching skill only; household sees applicants', async () => {
  await as('w1', `insert into applications (job_id, worker_id) values ('${job.id}', '${ids.w1}')`);
  await as('w2', `insert into applications (job_id, worker_id) values ('${job.id}', '${ids.w2}')`);
  const [cookJob] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate)
    values ('${ids.house}', 'plumb', 'town', current_date, 2, 800) returning id`);
  await fails('w1', `insert into applications (job_id, worker_id) values ('${cookJob.id}', '${ids.w1}')`);
  await fails('w1', `insert into applications (job_id, worker_id) values ('${job.id}', '${ids.w2}')`);
  assert.equal((await as('house', `select * from applications where job_id = '${job.id}'`)).length, 2);
  assert.equal((await as('other', `select * from applications`)).length, 0);
  assert.equal((await as('w1', `select * from applications`)).length, 1);
});

await test('hire: only the job household, only an applicant; phones then visible both ways', async () => {
  await fails('other', `select hire_worker('${job.id}', '${ids.w1}')`, /Job not found/);
  await fails('house', `select hire_worker('${job.id}', '${ids.other}')`, /not applied/);
  await as('house', `select hire_worker('${job.id}', '${ids.w1}')`);
  await fails('house', `select hire_worker('${job.id}', '${ids.w2}')`, /not open/);
  const [wp] = await as('house', `select phone from profiles where id = '${ids.w1}'`);
  assert.equal(wp.phone, '919000000002');
  const [hp] = await as('w1', `select phone from profiles where id = '${ids.house}'`);
  assert.equal(hp.phone, '919000000001');
  assert.equal((await as('w2', `select * from profiles where id = '${ids.house}'`)).length, 0);
  assert.equal((await as('w2', `select * from jobs where id = '${job.id}'`)).length, 0);
  // Applications can no longer be withdrawn once the job is assigned.
  const gone = await as('w2', `delete from applications where job_id = '${job.id}' returning *`);
  assert.equal(gone.length, 0);
});

await test('complete: only hired worker; creates payment with 10% fee', async () => {
  await fails('w2', `select complete_job('${job.id}')`);
  await fails('house', `select complete_job('${job.id}')`);
  await fails('w1', `select get_pay_target('${job.id}', '${ids.w1}')`);
  await handshake(job.id, 'w1');
  await fails('w1', `select complete_job('${job.id}')`, /not in progress/);
  const [pm] = await as('house', `select * from payments where job_id = '${job.id}'`);
  assert.equal(pm.amount, 400); assert.equal(pm.fee, 40); assert.equal(pm.status, 'pending');
  assert.equal((await as('other', `select * from payments`)).length, 0);
  const [w] = await as('w1', `select jobs_done from worker_profiles where user_id = '${ids.w1}'`);
  assert.equal(w.jobs_done, 1);
});

await test('pay target: UPI only to the household of the done job', async () => {
  const [t] = await as('house', `select * from get_pay_target('${job.id}', '${ids.w1}')`);
  assert.equal(t.upi_id, 'bikash@okaxis'); assert.equal(t.amount, 400);
  await fails('other', `select * from get_pay_target('${job.id}', '${ids.w1}')`);
});

await test('payment cannot be faked from the browser; worker confirms cash', async () => {
  await fails('house', `update payments set status = 'paid' where job_id = '${job.id}'`);
  await fails('house', `select confirm_cash('${job.id}')`);
  await fails('house', `select _confirm_offline('${job.id}', 'cash')`);
  await as('w1', `select confirm_cash('${job.id}')`);
  await fails('w1', `select confirm_direct('${job.id}')`, /Already paid/);
  const [pm] = await as('house', `select * from payments where job_id = '${job.id}'`);
  assert.equal(pm.status, 'paid'); assert.equal(pm.method, 'cash'); assert.equal(pm.payout_status, 'na');
});

await test('rate: once each, 1 to 5, both sides; updates averages', async () => {
  await fails('house', `select rate_person((select id from assignments where job_id = '${job.id}'), 6, '{}', null)`, /1 to 5/);
  await fails('other', `select rate_person((select id from assignments where job_id = '${job.id}'), 5, '{}', null)`, /Job not found/);
  await as('house', `select rate_person((select id from assignments where job_id = '${job.id}'), 4, '{on_time}', null)`);
  await fails('house', `select rate_person((select id from assignments where job_id = '${job.id}'), 5, '{}', null)`, /Already rated/);
  await as('w1', `select rate_person((select id from assignments where job_id = '${job.id}'), 5, '{paid_on_time,respectful}', 'Good family')`);
  const [w] = await as('house', `select rating_avg from public_workers where id = '${ids.w1}'`);
  assert.equal(Number(w.rating_avg), 4);
});

await test('admin: verify, fees owed, settle, payouts, stats; non-admin refused', async () => {
  for (const f of [`verify_worker('${ids.w1}')`, `admin_stats()`, `admin_fees_owed()`, `admin_payouts()`, `settle_fees('${ids.w1}', 'x')`]) {
    await fails('w1', `select * from ${f}`, /Admins only/);
  }
  await as('admin', `select verify_worker('${ids.w1}')`);
  const [owed] = await as('admin', `select * from admin_fees_owed()`);
  assert.equal(Number(owed.fees_owed), 40);
  await fails('admin', `select settle_fees('${ids.w1}', '  ')`, /required/);
  const [{ settle_fees: n }] = await as('admin', `select settle_fees('${ids.w1}', 'UPI-123')`);
  assert.equal(n, 1);
  assert.equal((await as('admin', `select * from admin_fees_owed()`)).length, 0);

  // Online payment as the webhook would record it (service role), then admin pays out.
  const [j2] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate)
    values ('${ids.house}', 'cook', 'town', current_date, 1, 500) returning id`);
  await as('w1', `insert into applications (job_id, worker_id) values ('${j2.id}', '${ids.w1}')`);
  await as('house', `select hire_worker('${j2.id}', '${ids.w1}')`);
  await handshake(j2.id, 'w1');
  await db.exec(`update payments set status = 'paid', method = 'upi', paid_at = now(), payout_status = 'pending',
                 razorpay_order_id = 'order_1', razorpay_payment_id = 'pay_1' where job_id = '${j2.id}'`);
  const [po] = await as('admin', `select * from admin_payouts()`);
  assert.equal(po.net, 450); assert.equal(po.fee, 50); assert.equal(po.upi_id, 'bikash@okaxis');
  await as('admin', `select mark_payout_sent('${po.payment_id}', 'UTR998877')`);
  await fails('admin', `select mark_payout_sent('${po.payment_id}', 'again')`, /not pending/);
  const [{ admin_stats: s }] = await as('admin', `select admin_stats()`);
  assert.equal(s.jobs_done, 2); assert.equal(s.fees_online, 50); assert.equal(s.fees_settled, 40);
  assert.equal(s.workers_verified, 1); assert.equal(s.paid_total, 900);
});

await test('06: caretaker, healthcare and others; others needs a description', async () => {
  for (const s of ['care', 'health']) {
    await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', '${s}', 'town', current_date + 1, 4, 900)`);
  }
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'other', 'town', current_date + 1, 4, 600)`, /jobs_other_needs_notes/);
  await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, notes) values ('${ids.house}', 'other', 'town', current_date + 1, 4, 600, 'Move furniture upstairs')`);
  await as('w2', `update worker_profiles set skills = '{clean,care,health,other}' where user_id = '${ids.w2}'`);
  await fails('w2', `update worker_profiles set skills = '{babysit}' where user_id = '${ids.w2}'`);
});

await test('07: jobs are booked in days (1 to 30)', async () => {
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'paint', 'town', current_date + 2, 30, 900) returning days`);
  assert.equal(Number(j.days), 30);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'paint', 'town', current_date + 2, 0, 900)`);
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'jobs'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.includes('hours'));
});

await test('08: pay = daily rate x days, worked out by the database; rates have a minimum', async () => {
  const [a] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'cook', 'town', current_date + 1, 3, 550) returning rate, pay`);
  assert.equal(a.pay, 1650);
  const [b] = await as('house', `insert into jobs (household_id, service, area, job_date, days) values ('${ids.house}', 'elec', 'town', current_date + 1, 2) returning rate, pay`);
  assert.equal(b.rate, 800); assert.equal(b.pay, 1600);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'cook', 'town', current_date + 1, 1, 300)`, /minimum rate/);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate, pay) values ('${ids.house}', 'cook', 'town', current_date + 1, 1, 500, 99999)`);
  assert.equal((await as('w1', `select * from rates`)).length, 10);
  await fails('house', `select set_rate('cook', 600, 450)`, /Admins only/);
  await fails('house', `update rates set daily_rate = 100000 where service = 'cook'`);
  await as('admin', `select set_rate('cook', 600, 450)`);
  const [c] = await as('house', `insert into jobs (household_id, service, area, job_date, days) values ('${ids.house}', 'cook', 'town', current_date + 1, 1) returning pay`);
  assert.equal(c.pay, 600);
});

await test('09: a job for 2 people: hire each, separate payments, done when both finish', async () => {
  // w2 gets cleaning back for this test; 'other' household also works as a worker-less check
  await as('w2', `update worker_profiles set skills = '{clean}' where user_id = '${ids.w2}'`);
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, workers_needed)
    values ('${ids.house}', 'clean', 'town', current_date + 1, 2, 500, 2) returning id, pay`);
  assert.equal(j.pay, 2000); // 500 x 2 days x 2 people
  await as('w1', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w1}')`);
  await as('w2', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w2}')`);
  await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
  assert.equal((await as('house', `select status from jobs where id = '${j.id}'`))[0].status, 'open');
  await fails('house', `select hire_worker('${j.id}', '${ids.w1}')`, /Already hired/);
  await as('house', `select hire_worker('${j.id}', '${ids.w2}')`);
  assert.equal((await as('house', `select status from jobs where id = '${j.id}'`))[0].status, 'assigned');
  // each worker sees the household's phone; workers don't see each other's assignment
  assert.equal((await as('w2', `select * from profiles where id = '${ids.house}'`)).length, 1);
  assert.equal((await as('w2', `select * from assignments where job_id = '${j.id}'`)).length, 1);
  await handshake(j.id, 'w1');
  assert.equal((await as('house', `select status from jobs where id = '${j.id}'`))[0].status, 'assigned');
  await handshake(j.id, 'w2');
  assert.equal((await as('house', `select status from jobs where id = '${j.id}'`))[0].status, 'done');
  const pays = await as('house', `select amount, fee from payments where job_id = '${j.id}' order by amount`);
  assert.deepEqual(pays.map((p) => [p.amount, p.fee]), [[1000, 100], [1000, 100]]);
  assert.equal((await as('w1', `select * from payments where job_id = '${j.id}'`)).length, 1);
  const [t] = await as('house', `select * from get_pay_target('${j.id}', '${ids.w2}')`);
  assert.equal(t.amount, 1000);
});

await test('09: stop hiring starts the job with the people already hired', async () => {
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, workers_needed)
    values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400, 3) returning id`);
  await fails('house', `select stop_hiring('${j.id}')`, /at least one/);
  await as('w1', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w1}')`);
  await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
  await fails('other', `select stop_hiring('${j.id}')`, /Job not found/);
  await as('house', `select stop_hiring('${j.id}')`);
  const [row] = await as('house', `select status, workers_needed, pay from jobs where id = '${j.id}'`);
  assert.deepEqual([row.status, row.workers_needed, row.pay], ['assigned', 1, 400]);
});

await test('10: arrival and completion need both sides; problems go to admin; 24h auto-confirm', async () => {
  const mk = async () => {
    const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400) returning id`);
    await as('w1', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w1}')`);
    await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
    return [j.id, `(select id from assignments where job_id = '${j.id}')`];
  };
  const status = async (j) => (await db.query(`select status from assignments where job_id = '${j}'`)).rows[0].status;
  const payments = async (j) => (await db.query(`select * from payments where job_id = '${j}'`)).rows.length;

  // order is enforced, and each side can only do its own step
  let [j, a] = await mk();
  await fails('house', `select confirm_arrival(${a})`, /not marked arrival/);
  await fails('w1', `select confirm_arrival(${a})`, /Job not found/);
  await fails('house', `select mark_arrived('${j}')`, /Job not found/);
  await as('w1', `select mark_arrived('${j}')`);
  await fails('w1', `select mark_arrived('${j}')`, /Already/);
  await as('house', `select confirm_arrival(${a})`);
  assert.equal(await status(j), 'working');
  await fails('house', `select confirm_completion(${a})`, /not finished/);
  await as('w1', `select complete_job('${j}')`);
  assert.equal(await status(j), 'done_claimed');
  assert.equal(await payments(j), 0); // no payment until confirmed
  await fails('w1', `select confirm_completion(${a})`, /Job not found/);
  await as('house', `select confirm_completion(${a})`);
  assert.equal(await status(j), 'done');
  assert.equal(await payments(j), 1);

  // worker may finish even if the household never confirmed arrival
  [j, a] = await mk();
  await as('w1', `select mark_arrived('${j}')`);
  await as('w1', `select complete_job('${j}')`);
  // household reports a problem -> disputed, no payment; admin decides
  await fails('house', `select report_problem(${a}, '  ')`, /describe/);
  await as('house', `select report_problem(${a}, 'Left after one hour')`);
  assert.equal(await status(j), 'disputed');
  await fails('house', `select * from admin_disputes()`, /Admins only/);
  const [d] = await as('admin', `select * from admin_disputes()`);
  assert.equal(d.problem, 'Left after one hour');
  await as('admin', `select resolve_dispute(${a}, false)`);
  assert.equal(await status(j), 'cancelled');
  assert.equal((await db.query(`select status from jobs where id = '${j}'`)).rows[0].status, 'open');

  // household doesn't respond: after 24 hours it is confirmed automatically
  [j, a] = await mk();
  await as('w1', `select mark_arrived('${j}')`);
  await as('w1', `select complete_job('${j}')`);
  const [{ auto_complete_due: none }] = await as('w1', `select auto_complete_due()`);
  assert.equal(none, 0);
  await db.exec(`update assignments set auto_done_at = now() - interval '1 minute' where job_id = '${j}'`);
  const [{ auto_complete_due: n }] = await as('w1', `select auto_complete_due()`);
  assert.equal(n, 1);
  assert.equal(await status(j), 'done');
  assert.equal(await payments(j), 1);
});

await test('11: tags, comments, public profiles and reviews', async () => {
  const [hp] = await as('w2', `select * from public_profiles where id = '${ids.house}'`);
  assert.equal(Number(hp.rating_avg), 5); assert.equal(hp.rating_count, 1);
  assert.ok(!('phone' in hp));
  const reviews = await as('w2', `select * from public_reviews where ratee_id = '${ids.house}'`);
  assert.equal(reviews.length, 1); assert.equal(reviews[0].rater_name, 'Bikash'); assert.equal(reviews[0].comment, 'Good family');
  assert.deepEqual(reviews[0].tags, ['paid_on_time', 'respectful']);
  // raw ratings rows are private to the two people involved
  assert.equal((await as('w2', `select * from ratings`)).length, 0);
  assert.equal((await as('w1', `select * from ratings`)).length >= 2, true);
  // unknown tags and direct writes are refused
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400) returning id`);
  await as('w1', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w1}')`);
  await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
  const a = `(select id from assignments where job_id = '${j.id}')`;
  await fails('house', `select rate_person(${a}, 5, '{}', null)`, /once the work is confirmed/);
  await handshake(j.id, 'w1');
  await fails('house', `select rate_person(${a}, 5, '{best_ever}', null)`);
  await fails('house', `insert into ratings (assignment_id, rater_id, ratee_id, stars) values (${a}, '${ids.house}', '${ids.w1}', 5)`);
});

await test('12: an account with an unverified phone cannot post or apply', async () => {
  // a legacy profile whose phone was typed in, never verified
  await db.exec(`insert into profiles (id, role, full_name, phone, area) values ('${ids.nophone}', 'household', 'Legacy', '919000000006', 'town')`);
  assert.equal((await as('nophone', `select phone_verified from profiles where id = '${ids.nophone}'`))[0].phone_verified, false);
  await fails('nophone', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.nophone}', 'clean', 'town', current_date + 1, 1, 400)`);
  await db.exec(`update auth.users set phone_confirmed_at = now() where id = '${ids.nophone}'`);
  await as('nophone', `select sync_my_phone()`);
  await as('nophone', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.nophone}', 'clean', 'town', current_date + 1, 1, 400)`);
});

await test('13: exact pin only for the household and hired people; others see ~1 km', async () => {
  await as('w2', `update worker_profiles set skills = '{clean}' where user_id = '${ids.w2}'`);
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400) returning id`);
  await fails('w1', `select set_job_location('${j.id}', 27.49123, 95.35678, 'x')`, /Job not found/);
  await fails('house', `select set_job_location('${j.id}', 120, 95, null)`, /Invalid/);
  await as('house', `select set_job_location('${j.id}', 27.49123, 95.35678, 'Blue gate behind the temple')`);
  // anyone signed in sees the rounded point on the open job, not the exact pin
  const [open] = await as('w2', `select approx_lat, approx_lng from jobs where id = '${j.id}'`);
  assert.deepEqual([open.approx_lat, open.approx_lng], [27.49, 95.36]);
  assert.equal((await as('w2', `select * from job_locations where job_id = '${j.id}'`)).length, 0);
  assert.equal((await as('house', `select landmark from job_locations where job_id = '${j.id}'`))[0].landmark, 'Blue gate behind the temple');
  await fails('house', `insert into job_locations (job_id, lat, lng) values ('${j.id}', 1, 1)`);
  // once hired, the worker sees the exact pin
  await as('w1', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w1}')`);
  assert.equal((await as('w1', `select * from job_locations where job_id = '${j.id}'`)).length, 0);
  await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
  const [loc] = await as('w1', `select lat, lng from job_locations where job_id = '${j.id}'`);
  assert.deepEqual([loc.lat, loc.lng], [27.49123, 95.35678]);
});

await test('14: a verified Thikadar brings a crew that fills places and is paid as one', async () => {
  await as('w1', `update worker_profiles set is_thikadar = true, crew_max = 3 where user_id = '${ids.w1}'`);
  const jobStatus = async (id) => (await as('house', `select status from jobs where id = '${id}'`))[0].status;
  const [j] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, workers_needed)
    values ('${ids.house}', 'clean', 'town', current_date + 1, 2, 500, 4) returning id`);
  // only a verified Thikadar may apply with a crew, up to their crew size and the job's places
  await fails('w2', `insert into applications (job_id, worker_id, crew_size) values ('${j.id}', '${ids.w2}', 2)`);
  await fails('w1', `insert into applications (job_id, worker_id, crew_size) values ('${j.id}', '${ids.w1}', 4)`);
  await as('w1', `insert into applications (job_id, worker_id, crew_size) values ('${j.id}', '${ids.w1}', 3)`);
  await as('w2', `insert into applications (job_id, worker_id) values ('${j.id}', '${ids.w2}')`);
  await as('house', `select hire_worker('${j.id}', '${ids.w1}')`);
  assert.equal((await as('house', `select places_filled('${j.id}') as n`))[0].n, 3);
  assert.equal(await jobStatus(j.id), 'open');
  await as('house', `select hire_worker('${j.id}', '${ids.w2}')`);
  assert.equal(await jobStatus(j.id), 'assigned');
  // the Thikadar names the crew
  const a = `(select id from assignments where job_id = '${j.id}' and worker_id = '${ids.w1}')`;
  await fails('w2', `select set_crew(${a}, '{A,B}')`, /Job not found/);
  await fails('w1', `select set_crew(${a}, '{A,B,C,D}')`, /More names/);
  await as('w1', `select set_crew(${a}, '{"Ravi Das"," Mina Gogoi ",""}')`);
  assert.deepEqual((await as('house', `select crew_names from assignments where id = ${a}`))[0].crew_names, ['Ravi Das', 'Mina Gogoi']);
  // one handshake for the whole crew; paid rate x days x crew size
  await handshake(j.id, 'w1');
  const [pm] = await as('w1', `select amount, fee from payments where assignment_id = ${a}`);
  assert.deepEqual([pm.amount, pm.fee], [3000, 300]);
  await handshake(j.id, 'w2');
  assert.equal(await jobStatus(j.id), 'done');
  // a crew bigger than the places left can't be hired
  const [k] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, workers_needed)
    values ('${ids.house}', 'clean', 'town', current_date + 1, 1, 400, 2) returning id`);
  await as('w2', `insert into applications (job_id, worker_id) values ('${k.id}', '${ids.w2}')`);
  await as('w1', `insert into applications (job_id, worker_id, crew_size) values ('${k.id}', '${ids.w1}', 2)`);
  await as('house', `select hire_worker('${k.id}', '${ids.w2}')`);
  await fails('house', `select hire_worker('${k.id}', '${ids.w1}')`, /Not enough places/);
  const [pw] = await as('house', `select is_thikadar, crew_max from public_workers where id = '${ids.w1}'`);
  assert.deepEqual([pw.is_thikadar, pw.crew_max], [true, 3]);
});

await test('15: half days (0.5 steps); pay rounds to whole rupees', async () => {
  const [a] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 0.5, 455) returning days, pay`);
  assert.deepEqual([Number(a.days), a.pay], [0.5, 228]); // 455 x 0.5 = 227.5 -> 228
  const [b] = await as('house', `insert into jobs (household_id, service, area, job_date, days, rate, workers_needed) values ('${ids.house}', 'clean', 'town', current_date + 1, 1.5, 400, 2) returning pay`);
  assert.equal(b.pay, 1200);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 1.3, 400)`, /jobs_days_check/);
  await fails('house', `insert into jobs (household_id, service, area, job_date, days, rate) values ('${ids.house}', 'clean', 'town', current_date + 1, 0, 400)`, /jobs_days_check/);
  // a half-day job pays the worker half a day
  await as('w2', `insert into applications (job_id, worker_id) select id, '${ids.w2}' from jobs where pay = 228`);
  const [j] = await as('house', `select id from jobs where pay = 228`);
  await as('house', `select hire_worker('${j.id}', '${ids.w2}')`);
  await handshake(j.id, 'w2');
  assert.equal((await as('w2', `select amount from payments where job_id = '${j.id}'`))[0].amount, 228);
});

await test('anon has no access', async () => {
  await assert.rejects(() => db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    await tx.query('select * from jobs');
  }));
  await assert.rejects(() => db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    await tx.query('select * from public_workers');
  }));
});

await test('jobs table is in the realtime publication', async () => {
  const r = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
  assert.deepEqual(r.rows.map((x) => x.tablename).sort(), ['assignments', 'jobs']);
});

console.log(`\n${passed} tests passed`);
