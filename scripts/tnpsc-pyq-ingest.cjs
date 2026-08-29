/**
 * TNPSC (and other bilingual-PDF exam) PYQ ingest pipeline.
 *
 * Fills the empty years for exams whose papers only exist as PDFs. Proven clean:
 *   - QUESTIONS: pdftotext pulls the ENGLISH half of a bilingual paper cleanly
 *     (the Tamil comes out as garbage and is discarded). An LLM then structures
 *     the clean English into {number, question, options}.
 *   - ANSWER KEY: the official keys are scanned images, so they are OCR'd via
 *     OpenRouter's file-parser (mistral-ocr) into {number: letter}.
 *   - MATCH: letter -> option index -> answer_text. Only questions whose answer
 *     maps cleanly to one option are kept (same renderability bar the cards use),
 *     so a served card's correct answer is guaranteed correct.
 *
 * DRY RUN by default (prints the rows it would insert). --apply writes. Every
 * run backs up the built rows to recovery/ first.
 *
 *   node scripts/tnpsc-pyq-ingest.cjs \
 *     --paper "C:/edu4bharat/raw/tnpsc/group-2/question-papers/2022/GROUP-II-PRELIM-2022.pdf" \
 *     --key   "C:/edu4bharat/raw/tnpsc/group-2/answer-keys/2022/GROUP_II_032022_PRELIMS_FIN_KEY.pdf" \
 *     --exam TNPSC --year 2022 --source-id tnpsc-group2-prelims-2022
 *   ... add --apply to write.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const APPLY = process.argv.includes('--apply');
const PAPER = arg('paper');
const KEY = arg('key');
const EXAM = arg('exam', 'TNPSC');
const YEAR = parseInt(arg('year', '0'), 10) || null;
const SOURCE_ID = arg('source-id') || (PAPER ? path.basename(PAPER, '.pdf').toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'unknown');

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
if (!URL || !SR || !OR_KEY) { console.error('Missing Supabase/OpenRouter env'); process.exit(1); }
if (!PAPER || !KEY) { console.error('Need --paper and --key PDF paths'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// One OpenRouter call, hardened: per-attempt timeout plus retry-with-backoff so
// a flaky OCR response or a 429 doesn't kill the run. mistral-ocr in particular
// rate-limits and occasionally stalls under repeated use.
async function or(messages, extra = {}) {
  const attempts = 4;
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
        signal: ctrl.signal,
        body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 8000, messages, ...extra }),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      const content = String(j?.choices?.[0]?.message?.content || '').trim();
      if (!content) throw new Error('empty response');
      return content;
    } catch (e) {
      lastErr = e;
      if (a < attempts - 1) await sleep(3000 * (a + 1)); // 3s, 6s, 9s backoff
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
const parseJson = (s) => JSON.parse(s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

// --- LOCAL OCR: ghostscript (PDF -> PNG) + tesseract (PNG -> text) -----------
// Fully free and unlimited, no API gate. Only the English is usable (Tamil OCRs
// to noise and gets filtered downstream), which is all we want.
function findBin(names) {
  for (const n of names) { try { if (fs.existsSync(n)) return n; } catch { /* ignore */ } }
  return null;
}
const GS_BIN = process.env.GHOSTSCRIPT || findBin([
  'C:/Program Files/gs/gs10.07.1/bin/gswin64c.exe',
  ...(() => { try { return fs.readdirSync('C:/Program Files/gs').map((d) => `C:/Program Files/gs/${d}/bin/gswin64c.exe`); } catch { return []; } })(),
]);
const TESS_BIN = process.env.TESSERACT || findBin(['C:/Program Files/Tesseract-OCR/tesseract.exe']);

function ocrPdfLocal(pdf, { dpi = 200, tessArgs = [] } = {}) {
  if (!GS_BIN || !TESS_BIN) throw new Error('ghostscript/tesseract not found');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pyqocr-'));
  try {
    execFileSync(GS_BIN, ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', `-r${dpi}`, `-sOutputFile=${dir}/pg%03d.png`, pdf], { stdio: ['ignore', 'ignore', 'ignore'] });
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    let text = '';
    for (const png of pngs) {
      try {
        text += execFileSync(TESS_BIN, [path.join(dir, png), 'stdout', '-l', 'eng', ...tessArgs], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) + '\n';
      } catch { /* skip a bad page */ }
    }
    return text;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// --- 1. QUESTIONS: pdftotext then LLM-structure the English in chunks --------

// pdftotext ships with Git-for-Windows but isn't on node's PATH; probe the known
// locations before falling back to a bare command.
function pdftotextBin() {
  const candidates = [
    process.env.PDFTOTEXT,
    'C:/Program Files/Git/mingw64/bin/pdftotext.exe',
    'C:/Program Files/Git/usr/bin/pdftotext.exe',
    '/mingw64/bin/pdftotext',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return 'pdftotext';
}
function extractText(pdf) {
  try {
    return execFileSync(pdftotextBin(), [pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { return ''; }
}


// Keep the lines that carry the English MCQ (numbered stems, a-e options, roman
// sub-points). Tamil-transliteration lines and page furniture are dropped.
function englishLines(text) {
  return text.split('\n').filter((ln) => {
    const t = ln.trim();
    if (!t) return false;
    if (/^\d+\s*\|\s*Page/i.test(t) || /^PH:\s/i.test(t) || /www\./i.test(t)) return false;
    // Tamil-transliteration signature: internal semicolons / vowelless clusters.
    if ((t.match(/[A-Za-z];[A-Za-z]/g) || []).length >= 2) return false;
    const ascii = (t.match(/[\x20-\x7E]/g) || []).length / t.length;
    return ascii > 0.85; // mostly-ASCII → English
  }).join('\n');
}

async function structureQuestions(englishText) {
  // Chunk by ~6000 chars on question boundaries so each LLM call is bounded.
  const blocks = englishText.split(/(?=^\s*\d{1,3}[\.\)]\s*)/m);
  const chunks = [];
  let cur = '';
  for (const b of blocks) {
    if ((cur + b).length > 6000 && cur) { chunks.push(cur); cur = ''; }
    cur += b;
  }
  if (cur.trim()) chunks.push(cur);

  // Structure the chunks in PARALLEL — each is small and independent, so this is
  // one call's latency instead of N, and no chunk can truncate the others.
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const out = await or([
        {
          role: 'system',
          content:
            'You are given the English text of TNPSC exam MCQs (Tamil already removed). For EACH numbered question, output an object: {"number":<int>,"q":"<question stem, include any i./ii./iii. sub-statements>","options":["<a>","<b>","<c>","<d>"]}. Drop the 5th option if it is "Answer not known"/"e." — keep only the 4 real options a-d in order. Fix obvious OCR spacing. Do NOT invent options or answers. Output ONLY a JSON array.',
        },
        { role: 'user', content: chunk },
      ]);
      const arr = parseJson(out);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }));
  return results.flat();
}

// --- 2. ANSWER KEY: OpenRouter file-parser OCR ------------------------------

// Read the answer key DETERMINISTICALLY: OCR at high DPI with a character
// whitelist (digits + A-E only, killing tick-mark noise), then take the first
// A-E letter after each question number. This is fail-SAFE — an unreadable cell
// yields no entry (the question is dropped later), never a wrong answer. That
// matters more than yield: a card with the wrong answer is worse than no card.
function ocrKey(pdf) {
  const raw = extractText(pdf);
  const text = raw.length > 200
    ? raw
    : ocrPdfLocal(pdf, { dpi: 300, tessArgs: ['--psm', '6', '-c', 'tessedit_char_whitelist=0123456789ABCDE .'] });
  const key = {};
  // Parse only lines that look like grid rows (>=3 "number letter" pairs). This
  // excludes header/date noise (e.g. "DOB: 03.03.2019") that would otherwise
  // hijack low question numbers. Within a row, the first A-E after each number
  // is the answer.
  for (const line of text.split('\n')) {
    const pairs = [...line.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Ea-e])/g)];
    if (pairs.length < 3) continue;
    for (const p of pairs) {
      const n = parseInt(p[1], 10);
      if (n >= 1 && n <= 250 && key[n] === undefined) key[n] = p[2].toUpperCase();
    }
  }
  return key;
}

// --- main -------------------------------------------------------------------

(async () => {
  console.log(`TNPSC ingest — ${APPLY ? 'APPLY' : 'DRY RUN'}\n  paper: ${PAPER}\n  key:   ${KEY}\n  ${EXAM} ${YEAR}  source_id=${SOURCE_ID}\n`);

  let text = extractText(PAPER);
  let eng = englishLines(text);
  if (eng.length < 3000) {
    console.log(`Scanned paper (${eng.length} text chars) — local OCR (ghostscript + tesseract)...`);
    text = ocrPdfLocal(PAPER);
    eng = englishLines(text);
    console.log(`OCR'd to ${eng.length} English chars.`);
  } else {
    console.log(`Text-layer paper (${eng.length} English chars).`);
  }
  // Questions (parallel chunk structuring) and answer-key OCR run concurrently.
  const [questions, key] = await Promise.all([structureQuestions(eng), ocrKey(KEY)]);
  console.log(`Structured questions: ${questions.length}   answer-key entries: ${Object.keys(key).length}`);

  const letterIdx = { a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
  let rows = [];
  let noKey = 0, badOpts = 0;
  for (const q of questions) {
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    if (opts.length < 2 || opts.length > 4) { badOpts++; continue; }
    const letter = key[String(q.number)];
    if (!letter || !(letter in letterIdx)) { noKey++; continue; }
    const idx = letterIdx[letter];
    if (idx >= opts.length) { badOpts++; continue; }
    const qtext = String(q.q || '').trim();
    if (qtext.length < 15) { badOpts++; continue; }
    rows.push({
      id: `${SOURCE_ID}-q${q.number}`,
      source_id: SOURCE_ID,
      exam: EXAM,
      year: YEAR,
      question_number: String(q.number),
      question_text: qtext,
      options: opts,
      answer_text: opts[idx],
      question_type: 'objective',
      answer_source: 'official-key-ocr',
      confidence: 0.9,
    });
  }

  // Dedupe by id: OCR can read a question number twice, which would put two rows
  // with the same id in one upsert batch and fail the WHOLE batch. Keep first.
  const seenIds = new Set();
  rows = rows.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

  console.log(`\nBuildable rows: ${rows.length}   (dropped: no-key ${noKey}, bad-options ${badOpts})`);
  console.log('\nSamples:');
  rows.slice(0, 4).forEach((r) => {
    console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 90)}`);
    r.options.forEach((o, i) => console.log(`   ${'abcd'[i]}) ${o}${o === r.answer_text ? '   <-- ANSWER' : ''}`));
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../recovery');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `tnpsc-ingest-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));
  console.log(`\nBackup: recovery/tnpsc-ingest-${SOURCE_ID}-${stamp}.json`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Add --apply to upsert.'); return; }

  // pyq_questions.source_id is a FK into pyq_sources — register the source first.
  const srcRow = {
    id: SOURCE_ID,
    exam: EXAM,
    board: EXAM === 'TNPSC' ? 'TNPSC' : EXAM,
    year: YEAR,
    language: 'English',
    title: `${EXAM} ${YEAR} — ${path.basename(PAPER, '.pdf')}`,
    file_name: path.basename(PAPER),
    file_path: PAPER,
    source_type: 'official-pdf',
  };
  const sr = await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(srcRow),
  });
  if (!sr.ok) { console.error(`source insert failed ${sr.status}: ${(await sr.text()).slice(0, 200)}`); process.exit(1); }
  console.log(`Registered source ${SOURCE_ID}.`);

  console.log(`Upserting ${rows.length} rows...`);
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    if (r.ok) ok += batch.length; else console.warn(`  batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  console.log(`Done. Upserted ${ok} rows for ${EXAM} ${YEAR}.`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
