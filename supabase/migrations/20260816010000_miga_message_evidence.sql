-- Additive structured textbook evidence for MIGA assistant messages.
-- Existing message content and history remain unchanged; NULL means legacy/no evidence.
alter table public.miga_chat_messages
  add column if not exists evidence jsonb;

alter table public.miga_chat_messages
  add constraint miga_chat_messages_evidence_array_check
  check (evidence is null or jsonb_typeof(evidence) = 'array') not valid;
