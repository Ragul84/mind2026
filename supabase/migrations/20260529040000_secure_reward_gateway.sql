create table if not exists public.secure_reward_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_key text not null,
  amount integer not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, claim_key)
);

alter table public.secure_reward_claims enable row level security;

drop policy if exists "Users can read own secure reward claims" on public.secure_reward_claims;
create policy "Users can read own secure reward claims"
on public.secure_reward_claims
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.secure_adjust_user_balance(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_claim_key text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.secure_reward_claims%rowtype;
  v_new_total integer;
  v_current_total integer;
  v_level integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only server-side reward verification can adjust balance';
  end if;

  if p_amount = 0 then
    raise exception 'Reward amount cannot be zero';
  end if;

  select *
    into v_existing
  from public.secure_reward_claims
  where user_id = p_user_id
    and claim_key = p_claim_key;

  if found then
    select coalesce(total_xp, 0)
      into v_new_total
    from public.user_profiles
    where id = p_user_id;

    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'total_xp', coalesce(v_new_total, 0),
      'amount', v_existing.amount,
      'reason', v_existing.reason
    );
  end if;

  select coalesce(total_xp, 0)
    into v_current_total
  from public.user_profiles
  where id = p_user_id
  for update;

  if p_amount < 0 and coalesce(v_current_total, 0) + p_amount < 0 then
    raise exception 'Insufficient balance';
  end if;

  perform set_config('app.trusted_context', 'true', true);

  update public.user_profiles
    set total_xp = coalesce(total_xp, 0) + p_amount,
        updated_at = now()
    where id = p_user_id
    returning total_xp into v_new_total;

  if v_new_total is null then
    insert into public.user_profiles (id, total_xp)
    values (p_user_id, greatest(p_amount, 0))
    on conflict (id) do update
      set total_xp = public.user_profiles.total_xp + p_amount,
          updated_at = now()
    returning total_xp into v_new_total;
  end if;

  v_level := floor(sqrt(greatest(v_new_total, 0) / 100.0)) + 1;

  insert into public.user_stats (
    user_id,
    total_xp,
    current_level,
    last_activity_date,
    updated_at
  )
  values (
    p_user_id,
    v_new_total,
    v_level,
    current_date,
    now()
  )
  on conflict (user_id) do update
    set total_xp = excluded.total_xp,
        current_level = excluded.current_level,
        last_activity_date = excluded.last_activity_date,
        updated_at = now();

  perform set_config('app.trusted_context', 'false', true);

  insert into public.secure_reward_claims (user_id, claim_key, amount, reason, metadata)
  values (p_user_id, p_claim_key, p_amount, p_reason, p_metadata);

  insert into public.user_transactions (user_id, amount, currency_type, transaction_type, metadata)
  values (p_user_id, p_amount, 'xp', p_reason, p_metadata);

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'total_xp', v_new_total,
    'amount', p_amount,
    'reason', p_reason
  );
end;
$$;

revoke execute on function public.secure_adjust_user_balance(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.secure_adjust_user_balance(uuid, integer, text, text, jsonb) to service_role;
