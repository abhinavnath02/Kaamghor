-- Kaamghor 10: two-way handshake for arrival and for completion.
--   hired -> arrived (worker: "I've arrived") -> working (household: "Yes, they've arrived")
--         -> done_claimed (worker: "Work finished")
--         -> done (household confirms, or automatically after 24 hours) | disputed (household reports a problem)
-- The payment is created only when the work is confirmed done.

alter table public.assignments drop constraint if exists assignments_status_check;
alter table public.assignments add constraint assignments_status_check
  check (status in ('hired', 'arrived', 'working', 'done_claimed', 'disputed', 'done', 'cancelled'));
alter table public.assignments
  add column if not exists arrived_at timestamptz,
  add column if not exists arrival_confirmed_at timestamptz,
  add column if not exists done_claimed_at timestamptz,
  add column if not exists auto_done_at timestamptz,
  add column if not exists problem text check (char_length(problem) <= 500);

-- Finishing one person: payment, job count, and the job is done when nobody is still active.
create or replace function public._finish_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; j public.jobs; still_active int;
begin
  select * into a from public.assignments where id = p_assignment for update;
  select * into j from public.jobs where id = a.job_id for update;
  update public.assignments set status = 'done', done_at = now() where id = a.id;
  update public.worker_profiles set jobs_done = jobs_done + 1 where user_id = a.worker_id;
  insert into public.payments (job_id, assignment_id, amount, fee)
    values (j.id, a.id, public.person_pay(j), round(public.person_pay(j) * public.platform_fee_pct() / 100.0)::int)
    on conflict (assignment_id) do nothing;
  select count(*) into still_active from public.assignments where job_id = j.id and status not in ('done', 'cancelled');
  if still_active = 0 and j.status = 'assigned' then update public.jobs set status = 'done' where id = j.id; end if;
end $$;
revoke all on function public._finish_assignment(uuid) from public, anon, authenticated;

-- The caller's own assignment on a job (worker side), locked.
create or replace function public._my_assignment(p_job uuid) returns public.assignments
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  select * into a from public.assignments where job_id = p_job and worker_id = auth.uid() for update;
  if not found then raise exception 'Job not found'; end if;
  return a;
end $$;
revoke all on function public._my_assignment(uuid) from public, anon, authenticated;

-- An assignment on one of the caller's jobs (household side), locked.
create or replace function public._household_assignment(p_assignment uuid) returns public.assignments
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  select a2.* into a from public.assignments a2 join public.jobs j on j.id = a2.job_id
   where a2.id = p_assignment and j.household_id = auth.uid() for update of a2;
  if not found then raise exception 'Job not found'; end if;
  return a;
end $$;
revoke all on function public._household_assignment(uuid) from public, anon, authenticated;

-- Worker: "I've arrived".
create or replace function public.mark_arrived(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments := public._my_assignment(p_job);
begin
  if a.status <> 'hired' then raise exception 'Already marked as arrived'; end if;
  update public.assignments set status = 'arrived', arrived_at = now() where id = a.id;
end $$;

-- Household: "Yes, they've arrived".
create or replace function public.confirm_arrival(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments := public._household_assignment(p_assignment);
begin
  if a.status <> 'arrived' then raise exception 'The worker has not marked arrival yet'; end if;
  update public.assignments set status = 'working', arrival_confirmed_at = now() where id = a.id;
end $$;

-- Worker: "Work finished". Allowed once they have arrived, even if the household
-- forgot to confirm the arrival. The household then has 24 hours to respond.
create or replace function public.complete_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments := public._my_assignment(p_job);
begin
  if a.status not in ('arrived', 'working') then raise exception 'Job is not in progress'; end if;
  update public.assignments
     set status = 'done_claimed', done_claimed_at = now(), auto_done_at = now() + interval '24 hours'
   where id = a.id;
end $$;

-- Household: "Confirm work done".
create or replace function public.confirm_completion(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments := public._household_assignment(p_assignment);
begin
  if a.status <> 'done_claimed' then raise exception 'The worker has not finished yet'; end if;
  perform public._finish_assignment(a.id);
end $$;

-- Household: "Report a problem" instead of confirming. Stops the 24-hour clock; an admin decides.
create or replace function public.report_problem(p_assignment uuid, p_problem text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments := public._household_assignment(p_assignment);
begin
  if a.status <> 'done_claimed' then raise exception 'You can report a problem once the worker says the work is finished'; end if;
  if coalesce(trim(p_problem), '') = '' then raise exception 'Please describe the problem'; end if;
  update public.assignments set status = 'disputed', problem = left(trim(p_problem), 500), auto_done_at = null where id = a.id;
end $$;

-- Confirms every finished job whose household didn't respond within 24 hours.
-- Runs every 15 minutes (pg_cron, below) and whenever someone opens their jobs. Returns how many.
create or replace function public.auto_complete_due() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.assignments where status = 'done_claimed' and auto_done_at <= now() for update skip locked loop
    perform public._finish_assignment(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- admin: disputes ----------
create or replace function public.admin_disputes()
returns table (assignment_id uuid, job_id uuid, service text, job_date date, problem text,
               household_name text, household_phone text, worker_name text, worker_phone text, done_claimed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return query
    select a.id, j.id, j.service, j.job_date, a.problem, h.full_name, h.phone, w.full_name, w.phone, a.done_claimed_at
      from public.assignments a
      join public.jobs j on j.id = a.job_id
      join public.profiles h on h.id = j.household_id
      join public.profiles w on w.id = a.worker_id
     where a.status = 'disputed'
     order by a.done_claimed_at;
end $$;

-- Done: the worker is paid as normal. Not done: that person's place is cancelled and the job reopens.
create or replace function public.resolve_dispute(p_assignment uuid, p_completed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  perform public._require_admin();
  select * into a from public.assignments where id = p_assignment for update;
  if not found or a.status <> 'disputed' then raise exception 'No open dispute'; end if;
  if p_completed then
    perform public._finish_assignment(a.id);
  else
    update public.assignments set status = 'cancelled' where id = a.id;
    update public.jobs set status = 'open' where id = a.job_id and status = 'assigned';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['mark_arrived(uuid)', 'confirm_arrival(uuid)', 'complete_job(uuid)', 'confirm_completion(uuid)',
                           'report_problem(uuid, text)', 'auto_complete_due()', 'admin_disputes()', 'resolve_dispute(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Every 15 minutes, confirm overdue jobs. Needs the pg_cron extension
-- (Supabase: Database -> Extensions -> pg_cron). Without it, the app still runs the check when people open their jobs.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('kaamghor-auto-complete') where exists (select 1 from cron.job where jobname = 'kaamghor-auto-complete');
  perform cron.schedule('kaamghor-auto-complete', '*/15 * * * *', 'select public.auto_complete_due()');
exception when others then
  raise notice 'pg_cron not available (%); jobs are still auto-confirmed when people open the app', sqlerrm;
end $$;
