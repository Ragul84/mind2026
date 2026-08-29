alter table public.current_affairs_daily_sets
  add column if not exists generation_mode text not null default 'openrouter';
