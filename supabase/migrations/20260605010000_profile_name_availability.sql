-- Profile name availability helper used during onboarding

create or replace function public.is_profile_name_available(
  p_full_name text,
  p_exclude_user_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.user_profiles up
    where lower(trim(coalesce(up.full_name, ''))) = lower(trim(coalesce(p_full_name, '')))
      and (p_exclude_user_id is null or up.id <> p_exclude_user_id)
  );
$$;

revoke all on function public.is_profile_name_available(text, uuid) from public;
grant execute on function public.is_profile_name_available(text, uuid) to authenticated;

create index if not exists idx_user_profiles_full_name_normalized
  on public.user_profiles (lower(trim(coalesce(full_name, ''))));
