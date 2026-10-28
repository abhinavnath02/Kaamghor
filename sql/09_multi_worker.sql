-- Kaamghor 09: a job can need several people.
-- Each hired person gets an assignment with their own status, payment and rating.
-- Existing hires become assignments; existing payments are linked to them.

-- ---------- how many people ----------
alter table public.jobs add column if not exists workers_needed int not null default 1 check (workers_needed between 1 and 10);
grant insert (workers_needed) on public.jobs to authenticated;

-- ---------- assignments ----------
create table if not exists public.assignments (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  worker_id  uuid not null references public.profiles (id),
  status     text not null default 'hired' check (status in ('hired', 'done', 'cancelled')),
  rating     int check (rating between 1 and 5),         -- household's rating of this worker
  hired_at   timestamptz not null default now(),
  done_at    timestamptz,
  unique (job_id, worker_id)
);
create index if not exists assignments_worker_idx on public.assignments (worker_id);

insert into public.assignments (job_id, worker_id, status, rating, hired_at, done_at)
  select id, worker_id, case when status = 'done' then 'done' else 'hired' end, rating, created_at,
         case when status = 'done' then now() end
    from public.jobs where worker_id is not null
  on conflict (job_id, worker_id) do nothing;

-- ---------- payments belong to one person's assignment ----------
alter table public.payments add column if not exists assignment_id uuid unique references public.assignments (id) on delete cascade;
update public.payments p set assignment_id = a.id
  from public.assignments a where a.job_id = p.job_id and p.assignment_id is null;
alter table public.payments drop constraint if exists payments_job_id_key;  -- a job can now have several payments
create index if not exists payments_job_idx on public.payments (job_id);

-- ---------- row-level security now goes through assignments ----------
-- Jobs and assignments refer to each other, so the checks live in security-definer helpers
-- (they read the tables directly); policies calling each other would recurse forever.
create or replace function public.owns_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs where id = p_job and household_id = auth.uid())
$$;
create or replace function public.works_on_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments where job_id = p_job and worker_id = auth.uid() and status <> 'cancelled')
$$;
-- True when I hired this person, or this person hired me (on a job that isn't cancelled).
create or replace function public.shares_job_with(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments a join public.jobs j on j.id = a.job_id
                 where a.status <> 'cancelled'
                   and ((j.household_id = auth.uid() and a.worker_id = p_other)
                     or (a.worker_id = auth.uid() and j.household_id = p_other)))
$$;

alter table public.assignments enable row level security;
revoke all on public.assignments from anon, authenticated;
grant select on public.assignments to authenticated;  -- changes only through the functions below

drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated using (
  worker_id = auth.uid() or public.is_admin() or public.owns_job(job_id)
);

-- Phone numbers: visible between a household and the people it hired (and admins).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin() or public.shares_job_with(id)
);

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated using (
  household_id = auth.uid() or status = 'open' or public.is_admin() or public.works_on_job(id)
);

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (
  public.is_admin()
  or public.owns_job(job_id)
  or exists (select 1 from public.assignments a where a.id = assignment_id and a.worker_id = auth.uid())
);

-- The single worker_id on jobs is replaced by assignments.
drop function if exists public.rate_job(uuid, int);
drop function if exists public.get_pay_target(uuid);
alter table public.jobs drop column if exists worker_id;

-- ---------- total pay = daily rate x days x people ----------
create or replace function public.job_pay_from_rate() returns trigger
language plpgsql set search_path = '' as $$
declare r public.rates;
begin
  select * into r from public.rates where service = new.service;
  if new.rate is null then new.rate := coalesce(r.daily_rate, 500); end if;
  if r.min_rate is not null and new.rate < r.min_rate then
    raise exception 'The minimum rate for this work is % a day', r.min_rate;
  end if;
  new.pay := new.rate * new.days * new.workers_needed;
  return new;
end $$;

-- What one person earns for the job.
create or replace function public.person_pay(j public.jobs) returns int
language sql immutable as $$ select coalesce(j.rate * j.days, j.pay / greatest(j.workers_needed, 1)) $$;

-- ---------- household: hire, one person at a time, until the job is full ----------
create or replace function public.hire_worker(p_job uuid, p_worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; hired int;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'open' then raise exception 'Job is not open'; end if;
  if not exists (select 1 from public.applications where job_id = p_job and worker_id = p_worker) then
    raise exception 'This worker has not applied';
  end if;
  if exists (select 1 from public.assignments where job_id = p_job and worker_id = p_worker and status <> 'cancelled') then
    raise exception 'Already hired';
  end if;
  insert into public.assignments (job_id, worker_id) values (p_job, p_worker)
    on conflict (job_id, worker_id) do update set status = 'hired', hired_at = now(), done_at = null;
  select count(*) into hired from public.assignments where job_id = p_job and status <> 'cancelled';
  if hired >= j.workers_needed then update public.jobs set status = 'assigned' where id = p_job; end if;
end $$;

-- Start with the people already hired (at least one) and stop taking applications.
create or replace function public.stop_hiring(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; hired int;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'open' then raise exception 'Job is not open'; end if;
  select count(*) into hired from public.assignments where job_id = p_job and status <> 'cancelled';
  if hired = 0 then raise exception 'Hire at least one person first'; end if;
  update public.jobs set workers_needed = hired, pay = public.person_pay(j) * hired, status = 'assigned' where id = p_job;
end $$;

-- ---------- worker: mark my part done (replaced by the two-way handshake in 10) ----------
create or replace function public._finish_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; j public.jobs; left_open int;
begin
  select * into a from public.assignments where id = p_assignment for update;
  select * into j from public.jobs where id = a.job_id for update;
  update public.assignments set status = 'done', done_at = now() where id = a.id;
  update public.worker_profiles set jobs_done = jobs_done + 1 where user_id = a.worker_id;
  insert into public.payments (job_id, assignment_id, amount, fee)
    values (j.id, a.id, public.person_pay(j), round(public.person_pay(j) * public.platform_fee_pct() / 100.0)::int)
    on conflict (assignment_id) do nothing;
  select count(*) into left_open from public.assignments where job_id = j.id and status = 'hired';
  if left_open = 0 and j.status = 'assigned' then update public.jobs set status = 'done' where id = j.id; end if;
end $$;
revoke all on function public._finish_assignment(uuid) from public, anon, authenticated;

create or replace function public.complete_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  select * into a from public.assignments where job_id = p_job and worker_id = auth.uid() for update;
  if not found then raise exception 'Job not found'; end if;
  if a.status <> 'hired' then raise exception 'Job is not in progress'; end if;
  perform public._finish_assignment(a.id);
end $$;

-- ---------- household: rate one worker ----------
create or replace function public.rate_worker(p_assignment uuid, p_rating int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5'; end if;
  select a2.* into a from public.assignments a2 join public.jobs j on j.id = a2.job_id
   where a2.id = p_assignment and j.household_id = auth.uid() for update of a2;
  if not found then raise exception 'Job not found'; end if;
  if a.status <> 'done' then raise exception 'Job is not done yet'; end if;
  if a.rating is not null then raise exception 'Already rated'; end if;
  update public.assignments set rating = p_rating where id = a.id;
  update public.worker_profiles
     set rating_avg = (select round(avg(rating), 2) from public.assignments where worker_id = a.worker_id and rating is not null)
   where user_id = a.worker_id;
end $$;

-- ---------- worker: confirm cash or direct UPI received for my part ----------
create or replace function public._confirm_offline(p_job uuid, p_method text) returns void
language plpgsql security definer set search_path = '' as $$
declare pay public.payments;
begin
  select pm.* into pay from public.payments pm join public.assignments a on a.id = pm.assignment_id
   where a.job_id = p_job and a.worker_id = auth.uid() for update of pm;
  if not found then raise exception 'No payment for this job'; end if;
  if pay.status = 'paid' then raise exception 'Already paid'; end if;
  update public.payments set method = p_method, status = 'paid', paid_at = now(), payout_status = 'na' where id = pay.id;
end $$;
revoke all on function public._confirm_offline(uuid, text) from public, anon, authenticated;

-- ---------- household: where to pay one worker by direct UPI ----------
create or replace function public.get_pay_target(p_job uuid, p_worker uuid)
returns table (worker_name text, upi_id text, amount int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assignments a join public.jobs j on j.id = a.job_id
                 where a.job_id = p_job and a.worker_id = p_worker and a.status = 'done' and j.household_id = auth.uid()) then
    raise exception 'Job not found';
  end if;
  return query
    select p.full_name, w.upi_id, pm.amount
      from public.assignments a
      join public.payments pm on pm.assignment_id = a.id
      join public.profiles p on p.id = a.worker_id
      join public.worker_profiles w on w.user_id = a.worker_id
     where a.job_id = p_job and a.worker_id = p_worker;
end $$;

-- ---------- admin: payouts and fees per worker, through assignments ----------
create or replace function public.admin_payouts()
returns table (payment_id uuid, job_id uuid, worker_id uuid, worker_name text, worker_phone text, upi_id text,
               amount int, fee int, net int, method text, paid_at timestamptz,
               payout_status text, payout_ref text, payout_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return query
    select pm.id, pm.job_id, a.worker_id, p.full_name, p.phone, w.upi_id,
           pm.amount, pm.fee, pm.amount - pm.fee, pm.method, pm.paid_at,
           pm.payout_status, pm.payout_ref, pm.payout_at
      from public.payments pm
      join public.assignments a on a.id = pm.assignment_id
      join public.profiles p on p.id = a.worker_id
      left join public.worker_profiles w on w.user_id = a.worker_id
     where pm.status = 'paid' and pm.payout_status in ('pending', 'sent')
     order by (pm.payout_status = 'pending') desc, pm.paid_at desc
     limit 200;
end $$;

create or replace function public.admin_fees_owed()
returns table (worker_id uuid, worker_name text, worker_phone text, jobs bigint, fees_owed bigint, oldest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return query
    select a.worker_id, p.full_name, p.phone, count(*), sum(pm.fee), min(pm.paid_at)
      from public.payments pm
      join public.assignments a on a.id = pm.assignment_id
      join public.profiles p on p.id = a.worker_id
     where pm.status = 'paid' and pm.payout_status = 'na' and pm.fee_settled_at is null
     group by a.worker_id, p.full_name, p.phone
     order by sum(pm.fee) desc;
end $$;

create or replace function public.settle_fees(p_worker uuid, p_ref text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public._require_admin();
  if coalesce(trim(p_ref), '') = '' then raise exception 'Reference is required'; end if;
  update public.payments pm set fee_settled_at = now(), fee_settle_ref = trim(p_ref)
    from public.assignments a
   where a.id = pm.assignment_id and a.worker_id = p_worker
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
    'avg_rating',        (select round(avg(rating), 2) from public.assignments where rating is not null)
  ) into r;
  return r;
end $$;

do $$
declare f text;
begin
  foreach f in array array['hire_worker(uuid, uuid)', 'stop_hiring(uuid)', 'complete_job(uuid)', 'rate_worker(uuid, int)',
                           'get_pay_target(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Hiring and progress reach both sides live.
do $$
begin
  alter publication supabase_realtime add table public.assignments;
exception when duplicate_object then null;
end $$;
