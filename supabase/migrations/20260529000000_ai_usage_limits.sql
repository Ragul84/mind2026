create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  feature text not null,
  used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature)
);

alter table public.ai_usage_daily enable row level security;

drop policy if exists "Users can read own ai usage" on public.ai_usage_daily;
create policy "Users can read own ai usage"
on public.ai_usage_daily
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.ai_feature_limit(p_tier text, p_feature text)
returns integer
language plpgsql
stable
as $$
begin
  if p_tier = 'pro' then
    return case p_feature
      when 'miga_message' then 150
      when 'study_lab_generation' then 50
      when 'study_lab_podcast' then 5
      when 'blueprint_generate' then 15
      when 'quiz_room_generate' then 10
      else 0
    end;
  end if;

  return case p_feature
    when 'miga_message' then 10
    when 'study_lab_generation' then 2
    when 'study_lab_podcast' then 0
    when 'blueprint_generate' then 2
    when 'quiz_room_generate' then 1
    else 0
  end;
end;
$$;

create or replace function public.check_and_consume_ai_usage(
  p_user_id uuid,
  p_feature text,
  p_consume boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_limit integer;
  v_used integer;
  v_today date := current_date;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'AI usage can only be checked for the current user';
  end if;

  if p_feature not in (
    'miga_message',
    'study_lab_generation',
    'study_lab_podcast',
    'blueprint_generate',
    'quiz_room_generate'
  ) then
    raise exception 'Unknown AI usage feature: %', p_feature;
  end if;

  select coalesce(subscription_tier, 'free')
    into v_tier
  from public.user_profiles
  where id = p_user_id;

  v_tier := case
    when v_tier in ('pro', 'pro_monthly', 'pro_annual') then 'pro'
    else 'free'
  end;

  v_limit := public.ai_feature_limit(v_tier, p_feature);

  insert into public.ai_usage_daily (user_id, usage_date, feature, used)
  values (p_user_id, v_today, p_feature, 0)
  on conflict (user_id, usage_date, feature) do nothing;

  select used
    into v_used
  from public.ai_usage_daily
  where user_id = p_user_id
    and usage_date = v_today
    and feature = p_feature
  for update;

  if p_consume and v_used < v_limit then
    v_used := v_used + 1;
    update public.ai_usage_daily
      set used = v_used,
          updated_at = now()
    where user_id = p_user_id
      and usage_date = v_today
      and feature = p_feature;
  end if;

  return jsonb_build_object(
    'feature', p_feature,
    'tier', v_tier,
    'used', v_used,
    'limit', v_limit,
    'remaining', greatest(v_limit - v_used, 0),
    'allowed', v_used < v_limit,
    'date', v_today
  );
end;
$$;

grant execute on function public.ai_feature_limit(text, text) to authenticated, service_role;
grant execute on function public.check_and_consume_ai_usage(uuid, text, boolean) to authenticated, service_role;
