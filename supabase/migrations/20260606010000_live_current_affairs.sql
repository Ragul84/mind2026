create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.current_affairs_articles (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  source_name text not null,
  category text not null,
  title text not null,
  summary text not null default '',
  url text not null unique,
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists current_affairs_articles_published_idx
  on public.current_affairs_articles (published_at desc);

create table if not exists public.current_affairs_daily_sets (
  date_key date primary key,
  status text not null check (status in ('ready', 'failed')),
  questions jsonb not null default '[]'::jsonb,
  question_count integer not null default 0,
  source_count integer not null default 0,
  source_errors jsonb not null default '[]'::jsonb,
  generation_mode text not null default 'openrouter',
  generation_ms integer,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.current_affairs_daily (
  date_key date primary key,
  headline text not null,
  summary text not null default '',
  published_at timestamptz not null,
  tag text not null default 'National',
  source_url text,
  source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.current_affairs_articles enable row level security;
alter table public.current_affairs_daily_sets enable row level security;
alter table public.current_affairs_daily enable row level security;

drop policy if exists "Authenticated users read current affairs articles"
  on public.current_affairs_articles;
create policy "Authenticated users read current affairs articles"
  on public.current_affairs_articles for select
  to authenticated using (true);

drop policy if exists "Authenticated users read current affairs sets"
  on public.current_affairs_daily_sets;
create policy "Authenticated users read current affairs sets"
  on public.current_affairs_daily_sets for select
  to authenticated using (true);

drop policy if exists "Authenticated users read current affairs headlines"
  on public.current_affairs_daily;
create policy "Authenticated users read current affairs headlines"
  on public.current_affairs_daily for select
  to authenticated using (true);

-- 00:15 UTC = 05:45 IST. The Edge Function itself is idempotent and only
-- accepts unauthenticated scheduled calls during the 00:00 UTC hour.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mindgains-current-affairs-0545-ist') then
    perform cron.unschedule('mindgains-current-affairs-0545-ist');
  end if;
end $$;

select cron.schedule(
  'mindgains-current-affairs-0545-ist',
  '15 0 * * *',
  $$
    select net.http_post(
      url := 'https://yuntwerxahgmaoduxvqc.supabase.co/functions/v1/current-affairs-ingest',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"scheduled":true}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
