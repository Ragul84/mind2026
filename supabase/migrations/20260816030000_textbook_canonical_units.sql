-- Additive canonical-unit support. Existing chapter_* fields remain for
-- backwards compatibility; canonical fields preserve NCERT's own labels.
alter table public.textbook_source_chapters
  add column if not exists document_ordinal integer,
  add column if not exists pdf_printed_unit_type text,
  add column if not exists pdf_printed_unit_number text,
  add column if not exists canonical_unit_type text,
  add column if not exists canonical_unit_number text,
  add column if not exists canonical_unit_title text;

alter table public.textbook_source_chapters
  add constraint textbook_source_chapters_document_ordinal_positive
  check (document_ordinal is null or document_ordinal > 0) not valid;

alter table public.textbook_source_chapters
  add constraint textbook_source_chapters_canonical_unit_type_check
  check (canonical_unit_type is null or canonical_unit_type in ('chapter', 'theme', 'unit', 'lesson', 'other')) not valid;

create index if not exists idx_textbook_source_chapters_canonical_unit
  on public.textbook_source_chapters (source_id, canonical_unit_type, canonical_unit_number);
