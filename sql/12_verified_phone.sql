-- Kaamghor 12: every account has a mobile number verified by SMS code.
-- The number on a profile always comes from Supabase Auth's verified phone (auth.users.phone),
-- never from what the browser types. People sign in with their phone, or sign in with Google/email
-- and then verify a phone once. Posting jobs and applying need a verified number.
-- Supabase stores phones without the plus sign, e.g. 919876543210, which matches profiles.phone.

-- The signed-in user's phone, only if it has been confirmed by SMS code.
create or replace function public.auth_phone() returns text
language sql stable security definer set search_path = '' as $$
  select phone from auth.users where id = auth.uid() and phone_confirmed_at is not null and phone <> ''
$$;

alter table public.profiles add column if not exists phone_verified boolean not null default false;
-- Accounts whose Auth phone is already confirmed count as verified.
update public.profiles p set phone = u.phone, phone_verified = true
  from auth.users u where u.id = p.id and u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '';

-- The browser may no longer write the phone; it is filled in from Auth.
revoke insert (phone) on public.profiles from authenticated;
revoke update (phone) on public.profiles from authenticated;

create or replace function public.profile_phone_from_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The browser can't send a phone (no column grant), so it is always taken from Auth here.
  if new.phone is null then
    new.phone := public.auth_phone();
    new.phone_verified := new.phone is not null;
  end if;
  if new.phone is null then raise exception 'Please verify your mobile number first'; end if;
  return new;
end $$;
drop trigger if exists profiles_phone_from_auth on public.profiles;
create trigger profiles_phone_from_auth before insert on public.profiles
  for each row execute function public.profile_phone_from_auth();

-- After verifying (or changing) the number: copy it from Auth to the profile.
create or replace function public.sync_my_phone() returns boolean
language plpgsql security definer set search_path = '' as $$
declare ph text := public.auth_phone();
begin
  if ph is null then raise exception 'Please verify your mobile number first'; end if;
  update public.profiles set phone = ph, phone_verified = true where id = auth.uid();
  return found;
end $$;
revoke all on function public.sync_my_phone() from public, anon;
grant execute on function public.sync_my_phone() to authenticated;

create or replace function public.my_phone_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select phone_verified from public.profiles where id = auth.uid()), false)
$$;

-- Posting and applying need a verified number.
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert to authenticated with check (
  household_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'household')
  and public.my_phone_verified()
  and job_date >= (now() at time zone 'Asia/Kolkata')::date
);

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications for insert to authenticated with check (
  worker_id = auth.uid()
  and public.my_phone_verified()
  and exists (
    select 1 from public.jobs j
    join public.worker_profiles w on w.user_id = auth.uid()
    where j.id = job_id and j.status = 'open' and j.service = any (w.skills)
  )
);
