-- PYQ Analytics Views + Functions
-- Powers the Exam Intelligence AI: topic frequency, year distribution,
-- syllabus heatmap — queries no generic AI (ChatGPT/Claude) can answer.
--
-- Design: views are read-only, computed from pyq_questions filtering only
-- clean rows (no demoted, no derived-model answers, confidence >= 0.7).
-- The "verified PYQ" gate is intentionally strict — only the sources
-- whose answer_source came from an official key or cross-verified key.

-- ============================================================
-- HELPER: is a row from a verified, clean PYQ source?
-- Used consistently across all views and the edge function.
-- ============================================================

-- Verified TNPSC source prefixes (Claude Code official-key ingests):
--   tnpsc-group1-prelims-*, tnpsc-group2-prelims-*, tnpsc-group2-*,
--   tnpsc-group4-prelims-*, tnpsc-group2a-*, tnpsc-acf-prelims-*
-- Verified UPSC source prefix: web-upsc-cse-prelims-gs1*
-- Verified SSC: examside-ssc-cgl-tier-i*
-- Verified JEE: examside-jee-*, official-jee-advanced-2026-*
-- Verified NEET: testbook-neet-correct-option*, official-neet-*

create or replace function public.is_verified_pyq_source(p_source_id text, p_exam text)
returns boolean
language sql
immutable
as $$
  select
    case upper(p_exam)
      when 'TNPSC' then p_source_id ~ '^(tnpsc-group[124]|tnpsc-group2a|tnpsc-acf)'
      when 'UPSC'  then p_source_id like 'web-upsc-cse-prelims-gs1%'
      when 'SSC'   then p_source_id like 'examside-ssc-cgl-tier-i%'
      when 'JEE'   then p_source_id ~ '^(examside-jee|official-jee-advanced-2026)'
      when 'NEET'  then p_source_id ~ '^(testbook-neet-correct-option|official-neet)'
      else false
    end;
$$;

-- ============================================================
-- VIEW 1: pyq_verified_clean
-- The foundation — only rows that are truly verified and serveable.
-- All analytics views derive from this.
-- ============================================================

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
  and length(coalesce(question_text, '')) >= 30
  and answer_text is not null
  and jsonb_array_length(options) >= 4;

-- ============================================================
-- VIEW 2: pyq_topic_frequency
-- For each exam+subject+topic: count, years appeared, first/last year.
-- Powers: "Which topic is most asked in TNPSC Group I?"
-- ============================================================

create or replace view public.pyq_topic_frequency as
select
  exam,
  coalesce(subject, 'Unclassified') as subject,
  coalesce(topic,   'Unclassified') as topic,
  count(*) as question_count,
  count(distinct year) as years_appeared,
  min(year) as first_year,
  max(year) as last_year,
  -- Heat score: frequency × recency (questions from last 3 years weight 2x)
  count(*) + count(*) filter (where year >= extract(year from now())::int - 3) as heat_score
from public.pyq_verified_clean
where subject is not null and topic is not null
group by exam, subject, topic
order by exam, heat_score desc;

comment on view public.pyq_topic_frequency is
  'Per-exam topic frequency across verified PYQs. Used for "most asked" analytics.';

-- ============================================================
-- VIEW 3: pyq_subject_breakdown
-- Per-exam subject totals + percentage of total questions.
-- Powers: "What percentage of TNPSC is Polity?"
-- ============================================================

create or replace view public.pyq_subject_breakdown as
with totals as (
  select exam, count(*) as total_for_exam
  from public.pyq_verified_clean
  where subject is not null
  group by exam
)
select
  v.exam,
  coalesce(v.subject, 'Unclassified') as subject,
  count(*) as question_count,
  t.total_for_exam,
  round(count(*) * 100.0 / t.total_for_exam, 1) as pct_of_total,
  count(distinct v.year) as years_with_questions,
  min(v.year) as first_year,
  max(v.year) as last_year
from public.pyq_verified_clean v
join totals t on t.exam = v.exam
where v.subject is not null
group by v.exam, v.subject, t.total_for_exam
order by v.exam, question_count desc;

comment on view public.pyq_subject_breakdown is
  'Subject-level percentage breakdown per exam. Powers the heatmap UI and priority advice.';

-- ============================================================
-- VIEW 4: pyq_year_distribution
-- Per-exam per-year question counts, broken down by subject.
-- Powers: year-wise trend charts in the UI.
-- ============================================================

create or replace view public.pyq_year_distribution as
select
  exam,
  year,
  coalesce(subject, 'Unclassified') as subject,
  count(*) as question_count
from public.pyq_verified_clean
where year is not null
group by exam, year, subject
order by exam, year desc, question_count desc;

comment on view public.pyq_year_distribution is
  'Year-wise question distribution per exam and subject. Powers trend charts.';

-- ============================================================
-- VIEW 5: pyq_exam_summary
-- One row per exam: total verified questions, year range, subject count.
-- Powers the top-level Exam Intelligence dashboard.
-- ============================================================

create or replace view public.pyq_exam_summary as
select
  exam,
  count(*) as total_questions,
  count(distinct year) as years_covered,
  min(year) as from_year,
  max(year) as to_year,
  count(distinct subject) filter (where subject is not null) as subjects_covered,
  count(*) filter (where subject is null) as untagged_count,
  count(*) filter (where needs_figure = true) as figure_dependent_count
from public.pyq_verified_clean
group by exam
order by total_questions desc;

comment on view public.pyq_exam_summary is
  'Top-level summary per exam. Powers the main exam intelligence card.';

-- ============================================================
-- FUNCTION: get_topic_heatmap
-- Returns ranked topics for an exam (optionally filtered by subject).
-- Called by the pyq_intelligence edge function.
-- ============================================================

create or replace function public.get_topic_heatmap(
  p_exam    text,
  p_subject text default null
)
returns table (
  subject        text,
  topic          text,
  question_count bigint,
  years_appeared bigint,
  first_year     int,
  last_year      int,
  heat_score     bigint,
  pct_of_subject numeric
)
language sql
stable
as $$
  with filtered as (
    select
      coalesce(f.subject, 'Unclassified') as subject,
      coalesce(f.topic,   'Unclassified') as topic,
      count(*) as question_count,
      count(distinct f.year) as years_appeared,
      min(f.year)::int as first_year,
      max(f.year)::int as last_year,
      count(*) + count(*) filter (
        where f.year >= extract(year from now())::int - 3
      ) as heat_score
    from public.pyq_verified_clean f
    where
      upper(f.exam) = upper(p_exam)
      and f.subject is not null
      and f.topic is not null
      and (p_subject is null or upper(f.subject) = upper(p_subject))
    group by f.subject, f.topic
  ),
  subject_totals as (
    select subject, sum(question_count) as subj_total
    from filtered
    group by subject
  )
  select
    f.subject,
    f.topic,
    f.question_count,
    f.years_appeared,
    f.first_year,
    f.last_year,
    f.heat_score,
    round(f.question_count * 100.0 / st.subj_total, 1) as pct_of_subject
  from filtered f
  join subject_totals st on st.subject = f.subject
  order by f.heat_score desc;
$$;

comment on function public.get_topic_heatmap is
  'Returns ranked topic heatmap for an exam. Called by the pyq_intelligence edge function.';

-- RLS: views inherit from pyq_questions (already has RLS). Functions are stable/immutable,
-- called as service_role from edge functions — no additional RLS needed.
grant select on public.pyq_verified_clean    to service_role, authenticated, anon;
grant select on public.pyq_topic_frequency   to service_role, authenticated, anon;
grant select on public.pyq_subject_breakdown to service_role, authenticated, anon;
grant select on public.pyq_year_distribution to service_role, authenticated, anon;
grant select on public.pyq_exam_summary      to service_role, authenticated, anon;
grant execute on function public.get_topic_heatmap to service_role, authenticated, anon;
grant execute on function public.is_verified_pyq_source to service_role, authenticated, anon;
