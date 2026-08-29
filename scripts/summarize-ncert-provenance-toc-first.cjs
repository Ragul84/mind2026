/* Read-only aggregation of completed TOC-first audit batches. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'reports', 'ncert-provenance-toc-first-batches');
const files = fs.readdirSync(dir).filter((name) => /^batch-[a-z].*\.json$/i.test(name));
const bySource = new Map();
for (const file of files) {
  const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const record of report.records || []) bySource.set(record.source_id, record);
}
const records = [...bySource.values()].map((record) => {
  const title = String(record.canonical_unit_title || '');
  if (record.status === 'CORRECTABLE' && (!title.trim() || /[\uFFFD]|â€|\u0008/.test(title) || /^of this textbook\b/i.test(title) || /former\s*$/i.test(title))) {
    return { ...record, status: 'PARSER_REVIEW', failure: 'malformed_or_non_title_official_text_extraction' };
  }
  return record;
}).sort((a, b) => a.source_id.localeCompare(b.source_id));
const count = (values, key) => values.reduce((out, value) => ((out[value[key] || 'NONE'] = (out[value[key] || 'NONE'] || 0) + 1), out), {});
const correctionRecords = records.filter((x) => x.status === 'CORRECTABLE');
const report = {
  generated_at: new Date().toISOString(),
  scope: 'read_only_official_ncert_toc_first_audit',
  total_records_audited: records.length,
  statuses: count(records, 'status'),
  canonical_unit_labels: count(records.filter((x) => x.canonical_unit_type), 'canonical_unit_type'),
  multipart_or_volume_records: records.filter((x) => x.volume_or_part).length,
  document_ordinal_vs_pdf_printed_number_differences: records.filter((x) => x.document_ordinal && x.pdf_printed_chapter_number && String(x.document_ordinal) !== String(x.pdf_printed_chapter_number)).map((x) => ({ source_id: x.source_id, volume_or_part: x.volume_or_part, document_ordinal: x.document_ordinal, pdf_printed_chapter_number: x.pdf_printed_chapter_number, canonical_unit_type: x.canonical_unit_type, canonical_unit_number: x.canonical_unit_number, canonical_unit_title: x.canonical_unit_title })),
  official_book_structures_used: [...new Set(records.filter((x) => x.official_book_structure_url).map((x) => x.book_code))].sort(),
  failed_book_structures: [...new Set(records.filter((x) => x.failure === 'official_toc_not_parseable').map((x) => x.book_code))].sort(),
  projected_trustworthy_student_facing_title_coverage_after_safe_corrections: records.filter((x) => x.status === 'VERIFIED_UNCHANGED' || x.status === 'CORRECTABLE').length,
  proposed_catalog_corrections: correctionRecords.map((x) => ({ source_id: x.source_id, current: { chapter_number: x.current_chapter_number, chapter_title: x.current_chapter_title }, proposed_official: { unit_type: x.canonical_unit_type, unit_number: x.canonical_unit_number, unit_title: x.canonical_unit_title }, verification: { book_structure_url: x.official_book_structure_url, chapter_document_url: x.official_chapter_url, mapping_method: x.mapping_method, pdf_printed_chapter_number: x.pdf_printed_chapter_number } })),
  records,
};
const output = path.join(ROOT, 'reports', 'ncert-provenance-integrity-audit.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, total: records.length, statuses: report.statuses, labels: report.canonical_unit_labels, corrections: correctionRecords.length }, null, 2));
