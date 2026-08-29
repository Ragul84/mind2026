-- Additive verified-textbook provenance catalog.
-- This migration intentionally does not alter textbook_chunks, embeddings, or
-- retrieval RPCs. source_id is the operational bridge from retrieved chunks.

create table if not exists public.textbook_source_documents (
  source_id text primary key,
  board text,
  class_level integer,
  subject text,
  language text,
  book_title text,
  volume_or_part text,
  term text,
  document_scope text,
  official_source_url text,
  verification_status text not null default 'unverified',
  field_provenance jsonb not null default '{}'::jsonb,
  metadata_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint textbook_source_documents_scope_check
    check (document_scope is null or document_scope in ('chapter_pdf', 'full_book', 'term_book', 'volume_book', 'unknown')),
  constraint textbook_source_documents_verification_check
    check (verification_status in ('verified_official', 'verified_ingestion_manifest', 'existing_curated_mapping', 'derived_source_id', 'derived_content', 'unverified'))
);

create table if not exists public.textbook_source_chapters (
  chapter_id uuid primary key default gen_random_uuid(),
  source_id text not null references public.textbook_source_documents(source_id) on delete cascade,
  chapter_key text not null,
  chapter_number text,
  chapter_title text,
  unit_number text,
  unit_title text,
  page_start integer,
  page_end integer,
  verification_status text not null default 'unverified',
  field_provenance jsonb not null default '{}'::jsonb,
  metadata_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint textbook_source_chapters_unique_key unique (source_id, chapter_key),
  constraint textbook_source_chapters_page_range_check check (page_start is null or page_end is null or page_start <= page_end),
  constraint textbook_source_chapters_verification_check
    check (verification_status in ('verified_official', 'verified_ingestion_manifest', 'existing_curated_mapping', 'derived_source_id', 'derived_content', 'unverified'))
);

-- Empty in Stage 1. NCERT source documents are chapter PDFs, so source_id is
-- sufficient. This table is reserved for later multi-lesson sources (Samacheer).
create table if not exists public.textbook_chunk_provenance (
  chunk_id text primary key,
  chapter_id uuid not null references public.textbook_source_chapters(chapter_id) on delete cascade,
  page_start integer,
  page_end integer,
  verification_status text not null default 'unverified',
  field_provenance jsonb not null default '{}'::jsonb,
  metadata_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint textbook_chunk_provenance_page_range_check check (page_start is null or page_end is null or page_start <= page_end),
  constraint textbook_chunk_provenance_verification_check
    check (verification_status in ('verified_official', 'verified_ingestion_manifest', 'existing_curated_mapping', 'derived_source_id', 'derived_content', 'unverified'))
);

create index if not exists idx_textbook_source_documents_catalog_lookup
  on public.textbook_source_documents (board, class_level, subject, language);
create index if not exists idx_textbook_source_chapters_source
  on public.textbook_source_chapters (source_id);
create index if not exists idx_textbook_chunk_provenance_chapter
  on public.textbook_chunk_provenance (chapter_id);

alter table public.textbook_source_documents enable row level security;
alter table public.textbook_source_chapters enable row level security;
alter table public.textbook_chunk_provenance enable row level security;

-- Catalog data is service-managed. No public client policy is added because this
-- Stage 1 catalog is not yet exposed to MIGA or any client surface.
