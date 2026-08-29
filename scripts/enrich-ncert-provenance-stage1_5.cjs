/*
 * Stage 1.5: NCERT official provenance enrichment.
 *
 * Evidence chain per accepted mapping:
 *  1. NCERT's official textbook catalogue identifies the English book and code.
 *  2. The matching official NCERT chapter PDF identifies its printed chapter
 *     number and title.
 *
 * A source_id is used only as an operational candidate. Ambiguous candidates,
 * failed downloads, and PDFs without a printed matching chapter heading are
 * deliberately left unresolved.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const OFFICIAL_CATALOG_URL = 'https://ncert.nic.in/textbook.php?ln=en';
const PDF_BASE = 'https://ncert.nic.in/textbook/pdf/';
const OFFICIAL = 'verified_official';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Supabase service credentials are required.');
const supabase = createClient(url, serviceKey);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalise = (value) => String(value || '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');
const sourceSlug = (value) => normalise(value).replace(/ /g, '-');
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function levenshtein(a, b) {
  const rows = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = rows[0]; rows[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return rows[b.length];
}

async function fetchWithRetry(target, binary = false) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(target, { headers: { 'user-agent': 'MindGains-Provenance-Audit/1.0' }, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function parseCatalogue(html) {
  const books = [];
  const blocks = html.matchAll(/else if\(\(document\.test\.tclass\.value==(\d+)\) && \(document\.test\.tsubject\.options\[sind\]\.text=="([^"]+)"\)\)\s*\{([\s\S]*?)\n\s*\}/g);
  for (const match of blocks) {
    const [, classText, subject, body] = match;
    const options = body.matchAll(/options\[(\d+)]\.text="([^"]+)"\s*;\s*document\.test\.tbook\.options\[\1]\.value="textbook\.php\?([a-z0-9]+)=0-(\d+)"/g);
    for (const option of options) {
      const [, index, title, code, chapterCount] = option;
      // NCERT's code convention uses e as the second character for English
      // editions (for example jemh1 and keph1). The label/code come directly
      // from NCERT's own catalogue.
      if (index === '0' || code[1]?.toLowerCase() !== 'e' || !/[a-z]/i.test(title)) continue;
      books.push({
        class_level: Number(classText),
        subject: normalise(subject),
        title: title.trim(),
        code: code.toLowerCase(),
        chapter_count: Number(chapterCount),
      });
    }
  }
  return books;
}

function parseOperationalSource(doc) {
  const languageCode = ({ english: 'en', hindi: 'hi', urdu: 'ur' })[String(doc.language).toLowerCase()] || doc.language;
  const expression = new RegExp(`^ncert-class-${doc.class_level}-${escapeRegExp(doc.subject)}-(.+)-${escapeRegExp(languageCode)}-chapter-(\\d+)-pdf$`);
  const match = doc.source_id.match(expression);
  if (!match) return null;
  return { book_slug: match[1], chapter_number: String(Number(match[2])) };
}

function chooseOfficialBook(doc, operation, books) {
  const candidates = books.filter((book) => book.class_level === doc.class_level && book.subject === normalise(doc.subject));
  const wanted = normalise(operation.book_slug);
  const scored = candidates.map((book) => ({ ...book, distance: levenshtein(wanted, normalise(book.title)) / Math.max(wanted.length, normalise(book.title).length, 1) }))
    .sort((a, b) => a.distance - b.distance);
  const best = scored[0];
  const second = scored[1];
  // Only deterministic or near-exact catalogue candidates are accepted. The
  // operational source ID never becomes display metadata by itself.
  if (!best || best.distance > 0.18 || (second && (second.distance - best.distance) < 0.05)) return null;
  return best;
}

function readOfficialChapter(pdfBuffer, officialUrl, expectedChapter) {
  const tempPath = path.join(os.tmpdir(), `mindgains-ncert-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  try {
    fs.writeFileSync(tempPath, pdfBuffer);
    const python = [
      'from pypdf import PdfReader',
      'import sys',
      'sys.stdout.reconfigure(encoding="utf-8", errors="replace")',
      'r=PdfReader(sys.argv[1])',
      'print(r.pages[0].extract_text() or "")',
    ].join('; ');
    const result = spawnSync('python', ['-c', python, tempPath], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error(`official PDF text extraction failed: ${result.stderr || result.error || 'unknown error'}`);
    const lines = result.stdout.replace(/\r/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    const word = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN','TWENTY'][Number(expectedChapter) - 1] || '';
    const isGeneric = (value) => /^(?:\d+\s+)?(?:mathema\s*tics|science|social science|physics|chemistry|biology|reprint(?:\s+\d{4}(?:-\d{2})?)?)$/i.test(value);
    let rawTitle = null;
    if (new RegExp(`^CHAPTER\\s+(?:${expectedChapter}|${word})$`, 'i').test(lines[0])) rawTitle = lines[1];
    else {
      const openingLine = lines[0].replace(/\s+\d+$/, '');
      if (!isGeneric(openingLine)) rawTitle = openingLine;
      // Some NCERT PDFs carry a book/page header at the top and print the
      // chapter title as the final all-caps label on the opening page.
      if (!rawTitle) {
        const indexes = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^[A-Z][A-Z ,&'’()–—-]{2,}$/.test(line) && !isGeneric(line));
        const last = indexes.at(-1);
        if (last) {
          const previous = indexes.at(-2);
          rawTitle = previous && previous.index === last.index - 1 ? `${previous.line} ${last.line}` : last.line;
        }
      }
    }
    const title = rawTitle?.trim().replace(/\s+/g, ' ');
    // The title must be in the opening PDF block and must not be a running
    // book/page header. This intentionally rejects uncertain layouts.
    if (!title || !/[a-z]/i.test(title) || /^contents?$/i.test(title) || isGeneric(title) || /\d/.test(title)) return null;
    return { chapter_title: title, official_source_url: officialUrl };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

async function fetchAllDocuments() {
  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await supabase.from('textbook_source_documents')
      .select('source_id,board,class_level,subject,language,book_title,volume_or_part,official_source_url,verification_status,field_provenance,metadata_source')
      .eq('board', 'ncert').order('source_id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitFlag = process.argv.find((arg) => arg.startsWith('--limit='));
  const offsetFlag = process.argv.find((arg) => arg.startsWith('--offset='));
  const limit = limitFlag ? Number(limitFlag.slice('--limit='.length)) : null;
  const offset = offsetFlag ? Number(offsetFlag.slice('--offset='.length)) : 0;
  const catalogue = parseCatalogue(await fetchWithRetry(OFFICIAL_CATALOG_URL));
  if (catalogue.length < 40) throw new Error(`Official NCERT catalogue parse was incomplete (${catalogue.length} English books).`);
  const allDocs = await fetchAllDocuments();
  const docs = Number.isInteger(limit) && limit > 0 ? allDocs.slice(offset, offset + limit) : allDocs.slice(offset);
  if (!limit && offset === 0 && docs.length !== 484) throw new Error(`Expected 484 NCERT catalog documents, found ${docs.length}.`);
  const { data: existingChapters, error: existingChaptersError } = await supabase
    .from('textbook_source_chapters').select('source_id,chapter_key');
  if (existingChaptersError) throw existingChaptersError;
  const existingChapterKeyBySource = new Map((existingChapters || []).map((row) => [row.source_id, row.chapter_key]));

  const accepted = [];
  const problems = [];
  async function verifyDocument(doc) {
    const operation = parseOperationalSource(doc);
    if (!operation) { problems.push({ source_id: doc.source_id, reason: 'unparseable_operational_source_id' }); return; }
    const book = chooseOfficialBook(doc, operation, catalogue);
    if (!book) { problems.push({ source_id: doc.source_id, reason: 'ambiguous_or_unmatched_official_book' }); return; }
    if (Number(operation.chapter_number) > book.chapter_count) { problems.push({ source_id: doc.source_id, reason: 'chapter_exceeds_official_book_count', book: book.title }); return; }
    const chapterCode = `${book.code}${String(Number(operation.chapter_number)).padStart(2, '0')}`;
    const officialUrl = `${PDF_BASE}${chapterCode}.pdf`;
    try {
      const chapter = readOfficialChapter(await fetchWithRetry(officialUrl, true), officialUrl, operation.chapter_number);
      if (!chapter) { problems.push({ source_id: doc.source_id, reason: 'official_pdf_missing_matching_printed_chapter_heading', official_url: officialUrl }); return; }
      accepted.push({ doc, operation, book, chapter });
    } catch (error) {
      problems.push({ source_id: doc.source_id, reason: 'official_pdf_fetch_or_parse_failed', detail: error.message, official_url: officialUrl });
    }
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, docs.length) }, async () => {
    while (cursor < docs.length) {
      const doc = docs[cursor++];
      await verifyDocument(doc);
      await sleep(150);
    }
  }));

  if (!dryRun && accepted.length) {
    const documentRows = accepted.map(({ doc, book }) => ({
      source_id: doc.source_id,
      // These values are now taken from the official NCERT catalogue record that
      // selected this exact English chapter PDF.  The source_id was used only to
      // locate a candidate; it is not the authority for any display field.
      board: 'ncert',
      class_level: book.class_level,
      subject: book.subject,
      language: 'english',
      book_title: book.title,
      volume_or_part: /\bpart[- ]?(i|ii|iii|iv|v|\d+)\b/i.test(book.title) ? book.title.match(/\bpart[- ]?(i|ii|iii|iv|v|\d+)\b/i)[0].replace('-', ' ') : null,
      official_source_url: `${PDF_BASE}${book.code}${String(Number(parseOperationalSource(doc).chapter_number)).padStart(2, '0')}.pdf`,
      verification_status: doc.verification_status,
      field_provenance: {
        ...doc.field_provenance,
        board: OFFICIAL,
        class_level: OFFICIAL,
        subject: OFFICIAL,
        language: OFFICIAL,
        document_scope: OFFICIAL,
        book_title: OFFICIAL,
        volume_or_part: /\bpart[- ]?(i|ii|iii|iv|v|\d+)\b/i.test(book.title) ? OFFICIAL : 'unverified',
        official_source_url: OFFICIAL,
      },
      metadata_source: { ...doc.metadata_source, official_ncert_catalogue: OFFICIAL_CATALOG_URL, official_chapter_pdf: `${PDF_BASE}${book.code}${String(Number(parseOperationalSource(doc).chapter_number)).padStart(2, '0')}.pdf` },
      updated_at: new Date().toISOString(),
    }));
    const chapterRows = accepted.map(({ doc, operation, chapter }) => ({
      source_id: doc.source_id, chapter_key: existingChapterKeyBySource.get(doc.source_id) || 'official-ncert-chapter', chapter_number: operation.chapter_number, chapter_title: chapter.chapter_title,
      verification_status: OFFICIAL,
      field_provenance: { chapter_number: OFFICIAL, chapter_title: OFFICIAL, unit_number: 'unverified', unit_title: 'unverified', page_start: 'unverified', page_end: 'unverified' },
      metadata_source: { kind: 'official_ncert_chapter_pdf', official_catalogue: OFFICIAL_CATALOG_URL, official_chapter_pdf: chapter.official_source_url },
      updated_at: new Date().toISOString(),
    }));
    const { error: docsError } = await supabase.from('textbook_source_documents').upsert(documentRows, { onConflict: 'source_id' });
    if (docsError) throw docsError;
    const { error: chaptersError } = await supabase.from('textbook_source_chapters').upsert(chapterRows, { onConflict: 'source_id,chapter_key' });
    if (chaptersError) throw chaptersError;
  }
  const summary = { stage: 'NCERT verified provenance Stage 1.5', dry_run: dryRun, offset, official_catalogue_books_parsed: catalogue.length, live_ncert_source_ids_processed: docs.length, official_mappings_accepted: accepted.length, unresolved_or_rejected: problems.length, problems };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
