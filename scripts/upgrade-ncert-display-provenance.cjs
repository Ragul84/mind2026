/*
 * Upgrades only the display fields already established by the completed
 * Stage 1.5 official NCERT mapping.  It never parses a source_id to create
 * metadata and never touches textbook_chunks or retrieval tables.
 */
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const OFFICIAL = 'verified_official';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');
const supabase = createClient(url, key);

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).eq('board', 'ncert').order('source_id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function main() {
  const documents = await fetchAll('textbook_source_documents', 'source_id,board,class_level,subject,language,book_title,volume_or_part,official_source_url,verification_status,field_provenance,metadata_source');
  const { data: chapters, error: chaptersError } = await supabase
    .from('textbook_source_chapters')
    .select('source_id,chapter_number,chapter_title,field_provenance,verification_status');
  if (chaptersError) throw chaptersError;
  const officialChapterBySource = new Set((chapters || []).filter((row) =>
    row.field_provenance?.chapter_number === OFFICIAL && row.field_provenance?.chapter_title === OFFICIAL,
  ).map((row) => row.source_id));

  const rows = documents.filter((doc) => (
    officialChapterBySource.has(doc.source_id)
    && doc.field_provenance?.book_title === OFFICIAL
    && doc.field_provenance?.language === OFFICIAL
    && doc.field_provenance?.official_source_url === OFFICIAL
    && doc.metadata_source?.official_ncert_catalogue
    && doc.metadata_source?.official_chapter_pdf
    && /^https:\/\/ncert\.nic\.in\/textbook\/pdf\//i.test(doc.official_source_url || '')
  )).map((doc) => ({
    ...doc,
    board: 'ncert',
    field_provenance: {
      ...doc.field_provenance,
      // Stage 1.5 accepted this document only after its official NCERT catalogue
      // book (class + subject) and official chapter PDF both matched.
      board: OFFICIAL,
      class_level: OFFICIAL,
      subject: OFFICIAL,
      document_scope: OFFICIAL,
    },
    updated_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await supabase.from('textbook_source_documents').upsert(rows, { onConflict: 'source_id' });
    if (error) throw error;
  }
  console.log(JSON.stringify({
    documents_examined: documents.length,
    display_fields_upgraded: rows.length,
    fields: ['board', 'class_level', 'subject', 'document_scope'],
    untouched_documents: documents.length - rows.length,
  }, null, 2));
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
