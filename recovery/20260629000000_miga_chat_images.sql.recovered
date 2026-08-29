-- Chat image attachments — private storage + per-message reference.
-- Images live in a PRIVATE bucket; the app views them via short-lived signed URLs.
-- Path convention: chat-images/<user_id>/<file>  (first folder = owner uid).

-- 1) Reference column on messages (stores the object PATH, not a URL, since signed
--    URLs expire — we mint a fresh one on load).
alter table public.miga_chat_messages
  add column if not exists image_path text;

-- 2) Private bucket.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

-- 3) Owner-only access to objects in this bucket. The first path segment must be
--    the caller's uid, so users can only read/write their own images.
drop policy if exists "chat_images_insert_own" on storage.objects;
create policy "chat_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat_images_select_own" on storage.objects;
create policy "chat_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat_images_delete_own" on storage.objects;
create policy "chat_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
