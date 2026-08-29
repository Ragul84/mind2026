-- Global rank by lifetime XP. RLS hides other users' rows from the client, so the
-- rank can't be counted client-side; this SECURITY DEFINER function does it
-- server-side. Rank = (number of users with more XP) + 1.

create or replace function public.get_user_global_rank(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    count(*) + 1
  )::int
  from public.user_profiles
  where coalesce(total_xp, 0) > (
    select coalesce(total_xp, 0) from public.user_profiles where id = p_user_id
  );
$$;

grant execute on function public.get_user_global_rank(uuid) to authenticated, service_role;
