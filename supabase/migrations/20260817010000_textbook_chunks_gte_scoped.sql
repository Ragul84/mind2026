-- Additive board-scoped textbook matcher.
-- This preserves the existing 3-argument matcher for backwards compatibility
-- and adds a 4-argument overload that can scope candidate retrieval by board
-- before ranking.

drop function if exists public.match_textbook_chunks_gte(vector(384), integer, text, text);

create function public.match_textbook_chunks_gte(
  query_embedding vector(384),
  match_count integer,
  filter_language text,
  filter_board text default null
)
returns table (
  id text,
  source_id text,
  board text,
  class_level integer,
  subject text,
  chapter text,
  language text,
  chunk_type text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id,
    c.source_id,
    c.board,
    c.class_level,
    c.subject,
    c.chapter,
    c.language,
    c.chunk_type,
    c.content,
    1 - (c.embedding_gte <=> query_embedding) as similarity
  from public.textbook_chunks as c
  where c.embedding_gte is not null
    and (filter_language is null or c.language = filter_language)
    and (filter_board is null or c.board = filter_board)
  order by c.embedding_gte <=> query_embedding asc, c.id asc
  limit greatest(coalesce(match_count, 6), 1);
$$;
