-- Kaamghor 15: half days. A job lasts 0.5, 1, 1.5 ... up to 30 days.
-- Pay stays in whole rupees: rate x days x people, rounded.

alter table public.jobs drop constraint if exists jobs_days_check;
alter table public.jobs alter column days type numeric(3,1) using days::numeric;
alter table public.jobs add constraint jobs_days_check check (days between 0.5 and 30 and days * 2 = trunc(days * 2));

-- What one person earns for the whole job, in rupees.
create or replace function public.person_pay(j public.jobs) returns int
language sql immutable as $$ select coalesce(round(j.rate * j.days)::int, j.pay / greatest(j.workers_needed, 1)) $$;

create or replace function public.job_pay_from_rate() returns trigger
language plpgsql set search_path = '' as $$
declare r public.rates;
begin
  select * into r from public.rates where service = new.service;
  if new.rate is null then new.rate := coalesce(r.daily_rate, 500); end if;
  if r.min_rate is not null and new.rate < r.min_rate then
    raise exception 'The minimum rate for this work is % a day', r.min_rate;
  end if;
  new.pay := round(new.rate * new.days * new.workers_needed)::int;
  return new;
end $$;
