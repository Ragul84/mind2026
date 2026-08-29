-- Weak-areas engine: real, per-user tracking of weak topics with spaced repetition.
--
-- Wrong answers record/strengthen a weak topic (strength drops, becomes due now).
-- Revising it advances a spaced-repetition schedule so it won't resurface until due,
-- and a fully mastered topic drops out of rotation. This is what makes "a revised
-- topic is not repeated" and "recently wrong topics come back" actually work.

create table if not exists public.weak_topics (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  subject        text not null default 'General',
  topic          text not null,
  topic_key      text not null,               -- normalized (lower/trimmed) for dedup
  reason         text,                          -- why it's weak (e.g. "missed 2 PYQs")
  source         text not null default 'quiz',  -- quiz | chat | manual
  strength       int  not null default 0,       -- 0..5 mastery box (higher = stronger)
  times_wrong    int  not null default 1,
  times_revised  int  not null default 0,
  status         text not null default 'active' check (status in ('active','mastered','archived')),
  last_wrong_at  timestamptz not null default now(),
  last_revised_at timestamptz,
  next_due_at    timestamptz not null default now(),  -- when it should resurface
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, topic_key)
);

create index if not exists idx_weak_topics_due
  on public.weak_topics (user_id, status, next_due_at);

alter table public.weak_topics enable row level security;

drop policy if exists "weak_topics_owner" on public.weak_topics;
create policy "weak_topics_owner" on public.weak_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Spaced-repetition interval (days) for a given strength after a correct revise.
create or replace function public._weak_interval_days(p_strength int)
returns int language sql immutable as $$
  select case
    when p_strength <= 0 then 0
    when p_strength = 1 then 1
    when p_strength = 2 then 3
    when p_strength = 3 then 7
    when p_strength = 4 then 16
    else 35
  end;
$$;

-- Record a wrong answer -> create or strengthen the weak topic, make it due now.
create or replace function public.record_weak_topic(
  p_topic text, p_subject text default 'General', p_reason text default null, p_source text default 'quiz'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_key text := lower(btrim(p_topic));
begin
  if v_key = '' or auth.uid() is null then return; end if;
  insert into public.weak_topics (user_id, subject, topic, topic_key, reason, source)
  values (auth.uid(), coalesce(nullif(btrim(p_subject),''),'General'), btrim(p_topic), v_key, p_reason, p_source)
  on conflict (user_id, topic_key) do update
    set times_wrong   = public.weak_topics.times_wrong + 1,
        strength      = greatest(0, public.weak_topics.strength - 1),
        reason        = coalesce(excluded.reason, public.weak_topics.reason),
        status        = 'active',
        last_wrong_at = now(),
        next_due_at   = now(),
        updated_at    = now();
end;
$$;

-- Mark a topic revised -> advance spaced repetition; master it after strength 5.
create or replace function public.mark_topic_revised(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_new_strength int;
begin
  update public.weak_topics
     set strength = least(5, strength + 1)
   where id = p_id and user_id = auth.uid()
   returning strength into v_new_strength;
  if v_new_strength is null then return; end if;
  update public.weak_topics
     set times_revised  = times_revised + 1,
         last_revised_at = now(),
         next_due_at     = now() + make_interval(days => public._weak_interval_days(v_new_strength)),
         status          = case when v_new_strength >= 5 then 'mastered' else 'active' end,
         updated_at      = now()
   where id = p_id and user_id = auth.uid();
end;
$$;

grant execute on function public.record_weak_topic(text, text, text, text) to authenticated;
grant execute on function public.mark_topic_revised(uuid) to authenticated;
