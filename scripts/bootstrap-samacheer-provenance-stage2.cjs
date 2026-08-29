/* global __dirname */
/*
 * Stage 2: Samacheer provenance bootstrap.
 *
 * This is additive-only tooling for the verified-source catalog.
 * It does not touch textbook_chunks, embeddings, retrieval, prompts, or MIGA.
 *
 * Important provenance rule:
 * - Existing chunk columns are copied as existing_curated_mapping.
 * - Unit/lesson candidates found from chunk text/source IDs are derived only.
 * - Nothing in this script marks Samacheer unit titles as verified_official.
 *
 * Default is dry-run.
 *
 * Write modes are intentionally explicit:
 * - --apply-documents writes only document-level Samacheer baseline rows.
 * - --apply-derived-candidates writes derived unit rows + chunk mappings too.
 *
 * Do not use --apply-derived-candidates until the backend evidence join uses
 * textbook_chunk_provenance per selected chunk. The current source_id-level
 * join is safe for NCERT chapter PDFs but not sufficient for Samacheer books.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'samacheer-provenance-stage2-bootstrap.json');

const LEVEL = {
  curated: 'existing_curated_mapping',
  derivedSourceId: 'derived_source_id',
  derivedContent: 'derived_content',
  unverified: 'unverified',
};

const applyDocuments = process.argv.includes('--apply-documents') || process.argv.includes('--apply-derived-candidates');
const applyDerivedCandidates = process.argv.includes('--apply-derived-candidates');
const sampleOnly = process.argv.includes('--sample');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Supabase service credentials are required for Samacheer provenance bootstrap.');
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function numericChunkOrder(id) {
  const m = String(id || '').match(/:(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanTitle(value) {
  const t = normalizeText(value)
    .replace(/\b\d+(?:st|nd|rd|th)?_[A-Za-z]+_Unit_\d+_[A-Z]{2}\.indd\b.*$/i, '')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}.*$/i, '')
    .trim();
  if (!t || t.length < 3 || t.length > 120) return null;
  if (/^(unit|chapter|lesson)$/i.test(t)) return null;
  if (/^(table of contents|contents|exercise|summary|glossary|activity|evaluation)$/i.test(t)) return null;
  return t;
}

function inferDocumentScope(sourceId) {
  if (/-term-\d+-pdf$/.test(sourceId)) return { scope: 'term_book', term: sourceId.match(/-term-(\d+)-pdf$/)?.[1] || null, provenance: LEVEL.derivedSourceId };
  if (/-volume-\d+-pdf$/.test(sourceId) || /-volume-\d+-/.test(sourceId)) return { scope: 'volume_book', term: null, provenance: LEVEL.derivedSourceId };
  if (/-book-pdf$/.test(sourceId)) return { scope: 'full_book', term: null, provenance: LEVEL.derivedSourceId };
  return { scope: 'unknown', term: null, provenance: LEVEL.unverified };
}

function extractUnitSignals(row) {
  const content = normalizeText(row.content);
  const signals = [];

  // Strong operational signal preserved inside many extracted Samacheer chunks.
  // Example: 16_Geography_Unit_6_EM.indd
  const indd = [...content.matchAll(/\b(?:\d{1,2}(?:st|nd|rd|th)?_)?([A-Za-z][A-Za-z -]{2,40})_Unit_(\d{1,2})_([A-Z]{2})\.indd\b/g)];
  for (const m of indd) {
    signals.push({
      unit_type: 'unit',
      unit_number: String(Number(m[2])),
      unit_title: null,
      confidence: 'medium',
      signal: 'indd_unit_marker',
    });
  }

  // Explicit English unit/lesson headings near the start of a chunk.
  const start = content.slice(0, 260);
  const explicit = start.match(/\b(?:UNIT|Unit)\s+([0-9IVXLC]+)\s*[-:–—.]?\s*([A-Z][A-Za-z0-9 ,()'’:&-]{4,90})?/);
  if (explicit) {
    signals.push({
      unit_type: 'unit',
      unit_number: explicit[1],
      unit_title: cleanTitle(explicit[2]),
      confidence: explicit[2] ? 'medium' : 'low',
      signal: 'explicit_unit_heading',
    });
  }

  const lesson = start.match(/\b(?:LESSON|Lesson)\s+([0-9IVXLC]+)\s*[-:–—.]?\s*([A-Z][A-Za-z0-9 ,()'’:&-]{4,90})?/);
  if (lesson) {
    signals.push({
      unit_type: 'lesson',
      unit_number: lesson[1],
      unit_title: cleanTitle(lesson[2]),
      confidence: lesson[2] ? 'medium' : 'low',
      signal: 'explicit_lesson_heading',
    });
  }

  // Section numbers like 6.2.5 establish a current unit number, not a title.
  const section = start.match(/\b(\d{1,2})\.\d+(?:\.\d+)?\b/);
  if (section) {
    signals.push({
      unit_type: 'unit',
      unit_number: String(Number(section[1])),
      unit_title: null,
      confidence: 'low',
      signal: 'section_number_prefix',
    });
  }

  // Some chunks begin with a page number followed by a running chapter/unit title.
  // This is useful as a candidate only, never verified.
  const running = start.match(/^\d{1,4}\s+([A-Z][A-Za-z][A-Za-z0-9 ,()'’:&-]{6,80})\b/);
  if (running) {
    signals.push({
      unit_type: 'unit',
      unit_number: null,
      unit_title: cleanTitle(running[1]),
      confidence: 'low',
      signal: 'running_header_candidate',
    });
  }

  return signals;
}

function pickBestSignal(signals) {
  if (!signals.length) return null;
  const score = { medium: 2, low: 1 };
  return signals.slice().sort((a, b) => {
    const s = (score[b.confidence] || 0) - (score[a.confidence] || 0);
    if (s !== 0) return s;
    if (a.unit_number && !b.unit_number) return -1;
    if (!a.unit_number && b.unit_number) return 1;
    if (a.unit_title && !b.unit_title) return -1;
    if (!a.unit_title && b.unit_title) return 1;
    return 0;
  })[0];
}

async function fetchSamacheerChunks() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0;; from += pageSize) {
    const { data, error } = await supabase
      .from('textbook_chunks')
      .select('id, source_id, board, class_level, subject, chapter, language, chunk_type, content')
      .eq('board', 'samacheer')
      .order('source_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize || (sampleOnly && rows.length >= 3000)) break;
  }
  return rows;
}

function buildCatalog(rows) {
  const sources = new Map();
  for (const row of rows) {
    if (!row.source_id) continue;
    if (!sources.has(row.source_id)) {
      sources.set(row.source_id, { source: row.source_id, rows: [] });
    }
    sources.get(row.source_id).rows.push(row);
  }

  const documentRows = [];
  const chapterRows = [];
  const chunkRows = [];
  const sourceReports = [];

  for (const entry of [...sources.values()].sort((a, b) => a.source.localeCompare(b.source))) {
    const sourceRows = entry.rows.sort((a, b) => numericChunkOrder(a.id) - numericChunkOrder(b.id));
    const first = sourceRows[0];
    const scope = inferDocumentScope(entry.source);
    const metadataDisagreements = [];
    for (const field of ['board', 'class_level', 'subject', 'language', 'chapter']) {
      const distinct = [...new Set(sourceRows.map((r) => r[field]).filter((x) => x !== null && x !== undefined))];
      if (distinct.length > 1) metadataDisagreements.push({ field, values: distinct });
    }

    documentRows.push({
      source_id: entry.source,
      board: first.board || null,
      class_level: first.class_level ?? null,
      subject: first.subject || null,
      language: first.language || null,
      book_title: null,
      volume_or_part: null,
      term: scope.term,
      document_scope: scope.scope,
      official_source_url: null,
      verification_status: LEVEL.curated,
      field_provenance: {
        board: LEVEL.curated,
        class_level: LEVEL.curated,
        subject: LEVEL.curated,
        language: LEVEL.curated,
        document_scope: scope.provenance,
        term: scope.term ? LEVEL.derivedSourceId : LEVEL.unverified,
        book_title: LEVEL.unverified,
        volume_or_part: LEVEL.unverified,
        official_source_url: LEVEL.unverified,
      },
      metadata_source: {
        kind: 'live_textbook_chunks_samacheer_baseline',
        note: 'Baseline copied from existing corpus. Unit candidates are derived only and not student-facing verified metadata.',
      },
      updated_at: new Date().toISOString(),
    });

    const units = new Map();
    let currentUnitKey = null;
    for (const row of sourceRows) {
      const signal = pickBestSignal(extractUnitSignals(row));
      if (signal && (signal.unit_number || signal.unit_title)) {
        const numberPart = signal.unit_number ? String(signal.unit_number).toLowerCase().replace(/\s+/g, '-') : 'unknown';
        const titlePart = signal.unit_title ? signal.unit_title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) : 'untitled';
        const key = `${signal.unit_type}-${numberPart}-${titlePart}`;
        currentUnitKey = key;
        const prior = units.get(key);
        units.set(key, {
          source_id: entry.source,
          chapter_key: key,
          chapter_number: null,
          chapter_title: null,
          unit_number: signal.unit_number || null,
          unit_title: signal.unit_title || null,
          canonical_unit_type: signal.unit_type || 'unit',
          canonical_unit_number: signal.unit_number || null,
          canonical_unit_title: signal.unit_title || null,
          verification_status: LEVEL.derivedContent,
          field_provenance: {
            unit_number: signal.unit_number ? LEVEL.derivedContent : LEVEL.unverified,
            unit_title: signal.unit_title ? LEVEL.derivedContent : LEVEL.unverified,
            canonical_unit_type: LEVEL.derivedContent,
            canonical_unit_number: signal.unit_number ? LEVEL.derivedContent : LEVEL.unverified,
            canonical_unit_title: signal.unit_title ? LEVEL.derivedContent : LEVEL.unverified,
            chapter_number: LEVEL.unverified,
            chapter_title: LEVEL.unverified,
          },
          metadata_source: {
            kind: 'samacheer_chunk_text_candidate',
            signal: signal.signal,
            confidence: signal.confidence,
            first_seen_chunk_id: prior?.metadata_source?.first_seen_chunk_id || row.id,
            note: 'Candidate only. Requires official Samacheer/SCERT verification before student-facing display.',
          },
          updated_at: new Date().toISOString(),
          supporting_chunk_ids: prior ? prior.supporting_chunk_ids.concat(row.id) : [row.id],
        });
      }

      if (currentUnitKey) {
        chunkRows.push({
          chunk_id: row.id,
          source_id: entry.source,
          chapter_key: currentUnitKey,
          verification_status: LEVEL.derivedContent,
          field_provenance: {
            chapter_id: LEVEL.derivedContent,
          },
          metadata_source: {
            kind: 'sequential_chunk_to_candidate_unit_mapping',
            note: 'Chunk mapped to latest derived unit signal in source order. Candidate only.',
          },
          updated_at: new Date().toISOString(),
        });
      }
    }

    for (const unit of units.values()) {
      const { supporting_chunk_ids, ...row } = unit;
      chapterRows.push(row);
    }

    sourceReports.push({
      source_id: entry.source,
      chunks: sourceRows.length,
      class_level: first.class_level,
      subject: first.subject,
      language: first.language,
      existing_chapter_field: first.chapter,
      document_scope: scope.scope,
      candidate_units: units.size,
      candidate_mapped_chunks: chunkRows.filter((r) => r.source_id === entry.source).length,
      metadata_disagreements: metadataDisagreements,
      sample_candidates: [...units.values()].slice(0, 5).map((u) => ({
        chapter_key: u.chapter_key,
        unit_type: u.canonical_unit_type,
        unit_number: u.canonical_unit_number,
        unit_title: u.canonical_unit_title,
        signal: u.metadata_source.signal,
        confidence: u.metadata_source.confidence,
      })),
    });
  }

  return { documentRows, chapterRows, chunkRows, sourceReports };
}

async function applyCatalog(catalog) {
  const { error: docError } = await supabase
    .from('textbook_source_documents')
    .upsert(catalog.documentRows, { onConflict: 'source_id' });
  if (docError) throw docError;

  if (!applyDerivedCandidates) return;

  if (catalog.chapterRows.length) {
    const { error: chapterError } = await supabase
      .from('textbook_source_chapters')
      .upsert(catalog.chapterRows, { onConflict: 'source_id,chapter_key' });
    if (chapterError) throw chapterError;
  }

  if (catalog.chunkRows.length) {
    const { data: chapters, error: fetchError } = await supabase
      .from('textbook_source_chapters')
      .select('chapter_id, source_id, chapter_key')
      .in('source_id', catalog.documentRows.map((r) => r.source_id));
    if (fetchError) throw fetchError;
    const chapterIdByKey = new Map((chapters || []).map((r) => [`${r.source_id}::${r.chapter_key}`, r.chapter_id]));
    const rows = catalog.chunkRows
      .map((r) => {
        const chapter_id = chapterIdByKey.get(`${r.source_id}::${r.chapter_key}`);
        if (!chapter_id) return null;
        return {
          chunk_id: r.chunk_id,
          chapter_id,
          verification_status: r.verification_status,
          field_provenance: r.field_provenance,
          metadata_source: r.metadata_source,
          updated_at: r.updated_at,
        };
      })
      .filter(Boolean);

    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await supabase
        .from('textbook_chunk_provenance')
        .upsert(rows.slice(i, i + batchSize), { onConflict: 'chunk_id' });
      if (error) throw error;
    }
  }
}

async function main() {
  const chunks = await fetchSamacheerChunks();
  const catalog = buildCatalog(chunks);
  const report = {
    stage: 'Samacheer provenance Stage 2 bootstrap',
    mode: applyDerivedCandidates ? 'apply_derived_candidates' : applyDocuments ? 'apply_documents' : 'dry_run',
    generated_at: new Date().toISOString(),
    live_samacheer_chunks_read: chunks.length,
    distinct_samacheer_source_ids: catalog.documentRows.length,
    document_rows: catalog.documentRows.length,
    derived_candidate_unit_rows: catalog.chapterRows.length,
    derived_chunk_provenance_rows: catalog.chunkRows.length,
    student_facing_verified_unit_titles_created: 0,
    provenance_levels_used: {
      document_baseline_fields: LEVEL.curated,
      document_scope_term_candidates: LEVEL.derivedSourceId,
      unit_candidates: LEVEL.derivedContent,
      chunk_unit_mappings: LEVEL.derivedContent,
    },
    warning: 'Derived Samacheer unit candidates are not verified and must not be displayed as canonical student-facing lesson metadata.',
    source_reports: catalog.sourceReports,
  };

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (applyDocuments) await applyCatalog(catalog);

  console.log(JSON.stringify({
    mode: report.mode,
    live_samacheer_chunks_read: report.live_samacheer_chunks_read,
    distinct_samacheer_source_ids: report.distinct_samacheer_source_ids,
    document_rows: report.document_rows,
    derived_candidate_unit_rows: report.derived_candidate_unit_rows,
    derived_chunk_provenance_rows: report.derived_chunk_provenance_rows,
    student_facing_verified_unit_titles_created: 0,
    report: path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/'),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
