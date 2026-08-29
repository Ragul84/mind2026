-- MIGA voice/call sessions — cloud-synced, kept SEPARATE from text chat
-- (miga_chat_sessions). One row per call session; the whole transcript is stored
-- as JSONB so a session maps 1:1 to the app's MascotSession snapshot.

create table if not exists public.miga_call_sessions (
  id text primary key,                       -- app-generated session id (e.g. "miga-...")
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'tutor',        -- 'tutor' | 'story'
  title text not null default '',
  last_message text,
  language_code text,
  language_label text,
  status text not null default 'paused',     -- 'active' | 'paused' | 'completed'
  topic text,
  story_id text,
  message_count int not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_miga_call_sessions_user
  on public.miga_call_sessions (user_id, last_message_at desc);

alter table public.miga_call_sessions enable row level security;

-- Owners can do everything with their own rows; nobody else can see them.
drop policy if exists "miga_call_sessions_owner" on public.miga_call_sessions;
create policy "miga_call_sessions_owner" on public.miga_call_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
