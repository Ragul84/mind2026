/* Read-only live validation report for NCERT Stage 1.5. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'ncert-verified-provenance-stage1_5.json');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Supabase service credentials are required.');
const supabase = createClient(url, serviceKey);
const OFFICIAL = 'verified_official';

async function fetchAll(table, columns, apply) {
  const rows = [];
  for (let from = 0;; from += 1000) {
    let query = supabase.from(table).select(columns).order(table === 'textbook_chunks' ? 'id' : 'source_id').range(from, from + 999);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
const countBy = (rows, value) => Object.fromEntries([...new Set(rows.map(value))].sort().map((key) => [key, rows.filter((row) => value(row) === key).length]));

async function main() {
  const liveRows = await fetchAll('textbook_chunks', 'id,source_id,board,class_level,subject,language', (q) => q.eq('board', 'ncert'));
  const live = [...new Map(liveRows.map((row) => [row.source_id, row])).values()];
  const liveIds = new Set(live.map((row) => row.source_id));
  const docs = await fetchAll('textbook_source_documents', 'source_id,board,class_level,subject,language,book_title,volume_or_part,official_source_url,verification_status,field_provenance,metadata_source', (q) => q.eq('board', 'ncert'));
  const chapters = (await fetchAll('textbook_source_chapters', 'source_id,chapter_key,chapter_number,chapter_title,verification_status,field_provenance,metadata_source'))
    .filter((row) => liveIds.has(row.source_id));
  const docsById = new Map(docs.map((row) => [row.source_id, row]));
  const officialChapters = chapters.filter((row) => row.field_provenance?.chapter_title === OFFICIAL);
  const anyVerifiedChapter = new Set(chapters.filter((row) => row.field_provenance?.chapter_title === OFFICIAL || row.field_provenance?.chapter_title === 'verified_ingestion_manifest').map((row) => row.source_id));
  const sourceChapterCounts = countBy(chapters, (row) => row.source_id);
  const duplicateMappings = Object.entries(sourceChapterCounts).filter(([, count]) => count > 1).map(([source_id, count]) => ({ source_id, count }));
  const bookNumberPairs = new Map();
  for (const chapter of officialChapters) {
    const doc = docsById.get(chapter.source_id);
    const key = `${doc?.class_level}|${doc?.book_title}|${chapter.chapter_number}`;
    (bookNumberPairs.get(key) || bookNumberPairs.set(key, []).get(key)).push(chapter.source_id);
  }
  const duplicateNumbers = [...bookNumberPairs.entries()].filter(([, ids]) => ids.length > 1).map(([key, source_ids]) => ({ key, source_ids }));
  const disagreements = docs.flatMap((doc) => {
    const source = live.find((row) => row.source_id === doc.source_id);
    return source ? ['board', 'class_level', 'subject', 'language'].filter((field) => doc[field] !== source[field]).map((field) => ({ source_id: doc.source_id, field, catalog: doc[field], live: source[field] })) : [];
  });
  const report = {
    title: 'NCERT VERIFIED PROVENANCE — STAGE 1.5', generated_at: new Date().toISOString(),
    corpus: { live_ncert_source_documents: live.length, live_ncert_chunks: liveRows.length },
    coverage: {
      catalogued_source_ids: live.filter((row) => docsById.has(row.source_id)).length,
      verified_book_titles: docs.filter((row) => row.field_provenance?.book_title === OFFICIAL).length,
      verified_chapter_numbers: officialChapters.filter((row) => row.field_provenance?.chapter_number === OFFICIAL).length,
      verified_chapter_titles: officialChapters.length,
      verified_official_source_references: docs.filter((row) => row.field_provenance?.official_source_url === OFFICIAL).length,
      verified_language: docs.filter((row) => row.field_provenance?.language === OFFICIAL).length,
      retained_manifest_titles: chapters.filter((row) => row.field_provenance?.chapter_title === 'verified_ingestion_manifest').length,
      total_student_facing_verified_titles: anyVerifiedChapter.size,
      unresolved_source_ids: live.filter((row) => !anyVerifiedChapter.has(row.source_id)).length,
    },
    breakdown: { classes: countBy(officialChapters, (row) => String(docsById.get(row.source_id)?.class_level)), subjects: countBy(officialChapters, (row) => docsById.get(row.source_id)?.subject), chapter_provenance: countBy(chapters, (row) => row.field_provenance?.chapter_title || 'unverified') },
    provenance_statuses: { documents: countBy(docs, (row) => row.verification_status), chapters: countBy(chapters, (row) => row.verification_status) },
    validation: {
      live_source_ids_without_catalog: live.filter((row) => !docsById.has(row.source_id)).map((row) => row.source_id),
      orphan_catalog_records: docs.filter((row) => !liveIds.has(row.source_id)).map((row) => row.source_id),
      catalog_live_metadata_disagreements: disagreements,
      source_ids_with_multiple_chapter_rows: duplicateMappings,
      duplicate_official_chapter_numbers_within_book: duplicateNumbers,
      unresolved_source_ids: live.filter((row) => !anyVerifiedChapter.has(row.source_id)).map((row) => row.source_id),
    },
    representative_verified_records: officialChapters.slice(0, 12).map((chapter) => ({ ...chapter, document: docsById.get(chapter.source_id) })),
    chunk_provenance: { rows_required_for_ncert_stage_1_5: 0, reason: 'NCERT live source documents are chapter PDFs; source_id resolves to document and chapter metadata.' },
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });
