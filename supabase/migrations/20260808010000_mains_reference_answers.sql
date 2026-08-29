-- Mains / descriptive model-answer references (Phase 2 quality lift).
-- A curated corpus of real reference answers (official keys, topper copies,
-- standard-book model answers) so AI answer-evaluation grades CONTENT against a
-- gold standard, not just generic judgement. Starts empty; answer-eval falls
-- back to textbook-RAG grounding until references are ingested. Populated by an
-- ingestion job (service_role); read-only to clients.

create table if not exists public.mains_reference_answers (
  id uuid primary key default gen_random_uuid(),
  exam text not null,                       -- UPSC / TNPSC / Banking / SSC
  paper text,                               -- e.g. 'GS Paper II', 'Essay', 'Descriptive'
  topic text,
  question text not null,
  model_answer text not null,
  key_points jsonb not null default '[]'::jsonb,   -- string[] the ideal answer must cover
  source text,                              -- 'UPSC official key' | 'topper copy' | book name
  year int,
  created_at timestamptz not null default now()
);

create index if not exists mains_ref_exam_idx on public.mains_reference_answers (exam);
create index if not exists mains_ref_topic_idx on public.mains_reference_answers (exam, topic);

alter table public.mains_reference_answers enable row level security;

-- Read-only to everyone; only service_role (ingestion) writes.
drop policy if exists "mains_ref_read" on public.mains_reference_answers;
create policy "mains_ref_read" on public.mains_reference_answers
  for select to authenticated, anon using (true);

grant select on public.mains_reference_answers to authenticated, anon, service_role;
