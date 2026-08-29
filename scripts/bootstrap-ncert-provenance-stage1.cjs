/* global __dirname */
/*
 * Stage 1: additive NCERT provenance bootstrap.
 *
 * Reads only existing textbook_chunks metadata, then creates one catalog
 * document per live NCERT source_id. These baseline fields are explicitly
 * marked existing_curated_mapping, never verified_official.
 *
 * The only chapter titles seeded here come from the local Fine Arts release
 * corpus manifest. They are marked verified_ingestion_manifest, with their
 * exact local artifact recorded. No title is inferred from a source ID, a
 * prompt, model text, or arbitrary chunk text.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_ROOT = path.join(ROOT, 'data', 'textbook-release-corpus');
const LEVEL = {
  verifiedOfficial: 'verified_official',
  verifiedManifest: 'verified_ingestion_manifest',
  curated: 'existing_curated_mapping',
  unverified: 'unverified',
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Supabase service credentials are required for the Stage 1 bootstrap.');
const supabase = createClient(url, serviceKey);

async function fetchNcertSources() {
  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await supabase
      .from('textbook_chunks')
      .select('id, source_id, board, class_level, subject, language')
      .eq('board', 'ncert')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const sources = new Map();
  for (const row of rows) {
    if (!row.source_id) continue;
    const prior = sources.get(row.source_id);
    const current = {
      source_id: row.source_id,
      board: row.board || null,
      class_level: row.class_level ?? null,
      subject: row.subject || null,
      language: row.language || null,
    };
    if (prior && JSON.stringify(prior) !== JSON.stringify(current)) {
      throw new Error(`Inconsistent live metadata for ${row.source_id}`);
    }
    sources.set(row.source_id, current);
  }
  return [...sources.values()];
}

function readFineArtsEvidence() {
  if (!fs.existsSync(RELEASE_ROOT)) return new Map();
  const evidence = new Map();
  for (const entry of fs.readdirSync(RELEASE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(RELEASE_ROOT, entry.name, 'chunks.jsonl');
    if (!fs.existsSync(manifestPath)) continue;
    const chunks = fs.readFileSync(manifestPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const first = chunks[0];
    if (!first || first.board !== 'ncert' || first.subject !== 'fine-arts' || !first.source_id || !first.chapter) continue;
    const allSameSource = chunks.every((chunk) => chunk.source_id === first.source_id && chunk.chapter === first.chapter);
    if (!allSameSource) throw new Error(`Fine Arts release manifest is internally inconsistent: ${manifestPath}`);
    const pageStarts = chunks.map((chunk) => Number(chunk.page_start)).filter(Number.isFinite);
    const pageEnds = chunks.map((chunk) => Number(chunk.page_end)).filter(Number.isFinite);
    evidence.set(first.source_id, {
      chapter_title: first.chapter.trim(),
      page_start: pageStarts.length ? Math.min(...pageStarts) : null,
      page_end: pageEnds.length ? Math.max(...pageEnds) : null,
      manifest_path: path.relative(ROOT, manifestPath).replace(/\\/g, '/'),
    });
  }
  return evidence;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sources = await fetchNcertSources();
  if (sources.length !== 484) {
    throw new Error(`Expected 484 live NCERT source IDs, found ${sources.length}. Refusing to seed an incomplete audit baseline.`);
  }
  const fineArts = readFineArtsEvidence();

  const documentRows = sources.map((source) => ({
    ...source,
    document_scope: 'chapter_pdf',
    verification_status: LEVEL.curated,
    field_provenance: {
      board: LEVEL.curated,
      class_level: LEVEL.curated,
      subject: LEVEL.curated,
      language: LEVEL.curated,
      document_scope: LEVEL.curated,
      book_title: LEVEL.unverified,
      volume_or_part: LEVEL.unverified,
      term: LEVEL.unverified,
      official_source_url: LEVEL.unverified,
    },
    metadata_source: {
      kind: 'live_textbook_chunks_baseline',
      note: 'Baseline metadata copied from existing live corpus; not approved for student-facing provenance.',
    },
    updated_at: new Date().toISOString(),
  }));
  if (!dryRun) {
    const { error: documentsError } = await supabase
      .from('textbook_source_documents')
      .upsert(documentRows, { onConflict: 'source_id' });
    if (documentsError) throw documentsError;
  }

  const chapterRows = [];
  for (const source of sources) {
    const evidence = fineArts.get(source.source_id);
    if (!evidence) continue;
    chapterRows.push({
      source_id: source.source_id,
      chapter_key: 'release-corpus-chapter',
      chapter_number: null,
      chapter_title: evidence.chapter_title,
      page_start: evidence.page_start,
      page_end: evidence.page_end,
      verification_status: LEVEL.verifiedManifest,
      field_provenance: {
        chapter_title: LEVEL.verifiedManifest,
        page_start: LEVEL.verifiedManifest,
        page_end: LEVEL.verifiedManifest,
        chapter_number: LEVEL.unverified,
        unit_number: LEVEL.unverified,
        unit_title: LEVEL.unverified,
      },
      metadata_source: {
        kind: 'local_release_corpus_manifest',
        manifest_path: evidence.manifest_path,
        source_id_validated_against: 'live_textbook_chunks.source_id',
      },
      updated_at: new Date().toISOString(),
    });
  }
  if (!dryRun) {
    const { error: chaptersError } = await supabase
      .from('textbook_source_chapters')
      .upsert(chapterRows, { onConflict: 'source_id,chapter_key' });
    if (chaptersError) throw chaptersError;
  }

  console.log(JSON.stringify({
    stage: 'NCERT verified provenance Stage 1',
    live_ncert_source_ids: sources.length,
    catalog_documents_upserted: documentRows.length,
    release_manifest_chapters_upserted: chapterRows.length,
    unresolved_chapter_titles: sources.length - chapterRows.length,
    chunk_provenance_rows_created: 0,
    dry_run: dryRun,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
