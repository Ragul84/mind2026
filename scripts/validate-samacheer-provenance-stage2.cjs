/* global __dirname */
/*
 * Read-only Samacheer provenance validation.
 *
 * Confirms catalog coverage and reports whether any Samacheer unit metadata has
 * been marked student-facing verified. This script does not write data.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'samacheer-provenance-stage2-validation.json');
const STUDENT_FACING = new Set(['verified_official', 'verified_ingestion_manifest']);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Supabase service credentials are required for Samacheer provenance validation.');
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function count(table, build) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  q = build ? build(q) : q;
  const { count: c, error } = await q;
  if (error) throw error;
  return c || 0;
}

async function fetchAll(table, select, build) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0;; from += pageSize) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    q = build ? build(q) : q;
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const liveRows = await fetchAll(
    'textbook_chunks',
    'source_id,board,class_level,subject,language,chapter,chunk_type',
    (q) => q.eq('board', 'samacheer').order('source_id', { ascending: true }),
  );
  const liveSourceIds = [...new Set(liveRows.map((r) => r.source_id).filter(Boolean))].sort();
  const liveByClass = {};
  const liveBySubject = {};
  const liveByLanguage = {};
  const liveByChunkType = {};
  for (const row of liveRows) {
    liveByClass[row.class_level ?? '(null)'] = (liveByClass[row.class_level ?? '(null)'] || 0) + 1;
    liveBySubject[row.subject || '(null)'] = (liveBySubject[row.subject || '(null)'] || 0) + 1;
    liveByLanguage[row.language || '(null)'] = (liveByLanguage[row.language || '(null)'] || 0) + 1;
    liveByChunkType[row.chunk_type || '(null)'] = (liveByChunkType[row.chunk_type || '(null)'] || 0) + 1;
  }

  const docs = await fetchAll(
    'textbook_source_documents',
    'source_id,board,class_level,subject,language,document_scope,term,verification_status,field_provenance',
    (q) => q.eq('board', 'samacheer').order('source_id', { ascending: true }),
  );
  const docIds = new Set(docs.map((r) => r.source_id));
  const missingDocuments = liveSourceIds.filter((id) => !docIds.has(id));
  const orphanDocuments = docs.map((r) => r.source_id).filter((id) => !liveSourceIds.includes(id));

  const chapters = await fetchAll(
    'textbook_source_chapters',
    'chapter_id,source_id,chapter_key,verification_status,field_provenance,canonical_unit_type,canonical_unit_number,canonical_unit_title,unit_number,unit_title',
    (q) => q.in('source_id', docs.length ? docs.map((r) => r.source_id) : ['__none__']),
  );
  const chapterIds = chapters.map((r) => r.chapter_id);
  const chunkProvenanceCount = chapterIds.length
    ? await count('textbook_chunk_provenance', (q) => q.in('chapter_id', chapterIds))
    : 0;

  const studentFacingUnitRows = chapters.filter((row) => STUDENT_FACING.has(row.verification_status));
  const derivedUnitRows = chapters.filter((row) => row.verification_status === 'derived_content');

  const report = {
    stage: 'Samacheer provenance Stage 2 validation',
    generated_at: new Date().toISOString(),
    live_samacheer_chunks: liveRows.length,
    live_samacheer_source_ids: liveSourceIds.length,
    catalog_documents: docs.length,
    catalog_document_coverage: `${docs.length}/${liveSourceIds.length}`,
    missing_live_source_documents: missingDocuments,
    orphan_catalog_documents: orphanDocuments,
    candidate_unit_rows: chapters.length,
    derived_candidate_unit_rows: derivedUnitRows.length,
    student_facing_verified_unit_rows: studentFacingUnitRows.length,
    chunk_provenance_rows_for_samacheer_catalog: chunkProvenanceCount,
    live_breakdown: {
      by_class: liveByClass,
      by_subject: liveBySubject,
      by_language: liveByLanguage,
      by_chunk_type: liveByChunkType,
    },
    safety_verdict: studentFacingUnitRows.length === 0
      ? 'PASS: no Samacheer derived unit/title metadata is marked student-facing verified.'
      : 'REVIEW_REQUIRED: Samacheer has student-facing verified unit rows.',
    student_facing_verified_samples: studentFacingUnitRows.slice(0, 20),
  };

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    live_samacheer_chunks: report.live_samacheer_chunks,
    live_samacheer_source_ids: report.live_samacheer_source_ids,
    catalog_documents: report.catalog_documents,
    candidate_unit_rows: report.candidate_unit_rows,
    chunk_provenance_rows_for_samacheer_catalog: report.chunk_provenance_rows_for_samacheer_catalog,
    student_facing_verified_unit_rows: report.student_facing_verified_unit_rows,
    safety_verdict: report.safety_verdict,
    report: path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/'),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
