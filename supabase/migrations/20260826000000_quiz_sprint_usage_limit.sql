-- Add a daily usage limit for weak-area sprint generation (quiz_sprint_generate).
--
-- Weak-Area Sprint (services/weakAreasService.ts generateSprint -> the
-- miga_sprint_generate edge function) was completely ungated: no client-side
-- check, no server-side limit, real OpenRouter calls on every sprint. Today a
-- failure (including a would-be limit) is swallowed and the UI silently skips
-- to the next topic with no message at all. This mirrors the existing
-- per-feature gate exactly, adding one feature. Everything else in both
-- functions is unchanged, so re-running is safe and does not alter any
-- existing feature's behaviour.

create or replace function public.ai_feature_limit(p_tier text, p_feature text)
returns integer
language plpgsql
stable
as $$
begin
  if p_tier = 'pro' then
    return case p_feature
      when 'miga_message' then 150
      when 'miga_call' then 200
      when 'study_lab_generation' then 50
      when 'study_lab_podcast' then 5
      when 'blueprint_generate' then 15
      when 'quiz_room_generate' then 10
      when 'quiz_sprint_generate' then 25
      else 0
    end;
  end if;

  return case p_feature
    when 'miga_message' then 10
    when 'miga_call' then 20
    when 'study_lab_generation' then 2
    when 'study_lab_podcast' then 0
    when 'blueprint_generate' then 2
    when 'quiz_room_generate' then 1
    when 'quiz_sprint_generate' then 3
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
    'miga_call',
    'study_lab_generation',
    'study_lab_podcast',
    'blueprint_generate',
    'quiz_room_generate',
    'quiz_sprint_generate'
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
    'date', v_today,
    'reset_at', (v_today + 1)::timestamptz
  );
end;
$$;

grant execute on function public.ai_feature_limit(text, text) to authenticated, service_role;
grant execute on function public.check_and_consume_ai_usage(uuid, text, boolean) to authenticated, service_role;
