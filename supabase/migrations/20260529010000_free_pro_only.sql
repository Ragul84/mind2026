update public.user_profiles
set subscription_tier = 'pro'
where subscription_tier::text = 'premium';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_stats'
      and column_name = 'subscription_tier'
  ) then
    update public.user_stats
    set subscription_tier = 'pro'
    where subscription_tier::text = 'premium';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_subscription_tier_free_pro_only'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_subscription_tier_free_pro_only
      check (subscription_tier::text in ('free', 'pro'));
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_stats'
      and column_name = 'subscription_tier'
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'user_stats_subscription_tier_free_pro_only'
  ) then
    alter table public.user_stats
      add constraint user_stats_subscription_tier_free_pro_only
      check (subscription_tier::text in ('free', 'pro'));
  end if;
end $$;
