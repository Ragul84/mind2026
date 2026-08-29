/**
 * Step 1 of UPSC ingest: turn a prelims GS paper PDF into structured questions.
 * Text-layer PDFs are read with pdftotext; scanned ones are OCR'd locally
 * (ghostscript + tesseract). aiand structures each numbered MCQ into
 * {number, q, options[4]}. Writes tmp-pyq/upsc/<year>-questions.json.
 *
 * Kept separate from key-matching so the (verbatim) questions are locked before
 * answers are attached from cross-verified sources.
 *
 *   node scripts/upsc-structure.cjs --paper tmp-pyq/upsc/2013-gs1-paper.pdf --year 2013
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const PAPER = arg('paper');
const YEAR = parseInt(arg('year', '0'), 10) || null;
const OUT = arg('out', path.resolve(__dirname, `../tmp-pyq/upsc/${YEAR}-questions.json`));
const OR_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = arg('model', process.env.OPENROUTER_FREE_MODEL || 'openrouter/free');
if (!OR_KEY) { console.error('need OPENROUTER_API_KEY'); process.exit(1); }
if (!PAPER || !fs.existsSync(PAPER)) { console.error('need --paper (existing PDF)'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenRouter free endpoint. Free models throttle (429) intermittently — retry
// with generous backoff so a whole run doesn't die on a transient upstream limit.
async function ai(messages) {
  for (let a = 0; a < 7; a++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
        signal: ctrl.signal,
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, messages }),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`OR ${r.status}: ${(await r.text()).slice(0, 140)}`);
      const c = String((await r.json())?.choices?.[0]?.message?.content || '').trim();
      if (!c) throw new Error('empty'); return c;
    } catch (e) { if (a === 6) throw e; await sleep(4000 * (a + 1)); } finally { clearTimeout(timer); }
  }
}
const parseJson = (s) => JSON.parse(s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

function pdftotextBin() {
  for (const c of [process.env.PDFTOTEXT, 'C:/Program Files/Git/mingw64/bin/pdftotext.exe', '/mingw64/bin/pdftotext'].filter(Boolean)) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'pdftotext';
}
const extractText = (pdf) => { try { return execFileSync(pdftotextBin(), ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };
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
// Drop Hindi/Devanagari + page furniture; keep the English MCQ lines.
function englishLines(text) {
  return text.split('\n').filter((ln) => {
    const t = ln.trim(); if (!t) return false;
    if (/devanagari/i.test(t)) return false;
    const nonascii = (t.match(/[^\x00-\x7F]/g) || []).length;
    if (nonascii > t.length * 0.3) return false; // mostly non-latin -> Hindi
    return true;
  }).join('\n');
}

function chunkText(text) {
  // Prefer splitting on question-number boundaries, but OCR of scanned papers
  // often has numbers mid-line — so fall back to fixed-size windows (with a small
  // overlap so a question split across a boundary is still seen whole once).
  const blocks = text.split(/(?=(?:^|\s)\d{1,3}\.\s)/m).filter((b) => b.trim());
  const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + b).length > 2600 && cur) { chunks.push(cur); cur = ''; } cur += b; }
  if (cur.trim()) chunks.push(cur);
  if (chunks.length <= 1 && text.length > 6000) {
    // boundary split failed — hard windows of 5000 chars with 400 overlap
    chunks.length = 0;
    for (let i = 0; i < text.length; i += 2500) chunks.push(text.slice(i, i + 2900));
  }
  return chunks;
}
async function structureQuestions(text) {
  const chunks = chunkText(text);
  // Sequential (not parallel) — free-tier models throttle hard under bursts, so
  // one-at-a-time with the built-in backoff is more reliable end to end.
  const results = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    try {
      const out = await ai([
        { role: 'system', content: 'You are given text of UPSC Civil Services Prelims General Studies MCQs (English; Hindi already removed). For EACH numbered question output {"number":<int>,"q":"<full stem INCLUDING any 1./2./3. statements and the closing line>","options":["<a>","<b>","<c>","<d>"]}. Exactly 4 options in printed order. Fix OCR spacing artifacts (e.g. "(c}"->"(c)"). Do NOT invent, reorder, translate, or answer. Output ONLY a JSON array.' },
        { role: 'user', content: chunks[ci] },
      ]);
      const arr = parseJson(out); if (Array.isArray(arr)) results.push(...arr);
    } catch { /* skip chunk */ }
    process.stdout.write(`  chunk ${ci + 1}/${chunks.length}\r`);
  }
  return results;
}

(async () => {
  const cachePath = path.join(path.dirname(OUT), `${YEAR}-ocr.txt`);
  let text = extractText(PAPER);
  if (englishLines(text).replace(/\s/g, '').length < 2000) {
    if (fs.existsSync(cachePath)) {
      console.log(`Using cached OCR (${cachePath})`);
      text = fs.readFileSync(cachePath, 'utf8');
    } else {
      console.log(`Scanned paper — local OCR (200 dpi)...`);
      text = ocrPdfLocal(PAPER, 200);
      fs.writeFileSync(cachePath, text);
    }
  }
  const eng = englishLines(text);
  console.log(`English text: ${eng.length} chars`);
  const questions = (await structureQuestions(eng))
    .filter((q) => q && Number.isInteger(q.number) && Array.isArray(q.options) && q.options.length === 4 && String(q.q || '').length > 15)
    .sort((a, b) => a.number - b.number);
  // dedupe by number
  const seen = new Set(); const uniq = questions.filter((q) => (seen.has(q.number) ? false : (seen.add(q.number), true)));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(uniq, null, 2));
  console.log(`Structured ${uniq.length} questions (numbers ${uniq[0]?.number}..${uniq[uniq.length - 1]?.number}) -> ${OUT}`);
  console.log('\nSample:');
  uniq.slice(0, 3).forEach((q) => { console.log(`\n[Q${q.number}] ${q.q.slice(0, 90)}`); q.options.forEach((o, i) => console.log(`   ${'abcd'[i]}) ${String(o).slice(0, 64)}`)); });
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
