-- Kaamghor 02: row-level security, column privileges, public_workers view, protective trigger.
-- Rule of thumb: the browser may only insert its own rows and edit harmless columns.
-- Every job or payment state change goes through the functions in 03_functions.sql.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

alter table public.profiles        enable row level security;
alter table public.worker_profiles enable row level security;
alter table public.jobs            enable row level security;
alter table public.applications    enable row level security;
alter table public.payments        enable row level security;

-- Start from nothing, then grant exactly what the app needs.
revoke all on public.profiles, public.worker_profiles, public.jobs, public.applications, public.payments from anon, authenticated;

-- ---------- profiles ----------
grant select on public.profiles to authenticated;
grant insert (id, role, full_name, phone, area) on public.profiles to authenticated;
grant update (full_name, phone, area) on public.profiles to authenticated;     -- role cannot be changed by users

create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.jobs j
    where j.status in ('assigned', 'done')
      and ((j.household_id = auth.uid() and j.worker_id = profiles.id)
        or (j.worker_id = auth.uid() and j.household_id = profiles.id))
  )
);
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and role in ('household', 'worker'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- worker_profiles ----------
grant select on public.worker_profiles to authenticated;
grant insert (user_id, skills, id_doc_path, upi_id, available) on public.worker_profiles to authenticated;
grant update (skills, id_doc_path, upi_id, available) on public.worker_profiles to authenticated;

create policy worker_profiles_select on public.worker_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy worker_profiles_insert on public.worker_profiles for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'worker'));
create policy worker_profiles_update on public.worker_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Stops workers changing their own verified flag, rating or job count.
-- Server-side functions run as the table owner, so they pass; browser requests run as "authenticated" or "anon".
create or replace function public.protect_worker_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verified := false;
      new.rating_avg := null;
      new.jobs_done := 0;
    elsif new.verified is distinct from old.verified
       or new.rating_avg is distinct from old.rating_avg
       or new.jobs_done is distinct from old.jobs_done then
      raise exception 'verified, rating_avg and jobs_done can only be changed by the system';
    end if;
    if new.id_doc_path is not null and new.id_doc_path not like new.user_id::text || '/%' then
      raise exception 'id_doc_path must be inside your own folder';
    end if;
  end if;
  return new;
end $$;

create trigger worker_profiles_protect
  before insert or update on public.worker_profiles
  for each row execute function public.protect_worker_fields();

-- ---------- jobs ----------
grant select on public.jobs to authenticated;
grant insert (household_id, service, area, job_date, hours, pay, notes) on public.jobs to authenticated;
-- No update or delete grant: hire, complete and rate go through functions.

-- Any signed-in user can read open jobs, so app queries filter by household.
create policy jobs_select on public.jobs for select to authenticated using (
  household_id = auth.uid()
  or worker_id = auth.uid()
  or status = 'open'
  or public.is_admin()
);
create policy jobs_insert on public.jobs for insert to authenticated with check (
  household_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'household')
  and job_date >= (now() at time zone 'Asia/Kolkata')::date
);

-- ---------- applications ----------
grant select, delete on public.applications to authenticated;
grant insert (job_id, worker_id) on public.applications to authenticated;

create policy applications_select on public.applications for select to authenticated using (
  worker_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.jobs j where j.id = job_id and j.household_id = auth.uid())
);
-- A worker can apply to an open job that needs one of their skills.
create policy applications_insert on public.applications for insert to authenticated with check (
  worker_id = auth.uid()
  and exists (
    select 1 from public.jobs j
    join public.worker_profiles w on w.user_id = auth.uid()
    where j.id = job_id and j.status = 'open' and j.service = any (w.skills)
  )
);
-- Withdraw while the job is still open.
create policy applications_delete on public.applications for delete to authenticated using (
  worker_id = auth.uid()
  and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'open')
);

-- ---------- payments ----------
grant select on public.payments to authenticated;
-- No insert or update grant: only functions and the Razorpay webhook (service role) write here.

create policy payments_select on public.payments for select to authenticated using (
  public.is_admin()
  or exists (select 1 from public.jobs j where j.id = job_id
             and (j.household_id = auth.uid() or j.worker_id = auth.uid()))
);

-- ---------- public_workers view ----------
-- Safe public fields only: no phone, UPI ID or ID document.
-- Runs with the owner's rights (not security_invoker) so it can be read past worker_profiles RLS.
create or replace view public.public_workers as
  select p.id, p.full_name, p.area, w.skills, w.verified, w.rating_avg, w.jobs_done, w.available
  from public.profiles p
  join public.worker_profiles w on w.user_id = p.id
  where p.role = 'worker';

revoke all on public.public_workers from anon, authenticated;
grant select on public.public_workers to authenticated;
