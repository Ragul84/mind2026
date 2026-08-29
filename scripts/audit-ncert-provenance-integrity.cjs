/*
 * Strictly audits existing student-facing NCERT chapter records against their
 * stored official NCERT chapter PDFs. It does not use source_id or chunk text as
 * chapter authority. A record is retained only when the PDF itself provides an
 * unambiguous chapter heading and a separate title line. `chapter-06` in a
 * source_id is an ingestion document ordinal, never assumed to be NCERT's
 * printed canonical chapter number.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'reports', 'ncert-provenance-integrity-cache');
const OFFICIAL = 'verified_official';
const MANIFEST = 'verified_ingestion_manifest';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');
const supabase = createClient(url, key);

const wordNumbers = new Map(['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'].map((v, i) => [v, i + 1]));
const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const titleLike = (line) => {
  const v = normalise(line);
  return v.length > 2 && v.length < 130 && /[a-z]/i.test(v)
    && !/^chapter\b/i.test(v) && !/^reprint\b/i.test(v)
    && !/^(physics|chemistry|biology|mathematics|science|social science|part [ivx]+)$/i.test(v)
    && !/^\d+$/.test(v);
};
function extractPdfIdentity(pdf) {
  const temp = path.join(os.tmpdir(), `mindgains-integrity-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  try {
    fs.writeFileSync(temp, pdf);
    const code = "from pypdf import PdfReader;import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');r=PdfReader(sys.argv[1]);print('\\n'.join((p.extract_text() or '') for p in r.pages[:3]))";
    const out = spawnSync('python', ['-c', code, temp], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    if (out.status !== 0) throw new Error(String(out.stderr || out.error || 'PDF extraction failed'));
    const lines = out.stdout.replace(/\r/g, '\n').split('\n').map(normalise).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^chapter\s+(\d+|[a-z]+)$/i) || lines[i].match(/^(\d+)\s*chapter$/i);
      if (!match) continue;
      const raw = match[1].toLowerCase();
      const number = /^\d+$/.test(raw) ? Number(raw) : wordNumbers.get(raw);
      if (!number) continue;
      // NCERT prints a number heading ("CHAPTER THIRTEEN") separately from
      // the title. A chapter-number heading is never itself a title.
      const title = lines.slice(i + 1, i + 8).find((line) => titleLike(line) && !/^chapter\s+(\d+|[a-z]+)$/i.test(line))
        || lines.slice(Math.max(0, i - 3), i).reverse().find(titleLike);
      if (title) return { chapterNumber: String(number), chapterTitle: title, lines: lines.slice(i, i + 6) };
      return { chapterNumber: String(number), chapterTitle: null, lines: lines.slice(i, i + 6) };
    }
    return { chapterNumber: null, chapterTitle: null, lines: lines.slice(0, 12) };
  } finally { fs.rmSync(temp, { force: true }); }
}
async function fetchPdf(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response = await fetch(target, { headers: { 'user-agent': 'MindGains-Provenance-Integrity-Audit/1.0' }, signal: controller.signal }); }
  finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  const apply = process.argv.includes('--apply');
  const start = Number((process.argv.find((arg) => arg.startsWith('--start=')) || '').split('=')[1] || 0);
  const limit = Number((process.argv.find((arg) => arg.startsWith('--limit=')) || '').split('=')[1] || 0);
  if (apply) throw new Error('This integrity audit is read-only. Catalog writes require separate approval.');
  const { data: docs, error: docsError } = await supabase.from('textbook_source_documents').select('source_id,class_level,subject,book_title,volume_or_part,official_source_url,field_provenance').eq('board', 'ncert');
  if (docsError) throw docsError;
  const { data: chapters, error: chaptersError } = await supabase.from('textbook_source_chapters').select('chapter_id,source_id,chapter_key,chapter_number,chapter_title,verification_status,field_provenance,metadata_source');
  if (chaptersError) throw chaptersError;
  const docBySource = new Map((docs || []).map((d) => [d.source_id, d]));
  const audited = []; let cursor = 0; fs.mkdirSync(CACHE_DIR, { recursive: true });
  const allTargets = (chapters || []).filter((c) => c.field_provenance?.chapter_title === OFFICIAL).sort((a, b) => a.source_id.localeCompare(b.source_id));
  const targets = limit > 0 ? allTargets.slice(start, start + limit) : allTargets;
  await Promise.all(Array.from({ length: 12 }, async () => { while (cursor < targets.length) { const chapter = targets[cursor++]; const doc = docBySource.get(chapter.source_id); const result = { source_id: chapter.source_id, stored_number: chapter.chapter_number, stored_title: chapter.chapter_title, official_url: doc?.official_source_url, status: 'unresolved' };
    try { if (!doc?.official_source_url || doc.field_provenance?.official_source_url !== OFFICIAL) { result.status = 'AUTHORITATIVE_AMBIGUITY'; throw new Error('missing_verified_official_url'); }
      const cachePath = path.join(CACHE_DIR, `${Buffer.from(chapter.source_id).toString('base64url')}.json`);
      let identity; if (fs.existsSync(cachePath)) identity = JSON.parse(fs.readFileSync(cachePath, 'utf8')).identity; else { identity = extractPdfIdentity(await fetchPdf(doc.official_source_url)); fs.writeFileSync(cachePath, JSON.stringify({ source_id: chapter.source_id, official_url: doc.official_source_url, fetched_at: new Date().toISOString(), identity }, null, 2)); }
      Object.assign(result, identity); result.book_structure_key = [doc.class_level, doc.subject, doc.book_title, doc.volume_or_part].filter(Boolean).join(' | ');
      if (!identity.chapterNumber || !identity.chapterTitle) result.status = 'PARSER_REVIEW';
      else if (normalise(chapter.chapter_title).toLowerCase() === normalise(identity.chapterTitle).toLowerCase() && String(chapter.chapter_number) === identity.chapterNumber) result.status = 'VERIFIED_UNCHANGED';
      else result.status = 'CORRECTABLE';
    } catch (e) { if (!result.status || result.status === 'unresolved') result.status = /fetch|abort|HTTP|terminated/i.test(e.message || '') ? 'RETRY_REQUIRED' : 'PARSER_REVIEW'; result.error = e.message || String(e); } audited.push({ chapter, result }); } }));
  const reportDir = path.join(ROOT, 'reports', 'ncert-provenance-integrity-batches'); fs.mkdirSync(reportDir, { recursive: true });
  const batch = { generated_at: new Date().toISOString(), start, limit: limit || allTargets.length, total_target_records: allTargets.length, records: audited.map(({ chapter, result }) => ({ ...result, current_chapter_number: chapter.chapter_number, current_chapter_title: chapter.chapter_title, document_ordinal: (chapter.source_id.match(/-chapter-(\d+)-pdf$/) || [])[1] || null, part_or_volume: docBySource.get(chapter.source_id)?.volume_or_part || null })) };
  fs.writeFileSync(path.join(reportDir, `batch-${start}-${targets.length}.json`), JSON.stringify(batch, null, 2)); console.log(JSON.stringify({ start, audited: audited.length, total_target_records: allTargets.length, statuses: audited.reduce((m, x) => ((m[x.result.status] = (m[x.result.status] || 0) + 1), m), {}) }, null, 2));
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
