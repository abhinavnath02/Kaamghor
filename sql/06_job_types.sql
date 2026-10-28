-- Kaamghor 06: new kinds of work: caretaker, healthcare provider, and "others".
-- Safe to run on a database that already has 01-05.

create or replace function public.valid_skill(s text) returns boolean
language sql immutable as $$
  select s in ('clean', 'cook', 'garden', 'paint', 'helper', 'plumb', 'elec', 'care', 'health', 'other')
$$;

-- "Others" must say what the work is, so workers know before applying.
alter table public.jobs drop constraint if exists jobs_other_needs_notes;
alter table public.jobs add constraint jobs_other_needs_notes
  check (service <> 'other' or char_length(trim(coalesce(notes, ''))) >= 5);
