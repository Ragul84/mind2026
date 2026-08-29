-- Release lockdown for paid entitlements and leaderboard currency.
-- Client roles must not be able to grant XP/MG or Pro directly.

revoke execute on function public.award_user_rewards(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.award_user_rewards(uuid, integer, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.activate_premium(uuid, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.award_user_rewards(uuid, integer, text, jsonb) to service_role;
grant execute on function public.award_user_rewards(uuid, integer, integer, text, jsonb) to service_role;
grant execute on function public.activate_premium(uuid, text, timestamptz, text) to service_role;

create or replace function public.activate_pro_subscription(
  p_user_id uuid,
  p_expires_at timestamptz,
  p_provider text,
  p_purchase_token text,
  p_product_id text,
  p_order_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only server-side purchase verification can activate Pro';
  end if;

  perform set_config('app.trusted_context', 'true', true);

  update public.user_profiles
    set subscription_tier = 'pro',
        premium_expires_at = p_expires_at,
        last_payment_date = now(),
        updated_at = now()
    where id = p_user_id;

  perform set_config('app.trusted_context', 'false', true);

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
    p_purchase_token,
    p_product_id,
    p_order_id,
    1,
    p_expires_at
  )
  on conflict (purchase_token) do update
    set expires_at = excluded.expires_at,
        verified_at = now();

  insert into public.user_transactions (user_id, amount, currency_type, transaction_type, metadata)
  values (
    p_user_id,
    0,
    'mg',
    'subscription_pro',
    jsonb_build_object(
      'tier', 'pro',
      'provider', p_provider,
      'product_id', p_product_id,
      'order_id', p_order_id,
      'expires_at', p_expires_at
    )
  );
end;
$$;

revoke execute on function public.activate_pro_subscription(uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.activate_pro_subscription(uuid, timestamptz, text, text, text, text) to service_role;

create or replace function public.guard_user_stats_sensitive_columns()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_setting('app.trusted_context', true) is distinct from 'true' then
    if new.total_xp is distinct from old.total_xp then
      raise exception 'Direct user_stats total_xp modification blocked.';
    end if;
    if new.subscription_tier is distinct from old.subscription_tier then
      raise exception 'Direct user_stats subscription_tier modification blocked.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_user_stats_sensitive_cols on public.user_stats;
create trigger guard_user_stats_sensitive_cols
  before update on public.user_stats
  for each row
  execute function public.guard_user_stats_sensitive_columns();
