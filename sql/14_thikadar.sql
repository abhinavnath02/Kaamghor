-- Kaamghor 14: Thikadars bring a crew.
-- A verified worker who leads a crew (Thikadar) can apply to a multi-person job with a crew of N.
-- The household hires the crew in one go: one assignment that fills N places. The Thikadar names
-- the crew, does the arrival/completion handshake for everyone and is paid rate x days x N to share.

-- ---------- who leads a crew ----------
alter table public.worker_profiles
  add column if not exists is_thikadar boolean not null default false,
  add column if not exists crew_max int not null default 1 check (crew_max between 1 and 20);
grant insert (is_thikadar, crew_max) on public.worker_profiles to authenticated;
grant update (is_thikadar, crew_max) on public.worker_profiles to authenticated;

-- ---------- applications and assignments carry a crew size (1 = just me) ----------
alter table public.applications add column if not exists crew_size int not null default 1 check (crew_size between 1 and 20);
grant insert (crew_size) on public.applications to authenticated;

alter table public.assignments
  add column if not exists crew_size int not null default 1 check (crew_size between 1 and 20),
  add column if not exists crew_names text[] not null default '{}' check (cardinality(crew_names) <= 20);

-- Applying with a crew: only a verified Thikadar, within their crew size and the job's places.
drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications for insert to authenticated with check (
  worker_id = auth.uid()
  and public.my_phone_verified()
  and exists (
    select 1 from public.jobs j
    join public.worker_profiles w on w.user_id = auth.uid()
    where j.id = job_id and j.status = 'open' and j.service = any (w.skills)
      and (crew_size = 1 or (w.is_thikadar and w.verified and crew_size <= w.crew_max and crew_size <= j.workers_needed))
  )
);

-- People hired so far on a job (a crew counts as its size).
create or replace function public.places_filled(p_job uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(crew_size), 0)::int from public.assignments where job_id = p_job and status <> 'cancelled'
$$;

create or replace function public.hire_worker(p_job uuid, p_worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; app public.applications; filled int;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'open' then raise exception 'Job is not open'; end if;
  select * into app from public.applications where job_id = p_job and worker_id = p_worker;
  if not found then raise exception 'This worker has not applied'; end if;
  if exists (select 1 from public.assignments where job_id = p_job and worker_id = p_worker and status <> 'cancelled') then
    raise exception 'Already hired';
  end if;
  filled := public.places_filled(p_job);
  if filled + app.crew_size > j.workers_needed then raise exception 'Not enough places left for this crew'; end if;
  insert into public.assignments (job_id, worker_id, crew_size) values (p_job, p_worker, app.crew_size)
    on conflict (job_id, worker_id) do update
      set status = 'hired', hired_at = now(), done_at = null, crew_size = excluded.crew_size, crew_names = '{}';
  if filled + app.crew_size >= j.workers_needed then update public.jobs set status = 'assigned' where id = p_job; end if;
end $$;

create or replace function public.stop_hiring(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; filled int;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.household_id <> auth.uid() then raise exception 'Job not found'; end if;
  if j.status <> 'open' then raise exception 'Job is not open'; end if;
  filled := public.places_filled(p_job);
  if filled = 0 then raise exception 'Hire at least one person first'; end if;
  update public.jobs set workers_needed = filled, pay = public.person_pay(j) * filled, status = 'assigned' where id = p_job;
end $$;

-- A crew is paid as one: rate x days x crew size, to the Thikadar.
create or replace function public._finish_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; j public.jobs; still_active int; amount int;
begin
  select * into a from public.assignments where id = p_assignment for update;
  select * into j from public.jobs where id = a.job_id for update;
  amount := public.person_pay(j) * a.crew_size;
  update public.assignments set status = 'done', done_at = now() where id = a.id;
  update public.worker_profiles set jobs_done = jobs_done + 1 where user_id = a.worker_id;
  insert into public.payments (job_id, assignment_id, amount, fee)
    values (j.id, a.id, amount, round(amount * public.platform_fee_pct() / 100.0)::int)
    on conflict (assignment_id) do nothing;
  select count(*) into still_active from public.assignments where job_id = j.id and status not in ('done', 'cancelled');
  if still_active = 0 and j.status = 'assigned' then update public.jobs set status = 'done' where id = j.id; end if;
end $$;
revoke all on function public._finish_assignment(uuid) from public, anon, authenticated;

-- Thikadar: name the crew (they may not have phones or accounts).
create or replace function public.set_crew(p_assignment uuid, p_names text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; cleaned text[];
begin
  select * into a from public.assignments where id = p_assignment and worker_id = auth.uid() for update;
  if not found then raise exception 'Job not found'; end if;
  if a.crew_size < 2 then raise exception 'This is not a crew booking'; end if;
  select coalesce(array_agg(left(trim(n), 60)), '{}') into cleaned from unnest(p_names) n where trim(n) <> '';
  if cardinality(cleaned) > a.crew_size then raise exception 'More names than the crew size'; end if;
  update public.assignments set crew_names = cleaned where id = a.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['hire_worker(uuid, uuid)', 'stop_hiring(uuid)', 'set_crew(uuid, text[])', 'places_filled(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- show Thikadars in lists and profiles ----------
drop view if exists public.public_workers;
create view public.public_workers as
  select p.id, p.full_name, p.area, w.skills, w.verified, p.rating_avg, p.rating_count, w.jobs_done, w.available,
         w.is_thikadar, w.crew_max
    from public.profiles p
    join public.worker_profiles w on w.user_id = p.id
   where p.role = 'worker';
revoke all on public.public_workers from anon, authenticated;
grant select on public.public_workers to authenticated;

drop view if exists public.public_profiles;
create view public.public_profiles as
  select p.id, p.full_name, p.role, p.area, p.rating_avg, p.rating_count, p.created_at,
         w.verified, w.jobs_done, w.skills, w.is_thikadar, w.crew_max
    from public.profiles p
    left join public.worker_profiles w on w.user_id = p.id
   where p.role in ('household', 'worker');
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;
