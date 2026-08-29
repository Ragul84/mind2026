-- Thumbs up/down on MIGA answers. Nullable: null = no rating given.
-- Lives on the message row itself since a rating is 1:1 with an answer and is
-- only ever read alongside it.

alter table public.miga_chat_messages
  add column if not exists feedback text
  check (feedback is null or feedback in ('up', 'down'));

-- Partial index: we only ever query the rated rows (to review bad answers), and
-- the overwhelming majority stay null.
create index if not exists idx_miga_messages_feedback
  on public.miga_chat_messages (user_id, feedback)
  where feedback is not null;
