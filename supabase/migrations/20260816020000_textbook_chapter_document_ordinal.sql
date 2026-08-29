-- Internal ingestion ordering only. This is deliberately separate from the
-- NCERT-printed canonical chapter number and is never student-facing.
alter table public.textbook_source_chapters
  add column if not exists document_ordinal integer;

alter table public.textbook_source_chapters
  add constraint textbook_source_chapters_document_ordinal_check
  check (document_ordinal is null or document_ordinal > 0) not valid;
