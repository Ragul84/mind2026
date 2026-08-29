-- Make the sensitive-column guard safe across tables that do not have subscription columns.
-- This prevents streak / stats upserts from failing when the trigger is reused on a narrower table.

create or replace function public.guard_sensitive_columns()
returns trigger
language plpgsql
security definer
as $$
declare
  new_row jsonb := coalesce(to_jsonb(new), '{}'::jsonb);
  old_row jsonb := coalesce(to_jsonb(old), '{}'::jsonb);
begin
  if current_setting('app.trusted_context', true) is distinct from 'true' then
    if new_row ? 'total_xp' and old_row ? 'total_xp' and (new_row ->> 'total_xp') is distinct from (old_row ->> 'total_xp') then
      raise exception 'Direct XP modification blocked. Use award_user_rewards() RPC.';
    end if;

    if new_row ? 'subscription_tier' and old_row ? 'subscription_tier' and (new_row ->> 'subscription_tier') is distinct from (old_row ->> 'subscription_tier') then
      raise exception 'Direct subscription_tier change blocked. Use activate_premium() RPC.';
    end if;

    if new_row ? 'gems' and old_row ? 'gems' and (new_row ->> 'gems') is distinct from (old_row ->> 'gems') then
      raise exception 'Direct gems modification blocked.';
    end if;

    if new_row ? 'premium_expires_at' and old_row ? 'premium_expires_at' and (new_row ->> 'premium_expires_at') is distinct from (old_row ->> 'premium_expires_at') then
      raise exception 'Direct premium_expires_at change blocked.';
    end if;
  end if;

  return new;
end;
$$;
