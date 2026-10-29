-- Kaamghor 07: work is booked in days, not hours.
-- A job starts on job_date and lasts `days` days (1 to 30). Existing jobs become 1-day jobs.

alter table public.jobs add column if not exists days int not null default 1 check (days between 1 and 30);
alter table public.jobs drop column if exists hours;  -- its column grant goes with it
grant insert (days) on public.jobs to authenticated;
