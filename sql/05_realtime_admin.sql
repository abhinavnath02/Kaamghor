-- Kaamghor 05: live job updates, and making yourself admin.

-- New and changed jobs reach workers live. Realtime still applies the jobs RLS policies.
alter publication supabase_realtime add table public.jobs;

-- Make yourself admin: sign in once in the app (Google or email) and finish the sign-up form,
-- then replace the email below with the one you signed in with and run this statement.
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
