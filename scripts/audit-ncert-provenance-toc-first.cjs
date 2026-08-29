/*
 * Read-only NCERT provenance integrity audit, TOC-first.
 *
 * Official NCERT book preliminary PDFs (<book-code>ps.pdf) establish the
 * canonical chapter sequence. The existing verified official chapter-PDF URL
 * identifies the individual document. Nothing in this script writes catalog
 * tables; it only produces reproducible cache/report artifacts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'reports', 'ncert-provenance-book-structures');
const OUT_DIR = path.join(ROOT, 'reports', 'ncert-provenance-toc-first-batches');
const CHAPTER_CONFIRM_CACHE_DIR = path.join(ROOT, 'reports', 'ncert-provenance-integrity-cache');
const OFFICIAL = 'verified_official';
const base = 'https://ncert.nic.in/textbook/pdf/';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');
const db = createClient(url, key);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const words = new Map(['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty','twenty one','twenty two','twenty three','twenty four','twenty five','twenty six','twenty seven','twenty eight','twenty nine','thirty'].map((v, i) => [v, i + 1]));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/gi, ' ').trim().toLowerCase();
function levenshtein(a, b) { const rows = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i += 1) { let previous = rows[0]; rows[0] = i; for (let j = 1; j <= b.length; j += 1) { const current = rows[j]; rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; } } return rows[b.length]; }
function titleSimilarity(a, b) { const x = norm(a), y = norm(b); if (!x || !y) return 0; return 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1); }
function hasUsableStudentTitle(value) {
  const text = String(value || '').trim();
  return text.length >= 3 && !/[\uFFFD]|â€|\u0008/.test(text) && !/^of this textbook\b/i.test(text) && !/former\s*$/i.test(text);
}

function option(name, fallback = '') { const hit = process.argv.find((v) => v.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; }
function bookCodeFromUrl(value) { const m = String(value || '').match(/\/([a-z0-9]+?)(\d{2})\.pdf(?:$|[?#])/i); return m ? m[1].toLowerCase() : null; }
function ordinalFromUrl(value) { const m = String(value || '').match(/\/([a-z0-9]+?)(\d{2})\.pdf(?:$|[?#])/i); return m ? Number(m[2]) : null; }
function headingNumber(raw) { const v = norm(raw); if (/^\d+$/.test(v)) return Number(v); return words.get(v) || null; }
function confirmedPdfChapterNumber(sourceId) {
  const file = path.join(CHAPTER_CONFIRM_CACHE_DIR, `${Buffer.from(sourceId).toString('base64url')}.json`);
  if (!fs.existsSync(file)) return null;
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value?.identity?.chapterNumber ? String(value.identity.chapterNumber) : null; } catch { return null; }
}

function cachedPdfConfirmation(sourceId) {
  const file = path.join(CHAPTER_CONFIRM_CACHE_DIR, `${Buffer.from(sourceId).toString('base64url')}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { number: value?.identity?.chapterNumber ? String(value.identity.chapterNumber) : null, error: null, cached: true };
  } catch (error) { return { number: null, error: String(error?.message || error), cached: true }; }
}

function extractPrintedUnitNumber(pdf) {
  const temp = path.join(os.tmpdir(), `mindgains-chapter-confirm-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  try {
    fs.writeFileSync(temp, pdf);
    const script = "from pypdf import PdfReader;import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');r=PdfReader(sys.argv[1]);print('\\n'.join((p.extract_text() or '') for p in r.pages[:4]))";
    const result = spawnSync('python', ['-c', script, temp], { encoding: 'utf8', timeout: 30000, maxBuffer: 3 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(String(result.stderr || result.error || 'chapter PDF text extraction failed'));
    const lines = String(result.stdout || '').replace(/\r/g, '\n').split('\n').map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(?:chapter\s*)?(\d+|[a-z ]+?)(?:\s*chapter)?$/i);
      if (!match || !/chapter/i.test(line)) continue;
      const number = headingNumber(match[1]);
      if (number) return { chapterNumber: String(number), lines: lines.slice(Math.max(0, lines.indexOf(line) - 1), lines.indexOf(line) + 4) };
    }
    return { chapterNumber: null, lines: lines.slice(0, 12) };
  } finally { fs.rmSync(temp, { force: true }); }
}

async function ensurePdfConfirmation(sourceId, officialUrl) {
  const file = path.join(CHAPTER_CONFIRM_CACHE_DIR, `${Buffer.from(sourceId).toString('base64url')}.json`);
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { number: value?.identity?.chapterNumber ? String(value.identity.chapterNumber) : null, error: null, cached: true };
  }
  if (!officialUrl) return { number: null, error: 'missing_official_chapter_url', cached: false };
  try {
    const identity = extractPrintedUnitNumber(await fetchOfficial(officialUrl));
    fs.writeFileSync(file, JSON.stringify({ source_id: sourceId, official_url: officialUrl, fetched_at: new Date().toISOString(), identity }, null, 2));
    return { number: identity.chapterNumber, error: null, cached: false };
  } catch (error) {
    return { number: null, error: String(error?.message || error), cached: false };
  }
}

async function fetchOfficial(target) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const r = await fetch(target, { headers: { 'user-agent': 'MindGains-NCERT-TOC-Audit/1.0', accept: 'application/pdf' }, signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (error) { last = error; await sleep(1000 * (attempt + 1)); }
  }
  throw last;
}

function ocrPage(pdfPath, page) {
  const png = path.join(os.tmpdir(), `mindgains-toc-${process.pid}-${Date.now()}-${page}.png`);
  try {
    const render = "import fitz,sys;d=fitz.open(sys.argv[1]);p=d[int(sys.argv[2])];p.get_pixmap(matrix=fitz.Matrix(3.5,3.5),alpha=False).save(sys.argv[3])";
    const r = spawnSync('python', ['-c', render, pdfPath, String(page), png], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) throw new Error(String(r.stderr || r.error || 'page rendering failed'));
    const t = spawnSync('C:\\Program Files\\Tesseract-OCR\\tesseract.exe', [png, 'stdout', '-l', 'eng', '--psm', '6'], { encoding: 'utf8', timeout: 30000 });
    if (t.status !== 0) throw new Error(String(t.stderr || t.error || 'OCR failed'));
    return t.stdout;
  } finally { fs.rmSync(png, { force: true }); }
}

function extractTextPages(pdfPath) {
  const script = "import fitz,json,sys;d=fitz.open(sys.argv[1]);print(json.dumps([p.get_text('text') for p in d]))";
  const result = spawnSync('python', ['-c', script, pdfPath], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error || 'PDF text extraction failed'));
  return JSON.parse(result.stdout || '[]');
}

function parseToc(raw) {
  const lines = String(raw || '').replace(/\r/g, '\n').split('\n').map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chapters = [];
  for (let i = 0; i < lines.length; i += 1) {
    const inlineNumeric = lines[i].match(/^(chapter|theme|unit|lesson)\s*(\d+)\s+(.+?)(?:\s+\d+)?$/i);
    if (inlineNumeric) {
      const title = inlineNumeric[3].replace(/\s+\d+$/, '').trim();
      if (norm(title).length > 2) chapters.push({ canonical_unit_type: inlineNumeric[1].toLowerCase(), canonical_unit_number: inlineNumeric[2], canonical_unit_title: title });
      continue;
    }
    const m = lines[i].match(/^(chapter|theme|unit|lesson)\s*(\d+|[a-z ]+)$/i) || lines[i].match(/^(\d+)\s*(chapter|theme|unit|lesson)$/i);
    if (!m) continue;
    const unitType = (m[2] && /^\d/.test(m[1])) ? m[2].toLowerCase() : m[1].toLowerCase();
    const number = headingNumber((m[2] && /^\d/.test(m[1])) ? m[1] : m[2]);
    if (!number) continue;
    const candidate = lines.slice(i + 1, i + 5).find((x) => {
      const n = norm(x);
      return n.length > 2 && !/^\d+(\.\d+)?$/.test(n) && !/^chapter\b/.test(n) && !/^\d+\.\d+\b/.test(n) && !/^(contents|foreword|preface|answers|appendices)$/.test(n);
    });
    if (candidate) chapters.push({ canonical_unit_type: unitType, canonical_unit_number: String(number), canonical_unit_title: candidate.replace(/\s+\d+$/, '').trim() });
  }
  return chapters.filter((row, index, list) => list.findIndex((x) => x.canonical_unit_type === row.canonical_unit_type && x.canonical_unit_number === row.canonical_unit_number) === index);
}

function buildStructure(bookCode) {
  const cache = path.join(CACHE_DIR, `${bookCode}.json`);
  if (fs.existsSync(cache)) { const parsed = JSON.parse(fs.readFileSync(cache, 'utf8')); if (parsed.schema_version === 4) { if (parsed.failure) throw new Error(parsed.failure); return parsed; } }
  throw new Error(`cache_miss:${bookCode}`);
}

async function fetchStructure(bookCode, sample) {
  const cache = path.join(CACHE_DIR, `${bookCode}.json`);
  if (fs.existsSync(cache)) { const parsed = JSON.parse(fs.readFileSync(cache, 'utf8')); if (parsed.schema_version === 4) { if (parsed.failure) throw new Error(parsed.failure); return parsed; } }
  const pdfUrl = `${base}${bookCode}ps.pdf`;
  const pdf = await fetchOfficial(pdfUrl);
  const temp = path.join(os.tmpdir(), `mindgains-toc-${process.pid}-${Date.now()}-${bookCode}.pdf`);
  try {
    fs.writeFileSync(temp, pdf);
    const pageCountResult = spawnSync('python', ['-c', "import fitz,sys;print(fitz.open(sys.argv[1]).page_count)", temp], { encoding: 'utf8', timeout: 30000 });
    const pageCount = Number(String(pageCountResult.stdout || '').trim());
    if (!Number.isFinite(pageCount) || pageCount < 1) throw new Error('could_not_read_book_pdf');
    const extracted = extractTextPages(temp);
    let pages = extracted.map((text, page) => ({ page, text })).filter(({ text }) => /\bcontents\b/i.test(text) || /\b(?:chapter|theme|unit|lesson)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i.test(text));
    let chapters = parseToc(pages.map((x) => x.text).join('\n'));
    let evidenceMode = 'official_pdf_text';
    if (!chapters.length) {
      pages = [];
      // OCR is a fallback only when the official PDF has an unusable text layer.
      for (let p = 0; p < pageCount; p += 1) {
        const text = ocrPage(temp, p);
        if (/\bcontents\b/i.test(text) || /\b(?:chapter|theme|unit|lesson)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i.test(text)) pages.push({ page: p, text });
      }
      chapters = parseToc(pages.map((x) => x.text).join('\n'));
      evidenceMode = 'official_pdf_ocr_fallback';
    }
    if (!chapters.length) throw new Error('official_toc_not_parseable');
    const record = {
      schema_version: 4,
      book_code: bookCode,
      official_book_structure_url: pdfUrl,
      fetched_at: new Date().toISOString(),
      sample: { class_level: sample.class_level, subject: sample.subject, book_title: sample.book_title, volume_or_part: sample.volume_or_part },
      chapters,
      evidence_pages: pages.map((x) => x.page),
      evidence_mode: evidenceMode,
    };
    fs.writeFileSync(cache, JSON.stringify(record, null, 2));
    return record;
  } catch (error) {
    const message = String(error?.message || error);
    fs.writeFileSync(cache, JSON.stringify({ schema_version: 4, book_code: bookCode, fetched_at: new Date().toISOString(), failure: message }, null, 2));
    throw error;
  } finally { fs.rmSync(temp, { force: true }); }
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('Read-only audit: --apply is deliberately blocked.');
  fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.mkdirSync(OUT_DIR, { recursive: true });
  const [{ data: docs, error: docError }, { data: chapters, error: chapterError }] = await Promise.all([
    db.from('textbook_source_documents').select('source_id,class_level,subject,book_title,volume_or_part,official_source_url,field_provenance').eq('board','ncert'),
    db.from('textbook_source_chapters').select('source_id,chapter_number,chapter_title,field_provenance,verification_status').eq('verification_status', OFFICIAL),
  ]);
  if (docError) throw docError; if (chapterError) throw chapterError;
  const docsBySource = new Map((docs || []).map((x) => [x.source_id, x]));
  const rows = (chapters || []).filter((x) => x.field_provenance?.chapter_title === OFFICIAL).map((chapter) => ({ chapter, doc: docsBySource.get(chapter.source_id) })).filter((x) => x.doc);
  const byBook = new Map();
  for (const row of rows) { const code = bookCodeFromUrl(row.doc.official_source_url); if (!code) continue; if (!byBook.has(code)) byBook.set(code, []); byBook.get(code).push(row); }
  const codes = [...byBook.keys()].sort(); const requestedBook = option('book'); const start = Number(option('start', '0')); const limit = Number(option('limit', String(codes.length))); const chosen = requestedBook ? codes.filter((code) => code === requestedBook) : codes.slice(start, start + limit);
  const structures = {}; const bookFailures = {}; let bookCursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, chosen.length) }, async () => {
    while (bookCursor < chosen.length) {
      const code = chosen[bookCursor++];
      try { structures[code] = await fetchStructure(code, byBook.get(code)[0].doc); }
      catch (e) { bookFailures[code] = String(e.message || e); }
    }
  }));
  const confirmationBySource = new Map(); let confirmationCursor = 0;
  // This pass is TOC-first. Reuse prior exact-PDF confirmations where present;
  // do not turn a missing machine-readable PDF heading into an expensive or
  // speculative per-record fetch. Multipart records without that confirmation
  // remain PARSER_REVIEW rather than being ordinal-mapped.
  const confirmationTargets = [];
  await Promise.all(Array.from({ length: Math.min(4, confirmationTargets.length) }, async () => {
    while (confirmationCursor < confirmationTargets.length) {
      const { chapter, doc } = confirmationTargets[confirmationCursor++];
      confirmationBySource.set(chapter.source_id, await ensurePdfConfirmation(chapter.source_id, doc.official_source_url));
    }
  }));
  const records = [];
  for (const code of chosen) for (const { chapter, doc } of byBook.get(code)) {
    const ordinal = ordinalFromUrl(doc.official_source_url);
    const confirmation = confirmationBySource.get(chapter.source_id) || cachedPdfConfirmation(chapter.source_id) || { number: null, error: null, cached: false };
    const pdfPrintedNumber = confirmation?.number || null;
    const structure = structures[code];
    const canonicalUnits = structure?.chapters || [];
    const unitTypes = new Set(canonicalUnits.map((x) => x.canonical_unit_type));
    // Ordinal is a document-location clue, never a canonical number. It can
    // bridge to a TOC only where that TOC has one coherent official unit series.
    const ordinalSeries = unitTypes.size === 1
      ? [...canonicalUnits].sort((a, b) => Number(a.canonical_unit_number) - Number(b.canonical_unit_number))
      : [];
    const hasVerifiedOfficialDocumentUrl = doc.field_provenance?.official_source_url === OFFICIAL;
    const ordinalOfficial = hasVerifiedOfficialDocumentUrl && !doc.volume_or_part && ordinal && ordinalSeries.length >= ordinal ? ordinalSeries[ordinal - 1] : null;
    const official = pdfPrintedNumber
      ? structure?.chapters?.find((x) => x.canonical_unit_number === pdfPrintedNumber)
      : ordinalOfficial;
    const mappingMethod = pdfPrintedNumber
      ? 'official_pdf_printed_unit_number_to_official_book_structure'
      : (ordinalOfficial ? 'verified_official_document_url_ordinal_to_official_book_structure' : null);
    let status = 'RETRY_REQUIRED';
    if (!structure) status = /fetch|HTTP|abort|ECONN|cache_miss/i.test(bookFailures[code] || '') ? 'RETRY_REQUIRED' : 'PARSER_REVIEW';
    else if (!pdfPrintedNumber && !ordinalOfficial) status = confirmation?.error ? 'RETRY_REQUIRED' : 'PARSER_REVIEW';
    // An omitted unit in a parsed TOC is a parser-coverage limitation, not an
    // authoritative contradiction. Reserve AUTHORITATIVE_AMBIGUITY for a
    // future explicit conflict between two official records.
    else if (!official || !hasUsableStudentTitle(official.canonical_unit_title)) status = 'PARSER_REVIEW';
    else {
      const similarity = titleSimilarity(chapter.chapter_title, official.canonical_unit_title);
      if (norm(chapter.chapter_number) === norm(official.canonical_unit_number) && similarity >= 0.86) status = 'VERIFIED_UNCHANGED';
      // A low-similarity title is a correction candidate only when the TOC also
      // establishes the document's canonical number. The raw official TOC text
      // remains in cache for manual confirmation before any later catalog write.
      else status = 'CORRECTABLE';
      records.push({ source_id: chapter.source_id, book_code: code, document_ordinal: ordinal || null, pdf_printed_chapter_number: pdfPrintedNumber, current_chapter_number: chapter.chapter_number, current_chapter_title: chapter.chapter_title, canonical_unit_type: official?.canonical_unit_type || null, canonical_unit_number: official?.canonical_unit_number || null, canonical_unit_title: official?.canonical_unit_title || null, mapping_method: mappingMethod, title_similarity: similarity, official_book_structure_url: structure?.official_book_structure_url || null, official_chapter_url: doc.official_source_url || null, official_chapter_url_provenance: doc.field_provenance?.official_source_url || null, pdf_confirmation_cached: confirmation?.cached || false, status, failure: bookFailures[code] || confirmation?.error || null, class_level: doc.class_level, subject: doc.subject, book_title: doc.book_title, volume_or_part: doc.volume_or_part });
      continue;
    }
    records.push({ source_id: chapter.source_id, book_code: code, document_ordinal: ordinal || null, pdf_printed_chapter_number: pdfPrintedNumber, current_chapter_number: chapter.chapter_number, current_chapter_title: chapter.chapter_title, canonical_unit_type: official?.canonical_unit_type || null, canonical_unit_number: official?.canonical_unit_number || null, canonical_unit_title: official?.canonical_unit_title || null, mapping_method: mappingMethod, title_similarity: titleSimilarity(chapter.chapter_title, official?.canonical_unit_title), official_book_structure_url: structure?.official_book_structure_url || null, official_chapter_url: doc.official_source_url || null, official_chapter_url_provenance: doc.field_provenance?.official_source_url || null, pdf_confirmation_cached: confirmation?.cached || false, status, failure: bookFailures[code] || confirmation?.error || null, class_level: doc.class_level, subject: doc.subject, book_title: doc.book_title, volume_or_part: doc.volume_or_part });
  }
  const report = { generated_at: new Date().toISOString(), strategy: 'official_book_toc_first_then_exact_official_chapter_document', start, limit, selected_book_codes: chosen, structures_cached: Object.keys(structures).length, book_failures: bookFailures, records };
  const batchKey = chosen.length ? chosen.join('_') : `empty-${start}`;
  fs.writeFileSync(path.join(OUT_DIR, `batch-${batchKey}.json`), JSON.stringify(report, null, 2));
  const statuses = records.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(JSON.stringify({ selected_book_codes: chosen.length, structures_cached: Object.keys(structures).length, book_failures: bookFailures, records: records.length, statuses }, null, 2));
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
