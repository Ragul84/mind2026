-- Nullified (cancelled) TNPSC questions with multi-answer support.
--
-- TNPSC officially cancels defective questions in two ways:
--   * multi-correct  — several options are accepted (e.g. A and D both right)
--   * grace / ALL    — the question is too broken, everyone is credited
-- Previously these were dropped entirely (no single answer). We now keep them
-- so the papers are complete, storing the full set of accepted options and a
-- flag. Quiz scoring treats any accepted option as correct (multi-answer strict)
-- and marks them all green, with the nullification noted in the explanation.
--
-- answer_source = 'official-key-nullified'; answer_text holds a primary accepted
-- option (for legacy single-answer display); accepted_answers holds the full set.

alter table public.pyq_questions
  add column if not exists nullified boolean not null default false,
  add column if not exists accepted_answers jsonb;

-- Recreate the clean view to expose the two new columns (and keep the relaxed
-- >= 10 length floor). Nullified rows already satisfy every other clean-gate
-- constraint, so they surface automatically once ingested.
create or replace view public.pyq_verified_clean as
select
  id, source_id, exam, year, subject, topic, subtopic,
  question_number, question_text, options, answer_text,
  question_type, answer_source, confidence, needs_figure, images,
  nullified, accepted_answers
from public.pyq_questions
where
  public.is_verified_pyq_source(source_id, exam)
  and answer_source not like '%-demoted'
  and answer_source not like 'rejected-%'
  and answer_source not like '%|garbage-demoted'
  and answer_source not like '%|quality-demoted'
  and answer_source not in ('derived-model', 'derived-claude')
  and answer_source is not null
  and question_type = 'objective'
  and confidence >= 0.7
  and length(coalesce(question_text, '')) >= 10
  and answer_text is not null
  and jsonb_array_length(options) >= 4;
