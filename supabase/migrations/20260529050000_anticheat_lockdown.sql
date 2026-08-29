-- Anti-cheat lockdown: clients can join/read, but cannot write scores/ranks/rewards.

drop policy if exists "Participant can update own score" on public.quiz_room_participants;

drop policy if exists "Players can update their own participation" on public.game_participants;
drop policy if exists "Authenticated users can update game sessions" on public.game_sessions;

revoke update on public.quiz_room_participants from anon, authenticated;
revoke update on public.game_participants from anon, authenticated;
revoke update on public.game_sessions from anon, authenticated;

-- Hide correct answers from direct client table reads where possible.
revoke select (correct_answer) on public.vault_questions from anon, authenticated;
revoke select (questions_data) on public.quiz_rooms from anon, authenticated;

create table if not exists public.anticheat_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'low',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.anticheat_events enable row level security;

drop policy if exists "Service role manages anticheat events" on public.anticheat_events;
create policy "Service role manages anticheat events"
on public.anticheat_events
for all
to service_role
using (true)
with check (true);
