-- Textbook-aware AI: page-level textbook corpus with pgvector retrieval.
-- Additive. Does not touch the legacy textbook_chunks / textbook_source_* tables;
-- those keep serving the existing miga_stream evidence cards. The new tables add
-- what the legacy corpus lacks: a page number on every chunk, so every answer can
-- cite book -> chapter -> page.
--
-- Embeddings: gte-small (384 dims), the model built into the Supabase Edge
-- runtime (Supabase.ai.Session('gte-small')), so ingestion and query embedding
-- cost nothing and stay in the same vector space as the legacy corpus.

create extension if not exists vector;

create table if not exists public.textbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- e.g. ncert-10-science-en
  board text not null,                       -- 'ncert' | 'samacheer' | 'cbse' | 'maharashtra' | ...
  board_type text not null default 'ncert',  -- 'ncert' | 'state'
  state_code text,                           -- 'TN', 'MH', ... when board_type = 'state'
  class_level integer not null check (class_level between 1 and 12),
  subject text not null,                     -- normalised lower-case: 'science', 'history', ...
  language text not null default 'english',  -- 'english' | 'hindi' | 'tamil' | ...
  title text not null,
  edition text,
  publisher text,
  source_url text,
  page_count integer,
  status text not null default 'pending' check (status in ('pending', 'ingesting', 'ready', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint textbooks_board_type_check check (board_type in ('ncert', 'state'))
);

create index if not exists textbooks_scope_idx
  on public.textbooks (board, class_level, subject, language);

create table if not exists public.textbook_chapters (
  id uuid primary key default gen_random_uuid(),
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  page_start integer,
  page_end integer,
  created_at timestamptz not null default now(),
  constraint textbook_chapters_unique unique (textbook_id, chapter_number),
  constraint textbook_chapters_pages check (page_start is null or page_end is null or page_start <= page_end)
);

create table if not exists public.textbook_page_chunks (
  id uuid primary key default gen_random_uuid(),
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  chapter_id uuid references public.textbook_chapters(id) on delete set null,
  page_number integer not null,              -- printed page number when known, else PDF page index (1-based)
  chunk_index integer not null default 0,    -- position within the page
  content text not null,
  token_estimate integer,
  embedding vector(384),
  -- Denormalised scope so retrieval filters without joins.
  board text not null,
  class_level integer not null,
  subject text not null,
  language text not null,
  created_at timestamptz not null default now(),
  constraint textbook_page_chunks_unique unique (textbook_id, page_number, chunk_index)
);

create index if not exists textbook_page_chunks_scope_idx
  on public.textbook_page_chunks (board, class_level, subject, language);
create index if not exists textbook_page_chunks_embedding_hnsw
  on public.textbook_page_chunks using hnsw (embedding vector_cosine_ops);

-- Read-only for signed-in students; writes only via service role (ingest function).
alter table public.textbooks enable row level security;
alter table public.textbook_chapters enable row level security;
alter table public.textbook_page_chunks enable row level security;

drop policy if exists "textbooks readable" on public.textbooks;
create policy "textbooks readable" on public.textbooks for select to authenticated using (true);
drop policy if exists "textbook chapters readable" on public.textbook_chapters;
create policy "textbook chapters readable" on public.textbook_chapters for select to authenticated using (true);
drop policy if exists "textbook page chunks readable" on public.textbook_page_chunks;
create policy "textbook page chunks readable" on public.textbook_page_chunks for select to authenticated using (true);

-- Scoped semantic retrieval with citation fields.
create or replace function public.match_textbook_pages(
  query_embedding vector(384),
  match_count integer default 6,
  filter_board text default null,
  filter_class integer default null,
  filter_subject text default null,
  filter_language text default null,
  min_similarity double precision default 0.75
)
returns table (
  chunk_id uuid,
  textbook_id uuid,
  book_title text,
  board text,
  class_level integer,
  subject text,
  language text,
  chapter_number integer,
  chapter_title text,
  page_number integer,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id, c.textbook_id, b.title, c.board, c.class_level, c.subject, c.language,
    ch.chapter_number, ch.title, c.page_number, c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.textbook_page_chunks c
  join public.textbooks b on b.id = c.textbook_id and b.status = 'ready'
  left join public.textbook_chapters ch on ch.id = c.chapter_id
  where c.embedding is not null
    and (filter_board is null or c.board = filter_board)
    and (filter_class is null or c.class_level = filter_class)
    and (filter_subject is null or c.subject = filter_subject)
    and (filter_language is null or c.language = filter_language)
    and 1 - (c.embedding <=> query_embedding) >= coalesce(min_similarity, 0)
  order by c.embedding <=> query_embedding asc
  limit least(greatest(coalesce(match_count, 6), 1), 20);
$$;

grant execute on function public.match_textbook_pages(vector, integer, text, integer, text, text, double precision) to authenticated, service_role;

-- Student's own textbook scope (picked during profile setup / in MIGA).
alter table public.user_profiles add column if not exists textbook_board text;
alter table public.user_profiles add column if not exists textbook_class integer;
alter table public.user_profiles add column if not exists textbook_language text;
