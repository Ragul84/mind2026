/* Applies only TOC-first CORRECTABLE records from the local integrity report.
 * Default is dry-run. --apply writes only provenance catalog tables. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const ROOT = path.resolve(__dirname, '..');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'ncert-provenance-integrity-audit.json'), 'utf8'));
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OFFICIAL = 'verified_official';
const apply = process.argv.includes('--apply');
const safe = report.proposed_catalog_corrections || [];
const revolt = {
  source_id: 'ncert-class-12-history-themes-in-indian-history-iii-en-chapter-02-pdf',
  current: {}, proposed_official: { unit_type: 'theme', unit_number: '10', unit_title: 'Rebels and the Raj: The Revolt of 1857 and Its Representations' },
  verification: { book_structure_url: 'https://ncert.nic.in/textbook/pdf/lehs3ps.pdf', chapter_document_url: 'https://ncert.nic.in/textbook/pdf/lehs302.pdf', mapping_method: 'official_history_part_iii_contents_plus_exact_official_theme_pdf', pdf_printed_chapter_number: null },
  document: { book_title: 'Themes in Indian History – Part III', volume_or_part: 'Part III' },
};
const operations = [...safe, revolt];
if (!apply) { console.log(JSON.stringify({ mode: 'dry_run', safe_corrections: safe.length, approved_revolt_enrichment: 1, total_operations: operations.length }, null, 2)); process.exit(0); }
(async () => {
  const ids = operations.map((x) => x.source_id);
  const { data: docs, error: docsError } = await db.from('textbook_source_documents').select('source_id,field_provenance,metadata_source').in('source_id', ids);
  if (docsError) throw docsError;
  if ((docs || []).length !== ids.length) throw new Error(`Missing source documents: expected ${ids.length}, found ${(docs || []).length}`);
  const docsById = new Map(docs.map((x) => [x.source_id, x]));
  const { data: existing, error: chaptersError } = await db.from('textbook_source_chapters').select('chapter_id,source_id,chapter_key,field_provenance,metadata_source').in('source_id', ids);
  if (chaptersError) throw chaptersError;
  const existingBySource = new Map((existing || []).map((x) => [x.source_id, x]));
  let updated = 0; let inserted = 0;
  for (const operation of operations) {
    const p = operation.proposed_official; const v = operation.verification;
    const fields = {
      chapter_number: p.unit_number, chapter_title: p.unit_title,
      document_ordinal: /^\d+$/.test(String(operation.source_id.match(/-chapter-(\d+)-pdf$/)?.[1] || '')) ? Number(operation.source_id.match(/-chapter-(\d+)-pdf$/)[1]) : null,
      pdf_printed_unit_type: v.pdf_printed_chapter_number ? 'chapter' : null,
      pdf_printed_unit_number: v.pdf_printed_chapter_number || null,
      canonical_unit_type: p.unit_type, canonical_unit_number: p.unit_number, canonical_unit_title: p.unit_title,
      verification_status: OFFICIAL,
      field_provenance: { ...(existingBySource.get(operation.source_id)?.field_provenance || {}), chapter_number: OFFICIAL, chapter_title: OFFICIAL, canonical_unit_type: OFFICIAL, canonical_unit_number: OFFICIAL, canonical_unit_title: OFFICIAL, ...(v.pdf_printed_chapter_number ? { pdf_printed_unit_number: OFFICIAL } : {}) },
      metadata_source: { ...(existingBySource.get(operation.source_id)?.metadata_source || {}), toc_first_integrity_audit: { book_structure_url: v.book_structure_url, chapter_document_url: v.chapter_document_url, mapping_method: v.mapping_method } },
    };
    const prior = existingBySource.get(operation.source_id);
    const result = prior
      ? await db.from('textbook_source_chapters').update(fields).eq('chapter_id', prior.chapter_id)
      : await db.from('textbook_source_chapters').insert({ source_id: operation.source_id, chapter_key: 'canonical-unit', ...fields });
    if (result.error) throw result.error;
    if (prior) updated += 1; else inserted += 1;
    if (operation.document) {
      const doc = docsById.get(operation.source_id);
      const docResult = await db.from('textbook_source_documents').update({ ...operation.document, official_source_url: v.chapter_document_url, field_provenance: { ...(doc.field_provenance || {}), book_title: OFFICIAL, volume_or_part: OFFICIAL, official_source_url: OFFICIAL }, metadata_source: { ...(doc.metadata_source || {}), toc_first_integrity_audit: { book_structure_url: v.book_structure_url, chapter_document_url: v.chapter_document_url } } }).eq('source_id', operation.source_id);
      if (docResult.error) throw docResult.error;
    }
  }
  console.log(JSON.stringify({ applied: true, updated, inserted, total: operations.length }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
