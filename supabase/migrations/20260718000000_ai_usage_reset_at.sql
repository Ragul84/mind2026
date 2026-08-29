-- Return the exact daily-reset instant from check_and_consume_ai_usage.
--
-- The client needs to show "resets in Xh" without knowing the DB's timezone.
-- current_date rolls over at midnight in the server's timezone, so
-- (current_date + 1)::timestamptz is precisely the next reset moment as an
-- absolute instant (serialized to the client as UTC). The client just counts
-- down to it. Only adds a 'reset_at' field; all limits/logic are unchanged.

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
    'date', v_today,
    'reset_at', (v_today + 1)::timestamptz
  );
end;
$$;

grant execute on function public.check_and_consume_ai_usage(uuid, text, boolean) to authenticated, service_role;
