-- MIGA text-chat sessions + messages (ChatGPT-style history, cloud-synced).
-- Per-message rows so long threads load partially and survive restarts.

create table if not exists public.miga_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.miga_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.miga_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_miga_sessions_user
  on public.miga_chat_sessions (user_id, pinned desc, last_message_at desc);
create index if not exists idx_miga_messages_session
  on public.miga_chat_messages (session_id, created_at asc);
-- For history search across message bodies.
create index if not exists idx_miga_messages_content
  on public.miga_chat_messages using gin (to_tsvector('simple', content));

alter table public.miga_chat_sessions enable row level security;
alter table public.miga_chat_messages enable row level security;

-- Owners can do everything with their own rows; nobody else can see them.
drop policy if exists "miga_sessions_owner" on public.miga_chat_sessions;
create policy "miga_sessions_owner" on public.miga_chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "miga_messages_owner" on public.miga_chat_messages;
create policy "miga_messages_owner" on public.miga_chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
