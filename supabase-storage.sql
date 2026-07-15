insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read media" on storage.objects;
create policy "Public read media"
on storage.objects for select
to public
using (bucket_id = 'media');

drop policy if exists "Public upload media" on storage.objects;
create policy "Public upload media"
on storage.objects for insert
to public
with check (bucket_id = 'media');

drop policy if exists "Public update media" on storage.objects;
create policy "Public update media"
on storage.objects for update
to public
using (bucket_id = 'media')
with check (bucket_id = 'media');

drop policy if exists "Public delete media" on storage.objects;
create policy "Public delete media"
on storage.objects for delete
to public
using (bucket_id = 'media');
