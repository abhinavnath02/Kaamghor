-- Kaamghor 04: private bucket for worker ID documents.
-- Workers upload into their own folder (<user id>/...). Only admins can read, through 5-minute signed links.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-docs', 'id-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy id_docs_worker_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'id-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'worker')
);

create policy id_docs_admin_read on storage.objects for select to authenticated using (
  bucket_id = 'id-docs' and public.is_admin()
);
