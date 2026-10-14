-- Weekly leagues (Duolingo-style).
--
-- * xp_events: append-only XP ledger. Filled by a trigger on user_stats.total_xp,
--   so every existing XP path (secure-rewards, lesson rewards, quizzes…) feeds
--   leagues without touching any caller.
-- * Weekly cohorts of up to 30 learners per tier. A learner joins this week's
--   cohort on their first XP of the week (IST weeks, Monday 00:00).
-- * Rollover (pg_cron, Monday 00:05 IST): top 7 promote, bottom 5 demote
--   (learners with 0 XP that week also demote), then the week closes.

create extension if not exists pg_cron with schema pg_catalog;

-- ── Tiers ───────────────────────────────────────────────────────────────────
create or replace function public.league_tiers()
returns text[] language sql immutable as $$
  select array['bronze','silver','gold','sapphire','ruby','emerald','amethyst','pearl','obsidian','diamond']::text[];
$$;

create or replace function public.league_tier_index(p_tier text)
returns integer language sql immutable as $$
  select coalesce(array_position(public.league_tiers(), p_tier), 1);
$$;

create or replace function public.league_current_week()
returns date language sql stable as $$
  select date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.xp_events (
  id bigserial primary key,
  user_id uuid not null,
  delta integer not null check (delta <> 0),
  source text not null default 'user_stats',
  created_at timestamptz not null default now()
);
create index if not exists xp_events_user_time_idx on public.xp_events (user_id, created_at desc);

create table if not exists public.league_weeks (
  week_start date primary key,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz
);

create table if not exists public.league_cohorts (
  id uuid primary key default gen_random_uuid(),
  week_start date not null references public.league_weeks(week_start) on delete cascade,
  tier text not null check (tier = any (public.league_tiers())),
  member_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists league_cohorts_open_idx on public.league_cohorts (week_start, tier, member_count);

create table if not exists public.league_members (
  week_start date not null references public.league_weeks(week_start) on delete cascade,
  user_id uuid not null,
  cohort_id uuid not null references public.league_cohorts(id) on delete cascade,
  tier text not null,
  weekly_xp integer not null default 0,
  joined_at timestamptz not null default now(),
  final_rank integer,
  outcome text check (outcome in ('promoted', 'stayed', 'demoted')),
  primary key (week_start, user_id)
);
create index if not exists league_members_cohort_idx on public.league_members (cohort_id, weekly_xp desc);

create table if not exists public.user_league_state (
  user_id uuid primary key,
  tier text not null default 'bronze' check (tier = any (public.league_tiers())),
  best_tier text not null default 'bronze',
  weeks_played integer not null default 0,
  last_outcome text,
  last_week date,
  updated_at timestamptz not null default now()
);

alter table public.xp_events enable row level security;
alter table public.league_weeks enable row level security;
alter table public.league_cohorts enable row level security;
alter table public.league_members enable row level security;
alter table public.user_league_state enable row level security;

drop policy if exists "own xp events" on public.xp_events;
create policy "own xp events" on public.xp_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "own league state" on public.user_league_state;
create policy "own league state" on public.user_league_state for select to authenticated using (user_id = auth.uid());
-- Cohort tables are read through get_my_league() (security definer) only.

-- ── Join + add XP ───────────────────────────────────────────────────────────
create or replace function public.league_join(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := public.league_current_week();
  v_tier text;
  v_cohort uuid;
begin
  select cohort_id into v_cohort from league_members where week_start = v_week and user_id = p_user_id;
  if v_cohort is not null then return v_cohort; end if;

  insert into league_weeks (week_start) values (v_week) on conflict do nothing;
  insert into user_league_state (user_id) values (p_user_id) on conflict do nothing;
  select tier into v_tier from user_league_state where user_id = p_user_id;

  -- Fill the oldest open cohort of this tier first; lock it so two joins can't overfill.
  select id into v_cohort
    from league_cohorts
    where week_start = v_week and tier = v_tier and member_count < 30
    order by created_at
    limit 1
    for update skip locked;
  if v_cohort is null then
    insert into league_cohorts (week_start, tier) values (v_week, v_tier) returning id into v_cohort;
  end if;

  insert into league_members (week_start, user_id, cohort_id, tier)
    values (v_week, p_user_id, v_cohort, v_tier)
    on conflict (week_start, user_id) do nothing;
  if found then
    update league_cohorts set member_count = member_count + 1 where id = v_cohort;
  else
    select cohort_id into v_cohort from league_members where week_start = v_week and user_id = p_user_id;
  end if;
  return v_cohort;
end;
$$;

create or replace function public.league_add_xp(p_user_id uuid, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := public.league_current_week();
begin
  if p_delta is null or p_delta <= 0 then return; end if;
  perform public.league_join(p_user_id);
  update league_members set weekly_xp = weekly_xp + p_delta
    where week_start = v_week and user_id = p_user_id;
end;
$$;

revoke execute on function public.league_join(uuid) from public, anon, authenticated;
revoke execute on function public.league_add_xp(uuid, integer) from public, anon, authenticated;

-- ── Trigger: every total_xp increase becomes an xp_event + league XP ──────────
create or replace function public.track_xp_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer := coalesce(new.total_xp, 0) - coalesce(case when tg_op = 'UPDATE' then old.total_xp end, 0);
begin
  if v_delta <> 0 then
    insert into xp_events (user_id, delta) values (new.user_id, v_delta);
    if v_delta > 0 then
      perform public.league_add_xp(new.user_id, v_delta);
    end if;
  end if;
  return new;
exception when others then
  -- Leagues must never block an XP award.
  raise warning 'track_xp_event failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists track_xp_event_upd on public.user_stats;
create trigger track_xp_event_upd
  after update of total_xp on public.user_stats
  for each row when (new.total_xp is distinct from old.total_xp)
  execute function public.track_xp_event();

drop trigger if exists track_xp_event_ins on public.user_stats;
create trigger track_xp_event_ins
  after insert on public.user_stats
  for each row when (coalesce(new.total_xp, 0) > 0)
  execute function public.track_xp_event();

-- ── Read: my cohort ─────────────────────────────────────────────────────────
create or replace function public.get_my_league()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_week date := public.league_current_week();
  v_cohort uuid;
  v_state record;
  v_members jsonb;
  v_tier_idx integer;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_state from user_league_state where user_id = v_uid;
  select cohort_id into v_cohort from league_members where week_start = v_week and user_id = v_uid;
  v_tier_idx := public.league_tier_index(coalesce(v_state.tier, 'bronze'));

  if v_cohort is not null then
    select coalesce(jsonb_agg(row_to_json(t) order by t.rank), '[]'::jsonb) into v_members from (
      select
        m.user_id,
        rank() over (order by m.weekly_xp desc, m.joined_at asc) as rank,
        m.weekly_xp,
        coalesce(nullif(p.full_name, ''), 'Learner') as name,
        p.avatar_url,
        p.state,
        (m.user_id = v_uid) as is_me
      from league_members m
      left join user_profiles p on p.id = m.user_id
      where m.cohort_id = v_cohort
    ) t;
  end if;

  return jsonb_build_object(
    'week_start', v_week,
    'week_ends_at', ((v_week + 7)::timestamp at time zone 'Asia/Kolkata'),
    'tier', coalesce(v_state.tier, 'bronze'),
    'tier_index', v_tier_idx,
    'tiers', to_jsonb(public.league_tiers()),
    'best_tier', coalesce(v_state.best_tier, 'bronze'),
    'last_outcome', v_state.last_outcome,
    'joined', v_cohort is not null,
    'promote_count', case when v_tier_idx >= array_length(public.league_tiers(), 1) then 0 else 7 end,
    'demote_count', case when v_tier_idx <= 1 then 0 else 5 end,
    'members', coalesce(v_members, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_my_league() to authenticated;

-- ── Weekly rollover ─────────────────────────────────────────────────────────
create or replace function public.league_rollover()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week record;
  v_closed integer := 0;
  v_max integer := array_length(public.league_tiers(), 1);
begin
  for v_week in
    select week_start from league_weeks
    where status = 'open' and week_start < public.league_current_week()
    order by week_start
    for update
  loop
    -- Rank inside each cohort, then decide outcomes.
    with ranked as (
      select m.week_start, m.user_id, m.tier, m.weekly_xp,
             rank() over (partition by m.cohort_id order by m.weekly_xp desc, m.joined_at asc) as rnk,
             count(*) over (partition by m.cohort_id) as size
      from league_members m
      where m.week_start = v_week.week_start
    )
    update league_members m set
      final_rank = r.rnk,
      outcome = case
        when public.league_tier_index(r.tier) < v_max and r.rnk <= 7 and r.weekly_xp > 0 then 'promoted'
        when public.league_tier_index(r.tier) > 1 and (r.weekly_xp = 0 or (r.size > 10 and r.rnk > r.size - 5)) then 'demoted'
        else 'stayed'
      end
    from ranked r
    where m.week_start = r.week_start and m.user_id = r.user_id;

    update user_league_state s set
      tier = (public.league_tiers())[
        greatest(1, least(v_max, public.league_tier_index(m.tier)
          + case m.outcome when 'promoted' then 1 when 'demoted' then -1 else 0 end))],
      weeks_played = s.weeks_played + 1,
      last_outcome = m.outcome,
      last_week = m.week_start,
      updated_at = now()
    from league_members m
    where m.week_start = v_week.week_start and m.user_id = s.user_id;

    update user_league_state set best_tier = tier
      where public.league_tier_index(tier) > public.league_tier_index(best_tier);

    update league_weeks set status = 'closed', closed_at = now() where week_start = v_week.week_start;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

revoke execute on function public.league_rollover() from public, anon, authenticated;

-- Monday 00:05 IST = Sunday 18:35 UTC. Re-runnable: unschedule first.
do $$
begin
  perform cron.unschedule('league-weekly-rollover');
exception when others then null;
end $$;
select cron.schedule('league-weekly-rollover', '35 18 * * 0', $$select public.league_rollover();$$);

-- Keep the ledger small: drop raw XP events older than 120 days.
do $$
begin
  perform cron.unschedule('xp-events-retention');
exception when others then null;
end $$;
select cron.schedule('xp-events-retention', '15 19 * * 0', $$delete from public.xp_events where created_at < now() - interval '120 days';$$);
