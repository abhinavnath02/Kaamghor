-- Kaamghor 16: everything both sides act on reaches the other side live.
-- New applications, payments and ratings join jobs and assignments in Supabase Realtime.
-- Realtime still applies each table's RLS policies, so people only get rows they may read.
-- Safe to run more than once.

do $$
declare t text;
begin
  foreach t in array array['jobs', 'assignments', 'applications', 'payments', 'ratings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
