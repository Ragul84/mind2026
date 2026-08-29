-- Mock test attempts + All-India Rank (Phase 1).
-- One row per submitted full-length mock. RLS keeps each user to their own rows;
-- ranking across all users is done by a SECURITY DEFINER function (same pattern
-- as get_user_global_rank / submit_daily_quiz_attempt) so the client never needs
-- to read other users' rows.

create table if not exists public.mock_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id text not null,
  config_name text not null default '',
  total_questions int not null default 0,
  attempted int not null default 0,
  correct int not null default 0,
  wrong int not null default 0,
  skipped int not null default 0,
  score numeric not null default 0,
  max_marks numeric not null default 0,
  accuracy numeric not null default 0,      -- 0..1
  percentage numeric not null default 0,    -- 0..1
  duration_sec int not null default 0,
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mock_attempts_user_idx
  on public.mock_attempts (user_id, created_at desc);
-- Ranking scans best score per user within an exam.
create index if not exists mock_attempts_exam_score_idx
  on public.mock_attempts (exam_id, score desc);

alter table public.mock_attempts enable row level security;

drop policy if exists "mock_attempts_select_own" on public.mock_attempts;
create policy "mock_attempts_select_own" on public.mock_attempts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "mock_attempts_insert_own" on public.mock_attempts;
create policy "mock_attempts_insert_own" on public.mock_attempts
  for insert to authenticated with check (user_id = auth.uid());

-- ── Submit an attempt and return the All-India Rank in one atomic call ──────
-- Rank is computed over each user's BEST score for the exam (so repeated
-- attempts don't inflate the field). user_id is taken from auth.uid() — the
-- caller cannot record on another user's behalf.
create or replace function public.submit_mock_attempt(
  p_exam_id text,
  p_config_name text,
  p_total int,
  p_attempted int,
  p_correct int,
  p_wrong int,
  p_skipped int,
  p_score numeric,
  p_max_marks numeric,
  p_accuracy numeric,
  p_percentage numeric,
  p_duration_sec int,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_rank int;
  v_total int;
  v_percentile numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  insert into public.mock_attempts (
    user_id, exam_id, config_name, total_questions, attempted, correct, wrong,
    skipped, score, max_marks, accuracy, percentage, duration_sec, sections
  ) values (
    v_user, p_exam_id, coalesce(p_config_name, ''), p_total, p_attempted, p_correct,
    p_wrong, p_skipped, p_score, p_max_marks, p_accuracy, p_percentage, p_duration_sec,
    coalesce(p_sections, '[]'::jsonb)
  ) returning id into v_id;

  with best as (
    select user_id, max(score) as s
    from public.mock_attempts
    where exam_id = p_exam_id
    group by user_id
  )
  select
    (select count(*) from best where s > p_score) + 1,
    (select count(*) from best),
    case when (select count(*) from best) > 0
      then round((select count(*) from best where s < p_score)::numeric
                 / (select count(*) from best) * 100, 1)
      else 0 end
  into v_rank, v_total, v_percentile;

  return jsonb_build_object(
    'attempt_id', v_id,
    'rank', v_rank,
    'total', v_total,
    'percentile', v_percentile
  );
end;
$$;

grant execute on function public.submit_mock_attempt(
  text, text, int, int, int, int, int, numeric, numeric, numeric, numeric, int, jsonb
) to authenticated, service_role;
