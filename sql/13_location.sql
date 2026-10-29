-- Kaamghor 13: where the work is.
-- The exact pin and landmark live in job_locations, visible only to the household, the people it
-- hired and admins. Jobs carry an approximate point (rounded to about 1 km) that anyone signed in
-- can see, so workers can judge distance before applying without learning the exact house.

create table if not exists public.job_locations (
  job_id    uuid primary key references public.jobs (id) on delete cascade,
  lat       double precision not null check (lat between -90 and 90),
  lng       double precision not null check (lng between -180 and 180),
  landmark  text check (char_length(landmark) <= 120)
);

alter table public.jobs
  add column if not exists approx_lat double precision,
  add column if not exists approx_lng double precision;

alter table public.job_locations enable row level security;
revoke all on public.job_locations from anon, authenticated;
grant select on public.job_locations to authenticated;  -- written only by set_job_location()
drop policy if exists job_locations_select on public.job_locations;
create policy job_locations_select on public.job_locations for select to authenticated
  using (public.owns_job(job_id) or public.works_on_job(job_id) or public.is_admin());

-- Household sets (or moves) the pin for one of its jobs.
create or replace function public.set_job_location(p_job uuid, p_lat double precision, p_lng double precision, p_landmark text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_job(p_job) then raise exception 'Job not found'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location';
  end if;
  insert into public.job_locations (job_id, lat, lng, landmark)
    values (p_job, p_lat, p_lng, nullif(left(trim(coalesce(p_landmark, '')), 120), ''))
  on conflict (job_id) do update set lat = excluded.lat, lng = excluded.lng, landmark = excluded.landmark;
  -- Two decimals is roughly 1 km: enough to show distance, not enough to find the house.
  update public.jobs set approx_lat = round(p_lat::numeric, 2), approx_lng = round(p_lng::numeric, 2) where id = p_job;
end $$;
revoke all on function public.set_job_location(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.set_job_location(uuid, double precision, double precision, text) to authenticated;
