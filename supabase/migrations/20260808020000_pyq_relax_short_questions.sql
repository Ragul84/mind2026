-- Relax the over-aggressive short-question filter in pyq_verified_clean.
--
-- Problem: the clean view required question_text length >= 30, a heuristic meant
-- to drop truncated-OCR garbage. But it wrongly hid ~124 legitimate short
-- previous-year questions across all exams — e.g. "The common table salt is",
-- "Swine Flu is caused by", "Orlon fibres are made up of :", "What is blue
-- carbon?" — all with 4 valid options and an official answer key.
--
-- Fix: lower the floor to length >= 10. Every other clean-gate constraint is
-- retained (verified source, non-demoted, objective, >= 4 options, answer_text
-- present, confidence >= 0.7), so a row admitted by this change already carries
-- a strong validity signal; the length floor now only guards against true
-- single-token OCR noise. Audited impact: +84 TNPSC, +33 JEE, +3 UPSC, +3 SSC,
-- +1 NEET — all verified as real questions, zero garbage.
--
-- Columns are unchanged, so the dependent analytics views (pyq_topic_frequency,
-- pyq_subject_breakdown, pyq_year_distribution, pyq_exam_summary) and
-- get_topic_heatmap automatically reflect the new definition — no cascade needed.

create or replace view public.pyq_verified_clean as
select
  id, source_id, exam, year, subject, topic, subtopic,
  question_number, question_text, options, answer_text,
  question_type, answer_source, confidence, needs_figure, images
from public.pyq_questions
where
  -- Must come from a verified source
  public.is_verified_pyq_source(source_id, exam)
  -- Not demoted or rejected
  and answer_source not like '%-demoted'
  and answer_source not like 'rejected-%'
  and answer_source not like '%|garbage-demoted'
  and answer_source not like '%|quality-demoted'
  -- Not model-derived (only official-key / crossverified-key)
  and answer_source not in ('derived-model', 'derived-claude')
  and answer_source is not null
  -- Must be a real MCQ
  and question_type = 'objective'
  and confidence >= 0.7
  -- Relaxed from >= 30: keep short but valid factual questions (e.g. "SO2 acts as")
  and length(coalesce(question_text, '')) >= 10
  and answer_text is not null
  and jsonb_array_length(options) >= 4;
