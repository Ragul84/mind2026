/**
 * UPSC Civil Services Prelims (GS Paper I) PYQ ingest.
 *
 * Adapts the TNPSC pipeline for UPSC's English-only, text-layer papers:
 *   - QUESTIONS: pdftotext (UPSC prelims PDFs carry a clean text layer; OCR only
 *     as a fallback for scanned scans). An LLM structures each numbered MCQ into
 *     {number, q, options}. Uses aiand (data-script provider), not the app's AI.
 *   - ANSWER KEY: NOT OCR'd here. The user chose CROSS-VERIFIED keys — so the key
 *     is supplied as an auditable JSON { "<number>": "A|B|C|D" } that is built
 *     separately from 2+ agreeing public sources (agreement-only, disagreements
 *     dropped). Keeping that step out of this script keeps verification auditable.
 *   - MATCH: letter -> option index -> answer_text. A question is kept only when
 *     its number has a cross-verified answer that maps cleanly onto one option.
 *
 * The key JSON MUST correspond to the SAME booklet series as the paper PDF
 * (UPSC shuffles A/B/C/D), otherwise numbers won't align — the builder records
 * the series it verified.
 *
 * DRY RUN by default. --apply writes. Every run backs up built rows to recovery/.
 *
 *   node scripts/upsc-pyq-ingest.cjs \
 *     --paper tmp-pyq/upsc/2015-gs1-paper.pdf \
 *     --key-json tmp-pyq/upsc/2015-key.json \
 *     --year 2015 --series A --source-id upsc-cse-prelims-2015-gs1
 *   ... add --apply to write.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const APPLY = process.argv.includes('--apply');
const PAPER = arg('paper');
const KEY_JSON = arg('key-json');
const EXAM = arg('exam', 'UPSC');
const YEAR = parseInt(arg('year', '0'), 10) || null;
const SERIES = arg('series', 'A');
const SOURCE_ID = arg('source-id') || (PAPER ? `upsc-cse-prelims-${YEAR}-gs1` : 'unknown');

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AIAND_KEY = process.env.AIAND_API_KEY;
const MODEL = arg('model', process.env.AIAND_MODEL || 'deepseek-ai/deepseek-v4-flash');
if (!URL || !SR || !AIAND_KEY) { console.error('Missing env (need AIAND_API_KEY)'); process.exit(1); }
if (!PAPER || !KEY_JSON) { console.error('Need --paper PDF and --key-json path'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// aiand.com (Anthropic /v1/messages). Split system out as Anthropic expects.
async function ai(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  for (let a = 0; a < 4; a++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const r = await fetch('https://api.aiand.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': AIAND_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, temperature: 0, system, messages: msgs }),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`aiand ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const c = String((await r.json())?.content?.[0]?.text || '').trim();
      if (!c) throw new Error('empty'); return c;
    } catch (e) { if (a === 3) throw e; await sleep(2500 * (a + 1)); } finally { clearTimeout(timer); }
  }
}
const parseJson = (s) => JSON.parse(s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

function pdftotextBin() {
  for (const c of [process.env.PDFTOTEXT, 'C:/Program Files/Git/mingw64/bin/pdftotext.exe', '/mingw64/bin/pdftotext'].filter(Boolean)) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'pdftotext';
}
function extractText(pdf) {
  try { return execFileSync(pdftotextBin(), ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}

// Local OCR fallback (ghostscript + tesseract) for the rare scanned UPSC PDF.
function findBin(names) { for (const n of names) { try { if (fs.existsSync(n)) return n; } catch { /* ignore */ } } return null; }
const GS_BIN = process.env.GHOSTSCRIPT || findBin((() => { try { return fs.readdirSync('C:/Program Files/gs').map((d) => `C:/Program Files/gs/${d}/bin/gswin64c.exe`); } catch { return []; } })());
const TESS_BIN = process.env.TESSERACT || findBin(['C:/Program Files/Tesseract-OCR/tesseract.exe']);
function ocrPdfLocal(pdf, dpi = 300) {
  if (!GS_BIN || !TESS_BIN) throw new Error('ghostscript/tesseract not found');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'upscocr-'));
  try {
    execFileSync(GS_BIN, ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', `-r${dpi}`, `-sOutputFile=${dir}/pg%03d.png`, pdf], { stdio: ['ignore', 'ignore', 'ignore'] });
    let text = '';
    for (const png of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
      try { text += execFileSync(TESS_BIN, [path.join(dir, png), 'stdout', '-l', 'eng'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) + '\n'; } catch { /* skip */ }
    }
    return text;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

async function structureQuestions(text) {
  const blocks = text.split(/(?=^\s*\d{1,3}\.\s)/m);
  const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + b).length > 6000 && cur) { chunks.push(cur); cur = ''; } cur += b; }
  if (cur.trim()) chunks.push(cur);
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const out = await ai([
        {
          role: 'system',
          content:
            'You are given the text of UPSC Civil Services Prelims General Studies MCQs. For EACH numbered question output an object: {"number":<int>,"q":"<full question stem, INCLUDING any 1./2./3. numbered statements or Consider-the-following list and the closing line like \'Which of the above is/are correct?\'>","options":["<a>","<b>","<c>","<d>"]}. Keep exactly the 4 options in order. Fix obvious spacing artifacts from PDF extraction. Do NOT invent, reorder, or answer. Output ONLY a JSON array.',
        },
        { role: 'user', content: chunk },
      ]);
      const arr = parseJson(out);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }));
  return results.flat();
}

(async () => {
  console.log(`UPSC ingest — ${APPLY ? 'APPLY' : 'DRY RUN'}\n  paper: ${PAPER}\n  key:   ${KEY_JSON} (series ${SERIES})\n  ${EXAM} ${YEAR}  source_id=${SOURCE_ID}\n`);
  if (!fs.existsSync(PAPER)) { console.error(`paper not found: ${PAPER}`); process.exit(1); }
  if (!fs.existsSync(KEY_JSON)) { console.error(`key JSON not found: ${KEY_JSON} — build it (cross-verified) first`); process.exit(1); }

  const keyRaw = JSON.parse(fs.readFileSync(KEY_JSON, 'utf8'));
  // Accept either {answers:{...},series:"A"} or a bare {number:letter} map.
  const key = keyRaw.answers || keyRaw;
  if (keyRaw.series && keyRaw.series !== SERIES) console.warn(`  WARNING: key series ${keyRaw.series} != --series ${SERIES}`);

  let text = extractText(PAPER);
  if (text.replace(/\s/g, '').length < 2000) {
    console.log(`Thin text layer (${text.length} chars) — local OCR...`);
    text = ocrPdfLocal(PAPER);
    console.log(`OCR'd to ${text.length} chars.`);
  } else {
    console.log(`Text-layer paper (${text.length} chars).`);
  }
  const questions = await structureQuestions(text);
  console.log(`Structured questions: ${questions.length}   cross-verified key entries: ${Object.keys(key).length}`);

  const letterIdx = { a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
  let rows = []; let noKey = 0, badOpts = 0;
  for (const q of questions) {
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    if (opts.length !== 4) { badOpts++; continue; }
    const letter = key[String(q.number)];
    if (!letter || !(letter in letterIdx)) { noKey++; continue; }
    const idx = letterIdx[letter];
    if (idx >= opts.length) { badOpts++; continue; }
    const qtext = String(q.q || '').trim();
    if (qtext.length < 20) { badOpts++; continue; }
    rows.push({
      id: `${SOURCE_ID}-q${q.number}`,
      source_id: SOURCE_ID, exam: EXAM, year: YEAR,
      subject: null, topic: null,
      question_number: String(q.number),
      question_text: qtext, options: opts, answer_text: opts[idx],
      question_type: 'objective',
      answer_source: 'crossverified-key', // 2+ agreeing public keys
      confidence: 0.9,
    });
  }
  const seen = new Set();
  rows = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  console.log(`\nBuildable rows: ${rows.length}   (dropped: no-key ${noKey}, bad-options ${badOpts})`);
  console.log('\nSamples:');
  rows.slice(0, 4).forEach((r) => {
    console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 100)}`);
    r.options.forEach((o, i) => console.log(`   ${'abcd'[i]}) ${o.slice(0, 70)}${o === r.answer_text ? '   <-- ANSWER' : ''}`));
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/upsc-ingest-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));
  console.log(`\nBackup: recovery/upsc-ingest-${SOURCE_ID}-${stamp}.json`);

  if (!APPLY) { console.log('\nDRY RUN — verify samples. Add --apply to upsert.'); return; }

  const srcRow = {
    id: SOURCE_ID, exam: EXAM, board: 'UPSC', year: YEAR, language: 'English',
    title: `UPSC CSE Prelims ${YEAR} — General Studies Paper I (Series ${SERIES})`,
    file_name: path.basename(PAPER), file_path: PAPER, source_type: 'official-pdf',
  };
  const sr = await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(srcRow),
  });
  if (!sr.ok) { console.error(`source insert failed ${sr.status}: ${(await sr.text()).slice(0, 200)}`); process.exit(1); }
  console.log(`Registered source ${SOURCE_ID}.`);

  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, {
      method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch),
    });
    if (r.ok) ok += batch.length; else console.warn(`  batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  console.log(`Done. Upserted ${ok} rows for ${EXAM} ${YEAR}.`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
