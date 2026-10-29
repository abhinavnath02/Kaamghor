-- Kaamghor 08: pay comes from work rates.
-- Each kind of work has a standard daily rate and a minimum (rupees per person per day).
-- A job stores its daily rate; the database works out the total pay, so it can't be faked.

create table if not exists public.rates (
  service     text primary key check (public.valid_skill(service)),
  daily_rate  int not null check (daily_rate >= 100),
  min_rate    int not null check (min_rate >= 100),
  updated_at  timestamptz not null default now(),
  check (min_rate <= daily_rate)
);

-- Starting rates. Placeholders: set real local rates in the admin Overview screen.
insert into public.rates (service, daily_rate, min_rate) values
  ('clean', 450, 350), ('cook', 500, 400), ('garden', 450, 350), ('paint', 700, 550), ('helper', 450, 350),
  ('plumb', 800, 600), ('elec', 800, 600), ('care', 600, 450), ('health', 900, 700), ('other', 500, 350)
on conflict (service) do nothing;

alter table public.rates enable row level security;
revoke all on public.rates from anon, authenticated;
grant select on public.rates to authenticated;
drop policy if exists rates_select on public.rates;
create policy rates_select on public.rates for select to authenticated using (true);

create or replace function public.set_rate(p_service text, p_daily int, p_min int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  insert into public.rates (service, daily_rate, min_rate, updated_at) values (p_service, p_daily, p_min, now())
  on conflict (service) do update set daily_rate = excluded.daily_rate, min_rate = excluded.min_rate, updated_at = now();
end $$;
revoke all on function public.set_rate(text, int, int) from public, anon;
grant execute on function public.set_rate(text, int, int) to authenticated;

-- Jobs carry the daily rate per person. The browser sends the rate, never the total.
alter table public.jobs add column if not exists rate int check (rate >= 100);
update public.jobs set rate = greatest(100, pay / days) where rate is null;
revoke insert (pay) on public.jobs from authenticated;
grant insert (rate) on public.jobs to authenticated;

-- No rate given: use the standard one. Below the minimum: refuse. Then total = rate x days.
create or replace function public.job_pay_from_rate() returns trigger
language plpgsql set search_path = '' as $$
declare r public.rates;
begin
  select * into r from public.rates where service = new.service;
  if new.rate is null then new.rate := coalesce(r.daily_rate, 500); end if;
  if r.min_rate is not null and new.rate < r.min_rate then
    raise exception 'The minimum rate for this work is % a day', r.min_rate;
  end if;
  new.pay := new.rate * new.days;
  return new;
end $$;

drop trigger if exists jobs_pay_from_rate on public.jobs;
create trigger jobs_pay_from_rate before insert on public.jobs
  for each row execute function public.job_pay_from_rate();
