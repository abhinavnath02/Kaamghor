-- Kaamghor 03: server-side functions. Each one checks who is calling before changing anything.
-- security definer = runs with the owner's rights, so the browser cannot skip these checks.

-- Platform fee in percent (open decision: 10% is the starting assumption).
create or replace function public.platform_fee_pct() returns int
language sql immutable as $$ select 10 $$;

-- ---------- household: hire ----------
create or replace function public.hire_worker(p_job uuid, p_worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'open' then raise exception 'Job is not open'; end if;
  if not exists (select 1 from public.applications where job_id = p_job and worker_id = p_worker) then
    raise exception 'This worker has not applied';
  end if;
  update public.jobs set worker_id = p_worker, status = 'assigned' where id = p_job;
end $$;

-- ---------- worker: mark done ----------
-- Creates the pending payment row for the job.
create or replace function public.complete_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.worker_id is distinct from auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'assigned' then raise exception 'Job is not in progress'; end if;
  update public.jobs set status = 'done' where id = p_job;
  update public.worker_profiles set jobs_done = jobs_done + 1 where user_id = j.worker_id;
  insert into public.payments (job_id, amount, fee)
    values (p_job, j.pay, round(j.pay * public.platform_fee_pct() / 100.0)::int)
    on conflict (job_id) do nothing;
end $$;

-- ---------- household: rate ----------
create or replace function public.rate_job(p_job uuid, p_rating int) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5'; end if;
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'done' then raise exception 'Job is not done yet'; end if;
  if j.rating is not null then raise exception 'Already rated'; end if;
  update public.jobs set rating = p_rating where id = p_job;
  update public.worker_profiles
     set rating_avg = (select round(avg(rating), 2) from public.jobs where worker_id = j.worker_id and rating is not null)
   where user_id = j.worker_id;
end $$;

-- ---------- worker: confirm cash or direct UPI received ----------
create or replace function public._confirm_offline(p_job uuid, p_method text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; pay public.payments;
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.worker_id is distinct from auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'done' then raise exception 'Job is not done yet'; end if;
  select * into pay from public.payments where job_id = p_job for update;
  if not found then raise exception 'No payment for this job'; end if;
  if pay.status = 'paid' then raise exception 'Already paid'; end if;
  update public.payments
     set method = p_method, status = 'paid', paid_at = now(), payout_status = 'na'
   where id = pay.id;
end $$;
revoke all on function public._confirm_offline(uuid, text) from public, anon, authenticated;

create or replace function public.confirm_cash(p_job uuid) returns void
language sql security definer set search_path = '' as $$
  select public._confirm_offline(p_job, 'cash')
$$;

create or replace function public.confirm_direct(p_job uuid) returns void
language sql security definer set search_path = '' as $$
  select public._confirm_offline(p_job, 'upi_direct')
$$;

-- ---------- household: where to pay by direct UPI ----------
-- UPI ID is shown only to the household of a completed job.
create or replace function public.get_pay_target(p_job uuid)
returns table (worker_name text, upi_id text, amount int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.jobs where id = p_job and household_id = auth.uid() and status = 'done') then
    raise exception 'Job not found';
  end if;
  return query
    select p.full_name, w.upi_id, j.pay
      from public.jobs j
      join public.profiles p on p.id = j.worker_id
      join public.worker_profiles w on w.user_id = j.worker_id
     where j.id = p_job;
end $$;

-- ---------- admin ----------
create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
end $$;

create or replace function public.verify_worker(p_worker uuid, p_verified boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  update public.worker_profiles set verified = p_verified where user_id = p_worker;
  if not found then raise exception 'Worker not found'; end if;
end $$;

-- Online payments the admin must pay out to workers (amount minus fee).
create or replace function public.admin_payouts()
returns table (payment_id uuid, job_id uuid, worker_id uuid, worker_name text, worker_phone text, upi_id text,
               amount int, fee int, net int, method text, paid_at timestamptz,
               payout_status text, payout_ref text, payout_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return query
    select pm.id, j.id, j.worker_id, p.full_name, p.phone, w.upi_id,
           pm.amount, pm.fee, pm.amount - pm.fee, pm.method, pm.paid_at,
           pm.payout_status, pm.payout_ref, pm.payout_at
      from public.payments pm
      join public.jobs j on j.id = pm.job_id
      join public.profiles p on p.id = j.worker_id
      left join public.worker_profiles w on w.user_id = j.worker_id
     where pm.status = 'paid' and pm.payout_status in ('pending', 'sent')
     order by (pm.payout_status = 'pending') desc, pm.paid_at desc
     limit 200;
end $$;

create or replace function public.mark_payout_sent(p_payment uuid, p_ref text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if coalesce(trim(p_ref), '') = '' then raise exception 'UPI reference is required'; end if;
  update public.payments set payout_status = 'sent', payout_ref = trim(p_ref), payout_at = now()
   where id = p_payment and status = 'paid' and payout_status = 'pending';
  if not found then raise exception 'Payout not pending'; end if;
end $$;

-- Fees workers owe on cash and direct-UPI jobs, not yet settled.
create or replace function public.admin_fees_owed()
returns table (worker_id uuid, worker_name text, worker_phone text, jobs bigint, fees_owed bigint, oldest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return query
    select j.worker_id, p.full_name, p.phone, count(*), sum(pm.fee), min(pm.paid_at)
      from public.payments pm
      join public.jobs j on j.id = pm.job_id
      join public.profiles p on p.id = j.worker_id
     where pm.status = 'paid' and pm.payout_status = 'na' and pm.fee_settled_at is null
     group by j.worker_id, p.full_name, p.phone
     order by sum(pm.fee) desc;
end $$;

-- Marks all of a worker's unsettled fees as paid back. Returns how many payments were settled.
create or replace function public.settle_fees(p_worker uuid, p_ref text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public._require_admin();
  if coalesce(trim(p_ref), '') = '' then raise exception 'Reference is required'; end if;
  update public.payments pm set fee_settled_at = now(), fee_settle_ref = trim(p_ref)
    from public.jobs j
   where j.id = pm.job_id and j.worker_id = p_worker
     and pm.status = 'paid' and pm.payout_status = 'na' and pm.fee_settled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
declare r json;
begin
  perform public._require_admin();
  select json_build_object(
    'households',        (select count(*) from public.profiles where role = 'household'),
    'workers',           (select count(*) from public.profiles where role = 'worker'),
    'workers_verified',  (select count(*) from public.worker_profiles where verified),
    'awaiting_verify',   (select count(*) from public.worker_profiles where not verified and id_doc_path is not null),
    'jobs_open',         (select count(*) from public.jobs where status = 'open'),
    'jobs_assigned',     (select count(*) from public.jobs where status = 'assigned'),
    'jobs_done',         (select count(*) from public.jobs where status = 'done'),
    'jobs_cancelled',    (select count(*) from public.jobs where status = 'cancelled'),
    'jobs_last_7d',      (select count(*) from public.jobs where created_at > now() - interval '7 days'),
    'paid_total',        (select coalesce(sum(amount), 0) from public.payments where status = 'paid'),
    'unpaid_jobs',       (select count(*) from public.payments where status = 'pending'),
    'fees_online',       (select coalesce(sum(fee), 0) from public.payments where status = 'paid' and payout_status <> 'na'),
    'fees_owed',         (select coalesce(sum(fee), 0) from public.payments where payout_status = 'na' and fee_settled_at is null),
    'fees_settled',      (select coalesce(sum(fee), 0) from public.payments where payout_status = 'na' and fee_settled_at is not null),
    'payouts_pending',   (select coalesce(sum(amount - fee), 0) from public.payments where payout_status = 'pending'),
    'avg_rating',        (select round(avg(rating), 2) from public.jobs where rating is not null)
  ) into r;
  return r;
end $$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  foreach f in array array[
    'hire_worker(uuid, uuid)', 'complete_job(uuid)', 'rate_job(uuid, int)',
    'confirm_cash(uuid)', 'confirm_direct(uuid)', 'get_pay_target(uuid)',
    'verify_worker(uuid, boolean)', 'admin_payouts()', 'mark_payout_sent(uuid, text)',
    'admin_fees_owed()', 'settle_fees(uuid, text)', 'admin_stats()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public._require_admin() from public, anon, authenticated;
