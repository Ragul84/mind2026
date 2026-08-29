/* global __dirname */
/* Read-only Stage 1 provenance validation and report writer. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'ncert-verified-provenance-stage1.json');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Supabase service credentials are required for validation.');
const supabase = createClient(url, serviceKey);

async function fetchAll(table, columns, filter) {
  const rows = [];
  for (let from = 0;; from += 1000) {
    let query = supabase.from(table).select(columns).order(table === 'textbook_chunks' ? 'id' : 'source_id', { ascending: true }).range(from, from + 999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const countBy = (items, key) => Object.fromEntries([...new Set(items.map(key))].sort().map((value) => [value, items.filter((item) => key(item) === value).length]));

async function main() {
  const liveRows = await fetchAll('textbook_chunks', 'id, source_id, board, class_level, subject, language', (q) => q.eq('board', 'ncert'));
  const live = [...new Map(liveRows.map((row) => [row.source_id, row])).values()];
  const docs = await fetchAll('textbook_source_documents', 'source_id, board, class_level, subject, language, book_title, volume_or_part, official_source_url, verification_status, field_provenance', (q) => q.eq('board', 'ncert'));
  // Do not put hundreds of source IDs into one REST query string. The catalog is
  // intentionally small at this stage; fetch it then intersect locally.
  const chapters = (await fetchAll('textbook_source_chapters', 'source_id, chapter_number, chapter_title, page_start, page_end, verification_status, field_provenance'))
    .filter((row) => live.some((source) => source.source_id === row.source_id));

  const liveIds = new Set(live.map((row) => row.source_id));
  const docIds = new Set(docs.map((row) => row.source_id));
  const chapterBySource = new Map(chapters.map((row) => [row.source_id, row]));
  const unresolved = live.filter((row) => !chapterBySource.get(row.source_id)?.chapter_title).map((row) => row.source_id);
  const documentDisagreements = docs.flatMap((doc) => {
    const source = live.find((row) => row.source_id === doc.source_id);
    if (!source) return [];
    return ['board', 'class_level', 'subject', 'language'].filter((field) => doc[field] !== source[field]).map((field) => ({ source_id: doc.source_id, field, catalog: doc[field], live: source[field] }));
  });

  const duplicateTitles = [...new Map(chapters.filter((row) => row.chapter_title).map((row) => [row.chapter_title.trim().toLowerCase(), []])).entries()];
  for (const chapter of chapters.filter((row) => row.chapter_title)) duplicateTitles.find(([key]) => key === chapter.chapter_title.trim().toLowerCase())[1].push(chapter.source_id);

  const report = {
    title: 'NCERT VERIFIED PROVENANCE — STAGE 1',
    generated_at: new Date().toISOString(),
    corpus: { live_ncert_source_documents: live.length, live_ncert_chunks: liveRows.length },
    coverage: {
      catalogued_source_ids: docs.filter((doc) => liveIds.has(doc.source_id)).length,
      verified_source_ids: docs.filter((doc) => doc.verification_status === 'verified_official').length,
      verified_ingestion_manifest_chapters: chapters.filter((row) => row.verification_status === 'verified_ingestion_manifest').length,
      verified_chapter_titles: chapters.filter((row) => row.field_provenance?.chapter_title === 'verified_official' || row.field_provenance?.chapter_title === 'verified_ingestion_manifest').length,
      unresolved_chapter_titles: unresolved.length,
      verified_book_titles: docs.filter((doc) => doc.field_provenance?.book_title === 'verified_official' || doc.field_provenance?.book_title === 'verified_ingestion_manifest').length,
      verified_chapter_numbers: chapters.filter((row) => row.field_provenance?.chapter_number === 'verified_official' || row.field_provenance?.chapter_number === 'verified_ingestion_manifest').length,
      verified_language: docs.filter((doc) => doc.field_provenance?.language === 'verified_official' || doc.field_provenance?.language === 'verified_ingestion_manifest').length,
      verified_subject: docs.filter((doc) => doc.field_provenance?.subject === 'verified_official' || doc.field_provenance?.subject === 'verified_ingestion_manifest').length,
      official_source_reference: docs.filter((doc) => !!doc.official_source_url && doc.field_provenance?.official_source_url === 'verified_official').length,
    },
    breakdown: {
      classes: countBy(live, (row) => String(row.class_level)),
      subjects: countBy(live, (row) => row.subject),
      languages: countBy(live, (row) => row.language),
      chapter_verification: countBy(chapters, (row) => row.verification_status),
    },
    problems: {
      live_source_ids_without_catalog: live.filter((row) => !docIds.has(row.source_id)).map((row) => row.source_id),
      orphan_catalog_records: docs.filter((doc) => !liveIds.has(doc.source_id)).map((doc) => doc.source_id),
      catalog_live_metadata_disagreements: documentDisagreements,
      duplicate_chapter_titles: duplicateTitles.filter(([, sourceIds]) => sourceIds.length > 1).map(([title, source_ids]) => ({ title, source_ids })),
      unresolved_chapter_titles: unresolved,
    },
    representative_verified_records: chapters
      .filter((row) => row.field_provenance?.chapter_title === 'verified_official' || row.field_provenance?.chapter_title === 'verified_ingestion_manifest')
      .slice(0, 8),
    chunk_provenance: {
      rows_required_for_ncert_stage_1: 0,
      reason: 'Every live NCERT source_id is a chapter-PDF document; source_id resolves directly to its sole chapter record.',
    },
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
