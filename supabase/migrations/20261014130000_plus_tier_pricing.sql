-- New pricing tiers (Oct 2026): Free, Plus, Pro (+ exam-week pass = 7-day Pro).
-- Adds a 'plus' subscription tier between free and pro:
--   * subscription_tier enum gains 'plus'
--   * ai_feature_limit gets Plus limits (free and pro values unchanged)
--   * sync_revenuecat_subscription maps the RevenueCat 'plus' entitlement to tier 'plus'
-- RevenueCat entitlements expected: 'plus' and 'pro' (see docs/pricing-2026.md).

alter type public.subscription_tier add value if not exists 'plus';

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

  if p_tier = 'plus' then
    return case p_feature
      when 'miga_message' then 60
      when 'miga_call' then 30
      when 'study_lab_generation' then 20
      when 'study_lab_podcast' then 1
      when 'blueprint_generate' then 6
      when 'quiz_room_generate' then 4
      when 'quiz_sprint_generate' then 12
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

create or replace function public.sync_revenuecat_subscription(
  p_user_id uuid,
  p_is_active boolean,
  p_entitlement_id text,
  p_expires_at timestamptz,
  p_product_id text,
  p_revenuecat_app_user_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := case
    when not p_is_active then 'free'
    when coalesce(p_entitlement_id, 'pro') = 'plus' then 'plus'
    else 'pro'
  end;
  v_purchase_token text := 'revenuecat:' || p_revenuecat_app_user_id || ':' || coalesce(p_entitlement_id, 'pro');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only server-side RevenueCat verification can sync subscriptions';
  end if;

  perform set_config('app.trusted_context', 'true', true);

  update public.user_profiles
    set subscription_tier = v_tier::subscription_tier,
        premium_expires_at = case when p_is_active then p_expires_at else null end,
        last_payment_date = case when p_is_active then now() else last_payment_date end,
        updated_at = now()
    where id = p_user_id;

  perform set_config('app.trusted_context', 'false', true);

  if p_is_active then
    insert into public.verified_purchases (
      user_id,
      purchase_token,
      product_id,
      order_id,
      purchase_state,
      expires_at
    )
    values (
      p_user_id,
      v_purchase_token,
      coalesce(p_product_id, 'revenuecat_subscription'),
      p_revenuecat_app_user_id,
      1,
      p_expires_at
    )
    on conflict (purchase_token) do update
      set product_id = excluded.product_id,
          order_id = excluded.order_id,
          purchase_state = excluded.purchase_state,
          expires_at = excluded.expires_at,
          verified_at = now();
  end if;

  insert into public.user_transactions (user_id, amount, currency_type, transaction_type, metadata)
  values (
    p_user_id,
    0,
    'mg',
    'subscription_' || v_tier,
    jsonb_build_object(
      'provider', 'revenuecat',
      'entitlement_id', p_entitlement_id,
      'product_id', p_product_id,
      'expires_at', p_expires_at,
      'active', p_is_active
    )
  );

  return jsonb_build_object(
    'success', true,
    'tier', v_tier,
    'expires_at', p_expires_at,
    'product_id', p_product_id
  );
end;
$$;

revoke execute on function public.sync_revenuecat_subscription(uuid, boolean, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.sync_revenuecat_subscription(uuid, boolean, text, timestamptz, text, text) to service_role;
