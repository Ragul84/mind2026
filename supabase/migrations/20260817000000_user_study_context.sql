-- Canonical, routing-only student context for MIGA and curriculum-aware study flows.
-- This is deliberately separate from profile identity and Daily Mission progression.

create table if not exists public.user_study_context (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_exam text null check (primary_exam in ('upsc', 'tnpsc', 'ssc', 'rrb', 'neet', 'jee', 'banking', 'other')),
  primary_curriculum text null check (primary_curriculum in ('ncert', 'samacheer')),
  class_level integer null check (class_level between 1 and 12),
  context_source text not null check (context_source in ('onboarding', 'user_choice', 'legacy_backfill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_study_context_curriculum_idx
  on public.user_study_context(primary_curriculum)
  where primary_curriculum is not null;

alter table public.user_study_context enable row level security;

drop policy if exists "user_study_context_owner_select" on public.user_study_context;
create policy "user_study_context_owner_select"
  on public.user_study_context for select
  using (auth.uid() = user_id);

drop policy if exists "user_study_context_owner_insert" on public.user_study_context;
create policy "user_study_context_owner_insert"
  on public.user_study_context for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_study_context_owner_update" on public.user_study_context;
create policy "user_study_context_owner_update"
  on public.user_study_context for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_study_context_owner_delete" on public.user_study_context;
create policy "user_study_context_owner_delete"
  on public.user_study_context for delete
  using (auth.uid() = user_id);

drop trigger if exists user_study_context_touch on public.user_study_context;
create trigger user_study_context_touch
before update on public.user_study_context
for each row execute function public.touch_updated_at();

-- A single authenticated transaction replaces the former split onboarding writes.
create or replace function public.complete_study_context_onboarding(
  p_full_name text,
  p_state text,
  p_avatar_url text,
  p_primary_exam text,
  p_primary_curriculum text,
  p_class_level integer,
  p_protocol_track_id text
)
returns public.user_study_context
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_context public.user_study_context;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_primary_exam is not null and p_primary_exam not in ('upsc', 'tnpsc', 'ssc', 'rrb', 'neet', 'jee', 'banking', 'other') then
    raise exception 'Unsupported primary exam';
  end if;
  if p_primary_curriculum is not null and p_primary_curriculum not in ('ncert', 'samacheer') then
    raise exception 'Unsupported primary curriculum';
  end if;
  if p_class_level is not null and (p_class_level < 1 or p_class_level > 12) then
    raise exception 'Invalid class level';
  end if;
  if p_protocol_track_id is null or length(trim(p_protocol_track_id)) = 0 then
    raise exception 'Study protocol track is required';
  end if;

  insert into public.user_profiles (id, full_name, state, avatar_url, updated_at)
  values (v_user_id, nullif(trim(p_full_name), ''), nullif(trim(p_state), ''), nullif(trim(p_avatar_url), ''), now())
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
    state = coalesce(excluded.state, public.user_profiles.state),
    avatar_url = coalesce(excluded.avatar_url, public.user_profiles.avatar_url),
    updated_at = now();

  insert into public.user_protocols (user_id, track_id, current_day_number, progress_phase, updated_at)
  values (v_user_id, p_protocol_track_id, 1, 1, now())
  on conflict (user_id) do update set
    track_id = excluded.track_id,
    current_day_number = 1,
    progress_phase = 1,
    updated_at = now();

  insert into public.user_study_context (
    user_id, primary_exam, primary_curriculum, class_level, context_source, updated_at
  ) values (
    v_user_id, p_primary_exam, p_primary_curriculum, p_class_level, 'onboarding', now()
  )
  on conflict (user_id) do update set
    primary_exam = excluded.primary_exam,
    primary_curriculum = excluded.primary_curriculum,
    class_level = excluded.class_level,
    context_source = 'onboarding',
    updated_at = now()
  returning * into v_context;

  return v_context;
end;
$$;

revoke all on function public.complete_study_context_onboarding(text, text, text, text, text, integer, text) from public;
grant execute on function public.complete_study_context_onboarding(text, text, text, text, text, integer, text) to authenticated;

-- Conservative backfill. Legacy Daily Mission tracks identify a curriculum but
-- cannot distinguish an exam learner from its matching school-curriculum flow.
insert into public.user_study_context (
  user_id, primary_exam, primary_curriculum, class_level, context_source
)
select
  p.id,
  case
    when lower(coalesce(p.target_exam, '')) ~ '(tnpsc|group[[:space:]]*[1-4])' then 'tnpsc'
    when lower(coalesce(p.target_exam, '')) ~ '(upsc|ias|cse)' then 'upsc'
    when lower(coalesce(p.target_exam, '')) ~ 'ssc' then 'ssc'
    when lower(coalesce(p.target_exam, '')) ~ 'rrb' then 'rrb'
    else null
  end,
  case
    when lower(coalesce(p.target_exam, '')) ~ '(tnpsc|samacheer|tamil[[:space:]]*nadu|group[[:space:]]*[1-4])' then 'samacheer'
    when lower(coalesce(p.target_exam, '')) ~ '(upsc|ias|cse|ssc|rrb|ncert|cbse)' then 'ncert'
    else null
  end,
  null,
  'legacy_backfill'
from public.user_profiles p
where lower(coalesce(p.target_exam, '')) ~ '(tnpsc|samacheer|tamil[[:space:]]*nadu|group[[:space:]]*[1-4]|upsc|ias|cse|ssc|rrb|ncert|cbse)'
on conflict (user_id) do nothing;

insert into public.user_study_context (
  user_id, primary_exam, primary_curriculum, class_level, context_source
)
select
  up.user_id,
  case when up.track_id = 'ssc_ecosystem' then 'ssc' else null end,
  case
    when up.track_id = 'tnpsc_ecosystem' then 'samacheer'
    when up.track_id in ('upsc_ecosystem', 'ssc_ecosystem') then 'ncert'
    else null
  end,
  null,
  'legacy_backfill'
from public.user_protocols up
where up.track_id in ('tnpsc_ecosystem', 'upsc_ecosystem', 'ssc_ecosystem')
  and not exists (
    select 1 from public.user_study_context usc where usc.user_id = up.user_id
  );
