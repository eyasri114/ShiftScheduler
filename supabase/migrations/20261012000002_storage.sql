-- Private bucket for sick notes and other absence attachments.
-- Object path convention: <member_id>/<absence_id>/<file name>
-- Only the employee and the managers who manage them can read the file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('absence-attachments', 'absence-attachments', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy absence_files_read on storage.objects for select to authenticated
  using (bucket_id = 'absence-attachments'
         and (public.is_self(((storage.foldername(name))[1])::uuid)
              or public.manages_member(((storage.foldername(name))[1])::uuid)));

create policy absence_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'absence-attachments'
              and (public.is_self(((storage.foldername(name))[1])::uuid)
                   or public.manages_member(((storage.foldername(name))[1])::uuid)));

create policy absence_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'absence-attachments'
         and public.manages_member(((storage.foldername(name))[1])::uuid));
