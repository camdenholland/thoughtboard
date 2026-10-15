-- Run this entire file in your project's Supabase SQL Editor.
-- No project keys or passwords belong in this file.
begin;

create table if not exists public.thoughtboard_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.thoughtboard_members enable row level security;
revoke all on public.thoughtboard_members from anon, authenticated;
grant select on public.thoughtboard_members to authenticated;
drop policy if exists "thoughtboard_read_own_membership" on public.thoughtboard_members;
create policy "thoughtboard_read_own_membership" on public.thoughtboard_members
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.thoughtboard_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  title text not null default '',
  content text not null default '',
  tags text[] not null default '{}',
  is_private boolean not null default false,
  note_date date,
  created_at timestamptz,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  primary key (user_id, id),
  check (revision > 0)
);
create index if not exists thoughtboard_notes_created_idx
  on public.thoughtboard_notes(user_id, created_at desc, inserted_at desc);
alter table public.thoughtboard_notes enable row level security;
revoke all on public.thoughtboard_notes from anon, authenticated;
grant select, insert, update, delete on public.thoughtboard_notes to authenticated;
drop policy if exists "thoughtboard_owner_access" on public.thoughtboard_notes;
create policy "thoughtboard_owner_access" on public.thoughtboard_notes
  for all to authenticated
  using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.thoughtboard_members where user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.thoughtboard_members where user_id = (select auth.uid())
    )
  );

create or replace function public.thoughtboard_note_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;
revoke all on function public.thoughtboard_note_revision() from public;
drop trigger if exists thoughtboard_note_revision on public.thoughtboard_notes;
create trigger thoughtboard_note_revision before update on public.thoughtboard_notes
  for each row execute function public.thoughtboard_note_revision();

-- Images are private even when a note is not marked "private" in the UI.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thoughtboard-images', 'thoughtboard-images', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "thoughtboard_images_read" on storage.objects;
create policy "thoughtboard_images_read" on storage.objects for select to authenticated
using (
  bucket_id = 'thoughtboard-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.thoughtboard_members where user_id = (select auth.uid()))
);
drop policy if exists "thoughtboard_images_insert" on storage.objects;
create policy "thoughtboard_images_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'thoughtboard-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.thoughtboard_members where user_id = (select auth.uid()))
);
-- Uploads are immutable. Replacing an image creates a new object; no public URLs.
commit;
