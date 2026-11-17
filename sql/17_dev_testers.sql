-- Kaamghor 17: developer mode. Lets listed test accounts skip SMS verification of the mobile number.
-- Only emails in dev_testers can use it, and only the SQL editor (service role) can add them:
--   insert into public.dev_testers (email) values ('you@example.com');
-- The app's hidden button (tap the phone tile 5 times on "Verify your mobile number") calls dev_skip_phone().
-- The account gets a test number that cannot be a real Indian mobile: +91 00000 xxxxx.
-- Remove rows from dev_testers before real users arrive.

create table if not exists public.dev_testers (
  email     text primary key check (email = lower(email)),
  added_at  timestamptz not null default now()
);
alter table public.dev_testers enable row level security;

-- Profiles also accept the developer range, which no real mobile can use.
alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles add constraint profiles_phone_check check (phone ~ '^91[6-9][0-9]{9}$' or phone ~ '^9100000[0-9]{5}$');
revoke all on public.dev_testers from anon, authenticated;  -- no policies: the browser can't read or write it

create or replace function public.dev_skip_phone() returns text
language plpgsql security definer set search_path = '' as $$
declare me auth.users; ph text;
begin
  select * into me from auth.users where id = auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.dev_testers where email = lower(me.email)) then
    raise exception 'Developer mode is not on for this account';
  end if;
  if me.phone_confirmed_at is not null and coalesce(me.phone, '') <> '' then return me.phone; end if;
  loop
    ph := '9100000' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (select 1 from auth.users where phone = ph);
  end loop;
  update auth.users set phone = ph, phone_confirmed_at = now() where id = me.id;
  return ph;
end $$;
revoke all on function public.dev_skip_phone() from public, anon;
grant execute on function public.dev_skip_phone() to authenticated;
