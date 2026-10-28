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
};
await db.exec(`insert into auth.users values
  ('${ids.house}', '919000000001'), ('${ids.w1}', '919000000002'), ('${ids.w2}', '919000000003'),
  ('${ids.admin}', '919000000004'), ('${ids.other}', '919000000005');`);

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

const signUp = (user, role, name, phone, area) =>
  as(user, `insert into profiles (id, role, full_name, phone, area) values ('${ids[user]}', '${role}', '${name}', '${phone}', '${area}')`);

await test('sign-up creates own profile with a valid mobile; role admin is refused', async () => {
  await signUp('house', 'household', 'Rina', '919000000001', 'town');
  await signUp('w1', 'worker', 'Bikash', '919000000002', 'town');
  await signUp('w2', 'worker', 'Puja', '919000000003', 'hijuguri');
  await signUp('other', 'household', 'Other', '919000000005', 'town');
  await fails('admin', `insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'admin', 'X', '919000000004', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, phone, area) values ('${ids.w1}', 'worker', 'X', '919000000004', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'worker', 'X', '12345', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, area) values ('${ids.admin}', 'worker', 'X', 'town')`);
  await fails('admin', `insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'worker', 'X', '919000000004', 'nowhere')`);
  await db.exec(`insert into profiles (id, role, full_name, phone, area) values ('${ids.admin}', 'admin', 'Admin', '919000000004', 'town')`);
});

await test('users can change their name and mobile but not their role', async () => {
  await fails('house', `update profiles set role = 'admin' where id = '${ids.house}'`);
  await fails('other', `update profiles set phone = '1' where id = '${ids.other}'`);
  await as('other', `update profiles set phone = '919111111111' where id = '${ids.other}'`);
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
  await as('w1', `select complete_job('${job.id}')`);
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

await test('rate: once, 1 to 5, household only; updates worker average', async () => {
  await fails('house', `select rate_worker((select id from assignments where job_id = '${job.id}'), 6)`);
  await fails('w1', `select rate_worker((select id from assignments where job_id = '${job.id}'), 5)`);
  await as('house', `select rate_worker((select id from assignments where job_id = '${job.id}'), 4)`);
  await fails('house', `select rate_worker((select id from assignments where job_id = '${job.id}'), 5)`, /Already rated/);
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
  await as('w1', `select complete_job('${j2.id}')`);
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
  assert.equal(j.days, 30);
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
  await as('w1', `select complete_job('${j.id}')`);
  assert.equal((await as('house', `select status from jobs where id = '${j.id}'`))[0].status, 'assigned');
  await as('w2', `select complete_job('${j.id}')`);
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
