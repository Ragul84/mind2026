delete from public.user_push_tokens older
using public.user_push_tokens newer
where older.push_token = newer.push_token
  and (
    older.updated_at < newer.updated_at
    or (older.updated_at = newer.updated_at and older.id::text < newer.id::text)
  );

create unique index if not exists user_push_tokens_push_token_unique
  on public.user_push_tokens (push_token);

alter table public.user_push_tokens
  add column if not exists current_affairs_enabled boolean not null default true;

alter table public.current_affairs_daily_sets
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_success_count integer not null default 0,
  add column if not exists push_failure_count integer not null default 0;
