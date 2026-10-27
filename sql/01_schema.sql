-- Kaamghor 01: tables and constraints.
-- Run the five files in order (01 to 05) in the Supabase SQL editor.

-- Pilot areas. Change this list here AND in index.html (AREAS) if needed.
create or replace function public.valid_area(a text) returns boolean
language sql immutable as $$
  select a in ('town', 'hijuguri', 'borguri', 'rangagora', 'bordoloi', 'chandmari')
$$;

create or replace function public.valid_skill(s text) returns boolean
language sql immutable as $$
  select s in ('clean', 'cook', 'garden', 'paint', 'helper', 'plumb', 'elec')
$$;

create or replace function public.valid_skills(arr text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(public.valid_skill(x)), true) from unnest(arr) x
$$;

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('household', 'worker', 'admin')),
  full_name   text not null check (char_length(full_name) between 1 and 80),
  -- Login is Google or email, so the user types their mobile at sign-up. Stored as 91XXXXXXXXXX.
  phone       text not null check (phone ~ '^91[6-9][0-9]{9}$'),
  area        text not null check (public.valid_area(area)),
  created_at  timestamptz not null default now()
);

create table public.worker_profiles (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  skills       text[] not null default '{}' check (public.valid_skills(skills)),
  verified     boolean not null default false,
  id_doc_path  text,
  upi_id       text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,128}@[A-Za-z]{2,64}$'),
  rating_avg   numeric(3,2),
  jobs_done    int not null default 0,
  available    boolean not null default true
);

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.profiles (id) on delete cascade,
  service       text not null check (public.valid_skill(service)),
  area          text not null check (public.valid_area(area)),
  job_date      date not null,
  hours         int not null check (hours between 1 and 12),
  pay           int not null check (pay >= 100),
  notes         text check (char_length(notes) <= 500),
  status        text not null default 'open' check (status in ('open', 'assigned', 'done', 'cancelled')),
  worker_id     uuid references public.profiles (id),
  rating        int check (rating between 1 and 5),
  created_at    timestamptz not null default now(),
  check (status = 'open' or status = 'cancelled' or worker_id is not null)
);
create index jobs_household_idx on public.jobs (household_id);
create index jobs_worker_idx on public.jobs (worker_id);
create index jobs_open_idx on public.jobs (status, service, area);

create table public.applications (
  job_id      uuid not null references public.jobs (id) on delete cascade,
  worker_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (job_id, worker_id)
);
create index applications_worker_idx on public.applications (worker_id);

create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null unique references public.jobs (id) on delete cascade,
  amount               int not null,
  fee                  int not null,
  method               text check (method in ('cash', 'upi', 'upi_direct', 'card', 'netbanking', 'wallet', 'other')),
  status               text not null default 'pending' check (status in ('pending', 'paid')),
  razorpay_order_id    text unique,
  razorpay_payment_id  text unique,
  paid_at              timestamptz,
  payout_status        text check (payout_status in ('pending', 'sent', 'na')),
  payout_ref           text,
  payout_at            timestamptz,
  fee_settled_at       timestamptz,
  fee_settle_ref       text,
  check (status = 'pending' or (method is not null and paid_at is not null))
);
