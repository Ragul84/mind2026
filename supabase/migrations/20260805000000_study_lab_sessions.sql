-- Study Lab sessions — move Study Lab off device-only AsyncStorage into the DB so
-- sessions + their generated artifacts (flashcards, quiz, revision notes, mind maps)
-- sync across devices and survive a reinstall. One row per session; the full session
-- object (materials + artifacts + pending state) lives in the `session` jsonb column.
create table if not exists public.study_lab_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  session jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_lab_sessions_user_idx
  on public.study_lab_sessions (user_id, updated_at desc);

alter table public.study_lab_sessions enable row level security;

-- Owner-only access: a user can only see and change their own sessions.
drop policy if exists "study_lab_select_own" on public.study_lab_sessions;
create policy "study_lab_select_own" on public.study_lab_sessions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "study_lab_insert_own" on public.study_lab_sessions;
create policy "study_lab_insert_own" on public.study_lab_sessions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "study_lab_update_own" on public.study_lab_sessions;
create policy "study_lab_update_own" on public.study_lab_sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "study_lab_delete_own" on public.study_lab_sessions;
create policy "study_lab_delete_own" on public.study_lab_sessions
  for delete to authenticated using (user_id = auth.uid());
