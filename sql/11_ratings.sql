-- Kaamghor 11: two-way ratings and public profiles.
-- After work is confirmed, the household rates each worker and each worker rates the household:
-- 1-5 stars, optional quick tags and an optional comment. Everyone has a rating average and count.

create or replace function public.valid_rating_tags(arr text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(x in (
    'on_time', 'good_work', 'polite', 'tidy', 'late', 'careless',               -- about a worker
    'paid_on_time', 'respectful', 'clear', 'safe', 'paid_late', 'rude'          -- about a household
  )), true) from unnest(arr) x
$$;

create table if not exists public.ratings (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  rater_id       uuid not null references public.profiles (id) on delete cascade,
  ratee_id       uuid not null references public.profiles (id) on delete cascade,
  stars          int not null check (stars between 1 and 5),
  tags           text[] not null default '{}' check (public.valid_rating_tags(tags) and cardinality(tags) <= 6),
  comment        text check (char_length(comment) <= 300),
  created_at     timestamptz not null default now(),
  unique (assignment_id, rater_id)
);
create index if not exists ratings_ratee_idx on public.ratings (ratee_id, created_at desc);

alter table public.profiles
  add column if not exists rating_avg numeric(3,2),
  add column if not exists rating_count int not null default 0;
-- (users can't write these: profiles only grants update on full_name, phone and area)

-- Existing one-way ratings (household -> worker) move into the new table.
insert into public.ratings (assignment_id, rater_id, ratee_id, stars, created_at)
  select a.id, j.household_id, a.worker_id, a.rating, coalesce(a.done_at, now())
    from public.assignments a join public.jobs j on j.id = a.job_id
   where a.rating is not null
on conflict (assignment_id, rater_id) do nothing;

create or replace function public._refresh_rating(p_person uuid) returns void
language sql security definer set search_path = '' as $$
  update public.profiles p
     set rating_avg = s.avg, rating_count = s.n
    from (select round(avg(stars), 2) as avg, count(*)::int as n from public.ratings where ratee_id = p_person) s
   where p.id = p_person;
  update public.worker_profiles set rating_avg = (select rating_avg from public.profiles where id = p_person)
   where user_id = p_person;
$$;
revoke all on function public._refresh_rating(uuid) from public, anon, authenticated;
select public._refresh_rating(id) from public.profiles;

-- Rate the other side of a finished assignment, once.
create or replace function public.rate_person(p_assignment uuid, p_stars int, p_tags text[], p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; j public.jobs; other uuid;
begin
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Rating must be 1 to 5'; end if;
  select * into a from public.assignments where id = p_assignment;
  if not found then raise exception 'Job not found'; end if;
  select * into j from public.jobs where id = a.job_id;
  if auth.uid() = j.household_id then other := a.worker_id;
  elsif auth.uid() = a.worker_id then other := j.household_id;
  else raise exception 'Job not found';
  end if;
  if a.status <> 'done' then raise exception 'You can rate once the work is confirmed'; end if;
  if exists (select 1 from public.ratings where assignment_id = a.id and rater_id = auth.uid()) then
    raise exception 'Already rated';
  end if;
  insert into public.ratings (assignment_id, rater_id, ratee_id, stars, tags, comment)
    values (a.id, auth.uid(), other, p_stars, coalesce(p_tags, '{}'), nullif(left(trim(coalesce(p_comment, '')), 300), ''));
  perform public._refresh_rating(other);
end $$;
revoke all on function public.rate_person(uuid, int, text[], text) from public, anon;
grant execute on function public.rate_person(uuid, int, text[], text) to authenticated;

drop function if exists public.rate_worker(uuid, int);

-- Ratings rows: the two people involved and admins. Others read public_reviews.
alter table public.ratings enable row level security;
revoke all on public.ratings from anon, authenticated;
grant select on public.ratings to authenticated;
drop policy if exists ratings_select on public.ratings;
create policy ratings_select on public.ratings for select to authenticated
  using (rater_id = auth.uid() or ratee_id = auth.uid() or public.is_admin());

-- ---------- public profile and reviews (no phone, UPI or ID document) ----------
create or replace view public.public_profiles as
  select p.id, p.full_name, p.role, p.area, p.rating_avg, p.rating_count, p.created_at,
         w.verified, w.jobs_done, w.skills
    from public.profiles p
    left join public.worker_profiles w on w.user_id = p.id
   where p.role in ('household', 'worker');
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- Reviews show the reviewer's first name only.
create or replace view public.public_reviews as
  select r.ratee_id, r.stars, r.tags, r.comment, r.created_at,
         split_part(p.full_name, ' ', 1) as rater_name, p.role as rater_role
    from public.ratings r join public.profiles p on p.id = r.rater_id;
revoke all on public.public_reviews from anon, authenticated;
grant select on public.public_reviews to authenticated;

-- Workers list: rating comes from the shared profile rating now, with a count.
drop view if exists public.public_workers;
create view public.public_workers as
  select p.id, p.full_name, p.area, w.skills, w.verified, p.rating_avg, p.rating_count, w.jobs_done, w.available
    from public.profiles p
    join public.worker_profiles w on w.user_id = p.id
   where p.role = 'worker';
revoke all on public.public_workers from anon, authenticated;
grant select on public.public_workers to authenticated;

-- The old per-assignment rating column is replaced by the ratings table.
alter table public.assignments drop column if exists rating;

create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
declare r json;
begin
  perform public._require_admin();
  select json_build_object(
    'households',        (select count(*) from public.profiles where role = 'household'),
    'workers',           (select count(*) from public.profiles where role = 'worker'),
    'workers_verified',  (select count(*) from public.worker_profiles where verified),
    'awaiting_verify',   (select count(*) from public.worker_profiles where not verified and id_doc_path is not null),
    'jobs_open',         (select count(*) from public.jobs where status = 'open'),
    'jobs_assigned',     (select count(*) from public.jobs where status = 'assigned'),
    'jobs_done',         (select count(*) from public.jobs where status = 'done'),
    'jobs_cancelled',    (select count(*) from public.jobs where status = 'cancelled'),
    'jobs_last_7d',      (select count(*) from public.jobs where created_at > now() - interval '7 days'),
    'paid_total',        (select coalesce(sum(amount), 0) from public.payments where status = 'paid'),
    'unpaid_jobs',       (select count(*) from public.payments where status = 'pending'),
    'fees_online',       (select coalesce(sum(fee), 0) from public.payments where status = 'paid' and payout_status <> 'na'),
    'fees_owed',         (select coalesce(sum(fee), 0) from public.payments where payout_status = 'na' and fee_settled_at is null),
    'fees_settled',      (select coalesce(sum(fee), 0) from public.payments where payout_status = 'na' and fee_settled_at is not null),
    'payouts_pending',   (select coalesce(sum(amount - fee), 0) from public.payments where payout_status = 'pending'),
    'avg_rating',        (select round(avg(stars), 2) from public.ratings)
  ) into r;
  return r;
end $$;
