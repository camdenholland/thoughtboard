-- Run once in the Supabase SQL Editor before deploying the updated frontend.
-- This adds board preferences; it does not change or delete notes.
begin;
create table if not exists public.thoughtboard_layout (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ordered_ids text[] not null default '{}',
  sort_mode text not null default 'manual' check(sort_mode in ('manual','newest','oldest','az','za')),
  revision integer not null default 1 check(revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.thoughtboard_layout enable row level security;
revoke all on public.thoughtboard_layout from anon, authenticated;
grant select, insert, update, delete on public.thoughtboard_layout to authenticated;
drop policy if exists thoughtboard_layout_owner on public.thoughtboard_layout;
create policy thoughtboard_layout_owner on public.thoughtboard_layout for all to authenticated
using (user_id = (select auth.uid()) and exists(select 1 from public.thoughtboard_members where user_id = (select auth.uid())))
with check (user_id = (select auth.uid()) and exists(select 1 from public.thoughtboard_members where user_id = (select auth.uid())));
drop trigger if exists thoughtboard_layout_revision on public.thoughtboard_layout;
create trigger thoughtboard_layout_revision before update on public.thoughtboard_layout
for each row execute function public.thoughtboard_note_revision();
commit;
