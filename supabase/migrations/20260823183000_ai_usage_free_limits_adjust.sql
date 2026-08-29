-- Rebalance free-tier AI limits for cost management:
-- - miga_message (chat, cheap text-only calls): 10/day -> 20/day, better free UX.
-- - miga_call (voice replies, the app's only unbounded per-turn cost): 20/day -> 10/day.
-- Pro limits and every other feature are unchanged.

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
      else 0
    end;
  end if;

  return case p_feature
    when 'miga_message' then 20
    when 'miga_call' then 10
    when 'study_lab_generation' then 2
    when 'study_lab_podcast' then 0
    when 'blueprint_generate' then 2
    when 'quiz_room_generate' then 1
    else 0
  end;
end;
$$;

grant execute on function public.ai_feature_limit(text, text) to authenticated, service_role;
